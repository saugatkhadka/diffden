import { homedir } from "os";
import { join, basename, dirname, resolve } from "path";

export const DATA_DIR = join(homedir(), ".diffden");
export const CONFIG_PATH = join(DATA_DIR, "config.json");
export const REPOS_DIR = join(DATA_DIR, "repos");

export function relativeTime(date: Date): string {
  const now = Date.now();
  const diff = now - date.getTime();
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  return date.toLocaleDateString();
}

export function projectSlug(dirPath: string): string {
  return basename(resolve(dirPath)).replace(/[^a-zA-Z0-9_-]/g, "_");
}

export function projectDirFromFile(filePath: string): string {
  return dirname(resolve(filePath));
}

export function truncate(str: string, maxLen: number): string {
  if (str.length <= maxLen) return str;
  return str.slice(0, maxLen - 2) + "..";
}

export function padRight(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return str + " ".repeat(len - str.length);
}

export function padLeft(str: string, len: number): string {
  if (str.length >= len) return str.slice(0, len);
  return " ".repeat(len - str.length) + str;
}
