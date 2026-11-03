// Fails when a class has a shorter canonical form (e.g. w-[18px] → w-4.5, data-[open]: → data-open:),
// using Tailwind's own canonicaliser: the same check the editor extension warns about.
// `node scripts/check-tailwind.mjs --fix` rewrites them in place.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { __unstable__loadDesignSystem } from "@tailwindcss/node";

const root = new URL("..", import.meta.url).pathname;
const cssPath = join(root, "src/app/globals.css");
const design = await __unstable__loadDesignSystem(readFileSync(cssPath, "utf8"), { base: join(root, "src/app") });

const files = readdirSync(join(root, "src"), { recursive: true })
  .filter((f) => /\.tsx?$/.test(f))
  .map((f) => join(root, "src", f));

// Class lists live in className="…", className={`…`} and cn("…") style strings; scan every string literal.
const STRING = /(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const fix = process.argv.includes("--fix");
const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  const replacements = new Map();
  for (const match of text.matchAll(STRING)) {
    const tokens = match[2].split(/\s+/).filter((t) => t && !t.includes("${") && /^[!-]?[a-z@[]/.test(t));
    for (const token of tokens) {
      if (design.parseCandidate(token).length === 0) continue;
      const [canonical] = design.canonicalizeCandidates([token], { rem: 16 });
      if (canonical && canonical !== token) {
        const line = text.slice(0, match.index).split("\n").length;
        problems.push(`${relative(root, file)}:${line}  ${token}  →  ${canonical}`);
        replacements.set(token, canonical);
      }
    }
  }
  if (fix && replacements.size) {
    let next = text;
    for (const [from, to] of replacements) {
      const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      next = next.replace(new RegExp(`(?<=[\\s"'\`])${escaped}(?=[\\s"'\`])`, "g"), to);
    }
    writeFileSync(file, next);
  }
}
if (fix) {
  console.log(`Fixed ${problems.length} class(es).`);
  process.exit(0);
}

if (problems.length) {
  console.error(`Non-canonical Tailwind classes (${problems.length}):\n${[...new Set(problems)].join("\n")}`);
  process.exit(1);
}
console.log("Tailwind classes are canonical.");
