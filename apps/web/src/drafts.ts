import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { ChatImage } from "@tandem/contracts";

export interface Draft { text: string; images: ChatImage[] }
interface Entry { draft: Draft; ready: boolean; saving?: boolean; error?: string }
const entries = new Map<string, Entry>();
const listeners = new Map<string, Set<() => void>>();
const loads = new Map<string, Promise<void>>();
const saves = new Map<string, Promise<void>>();
const revisions = new Map<string, number>();
const textKey = (key: string) => `tandem:draft:${key}`;

function entry(key: string): Entry {
  let e = entries.get(key);
  if (!e) {
    let text = "";
    try { text = localStorage.getItem(textKey(key)) ?? ""; } catch { /* memory still works */ }
    e = { draft: { text, images: [] }, ready: false };
    entries.set(key, e);
  }
  return e;
}

function publish(key: string, e: Entry) {
  entries.set(key, e);
  listeners.get(key)?.forEach((f) => f());
}

let database: Promise<IDBDatabase> | undefined;
function db(): Promise<IDBDatabase> {
  database ??= new Promise((resolve, reject) => {
    const request = indexedDB.open("tandem-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => { request.result.onversionchange = () => request.result.close(); resolve(request.result); };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error("草稿儲存空間暫時無法開啟"));
  });
  return database;
}

async function read(key: string): Promise<Draft | undefined> {
  const database = await db();
  return new Promise((resolve, reject) => {
    const request = database.transaction("drafts").objectStore("drafts").get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function write(key: string, draft: Draft) {
  const database = await db();
  return new Promise<void>((resolve, reject) => {
    const tx = database.transaction("drafts", "readwrite");
    const store = tx.objectStore("drafts");
    if (draft.text || draft.images.length) store.put(draft, key);
    else store.delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function load(key: string): Promise<void> {
  if (!loads.has(key)) {
    const before = entry(key);
    loads.set(key, read(key).then((stored) => {
      const current = entry(key);
      // A late read must never replace typing or a paste that happened while loading.
      publish(key, { ...current, ready: true, draft: stored && current.draft.images === before.draft.images
        ? { text: current.draft.text, images: stored.images }
        : current.draft });
    }).catch(() => publish(key, { ...entry(key), ready: true, error: "無法將草稿存到磁碟；離開分頁後仍可恢復，關閉程式後圖片可能遺失。" })));
  }
  return loads.get(key)!;
}

export function updateDraft(key: string, update: Draft | ((d: Draft) => Draft)) {
  const current = entry(key);
  const draft = typeof update === "function" ? update(current.draft) : update;
  let textSaved = true;
  try {
    if (draft.text) localStorage.setItem(textKey(key), draft.text);
    else localStorage.removeItem(textKey(key));
  } catch { textSaved = false; }
  // Text is saved synchronously. Avoid rewriting megabytes of unchanged images per keystroke.
  if (textSaved && draft.images === current.draft.images) { publish(key, { ...current, draft }); return; }
  const revision = (revisions.get(key) ?? 0) + 1;
  revisions.set(key, revision);
  publish(key, { ...current, draft, saving: true });
  // Serialize writes for each conversation, including clears after sending.
  const pending = (saves.get(key) ?? Promise.resolve()).then(() => write(key, draft)).then(() => {
    if (revisions.get(key) === revision) publish(key, { ...entry(key), saving: false, error: undefined });
  }).catch(() => {
    if (revisions.get(key) === revision) publish(key, { ...entry(key), saving: false, error: "草稿未能存到磁碟，請先保留內容再關閉程式。" });
  });
  saves.set(key, pending);
}

export function useDraft(key: string) {
  const subscribe = useCallback((f: () => void) => {
    const set = listeners.get(key) ?? new Set();
    listeners.set(key, set);
    set.add(f);
    return () => { set.delete(f); };
  }, [key]);
  const snapshot = useCallback(() => entry(key), [key]);
  const state = useSyncExternalStore(subscribe, snapshot);
  useEffect(() => { void load(key); }, [key]);
  const setDraft = useCallback((update: Draft | ((d: Draft) => Draft)) => updateDraft(key, update), [key]);
  return { ...state, setDraft };
}
