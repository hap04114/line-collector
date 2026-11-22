import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, searchForWorkspaceRoot } from "vite";

const here = fileURLToPath(new URL(".", import.meta.url));
const api = process.env.API_URL || "http://localhost:8787";

export default defineConfig({
  root: here,
  plugins: [react()],
  build: { outDir: resolve(here, "dist"), emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    host: true,
    proxy: { "/api": api, "/uploads": api },
    // node_modules may be a junction to another drive; allow its real path
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), realpathSync(resolve(here, "../node_modules"))] },
  },
});
