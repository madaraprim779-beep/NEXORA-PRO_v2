
export interface ReactionEnv {
  DB: D1Database;
}

export interface ReactionUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

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

async function getMessageAccess(
  db: D1Database,
  messageId: string,
  userId: string
): Promise<any> {
  return db.prepare(`
    SELECT
      m.id,
      m.conversation_id,
      m.sender_id,
      m.deleted_at
    FROM messages m
    JOIN conversation_members cm
      ON cm.conversation_id = m.conversation_id
    WHERE m.id = ?
      AND cm.user_id = ?
    LIMIT 1
  `).bind(messageId, userId).first();
}

async function isBlocked(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const result = await db.prepare(`
    SELECT 1
    FROM conversation_members mine
    JOIN conversation_members other
      ON other.conversation_id = mine.conversation_id
    JOIN blocks b
      ON (
        (b.blocker_id = mine.user_id AND b.blocked_id = other.user_id)
        OR
        (b.blocker_id = other.user_id AND b.blocked_id = mine.user_id)
      )
    WHERE mine.conversation_id = ?
      AND mine.user_id = ?
    LIMIT 1
  `).bind(conversationId, userId).first();

  return Boolean(result);
}

// Ajouter ou modifier une réaction
async function addReaction(
  request: Request,
  env: ReactionEnv,
  user: ReactionUser,
  messageId: string
): Promise<Response> {
  const message = await getMessageAccess(
    env.DB,
    messageId,
    user.id
  );

  if (!message) {
    return json({ error: "Message introuvable ou accès refusé." }, 404);
  }

  if (message.deleted_at) {
    return json({ error: "Ce message a été supprimé." }, 410);
  }

  if (await isBlocked(
    env.DB,
    message.conversation_id,
    user.id
  )) {
    return json({ error: "Action indisponible." }, 403);
  }

  let data: any;

  try {
    data = await request.json();
  } catch {
    return json({ error: "Données invalides." }, 400);
  }

  const reaction = data?.reaction;

  if (typeof reaction !== "string") {
    return json({ error: "Réaction obligatoire." }, 400);
  }

  const emoji = reaction.trim();

  if (
    !emoji ||
    [...emoji].length > 8 ||
    /[\u0000-\u001F]/.test(emoji)
  ) {
    return json({ error: "Réaction invalide." }, 400);
  }

  await env.DB.prepare(`
    INSERT INTO message_reactions
      (message_id, user_id, reaction, created_at)
    VALUES (?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(message_id, user_id)
    DO UPDATE SET
      reaction = excluded.reaction,
      created_at = CURRENT_TIMESTAMP
  `).bind(messageId, user.id, emoji).run();

  return json({
    success: true,
    message: "Réaction enregistrée.",
    reaction: {
      message_id: messageId,
      user_id: user.id,
      emoji
    }
  });
}

// Voir les réactions d'un message
async function listReactions(
  env: ReactionEnv,
  user: ReactionUser,
  messageId: string
): Promise<Response> {
  const message = await getMessageAccess(
    env.DB,
    messageId,
    user.id
  );

  if (!message) {
    return json({ error: "Message introuvable ou accès refusé." }, 404);
  }

  if (message.deleted_at) {
    return json({ error: "Ce message a été supprimé." }, 410);
  }

  const reactions = await env.DB.prepare(`
    SELECT
      mr.reaction,
      COUNT(*) AS total,
      SUM(CASE WHEN mr.user_id = ? THEN 1 ELSE 0 END) AS reacted_by_me
    FROM message_reactions mr
    WHERE mr.message_id = ?
    GROUP BY mr.reaction
    ORDER BY total DESC
  `).bind(user.id, messageId).all();

  return json({
    success: true,
    reactions: reactions.results || []
  });
}

// Retirer sa réaction
async function removeReaction(
  env: ReactionEnv,
  user: ReactionUser,
  messageId: string
): Promise<Response> {
  const message = await getMessageAccess(
    env.DB,
    messageId,
    user.id
  );

  if (!message) {
    return json({ error: "Message introuvable ou accès refusé." }, 404);
  }

  if (await isBlocked(
    env.DB,
    message.conversation_id,
    user.id
  )) {
    return json({ error: "Action indisponible." }, 403);
  }

  await env.DB.prepare(`
    DELETE FROM message_reactions
    WHERE message_id = ? AND user_id = ?
  `).bind(messageId, user.id).run();

  return json({
    success: true,
    message: "Réaction retirée."
  });
}

// Routeur des réactions
export async function handleReactions(
  request: Request,
  env: ReactionEnv,
  user: ReactionUser,
  path: string
): Promise<Response | null> {
  const method = request.method;

  const match = path.match(
    /^\/api\/messages\/([a-zA-Z0-9_-]+)\/reactions$/
  );

  if (!match) return null;

  const messageId = match[1];

  if (method === "POST") {
    return addReaction(request, env, user, messageId);
  }

  if (method === "GET") {
    return listReactions(env, user, messageId);
  }

  if (method === "DELETE") {
    return removeReaction(env, user, messageId);
  }

  return null;
}
