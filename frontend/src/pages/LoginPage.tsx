import { useState, type FormEvent } from "react";
import axios from "axios";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";
import { useLogin } from "../api/auth";

export function LoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const login = useLogin();

  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      await login.mutateAsync({ username, password });
      navigate("/", { replace: true });
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined;
      setError(status === 401 ? t("auth.invalidCredentials") : t("auth.genericError"));
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-neutral-950 p-4 text-neutral-100">
      <div className="w-full max-w-sm rounded-lg border border-neutral-800 bg-neutral-900 p-6">
        <div className="mb-6 flex items-center gap-2">
          <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-8 w-8" />
          <h1 className="text-lg font-semibold tracking-tight">OpenDVR</h1>
        </div>
        <h2 className="mb-1 text-base font-semibold">{t("auth.loginTitle")}</h2>
        <p className="mb-4 text-sm text-neutral-500">{t("auth.loginSubtitle")}</p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder={t("auth.username")}
            required
            autoFocus
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />
          <input
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder={t("auth.password")}
            type="password"
            required
            className="rounded-md border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
          />

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button
            type="submit"
            disabled={login.isPending}
            className="mt-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium hover:bg-blue-500 disabled:opacity-50"
          >
            {t("auth.signIn")}
          </button>
        </form>
      </div>
    </div>
  );
}
