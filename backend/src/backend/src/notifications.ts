
export interface NotificationsEnv {
  DB: D1Database;
}

export interface NotificationsUser {
  id: string;
}

export interface CreateNotificationInput {
  user_id: string;
  type: string;
  content: string;
}

const ALLOWED_TYPES = [
  "message",
  "reaction",
  "call",
  "group",
  "contact",
  "status",
  "security",
  "system",
];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
    },
  });
}

async function createNotification(
  env: NotificationsEnv,
  input: CreateNotificationInput
): Promise<void> {
  const userId = input.user_id?.trim();
  const type = input.type?.trim();
  const content = input.content?.trim();

  if (!userId || !type || !content) {
    throw new Error("Données de notification invalides.");
  }

  if (!ALLOWED_TYPES.includes(type)) {
    throw new Error("Type de notification invalide.");
  }

  if (content.length > 1000) {
    throw new Error("Notification trop longue.");
  }

  await env.DB.prepare(`
    INSERT INTO notifications (
      id,
      user_id,
      type,
      content,
      read_at,
      created_at
    )
    VALUES (?, ?, ?, ?, NULL, CURRENT_TIMESTAMP)
  `).bind(
    crypto.randomUUID(),
    userId,
    type,
    content
  ).run();
}

export { createNotification };

async function listNotifications(
  request: Request,
  env: NotificationsEnv,
  user: NotificationsUser
): Promise<Response> {
  const url = new URL(request.url);
  const unreadOnly = url.searchParams.get("unread") === "true";

  const rawLimit = Number(url.searchParams.get("limit") || 50);
  const limit = Number.isFinite(rawLimit)
    ? Math.min(Math.max(Math.floor(rawLimit), 1), 100)
    : 50;

  const query = unreadOnly
    ? `
      SELECT id, type, content, read_at, created_at
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
      ORDER BY created_at DESC
      LIMIT ?
    `
    : `
      SELECT id, type, content, read_at, created_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ?
    `;

  try {
    const result = await env.DB.prepare(query)
      .bind(user.id, limit)
      .all();

    const unread = await env.DB.prepare(`
      SELECT COUNT(*) AS total
      FROM notifications
      WHERE user_id = ? AND read_at IS NULL
    `).bind(user.id).first<{ total: number }>();

    return json({
      success: true,
      notifications: result.results || [],
      unread_count: Number(unread?.total || 0),
    });
  } catch {
    return json({
      success: false,
      error: "Impossible de récupérer les notifications.",
    }, 500);
  }
}

async function markAllAsRead(
  env: NotificationsEnv,
  user: NotificationsUser
): Promise<Response> {
  try {
    await env.DB.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE user_id = ? AND read_at IS NULL
    `).bind(user.id).run();

    return json({
      success: true,
      message: "Toutes les notifications sont marquées comme lues.",
    });
  } catch {
    return json({
      success: false,
      error: "Impossible de mettre à jour les notifications.",
    }, 500);
  }
}

async function deleteAllNotifications(
  env: NotificationsEnv,
  user: NotificationsUser
): Promise<Response> {
  try {
    await env.DB.prepare(`
      DELETE FROM notifications
      WHERE user_id = ?
    `).bind(user.id).run();

    return json({
      success: true,
      message: "Notifications supprimées.",
    });
  } catch {
    return json({
      success: false,
      error: "Impossible de supprimer les notifications.",
    }, 500);
  }
}

async function updateNotification(
  env: NotificationsEnv,
  user: NotificationsUser,
  notificationId: string
): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      UPDATE notifications
      SET read_at = CURRENT_TIMESTAMP
      WHERE id = ? AND user_id = ?
    `).bind(notificationId, user.id).run();

    if (!result.meta.changes) {
      return json({
        success: false,
        error: "Notification introuvable.",
      }, 404);
    }

    return json({
      success: true,
      message: "Notification marquée comme lue.",
    });
  } catch {
    return json({
      success: false,
      error: "Impossible de modifier la notification.",
    }, 500);
  }
}

async function deleteNotification(
  env: NotificationsEnv,
  user: NotificationsUser,
  notificationId: string
): Promise<Response> {
  try {
    const result = await env.DB.prepare(`
      DELETE FROM notifications
      WHERE id = ? AND user_id = ?
    `).bind(notificationId, user.id).run();

    if (!result.meta.changes) {
      return json({
        success: false,
        error: "Notification introuvable.",
      }, 404);
    }

    return json({
      success: true,
      message: "Notification supprimée.",
    });
  } catch {
    return json({
      success: false,
      error: "Impossible de supprimer la notification.",
    }, 500);
  }
}

export async function handleNotifications(
  request: Request,
  env: NotificationsEnv,
  user: NotificationsUser
): Promise<Response | null> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/notifications" && request.method === "GET") {
    return listNotifications(request, env, user);
  }

  if (
    path === "/api/notifications/read-all" &&
    request.method === "PATCH"
  ) {
    return markAllAsRead(env, user);
  }

  if (
    path === "/api/notifications" &&
    request.method === "DELETE"
  ) {
    return deleteAllNotifications(env, user);
  }

  const match = path.match(/^\/api\/notifications\/([^/]+)$/);

  if (match && request.method === "PATCH") {
    return updateNotification(env, user, match[1]);
  }

  if (match && request.method === "DELETE") {
    return deleteNotification(env, user, match[1]);
  }

  return null;
}
