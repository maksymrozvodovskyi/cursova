import type { BotContext } from "../../types/bot";
import { getUserBuilds } from "../../db/repositories/buildRepo";
import { findOrCreateUser } from "../../db/repositories/userRepo";

const HISTORY_LIMIT = 5;

export async function historyHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const dbUser = await findOrCreateUser(
    ctx.from.id,
    ctx.from.username,
    ctx.from.first_name,
  );
  const builds = await getUserBuilds(dbUser.id, HISTORY_LIMIT);

  if (builds.length === 0) {
    await ctx.reply("У вас ще немає збірок. Використовуйте /build.");
    return;
  }

  const lines = builds.map((b, i) => {
    const date = b.createdAt.toLocaleDateString();
    return `${i + 1}. Бюджет: ${b.budget} грн | ${b.useCase} | ${b.totalPrice} грн (${date})`;
  });

  const msg = [`📜 Ваші останні ${HISTORY_LIMIT} збірок:`, "", ...lines].join(
    "\n",
  );
  await ctx.reply(msg);
}
