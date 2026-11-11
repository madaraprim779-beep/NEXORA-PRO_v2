
export interface MediaEnv {
  DB: D1Database;
  MEDIA: R2Bucket;
}

export interface MediaUser {
  id: string;
  nexora_id: string;
  username: string;
  display_name: string;
}

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const MAX_VIDEO_SIZE = 50 * 1024 * 1024;
const MAX_DOCUMENT_SIZE = 20 * 1024 * 1024;

const ALLOWED_TYPES: Record<string, string[]> = {
  image: ["image/jpeg", "image/png", "image/webp"],
  video: ["video/mp4", "video/webm"],
  document: [
    "application/pdf",
    "text/plain",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ]
};

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

function getExtension(type: string): string {
  const extensions: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx"
  };

  return extensions[type] || "bin";
}

async function isConversationMember(
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

async function uploadMedia(
  request: Request,
  env: MediaEnv,
  user: MediaUser,
  conversationId: string
): Promise<Response> {
  if (!await isConversationMember(env.DB, conversationId, user.id)) {
    return json({ error: "Accès à la conversation refusé." }, 403);
  }

  if (await isBlocked(env.DB, conversationId, user.id)) {
    return json({ error: "Action indisponible." }, 403);
  }

  const form = await request.formData();
  const file = form.get("file");
  const category = String(form.get("category") || "");

  if (!(file instanceof File)) {
    return json({ error: "Fichier manquant." }, 400);
  }

  if (!Object.hasOwn(ALLOWED_TYPES, category)) {
    return json({ error: "Catégorie invalide." }, 400);
  }

  if (!ALLOWED_TYPES[category].includes(file.type)) {
    return json({ error: "Format de fichier non autorisé." }, 415);
  }

  const maxSize =
    category === "image" ? MAX_IMAGE_SIZE :
    category === "video" ? MAX_VIDEO_SIZE :
    MAX_DOCUMENT_SIZE;

  if (file.size <= 0 || file.size > maxSize) {
    return json({
      error: "Taille de fichier invalide ou limite dépassée.",
      maximum_bytes: maxSize
    }, 413);
  }

  const id = crypto.randomUUID();
  const extension = getExtension(file.type);
  const key = `private/${conversationId}/${user.id}/${id}.${extension}`;

  await env.MEDIA.put(key, file.stream(), {
    httpMetadata: {
      contentType: file.type,
      cacheControl: "private, no-store"
    },
    customMetadata: {
      conversationId,
      uploaderId: user.id,
      category
    }
  });

  return json({
    success: true,
    media: {
      id,
      conversation_id: conversationId,
      category,
      content_type: file.type,
      size: file.size,
      key
    }
  }, 201);
}

async function downloadMedia(
  env: MediaEnv,
  user: MediaUser,
  key: string
): Promise<Response> {
  const object = await env.MEDIA.get(key);

  if (!object) {
    return json({ error: "Média introuvable." }, 404);
  }

  const conversationId = object.customMetadata?.conversationId;
  const uploaderId = object.customMetadata?.uploaderId;

  if (!conversationId ||
      !await isConversationMember(env.DB, conversationId, user.id)) {
    return json({ error: "Accès refusé." }, 403);
  }

  if (await isBlocked(env.DB, conversationId, user.id)) {
    return json({ error: "Accès indisponible." }, 403);
  }

  const headers = new Headers();
  object.writeHttpMetadata(headers);

  headers.set("Cache-Control", "private, no-store");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Content-Disposition", "attachment");
  headers.set("Access-Control-Allow-Origin", "*");

  if (uploaderId === user.id) {
    headers.set("X-Media-Owner", "true");
  }

  return new Response(object.body, {
    status: 200,
    headers
  });
}

async function deleteMedia(
  env: MediaEnv,
  user: MediaUser,
  key: string
): Promise<Response> {
  const object = await env.MEDIA.get(key);

  if (!object) {
    return json({ error: "Média introuvable." }, 404);
  }

  if (object.customMetadata?.uploaderId !== user.id) {
    return json({
      error: "Seul l'expéditeur peut supprimer ce média."
    }, 403);
  }

  const conversationId = object.customMetadata?.conversationId;

  if (!conversationId ||
      !await isConversationMember(env.DB, conversationId, user.id)) {
    return json({ error: "Accès refusé." }, 403);
  }

  await env.MEDIA.delete(key);

  return json({
    success: true,
    message: "Média supprimé."
  });
}

export async function handleMedia(
  request: Request,
  env: MediaEnv,
  user: MediaUser,
  path: string
): Promise<Response | null> {
  const method = request.method;

  if (path === "/api/media/upload" && method === "POST") {
    const form = await request.clone().formData();
    const conversationId = String(form.get("conversation_id") || "");

    if (!conversationId) {
      return json({ error: "Conversation obligatoire." }, 400);
    }

    return uploadMedia(request, env, user, conversationId);
  }

  const downloadMatch = path.match(/^\/api\/media\/download\/([a-zA-Z0-9_-]+)$/);

  if (downloadMatch && method === "GET") {
    return downloadMedia(env, user, downloadMatch[1]);
  }

  const deleteMatch = path.match(/^\/api\/media\/delete\/([a-zA-Z0-9_-]+)$/);

  if (deleteMatch && method === "DELETE") {
    return deleteMedia(env, user, deleteMatch[1]);
  }

  return null;
}
