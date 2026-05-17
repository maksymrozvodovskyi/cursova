import type { MiddlewareFn } from "telegraf";
import type { BotContext } from "../../types/bot";

const WINDOW_MS = 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;

interface RateLimitOptions {
  maxPerHour?: number;
  windowMs?: number;
}

export function rateLimitMiddleware(
  maxPerHourOrOptions: number | RateLimitOptions = 5,
): MiddlewareFn<BotContext> {
  const opts: Required<RateLimitOptions> =
    typeof maxPerHourOrOptions === "number"
      ? { maxPerHour: maxPerHourOrOptions, windowMs: WINDOW_MS }
      : {
          maxPerHour: maxPerHourOrOptions.maxPerHour ?? 5,
          windowMs: maxPerHourOrOptions.windowMs ?? WINDOW_MS,
        };

  const userRequests = new Map<number, number[]>();

  const cleanup = setInterval(() => {
    const cutoff = Date.now() - opts.windowMs;
    for (const [userId, timestamps] of userRequests) {
      const fresh = timestamps.filter((t) => t > cutoff);
      if (fresh.length === 0) {
        userRequests.delete(userId);
      } else {
        userRequests.set(userId, fresh);
      }
    }
  }, CLEANUP_INTERVAL_MS);
  cleanup.unref?.();

  return async (ctx, next) => {
    const userId = ctx.from?.id;
    if (!userId) {
      await next();
      return;
    }

    const now = Date.now();
    const cutoff = now - opts.windowMs;
    const timestamps = (userRequests.get(userId) ?? []).filter(
      (t) => t > cutoff,
    );

    if (timestamps.length >= opts.maxPerHour) {
      userRequests.set(userId, timestamps);
      await ctx.reply(
        `Занадто багато запитів. Спробуйте пізніше (ліміт ${opts.maxPerHour} збірок/год).`,
      );
      return;
    }

    timestamps.push(now);
    userRequests.set(userId, timestamps);
    await next();
  };
}
