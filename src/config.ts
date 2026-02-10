import { mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
import { dirname, resolve, basename, join } from "path";
import { CONFIG_PATH, DATA_DIR, REPOS_DIR, projectSlug, projectDirFromFile } from "./utils.ts";

export interface ProjectConfig {
  slug: string;
  dir: string;
  files: string[]; // basenames of watched files
}

export interface AppConfig {
  projects: ProjectConfig[];
  editor?: string;
}

function ensureDirs() {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(REPOS_DIR, { recursive: true });
}

export function loadConfig(): AppConfig {
  ensureDirs();
  if (!existsSync(CONFIG_PATH)) {
    const config: AppConfig = { projects: [] };
    saveConfig(config);
    return config;
  }
  const raw = readFileSync(CONFIG_PATH, "utf-8");
  return JSON.parse(raw) as AppConfig;
}

export function saveConfig(config: AppConfig): void {
  ensureDirs();
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2));
}

export function addFileToConfig(config: AppConfig, filePath: string): AppConfig {
  const absPath = resolve(filePath);
  const dir = projectDirFromFile(absPath);
  const slug = projectSlug(dir);
  const fileName = basename(absPath);

  let project = config.projects.find((p) => p.slug === slug);
  if (!project) {
    project = { slug, dir, files: [] };
    config.projects.push(project);
  }
  if (!project.files.includes(fileName)) {
    project.files.push(fileName);
  }
  saveConfig(config);
  return config;
}

export function removeFileFromConfig(config: AppConfig, filePath: string): AppConfig {
  const absPath = resolve(filePath);
  const dir = projectDirFromFile(absPath);
  const slug = projectSlug(dir);
  const fileName = basename(absPath);

  const project = config.projects.find((p) => p.slug === slug);
  if (project) {
    project.files = project.files.filter((f) => f !== fileName);
    if (project.files.length === 0) {
      config.projects = config.projects.filter((p) => p.slug !== slug);
    }
  }
  saveConfig(config);
  return config;
}

export function getRepoPath(slug: string): string {
  return `${REPOS_DIR}/${slug}`;
}

export function getFullFilePath(project: ProjectConfig, fileName: string): string {
  return join(project.dir, fileName);
}
