// Checks that no secret from .env.local appears in the git history (every commit, every branch, binary files too) or in
// what a deployed site serves: the HTML of each page (which carries the server-rendered data passed to the browser) and
// every script it loads. Prints variable names only, never values.
//   node scripts/secrets-audit.mjs [https://www.chaperone.site] [--cookie "chp_session=..."]
// With a session cookie (copy it from the browser after starting the demo), the signed-in pages are checked too.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { parseEnv } from "node:util";

// Read the file itself, so a variable exported in the shell can't stand in for the one in .env.local.
const env = parseEnv(readFileSync(".env.local", "utf8"));
const SECRET = /KEY|SECRET|PASSWORD|TOKEN|JWK|DATABASE_URL|WEBHOOK_ID|EMAIL|VOICE/;
const secrets = Object.entries(env).flatMap(([name, value]) => {
  if (!SECRET.test(name) || !value || value.length < 12) return [];
  const probes = [value];
  try {
    if (JSON.parse(value).d) probes.push(JSON.parse(value).d); // a JWK's private part
  } catch {}
  try {
    const url = new URL(value);
    if (url.password && url.password.length >= 8) probes.push(decodeURIComponent(url.password)); // a database password on its own
  } catch {}
  return [{ name, probes }];
});
// PayPal client credentials also travel as base64("id:secret") in Basic auth headers.
for (const prefix of ["PAYPAL", "PAYPAL_SHOP_A", "PAYPAL_SHOP_B", "PAYPAL_SHOP_C"]) {
  const id = env[`${prefix}_CLIENT_ID`];
  const secret = env[`${prefix}_CLIENT_SECRET`];
  if (id && secret) secrets.push({ name: `${prefix}_CLIENT_ID:SECRET (base64)`, probes: [Buffer.from(`${id}:${secret}`).toString("base64")] });
}
if (existsSync("docs/private/agent-key.txt")) secrets.push({ name: "docs/private/agent-key.txt", probes: [readFileSync("docs/private/agent-key.txt", "utf8").trim()] });

const leaks = (text) => secrets.filter((s) => s.probes.some((p) => text.includes(p))).map((s) => s.name);

const history = execFileSync("git", ["log", "--all", "-p", "--binary", "--no-color"], { maxBuffer: 1 << 30 }).toString("latin1");
const commits = execFileSync("git", ["rev-list", "--all", "--count"]).toString().trim();
const inHistory = leaks(history);
console.log(`git history: ${commits} commits, ${secrets.length} secrets checked, found: ${inHistory.join(", ") || "none"}`);

const site = process.argv[2]?.startsWith("http") ? process.argv[2] : null;
let inSite = [];
if (site) {
  const cookie = process.argv.includes("--cookie") ? process.argv[process.argv.indexOf("--cookie") + 1] : undefined;
  const pages = ["/", "/app", "/oauth/authorize", "/approve/x", ...(cookie ? ["/app/shop", "/app/approvals", "/app/ledger", "/app/rules", "/app/connect"] : [])];
  const bodies = [];
  const scripts = new Set();
  for (const path of pages) {
    const html = await (await fetch(new URL(path, site), { headers: cookie ? { cookie } : {} })).text();
    bodies.push(html);
    for (const m of html.matchAll(/(?:src|href)="(\/_next\/static\/[^"]+\.js)"/g)) scripts.add(m[1]);
    // Chunks the page loads later are named in its inline data as "static/chunks/...".
    for (const m of html.matchAll(/(static\/chunks\/[\w./-]+\.js)/g)) scripts.add(`/_next/${m[1]}`);
  }
  for (const s of scripts) bodies.push(await (await fetch(new URL(s, site))).text());
  inSite = leaks(bodies.join("\n"));
  console.log(`${site}: ${pages.length} pages${cookie ? " (signed in)" : ""} and ${scripts.size} scripts, found: ${inSite.join(", ") || "none"}`);
}
process.exit(inHistory.length || inSite.length ? 1 : 0);
