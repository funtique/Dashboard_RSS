const body = document.getElementById("feed-grid");
const rowTemplate = document.getElementById("row-template");
const dashboardTitle = document.getElementById("dashboard-title");
const boardSubtitle = document.getElementById("board-subtitle");
const generatedAt = document.getElementById("generated-at");
const refreshLabel = document.getElementById("refresh-label");

const DEFAULT_ITEMS_PER_PAGE = 12;
const DEFAULT_ROTATION_SECONDS = 20;

let refreshTimer = null;
let rotationTimer = null;
let viewState = null;

boot();

async function boot() {
  await loadFeed();
}

async function loadFeed() {
  try {
    refreshLabel.textContent = "Synchronisation en cours";

    const response = await fetch("/api/feed", { cache: "no-store" });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.details || payload.error || "Erreur inconnue");
    }

    applyPayload(payload);
    scheduleRefresh(payload.meta.refreshMinutes || 10);
  } catch (error) {
    renderError(error.message);
    scheduleRefresh(5);
  }
}

function applyPayload(payload) {
  const items = payload.items || [];
  const itemsPerPage = toPositiveInteger(payload.meta?.display?.itemsPerPage, DEFAULT_ITEMS_PER_PAGE);
  const rotationSeconds = toPositiveInteger(payload.meta?.display?.rotationSeconds, DEFAULT_ROTATION_SECONDS);

  viewState = {
    payload,
    pages: chunk(items, itemsPerPage),
    pageIndex: 0,
    itemsPerPage,
    rotationSeconds
  };

  renderCurrentPage();
  scheduleRotation();
}

function renderCurrentPage() {
  if (!viewState) {
    return;
  }

  const payload = viewState.payload;
  const pages = viewState.pages;
  const pageItems = pages[viewState.pageIndex] || [];
  const totalItems = payload.items?.length || 0;
  const pageCount = Math.max(pages.length, 1);
  const pageLabel = pageCount > 1 ? ` | Page ${viewState.pageIndex + 1}/${pageCount}` : "";

  const items = payload.items || [];
  const formatterDate = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: payload.meta.timezone
  });
  const formatterTime = new Intl.DateTimeFormat("fr-FR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: payload.meta.timezone
  });
  const formatterGenerated = new Intl.DateTimeFormat("fr-FR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    timeZone: payload.meta.timezone
  });

  dashboardTitle.textContent = payload.meta.title;
  boardSubtitle.textContent = `${totalItems} article${totalItems > 1 ? "s" : ""} affiches${pageLabel}`;
  generatedAt.textContent = `Derniere mise a jour: ${formatterGenerated.format(new Date(payload.meta.generatedAt))}`;
  refreshLabel.textContent =
    `Actualisation ${payload.meta.refreshMinutes} min | Rotation ${viewState.rotationSeconds}s`;

  body.innerHTML = "";

  if (!items.length) {
    body.innerHTML = `<div class="empty-state">Aucun article disponible. Verifie les flux dans <code>feeds.json</code>.</div>`;
    return;
  }

  pageItems.forEach((item, index) => {
    const fragment = rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".feed-card");
    const image = fragment.querySelector(".thumb");
    const fallback = fragment.querySelector(".thumb-fallback");
    const freshnessBadge = fragment.querySelector(".freshness-badge");
    const publishedDate = new Date(item.publishedAt);
    const freshness = getFreshness(publishedDate);
    const hasValidDate = Number.isFinite(publishedDate.getTime());

    fragment.querySelector(".article-title").textContent = item.title;
    fragment.querySelector(".article-summary").textContent = summarize(item.summary || item.link);
    fragment.querySelector(".publish-time").textContent = hasValidDate ? formatterTime.format(publishedDate) : "--:--";
    fragment.querySelector(".publish-date").textContent = hasValidDate ? formatterDate.format(publishedDate) : "Date inconnue";
    fragment.querySelector(".source-badge").textContent = item.source;
    freshnessBadge.textContent = freshness.label;
    if (freshness.className) {
      freshnessBadge.classList.add(freshness.className);
    }

    if (item.image) {
      image.src = item.image;
      image.alt = item.title;
      image.classList.add("visible");
      image.addEventListener(
        "error",
        () => {
          image.classList.remove("visible");
          fallback.style.display = "grid";
        },
        { once: true }
      );
      fallback.style.display = "none";
    }

    row.style.setProperty("--delay-index", index);
    body.appendChild(fragment);
  });
}

function renderError(message) {
  viewState = null;
  clearRotation();
  dashboardTitle.textContent = "Veille RSS";
  boardSubtitle.textContent = "Flux indisponibles";
  generatedAt.textContent = "Le dashboard retentera automatiquement.";
  refreshLabel.textContent = "Erreur de chargement";
  body.innerHTML = `<div class="empty-state is-error">${escapeHtml(message)}</div>`;
}

function scheduleRefresh(minutes) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(loadFeed, minutes * 60 * 1000);
}

function scheduleRotation() {
  clearRotation();

  if (!viewState || viewState.pages.length <= 1) {
    return;
  }

  rotationTimer = window.setTimeout(() => {
    viewState.pageIndex = (viewState.pageIndex + 1) % viewState.pages.length;
    renderCurrentPage();
    scheduleRotation();
  }, viewState.rotationSeconds * 1000);
}

function clearRotation() {
  window.clearTimeout(rotationTimer);
  rotationTimer = null;
}

function chunk(items, size) {
  const pages = [];
  for (let index = 0; index < items.length; index += size) {
    pages.push(items.slice(index, index + size));
  }
  return pages;
}

function summarize(value) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= 180) {
    return text;
  }
  return `${text.slice(0, 177).trimEnd()}...`;
}

function toPositiveInteger(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function getFreshness(date) {
  if (!Number.isFinite(date.getTime())) {
    return {
      label: "N/A",
      className: ""
    };
  }

  const ageMinutes = Math.max(0, Math.round((Date.now() - date.getTime()) / 60000));

  if (ageMinutes <= 120) {
    return {
      label: `${ageMinutes} min`,
      className: "is-hot"
    };
  }

  if (ageMinutes <= 720) {
    return {
      label: `${Math.round(ageMinutes / 60)} h`,
      className: "is-fresh"
    };
  }

  return {
    label: `${Math.round(ageMinutes / 1440)} j`,
    className: ""
  };
}
