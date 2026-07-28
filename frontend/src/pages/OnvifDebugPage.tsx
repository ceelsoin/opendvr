import { useEffect, useMemo, useRef, useState } from "react";
import { useCameras } from "../api/cameras";
import { useOnvifDebugCommands, useRunOnvifDebugCommand } from "../api/onvifDebug";

interface HistoryEntry {
  id: number;
  cameraName: string;
  raw: string;
  timestamp: string;
  status: "pending" | "ok" | "error" | "local";
  output?: unknown;
  errorMessage?: string;
}

let nextEntryId = 0;

function formatOutput(output: unknown): string {
  if (typeof output === "string") return output;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

export function OnvifDebugPage() {
  const { data: cameras } = useCameras();
  const { data: commands } = useOnvifDebugCommands();
  const runCommand = useRunOnvifDebugCommand();

  const [cameraId, setCameraId] = useState<string>("");
  const [input, setInput] = useState("");
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [commandLog, setCommandLog] = useState<string[]>([]);
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!cameraId && cameras && cameras.length > 0) {
      setCameraId(cameras[0].id);
    }
  }, [cameras, cameraId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [history]);

  const selectedCamera = cameras?.find((c) => c.id === cameraId);

  const commandNameFilter = input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : null;
  const suggestions = useMemo(() => {
    if (commandNameFilter === null || !commands) return [];
    return commands.filter((c) => c.name.toLowerCase().startsWith(commandNameFilter)).slice(0, 8);
  }, [commandNameFilter, commands]);

  const pushEntry = (entry: Omit<HistoryEntry, "id" | "timestamp">) => {
    setHistory((h) => [...h, { ...entry, id: nextEntryId++, timestamp: new Date().toLocaleTimeString() }]);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const raw = input.trim();
    if (!raw) return;
    setInput("");
    setHistoryIndex(null);
    setCommandLog((log) => (log[log.length - 1] === raw ? log : [...log, raw]));

    if (!raw.startsWith("/")) {
      pushEntry({
        cameraName: selectedCamera?.name ?? "-",
        raw,
        status: "error",
        errorMessage: 'Comandos começam com "/". Digite /help para ver a lista.',
      });
      return;
    }

    const [commandToken, ...args] = raw.slice(1).split(/\s+/);
    const command = commandToken.toLowerCase();

    if (command === "help") {
      const listing = (commands ?? [])
        .map((c) => `${c.usage}\n    ${c.description}`)
        .join("\n\n");
      pushEntry({ cameraName: selectedCamera?.name ?? "-", raw, status: "local", output: listing || "Carregando comandos..." });
      return;
    }

    if (command === "clear") {
      setHistory([]);
      return;
    }

    if (!selectedCamera) {
      pushEntry({ cameraName: "-", raw, status: "error", errorMessage: "Selecione uma câmera primeiro." });
      return;
    }

    const entryId = nextEntryId++;
    setHistory((h) => [
      ...h,
      { id: entryId, cameraName: selectedCamera.name, raw, status: "pending", timestamp: new Date().toLocaleTimeString() },
    ]);

    runCommand.mutate(
      { cameraId: selectedCamera.id, command, args },
      {
        onSuccess: (data) => {
          setHistory((h) =>
            h.map((entry) =>
              entry.id === entryId
                ? data.ok
                  ? { ...entry, status: "ok", output: data.result }
                  : { ...entry, status: "error", errorMessage: data.error }
                : entry
            )
          );
        },
        onError: (err) => {
          setHistory((h) =>
            h.map((entry) => (entry.id === entryId ? { ...entry, status: "error", errorMessage: String(err) } : entry))
          );
        },
      }
    );
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (commandLog.length === 0) return;

    if (e.key === "ArrowUp") {
      e.preventDefault();
      const nextIndex = historyIndex === null ? commandLog.length - 1 : Math.max(0, historyIndex - 1);
      setHistoryIndex(nextIndex);
      setInput(commandLog[nextIndex]);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      if (historyIndex === null) return;
      const nextIndex = historyIndex + 1;
      if (nextIndex >= commandLog.length) {
        setHistoryIndex(null);
        setInput("");
      } else {
        setHistoryIndex(nextIndex);
        setInput(commandLog[nextIndex]);
      }
    }
  };

  return (
    <div className="flex h-[calc(100vh-3rem)] flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold">Debug ONVIF</h2>
        <select
          value={cameraId}
          onChange={(e) => setCameraId(e.target.value)}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-1.5 text-sm"
        >
          {cameras?.map((camera) => (
            <option key={camera.id} value={camera.id}>
              {camera.name} ({camera.host})
            </option>
          ))}
        </select>
      </div>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto rounded-md border border-neutral-800 bg-black p-4 font-mono text-xs"
      >
        {history.length === 0 && (
          <p className="text-neutral-600">
            Digite <span className="text-neutral-300">/help</span> para ver os comandos disponíveis. Exemplo:{" "}
            <span className="text-neutral-300">/device.info</span>
          </p>
        )}
        {history.map((entry) => (
          <div key={entry.id} className="mb-3">
            <div className="flex items-center gap-2 text-neutral-500">
              <span>[{entry.timestamp}]</span>
              {entry.status !== "local" && <span className="text-blue-400">{entry.cameraName}</span>}
              <span className="text-neutral-300">{entry.raw}</span>
              {entry.status === "pending" && <span className="text-yellow-500">executando...</span>}
            </div>
            {entry.status === "ok" && (
              <pre className="mt-1 whitespace-pre-wrap break-all text-green-400">{formatOutput(entry.output)}</pre>
            )}
            {entry.status === "local" && (
              <pre className="mt-1 whitespace-pre-wrap break-all text-neutral-400">{formatOutput(entry.output)}</pre>
            )}
            {entry.status === "error" && <p className="mt-1 whitespace-pre-wrap text-red-400">{entry.errorMessage}</p>}
          </div>
        ))}
      </div>

      <div className="relative">
        {suggestions.length > 0 && (
          <div className="absolute bottom-full mb-1 w-full rounded-md border border-neutral-700 bg-neutral-900 text-xs shadow-lg">
            {suggestions.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => setInput(`/${s.name} `)}
                className="block w-full px-3 py-1.5 text-left hover:bg-neutral-800"
              >
                <span className="font-mono text-blue-400">{s.usage}</span>
                <span className="ml-2 text-neutral-500">{s.description}</span>
              </button>
            ))}
          </div>
        )}
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="/device.info"
            className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm"
            autoComplete="off"
            spellCheck={false}
          />
          <button
            type="submit"
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-500"
          >
            Enviar
          </button>
        </form>
      </div>
    </div>
  );
}
