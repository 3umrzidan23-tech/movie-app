"use strict";

/**
 * Shared TMDB proxy logic.
 *
 * Used by:
 *  - api/tmdb.js  (Vercel Function in production)
 *  - dev-server.js (zero-dependency local server)
 *
 * Keeping the allow-list here prevents the public endpoint from being used
 * as an open proxy for arbitrary TMDB routes.
 */

const TMDB_BASE = "https://api.themoviedb.org/3";

const ALLOWED_PATHS = [
  /^\/trending\/movie\/week$/,
  /^\/movie\/(now_playing|popular|top_rated|upcoming)$/,
  /^\/movie\/\d+$/,
  /^\/search\/movie$/,
  /^\/discover\/movie$/,
  /^\/genre\/movie\/list$/,
];

const ALLOWED_QUERY = new Set([
  "language",
  "page",
  "query",
  "include_adult",
  "with_genres",
  "sort_by",
  "append_to_response",
]);

function isAllowedPath(path) {
  return ALLOWED_PATHS.some((pattern) => pattern.test(path));
}

async function proxyTmdb({ path, query = {}, apiKey, timeoutMs = 10000 }) {
  if (!apiKey) {
    const error = new Error("TMDB_API_KEY is not configured on the server.");
    error.status = 500;
    throw error;
  }

  if (!isAllowedPath(path)) {
    const error = new Error("This TMDB endpoint is not allowed.");
    error.status = 400;
    throw error;
  }

  const url = new URL(TMDB_BASE + path);
  url.searchParams.set("api_key", apiKey);

  if (!url.searchParams.has("language")) {
    url.searchParams.set("language", "en-US");
  }

  for (const [key, value] of Object.entries(query)) {
    if (!ALLOWED_QUERY.has(key) || value === undefined || value === null || value === "") {
      continue;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => url.searchParams.append(key, String(item)));
    } else {
      url.searchParams.set(key, String(value));
    }
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });

    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  } catch (error) {
    if (error.name === "AbortError") {
      const timeoutError = new Error("The movie database took too long to respond.");
      timeoutError.status = 504;
      throw timeoutError;
    }

    const networkError = new Error("Could not reach the movie database.");
    networkError.status = 502;
    throw networkError;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { proxyTmdb, isAllowedPath, ALLOWED_PATHS, ALLOWED_QUERY };
