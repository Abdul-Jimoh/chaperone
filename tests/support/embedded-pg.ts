import { mkdtemp, rm } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import EmbeddedPostgres from "embedded-postgres";
import { Pool } from "pg";

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, () => {
      const { port } = srv.address() as { port: number };
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

/** A throwaway, migrated Postgres in a temp dir: for tests and for recording fixtures without touching Neon. */
export async function startEmbeddedPostgres(): Promise<{ url: string; stop: () => Promise<void> }> {
  const dir = await mkdtemp(join(tmpdir(), "chaperone-pg-"));
  const port = await freePort();
  const pg = new EmbeddedPostgres({
    databaseDir: dir,
    user: "postgres",
    password: "postgres",
    port,
    persistent: false,
    onLog: () => {},
  });
  await pg.initialise();
  await pg.start();
  await pg.createDatabase("chaperone_test");

  const url = `postgres://postgres:postgres@localhost:${port}/chaperone_test`;
  const pool = new Pool({ connectionString: url });
  await migrate(drizzle(pool), { migrationsFolder: "drizzle" });
  await pool.end();

  return {
    url,
    stop: async () => {
      await pg.stop();
      await rm(dir, { recursive: true, force: true });
    },
  };
}
