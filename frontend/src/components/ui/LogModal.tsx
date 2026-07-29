import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { apiClient } from "../../api/client";

interface LogEntry {
  seq: number;
  level: number;
  time: number;
  msg?: string;
  cameraId?: string;
  [key: string]: unknown;
}

const POLL_INTERVAL_MS = 700;

function levelLabel(level: number): { label: string; className: string } {
  if (level >= 50) return { label: "ERROR", className: "text-red-400" };
  if (level >= 40) return { label: "WARN", className: "text-yellow-400" };
  if (level >= 30) return { label: "INFO", className: "text-neutral-300" };
  return { label: "DEBUG", className: "text-neutral-600" };
}

interface LogModalProps {
  title: string;
  /** Only show log entries tagged with this camera id (see backend/src/lib/logBuffer.ts). */
  cameraId?: string;
  /** Whether the underlying operation (restart/test/etc) is still in flight - shown as a status line, doesn't stop polling on its own (a short grace period still runs after, to catch trailing log lines). */
  isRunning: boolean;
  onClose: () => void;
}

/**
 * Live-tails the backend's log ring buffer (GET /api/maintenance/logs, see
 * backend/src/lib/logBuffer.ts) while an operation the user just triggered
 * (camera restart, test connection, factory reset, etc) is running, so they
 * get some visibility into what's actually happening server-side instead of
 * just a spinner. Polls for new entries since the last one shown; doesn't
 * fetch any history from before the modal opened.
 */
export function LogModal({ title, cameraId, isRunning, onClose }: LogModalProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const afterSeqRef = useRef<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function poll() {
      try {
        const params: Record<string, string | number> = {};
        if (cameraId) params.cameraId = cameraId;
        if (afterSeqRef.current !== null) params.afterSeq = afterSeqRef.current;
        const { data } = await apiClient.get<{ entries: LogEntry[]; lastSeq: number }>("/maintenance/logs", { params });
        if (cancelled) return;

        if (!initializedRef.current) {
          // First poll: just establish the baseline (don't show history from
          // before this modal opened) unless there's genuinely nothing after
          // it yet - in that case still show nothing until new entries arrive.
          afterSeqRef.current = data.lastSeq;
          initializedRef.current = true;
          return;
        }

        if (data.entries.length > 0) {
          setEntries((prev) => [...prev, ...data.entries]);
          afterSeqRef.current = data.lastSeq;
        }
      } catch {
        // Best-effort - a single failed poll just tries again next tick.
      }
    }

    void poll();
    const interval = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [cameraId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [entries]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold">{title}</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] ${
                isRunning ? "bg-yellow-950 text-yellow-400" : "bg-green-950 text-green-400"
              }`}
            >
              {isRunning ? t("maintenance.logModal.running") : t("maintenance.logModal.finished")}
            </span>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto rounded-md border border-neutral-800 bg-black p-3 font-mono text-xs"
        >
          {entries.length === 0 && (
            <p className="text-neutral-600">{t("maintenance.logModal.waiting")}</p>
          )}
          {entries.map((entry) => {
            const { label, className } = levelLabel(entry.level);
            return (
              <div key={entry.seq} className="mb-1 whitespace-pre-wrap break-all">
                <span className="text-neutral-600">[{new Date(entry.time).toLocaleTimeString()}]</span>{" "}
                <span className={className}>{label}</span> <span className="text-neutral-200">{entry.msg}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
