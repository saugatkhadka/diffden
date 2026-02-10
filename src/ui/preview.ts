import { TextRenderable, type RenderContext } from "@opentui/core";

export function createPreview(ctx: RenderContext): TextRenderable {
  return new TextRenderable(ctx, {
    content: "",
    fg: "#c0c0c0",
    bg: "#0d0d1a",
    wrapMode: "char",
  });
}

export function updatePreview(text: TextRenderable, content: string) {
  text.content = content;
}
