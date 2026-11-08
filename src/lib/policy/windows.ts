import type { BudgetPeriod } from "./schema";

function zonedParts(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    weekday: "short",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return {
    year: Number(get("year")),
    month: Number(get("month")),
    day: Number(get("day")),
    hour: Number(get("hour")),
    minute: Number(get("minute")),
    second: Number(get("second")),
    weekday: get("weekday"),
  };
}

function offsetAt(instant: number, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(instant / 1000) * 1000;
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day);
  let instant = guess - offsetAt(guess, timeZone);
  // The offset at the guess can differ from the offset at local midnight across a DST change.
  instant = guess - offsetAt(instant, timeZone);
  return new Date(instant);
}

const WEEKDAY_INDEX: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/**
 * Start of the calendar window containing `now` in the mandate's time zone (weeks start Monday).
 * Returns null for "run", which is scoped by run id rather than time.
 */
export function windowStart(period: BudgetPeriod, now: Date, timeZone: string): Date | null {
  if (period === "run") return null;
  const p = zonedParts(now.getTime(), timeZone);
  if (period === "day") return zonedMidnight(p.year, p.month, p.day, timeZone);
  if (period === "month") return zonedMidnight(p.year, p.month, 1, timeZone);
  const back = WEEKDAY_INDEX[p.weekday]!;
  const monday = new Date(Date.UTC(p.year, p.month - 1, p.day - back));
  return zonedMidnight(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), timeZone);
}

/** The calendar date of `now` in the mandate's time zone, as YYYY-MM-DD. */
export function localDate(now: Date, timeZone: string): string {
  const p = zonedParts(now.getTime(), timeZone);
  return `${p.year}-${String(p.month).padStart(2, "0")}-${String(p.day).padStart(2, "0")}`;
}
