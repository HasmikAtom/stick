import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/lib/auth-client";
import { LoginScreen } from "@/components/LoginScreen";
import { AppShell } from "@/components/AppShell";
import { Home } from "@/components/Home";
import { AdminPage } from "@/components/AdminPage";
import { PlexSettings } from "@/components/PlexSettings";

export default function App() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!session) return <LoginScreen />;

  return (
    <BrowserRouter>
      <AppShell user={session.user as any}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route
            path="/admin"
            element={
              (session.user as any).role === "admin"
                ? <AdminPage />
                : <Navigate to="/" replace />
            }
          />
          <Route path="/plex" element={<PlexSettings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AppShell>
    </BrowserRouter>
  );
}
