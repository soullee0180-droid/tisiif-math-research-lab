import {
  useState,
  useEffect,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { X, AlertCircle, LoaderCircle } from "lucide-react";
import { subscribe, version } from "./api";
export function useData(
  loader: () => Promise<any>,
  deps: any[] = [],
  pollMs = 0,
) {
  const rev = useSyncExternalStore(subscribe, version);
  const [data, setData] = useState<any>(null),
    [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setError("");
    loader()
      .then((v) => {
        if (!cancelled) setData(v);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    const timer = pollMs
      ? setInterval(() => {
          if (document.visibilityState !== "hidden")
            loader()
              .then((v) => {
                if (!cancelled) {
                  setData(v);
                  setError("");
                }
              })
              .catch((e) => {
                if (!cancelled) setError(e.message);
              });
        }, pollMs)
      : undefined;
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [rev, pollMs, ...deps]);
  return { data, error };
}
export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      remarkPlugins={[remarkGfm, remarkMath]}
      rehypePlugins={[[rehypeKatex, { trust: false, strict: "warn" }]]}
    >
      {text || ""}
    </ReactMarkdown>
  );
}
export function Status({ value }: { value: any }) {
  const labels: Record<string, string> = {
    approved: "승인됨",
    draft: "초안",
    running: "진행 중",
    paused: "일시정지",
    cancelled: "취소",
    complete: "완료",
    queued: "대기",
    parse_failed: "원문 재검토",
    unknown_remote: "원격 상태 불명",
    blocked: "차단",
    failed: "실패",
    main: "본실험",
    pilot: "예비",
    fixture: "모의",
    manual_web: "수동 웹",
    mock: "모의",
    api: "API",
  };
  return (
    <span
      className={
        "badge " +
        (value === "complete" || value === "approved" || value === "PASS"
          ? "good"
          : value === "running"
            ? "blue"
            : /fail|blocked|unknown|FAIL|BLOCKED/.test(value)
              ? "warn"
              : "")
      }
    >
      {labels[value] || value}
    </span>
  );
}
export function ErrorBox({ error }: { error?: string }) {
  return error ? (
    <div className="error" role="alert">
      <AlertCircle size={17} />
      {error}
    </div>
  ) : null;
}
export function Loading() {
  return (
    <div className="empty">
      <LoaderCircle className="spin" size={24} />
      <p>자료를 불러오는 중입니다.</p>
    </div>
  );
}
export function Empty({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="empty">
      <div className="empty-symbol">∅</div>
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function Field({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  useEffect(() => {
    const prior = document.activeElement as HTMLElement;
    const dialog = document.querySelector('[role="dialog"]') as HTMLElement;
    dialog?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {
        const list = [
          ...dialog.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,a[href]",
          ),
        ].filter((e) => !e.hasAttribute("disabled"));
        const first = list[0],
          last = list.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, []);
  return (
    <div className="overlay">
      <section
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="modal"
      >
        <header>
          <h2>{title}</h2>
          <button className="icon" aria-label="닫기" onClick={onClose}>
            <X size={20} />
          </button>
        </header>
        {children}
      </section>
    </div>
  );
}
export function Action({
  children,
  run,
  className = "",
  disabled = false,
}: {
  children: ReactNode;
  run: () => Promise<any>;
  className?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  return (
    <>
      <button
        disabled={busy || disabled}
        className={className}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await run();
          } catch (e: any) {
            setError(e.message);
          } finally {
            setBusy(false);
          }
        }}
      >
        {busy ? <LoaderCircle className="spin" size={15} /> : null}
        {children}
      </button>
      <ErrorBox error={error} />
    </>
  );
}
export function Title({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  children?: ReactNode;
}) {
  return (
    <div className="page-title">
      <div>
        <div className="eyebrow">{eyebrow || "TISIIF RESEARCH WORKSPACE"}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      <div className="actions">{children}</div>
    </div>
  );
}
