import { z } from "zod";
import type { Llm } from "@/lib/llm/llm";

/** Listings that are none of the allowed categories get this slug, which no mandate allows. */
export const OUTSIDE = "other";

export type Classifiable = { id: string; title: string; sourceCategory: string | null };

const SYSTEM = `You sort products into a shopper's allowed categories.
For each product, answer with the allowed category it plainly is, "${OUTSIDE}" if it is clearly none of them, or "unsure" if you can't tell.
A product only belongs to a category if it is that thing itself, not an accessory, container or tool for it (a coffee canister is not coffee).`;

/**
 * Claude's third job. It sees titles and Channel3's own category, never descriptions, so text planted
 * in a listing can't argue its way into a category. The answer is a soft signal (D8): "unsure" makes
 * the evaluator ask the user, and no category can lift a cap or the payee allowlist.
 */
export async function classifyListings(
  llm: Llm,
  listings: Classifiable[],
  categories: string[],
): Promise<Map<string, string | null>> {
  const result = new Map<string, string | null>();
  if (!listings.length || !categories.length) return result;

  const ids = listings.map((l) => l.id) as [string, ...string[]];
  const schema = z.object({
    products: z.array(z.object({ id: z.enum(ids), category: z.enum([OUTSIDE, "unsure", ...categories]) })),
  });
  const lines = listings.map((l) => `${l.id}: ${l.title} [source category: ${l.sourceCategory ?? "none"}]`).join("\n");
  const { data } = await llm.structured("classify", schema, {
    max_tokens: 2000,
    effort: "low",
    system: SYSTEM,
    messages: [{ role: "user", content: `Allowed categories: ${categories.join(", ")}\n\nProducts:\n${lines}` }],
  });

  for (const { id, category } of data.products) result.set(id, category === "unsure" ? null : category);
  return result;
}
