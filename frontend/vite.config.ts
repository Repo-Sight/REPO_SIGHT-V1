import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Static HTML per route at build time (SEO). "flat" writes /x.html files;
  // scripts/flatten-html.mjs then fixes the "x.html.html" names that .html
  // route paths produce, so live URLs stay exactly as they are today.
  ssgOptions: {
    script: "async",
    dirStyle: "flat",
    formatting: "none",
  },
});
