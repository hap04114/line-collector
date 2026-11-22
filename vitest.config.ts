import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["server/test/**/*.test.ts"],
    env: { TZ: "America/New_York", POLLER_ENABLED: "false" },
  },
});
