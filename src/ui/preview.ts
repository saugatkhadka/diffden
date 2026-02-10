import {
  BoxRenderable,
  DiffRenderable,
  TextRenderable,
  type RenderContext,
} from "@opentui/core";

export interface PreviewPane {
  container: BoxRenderable;
  fullText: TextRenderable;
  diffText: DiffRenderable;
}

export function createPreview(ctx: RenderContext): PreviewPane {
  const container = new BoxRenderable(ctx, {
    width: "100%",
    height: "100%",
    backgroundColor: "#0d0d1a",
    overflow: "hidden",
  });

  const fullText = new TextRenderable(ctx, {
    content: "",
    fg: "#c0c0c0",
    bg: "#0d0d1a",
    wrapMode: "char",
    width: "100%",
    height: "100%",
  });

  const diffText = new DiffRenderable(ctx, {
    diff: "",
    view: "unified",
    wrapMode: "char",
    showLineNumbers: true,
    lineNumberFg: "#6d7a99",
    lineNumberBg: "#0f1524",
    addedBg: "#11261b",
    removedBg: "#2a1418",
    contextBg: "#0d0d1a",
    addedContentBg: "#143022",
    removedContentBg: "#341a20",
    contextContentBg: "#0d0d1a",
    addedSignColor: "#39d98a",
    removedSignColor: "#ff6b8a",
    addedLineNumberBg: "#102018",
    removedLineNumberBg: "#2a151a",
    width: "100%",
    height: "100%",
    overflow: "hidden",
    visible: false,
  });

  container.add(fullText);
  container.add(diffText);

  return { container, fullText, diffText };
}

export function updatePreview(preview: PreviewPane, content: string, mode: "diff" | "full", fileName: string | null) {
  if (mode === "diff") {
    preview.diffText.diff = content;
    preview.diffText.visible = true;
    preview.fullText.visible = false;
    return;
  }

  preview.fullText.content = content;
  preview.fullText.visible = true;
  preview.diffText.visible = false;
}
