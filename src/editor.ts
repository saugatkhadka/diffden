import { spawn } from "child_process";
import { getRepoPath } from "./config.ts";

export function openInEditor(slug: string, editor?: string): boolean {
  const repoPath = getRepoPath(slug);
  const cmd = editor || process.env.VISUAL || process.env.EDITOR || "code";

  try {
    const child = spawn(cmd, [repoPath], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

export function getLinkInstructions(slug: string): string {
  const repoPath = getRepoPath(slug);
  return [
    "To link the tracking repo in VS Code's git sidebar:",
    "",
    "Option 1: Add to workspace settings (.vscode/settings.json):",
    `  "git.repositories": ["${repoPath}"]`,
    "",
    "Option 2: Add as multi-root workspace folder:",
    `  File > Add Folder to Workspace... > ${repoPath}`,
    "",
    "Option 3: Open tracking repo directly:",
    `  code ${repoPath}`,
    "",
    "Then use GitLens or the built-in Git sidebar to browse history.",
  ].join("\n");
}
