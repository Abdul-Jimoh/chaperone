// A Postgres that runs on this machine with no install and no account (embedded-postgres), kept in .local/pg.
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import EmbeddedPostgres from "embedded-postgres";

export const LOCAL_PORT = 54329;
export const LOCAL_URL = `postgres://postgres:postgres@localhost:${LOCAL_PORT}/chaperone`;
const DIR = join(process.cwd(), ".local", "pg");

export const isLocalUrl = (url: string | undefined) => url === LOCAL_URL;

export async function startLocalDb(): Promise<() => Promise<void>> {
  const fresh = !existsSync(join(DIR, "PG_VERSION"));
  mkdirSync(DIR, { recursive: true });
  const pg = new EmbeddedPostgres({ databaseDir: DIR, user: "postgres", password: "postgres", port: LOCAL_PORT, persistent: true, onLog: () => {} });
  if (fresh) await pg.initialise();
  await pg.start();
  if (fresh) await pg.createDatabase("chaperone");
  return () => pg.stop();
}
