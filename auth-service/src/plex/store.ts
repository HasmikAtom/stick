// auth-service/src/plex/store.ts
import { randomUUID } from "node:crypto";
import { db } from "../db.js";
import { encrypt, decrypt } from "./crypto.js";

export type Connection = {
  userId: string;
  plexUsername: string | null;
  accountToken: string;
  serverMachineId: string | null;
  serverName: string | null;
  serverUri: string | null;
  serverToken: string | null;
};

export function getOrCreateClientId(): string {
  const row = db.prepare("SELECT client_id FROM plex_app WHERE id = 1").get() as
    | { client_id: string }
    | undefined;
  if (row) return row.client_id;
  const cid = randomUUID();
  db.prepare("INSERT INTO plex_app (id, client_id) VALUES (1, ?)").run(cid);
  return cid;
}

export function saveAccountToken(userId: string, username: string, accountToken: string): void {
  db.prepare(
    `INSERT INTO plex_connection (user_id, plex_username, account_token, updated_at)
     VALUES (?, ?, ?, unixepoch())
     ON CONFLICT(user_id) DO UPDATE SET
       plex_username = excluded.plex_username,
       account_token = excluded.account_token,
       updated_at    = unixepoch()`,
  ).run(userId, username, encrypt(accountToken));
}

export function saveServer(
  userId: string,
  server: { machineId: string; name: string; uri: string; serverToken: string },
): void {
  db.prepare(
    `UPDATE plex_connection
       SET server_machine_id = ?, server_name = ?, server_uri = ?, server_token = ?, updated_at = unixepoch()
     WHERE user_id = ?`,
  ).run(server.machineId, server.name, server.uri, encrypt(server.serverToken), userId);
}

export function getConnection(userId: string): Connection | null {
  const row = db
    .prepare("SELECT * FROM plex_connection WHERE user_id = ?")
    .get(userId) as any;
  if (!row) return null;
  return {
    userId: row.user_id,
    plexUsername: row.plex_username,
    accountToken: decrypt(row.account_token),
    serverMachineId: row.server_machine_id,
    serverName: row.server_name,
    serverUri: row.server_uri,
    serverToken: row.server_token ? decrypt(row.server_token) : null,
  };
}

export function deleteConnection(userId: string): void {
  db.prepare("DELETE FROM plex_connection WHERE user_id = ?").run(userId);
}
