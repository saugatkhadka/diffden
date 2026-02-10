# DiffDen

DiffDen is a terminal UI app that watches files like `AGENT_SCRATCHPAD.md` and snapshots every change into an internal git repository.

## Local development

```bash
bun install
bun run dev
```

## Build

```bash
bun run build
```

## CLI usage

After publishing to npm, users can run DiffDen with a single command:

```bash
npx diffden
```

Or install globally:

```bash
npm install -g diffden
diffden

```

This project was created using `bun init` in bun v1.3.8. [Bun](https://bun.com) is a fast all-in-one JavaScript runtime.
