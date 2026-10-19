"use strict";

/**
 * Zero-dependency local development server.
 *
 *   node dev-server.js
 *
 * Serves the static site and implements the same /api/tmdb proxy used by the
 * Vercel Function. The TMDB key is read from .env.local (git-ignored) or from
 * the TMDB_API_KEY environment variable.
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { proxyTmdb } = require("./lib/tmdb-proxy");

const ROOT = __dirname;
const PORT = Number(process.env.PORT) || 5500;

loadEnvFile();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
};

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env.local");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;

    const key = trimmed.slice(0, equals).trim();
    let value = trimmed.slice(equals + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) process.env[key] = value;
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(data));
}

async function handleProxy(requestUrl, res) {
  try {
    const query = Object.fromEntries(requestUrl.searchParams.entries());
    const { status, data } = await proxyTmdb({
      path: query.path,
      query,
      apiKey: process.env.TMDB_API_KEY,
    });

    sendJson(res, status, data);
  } catch (error) {
    sendJson(res, error.status || 502, {
      status_message: error.message || "TMDB proxy error.",
    });
  }
}

function handleStatic(requestUrl, req, res) {
  let pathname;

  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad request");
    return;
  }

  if (pathname === "/") pathname = "/index.html";

  const filePath = path.resolve(ROOT, "." + pathname);
  const rootPrefix = ROOT.endsWith(path.sep) ? ROOT : ROOT + path.sep;

  if (!filePath.startsWith(rootPrefix)) {
    res.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }

  fs.stat(filePath, (error, stats) => {
    if (error || !stats.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not found");
      return;
    }

    const extension = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": MIME_TYPES[extension] || "application/octet-stream",
      "Cache-Control": "no-cache",
    });

    if (req.method === "HEAD") {
      res.end();
      return;
    }

    fs.createReadStream(filePath).pipe(res);
  });
}

const server = http.createServer((req, res) => {
  const requestUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);

  if (requestUrl.pathname === "/api/tmdb") {
    if (req.method !== "GET") {
      res.setHeader("Allow", "GET");
      sendJson(res, 405, { status_message: "Method not allowed." });
      return;
    }

    handleProxy(requestUrl, res);
    return;
  }

  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD", "Content-Type": "text/plain; charset=utf-8" });
    res.end("Method not allowed");
    return;
  }

  handleStatic(requestUrl, req, res);
});

server.listen(PORT, () => {
  const keyStatus = process.env.TMDB_API_KEY ? "loaded" : "MISSING (add it to .env.local)";
  console.log(`CineScope dev server: http://localhost:${PORT}`);
  console.log(`TMDB_API_KEY: ${keyStatus}`);
});
