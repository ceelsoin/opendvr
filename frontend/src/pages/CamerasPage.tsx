import { useState } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  useCameras,
  useDeleteCamera,
  useDisableCamera,
  useEnableCamera,
  useRestartCamera,
  useTestCameraConnection,
} from "../api/cameras";
import type { Camera } from "../api/types";
import { CameraFormDialog } from "../components/cameras/CameraFormDialog";
import { OnvifScanModal } from "../components/cameras/OnvifScanModal";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { LogModal } from "../components/ui/LogModal";
import { PtzControls } from "../components/ptz/PtzControls";
import { useToastStore } from "../store/toastStore";

function extractErrorMessage(err: unknown, fallback: string): string {
  const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string; details?: string } | undefined) : undefined;
  const base = data?.error ?? fallback;
  return data?.details ? `${base} (${data.details})` : base;
}

export function CamerasPage() {
  const { t } = useTranslation();
  const { data: cameras } = useCameras();
  const deleteCamera = useDeleteCamera();
  const testConnection = useTestCameraConnection();
  const restartCamera = useRestartCamera();
  const enableCamera = useEnableCamera();
  const disableCamera = useDisableCamera();
  const addToast = useToastStore((s) => s.addToast);

  const [dialogState, setDialogState] = useState<"closed" | "create" | Camera>("closed");
  const [scanModalOpen, setScanModalOpen] = useState(false);
  const [expandedPtz, setExpandedPtz] = useState<string | null>(null);
  const [testedCameraId, setTestedCameraId] = useState<string | null>(null);
  const [restartingCameraId, setRestartingCameraId] = useState<string | null>(null);
  const [confirmAction, setConfirmAction] = useState<{ type: "delete" | "disable"; camera: Camera } | null>(null);
  const [restartLogCamera, setRestartLogCamera] = useState<Camera | null>(null);
  const [testLogCamera, setTestLogCamera] = useState<Camera | null>(null);

  const handleTestConnection = (camera: Camera) => {
    setTestedCameraId(camera.id);
    setTestLogCamera(camera);
    testConnection.mutate(camera.id, {
      onSuccess: (data) => {
        addToast("success", `${camera.name}: ${t("cameras.toastConnected", { count: data.streams?.length ?? 0 })}`);
      },
      onError: (err) => {
        addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.testConnectionFailed"))}`);
      },
    });
  };

  const handleRestart = (camera: Camera) => {
    setRestartingCameraId(camera.id);
    setRestartLogCamera(camera);
    restartCamera.mutate(camera.id, {
      onSuccess: (data) => {
        setRestartingCameraId(null);
        if (data.ok) {
          addToast("success", `${camera.name}: ${t("cameras.toastRestarted", { status: data.status })}`);
        } else {
          addToast("error", `${camera.name}: ${t("cameras.toastRestartedOffline", { status: data.status })}`);
        }
      },
      onError: (err) => {
        setRestartingCameraId(null);
        addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastRestartFailed"))}`);
      },
    });
  };

  const handleToggleEnabled = (camera: Camera) => {
    if (camera.enabled) {
      setConfirmAction({ type: "disable", camera });
      return;
    }
    enableCamera.mutate(camera.id, {
      onSuccess: (data) =>
        addToast(
          data.status === "online" ? "success" : "error",
          `${camera.name}: ${t("cameras.toastEnabled")}${data.status !== "online" ? t("cameras.toastEnabledOfflineSuffix") : ""}`
        ),
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastEnableFailed"))}`),
    });
  };

  const handleConfirmedDisable = (camera: Camera) => {
    disableCamera.mutate(camera.id, {
      onSuccess: () => addToast("success", `${camera.name}: ${t("cameras.toastDisabled")}`),
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastDisableFailed"))}`),
    });
  };

  const handleConfirmedDelete = (camera: Camera) => {
    deleteCamera.mutate(camera.id, {
      onSuccess: () => addToast("success", `${camera.name}: ${t("cameras.toastRemoved")}`),
      onError: (err) => addToast("error", `${camera.name}: ${extractErrorMessage(err, t("cameras.toastRemoveFailed"))}`),
    });
  };

  return (
    <div className="flex flex-col gap-8">
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-semibold">{t("cameras.title")}</h2>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setScanModalOpen(true)}
              className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
            >
              {t("cameras.discoverButton")}
            </button>
            <button
              type="button"
              onClick={() => setDialogState("create")}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500"
            >
              {t("cameras.addButton")}
            </button>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          {cameras?.map((camera) => (
            <div key={camera.id} className="rounded-md border border-neutral-800 bg-neutral-900">
              <div className="flex flex-col gap-2.5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <span
                    title={!camera.enabled ? t("cameras.statusDisabledTitle") : undefined}
                    className={`h-2 w-2 shrink-0 rounded-full ${
                      !camera.enabled
                        ? "bg-neutral-700"
                        : camera.status === "online"
                          ? "bg-green-500"
                          : camera.status === "offline"
                            ? "bg-red-500"
                            : "bg-neutral-500"
                    }`}
                  />
                  <div>
                    <p className="text-sm font-medium">
                      {camera.name}
                      {!camera.enabled && <span className="ml-2 text-xs font-normal text-neutral-500">{t("cameras.disabledSuffix")}</span>}
                    </p>
                    <p className="text-xs text-neutral-500">
                      {camera.host}:{camera.port}
                      {camera.onvifPath}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5 sm:justify-end">
                  <button
                    type="button"
                    onClick={() => handleToggleEnabled(camera)}
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-700 active:bg-neutral-600"
                  >
                    {camera.enabled ? t("cameras.turnOff") : t("cameras.turnOn")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleTestConnection(camera)}
                    disabled={testConnection.isPending && testedCameraId === camera.id}
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-700 active:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {testConnection.isPending && testedCameraId === camera.id
                      ? t("cameras.testingConnection")
                      : t("cameras.testConnection")}
                  </button>
                  <button
                    type="button"
                    onClick={() => handleRestart(camera)}
                    disabled={restartingCameraId === camera.id || !camera.enabled}
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-700 active:bg-neutral-600 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:bg-neutral-800"
                  >
                    {restartingCameraId === camera.id ? t("cameras.restarting") : t("cameras.restart")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpandedPtz(expandedPtz === camera.id ? null : camera.id)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors active:bg-neutral-600 ${
                      expandedPtz === camera.id
                        ? "border-blue-700 bg-blue-950 text-blue-300 hover:border-blue-600 hover:bg-blue-900"
                        : "border-neutral-700 bg-neutral-800 text-neutral-300 hover:border-neutral-600 hover:bg-neutral-700"
                    }`}
                  >
                    {t("cameras.ptzButton")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDialogState(camera)}
                    className="rounded-md border border-neutral-700 bg-neutral-800 px-2.5 py-1.5 text-xs font-medium text-neutral-300 transition-colors hover:border-neutral-600 hover:bg-neutral-700 active:bg-neutral-600"
                  >
                    {t("cameras.edit")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmAction({ type: "delete", camera })}
                    className="rounded-md border border-red-900 bg-red-950 px-2.5 py-1.5 text-xs font-medium text-red-400 transition-colors hover:border-red-800 hover:bg-red-900 active:bg-red-800"
                  >
                    {t("cameras.remove")}
                  </button>
                </div>
              </div>

              {testedCameraId === camera.id && testConnection.data?.ok && (
                <div className="border-t border-neutral-800 px-4 py-2 text-xs">
                  <p className="text-green-400">
                    {t("cameras.connectedStreams", { count: testConnection.data.streams?.length ?? 0 })}
                  </p>
                </div>
              )}
              {testedCameraId === camera.id && testConnection.isError && (
                <div className="border-t border-neutral-800 px-4 py-2 text-xs text-red-400">
                  {extractErrorMessage(testConnection.error, t("cameras.testConnectionFailed"))}
                </div>
              )}

              {expandedPtz === camera.id && (
                <div className="border-t border-neutral-800 px-4 py-3">
                  <PtzControls cameraId={camera.id} />
                </div>
              )}
            </div>
          ))}
          {!cameras?.length && <p className="text-sm text-neutral-500">{t("cameras.none")}</p>}
        </div>
      </section>

      {dialogState !== "closed" && (
        <CameraFormDialog
          camera={dialogState === "create" ? undefined : dialogState}
          onClose={() => setDialogState("closed")}
        />
      )}

      {scanModalOpen && <OnvifScanModal onClose={() => setScanModalOpen(false)} />}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction.type === "delete" ? t("cameras.confirmDeleteTitle") : t("cameras.confirmDisableTitle")}
          message={
            confirmAction.type === "delete"
              ? t("cameras.confirmDeleteMessage", { name: confirmAction.camera.name })
              : t("cameras.confirmDisableMessage", { name: confirmAction.camera.name })
          }
          confirmLabel={confirmAction.type === "delete" ? t("cameras.remove") : t("cameras.turnOff")}
          cancelLabel={t("cameras.confirmCancel")}
          danger={confirmAction.type === "delete"}
          isConfirming={confirmAction.type === "delete" ? deleteCamera.isPending : disableCamera.isPending}
          onCancel={() => setConfirmAction(null)}
          onConfirm={() => {
            if (confirmAction.type === "delete") {
              handleConfirmedDelete(confirmAction.camera);
            } else {
              handleConfirmedDisable(confirmAction.camera);
            }
            setConfirmAction(null);
          }}
        />
      )}

      {restartLogCamera && (
        <LogModal
          title={t("cameras.restartLogTitle", { name: restartLogCamera.name })}
          cameraId={restartLogCamera.id}
          isRunning={restartingCameraId === restartLogCamera.id}
          onClose={() => setRestartLogCamera(null)}
        />
      )}

      {testLogCamera && (
        <LogModal
          title={t("cameras.testLogTitle", { name: testLogCamera.name })}
          cameraId={testLogCamera.id}
          isRunning={testConnection.isPending && testedCameraId === testLogCamera.id}
          onClose={() => setTestLogCamera(null)}
        />
      )}
    </div>
  );
}
