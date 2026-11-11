
export interface CallEnv {
  DB: D1Database;
}

export interface CallUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

type CallType = "audio" | "video";
type CallStatus =
  | "ringing"
  | "accepted"
  | "rejected"
  | "ended"
  | "missed";

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

async function isMember(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const member = await db.prepare(`
    SELECT 1 FROM conversation_members
    WHERE conversation_id = ? AND user_id = ?
    LIMIT 1
  `).bind(conversationId, userId).first();

  return Boolean(member);
}

async function isBlocked(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const blocked = await db.prepare(`
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

  return Boolean(blocked);
}

async function createCall(
  request: Request,
  env: CallEnv,
  user: CallUser
): Promise<Response> {
  let data: any;

  try {
    data = await request.json();
  } catch {
    return json({ error: "Données invalides." }, 400);
  }

  const conversationId = String(
    data?.conversation_id || ""
  );

  const type: CallType = data?.type;

  if (!conversationId || !["audio", "video"].includes(type)) {
    return json({ error: "Conversation ou type d'appel invalide." }, 400);
  }

  if (!await isMember(env.DB, conversationId, user.id)) {
    return json({ error: "Accès à la conversation refusé." }, 403);
  }

  if (await isBlocked(env.DB, conversationId, user.id)) {
    return json({ error: "Appel indisponible." }, 403);
  }

  const id = crypto.randomUUID();

  await env.DB.prepare(`
    INSERT INTO calls (
      id,
      conversation_id,
      initiator_id,
      call_type,
      status,
      started_at,
      created_at
    )
    VALUES (?, ?, ?, ?, 'ringing', NULL, CURRENT_TIMESTAMP)
  `).bind(
    id,
    conversationId,
    user.id,
    type
  ).run();

  return json({
    success: true,
    call: {
      id,
      conversation_id: conversationId,
      type,
      status: "ringing",
      initiator_id: user.id
    }
  }, 201);
}

async function updateCallStatus(
  request: Request,
  env: CallEnv,
  user: CallUser,
  callId: string,
  action: string
): Promise<Response> {
  const call = await env.DB.prepare(`
    SELECT c.*
    FROM calls c
    JOIN conversation_members cm
      ON cm.conversation_id = c.conversation_id
    WHERE c.id = ? AND cm.user_id = ?
    LIMIT 1
  `).bind(callId, user.id).first<any>();

  if (!call) {
    return json({ error: "Appel introuvable ou accès refusé." }, 404);
  }

  if (call.status !== "ringing" && action !== "end") {
    return json({ error: "Cet appel n'est plus disponible." }, 409);
  }

  if (await isBlocked(env.DB, call.conversation_id, user.id)) {
    return json({ error: "Action indisponible." }, 403);
  }

  let nextStatus: CallStatus;

  if (action === "accept") {
    if (call.initiator_id === user.id) {
      return json({ error: "L'initiateur ne peut pas accepter son propre appel." }, 403);
    }
    nextStatus = "accepted";
  } else if (action === "reject") {
    if (call.initiator_id === user.id) {
      return json({ error: "Action non autorisée." }, 403);
    }
    nextStatus = "rejected";
  } else if (action === "end") {
    nextStatus = "ended";
  } else {
    return json({ error: "Action invalide." }, 400);
  }

  const now = new Date().toISOString();

  if (nextStatus === "accepted") {
    await env.DB.prepare(`
      UPDATE calls
      SET status = 'accepted', started_at = ?
      WHERE id = ? AND status = 'ringing'
    `).bind(now, callId).run();
  } else {
    await env.DB.prepare(`
      UPDATE calls
      SET status = ?, ended_at = ?
      WHERE id = ? AND status IN ('ringing', 'accepted')
    `).bind(nextStatus, now, callId).run();
  }

  return json({
    success: true,
    call_id: callId,
    status: nextStatus
  });
}

async function callHistory(
  env: CallEnv,
  user: CallUser
): Promise<Response> {
  const history = await env.DB.prepare(`
    SELECT
      c.id,
      c.conversation_id,
      c.initiator_id,
      c.call_type,
      c.status,
      c.started_at,
      c.ended_at,
      c.created_at
    FROM calls c
    JOIN conversation_members cm
      ON cm.conversation_id = c.conversation_id
    WHERE cm.user_id = ?
    ORDER BY c.created_at DESC
    LIMIT 100
  `).bind(user.id).all();

  return json({
    success: true,
    calls: history.results || []
  });
}

async function callDetails(
  env: CallEnv,
  user: CallUser,
  callId: string
): Promise<Response> {
  const call = await env.DB.prepare(`
    SELECT c.*
    FROM calls c
    JOIN conversation_members cm
      ON cm.conversation_id = c.conversation_id
    WHERE c.id = ? AND cm.user_id = ?
    LIMIT 1
  `).bind(callId, user.id).first();

  if (!call) {
    return json({ error: "Appel introuvable." }, 404);
  }

  return json({
    success: true,
    call
  });
}

export async function handleCalls(
  request: Request,
  env: CallEnv,
  user: CallUser,
  path: string
): Promise<Response | null> {
  const method = request.method;
  const parts = path.split("/").filter(Boolean);

  if (path === "/api/calls" && method === "POST") {
    return createCall(request, env, user);
  }

  if (path === "/api/calls" && method === "GET") {
    return callHistory(env, user);
  }

  if (parts[0] !== "api" || parts[1] !== "calls" || !parts[2]) {
    return null;
  }

  const callId = parts[2];

  if (parts[3] === "accept" && method === "POST") {
    return updateCallStatus(request, env, user, callId, "accept");
  }

  if (parts[3] === "reject" && method === "POST") {
    return updateCallStatus(request, env, user, callId, "reject");
  }

  if (parts[3] === "end" && method === "POST") {
    return updateCallStatus(request, env, user, callId, "end");
  }

  if (parts.length === 3 && method === "GET") {
    return callDetails(env, user, callId);
  }

  return null;
}
