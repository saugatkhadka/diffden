import { SelectRenderable, type SelectOption, type RenderContext } from "@opentui/core";
import { relativeTime } from "../utils.ts";

export interface FileItem {
  fileName: string;
  snapshotCount: number;
  lastChanged: Date | null;
}

function formatOption(item: FileItem): SelectOption {
  const count = `${item.snapshotCount} snap${item.snapshotCount !== 1 ? "s" : ""}`;
  const time = item.lastChanged ? relativeTime(item.lastChanged) : "no snapshots";
  return {
    name: item.fileName,
    description: `${count} · ${time}`,
    value: item,
  };
}

export function createFileList(ctx: RenderContext): SelectRenderable {
  return new SelectRenderable(ctx, {
    showDescription: true,
    showScrollIndicator: true,
    wrapSelection: true,
    backgroundColor: "#1a1a2e",
    textColor: "#e0e0e0",
    selectedBackgroundColor: "#16213e",
    selectedTextColor: "#00d2ff",
    focusedBackgroundColor: "#1a1a2e",
    focusedTextColor: "#e0e0e0",
    descriptionColor: "#666680",
    selectedDescriptionColor: "#4a90d9",
  });
}

export function updateFileList(select: SelectRenderable, items: FileItem[]) {
  select.options = items.map(formatOption);
}
