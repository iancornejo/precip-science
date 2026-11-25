// Times for the map: UTC first (as meteorologists read them), local time second.

const pad = (n: number) => String(n).padStart(2, "0");
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function utcClock(t: number): string {
  const d = new Date(t);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
}

export function utcDay(t: number): string {
  const d = new Date(t);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

const localFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
export function localClock(t: number): string {
  return localFmt.format(new Date(t));
}

/** "3 min ago", "1 h 20 min ago". */
export function ago(t: number, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - t) / 60e3));
  if (min < 1) return "just now";
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h} h ${m} min ago` : `${h} h ago`;
}

/** Geom has no tabular figures: wrap each digit so a changing clock doesn't jitter (base.css .fixed-digits). */
export function fixedDigits(s: string): string {
  return s.replace(/[0-9]/g, (d) => `<span>${d}</span>`);
}

/** The full stamp: "17:02 UTC · 10:02 AM MST", with the date when it isn't today (UTC). */
export function stamp(t: number, now = Date.now()): { html: string; text: string; local: string } {
  const sameDay = utcDay(t) === utcDay(now);
  const day = sameDay ? "" : `${utcDay(t)}, `;
  const text = `${day}${utcClock(t)} UTC · ${localClock(t)}`;
  const html = `${day}<span class="fixed-digits">${fixedDigits(utcClock(t))}</span> UTC<span class="map-local"> · ${localClock(t)}</span>`;
  return { html, text, local: localClock(t) };
}
