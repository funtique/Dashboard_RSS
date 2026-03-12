const body = document.getElementById("feed-grid");
const rowTemplate = document.getElementById("row-template");
const dashboardTitle = document.getElementById("dashboard-title");
const boardSubtitle = document.getElementById("board-subtitle");
const generatedAt = document.getElementById("generated-at");
const refreshLabel = document.getElementById("refresh-label");

let refreshTimer = null;

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

    renderPayload(payload);
    scheduleRefresh(payload.meta.refreshMinutes || 10);
  } catch (error) {
    renderError(error.message);
    scheduleRefresh(5);
  }
}

function renderPayload(payload) {
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
  boardSubtitle.textContent = `${items.length} article${items.length > 1 ? "s" : ""} affiches`;
  generatedAt.textContent = `Derniere mise a jour: ${formatterGenerated.format(new Date(payload.meta.generatedAt))}`;
  refreshLabel.textContent = `Actualisation toutes les ${payload.meta.refreshMinutes} min`;

  body.innerHTML = "";

  if (!items.length) {
    body.innerHTML = `<div class="empty-state">Aucun article disponible. Verifie les flux dans <code>feeds.json</code>.</div>`;
    return;
  }

  for (const item of items) {
    const fragment = rowTemplate.content.cloneNode(true);
    const row = fragment.querySelector(".feed-card");
    const image = fragment.querySelector(".thumb");
    const fallback = fragment.querySelector(".thumb-fallback");

    fragment.querySelector(".article-title").textContent = item.title;
    fragment.querySelector(".article-summary").textContent = item.summary || item.link;
    fragment.querySelector(".publish-time").textContent = formatterTime.format(new Date(item.publishedAt));
    fragment.querySelector(".publish-date").textContent = formatterDate.format(new Date(item.publishedAt));
    fragment.querySelector(".source-badge").textContent = item.source;

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

    row.dataset.href = item.link;
    body.appendChild(fragment);
  }
}

function renderError(message) {
  dashboardTitle.textContent = "Veille RSS";
  boardSubtitle.textContent = "Flux indisponibles";
  generatedAt.textContent = "Le dashboard retentera automatiquement.";
  refreshLabel.textContent = "Erreur de chargement";
  body.innerHTML = `<div class="empty-state">${escapeHtml(message)}</div>`;
}

function scheduleRefresh(minutes) {
  window.clearTimeout(refreshTimer);
  refreshTimer = window.setTimeout(loadFeed, minutes * 60 * 1000);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
