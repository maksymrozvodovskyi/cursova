import { prisma } from "../client";
import { Prisma } from "../../../prisma/generated/prisma/index";
import type {
  Build,
  ComponentCache,
} from "../../../prisma/generated/prisma/index";
import type { Component } from "../../types";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface BuildInput {
  userId: number;
  budget: number;
  useCase: string;
  components: Component[];
  totalPrice: number;
  explanation?: string | null;
}

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function saveBuild(input: BuildInput): Promise<Build> {
  return prisma.build.create({
    data: {
      userId: input.userId,
      budget: input.budget,
      useCase: input.useCase,
      components: toJsonInput(input.components),
      totalPrice: input.totalPrice,
      explanation: input.explanation ?? null,
    },
  });
}

export async function getUserBuilds(
  userId: number,
  limit = 5,
): Promise<Build[]> {
  return prisma.build.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
}

export async function getCachedComponent(
  query: string,
  source = "hotline",
): Promise<ComponentCache | null> {
  const cached = await prisma.componentCache.findUnique({
    where: { query_source: { query, source } },
  });
  if (cached && cached.lastUpdated > new Date(Date.now() - CACHE_TTL_MS)) {
    return cached;
  }
  return null;
}

export interface CacheInput {
  query: string;
  normalizedName: string;
  price: number;
  url: string;
  source?: string;
}

export async function saveToCache(data: CacheInput): Promise<ComponentCache> {
  const source = data.source ?? "hotline";

  return prisma.componentCache.upsert({
    where: { query_source: { query: data.query, source } },
    update: {
      price: data.price,
      url: data.url,
      normalizedName: data.normalizedName,
      lastUpdated: new Date(),
    },
    create: {
      query: data.query,
      normalizedName: data.normalizedName,
      price: data.price,
      url: data.url,
      source,
    },
  });
}
