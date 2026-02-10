import { InputRenderable, BoxRenderable, TextRenderable, type RenderContext } from "@opentui/core";

export interface CommandBar {
  container: BoxRenderable;
  input: InputRenderable;
  hints: TextRenderable;
  status: TextRenderable;
}

export function createCommandBar(ctx: RenderContext): CommandBar {
  const container = new BoxRenderable(ctx, {
    flexDirection: "row",
    height: 1,
    width: "100%",
    backgroundColor: "#16213e",
  });

  const hints = new TextRenderable(ctx, {
    content: "[j/k] nav  [Enter/l] select  [Esc/h] back  [Tab] diff/full  [r] restore  [o] open  [/] cmd  [q] quit",
    fg: "#666680",
    bg: "#16213e",
    flexGrow: 1,
    height: 1,
    truncate: true,
  });

  const status = new TextRenderable(ctx, {
    content: "",
    fg: "#00d2ff",
    bg: "#16213e",
    height: 1,
    flexShrink: 0,
  });

  const input = new InputRenderable(ctx, {
    placeholder: "Type / for commands...",
    width: "100%",
    textColor: "#e0e0e0",
    backgroundColor: "#16213e",
    visible: false,
  });

  container.add(hints);
  container.add(status);
  container.add(input);

  return { container, input, hints, status };
}

export function showInput(bar: CommandBar) {
  bar.hints.visible = false;
  bar.status.visible = false;
  bar.input.visible = true;
  bar.input.value = "/";
  bar.input.focus();
}

export function hideInput(bar: CommandBar) {
  bar.input.visible = false;
  bar.input.blur();
  bar.input.value = "";
  bar.hints.visible = true;
  bar.status.visible = true;
}

export function setStatus(bar: CommandBar, msg: string) {
  bar.status.content = msg ? ` ${msg} ` : "";
}

export function updateHints(bar: CommandBar, focusedColumn: number) {
  const base = "[q] quit  [/] cmd";
  const nav = "[j/k] nav";
  const select = "[Enter/l] select";
  const back = "[Esc/h] back";

  switch (focusedColumn) {
    case 0:
      bar.hints.content = `${nav}  ${select}  [o] open  ${base}`;
      break;
    case 1:
      bar.hints.content = `${nav}  ${select}  ${back}  [o] open  ${base}`;
      break;
    case 2:
      bar.hints.content = `${nav}  ${select}  ${back}  [Tab] diff/full  [r] restore  ${base}`;
      break;
    case 3:
      bar.hints.content = `${back}  [Tab] diff/full  [j/k] scroll  ${base}`;
      break;
  }
}
