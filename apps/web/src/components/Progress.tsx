import type { ProjectProgress, ProjectStep } from "@tandem/contracts";

const STEPS: { step: ProjectStep; label: string }[] = [
  { step: "accept", label: "接受邀請" },
  { step: "clone", label: "下載專案資料" },
  { step: "setup", label: "準備 Tandem" },
  { step: "push", label: "上傳設定" },
  { step: "done", label: "完成" },
];

const STATE_TEXT = { done: "（完成）", error: "（失敗）", active: "（進行中）", todo: "（等待）" } as const;
const STATE_MARK = { done: "✓", error: "!", active: "…", todo: "" } as const;

export function ProgressView({
  progress,
  withAccept,
  onRetry,
  onBack,
}: {
  progress: ProjectProgress | undefined;
  withAccept: boolean;
  onRetry: () => void;
  onBack: () => void;
}) {
  const steps = STEPS.filter((s) => withAccept || s.step !== "accept");
  const current = progress ? steps.findIndex((s) => s.step === progress.step) : -1;
  const failed = !!progress?.error;
  const finished = progress?.step === "done" && !failed;

  return (
    <main className="center-page">
      <div className="card panel" aria-live="polite">
        <h1 className="page-title">{failed ? "沒有成功" : finished ? "完成了" : "正在準備專案…"}</h1>
        <ol className="steps">
          {steps.map((s, i) => {
            const state: keyof typeof STATE_TEXT =
              failed && i === current ? "error" : i < current || finished ? "done" : i === current ? "active" : "todo";
            return (
              <li key={s.step} className={`step step-${state}`} aria-current={state === "active" ? "step" : undefined}>
                <span className="step-mark" aria-hidden="true">
                  {STATE_MARK[state]}
                </span>
                {s.label}
                <span className="sr-only">{STATE_TEXT[state]}</span>
              </li>
            );
          })}
        </ol>
        {progress && !failed && <p className="muted">{progress.message}</p>}
        {!progress && <p className="muted">開始中…</p>}
        {failed && progress?.error && (
          <>
            <p className="banner banner-error" role="alert">
              {progress.error.message}
            </p>
            {progress.error.detail && (
              <details>
                <summary>詳細資訊</summary>
                <pre className="detail">{progress.error.detail}</pre>
              </details>
            )}
            <div className="row gap-top">
              <button type="button" className="btn btn-primary" onClick={onRetry}>
                再試一次
              </button>
              <button type="button" className="btn" onClick={onBack}>
                回上一頁
              </button>
            </div>
          </>
        )}
      </div>
    </main>
  );
}
