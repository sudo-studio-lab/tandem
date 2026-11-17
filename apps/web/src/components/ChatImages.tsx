import { useState } from "react";
import type { ChatImage } from "@tandem/contracts";
import { Modal } from "./ui.tsx";

export function ChatImages({ images, onRemove }: { images: ChatImage[]; onRemove?: (id: string) => void }) {
  const [preview, setPreview] = useState<ChatImage | null>(null);
  if (!images.length) return null;
  return <>
    <div className="chat-images">
      {images.map((image) => <div className="chat-image" key={image.id}>
        <button type="button" className="chat-image-open" aria-label={`查看圖片 ${image.name}`} onClick={() => setPreview(image)}>
          <img src={image.dataUrl} alt={image.name || "對話圖片"} loading="lazy" />
        </button>
        {onRemove && <button type="button" className="chat-image-remove" aria-label={`移除圖片 ${image.name}`} onClick={() => onRemove(image.id)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
        </button>}
        <span className="small chat-image-name" title={image.name}>{image.name}</span>
      </div>)}
    </div>
    {preview && <Modal title={preview.name || "對話圖片"} onClose={() => setPreview(null)}>
      <img className="chat-image-preview" src={preview.dataUrl} alt={preview.name || "對話圖片"} />
      <a className="btn btn-small" href={preview.dataUrl} download={preview.name || "image.png"}>下載圖片</a>
    </Modal>}
  </>;
}
