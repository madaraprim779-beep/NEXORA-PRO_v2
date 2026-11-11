
export interface PrivacyEnv {
  DB: D1Database;
}

export interface PrivacyUser {
  id: string;
}

type PrivacyLevel = "everyone" | "contacts" | "nobody";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function readBody(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function isBlocked(
  env: PrivacyEnv,
  userA: string,
  userB: string
): Promise<boolean> {
  const result = await env.DB.prepare(`
    SELECT 1 FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?)
       OR (blocker_id = ? AND blocked_id = ?)
    LIMIT 1
  `).bind(userA, userB, userB, userA).first();

  return !!result;
}

async function isContact(
  env: PrivacyEnv,
  userA: string,
  userB: string
): Promise<boolean> {
  const result = await env.DB.prepare(`
    SELECT 1 FROM contacts
    WHERE user_id = ? AND contact_user_id = ?
    LIMIT 1
  `).bind(userA, userB).first();

  return !!result;
}

async function ensureSettings(env: PrivacyEnv, userId: string) {
  await env.DB.prepare(`
    INSERT OR IGNORE INTO privacy_settings
      (user_id, last_seen, profile_photo, status_visibility,
       read_receipts, disappearing_seconds)
    VALUES (?, 'everyone', 'everyone', 'contacts', 1, 0)
  `).bind(userId).run();
}

async function getSettings(env: PrivacyEnv, userId: string) {
  await ensureSettings(env, userId);

  return env.DB.prepare(`
    SELECT last_seen, profile_photo, status_visibility,
           read_receipts, disappearing_seconds
    FROM privacy_settings
    WHERE user_id = ?
  `).bind(userId).first();
}

async function blockUser(
  env: PrivacyEnv,
  user: PrivacyUser,
  targetId: string
): Promise<Response> {
  if (!targetId || targetId === user.id) {
    return json({ error: "Utilisateur invalide." }, 400);
  }

  const target = await env.DB.prepare(
    "SELECT id FROM profiles WHERE id = ?"
  ).bind(targetId).first();

  if (!target) return json({ error: "Compte introuvable." }, 404);

  await env.DB.prepare(`
    INSERT OR IGNORE INTO blocks (blocker_id, blocked_id)
    VALUES (?, ?)
  `).bind(user.id, targetId).run();

  await env.DB.prepare(`
    DELETE FROM contacts
    WHERE (user_id = ? AND contact_user_id = ?)
       OR (user_id = ? AND contact_user_id = ?)
  `).bind(user.id, targetId, targetId, user.id).run();

  return json({ success: true, message: "Utilisateur bloqué." });
}

async function unblockUser(
  env: PrivacyEnv,
  user: PrivacyUser,
  targetId: string
): Promise<Response> {
  if (!targetId || targetId === user.id) {
    return json({ error: "Utilisateur invalide." }, 400);
  }

  await env.DB.prepare(`
    DELETE FROM blocks
    WHERE blocker_id = ? AND blocked_id = ?
  `).bind(user.id, targetId).run();

  return json({ success: true, message: "Utilisateur débloqué." });
}

async function listBlocked(
  env: PrivacyEnv,
  user: PrivacyUser
): Promise<Response> {
  const result = await env.DB.prepare(`
    SELECT p.id, p.nexora_id, p.username, p.display_name,
           p.avatar_url, b.created_at AS blocked_at
    FROM blocks b
    JOIN profiles p ON p.id = b.blocked_id
    WHERE b.blocker_id = ?
    ORDER BY b.created_at DESC
  `).bind(user.id).all();

  return json({ success: true, users: result.results || [] });
}

async function updateSettings(
  request: Request,
  env: PrivacyEnv,
  user: PrivacyUser
): Promise<Response> {
  const body = await readBody(request);
  if (!body) return json({ error: "Données invalides." }, 400);

  const levels: PrivacyLevel[] = ["everyone", "contacts", "nobody"];

  const current = await getSettings(env, user.id) as any;

  const lastSeen = body.last_seen ?? current.last_seen;
  const profilePhoto = body.profile_photo ?? current.profile_photo;
  const statusVisibility = body.status_visibility ?? current.status_visibility;
  const readReceipts = body.read_receipts ?? current.read_receipts;
  const disappearing = body.disappearing_seconds ?? current.disappearing_seconds;

  if (
    !levels.includes(lastSeen) ||
    !levels.includes(profilePhoto) ||
    !levels.includes(statusVisibility)
  ) {
    return json({ error: "Paramètre de visibilité invalide." }, 400);
  }

  if (typeof readReceipts !== "boolean") {
    return json({ error: "read_receipts doit être un booléen." }, 400);
  }

  const allowedDurations = [0, 86400, 604800, 7776000];

  if (
    !Number.isInteger(disappearing) ||
    !allowedDurations.includes(disappearing)
  ) {
    return json({ error: "Durée des messages éphémères invalide." }, 400);
  }

  await env.DB.prepare(`
    UPDATE privacy_settings
    SET last_seen = ?,
        profile_photo = ?,
        status_visibility = ?,
        read_receipts = ?,
        disappearing_seconds = ?,
        updated_at = CURRENT_TIMESTAMP
    WHERE user_id = ?
  `).bind(
    lastSeen,
    profilePhoto,
    statusVisibility,
    readReceipts ? 1 : 0,
    disappearing,
    user.id
  ).run();

  return json({
    success: true,
    settings: await getSettings(env, user.id)
  });
}

async function reportUser(
  request: Request,
  env: PrivacyEnv,
  user: PrivacyUser
): Promise<Response> {
  const body = await readBody(request);

  const targetId = String(body?.reported_user_id || "");
  const reason = String(body?.reason || "").trim();
  const details = String(body?.details || "").trim();

  if (!targetId || targetId === user.id) {
    return json({ error: "Compte signalé invalide." }, 400);
  }

  if (!reason || reason.length > 80 || details.length > 1000) {
    return json({ error: "Informations de signalement invalides." }, 400);
  }

  const target = await env.DB.prepare(
    "SELECT id FROM profiles WHERE id = ?"
  ).bind(targetId).first();

  if (!target) return json({ error: "Compte introuvable." }, 404);

  await env.DB.prepare(`
    INSERT INTO reports
      (id, reporter_id, reported_user_id, reason, details)
    VALUES (?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    user.id,
    targetId,
    reason,
    details || null
  ).run();

  return json({ success: true, message: "Signalement envoyé." }, 201);
}

export async function handlePrivacy(
  request: Request,
  env: PrivacyEnv,
  user: PrivacyUser,
  path: string
): Promise<Response | null> {
  const method = request.method;

  if (path === "/api/privacy/settings" && method === "GET") {
    return json({
      success: true,
      settings: await getSettings(env, user.id)
    });
  }

  if (path === "/api/privacy/settings" && method === "PATCH") {
    return updateSettings(request, env, user);
  }

  if (path === "/api/privacy/blocks" && method === "GET") {
    return listBlocked(env, user);
  }

  if (path === "/api/privacy/blocks" && method === "POST") {
    const body = await readBody(request);
    return blockUser(env, user, String(body?.user_id || ""));
  }

  if (path.startsWith("/api/privacy/blocks/")) {
    const targetId = decodeURIComponent(
      path.slice("/api/privacy/blocks/".length)
    );

    if (method === "DELETE") {
      return unblockUser(env, user, targetId);
    }
  }

  if (path === "/api/reports" && method === "POST") {
    return reportUser(request, env, user);
  }

  return null;
}
