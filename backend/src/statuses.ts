
export interface StatusEnv {
  DB: D1Database;
  MEDIA?: R2Bucket;
}

export interface StatusUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

const MAX_CAPTION_LENGTH = 700;
const STATUS_DURATION = 24 * 60 * 60;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*"
    }
  });
}

async function isBlocked(
  db: D1Database,
  userA: string,
  userB: string
): Promise<boolean> {
  const result = await db.prepare(`
    SELECT 1
    FROM blocks
    WHERE (blocker_id = ? AND blocked_id = ?)
       OR (blocker_id = ? AND blocked_id = ?)
    LIMIT 1
  `).bind(userA, userB, userB, userA).first();

  return Boolean(result);
}

async function canSeeStatus(
  db: D1Database,
  viewerId: string,
  ownerId: string
): Promise<boolean> {
  if (viewerId === ownerId) return false;

  if (await isBlocked(db, viewerId, ownerId)) {
    return false;
  }

  const result = await db.prepare(`
    SELECT 1
    WHERE EXISTS (
      SELECT 1 FROM contacts
      WHERE user_id = ? AND contact_user_id = ?
    )
    OR EXISTS (
      SELECT 1
      FROM conversation_members a
      JOIN conversation_members b
        ON b.conversation_id = a.conversation_id
      WHERE a.user_id = ?
        AND b.user_id = ?
    )
    LIMIT 1
  `).bind(
    viewerId,
    ownerId,
    viewerId,
    ownerId
  ).first();

  return Boolean(result);
}

async function publishStatus(
  request: Request,
  env: StatusEnv,
  user: StatusUser
): Promise<Response> {
  let data: unknown;

  try {
    data = await request.json();
  } catch {
    return json({ error: "Données invalides." }, 400);
  }

  const input = data as {
    caption?: unknown;
    media_url?: unknown;
    media_type?: unknown;
  } | null;

  const caption =
    typeof input?.caption === "string"
      ? input.caption.trim()
      : "";

  const mediaUrl =
    typeof input?.media_url === "string"
      ? input.media_url.trim()
      : null;

  const mediaType = input?.media_type ?? "text";

  if (caption.length > MAX_CAPTION_LENGTH) {
    return json({ error: "Texte trop long." }, 400);
  }

  if (!["text", "image", "video"].includes(String(mediaType))) {
    return json({ error: "Type de statut invalide." }, 400);
  }

  if (mediaType === "text" && !caption) {
    return json({ error: "Le statut ne peut pas être vide." }, 400);
  }

  if (mediaType !== "text") {
    if (!mediaUrl) {
      return json({ error: "Média obligatoire." }, 400);
    }

    if (
      !mediaUrl.startsWith("/api/media/download/") ||
      mediaUrl.length > 500 ||
      mediaUrl.includes("..")
    ) {
      return json({ error: "Référence média invalide." }, 400);
    }

    // Les médias ne sont pas activés tant que le stockage
    // R2 n'est pas configuré.
    if (!env.MEDIA) {
      return json({
        error: "Les statuts photo et vidéo sont temporairement indisponibles.",
        code: "MEDIA_STORAGE_DISABLED"
      }, 503);
    }
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO statuses (
      id,
      user_id,
      media_url,
      caption,
      media_type,
      expires_at,
      created_at
    )
    VALUES (
      ?, ?, ?, ?, ?,
      datetime('now', '+24 hours'),
      CURRENT_TIMESTAMP
    )
  `).bind(
    id,
    user.id,
    mediaUrl,
    caption,
    mediaType
  ).run();

  return json({
    success: true,
    status: {
      id,
      caption,
      media_type: mediaType,
      media_url: mediaUrl,
      expires_in_seconds: STATUS_DURATION
    }
  }, 201);
}

async function listStatuses(
  env: StatusEnv,
  user: StatusUser
): Promise<Response> {
  const statuses = await env.DB.prepare(`
    SELECT
      s.id,
      s.user_id,
      p.nexora_id,
      p.display_name,
      p.avatar_url,
      s.media_url,
      s.caption,
      s.media_type,
      s.created_at,
      s.expires_at,
      EXISTS (
        SELECT 1
        FROM status_views sv
        WHERE sv.status_id = s.id
          AND sv.viewer_id = ?
      ) AS viewed
    FROM statuses s
    JOIN profiles p ON p.id = s.user_id
    WHERE s.expires_at > CURRENT_TIMESTAMP
      AND s.user_id != ?
      AND (
        EXISTS (
          SELECT 1 FROM contacts c
          WHERE c.user_id = ?
            AND c.contact_user_id = s.user_id
        )
        OR EXISTS (
          SELECT 1
          FROM conversation_members mine
          JOIN conversation_members other
            ON other.conversation_id = mine.conversation_id
          WHERE mine.user_id = ?
            AND other.user_id = s.user_id
        )
      )
      AND NOT EXISTS (
        SELECT 1 FROM blocks b
        WHERE (b.blocker_id = ? AND b.blocked_id = s.user_id)
           OR (b.blocker_id = s.user_id AND b.blocked_id = ?)
      )
    ORDER BY s.created_at DESC
  `).bind(
    user.id,
    user.id,
    user.id,
    user.id,
    user.id,
    user.id
  ).all();

  return json({
    success: true,
    statuses: statuses.results || []
  });
}

async function viewStatus(
  env: StatusEnv,
  user: StatusUser,
  statusId: string
): Promise<Response> {
  const status = await env.DB.prepare(`
    SELECT id, user_id, expires_at
    FROM statuses
    WHERE id = ?
      AND expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(statusId).first<{
    id: string;
    user_id: string;
    expires_at: string;
  }>();

  if (!status) {
    return json({
      error: "Statut introuvable ou expiré."
    }, 404);
  }

  if (!await canSeeStatus(
    env.DB,
    user.id,
    status.user_id
  )) {
    return json({
      error: "Ce statut ne vous est pas accessible."
    }, 403);
  }

  await env.DB.prepare(`
    INSERT OR IGNORE INTO status_views (
      status_id,
      viewer_id,
      viewed_at
    )
    VALUES (?, ?, CURRENT_TIMESTAMP)
  `).bind(
    statusId,
    user.id
  ).run();

  return json({
    success: true,
    message: "Vue enregistrée."
  });
}

async function listStatusViews(
  env: StatusEnv,
  user: StatusUser,
  statusId: string
): Promise<Response> {
  const status = await env.DB.prepare(`
    SELECT id
    FROM statuses
    WHERE id = ?
      AND user_id = ?
      AND expires_at > CURRENT_TIMESTAMP
    LIMIT 1
  `).bind(
    statusId,
    user.id
  ).first();

  if (!status) {
    return json({
      error: "Statut introuvable."
    }, 404);
  }

  const views = await env.DB.prepare(`
    SELECT
      p.nexora_id,
      p.display_name,
      p.avatar_url,
      sv.viewed_at
    FROM status_views sv
    JOIN profiles p ON p.id = sv.viewer_id
    WHERE sv.status_id = ?
    ORDER BY sv.viewed_at DESC
  `).bind(statusId).all();

  return json({
    success: true,
    views: views.results || []
  });
}

async function deleteStatus(
  env: StatusEnv,
  user: StatusUser,
  statusId: string
): Promise<Response> {
  const status = await env.DB.prepare(`
    SELECT id
    FROM statuses
    WHERE id = ?
      AND user_id = ?
    LIMIT 1
  `).bind(
    statusId,
    user.id
  ).first();

  if (!status) {
    return json({
      error: "Statut introuvable."
    }, 404);
  }

  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM status_views
      WHERE status_id = ?
    `).bind(statusId),

    env.DB.prepare(`
      DELETE FROM statuses
      WHERE id = ?
        AND user_id = ?
    `).bind(statusId, user.id)
  ]);

  return json({
    success: true,
    message: "Statut supprimé."
  });
}

export async function handleStatuses(
  request: Request,
  env: StatusEnv,
  user: StatusUser,
  path: string
): Promise<Response | null> {
  const method = request.method;
  const parts = path.split("/").filter(Boolean);
  const statusId = parts[2];

  if (
    path === "/api/statuses" &&
    method === "POST"
  ) {
    return publishStatus(request, env, user);
  }

  if (
    path === "/api/statuses" &&
    method === "GET"
  ) {
    return listStatuses(env, user);
  }

  if (!statusId) {
    return null;
  }

  if (
    parts[3] === "view" &&
    method === "POST"
  ) {
    return viewStatus(env, user, statusId);
  }

  if (
    parts[3] === "views" &&
    method === "GET"
  ) {
    return listStatusViews(env, user, statusId);
  }

  if (
    parts.length === 3 &&
    method === "DELETE"
  ) {
    return deleteStatus(env, user, statusId);
  }

  return null;
}
