import { useEffect, useRef, useState } from "react";
import { useCameras, useCreateCamera } from "../../api/cameras";
import { streamNetworkScan, type NetworkScanHostResult } from "../../api/networkScan";
import type { Camera, CreateCameraInput } from "../../api/types";
import { useToastStore } from "../../store/toastStore";

interface OnvifScanModalProps {
  onClose: () => void;
}

function guessDefaultRange(cameras: Camera[] | undefined): string {
  const withHost = cameras?.find((c) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(c.host));
  if (!withHost) return "";
  const parts = withHost.host.split(".");
  return `${parts[0]}.${parts[1]}.${parts[2]}.1-254`;
}

function pickDefaultTokens(streams: NonNullable<NetworkScanHostResult["onvif"]>["streams"]) {
  if (!streams || streams.length === 0) return {};
  const sorted = [...streams].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return {
    main: sorted[0],
    sub: sorted.length > 1 ? sorted[sorted.length - 1] : sorted[0],
  };
}

function buildCreateInput(result: NetworkScanHostResult, username: string, password: string): CreateCameraInput {
  const base: CreateCameraInput = {
    name: `Câmera ${result.host}`,
    host: result.host,
    port: result.onvifPort ?? 80,
    onvifPath: "/onvif/device_service",
    username,
    password,
  };
  if (result.onvif?.ok && result.onvif.streams?.length) {
    const { main, sub } = pickDefaultTokens(result.onvif.streams);
    return {
      ...base,
      ...(main
        ? {
            mainProfileToken: main.profileToken,
            rtspMainUri: main.rtspUri,
            mainStreamMetadata: { width: main.width, height: main.height, encoding: main.encoding },
          }
        : {}),
      ...(sub
        ? {
            subProfileToken: sub.profileToken,
            rtspSubUri: sub.rtspUri,
            subStreamMetadata: { width: sub.width, height: sub.height, encoding: sub.encoding },
          }
        : {}),
    };
  }
  // No ONVIF (or it failed) - if a common RTSP path guess worked, use it
  // directly as the main stream URI (no profile token, since there's no
  // ONVIF media profile behind it).
  if (result.rtspPath) {
    return { ...base, rtspMainUri: `rtsp://${result.host}:554${result.rtspPath}` };
  }
  return base;
}

function resultSummary(result: NetworkScanHostResult): string {
  if (result.onvif?.ok) {
    return `ONVIF ok (${result.onvif.streams?.length ?? 0} stream(s)) na porta ${result.onvifPort}`;
  }
  if (result.onvif && !result.onvif.ok) {
    return `Porta ONVIF ${result.onvifPort} aberta, mas falhou: ${result.onvif.error}${
      result.rtspPath ? ` — RTSP direto encontrado em ${result.rtspPath}` : ""
    }`;
  }
  if (result.rtspPath) {
    return `RTSP confirmado, URL adivinhada: ${result.rtspPath}`;
  }
  if (result.onvifPort !== null) {
    return `Porta ONVIF ${result.onvifPort} aberta (sem credenciais para confirmar)`;
  }
  return "Porta RTSP (554) aberta, mas nenhuma URL comum respondeu";
}

/**
 * Terminal-style modal for the active network scan (see
 * backend/src/onvif/networkScan.ts for why this exists alongside the old
 * WS-Discovery button, which routinely finds nothing when the backend runs
 * inside Docker). Streams progress live and lets the user bulk-add
 * whichever discovered hosts they select.
 */
export function OnvifScanModal({ onClose }: OnvifScanModalProps) {
  const { data: cameras } = useCameras();
  const createCamera = useCreateCamera();
  const addToast = useToastStore((s) => s.addToast);

  const [range, setRange] = useState(() => guessDefaultRange(cameras));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [scanning, setScanning] = useState(false);
  const [logLines, setLogLines] = useState<string[]>([]);
  const [results, setResults] = useState<NetworkScanHostResult[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState(false);

  const abortRef = useRef<AbortController | null>(null);
  const logRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [logLines]);

  useEffect(() => {
    // Cancel any in-flight scan if the modal is closed/unmounted.
    return () => abortRef.current?.abort();
  }, []);

  const appendLog = (line: string) => setLogLines((lines) => [...lines, line]);

  const handleStartScan = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!range.trim() || !username.trim()) return;

    setScanning(true);
    setLogLines([]);
    setResults([]);
    setSelected(new Set());

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      await streamNetworkScan(
        { range, username, password },
        (event) => {
          if (event.type === "start") {
            appendLog(`$ varredura iniciada — ${event.totalHosts} host(s) na faixa`);
          } else if (event.type === "host-start") {
            appendLog(`testando ${event.host}...`);
          } else if (event.type === "host-result") {
            const { type: _type, ...result } = event;
            if (result.rtspOpen || result.onvifPort !== null) {
              appendLog(`  ✓ ${result.host} — ${resultSummary(result)}`);
              setResults((prev) => [...prev, result]);
              setSelected((prev) => {
                // Auto-select confirmed cameras (ONVIF, or a working guessed
                // RTSP path); leave uncertain candidates (only an open port,
                // nothing confirmed) unchecked.
                if (!result.onvif?.ok && !result.rtspPath) return prev;
                const next = new Set(prev);
                next.add(result.host);
                return next;
              });
            }
          } else if (event.type === "done") {
            appendLog("$ varredura concluída");
          } else if (event.type === "error") {
            appendLog(`$ erro: ${event.message}`);
            addToast("error", event.message);
          }
        },
        controller.signal
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : "Falha na varredura.";
      appendLog(`$ erro: ${message}`);
      addToast("error", message);
    } finally {
      setScanning(false);
      abortRef.current = null;
    }
  };

  const handleCancelScan = () => {
    abortRef.current?.abort();
  };

  const toggleSelected = (host: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(host)) next.delete(host);
      else next.add(host);
      return next;
    });
  };

  const handleBulkAdd = async () => {
    const toAdd = results.filter((r) => selected.has(r.host));
    if (toAdd.length === 0) return;
    setAdding(true);
    let successCount = 0;
    let failCount = 0;
    for (const result of toAdd) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await createCamera.mutateAsync(buildCreateInput(result, username, password));
        successCount++;
      } catch {
        failCount++;
      }
    }
    setAdding(false);
    addToast(
      failCount === 0 ? "success" : "error",
      `${successCount} câmera(s) adicionada(s)${failCount ? `, ${failCount} falharam` : ""}.`
    );
    if (successCount > 0) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold">Varredura de rede (ONVIF/RTSP)</h2>
            <p className="mt-1 text-xs text-neutral-500">
              Testa cada IP da faixa em busca de portas RTSP/ONVIF abertas — funciona mesmo quando a descoberta
              automática (WS-Discovery) não encontra nada, o que é comum rodando em Docker.
            </p>
          </div>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <form onSubmit={handleStartScan} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">Faixa de IP</label>
            <input
              value={range}
              onChange={(e) => setRange(e.target.value)}
              placeholder="192.168.1.0/24 ou 192.168.1.1-254"
              required
              disabled={scanning}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuário ONVIF (mesmo de todas as câmeras)"
              required
              disabled={scanning}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm disabled:opacity-50"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Senha"
              type="password"
              disabled={scanning}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm disabled:opacity-50"
            />
          </div>
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={scanning}
              className="flex-1 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {scanning ? "Escaneando..." : "Iniciar varredura"}
            </button>
            {scanning && (
              <button
                type="button"
                onClick={handleCancelScan}
                className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700"
              >
                Cancelar
              </button>
            )}
          </div>
        </form>

        <div
          ref={logRef}
          className="mt-4 h-48 overflow-y-auto rounded-md border border-neutral-800 bg-black p-3 font-mono text-xs text-green-400"
        >
          {logLines.length === 0 ? (
            <p className="text-neutral-600">Aguardando início da varredura...</p>
          ) : (
            logLines.map((line, i) => (
              <div key={i} className="whitespace-pre-wrap">
                {line}
              </div>
            ))
          )}
        </div>

        {results.length > 0 && (
          <div className="mt-4 flex flex-col gap-2">
            <h3 className="text-sm font-semibold">Encontrados ({results.length})</h3>
            <div className="flex flex-col gap-1.5">
              {results.map((result) => (
                <label
                  key={result.host}
                  className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-xs"
                >
                  <input
                    type="checkbox"
                    checked={selected.has(result.host)}
                    onChange={() => toggleSelected(result.host)}
                  />
                  <span className="font-mono text-neutral-200">{result.host}</span>
                  <span className="text-neutral-500">{resultSummary(result)}</span>
                </label>
              ))}
            </div>
            <button
              type="button"
              onClick={handleBulkAdd}
              disabled={selected.size === 0 || adding}
              className="mt-1 self-start rounded-md bg-green-700 px-3 py-1.5 text-sm font-medium hover:bg-green-600 disabled:opacity-50"
            >
              {adding ? "Adicionando..." : `Adicionar selecionadas (${selected.size})`}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
