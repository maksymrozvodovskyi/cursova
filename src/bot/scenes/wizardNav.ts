import { Markup } from "telegraf";
import { message } from "telegraf/filters";
import type { BotContext } from "../../types/bot";

export const WIZARD_CANCEL = "Скасувати";
export const WIZARD_RESTART = "Почати спочатку";

export function appendWizardNav(
  rows: readonly (readonly string[])[],
): string[][] {
  return [...rows.map((r) => [...r]), [WIZARD_CANCEL, WIZARD_RESTART]];
}

export function wizardNavOnlyKeyboard() {
  return Markup.keyboard([[WIZARD_CANCEL, WIZARD_RESTART]]).resize();
}

export async function tryHandleWizardNav(
  ctx: BotContext,
  sceneId: string,
): Promise<boolean> {
  if (!ctx.has(message("text"))) return false;
  const text = ctx.message.text.trim();
  if (text === WIZARD_CANCEL) {
    await ctx.reply("Скасовано.", Markup.removeKeyboard());
    await ctx.scene.leave();
    return true;
  }
  if (text === WIZARD_RESTART) {
    await ctx.scene.leave();
    await ctx.scene.enter(sceneId);
    return true;
  }
  return false;
}
