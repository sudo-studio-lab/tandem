import { TandemError } from "./errors.ts";
import type { ChatImage } from "./agent.ts";

export const MAX_CHAT_IMAGES = 4;
export const MAX_CHAT_IMAGE_BYTES = 5 * 1024 * 1024;
export const CHAT_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

/** Both HTTP clients and restored drafts must pass the same limits. */
export function validateChatImages(value: unknown): ChatImage[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_CHAT_IMAGES) throw new TandemError("usage", `每則訊息最多 ${MAX_CHAT_IMAGES} 張圖片`);
  return value.map((image: unknown) => {
    if (!image || typeof image !== "object") throw new TandemError("usage", "圖片格式不正確");
    const { id, name, dataUrl } = image as ChatImage;
    if (typeof id !== "string" || !id || id.length > 100 || typeof name !== "string" || name.length > 255 || typeof dataUrl !== "string") {
      throw new TandemError("usage", "圖片格式不正確");
    }
    if (dataUrl.length > Math.ceil(MAX_CHAT_IMAGE_BYTES / 3) * 4 + 40) throw new TandemError("usage", "每張圖片不可超過 5 MB");
    const match = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
    if (!match || match[2]!.length % 4 !== 0) throw new TandemError("usage", "請貼上 PNG、JPEG、GIF 或 WebP 圖片");
    const encoded = match[2]!;
    const bytes = encoded.length * 3 / 4 - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
    if (bytes > MAX_CHAT_IMAGE_BYTES) throw new TandemError("usage", "每張圖片不可超過 5 MB");
    return { id, name, dataUrl };
  });
}
