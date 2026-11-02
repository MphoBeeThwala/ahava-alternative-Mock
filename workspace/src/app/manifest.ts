import type { MetadataRoute } from "next";

// Next.js serves this at /manifest.webmanifest and auto-links it from
// every page's <head> — no layout.tsx wiring needed.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Ahava Healthcare",
    short_name: "Ahava",
    description: "Check your symptoms with AI, reviewed by a clinician.",
    start_url: "/",
    display: "standalone",
    background_color: "#FBF7F0",
    theme_color: "#FBF7F0",
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
