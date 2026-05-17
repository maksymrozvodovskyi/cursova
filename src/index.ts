import { env } from "./config/env";
import { startBot } from "./bot";
import { logger } from "./bot/middlewares/logger";

async function main(): Promise<void> {
  await startBot();
  logger.info({ env: env.NODE_ENV }, "Application started");
}

main().catch((err) => {
  logger.error({ err }, "Fatal application error");
  process.exit(1);
});
