import type { CommandHandler, CommandContext } from "./types";

export class ClickCommand implements CommandHandler {
  async execute(_ctx: CommandContext, id?: string) {
    if (!id) {
      window.dispatchEvent(new CustomEvent("worker-log", { detail: "❓ click <blockId>" }));
      return;
    }
    window.dispatchEvent(new CustomEvent("block-click", { detail: { blockId: id } }));
    window.dispatchEvent(new CustomEvent("worker-log", { detail: `🖱️ (AI) clicked ${id}` }));
  }
}
