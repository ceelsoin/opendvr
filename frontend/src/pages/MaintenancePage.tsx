import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useCameras } from "../api/cameras";
import { useChangePassword, useDeleteRecordings, useFactoryReset, useRestartServer } from "../api/maintenance";
import { ConfirmDialog } from "../components/ui/ConfirmDialog";
import { LogModal } from "../components/ui/LogModal";
import { extractErrorMessage } from "../lib/apiError";
import { useToastStore } from "../store/toastStore";

const FACTORY_RESET_CONFIRM_PHRASE = "RESETAR";

export function MaintenancePage() {
  const { t } = useTranslation();
  const addToast = useToastStore((s) => s.addToast);
  const { data: cameras } = useCameras();

  const changePassword = useChangePassword();
  const restartServer = useRestartServer();
  const factoryReset = useFactoryReset();
  const deleteRecordings = useDeleteRecordings();

  // Change password
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  // Restart server
  const [confirmRestart, setConfirmRestart] = useState(false);
  const [restartLogOpen, setRestartLogOpen] = useState(false);

  // Factory reset
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);

  // Delete recordings
  const [recordingsCameraId, setRecordingsCameraId] = useState<string>("");
  const [confirmDeleteRecordings, setConfirmDeleteRecordings] = useState(false);

  // Logs
  const [logsOpen, setLogsOpen] = useState(false);

  const handleChangePassword = (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      addToast("error", t("maintenance.changePassword.mismatch"));
      return;
    }
    changePassword.mutate(
      { currentPassword, newPassword },
      {
        onSuccess: () => {
          addToast("success", t("maintenance.changePassword.success"));
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
        },
        onError: (err) => addToast("error", extractErrorMessage(err, t("maintenance.changePassword.failed"))),
      }
    );
  };

  const handleRestartServer = () => {
    setConfirmRestart(false);
    setRestartLogOpen(true);
    restartServer.mutate(undefined, {
      onSuccess: () => addToast("success", t("maintenance.restartServer.success")),
      onError: (err) => addToast("error", extractErrorMessage(err, t("maintenance.restartServer.failed"))),
    });
  };

  const handleFactoryReset = () => {
    setConfirmReset(false);
    factoryReset.mutate(resetPassword, {
      onSuccess: () => {
        addToast("success", t("maintenance.factoryReset.success"));
        setTimeout(() => window.location.assign(`${import.meta.env.BASE_URL}`), 1500);
      },
      onError: (err) => addToast("error", extractErrorMessage(err, t("maintenance.factoryReset.failed"))),
    });
  };

  const handleDeleteRecordings = () => {
    setConfirmDeleteRecordings(false);
    deleteRecordings.mutate(recordingsCameraId || undefined, {
      onSuccess: () => addToast("success", t("maintenance.deleteRecordings.success")),
      onError: (err) => addToast("error", extractErrorMessage(err, t("maintenance.deleteRecordings.failed"))),
    });
  };

  const selectedCameraName = cameras?.find((c) => c.id === recordingsCameraId)?.name;

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-base font-semibold">{t("maintenance.title")}</h2>

      {/* Change password */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-3 text-sm font-semibold">{t("maintenance.changePassword.title")}</h3>
        <form onSubmit={handleChangePassword} className="flex max-w-sm flex-col gap-2">
          <input
            type="password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            placeholder={t("maintenance.changePassword.currentPlaceholder")}
            required
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder={t("maintenance.changePassword.newPlaceholder")}
            required
            minLength={8}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            placeholder={t("maintenance.changePassword.confirmPlaceholder")}
            required
            minLength={8}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <button
            type="submit"
            disabled={changePassword.isPending}
            className="mt-1 self-start rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("maintenance.changePassword.submit")}
          </button>
        </form>
      </section>

      {/* Logs */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-1 text-sm font-semibold">{t("maintenance.logs.title")}</h3>
        <p className="mb-3 text-xs text-neutral-500">{t("maintenance.logs.hint")}</p>
        <button
          type="button"
          onClick={() => setLogsOpen(true)}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700"
        >
          {t("maintenance.logs.viewButton")}
        </button>
      </section>

      {/* Delete recordings */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-1 text-sm font-semibold">{t("maintenance.deleteRecordings.title")}</h3>
        <p className="mb-3 text-xs text-neutral-500">{t("maintenance.deleteRecordings.hint")}</p>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={recordingsCameraId}
            onChange={(e) => setRecordingsCameraId(e.target.value)}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          >
            <option value="">{t("maintenance.deleteRecordings.allCameras")}</option>
            {cameras?.map((camera) => (
              <option key={camera.id} value={camera.id}>
                {camera.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => setConfirmDeleteRecordings(true)}
            disabled={deleteRecordings.isPending}
            className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("maintenance.deleteRecordings.submit")}
          </button>
        </div>
      </section>

      {/* Restart server */}
      <section className="rounded-md border border-neutral-800 bg-neutral-900 p-4">
        <h3 className="mb-1 text-sm font-semibold">{t("maintenance.restartServer.title")}</h3>
        <p className="mb-3 text-xs text-neutral-500">{t("maintenance.restartServer.hint")}</p>
        <button
          type="button"
          onClick={() => setConfirmRestart(true)}
          disabled={restartServer.isPending}
          className="rounded-md bg-neutral-800 px-3 py-1.5 text-sm hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t("maintenance.restartServer.submit")}
        </button>
      </section>

      {/* Factory reset */}
      <section className="rounded-md border border-red-950 bg-neutral-900 p-4">
        <h3 className="mb-1 text-sm font-semibold text-red-400">{t("maintenance.factoryReset.title")}</h3>
        <p className="mb-3 text-xs text-neutral-500">{t("maintenance.factoryReset.hint")}</p>
        <div className="flex max-w-sm flex-col gap-2">
          <input
            value={resetPhrase}
            onChange={(e) => setResetPhrase(e.target.value)}
            placeholder={t("maintenance.factoryReset.phrasePlaceholder", { phrase: FACTORY_RESET_CONFIRM_PHRASE })}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <input
            type="password"
            value={resetPassword}
            onChange={(e) => setResetPassword(e.target.value)}
            placeholder={t("maintenance.factoryReset.passwordPlaceholder")}
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={resetPhrase !== FACTORY_RESET_CONFIRM_PHRASE || !resetPassword || factoryReset.isPending}
            className="mt-1 self-start rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium hover:bg-red-500 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t("maintenance.factoryReset.submit")}
          </button>
        </div>
      </section>

      {confirmRestart && (
        <ConfirmDialog
          title={t("maintenance.restartServer.confirmTitle")}
          message={t("maintenance.restartServer.confirmMessage")}
          confirmLabel={t("maintenance.restartServer.submit")}
          cancelLabel={t("cameras.confirmCancel")}
          onConfirm={handleRestartServer}
          onCancel={() => setConfirmRestart(false)}
        />
      )}

      {confirmReset && (
        <ConfirmDialog
          title={t("maintenance.factoryReset.confirmTitle")}
          message={t("maintenance.factoryReset.confirmMessage")}
          confirmLabel={t("maintenance.factoryReset.submit")}
          cancelLabel={t("cameras.confirmCancel")}
          danger
          isConfirming={factoryReset.isPending}
          onConfirm={handleFactoryReset}
          onCancel={() => setConfirmReset(false)}
        />
      )}

      {confirmDeleteRecordings && (
        <ConfirmDialog
          title={t("maintenance.deleteRecordings.confirmTitle")}
          message={
            recordingsCameraId
              ? t("maintenance.deleteRecordings.confirmMessageCamera", { name: selectedCameraName ?? "" })
              : t("maintenance.deleteRecordings.confirmMessageAll")
          }
          confirmLabel={t("maintenance.deleteRecordings.submit")}
          cancelLabel={t("cameras.confirmCancel")}
          danger
          isConfirming={deleteRecordings.isPending}
          onConfirm={handleDeleteRecordings}
          onCancel={() => setConfirmDeleteRecordings(false)}
        />
      )}

      {restartLogOpen && (
        <LogModal
          title={t("maintenance.restartServer.logTitle")}
          isRunning={restartServer.isPending}
          onClose={() => setRestartLogOpen(false)}
        />
      )}

      {logsOpen && (
        <LogModal title={t("maintenance.logs.title")} isRunning={false} onClose={() => setLogsOpen(false)} />
      )}
    </div>
  );
}
