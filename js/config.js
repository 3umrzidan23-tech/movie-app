/* =========================================================
   CineScope — application configuration
   ---------------------------------------------------------
   All TMDB requests go through /api/tmdb (a tiny Vercel
   Function). The API key lives in the TMDB_API_KEY
   environment variable on Vercel, never in this file.
   ========================================================= */

const CONFIG = Object.freeze({
  API_BASE: "/api/tmdb",

  IMG_BASE: "https://image.tmdb.org/t/p",
  POSTER_SIZE: "w342",
  POSTER_SIZE_LARGE: "w500",
  BACKDROP_SIZE: "w1280",

  CACHE_TTL: 10 * 60 * 1000, // 10 minutes

  CATEGORIES: Object.freeze({
    trending: { title: "Trending This Week", endpoint: "/trending/movie/week" },
    now_playing: { title: "Now Playing", endpoint: "/movie/now_playing" },
    popular: { title: "Popular Movies", endpoint: "/movie/popular" },
    top_rated: { title: "Top Rated Movies", endpoint: "/movie/top_rated" },
    upcoming: { title: "Upcoming Movies", endpoint: "/movie/upcoming" },
  }),
});
