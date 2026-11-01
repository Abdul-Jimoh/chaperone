import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type Db = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

export function createDb(connectionString: string, options: { max?: number } = {}): { db: Db; pool: Pool } {
  const pool = new Pool({ connectionString, max: options.max ?? 5 });
  return { db: drizzle(pool, { schema }), pool };
}
