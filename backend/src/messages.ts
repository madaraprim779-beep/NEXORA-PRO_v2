
export interface MessagesEnv {
  DB: D1Database;
}

export interface MessagesUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
  created_at: string;
  read_count?: number;
  read_by_me?: number;
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

function getMessageId(pathname: string): string | null {
  const match = pathname.match(/^\/api\/messages\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function isConversationMember(
  DB: D1Database,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const result = await DB.prepare(`
    SELECT 1
    FROM conversation_members
    WHERE conversation_id = ? AND user_id = ?
    LIMIT 1
  `).bind(conversationId, userId).first();

  return Boolean(result);
}

async function getMessage(
  DB: D1Database,
  messageId: string
): Promise<MessageRow | null> {
  return DB.prepare(`
    SELECT
      id,
      conversation_id,
      sender_id,
      content,
      message_type,
      reply_to,
      edited_at,
      deleted_at,
      created_at
    FROM messages
    WHERE id = ?
    LIMIT 1
  `).bind(messageId).first<MessageRow>();
}

function createId(): string {
  return crypto.randomUUID();
}

async function markConversationAsRead(
  DB: D1Database,
  conversationId: string,
  userId: string
): Promise<void> {
  await DB.prepare(`
    INSERT OR IGNORE INTO message_reads (message_id, user_id)
    SELECT m.id, ?
    FROM messages m
    WHERE m.conversation_id = ?
      AND m.sender_id != ?
      AND m.deleted_at IS NULL
  `).bind(userId, conversationId, userId).run();
}

export async function handleMessages(
  request: Request,
  env: MessagesEnv,
  user: MessagesUser
): Promise<Response> {
  const url = new URL(request.url);
  const pathname = url.pathname;
  const method = request.method;

  // LISTER LES MESSAGES ET ENREGISTRER LEUR LECTURE
  if (method === "GET" && pathname === "/api/messages") {
    const conversationId = url.searchParams.get("conversation_id");

    if (!conversationId) {
      return json({
        success: false,
        error: "Identifiant de conversation manquant.",
      }, 400);
    }

    const member = await isConversationMember(
      env.DB,
      conversationId,
      user.id
    );

    if (!member) {
      return json({
        success: false,
        error: "Accès à cette conversation refusé.",
      }, 403);
    }

    // Marquer les messages reçus comme lus.
    await markConversationAsRead(
      env.DB,
      conversationId,
      user.id
    );

    const result = await env.DB.prepare(`
      SELECT
        m.id,
        m.conversation_id,
        m.sender_id,
        m.content,
        m.message_type,
        m.reply_to,
        m.edited_at,
        m.deleted_at,
        m.created_at,
        (
          SELECT COUNT(*)
          FROM message_reads mr
          JOIN conversation_members cm
            ON cm.user_id = mr.user_id
           AND cm.conversation_id = m.conversation_id
          WHERE mr.message_id = m.id
            AND mr.user_id != m.sender_id
        ) AS read_count,
        EXISTS (
          SELECT 1
          FROM message_reads mine
          WHERE mine.message_id = m.id
            AND mine.user_id = ?
        ) AS read_by_me
      FROM messages m
      WHERE m.conversation_id = ?
        AND m.deleted_at IS NULL
      ORDER BY m.created_at ASC
      LIMIT 500
    `).bind(user.id, conversationId).all<MessageRow>();

    return json({
      success: true,
      messages: result.results ?? [],
      total: result.results?.length ?? 0,
    });
  }

  // ENVOYER UN MESSAGE TEXTE
  if (method === "POST" && pathname === "/api/messages") {
    let body: {
      conversation_id?: string;
      content?: string;
      reply_to?: string;
    };

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Données invalides.",
      }, 400);
    }

    const conversationId = body.conversation_id?.trim();
    const content = body.content?.trim();

    if (!conversationId || !content) {
      return json({
        success: false,
        error: "Conversation et message obligatoires.",
      }, 400);
    }

    if (content.length > 10000) {
      return json({
        success: false,
        error: "Message trop long.",
      }, 400);
    }

    const member = await isConversationMember(
      env.DB,
      conversationId,
      user.id
    );

    if (!member) {
      return json({
        success: false,
        error: "Vous ne participez pas à cette conversation.",
      }, 403);
    }

    if (body.reply_to) {
      const original = await getMessage(env.DB, body.reply_to);

      if (
        !original ||
        original.conversation_id !== conversationId ||
        original.deleted_at
      ) {
        return json({
          success: false,
          error: "Message auquel répondre introuvable.",
        }, 404);
      }
    }

    const id = createId();

    await env.DB.prepare(`
      INSERT INTO messages (
        id,
        conversation_id,
        sender_id,
        content,
        message_type,
        reply_to
      )
      VALUES (?, ?, ?, ?, 'text', ?)
    `).bind(
      id,
      conversationId,
      user.id,
      content,
      body.reply_to ?? null
    ).run();

    const message = await getMessage(env.DB, id);

    return json({
      success: true,
      message,
    }, 201);
  }

  // MODIFIER UN MESSAGE
  if (method === "PATCH") {
    const messageId = getMessageId(pathname);

    if (!messageId) {
      return json({
        success: false,
        error: "Route introuvable.",
      }, 404);
    }

    const message = await getMessage(env.DB, messageId);

    if (!message || message.deleted_at) {
      return json({
        success: false,
        error: "Message introuvable.",
      }, 404);
    }

    if (message.sender_id !== user.id) {
      return json({
        success: false,
        error: "Vous ne pouvez modifier que vos messages.",
      }, 403);
    }

    let body: { content?: string };

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Données invalides.",
      }, 400);
    }

    const content = body.content?.trim();

    if (!content || content.length > 10000) {
      return json({
        success: false,
        error: "Le message est vide ou trop long.",
      }, 400);
    }

    await env.DB.prepare(`
      UPDATE messages
      SET content = ?, edited_at = CURRENT_TIMESTAMP
      WHERE id = ? AND sender_id = ?
    `).bind(content, messageId, user.id).run();

    return json({
      success: true,
      message: await getMessage(env.DB, messageId),
    });
  }

  // SUPPRIMER SON MESSAGE
  if (method === "DELETE") {
    const messageId = getMessageId(pathname);

    if (!messageId) {
      return json({
        success: false,
        error: "Route introuvable.",
      }, 404);
    }

    const message = await getMessage(env.DB, messageId);

    if (!message || message.deleted_at) {
      return json({
        success: false,
        error: "Message introuvable.",
      }, 404);
    }

    if (message.sender_id !== user.id) {
      return json({
        success: false,
        error: "Vous ne pouvez supprimer que vos messages.",
      }, 403);
    }

    await env.DB.prepare(`
      UPDATE messages
      SET deleted_at = CURRENT_TIMESTAMP,
          content = ''
      WHERE id = ? AND sender_id = ?
    `).bind(messageId, user.id).run();

    return json({
      success: true,
      message: "Message supprimé.",
    });
  }

  // TRANSFÉRER UN MESSAGE TEXTE
  const forwardMatch = pathname.match(
    /^\/api\/messages\/([^/]+)\/forward$/
  );

  if (method === "POST" && forwardMatch) {
    const originalId = decodeURIComponent(forwardMatch[1]);

    const original = await getMessage(env.DB, originalId);

    if (!original || original.deleted_at) {
      return json({
        success: false,
        error: "Message à transférer introuvable.",
      }, 404);
    }

    const originalMember = await isConversationMember(
      env.DB,
      original.conversation_id,
      user.id
    );

    if (!originalMember) {
      return json({
        success: false,
        error: "Accès refusé.",
      }, 403);
    }

    let body: { conversation_id?: string };

    try {
      body = await request.json();
    } catch {
      return json({
        success: false,
        error: "Données invalides.",
      }, 400);
    }

    const destinationId = body.conversation_id?.trim();

    if (!destinationId) {
      return json({
        success: false,
        error: "Conversation de destination manquante.",
      }, 400);
    }

    const destinationMember = await isConversationMember(
      env.DB,
      destinationId,
      user.id
    );

    if (!destinationMember) {
      return json({
        success: false,
        error: "Vous ne participez pas à la conversation de destination.",
      }, 403);
    }

    const newId = createId();

    await env.DB.prepare(`
      INSERT INTO messages (
        id,
        conversation_id,
        sender_id,
        content,
        message_type
      )
      VALUES (?, ?, ?, ?, 'text')
    `).bind(
      newId,
      destinationId,
      user.id,
      original.content
    ).run();

    return json({
      success: true,
      message: await getMessage(env.DB, newId),
    }, 201);
  }

  return json({
    success: false,
    error: "Route de messagerie introuvable.",
  }, 404);
}
