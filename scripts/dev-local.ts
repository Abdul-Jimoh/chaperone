// pnpm dev:local: starts the local Postgres (when .env.local points at it), then the app; stops both together.
import { spawn } from "node:child_process";
import { isLocalUrl, startLocalDb } from "./local-db";

process.loadEnvFile(".env.local");
const stop = isLocalUrl(process.env.DATABASE_URL) ? await startLocalDb() : null;
// On Windows pnpm is pnpm.cmd, which only starts through a shell.
const app = spawn("pnpm", ["exec", "next", "dev"], { stdio: "inherit", shell: process.platform === "win32" });
let stopping: Promise<void> | undefined;
const finish = async (code: number) => {
  stopping ??= Promise.resolve(stop?.());
  await stopping;
  process.exit(code);
};
process.on("SIGINT", () => app.kill("SIGINT"));
process.on("SIGTERM", () => app.kill("SIGTERM"));
app.on("exit", (code) => finish(code ?? 0));
