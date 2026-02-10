#!/usr/bin/env bun

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

interface Viewport {
  cols: number;
  rows: number;
}

interface RunArtifacts {
  viewport: string;
  exitCode: number;
  durationMs: number;
  rawLog: string;
  textLog: string;
  highlightsLog: string;
  checks: {
    hasTitle: boolean;
    hasSnapshotsHeader: boolean;
    hasPreviewHeader: boolean;
  };
  passed: boolean;
  stderr?: string;
}

interface HarnessOptions {
  mode: "smoke" | "interactive";
  sizes: Viewport[];
  outDir: string;
  keepTemp: boolean;
}

const DEFAULT_SIZES = ["80x24", "105x30", "140x40"];
const DEFAULT_INTERACTIVE_SIZE = "120x36";
const DEFAULT_OUT_ROOT = "artifacts/tui-harness";

function printHelp() {
  console.log(`DiffDen TUI Harness

Usage:
  bun bin/tui-harness.ts smoke [--sizes=80x24,105x30,140x40] [--out=artifacts/tui-harness/<name>] [--keep-temp]
  bun bin/tui-harness.ts interactive [--size=120x36] [--keep-temp]

Modes:
  smoke        Run scripted PTY scenarios across multiple terminal sizes and save artifacts.
  interactive  Open a manual TUI session in a fixed-size PTY.
`);
}

function parseViewport(value: string): Viewport {
  const match = /^(\d+)x(\d+)$/.exec(value.trim());
  if (!match) {
    throw new Error(`Invalid viewport "${value}". Expected format: <cols>x<rows>`);
  }

  const cols = Number(match[1]);
  const rows = Number(match[2]);
  if (cols < 40 || rows < 15) {
    throw new Error(`Viewport too small (${value}). Minimum is 40x15`);
  }

  return { cols, rows };
}

function parseOptions(argv: string[]): HarnessOptions {
  let mode: HarnessOptions["mode"] = "smoke";
  let sizes = DEFAULT_SIZES.map(parseViewport);
  let outDir = "";
  let keepTemp = false;

  const args = [...argv];
  if (args.length > 0 && !args[0]!.startsWith("-")) {
    const candidate = args.shift()!;
    if (candidate === "smoke" || candidate === "interactive") {
      mode = candidate;
    } else if (candidate === "help") {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Unknown mode "${candidate}"`);
    }
  }

  let hasExplicitInteractiveSize = false;

  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
    if (arg === "--keep-temp") {
      keepTemp = true;
      continue;
    }
    if (arg.startsWith("--sizes=")) {
      const raw = arg.slice("--sizes=".length).trim();
      if (!raw) throw new Error("Missing value for --sizes");
      sizes = raw.split(",").map(parseViewport);
      continue;
    }
    if (arg.startsWith("--size=")) {
      const raw = arg.slice("--size=".length).trim();
      if (!raw) throw new Error("Missing value for --size");
      sizes = [parseViewport(raw)];
      hasExplicitInteractiveSize = true;
      continue;
    }
    if (arg.startsWith("--out=")) {
      const raw = arg.slice("--out=".length).trim();
      if (!raw) throw new Error("Missing value for --out");
      outDir = resolve(raw);
      continue;
    }
    throw new Error(`Unknown flag "${arg}"`);
  }

  if (mode === "interactive" && !hasExplicitInteractiveSize) {
    sizes = [parseViewport(DEFAULT_INTERACTIVE_SIZE)];
  }

  if (!outDir) {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    outDir = resolve(join(DEFAULT_OUT_ROOT, stamp));
  }

  return { mode, sizes, outDir, keepTemp };
}

function sh(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function stripAnsi(input: string): string {
  // Covers CSI, OSC and single-character ESC controls.
  return input.replace(
    // biome-ignore lint/suspicious/noControlCharactersInRegex: ANSI sequence parsing
    /\u001b(?:\[[0-?]*[ -/]*[@-~]|\][^\u0007]*?(?:\u0007|\u001b\\)|[PX^_][\s\S]*?\u001b\\|[@-Z\\-_])/g,
    "",
  );
}

function cleanScriptOutput(raw: string): string {
  const withoutMeta = raw.replace(/^Script started.*\n/m, "").replace(/\n?Script done.*$/m, "");

  const deAnsi = stripAnsi(withoutMeta);
  const normalized = deAnsi.replace(/\r/g, "\n");

  const compactLines: string[] = [];
  for (const line of normalized.split("\n")) {
    const trimmedRight = line.replace(/\s+$/g, "");
    if (trimmedRight === compactLines[compactLines.length - 1]) continue;
    compactLines.push(trimmedRight);
  }

  return compactLines.join("\n").trim() + "\n";
}

function extractHighlights(cleanText: string): string {
  const keywords = [
    "DiffDen",
    "Projects",
    "Files",
    "Snapshots",
    "Preview",
    "watch",
    "restore",
    "expand",
    "Unknown command",
  ];

  const compact = cleanText.replace(/\s+/g, " ").trim();
  const snippets: string[] = [];

  for (const keyword of keywords) {
    const index = compact.toLowerCase().indexOf(keyword.toLowerCase());
    if (index === -1) continue;

    const start = Math.max(0, index - 35);
    const end = Math.min(compact.length, index + keyword.length + 90);
    const snippet = compact.slice(start, end);
    snippets.push(`${keyword}: ...${snippet}...`);
  }

  return (snippets.length > 0 ? snippets : ["(no highlight snippets matched)"]).join("\n") + "\n";
}

function waitForExit(proc: ChildProcess): Promise<number> {
  return new Promise((resolveExit, rejectExit) => {
    proc.on("error", rejectExit);
    proc.on("close", (code) => {
      resolveExit(code ?? 1);
    });
  });
}

async function runBash(command: string, cwd: string): Promise<{ exitCode: number; stderr: string }> {
  const proc = spawn("bash", ["-lc", command], {
    cwd,
    stdio: ["ignore", "ignore", "pipe"],
  });

  let stderr = "";
  proc.stderr?.on("data", (chunk: Buffer) => {
    stderr += chunk.toString("utf8");
  });

  const exitCode = await waitForExit(proc);
  return { exitCode, stderr: stderr.trim() };
}

function buildSmokeCommand(args: {
  cols: number;
  rows: number;
  homeDir: string;
  watchedFile: string;
  rawLog: string;
}): string {
  const watchCommand = `/watch ${args.watchedFile}`;
  const appCommand = `stty cols ${args.cols} rows ${args.rows}; HOME=${sh(args.homeDir)} bun src/cli.ts`;

  return `
set -euo pipefail
(
  sleep 1.8
  printf '%s\\n%s\\n' 'line 1' 'line 2' > ${sh(args.watchedFile)}
  sleep 1.2
  printf '%s\\n%s\\n%s\\n' 'line 1' 'line 2' 'line 3' > ${sh(args.watchedFile)}
) &
{
  sleep 0.7
  printf '%s\\r' ${sh(watchCommand)}
  sleep 2.8
  printf 'lll'
  sleep 0.5
  printf '\\t'
  sleep 0.5
  printf 'o'
  sleep 0.4
  printf 'q'
} | script -q -e -c ${sh(appCommand)} ${sh(args.rawLog)} >/dev/null
wait
`.trim();
}

async function runSmokeViewport(options: {
  rootDir: string;
  outDir: string;
  viewport: Viewport;
  keepTemp: boolean;
}): Promise<RunArtifacts> {
  const viewportLabel = `${options.viewport.cols}x${options.viewport.rows}`;
  const homeDir = await mkdtemp(join(tmpdir(), "diffden-harness-home-"));
  const projectDir = await mkdtemp(join(tmpdir(), "diffden-harness-project-"));
  const watchedFile = join(projectDir, "demo-note.md");
  const rawLog = join(options.outDir, `${viewportLabel}.raw.log`);
  const textLog = join(options.outDir, `${viewportLabel}.screen.txt`);
  const highlightsLog = join(options.outDir, `${viewportLabel}.highlights.txt`);

  await writeFile(watchedFile, "line 1\n", "utf8");

  const started = Date.now();
  const command = buildSmokeCommand({
    cols: options.viewport.cols,
    rows: options.viewport.rows,
    homeDir,
    watchedFile,
    rawLog,
  });

  const { exitCode, stderr } = await runBash(command, options.rootDir);
  const durationMs = Date.now() - started;

  let rawText = "";
  try {
    rawText = await readFile(rawLog, "utf8");
  } catch {
    rawText = "";
  }

  const cleanText = cleanScriptOutput(rawText);
  const highlights = extractHighlights(cleanText);
  await writeFile(textLog, cleanText, "utf8");
  await writeFile(highlightsLog, highlights, "utf8");

  const checks = {
    hasTitle: cleanText.includes("DiffDen"),
    hasSnapshotsHeader: cleanText.includes("Snapshots"),
    hasPreviewHeader: cleanText.includes("Preview"),
  };

  if (!options.keepTemp) {
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }

  return {
    viewport: viewportLabel,
    exitCode,
    durationMs,
    rawLog,
    textLog,
    highlightsLog,
    checks,
    passed: exitCode === 0 && checks.hasTitle && checks.hasSnapshotsHeader && checks.hasPreviewHeader,
    stderr: stderr || undefined,
  };
}

async function runSmoke(options: HarnessOptions, rootDir: string) {
  await mkdir(options.outDir, { recursive: true });
  const results: RunArtifacts[] = [];

  console.log(`Running TUI harness in smoke mode for ${options.sizes.length} viewport(s)...`);
  for (const viewport of options.sizes) {
    const label = `${viewport.cols}x${viewport.rows}`;
    console.log(`- ${label}`);
    const artifacts = await runSmokeViewport({
      rootDir,
      outDir: options.outDir,
      viewport,
      keepTemp: options.keepTemp,
    });
    results.push(artifacts);
  }

  const summaryPath = join(options.outDir, "summary.json");
  const reportPath = join(options.outDir, "REPORT.md");

  const reportLines = [
    "# DiffDen TUI Harness Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    "",
    "| Viewport | Exit | Checks | Result |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => {
      const checks = [
        result.checks.hasTitle ? "title" : "missing:title",
        result.checks.hasSnapshotsHeader ? "snapshots" : "missing:snapshots",
        result.checks.hasPreviewHeader ? "preview" : "missing:preview",
      ].join(", ");
      return `| ${result.viewport} | ${result.exitCode} | ${checks} | ${result.passed ? "pass" : "fail"} |`;
    }),
    "",
    "## Artifacts",
    "",
    ...results.flatMap((result) => [
      `- ${result.viewport} raw: ${result.rawLog}`,
      `- ${result.viewport} text: ${result.textLog}`,
      `- ${result.viewport} highlights: ${result.highlightsLog}`,
    ]),
    "",
  ];

  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        command: process.argv.join(" "),
        outputDir: options.outDir,
        results,
      },
      null,
      2,
    ) + "\n",
    "utf8",
  );
  await writeFile(reportPath, reportLines.join("\n"), "utf8");

  const failed = results.filter((result) => !result.passed);
  console.log(`\nSummary: ${results.length - failed.length}/${results.length} viewport runs passed`);
  console.log(`Artifacts: ${options.outDir}`);

  if (failed.length > 0) {
    console.log("Failed viewports:");
    for (const fail of failed) {
      console.log(`- ${fail.viewport} (exit=${fail.exitCode})`);
      if (fail.stderr) {
        console.log(`  stderr: ${fail.stderr}`);
      }
    }
    process.exit(1);
  }
}

async function runInteractive(options: HarnessOptions, rootDir: string) {
  const viewport = options.sizes[0]!;
  const homeDir = await mkdtemp(join(tmpdir(), "diffden-harness-home-"));
  const projectDir = await mkdtemp(join(tmpdir(), "diffden-harness-project-"));
  const watchedFile = join(projectDir, "demo-note.md");
  await writeFile(watchedFile, "line 1\n", "utf8");

  console.log("Interactive harness session");
  console.log(`- viewport: ${viewport.cols}x${viewport.rows}`);
  console.log(`- isolated HOME: ${homeDir}`);
  console.log(`- demo file: ${watchedFile}`);
  console.log("");
  console.log("Suggested first command inside DiffDen:");
  console.log(`/watch ${watchedFile}`);
  console.log("");

  const appCommand = `stty cols ${viewport.cols} rows ${viewport.rows}; HOME=${sh(homeDir)} bun src/cli.ts`;
  const proc = spawn("script", ["-q", "-e", "-c", appCommand, "/dev/null"], {
    cwd: rootDir,
    stdio: "inherit",
  });
  const exitCode = await waitForExit(proc);

  if (!options.keepTemp) {
    await rm(homeDir, { recursive: true, force: true });
    await rm(projectDir, { recursive: true, force: true });
  }

  process.exit(exitCode);
}

async function main() {
  try {
    const options = parseOptions(process.argv.slice(2));
    const rootDir = process.cwd();

    if (options.mode === "interactive") {
      await runInteractive(options, rootDir);
      return;
    }

    await runSmoke(options, rootDir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Harness failed: ${message}`);
    process.exit(1);
  }
}

await main();
