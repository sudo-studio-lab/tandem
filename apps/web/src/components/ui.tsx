import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

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

/** Just enough Markdown for notes: headings, bullets, paragraphs and ``` code blocks. Never renders HTML. */
/** **bold** and `code` inside one line; everything else stays plain text. */
function inline(line: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /\*\*([^*\n]+?)\*\*|`([^`\n]+)`/g;
  let last = 0;
  for (let m = re.exec(line); m; m = re.exec(line)) {
    if (m.index > last) out.push(line.slice(last, m.index));
    out.push(m[1] !== undefined ? <strong key={m.index}>{m[1]}</strong> : <code key={m.index}>{m[2]}</code>);
    last = m.index + m[0].length;
  }
  if (last < line.length) out.push(line.slice(last));
  return out;
}

export function MarkdownLite({ text, className }: { text: string; className?: string }) {
  const out: ReactNode[] = [];
  const lines = text.split("\n");
  // A blank line starts a new paragraph: the next block gets a little more room above it.
  let gap = false;
  const cls = (base?: string) => [base, gap && out.length ? "notes-gap" : ""].filter(Boolean).join(" ") || undefined;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (/^\s*```/.test(line)) {
      const code: string[] = [];
      while (i + 1 < lines.length && !/^\s*```/.test(lines[i + 1]!)) code.push(lines[++i]!);
      i++;
      out.push(<pre key={i} className={cls("notes-code")}>{code.join("\n")}</pre>);
      gap = false;
      continue;
    }
    if (!line.trim()) {
      gap = true;
      continue;
    }
    const h = /^#{1,6}\s+(.*)$/.exec(line);
    const ol = /^\s*(\d+)\.\s+(.*)$/.exec(line);
    const ul = /^\s*[-*•]\s+(.*)$/.exec(line);
    if (h) out.push(<h4 key={i} className={cls()}>{inline(h[1]!)}</h4>);
    else if (ol) out.push(<p key={i} className={cls("notes-li notes-ol")} data-n={`${ol[1]}.`}>{inline(ol[2]!)}</p>);
    else if (ul) out.push(<p key={i} className={cls("notes-li")}>{inline(ul[1]!)}</p>);
    else out.push(<p key={i} className={cls()}>{inline(line)}</p>);
    gap = false;
  }
  return <div className={`notes${className ? ` ${className}` : ""}`}>{out}</div>;
}

const HUES = [210, 150, 25, 280, 340, 190, 45, 110];
/** Initial in a colored circle; the color is stable per login. */
export function Avatar({ login, size = 32 }: { login: string; size?: number }) {
  let h = 0;
  for (const c of login) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const hue = HUES[h % HUES.length];
  return (
    <span
      className="avatar"
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.45, "--hue": hue } as CSSProperties}
    >
      {login.slice(0, 1).toUpperCase()}
    </span>
  );
}
