import { z } from "zod";
import {
  generateBuildRecommendation,
  generateOptimizedBuild,
  generateThreeComponentAlternatives,
  ComponentSchema,
  sumComponentPrices,
  normalizeBuildTotals,
  type AiComponent,
  type BuildRecommendation,
} from "../ai/client";
import { searchHotline } from "../parser/hotline";
import { normalizeQuery } from "../parser/normalizer";
import { getCachedComponent, saveToCache } from "../db/repositories/buildRepo";
import { logger } from "../bot/middlewares/logger";
import type { Build } from "../../prisma/generated/prisma/index";
import type { BuildResult, Component } from "../types";

const StoredComponentsSchema = z.array(ComponentSchema);

type EnrichMode = "marketPrice" | "urlsOnly";

const MARKET_OVER_BUDGET_NOTE =
  "\n\n(За даними каталогів сума перевищує вказаний бюджет — показано знайдені ціни без штучного підгону під ліміт. Де каталог не знайшов позицію, лишається орієнтир від моделі.)";

async function enrichComponent(
  comp: AiComponent,
  mode: EnrichMode,
): Promise<Component> {
  const query = normalizeQuery(comp.name);

  try {
    let cached = await getCachedComponent(query);
    if (!cached) {
      const parsed = await searchHotline(query);
      if (parsed) {
        cached = await saveToCache({
          query,
          normalizedName: parsed.name,
          price: parsed.price,
          url: parsed.url,
        });
      }
    }
    return {
      type: comp.type,
      name: cached?.normalizedName ?? comp.name,
      price: mode === "marketPrice" && cached ? cached.price : comp.price,
      url: cached?.url ?? comp.url ?? "",
    };
  } catch (err) {
    logger.warn(
      { err, query },
      "Component enrichment failed, falling back to AI values",
    );
    return {
      type: comp.type,
      name: comp.name,
      price: comp.price,
      url: comp.url ?? "",
    };
  }
}

async function enrichAll(
  components: readonly AiComponent[],
  mode: EnrichMode,
): Promise<Component[]> {
  return Promise.all(components.map((c) => enrichComponent(c, mode)));
}

export async function createBuildRecommendation(
  budget: number,
  useCase: string,
): Promise<BuildResult> {
  const aiResult = await generateBuildRecommendation(budget, useCase);

  const enriched = await enrichAll(aiResult.components, "marketPrice");
  const totalPrice = sumComponentPrices(enriched);
  let explanation = aiResult.explanation;

  if (totalPrice > budget) {
    logger.warn(
      { totalPrice, budget },
      "Market sum exceeds user budget; keeping catalog prices (no scaling)",
    );
    explanation = explanation + MARKET_OVER_BUDGET_NOTE;
  }

  return {
    components: enriched,
    totalPrice,
    explanation,
  };
}

export async function optimizeBuild(
  originalBuild: BuildRecommendation,
  instruction: string,
): Promise<BuildResult> {
  const aiResult = await generateOptimizedBuild(originalBuild, instruction);
  const enriched = await enrichAll(aiResult.components, "urlsOnly");
  const totalPrice = sumComponentPrices(enriched);

  return {
    components: enriched,
    totalPrice,
    explanation: aiResult.explanation,
  };
}

export async function createThreeAlternativesForSlot(
  draft: BuildResult,
  slotIndex: number,
  budget: number,
  useCase: string,
): Promise<Component[]> {
  const raw = await generateThreeComponentAlternatives(
    draft.components,
    slotIndex,
    budget,
    useCase,
  );
  return Promise.all(raw.map((a) => enrichComponent(a, "marketPrice")));
}

export function buildToRecommendation(b: Build): BuildRecommendation {
  const components = StoredComponentsSchema.parse(b.components);
  return normalizeBuildTotals({
    components,
    totalPrice: b.totalPrice,
    explanation: b.explanation ?? "",
  });
}
