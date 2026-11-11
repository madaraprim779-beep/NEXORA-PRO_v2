
import { handleMessaging } from "./messaging";
import { handleGroups } from "./groups";
import { handleMedia } from "./media";
import { handleVoice } from "./voice";
import { handleReactions } from "./reactions";
import { handleStatuses } from "./statuses";
import { handleCalls } from "./calls";
import { handlePrivacy } from "./privacy";
import { handleRealtime, RealtimeRoom } from "./realtime";
import { handleMessages } from "./messages";
import { handleNotifications } from "./notifications";

export { RealtimeRoom };

export interface Env {
  DB: D1Database;
  MEDIA?: R2Bucket;
  REALTIME?: DurableObjectNamespace;
}

interface AuthUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods":
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization",
  "Access-Control-Max-Age": "86400",
};

function response(
  data: unknown,
  status = 200
): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function withCors(result: Response): Response {
  if (result.status === 101) {
    return result;
  }

  const headers = new Headers(result.headers);

  for (const [key, value] of Object.entries(corsHeaders)) {
    headers.set(key, value);
  }

  return new Response(result.body, {
    status: result.status,
    statusText: result.statusText,
    headers,
  });
}

function randomString(bytes = 32): string {
  const array = crypto.getRandomValues(
    new Uint8Array(bytes)
  );

  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

function decodeBase64Url(value: string): Uint8Array {
  const base64 = value
    .replace(/-/g, "+")
    .replace(/_/g, "/");

  const padded =
    base64 + "=".repeat((4 - base64.length % 4) % 4);

  return Uint8Array.from(
    atob(padded),
    (character) => character.charCodeAt(0)
  );
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );

  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hashPassword(
  password: string,
  salt: string
): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: decodeBase64Url(salt),
      iterations: 310000,
      hash: "SHA-256",
    },
    key,
    256
  );

  return Array.from(new Uint8Array(bits))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function createNexoraId(
  db: D1Database
): Promise<string> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const id =
      "NXR-" +
      randomString(6)
        .toUpperCase()
        .replace(/[-_]/g, "X")
        .slice(0, 8);

    const existing = await db
      .prepare(
        "SELECT id FROM profiles WHERE nexora_id = ?"
      )
      .bind(id)
      .first();

    if (!existing) return id;
  }

  throw new Error(
    "Impossible de générer un NEXORA ID."
  );
}

function getToken(request: Request): string | null {
  const authorization =
    request.headers.get("Authorization");

  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }

  return authorization.slice(7).trim() || null;
}

async function createSession(
  db: D1Database,
  userId: string
) {
  const token = randomString(48);
  const tokenHash = await sha256(token);
  const sessionId = crypto.randomUUID();

  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await db.prepare(`
    INSERT INTO sessions
      (id, user_id, token_hash, expires_at)
    VALUES (?, ?, ?, ?)
  `).bind(
    sessionId,
    userId,
    tokenHash,
    expiresAt
  ).run();

  return {
    token,
    expiresAt,
  };
}

async function authenticate(
  request: Request,
  db: D1Database
): Promise<AuthUser | null> {
  const token = getToken(request);

  if (!token) return null;

  const tokenHash = await sha256(token);

  return db.prepare(`
    SELECT
      profiles.id,
      profiles.nexora_id,
      profiles.username,
      profiles.display_name
    FROM sessions
    JOIN profiles
      ON profiles.id = sessions.user_id
    WHERE sessions.token_hash = ?
      AND sessions.expires_at > ?
  `).bind(
    tokenHash,
    new Date().toISOString()
  ).first<AuthUser>();
}

async function readJson(
  request: Request
): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function handleHealth(
  env: Env
): Promise<Response> {
  const expectedTables = [
    "profiles",
    "credentials",
    "sessions",
    "conversations",
    "conversation_members",
    "messages",
    "contacts",
    "blocks",
    "statuses",
    "status_views",
    "message_reactions",
    "notifications",
    "reports",
    "privacy_settings",
    "message_reads",
    "calls",
  ];

  const result = await env.DB.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN (
        ${expectedTables.map(() => "?").join(",")}
      )
  `).bind(...expectedTables)
    .all<{ name: string }>();

  const foundTables = (
    result.results ?? []
  ).map((table) => table.name);

  const missingTables = expectedTables.filter(
    (table) => !foundTables.includes(table)
  );

  return response({
    success: missingTables.length === 0,
    application: "NEXORA PRO V2",
    server: "online",
    database: "connected",
    tables_found: foundTables.length,
    tables_expected: expectedTables.length,
    missing_tables: missingTables,
    services: {
      database: "connected",
      media_storage: env.MEDIA
        ? "configured"
        : "disabled",
      realtime: env.REALTIME
        ? "configured"
        : "disabled",
      calls: "signaling_not_configured",
    },
    timestamp: new Date().toISOString(),
  });
}

async function handleRegister(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await readJson(request);

  if (!body || typeof body !== "object") {
    return response({
      error: "Données invalides.",
    }, 400);
  }

  const username =
    typeof body.username === "string"
      ? body.username.trim()
      : "";

  const displayName =
    typeof body.display_name === "string"
      ? body.display_name.trim()
      : "";

  const password = body.password;

  if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) {
    return response({
      error:
        "Pseudo invalide : 3 à 24 caractères.",
    }, 400);
  }

  if (
    !displayName ||
    displayName.length > 40
  ) {
    return response({
      error: "Nom d'affichage invalide.",
    }, 400);
  }

  if (
    typeof password !== "string" ||
    password.length < 8 ||
    password.length > 128
  ) {
    return response({
      error:
        "Mot de passe invalide : 8 à 128 caractères.",
    }, 400);
  }

  const userId = crypto.randomUUID();
  const nexoraId = await createNexoraId(env.DB);
  const salt = randomString(16);

  const passwordHash = await hashPassword(
    password,
    salt
  );

  const sessionToken = randomString(48);
  const tokenHash = await sha256(sessionToken);
  const sessionId = crypto.randomUUID();

  const expiresAt = new Date(
    Date.now() + 30 * 24 * 60 * 60 * 1000
  ).toISOString();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO profiles
        (id, nexora_id, username, display_name)
      VALUES (?, ?, ?, ?)
    `).bind(
      userId,
      nexoraId,
      username,
      displayName
    ),

    env.DB.prepare(`
      INSERT INTO credentials
        (user_id, password_hash, password_salt)
      VALUES (?, ?, ?)
    `).bind(
      userId,
      passwordHash,
      salt
    ),

    env.DB.prepare(`
      INSERT INTO sessions
        (id, user_id, token_hash, expires_at)
      VALUES (?, ?, ?, ?)
    `).bind(
      sessionId,
      userId,
      tokenHash,
      expiresAt
    ),

    env.DB.prepare(`
      INSERT OR IGNORE INTO privacy_settings
        (user_id)
      VALUES (?)
    `).bind(userId),
  ]);

  return response({
    success: true,
    message: "Compte NEXORA créé.",
    user: {
      nexora_id: nexoraId,
      username,
      display_name: displayName,
    },
    token: sessionToken,
    expires_at: expiresAt,
  }, 201);
}

async function handleLogin(
  request: Request,
  env: Env
): Promise<Response> {
  const body = await readJson(request);

  if (!body || typeof body !== "object") {
    return response({
      error: "Données invalides.",
    }, 400);
  }

  const nexoraId =
    typeof body.nexora_id === "string"
      ? body.nexora_id.trim().toUpperCase()
      : "";

  const password = body.password;

  if (
    !nexoraId ||
    typeof password !== "string" ||
    password.length < 1 ||
    password.length > 128
  ) {
    return response({
      error: "Identifiants invalides.",
    }, 400);
  }

  const user = await env.DB.prepare(`
    SELECT
      profiles.id,
      profiles.nexora_id,
      profiles.username,
      profiles.display_name,
      credentials.password_hash,
      credentials.password_salt
    FROM profiles
    JOIN credentials
      ON credentials.user_id = profiles.id
    WHERE profiles.nexora_id = ?
  `).bind(nexoraId).first<{
    id: string;
    nexora_id: string;
    username: string;
    display_name: string;
    password_hash: string;
    password_salt: string;
  }>();

  if (!user) {
    return response({
      error: "Identifiants incorrects.",
    }, 401);
  }

  const suppliedHash = await hashPassword(
    password,
    user.password_salt
  );

  if (suppliedHash !== user.password_hash) {
    return response({
      error: "Identifiants incorrects.",
    }, 401);
  }

  const session = await createSession(
    env.DB,
    user.id
  );

  return response({
    success: true,
    user: {
      nexora_id: user.nexora_id,
      username: user.username,
      display_name: user.display_name,
    },
    token: session.token,
    expires_at: session.expiresAt,
  });
}

async function dispatchPrivateRoute(
  request: Request,
  env: Env,
  user: AuthUser,
  path: string
): Promise<Response | null> {

  if (
    path === "/api/users/search" ||
    path.startsWith("/api/contacts") ||
    path.startsWith("/api/conversations")
  ) {
    const result = await handleMessaging(
      request, env, user, path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/groups")) {
    const result = await handleGroups(
      request, env, user, path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/messages")) {
    const reactionMatch =
      /^\/api\/messages\/[^/]+\/reactions$/.test(path);

    if (reactionMatch) {
      const reactionResult = await handleReactions(
        request, env, user, path
      );

      if (reactionResult) return reactionResult;
    }

    const messageResult = await handleMessages(
      request, env, user, path
    );

    if (messageResult) return messageResult;
  }

  if (path.startsWith("/api/media")) {
    if (!env.MEDIA) {
      return response({
        success: false,
        error:
          "Stockage des médias temporairement indisponible.",
      }, 503);
    }

    const result = await handleMedia(
      request,
      env as Env & { MEDIA: R2Bucket },
      user,
      path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/voice")) {
    if (!env.MEDIA) {
      return response({
        success: false,
        error:
          "Stockage vocal temporairement indisponible.",
      }, 503);
    }

    const result = await handleVoice(
      request,
      env as Env & { MEDIA: R2Bucket },
      user,
      path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/statuses")) {
    const result = await handleStatuses(
      request, env, user, path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/calls")) {
    const result = await handleCalls(
      request, env, user, path
    );
    if (result) return result;
  }

  if (
    path.startsWith("/api/privacy") ||
    path.startsWith("/api/reports")
  ) {
    const result = await handlePrivacy(
      request, env, user, path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/notifications")) {
    const result = await handleNotifications(
      request, env, user, path
    );
    if (result) return result;
  }

  if (path.startsWith("/api/realtime/")) {
    if (!env.REALTIME) {
      return response({
        success: false,
        error:
          "Service temps réel temporairement indisponible.",
      }, 503);
    }

    const result = await handleRealtime(
      request,
      env as Env & {
        REALTIME: DurableObjectNamespace
      },
      user,
      path
    );
    if (result) return result;
  }

  return null;
}

export default {
  async fetch(
    request: Request,
    env: Env
  ): Promise<Response> {

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: corsHeaders,
      });
    }

    const url = new URL(request.url);
    const path = url.pathname;

    try {
      if (
        request.method === "GET" &&
        path === "/api/health"
      ) {
        return await handleHealth(env);
      }

      if (
        request.method === "POST" &&
        path === "/api/auth/register"
      ) {
        return await handleRegister(request, env);
      }

      if (
        request.method === "POST" &&
        path === "/api/auth/login"
      ) {
        return await handleLogin(request, env);
      }

      if (
        request.method === "GET" &&
        path === "/api/auth/me"
      ) {
        const user = await authenticate(
          request,
          env.DB
        );

        if (!user) {
          return response({
            error:
              "Session invalide ou expirée.",
          }, 401);
        }

        return response({
          success: true,
          user,
        });
      }

      if (
        request.method === "POST" &&
        path === "/api/auth/logout"
      ) {
        const token = getToken(request);

        if (token) {
          const tokenHash = await sha256(token);

          await env.DB.prepare(`
            DELETE FROM sessions
            WHERE token_hash = ?
          `).bind(tokenHash).run();
        }

        return response({
          success: true,
          message: "Déconnexion effectuée.",
        });
      }

      if (path.startsWith("/api/")) {
        const currentUser = await authenticate(
          request,
          env.DB
        );

        if (!currentUser) {
          return response({
            error: "Authentification requise.",
          }, 401);
        }

        const result = await dispatchPrivateRoute(
          request,
          env,
          currentUser,
          path
        );

        if (result) {
          return withCors(result);
        }
      }

      return response({
        error: "Route introuvable.",
        path,
      }, 404);

    } catch (error) {
      console.error(
        "NEXORA API error:",
        error
      );

      return response({
        success: false,
        error: "Erreur interne du serveur.",
      }, 500);
    }
  },
};
