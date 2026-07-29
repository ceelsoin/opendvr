import { useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import type { Camera, CreateCameraInput, DiscoveredStream, UpdateCameraInput } from "../../api/types";
import { useCreateCamera, useProbeCamera, useProbeOnvif, useUpdateCamera } from "../../api/cameras";

interface CameraFormDialogProps {
  camera?: Camera;
  onClose: () => void;
}

function directSourceInfo(t: (key: string) => string): Record<Exclude<Camera["sourceType"], "onvif">, { label: string; placeholder: string }> {
  return {
    rtsp: {
      label: "RTSP",
      placeholder: "rtsp://192.168.1.10:554/canal1 (ou rtsp://usuario:senha@192.168.1.10:554/canal1)",
    },
    rtmp: { label: "RTMP", placeholder: "rtmp://192.168.1.10/live/stream" },
    hls: { label: "HLS", placeholder: "https://192.168.1.10/stream.m3u8" },
    srt: { label: "SRT", placeholder: "srt://192.168.1.10:9000?streamid=..." },
    "mjpeg-http": { label: t("cameraForm.sourceTypeMjpeg"), placeholder: "http://usuario:senha@192.168.1.10/video.mjpg" },
    webpage: { label: t("cameraForm.sourceTypeWebpage"), placeholder: "https://exemplo.com/pagina-com-video-ao-vivo" },
  };
}

function streamLabel(stream: DiscoveredStream, t: (key: string) => string): string {
  const resolution = stream.width && stream.height ? `${stream.width}x${stream.height}` : t("cameras.unknownResolution");
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
function initialStreamsFromCamera(camera: Camera | undefined, t: (key: string) => string): DiscoveredStream[] {
  if (!camera) return [];
  const byToken = new Map<string, DiscoveredStream>();
  if (camera.onvifProfileToken && camera.rtspMainUri) {
    byToken.set(camera.onvifProfileToken, {
      profileToken: camera.onvifProfileToken,
      name: t("cameraForm.previouslySelected"),
      encoding: camera.mainStreamEncoding,
      width: camera.mainStreamWidth,
      height: camera.mainStreamHeight,
      rtspUri: camera.rtspMainUri,
    });
  }
  if (camera.onvifSubProfileToken && camera.rtspSubUri && !byToken.has(camera.onvifSubProfileToken)) {
    byToken.set(camera.onvifSubProfileToken, {
      profileToken: camera.onvifSubProfileToken,
      name: t("cameraForm.previouslySelected"),
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
  const { t } = useTranslation();
  const DIRECT_SOURCE_INFO = directSourceInfo(t);
  const isEdit = Boolean(camera);
  const createCamera = useCreateCamera();
  const updateCamera = useUpdateCamera();
  const probeOnvif = useProbeOnvif();
  const probeCamera = useProbeCamera();

  const [onvifUrl, setOnvifUrl] = useState(() => onvifUrlDisplay(camera));
  const [sourceType, setSourceType] = useState<Camera["sourceType"]>(camera?.sourceType ?? "onvif");
  const [directUrl, setDirectUrl] = useState(() =>
    camera && camera.sourceType !== "onvif" ? (camera.rtspMainUri ?? "") : ""
  );
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
  const [rotation, setRotation] = useState<Camera["rotation"]>(camera?.rotation ?? 0);

  const [streams, setStreams] = useState<DiscoveredStream[]>(() => initialStreamsFromCamera(camera, t));
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

  // When editing and the user hasn't typed a (new) password anywhere, reuse
  // this camera's already-saved password via the cameraId-scoped probe
  // endpoint instead of forcing them to retype it just to re-discover
  // streams - only falls back to the generic /onvif/probe (which requires an
  // explicit password) when creating a camera, or when the user is
  // deliberately overriding credentials.
  const canProbeWithStoredPassword = isEdit && Boolean(camera) && !password && !onvifUrlHasCredentials;

  const handleProbe = async () => {
    setFormError(null);
    try {
      const result = canProbeWithStoredPassword
        ? await probeCamera.mutateAsync({
            id: camera!.id,
            input: { host, port: Number(port) || undefined, onvifPath, username },
          })
        : await probeOnvif.mutateAsync(
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
      const base = data?.error ?? t("cameraForm.onvifConnectionFailed");
      setFormError(data?.details ? `${base} (${data.details})` : base);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    if (sourceType === "onvif") {
      if (!isEdit && !password) {
        setFormError(t("cameraForm.passwordRequired"));
        return;
      }
    } else if (!directUrl.trim()) {
      setFormError(t("cameraForm.streamUrlRequired"));
      return;
    }

    const basePayload: CreateCameraInput | UpdateCameraInput = {
      name,
      sourceType,
      ...(sourceType !== "onvif" ? { rtspMainUri: directUrl.trim() } : {}),
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
      rotation,
      recordingMode,
      motionRecording,
      // Non-ONVIF sources have no PullPoint events for the video connection
      // itself (see types/camera.ts's CameraSourceType), so "onvif" isn't a
      // valid choice here regardless of what's selected - always "video".
      motionDetectionSource: sourceType === "onvif" ? motionDetectionSource : "video",
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
      setFormError(t("cameraForm.saveFailed"));
    }
  };

  const isSaving = createCamera.isPending || updateCamera.isPending;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-950 p-5">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">{isEdit ? t("cameraForm.editTitle") : t("cameraForm.addTitle")}</h2>
          <button type="button" onClick={onClose} className="text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div>
            <label className="mb-1 block text-xs text-neutral-500">{t("cameraForm.sourceTypeLabel")}</label>
            <select
              value={sourceType}
              onChange={(e) => setSourceType(e.target.value as Camera["sourceType"])}
              className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value="onvif">{t("cameraForm.sourceTypeOnvif")}</option>
              <option value="rtsp">{t("cameraForm.sourceTypeRtsp")}</option>
              <option value="rtmp">{t("cameraForm.sourceTypeRtmp")}</option>
              <option value="hls">{t("cameraForm.sourceTypeHls")}</option>
              <option value="srt">{t("cameraForm.sourceTypeSrt")}</option>
              <option value="mjpeg-http">{t("cameraForm.sourceTypeMjpeg")}</option>
              <option value="webpage">{t("cameraForm.sourceTypeWebpage")}</option>
            </select>
          </div>

          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("cameraForm.namePlaceholder")}
            required
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />

          {sourceType === "onvif" ? (
            <>
              <div>
                <label className="mb-1 block text-xs text-neutral-500">
                  {t("cameraForm.onvifUrlLabel")}
                </label>
                <div className="flex gap-2">
                  <input
                    value={onvifUrl}
                    onChange={(e) => setOnvifUrl(e.target.value)}
                    placeholder={t("cameraForm.onvifUrlPlaceholder")}
                    className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                  />
                </div>
                {isEdit && !onvifUrlHasCredentials && (
                  <p className="mt-1 text-[11px] text-neutral-500">
                    {t("cameraForm.onvifUrlPasswordHint")}
                  </p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={t("cameraForm.hostPlaceholder")}
                  required
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={t("cameraForm.onvifPortPlaceholder")}
                  type="number"
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                <input
                  value={onvifPath}
                  onChange={(e) => setOnvifPath(e.target.value)}
                  placeholder={t("cameraForm.onvifPathPlaceholder")}
                  className="col-span-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                <input
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder={t("cameraForm.usernamePlaceholder")}
                  required
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                <input
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isEdit ? t("cameraForm.passwordKeepPlaceholder") : t("cameraForm.passwordPlaceholder")}
                  type="password"
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
              </div>

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleProbe}
                  disabled={probeOnvif.isPending || probeCamera.isPending}
                  className="flex-1 rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
                >
                  {probeOnvif.isPending || probeCamera.isPending ? t("cameraForm.connecting") : t("cameraForm.getStreamUrls")}
                </button>
              </div>

              {streams.length > 0 && (
                <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3">
                  <div>
                    <label className="mb-1 block text-xs text-neutral-500">{t("cameraForm.mainStreamLabel")}</label>
                    <select
                      value={mainToken}
                      onChange={(e) => setMainToken(e.target.value)}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    >
                      {streams.map((s) => (
                        <option key={s.profileToken} value={s.profileToken}>
                          {streamLabel(s, t)}
                        </option>
                      ))}
                    </select>
                    {mainStream && (
                      <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">{mainStream.rtspUri}</p>
                    )}
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-neutral-500">
                      {t("cameraForm.subStreamLabel")}
                    </label>
                    <select
                      value={subToken}
                      onChange={(e) => setSubToken(e.target.value)}
                      className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    >
                      {streams.map((s) => (
                        <option key={s.profileToken} value={s.profileToken}>
                          {streamLabel(s, t)}
                        </option>
                      ))}
                    </select>
                    {subStreamSelected && (
                      <p className="mt-1 break-all font-mono text-[11px] text-neutral-500">
                        {subStreamSelected.rtspUri}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3">
              <label className="text-xs text-neutral-500">{t("cameraForm.directUrlLabel", { type: DIRECT_SOURCE_INFO[sourceType].label })}</label>
              <input
                value={directUrl}
                onChange={(e) => setDirectUrl(e.target.value)}
                placeholder={DIRECT_SOURCE_INFO[sourceType].placeholder}
                required
                className="w-full rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 font-mono text-sm"
              />
              {sourceType === "webpage" && (
                <p className="text-[11px] text-amber-500">
                  {t("cameraForm.webpageWarning")}
                </p>
              )}
              {sourceType === "mjpeg-http" && (
                <p className="text-[11px] text-neutral-500">
                  {t("cameraForm.mjpegHint")}
                </p>
              )}
              {sourceType === "rtsp" && (
                <>
                  <p className="text-[11px] text-neutral-500">
                    {t("cameraForm.rtspHint")}
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t("cameraForm.usernameOptionalPlaceholder")}
                      className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    />
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isEdit ? t("cameraForm.passwordKeepPlaceholder") : t("cameraForm.passwordOptionalPlaceholder")}
                      type="password"
                      className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    />
                  </div>
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={useVlcRelay} onChange={(e) => setUseVlcRelay(e.target.checked)} />
                    {t("cameraForm.incompatibleRtspCheckbox")}
                  </label>
                </>
              )}
            </div>
          )}

          {hasPtz && sourceType !== "onvif" && (
            <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3">
              <span className="text-xs text-neutral-500">
                {t("cameraForm.ptzOnvifConnectionHint")}
              </span>
              <div className="grid grid-cols-2 gap-3">
                <input
                  value={host}
                  onChange={(e) => setHost(e.target.value)}
                  placeholder={t("cameraForm.ptzHostPlaceholder")}
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                <input
                  value={port}
                  onChange={(e) => setPort(e.target.value)}
                  placeholder={t("cameraForm.onvifPortPlaceholder")}
                  type="number"
                  className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                <input
                  value={onvifPath}
                  onChange={(e) => setOnvifPath(e.target.value)}
                  placeholder={t("cameraForm.onvifPathPlaceholder")}
                  className="col-span-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                />
                {sourceType !== "rtsp" && (
                  <>
                    <input
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={t("cameraForm.ptzUsernamePlaceholder")}
                      className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    />
                    <input
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={isEdit ? t("cameraForm.passwordKeepPlaceholder") : t("cameraForm.ptzPasswordPlaceholder")}
                      type="password"
                      className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
                    />
                  </>
                )}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <span className="text-xs text-neutral-500">{t("cameraForm.rotationLabel")}</span>
            <select
              value={rotation}
              onChange={(e) => setRotation(Number(e.target.value) as Camera["rotation"])}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            >
              <option value={0}>{t("cameraForm.rotationNone")}</option>
              <option value={90}>{t("cameraForm.rotation90")}</option>
              <option value={180}>{t("cameraForm.rotation180")}</option>
              <option value={270}>{t("cameraForm.rotation270")}</option>
            </select>
            {rotation !== 0 && <span className="text-xs text-neutral-500">{t("cameraForm.rotationHint")}</span>}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <span className="text-xs text-neutral-500">{t("cameraForm.recordingModeLabel")}</span>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="recordingMode"
                checked={recordingMode === "off"}
                onChange={() => setRecordingMode("off")}
              />
              {t("cameraForm.recordingModeOff")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="recordingMode"
                checked={recordingMode === "continuous"}
                onChange={() => setRecordingMode("continuous")}
              />
              {t("cameraForm.recordingModeContinuous")}
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                name="recordingMode"
                checked={recordingMode === "motion"}
                onChange={() => setRecordingMode("motion")}
              />
              {t("cameraForm.recordingModeMotion")}
            </label>
            {recordingMode === "motion" && (
              <p className="text-[11px] text-neutral-500">
                {t("cameraForm.recordingModeMotionHint")}
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <span className="text-xs text-neutral-500">
              {t("cameraForm.motionDetectionLabel")}
            </span>
            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={motionRecording}
                onChange={(e) => setMotionRecording(e.target.checked)}
              />
              {t("cameraForm.motionDetectionCheckbox")}
            </label>
            {recordingMode === "motion" && !motionRecording && (
              <p className="text-[11px] text-amber-500">
                {t("cameraForm.motionDetectionNeedsSourceHint")}
              </p>
            )}
            {(recordingMode === "motion" || motionRecording) && (
              <>
                <label className="flex items-center gap-2">
                  {t("cameraForm.detectionSourceLabel")}
                  <select
                    value={motionDetectionSource}
                    onChange={(e) => setMotionDetectionSource(e.target.value as Camera["motionDetectionSource"])}
                    className="rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
                  >
                    <option value="video">{t("cameraForm.detectionSourceVideo")}</option>
                    {sourceType === "onvif" && <option value="onvif">{t("cameraForm.detectionSourceOnvif")}</option>}
                  </select>
                </label>
                <p className="text-[11px] text-neutral-500">
                  {motionDetectionSource === "video"
                    ? t("cameraForm.detectionSourceVideoHint")
                    : t("cameraForm.detectionSourceOnvifHint")}
                </p>
              </>
            )}
          </div>

          <div className="flex flex-col gap-2 rounded-md border border-neutral-800 p-3 text-sm">
            <label className="flex items-center gap-2">
              {t("cameraForm.retentionLabel")}
              <input
                type="number"
                value={retentionDays}
                onChange={(e) => setRetentionDays(e.target.value)}
                className="w-20 rounded-md border border-neutral-700 bg-neutral-900 px-2 py-1"
              />
            </label>
            {sourceType === "onvif" && (
              <>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={useVlcRelay}
                    onChange={(e) => setUseVlcRelay(e.target.checked)}
                  />
                  {t("cameraForm.vlcRelayCheckbox")}
                </label>
                {useVlcRelay && (
                  <p className="text-[11px] text-neutral-500">
                    {t("cameraForm.vlcRelayHint")}
                  </p>
                )}
              </>
            )}
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={hasPtz} onChange={(e) => setHasPtz(e.target.checked)} />
              {t("cameraForm.ptzCheckbox")}
            </label>
            {hasPtz && (
              <p className="text-[11px] text-neutral-500">
                {t("cameraForm.ptzHint")}
              </p>
            )}
          </div>

          {formError && <p className="text-xs text-red-400">{formError}</p>}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-md px-3 py-2 text-sm hover:bg-neutral-800">
              {t("cameraForm.cancel")}
            </button>
            <button
              type="submit"
              disabled={isSaving}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {isSaving ? t("cameraForm.saving") : isEdit ? t("cameraForm.saveChanges") : t("cameraForm.addCamera")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
