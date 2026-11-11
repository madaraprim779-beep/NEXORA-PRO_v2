
export async function handleMessages(
  request: Request,
  env: MessagesEnv,
  user: MessagesUser,
  path: string
): Promise<Response | null> {
  const method = request.method;

  // Envoyer un message
  if (
    path === "/api/messages" &&
    method === "POST"
  ) {
    return sendMessage(request, env, user);
  }

  // Lire les messages d'une conversation
  if (
    path === "/api/messages" &&
    method === "GET"
  ) {
    const conversationId =
      new URL(request.url).searchParams.get("conversation_id");

    if (!conversationId) {
      return json({
        error: "Identifiant de conversation obligatoire."
      }, 400);
    }

    return listMessages(
      request,
      env,
      user,
      conversationId
    );
  }

  // Marquer un message comme lu
  if (
    path === "/api/messages/read" &&
    method === "POST"
  ) {
    const conversationId =
      new URL(request.url).searchParams.get("conversation_id");

    if (!conversationId) {
      return json({
        error: "Identifiant de conversation obligatoire."
      }, 400);
    }

    return markRead(
      request,
      env,
      user,
      conversationId
    );
  }

  // Modifier un message
  const editMatch = path.match(
    /^\/api\/messages\/([^/]+)$/
  );

  if (editMatch && method === "PATCH") {
    return editMessage(
      request,
      env,
      user,
      decodeURIComponent(editMatch[1])
    );
  }

  // Supprimer un message
  if (editMatch && method === "DELETE") {
    return deleteMessage(
      env,
      user,
      decodeURIComponent(editMatch[1])
    );
  }

  // Transférer un message
  const forwardMatch = path.match(
    /^\/api\/messages\/([^/]+)\/forward$/
  );

  if (forwardMatch && method === "POST") {
    return forwardMessage(
      request,
      env,
      user,
      decodeURIComponent(forwardMatch[1])
    );
  }

  return null;
}
