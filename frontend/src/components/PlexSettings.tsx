import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/services";
import { Button } from "@/components/ui/button";

type Status = {
  linked: boolean;
  plexUsername?: string | null;
  serverName?: string | null;
  serverSelected?: boolean;
};
type Server = { machineId: string; name: string };

export function PlexSettings() {
  const [status, setStatus] = useState<Status>({ linked: false });
  const [code, setCode] = useState<string | null>(null);
  const [servers, setServers] = useState<Server[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const pollActiveRef = useRef(false);

  async function refresh(): Promise<Status | null> {
    const res = await apiFetch("/api/plex/status");
    if (res.ok) {
      const s: Status = await res.json();
      setStatus(s);
      return s;
    }
    return null;
  }

  async function loadServers() {
    const res = await apiFetch("/api/plex/servers");
    if (!res.ok) return;
    const { servers: svrs } = await res.json();
    if (svrs.length === 1) {
      await selectServer(svrs[0].machineId);
    } else if (svrs.length === 0) {
      setError("No Plex servers found on this account.");
    } else {
      setServers(svrs);
    }
  }

  useEffect(() => {
    (async () => {
      const s = await refresh();
      if (s?.linked && !s.serverSelected) await loadServers();
    })();
    return () => {
      pollActiveRef.current = false;
    };
  }, []);

  async function connect() {
    setError(null);
    setMessage(null);
    setBusy(true);
    const res = await apiFetch("/api/plex/link/start", { method: "POST" });
    if (!res.ok) {
      setError("Could not start Plex link.");
      setBusy(false);
      return;
    }
    const { code, authUrl } = await res.json();
    setCode(code);
    window.open(authUrl, "_blank", "noopener,noreferrer");

    const deadline = Date.now() + 120_000; // 2 min cap
    pollActiveRef.current = true;
    const poll = async () => {
      if (!pollActiveRef.current) return;
      try {
        const r = await apiFetch("/api/plex/link/poll");
        if (!pollActiveRef.current) return;
        if (!r.ok) {
          pollActiveRef.current = false;
          setBusy(false);
          setCode(null);
          setError("Lost contact with Plex. Please try again.");
          return;
        }
        const body = await r.json();
        if (!pollActiveRef.current) return;
        if (body.status === "linked") {
          pollActiveRef.current = false;
          setCode(null);
          setBusy(false);
          await refresh();
          if (body.servers.length === 1) {
            await selectServer(body.servers[0].machineId);
          } else if (body.servers.length === 0) {
            setError("No Plex servers found on this account.");
          } else {
            setServers(body.servers);
          }
          return;
        }
        if (body.status === "expired" || Date.now() > deadline) {
          pollActiveRef.current = false;
          setCode(null);
          setBusy(false);
          setError("Link expired. Please try again.");
          return;
        }
        setTimeout(poll, 2000);
      } catch {
        pollActiveRef.current = false;
        setBusy(false);
        setCode(null);
        setError("Lost contact with Plex. Please try again.");
      }
    };
    setTimeout(poll, 2000);
  }

  async function selectServer(machineId: string) {
    setBusy(true);
    setError(null);
    try {
      const res = await apiFetch("/api/plex/server", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ machineId }),
      });
      if (!res.ok) {
        setError("Could not reach that Plex server from TorrentUI.");
        return;
      }
      setServers([]);
      await refresh();
    } catch {
      setError("Could not reach that Plex server from TorrentUI.");
    } finally {
      setBusy(false);
    }
  }

  async function testConnection() {
    setError(null);
    setMessage(null);
    const res = await apiFetch("/api/plex/ping");
    if (res.ok) {
      setMessage("Connection OK.");
    } else {
      setError("Server not reachable.");
    }
  }

  async function unlink() {
    await apiFetch("/api/plex/link", { method: "DELETE" });
    setStatus({ linked: false });
    setServers([]);
    setCode(null);
    setError(null);
    setMessage(null);
  }

  return (
    <div className="mx-auto max-w-xl space-y-4 p-6">
      <h1 className="text-xl font-semibold">Plex</h1>

      {error && <p className="text-sm text-destructive">{error}</p>}
      {message && <p className="text-sm text-muted-foreground">{message}</p>}

      {!status.linked && (
        <Button onClick={connect} disabled={busy}>
          {busy ? "Waiting for Plex…" : "Connect to Plex"}
        </Button>
      )}

      {code && (
        <p className="text-sm">
          A Plex window opened. If it didn't, your link code is <strong>{code}</strong>.
        </p>
      )}

      {servers.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm">Choose a server:</p>
          {servers.map((s) => (
            <Button key={s.machineId} variant="outline" onClick={() => selectServer(s.machineId)} disabled={busy}>
              {s.name}
            </Button>
          ))}
        </div>
      )}

      {status.linked && (
        <div className="space-y-3 rounded-md border p-4">
          <p className="text-sm">
            Linked as <strong>{status.plexUsername}</strong>
            {status.serverName ? <> · server <strong>{status.serverName}</strong></> : <> · no server selected</>}
          </p>
          <div className="flex gap-2">
            {status.serverSelected && (
              <Button variant="outline" onClick={testConnection}>Test connection</Button>
            )}
            <Button variant="destructive" onClick={unlink}>Unlink</Button>
          </div>
        </div>
      )}
    </div>
  );
}
