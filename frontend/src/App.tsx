import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useSession } from "@/lib/auth-client";
import { LoginScreen } from "@/components/LoginScreen";
import { AppShell } from "@/components/AppShell";
import { Home } from "@/components/Home";
import { AdminPage } from "@/components/AdminPage";
import { SearchPage } from "@/pages/SearchPage";
import { DashboardProvider } from "@/components/dashboard";

type SessionUser = {
  id: string;
  email: string;
  name?: string | null;
  image?: string | null;
  role?: string | null;
};

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

  const user = session.user as unknown as SessionUser;

  return (
    <BrowserRouter>
      <DashboardProvider>
        <AppShell user={user}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/search" element={<SearchPage />} />
            <Route
              path="/admin"
              element={
                user.role === "admin"
                  ? <AdminPage />
                  : <Navigate to="/" replace />
              }
            />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </AppShell>
      </DashboardProvider>
    </BrowserRouter>
  );
}
