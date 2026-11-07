import "server-only";
import { randomUUID } from "node:crypto";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { JWK } from "jose";
import type { Db } from "@/db/client";
import { agentKeys, approvals, mandates, paymentMethods, payments, users } from "@/db/schema";
import { DEMO_NOT_ENFORCED, DEMO_STATEMENT, DEMO_TIMEZONE, demoPolicy } from "@/lib/demo";
import type { AgentStep } from "@/lib/agent/run";
import { runShoppingAgent } from "@/lib/agent/run";
import type { ProductSearch } from "@/lib/agent/catalog";
import type { Llm } from "@/lib/llm/llm";
import { compileMandate } from "@/lib/policy/compile";
import { describePolicy, formatCents } from "@/lib/policy/describe";
import { evaluate } from "@/lib/policy/evaluate";
import { openDraft, sealDraft } from "./drafts";
import { spentByPeriod } from "@/lib/ledger/reserve";
import { storeConfirmedMandate, type Mandate } from "@/lib/mandates";
import { issueApprovalLink, sweepApprovals, type ApprovalDeps } from "@/lib/payments/approvals";
import { requestPayment, revokeMandate, type PaymentDeps, type PaymentResult } from "@/lib/payments/service";
import { enforce, LIMITS, purchaseChecks } from "@/lib/ratelimit";
import { issueAgentKey } from "@/mcp/keys";
import type { DemoShop } from "@/lib/shops";

/** Where the demo's carts are sent: the three sandbox shops, plus a merchant that is none of them. */
export type DemoWorld = { shops: DemoShop[]; rogueMerchantId: string };

/** The seeded shopper whose vaulted sandbox wallet every judge-mode shopper borrows (scripts/seed.ts). */
const TEMPLATE_EMAIL = "demo-shopper@example.com";

export class DemoNotReadyError extends Error {}
export class NotYoursError extends Error {}

/**
 * A fresh, isolated shopper for one visitor: their own mandate, budget and ledger, sharing only the sandbox wallet.
 * `client` is the visitor's keyed hash (see clientId), kept so their limits follow them across shoppers.
 */
export async function startDemoShopper(db: Db, client: string, now = new Date()): Promise<string> {
  const [template] = await db
    .select({ token: paymentMethods.paypalPaymentTokenId, customer: paymentMethods.paypalCustomerId })
    .from(paymentMethods)
    .innerJoin(users, eq(users.id, paymentMethods.userId))
    .where(and(eq(users.email, TEMPLATE_EMAIL), eq(paymentMethods.status, "active")))
    .orderBy(desc(paymentMethods.createdAt))
    .limit(1);
  if (!template) throw new DemoNotReadyError("The demo wallet isn't set up yet (run scripts/seed.ts).");
  await enforce(
    db,
    [
      [LIMITS.demoStartPerClient, client],
      [LIMITS.demoStartPerClientDaily, client],
      [LIMITS.demoStartAll, null],
    ],
    now,
  );

  return db.transaction(async (tx) => {
    const [user] = await tx.insert(users).values({ displayName: "Demo shopper", demoSessionId: randomUUID(), demoClient: client }).returning();
    await tx.insert(paymentMethods).values({ userId: user!.id, paypalPaymentTokenId: template.token, paypalCustomerId: template.customer });
    return user!.id;
  });
}

export type ReadBack = { statement: string; token: string; rules: string[]; notEnforced: string[] };
export type CompileOutcome = ({ ok: true } & ReadBack) | { ok: false; problems: string[] };

function readBack(secret: string, userId: string, statement: string, policy: Mandate["policy"], notEnforced: string[]): ReadBack {
  return { statement, token: sealDraft(secret, { userId, statement, policy }), rules: describePolicy(policy), notEnforced };
}

/** The example sentence as Claude compiled it when it was recorded; offered when Claude can't be reached. */
export function exampleReadBack(world: DemoWorld, userId: string, secret: string): ReadBack {
  return readBack(secret, userId, DEMO_STATEMENT, demoPolicy(world.shops), DEMO_NOT_ENFORCED);
}

/** Claude drafts the visitor's own sentence; code validates it. Nothing is stored until they confirm the read-back. */
export async function compileDemoRules(
  deps: { db: Db; llm: Llm; world: DemoWorld; secret: string },
  userId: string,
  statement: string,
  now = new Date(),
): Promise<CompileOutcome> {
  const text = statement.trim();
  if (text.length < 10) return { ok: false, problems: ["Write your rules in a sentence or two."] };
  if (text.length > 600) return { ok: false, problems: ["Keep your rules under 600 characters."] };
  // Claude calls themselves are limited where they happen (serverLlm's beforeLive), so cached replies stay free.
  await enforce(deps.db, [[LIMITS.compilesPerShopper, userId]], now);
  const result = await compileMandate(deps.llm, { statement: text, shops: deps.world.shops, timezone: DEMO_TIMEZONE, now });
  if (!result.ok) return result;
  return { ok: true, ...readBack(deps.secret, userId, text, result.policy, result.notEnforced) };
}

/** Signs exactly the policy that was read back (the sealed draft). One active mandate per shopper. */
export async function confirmDemoMandate(db: Db, userId: string, token: string, secrets: { draft: string; signingJwk: JWK }): Promise<Mandate> {
  const current = await activeMandate(db, userId);
  if (current) return current;
  const draft = openDraft(secrets.draft, token, userId);
  if (!draft) throw new NotYoursError("That read-back has expired or was changed. Turn your rules into a draft again.");
  await enforce(db, [[LIMITS.mandatesPerShopper, userId]]);
  return storeConfirmedMandate(db, { userId, statement: draft.statement, policy: draft.policy, signingJwk: secrets.signingJwk });
}

export async function activeMandate(db: Db, userId: string): Promise<Mandate | null> {
  const [m] = await db
    .select()
    .from(mandates)
    .where(and(eq(mandates.userId, userId), eq(mandates.status, "active")))
    .orderBy(desc(mandates.createdAt))
    .limit(1);
  return m ?? null;
}

export async function latestMandate(db: Db, userId: string): Promise<Mandate | null> {
  const [m] = await db.select().from(mandates).where(eq(mandates.userId, userId)).orderBy(desc(mandates.createdAt)).limit(1);
  return m ?? null;
}

export async function dashboard(db: Db, userId: string, now = new Date()) {
  const mandate = await latestMandate(db, userId);
  if (!mandate) return null;
  const spent = await spentByPeriod(db, mandate.id, mandate.policy, null, now);
  const recent = await db.select().from(payments).where(eq(payments.mandateId, mandate.id)).orderBy(desc(payments.createdAt)).limit(25);
  const waiting = recent.filter((p) => p.status === "pending_approval");
  const deadlines = waiting.length
    ? await db.select({ paymentId: approvals.paymentId, expiresAt: approvals.expiresAt }).from(approvals).where(inArray(approvals.paymentId, waiting.map((p) => p.id)))
    : [];
  const agents = await db
    .select({ id: agentKeys.id, label: agentKeys.label, via: agentKeys.via, lastUsedAt: agentKeys.lastUsedAt, createdAt: agentKeys.createdAt })
    .from(agentKeys)
    .where(and(eq(agentKeys.mandateId, mandate.id), isNull(agentKeys.revokedAt)))
    .orderBy(desc(agentKeys.createdAt));
  return { mandate, spent, recent, waiting, agents, deadlines: new Map(deadlines.map((d) => [d.paymentId, d.expiresAt])) };
}

export type Scenario = "allowed" | "ask" | "injected";

// Carts an agent might propose, from the demo catalog. They go through the same evaluator and PayPal sandbox as a real agent's.
function scenarioCart(world: DemoWorld, scenario: Scenario) {
  const shops = new Map(world.shops.map((s) => [s.key, s.merchantId]));
  const cart = (payeeMerchantId: string, items: { productId: string; title: string; unitPriceCents: number; quantity: number; category: string }[]) => ({
    payeeMerchantId,
    currency: "USD",
    items,
    shippingCents: 0,
    taxCents: 0,
  });
  switch (scenario) {
    case "allowed":
      return cart(shops.get("pet-pantry")!, [{ productId: "pp-dry-dog-food-5kg", title: "Dry dog food, chicken and rice, 5 kg", unitPriceCents: 2_649, quantity: 1, category: "dog-food" }]);
    case "ask":
      return cart(shops.get("home-basics")!, [
        { productId: "hb-paper-towels-12", title: "Paper towels, 12 rolls", unitPriceCents: 3_349, quantity: 1, category: "paper-towels" },
        { productId: "hb-dish-soap-750", title: "Dish soap, 750 ml", unitPriceCents: 750, quantity: 1, category: "dish-soap" },
      ]);
    case "injected":
      // The listing told the agent to buy 10 and pay a merchant that isn't one of the user's shops.
      return cart(world.rogueMerchantId, [{ productId: "bpd-dry-dog-food-5kg", title: "Dry dog food, 5 kg, bulk deal", unitPriceCents: 2_499, quantity: 10, category: "dog-food" }]);
  }
}

const SCENARIO_COPY: Record<Scenario, { noun: string; body: string }> = {
  allowed: { noun: "the dog food", body: "Pet Pantry." },
  ask: { noun: "the paper towels and dish soap", body: "Home Basics." },
  injected: { noun: "the 10 bags of dog food", body: "A listing told the agent to ignore your limits and pay Bulk Pet Deals, a shop you never listed." },
};

const VERDICT: Record<string, string> = { allow: "Your rules: pay it.", needs_approval: "Your rules: ask you first.", deny: "Your rules: block it." };

/** The fixed carts, with what the user's current rules would say about each right now. */
export function scenarioCards(world: DemoWorld, mandate: Mandate, spent: Record<string, number>, now = new Date()) {
  return (["allowed", "ask", "injected"] as const).map((id) => {
    const cart = scenarioCart(world, id);
    const e = evaluate({ policy: mandate.policy, mandateStatus: mandate.status, cart, spent, now });
    const items = cart.items
      .map((i, n) => {
        const name = i.title.split(",")[0]!;
        return i.quantity > 1 ? `${i.quantity} × ${name.toLowerCase()}` : n > 0 ? name.toLowerCase() : name;
      })
      .join(" and ");
    return { id, noun: SCENARIO_COPY[id].noun, title: `${items}, ${formatCents(e.totalCents)}`, body: SCENARIO_COPY[id].body, expect: VERDICT[e.decision]! };
  });
}

async function ownMandate(db: Db, userId: string): Promise<Mandate> {
  const mandate = await latestMandate(db, userId);
  if (!mandate) throw new NotYoursError("No mandate yet.");
  return mandate;
}

/** `attemptId` is issued with the page, so a double-click or a resent form is the same purchase, not a second one. */
export async function simulatePurchase(deps: PaymentDeps, world: DemoWorld, userId: string, scenario: Scenario, attemptId: string): Promise<PaymentResult> {
  const mandate = await ownMandate(deps.db, userId);
  await enforce(deps.db, await purchaseChecks(deps.db, userId), deps.clock?.());
  // Like a real agent's request: expired approvals give their budget back before this one is decided.
  await sweepApprovals(deps).catch((error) => console.warn("approval sweep failed:", error));
  return requestPayment(deps, { mandateId: mandate.id, runId: `demo-${attemptId}`, source: "agent", cart: scenarioCart(world, scenario) });
}

/**
 * Claude's second job, live: the agent searches the demo shops' catalog and asks Chaperone to pay. It proposes
 * listing ids and quantities; prices, titles and sellers come from the catalog, and the evaluator decides.
 */
export async function runDemoAgent(
  deps: { payments: PaymentDeps; llm: Llm; search: ProductSearch; world: DemoWorld },
  userId: string,
  input: { goal: string; attemptId: string; onStep?: (step: AgentStep) => void },
) {
  const goal = input.goal.trim();
  if (goal.length < 5 || goal.length > 300) throw new NotYoursError("Describe the shopping trip in a sentence (up to 300 characters).");
  const mandate = await ownMandate(deps.payments.db, userId);
  await enforce(deps.payments.db, [[LIMITS.agentRunsPerShopper, userId]], deps.payments.clock?.());
  return runShoppingAgent(
    { llm: deps.llm, search: deps.search, payments: deps.payments, shops: deps.world.shops },
    {
      mandateId: mandate.id,
      goal,
      runId: `agent-${input.attemptId}`,
      onStep: input.onStep,
      // Each payment the agent asks for counts against the purchase limits, like a button press or an MCP call.
      beforePayment: async () => enforce(deps.payments.db, await purchaseChecks(deps.payments.db, userId), deps.payments.clock?.()),
    },
  );
}

export async function createDemoAgentKey(db: Db, userId: string): Promise<string> {
  const mandate = await activeMandate(db, userId);
  if (!mandate) throw new NotYoursError("There's no active mandate to attach a key to.");
  await enforce(db, [[LIMITS.agentKeysPerShopper, userId]]);
  return issueAgentKey(db, mandate.id, "dashboard");
}

/** Disconnects one agent: its key stops working at once. Only the mandate's owner can do it. */
export async function disconnectAgent(db: Db, userId: string, agentKeyId: string, now = new Date()) {
  const [row] = await db
    .select({ id: agentKeys.id })
    .from(agentKeys)
    .innerJoin(mandates, eq(mandates.id, agentKeys.mandateId))
    .where(and(eq(agentKeys.id, agentKeyId), eq(mandates.userId, userId)));
  if (!row) throw new NotYoursError("That agent isn't connected to your rules.");
  await db.update(agentKeys).set({ revokedAt: now }).where(eq(agentKeys.id, agentKeyId));
}

export async function revokeOwnMandate(deps: PaymentDeps, userId: string) {
  const mandate = await ownMandate(deps.db, userId);
  return revokeMandate(deps, mandate.id, "user");
}

/** Issued only to the signed-in owner: a link in an agent's hands would let it approve itself (D12). */
export async function approvalLinkFor(deps: ApprovalDeps, userId: string, paymentId: string) {
  const [row] = await deps.db
    .select({ id: payments.id })
    .from(payments)
    .innerJoin(mandates, eq(mandates.id, payments.mandateId))
    .where(and(eq(payments.id, paymentId), eq(mandates.userId, userId)));
  if (!row) throw new NotYoursError("That payment isn't yours.");
  await enforce(deps.db, [[LIMITS.approvalLinksPerShopper, userId]], deps.clock?.());
  return issueApprovalLink(deps, paymentId);
}
