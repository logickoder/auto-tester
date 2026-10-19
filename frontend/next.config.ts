import type { NextConfig } from "next";

// Single-container mode (root Dockerfile): the dashboard is the public server and
// forwards the API's own paths to FastAPI inside the same container, so the runner
// and the API docs keep working on the same host. Read at build time.
const passthrough = process.env.AUTOTESTER_API_PASSTHROUGH === "1";
const api = process.env.FASTAPI_BASE_URL ?? "http://127.0.0.1:8001";

const nextConfig: NextConfig = {
  // Self-contained server bundle for the Docker images.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async rewrites() {
    if (!passthrough) return [];
    return [
      // Everything under /api except the dashboard's own /api/backend proxy route.
      { source: "/api/:path((?!backend/).*)", destination: `${api}/api/:path` },
      { source: "/health", destination: `${api}/health` },
      { source: "/docs", destination: `${api}/docs` },
      { source: "/openapi.json", destination: `${api}/openapi.json` },
    ];
  },
};

export default nextConfig;
