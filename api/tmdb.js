"use strict";

const { proxyTmdb } = require("../lib/tmdb-proxy");

/**
 * Vercel Function: GET /api/tmdb?path=/trending/movie/week&page=1
 *
 * The TMDB API key is read from the TMDB_API_KEY environment variable,
 * so it is never shipped to the browser.
 */
module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    res.setHeader("Allow", "GET");
    res.status(405).json({ status_message: "Method not allowed." });
    return;
  }

  const path = typeof req.query.path === "string" ? req.query.path : "";

  try {
    const { status, data } = await proxyTmdb({
      path,
      query: req.query,
      apiKey: process.env.TMDB_API_KEY,
    });

    if (status >= 200 && status < 300) {
      res.setHeader("Cache-Control", "public, s-maxage=600, stale-while-revalidate=86400");
    }

    res.status(status).json(data);
  } catch (error) {
    const status = error.status || 502;

    if (status >= 500) {
      console.error("TMDB proxy error:", error.message);
    }

    res.status(status).json({ status_message: error.message || "TMDB proxy error." });
  }
};
