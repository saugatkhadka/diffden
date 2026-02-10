import simpleGit, { type SimpleGit, type LogResult, type DefaultLogFields } from "simple-git";
import { existsSync, mkdirSync, copyFileSync, readFileSync } from "fs";
import { join, basename } from "path";
import { getRepoPath } from "./config.ts";

export interface SnapshotInfo {
  hash: string;
  date: Date;
  message: string;
  insertions: number;
  deletions: number;
}

function ensureRepoDir(slug: string): string {
  const repoPath = getRepoPath(slug);
  mkdirSync(repoPath, { recursive: true });
  return repoPath;
}

async function getGit(slug: string): Promise<SimpleGit> {
  const repoPath = ensureRepoDir(slug);
  const git = simpleGit(repoPath);

  const isRepo = await git.checkIsRepo();
  if (!isRepo) {
    await git.init();
    await git.addConfig("user.name", "track-scratchpad");
    await git.addConfig("user.email", "track-scratchpad@local");
  }
  return git;
}

export async function snapshot(slug: string, sourceFilePath: string): Promise<string | null> {
  const git = await getGit(slug);
  const repoPath = getRepoPath(slug);
  const fileName = basename(sourceFilePath);
  const destPath = join(repoPath, fileName);

  if (!existsSync(sourceFilePath)) return null;

  copyFileSync(sourceFilePath, destPath);
  await git.add(fileName);

  const status = await git.status();
  if (status.staged.length === 0) return null; // no changes

  const result = await git.commit(`[${fileName}] auto-snapshot`);
  return result.commit || null;
}

export async function getLog(slug: string, fileName?: string): Promise<SnapshotInfo[]> {
  const git = await getGit(slug);
  const repoPath = getRepoPath(slug);

  try {
    const args: string[] = ["--stat", "--stat-width=200"];
    if (fileName) {
      args.push("--follow", "--", fileName);
    }
    const log: LogResult<DefaultLogFields> = await git.log(args);

    return log.all.map((entry) => {
      const diff = entry.diff;
      let insertions = 0;
      let deletions = 0;
      // Parse diff stats from the body/message if available
      if (diff) {
        insertions = (diff as any).insertions ?? 0;
        deletions = (diff as any).deletions ?? 0;
      }
      // Fallback: parse from the stat line in body
      if (insertions === 0 && deletions === 0 && entry.body) {
        const statMatch = entry.body.match(/(\d+) insertion.*?(\d+) deletion/);
        if (statMatch) {
          insertions = parseInt(statMatch[1]!, 10);
          deletions = parseInt(statMatch[2]!, 10);
        }
      }
      return {
        hash: entry.hash,
        date: new Date(entry.date),
        message: entry.message,
        insertions,
        deletions,
      };
    });
  } catch {
    return [];
  }
}

export async function getDiff(slug: string, hash: string, fileName?: string): Promise<string> {
  const git = await getGit(slug);
  try {
    const args = [`${hash}^`, hash];
    if (fileName) args.push("--", fileName);
    const diff = await git.diff(args);
    return diff || "(no diff available)";
  } catch {
    // First commit — diff against empty tree
    try {
      const diff = await git.diff(["4b825dc642cb6eb9a060e54bf899d8b2da2e7862", hash]);
      return diff || "(initial snapshot)";
    } catch {
      return "(no diff available)";
    }
  }
}

export async function getContent(slug: string, hash: string, fileName: string): Promise<string> {
  const git = await getGit(slug);
  try {
    return await git.show([`${hash}:${fileName}`]);
  } catch {
    return "(content not available)";
  }
}

export async function restore(slug: string, hash: string, fileName: string, destPath: string): Promise<boolean> {
  try {
    const content = await getContent(slug, hash, fileName);
    if (content === "(content not available)") return false;
    const { writeFileSync } = require("fs") as typeof import("fs");
    writeFileSync(destPath, content);
    return true;
  } catch {
    return false;
  }
}

export async function getSnapshotCount(slug: string, fileName?: string): Promise<number> {
  const log = await getLog(slug, fileName);
  return log.length;
}

export async function getLatestSnapshot(slug: string, fileName?: string): Promise<SnapshotInfo | null> {
  const log = await getLog(slug, fileName);
  return log[0] ?? null;
}
