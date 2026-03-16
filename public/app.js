const feedGrid = document.getElementById("feed-grid");
const metricsGrid = document.getElementById("metrics-grid");
const headlineList = document.getElementById("headline-list");
const rowTemplate = document.getElementById("row-template");
const metricTemplate = document.getElementById("metric-template");
const headlineTemplate = document.getElementById("headline-template");
const dashboardTitle = document.getElementById("dashboard-title");
const boardSubtitle = document.getElementById("board-subtitle");
const generatedAt = document.getElementById("generated-at");
const refreshLabel = document.getElementById("refresh-label");
const featuredTitle = document.getElementById("featured-title");
const featuredSource = document.getElementById("featured-source");
const featuredFreshness = document.getElementById("featured-freshness");
const featuredImage = document.getElementById("featured-image");
const featuredImageFallback = document.getElementById("featured-image-fallback");
const featuredTime = document.getElementById("featured-time");
const featuredDate = document.getElementById("featured-date");
const featuredSummary = document.getElementById("featured-summary");
const featuredLink = document.getElementById("featured-link");

const FEATURED_COUNT = 1;
const HEADLINE_COUNT = 3;
const GRID_COUNT = 6;

boot();

async function boot() {
  await loadFeed();
}

async function loadFeed() {
  try {
    refreshLabel.textContent = "Chargement des flux";

    const response = await fetch("/api/feed", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Erreur inconnue");
    }

    renderDashboard(payload);
  } catch (error) {
    renderError(error.message);
  }
}

function renderDashboard(payload) {
  const items = Array.isArray(payload.items) ? payload.items : [];
  const meta = payload.meta || {};
  const timezone = meta.timezone || "Europe/Paris";
  const formatters = buildFormatters(timezone);
  const featuredItem = items[0] || null;
  const headlineItems = items.slice(FEATURED_COUNT, FEATURED_COUNT + HEADLINE_COUNT);
  const gridItems = items.slice(FEATURED_COUNT + HEADLINE_COUNT, FEATURED_COUNT + HEADLINE_COUNT + GRID_COUNT);
  const visibleCount = Number(featuredItem) + headlineItems.length + gridItems.length;

  dashboardTitle.textContent = meta.title || "Dashboard RSS";
  boardSubtitle.textContent = `${items.length} article${items.length > 1 ? "s" : ""} agreges | ${visibleCount} visibles sur cet ecran`;
  generatedAt.textContent = `Instantane genere le ${formatSafeDate(meta.generatedAt, formatters.generated, "date inconnue")}`;
  refreshLabel.textContent = formatCacheStatus(meta.cacheTtlMinutes);

  renderFeatured(featuredItem, formatters);
  renderMetrics(items, meta);
  renderHeadlines(headlineItems);
  renderGrid(gridItems, formatters);
}

function renderFeatured(item, formatters) {
  resetImage(featuredImage, featuredImageFallback);

  if (!item) {
    featuredTitle.textContent = "Aucun article a afficher";
    featuredSource.textContent = "Sources";
    featuredFreshness.textContent = "En attente";
    featuredFreshness.className = "freshness-badge";
    featuredTime.textContent = "--:--";
    featuredDate.textContent = "Aucune date";
    featuredSummary.textContent = "Le dashboard n'a remonte aucun article exploitable pour le moment.";
    featuredLink.removeAttribute("href");
    featuredLink.setAttribute("aria-disabled", "true");
    return;
  }

  featuredTitle.textContent = item.title;
  featuredSource.textContent = item.source || "Source";
  featuredFreshness.textContent = item.freshnessLabel || "N/A";
  featuredFreshness.className = `freshness-badge ${item.freshnessClass || ""}`.trim();
  featuredTime.textContent = formatSafeDate(item.publishedAt, formatters.time, "--:--");
  featuredDate.textContent = formatSafeDate(item.publishedAt, formatters.date, "Date inconnue");
  featuredSummary.textContent = summarize(item.summary || item.link, 340);
  featuredLink.href = item.link;
  featuredLink.removeAttribute("aria-disabled");

  applyImage(item.image, item.title, featuredImage, featuredImageFallback, "visible");
}

function renderMetrics(items, meta) {
  const uniqueSources = new Set(items.map((item) => item.source).filter(Boolean)).size;
  const hotItems = items.filter((item) => item.ageMinutes <= 120).length;
  const avgAge = items.length
    ? Math.round(items.reduce((total, item) => total + sanitizeAge(item.ageMinutes), 0) / items.length)
    : 0;
  const freshest = items[0]?.freshnessLabel || "N/A";
  const metrics = [
    {
      label: "Flux actifs",
      value: meta.enabledFeedCount || uniqueSources || 0,
      note: `${uniqueSources} source${uniqueSources > 1 ? "s" : ""} visibles`
    },
    {
      label: "Articles chauds",
      value: hotItems,
      note: "Publies il y a moins de 2 h"
    },
    {
      label: "Age moyen",
      value: formatAgeValue(avgAge),
      note: "Sur les articles agreges"
    },
    {
      label: "Plus recent",
      value: freshest,
      note: `Cache serveur ${formatCacheTtl(meta.cacheTtlMinutes)}`
    }
  ];

  metricsGrid.innerHTML = "";

  metrics.forEach((metric) => {
    const fragment = metricTemplate.content.cloneNode(true);
    fragment.querySelector(".metric-label").textContent = metric.label;
    fragment.querySelector(".metric-value").textContent = String(metric.value);
    fragment.querySelector(".metric-note").textContent = metric.note;
    metricsGrid.appendChild(fragment);
  });
}

function renderHeadlines(items) {
  headlineList.innerHTML = "";

  if (!items.length) {
    headlineList.innerHTML = `<div class="empty-state compact">Pas encore de titres secondaires disponibles.</div>`;
    return;
  }

  items.forEach((item) => {
    const fragment = headlineTemplate.content.cloneNode(true);
    fragment.querySelector(".headline-source").textContent = item.source || "Source";
    fragment.querySelector(".headline-freshness").textContent = item.freshnessLabel || "N/A";
    fragment.querySelector(".headline-title").textContent = item.title;
    headlineList.appendChild(fragment);
  });
}

function renderGrid(items, formatters) {
  feedGrid.innerHTML = "";

  if (!items.length) {
    feedGrid.innerHTML = `<div class="empty-state">Aucun article supplementaire a afficher. Verifie la configuration dans <code>feeds.json</code>.</div>`;
    return;
  }

  items.forEach((item, index) => {
    const fragment = rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".feed-card");
    const image = fragment.querySelector(".thumb");
    const fallback = fragment.querySelector(".thumb-fallback");
    const freshnessBadge = fragment.querySelector(".freshness-badge");
    const publishedDate = new Date(item.publishedAt);
    const hasValidDate = Number.isFinite(publishedDate.getTime());

    fragment.querySelector(".article-title").textContent = item.title;
    fragment.querySelector(".article-summary").textContent = summarize(item.summary || item.link, 150);
    fragment.querySelector(".publish-time").textContent = hasValidDate ? formatters.time.format(publishedDate) : "--:--";
    fragment.querySelector(".publish-date").textContent = hasValidDate ? formatters.date.format(publishedDate) : "Date inconnue";
    fragment.querySelector(".source-badge").textContent = item.source || "Source";
    freshnessBadge.textContent = item.freshnessLabel || "N/A";
    if (item.freshnessClass) {
      freshnessBadge.classList.add(item.freshnessClass);
    }

    applyImage(item.image, item.title, image, fallback, "visible");

    row.style.setProperty("--delay-index", index);
    feedGrid.appendChild(fragment);
  });
}

function renderError(message) {
  dashboardTitle.textContent = "Veille RSS";
  boardSubtitle.textContent = "Flux indisponibles";
  generatedAt.textContent = "Le prochain rechargement de l'ecran retentera automatiquement.";
  refreshLabel.textContent = "Chargement impossible";
  featuredTitle.textContent = "Erreur de collecte";
  featuredSource.textContent = "Systeme";
  featuredFreshness.textContent = "Erreur";
  featuredFreshness.className = "freshness-badge is-hot";
  featuredTime.textContent = "--:--";
  featuredDate.textContent = "Indisponible";
  featuredSummary.textContent = message;
  featuredLink.removeAttribute("href");
  featuredLink.setAttribute("aria-disabled", "true");
  resetImage(featuredImage, featuredImageFallback);
  metricsGrid.innerHTML = `<div class="empty-state compact is-error">Le backend n'a pas pu agreger les flux.</div>`;
  headlineList.innerHTML = "";
  feedGrid.innerHTML = `<div class="empty-state is-error">${escapeHtml(message)}</div>`;
}

function buildFormatters(timezone) {
  return {
    date: new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      timeZone: timezone
    }),
    time: new Intl.DateTimeFormat("fr-FR", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone
    }),
    generated: new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      timeZone: timezone
    })
  };
}

function applyImage(src, alt, imageElement, fallbackElement, visibleClass) {
  resetImage(imageElement, fallbackElement);

  if (!src) {
    return;
  }

  imageElement.src = src;
  imageElement.alt = alt;
  imageElement.classList.add(visibleClass);
  imageElement.addEventListener(
    "error",
    () => {
      resetImage(imageElement, fallbackElement);
    },
    { once: true }
  );
  fallbackElement.style.display = "none";
}

function formatSafeDate(value, formatter, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : fallback;
}

function resetImage(imageElement, fallbackElement) {
  imageElement.removeAttribute("src");
  imageElement.classList.remove("visible");
  fallbackElement.style.display = "grid";
}

function summarize(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) {
    return text;
  }
  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function sanitizeAge(value) {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function formatAgeValue(ageMinutes) {
  if (ageMinutes < 60) {
    return `${ageMinutes} min`;
  }

  if (ageMinutes < 1440) {
    return `${Math.round(ageMinutes / 60)} h`;
  }

  return `${Math.round(ageMinutes / 1440)} j`;
}

function formatCacheStatus(cacheTtlMinutes) {
  return `Vue fixe | cache ${formatCacheTtl(cacheTtlMinutes)}`;
}

function formatCacheTtl(cacheTtlMinutes) {
  const minutes = Number.isFinite(cacheTtlMinutes) && cacheTtlMinutes > 0 ? cacheTtlMinutes : 5;
  return `${minutes} min`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
