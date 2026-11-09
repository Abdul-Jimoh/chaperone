// Checks that no secret from .env.local appears in the git history (every commit, every branch) or in the JavaScript a
// deployed site serves. Prints variable names only, never values.
//   node scripts/secrets-audit.mjs [https://www.chaperone.site]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

process.loadEnvFile(".env.local");
const names = Object.keys(process.env).filter((k) => /KEY|SECRET|PASSWORD|TOKEN|JWK|DATABASE_URL|WEBHOOK_ID|EMAIL|VOICE/.test(k));
const secrets = names.flatMap((name) => {
  const value = process.env[name];
  if (!value || value.length < 12) return [];
  // A JWK's private part is what matters, wherever the rest of the key appears.
  let d;
  try {
    d = JSON.parse(value).d;
  } catch {}
  return [{ name, probes: d ? [value, d] : [value] }];
});
if (existsSync("docs/private/agent-key.txt")) secrets.push({ name: "docs/private/agent-key.txt", probes: [readFileSync("docs/private/agent-key.txt", "utf8").trim()] });

const leaks = (text) => secrets.filter((s) => s.probes.some((p) => text.includes(p))).map((s) => s.name);

const history = execFileSync("git", ["log", "--all", "-p", "--no-color"], { maxBuffer: 1 << 30 }).toString();
const commits = execFileSync("git", ["rev-list", "--all", "--count"]).toString().trim();
const inHistory = leaks(history);
console.log(`git history: ${commits} commits, ${secrets.length} secrets checked, found: ${inHistory.join(", ") || "none"}`);

const site = process.argv[2];
let inSite = [];
if (site) {
  const pages = ["/", "/app", "/oauth/authorize", "/approve/x"];
  const scripts = new Set();
  for (const path of pages) {
    const html = await (await fetch(new URL(path, site))).text();
    for (const m of html.matchAll(/src="(\/_next\/static\/[^"]+\.js)"/g)) scripts.add(m[1]);
  }
  const bodies = await Promise.all([...scripts].map(async (s) => (await fetch(new URL(s, site))).text()));
  inSite = leaks(bodies.join("\n"));
  console.log(`${site}: ${scripts.size} scripts, found: ${inSite.join(", ") || "none"}`);
}
process.exit(inHistory.length || inSite.length ? 1 : 0);
