import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import {
  useNotificationSettings,
  useTestNotification,
  useUpdateNotificationSettings,
} from "../api/settings";
import { useStreamSettings, useUpdateStreamSettings, type HlsVariant } from "../api/streamSettings";
import { useCaptionSettings, useUpdateCaptionSettings } from "../api/captioning";
import { useSubscribePush, useUnsubscribePush, useVapidPublicKey } from "../api/push";
import { getExistingPushSubscription, isPushSupported, subscribeToPush, unsubscribeFromPush } from "../lib/push";
import { useToastStore } from "../store/toastStore";

export function SettingsPage() {
  const { t } = useTranslation();
  const { data: status, isLoading } = useNotificationSettings();
  const updateSettings = useUpdateNotificationSettings();
  const testNotification = useTestNotification();
  const addToast = useToastStore((s) => s.addToast);

  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordAttachSnapshot, setDiscordAttachSnapshot] = useState(true);

  const [telegramBotToken, setTelegramBotToken] = useState("");
  const [telegramChatId, setTelegramChatId] = useState("");
  const [telegramAttachSnapshot, setTelegramAttachSnapshot] = useState(true);

  const [webhookUrl, setWebhookUrl] = useState("");
  const [webhookAttachSnapshot, setWebhookAttachSnapshot] = useState(true);

  const [emailSmtpHost, setEmailSmtpHost] = useState("");
  const [emailSmtpPort, setEmailSmtpPort] = useState("587");
  const [emailSmtpUser, setEmailSmtpUser] = useState("");
  const [emailSmtpPass, setEmailSmtpPass] = useState("");
  const [emailSmtpSecure, setEmailSmtpSecure] = useState(false);
  const [emailFrom, setEmailFrom] = useState("");
  const [emailTo, setEmailTo] = useState("");
  const [emailAttachSnapshot, setEmailAttachSnapshot] = useState(true);

  const [s3Endpoint, setS3Endpoint] = useState("");
  const [s3Region, setS3Region] = useState("");
  const [s3AccessKey, setS3AccessKey] = useState("");
  const [s3SecretKey, setS3SecretKey] = useState("");
  const [s3BucketName, setS3BucketName] = useState("");

  const { data: streamSettings } = useStreamSettings();
  const updateStreamSettings = useUpdateStreamSettings();
  const [hlsVariant, setHlsVariant] = useState<HlsVariant>("lowLatency");
  const [hlsSegmentCount, setHlsSegmentCount] = useState("7");
  const [hlsSegmentDuration, setHlsSegmentDuration] = useState("1s");
  const [hlsPartDuration, setHlsPartDuration] = useState("200ms");
  const [hlsSegmentMaxSize, setHlsSegmentMaxSize] = useState("50M");
  const [hlsAlwaysRemux, setHlsAlwaysRemux] = useState(false);
  const [hlsMuxerCloseAfter, setHlsMuxerCloseAfter] = useState("60s");
  const [preferSubStreamInGrid, setPreferSubStreamInGrid] = useState(false);
  const [playerLiveSyncDurationCount, setPlayerLiveSyncDurationCount] = useState("3");
  const [playerMaxBufferLength, setPlayerMaxBufferLength] = useState("10");

  const { data: captionSettings } = useCaptionSettings();
  const updateCaptionSettings = useUpdateCaptionSettings();
  const [captionEnabled, setCaptionEnabled] = useState(false);
  const [captionEndpoint, setCaptionEndpoint] = useState("");
  const [captionApiKey, setCaptionApiKey] = useState("");
  const [captionModel, setCaptionModel] = useState("");
  const [captionPerson, setCaptionPerson] = useState(true);
  const [captionVehicle, setCaptionVehicle] = useState(true);
  const [captionAnimal, setCaptionAnimal] = useState(false);
  const [captionOther, setCaptionOther] = useState(false);

  const pushSupported = isPushSupported();
  const [pushSubscription, setPushSubscription] = useState<PushSubscription | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const vapidPublicKey = useVapidPublicKey();
  const subscribePush = useSubscribePush();
  const unsubscribePush = useUnsubscribePush();

  useEffect(() => {
    if (!pushSupported) return;
    getExistingPushSubscription()
      .then(setPushSubscription)
      .catch(() => {});
  }, [pushSupported]);

  useEffect(() => {
    if (!status) return;
    setDiscordWebhookUrl(status.discordWebhookUrl ?? "");
    setDiscordAttachSnapshot(status.discordAttachSnapshot);
    setTelegramBotToken(status.telegramBotToken ?? "");
    setTelegramChatId(status.telegramChatId ?? "");
    setTelegramAttachSnapshot(status.telegramAttachSnapshot);
    setWebhookUrl(status.webhookUrl ?? "");
    setWebhookAttachSnapshot(status.webhookAttachSnapshot);
    setEmailSmtpHost(status.emailSmtpHost ?? "");
    setEmailSmtpPort(String(status.emailSmtpPort ?? 587));
    setEmailSmtpUser(status.emailSmtpUser ?? "");
    setEmailSmtpSecure(status.emailSmtpSecure);
    setEmailFrom(status.emailFrom ?? "");
    setEmailTo(status.emailTo ?? "");
    setEmailAttachSnapshot(status.emailAttachSnapshot);
    setS3Endpoint(status.s3Endpoint ?? "");
    setS3Region(status.s3Region ?? "");
    setS3AccessKey(status.s3AccessKey ?? "");
    setS3BucketName(status.s3BucketName ?? "");
  }, [status]);

  useEffect(() => {
    if (!streamSettings) return;
    setHlsVariant(streamSettings.hlsVariant);
    setHlsSegmentCount(String(streamSettings.hlsSegmentCount));
    setHlsSegmentDuration(streamSettings.hlsSegmentDuration);
    setHlsPartDuration(streamSettings.hlsPartDuration);
    setHlsSegmentMaxSize(streamSettings.hlsSegmentMaxSize);
    setHlsAlwaysRemux(streamSettings.hlsAlwaysRemux);
    setHlsMuxerCloseAfter(streamSettings.hlsMuxerCloseAfter);
    setPreferSubStreamInGrid(streamSettings.preferSubStreamInGrid);
    setPlayerLiveSyncDurationCount(String(streamSettings.playerLiveSyncDurationCount));
    setPlayerMaxBufferLength(String(streamSettings.playerMaxBufferLength));
  }, [streamSettings]);

  useEffect(() => {
    if (!captionSettings) return;
    setCaptionEnabled(captionSettings.enabled);
    setCaptionEndpoint(captionSettings.endpoint ?? "");
    setCaptionApiKey(captionSettings.apiKey ?? "");
    setCaptionModel(captionSettings.model ?? "");
    setCaptionPerson(captionSettings.categoryPerson);
    setCaptionVehicle(captionSettings.categoryVehicle);
    setCaptionAnimal(captionSettings.categoryAnimal);
    setCaptionOther(captionSettings.categoryOther);
  }, [captionSettings]);

  const extractErrorMessage = (err: unknown, fallback: string): string => {
    const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string }) : undefined;
    return data?.error ?? fallback;
  };

  const handleTest = async (channel: "discord" | "telegram" | "webhook" | "email" | "push") => {
    try {
      const result = await testNotification.mutateAsync(channel);
      if (result.ok) {
        addToast("success", t("settingsPage.toastTestSent"));
      } else {
        addToast("error", result.error ?? t("settingsPage.toastTestFailed"));
      }
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastTestFailed")));
    }
  };

  const handleSaveCaptioning = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateCaptionSettings.mutateAsync({
        enabled: captionEnabled,
        endpoint: captionEndpoint || null,
        apiKey: captionApiKey || null,
        model: captionModel || null,
        categoryPerson: captionPerson,
        categoryVehicle: captionVehicle,
        categoryAnimal: captionAnimal,
        categoryOther: captionOther,
      });
      addToast("success", t("settingsPage.toastCaptioningSaved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastCaptioningSaveFailed")));
    }
  };

  const handleSaveDiscord = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(discordWebhookUrl ? { discordWebhookUrl } : {}),
        discordAttachSnapshot,
      });
      addToast("success", t("settingsPage.toastDiscordSaved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastDiscordSaveFailed")));
    }
  };

  const handleClearDiscord = async () => {
    try {
      await updateSettings.mutateAsync({ discordWebhookUrl: null });
      addToast("success", t("settingsPage.toastDiscordRemoved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastDiscordRemoveFailed")));
    }
  };

  const handleSaveTelegram = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(telegramBotToken ? { telegramBotToken } : {}),
        ...(telegramChatId ? { telegramChatId } : {}),
        telegramAttachSnapshot,
      });
      addToast("success", t("settingsPage.toastTelegramSaved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastTelegramSaveFailed")));
    }
  };

  const handleClearTelegram = async () => {
    try {
      await updateSettings.mutateAsync({ telegramBotToken: null, telegramChatId: null });
      addToast("success", t("settingsPage.toastTelegramRemoved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastTelegramRemoveFailed")));
    }
  };

  const handleSaveWebhook = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(webhookUrl ? { webhookUrl } : {}),
        webhookAttachSnapshot,
      });
      addToast("success", t("settingsPage.toastWebhookSaved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastWebhookSaveFailed")));
    }
  };

  const handleClearWebhook = async () => {
    try {
      await updateSettings.mutateAsync({ webhookUrl: null });
      addToast("success", t("settingsPage.toastWebhookRemoved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastWebhookRemoveFailed")));
    }
  };

  const handleSaveEmail = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(emailSmtpHost ? { emailSmtpHost } : {}),
        emailSmtpPort: Number(emailSmtpPort) || 587,
        ...(emailSmtpUser ? { emailSmtpUser } : {}),
        ...(emailSmtpPass ? { emailSmtpPass } : {}),
        emailSmtpSecure,
        ...(emailFrom ? { emailFrom } : {}),
        ...(emailTo ? { emailTo } : {}),
        emailAttachSnapshot,
      });
      setEmailSmtpPass("");
      addToast("success", t("settingsPage.toastEmailSaved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastEmailSaveFailed")));
    }
  };

  const handleClearEmail = async () => {
    try {
      await updateSettings.mutateAsync({
        emailSmtpHost: null,
        emailSmtpUser: null,
        emailSmtpPass: null,
        emailFrom: null,
        emailTo: null,
      });
      addToast("success", t("settingsPage.toastEmailRemoved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastEmailRemoveFailed")));
    }
  };

  const handleSaveStream = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateStreamSettings.mutateAsync({
        hlsVariant,
        hlsSegmentCount: Number(hlsSegmentCount),
        hlsSegmentDuration,
        hlsPartDuration,
        hlsSegmentMaxSize,
        hlsAlwaysRemux,
        hlsMuxerCloseAfter,
        preferSubStreamInGrid,
        playerLiveSyncDurationCount: Number(playerLiveSyncDurationCount),
        playerMaxBufferLength: Number(playerMaxBufferLength),
      });
      addToast("success", t("settingsPage.toastStreamSaved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastStreamSaveFailed")));
    }
  };

  const handleSaveS3 = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(s3Endpoint ? { s3Endpoint } : {}),
        ...(s3Region ? { s3Region } : {}),
        ...(s3AccessKey ? { s3AccessKey } : {}),
        ...(s3SecretKey ? { s3SecretKey } : {}),
        ...(s3BucketName ? { s3BucketName } : {}),
      });
      setS3SecretKey("");
      addToast("success", t("settingsPage.toastS3Saved"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastS3SaveFailed")));
    }
  };

  const handleClearS3 = async () => {
    try {
      await updateSettings.mutateAsync({
        s3Endpoint: null,
        s3Region: null,
        s3AccessKey: null,
        s3SecretKey: null,
        s3BucketName: null,
      });
      addToast("success", t("settingsPage.toastS3Removed"));
    } catch (err) {
      addToast("error", extractErrorMessage(err, t("settingsPage.toastS3RemoveFailed")));
    }
  };

  const handleEnablePush = async () => {
    if (!vapidPublicKey.data) return;
    setPushBusy(true);
    try {
      const subscription = await subscribeToPush(vapidPublicKey.data);
      const json = subscription.toJSON() as { endpoint?: string; keys?: { p256dh: string; auth: string } };
      if (!json.endpoint || !json.keys) {
        throw new Error("missing-subscription-fields");
      }
      await subscribePush.mutateAsync({ endpoint: json.endpoint, keys: json.keys });
      setPushSubscription(subscription);
      addToast("success", t("settingsPage.toastPushEnabled"));
    } catch (err) {
      if (err instanceof Error && err.message === "permission-denied") {
        addToast("error", t("settingsPage.toastPushPermissionDenied"));
      } else {
        addToast("error", t("settingsPage.toastPushEnableFailed"));
      }
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!pushSubscription) return;
    setPushBusy(true);
    try {
      const endpoint = pushSubscription.endpoint;
      await unsubscribeFromPush(pushSubscription);
      await unsubscribePush.mutateAsync(endpoint);
      setPushSubscription(null);
      addToast("success", t("settingsPage.toastPushDisabled"));
    } catch {
      addToast("error", t("settingsPage.toastPushDisableFailed"));
    } finally {
      setPushBusy(false);
    }
  };

  if (isLoading) {
    return <p className="text-neutral-400">{t("settingsPage.loadingSettings")}</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">{t("settingsPage.title")}</h2>
        <p className="text-sm text-neutral-500">
          {t("settingsPage.description")}
        </p>
      </div>

      {/* Streaming (HLS) optimization */}
      <form onSubmit={handleSaveStream} className="flex flex-col gap-3 rounded-lg border border-neutral-800 p-4">
        <div>
          <h3 className="text-sm font-medium">{t("settingsPage.streamTitle")}</h3>
          <p className="text-sm text-neutral-500">{t("settingsPage.streamDescription")}</p>
        </div>

        <label className="flex flex-col gap-1 text-sm">
          {t("settingsPage.streamVariantLabel")}
          <select
            value={hlsVariant}
            onChange={(e) => setHlsVariant(e.target.value as HlsVariant)}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          >
            <option value="lowLatency">{t("settingsPage.streamVariantLowLatency")}</option>
            <option value="fmp4">{t("settingsPage.streamVariantFmp4")}</option>
            <option value="mpegts">{t("settingsPage.streamVariantMpegts")}</option>
          </select>
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamSegmentCountLabel")}
            <input
              type="number"
              min={2}
              max={60}
              value={hlsSegmentCount}
              onChange={(e) => setHlsSegmentCount(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamSegmentDurationLabel")}
            <input
              value={hlsSegmentDuration}
              onChange={(e) => setHlsSegmentDuration(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamPartDurationLabel")}
            <input
              value={hlsPartDuration}
              onChange={(e) => setHlsPartDuration(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamSegmentMaxSizeLabel")}
            <input
              value={hlsSegmentMaxSize}
              onChange={(e) => setHlsSegmentMaxSize(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamMuxerCloseAfterLabel")}
            <input
              value={hlsMuxerCloseAfter}
              onChange={(e) => setHlsMuxerCloseAfter(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamLiveSyncLabel")}
            <input
              type="number"
              min={1}
              max={20}
              value={playerLiveSyncDurationCount}
              onChange={(e) => setPlayerLiveSyncDurationCount(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            {t("settingsPage.streamMaxBufferLabel")}
            <input
              type="number"
              min={1}
              max={60}
              value={playerMaxBufferLength}
              onChange={(e) => setPlayerMaxBufferLength(e.target.value)}
              className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={hlsAlwaysRemux} onChange={(e) => setHlsAlwaysRemux(e.target.checked)} />
          {t("settingsPage.streamAlwaysRemuxLabel")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={preferSubStreamInGrid}
            onChange={(e) => setPreferSubStreamInGrid(e.target.checked)}
          />
          {t("settingsPage.streamPreferSubStreamLabel")}
        </label>

        <div className="flex justify-end">
          <button
            type="submit"
            disabled={updateStreamSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>

      {/* Push (PWA) */}
      <div className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("settingsPage.pushTitle")}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.pushConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.pushConfigured ? t("settingsPage.configured") : t("settingsPage.notConfigured")}
          </span>
        </div>
        <p className="text-sm text-neutral-500">{t("settingsPage.pushDescription")}</p>
        {!pushSupported ? (
          <p className="text-[11px] text-amber-500">{t("settingsPage.pushNotSupported")}</p>
        ) : (
          <div className="flex justify-end gap-2">
            {pushSubscription && (
              <button
                type="button"
                onClick={() => handleTest("push")}
                disabled={!status?.pushConfigured || testNotification.isPending}
                className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
              >
                {t("settingsPage.test")}
              </button>
            )}
            <button
              type="button"
              onClick={pushSubscription ? handleDisablePush : handleEnablePush}
              disabled={pushBusy || (!pushSubscription && !vapidPublicKey.data)}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
            >
              {pushSubscription ? t("settingsPage.pushDisable") : t("settingsPage.pushEnable")}
            </button>
          </div>
        )}
      </div>

      {/* Auto-captioning (item 4: VLM) */}
      <form onSubmit={handleSaveCaptioning} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <h3 className="text-sm font-medium">{t("settingsPage.captioningTitle")}</h3>
        <p className="text-sm text-neutral-500">{t("settingsPage.captioningDescription")}</p>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={captionEnabled} onChange={(e) => setCaptionEnabled(e.target.checked)} />
          {t("settingsPage.captioningEnable")}
        </label>
        <input
          value={captionEndpoint}
          onChange={(e) => setCaptionEndpoint(e.target.value)}
          placeholder={t("settingsPage.captioningEndpointPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={captionModel}
          onChange={(e) => setCaptionModel(e.target.value)}
          placeholder={t("settingsPage.captioningModelPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={captionApiKey}
          onChange={(e) => setCaptionApiKey(e.target.value)}
          placeholder={t("settingsPage.captioningApiKeyPlaceholder")}
          type="password"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <span className="text-xs text-neutral-500">{t("settingsPage.captioningCategoriesLabel")}</span>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={captionPerson} onChange={(e) => setCaptionPerson(e.target.checked)} />
            {t("eventTypes.personDetected")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={captionVehicle} onChange={(e) => setCaptionVehicle(e.target.checked)} />
            {t("eventTypes.vehicleDetected")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={captionAnimal} onChange={(e) => setCaptionAnimal(e.target.checked)} />
            {t("eventTypes.animalDetected")}
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={captionOther} onChange={(e) => setCaptionOther(e.target.checked)} />
            {t("eventTypes.objectDetected")}
          </label>
        </div>
        <div className="flex justify-end">
          <button
            type="submit"
            disabled={updateCaptionSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>

      {/* Discord */}
      <form onSubmit={handleSaveDiscord} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("settingsPage.discordTitle")}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.discordWebhookConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.discordWebhookConfigured ? t("settingsPage.configured") : t("settingsPage.notConfigured")}
          </span>
        </div>
        <input
          value={discordWebhookUrl}
          onChange={(e) => setDiscordWebhookUrl(e.target.value)}
          placeholder={t("settingsPage.discordUrlPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-neutral-500">
          {t("settingsPage.autoSavedHint")}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={discordAttachSnapshot}
            onChange={(e) => setDiscordAttachSnapshot(e.target.checked)}
          />
          {t("settingsPage.attachSnapshot")}
        </label>
        <div className="flex justify-end gap-2">
          {status?.discordWebhookConfigured && (
            <button
              type="button"
              onClick={handleClearDiscord}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              {t("settingsPage.remove")}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("discord")}
            disabled={!status?.discordWebhookConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {t("settingsPage.test")}
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>

      {/* Telegram */}
      <form onSubmit={handleSaveTelegram} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("settingsPage.telegramTitle")}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.telegramConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.telegramConfigured ? t("settingsPage.configured") : t("settingsPage.notConfigured")}
          </span>
        </div>
        <input
          value={telegramBotToken}
          onChange={(e) => setTelegramBotToken(e.target.value)}
          placeholder={t("settingsPage.telegramTokenPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={telegramChatId}
          onChange={(e) => setTelegramChatId(e.target.value)}
          placeholder={t("settingsPage.telegramChatIdPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-neutral-500">
          {t("settingsPage.autoSavedHintPlural")}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={telegramAttachSnapshot}
            onChange={(e) => setTelegramAttachSnapshot(e.target.checked)}
          />
          {t("settingsPage.attachSnapshot")}
        </label>
        <div className="flex justify-end gap-2">
          {status?.telegramConfigured && (
            <button
              type="button"
              onClick={handleClearTelegram}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              {t("settingsPage.remove")}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("telegram")}
            disabled={!status?.telegramConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {t("settingsPage.test")}
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>

      {/* Webhook genérico */}
      <form onSubmit={handleSaveWebhook} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("settingsPage.webhookTitle")}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.webhookConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.webhookConfigured ? t("settingsPage.configured") : t("settingsPage.notConfigured")}
          </span>
        </div>
        <input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder={t("settingsPage.webhookUrlPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-neutral-500">
          {t("settingsPage.webhookHint")}
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={webhookAttachSnapshot}
            onChange={(e) => setWebhookAttachSnapshot(e.target.checked)}
          />
          {t("settingsPage.attachSnapshotBase64")}
        </label>
        <div className="flex justify-end gap-2">
          {status?.webhookConfigured && (
            <button
              type="button"
              onClick={handleClearWebhook}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              {t("settingsPage.remove")}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("webhook")}
            disabled={!status?.webhookConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {t("settingsPage.test")}
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>

      {/* Email (SMTP) */}
      <form onSubmit={handleSaveEmail} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("settingsPage.emailTitle")}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.emailConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.emailConfigured ? t("settingsPage.configured") : t("settingsPage.notConfigured")}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            value={emailSmtpHost}
            onChange={(e) => setEmailSmtpHost(e.target.value)}
            placeholder={t("settingsPage.smtpHostPlaceholder")}
            className="col-span-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={emailSmtpPort}
            onChange={(e) => setEmailSmtpPort(e.target.value)}
            placeholder={t("settingsPage.portPlaceholder")}
            type="number"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <input
          value={emailSmtpUser}
          onChange={(e) => setEmailSmtpUser(e.target.value)}
          placeholder={t("settingsPage.smtpUserPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={emailSmtpPass}
          onChange={(e) => setEmailSmtpPass(e.target.value)}
          placeholder={t("settingsPage.smtpPassPlaceholder")}
          type="password"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder={t("settingsPage.fromPlaceholder")}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder={t("settingsPage.toPlaceholder")}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={emailSmtpSecure} onChange={(e) => setEmailSmtpSecure(e.target.checked)} />
          {t("settingsPage.useTls")}
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailAttachSnapshot}
            onChange={(e) => setEmailAttachSnapshot(e.target.checked)}
          />
          {t("settingsPage.attachSnapshot")}
        </label>
        <div className="flex justify-end gap-2">
          {status?.emailConfigured && (
            <button
              type="button"
              onClick={handleClearEmail}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              {t("settingsPage.remove")}
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("email")}
            disabled={!status?.emailConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            {t("settingsPage.test")}
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>

      {/* Armazenamento S3 (snapshots públicos) */}
      <form onSubmit={handleSaveS3} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">{t("settingsPage.s3Title")}</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.s3Configured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.s3Configured ? t("settingsPage.configured") : t("settingsPage.notConfigured")}
          </span>
        </div>
        <p className="text-sm text-neutral-500">
          {t("settingsPage.s3Description")}
        </p>
        <input
          value={s3Endpoint}
          onChange={(e) => setS3Endpoint(e.target.value)}
          placeholder={t("settingsPage.s3EndpointPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={s3Region}
            onChange={(e) => setS3Region(e.target.value)}
            placeholder={t("settingsPage.s3RegionPlaceholder")}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={s3BucketName}
            onChange={(e) => setS3BucketName(e.target.value)}
            placeholder={t("settingsPage.s3BucketPlaceholder")}
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <input
          value={s3AccessKey}
          onChange={(e) => setS3AccessKey(e.target.value)}
          placeholder={t("settingsPage.s3AccessKeyPlaceholder")}
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={s3SecretKey}
          onChange={(e) => setS3SecretKey(e.target.value)}
          placeholder={t("settingsPage.s3SecretKeyPlaceholder")}
          type="password"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <div className="flex justify-end gap-2">
          {status?.s3Configured && (
            <button
              type="button"
              onClick={handleClearS3}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              {t("settingsPage.remove")}
            </button>
          )}
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("settingsPage.save")}
          </button>
        </div>
      </form>
    </div>
  );
}


