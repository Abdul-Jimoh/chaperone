import "server-only";
import { headers } from "next/headers";
import { env } from "@/lib/env";

/**
 * Where links handed to people and agents should point. In production that is the configured APP_URL,
 * never a client-supplied Host header; in dev it follows whatever port the server runs on.
 */
export async function appOrigin(): Promise<string> {
  if (process.env.NODE_ENV === "production") return env().APP_URL.replace(/\/$/, "");
  const host = (await headers()).get("host") ?? "localhost:3000";
  return `http://${host}`;
}
