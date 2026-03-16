const feedGrid = document.getElementById("feed-grid");
const metricsGrid = document.getElementById("metrics-grid");
const headlineList = document.getElementById("headline-list");
const healthSummary = document.getElementById("health-summary");
const healthList = document.getElementById("health-list");
const rowTemplate = document.getElementById("row-template");
const metricTemplate = document.getElementById("metric-template");
const headlineTemplate = document.getElementById("headline-template");
const healthTemplate = document.getElementById("health-template");
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
  await loadDashboard();
}

async function loadDashboard() {
  try {
    refreshLabel.textContent = "Chargement des flux";

    const [feedPayload, statusPayload] = await Promise.all([
      fetchJson("/api/feed"),
      fetchJson("/api/status")
    ]);

    renderDashboard(feedPayload, statusPayload);
  } catch (error) {
    renderError(error.message);
  }
}

async function fetchJson(url) {
  const response = await fetch(url, { cache: "no-store" });
  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.details || payload.error || "Erreur inconnue");
  }

  return payload;
}

function renderDashboard(feedPayload, statusPayload) {
  const items = Array.isArray(feedPayload.items) ? feedPayload.items : [];
  const meta = feedPayload.meta || {};
  const timezone = meta.timezone || "Europe/Paris";
  const formatters = buildFormatters(timezone);
  const featuredItem = items[0] || null;
  const headlineItems = items.slice(FEATURED_COUNT, FEATURED_COUNT + HEADLINE_COUNT);
  const gridItems = items.slice(FEATURED_COUNT + HEADLINE_COUNT, FEATURED_COUNT + HEADLINE_COUNT + GRID_COUNT);
  const visibleCount = Number(featuredItem) + headlineItems.length + gridItems.length;

  dashboardTitle.textContent = meta.title || "Dashboard RSS";
  boardSubtitle.textContent = `${items.length} article${items.length > 1 ? "s" : ""} agreges | ${visibleCount} visibles sur cet ecran`;
  generatedAt.textContent = `Instantane genere le ${formatSafeDate(meta.generatedAt, formatters.generated, "date inconnue")}`;
  refreshLabel.textContent = formatCacheStatus(meta.cacheTtlMinutes, meta.statusSummary);

  renderFeatured(featuredItem, formatters);
  renderMetrics(items, meta);
  renderHealth(statusPayload, formatters);
  renderHeadlines(headlineItems);
  renderGrid(gridItems, formatters);
}

function renderFeatured(item, formatters) {
  resetImage(featuredImage, featuredImageFallback);
  featuredSource.textContent = "";
  featuredFreshness.textContent = "";
  featuredFreshness.className = "freshness-badge";

  if (!item) {
    featuredTitle.textContent = "Aucun article a afficher";
    featuredSource.textContent = "Sources";
    featuredFreshness.textContent = "En attente";
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
  featuredSummary.textContent = buildFeaturedSummary(item);
  featuredLink.href = item.link;
  featuredLink.removeAttribute("aria-disabled");

  applyImage(item.image, item.title, featuredImage, featuredImageFallback, "visible");
}

function buildFeaturedSummary(item) {
  const parts = [];
  if (item.criticalityLabel) {
    const detail = item.matchedKeyword ? ` via "${item.matchedKeyword}"` : "";
    parts.push(`${item.criticalityLabel}${detail}.`);
  }

  const excerpt = summarize(item.summary || item.link, 280);
  if (excerpt) {
    parts.push(excerpt);
  }

  return parts.join(" ");
}

function renderMetrics(items, meta) {
  const uniqueSources = new Set(items.map((item) => item.source).filter(Boolean)).size;
  const hotItems = items.filter((item) => item.ageMinutes <= 120).length;
  const criticalItems = items.filter((item) => Boolean(item.criticalityLabel)).length;
  const avgAge = items.length
    ? Math.round(items.reduce((total, item) => total + sanitizeAge(item.ageMinutes), 0) / items.length)
    : 0;
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
      label: "Signaux critiques",
      value: criticalItems,
      note: "Mots-cles critiques detectes"
    },
    {
      label: "Age moyen",
      value: formatAgeValue(avgAge),
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

function renderHealth(statusPayload, formatters) {
  const feedStatuses = Array.isArray(statusPayload?.feeds) ? statusPayload.feeds : [];
  const summary = statusPayload?.meta?.statusSummary || createEmptyStatusSummary();

  healthSummary.innerHTML = "";
  healthList.innerHTML = "";

  healthSummary.appendChild(createSummaryBadge(`${summary.ok} OK`, "is-ok"));
  healthSummary.appendChild(createSummaryBadge(`${summary.empty} vides`, "is-empty"));
  healthSummary.appendChild(createSummaryBadge(`${summary.timeout} timeout`, "is-timeout"));
  healthSummary.appendChild(createSummaryBadge(`${summary.error} erreurs`, "is-error"));

  if (!feedStatuses.length) {
    healthList.innerHTML = `<div class="empty-state compact">Aucun etat de flux disponible.</div>`;
    return;
  }

  feedStatuses
    .slice()
    .sort(compareHealthStatuses)
    .forEach((feedStatus) => {
      const fragment = healthTemplate.content.cloneNode(true);
      const statusPill = fragment.querySelector(".health-status");
      fragment.querySelector(".health-name").textContent = feedStatus.name || "Flux";
      statusPill.textContent = formatFeedStatusLabel(feedStatus.status);
      statusPill.classList.add(getHealthStatusClass(feedStatus.status));
      fragment.querySelector(".health-note").textContent = buildHealthNote(feedStatus, formatters);
      healthList.appendChild(fragment);
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
    const criticalityBadge = fragment.querySelector(".headline-criticality");
    fragment.querySelector(".headline-source").textContent = item.source || "Source";
    fragment.querySelector(".headline-freshness").textContent = item.freshnessLabel || "N/A";
    fragment.querySelector(".headline-title").textContent = item.title;
    applyCriticalityBadge(criticalityBadge, item);
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
    const criticalityBadge = fragment.querySelector(".criticality-badge");
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

    applyCriticalityBadge(criticalityBadge, item);
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
  healthSummary.innerHTML = "";
  healthList.innerHTML = `<div class="empty-state compact is-error">Le panneau de sante est indisponible.</div>`;
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

function applyCriticalityBadge(element, item) {
  element.textContent = item.criticalityLabel || "";
  element.className = "criticality-badge";

  if (!item.criticalityLabel) {
    element.classList.add("is-hidden");
    return;
  }

  element.classList.add("is-visible");
  if (item.criticalityClass) {
    element.classList.add(item.criticalityClass);
  }
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

function formatCacheStatus(cacheTtlMinutes, statusSummary) {
  const summary = statusSummary || createEmptyStatusSummary();
  return `Vue fixe | cache ${formatCacheTtl(cacheTtlMinutes)} | ${summary.ok}/${summary.total || 0} flux OK`;
}

function formatCacheTtl(cacheTtlMinutes) {
  const minutes = Number.isFinite(cacheTtlMinutes) && cacheTtlMinutes > 0 ? cacheTtlMinutes : 5;
  return `${minutes} min`;
}

function formatFeedStatusLabel(status) {
  const labels = {
    ok: "OK",
    empty: "Vide",
    timeout: "Timeout",
    error: "Erreur"
  };
  return labels[status] || "Inconnu";
}

function getHealthStatusClass(status) {
  return `is-${status || "error"}`;
}

function buildHealthNote(feedStatus, formatters) {
  const durationLabel = Number.isFinite(feedStatus.durationMs) ? `${feedStatus.durationMs} ms` : "n/a";
  const itemsLabel = `${feedStatus.itemCount || 0} article${feedStatus.itemCount > 1 ? "s" : ""}`;

  if (feedStatus.status === "ok" || feedStatus.status === "empty") {
    const successLabel = formatSafeDate(feedStatus.lastSuccessAt, formatters.generated, "date inconnue");
    return `${itemsLabel} | ${durationLabel} | dernier succes ${successLabel}`;
  }

  const errorMessage = feedStatus.message || "Erreur non detaillee";
  const errorLabel = formatSafeDate(feedStatus.lastErrorAt, formatters.generated, "date inconnue");
  return `${itemsLabel} | ${durationLabel} | ${errorMessage} | ${errorLabel}`;
}

function createSummaryBadge(label, className) {
  const element = document.createElement("span");
  element.className = `health-pill ${className}`;
  element.textContent = label;
  return element;
}

function compareHealthStatuses(left, right) {
  const order = {
    error: 0,
    timeout: 1,
    empty: 2,
    ok: 3
  };
  return (order[left.status] ?? 99) - (order[right.status] ?? 99);
}

function createEmptyStatusSummary() {
  return {
    total: 0,
    ok: 0,
    empty: 0,
    timeout: 0,
    error: 0
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
