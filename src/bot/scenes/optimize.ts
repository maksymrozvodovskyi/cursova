import { Scenes, Markup } from "telegraf";
import { message } from "telegraf/filters";
import type { BotContext } from "../../types/bot";
import { optimizeBuild } from "../../services/buildService";
import type { BuildRecommendation } from "../../ai/client";
import { logger } from "../middlewares/logger";
import { appendWizardNav, tryHandleWizardNav } from "./wizardNav";

export const OPTIMIZE_SCENE_ID = "optimize";

export const OPTIMIZATION_OPTIONS = [
  "Зменшити ціну на 10%",
  "Збільшити продуктивність",
  "Збалансувати ціну/якість",
] as const;

interface OptimizeState {
  lastBuild?: BuildRecommendation;
  useCase?: string;
  sourceBudget?: number;
}

function getState(ctx: BotContext): OptimizeState {
  return ctx.wizard.state as OptimizeState;
}

export const optimizeScene = new Scenes.WizardScene<BotContext>(
  OPTIMIZE_SCENE_ID,
  async (ctx) => {
    if (!ctx.from) {
      await ctx.reply("Не вдалося визначити користувача.");
      return ctx.scene.leave();
    }

    const fromDraft = ctx.session.pendingOptimizeFromDraft;
    if (fromDraft) {
      delete ctx.session.pendingOptimizeFromDraft;
      getState(ctx).lastBuild = fromDraft.lastBuild;
      getState(ctx).useCase = fromDraft.useCase;
      getState(ctx).sourceBudget = fromDraft.budget;
      await ctx.reply(
        "Оберіть тип оптимізації (поточна збірка з /build, ще без збереження в історію):",
        Markup.keyboard(appendWizardNav(OPTIMIZATION_OPTIONS.map((o) => [o])))
          .oneTime()
          .resize(),
      );
      return ctx.wizard.next();
    }

    await ctx.reply(
      "Оптимізація доступна лише під час підбору збірки: запустіть /build, отримайте рекомендацію та оберіть «⚡ Оптимізувати збірку» на клавіатурі.",
    );
    return ctx.scene.leave();
  },
  async (ctx) => {
    if (!ctx.has(message("text"))) {
      await ctx.reply("Будь ласка, оберіть варіант з клавіатури.");
      return;
    }

    if (await tryHandleWizardNav(ctx, OPTIMIZE_SCENE_ID)) return;

    const choice = ctx.message.text.trim();
    if (
      !OPTIMIZATION_OPTIONS.includes(
        choice as (typeof OPTIMIZATION_OPTIONS)[number],
      )
    ) {
      await ctx.reply("Будь ласка, оберіть варіант з клавіатури.");
      return;
    }

    const { lastBuild, useCase, sourceBudget } = getState(ctx);
    if (!lastBuild || !useCase || sourceBudget == null) {
      await ctx.reply("Сесія втрачена. Поверніться до /build і спробуйте знову.");
      return ctx.scene.leave();
    }

    if (!ctx.from) {
      await ctx.reply("Не вдалося визначити користувача.");
      return ctx.scene.leave();
    }

    await ctx.reply("⏳ Оптимізую збірку...");

    try {
      const result = await optimizeBuild(lastBuild, choice);

      const componentsText = result.components
        .map((c) => `${c.type}: ${c.name} — ${c.price} грн`)
        .join("\n");
      const replyText = [
        "✅ Оптимізована збірка",
        "",
        componentsText,
        "",
        `💰 Нова вартість: ${result.totalPrice} грн`,
        "",
        `💡 ${result.explanation}`,
      ].join("\n");

      await ctx.reply(replyText, {
        link_preview_options: { is_disabled: true },
      });

      ctx.session.resumeBuildPostMenu = {
        draftBuild: result,
        budget: sourceBudget,
        useCase,
      };
      await ctx.scene.leave();
      await ctx.scene.enter("build");
      return;
    } catch (err) {
      logger.error({ err, choice }, "Optimization failed");
      await ctx.reply(
        "Помилка оптимізації. Спробуйте ще раз пізніше.",
        Markup.removeKeyboard(),
      );
    }

    return ctx.scene.leave();
  },
);
