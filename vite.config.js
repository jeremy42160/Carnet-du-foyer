import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Le service worker de notifications (public/firebase-messaging-sw.js) est déjà écrit
// à la main et servi tel quel depuis /public — on n'utilise donc pas la génération
// automatique de vite-plugin-pwa pour le service worker, seulement pour le manifeste.
export default defineConfig({
  plugins: [react()],
});
