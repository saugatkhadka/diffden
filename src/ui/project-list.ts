import { SelectRenderable, type SelectOption, type RenderContext } from "@opentui/core";

export interface ProjectItem {
  slug: string;
  dir: string;
  fileCount: number;
}

function formatOption(item: ProjectItem): SelectOption {
  return {
    name: `${item.slug}`,
    description: `${item.fileCount} file${item.fileCount !== 1 ? "s" : ""} · ${item.dir}`,
    value: item,
  };
}

export function createProjectList(ctx: RenderContext): SelectRenderable {
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

export function updateProjectList(select: SelectRenderable, items: ProjectItem[]) {
  select.options = items.map(formatOption);
}
