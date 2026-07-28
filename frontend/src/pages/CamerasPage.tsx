import { useState } from "react";
import axios from "axios";
import {
  useCameras,
  useDeleteCamera,
  useDiscoverCameras,
  useRestartCamera,
  useTestCameraConnection,
} from "../api/cameras";
import type { Camera } from "../api/types";
import { CameraFormDialog } from "../components/cameras/CameraFormDialog";
import { PtzControls } from "../components/ptz/PtzControls";
import { useToastStore } from "../store/toastStore";

function extractErrorMessage(err: unknown, fallback: string): string {
  const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: string } | undefined) : undefined;
  const base = data?.error ?? fallback;
  return data?.details ? `${base} (${data.details})` : base;
}

export function CamerasPage() {
  const { data: cameras } = useCameras();
  const deleteCamera = useDeleteCamera();
  const testConnection = useTestCameraConnection();
  const restartCamera = useRestartCamera();
  const discoverCameras = useDiscoverCameras();
  const addToast = useToastStore((s) => s.addToast);

  const [dialogState, setDialogState] = useState<"closed" | "create" | Camera>("closed");
  const [expandedPtz, setExpandedPtz] = useState<string | null>(null);
  const [testedCameraId, setTestedCameraId] = useState<string | null>(null);
  const [restartingCameraId, setRestartingCameraId] = useState<string | null>(null);

  const handleTestConnection = (camera: Camera) => {
    setTestedCameraId(camera.id);
    testConnection.mutate(camera.id, {
      onSuccess: (data) => {
        addToast("success", `${camera.name}: conectado — ${data.streams?.length ?? 0} stream(s) encontrado(s).`);
      },
      onError: (err) => {
        addToast("error", `${camera.name}: ${extractErrorMessage(err, "Falha ao testar a conexão com a câmera.")}`);
      },
    });
  };

  const handleRestart = (camera: Camera) => {
    setRestartingCameraId(camera.id);
    restartCamera.mutate(camera.id, {
      onSuccess: (data) => {
        setRestartingCameraId(null);
        if (data.ok) {
          addToast("success", `${camera.name}: reiniciada com sucesso (status: ${data.status}).`);
        } else {
          addToast("error", `${camera.name}: reiniciou mas ficou offline (status: ${data.status}). Verifique host/credenciais.`);
        }
      },
      onError: (err) => {
        setRestartingCameraId(null);
        addToast("error", `${camera.name}: ${extractErrorMessage(err, "Falha ao reiniciar a câmera.")}`);
      },
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">Câmeras cadastradas</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => discoverCameras.mutate(5000)}
              disabled={discoverCameras.isPending}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:opacity-50"
            >
              {discoverCameras.isPending ? "Procurando na rede..." : "Descobrir câmeras (ONVIF)"}
            </button>
            <button
              type="button"
              onClick={() => setDialogState("create")}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
            >
              Adicionar câmera
            </button>
          </div>
        </div>

        {discoverCameras.data && (
          <div className="mb-4 flex flex-col gap-2">
            {discoverCameras.data.length === 0 ? (
              <p className="text-sm text-neutral-500">Nenhum dispositivo ONVIF encontrado na rede.</p>
            ) : (
              discoverCameras.data.map((device) => (
                <div
                  key={`${device.hostname}:${device.port}`}
                  className="flex items-center justify-between rounded-md border border-neutral-800 bg-neutral-900 px-3 py-2 text-sm text-neutral-300"
                >
                  <span>
                    {device.hostname}:{device.port}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDialogState({
                        id: "",
                        name: "",
                        host: device.hostname,
                        port: device.port,
                        onvifPath: "/onvif/device_service",
                        username: "",
                        rtspMainUri: null,
                        rtspSubUri: null,
                        onvifProfileToken: null,
                        onvifSubProfileToken: null,
                        rtspCompatMode: null,
                        mainStreamWidth: null,
                        mainStreamHeight: null,
                        mainStreamEncoding: null,
                        subStreamWidth: null,
                        subStreamHeight: null,
                        subStreamEncoding: null,
                        hasPtz: false,
                        recordingMode: "off",
                        motionRecording: true,
                        motionDetectionSource: "onvif",
                        retentionDays: 7,
                        status: "unknown",
                        createdAt: "",
                        updatedAt: "",
                      })
                    }
                    className="rounded-md px-2 py-1 text-xs text-blue-400 hover:bg-blue-950"
                  >
                    Usar este endereço
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {cameras?.map((camera) => (
            <div key={camera.id} className="rounded-md border border-neutral-800 bg-neutral-900">
              <div className="flex items-center justify-between px-4 py-2">
                <div className="flex items-center gap-2">
                  <span
                    className={`h-2 w-2 rounded-full ${
                      camera.status === "online"
                        ? "bg-green-500"
                        : camera.status === "offline"
                          ? "bg-red-500"
                          : "bg-neutral-500"
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium">{camera.name}</p>
                    <p className="text-xs text-neutral-500">
                      {camera.host}:{camera.port}
                      {camera.onvifPath}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => handleTestConnection(camera)}
                    disabled={testConnection.isPending && testedCameraId === camera.id}
                    className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Testar conexão
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestart(camera)}
                    disabled={restartingCameraId === camera.id}
                    className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    {restartingCameraId === camera.id ? "Reiniciando..." : "Reiniciar"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedPtz(expandedPtz === camera.id ? null : camera.id)}
                    className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    PTZ
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogState(camera)}
                    className="rounded-md px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    onClick={() => deleteCamera.mutate(camera.id)}
                    className="rounded-md px-2 py-1 text-xs text-red-400 hover:bg-red-950"
                  >
                    Remover
                  </button>
                </div>
              </div>

              {testedCameraId === camera.id && testConnection.data?.ok && (
                <div className="border-t border-neutral-800 px-4 py-2 text-xs">
                  <p className="text-green-400">
                    Conectado — {testConnection.data.streams?.length ?? 0} stream(s) encontrado(s).
                  </p>
                </div>
              )}
              {testedCameraId === camera.id && testConnection.isError && (
                <div className="border-t border-neutral-800 px-4 py-2 text-xs text-red-400">
                  {extractErrorMessage(testConnection.error, "Falha ao testar a conexão com a câmera.")}
                </div>
              )}

              {expandedPtz === camera.id && (
                <div className="border-t border-neutral-800 px-4 py-3">
                  <PtzControls cameraId={camera.id} />
                </div>
              )}
            </div>
          ))}
          {!cameras?.length && <p className="text-sm text-neutral-500">Nenhuma câmera cadastrada.</p>}
        </div>
      </section>

      {dialogState !== "closed" && (
        <CameraFormDialog
          camera={dialogState === "create" ? undefined : dialogState}
          onClose={() => setDialogState("closed")}
        />
      )}
    </div>
  );
}
