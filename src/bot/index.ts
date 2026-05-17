import { Telegraf, Scenes, session } from "telegraf";
import type { BotContext } from "../types/bot";
import { env } from "../config/env";
import { startHandler } from "./handlers/start";
import { historyHandler } from "./handlers/history";
import { compareHandler } from "./handlers/compare";
import { buildScene, BUILD_SCENE_ID } from "./scenes/build";
import { optimizeScene } from "./scenes/optimize";
import { loggerMiddleware, logger } from "./middlewares/logger";
import { rateLimitMiddleware } from "./middlewares/rateLimit";

export function createBot(): Telegraf<BotContext> {
  const bot = new Telegraf<BotContext>(env.BOT_TOKEN);

  const stage = new Scenes.Stage<BotContext>([buildScene, optimizeScene]);

  bot.use(session());
  bot.use(stage.middleware());
  bot.use(loggerMiddleware());
  bot.use(rateLimitMiddleware(5));

  bot.start(startHandler);
  bot.command("build", (ctx) => ctx.scene.enter(BUILD_SCENE_ID));
  bot.command("history", historyHandler);
  bot.command("compare", compareHandler);
  bot.catch((err, ctx) => {
    logger.error({ err, update: ctx.update }, "Unhandled bot error");
  });

  return bot;
}

export function startBot(): Promise<Telegraf<BotContext>> {
  const bot = createBot();

  process.once("SIGINT", () => bot.stop("SIGINT"));
  process.once("SIGTERM", () => bot.stop("SIGTERM"));

  return new Promise((resolve, reject) => {
    bot
      .launch(() => {
        logger.info("Bot started");
        resolve(bot);
      })
      .catch(reject);
  });
}
