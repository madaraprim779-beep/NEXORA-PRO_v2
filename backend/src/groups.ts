
export interface GroupEnv {
  DB: D1Database;
}

export interface GroupUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

const jsonHeaders = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
};

function result(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: jsonHeaders,
  });
}

async function body(request: Request): Promise<any> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function isMember(
  db: D1Database,
  groupId: string,
  userId: string
): Promise<boolean> {
  const member = await db.prepare(`
    SELECT 1
    FROM conversation_members
    WHERE conversation_id = ? AND user_id = ?
    LIMIT 1
  `).bind(groupId, userId).first();

  return Boolean(member);
}

async function isAdmin(
  db: D1Database,
  groupId: string,
  userId: string
): Promise<boolean> {
  const member = await db.prepare(`
    SELECT 1
    FROM conversation_members
    WHERE conversation_id = ?
      AND user_id = ?
      AND role = 'admin'
    LIMIT 1
  `).bind(groupId, userId).first();

  return Boolean(member);
}

async function findUser(
  db: D1Database,
  nexoraId: string
): Promise<any> {
  return db.prepare(`
    SELECT id, nexora_id, username, display_name, avatar_url
    FROM profiles
    WHERE nexora_id = ?
    LIMIT 1
  `).bind(nexoraId).first();
}

// Créer un groupe
async function createGroup(
  request: Request,
  env: GroupEnv,
  user: GroupUser
): Promise<Response> {
  const data = await body(request);

  if (!data || typeof data.name !== "string") {
    return result({ error: "Nom du groupe invalide." }, 400);
  }

  const name = data.name.trim();

  if (name.length < 2 || name.length > 60) {
    return result({
      error: "Le nom doit contenir entre 2 et 60 caractères."
    }, 400);
  }

  const id = crypto.randomUUID();

  await env.DB.batch([
    env.DB.prepare(`
      INSERT INTO conversations
      (id, type, title, created_by, created_at, updated_at)
      VALUES (?, 'group', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `).bind(id, name, user.id),

    env.DB.prepare(`
      INSERT INTO conversation_members
      (conversation_id, user_id, role, joined_at)
      VALUES (?, ?, 'admin', CURRENT_TIMESTAMP)
    `).bind(id, user.id),
  ]);

  return result({
    success: true,
    message: "Groupe créé.",
    group: {
      id,
      name,
      creator: user.nexora_id
    }
  }, 201);
}

// Ajouter un membre
async function addMember(
  request: Request,
  env: GroupEnv,
  user: GroupUser,
  groupId: string
): Promise<Response> {
  if (!await isAdmin(env.DB, groupId, user.id)) {
    return result({
      error: "Seul un administrateur peut ajouter des membres."
    }, 403);
  }

  const data = await body(request);
  const nexoraId = String(data?.nexora_id || "").trim().toUpperCase();

  if (!nexoraId) {
    return result({ error: "NEXORA ID obligatoire." }, 400);
  }

  const member = await findUser(env.DB, nexoraId);

  if (!member) {
    return result({ error: "Utilisateur introuvable." }, 404);
  }

  if (member.id === user.id) {
    return result({ error: "Vous êtes déjà membre." }, 409);
  }

  const exists = await isMember(env.DB, groupId, member.id);

  if (exists) {
    return result({ error: "Cet utilisateur est déjà membre." }, 409);
  }

  await env.DB.prepare(`
    INSERT INTO conversation_members
    (conversation_id, user_id, role, joined_at)
    VALUES (?, ?, 'member', CURRENT_TIMESTAMP)
  `).bind(groupId, member.id).run();

  return result({
    success: true,
    message: "Membre ajouté.",
    member: {
      nexora_id: member.nexora_id,
      display_name: member.display_name
    }
  }, 201);
}

// Voir les membres
async function listMembers(
  env: GroupEnv,
  user: GroupUser,
  groupId: string
): Promise<Response> {
  if (!await isMember(env.DB, groupId, user.id)) {
    return result({ error: "Accès refusé." }, 403);
  }

  const members = await env.DB.prepare(`
    SELECT
      p.id,
      p.nexora_id,
      p.username,
      p.display_name,
      p.avatar_url,
      m.role,
      m.joined_at
    FROM conversation_members m
    JOIN profiles p ON p.id = m.user_id
    WHERE m.conversation_id = ?
    ORDER BY m.joined_at ASC
  `).bind(groupId).all();

  return result({
    success: true,
    members: members.results || []
  });
}

// Modifier le groupe
async function updateGroup(
  request: Request,
  env: GroupEnv,
  user: GroupUser,
  groupId: string
): Promise<Response> {
  if (!await isAdmin(env.DB, groupId, user.id)) {
    return result({ error: "Permission administrateur requise." }, 403);
  }

  const data = await body(request);

  if (!data || typeof data.name !== "string") {
    return result({ error: "Nom invalide." }, 400);
  }

  const name = data.name.trim();

  if (name.length < 2 || name.length > 60) {
    return result({ error: "Nom invalide." }, 400);
  }

  await env.DB.prepare(`
    UPDATE conversations
    SET title = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND type = 'group'
  `).bind(name, groupId).run();

  return result({
    success: true,
    message: "Groupe modifié.",
    name
  });
}

// Promouvoir ou rétrograder un administrateur
async function changeRole(
  request: Request,
  env: GroupEnv,
  user: GroupUser,
  groupId: string
): Promise<Response> {
  if (!await isAdmin(env.DB, groupId, user.id)) {
    return result({ error: "Permission administrateur requise." }, 403);
  }

  const data = await body(request);
  const nexoraId = String(data?.nexora_id || "").trim().toUpperCase();
  const role = data?.role;

  if (!["admin", "member"].includes(role)) {
    return result({ error: "Rôle invalide." }, 400);
  }

  const member = await findUser(env.DB, nexoraId);

  if (!member || !await isMember(env.DB, groupId, member.id)) {
    return result({ error: "Membre introuvable." }, 404);
  }

  if (member.id === user.id && role === "member") {
    return result({
      error: "Transférez d'abord l'administration à un autre membre."
    }, 400);
  }

  await env.DB.prepare(`
    UPDATE conversation_members
    SET role = ?
    WHERE conversation_id = ? AND user_id = ?
  `).bind(role, groupId, member.id).run();

  return result({
    success: true,
    message: "Rôle modifié."
  });
}

// Retirer un membre
async function removeMember(
  env: GroupEnv,
  user: GroupUser,
  groupId: string,
  targetId: string
): Promise<Response> {
  if (!await isAdmin(env.DB, groupId, user.id)) {
    return result({ error: "Permission administrateur requise." }, 403);
  }

  if (targetId === user.id) {
    return result({
      error: "Utilisez la fonction quitter le groupe."
    }, 400);
  }

  await env.DB.prepare(`
    DELETE FROM conversation_members
    WHERE conversation_id = ? AND user_id = ?
  `).bind(groupId, targetId).run();

  return result({ success: true, message: "Membre retiré." });
}

// Quitter un groupe
async function leaveGroup(
  env: GroupEnv,
  user: GroupUser,
  groupId: string
): Promise<Response> {
  if (!await isMember(env.DB, groupId, user.id)) {
    return result({ error: "Vous n'êtes pas membre." }, 404);
  }

  await env.DB.prepare(`
    DELETE FROM conversation_members
    WHERE conversation_id = ? AND user_id = ?
  `).bind(groupId, user.id).run();

  return result({
    success: true,
    message: "Vous avez quitté le groupe."
  });
}

// Supprimer un groupe
async function deleteGroup(
  env: GroupEnv,
  user: GroupUser,
  groupId: string
): Promise<Response> {
  if (!await isAdmin(env.DB, groupId, user.id)) {
    return result({ error: "Permission administrateur requise." }, 403);
  }

  await env.DB.batch([
    env.DB.prepare(`
      DELETE FROM message_reactions
      WHERE message_id IN (
        SELECT id FROM messages WHERE conversation_id = ?
      )
    `).bind(groupId),

    env.DB.prepare(`
      DELETE FROM messages WHERE conversation_id = ?
    `).bind(groupId),

    env.DB.prepare(`
      DELETE FROM conversation_members WHERE conversation_id = ?
    `).bind(groupId),

    env.DB.prepare(`
      DELETE FROM conversations WHERE id = ? AND type = 'group'
    `).bind(groupId),
  ]);

  return result({
    success: true,
    message: "Groupe supprimé."
  });
}

// Routeur des groupes
export async function handleGroups(
  request: Request,
  env: GroupEnv,
  user: GroupUser,
  path: string
): Promise<Response | null> {
  const method = request.method;
  const parts = path.split("/").filter(Boolean);
  const groupId = parts[2];

  if (path === "/api/groups" && method === "POST") {
    return createGroup(request, env, user);
  }

  if (path === "/api/groups" && method === "GET") {
    const groups = await env.DB.prepare(`
      SELECT
        c.id,
        c.title,
        c.created_by,
        c.created_at,
        c.updated_at,
        COUNT(m.user_id) AS member_count
      FROM conversations c
      JOIN conversation_members mine
        ON mine.conversation_id = c.id
      LEFT JOIN conversation_members m
        ON m.conversation_id = c.id
      WHERE mine.user_id = ? AND c.type = 'group'
      GROUP BY c.id
      ORDER BY c.updated_at DESC
    `).bind(user.id).all();

    return result({
      success: true,
      groups: groups.results || []
    });
  }

  if (!groupId || !await isMember(env.DB, groupId, user.id)) {
    return result({ error: "Groupe introuvable ou accès refusé." }, 404);
  }

  if (parts[3] === "members" && method === "GET") {
    return listMembers(env, user, groupId);
  }

  if (parts[3] === "members" && method === "POST") {
    return addMember(request, env, user, groupId);
  }

  if (parts[3] === "members" && parts[4] && method === "DELETE") {
    return removeMember(env, user, groupId, parts[4]);
  }

  if (parts[3] === "role" && method === "PATCH") {
    return changeRole(request, env, user, groupId);
  }

  if (parts[3] === "leave" && method === "POST") {
    return leaveGroup(env, user, groupId);
  }

  if (parts[3] === "delete" && method === "DELETE") {
    return deleteGroup(env, user, groupId);
  }

  if (method === "PATCH" && parts.length === 3) {
    return updateGroup(request, env, user, groupId);
  }

  return null;
}
