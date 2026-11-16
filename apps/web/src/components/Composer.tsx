import { useRef, useState, type ReactNode } from "react";
import type { ChatImage } from "@tandem/contracts";
import { CHAT_IMAGE_TYPES, MAX_CHAT_IMAGES, MAX_CHAT_IMAGE_BYTES, validateChatImages } from "../../../../packages/contracts/src/images.ts";
import { useDraft } from "../drafts.ts";
import { ChatImages } from "./ChatImages.tsx";
import { errMsg } from "./ui.tsx";

export type SendMode = "send" | "steer" | "queue";
const readImage = (file: File) => new Promise<ChatImage>((resolve, reject) => {
  const reader = new FileReader();
  reader.onload = () => resolve({ id: crypto.randomUUID(), name: file.name || "貼上的圖片.png", dataUrl: String(reader.result) });
  reader.onerror = () => reject(new Error("讀不到圖片，請再貼上一次"));
  reader.readAsDataURL(file);
});

export function Composer({ draftKey, running, supportsSteer, supportsImages, disabled, toolbar, queue, onSend, onStop, onError }: {
  draftKey: string; running: boolean; supportsSteer: boolean; supportsImages: boolean; disabled?: boolean;
  toolbar: ReactNode; queue: ReactNode;
  onSend(mode: SendMode, text: string, images: ChatImage[]): Promise<void>;
  onStop(): void; onError(message: string): void;
}) {
  const { draft, setDraft, ready, saving, error } = useDraft(draftKey);
  const [sending, setSending] = useState(false);
  const [reading, setReading] = useState(false);
  const busy = useRef(false);
  const picker = useRef<HTMLInputElement>(null);
  const canSend = ready && !disabled && !sending && !reading && (!!draft.text.trim() || draft.images.length > 0) && (supportsImages || !draft.images.length);
  const send = async (mode: SendMode) => {
    if (!canSend || busy.current || (mode === "steer" && (!running || !supportsSteer))) return;
    busy.current = true; setSending(true);
    const submitted = draft;
    try {
      await onSend(mode, submitted.text.trim(), submitted.images);
      setDraft((current) => current === submitted ? { text: "", images: [] } : current);
    } catch (e) { onError(errMsg(e)); }
    finally { busy.current = false; setSending(false); }
  };
  const addImages = async (files: File[]) => {
    if (!files.length) return;
    if (!supportsImages) { onError("這個 provider 目前未提供圖片輸入；可以切換到支援圖片的對話。"); return; }
    setReading(true);
    try {
      if (files.length + draft.images.length > MAX_CHAT_IMAGES) throw new Error(`每則訊息最多 ${MAX_CHAT_IMAGES} 張圖片`);
      for (const file of files) {
        if (!CHAT_IMAGE_TYPES.includes(file.type)) throw new Error("請選擇 PNG、JPEG、GIF 或 WebP 圖片");
        if (file.size > MAX_CHAT_IMAGE_BYTES) throw new Error("每張圖片不可超過 5 MB");
      }
      const images = await Promise.all(files.map(readImage));
      setDraft((current) => ({ ...current, images: validateChatImages([...current.images, ...images]) }));
    } catch (e) { onError(errMsg(e)); }
    finally { setReading(false); }
  };
  return <form className="chat-compose chat-compose-full" onSubmit={(e) => { e.preventDefault(); void send(running ? supportsSteer ? "steer" : "queue" : "send"); }}>
    <div className="compose-toolbar">
      {toolbar}
      <span className="muted small compose-saved" role="status">{error ? "草稿暫存異常" : !ready ? "載入草稿…" : saving ? "儲存草稿…" : draft.text || draft.images.length ? "草稿已保留" : ""}</span>
    </div>
    {queue}
    <div className="compose-editor">
      <ChatImages images={draft.images} onRemove={(id) => setDraft((current) => ({ ...current, images: current.images.filter((image) => image.id !== id) }))} />
      <textarea value={draft.text} rows={3} aria-label="訊息" disabled={!ready || sending}
        placeholder={running ? "工作中仍可補充指示，或排入下一則" : "輸入訊息，也可以直接貼上圖片"}
        onChange={(e) => setDraft((current) => ({ ...current, text: e.target.value }))}
        onPaste={(e) => { const files = [...e.clipboardData.items].filter((item) => item.kind === "file").map((item) => item.getAsFile()).filter((file): file is File => !!file); void addImages(files); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
            e.preventDefault(); void send(running ? e.ctrlKey || !supportsSteer ? "queue" : "steer" : "send");
          }
        }} />
    </div>
    {error && <p className="small banner banner-warn" role="alert">{error}</p>}
    {!!draft.images.length && !supportsImages && <p className="small banner banner-warn">目前模型無法接收圖片；附件仍保留在草稿。</p>}
    <div className="compose-actions">
      <input ref={picker} className="sr-only" type="file" accept={CHAT_IMAGE_TYPES.join(",")} multiple tabIndex={-1} aria-label="選擇圖片" onChange={(e) => { void addImages([...(e.target.files ?? [])]); e.target.value = ""; }} />
      <button type="button" className="btn btn-small" disabled={!ready || sending || reading || !supportsImages} onClick={() => picker.current?.click()}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m8 12 6-6a3 3 0 0 1 4 4l-8 8a5 5 0 0 1-7-7l9-9" /></svg>
        {reading ? "讀取圖片…" : "加入圖片"}
      </button>
      <span className="muted small compose-hint">Shift+Enter 換行{running && supportsSteer ? " · Ctrl+Enter 排隊" : ""}</span>
      <div className="compose-send-actions">
        {running ? <>
          {supportsSteer && <button type="button" className="btn btn-primary" disabled={!canSend} onClick={() => void send("steer")}>立即補充</button>}
          <button type="button" className={`btn${supportsSteer ? "" : " btn-primary"}`} disabled={!canSend} onClick={() => void send("queue")}>排入下一則</button>
          <button type="button" className="btn btn-danger" disabled={sending} onClick={onStop}>停止</button>
        </> : <button type="submit" className="btn btn-primary" disabled={!canSend}>{sending ? "送出中…" : "送出"}</button>}
      </div>
    </div>
    {running && !supportsSteer && <p className="muted small">此 provider 目前支援排隊；回覆完成後會依序送出。</p>}
  </form>;
}
