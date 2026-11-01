export type Money = { currency_code: string; value: string };

export function money(cents: number, currency = "USD"): Money {
  if (!Number.isInteger(cents) || cents < 0) throw new Error(`invalid amount in cents: ${cents}`);
  return { currency_code: currency, value: (cents / 100).toFixed(2) };
}

export function toCents(m: Money): number {
  const [whole, frac = ""] = m.value.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0").slice(0, 2));
}
