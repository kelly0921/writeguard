import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  root: projectRoot,
  cacheDir: `${projectRoot}/node_modules/.vitest`,
  server: {
    fs: {
      allow: [projectRoot]
    }
  },
  test: {
    environment: "node",
    fileParallelism: false,
    include: ["tests/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json", "html"]
    }
  }
});
