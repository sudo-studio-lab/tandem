import { useEffect, useRef, useState, type ReactNode } from "react";

/** Native <dialog>: focus trap, Escape and backdrop come for free. */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-body">
        <div className="modal-head">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="btn btn-small" onClick={onClose} aria-label="關閉">
            ✕
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}

/** Copy text to the clipboard; `copied` is true for 2 s afterwards. */
export function useCopy() {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setFailed(true);
    }
  };
  return { copied, failed, copy };
}

export function Spinner({ label }: { label: string }) {
  return (
    <p className="muted loading" role="status">
      <span className="spin" aria-hidden="true" /> {label}
    </p>
  );
}

export const errMsg = (e: unknown) => (e instanceof Error ? e.message : String(e));
