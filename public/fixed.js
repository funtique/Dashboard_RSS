const fixedGrid = document.getElementById("fixed-grid");
const fixedTitle = document.getElementById("fixed-title");
const fixedSubtitle = document.getElementById("fixed-subtitle");
const fixedGenerated = document.getElementById("fixed-generated");
const fixedCardTemplate = document.getElementById("fixed-card-template");

boot();

window.addEventListener("resize", applyGridDensity);

async function boot() {
  try {
    const payload = await fetchJson("/api/feed");
    renderFixedPage(payload);
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

function renderFixedPage(payload) {
  const items = Array.isArray(payload?.items) ? payload.items : [];
  const meta = payload?.meta || {};
  const timezone = meta.timezone || "Europe/Paris";
  const formatters = buildFormatters(timezone);

  fixedTitle.textContent = `${meta.title || "Dashboard RSS"} | Mosaïque`;
  fixedSubtitle.textContent = `${items.length} flux visibles sans defilement`;
  fixedGenerated.textContent = `Maj ${formatSafeDate(meta.generatedAt, formatters.generated, "inconnue")}`;
  fixedGrid.innerHTML = "";

  if (!items.length) {
    fixedGrid.innerHTML = `<div class="fixed-empty">Aucun article a afficher.</div>`;
    applyGridDensity();
    return;
  }

  items.forEach((item) => {
    const fragment = fixedCardTemplate.content.cloneNode(true);
    const criticality = fragment.querySelector(".fixed-criticality");

    fragment.querySelector(".fixed-source").textContent = item.source || "Source";
    fragment.querySelector(".fixed-age").textContent = item.freshnessLabel || "N/A";
    fragment.querySelector(".fixed-card-title").textContent = item.title || "Article sans titre";
    fragment.querySelector(".fixed-card-summary").textContent = summarize(item.summary || item.link, 140);
    fragment.querySelector(".fixed-date").textContent = formatSafeDate(item.publishedAt, formatters.dateTime, "Date inconnue");

    if (item.criticalityLabel) {
      criticality.textContent = item.criticalityLabel;
      criticality.classList.add("is-visible");
      if (item.criticalityClass) {
        criticality.classList.add(item.criticalityClass);
      }
    } else {
      criticality.remove();
    }

    fixedGrid.appendChild(fragment);
  });

  applyGridDensity();
}

function applyGridDensity() {
  const cards = fixedGrid.querySelectorAll(".fixed-card");
  const itemCount = cards.length;
  const columns = computeColumnCount(itemCount);
  const rows = itemCount ? Math.ceil(itemCount / columns) : 1;

  fixedGrid.style.setProperty("--fixed-columns", String(columns));
  fixedGrid.style.setProperty("--fixed-rows", String(rows));

  fixedGrid.dataset.density = getDensityLevel(itemCount, rows);
}

function computeColumnCount(itemCount) {
  if (itemCount <= 1) {
    return 1;
  }

  const viewportRatio = window.innerWidth / Math.max(window.innerHeight, 1);
  const baseColumns = Math.ceil(Math.sqrt(itemCount * viewportRatio));
  return Math.min(Math.max(baseColumns, 2), Math.max(itemCount, 1));
}

function getDensityLevel(itemCount, rows) {
  if (itemCount >= 16 || rows >= 4) {
    return "tight";
  }

  if (itemCount >= 9 || rows >= 3) {
    return "compact";
  }

  return "normal";
}

function buildFormatters(timezone) {
  return {
    generated: new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone
    }),
    dateTime: new Intl.DateTimeFormat("fr-FR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: timezone
    })
  };
}

function formatSafeDate(value, formatter, fallback) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? formatter.format(date) : fallback;
}

function summarize(value, limit) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (text.length <= limit) {
    return text;
  }

  return `${text.slice(0, limit - 3).trimEnd()}...`;
}

function renderError(message) {
  fixedTitle.textContent = "Flux fixe indisponible";
  fixedSubtitle.textContent = "Le mur n'a pas pu charger les flux.";
  fixedGenerated.textContent = "";
  fixedGrid.innerHTML = `<div class="fixed-empty is-error">${escapeHtml(message)}</div>`;
  applyGridDensity();
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
