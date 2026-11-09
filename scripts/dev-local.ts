// pnpm dev:local: starts the local Postgres (when .env.local points at it), then the app; stops both together.
import { spawn } from "node:child_process";
import { isLocalUrl, startLocalDb } from "./local-db";

process.loadEnvFile(".env.local");
const stop = isLocalUrl(process.env.DATABASE_URL) ? await startLocalDb() : null;
const app = spawn("pnpm", ["exec", "next", "dev"], { stdio: "inherit" });
const shutdown = async () => {
  app.kill("SIGINT");
  await stop?.();
  process.exit(0);
};
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
app.on("exit", async (code) => {
  await stop?.();
  process.exit(code ?? 0);
});
