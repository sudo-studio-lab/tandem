import { useEffect, useRef, useState } from "react";
import type { DeviceLoginStart, DeviceLoginState } from "@tandem/contracts";
import { api } from "../api.ts";
import { errMsg, useCopy } from "./ui.tsx";

type Phase =
  | { kind: "idle" }
  | { kind: "starting" }
  | { kind: "waiting"; start: DeviceLoginStart }
  | { kind: "failed"; message: string };

const FAIL_TEXT = {
  expired: "代碼過期了。請再試一次，這次記得在 15 分鐘內完成。",
  denied: "你在 GitHub 上按了拒絕。如果是誤按，請再試一次。",
} as const;

export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });
  const { copied, failed: copyFailed, copy } = useCopy();
  const done = useRef(onSignedIn);
  done.current = onSignedIn;

  async function begin() {
    setPhase({ kind: "starting" });
    try {
      setPhase({ kind: "waiting", start: await api<DeviceLoginStart>("POST", "/api/login/device") });
    } catch (e) {
      setPhase({ kind: "failed", message: errMsg(e) });
    }
  }

  const id = phase.kind === "waiting" ? phase.start.id : null;
  useEffect(() => {
    if (!id) return;
    let stop = false;
    const tick = async () => {
      try {
        const s = await api<DeviceLoginState>("GET", `/api/login/device/${encodeURIComponent(id)}`);
        if (stop) return;
        if (s.state === "done") done.current();
        else if (s.state === "expired" || s.state === "denied") setPhase({ kind: "failed", message: FAIL_TEXT[s.state] });
        else if (s.state === "error") setPhase({ kind: "failed", message: `登入失敗：${s.message}` });
      } catch {
        /* network blip: keep polling */
      }
    };
    const t = setInterval(tick, 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [id]);

  return (
    <main className="center-page">
      <div className="card panel">
        <h1 className="brand-big">Tandem</h1>
        <p className="lead">和隊友同步進度，不用開會、不用問「你在做什麼」。</p>

        {(phase.kind === "idle" || phase.kind === "starting") && (
          <>
            <button type="button" className="btn btn-primary btn-big" onClick={begin} disabled={phase.kind === "starting"}>
              {phase.kind === "starting" ? "準備中…" : "用 GitHub 登入"}
            </button>
            <p className="muted small">
              登入時 GitHub 會問你要不要讓 Tandem 存取你的 repo。這是為了同步紀錄和邀請隊友，我們不會動你的程式碼。
            </p>
          </>
        )}

        {phase.kind === "waiting" && (
          <div aria-live="polite">
            <p>1. 複製這組代碼</p>
            <div className="code-row">
              <output className="user-code" aria-label="登入代碼">
                {phase.start.userCode}
              </output>
              <button type="button" className="btn" onClick={() => copy(phase.start.userCode)}>
                {copied ? "已複製" : "複製代碼"}
              </button>
            </div>
            {copyFailed && <p className="muted small">無法自動複製，請手動選取代碼。</p>}
            <p>2. 打開 GitHub，貼上代碼並按「授權」</p>
            <a
              className="btn btn-primary btn-big"
              href={phase.start.verificationUri}
              target="_blank"
              rel="noreferrer"
              onClick={() => void copy(phase.start.userCode)}
            >
              打開 GitHub
            </a>
            <p className="muted loading" role="status">
              <span className="spin" aria-hidden="true" /> 等你在 GitHub 上完成，這個畫面會自動跳轉…
            </p>
            <p className="muted small">
              GitHub 會問你要不要讓 Tandem 存取你的 repo，用來同步紀錄和邀請隊友。
            </p>
            <button type="button" className="btn btn-link" onClick={() => setPhase({ kind: "idle" })}>
              取消
            </button>
          </div>
        )}

        {phase.kind === "failed" && (
          <>
            <p className="banner banner-error" role="alert">
              {phase.message}
            </p>
            <button type="button" className="btn btn-primary btn-big" onClick={begin}>
              再試一次
            </button>
          </>
        )}
      </div>
    </main>
  );
}
