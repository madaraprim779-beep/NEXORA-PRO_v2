
interface MessagingUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

interface MessagingEnv {
  DB: D1Database;
}

const headers = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers,
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
  db: D1Database,
  userA: string,
  userB: string
): Promise<boolean> {
  const result = await db.prepare(`
    SELECT blocker_id
    FROM blocks
    WHERE
      (blocker_id = ? AND blocked_id = ?)
      OR
      (blocker_id = ? AND blocked_id = ?)
    LIMIT 1
  `).bind(userA, userB, userB, userA).first();

  return Boolean(result);
}

async function findUser(
  db: D1Database,
  nexoraId: string
): Promise<MessagingUser | null> {
  return db.prepare(`
    SELECT id, nexora_id, username, display_name
    FROM profiles
    WHERE nexora_id = ?
    LIMIT 1
  `).bind(nexoraId).first<MessagingUser>();
}

async function findPrivateConversation(
  db: D1Database,
  userA: string,
  userB: string
): Promise<string | null> {
  const result = await db.prepare(`
    SELECT c.id
    FROM conversations c
    JOIN conversation_members a
      ON a.conversation_id = c.id
    JOIN conversation_members b
      ON b.conversation_id = c.id
    WHERE c.type = 'private'
      AND a.user_id = ?
      AND b.user_id = ?
    LIMIT 1
  `).bind(userA, userB).first<{ id: string }>();

  return result?.id ?? null;
}

async function searchUser(
  request: Request,
  db: D1Database,
  currentUser: MessagingUser
): Promise<Response> {
  const url = new URL(request.url);
  const nexoraId = url.searchParams
    .get("nexora_id")
    ?.trim()
    .toUpperCase();

  if (!nexoraId || !/^NXR-[A-Z0-9]{8}$/.test(nexoraId)) {
    return json({
      error: "Entre un NEXORA ID valide."
    }, 400);
  }

  const user = await findUser(db, nexoraId);

  if (!user || user.id === currentUser.id) {
    return json({
      success: true,
      found: false,
      user: null,
    });
  }

  if (await isBlocked(db, currentUser.id, user.id)) {
    return json({
      success: true,
      found: false,
      user: null,
    });
  }

  return json({
    success: true,
    found: true,
    user: {
      nexora_id: user.nexora_id,
      username: user.username,
      display_name: user.display_name,
    },
  });
}

async function addContact(
  request: Request,
  db: D1Database,
  currentUser: MessagingUser
): Promise<Response> {
  const body = await readBody(request);
  const nexoraId = body?.nexora_id
    ?.trim()
    .toUpperCase();

  if (!nexoraId || !/^NXR-[A-Z0-9]{8}$/.test(nexoraId)) {
    return json({
      error: "NEXORA ID invalide."
    }, 400);
  }

  const target = await findUser(db, nexoraId);

  if (!target || target.id === currentUser.id) {
    return json({
      error: "Utilisateur introuvable."
    }, 404);
  }

  if (await isBlocked(db, currentUser.id, target.id)) {
    return json({
      error: "Cette action n'est pas disponible."
    }, 403);
  }

  await db.prepare(`
    INSERT OR IGNORE INTO contacts
    (user_id, contact_user_id)
    VALUES (?, ?)
  `).bind(currentUser.id, target.id).run();

  return json({
    success: true,
    message: "Contact ajouté.",
    contact: {
      nexora_id: target.nexora_id,
      username: target.username,
      display_name: target.display_name,
    },
  }, 201);
}

async function listContacts(
  db: D1Database,
  currentUser: MessagingUser
): Promise<Response> {
  const result = await db.prepare(`
    SELECT
      p.nexora_id,
      p.username,
      p.display_name,
      p.avatar_url,
      p.bio,
      p.is_online,
      p.last_seen,
      c.created_at AS contact_since
    FROM contacts c
    JOIN profiles p
      ON p.id = c.contact_user_id
    WHERE c.user_id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM blocks b
        WHERE
          (b.blocker_id = ? AND b.blocked_id = p.id)
          OR
          (b.blocker_id = p.id AND b.blocked_id = ?)
      )
    ORDER BY p.display_name COLLATE NOCASE ASC
  `).bind(
    currentUser.id,
    currentUser.id,
    currentUser.id
  ).all();

  return json({
    success: true,
    contacts: result.results ?? [],
    total: result.results?.length ?? 0,
  });
}

async function createPrivateConversation(
  request: Request,
  db: D1Database,
  currentUser: MessagingUser
): Promise<Response> {
  const body = await readBody(request);
  const nexoraId = body?.nexora_id
    ?.trim()
    .toUpperCase();

  if (!nexoraId || !/^NXR-[A-Z0-9]{8}$/.test(nexoraId)) {
    return json({
      error: "NEXORA ID invalide."
    }, 400);
  }

  const target = await findUser(db, nexoraId);

  if (!target || target.id === currentUser.id) {
    return json({
      error: "Utilisateur introuvable."
    }, 404);
  }

  if (await isBlocked(db, currentUser.id, target.id)) {
    return json({
      error: "Impossible de créer cette conversation."
    }, 403);
  }

  const existing = await findPrivateConversation(
    db,
    currentUser.id,
    target.id
  );

  if (existing) {
    return json({
      success: true,
      created: false,
      conversation_id: existing,
      message: "Conversation déjà existante.",
    });
  }

  const conversationId = crypto.randomUUID();

  await db.batch([
    db.prepare(`
      INSERT INTO conversations
      (id, type, title, created_by)
      VALUES (?, 'private', NULL, ?)
    `).bind(conversationId, currentUser.id),

    db.prepare(`
      INSERT INTO conversation_members
      (conversation_id, user_id, role)
      VALUES (?, ?, 'member')
    `).bind(conversationId, currentUser.id),

    db.prepare(`
      INSERT INTO conversation_members
      (conversation_id, user_id, role)
      VALUES (?, ?, 'member')
    `).bind(conversationId, target.id),
  ]);

  return json({
    success: true,
    created: true,
    conversation_id: conversationId,
    participant: {
      nexora_id: target.nexora_id,
      username: target.username,
      display_name: target.display_name,
    },
  }, 201);
}

async function listConversations(
  db: D1Database,
  currentUser: MessagingUser
): Promise<Response> {
  const result = await db.prepare(`
    SELECT
      c.id AS conversation_id,
      c.type,
      c.title,
      c.created_at,
      c.updated_at,

      other.id AS participant_id,
      other.nexora_id AS participant_nexora_id,
      other.username AS participant_username,
      other.display_name AS participant_display_name,
      other.avatar_url AS participant_avatar,

      (
        SELECT m.content
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message,

      (
        SELECT m.message_type
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message_type,

      (
        SELECT m.created_at
        FROM messages m
        WHERE m.conversation_id = c.id
          AND m.deleted_at IS NULL
        ORDER BY m.created_at DESC
        LIMIT 1
      ) AS last_message_at

    FROM conversation_members mine

    JOIN conversations c
      ON c.id = mine.conversation_id

    LEFT JOIN conversation_members theirs
      ON theirs.conversation_id = c.id
      AND theirs.user_id != ?

    LEFT JOIN profiles other
      ON other.id = theirs.user_id

    WHERE mine.user_id = ?

    ORDER BY COALESCE(
      (
        SELECT m.created_at
        FROM messages m
        WHERE m.conversation_id = c.id
        ORDER BY m.created_at DESC
        LIMIT 1
      ),
      c.updated_at,
      c.created_at
    ) DESC
  `).bind(
    currentUser.id,
    currentUser.id
  ).all();

  return json({
    success: true,
    conversations: result.results ?? [],
    total: result.results?.length ?? 0,
  });
}

export async function handleMessaging(
  request: Request,
  env: MessagingEnv,
  currentUser: MessagingUser,
  path: string
): Promise<Response | null> {

  // Recherche par NEXORA ID
  if (
    request.method === "GET" &&
    path === "/api/users/search"
  ) {
    return searchUser(request, env.DB, currentUser);
  }

  // Ajouter un contact
  if (
    request.method === "POST" &&
    path === "/api/contacts"
  ) {
    return addContact(request, env.DB, currentUser);
  }

  // Liste des contacts
  if (
    request.method === "GET" &&
    path === "/api/contacts"
  ) {
    return listContacts(env.DB, currentUser);
  }

  // Créer ou retrouver une conversation privée
  if (
    request.method === "POST" &&
    path === "/api/conversations/private"
  ) {
    return createPrivateConversation(
      request,
      env.DB,
      currentUser
    );
  }

  // Liste des conversations
  if (
    request.method === "GET" &&
    path === "/api/conversations"
  ) {
    return listConversations(env.DB, currentUser);
  }

  return null;
}
