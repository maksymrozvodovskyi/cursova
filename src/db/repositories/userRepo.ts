import { prisma } from "../client";
import type { User } from "../../../prisma/generated/prisma/index";

export async function findOrCreateUser(
  telegramId: number,
  username?: string | null,
  firstName?: string | null,
): Promise<User> {
  const telegramIdBig = BigInt(telegramId);

  const existing = await prisma.user.findUnique({
    where: { telegramId: telegramIdBig },
  });
  if (existing) return existing;

  return prisma.user.create({
    data: {
      telegramId: telegramIdBig,
      username: username ?? null,
      firstName: firstName ?? null,
    },
  });
}
