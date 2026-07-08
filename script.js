/*=========================================================
   script.js
   ----------------------------------------------------------------------------
   Wires up the UI and implements the recommendation engine. Depends on the
   global `ITEMS` array defined in data.js (loaded before this file).
   ============================================================================ */

/* ----------------------------------------------------------------------------
   1. STATE
   -------------------------------------------------------------------------- */

let favoriteIds = new Set();     // ids of items the user has added to preferences
let currentRecommendations = []; // last generated recommendation list
let filters = {
  search: "",
  category: "all",
  genre: "all",
  sort: "rating-desc",
};

/* ----------------------------------------------------------------------------
   2. DOM REFERENCES
   -------------------------------------------------------------------------- */

const catalogGrid = document.getElementById("catalogGrid");
const catalogEmpty = document.getElementById("catalogEmpty");
const preferencesShelf = document.getElementById("preferencesShelf");
const preferencesEmpty = document.getElementById("preferencesEmpty");
const recGrid = document.getElementById("recGrid");
const recEmpty = document.getElementById("recEmpty");
const loadingState = document.getElementById("loadingState");

const searchInput = document.getElementById("searchInput");
const categoryFilter = document.getElementById("categoryFilter");
const genreFilter = document.getElementById("genreFilter");
const sortSelect = document.getElementById("sortSelect");

const generateBtn = document.getElementById("generateBtn");
const resetBtn = document.getElementById("resetBtn");
const clearRecsBtn = document.getElementById("clearRecsBtn");
const themeToggle = document.getElementById("themeToggle");

const statTotal = document.getElementById("statTotal");
const statFavorites = document.getElementById("statFavorites");
const statRecs = document.getElementById("statRecs");

/* ----------------------------------------------------------------------------
   3. UTILITIES
   -------------------------------------------------------------------------- */

/** Escapes text before inserting into innerHTML to avoid markup injection. */
function escapeHTML(str) {
  const div = document.createElement("div");
  div.textContent = str;
  return div.innerHTML;
}

function getItemById(id) {
  return ITEMS.find((item) => item.id === id);
}

/** Builds the list of star icons for a rating (movies/books use /10, products use /5). */
function formatRating(item) {
  const scale = item.category === "Product" ? 5 : 10;
  return `★ ${item.rating.toFixed(1)} / ${scale}`;
}

/* ----------------------------------------------------------------------------
   4. RENDERING — CATALOG
   -------------------------------------------------------------------------- */

/** Populates the genre filter dropdown with every unique genre found in ITEMS. */
function populateGenreFilter() {
  const genreSet = new Set();
  ITEMS.forEach((item) => item.genres.forEach((g) => genreSet.add(g)));
  const sortedGenres = [...genreSet].sort();
  sortedGenres.forEach((genre) => {
    const opt = document.createElement("option");
    opt.value = genre;
    opt.textContent = genre;
    genreFilter.appendChild(opt);
  });
}

/** Applies current search/category/genre filters + sort order to ITEMS. */
function getFilteredItems() {
  let result = ITEMS.filter((item) => {
    const matchesSearch = item.title.toLowerCase().includes(filters.search.toLowerCase());
    const matchesCategory = filters.category === "all" || item.category === filters.category;
    const matchesGenre = filters.genre === "all" || item.genres.includes(filters.genre);
    return matchesSearch && matchesCategory && matchesGenre;
  });

  switch (filters.sort) {
    case "rating-desc":
      result.sort((a, b) => b.rating - a.rating);
      break;
    case "rating-asc":
      result.sort((a, b) => a.rating - b.rating);
      break;
    case "title-asc":
      result.sort((a, b) => a.title.localeCompare(b.title));
      break;
  }
  return result;
}

/** Builds the HTML for a single catalog card. */
function buildItemCard(item) {
  const isAdded = favoriteIds.has(item.id);
  const tags = item.genres
    .map((g) => `<span class="tag-stub">${escapeHTML(g)}</span>`)
    .join("");

  return `
    <article class="item-card" role="listitem">
      <img class="item-thumb" src="${item.image}" alt="${escapeHTML(item.title)}" loading="lazy" />
      <div class="item-body">
        <span class="item-eyebrow">${escapeHTML(item.category)}</span>
        <h3 class="item-title">${escapeHTML(item.title)}</h3>
        <p class="item-desc">${escapeHTML(item.description)}</p>
        <div class="tag-row">${tags}</div>
        <div class="item-footer">
          <span class="item-rating">${formatRating(item)}</span>
          <button class="add-btn ${isAdded ? "added" : ""}" data-id="${item.id}">
            ${isAdded ? "Added ✓" : "Add to Preferences"}
          </button>
        </div>
      </div>
    </article>
  `;
}

/** Re-renders the catalog grid based on current filters. */
function renderCatalog() {
  const items = getFilteredItems();
  catalogGrid.innerHTML = items.map(buildItemCard).join("");
  catalogEmpty.hidden = items.length !== 0;

  // Wire up "Add to Preferences" buttons (re-attached every render since
  // innerHTML was replaced).
  catalogGrid.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", () => toggleFavorite(Number(btn.dataset.id)));
  });
}

/* ----------------------------------------------------------------------------
   5. RENDERING — PREFERENCES SHELF
   -------------------------------------------------------------------------- */

function renderShelf() {
  const favorites = [...favoriteIds].map(getItemById).filter(Boolean);

  preferencesShelf.innerHTML = favorites
    .map(
      (item) => `
      <div class="shelf-chip" role="listitem">
        <img src="${item.image}" alt="${escapeHTML(item.title)}" />
        <span>${escapeHTML(item.title)}</span>
        <button data-id="${item.id}" aria-label="Remove ${escapeHTML(item.title)} from preferences">✕</button>
      </div>`
    )
    .join("");

  preferencesEmpty.hidden = favorites.length !== 0;

  preferencesShelf.querySelectorAll("button[data-id]").forEach((btn) => {
    btn.addEventListener("click", () => toggleFavorite(Number(btn.dataset.id)));
  });

  statFavorites.textContent = favorites.length;
}

/** Adds or removes an item from the favorites set, then re-renders affected UI. */
function toggleFavorite(id) {
  if (favoriteIds.has(id)) {
    favoriteIds.delete(id);
  } else {
    favoriteIds.add(id);
  }
  renderCatalog();
  renderShelf();
}

/* ----------------------------------------------------------------------------
   6. THE RECOMMENDATION ENGINE (Content-Based Filtering)
   ----------------------------------------------------------------------------

   HOW IT WORKS
   ------------
   1. Build a "preference profile": the UNION of every genre/tag across all
      items the user has added to their shelf.
   2. For every OTHER item in the catalog (excluding ones already favorited),
      compare its genre set against the preference profile using the
      JACCARD SIMILARITY coefficient:

          similarity = |A ∩ B| / |A ∪ B|

      where A = the user's combined preference genres, and B = the
      candidate item's genres. This gives a score between 0 (no overlap)
      and 1 (identical genre sets), which we convert to a percentage.

   3. Sort all candidates by similarity score (highest first) and return
      the top N as recommendations, along with the specific genres that
      overlapped — so we can show *why* each item was recommended.
   -------------------------------------------------------------------------- */

/** Computes Jaccard similarity between two arrays of genre strings. */
function jaccardSimilarity(genresA, genresB) {
  const setA = new Set(genresA);
  const setB = new Set(genresB);
  const intersection = [...setA].filter((g) => setB.has(g));
  const union = new Set([...setA, ...setB]);
  if (union.size === 0) return { score: 0, matched: [] };
  return { score: intersection.length / union.size, matched: intersection };
}

/**
 * Generates the top recommendations for the current favorites.
 * @param {number} topN - how many recommendations to return
 * @returns {Array<{item: object, score: number, matched: string[]}>}
 */
function generateRecommendations(topN = 8) {
  const favorites = [...favoriteIds].map(getItemById).filter(Boolean);
  if (favorites.length === 0) return [];

  // Step 1: build the combined preference genre profile.
  const preferenceGenres = new Set();
  favorites.forEach((item) => item.genres.forEach((g) => preferenceGenres.add(g)));
  const profile = [...preferenceGenres];

  // Step 2: score every non-favorited item against that profile.
  const scored = ITEMS.filter((item) => !favoriteIds.has(item.id)).map((item) => {
    const { score, matched } = jaccardSimilarity(profile, item.genres);
    return { item, score, matched };
  });

  // Step 3: sort by descending similarity and take the top N.
  return scored
    .filter((entry) => entry.score > 0) // only recommend items with real overlap
    .sort((a, b) => b.score - a.score)
    .slice(0, topN);
}

/* ----------------------------------------------------------------------------
   7. RENDERING — RECOMMENDATIONS
   -------------------------------------------------------------------------- */

function buildRecCard(entry) {
  const { item, score, matched } = entry;
  const pct = Math.round(score * 100);
  const circumference = 169.6; // 2 * PI * 27 (matches the SVG radius in CSS)
  const offset = circumference - (pct / 100) * circumference;

  const matchedTags = matched
    .map((g) => `<span class="tag-stub matched">${escapeHTML(g)}</span>`)
    .join("");

  return `
    <article class="item-card rec-card" role="listitem">
      <div class="match-badge">
        <svg class="match-ring" viewBox="0 0 64 64">
          <circle class="ring-track" cx="32" cy="32" r="27"></circle>
          <circle class="ring-fill" cx="32" cy="32" r="27" style="stroke-dashoffset:${offset}"></circle>
        </svg>
        <span class="match-pct">${pct}%</span>
      </div>
      <img class="item-thumb" src="${item.image}" alt="${escapeHTML(item.title)}" loading="lazy" />
      <div class="item-body">
        <span class="item-eyebrow">${escapeHTML(item.category)}</span>
        <h3 class="item-title">${escapeHTML(item.title)}</h3>
        <p class="item-desc">${escapeHTML(item.description)}</p>
        <div class="tag-row">${matchedTags}</div>
        <p class="match-genres">${pct}% Match &middot; Similar Genres: ${matched.join(", ") || "—"}</p>
        <div class="item-footer">
          <span class="item-rating">${formatRating(item)}</span>
          <button class="add-btn" data-id="${item.id}">Add to Preferences</button>
        </div>
      </div>
    </article>
  `;
}

function renderRecommendations() {
  recGrid.innerHTML = currentRecommendations.map(buildRecCard).join("");
  recEmpty.hidden = currentRecommendations.length !== 0;
  statRecs.textContent = currentRecommendations.length;

  recGrid.querySelectorAll(".add-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      toggleFavorite(Number(btn.dataset.id));
      // Re-run recommendations since the preference profile just changed.
      handleGenerateClick();
    });
  });
}

/** Handles the "Generate Recommendations" button, including the loading animation. */
function handleGenerateClick() {
  if (favoriteIds.size === 0) {
    currentRecommendations = [];
    renderRecommendations();
    recEmpty.textContent = "Add a few favorites from the catalog above before generating recommendations.";
    recEmpty.hidden = false;
    return;
  }

  loadingState.hidden = false;
  recGrid.innerHTML = "";
  recEmpty.hidden = true;

  // Small artificial delay so the "calculating similarity" state is visible —
  // the computation itself is instant for a catalog this size.
  setTimeout(() => {
    currentRecommendations = generateRecommendations(8);
    loadingState.hidden = true;
    renderRecommendations();
    if (currentRecommendations.length === 0) {
      recEmpty.textContent = "No close matches found — try adding a more varied set of preferences.";
      recEmpty.hidden = false;
    }
  }, 500);
}

/* ----------------------------------------------------------------------------
   8. DASHBOARD / STATS
   -------------------------------------------------------------------------- */

function updateDashboard() {
  statTotal.textContent = ITEMS.length;
  statFavorites.textContent = favoriteIds.size;
  statRecs.textContent = currentRecommendations.length;
}

/* ----------------------------------------------------------------------------
   9. THEME (dark / light mode) — persisted via localStorage
   -------------------------------------------------------------------------- */

function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
  try {
    localStorage.setItem("curatia_theme", theme);
  } catch (e) { /* localStorage unavailable — ignore */ }
}

function loadTheme() {
  let theme = "light";
  try {
    theme = localStorage.getItem("curatia_theme") || "light";
  } catch (e) { /* ignore */ }
  applyTheme(theme);
}

themeToggle.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme");
  applyTheme(current === "dark" ? "light" : "dark");
});

/* ----------------------------------------------------------------------------
   10. EVENT WIRING — toolbar
   -------------------------------------------------------------------------- */

searchInput.addEventListener("input", (e) => {
  filters.search = e.target.value;
  renderCatalog();
});

categoryFilter.addEventListener("change", (e) => {
  filters.category = e.target.value;
  renderCatalog();
});

genreFilter.addEventListener("change", (e) => {
  filters.genre = e.target.value;
  renderCatalog();
});

sortSelect.addEventListener("change", (e) => {
  filters.sort = e.target.value;
  renderCatalog();
});

generateBtn.addEventListener("click", handleGenerateClick);

resetBtn.addEventListener("click", () => {
  favoriteIds.clear();
  currentRecommendations = [];
  renderCatalog();
  renderShelf();
  renderRecommendations();
  recEmpty.textContent = "No recommendations yet. Select some preferences and click \"Generate Recommendations\".";
  recEmpty.hidden = false;
});

clearRecsBtn.addEventListener("click", () => {
  currentRecommendations = [];
  renderRecommendations();
  recEmpty.textContent = "No recommendations yet. Select some preferences and click \"Generate Recommendations\".";
  recEmpty.hidden = false;
});

/* ----------------------------------------------------------------------------
   11. INIT
   -------------------------------------------------------------------------- */

function init() {
  loadTheme();
  populateGenreFilter();
  renderCatalog();
  renderShelf();
  updateDashboard();
}

init();
