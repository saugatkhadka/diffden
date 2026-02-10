import { SelectRenderable, type SelectOption, type RenderContext } from "@opentui/core";
import { relativeTime } from "../utils.ts";
import type { SnapshotInfo } from "../tracker.ts";

function formatOption(snap: SnapshotInfo): SelectOption {
  const time = relativeTime(snap.date);
  const stats = `+${snap.insertions} -${snap.deletions}`;
  return {
    name: time,
    description: stats,
    value: snap,
  };
}

export function createSnapshotList(ctx: RenderContext): SelectRenderable {
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

export function updateSnapshotList(select: SelectRenderable, snapshots: SnapshotInfo[]) {
  select.options = snapshots.map(formatOption);
}
