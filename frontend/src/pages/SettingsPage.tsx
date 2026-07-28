import { useEffect, useState, type FormEvent } from "react";
import axios from "axios";
import {
  useNotificationSettings,
  useTestNotification,
  useUpdateNotificationSettings,
} from "../api/settings";
import { useToastStore } from "../store/toastStore";

export function SettingsPage() {
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

  useEffect(() => {
    if (!status) return;
    setDiscordAttachSnapshot(status.discordAttachSnapshot);
    setTelegramAttachSnapshot(status.telegramAttachSnapshot);
    setWebhookAttachSnapshot(status.webhookAttachSnapshot);
    setEmailSmtpHost(status.emailSmtpHost ?? "");
    setEmailSmtpPort(String(status.emailSmtpPort ?? 587));
    setEmailSmtpUser(status.emailSmtpUser ?? "");
    setEmailSmtpSecure(status.emailSmtpSecure);
    setEmailFrom(status.emailFrom ?? "");
    setEmailTo(status.emailTo ?? "");
    setEmailAttachSnapshot(status.emailAttachSnapshot);
  }, [status]);

  const extractErrorMessage = (err: unknown, fallback: string): string => {
    const data = axios.isAxiosError(err) ? (err.response?.data as { error?: string }) : undefined;
    return data?.error ?? fallback;
  };

  const handleTest = async (channel: "discord" | "telegram" | "webhook" | "email") => {
    try {
      const result = await testNotification.mutateAsync(channel);
      if (result.ok) {
        addToast("success", "Notificação de teste enviada.");
      } else {
        addToast("error", result.error ?? "Falha ao enviar notificação de teste.");
      }
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao enviar notificação de teste."));
    }
  };

  const handleSaveDiscord = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(discordWebhookUrl ? { discordWebhookUrl } : {}),
        discordAttachSnapshot,
      });
      addToast("success", "Discord salvo.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao salvar o Discord."));
    }
  };

  const handleClearDiscord = async () => {
    try {
      await updateSettings.mutateAsync({ discordWebhookUrl: null });
      addToast("success", "Webhook do Discord removido.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao remover o webhook do Discord."));
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
      addToast("success", "Telegram salvo.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao salvar o Telegram."));
    }
  };

  const handleClearTelegram = async () => {
    try {
      await updateSettings.mutateAsync({ telegramBotToken: null, telegramChatId: null });
      addToast("success", "Telegram removido.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao remover o Telegram."));
    }
  };

  const handleSaveWebhook = async (e: FormEvent) => {
    e.preventDefault();
    try {
      await updateSettings.mutateAsync({
        ...(webhookUrl ? { webhookUrl } : {}),
        webhookAttachSnapshot,
      });
      addToast("success", "Webhook genérico salvo.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao salvar o webhook genérico."));
    }
  };

  const handleClearWebhook = async () => {
    try {
      await updateSettings.mutateAsync({ webhookUrl: null });
      addToast("success", "Webhook genérico removido.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao remover o webhook genérico."));
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
      addToast("success", "Email (SMTP) salvo.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao salvar o email."));
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
      addToast("success", "Email (SMTP) removido.");
    } catch (err) {
      addToast("error", extractErrorMessage(err, "Falha ao remover o email."));
    }
  };

  if (isLoading) {
    return <p className="text-neutral-400">Carregando configurações...</p>;
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <div>
        <h2 className="text-base font-semibold">Notificações externas</h2>
        <p className="text-sm text-neutral-500">
          Enviadas automaticamente quando um evento de movimento/violação é detectado (ONVIF ou análise de vídeo).
          Cada canal decide independentemente se envia a snapshot do momento como anexo.
        </p>
      </div>

      {/* Discord */}
      <form onSubmit={handleSaveDiscord} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Discord</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.discordWebhookConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.discordWebhookConfigured ? "Configurado" : "Não configurado"}
          </span>
        </div>
        <input
          value={discordWebhookUrl}
          onChange={(e) => setDiscordWebhookUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-neutral-500">
          A URL não é reexibida por segurança depois de salva — deixe em branco se não quiser alterá-la.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={discordAttachSnapshot}
            onChange={(e) => setDiscordAttachSnapshot(e.target.checked)}
          />
          Enviar snapshot como anexo
        </label>
        <div className="flex justify-end gap-2">
          {status?.discordWebhookConfigured && (
            <button
              type="button"
              onClick={handleClearDiscord}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              Remover
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("discord")}
            disabled={!status?.discordWebhookConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            Testar
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </form>

      {/* Telegram */}
      <form onSubmit={handleSaveTelegram} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Telegram</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.telegramConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.telegramConfigured ? "Configurado" : "Não configurado"}
          </span>
        </div>
        <input
          value={telegramBotToken}
          onChange={(e) => setTelegramBotToken(e.target.value)}
          placeholder="Bot token (ex: 123456:ABC-...)"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={telegramChatId}
          onChange={(e) => setTelegramChatId(e.target.value)}
          placeholder="Chat ID"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-neutral-500">
          Os valores não são reexibidos por segurança depois de salvos — deixe em branco se não quiser alterá-los.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={telegramAttachSnapshot}
            onChange={(e) => setTelegramAttachSnapshot(e.target.checked)}
          />
          Enviar snapshot como anexo
        </label>
        <div className="flex justify-end gap-2">
          {status?.telegramConfigured && (
            <button
              type="button"
              onClick={handleClearTelegram}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              Remover
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("telegram")}
            disabled={!status?.telegramConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            Testar
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </form>

      {/* Webhook genérico */}
      <form onSubmit={handleSaveWebhook} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Webhook genérico</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.webhookConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.webhookConfigured ? "Configurado" : "Não configurado"}
          </span>
        </div>
        <input
          value={webhookUrl}
          onChange={(e) => setWebhookUrl(e.target.value)}
          placeholder="https://minha-automacao.example.com/webhook"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <p className="text-[11px] text-neutral-500">
          Envia um POST com JSON (câmera, tipo do evento, mensagem, horário). Útil pra integrar com n8n, Home
          Assistant, etc. A URL não é reexibida por segurança depois de salva.
        </p>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={webhookAttachSnapshot}
            onChange={(e) => setWebhookAttachSnapshot(e.target.checked)}
          />
          Enviar snapshot como anexo (base64 no JSON)
        </label>
        <div className="flex justify-end gap-2">
          {status?.webhookConfigured && (
            <button
              type="button"
              onClick={handleClearWebhook}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              Remover
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("webhook")}
            disabled={!status?.webhookConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            Testar
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </form>

      {/* Email (SMTP) */}
      <form onSubmit={handleSaveEmail} className="flex flex-col gap-2 rounded-lg border border-neutral-800 p-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-medium">Email (SMTP)</h3>
          <span
            className={`rounded-full px-2 py-0.5 text-xs ${
              status?.emailConfigured ? "bg-green-950 text-green-400" : "bg-neutral-800 text-neutral-500"
            }`}
          >
            {status?.emailConfigured ? "Configurado" : "Não configurado"}
          </span>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <input
            value={emailSmtpHost}
            onChange={(e) => setEmailSmtpHost(e.target.value)}
            placeholder="Host SMTP"
            className="col-span-2 rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={emailSmtpPort}
            onChange={(e) => setEmailSmtpPort(e.target.value)}
            placeholder="Porta"
            type="number"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <input
          value={emailSmtpUser}
          onChange={(e) => setEmailSmtpUser(e.target.value)}
          placeholder="Usuário SMTP"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <input
          value={emailSmtpPass}
          onChange={(e) => setEmailSmtpPass(e.target.value)}
          placeholder="Senha SMTP (deixe em branco para manter)"
          type="password"
          className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <div className="grid grid-cols-2 gap-2">
          <input
            value={emailFrom}
            onChange={(e) => setEmailFrom(e.target.value)}
            placeholder="Remetente (De:)"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
          <input
            value={emailTo}
            onChange={(e) => setEmailTo(e.target.value)}
            placeholder="Destinatário (Para:)"
            className="rounded-md border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={emailSmtpSecure} onChange={(e) => setEmailSmtpSecure(e.target.checked)} />
          Usar TLS/SSL direto (porta 465)
        </label>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={emailAttachSnapshot}
            onChange={(e) => setEmailAttachSnapshot(e.target.checked)}
          />
          Enviar snapshot como anexo
        </label>
        <div className="flex justify-end gap-2">
          {status?.emailConfigured && (
            <button
              type="button"
              onClick={handleClearEmail}
              className="rounded-md px-3 py-2 text-sm text-red-400 hover:bg-red-950"
            >
              Remover
            </button>
          )}
          <button
            type="button"
            onClick={() => handleTest("email")}
            disabled={!status?.emailConfigured || testNotification.isPending}
            className="rounded-md bg-neutral-800 px-3 py-2 text-sm hover:bg-neutral-700 disabled:opacity-50"
          >
            Testar
          </button>
          <button
            type="submit"
            disabled={updateSettings.isPending}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}

