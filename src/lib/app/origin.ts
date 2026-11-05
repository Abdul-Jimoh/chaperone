import "server-only";
import { headers } from "next/headers";
import { ConfigError, env } from "@/lib/env";

/**
 * Where links handed to people and agents should point. In production that is the configured APP_URL,
 * never a client-supplied Host header; in dev it follows whatever port the server runs on.
 */
export async function appOrigin(): Promise<string> {
  if (process.env.NODE_ENV === "production") {
    // The schema defaults APP_URL to localhost for dev; in production that would hand out dead QR codes.
    if (!process.env.APP_URL) throw new ConfigError("Missing env var APP_URL. See .env.example.");
    return env().APP_URL.replace(/\/$/, "");
  }
  const host = (await headers()).get("host") ?? "localhost:3000";
  return `http://${host}`;
}
