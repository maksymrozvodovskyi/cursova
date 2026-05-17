import { Scenes, Markup } from "telegraf";
import { message } from "telegraf/filters";
import type { BotContext } from "../../types/bot";
import {
  createBuildRecommendation,
  createThreeAlternativesForSlot,
} from "../../services/buildService";
import { saveBuild } from "../../db/repositories/buildRepo";
import { findOrCreateUser } from "../../db/repositories/userRepo";
import { sumComponentPrices, normalizeBuildTotals } from "../../ai/client";
import { logger } from "../middlewares/logger";
import {
  appendWizardNav,
  tryHandleWizardNav,
  wizardNavOnlyKeyboard,
} from "./wizardNav";
import { OPTIMIZE_SCENE_ID } from "./optimize";
import type { BuildResult, Component } from "../../types";

export const BUILD_SCENE_ID = "build";

export const USE_CASES = [
  "Геймінг",
  "Робота / Офіс",
  "Монтаж відео",
  "Універсальна",
  "Компактний ПК",
] as const;

const MIN_BUDGET = 10_000;
const MAX_BUDGET = 500_000;

const KB_SAVE = "✅ Зберегти збірку";
const KB_REPLACE = "🔧 Замінити комплектуючу";
const KB_OPTIMIZE = "⚡ Оптимізувати збірку";

const POST_BUILD_MENU_HINT =
  "Зберегти, замінити позицію або оптимізувати — кнопки нижче.";
const POST_BUILD_MENU_HINT_LOCKED =
  "Зберегти або замінити позицію — кнопки нижче.";

function postBuildMenuHint(includeOptimize: boolean): string {
  return includeOptimize ? POST_BUILD_MENU_HINT : POST_BUILD_MENU_HINT_LOCKED;
}

function includeOptimizeInPostBuildMenu(st: BuildState): boolean {
  return st.optimizeLocked !== true;
}

function postBuildMenuMarkup(includeOptimize: boolean) {
  const rows: string[][] = [[KB_SAVE], [KB_REPLACE]];
  if (includeOptimize) rows.push([KB_OPTIMIZE]);
  return Markup.keyboard(appendWizardNav(rows)).oneTime().resize();
}

async function replyDraftWithPostBuildMenu(
  ctx: BotContext,
  budget: number,
  draft: BuildResult,
): Promise<void> {
  const inc = includeOptimizeInPostBuildMenu(getState(ctx));
  await ctx.reply(formatDraftMessage(budget, draft), {
    link_preview_options: { is_disabled: true },
    ...postBuildMenuMarkup(inc),
  });
}

async function replyPostBuildMenu(ctx: BotContext): Promise<void> {
  const st = getState(ctx);
  const inc = includeOptimizeInPostBuildMenu(st);
  await ctx.reply(postBuildMenuHint(inc), postBuildMenuMarkup(inc));
}

interface BuildState {
  budget?: number;
  useCase?: string;
  draftBuild?: BuildResult;
  swapSlotIndex?: number;
  swapAlternatives?: Component[];
  optimizeLocked?: boolean;
}

function getState(ctx: BotContext): BuildState {
  return ctx.wizard.state as BuildState;
}

function parseBudget(input: string): number | null {
  const cleaned = input.replace(/[\s.,]/gu, "");
  const value = Number.parseInt(cleaned, 10);
  if (!Number.isFinite(value)) return null;
  return value;
}

function truncateLabel(name: string, max: number): string {
  const t = name.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function formatSwapPriceNote(
  altPrice: number,
  slotPrice: number,
  draftTotal: number,
): string {
  const delta = altPrice - slotPrice;
  const newTotal = draftTotal - slotPrice + altPrice;
  if (delta === 0) {
    return `без змін vs поточна позиція; сума збірки: ${newTotal} грн`;
  }
  if (delta > 0) {
    return `+${delta} грн дорожче за поточну позицію (${slotPrice} грн); по всій збірці: ${draftTotal} → ${newTotal} грн (+${delta} грн)`;
  }
  const abs = Math.abs(delta);
  return `−${abs} грн дешевше за поточну позицію (${slotPrice} грн); по всій збірці: ${draftTotal} → ${newTotal} грн (−${abs} грн)`;
}

function formatDraftMessage(budget: number, draft: BuildResult): string {
  const componentsText = draft.components
    .map((c) => `${c.type}: ${c.name} — ${c.price} грн`)
    .join("\n");
  return [
    `✅ Рекомендована збірка (бюджет: ${budget} грн)`,
    "",
    componentsText,
    "",
    `💰 Загальна вартість: ${draft.totalPrice} грн`,
    "",
    `💡 ${draft.explanation}`,
  ].join("\n");
}

async function saveDraftAndLeave(
  ctx: BotContext,
  st: BuildState,
): Promise<void> {
  if (!ctx.from || !st.draftBuild || !st.budget || !st.useCase) {
    await ctx.reply(
      "Не вдалося зберегти: немає даних збірки.",
      Markup.removeKeyboard(),
    );
    await ctx.scene.leave();
    return;
  }

  const dbUser = await findOrCreateUser(
    ctx.from.id,
    ctx.from.username,
    ctx.from.first_name,
  );

  await saveBuild({
    userId: dbUser.id,
    budget: st.budget,
    useCase: st.useCase,
    components: st.draftBuild.components,
    totalPrice: st.draftBuild.totalPrice,
    explanation: st.draftBuild.explanation,
  });

  await ctx.reply(
    "Збірка збережена в історію. /history — переглянути збережені збірки.",
    Markup.removeKeyboard(),
  );
  await ctx.scene.leave();
}

async function applyPostBuildMenuChoice(
  ctx: BotContext,
  st: BuildState,
  text: string,
  advanceToSlotStep: boolean,
): Promise<boolean> {
  if (!st.draftBuild || !st.budget || !st.useCase) return false;

  if (text !== KB_SAVE && text !== KB_REPLACE && text !== KB_OPTIMIZE) {
    return false;
  }

  delete st.swapSlotIndex;
  delete st.swapAlternatives;

  if (text === KB_OPTIMIZE && st.optimizeLocked) {
    await ctx.reply(
      "До цієї чорнової збірки вже застосовано оптимізацію. Можна лише зберегти збірку або замінити комплектуючу.",
    );
    return true;
  }

  if (text === KB_SAVE) {
    await saveDraftAndLeave(ctx, st);
    return true;
  }

  if (text === KB_REPLACE) {
    const rows = st.draftBuild.components.map((c, i) => [
      `${i + 1}. ${c.type}: ${truncateLabel(c.name, 38)}`,
    ]);
    await ctx.reply(
      "Оберіть позицію, яку хочете замінити:",
      Markup.keyboard(appendWizardNav(rows)).oneTime().resize(),
    );
    if (advanceToSlotStep) {
      await ctx.wizard.next();
    }
    return true;
  }

  if (text === KB_OPTIMIZE) {
    ctx.session.pendingOptimizeFromDraft = {
      lastBuild: normalizeBuildTotals({
        components: st.draftBuild.components,
        totalPrice: st.draftBuild.totalPrice,
        explanation: st.draftBuild.explanation,
      }),
      useCase: st.useCase,
      budget: st.budget,
    };
    await ctx.scene.leave();
    await ctx.scene.enter(OPTIMIZE_SCENE_ID);
    return true;
  }

  return false;
}

export const buildScene = new Scenes.WizardScene<BotContext>(
  BUILD_SCENE_ID,
  async (ctx) => {
    const resume = ctx.session.resumeBuildPostMenu;
    if (resume) {
      delete ctx.session.resumeBuildPostMenu;
      const st = getState(ctx);
      st.budget = resume.budget;
      st.useCase = resume.useCase;
      st.draftBuild = resume.draftBuild;
      st.optimizeLocked = true;
      await replyPostBuildMenu(ctx);
      return ctx.wizard.selectStep(3);
    }

    delete getState(ctx).optimizeLocked;

    await ctx.reply(
      "Введіть ваш бюджет у гривнях (наприклад 50000):",
      wizardNavOnlyKeyboard(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.has(message("text"))) {
      await ctx.reply("Будь ласка, введіть бюджет числом.");
      return;
    }

    if (await tryHandleWizardNav(ctx, BUILD_SCENE_ID)) return;

    const budget = parseBudget(ctx.message.text.trim());
    if (budget === null || budget < MIN_BUDGET || budget > MAX_BUDGET) {
      await ctx.reply(
        `Будь ласка, введіть коректний бюджет від ${MIN_BUDGET} до ${MAX_BUDGET} грн.`,
      );
      return;
    }

    getState(ctx).budget = budget;
    await ctx.reply(
      "Оберіть задачу:",
      Markup.keyboard(appendWizardNav(USE_CASES.map((u) => [u])))
        .oneTime()
        .resize(),
    );
    return ctx.wizard.next();
  },
  async (ctx) => {
    if (!ctx.has(message("text"))) {
      await ctx.reply("Будь ласка, оберіть задачу з клавіатури.");
      return;
    }

    if (await tryHandleWizardNav(ctx, BUILD_SCENE_ID)) return;

    const useCase = ctx.message.text.trim();
    if (!USE_CASES.includes(useCase as (typeof USE_CASES)[number])) {
      await ctx.reply("Будь ласка, оберіть задачу з клавіатури.");
      return;
    }

    const st = getState(ctx);
    const { budget } = st;
    if (!budget) {
      await ctx.reply("Спочатку введіть бюджет.");
      return ctx.scene.leave();
    }

    if (!ctx.from) {
      await ctx.reply("Не вдалося визначити користувача.");
      return ctx.scene.leave();
    }

    st.useCase = useCase;

    await ctx.reply("⏳ Генерую рекомендацію...");

    try {
      const result = await createBuildRecommendation(budget, useCase);
      st.draftBuild = result;

      await replyDraftWithPostBuildMenu(ctx, budget, result);
      return ctx.wizard.next();
    } catch (err) {
      logger.error({ err, budget, useCase }, "Build generation failed");
      await ctx.reply(
        "Помилка генерації. Спробуйте ще раз пізніше.",
        Markup.removeKeyboard(),
      );
      return ctx.scene.leave();
    }
  },
  async (ctx) => {
    if (!ctx.has(message("text"))) {
      return;
    }

    if (await tryHandleWizardNav(ctx, BUILD_SCENE_ID)) return;

    const st = getState(ctx);
    const text = ctx.message.text.trim();

    if (!st.draftBuild || !st.budget || !st.useCase) {
      await ctx.reply("Сесія втрачена. Запустіть /build знову.");
      return ctx.scene.leave();
    }

    if (await applyPostBuildMenuChoice(ctx, st, text, true)) {
      return;
    }

    await ctx.reply(
      st.optimizeLocked
        ? `Натисніть «${KB_SAVE}» або «${KB_REPLACE}».`
        : `Натисніть «${KB_SAVE}», «${KB_REPLACE}» або «${KB_OPTIMIZE}».`,
    );
  },
  async (ctx) => {
    if (!ctx.has(message("text"))) {
      return;
    }

    if (await tryHandleWizardNav(ctx, BUILD_SCENE_ID)) return;

    const st = getState(ctx);
    const text = ctx.message.text.trim();

    if (!st.draftBuild || !st.budget || !st.useCase) {
      await ctx.reply("Сесія втрачена. Запустіть /build знову.");
      return ctx.scene.leave();
    }

    if (await applyPostBuildMenuChoice(ctx, st, text, false)) {
      return;
    }

    const m = text.match(/^(\d+)\.\s*/u);
    const slotIndex = m ? Number.parseInt(m[1]!, 10) - 1 : -1;

    if (
      !st.draftBuild ||
      !st.budget ||
      !st.useCase ||
      slotIndex < 0 ||
      slotIndex >= st.draftBuild.components.length
    ) {
      await ctx.reply(
        "Не зрозумів вибір. Натисніть номер з клавіатури (наприклад «3. GPU: …»).",
      );
      return;
    }

    await ctx.reply("⏳ Підбираю 3 варіанти для цієї позиції...");

    try {
      const alts = await createThreeAlternativesForSlot(
        st.draftBuild,
        slotIndex,
        st.budget,
        st.useCase,
      );
      st.swapSlotIndex = slotIndex;
      st.swapAlternatives = alts;

      const slot = st.draftBuild.components[slotIndex]!;
      const draftTotal = st.draftBuild.totalPrice;
      const lines = alts.map((a, i) => {
        const note = formatSwapPriceNote(a.price, slot.price, draftTotal);
        return `${i + 1}) ${a.name} — ${a.price} грн\n   (${note})`;
      });
      await ctx.reply(
        [
          `Альтернативи для «${slot.type}» (замість: ${truncateLabel(slot.name, 50)}):`,
          "",
          "Ціни з каталогу (Hotline), де знайдено відповідник; інакше — орієнтир від моделі.",
          "",
          ...lines,
          "",
          "Оберіть варіант кнопками під повідомленням.",
        ].join("\n"),
        Markup.inlineKeyboard([
          [
            Markup.button.callback("1", "buildswap:0"),
            Markup.button.callback("2", "buildswap:1"),
            Markup.button.callback("3", "buildswap:2"),
          ],
          [Markup.button.callback("Скасувати вибір", "buildswap_cancel")],
        ]),
      );
    } catch (err) {
      logger.error({ err, slotIndex }, "Component alternatives failed");
      const inc = includeOptimizeInPostBuildMenu(st);
      await ctx.reply(
        [
          "Не вдалося отримати варіанти. Спробуйте іншу позицію або збережіть збірку як є.",
          "",
          postBuildMenuHint(inc),
        ].join("\n"),
        postBuildMenuMarkup(inc),
      );
      ctx.wizard.selectStep(3);
      return;
    }
  },
);

buildScene.action(/^buildswap:([0-2])$/, async (ctx) => {
  if (ctx.wizard.cursor !== 4) {
    await ctx.answerCbQuery("Спочатку оберіть позицію в меню.").catch(() => {});
    return;
  }

  await ctx.answerCbQuery().catch(() => {});

  const st = getState(ctx);
  const pick = Number.parseInt(ctx.match![1]!, 10);
  const alts = st.swapAlternatives;
  const slotIdx = st.swapSlotIndex;
  const draft = st.draftBuild;
  const budget = st.budget;
  const useCase = st.useCase;

  if (
    alts == null ||
    slotIdx == null ||
    draft == null ||
    budget == null ||
    useCase == null ||
    pick < 0 ||
    pick > 2
  ) {
    const inc = includeOptimizeInPostBuildMenu(st);
    await ctx.reply(
      [
        "Цей вибір застарів. Оберіть позицію знову.",
        "",
        postBuildMenuHint(inc),
      ].join("\n"),
      postBuildMenuMarkup(inc),
    );
    ctx.wizard.selectStep(3);
    return;
  }

  const chosen = alts[pick]!;
  const old = draft.components[slotIdx]!;
  const nextComponents = draft.components.map((c, i) =>
    i === slotIdx ? { ...chosen, type: old.type } : c,
  );
  const totalPrice = sumComponentPrices(nextComponents);
  st.draftBuild = {
    components: nextComponents,
    totalPrice,
    explanation: `${draft.explanation}\n\nЗаміна ${old.type}: «${old.name}» → «${chosen.name}».`,
  };
  delete st.swapSlotIndex;
  delete st.swapAlternatives;

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  const inc = includeOptimizeInPostBuildMenu(st);
  await ctx.reply(formatDraftMessage(budget, st.draftBuild), {
    link_preview_options: { is_disabled: true },
    ...postBuildMenuMarkup(inc),
  });
  await ctx.wizard.selectStep(3);
});

buildScene.action("buildswap_cancel", async (ctx) => {
  if (ctx.wizard.cursor !== 4) {
    await ctx.answerCbQuery().catch(() => {});
    return;
  }

  await ctx.answerCbQuery().catch(() => {});

  const st = getState(ctx);
  delete st.swapSlotIndex;
  delete st.swapAlternatives;

  try {
    await ctx.editMessageReplyMarkup({ inline_keyboard: [] });
  } catch {}

  const inc = includeOptimizeInPostBuildMenu(st);
  await ctx.reply(
    ["Вибір скасовано.", "", postBuildMenuHint(inc)].join("\n"),
    postBuildMenuMarkup(inc),
  );
  await ctx.wizard.selectStep(3);
});
