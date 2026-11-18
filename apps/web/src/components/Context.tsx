/**
 * 脈絡: the team's shared context folder (tandem/context/ in the data repo). Everyone and every
 * agent can read and write it. Laid out for a narrow side panel: a list, then one file at a time.
 */
import { useCallback, useEffect, useState } from "react";
import type { ContextConflict, ContextFile, ContextFileInfo, ContextWriteResult } from "@tandem/contracts";
import {
  CONTEXT_IMAGE_TYPES,
  CONTEXT_MAX_BYTES,
  CONTEXT_NOTES,
  CONTEXT_TEXT_TYPES,
  contextConflictMessage,
  contextKind,
  validateContextPath,
} from "../../../../packages/contracts/src/context.ts";
import { ApiError, api, projectPath } from "../api.ts";
import { relTime } from "../time.ts";
import { MarkdownLite, Spinner, errMsg } from "./ui.tsx";
import { PageBar } from "./PageBar.tsx";

const ACCEPT = [...Object.keys(CONTEXT_TEXT_TYPES), ...Object.keys(CONTEXT_IMAGE_TYPES)].join(",");
const MAX_MB = CONTEXT_MAX_BYTES / 1024 / 1024;

const size = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);
const utf8Bytes = (s: string) => new TextEncoder().encode(s).length;
const isConflict = (e: unknown): e is ApiError => e instanceof ApiError && e.code === "conflict";
const conflictBy = (e: ApiError) => (e.details as ContextConflict | undefined)?.by;

function meta(f: ContextFileInfo, now: number): string {
  return [f.by ? `@${f.by}` : "", relTime(f.at, now), size(f.size), f.pending ? "還沒同步" : ""].filter(Boolean).join(" · ");
}

function imageSrc(f: ContextFile): string | null {
  if (f.kind === "image") return `data:${f.mime};base64,${f.content}`;
  if (f.mime === "image/svg+xml") return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(f.content)}`;
  return null;
}

/** File content: Markdown, an image (SVG included; shown with <img>, so scripts never run), or plain text. */
function Body({ file }: { file: ContextFile }) {
  const src = imageSrc(file);
  if (src) return <img className="ctx-img" src={src} alt={file.path} />;
  if (!file.content.trim()) return <p className="muted small">（空的檔案）</p>;
  if (file.path.toLowerCase().endsWith(".md")) return <MarkdownLite className="ctx-md" text={file.content} />;
  return <pre className="ctx-pre">{file.content}</pre>;
}

function readUpload(f: File): Promise<{ content: string; encoding: "utf8" | "base64" }> {
  const kind = contextKind(f.name.toLowerCase())?.kind;
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = () => reject(new Error("讀不到這個檔案"));
    if (kind === "image") {
      r.onload = () => resolve({ content: String(r.result).replace(/^data:[^,]*,/, ""), encoding: "base64" });
      r.readAsDataURL(f);
    } else {
      r.onload = () => resolve({ content: String(r.result), encoding: "utf8" });
      r.readAsText(f);
    }
  });
}

/** Spaces and other odd characters become "-", so uploaded names pass the path rules. */
const cleanName = (name: string) => name.trim().replace(/[^\p{L}\p{N}._/-]+/gu, "-").replace(/^[-.]+/, "");

function NewFile({ projectId, initialName, onDone, onCancel }: { projectId: string; initialName: string; onDone: (path: string) => void; onCancel: () => void }) {
  const [name, setName] = useState(initialName);
  const [text, setText] = useState("");
  const [upload, setUpload] = useState<{ name: string; content: string; encoding: "utf8" | "base64" } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const image = upload?.encoding === "base64";

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setError(null);
    if (f.size > CONTEXT_MAX_BYTES) return setError(`檔案太大，每個檔案最多 ${MAX_MB} MB`);
    if (!contextKind(f.name.toLowerCase())) return setError(`只收 ${ACCEPT.replaceAll(",", " ")}`);
    try {
      const r = await readUpload(f);
      if (r.encoding === "utf8") {
        setText(r.content);
        setUpload(null);
      } else setUpload({ name: f.name, ...r });
      if (!name.trim()) setName(cleanName(f.name));
    } catch (e) {
      setError(errMsg(e));
    }
  };

  const save = async () => {
    setError(null);
    let path: string;
    try {
      path = validateContextPath(name);
    } catch (e) {
      return setError(errMsg(e));
    }
    const kind = contextKind(path)?.kind;
    if (kind === "image" && !image) return setError("圖片請用「上傳檔案」");
    if (kind === "text" && image) return setError("上傳的是圖片，檔名要用 .png .jpg .gif .webp");
    if (!image && utf8Bytes(text) > CONTEXT_MAX_BYTES) return setError(`檔案太大，每個檔案最多 ${MAX_MB} MB`);
    setSaving(true);
    try {
      await api<ContextWriteResult>("PUT", projectPath(projectId, "/context/file"), {
        path,
        content: image ? upload!.content : text,
        encoding: image ? "base64" : "utf8",
        expectVersion: null,
      });
      onDone(path);
    } catch (e) {
      setError(isConflict(e) ? "已經有叫這個名字的檔案了。換個名字，或打開那個檔案來改。" : errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="card pad ctx-form">
      <h3 className="ctx-name">新增檔案</h3>
      <label>
        檔名
        <input className="input full" value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 specs/api.md" autoFocus />
      </label>
      <p className="muted small">
        可以放在資料夾裡（最多 3 層）。文字：.md .txt .json .csv .svg .mmd；圖片：.png .jpg .gif .webp。每個最多 {MAX_MB} MB。
      </p>
      {image ? (
        <p className="ctx-upload">
          <img className="ctx-thumb" src={`data:${contextKind(upload!.name.toLowerCase())?.mime};base64,${upload!.content}`} alt="" />
          <span className="grow small">{upload!.name}</span>
          <button type="button" className="btn btn-small btn-quiet" onClick={() => setUpload(null)}>
            拿掉
          </button>
        </p>
      ) : (
        <label>
          內容
          <textarea className="input full ctx-editor" rows={10} value={text} onChange={(e) => setText(e.target.value)} />
        </label>
      )}
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      <div className="ctx-buttons">
        <label className="btn btn-small ctx-pick">
          上傳檔案
          <input type="file" accept={ACCEPT} className="sr-only" onChange={(e) => void pick(e.target.files?.[0])} />
        </label>
        <span className="spacer" />
        <button type="button" className="btn btn-quiet" onClick={onCancel} disabled={saving}>
          取消
        </button>
        <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={saving || !name.trim()}>
          {saving ? "建立中…" : "建立"}
        </button>
      </div>
    </div>
  );
}

function FileView({
  projectId,
  path,
  now,
  onBack,
  onChanged,
}: {
  projectId: string;
  path: string;
  now: number;
  onBack: () => void;
  onChanged: () => void;
}) {
  const [file, setFile] = useState<ContextFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [lostDraft, setLostDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [conflict, setConflict] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const f = await api<ContextFile>("GET", projectPath(projectId, `/context/file?path=${encodeURIComponent(path)}`));
      setFile(f);
      return f;
    } catch (e) {
      setLoadError(errMsg(e));
      return null;
    }
  }, [projectId, path]);

  useEffect(() => {
    void load();
  }, [load]);

  const startEdit = () => {
    if (!file) return;
    setDraft(file.content);
    setLostDraft(null);
    setError(null);
    setConflict(null);
    setEditing(true);
  };

  const reload = async () => {
    const mine = draft;
    const f = await load();
    setConflict(null);
    if (f && editing) {
      setDraft(f.content);
      if (mine !== f.content) setLostDraft(mine);
    }
  };

  const save = async () => {
    if (!file) return;
    setError(null);
    if (utf8Bytes(draft) > CONTEXT_MAX_BYTES) return setError(`檔案太大，每個檔案最多 ${MAX_MB} MB`);
    setBusy(true);
    try {
      await api<ContextWriteResult>("PUT", projectPath(projectId, "/context/file"), {
        path: file.path,
        content: draft,
        expectVersion: file.version,
      });
      setEditing(false);
      setLostDraft(null);
      await load();
      onChanged();
    } catch (e) {
      if (isConflict(e)) setConflict(contextConflictMessage(conflictBy(e)));
      else setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!file) return;
    if (!confirm(`刪除 ${file.path}？隊友那邊也會一起不見。`)) return;
    setError(null);
    setBusy(true);
    try {
      await api("DELETE", projectPath(projectId, `/context/file?path=${encodeURIComponent(file.path)}&expectVersion=${file.version}`));
      onChanged();
      onBack();
    } catch (e) {
      if (isConflict(e)) setConflict(contextConflictMessage(conflictBy(e)));
      else setError(errMsg(e));
    } finally {
      setBusy(false);
    }
  };

  const text = file?.kind === "text";
  return (
    <>
      <PageBar back="脈絡" onBack={onBack} />
      {!file ? (
        loadError ? (
          <p className="banner banner-error" role="alert">
            {loadError}{" "}
            <button type="button" className="btn btn-small" onClick={() => void load()}>
              再試一次
            </button>
          </p>
        ) : (
          <Spinner label="載入中…" />
        )
      ) : (
        <article className="card pad ctx-file">
          <header className="ctx-head">
            <div className="grow">
              <h3 className="ctx-name">{file.path}</h3>
              <p className="row-meta">{meta(file, now)}</p>
            </div>
            {!editing && (
              <div className="ctx-buttons">
                {text && (
                  <button type="button" className="btn btn-small" onClick={startEdit} disabled={busy}>
                    編輯
                  </button>
                )}
                <button type="button" className="btn btn-small btn-danger" onClick={() => void remove()} disabled={busy}>
                  刪除
                </button>
              </div>
            )}
          </header>
          {conflict && (
            <p className="banner banner-error ctx-conflict" role="alert">
              {conflict}{" "}
              <button type="button" className="btn btn-small" onClick={() => void reload()}>
                重新載入
              </button>
            </p>
          )}
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          {editing ? (
            <>
              <textarea
                className="input full ctx-editor"
                rows={16}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                aria-label={`編輯 ${file.path}`}
                autoFocus
              />
              {lostDraft !== null && (
                <details className="more">
                  <summary>你剛才改的內容</summary>
                  <textarea className="input full ctx-editor" rows={8} value={lostDraft} readOnly aria-label="你剛才改的內容" />
                </details>
              )}
              <div className="ctx-buttons ctx-buttons-end">
                <button type="button" className="btn btn-quiet" onClick={() => setEditing(false)} disabled={busy}>
                  取消
                </button>
                <button type="button" className="btn btn-primary" onClick={() => void save()} disabled={busy || !!conflict}>
                  {busy ? "儲存中…" : "儲存"}
                </button>
              </div>
            </>
          ) : (
            <Body file={file} />
          )}
        </article>
      )}
    </>
  );
}

export function ContextPage({ projectId, now, onBack }: { projectId: string; now: number; onBack: () => void }) {
  const [files, setFiles] = useState<ContextFileInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      setFiles(await api<ContextFileInfo[]>("GET", projectPath(projectId, "/context")));
    } catch (e) {
      setError(errMsg(e));
    }
  }, [projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  if (open) {
    return (
      <div className="tb-log ctx">
        <FileView projectId={projectId} path={open} now={now} onBack={() => setOpen(null)} onChanged={() => void load()} />
      </div>
    );
  }

  const hasNotes = !!files?.some((f) => f.path === CONTEXT_NOTES);
  return (
    <div className="tb-log ctx">
      <PageBar title="脈絡" titleId="ctx-title" onBack={onBack} />
      <section className="panel-block" aria-labelledby="ctx-title">
        <div className="ctx-intro">
          <p className="muted small grow">背景、規格和圖，隊友和大家的 AI 都讀得到。不要放金鑰或密碼。</p>
          {creating === null && (
            <button type="button" className="btn btn-small" onClick={() => setCreating("")}>
              新增檔案
            </button>
          )}
        </div>
        {creating !== null && (
          <NewFile
            projectId={projectId}
            initialName={creating}
            onCancel={() => setCreating(null)}
            onDone={(p) => {
              setCreating(null);
              void load();
              setOpen(p);
            }}
          />
        )}
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}{" "}
            <button type="button" className="btn btn-small" onClick={() => void load()}>
              再試一次
            </button>
          </p>
        ) : !files ? (
          <Spinner label="載入中…" />
        ) : files.length === 0 ? (
          creating === null && (
            <div className="card pad ctx-empty">
              <p className="muted">還沒有檔案。先寫一份 {CONTEXT_NOTES}，放專案背景、架構和需求。</p>
              <button type="button" className="btn btn-primary btn-small" onClick={() => setCreating(CONTEXT_NOTES)}>
                建立 {CONTEXT_NOTES}
              </button>
            </div>
          )
        ) : (
          <>
            <ul className="rows card ctx-list">
              {files.map((f) => (
                <li key={f.path}>
                  <button type="button" className="ctx-row" onClick={() => setOpen(f.path)}>
                    <span className="ctx-row-name">
                      <span className="row-title">{f.path}</span>
                      {f.path === CONTEXT_NOTES && <span className="tag">置頂</span>}
                      {f.kind === "image" && <span className="tag">圖片</span>}
                    </span>
                    <span className="row-meta">{meta(f, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {!hasNotes && creating === null && (
              <p className="muted small">
                還沒有 {CONTEXT_NOTES}。{" "}
                <button type="button" className="tb-link" onClick={() => setCreating(CONTEXT_NOTES)}>
                  建立一份
                </button>
              </p>
            )}
          </>
        )}
      </section>
    </div>
  );
}
