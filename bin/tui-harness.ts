#!/usr/bin/env bun

import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";

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
  finalScreenLog: string;
  screenImage?: string;
  highlightsLog: string;
  checks: {
    hasTitle: boolean;
    hasSnapshotsHeader: boolean;
    hasPreviewColumn: boolean;
    hasScenarioFileMarker: boolean;
  };
  passed: boolean;
  stderr?: string;
}

interface HarnessOptions {
  mode: "smoke" | "interactive";
  sizes: Viewport[];
  outDir: string;
  keepTemp: boolean;
  scenario: "basic" | "multi-file";
}

const DEFAULT_SIZES = ["80x24", "105x30", "140x40"];
const DEFAULT_INTERACTIVE_SIZE = "120x36";
const DEFAULT_OUT_ROOT = "artifacts/tui-harness";
const DEFAULT_SCENARIO: HarnessOptions["scenario"] = "basic";

function printHelp() {
  console.log(`DiffDen TUI Harness

Usage:
  bun bin/tui-harness.ts smoke [--sizes=80x24,105x30,140x40] [--scenario=basic|multi-file] [--out=artifacts/tui-harness/<name>] [--keep-temp]
  bun bin/tui-harness.ts interactive [--size=120x36] [--scenario=basic|multi-file] [--keep-temp]

Modes:
  smoke        Run scripted PTY scenarios across multiple terminal sizes and save artifacts.
  interactive  Open a manual TUI session in a fixed-size PTY.

Scenarios:
  basic        Single watched file with edits + navigation.
  multi-file   Three watched files with edits on each + navigation.
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
  let scenario: HarnessOptions["scenario"] = DEFAULT_SCENARIO;

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
    if (arg.startsWith("--scenario=")) {
      const raw = arg.slice("--scenario=".length).trim();
      if (raw !== "basic" && raw !== "multi-file") {
        throw new Error(`Invalid scenario "${raw}". Expected: basic|multi-file`);
      }
      scenario = raw;
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

  return { mode, sizes, outDir, keepTemp, scenario };
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
  const deAnsi = stripAnsi(stripScriptMeta(raw));
  const normalized = deAnsi.replace(/\r/g, "\n");

  const compactLines: string[] = [];
  for (const line of normalized.split("\n")) {
    const trimmedRight = line.replace(/\s+$/g, "");
    if (trimmedRight === compactLines[compactLines.length - 1]) continue;
    compactLines.push(trimmedRight);
  }

  return compactLines.join("\n").trim() + "\n";
}

function stripScriptMeta(raw: string): string {
  return raw.replace(/^Script started.*\n/m, "").replace(/\n?Script done.*$/m, "");
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

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function parseFinalScreenBuffer(raw: string, cols: number, rows: number): string[] {
  const buffer = Array.from({ length: rows }, () => Array.from({ length: cols }, () => " "));
  let row = 0;
  let col = 0;
  let savedRow = 0;
  let savedCol = 0;

  const clearAll = () => {
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        buffer[r]![c] = " ";
      }
    }
  };

  const clearLineFromCursor = (mode: number) => {
    if (mode === 2) {
      for (let c = 0; c < cols; c++) buffer[row]![c] = " ";
      return;
    }
    if (mode === 1) {
      for (let c = 0; c <= col; c++) buffer[row]![c] = " ";
      return;
    }
    for (let c = col; c < cols; c++) buffer[row]![c] = " ";
  };

  const putChar = (ch: string) => {
    if (row >= 0 && row < rows && col >= 0 && col < cols) {
      buffer[row]![col] = ch;
    }
    col += 1;
    if (col >= cols) {
      col = 0;
      row = Math.min(rows - 1, row + 1);
    }
  };

  let i = 0;
  while (i < raw.length) {
    const ch = raw[i]!;

    if (ch === "\u001b") {
      const next = raw[i + 1];
      if (next === "[") {
        let j = i + 2;
        while (j < raw.length) {
          const code = raw.charCodeAt(j);
          if (code >= 0x40 && code <= 0x7e) break;
          j += 1;
        }
        if (j >= raw.length) break;

        const final = raw[j]!;
        const payload = raw.slice(i + 2, j);
        const payloadNoPrivate = payload.replace(/^\?/, "");
        const parts =
          payloadNoPrivate.length > 0
            ? payloadNoPrivate.split(";").map((n) => Number.parseInt(n, 10) || 0)
            : [];
        const p1 = parts[0] ?? 0;
        const p2 = parts[1] ?? 0;

        switch (final) {
          case "H":
          case "f": {
            const targetRow = (p1 || 1) - 1;
            const targetCol = (p2 || 1) - 1;
            row = clamp(targetRow, 0, rows - 1);
            col = clamp(targetCol, 0, cols - 1);
            break;
          }
          case "A":
            row = clamp(row - (p1 || 1), 0, rows - 1);
            break;
          case "B":
            row = clamp(row + (p1 || 1), 0, rows - 1);
            break;
          case "C":
            col = clamp(col + (p1 || 1), 0, cols - 1);
            break;
          case "D":
            col = clamp(col - (p1 || 1), 0, cols - 1);
            break;
          case "J":
            if (p1 === 2 || p1 === 3 || p1 === 0) {
              clearAll();
            }
            break;
          case "K":
            clearLineFromCursor(p1);
            break;
          case "s":
            savedRow = row;
            savedCol = col;
            break;
          case "u":
            row = savedRow;
            col = savedCol;
            break;
          default:
            break;
        }

        i = j + 1;
        continue;
      }

      if (next === "]") {
        // OSC: consume until BEL or ST.
        let j = i + 2;
        while (j < raw.length) {
          if (raw[j] === "\u0007") {
            j += 1;
            break;
          }
          if (raw[j] === "\u001b" && raw[j + 1] === "\\") {
            j += 2;
            break;
          }
          j += 1;
        }
        i = j;
        continue;
      }

      if (next === "7") {
        savedRow = row;
        savedCol = col;
        i += 2;
        continue;
      }
      if (next === "8") {
        row = savedRow;
        col = savedCol;
        i += 2;
        continue;
      }

      i += 2;
      continue;
    }

    if (ch === "\r") {
      col = 0;
      i += 1;
      continue;
    }
    if (ch === "\n") {
      row = Math.min(rows - 1, row + 1);
      i += 1;
      continue;
    }
    if (ch === "\b") {
      col = Math.max(0, col - 1);
      i += 1;
      continue;
    }
    if (ch === "\t") {
      const nextTabCol = Math.min(cols - 1, col + (8 - (col % 8)));
      while (col < nextTabCol) {
        putChar(" ");
      }
      i += 1;
      continue;
    }

    if (ch >= " ") {
      putChar(ch);
    }
    i += 1;
  }

  return buffer.map((line) => line.join("").replace(/\s+$/g, ""));
}

async function renderScreenImage(
  screenLines: string[],
  outputPath: string,
  viewport: Viewport,
): Promise<boolean> {
  const screenText = screenLines.join("\n");
  const pointSize = 16;
  const cellWidthPx = 10;
  const cellHeightPx = 20;
  const paddingX = 12;
  const paddingY = 14;
  const canvasWidth = viewport.cols * cellWidthPx + paddingX * 2;
  const canvasHeight = viewport.rows * cellHeightPx + paddingY * 2;

  try {
    const proc = spawn(
      "convert",
      [
        "-size",
        `${canvasWidth}x${canvasHeight}`,
        "xc:#0d0d1a",
        "-fill",
        "#d7d7ff",
        "-font",
        "DejaVu-Sans-Mono",
        "-pointsize",
        String(pointSize),
        "-gravity",
        "NorthWest",
        "-annotate",
        `+${paddingX}+${paddingY + pointSize}`,
        screenText,
        outputPath,
      ],
      {
        stdio: ["ignore", "ignore", "pipe"],
      },
    );

    let stderr = "";
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });

    const exitCode = await waitForExit(proc);
    if (exitCode !== 0 && stderr.trim()) {
      console.error(`Image render failed: ${stderr.trim()}`);
    }
    return exitCode === 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Image render failed: ${message}`);
    return false;
  }
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
  scenarioContext: ScenarioContext;
  rawLog: string;
}): string {
  if (args.scenarioContext.scenario === "multi-file") {
    return buildSmokeCommandMultiFile(args);
  }
  return buildSmokeCommandBasic(args);
}

interface ScenarioContext {
  scenario: HarnessOptions["scenario"];
  watchedFiles: string[];
  projectDir: string;
}

function buildSmokeCommandBasic(args: {
  cols: number;
  rows: number;
  homeDir: string;
  scenarioContext: ScenarioContext;
  rawLog: string;
}): string {
  const watchedFile = args.scenarioContext.watchedFiles[0]!;
  const appCommand = `stty cols ${args.cols} rows ${args.rows}; HOME=${sh(args.homeDir)} bun src/cli.ts`;

  return `
set -euo pipefail
(
  sleep 1.8
  printf '%s\\n%s\\n' 'line 1' 'line 2' > ${sh(watchedFile)}
  sleep 1.2
  printf '%s\\n%s\\n%s\\n' 'line 1' 'line 2' 'line 3' > ${sh(watchedFile)}
) &
{
  sleep 3.2
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

function buildSmokeCommandMultiFile(args: {
  cols: number;
  rows: number;
  homeDir: string;
  scenarioContext: ScenarioContext;
  rawLog: string;
}): string {
  const [fileA, fileB, fileC] = args.scenarioContext.watchedFiles;
  if (!fileA || !fileB || !fileC) {
    throw new Error("multi-file scenario requires exactly 3 files");
  }

  const appCommand = `stty cols ${args.cols} rows ${args.rows}; HOME=${sh(args.homeDir)} bun src/cli.ts`;

  return `
set -euo pipefail
(
  sleep 2.4
  printf '%s\\n%s\\n' '# alpha' 'step 1' > ${sh(fileA)}
  sleep 0.7
  printf '%s\\n%s\\n' '# beta' 'step 1' > ${sh(fileB)}
  sleep 0.7
  printf '%s\\n%s\\n' '# gamma' 'step 1' > ${sh(fileC)}
  sleep 0.9
  printf '%s\\n%s\\n%s\\n' '# alpha' 'step 1' 'step 2' > ${sh(fileA)}
) &
{
  sleep 4.8
  printf 'l'
  sleep 0.35
  printf 'j'
  sleep 0.35
  printf 'k'
  sleep 0.35
  printf 'l'
  sleep 0.35
  printf 'j'
  sleep 0.35
  printf '\\t'
  sleep 0.35
  printf 'o'
  sleep 0.5
  printf 'q'
} | script -q -e -c ${sh(appCommand)} ${sh(args.rawLog)} >/dev/null
wait
`.trim();
}

async function buildScenarioContext(
  projectDir: string,
  scenario: HarnessOptions["scenario"],
): Promise<ScenarioContext> {
  if (scenario === "multi-file") {
    const files = [
      join(projectDir, "alpha.test.md"),
      join(projectDir, "beta.test.md"),
      join(projectDir, "gamma.test.md"),
    ];
    await writeFile(files[0]!, "# alpha\ninit\n", "utf8");
    await writeFile(files[1]!, "# beta\ninit\n", "utf8");
    await writeFile(files[2]!, "# gamma\ninit\n", "utf8");
    return { scenario, watchedFiles: files, projectDir };
  }

  const single = join(projectDir, "demo-note.md");
  await writeFile(single, "line 1\n", "utf8");
  return { scenario, watchedFiles: [single], projectDir };
}

function projectSlug(dirPath: string): string {
  return basename(resolve(dirPath)).replace(/[^a-zA-Z0-9_-]/g, "_");
}

async function primeHomeConfig(homeDir: string, scenarioContext: ScenarioContext): Promise<void> {
  const dataDir = join(homeDir, ".diffden");
  const reposDir = join(dataDir, "repos");
  const configPath = join(dataDir, "config.json");
  await mkdir(reposDir, { recursive: true });

  const config = {
    projects: [
      {
        slug: projectSlug(scenarioContext.projectDir),
        dir: scenarioContext.projectDir,
        files: scenarioContext.watchedFiles.map((file) => basename(file)),
      },
    ],
  };

  await writeFile(configPath, JSON.stringify(config, null, 2) + "\n", "utf8");
}

async function runSmokeViewport(options: {
  rootDir: string;
  outDir: string;
  viewport: Viewport;
  keepTemp: boolean;
  scenario: HarnessOptions["scenario"];
}): Promise<RunArtifacts> {
  const viewportLabel = `${options.viewport.cols}x${options.viewport.rows}`;
  const homeDir = await mkdtemp(join(tmpdir(), "diffden-harness-home-"));
  const projectDir = await mkdtemp(join(tmpdir(), "diffden-harness-project-"));
  const scenarioContext = await buildScenarioContext(projectDir, options.scenario);
  const rawLog = join(options.outDir, `${viewportLabel}.raw.log`);
  const textLog = join(options.outDir, `${viewportLabel}.screen.txt`);
  const finalScreenLog = join(options.outDir, `${viewportLabel}.final-screen.txt`);
  const screenImage = join(options.outDir, `${viewportLabel}.screen.png`);
  const highlightsLog = join(options.outDir, `${viewportLabel}.highlights.txt`);
  await primeHomeConfig(homeDir, scenarioContext);

  const started = Date.now();
  const command = buildSmokeCommand({
    cols: options.viewport.cols,
    rows: options.viewport.rows,
    homeDir,
    scenarioContext,
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

  const rawNoMeta = stripScriptMeta(rawText);
  const cleanText = cleanScriptOutput(rawNoMeta);
  const finalScreenLines = parseFinalScreenBuffer(rawNoMeta, options.viewport.cols, options.viewport.rows);
  const finalScreenText = finalScreenLines.join("\n") + "\n";
  const highlights = extractHighlights(cleanText);
  await writeFile(textLog, cleanText, "utf8");
  await writeFile(finalScreenLog, finalScreenText, "utf8");
  await writeFile(highlightsLog, highlights, "utf8");
  const imageGenerated = await renderScreenImage(finalScreenLines, screenImage, options.viewport);

  const checks = {
    hasTitle: finalScreenText.includes("DiffDen"),
    hasSnapshotsHeader: finalScreenText.includes("Snapshots"),
    hasPreviewColumn:
      finalScreenText.includes("Preview") ||
      finalScreenText.includes("Full Content") ||
      finalScreenText.includes("Diff"),
    hasScenarioFileMarker:
      options.scenario !== "multi-file"
        ? true
        : options.viewport.cols < 105
          ? true
          : scenarioContext.watchedFiles
              .map((file) => basename(file))
              .some((marker) => finalScreenText.includes(marker)),
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
    finalScreenLog,
    screenImage: imageGenerated ? screenImage : undefined,
    highlightsLog,
    checks,
    passed: exitCode === 0 && checks.hasTitle && checks.hasSnapshotsHeader && checks.hasPreviewColumn,
    stderr: stderr || undefined,
  };
}

async function runSmoke(options: HarnessOptions, rootDir: string) {
  await mkdir(options.outDir, { recursive: true });
  const results: RunArtifacts[] = [];

  console.log(`Running TUI harness in smoke mode for ${options.sizes.length} viewport(s)...`);
  console.log(`Scenario: ${options.scenario}`);
  for (const viewport of options.sizes) {
    const label = `${viewport.cols}x${viewport.rows}`;
    console.log(`- ${label}`);
    const artifacts = await runSmokeViewport({
      rootDir,
      outDir: options.outDir,
      viewport,
      keepTemp: options.keepTemp,
      scenario: options.scenario,
    });
    results.push(artifacts);
  }

  const summaryPath = join(options.outDir, "summary.json");
  const reportPath = join(options.outDir, "REPORT.md");

  const reportLines = [
    "# DiffDen TUI Harness Report",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Scenario: ${options.scenario}`,
    "",
    "| Viewport | Exit | Checks | Result |",
    "| --- | --- | --- | --- |",
    ...results.map((result) => {
      const checks = [
        result.checks.hasTitle ? "title" : "missing:title",
        result.checks.hasSnapshotsHeader ? "snapshots" : "missing:snapshots",
        result.checks.hasPreviewColumn ? "preview-col" : "missing:preview-col",
        result.checks.hasScenarioFileMarker ? "scenario-files" : "missing:scenario-files",
      ].join(", ");
      return `| ${result.viewport} | ${result.exitCode} | ${checks} | ${result.passed ? "pass" : "fail"} |`;
    }),
    "",
    "## Artifacts",
    "",
    ...results.flatMap((result) => [
      `- ${result.viewport} raw: ${result.rawLog}`,
      `- ${result.viewport} text: ${result.textLog}`,
      `- ${result.viewport} final-screen: ${result.finalScreenLog}`,
      `- ${result.viewport} image: ${result.screenImage ?? "(not generated)"}`,
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
        scenario: options.scenario,
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
  const scenarioContext = await buildScenarioContext(projectDir, options.scenario);
  await primeHomeConfig(homeDir, scenarioContext);

  console.log("Interactive harness session");
  console.log(`- viewport: ${viewport.cols}x${viewport.rows}`);
  console.log(`- scenario: ${options.scenario}`);
  console.log(`- isolated HOME: ${homeDir}`);
  console.log(`- demo files: ${scenarioContext.watchedFiles.join(", ")}`);
  console.log("- files are preconfigured for watching in this harness HOME");
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
