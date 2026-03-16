const fs = require("fs/promises");
const path = require("path");
const express = require("express");
const Parser = require("rss-parser");

const app = express();
const port = process.env.PORT || 3000;
const configCandidates = [
  process.env.CONFIG_PATH ? path.resolve(process.env.CONFIG_PATH) : null,
  path.join(__dirname, "feeds.json"),
  path.join(__dirname, "feeds.example.json")
].filter(Boolean);

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
  items: [],
  feedStatuses: [],
  statusSummary: createStatusSummary([]),
  sourceConfigPath: null
};
const articleImageCache = new Map();
const feedHealthMemory = new Map();

app.use(express.static(path.join(__dirname, "public")));

app.get("/api/feed", async (_req, res) => {
  try {
    const config = await readConfig();
    const snapshot = await getCachedFeedSnapshot(config);

    res.json({
      meta: buildMeta(config, snapshot),
      items: snapshot.items
    });
  } catch (error) {
    res.status(500).json({
      error: "Impossible de charger les flux RSS.",
      details: error.message
    });
  }
});

app.get("/api/status", async (_req, res) => {
  try {
    const config = await readConfig();
    const snapshot = await getCachedFeedSnapshot(config);

    res.json({
      meta: buildMeta(config, snapshot),
      cache: {
        generatedAt: snapshot.generatedAt,
        ageMinutes: getAgeMinutes(snapshot.generatedAt),
        sourceConfigPath: cache.sourceConfigPath
      },
      feeds: snapshot.feedStatuses
    });
  } catch (error) {
    res.status(500).json({
      error: "Impossible de charger l'etat des flux.",
      details: error.message
    });
  }
});

app.listen(port, () => {
  console.log(`Dashboard RSS disponible sur http://localhost:${port}`);
});

async function readConfig() {
  const activeConfigPath = await resolveConfigPath();
  cache.sourceConfigPath = activeConfigPath;
  const raw = await fs.readFile(activeConfigPath, "utf8");
  return JSON.parse(raw);
}

async function getCachedFeedSnapshot(config) {
  const refreshWindowMs = getCacheTtlMinutes(config) * 60 * 1000;
  const now = Date.now();

  if (cache.generatedAt) {
    const ageMs = now - new Date(cache.generatedAt).getTime();
    if (ageMs < refreshWindowMs && cache.items.length) {
      return {
        generatedAt: cache.generatedAt,
        items: cache.items.slice(0, config.maxItems || 24),
        feedStatuses: cache.feedStatuses,
        statusSummary: cache.statusSummary
      };
    }
  }

  const snapshot = await loadFeedSnapshot(config);
  cache.generatedAt = snapshot.generatedAt;
  cache.items = snapshot.items;
  cache.feedStatuses = snapshot.feedStatuses;
  cache.statusSummary = snapshot.statusSummary;
  return snapshot;
}

async function loadFeedSnapshot(config) {
  const enabledFeeds = Array.isArray(config.feeds)
    ? config.feeds.filter((feed) => feed.enabled !== false && feed.url)
    : [];

  const requests = enabledFeeds.map((feed) => loadSingleFeed(feed, config.requestTimeoutMs));
  const settled = await Promise.allSettled(requests);
  const feedResults = settled.map((result, index) => {
    if (result.status === "fulfilled") {
      return result.value;
    }

    return buildFeedFailure(enabledFeeds[index], result.reason);
  });

  const items = feedResults
    .flatMap((result) => result.items)
    .filter(deduplicateItems)
    .sort(compareItemsByPriority);

  const limitedItems = items.slice(0, config.maxItems || 24);
  await enrichItemsWithImages(limitedItems);

  return {
    generatedAt: new Date().toISOString(),
    items: limitedItems.map((item) => enrichItemForDisplay(item, config)),
    feedStatuses: feedResults.map((result) => result.feedStatus),
    statusSummary: createStatusSummary(feedResults.map((result) => result.feedStatus))
  };
}

async function loadSingleFeed(feed, timeoutOverride) {
  const timeoutMs = toPositiveInteger(timeoutOverride, 12000);
  const localParser = timeoutOverride
    ? new Parser({
      timeout: timeoutMs,
      customFields: parserCustomFields
    })
    : parser;
  const startedAt = Date.now();

  try {
    const parsedFeed = await parseFeedWithFallback(localParser, feed.url, timeoutMs);
    const items = (parsedFeed.items || [])
      .map((item) => normalizeItem(item, feed, parsedFeed))
      .filter((item) => item.title && item.link);

    const feedStatus = updateFeedHealth(feed, {
      status: items.length ? "ok" : "empty",
      itemCount: items.length,
      durationMs: Date.now() - startedAt
    });

    return {
      items,
      feedStatus
    };
  } catch (error) {
    console.warn(`Flux ignore: ${feed.name || feed.url} (${error.message})`);
    return buildFeedFailure(feed, error, Date.now() - startedAt);
  }
}

async function parseFeedWithFallback(localParser, url, timeoutMs) {
  try {
    return await localParser.parseURL(url);
  } catch (_error) {
    const xml = await fetchFeedXmlWithRetry(url, timeoutMs);
    return localParser.parseString(xml);
  }
}

async function fetchFeedXmlWithRetry(url, timeoutMs) {
  const maxAttempts = 3;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const response = await fetch(url, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
          Accept: "application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8",
          "Accept-Language": "fr-FR,fr;q=0.9,en-US;q=0.8,en;q=0.7",
          Referer: "https://korben.info/"
        },
        signal: AbortSignal.timeout(timeoutMs)
      });

      if (response.ok) {
        return response.text();
      }

      if (!isRetryableStatus(response.status) || attempt === maxAttempts) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      if (attempt === maxAttempts || !isRetryableFetchError(error)) {
        throw error;
      }
    }

    await wait(700 * attempt);
  }

  throw new Error("Impossible de recuperer le flux RSS.");
}

function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

function isRetryableFetchError(error) {
  const message = String(error?.message || "");
  return error?.name === "TimeoutError" || error?.name === "AbortError" || message.includes("network");
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
    sourcePriority: toSignedInteger(feed.priority, 0),
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
    itemsPerPage: toPositiveInteger(display.itemsPerPage, 10),
    rotationSeconds: toPositiveInteger(display.rotationSeconds, 0)
  };
}

function buildMeta(config, snapshot) {
  const enabledFeedCount = Array.isArray(config.feeds)
    ? config.feeds.filter((feed) => feed.enabled !== false && feed.url).length
    : 0;

  return {
    title: config.dashboardTitle || "Dashboard RSS",
    refreshMinutes: getCacheTtlMinutes(config),
    cacheTtlMinutes: getCacheTtlMinutes(config),
    maxItems: config.maxItems || 24,
    timezone: config.timezone || "Europe/Paris",
    generatedAt: snapshot.generatedAt || new Date().toISOString(),
    enabledFeedCount,
    display: getDisplaySettings(config),
    statusSummary: snapshot.statusSummary
  };
}

function enrichItemForDisplay(item, config) {
  const ageMinutes = getAgeMinutes(item.publishedAt);
  const criticality = matchCriticality(item, config);
  return {
    ...item,
    ageMinutes,
    freshnessLabel: formatFreshness(ageMinutes),
    freshnessClass: getFreshnessClass(ageMinutes),
    criticalityLabel: criticality.label,
    criticalityClass: criticality.className,
    criticalityBoost: criticality.boost,
    matchedKeyword: criticality.matchedKeyword,
    score: computePriorityScore(item, ageMinutes, criticality)
  };
}

function deduplicateItems(item, index, items) {
  const key = buildDedupKey(item);
  return items.findIndex((entry) => buildDedupKey(entry) === key) === index;
}

function buildDedupKey(item) {
  const normalizedLink = normalizeLink(item.link);
  if (normalizedLink) {
    return `link:${normalizedLink}`;
  }

  return `title:${normalizeTitle(item.title)}`;
}

function normalizeLink(value) {
  if (!value) {
    return "";
  }

  try {
    const url = new URL(String(value).trim());
    url.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "fbclid", "gclid"].forEach((key) => {
      url.searchParams.delete(key);
    });
    const search = url.searchParams.toString();
    return `${url.origin}${url.pathname.replace(/\/+$/, "")}${search ? `?${search}` : ""}`.toLowerCase();
  } catch (_error) {
    return String(value).trim().toLowerCase();
  }
}

function normalizeTitle(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(the|a|an|le|la|les|de|des|du|un|une|and|et)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function compareItemsByPriority(left, right) {
  return computePriorityScore(right) - computePriorityScore(left);
}

function computePriorityScore(item, explicitAgeMinutes, criticalityOverride) {
  const ageMinutes = Number.isFinite(explicitAgeMinutes) ? explicitAgeMinutes : getAgeMinutes(item.publishedAt);
  const criticality = criticalityOverride || {
    boost: item.criticalityBoost || 0
  };
  const freshnessScore = Math.max(0, 20000 - ageMinutes);
  const summaryScore = item.summary ? Math.min(item.summary.length, 240) : 0;
  const imageScore = item.image ? 25 : 0;
  const sourcePriorityScore = toSignedInteger(item.sourcePriority, 0) * 60;
  const criticalityScore = toSignedInteger(criticality.boost, 0);
  return freshnessScore + summaryScore + imageScore + sourcePriorityScore + criticalityScore;
}

function matchCriticality(item, config) {
  const rules = Array.isArray(config?.criticalityRules) ? config.criticalityRules : [];
  const haystack = `${item.title || ""} ${item.summary || ""}`.toLowerCase();
  let best = null;

  for (const rule of rules) {
    const keywords = Array.isArray(rule?.keywords) ? rule.keywords : [];
    const matchedKeyword = keywords.find((keyword) => keyword && haystack.includes(String(keyword).toLowerCase()));
    if (!matchedKeyword) {
      continue;
    }

    const candidate = {
      label: rule.label || "Signal",
      className: rule.className || "is-critical-medium",
      boost: toSignedInteger(rule.boost, 0),
      matchedKeyword
    };

    if (!best || candidate.boost > best.boost) {
      best = candidate;
    }
  }

  return best || {
    label: "",
    className: "",
    boost: 0,
    matchedKeyword: ""
  };
}

function getAgeMinutes(value) {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.max(0, Math.round((Date.now() - timestamp) / 60000));
}

function formatFreshness(ageMinutes) {
  if (!Number.isFinite(ageMinutes) || ageMinutes === Number.MAX_SAFE_INTEGER) {
    return "N/A";
  }

  if (ageMinutes < 60) {
    return `${ageMinutes} min`;
  }

  if (ageMinutes < 1440) {
    return `${Math.round(ageMinutes / 60)} h`;
  }

  return `${Math.round(ageMinutes / 1440)} j`;
}

function getFreshnessClass(ageMinutes) {
  if (!Number.isFinite(ageMinutes)) {
    return "";
  }

  if (ageMinutes <= 120) {
    return "is-hot";
  }

  if (ageMinutes <= 720) {
    return "is-fresh";
  }

  return "";
}

function createStatusSummary(feedStatuses) {
  const summary = {
    total: feedStatuses.length,
    ok: 0,
    empty: 0,
    timeout: 0,
    error: 0
  };

  feedStatuses.forEach((feedStatus) => {
    const key = summary[feedStatus.status] !== undefined ? feedStatus.status : "error";
    summary[key] += 1;
  });

  return summary;
}

function updateFeedHealth(feed, nextStatus) {
  const key = buildFeedKey(feed);
  const previous = feedHealthMemory.get(key) || {
    lastSuccessAt: null,
    lastErrorAt: null
  };
  const timestamp = new Date().toISOString();

  const feedStatus = {
    name: feed.name || hostnameFromUrl(feed.url),
    url: feed.url,
    status: nextStatus.status,
    itemCount: nextStatus.itemCount || 0,
    durationMs: nextStatus.durationMs || 0,
    message: nextStatus.message || "",
    lastSuccessAt: previous.lastSuccessAt,
    lastErrorAt: previous.lastErrorAt
  };

  if (feedStatus.status === "ok" || feedStatus.status === "empty") {
    feedStatus.lastSuccessAt = timestamp;
  }

  if (feedStatus.status === "error" || feedStatus.status === "timeout") {
    feedStatus.lastErrorAt = timestamp;
  }

  feedHealthMemory.set(key, feedStatus);
  return feedStatus;
}

function buildFeedFailure(feed, error, durationMs = 0) {
  const message = String(error?.message || "Erreur inconnue");
  return {
    items: [],
    feedStatus: updateFeedHealth(feed, {
      status: inferFeedErrorStatus(error),
      itemCount: 0,
      durationMs,
      message
    })
  };
}

function inferFeedErrorStatus(error) {
  const message = String(error?.message || "").toLowerCase();
  if (error?.name === "TimeoutError" || error?.name === "AbortError" || message.includes("timeout")) {
    return "timeout";
  }

  return "error";
}

function buildFeedKey(feed) {
  return `${feed.name || ""}|${feed.url || ""}`;
}

function getCacheTtlMinutes(config) {
  return toPositiveInteger(config?.refreshMinutes, 5);
}

async function resolveConfigPath() {
  for (const candidate of configCandidates) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch (_error) {
      continue;
    }
  }

  throw new Error("Aucun fichier de configuration trouve. Creez feeds.json a partir de feeds.example.json.");
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function toSignedInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}
