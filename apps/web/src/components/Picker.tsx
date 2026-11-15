import { useEffect, useState, type FormEvent } from "react";
import type { AppSession, Invitation, OwnerChoice, RepoChoice } from "@tandem/contracts";
import { api } from "../api.ts";
import { relTime } from "../time.ts";
import { Spinner, errMsg } from "./ui.tsx";

export type StartOp = (start: () => Promise<{ opId: string }>, withAccept: boolean) => void;

interface Props {
  session: AppSession;
  /** "owner/name" from ?join= */
  hint: string | null;
  now: number;
  onStart: StartOp;
  onOpenFolder: (path: string) => Promise<void>;
  onBack?: () => void;
}

const REPO_NAME_RE = /^[A-Za-z0-9._-]+$/;

function Invitations({ hint, login, now, onStart }: { hint: string | null; login: string | null; now: number; onStart: StartOp }) {
  const [items, setItems] = useState<Invitation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    const q = hint ? `?hint=${encodeURIComponent(hint)}` : "";
    const lc = hint?.toLowerCase();
    const isHinted = (i: Invitation) => i.hinted ?? i.repo.fullName.toLowerCase() === lc;
    api<Invitation[]>("GET", `/api/invitations${q}`)
      .then((list) => {
        if (!stop) setItems([...list].sort((a, b) => Number(isHinted(b)) - Number(isHinted(a))));
      })
      .catch((e) => !stop && setError(errMsg(e)));
    return () => {
      stop = true;
    };
  }, [hint]);

  return (
    <section className="section" aria-labelledby="h-inv">
      <h2 id="h-inv">邀請你的專案</h2>
      {error ? (
        <p className="banner banner-error" role="alert">
          {error}
        </p>
      ) : !items ? (
        <Spinner label="找邀請中…" />
      ) : items.length === 0 ? (
        <p className="card pad muted">還沒有人邀請你。請隊友在 Tandem 裡輸入你的 GitHub 帳號 @{login ?? "你的帳號"}。</p>
      ) : (
        <ul className="list card">
          {items.map((i) => (
            <li key={i.id} className="row">
              <div className="grow">
                <strong>{i.repo.fullName}</strong> {i.repo.private && <span className="badge">私人</span>}
                {i.hinted && <span className="badge badge-me">你點的連結</span>}
                <div className="meta muted">
                  @{i.inviter} 邀請你 · {relTime(i.createdAt, now)}
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onStart(() => api("POST", `/api/invitations/${i.id}/accept`), true)}
              >
                加入
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Repos({ onStart }: { onStart: StartOp }) {
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [items, setItems] = useState<RepoChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    let stop = false;
    setError(null);
    api<RepoChoice[]>("GET", `/api/github/repos?q=${encodeURIComponent(debounced)}`)
      .then((l) => !stop && setItems(l))
      .catch((e) => !stop && setError(errMsg(e)));
    return () => {
      stop = true;
    };
  }, [debounced]);

  return (
    <section className="section" aria-labelledby="h-repo">
      <h2 id="h-repo">從你的 GitHub repo 開始</h2>
      <label className="sr-only" htmlFor="repo-q">
        搜尋 repo
      </label>
      <input
        id="repo-q"
        className="input full"
        type="search"
        placeholder="搜尋 repo 名稱"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        autoComplete="off"
      />
      <div className="gap-top">
        {error ? (
          <p className="banner banner-error" role="alert">
            {error}
          </p>
        ) : !items ? (
          <Spinner label="讀取你的 repo…" />
        ) : items.length === 0 ? (
          <p className="card pad muted">
            {debounced
              ? `找不到名稱含「${debounced}」的 repo。`
              : "你的 GitHub 帳號下還沒有可以寫入的 repo。可以用下面的「開新專案」建一個。"}
          </p>
        ) : (
          <ul className="list card scroll-list">
            {items.map((r) => (
              <li key={r.fullName} className="row">
                <div className="grow">
                  <strong>{r.fullName}</strong> {r.private && <span className="badge">私人</span>}
                  {r.isTandem && <span className="badge badge-info">已有 Tandem 紀錄</span>}
                  {r.localProjectId && <span className="badge badge-ok">已在這台電腦</span>}
                </div>
                {!r.localProjectId && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => onStart(() => api("POST", "/api/projects", { repo: r.fullName }), false)}
                  >
                    開始
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewProject({ session, onStart }: { session: AppSession; onStart: StartOp }) {
  const [owners, setOwners] = useState<OwnerChoice[]>([]);
  const [owner, setOwner] = useState(session.login ?? "");
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    api<OwnerChoice[]>("GET", "/api/github/owners")
      .then((o) => {
        setOwners(o);
        setOwner((cur) => (o.some((x) => x.login === cur) ? cur : (o[0]?.login ?? cur)));
      })
      .catch(() => {});
  }, []);

  const trimmed = name.trim();
  const problem = !trimmed
    ? "請幫專案取個名字"
    : !REPO_NAME_RE.test(trimmed)
      ? "名稱只能用英文字母、數字、- _ ."
      : trimmed === "." || trimmed === ".."
        ? "這個名稱不能用"
        : trimmed.length > 100
          ? "名稱太長了"
          : null;

  function submit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (problem || !owner) return;
    onStart(() => api("POST", "/api/projects/new", { owner, name: trimmed }), false);
  }

  const showProblem = touched && !!problem;
  return (
    <section className="section" aria-labelledby="h-new">
      <h2 id="h-new">開新專案</h2>
      <form className="card pad form-grid" onSubmit={submit} noValidate>
        <div>
          <label htmlFor="new-owner">放在哪個帳號</label>
          <select id="new-owner" className="input full" value={owner} onChange={(e) => setOwner(e.target.value)}>
            {(owners.length ? owners : [{ login: owner, kind: "user" as const }]).map((o) => (
              <option key={o.login} value={o.login}>
                {o.login}
                {o.kind === "org" ? "（組織）" : ""}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="new-name">專案名稱</label>
          <input
            id="new-name"
            className="input full"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="例如 my-project"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={showProblem}
            aria-describedby="new-name-help"
          />
        </div>
        <div>
          <button type="submit" className="btn btn-primary">
            建立並開始
          </button>
        </div>
        <p id="new-name-help" className={showProblem ? "field-error full-row" : "muted small full-row"} role={showProblem ? "alert" : undefined}>
          {showProblem ? problem : "會在 GitHub 建立一個私人 repo，只有你邀請的人看得到。"}
        </p>
      </form>
    </section>
  );
}

function OpenFolder({ onOpenFolder }: { onOpenFolder: Props["onOpenFolder"] }) {
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!path.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await onOpenFolder(path.trim());
    } catch (e2) {
      setError(errMsg(e2));
      setBusy(false);
    }
  }

  if (!open)
    return (
      <p className="gap-top">
        <button type="button" className="btn btn-link" onClick={() => setOpen(true)}>
          使用電腦裡已經有的資料夾
        </button>
      </p>
    );
  return (
    <form className="card pad gap-top" onSubmit={submit}>
      <label htmlFor="folder-path">資料夾位置</label>
      <div className="row">
        <input
          id="folder-path"
          className="input grow"
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="例如 C:\Users\你\Documents\my-project"
          autoComplete="off"
          spellCheck={false}
        />
        <button type="submit" className="btn btn-primary" disabled={busy || !path.trim()}>
          {busy ? "加入中…" : "加入"}
        </button>
      </div>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
    </form>
  );
}

export function Picker({ session, hint, now, onStart, onOpenFolder, onBack }: Props) {
  return (
    <main className="page narrow">
      {onBack && (
        <p className="gap-top">
          <button type="button" className="btn btn-link" onClick={onBack}>
            ← 回到專案
          </button>
        </p>
      )}
      <h1 className="page-title">{session.projects.length ? "加入或開始專案" : `嗨 @${session.login}，來開始第一個專案`}</h1>
      <Invitations hint={hint} login={session.login} now={now} onStart={onStart} />
      <Repos onStart={onStart} />
      <NewProject session={session} onStart={onStart} />
      <OpenFolder onOpenFolder={onOpenFolder} />
    </main>
  );
}
