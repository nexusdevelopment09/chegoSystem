import { networkInterfaces } from "node:os";
import type { NextConfig } from "next";

// Deixa um celular no mesmo Wi-Fi abrir o servidor de desenvolvimento pelo IP
// deste computador (http://192.168.x.x:3000). Só afeta o `next dev`.
const lanAddresses = Object.values(networkInterfaces())
  .flat()
  .filter((net) => net && net.family === "IPv4" && !net.internal)
  .map((net) => net!.address);

const nextConfig: NextConfig = {
  // Os testes de ponta a ponta rodam um segundo servidor com a própria pasta de build.
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
        // Proteções básicas em todas as páginas: não adivinhar o tipo dos arquivos,
        // não deixar o app ser embutido em outro site (clickjacking), não vazar
        // endereços completos para outros sites e não dar acesso a sensores que
        // o app não usa.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), payment=(), geolocation=(self)" },
        ],
      },
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
