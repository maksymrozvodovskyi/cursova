import Groq from "groq-sdk";
import { z, type ZodType } from "zod";
import { env } from "../config/env";
import { logger } from "../bot/middlewares/logger";
const GROQ_MODEL = "llama-3.3-70b-versatile";

const groq = new Groq({ apiKey: env.GROQ_API_KEY });

export const ComponentSchema = z.object({
  type: z.string(),
  name: z.string(),
  price: z.number(),
  url: z.string().optional(),
});

export const BuildRecommendationSchema = z.object({
  components: z.array(ComponentSchema).min(1),
  totalPrice: z.number(),
  explanation: z.string(),
});

export const ThreeAlternativesSchema = z.object({
  alternatives: z.array(ComponentSchema).length(3),
});

export type BuildRecommendation = z.infer<typeof BuildRecommendationSchema>;
export type AiComponent = z.infer<typeof ComponentSchema>;
export type ThreeAlternatives = z.infer<typeof ThreeAlternativesSchema>;

export interface ComparisonInput {
  components: unknown;
  totalPrice: number;
  explanation?: string | null;
  useCase?: string;
  budget?: number;
}

export function sumComponentPrices(
  components: readonly { price: number }[],
): number {
  return components.reduce((s, c) => s + c.price, 0);
}

export function normalizeBuildTotals(
  data: BuildRecommendation,
): BuildRecommendation {
  const sum = sumComponentPrices(data.components);
  return { ...data, totalPrice: sum };
}

function extractJson(raw: string): string {
  const trimmed = raw
    .trim()
    .replace(/```json|```/g, "")
    .trim();
  const match = trimmed.match(/\{[\s\S]*\}/u);
  return match ? match[0] : trimmed;
}

function parseAiJson<T>(content: string, schema: ZodType<T>): T {
  const jsonStr = extractJson(content);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    logger.error({ err, content }, "Failed to parse AI response as JSON");
    throw new Error("AI response is not valid JSON");
  }

  const result = schema.safeParse(parsed);
  if (!result.success) {
    logger.error(
      { issues: result.error.issues, content },
      "AI response failed schema validation",
    );
    throw new Error("AI response does not match expected schema");
  }
  return result.data;
}

async function callGroq(
  prompt: string,
  systemPrompt: string,
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const response = await groq.chat.completions.create({
    model: GROQ_MODEL,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: prompt },
    ],
    temperature: options.temperature ?? 0.7,
    max_tokens: options.maxTokens ?? 2000,
  });
  return response.choices[0]?.message?.content ?? "";
}

function buildUserPrompt(
  budget: number,
  useCase: string,
  correction: string,
): string {
  const tail = correction ? `\n\n${correction}\n` : "";
  return `Ти експерт з підбору комплектуючих ПК преміум-класу.

Користувач орієнтується на бюджет близько ${budget} грн і задачу: "${useCase}".

Підбери сумісні реальні моделі в name (CPU, GPU, RAM, SSD, материнська плата, БЖ, корпус). Поле price у JSON — лише орієнтовний порядок величини для класу деталі; після відповіді ціни будуть узгоджені з каталогами (Hotline), тому не намагайся «вгадати» точну суму рівно бюджету в JSON — важливіші правильні назви та баланс класів під задачу.

ПРАВИЛА ПІДБОРУ ЗА БЮДЖЕТОМ:
- Бюджет великий → ТОПОВІ компоненти: Ryzen 7/9, Intel Core i7/i9, RTX 4070 Ti / 4080 / 4090, 32-64GB DDR5, топові NVMe SSD (Samsung 990 Pro / WD Black SN850X), якісне охолодження, корпуси з відмінним airflow.
- Бюджет середній → Високий середній рівень (Ryzen 7 / i7, RTX 4070 / 4070 Ti, 32GB RAM).
- Бюджет маленький → Бюджетні/середні варіанти.

ПРАВИЛА ЦІН У JSON (орієнтири):
- price — цілі числа UAH, реалістичний порядок для кожної моделі (не занижуй топ-клас до нереальних сум).
- totalPrice = сума price у цьому JSON (для валідності схеми); фінальна сума для користувача все одно перерахується з каталогу.
- Не вигадуй неіснуючі SKU; у name — реальні моделі.

Запропонуй повну збірку ПК (CPU, GPU, RAM, SSD/HDD, Motherboard, PSU, Case).

Поверни ТІЛЬКИ валідний JSON без додаткового тексту:
{
  "components": [
    {"type": "CPU", "name": "...", "price": 12345}
  ],
  "totalPrice": 123456,
  "explanation": "Коротке пояснення українською."
}${tail}`;
}

export const BUILD_SOFT_BUDGET_FACTOR = 1.22;

export async function generateBuildRecommendation(
  budget: number,
  useCase: string,
): Promise<BuildRecommendation> {
  let correction = "";
  let lastSum = 0;
  let lastParsed: BuildRecommendation | null = null;
  const systemPrompt =
    "Ти корисний асистент з підбору ПК. Відповідай тільки JSON. Підбирай реальні моделі; ціни в JSON орієнтовні — фінальні підставляються з каталогів.";

  for (let attempt = 0; attempt < 2; attempt++) {
    const prompt = buildUserPrompt(budget, useCase, correction);
    const content = await callGroq(prompt, systemPrompt, {
      temperature: attempt === 0 ? 0.55 : 0.3,
    });
    const parsed = normalizeBuildTotals(
      parseAiJson(content, BuildRecommendationSchema),
    );
    lastParsed = parsed;
    lastSum = parsed.totalPrice;
    if (parsed.totalPrice <= budget) {
      return parsed;
    }
    correction = `Підказка: зараз сума price = ${parsed.totalPrice} грн при орієнтовному бюджеті ${budget} грн. За можливості згенеруй варіант ближче до бюджету (перерозподіл або інші класи GPU/CPU), totalPrice = сума price.`;
    logger.warn(
      { attempt, sum: parsed.totalPrice, budget },
      "Build AI exceeded budget, retrying",
    );
  }

  const softCap = Math.ceil(budget * BUILD_SOFT_BUDGET_FACTOR);
  logger.warn(
    { lastSum, budget, softCap, withinSoftCap: lastSum <= softCap },
    "Build AI over stated budget; returning last proposal for enrichment pipeline",
  );
  return { ...lastParsed! };
}

export async function generateThreeComponentAlternatives(
  components: readonly AiComponent[],
  slotIndex: number,
  budget: number,
  useCase: string,
): Promise<AiComponent[]> {
  if (slotIndex < 0 || slotIndex >= components.length) {
    throw new Error("Invalid component slot index");
  }
  const slot = components[slotIndex]!;
  const othersSum = components.reduce(
    (s, c, i) => s + (i === slotIndex ? 0 : c.price),
    0,
  );
  const headroom = Math.max(0, budget - othersSum);
  const systemPrompt =
    "Ти корисний асистент з підбору ПК. Відповідай тільки JSON. Три різні реалістичні моделі одного типу.";
  const prompt = `Повна поточна збірка (JSON). Користувач хоче замінити лише ОДИН компонент.

Задача ПК: "${useCase}".
Орієнтовний загальний бюджет збірки: ${budget} грн.
Сума інших позицій (без замінюваного слота): ${othersSum} грн — для нової деталі типу "${slot.type}" лишається орієнтовно до ~${headroom} грн (не обовʼязково вичерпати; головне — сумісність і сенс для задачі).

Замінюваний слот (індекс ${slotIndex} у масиві components):
- type: "${slot.type}"
- name: "${slot.name}"
- price: ${slot.price}

Поверни РІВНО 3 різні альтернативи того самого type "${slot.type}" (інші моделі/обсяги VRAM/памʼяті тощо, якщо доречно). У кожного елемента поле type має дорівнювати "${slot.type}".
Поле price — реалістичні ринкові гривні для України, порядку класу поточної деталі (${slot.price} грн); не занижуй дорогі GPU/CPU до абсурдних сум; цілі числа; без фейкових SKU.

Поверни ТІЛЬКИ JSON:
{
  "alternatives": [
    {"type": "${slot.type}", "name": "...", "price": 12345},
    {"type": "${slot.type}", "name": "...", "price": 12345},
    {"type": "${slot.type}", "name": "...", "price": 12345}
  ]
}

Повний контекст збірки:
${JSON.stringify({ components }, null, 2)}`;

  const content = await callGroq(prompt, systemPrompt, {
    temperature: 0.6,
    maxTokens: 1500,
  });
  const parsed = parseAiJson(content, ThreeAlternativesSchema);
  return parsed.alternatives.map((a) => ({
    ...a,
    type: slot.type,
  }));
}

export async function generateOptimizedBuild(
  originalBuild: BuildRecommendation,
  instruction: string,
): Promise<BuildRecommendation> {
  const ob = normalizeBuildTotals(originalBuild);
  const originalSum = sumComponentPrices(ob.components);
  const systemPrompt =
    "Ти корисний асистент з оптимізації ПК. Відповідай тільки JSON.";
  const prompt = `Ти експерт з оптимізації ПК. Ось поточна збірка (сума по price = ${originalSum} грн):

${JSON.stringify(ob, null, 2)}

Інструкція користувача: "${instruction}"

Запропонуй оновлену збірку згідно з інструкцією. Можеш змінювати моделі та ціни; totalPrice має дорівнювати сумі price; ціни в гривнях, цілі числа.

Поверни ТІЛЬКИ JSON:
{
  "components": [...],
  "totalPrice": число,
  "explanation": "Що змінено і чому (українською)."
}`;

  const content = await callGroq(prompt, systemPrompt, {
    temperature: 0.55,
  });
  return normalizeBuildTotals(parseAiJson(content, BuildRecommendationSchema));
}

export async function generateBuildComparison(
  cheaper: ComparisonInput,
  pricier: ComparisonInput,
): Promise<string> {
  const prompt = `Порівняй дві збірки ПК і напиши коротке, корисне порівняння українською.

ВАЖЛИВО: «Збірка 1» завжди ДЕШЕВША (менша totalPrice), «Збірка 2» — ДОРОЖЧА. Не плутай порядок і не пиши, що дорожча збірка «краща за ту саму ціну», якщо різниця лише в ціні без зміни компонентів.

Збірка 1 (дешевша):
${JSON.stringify(cheaper, null, 2)}

Збірка 2 (дорожча):
${JSON.stringify(pricier, null, 2)}

Формат відповіді (приклад):
Порівняння двох останніх збірок:

1. … — 18000 грн
   CPU: …
   GPU: …

2. … — 23500 грн
   …

Різниця: +5500 грн (друга дорожча за першу)

Що змінилось у дорожчій:
+ …

Висновок: …

Поверни ТІЛЬКИ текст у такому стилі, без зайвих коментарів.`;

  try {
    const content = await callGroq(
      prompt,
      "Ти корисний асистент з порівняння ПК. Дотримуйся порядку: збірка 1 дешевша за збірку 2.",
      { temperature: 0.55, maxTokens: 1500 },
    );
    return content.trim();
  } catch (err) {
    logger.error({ err }, "AI generation failed (compare)");
    throw err;
  }
}
