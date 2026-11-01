import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import type { Check } from "@/lib/policy/evaluate";
import type { CartItem, Policy } from "@/lib/policy/schema";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").unique(),
  displayName: text("display_name").notNull(),
  // Set for judge-mode users so each judge session gets its own isolated copy of the demo.
  demoSessionId: text("demo_session_id").unique(),
  createdAt: createdAt(),
});

export const merchants = pgTable("merchants", {
  id: uuid("id").primaryKey().defaultRandom(),
  paypalMerchantId: text("paypal_merchant_id").notNull().unique(),
  name: text("name").notNull(),
  createdAt: createdAt(),
});

export const paymentMethodStatus = pgEnum("payment_method_status", ["active", "revoked"]);

export const paymentMethods = pgTable("payment_methods", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  paypalPaymentTokenId: text("paypal_payment_token_id").notNull().unique(),
  paypalCustomerId: text("paypal_customer_id"),
  payerEmail: text("payer_email"),
  status: paymentMethodStatus("status").notNull().default("active"),
  createdAt: createdAt(),
});

export const mandateStatus = pgEnum("mandate_status", ["active", "revoked"]);

export const mandates = pgTable("mandates", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id),
  statement: text("statement").notNull(),
  policy: jsonb("policy").$type<Policy>().notNull(),
  hash: text("hash").notNull(),
  jws: text("jws").notNull(),
  status: mandateStatus("status").notNull().default("active"),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
});

export const decision = pgEnum("decision", ["allow", "needs_approval", "deny"]);
export const paymentSource = pgEnum("payment_source", ["agent", "mcp"]);
export const paymentStatus = pgEnum("payment_status", [
  "denied",
  "authorizing",
  "pending_approval",
  "authorized",
  // Claimed before calling PayPal, so a capture and a void (e.g. from a revoke) can't both run on one hold.
  "capturing",
  "voiding",
  "captured",
  "voided",
  "failed",
]);

export const payments = pgTable(
  "payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateId: uuid("mandate_id").notNull().references(() => mandates.id),
    mandateHash: text("mandate_hash").notNull(),
    runId: text("run_id"),
    idempotencyKey: text("idempotency_key").notNull().unique(),
    source: paymentSource("source").notNull(),
    payeeMerchantId: text("payee_merchant_id").notNull(),
    items: jsonb("items").$type<CartItem[]>().notNull(),
    shippingCents: integer("shipping_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    currency: text("currency").notNull(),
    decision: decision("decision").notNull(),
    clauseId: text("clause_id").notNull(),
    clauseText: text("clause_text").notNull(),
    checks: jsonb("checks").$type<Check[]>().notNull(),
    status: paymentStatus("status").notNull(),
    paypalOrderId: text("paypal_order_id"),
    paypalAuthorizationId: text("paypal_authorization_id"),
    paypalCaptureId: text("paypal_capture_id"),
    anomalyFlags: text("anomaly_flags").array().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("payments_mandate_idx").on(t.mandateId, t.createdAt)],
);

export const reservationStatus = pgEnum("reservation_status", ["held", "captured", "released"]);

export const reservations = pgTable(
  "reservations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    paymentId: uuid("payment_id").notNull().unique().references(() => payments.id),
    mandateId: uuid("mandate_id").notNull().references(() => mandates.id),
    runId: text("run_id"),
    amountCents: integer("amount_cents").notNull(),
    status: reservationStatus("status").notNull().default("held"),
    createdAt: createdAt(),
    settledAt: timestamp("settled_at", { withTimezone: true }),
  },
  (t) => [index("reservations_window_idx").on(t.mandateId, t.status, t.createdAt)],
);

export const approvalOutcome = pgEnum("approval_outcome", ["approved", "rejected", "expired"]);

export const approvals = pgTable("approvals", {
  id: uuid("id").primaryKey().defaultRandom(),
  paymentId: uuid("payment_id").notNull().unique().references(() => payments.id),
  // Only the hash is stored, so a database leak can't be replayed as approval links.
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  outcome: approvalOutcome("outcome"),
  createdAt: createdAt(),
});

export const ledgerEvents = pgTable(
  "ledger_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mandateId: uuid("mandate_id").notNull().references(() => mandates.id),
    mandateHash: text("mandate_hash").notNull(),
    paymentId: uuid("payment_id").references(() => payments.id),
    type: text("type").notNull(),
    amountCents: integer("amount_cents"),
    paypalResourceId: text("paypal_resource_id"),
    detail: jsonb("detail").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("ledger_events_mandate_idx").on(t.mandateId, t.createdAt)],
);

export const webhookEvents = pgTable("webhook_events", {
  id: text("id").primaryKey(),
  eventType: text("event_type").notNull(),
  resourceId: text("resource_id"),
  verified: boolean("verified").notNull(),
  payload: jsonb("payload").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  processedAt: timestamp("processed_at", { withTimezone: true }),
});

export const llmUsageStatus = pgEnum("llm_usage_status", ["reserved", "settled", "failed"]);

export const llmUsage = pgTable("llm_usage", {
  id: uuid("id").primaryKey().defaultRandom(),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  // A call reserves its worst-case cost before it runs, so concurrent calls can't jointly overshoot the cap.
  status: llmUsageStatus("status").notNull().default("reserved"),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costMicroUsd: bigint("cost_micro_usd", { mode: "number" }).notNull(),
  sessionId: text("session_id"),
  createdAt: createdAt(),
});
