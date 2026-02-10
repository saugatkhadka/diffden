import {
  createCliRenderer,
  BoxRenderable,
  TextRenderable,
  type CliRenderer,
  type SelectRenderable,
  type KeyEvent,
} from "@opentui/core";

import { loadConfig, saveConfig, addFileToConfig, removeFileFromConfig, getFullFilePath, type AppConfig, type ProjectConfig } from "./config.ts";
import { getLog, getDiff, getContent, restore, getSnapshotCount, getLatestSnapshot, snapshot, type SnapshotInfo } from "./tracker.ts";
import { startWatching, stopWatching, stopAll, onSnapshot } from "./watcher.ts";
import { openInEditor, getLinkInstructions } from "./editor.ts";
import { relativeTime, projectSlug } from "./utils.ts";
import { resolve as resolvePath, basename as basenamePath, dirname as dirnamePath } from "path";

import { createProjectList, updateProjectList, type ProjectItem } from "./ui/project-list.ts";
import { createFileList, updateFileList, type FileItem } from "./ui/file-list.ts";
import { createSnapshotList, updateSnapshotList } from "./ui/snapshot-list.ts";
import { createPreview, updatePreview } from "./ui/preview.ts";
import { createCommandBar, showInput, hideInput, setStatus, updateHints, type CommandBar } from "./ui/command-bar.ts";

// Column indices
const COL_PROJECTS = 0;
const COL_FILES = 1;
const COL_SNAPSHOTS = 2;
const COL_PREVIEW = 3;
const WIDE_LAYOUT_BREAKPOINT = 120;
const SNAPSHOT_DIFF_ONLY_BREAKPOINT = 105;

interface AppState {
  config: AppConfig;
  focusedColumn: number;
  selectedProject: ProjectConfig | null;
  selectedFileName: string | null;
  selectedSnapshot: SnapshotInfo | null;
  snapshots: SnapshotInfo[];
  previewMode: "diff" | "full";
  expandedColumn: number | null;
  commandMode: boolean;
}

export async function startApp(initialFilePath?: string) {
  const renderer = await createCliRenderer({
    exitOnCtrlC: true,
    useAlternateScreen: true,
    useMouse: true,
    backgroundColor: "#0d0d1a",
  });

  await renderer.setupTerminal();

  const state: AppState = {
    config: loadConfig(),
    focusedColumn: 0,
    selectedProject: null,
    selectedFileName: null,
    selectedSnapshot: null,
    snapshots: [],
    previewMode: "diff",
    expandedColumn: null,
    commandMode: false,
  };

  // If initial file was provided, add it
  if (initialFilePath) {
    state.config = addFileToConfig(state.config, initialFilePath);
  }

  // Create the root layout
  const rootBox = new BoxRenderable(renderer.root.ctx, {
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: "#0d0d1a",
  });

  // Title bar
  const titleBar = new TextRenderable(renderer.root.ctx, {
    content: " DiffDen ",
    fg: "#00d2ff",
    bg: "#16213e",
    height: 1,
    width: "100%",
    truncate: true,
  });

  // Columns container
  const columnsBox = new BoxRenderable(renderer.root.ctx, {
    flexDirection: "row",
    flexGrow: 1,
    width: "100%",
  });

  // Create column containers (boxes with borders)
  const projectBox = new BoxRenderable(renderer.root.ctx, {
    border: true,
    borderColor: "#00d2ff",
    title: " Projects ",
    backgroundColor: "#1a1a2e",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 18,
    overflow: "hidden",
  });

  const fileBox = new BoxRenderable(renderer.root.ctx, {
    border: true,
    borderColor: "#333355",
    title: " Files ",
    backgroundColor: "#1a1a2e",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 18,
    overflow: "hidden",
  });

  const snapshotBox = new BoxRenderable(renderer.root.ctx, {
    border: true,
    borderColor: "#333355",
    title: " Snapshots ",
    backgroundColor: "#1a1a2e",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 18,
    overflow: "hidden",
  });

  const previewBox = new BoxRenderable(renderer.root.ctx, {
    border: true,
    borderColor: "#333355",
    title: " Preview ",
    backgroundColor: "#0d0d1a",
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 18,
    overflow: "hidden",
  });

  // Create renderables inside each column
  const projectList = createProjectList(renderer.root.ctx);
  projectList.width = "100%";
  projectList.height = "100%";
  projectBox.add(projectList);

  const fileList = createFileList(renderer.root.ctx);
  fileList.width = "100%";
  fileList.height = "100%";
  fileBox.add(fileList);

  const snapshotList = createSnapshotList(renderer.root.ctx);
  snapshotList.width = "100%";
  snapshotList.height = "100%";
  snapshotBox.add(snapshotList);

  const preview = createPreview(renderer.root.ctx);
  previewBox.add(preview.container);

  // Command bar
  const commandBar = createCommandBar(renderer.root.ctx);

  // Assemble layout
  columnsBox.add(projectBox);
  columnsBox.add(fileBox);
  columnsBox.add(snapshotBox);
  columnsBox.add(previewBox);

  rootBox.add(titleBar);
  rootBox.add(columnsBox);
  rootBox.add(commandBar.container);

  renderer.root.add(rootBox);

  function getPreviewFocusable() {
    return state.previewMode === "diff" ? preview.diffText : preview.fullText;
  }

  function getColumnRenderable(col: number) {
    if (col === COL_PREVIEW) return getPreviewFocusable();
    return [projectList, fileList, snapshotList][col] ?? null;
  }
  const columnBoxes = [projectBox, fileBox, snapshotBox, previewBox];

  function getVisibleColumnIndices(width: number, focus: number): number[] {
    if (width >= WIDE_LAYOUT_BREAKPOINT) {
      return [COL_PROJECTS, COL_FILES, COL_SNAPSHOTS, COL_PREVIEW];
    }

    if (width >= SNAPSHOT_DIFF_ONLY_BREAKPOINT) {
      return focus <= COL_FILES
        ? [COL_PROJECTS, COL_FILES, COL_SNAPSHOTS]
        : [COL_FILES, COL_SNAPSHOTS, COL_PREVIEW];
    }

    // Compact layout for side-snapped terminals: keep snapshots + diff visible.
    return [COL_SNAPSHOTS, COL_PREVIEW];
  }

  function coerceFocusForViewport() {
    if (renderer.width < SNAPSHOT_DIFF_ONLY_BREAKPOINT && state.focusedColumn < COL_SNAPSHOTS) {
      state.focusedColumn = COL_SNAPSHOTS;
      snapshotList.focus();
    }
  }

  function applyColumnLayout() {
    const basePreviewGrow = state.previewMode === "diff" ? 2.5 : 1;
    const baseGrows = [1, 1, 1, basePreviewGrow];
    const visibleIndices = getVisibleColumnIndices(renderer.width, state.focusedColumn);
    const compactSnapshotDiffLayout = renderer.width < SNAPSHOT_DIFF_ONLY_BREAKPOINT;

    if (compactSnapshotDiffLayout) {
      baseGrows[COL_SNAPSHOTS] = 1;
      baseGrows[COL_PREVIEW] = state.previewMode === "diff" ? 3.6 : 2.1;
    }

    for (let i = 0; i < columnBoxes.length; i++) {
      columnBoxes[i]!.flexGrow = baseGrows[i]!;
    }

    if (state.expandedColumn !== null) {
      const isExpandedDiffPreview =
        state.expandedColumn === COL_PREVIEW && state.previewMode === "diff";

      if (isExpandedDiffPreview) {
        const otherVisibleCount = visibleIndices.filter((index) => index !== COL_PREVIEW).length;

        // Ensure preview uses ~70% when expanded, and more on very small screens.
        const targetPreviewShare =
          renderer.width < 80
            ? 0.85
            : renderer.width < SNAPSHOT_DIFF_ONLY_BREAKPOINT
              ? 0.8
              : renderer.width < WIDE_LAYOUT_BREAKPOINT
                ? 0.75
                : 0.7;
        const otherGrow = 1;
        const previewGrow =
          otherVisibleCount === 0
            ? 1
            : (targetPreviewShare * otherVisibleCount * otherGrow) / (1 - targetPreviewShare);

        for (const index of visibleIndices) {
          columnBoxes[index]!.flexGrow = index === COL_PREVIEW ? previewGrow : otherGrow;
        }
      } else {
        columnBoxes[state.expandedColumn]!.flexGrow = Math.max(...baseGrows) + 2;
      }
    }
  }

  function columnLabel(col: number): string {
    switch (col) {
      case COL_PROJECTS:
        return "Projects";
      case COL_FILES:
        return "Files";
      case COL_SNAPSHOTS:
        return "Snapshots";
      case COL_PREVIEW:
        return "Preview";
      default:
        return "Column";
    }
  }

  // --- Functions to update UI ---

  function updateColumnVisibility() {
    coerceFocusForViewport();
    applyColumnLayout();
    const visibleIndices = new Set(getVisibleColumnIndices(renderer.width, state.focusedColumn));
    for (let i = 0; i < columnBoxes.length; i++) {
      columnBoxes[i]!.visible = visibleIndices.has(i);
    }
  }

  function updateFocusStyles() {
    coerceFocusForViewport();
    for (let i = 0; i < columnBoxes.length; i++) {
      columnBoxes[i]!.borderColor = i === state.focusedColumn ? "#00d2ff" : "#333355";
    }
    updateHints(commandBar, state.focusedColumn);
    updateColumnVisibility();
  }

  function focusColumn(col: number) {
    if (col < 0 || col > 3) return;
    state.focusedColumn = col;

    // Focus the renderable in that column
    const target = getColumnRenderable(col);
    if (target && "focus" in target) {
      (target as any).focus();
    }

    updateFocusStyles();
    renderer.requestRender();
  }

  async function refreshProjects() {
    state.config = loadConfig();
    const items: ProjectItem[] = [];
    for (const project of state.config.projects) {
      const fileCount = project.files.length;
      items.push({ slug: project.slug, dir: project.dir, fileCount });
    }
    updateProjectList(projectList, items);

    if (items.length === 0) {
      titleBar.content = " DiffDen — use /watch <path> to add a file ";
    } else {
      titleBar.content = " DiffDen ";
    }
  }

  async function refreshFiles() {
    if (!state.selectedProject) {
      updateFileList(fileList, []);
      return;
    }
    const project = state.selectedProject;
    const items: FileItem[] = [];
    for (const fileName of project.files) {
      const count = await getSnapshotCount(project.slug, fileName);
      const latest = await getLatestSnapshot(project.slug, fileName);
      items.push({
        fileName,
        snapshotCount: count,
        lastChanged: latest?.date ?? null,
      });
    }
    updateFileList(fileList, items);
    fileBox.title = ` Files — ${project.slug} `;
  }

  async function refreshSnapshots() {
    if (!state.selectedProject || !state.selectedFileName) {
      updateSnapshotList(snapshotList, []);
      state.snapshots = [];
      state.selectedSnapshot = null;
      return;
    }
    const snaps = await getLog(state.selectedProject.slug, state.selectedFileName);
    state.snapshots = snaps;
    updateSnapshotList(snapshotList, snaps);
    snapshotBox.title = ` Snapshots — ${state.selectedFileName} `;

    if (snaps.length === 0) {
      state.selectedSnapshot = null;
      await refreshPreview();
      return;
    }

    const selectedHash = state.selectedSnapshot?.hash;
    const selectedIndex = selectedHash
      ? snaps.findIndex((snap) => snap.hash === selectedHash)
      : 0;
    const nextIndex = selectedIndex >= 0 ? selectedIndex : 0;

    snapshotList.setSelectedIndex(nextIndex);
  }

  async function refreshPreview() {
    if (!state.selectedProject || !state.selectedFileName || !state.selectedSnapshot) {
      updatePreview(preview, "", state.previewMode, state.selectedFileName);
      return;
    }
    const snap = state.selectedSnapshot;
    if (state.previewMode === "diff") {
      const diff = await getDiff(state.selectedProject.slug, snap.hash, state.selectedFileName);
      updatePreview(preview, diff, "diff", state.selectedFileName);
      previewBox.title = " Diff ";
    } else {
      const content = await getContent(state.selectedProject.slug, snap.hash, state.selectedFileName);
      updatePreview(preview, content, "full", state.selectedFileName);
      previewBox.title = " Full Content ";
    }
  }

  // --- Event handlers ---

  // Project selected
  projectList.on("selectionChanged", async (_index: number, option: any) => {
    if (!option?.value) return;
    const item = option.value as ProjectItem;
    state.selectedProject = state.config.projects.find((p) => p.slug === item.slug) ?? null;
    state.selectedFileName = null;
    state.selectedSnapshot = null;
    await refreshFiles();
    updateSnapshotList(snapshotList, []);
    updatePreview(preview, "", state.previewMode, state.selectedFileName);
  });

  projectList.on("itemSelected", async (_index: number, option: any) => {
    if (!option?.value) return;
    const item = option.value as ProjectItem;
    state.selectedProject = state.config.projects.find((p) => p.slug === item.slug) ?? null;
    await refreshFiles();
    focusColumn(COL_FILES);
  });

  // File selected
  fileList.on("selectionChanged", async (_index: number, option: any) => {
    if (!option?.value) return;
    const item = option.value as FileItem;
    state.selectedFileName = item.fileName;
    state.selectedSnapshot = null;
    await refreshSnapshots();
    await refreshPreview();
  });

  fileList.on("itemSelected", async (_index: number, option: any) => {
    if (!option?.value) return;
    const item = option.value as FileItem;
    state.selectedFileName = item.fileName;
    await refreshSnapshots();
    focusColumn(COL_SNAPSHOTS);
  });

  // Snapshot selected
  snapshotList.on("selectionChanged", async (_index: number, option: any) => {
    if (!option?.value) return;
    state.selectedSnapshot = option.value as SnapshotInfo;
    await refreshPreview();
  });

  snapshotList.on("itemSelected", async () => {
    focusColumn(COL_PREVIEW);
  });

  // Command input
  commandBar.input.on("enter", async (value: string) => {
    hideInput(commandBar);
    state.commandMode = false;
    focusColumn(state.focusedColumn);
    await handleCommand(value.trim());
  });

  async function handleCommand(cmd: string) {
    if (!cmd.startsWith("/")) return;
    const parts = cmd.slice(1).split(/\s+/);
    const command = parts[0];
    const arg = parts.slice(1).join(" ");

    switch (command) {
      case "watch": {
        if (!arg) {
          setStatus(commandBar, "Usage: /watch <file-path>");
          return;
        }
        state.config = addFileToConfig(state.config, arg);
        const watchAbsPath = resolvePath(arg);
        const watchSlug = projectSlug(dirnamePath(watchAbsPath));
        await snapshot(watchSlug, watchAbsPath);
        const watchProject = state.config.projects.find((p) => p.slug === watchSlug);
        if (watchProject) await startWatching(watchProject);
        await refreshProjects();
        setStatus(commandBar, `Watching: ${basenamePath(watchAbsPath)}`);
        break;
      }
      case "unwatch": {
        if (!arg) {
          setStatus(commandBar, "Usage: /unwatch <file-path>");
          return;
        }
        const unwatchAbsPath = resolvePath(arg);
        const unwatchSlug = projectSlug(dirnamePath(unwatchAbsPath));
        await stopWatching(unwatchSlug, basenamePath(unwatchAbsPath));
        state.config = removeFileFromConfig(state.config, arg);
        await refreshProjects();
        setStatus(commandBar, `Unwatched: ${basenamePath(unwatchAbsPath)}`);
        break;
      }
      case "restore": {
        if (state.selectedProject && state.selectedFileName && state.selectedSnapshot) {
          const destPath = getFullFilePath(state.selectedProject, state.selectedFileName);
          const ok = await restore(state.selectedProject.slug, state.selectedSnapshot.hash, state.selectedFileName, destPath);
          setStatus(commandBar, ok ? "Restored!" : "Restore failed");
        } else {
          setStatus(commandBar, "Select a snapshot first");
        }
        break;
      }
      case "open": {
        const slug = state.selectedProject?.slug;
        if (slug) {
          openInEditor(slug, state.config.editor);
          setStatus(commandBar, "Opened in editor");
        } else {
          setStatus(commandBar, "Select a project first");
        }
        break;
      }
      case "link": {
        const slug = state.selectedProject?.slug;
        if (slug) {
          const instructions = getLinkInstructions(slug);
          updatePreview(preview, instructions, "full", null);
          previewBox.title = " Link Instructions ";
          focusColumn(COL_PREVIEW);
        } else {
          setStatus(commandBar, "Select a project first");
        }
        break;
      }
      default:
        setStatus(commandBar, `Unknown command: /${command}`);
    }
  }

  // --- Global key handler ---
  renderer.keyInput.on("keypress", async (key: KeyEvent) => {
    // If command mode, let input handle it
    if (state.commandMode) {
      if (key.name === "escape") {
        hideInput(commandBar);
        state.commandMode = false;
        focusColumn(state.focusedColumn);
      }
      return;
    }

    switch (key.name) {
      case "q":
        await stopAll();
        renderer.destroy();
        process.exit(0);
        break;

      case "/":
        state.commandMode = true;
        showInput(commandBar);
        break;

      case "l":
      case "right": {
        const col = state.focusedColumn;
        if (col < 3) {
          // Trigger selection on current column first
          const current = getColumnRenderable(col);
          if (current && "selectCurrent" in current) {
            (current as SelectRenderable).selectCurrent();
          }
          focusColumn(col + 1);
        }
        break;
      }

      case "h":
      case "left":
      case "escape":
        if (state.focusedColumn > 0) {
          focusColumn(state.focusedColumn - 1);
        }
        break;

      case "tab": {
        if (state.focusedColumn >= 2 && state.selectedSnapshot) {
          state.previewMode = state.previewMode === "diff" ? "full" : "diff";
          applyColumnLayout();
          await refreshPreview();
          if (state.focusedColumn === COL_PREVIEW) {
            focusColumn(COL_PREVIEW);
          }
        }
        break;
      }

      case "r": {
        if (state.selectedProject && state.selectedFileName && state.selectedSnapshot) {
          const destPath = getFullFilePath(state.selectedProject, state.selectedFileName);
          const ok = await restore(state.selectedProject.slug, state.selectedSnapshot.hash, state.selectedFileName, destPath);
          setStatus(commandBar, ok ? "Restored!" : "Restore failed");
        }
        break;
      }

      case "o": {
        const focused = state.focusedColumn;
        state.expandedColumn = state.expandedColumn === focused ? null : focused;
        applyColumnLayout();
        setStatus(
          commandBar,
          state.expandedColumn === null
            ? "Layout reset"
            : `${columnLabel(state.expandedColumn)} expanded`,
        );
        setTimeout(() => setStatus(commandBar, ""), 1500);
        renderer.requestRender();
        break;
      }
    }
  });

  // --- File watcher callback ---
  onSnapshot(async (slug: string, fileName: string) => {
    // Refresh UI when a new snapshot is taken
    if (state.selectedProject?.slug === slug) {
      await refreshFiles();
      if (state.selectedFileName === fileName) {
        await refreshSnapshots();
        if (state.selectedSnapshot) {
          await refreshPreview();
        }
      }
    }
    setStatus(commandBar, `Snapshot: ${fileName}`);
    // Clear status after 3 seconds
    setTimeout(() => setStatus(commandBar, ""), 3000);
  });

  // --- Start watchers for all configured files ---
  for (const project of state.config.projects) {
    await startWatching(project);
  }

  // --- Initial render ---
  applyColumnLayout();
  await refreshProjects();
  focusColumn(COL_PROJECTS);

  // Handle resize
  renderer.root.on("resized", () => {
    updateColumnVisibility();
    renderer.requestRender();
  });

  renderer.start();
}
