import type { BotContext } from "../../types/bot";
import { findOrCreateUser } from "../../db/repositories/userRepo";

const WELCOME_MESSAGE = [
  "Привіт! Я бот для інтелектуального підбору ПК.",
  "",
  "Використовуйте /build щоб почати покроковий підбір збірки.",
  "Команди: /history, /compare",
].join("\n");

export async function startHandler(ctx: BotContext): Promise<void> {
  if (ctx.from) {
    await findOrCreateUser(ctx.from.id, ctx.from.username, ctx.from.first_name);
  }
  await ctx.reply(WELCOME_MESSAGE);
}
