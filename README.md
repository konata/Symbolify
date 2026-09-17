# Symbolify

IntelliJ ⌘⌥O-style symbol search for [tinycast](https://github.com/abue-ammar/tinycast), over
symbol indexes you generate from any source tree (built and used against AOSP `frameworks/base`).

- **Five matching tiers**: prefix > acronym (hump-initial subsequence, `ATMS` →
  `ActivityTaskManagerService`) > word-start substring > substring > separator-insensitive
  substring (`graceperiod` → `BAL_ALLOW_GRACE_PERIOD`) > fuzzy subsequence with fzf-style
  scoring (consecutive-run / word-start bonuses, gap penalty)
- **Multi-source merged search**: every enabled source is searched at once with one unified
  ranking; the same symbol hit in several sources lists once per source, tagged `· source`
- **IntelliJ-style rows**: kind icons with letter circles (class / interface / enum / method /
  field), signatures as parameter-type lists — `reparent(SurfaceControl, SurfaceControl)`
- **Enter** jumps to `file:line` in Zed (jump before the host closes the window); ⌘C copies
  the path, ⌥⌘C copies `path:line`

## Requirements

- [tinycast](https://github.com/abue-ammar/tinycast)
- [universal-ctags](https://github.com/universal-ctags/ctags) (`brew install universal-ctags`)
- [Bun](https://bun.sh) (build the extension and run the generator)

## Usage

**1. Generate an index** from a source tree (Java only; tests excluded):

```sh
bun tools/generate.js --root ~/src/frameworks/base --scan core,services
# -> out/base.json (~281k symbols from AOSP core+services, ~16MB)
```

`--out` overrides the output path; the `CTAGS` env var overrides the ctags binary.
The JSON is pure data (symbols + relative paths + line numbers) — no absolute paths,
so one file works on any machine.

**2. Install the extension**:

```sh
./deploy.sh        # builds and copies into tinycast's extensions directory
```

Restart tinycast afterwards so the extension is picked up.

**3. Configure sources** in tinycast Settings → Extensions → Symbolify. Two source slots,
each: Enabled checkbox, Name, Symbols JSON (file picker), Base Directory (the source tree
the index was generated from — required, since indexes are path-free).

The search placeholder shows the enabled source names joined with `&`.

## Layout

```
extension/     Raycast-format extension source (zero npm deps)
tools/         generate.js — ctags scan → JSON index; icon.swift — regenerates the icon
out/           generated indexes (gitignored)
build.sh       bundle with Bun, externalize @raycast/api and react
deploy.sh      build + install into ~/Library/Application Support/com.tinycast.app
```

## tinycast host notes

Behavior verified against tinycast 0.10.23 sources; these shape the code:

- Icon sources must end in `-16` for raw SF Symbol lookup; bare dotted names resolve as
  asset file paths and silently fall back to a placeholder. `tintColor` takes hex.
- Preference type strings for pickers are `file` / `directory` — the Raycast-standard
  `filePicker` / `directoryPicker` silently degrade to text fields.
- List row `accessories` are not rendered, and title/subtitle have a fixed gap — hence
  signatures embedded in the title.
- `closeMainWindow` tears down the extension session, so the Zed jump fires first.

## License

[MIT](LICENSE)
