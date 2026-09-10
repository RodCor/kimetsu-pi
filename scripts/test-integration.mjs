import { spawnSync } from "node:child_process";

const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/kimetsu-integration.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, KIMETSU_INTEGRATION_REQUIRED: "1" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
