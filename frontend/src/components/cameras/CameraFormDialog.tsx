import { useState } from "react";
import axios from "axios";
import type { Camera, CreateCameraInput, DiscoveredStream, UpdateCameraInput } from "../../api/types";
import { useCreateCamera, useProbeOnvif, useUpdateCamera } from "../../api/cameras";

interface CameraFormDialogProps {
  camera?: Camera;
  onClose: () => void;
}

function streamLabel(stream: DiscoveredStream): string {
  const resolution = stream.width && stream.height ? `${stream.width}x${stream.height}` : "resolução desconhecida";
  return `${resolution}${stream.encoding ? ` (${stream.encoding})` : ""}: ${stream.rtspUri}`;
}

function pickDefaultTokens(streams: DiscoveredStream[]): { main?: string; sub?: string } {
  if (streams.length === 0) return {};
  const sorted = [...streams].sort((a, b) => (b.width ?? 0) * (b.height ?? 0) - (a.width ?? 0) * (a.height ?? 0));
  return {
    main: sorted[0]?.profileToken,
    sub: sorted.length > 1 ? sorted[sorted.length - 1]?.profileToken : sorted[0]?.profileToken,
  };
}

/**
 * When editing a camera, we already know which streams were selected last
 * time (saved in the DB) even though we haven't re-probed ONVIF yet in this
 * session. Synthesizing entries from that saved data lets the selects show
 * the current selection immediately, instead of appearing empty until the
 * user clicks "Obter URLs de vídeo" again.
 */
function initialStreamsFromCamera(camera?: Camera): DiscoveredStream[] {
  if (!camera) return [];
  const byToken = new Map<string, DiscoveredStream>();
  if (camera.onvifProfileToken && camera.rtspMainUri) {
    byToken.set(camera.onvifProfileToken, {
      profileToken: camera.onvifProfileToken,
      name: "Selecionado anteriormente",
      encoding: camera.mainStreamEncoding,
      width: camera.mainStreamWidth,
      height: camera.mainStreamHeight,
      rtspUri: camera.rtspMainUri,
    });
  }
  if (camera.onvifSubProfileToken && camera.rtspSubUri && !byToken.has(camera.onvifSubProfileToken)) {
    byToken.set(camera.onvifSubProfileToken, {
      profileToken: camera.onvifSubProfileToken,
      name: "Selecionado anteriormente",
      encoding: camera.subStreamEncoding,
      width: camera.subStreamWidth,
      height: camera.subStreamHeight,
      rtspUri: camera.rtspSubUri,
    });
  }
  return [...byToken.values()];
}

/**
 * Pre-fills the "URL do serviço ONVIF" field when editing, so there's a
 * visual reference to what was used before - without the password, which is
 * never sent back to the client. The user needs to type the password again
 * here if they want to re-probe using this combined field.
 */
function onvifUrlDisplay(camera?: Camera): string {
  if (!camera) return "";
  return `http://${camera.username}@${camera.host}:${camera.port}${camera.onvifPath}`;
}

export function CameraFormDialog({ camera, onClose }: CameraFormDialogProps) {
  const isEdit = Boolean(camera);
  const createCamera = useCreateCamera();
  const updateCamera = useUpdateCamera();
  const probeOnvif = useProbeOnvif();

  const [onvifUrl, setOnvifUrl] = useState(() => onvifUrlDisplay(camera));
  const [name, setName] = useState(camera?.name ?? "");
  const [host, setHost] = useState(camera?.host ?? "");
  const [port, setPort] = useState(String(camera?.port ?? 80));
  const [onvifPath, setOnvifPath] = useState(camera?.onvifPath ?? "/onvif/device_service");
  const [username, setUsername] = useState(camera?.username ?? "");
  const [password, setPassword] = useState("");
  const [recordingMode, setRecordingMode] = useState<Camera["recordingMode"]>(camera?.recordingMode ?? "off");
  const [motionRecording, setMotionRecording] = useState(camera?.motionRecording ?? true);
  const [motionDetectionSource, setMotionDetectionSource] = useState<Camera["motionDetectionSource"]>(
    camera?.motionDetectionSource ?? "video"
  );
  const [retentionDays, setRetentionDays] = useState(String(camera?.retentionDays ?? 7));
  const [useVlcRelay, setUseVlcRelay] = useState(camera?.rtspCompatMode === "vlc-relay");
  const [hasPtz, setHasPtz] = useState(camera?.hasPtz ?? false);

  const [streams, setStreams] = useState<DiscoveredStream[]>(() => initialStreamsFromCamera(camera));
  const [mainToken, setMainToken] = useState<string>(camera?.onvifProfileToken ?? "");
  const [subToken, setSubToken] = useState<string>(camera?.onvifSubProfileToken ?? "");
  const [formError, setFormError] = useState<string | null>(null);

  const mainStream = streams.find((s) => s.profileToken === mainToken);
  const subStreamSelected = streams.find((s) => s.profileToken === subToken);

  // The combined field is pre-filled (when editing) WITHOUT a password, since
  // passwords are never sent back to the client - only use it if it actually
  // looks like it has credentials (user:pass@), otherwise fall back to the
  // individual host/port/user/password fields (which do have the typed
  // password, if any).
  const onvifUrlHasCredentials = /:\/\/[^@/]+:[^@/]+@/.test(onvifUrl.trim());

  const handleProbe = async () => {
    setFormError(null);
    try {
      const result = await probeOnvif.mutateAsync(
        onvifUrlHasCredentials
          ? { onvifUrl: onvifUrl.trim() }
          : { host, port: Number(port) || undefined, onvifPath, username, password: password || undefined }
      );
      setHost(result.host);
      setPort(String(result.port));
      setOnvifPath(result.onvifPath);
      setUsername(result.username);
      setStreams(result.streams);
      const defaults = pickDefaultTokens(result.streams);
      if (defaults.main) setMainToken(defaults.main);
      if (defaults.sub) setSubToken(defaults.sub);
    } catch (err) {
      const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: string }) : undefined;
      const base = data?.error ?? "Não foi possível conectar à câmera via ONVIF.";
      setFormError(data?.details ? `${base} (${data.details})` : base);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (!isEdit && !password) {
      setFormError("Senha é obrigatória");
      return;
    }

    const basePayload: CreateCameraInput | UpdateCameraInput = {
      name,
      host,
      port: Number(port) || 80,
      onvifPath,
      username,
      ...(password ? { password } : {}),
      ...(mainStream
        ? {
            mainProfileToken: mainStream.profileToken,
            rtspMainUri: mainStream.rtspUri,
            mainStreamMetadata: { width: mainStream.width, height: mainStream.height, encoding: mainStream.encoding },
          }
        : {}),
      ...(subStreamSelected
        ? {
            subProfileToken: subStreamSelected.profileToken,
            rtspSubUri: subStreamSelected.rtspUri,
            subStreamMetadata: {
              width: subStreamSelected.width,
              height: subStreamSelected.height,
              encoding: subStreamSelected.encoding,
            },
          }
        : {}),
      rtspCompatMode: useVlcRelay ? "vlc-relay" : null,
      hasPtz,
      recordingMode,
      motionRecording,
      motionDetectionSource,
      retentionDays: Number(retentionDays) || 7,
    };

    try {
      if (isEdit && camera) {
        await updateCamera.mutateAsync({ id: camera.id, input: basePayload });
      } else {
        await createCamera.mutateAsync(basePayload as CreateCameraInput);
      }
      onClose();
    } catch {
      setFormError("Falha ao salvar a câmera. Verifique os dados e tente novamente.");
    }
  };

  const isSaving = createCamera.isPending || updateCamera.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{isEdit ? "Editar câmera" : "Adicionar câmera"}</h2>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">
              URL do serviço ONVIF (opcional — preenche os campos abaixo)
            </label>
            <div className="flex gap-2">
              <input
                value={onvifUrl}
                onChange={(e) => setOnvifUrl(e.target.value)}
                placeholder="http://admin:senha@192.168.88.35:5000/onvif"
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
              />
            </div>
            {isEdit && !onvifUrlHasCredentials && (
              <p className="mt-1 text-[11px] text-neutral-500">
                A senha não é reexibida por segurança — adicione-a aqui (user:senha@...) ou preencha o campo "Senha"
                abaixo antes de clicar em "Obter URLs de vídeo".
              </p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Nome (ex: Garagem)"
              required
              className="col-span-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
            <input
              value={host}
              onChange={(e) => setHost(e.target.value)}
              placeholder="IP/Host"
              required
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
            <input
              value={port}
              onChange={(e) => setPort(e.target.value)}
              placeholder="Porta ONVIF"
              type="number"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
            <input
              value={onvifPath}
              onChange={(e) => setOnvifPath(e.target.value)}
              placeholder="Caminho ONVIF (/onvif/device_service)"
              className="col-span-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
            <input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Usuário"
              required
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
            <input
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={isEdit ? "Senha (deixe em branco para manter)" : "Senha"}
              type="password"
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </div>

          <div className="flex gap-2">
            <button
              type="button"
              onClick={handleProbe}
              disabled={probeOnvif.isPending}
              className="flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
            >
              {probeOnvif.isPending ? "Conectando..." : "Obter URLs de vídeo"}
            </button>
          </div>

          {streams.length > 0 && (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3">
              <div>
                <label className="mb-1 block text-xs text-neutral-500">URL ao vivo (stream principal)</label>
                <select
                  value={mainToken}
                  onChange={(e) => setMainToken(e.target.value)}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                >
                  {streams.map((s) => (
                    <option key={s.profileToken} value={s.profileToken}>
                      {streamLabel(s)}
                    </option>
                  ))}
                </select>
                {mainStream && (
                  <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">{mainStream.rtspUri}</p>
                )}
              </div>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">
                  URL de gravação (stream sub, opcional)
                </label>
                <select
                  value={subToken}
                  onChange={(e) => setSubToken(e.target.value)}
                  className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                >
                  {streams.map((s) => (
                    <option key={s.profileToken} value={s.profileToken}>
                      {streamLabel(s)}
                    </option>
                  ))}
                </select>
                {subStreamSelected && (
                  <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">{subStreamSelected.rtspUri}</p>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <span className="text-xs text-neutral-500">Modo de gravação</span>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="recordingMode"
                checked={recordingMode === "off"}
                onChange={() => setRecordingMode("off")}
              />
              Sem gravação
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="recordingMode"
                checked={recordingMode === "continuous"}
                onChange={() => setRecordingMode("continuous")}
              />
              Gravação contínua
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="recordingMode"
                checked={recordingMode === "motion"}
                onChange={() => setRecordingMode("motion")}
              />
              Gravação por movimento
            </label>
            {recordingMode === "motion" && (
              <p className="text-[11px] text-neutral-500">
                A gravação começa quando um movimento é detectado (veja "Detecção de movimento" abaixo) e continua
                por 1 minuto após o último evento. Precisa de uma origem de detecção ativa para funcionar.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <span className="text-xs text-neutral-500">
              Detecção de movimento (independente do modo de gravação acima)
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={motionRecording}
                onChange={(e) => setMotionRecording(e.target.checked)}
              />
              Detectar movimento nesta câmera (alertas: flash/toast/snapshot/notificações)
            </label>
            {recordingMode === "motion" && !motionRecording && (
              <p className="text-[11px] text-amber-500">
                A gravação por movimento precisa de uma detecção ativa pra saber quando gravar — mesmo com este
                checkbox desmarcado, a origem abaixo continuará rodando só pra acionar a gravação.
              </p>
            )}
            {(recordingMode === "motion" || motionRecording) && (
              <>
                <label className="flex items-center gap-2">
                  Origem da detecção
                  <select
                    value={motionDetectionSource}
                    onChange={(e) => setMotionDetectionSource(e.target.value as Camera["motionDetectionSource"])}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                  >
                    <option value="video">Vídeo (análise local, OpenCV) — recomendado</option>
                    <option value="onvif">ONVIF (evento da câmera)</option>
                  </select>
                </label>
                <p className="text-[11px] text-neutral-500">
                  {motionDetectionSource === "video"
                    ? "Roda no servidor, analisando o próprio vídeo (OpenCV) — funciona mesmo quando a câmera anuncia suporte a eventos ONVIF mas na prática não funciona (comum em modelos baratos)."
                    : "Usa a assinatura de eventos ONVIF da própria câmera — mais leve, mas depende do firmware suportar de verdade."}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <label className="flex items-center gap-2">
              Retenção (dias)
              <input
                type="number"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
              />
            </label>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={useVlcRelay}
                onChange={(e) => setUseVlcRelay(e.target.checked)}
              />
              Câmera com RTSP incompatível (usar relay VLC)
            </label>
            {useVlcRelay && (
              <p className="text-[11px] text-neutral-500">
                Use quando o stream aparece "indisponível" mesmo com a câmera online. Um processo VLC interno se
                conecta à câmera e reexpõe o vídeo em um formato compatível para o MediaMTX consumir.
              </p>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasPtz} onChange={(e) => setHasPtz(e.target.checked)} />
              Câmera com PTZ (motorizada)
            </label>
            {hasPtz && (
              <p className="text-[11px] text-neutral-500">
                Habilita o botão "PTZ" nesta câmera no Grid, com um controle de joystick para mover a câmera e
                gerenciar presets.
              </p>
            )}
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-neutral-800">
              Cancelar
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {isSaving ? "Salvando..." : isEdit ? "Salvar alterações" : "Adicionar câmera"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
