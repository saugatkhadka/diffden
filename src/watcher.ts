import { watch, type FSWatcher } from "chokidar";
import { join } from "path";
import { snapshot } from "./tracker.ts";
import type { ProjectConfig } from "./config.ts";
import { projectSlug } from "./utils.ts";

const DEBOUNCE_MS = 500;

interface WatcherEntry {
  watcher: FSWatcher;
  filePath: string;
  slug: string;
}

const watchers = new Map<string, WatcherEntry>();
let onSnapshotCallback: ((slug: string, fileName: string) => void) | null = null;

export function onSnapshot(cb: (slug: string, fileName: string) => void) {
  onSnapshotCallback = cb;
}

export async function startWatching(project: ProjectConfig): Promise<void> {
  const slug = project.slug;

  for (const fileName of project.files) {
    const filePath = join(project.dir, fileName);
    const key = `${slug}:${fileName}`;

    if (watchers.has(key)) continue;

    let debounceTimer: ReturnType<typeof setTimeout> | null = null;

    const watcher = watch(filePath, {
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 50 },
    });

    watcher.on("change", () => {
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(async () => {
        const hash = await snapshot(slug, filePath);
        if (hash && onSnapshotCallback) {
          onSnapshotCallback(slug, fileName);
        }
      }, DEBOUNCE_MS);
    });

    watchers.set(key, { watcher, filePath, slug });
  }
}

export async function stopWatching(slug: string, fileName?: string): Promise<void> {
  for (const [key, entry] of watchers) {
    if (entry.slug === slug && (!fileName || key.endsWith(`:${fileName}`))) {
      await entry.watcher.close();
      watchers.delete(key);
    }
  }
}

export async function stopAll(): Promise<void> {
  for (const [key, entry] of watchers) {
    await entry.watcher.close();
  }
  watchers.clear();
}

export function isWatching(slug: string, fileName: string): boolean {
  return watchers.has(`${slug}:${fileName}`);
}
