import { Route, Routes } from "react-router-dom";
import { AppLayout } from "./components/layout/AppLayout";
import { AuthGate } from "./components/auth/AuthGate";
import { GridPage } from "./pages/GridPage";
import { TimelinePage } from "./pages/TimelinePage";
import { EventsPage } from "./pages/EventsPage";
import { CamerasPage } from "./pages/CamerasPage";
import { OnvifDebugPage } from "./pages/OnvifDebugPage";
import { CustomGridViewPage } from "./pages/CustomGridViewPage";
import { SettingsPage } from "./pages/SettingsPage";
import { MaintenancePage } from "./pages/MaintenancePage";
import { LoginPage } from "./pages/LoginPage";
import { SetupPage } from "./pages/SetupPage";

function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="login" element={<LoginPage />} />
        <Route path="setup" element={<SetupPage />} />
        {/* Kiosk-style route, deliberately outside AppLayout (no sidebar/nav) -
            this is the unique, shareable URL for a saved custom grid. */}
        <Route path="g/:id" element={<CustomGridViewPage />} />
        <Route element={<AppLayout />}>
          <Route index element={<GridPage />} />
          {/* <Route path="dashboard" element={<DashboardPage />} /> */}
          <Route path="timeline" element={<TimelinePage />} />
          <Route path="events" element={<EventsPage />} />
          <Route path="cameras" element={<CamerasPage />} />
          <Route path="onvif-debug" element={<OnvifDebugPage />} />
          <Route path="settings" element={<SettingsPage />} />
          <Route path="maintenance" element={<MaintenancePage />} />
        </Route>
      </Routes>
    </AuthGate>
  );
}

export default App;

