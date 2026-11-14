import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      manifest: {
        name: "CanTrack",
        short_name: "CanTrack",
        description: "Paseadores de perros en Pasto: pide un paseo o pasea y gana.",
        lang: "es",
        theme_color: "#45C55D",
        background_color: "#F4FAF3",
        display: "standalone",
        orientation: "portrait",
        start_url: "/",
        scope: "/",
        // Without icons Android never offers "Instalar app"; maskable fills adaptive shapes.
        icons: [
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
          { src: "/icons/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
      },
    }),
  ],
});
