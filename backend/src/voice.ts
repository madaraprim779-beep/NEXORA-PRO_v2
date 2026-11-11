
export interface VoiceEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
}

export interface VoiceUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

const MAX_VOICE_SIZE = 15 * 1024 * 1024;

const ALLOWED_AUDIO_TYPES = [
  "audio/webm",
  "audio/ogg",
  "audio/mp4",
  "audio/mpeg",
  "audio/wav",
  "audio/aac"
];

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

function extension(type: string): string {
  const types: Record<string, string> = {
    "audio/webm": "webm",
    "audio/ogg": "ogg",
    "audio/mp4": "m4a",
    "audio/mpeg": "mp3",
    "audio/wav": "wav",
    "audio/aac": "aac"
  };

  return types[type] || "bin";
}

async function isMember(
  db: D1Database,
  conversationId: string,
  userId: string
): Promise<boolean> {
  const member = await db.prepare(`
    SELECT 1
    FROM conversation_members
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

async function uploadVoice(
  request: Request,
  env: VoiceEnv,
  user: VoiceUser
): Promise<Response> {
  const form = await request.formData();

  const conversationId = String(
    form.get("conversation_id") || ""
  );

  const file = form.get("file");

  if (!conversationId) {
    return json({ error: "Conversation obligatoire." }, 400);
  }

  if (!(file instanceof File)) {
    return json({ error: "Fichier audio manquant." }, 400);
  }

  if (!ALLOWED_AUDIO_TYPES.includes(file.type)) {
    return json({ error: "Format audio non autorisé." }, 415);
  }

  if (file.size <= 0 || file.size > MAX_VOICE_SIZE) {
    return json({
      error: "Fichier audio vide ou trop volumineux.",
      maximum_bytes: MAX_VOICE_SIZE
    }, 413);
  }

  if (!await isMember(env.DB, conversationId, user.id)) {
    return json({ error: "Accès à la conversation refusé." }, 403);
  }

  if (await isBlocked(env.DB, conversationId, user.id)) {
    return json({ error: "Action indisponible." }, 403);
  }

  const id = crypto.randomUUID();

  const key =
    `voice/${conversationId}/${user.id}/${id}.${extension(file.type)}`;

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "private, no-store"
    },
    customMetadata: {
      conversationId,
      uploaderId: user.id,
      mediaType: "voice",
      voiceId: id
    }
  });

  return json({
    success: true,
    voice: {
      id,
      conversation_id: conversationId,
      content_type: file.type,
      size: file.size,
      download_url: `/api/voice/download?key=${encodeURIComponent(key)}`
    }
  }, 201);
}

async function downloadVoice(
  request: Request,
  env: VoiceEnv,
  user: VoiceUser
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!key || !key.startsWith("voice/")) {
    return json({ error: "Identifiant audio invalide." }, 400);
  }

  const object = await env.MEDIA.get(key);

  if (!object) {
    return json({ error: "Message vocal introuvable." }, 404);
  }

  const conversationId = object.customMetadata?.conversationId;

  if (
    object.customMetadata?.mediaType !== "voice" ||
    !conversationId ||
    !await isMember(env.DB, conversationId, user.id)
  ) {
    return json({ error: "Accès refusé." }, 403);
  }

  if (await isBlocked(env.DB, conversationId, user.id)) {
    return json({ error: "Accès indisponible." }, 403);
  }

  const headers = new Headers();

  object.writeHttpMetadata(headers);

  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "inline");
  headers.set("Accept-Ranges", "none");
  headers.set("Access-Control-Allow-Origin", "*");

  return new Response(object.body, {
    status: 200,
    headers
  });
}

async function deleteVoice(
  request: Request,
  env: VoiceEnv,
  user: VoiceUser
): Promise<Response> {
  const url = new URL(request.url);
  const key = url.searchParams.get("key");

  if (!key || !key.startsWith("voice/")) {
    return json({ error: "Identifiant audio invalide." }, 400);
  }

  const object = await env.MEDIA.get(key);

  if (!object) {
    return json({ error: "Message vocal introuvable." }, 404);
  }

  if (object.customMetadata?.mediaType !== "voice") {
    return json({ error: "Fichier audio invalide." }, 400);
  }

  if (object.customMetadata?.uploaderId !== user.id) {
    return json({
      error: "Seul l'expéditeur peut supprimer ce fichier."
    }, 403);
  }

  const conversationId = object.customMetadata?.conversationId;

  if (
    !conversationId ||
    !await isMember(env.DB, conversationId, user.id)
  ) {
    return json({ error: "Accès refusé." }, 403);
  }

  await env.MEDIA.delete(key);

  return json({
    success: true,
    message: "Message vocal supprimé."
  });
}

export async function handleVoice(
  request: Request,
  env: VoiceEnv,
  user: VoiceUser,
  path: string
): Promise<Response | null> {
  const method = request.method;

  if (path === "/api/voice/upload" && method === "POST") {
    return uploadVoice(request, env, user);
  }

  if (path === "/api/voice/download" && method === "GET") {
    return downloadVoice(request, env, user);
  }

  if (path === "/api/voice/delete" && method === "DELETE") {
    return deleteVoice(request, env, user);
  }

  return null;
}
