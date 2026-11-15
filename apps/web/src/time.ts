import { useEffect, useState } from "react";

/** Current time, re-evaluated every minute so relative times stay fresh. */
export function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function span(ms: number): string {
  const min = Math.floor(ms / 60_000);
  if (min < 1) return "不到 1 分鐘";
  if (min < 60) return `${min} 分鐘`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} 小時`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} 天`;
  const mon = Math.floor(day / 30);
  if (mon < 12) return `${mon} 個月`;
  return `${Math.floor(day / 365)} 年`;
}

/** "3 小時前" */
export function relTime(iso: string | undefined, now: number): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const ms = now - t;
  if (ms < 60_000) return "剛剛";
  return `${span(ms)}前`;
}

/** "等了 3 小時" */
export function waitedFor(iso: string, now: number): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  return `等了 ${span(Math.max(0, now - t))}`;
}
