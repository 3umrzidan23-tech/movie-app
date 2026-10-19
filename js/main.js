/* =========================================================
   CineScope — application logic
   ========================================================= */

(() => {
  "use strict";

  const {
    API_BASE,
    IMG_BASE,
    POSTER_SIZE,
    POSTER_SIZE_LARGE,
    BACKDROP_SIZE,
    CACHE_TTL,
    CATEGORIES,
  } = CONFIG;

  const STORAGE = {
    watchlist: "cinescope:watchlist",
    cache: "cinescope:cache:",
  };

  const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

  /* ---------------- State ---------------- */

  const state = {
    mode: "category", // category | search | genre | watchlist
    category: "trending",
    lastCategory: "trending",
    genreId: null,
    genreName: "",
    query: "",
    sort: "default",
    page: 1,
    totalPages: 1,
    totalResults: 0,
    items: [],
    watchlist: loadWatchlist(),
    genres: [],
    loading: false,
    requestId: 0,
    detailId: null,
    detailMovie: null,
  };

  /* ---------------- DOM ---------------- */

  const els = {
    moviesRow: document.getElementById("moviesRow"),
    stateBox: document.getElementById("stateBox"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    loadMoreSpinner: document.getElementById("loadMoreSpinner"),
    sectionTitle: document.getElementById("sectionTitle"),
    resultsInfo: document.getElementById("resultsInfo"),
    searchInput: document.getElementById("searchInput"),
    clearSearch: document.getElementById("clearSearch"),
    sortSelect: document.getElementById("sortSelect"),
    genreChips: document.getElementById("genreChips"),
    menuBtn: document.getElementById("menuBtn"),
    brandLink: document.getElementById("brandLink"),
    offcanvas: document.getElementById("offcanvasNavbar"),
    sidebarWatchlist: document.getElementById("sidebarWatchlist"),
    topWatchlistBtn: document.getElementById("topWatchlistBtn"),
    watchlistCount: document.getElementById("watchlistCount"),
    watchlistCountTop: document.getElementById("watchlistCountTop"),
    watchlistNavCount: document.getElementById("watchlistNavCount"),
    movieModal: document.getElementById("movieModal"),
    movieModalBody: document.getElementById("movieModalBody"),
    contactModal: document.getElementById("contactModal"),
    contactForm: document.getElementById("contactForm"),
    contactName: document.getElementById("contactName"),
    contactEmail: document.getElementById("contactEmail"),
    contactMessage: document.getElementById("contactMessage"),
    toastContainer: document.getElementById("toastContainer"),
    backToTop: document.getElementById("backToTop"),
  };

  let searchTimer = null;

  /* ---------------- Helpers ---------------- */

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => {
      const map = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
      return map[char];
    });
  }

  function imageUrl(path, size = POSTER_SIZE) {
    return path ? `${IMG_BASE}/${size}${path}` : "./images/placeholder.svg";
  }

  function yearOf(date) {
    return date ? String(date).slice(0, 4) : "TBA";
  }

  function formatVotes(votes) {
    const number = Number(votes) || 0;
    if (number >= 1_000_000) return `${(number / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
    if (number >= 1_000) return `${(number / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
    return String(number);
  }

  function formatNumber(number) {
    return Number(number || 0).toLocaleString("en-US");
  }

  function formatRuntime(minutes) {
    const total = Number(minutes) || 0;
    if (!total) return "";
    const hours = Math.floor(total / 60);
    const mins = total % 60;
    return hours ? `${hours}h ${mins}m` : `${mins}m`;
  }

  function ratingClass(rating) {
    const value = Number(rating) || 0;
    if (value <= 0) return "none";
    if (value >= 7) return "high";
    if (value >= 5) return "mid";
    return "low";
  }

  function ratingText(rating) {
    return Number(rating) > 0 ? Number(rating).toFixed(1) : "NR";
  }

  function getStars(rating) {
    const filled = Math.round((Number(rating) || 0) / 2);
    return Array.from({ length: 5 }, (_, index) => {
      const style = index < filled ? "solid" : "regular";
      return `<i class="fa-${style} fa-star" aria-hidden="true"></i>`;
    }).join("");
  }

  function normalizeMovie(raw = {}) {
    return {
      id: Number(raw.id) || 0,
      title: raw.title || raw.name || "Untitled",
      overview: raw.overview || "",
      date: raw.release_date || raw.first_air_date || "",
      rating: Number(raw.vote_average) || 0,
      votes: Number(raw.vote_count) || 0,
      posterPath: raw.poster_path || "",
      backdropPath: raw.backdrop_path || "",
    };
  }

  function normalizeStoredMovie(raw = {}) {
    return {
      id: Number(raw.id) || 0,
      title: raw.title || "Untitled",
      overview: raw.overview || "",
      date: raw.date || raw.release_date || "",
      rating: Number(raw.rating ?? raw.vote_average) || 0,
      votes: Number(raw.votes ?? raw.vote_count) || 0,
      posterPath: raw.posterPath ?? raw.poster_path ?? "",
      backdropPath: raw.backdropPath ?? raw.backdrop_path ?? "",
    };
  }

  /* ---------------- Local storage ---------------- */

  function loadWatchlist() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE.watchlist) || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

      const clean = {};
      Object.values(parsed).forEach((item) => {
        if (item && Number(item.id)) clean[item.id] = normalizeStoredMovie(item);
      });
      return clean;
    } catch {
      return {};
    }
  }

  function persistWatchlist() {
    try {
      localStorage.setItem(STORAGE.watchlist, JSON.stringify(state.watchlist));
    } catch {
      showToast("Could not save your list — storage is full or blocked.", "error");
    }
    updateWatchlistCounts();
  }

  function updateWatchlistCounts() {
    const count = Object.keys(state.watchlist).length;
    [els.watchlistCount, els.watchlistCountTop, els.watchlistNavCount].forEach((node) => {
      if (node) node.textContent = String(count);
    });
    if (els.sidebarWatchlist) {
      els.sidebarWatchlist.setAttribute(
        "aria-label",
        `Open My List, ${count} saved movie${count === 1 ? "" : "s"}`
      );
    }
  }

  function findMovie(id) {
    const numericId = Number(id);
    if (state.detailMovie && state.detailMovie.id === numericId) return state.detailMovie;
    return state.items.find((movie) => movie.id === numericId) || state.watchlist[numericId] || null;
  }

  /* ---------------- API ---------------- */

  function readCache(key) {
    try {
      const raw = sessionStorage.getItem(key);
      if (!raw) return null;

      const entry = JSON.parse(raw);
      if (!entry || typeof entry.time !== "number" || Date.now() - entry.time > CACHE_TTL) {
        sessionStorage.removeItem(key);
        return null;
      }
      return entry.data;
    } catch {
      return null;
    }
  }

  function writeCache(key, data) {
    try {
      sessionStorage.setItem(key, JSON.stringify({ time: Date.now(), data }));
    } catch {
      /* Session storage can be full or disabled — caching is optional. */
    }
  }

  async function apiGet(path, params = {}) {
    const url = new URL(API_BASE, window.location.origin);
    url.searchParams.set("path", path);
    if (!url.searchParams.has("language")) url.searchParams.set("language", "en-US");

    Object.entries(params).forEach(([key, value]) => {
      if (value !== undefined && value !== null && value !== "") {
        url.searchParams.set(key, String(value));
      }
    });

    const cacheKey = `${STORAGE.cache}${url.pathname}${url.search}`;
    const cached = readCache(cacheKey);
    if (cached) return cached;

    let response;
    try {
      response = await fetch(url.toString(), { headers: { Accept: "application/json" } });
    } catch {
      throw new Error("Network error. Check your internet connection and try again.");
    }

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const apiMessage =
        data && typeof data.status_message === "string" ? data.status_message : "";

      if (response.status === 401) throw new Error("The movie database rejected the API key.");
      if (response.status === 404) throw new Error(apiMessage || "We couldn't find that movie.");
      if (response.status === 429) throw new Error("Too many requests. Please wait a moment and try again.");
      throw new Error(apiMessage || `The movie database returned an error (${response.status}).`);
    }

    if (!data) throw new Error("The movie database returned an empty response.");

    writeCache(cacheKey, data);
    return data;
  }

  function fetchPage(page) {
    if (state.mode === "search") {
      return apiGet("/search/movie", { query: state.query, page, include_adult: false });
    }

    if (state.mode === "genre") {
      return apiGet("/discover/movie", {
        with_genres: state.genreId,
        page,
        include_adult: false,
        sort_by: "popularity.desc",
      });
    }

    return apiGet(CATEGORIES[state.category].endpoint, { page });
  }

  /* ---------------- Rendering ---------------- */

  function skeletonCard() {
    return `
      <div class="col">
        <div class="skeleton-card" aria-hidden="true">
          <div class="skeleton-poster"></div>
          <div class="skeleton-body">
            <div class="skeleton-line"></div>
            <div class="skeleton-line short"></div>
          </div>
        </div>
      </div>`;
  }

  function renderSkeletons(count = 10) {
    els.moviesRow.innerHTML = Array.from({ length: count }, skeletonCard).join("");
  }

  function movieCard(movie) {
    const isSaved = Boolean(state.watchlist[movie.id]);
    const rating = ratingText(movie.rating);
    const overview = movie.overview || "No overview available for this movie yet.";

    return `
      <div class="col">
        <article class="movie-card" data-movie-id="${movie.id}">
          <div class="poster-wrap">
            <img
              src="${imageUrl(movie.posterPath, POSTER_SIZE)}"
              alt="${escapeHtml(movie.title)} poster"
              loading="lazy"
              decoding="async"
              width="342"
              height="513"
              onerror="this.onerror=null;this.src='./images/placeholder.svg'"
            />

            <button
              type="button"
              class="watch-btn ${isSaved ? "active" : ""}"
              data-watchlist="${movie.id}"
              aria-pressed="${isSaved}"
              aria-label="${isSaved ? "Remove from" : "Add to"} My List: ${escapeHtml(movie.title)}"
            >
              <i class="${isSaved ? "fa-solid" : "fa-regular"} fa-heart" aria-hidden="true"></i>
            </button>

            <span class="rating-badge ${ratingClass(movie.rating)}">
              <i class="fa-solid fa-star" aria-hidden="true"></i>${rating}
            </span>

            <div class="card-overlay" aria-hidden="true">
              <p class="overlay-overview">${escapeHtml(overview)}</p>
              <span class="overlay-hint">View details <i class="fa-solid fa-arrow-right"></i></span>
            </div>
          </div>

          <div class="card-body-custom">
            <h2 class="movie-title" title="${escapeHtml(movie.title)}">
              <a class="movie-link" href="?movie=${movie.id}">${escapeHtml(movie.title)}</a>
            </h2>
            <div class="movie-meta">
              <span>${escapeHtml(yearOf(movie.date))}</span>
              <span class="score">
                <i class="fa-solid fa-star" aria-hidden="true"></i> ${rating}
                ${movie.votes ? `<span class="votes">(${formatVotes(movie.votes)})</span>` : ""}
              </span>
            </div>
          </div>
        </article>
      </div>`;
  }

  function getSortedItems() {
    const items = [...state.items];

    if (state.sort === "rating") {
      items.sort((a, b) => b.rating - a.rating || b.votes - a.votes);
    } else if (state.sort === "newest") {
      items.sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    }

    return items;
  }

  function renderMovies() {
    const items = getSortedItems();
    if (!items.length) {
      els.moviesRow.innerHTML = "";
      return;
    }
    els.moviesRow.innerHTML = items.map(movieCard).join("");
  }

  function updateResultsInfo() {
    const shown = state.items.length;
    const total = state.totalResults || shown;
    let text = "";

    if (state.mode === "search") {
      text = `${shown} result${shown === 1 ? "" : "s"} for “${state.query}”`;
    } else if (state.mode === "genre") {
      text = `${shown}${total > shown ? ` of ${formatNumber(total)}` : ""} ${state.genreName} movie${shown === 1 ? "" : "s"}`;
    } else if (state.mode === "watchlist") {
      text = `${shown} saved movie${shown === 1 ? "" : "s"}`;
    } else {
      text = `${shown}${total > shown ? ` of ${formatNumber(total)}` : ""} movie${shown === 1 ? "" : "s"} loaded`;
    }

    els.resultsInfo.textContent = text;
  }

  function getSectionTitle() {
    if (state.mode === "search") return "Search Results";
    if (state.mode === "genre") return `${state.genreName} Movies`;
    if (state.mode === "watchlist") return "My List";
    return CATEGORIES[state.category]?.title || "Movies";
  }

  function updateHeaderMeta() {
    const title = getSectionTitle();
    els.sectionTitle.textContent = title;
    document.title = `${title} · CineScope`;
    els.resultsInfo.textContent = "";
    updateNavActive();
    updateChips();
  }

  function updateNavActive() {
    els.offcanvas.querySelectorAll("[data-category]").forEach((link) => {
      const isActive = state.mode === "category" && link.dataset.category === state.category;
      link.classList.toggle("active", isActive);
      if (isActive) link.setAttribute("aria-current", "page");
      else link.removeAttribute("aria-current");
    });

    const watchLink = els.offcanvas.querySelector('[data-action="watchlist"]');
    if (watchLink) {
      const isActive = state.mode === "watchlist";
      watchLink.classList.toggle("active", isActive);
      if (isActive) watchLink.setAttribute("aria-current", "page");
      else watchLink.removeAttribute("aria-current");
    }
  }

  function updateChips() {
    els.genreChips.querySelectorAll(".chip").forEach((chip) => {
      const value = chip.dataset.genre;
      const isActive = value
        ? state.mode === "genre" && Number(value) === Number(state.genreId)
        : state.mode === "category";
      chip.classList.toggle("active", isActive);
      chip.setAttribute("aria-pressed", String(isActive));
    });
  }

  function setLoadMoreVisibility() {
    const canLoadMore =
      state.mode !== "watchlist" &&
      state.items.length > 0 &&
      state.page < state.totalPages;

    els.loadMoreBtn.classList.toggle("d-none", !canLoadMore);
  }

  function setLoadMoreBusy(isBusy) {
    els.loadMoreBtn.disabled = isBusy;
    els.loadMoreSpinner.classList.toggle("d-none", !isBusy);
  }

  /* ---------------- Data loading ---------------- */

  async function loadMovies({ append = false } = {}) {
    if (state.mode === "watchlist") {
      renderWatchlist();
      return;
    }

    if (append && (state.loading || state.page >= state.totalPages)) return;

    const requestId = ++state.requestId;
    const pageToLoad = append ? state.page + 1 : 1;
    state.loading = true;

    if (append) {
      setLoadMoreBusy(true);
    } else {
      state.page = 1;
      state.totalPages = 1;
      state.items = [];
      renderSkeletons();
      showStateBox(null);
      els.resultsInfo.textContent = "Loading…";
      els.loadMoreBtn.classList.add("d-none");
    }

    try {
      const data = await fetchPage(pageToLoad);
      if (requestId !== state.requestId) return;

      const movies = (data.results || []).map(normalizeMovie).filter((movie) => movie.id);
      state.items = append ? [...state.items, ...movies] : movies;
      state.page = Number(data.page) || pageToLoad;
      state.totalPages = Math.min(Number(data.total_pages) || 1, 500);
      state.totalResults = Number(data.total_results) || state.items.length;

      if (!state.items.length) {
        els.moviesRow.innerHTML = "";
        showStateBox("empty");
        updateResultsInfo();
        return;
      }

      renderMovies();
      updateResultsInfo();
      setLoadMoreVisibility();
    } catch (error) {
      if (requestId !== state.requestId) return;

      console.error("Movie request failed:", error);

      if (append) {
        showToast(error.message || "Could not load more movies.", "error");
      } else {
        els.moviesRow.innerHTML = "";
        showStateBox("error", error.message || "Something went wrong while loading movies.");
        els.resultsInfo.textContent = "";
      }
    } finally {
      if (requestId === state.requestId) {
        state.loading = false;
        setLoadMoreBusy(false);
        setLoadMoreVisibility();
      }
    }
  }

  function renderWatchlist() {
    state.items = Object.values(state.watchlist).map(normalizeStoredMovie);
    state.page = 1;
    state.totalPages = 1;
    state.totalResults = state.items.length;

    els.loadMoreBtn.classList.add("d-none");

    if (!state.items.length) {
      els.moviesRow.innerHTML = "";
      showStateBox("watchlist-empty");
    } else {
      showStateBox(null);
      renderMovies();
    }

    updateResultsInfo();
  }

  function showStateBox(type, message = "") {
    if (!type) {
      els.stateBox.innerHTML = "";
      return;
    }

    if (type === "error") {
      els.stateBox.innerHTML = `
        <div class="state-box">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <h2>We couldn't load the movies</h2>
          <p>${escapeHtml(message || "Please check your connection and try again.")}</p>
          <button type="button" class="btn btn-accent" data-retry>
            <i class="fa-solid fa-rotate-right me-1" aria-hidden="true"></i>Try again
          </button>
        </div>`;
      return;
    }

    if (type === "watchlist-empty") {
      els.stateBox.innerHTML = `
        <div class="state-box">
          <i class="fa-regular fa-heart" aria-hidden="true"></i>
          <h2>Your list is empty</h2>
          <p>Tap the heart on any movie poster to save it here for later.</p>
          <button type="button" class="btn btn-accent" data-browse>
            <i class="fa-solid fa-fire me-1" aria-hidden="true"></i>Browse trending movies
          </button>
        </div>`;
      return;
    }

    els.stateBox.innerHTML = `
      <div class="state-box">
        <i class="fa-regular fa-face-frown" aria-hidden="true"></i>
        <h2>No movies found</h2>
        <p>Try a different search term, choose another genre, or browse the trending movies.</p>
        <button type="button" class="btn btn-accent" data-browse>
          <i class="fa-solid fa-fire me-1" aria-hidden="true"></i>Browse trending movies
        </button>
      </div>`;
  }

  /* ---------------- Genres ---------------- */

  function renderGenreChips() {
    const chips = ['<button type="button" class="chip" data-genre="">All</button>'];
    state.genres.forEach((genre) => {
      chips.push(
        `<button type="button" class="chip" data-genre="${genre.id}">${escapeHtml(genre.name)}</button>`
      );
    });
    els.genreChips.innerHTML = chips.join("");
    updateChips();
  }

  async function loadGenres() {
    try {
      const data = await apiGet("/genre/movie/list");
      state.genres = Array.isArray(data.genres) ? data.genres : [];
    } catch (error) {
      console.warn("Could not load genres:", error);
      state.genres = [];
    }
    renderGenreChips();
  }

  /* ---------------- Navigation ---------------- */

  function setCategory(category, { scroll = true } = {}) {
    if (!CATEGORIES[category]) return;

    state.mode = "category";
    state.category = category;
    state.lastCategory = category;
    state.genreId = null;
    state.genreName = "";
    state.query = "";

    clearSearchInput();
    updateHeaderMeta();
    loadMovies();
    closeOffcanvas();
    if (scroll) scrollToTop();
  }

  function selectGenre(genreId, genreName) {
    state.mode = "genre";
    state.genreId = genreId;
    state.genreName = genreName;
    state.query = "";

    clearSearchInput();
    updateHeaderMeta();
    loadMovies();
    closeOffcanvas();
    scrollToTop();
  }

  function showWatchlist() {
    state.mode = "watchlist";
    state.query = "";
    state.genreId = null;
    state.genreName = "";

    // Invalidate any in-flight movie request so it cannot overwrite this view.
    state.requestId += 1;
    state.loading = false;
    setLoadMoreBusy(false);

    clearSearchInput();
    updateHeaderMeta();
    renderWatchlist();
    closeOffcanvas();
    scrollToTop();
  }

  function clearSearchInput() {
    clearTimeout(searchTimer);
    els.searchInput.value = "";
    els.clearSearch.classList.add("d-none");
  }

  function scrollToTop() {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeOffcanvas() {
    const instance = bootstrap.Offcanvas.getInstance(els.offcanvas);
    if (instance) instance.hide();
  }

  /* ---------------- Search ---------------- */

  function onSearchInput() {
    const value = els.searchInput.value.trim();
    els.clearSearch.classList.toggle("d-none", value.length === 0);

    clearTimeout(searchTimer);

    if (!value) {
      if (state.mode === "search") setCategory(state.lastCategory);
      return;
    }

    if (value.length < 2) return;

    searchTimer = setTimeout(() => runSearch(value), 400);
  }

  function runSearch(value) {
    const query = String(value || "").trim();
    if (query.length < 2) return;
    if (state.mode === "search" && state.query === query) return;

    state.mode = "search";
    state.query = query;
    state.genreId = null;
    state.genreName = "";

    updateHeaderMeta();
    loadMovies();
    scrollToTop();
  }

  function clearSearch() {
    const wasSearching = state.mode === "search";
    clearSearchInput();

    if (wasSearching) {
      setCategory(state.lastCategory);
    } else {
      els.searchInput.focus();
    }
  }

  /* ---------------- Watchlist ---------------- */

  function toggleWatchlist(movie) {
    if (!movie || !movie.id) return;

    const wasSaved = Boolean(state.watchlist[movie.id]);

    if (wasSaved) {
      delete state.watchlist[movie.id];
    } else {
      state.watchlist[movie.id] = normalizeStoredMovie(movie);
    }

    persistWatchlist();
    syncWatchlistButtons(movie.id);
    updateDetailWatchButton();

    showToast(
      wasSaved ? `Removed “${movie.title}” from My List.` : `Added “${movie.title}” to My List.`,
      wasSaved ? "info" : "success"
    );

    if (state.mode === "watchlist") renderWatchlist();
  }

  function syncWatchlistButtons(movieId) {
    const isSaved = Boolean(state.watchlist[movieId]);

    document.querySelectorAll(`[data-watchlist="${movieId}"]`).forEach((button) => {
      button.classList.toggle("active", isSaved);
      button.setAttribute("aria-pressed", String(isSaved));
      button.innerHTML = `<i class="${isSaved ? "fa-solid" : "fa-regular"} fa-heart" aria-hidden="true"></i>`;

      const cardTitle = button.closest(".movie-card")?.querySelector(".movie-title")?.textContent;
      if (cardTitle) {
        button.setAttribute(
          "aria-label",
          `${isSaved ? "Remove from" : "Add to"} My List: ${cardTitle}`
        );
      }
    });
  }

  function updateDetailWatchButton() {
    const button = document.getElementById("detailWatchBtn");
    if (!button || !state.detailMovie) return;

    const isSaved = Boolean(state.watchlist[state.detailMovie.id]);
    button.classList.toggle("active", isSaved);
    button.setAttribute("aria-pressed", String(isSaved));
    button.innerHTML = `
      <i class="${isSaved ? "fa-solid" : "fa-regular"} fa-heart" aria-hidden="true"></i>
      ${isSaved ? "In My List" : "Add to My List"}`;
  }

  /* ---------------- Movie details ---------------- */

  function detailsLoader() {
    return `
      <div class="details-loader">
        <div class="spinner-border text-danger" role="status" aria-hidden="true"></div>
        <p>Loading movie details…</p>
      </div>`;
  }

  function pickTrailer(videos = []) {
    return (
      videos.find((video) => video.site === "YouTube" && video.type === "Trailer" && video.official) ||
      videos.find((video) => video.site === "YouTube" && video.type === "Trailer") ||
      videos.find((video) => video.site === "YouTube" && video.type === "Teaser") ||
      videos.find((video) => video.site === "YouTube") ||
      null
    );
  }

  function similarCard(movie) {
    return `
      <button
        type="button"
        class="similar-card"
        data-similar-id="${movie.id}"
        aria-label="Open details for ${escapeHtml(movie.title)}"
      >
        <span class="similar-poster">
          <img
            src="${imageUrl(movie.posterPath, POSTER_SIZE)}"
            alt=""
            loading="lazy"
            decoding="async"
            onerror="this.onerror=null;this.src='./images/placeholder.svg'"
          />
          <span class="rating-badge ${ratingClass(movie.rating)}">
            <i class="fa-solid fa-star" aria-hidden="true"></i>${ratingText(movie.rating)}
          </span>
        </span>
        <span class="similar-title">${escapeHtml(movie.title)}</span>
      </button>`;
  }

  async function openDetails(rawId) {
    const movieId = Number(rawId);
    if (!movieId) return;

    state.detailId = movieId;
    state.detailMovie = null;

    const modal = bootstrap.Modal.getOrCreateInstance(els.movieModal);
    els.movieModalBody.innerHTML = detailsLoader();
    modal.show();
    els.movieModal.querySelector(".modal-body").scrollTop = 0;
    setMovieParam(movieId);

    try {
      const data = await apiGet(`/movie/${movieId}`, {
        append_to_response: "credits,videos,recommendations",
      });

      if (state.detailId !== movieId) return;
      renderDetails(data);
    } catch (error) {
      if (state.detailId !== movieId) return;
      console.error("Details request failed:", error);

      els.movieModalBody.innerHTML = `
        <div class="state-box m-3">
          <i class="fa-solid fa-triangle-exclamation" aria-hidden="true"></i>
          <h2>Couldn't load this movie</h2>
          <p>${escapeHtml(error.message || "Please try again.")}</p>
          <button type="button" class="btn btn-accent" data-detail-retry="${movieId}">
            <i class="fa-solid fa-rotate-right me-1" aria-hidden="true"></i>Try again
          </button>
        </div>`;
    }
  }

  function renderDetails(data) {
    const movie = normalizeMovie(data);
    state.detailMovie = movie;

    const backdrop = imageUrl(data.backdrop_path || data.poster_path, BACKDROP_SIZE);
    const poster = imageUrl(data.poster_path, POSTER_SIZE_LARGE);
    const genres = Array.isArray(data.genres) ? data.genres : [];
    const runtime = formatRuntime(data.runtime);
    const votes = Number(data.vote_count) || 0;
    const trailer = pickTrailer(Array.isArray(data.videos?.results) ? data.videos.results : []);
    const crew = Array.isArray(data.credits?.crew) ? data.credits.crew : [];
    const cast = Array.isArray(data.credits?.cast) ? data.credits.cast.slice(0, 8) : [];
    const recommendations = Array.isArray(data.recommendations?.results)
      ? data.recommendations.results.slice(0, 6).map(normalizeMovie).filter((item) => item.id)
      : [];
    const director = crew.find((person) => person.job === "Director")?.name || "";

    els.movieModalBody.innerHTML = `
      <div
        class="modal-hero"
        style="background-image: url('${backdrop}')"
        role="img"
        aria-label="${escapeHtml(movie.title)} backdrop"
      ></div>

      <div class="details-content">
        <div class="details-poster">
          <img
            src="${poster}"
            alt="${escapeHtml(movie.title)} poster"
            onerror="this.onerror=null;this.src='./images/placeholder.svg'"
          />
        </div>

        <div class="details-info">
          <h2 class="details-title" id="movieModalTitle">${escapeHtml(movie.title)}</h2>
          ${data.tagline ? `<p class="tagline">“${escapeHtml(data.tagline)}”</p>` : ""}

          <div class="meta-chips">
            <span class="meta-chip"><i class="fa-regular fa-calendar" aria-hidden="true"></i>${escapeHtml(yearOf(movie.date))}</span>
            ${runtime ? `<span class="meta-chip"><i class="fa-regular fa-clock" aria-hidden="true"></i>${runtime}</span>` : ""}
            <span class="meta-chip meta-rating ${ratingClass(movie.rating)}">
              <i class="fa-solid fa-star" aria-hidden="true"></i>${ratingText(movie.rating)} / 10
            </span>
            <span class="meta-chip">${votes ? `${formatVotes(votes)} votes` : "No votes yet"}</span>
          </div>

          ${genres.length ? `<p class="details-genres">${genres.map((genre) => `<span class="cast-chip">${escapeHtml(genre.name)}</span>`).join("")}</p>` : ""}

          <div class="stars-row">
            <span aria-hidden="true">${getStars(movie.rating)}</span>
            <span><strong>${ratingText(movie.rating)}</strong> / 10 · ${votes ? `${formatVotes(votes)} ratings` : "Not rated yet"}</span>
          </div>

          <p class="details-overview">${escapeHtml(data.overview || "No overview available for this movie yet.")}</p>

          <div class="details-actions">
            ${trailer ? `<button type="button" class="btn btn-accent" data-trailer="${escapeHtml(trailer.key)}"><i class="fa-solid fa-play me-1" aria-hidden="true"></i>Watch Trailer</button>` : ""}
            <button
              type="button"
              class="btn btn-outline-light ${state.watchlist[movie.id] ? "active" : ""}"
              id="detailWatchBtn"
              data-detail-watch="${movie.id}"
              aria-pressed="${Boolean(state.watchlist[movie.id])}"
            >
              <i class="${state.watchlist[movie.id] ? "fa-solid" : "fa-regular"} fa-heart" aria-hidden="true"></i>
              ${state.watchlist[movie.id] ? "In My List" : "Add to My List"}
            </button>
            <button type="button" class="btn btn-outline-light" data-share>
              <i class="fa-solid fa-share-nodes me-1" aria-hidden="true"></i>Share
            </button>
          </div>

          <div class="trailer-area" id="trailerArea"></div>

          <div class="details-credits">
            ${director ? `<p><span>Director:</span> ${escapeHtml(director)}</p>` : ""}
            ${cast.length ? `<p><span>Cast:</span> ${cast.map((person) => `<span class="cast-chip">${escapeHtml(person.name)}</span>`).join("")}</p>` : ""}
          </div>
        </div>
      </div>

      ${
        recommendations.length
          ? `<div class="details-section">
               <h3>More like this</h3>
               <div class="similar-grid">${recommendations.map(similarCard).join("")}</div>
             </div>`
          : ""
      }`;
  }

  function playTrailer(videoKey) {
    const area = document.getElementById("trailerArea");
    if (!area || !videoKey) return;

    area.innerHTML = `
      <iframe
        src="https://www.youtube.com/embed/${encodeURIComponent(videoKey)}?autoplay=1&rel=0"
        title="Movie trailer"
        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
        allowfullscreen
      ></iframe>`;

    area.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function setMovieParam(movieId) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("movie", String(movieId));
      window.history.replaceState(null, "", url);
    } catch {
      /* History API is optional. */
    }
  }

  function removeMovieParam() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("movie");
      const next = `${url.pathname}${url.search}${url.hash}`;
      window.history.replaceState(null, "", next);
    } catch {
      /* History API is optional. */
    }
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text);
    }

    return new Promise((resolve, reject) => {
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.select();

      try {
        document.execCommand("copy") ? resolve() : reject(new Error("Copy failed"));
      } catch (error) {
        reject(error);
      } finally {
        textarea.remove();
      }
    });
  }

  function shareCurrent() {
    if (!state.detailMovie) return;

    const url = new URL(window.location.href);
    url.searchParams.set("movie", String(state.detailMovie.id));

    const shareData = {
      title: `${state.detailMovie.title} · CineScope`,
      text: state.detailMovie.overview?.slice(0, 120) || "Check out this movie on CineScope.",
      url: url.toString(),
    };

    if (navigator.share) {
      navigator.share(shareData).catch(() => {
        /* The user cancelled the share sheet. */
      });
      return;
    }

    copyText(shareData.url)
      .then(() => showToast("Movie link copied to clipboard.", "success"))
      .catch(() => showToast("Could not copy the link.", "error"));
  }

  /* ---------------- Toasts ---------------- */

  function showToast(message, type = "success") {
    const icon =
      type === "error" ? "fa-circle-exclamation" : type === "info" ? "fa-circle-info" : "fa-circle-check";

    const toastEl = document.createElement("div");
    toastEl.className = "toast align-items-center border-0";
    toastEl.setAttribute("role", "status");
    toastEl.setAttribute("aria-live", "polite");
    toastEl.setAttribute("aria-atomic", "true");
    toastEl.innerHTML = `
      <div class="d-flex">
        <div class="toast-body">
          <i class="fa-solid ${icon} me-2" aria-hidden="true"></i>${escapeHtml(message)}
        </div>
        <button type="button" class="btn-close btn-close-white me-2 m-auto" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>`;

    els.toastContainer.appendChild(toastEl);
    const toast = new bootstrap.Toast(toastEl, { delay: 3200 });
    toastEl.addEventListener("hidden.bs.toast", () => toastEl.remove());
    toast.show();
  }

  /* ---------------- Contact form ---------------- */

  function setFieldError(input, message = "") {
    const errorEl = document.getElementById(`${input.id}Error`);
    input.classList.toggle("is-invalid", Boolean(message));
    if (errorEl) errorEl.textContent = message;
  }

  function openContactModal() {
    const showModal = () => bootstrap.Modal.getOrCreateInstance(els.contactModal).show();
    const offcanvas = bootstrap.Offcanvas.getInstance(els.offcanvas);

    if (offcanvas && els.offcanvas.classList.contains("show")) {
      els.offcanvas.addEventListener("hidden.bs.offcanvas", showModal, { once: true });
      offcanvas.hide();
      return;
    }

    showModal();
  }

  function onContactSubmit(event) {
    event.preventDefault();

    const name = els.contactName.value.trim();
    const email = els.contactEmail.value.trim();
    const message = els.contactMessage.value.trim();
    let valid = true;

    if (name.length < 2) {
      setFieldError(els.contactName, "Please enter your name (at least 2 characters).");
      valid = false;
    } else {
      setFieldError(els.contactName);
    }

    if (!email) {
      setFieldError(els.contactEmail, "Please enter your email address.");
      valid = false;
    } else if (!EMAIL_RE.test(email)) {
      setFieldError(els.contactEmail, "Please enter a valid email address.");
      valid = false;
    } else {
      setFieldError(els.contactEmail);
    }

    if (message.length < 10) {
      setFieldError(els.contactMessage, "Please write a message of at least 10 characters.");
      valid = false;
    } else {
      setFieldError(els.contactMessage);
    }

    if (!valid) {
      els.contactForm.querySelector(".is-invalid")?.focus();
      return;
    }

    els.contactForm.reset();
    [els.contactName, els.contactEmail, els.contactMessage].forEach((input) => setFieldError(input));

    bootstrap.Modal.getInstance(els.contactModal)?.hide();
    showToast("Thanks! Your message has been received.", "success");
  }

  /* ---------------- Event handlers ---------------- */

  function onGenreClick(event) {
    const chip = event.target.closest("[data-genre]");
    if (!chip) return;

    const value = chip.dataset.genre;

    if (!value) {
      setCategory(state.lastCategory);
      return;
    }

    const genre = state.genres.find((item) => String(item.id) === value);
    selectGenre(Number(value), genre?.name || "Genre");
  }

  function onMovieClick(event) {
    const watchButton = event.target.closest("[data-watchlist]");
    if (watchButton) {
      const movie = findMovie(watchButton.dataset.watchlist);
      if (movie) toggleWatchlist(movie);
      return;
    }

    const card = event.target.closest("[data-movie-id]");
    if (card) {
      // Let Ctrl/Cmd/Shift-click behave like a normal link (open in a new tab).
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

      event.preventDefault();
      openDetails(card.dataset.movieId);
    }
  }

  function onStateAction(event) {
    if (event.target.closest("[data-retry]")) {
      loadMovies();
      return;
    }

    if (event.target.closest("[data-browse]")) {
      setCategory("trending");
    }
  }

  function onModalClick(event) {
    const target = event.target;

    const similar = target.closest("[data-similar-id]");
    if (similar) {
      openDetails(similar.dataset.similarId);
      return;
    }

    const trailerButton = target.closest("[data-trailer]");
    if (trailerButton) {
      playTrailer(trailerButton.dataset.trailer);
      return;
    }

    if (target.closest("[data-detail-watch]") && state.detailMovie) {
      toggleWatchlist(state.detailMovie);
      return;
    }

    if (target.closest("[data-share]")) {
      shareCurrent();
      return;
    }

    const retryButton = target.closest("[data-detail-retry]");
    if (retryButton) openDetails(retryButton.dataset.detailRetry);
  }

  function onModalHidden() {
    const area = document.getElementById("trailerArea");
    if (area) area.innerHTML = "";

    state.detailId = null;
    state.detailMovie = null;
    removeMovieParam();
  }

  /* ---------------- Binding ---------------- */

  function bindEvents() {
    els.menuBtn.addEventListener("click", () => {
      bootstrap.Offcanvas.getOrCreateInstance(els.offcanvas).show();
    });

    els.offcanvas.addEventListener("show.bs.offcanvas", () => {
      els.menuBtn.setAttribute("aria-expanded", "true");
    });

    els.offcanvas.addEventListener("hide.bs.offcanvas", () => {
      els.menuBtn.setAttribute("aria-expanded", "false");
    });

    els.brandLink.addEventListener("click", (event) => {
      event.preventDefault();
      setCategory("trending");
    });

    els.offcanvas.querySelectorAll("[data-category]").forEach((link) => {
      link.addEventListener("click", (event) => {
        event.preventDefault();
        setCategory(link.dataset.category);
      });
    });

    els.offcanvas.querySelector('[data-action="watchlist"]')?.addEventListener("click", (event) => {
      event.preventDefault();
      showWatchlist();
    });

    els.sidebarWatchlist.addEventListener("click", showWatchlist);
    els.topWatchlistBtn.addEventListener("click", showWatchlist);

    document.querySelectorAll(".js-open-contact").forEach((button) => {
      button.addEventListener("click", openContactModal);
    });

    els.searchInput.addEventListener("input", onSearchInput);

    els.searchInput.addEventListener("keydown", (event) => {
      if (event.key === "Enter") {
        event.preventDefault();
        clearTimeout(searchTimer);

        const value = els.searchInput.value.trim();
        if (value.length >= 2) runSearch(value);
        else if (!value) setCategory(state.lastCategory);
      }

      if (event.key === "Escape") {
        event.preventDefault();
        clearSearch();
      }
    });

    els.clearSearch.addEventListener("click", clearSearch);

    els.sortSelect.addEventListener("change", () => {
      state.sort = els.sortSelect.value;
      renderMovies();
      updateResultsInfo();
    });

    els.genreChips.addEventListener("click", onGenreClick);
    els.moviesRow.addEventListener("click", onMovieClick);
    els.stateBox.addEventListener("click", onStateAction);
    els.loadMoreBtn.addEventListener("click", () => loadMovies({ append: true }));

    els.movieModalBody.addEventListener("click", onModalClick);
    els.movieModal.addEventListener("hidden.bs.modal", onModalHidden);

    els.contactForm.addEventListener("submit", onContactSubmit);

    [els.contactName, els.contactEmail, els.contactMessage].forEach((input) => {
      input.addEventListener("input", () => setFieldError(input));
    });

    [els.movieModal, els.contactModal].forEach((modal) => {
      modal.addEventListener("hide.bs.modal", () => {
        if (modal.contains(document.activeElement)) document.activeElement.blur();
      });
    });

    els.backToTop.addEventListener("click", scrollToTop);
    window.addEventListener(
      "scroll",
      () => {
        els.backToTop.classList.toggle("show", window.scrollY > 450);
      },
      { passive: true }
    );
  }

  /* ---------------- Init ---------------- */

  function init() {
    bindEvents();
    updateWatchlistCounts();
    updateHeaderMeta();
    loadGenres();
    loadMovies();

    const deepLinkId = new URLSearchParams(window.location.search).get("movie");
    if (deepLinkId) openDetails(deepLinkId);
  }

  init();
})();
