import pino from "pino";
import type { MiddlewareFn } from "telegraf";
import type { BotContext } from "../../types/bot";

const level = process.env.LOG_LEVEL ?? "info";

export const logger = pino({ level });

export function loggerMiddleware(): MiddlewareFn<BotContext> {
  return async (ctx, next) => {
    const start = Date.now();
    const user = ctx.from?.username ?? ctx.from?.id;
    logger.info({ user, update: ctx.updateType }, "Incoming update");
    try {
      await next();
    } catch (err) {
      logger.error({ err, user, update: ctx.updateType }, "Handler error");
      throw err;
    } finally {
      const ms = Date.now() - start;
      logger.info({ user, duration: ms }, "Response time");
    }
  };
}
