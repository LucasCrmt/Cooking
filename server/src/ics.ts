// A person's planned recipes as an iCalendar file (RFC 5545), for Google Calendar, Apple Calendar or Outlook:
// downloaded once (.ics), or followed through a private address that the calendar app refreshes.
//
// Each plan is an all-day event on its day ("Gyoza (dîner)"): plans are for a day and a meal,
// not a time. The event links to the recipe.

import { PUBLIC_URL } from "./config.ts";
import type { Plan } from "./plans.ts";

const MEAL_NAMES: Record<string, Record<string, string>> = {
  fr: { breakfast: "petit-déjeuner", lunch: "déjeuner", snack: "goûter", dinner: "dîner" },
  en: { breakfast: "breakfast", lunch: "lunch", snack: "snack", dinner: "dinner" },
};

/** Text values: backslash, semicolon, comma and newlines escaped. */
const text = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

/** Lines longer than 75 octets continue on the next line after a space (without cutting a character). */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let start = 0;
  while (start < bytes.length) {
    let end = Math.min(start + (parts.length ? 74 : 75), bytes.length);
    // Back up to a character boundary (UTF-8 continuation bytes are 10xxxxxx).
    while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
    parts.push(bytes.subarray(start, end).toString("utf8"));
    start = end;
  }
  return parts.join("\r\n ");
}

const dateValue = (day: string) => day.replace(/-/g, "");
const nextDay = (day: string) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const stamp = () => new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");

export function icsCalendar(plans: Plan[], opts: { name: string; lang: string }): string {
  const lang = opts.lang === "en" ? "en" : "fr";
  const host = new URL(PUBLIC_URL).hostname;
  const now = stamp();
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cooking//Calendar//FR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${text(opts.name)}`,
    // How often a subscribed calendar should come back (some apps listen).
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H",
  ];
  for (const p of plans) {
    const meal = p.meal ? MEAL_NAMES[lang][p.meal] : "";
    const url = `${PUBLIC_URL}/r/${p.recipeId}`;
    const description = [p.note, url].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      `UID:plan-${p.id}@${host}`,
      `DTSTAMP:${now}`,
      `DTSTART;VALUE=DATE:${dateValue(p.day)}`,
      `DTEND;VALUE=DATE:${dateValue(nextDay(p.day))}`,
      `SUMMARY:${text(meal ? `${p.title} (${meal})` : p.title)}`,
      `DESCRIPTION:${text(description)}`,
      `URL:${url}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}
