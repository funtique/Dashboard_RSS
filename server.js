const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const Parser = require("rss-parser");

const app = express();
const port = process.env.PORT || 3000;
const configPath = path.join(__dirname, "feeds.json");

const parserCustomFields = {
  item: [
    ["media:content", "mediaContent", { keepArray: true }],
    ["media:thumbnail", "mediaThumbnail", { keepArray: true }],
    ["media:group", "mediaGroup", { keepArray: true }],
    ["enclosure", "enclosure", { keepArray: true }],
    ["content:encoded", "contentEncoded"],
    ["itunes:image", "itunesImage"],
    ["image", "image"]
  ]
};

const parser = new Parser({
  timeout: 12000,
  customFields: parserCustomFields
});

const cache = {
  generatedAt: null,
  items: []
};
const articleImageCache = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/feed", async (_req, res) => {
  try {
    const config = await readConfig();
    const items = await getCachedFeedItems(config);
    const display = getDisplaySettings(config);

    res.json({
      meta: {
        title: config.dashboardTitle || "Dashboard RSS",
        refreshMinutes: config.refreshMinutes || 10,
        maxItems: config.maxItems || 24,
        timezone: config.timezone || "Europe/Paris",
        generatedAt: cache.generatedAt || new Date().toISOString(),
        display
      },
      items
    });
  } catch (error) {
    res.status(500).json({
      error: "Impossible de charger les flux RSS.",
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Dashboard RSS disponible sur http://localhost:${port}`);
});

async function readConfig() {
  const raw = await fs.readFile(configPath, "utf8");
  return JSON.parse(raw);
}

async function loadFeedItems(config) {
  const enabledFeeds = Array.isArray(config.feeds)
    ? config.feeds.filter((feed) => feed.enabled !== false && feed.url)
    : [];

  const requests = enabledFeeds.map((feed) => loadSingleFeed(feed, config.requestTimeoutMs));
  const settled = await Promise.allSettled(requests);

  const items = settled
    .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
    .sort((left, right) => {
      const leftDate = new Date(left.publishedAt).getTime() || 0;
      const rightDate = new Date(right.publishedAt).getTime() || 0;
      return rightDate - leftDate;
    });

  const limitedItems = items.slice(0, config.maxItems || 24);
  await enrichItemsWithImages(limitedItems);
  return limitedItems;
}

async function getCachedFeedItems(config) {
  const refreshMinutes = config.refreshMinutes || 10;
  const refreshWindowMs = refreshMinutes * 60 * 1000;
  const now = Date.now();

  if (cache.generatedAt) {
    const ageMs = now - new Date(cache.generatedAt).getTime();
    if (ageMs < refreshWindowMs && cache.items.length) {
      return cache.items.slice(0, config.maxItems || 24);
    }
  }

  const items = await loadFeedItems(config);
  cache.generatedAt = new Date().toISOString();
  cache.items = items;
  return items;
}

async function loadSingleFeed(feed, timeoutOverride) {
  const localParser = timeoutOverride
    ? new Parser({
        timeout: timeoutOverride,
        customFields: parserCustomFields
      })
    : parser;

  try {
    const parsedFeed = await localParser.parseURL(feed.url);

    return (parsedFeed.items || [])
      .map((item) => normalizeItem(item, feed, parsedFeed))
      .filter((item) => item.title && item.link);
  } catch (error) {
    console.warn(`Flux ignore: ${feed.name || feed.url} (${error.message})`);
    return [];
  }
}

async function enrichItemsWithImages(items) {
  const targets = items.filter((item) => !item.image && item.link);
  await Promise.allSettled(targets.map(async (item) => {
    item.image = await extractImageFromArticle(item.link);
  }));
}

function normalizeItem(item, feed, parsedFeed) {
  const publishedAt =
    item.isoDate ||
    item.pubDate ||
    item.published ||
    item.created ||
    new Date(0).toISOString();

  return {
    id: item.guid || item.id || item.link,
    title: stripHtml(item.title || "").trim(),
    link: item.link,
    publishedAt,
    source: feed.name || parsedFeed.title || hostnameFromUrl(feed.url),
    image: extractImage(item),
    summary: buildSummary(item)
  };
}

function buildSummary(item) {
  const text = stripHtml(item.contentSnippet || item.content || item.contentEncoded || "");
  return text.replace(/\s+/g, " ").trim();
}

function extractImage(item) {
  const candidates = [
    item.enclosure,
    item.mediaContent,
    item.mediaThumbnail,
    item.mediaGroup
  ]
    .flat()
    .filter(Boolean);

  for (const entry of candidates) {
    if (Array.isArray(entry)) {
      for (const nested of entry) {
        const url = pickImageUrl(nested);
        if (url) {
          return url;
        }
      }
    }

    const url = pickImageUrl(entry);
    if (url) {
      return url;
    }
  }

  const htmlSources = [item.contentEncoded, item.content, item.summary, item.description]
    .filter(Boolean)
    .map((value) => String(value));

  for (const html of htmlSources) {
    const match = html.match(/<img[^>]+src=["']([^"']+)["']/i);
    if (match) {
      return match[1];
    }
  }

  if (typeof item.itunesImage === "string" && item.itunesImage) {
    return item.itunesImage;
  }

  if (item.itunesImage && typeof item.itunesImage.href === "string") {
    return item.itunesImage.href;
  }

  return null;
}

async function extractImageFromArticle(url) {
  if (articleImageCache.has(url)) {
    return articleImageCache.get(url);
  }

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml"
      }
    });

    if (!response.ok) {
      articleImageCache.set(url, null);
      return null;
    }

    const html = await response.text();
    const image = extractMetaImage(html);
    articleImageCache.set(url, image);
    return image;
  } catch (_error) {
    articleImageCache.set(url, null);
    return null;
  }
}

function extractMetaImage(html) {
  const patterns = [
    /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i,
    /<meta[^>]+name=["']twitter:image["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+name=["']twitter:image["']/i,
    /<img[^>]+src=["']([^"']+)["']/i
  ];

  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match && isUsableImageUrl(match[1])) {
      return match[1];
    }
  }

  return null;
}

function pickImageUrl(entry) {
  if (!entry) {
    return null;
  }

  if (typeof entry === "string" && isImageUrl(entry)) {
    return entry;
  }

  const values = [entry.url, entry.$?.url, entry.href, entry.$?.href, entry.link, entry.path];

  return values.find((value) => typeof value === "string" && isUsableImageUrl(value)) || null;
}

function isImageUrl(value) {
  return /^https?:\/\//i.test(value) && /\.(jpg|jpeg|png|webp|gif)(\?.*)?$/i.test(value);
}

function isUsableImageUrl(value) {
  return /^https?:\/\//i.test(value) && !value.includes("data:image");
}

function stripHtml(value) {
  return String(value || "").replace(/<[^>]*>/g, " ");
}

function hostnameFromUrl(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch (_error) {
    return value;
  }
}

function getDisplaySettings(config) {
  const display = config?.display || {};
  return {
    itemsPerPage: toPositiveInteger(display.itemsPerPage, 12),
    rotationSeconds: toPositiveInteger(display.rotationSeconds, 20)
  };
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
