import { z } from "zod";

// Hard ceiling so a mis-compiled mandate can never authorise more than this per purchase or window.
export const MAX_CENTS = 1_000_000;

const cents = z.number().int().nonnegative().max(MAX_CENTS);
const positiveCents = cents.positive();

export const categorySlug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase-hyphenated slug")
  .max(40);

export const merchantId = z.string().regex(/^[A-Z0-9]{10,20}$/, "PayPal merchant ID");

function isTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export const BUDGET_PERIODS = ["run", "day", "week", "month"] as const;
export type BudgetPeriod = (typeof BUDGET_PERIODS)[number];

export const budgetWindowSchema = z.strictObject({
  period: z.enum(BUDGET_PERIODS),
  limitCents: positiveCents,
});

export const policySchema = z
  .strictObject({
    version: z.literal(1),
    currency: z.literal("USD"),
    timezone: z.string().refine(isTimeZone, "IANA time zone"),
    perTransactionCapCents: positiveCents,
    // Purchases strictly above this total need a human tap; null means never ask.
    approvalThresholdCents: cents.nullable(),
    budgets: z.array(budgetWindowSchema).max(BUDGET_PERIODS.length),
    merchants: z
      .array(z.strictObject({ merchantId, name: z.string().trim().min(1).max(80) }))
      .min(1)
      .max(20),
    // Empty means any category.
    categories: z.array(categorySlug).max(20),
    maxQuantityPerItem: z.number().int().positive().max(1000).nullable(),
    schedule: z
      .strictObject({ every: z.number().int().min(1).max(365), unit: z.enum(["day", "week", "month"]) })
      .nullable(),
    expiresAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .superRefine((p, ctx) => {
    const periods = p.budgets.map((b) => b.period);
    if (new Set(periods).size !== periods.length) {
      ctx.addIssue({ code: "custom", path: ["budgets"], message: "one budget per period" });
    }
    const ids = p.merchants.map((m) => m.merchantId);
    if (new Set(ids).size !== ids.length) {
      ctx.addIssue({ code: "custom", path: ["merchants"], message: "duplicate merchant" });
    }
    if (new Set(p.categories).size !== p.categories.length) {
      ctx.addIssue({ code: "custom", path: ["categories"], message: "duplicate category" });
    }
  });

export type Policy = z.infer<typeof policySchema>;

export const cartItemSchema = z.strictObject({
  productId: z.string().max(200).optional(),
  title: z.string().trim().min(1).max(300),
  unitPriceCents: positiveCents,
  quantity: z.number().int().positive().max(10_000),
  category: categorySlug.nullable(),
});

export const cartSchema = z.strictObject({
  payeeMerchantId: merchantId,
  currency: z.string().length(3),
  items: z.array(cartItemSchema).min(1).max(50),
  shippingCents: cents.default(0),
  taxCents: cents.default(0),
});

export type CartItem = z.infer<typeof cartItemSchema>;
export type Cart = z.infer<typeof cartSchema>;
