import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Chegô",
    short_name: "Chegô",
    description: "Tudo da cidade, numa sacola só.",
    lang: "pt-BR",
    start_url: "/",
    display: "standalone",
    orientation: "portrait",
    background_color: "#FFF8F1",
    theme_color: "#E8611A",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
