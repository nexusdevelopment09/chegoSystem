import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// Lets a phone on the same Wi-Fi open the dev server through this computer's
// IP (http://192.168.x.x:3000). Only affects `next dev`.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === "IPv4" && !net.internal)
  .map((net) => net!.address);

const nextConfig: NextConfig = {
  // The end-to-end tests run a second dev server with its own build folder.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  cacheComponents: true,
  partialPrefetching: true,
  allowedDevOrigins: lanAddresses,
  experimental: {
    serverActions: {
      allowedOrigins: lanAddresses.map((address) => `${address}:3000`),
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        ],
      },
    ];
  },
};

export default nextConfig;
