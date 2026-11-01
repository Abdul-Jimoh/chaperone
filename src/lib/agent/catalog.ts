import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Channel3 } from "@channel3/sdk";
import { sha256Hex } from "@/lib/policy/canonical";

/** A product as the agent sees it. Every text field came from a third party and is untrusted. */
export type Listing = {
  productId: string;
  title: string;
  description: string;
  priceCents: number;
  /** Channel3's own category slug, e.g. "non-prescription-dog-food". */
  sourceCategory: string | null;
};

export type ProductSearch = (query: string, limit: number) => Promise<Listing[]>;

const DESCRIPTION_CHARS = 300;

export function channel3Search(client: Channel3): ProductSearch {
  return async (query, limit) => {
    const page = await client.products.search({ query, limit, config: { country: "US", currency: "USD" } });
    return page.data.flatMap((p) => {
      const offer = p.offers?.find((o) => o.price.currency === "USD" && o.availability === "InStock");
      if (!offer || !(offer.price.price > 0)) return [];
      return [
        {
          productId: p.id,
          title: p.title.slice(0, 200),
          description: (p.description ?? "").slice(0, DESCRIPTION_CHARS),
          priceCents: Math.round(offer.price.price * 100),
          sourceCategory: p.category?.slug ?? null,
        },
      ];
    });
  };
}

function searchKey(query: string, limit: number): string {
  return sha256Hex(`${query.trim().toLowerCase()}|${limit}`).slice(0, 16);
}

/** Saves live results so tests and replays never call Channel3. */
export function recordingSearch(inner: ProductSearch, dir: string): ProductSearch {
  return async (query, limit) => {
    const listings = await inner(query, limit);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${searchKey(query, limit)}.json`), `${JSON.stringify({ query, limit, listings }, null, 2)}\n`);
    return listings;
  };
}

export class MissingSearchFixtureError extends Error {}

export function replaySearch(dir: string): ProductSearch {
  return async (query, limit) => {
    try {
      return JSON.parse(readFileSync(join(dir, `${searchKey(query, limit)}.json`), "utf8")).listings as Listing[];
    } catch {
      throw new MissingSearchFixtureError(`No recorded Channel3 results for "${query}" (limit ${limit})`);
    }
  };
}
