import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/**
 * Neon URLs say sslmode=require, which pg currently treats as verify-full but will downgrade to
 * libpq's weaker meaning in its next major version. Asking for verify-full keeps certificate checks.
 */
export function withVerifiedTls(connectionString: string): string {
  const url = new URL(connectionString);
  if (url.searchParams.get("sslmode") === "require") url.searchParams.set("sslmode", "verify-full");
  return url.toString();
}

export function createDb(connectionString: string, options: { max?: number } = {}): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString: withVerifiedTls(connectionString), max: options.max ?? 5 });
  // An idle connection Neon drops emits "error" on the pool; unhandled, that would crash the process.
  pool.on("error", (error) => console.warn("idle database connection closed:", error.message));
  return { db: drizzle(pool, { schema }), pool };
}
