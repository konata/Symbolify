// Symbolify index generator: scan a source tree with universal-ctags and emit
// a compact JSON symbol index the extension can load.
//
// Usage:
//   bun tools/generate.js --root <source tree> [--scan core,services] [--out out/name.json]
//
// - --scan  : comma-separated directories under --root to recurse into
// - --out   : output path; defaults to out/<root basename>.json
// - CTAGS env overrides the ctags binary (defaults to Homebrew's, then PATH)
import { execFileSync } from "node:child_process";
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join, basename } from "node:path";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    root: { type: "string" },
    scan: { type: "string", default: "core,services" },
    out: { type: "string" },
  },
});
if (!values.root) {
  console.error("usage: bun tools/generate.js --root <source tree> [--scan core,services] [--out out/name.json]");
  process.exit(1);
}
const ROOT = values.root;
const OUT = values.out ?? join(import.meta.dir, "../out", `${basename(ROOT)}.json`);

// /usr/bin/ctags on macOS is the ancient Exuberant build; prefer Homebrew's u-ctags
const CTAGS = process.env.CTAGS
  ?? (existsSync("/opt/homebrew/bin/ctags") ? "/opt/homebrew/bin/ctags" : "ctags");

// kind whitelist: type-level plus methods/fields (packages not indexed)
const KINDS = new Set(["c", "i", "g", "m", "f", "e"]);

const tags = execFileSync(
  CTAGS,
  [
    "-R", "--languages=java", "--fields=+nlS", "--output-format=u-ctags", "-f", "-",
    "--exclude=.git", "--exclude=*/tests/*", "--exclude=*/androidTest/*", "--exclude=*/test/*",
    ...values.scan.split(","),
  ],
  { cwd: ROOT, maxBuffer: 512 * 1024 * 1024, encoding: "utf8" },
);

const names = [], kinds = [], fileIdx = [], lines = [], sigs = [];
const files = [];
const fileMap = new Map();

const MODIFIERS = new Set(["public", "private", "protected", "static", "final", "abstract",
  "synchronized", "native", "strictfp", "default", "transient", "volatile"]);

// IntelliJ Find Symbol style signatures: methods = (Type, Type) with parameter
// types only — no names, annotations, or return types; fields = the bare type.
const IDENT = /^[A-Za-z_$][\w$]*$/;

// split on top-level commas only; commas inside <>(){}[] belong to generics/annotation args
function splitTopLevel(s) {
  const out = [];
  let depth = 0, cur = "";
  for (const ch of s) {
    if (ch === "<" || ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ">" || ch === ")" || ch === "}" || ch === "]") depth--;
    if (ch === "," && depth === 0) { out.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

// one parameter -> its type: drop annotation tokens and the trailing bare-identifier name
function paramType(param) {
  const tokens = param.trim().split(/\s+/).filter((t) => t && !t.startsWith("@"));
  if (!tokens.length) return "";
  const last = tokens[tokens.length - 1];
  if (tokens.length > 1 && IDENT.test(last)) tokens.pop();
  return tokens.join(" ").replace(/\s+/g, " ").trim();
}

function signature(name, kind, pattern, ctagSig) {
  const decl = pattern.replace(/^\/\^/, "").replace(/\$\/;?"?$/, "").trim();
  if (kind === "m") {
    // prefer the declaration line for parameters; multi-line signatures fall back to
    // the ctags signature field, which carries its own outer parens — strip them first
    let params = "";
    const at = decl.indexOf(name + "(");
    const open = decl.indexOf("(", at);
    const close = decl.lastIndexOf(")");
    if (open > 0 && close > open) params = decl.slice(open + 1, close);
    if (!params && ctagSig) {
      params = ctagSig.startsWith("(") && ctagSig.endsWith(")")
        ? ctagSig.slice(1, -1) : ctagSig;
    }
    const types = splitTopLevel(params).map(paramType).filter(Boolean);
    const sig = `(${types.join(", ")})`;
    return sig.length > 100 ? sig.slice(0, 97) + "…)" : sig;
  }
  if (kind === "f") {
    const at = decl.indexOf(name);
    if (at <= 0) return "";
    const type = decl.slice(0, at).trim().split(/\s+/)
      .filter((t) => !MODIFIERS.has(t) && !t.startsWith("@")).join(" ");
    return type.slice(0, 100);
  }
  return "";
}

for (const line of tags.split("\n")) {
  const p = line.split("\t");
  if (p.length < 5) continue;
  const kind = p[3];
  if (!KINDS.has(kind)) continue;
  let fi = fileMap.get(p[1]);
  if (fi === undefined) { fi = files.length; fileMap.set(p[1], fi); files.push(p[1]); }
  let lineno = 0, ctagSig = null;
  for (const x of p.slice(4)) {
    if (x.startsWith("line:")) lineno = +x.slice(5);
    else if (x.startsWith("signature:")) ctagSig = x.slice(10);
  }
  names.push(p[0]); kinds.push(kind); fileIdx.push(fi); lines.push(lineno);
  sigs.push(signature(p[0], kind, p[2], ctagSig));
}

const index = { generated: new Date().toISOString(), files, names, kinds: kinds.join(""), fileIdx, lines, sigs };
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(index));
console.log(`files=${files.length} symbols=${names.length} -> ${OUT}`);
