import type { TestProject } from "vitest/node";
import { startEmbeddedPostgres } from "./embedded-pg";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}

// Real Postgres (not an in-process emulation) so row-lock concurrency tests mean something.
export default async function setup(project: TestProject) {
  const { url, stop } = await startEmbeddedPostgres();
  project.provide("databaseUrl", url);
  return stop;
}
