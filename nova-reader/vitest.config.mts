// Vitest settings. Runs only on your computer (Node.js) during `npm test`.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Lets tests use the same "@/lib/..." imports as the app.
    alias: {
      "@": fileURLToPath(new URL("./", import.meta.url)),
      // "server-only" throws when imported outside Next.js server code. Tests run
      // in plain Node, so point it at the package's empty, harmless file.
      "server-only": fileURLToPath(new URL("./node_modules/server-only/empty.js", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
