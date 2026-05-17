import type { BotContext } from "../../types/bot";
import { getUserBuilds } from "../../db/repositories/buildRepo";
import { findOrCreateUser } from "../../db/repositories/userRepo";
import { generateBuildComparison } from "../../ai/client";
import { logger } from "../middlewares/logger";

function formatFallback(
  cheaper: ComparedBuild,
  pricier: ComparedBuild,
): string {
  const diff = pricier.totalPrice - cheaper.totalPrice;
  return [
    "Порівняння двох останніх збірок:",
    "",
    `1. ${cheaper.useCase} — ${cheaper.totalPrice} грн (бюджет ${cheaper.budget})`,
    `2. ${pricier.useCase} — ${pricier.totalPrice} грн (бюджет ${pricier.budget})`,
    "",
    `Різниця: +${diff} грн (друга дорожча за першу)`,
  ].join("\n");
}

interface ComparedBuild {
  useCase: string;
  totalPrice: number;
  budget: number;
}

function toPayload(b: {
  components: unknown;
  totalPrice: number;
  explanation: string | null;
  useCase: string;
  budget: number;
}) {
  return {
    components: b.components,
    totalPrice: b.totalPrice,
    explanation: b.explanation,
    useCase: b.useCase,
    budget: b.budget,
  };
}

export async function compareHandler(ctx: BotContext): Promise<void> {
  if (!ctx.from) return;

  const dbUser = await findOrCreateUser(
    ctx.from.id,
    ctx.from.username,
    ctx.from.first_name,
  );
  const builds = await getUserBuilds(dbUser.id, 10);

  if (builds.length < 2) {
    await ctx.reply("Потрібно мінімум 2 збірки в історії для порівняння.");
    return;
  }

  const [first, second] = builds;
  if (!first || !second) {
    await ctx.reply("Помилка: не вдалося отримати дві збірки.");
    return;
  }

  const [cheaper, pricier] =
    first.totalPrice <= second.totalPrice ? [first, second] : [second, first];

  await ctx.reply("⏳ Порівнюю збірки...");

  try {
    const comparisonText = await generateBuildComparison(
      toPayload(cheaper),
      toPayload(pricier),
    );

    await ctx.reply(
      comparisonText ||
        formatFallback(
          {
            useCase: cheaper.useCase,
            totalPrice: cheaper.totalPrice,
            budget: cheaper.budget,
          },
          {
            useCase: pricier.useCase,
            totalPrice: pricier.totalPrice,
            budget: pricier.budget,
          },
        ),
    );
  } catch (err) {
    logger.error({ err }, "Comparison failed, using fallback");
    await ctx.reply(
      formatFallback(
        {
          useCase: cheaper.useCase,
          totalPrice: cheaper.totalPrice,
          budget: cheaper.budget,
        },
        {
          useCase: pricier.useCase,
          totalPrice: pricier.totalPrice,
          budget: pricier.budget,
        },
      ),
    );
  }
}
