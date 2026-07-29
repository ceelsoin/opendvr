import { useState } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Toaster } from "../ui/Toaster";
import { EventSocketListener } from "../realtime/EventSocketListener";
import { TopStatusBar } from "./TopStatusBar";
import { LanguageSwitcher } from "../ui/LanguageSwitcher";
import { useLogout } from "../../api/auth";

const navItems: Array<{ to: string; key: string; end?: boolean }> = [
  { to: "/", key: "nav.grid", end: true },
//   { to: "/dashboard", key: "nav.dashboard" },
  { to: "/timeline", key: "nav.timeline" },
  { to: "/events", key: "nav.events" },
  { to: "/cameras", key: "nav.cameras" },
  { to: "/onvif-debug", key: "nav.onvifDebug" },
  { to: "/settings", key: "nav.settings" },
];

export function AppLayout() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const logout = useLogout();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const handleLogout = async () => {
    await logout.mutateAsync();
    navigate("/login", { replace: true });
  };

  return (
    <div className="flex h-full min-h-screen flex-col bg-neutral-950 text-neutral-100">
      <Toaster />
      <EventSocketListener />
      <TopStatusBar onMenuClick={() => setSidebarOpen((v) => !v)} />
      <div className="flex flex-1">
        {sidebarOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 md:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}
        <aside
          className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 -translate-x-full transform flex-col overflow-y-auto border-r border-neutral-800 bg-neutral-950 p-4 transition-transform duration-200 md:relative md:z-auto md:w-56 md:translate-x-0 ${
            sidebarOpen ? "translate-x-0" : ""
          }`}
        >
          <div className="mb-6 flex items-center gap-2">
            <img src={`${import.meta.env.BASE_URL}favicon.svg`} alt="" className="h-7 w-7 shrink-0" />
            <h1 className="text-lg font-semibold tracking-tight">OpenDVR</h1>
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {navItems.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={() => setSidebarOpen(false)}
                className={({ isActive }) =>
                  `rounded-md px-3 py-2 text-sm transition-colors ${
                    isActive
                      ? "bg-neutral-800 text-white"
                      : "text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
                  }`
                }
              >
                {t(item.key)}
              </NavLink>
            ))}
          </nav>
          <div className="flex flex-col gap-2 border-t border-neutral-800 pt-3">
            <LanguageSwitcher />
            <button
              type="button"
              onClick={handleLogout}
              className="rounded-md px-3 py-2 text-left text-sm text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200"
            >
              {t("nav.logout")}
            </button>
          </div>
        </aside>
        <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
