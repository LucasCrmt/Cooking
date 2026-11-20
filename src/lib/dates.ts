// Days as plain "YYYY-MM-DD" strings in local time: a dinner is planned for a day, not an instant.

export type Day = string;

const pad = (n: number) => String(n).padStart(2, "0");

export const toDay = (d: Date): Day => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "2026-11-26" → that day at local midnight. */
export function fromDay(day: Day): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export const today = (): Day => toDay(new Date());

export const isDay = (s: unknown): s is Day => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(fromDay(s).getTime());
