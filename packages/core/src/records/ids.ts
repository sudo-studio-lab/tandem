import { randomInt } from "node:crypto";

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Local-time YYYY-MM-DD. */
export function localDateString(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}`;
}

/** Local-time ISO 8601 with offset, e.g. 2026-11-15T16:00:00+08:00. */
export function localIsoString(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  const off = -date.getTimezoneOffset();
  const sign = off >= 0 ? "+" : "-";
  const abs = Math.abs(off);
  return (
    `${localDateString(date)}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}` +
    `${sign}${p(Math.floor(abs / 60))}:${p(abs % 60)}`
  );
}

/** D-YYYYMMDD-xxxx with a random 4-char base36 suffix; retries while `isTaken` says the id exists. */
export function generateDecisionId(date: Date, isTaken: (id: string) => boolean): string {
  const ymd = localDateString(date).replaceAll("-", "");
  for (let attempt = 0; attempt < 10_000; attempt++) {
    let suffix = "";
    for (let i = 0; i < 4; i++) suffix += ALPHABET[randomInt(ALPHABET.length)];
    const id = `D-${ymd}-${suffix}`;
    if (!isTaken(id)) return id;
  }
  throw new Error("無法產生不重複的決定編號");
}

/** Local Date at midnight for the YYYYMMDD part of a decision id (or undefined). */
export function dateFromId(id: string): Date | undefined {
  const m = /^D-(\d{4})(\d{2})(\d{2})-/.exec(id);
  if (!m) return undefined;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** ASCII lowercase-hyphen slug; null when nothing usable remains (e.g. Chinese-only titles). */
export function slugify(title: string): string | null {
  const s = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return s === "" ? null : s;
}
