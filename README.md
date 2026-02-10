# DiffDen

DiffDen is a terminal UI app that watches files like `AGENT_SCRATCHPAD.md` and snapshots every change into an internal git repository.

Requires Bun (`bun --version`).

## Local development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

## TUI harness (responsive + PTY)

Run an automated smoke harness that drives the real terminal UI, records output, and checks multiple screen sizes:

```bash
bun run harness:tui
```

Useful options:

```bash
# custom viewport matrix
bun bin/tui-harness.ts smoke --sizes=80x24,100x30,140x42

# multi-file scenario (tracks 3 files and mutates each)
bun bin/tui-harness.ts smoke --scenario=multi-file

# custom artifacts directory
bun bin/tui-harness.ts smoke --out=artifacts/tui-harness/local-run
```

Artifacts are written per viewport:
- `<size>.raw.log`: raw PTY transcript (ANSI intact)
- `<size>.screen.txt`: ANSI-stripped text capture
- `<size>.final-screen.txt`: reconstructed final terminal buffer
- `<size>.screen.png`: image snapshot of the reconstructed terminal screen
- `<size>.highlights.txt`: filtered lines useful for quick debugging
- `summary.json` and `REPORT.md`: run-level summary

For manual testing in a fixed-size PTY:

```bash
bun run harness:tui:interactive
```

## CLI usage

```bash
npx diffden
```

Or install globally:

```bash
npm install -g diffden
diffden
```
