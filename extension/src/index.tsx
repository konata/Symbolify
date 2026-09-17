import { Action, ActionPanel, Clipboard, closeMainWindow, getPreferenceValues, Icon, List, showHUD } from "@raycast/api";
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { useEffect, useMemo, useState } from "react";

const ZED = ["/usr/local/bin/zed", "/opt/homebrew/bin/zed", "/usr/bin/zed"].find(existsSync);

// kind -> IntelliJ Find Symbol style letter circles and ranking weight (types first).
// The icon source must end in -16: the host resolves bare dotted names (m.circle.fill)
// as asset file paths; only the -16 suffix falls through to a raw SF Symbol lookup.
// tintColor takes hex strings.
const KIND: Record<string, { glyph: string; color: string; pri: number }> = {
  c: { glyph: "c.circle.fill-16", color: "#40B6E0", pri: 0 },
  i: { glyph: "i.circle.fill-16", color: "#8CC17E", pri: 1 },
  g: { glyph: "e.circle.fill-16", color: "#E8A33D", pri: 2 },
  m: { glyph: "m.circle.fill-16", color: "#B389C5", pri: 3 },
  f: { glyph: "f.circle.fill-16", color: "#5CA8E0", pri: 4 },
  e: { glyph: "e.square.fill-16", color: "#EDD5A3", pri: 4 },
};

interface Index {
  files: string[];
  names: string[];
  kinds: string;
  fileIdx: number[];
  lines: number[];
  sigs: string[];
  owners?: string[]; // enclosing class for members, e.g. Uri.OpaqueUri (empty for top-level types)
  lower?: string[];
  nosep?: string[]; // lowercased name with _ . $ stripped, so graceperiod hits grace_period
  initials?: string[];
}

// active source: loaded index + display name + base (indexes carry no tree path, they are portable)
interface Source extends Index {
  name: string;
}

const expand = (path: string) => path.replace(/^~(?=\/)/, process.env.HOME ?? "");

// settings-page source slots: enabled checkbox plus a JSON path activates a slot;
// the name is the Name field verbatim, no fallback
function configuredSources(prefs: Record<string, string | boolean | undefined>) {
  const out: { name: string; json: string; base: string }[] = [];
  for (let n = 1; n <= 2; n++) {
    const json = prefs[`src${n}Json`];
    if (!prefs[`src${n}On`] || typeof json !== "string" || !json) continue;
    const base = prefs[`src${n}Base`];
    const name = prefs[`src${n}Name`];
    out.push({
      json: expand(json),
      base: typeof base === "string" && base ? expand(base) : "",
      name: typeof name === "string" ? name.trim() : "",
    });
  }
  return out;
}

function loadIndex(json: string): Index {
  const idx = JSON.parse(readFileSync(json, "utf8")) as Index;
  idx.lower = [];
  idx.nosep = [];
  idx.initials = [];
  for (const n of idx.names) {
    let initials = "";
    let prevLower = false; // after a lowercase/digit char, a separator or uppercase starts a word
    let prevSep = true;    // start of line and after `.` `_` `$` count as word starts
    for (const ch of n) {
      const isUpper = ch >= "A" && ch <= "Z";
      const isLower = (ch >= "a" && ch <= "z") || (ch >= "0" && ch <= "9");
      if (isUpper && (prevLower || prevSep)) initials += ch.toLowerCase();
      else if (isLower && prevSep) initials += ch;
      prevLower = isLower;
      prevSep = ch === "." || ch === "_" || ch === "$";
    }
    const lower = n.toLowerCase();
    idx.lower.push(lower);
    idx.nosep.push(lower.replace(/[_$.]/g, ""));
    idx.initials.push(initials);
  }
  return idx;
}

function openInZed(abs: string, line: number) {
  if (!ZED) return;
  // jump first, close after: tinycast tears down the extension session on closeMainWindow,
  // leaving in-flight host calls to die silently
  const child = spawn(ZED, [`${abs}:${line}`], { detached: true, stdio: "ignore" });
  child.unref();
}

// greedy leftmost subsequence match with fzf-style scoring: escalating bonus for
// consecutive runs, bonus for word starts (humps/separators/line start), gap penalty.
// Returns null on no match; the score feeds ranking (higher = better, folded into quality).
function matchSubsequence(query: string, name: string, lower: string) {
  let t = 0, run = 0, score = 0;
  for (let c = 0; c < query.length; c++) {
    const at = lower.indexOf(query[c], t);
    if (at === -1) return null;
    if (c > 0) {
      const gap = at - t;
      if (gap === 0) score += ++run * 2;
      else { run = 0; score -= Math.min(gap, 8); }
    }
    if (at === 0 || "_.$".includes(name[at - 1]) || name[at] !== lower[at]) score += 4;
    t = at + 1;
  }
  return score;
}

function isSubsequenceOf(query: string, target: string) {
  let t = 0;
  for (const ch of query) {
    t = target.indexOf(ch, t);
    if (t === -1) return false;
    t++;
  }
  return true;
}

// search every enabled source together, one unified ranking: tier > kind weight > name
// length (minus fuzzy bonus), sources themselves don't affect order.
// tiers: 0 prefix / 1 acronym (hump-initial subsequence, ATMS -> ActivityTaskManagerService)
// / 2 word-start substring / 3 substring / 4 fuzzy subsequence
function rankAll(sources: Source[], query: string, limit = 50) {
  const ql = query.toLowerCase();
  if (!ql) return [] as { s: Source; i: number; score: number }[];
  const hits: { s: Source; i: number; score: number }[] = [];
  const q = ql.replace(/[_$.]/g, "");
  for (const s of sources) {
    const { lower, nosep, names, kinds, initials } = s;
    for (let i = 0; i < lower!.length; i++) {
      const at = lower![i].indexOf(ql);
      let tier = -1, bonus = 0;
      if (at === 0) tier = 0;
      else if (at > 0) {
        const prev = names[i][at - 1];
        const hump = names[i][at] !== lower![i][at];
        tier = hump || prev === "." || prev === "_" || prev === "$" ? 2 : 3;
      } else if (q && nosep![i].indexOf(q) !== -1) {
        // literal substring missed: retry with separators stripped on both sides
        // (graceperiod -> BAL_ALLOW_GRACE_PERIOD)
        tier = nosep![i].startsWith(q) ? 0 : 3;
      } else if (ql.length >= 2 && isSubsequenceOf(ql, initials![i])) tier = 1;
      else if (ql.length >= 3) {
        const fuzzy = matchSubsequence(ql, names[i], lower![i]);
        if (fuzzy !== null) { tier = 4; bonus = fuzzy; }
      }
      if (tier === -1) continue;
      const quality = Math.min(Math.max(names[i].length - bonus, 0), 9999);
      hits.push({ s, i, score: tier * 1e6 + (KIND[kinds[i]]?.pri ?? 5) * 1e4 + quality });
    }
  }
  hits.sort((a, b) => a.score - b.score);
  return hits.slice(0, limit);
}

export default function Command() {
  const [sources, setSources] = useState<{ ok: Source[]; failed: string[] } | null>(null);
  useEffect(() => {
    const ok: Source[] = [];
    const failed: string[] = [];
    for (const cfg of configuredSources(getPreferenceValues())) {
      if (!cfg.base) {
        failed.push(cfg.name);
        continue;
      }
      try {
        const idx = loadIndex(cfg.json);
        ok.push({ ...idx, root: cfg.base, name: cfg.name });
      } catch {
        failed.push(cfg.name);
      }
    }
    setSources({ ok, failed });
  }, []);
  const [query, setQuery] = useState("");
  const hits = useMemo(() => (sources ? rankAll(sources.ok, query) : []), [sources, query]);
  // placeholder = enabled source names joined with " & ", so what you're searching is visible
  const activeNames = sources?.ok.map((s) => s.name).filter(Boolean).join(" & ");
  const placeholder = activeNames || (sources?.ok.length ? "" : sources ? "No sources enabled" : "Loading…");

  // no sources or all failed: point at the settings instead of an opaque empty list
  if (sources && !sources.ok.length) {
    return (
      <List onSearchTextChange={setQuery} searchBarPlaceholder={placeholder}>
        <List.Item
          icon={{ source: "exclamationmark.circle-16", tintColor: "#E8A33D" }}
          title={sources.failed.length ? `Failed to load: ${sources.failed.join(", ")}` : "No sources enabled"}
          subtitle={sources.failed.length ? "Check the JSON paths and base directories in settings" : "Enable a source in Symbolify settings to start searching"}
        />
      </List>
    );
  }

  return (
    <List isLoading={!sources} onSearchTextChange={setQuery} searchBarPlaceholder={placeholder}>
      {hits.map(({ s, i }) => {
        const kind = KIND[s.kinds[i]] ?? { glyph: "questionmark.circle-16", color: "#9AA5B1", pri: 5 };
        const sig = s.sigs[i];
        // IDEA style: the signature sits right next to the symbol name (zero gap for
        // methods, colon for fields) because title/subtitle have a fixed host-side gap
        const isMethod = s.kinds[i] === "m";
        const title = sig ? (isMethod ? `${s.names[i]}${sig}` : `${s.names[i]}: ${sig}`) : s.names[i];
        const file = s.files[s.fileIdx[i]];
        const abs = `${s.root}/${file}`;
        return (
          <List.Item
            key={`${s.name}:${file}:${s.lines[i]}`}
            icon={{ source: kind.glyph, tintColor: kind.color }}
            title={title}
            subtitle={[s.owners?.[i], file, s.name].filter(Boolean).join(" · ")}
            actions={
              <ActionPanel>
                <Action
                  title="Open in Zed"
                  icon={Icon.ArrowRight}
                  onAction={async () => {
                    openInZed(abs, s.lines[i]);
                    await closeMainWindow();
                  }}
                />
                <Action
                  title="Copy Path"
                  icon={Icon.Clipboard}
                  shortcut={{ modifiers: ["cmd"], key: "c" }}
                  onAction={async () => { await Clipboard.copy(abs); await showHUD("Path copied"); }}
                />
                <Action
                  title="Copy path:line"
                  icon={Icon.Clipboard}
                  shortcut={{ modifiers: ["opt", "cmd"], key: "c" }}
                  onAction={async () => { await Clipboard.copy(`${abs}:${s.lines[i]}`); await showHUD("path:line copied"); }}
                />
              </ActionPanel>
            }
          />
        );
      })}
    </List>
  );
}
