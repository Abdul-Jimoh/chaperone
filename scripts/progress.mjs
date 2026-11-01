#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const file = fileURLToPath(new URL("../docs/PROGRESS.md", import.meta.url));
const lines = readFileSync(file, "utf8").split("\n");

const phaseRe = /^## (P\d+) — (.+)$/;
const taskRe = /^- \[( |x|~)\] (P\d+\.\d+) (.+?)(?: · (human))?\s*$/;

const phases = [];
for (const line of lines) {
  const p = line.match(phaseRe);
  if (p) {
    phases.push({ id: p[1], name: p[2].trim(), tasks: [] });
    continue;
  }
  const t = line.match(taskRe);
  if (t && phases.length) {
    phases.at(-1).tasks.push({ state: t[1], id: t[2], title: t[3], human: Boolean(t[4]) });
  }
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : "–");
const bar = (n, d, w = 20) => {
  const filled = d ? Math.round((n / d) * w) : 0;
  return "█".repeat(filled) + "░".repeat(w - filled);
};

let total = 0;
let done = 0;
console.log("Chaperone progress\n");
for (const phase of phases) {
  const d = phase.tasks.filter((t) => t.state === "x").length;
  total += phase.tasks.length;
  done += d;
  console.log(`${phase.id.padEnd(3)} ${bar(d, phase.tasks.length)} ${pct(d, phase.tasks.length).padStart(4)}  ${`${d}/${phase.tasks.length}`.padEnd(6)} ${phase.name}`);
}
console.log(`\nOverall ${bar(done, total, 30)} ${pct(done, total)}  (${done}/${total} tasks)`);

const current = phases.find((p) => p.tasks.some((t) => t.state !== "x"));
if (current) console.log(`Current phase: ${current.id} — ${current.name}`);

const inProgress = phases.flatMap((p) => p.tasks.filter((t) => t.state === "~"));
if (inProgress.length) {
  console.log("\nIn progress:");
  for (const t of inProgress) console.log(`  ${t.id} ${t.title}`);
}

const human = phases.flatMap((p) => p.tasks.filter((t) => t.human && t.state !== "x"));
const nextHuman = human.filter((t) => phases.findIndex((p) => p.tasks.includes(t)) <= phases.indexOf(current));
if (nextHuman.length) {
  console.log("\nWaiting on human:");
  for (const t of nextHuman) console.log(`  ${t.id} ${t.title}`);
}
