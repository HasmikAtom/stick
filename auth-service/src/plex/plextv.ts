const PLEXTV = "https://plex.tv";
const PRODUCT = "TorrentUI";
const VERSION = "1.0.0";

export type PlexConnection = { uri: string; local: boolean; relay: boolean };
export type PlexServer = {
  name: string;
  machineId: string;
  accessToken: string;
  connections: PlexConnection[];
};

function headers(clientId: string, token?: string): Record<string, string> {
  const h: Record<string, string> = {
    Accept: "application/json",
    "X-Plex-Product": PRODUCT,
    "X-Plex-Version": VERSION,
    "X-Plex-Client-Identifier": clientId,
    "X-Plex-Device": "TorrentUI",
    "X-Plex-Platform": "Web",
  };
  if (token) h["X-Plex-Token"] = token;
  return h;
}

export async function createPin(clientId: string): Promise<{ id: number; code: string }> {
  const res = await fetch(`${PLEXTV}/api/v2/pins?strong=true`, {
    method: "POST",
    headers: headers(clientId),
  });
  if (!res.ok) throw new Error(`plex pin create failed: ${res.status}`);
  const j = (await res.json()) as { id: number; code: string };
  return { id: j.id, code: j.code };
}

export async function pollPin(
  clientId: string,
  id: number,
): Promise<{ authToken: string | null }> {
  const res = await fetch(`${PLEXTV}/api/v2/pins/${id}`, { headers: headers(clientId) });
  if (res.status === 404) return { authToken: null };
  if (!res.ok) throw new Error(`plex pin poll failed: ${res.status}`);
  const j = (await res.json()) as { authToken?: string | null };
  return { authToken: j.authToken ?? null };
}

export async function listServers(clientId: string, token: string): Promise<PlexServer[]> {
  const res = await fetch(`${PLEXTV}/api/v2/resources?includeHttps=1&includeRelay=1`, {
    headers: headers(clientId, token),
  });
  if (!res.ok) throw new Error(`plex resources failed: ${res.status}`);
  const arr = (await res.json()) as any[];
  return arr
    .filter((d) => String(d.provides ?? "").split(",").includes("server"))
    .map((d) => ({
      name: d.name,
      machineId: d.clientIdentifier,
      accessToken: d.accessToken,
      connections: (d.connections ?? []).map((c: any) => ({
        uri: c.uri,
        local: !!c.local,
        relay: !!c.relay,
      })),
    }));
}

export async function fetchAccount(
  clientId: string,
  token: string,
): Promise<{ username: string }> {
  const res = await fetch(`${PLEXTV}/api/v2/user`, { headers: headers(clientId, token) });
  if (!res.ok) throw new Error(`plex user failed: ${res.status}`);
  const j = (await res.json()) as { username?: string; title?: string };
  return { username: j.username ?? j.title ?? "" };
}
