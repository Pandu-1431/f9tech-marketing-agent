import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    alias: { "@": path.resolve(import.meta.dirname, "src") },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      DATABASE_URL: "memory://",
      AGENT_TEXT_CHAIN: "fake",
      AGENT_IMAGE_CHAIN: "fake",
      STORAGE_DRIVER: "local",
      STORAGE_LOCAL_DIR: "/tmp/marketing-agent-test-uploads",
    },
  },
});
