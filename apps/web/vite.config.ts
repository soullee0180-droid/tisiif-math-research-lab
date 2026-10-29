import { defineConfig } from "vite";
export default defineConfig({
  optimizeDeps: {
    include: [
      "pdfjs-dist/legacy/build/pdf.mjs",
      "pdf-lib",
      "@noble/hashes/sha256",
      "exceljs",
      "fflate",
    ],
  },
  build: { target: "es2023", outDir: "dist" },
  worker: { format: "es" },
  server: { host: "0.0.0.0", allowedHosts: ["terminal.local"] },
});
