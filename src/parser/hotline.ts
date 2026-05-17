import axios from "axios";
import * as cheerio from "cheerio";
import { logger } from "../bot/middlewares/logger";

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const REQUEST_TIMEOUT_MS = 10_000;
const HOTLINE_BASE_URL = "https://hotline.ua";

export interface ParsedComponent {
  name: string;
  price: number;
  url: string;
}

export async function searchHotline(
  query: string,
): Promise<ParsedComponent | null> {
  const searchUrl = `${HOTLINE_BASE_URL}/search/?q=${encodeURIComponent(query)}`;

  try {
    const { data } = await axios.get<string>(searchUrl, {
      headers: {
        "User-Agent": USER_AGENT,
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        "Accept-Language": "uk-UA,uk;q=0.9,en;q=0.8",
      },
      timeout: REQUEST_TIMEOUT_MS,
      validateStatus: (status) => status >= 200 && status < 400,
    });

    const $ = cheerio.load(data);
    const firstItem = $(".list-item").first();
    if (firstItem.length === 0) return null;

    const name = firstItem.find(".list-item__title").text().trim() || query;
    const priceText = firstItem
      .find(".price__value")
      .first()
      .text()
      .replace(/\s/gu, "");
    const price = Number.parseInt(priceText, 10);
    if (!Number.isFinite(price) || price <= 0) return null;

    const relativeUrl = firstItem.find("a").first().attr("href") ?? "";
    const url = relativeUrl.startsWith("http")
      ? relativeUrl
      : `${HOTLINE_BASE_URL}${relativeUrl}`;

    return { name, price, url };
  } catch (err) {
    logger.warn({ err, query }, "Hotline parse failed");
    return null;
  }
}
