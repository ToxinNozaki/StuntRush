import { defineConfig } from "vite";

// GitHub Pages serves this repo at /StuntRush/, not the domain root, so every
// asset reference has to be prefixed with that base path at build time.
export default defineConfig({
  base: "/StuntRush/",
});
