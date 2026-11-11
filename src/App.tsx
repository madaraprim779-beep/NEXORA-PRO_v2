
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  MessageCircle,
  Users,
  CircleDot,
  Phone,
  Settings,
  Search,
  LogOut,
  RefreshCw,
  ShieldCheck,
  ArrowLeft,
  Send,
  Plus,
  X
} from "lucide-react";

type User = {
  id?: string;
  nexora_id: string;
  username: string;
  display_name: string;
};

type Contact = User & {
  avatar_url?: string | null;
  is_online?: boolean | number;
};

type Conversation = {
  conversation_id: string;
  type: string;
  title?: string | null;
  participant_nexora_id?: string | null;
  participant_username?: string | null;
  participant_display_name?: string | null;
  last_message?: string | null;
  last_message_type?: string | null;
  last_message_at?: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type?: string;
  reply_to?: string | null;
  edited_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
};

type Section =
  | "Discussions"
  | "Contacts"
  | "Statuts"
  | "Appels"
  | "Paramètres";

const API_URL = (
  import.meta.env.VITE_API_URL || ""
).replace(/\/$/, "");

const TOKEN_KEY = "nexora_session_token";

async function api<T>(
  path: string,
  token?: string,
  options: RequestInit = {}
): Promise<T> {
  if (!API_URL) {
    throw new Error(
      "API non configurée. Vérifie VITE_API_URL dans Vercel."
    );
  }

  const response = await fetch(API_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token
        ? { Authorization: `Bearer ${token}` }
        : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      data.error || "Une erreur est survenue."
    );
  }

  return data as T;
}

function formatTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

function getInitials(value?: string | null) {
  return (value || "N").trim().slice(0, 1).toUpperCase();
}

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || ""
  );

  const [user, setUser] = useState<User | null>(null);

  const [authMode, setAuthMode] = useState<
    "login" | "register"
  >("login");

  const [nexoraId, setNexoraId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [section, setSection] =
    useState<Section>("Discussions");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] =
    useState<Conversation[]>([]);

  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  const [search, setSearch] = useState("");
  const [newContactId, setNewContactId] = useState("");
  const [foundUser, setFoundUser] = useState<User | null>(null);

  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(false);
  const [messagesLoading, setMessagesLoading] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  function clearMessages() {
    setNotice("");
    setError("");
  }

  const loadWorkspace = useCallback(
    async (session: string) => {
      const [me, contactData, conversationData] =
        await Promise.all([
          api<{ user: User }>("/api/auth/me", session),
          api<{ contacts: Contact[] }>("/api/contacts", session),
          api<{ conversations: Conversation[] }>(
            "/api/conversations",
            session
          )
        ]);

      setUser(me.user);
      setContacts(contactData.contacts || []);
      setConversations(conversationData.conversations || []);
    },
    []
  );

  const loadConversationMessages = useCallback(
    async (conversationId: string, session: string) => {
      return api<{
        success: boolean;
        messages: Message[];
      }>(
        "/api/messages?conversation_id=" +
          encodeURIComponent(conversationId),
        session
      );
    },
    []
  );

  useEffect(() => {
    if (!token) return;

    let cancelled = false;

    setLoading(true);

    loadWorkspace(token)
      .catch((e: Error) => {
        if (cancelled) return;

        localStorage.removeItem(TOKEN_KEY);
        setToken("");
        setUser(null);
        setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [token, loadWorkspace]);

  useEffect(() => {
    const conversationId =
      selectedConversation?.conversation_id;

    if (!token || !conversationId) {
      setMessages([]);
      return;
    }

    let cancelled = false;

    setMessages([]);
    setMessagesLoading(true);

    loadConversationMessages(conversationId, token)
      .then((result) => {
        if (!cancelled) {
          setMessages(result.messages || []);
        }
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setMessagesLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    token,
    selectedConversation?.conversation_id,
    loadConversationMessages
  ]);

  const filteredConversations = useMemo(() => {
    const query = search.trim().toLowerCase();

    return conversations.filter((conversation) =>
      [
        conversation.title,
        conversation.participant_display_name,
        conversation.participant_username,
        conversation.participant_nexora_id,
        conversation.last_message
      ].some((value) =>
        (value || "").toLowerCase().includes(query)
      )
    );
  }, [conversations, search]);

  const filteredContacts = useMemo(() => {
    const query = search.trim().toLowerCase();

    return contacts.filter((contact) =>
      [
        contact.display_name,
        contact.username,
        contact.nexora_id
      ].some((value) =>
        value.toLowerCase().includes(query)
      )
    );
  }, [contacts, search]);

  async function submitAuth(event: FormEvent) {
    event.preventDefault();
    clearMessages();
    setBusy(true);

    try {
      const body =
        authMode === "login"
          ? {
              nexora_id: nexoraId.trim().toUpperCase(),
              password
            }
          : {
              username: username.trim(),
              display_name: displayName.trim(),
              password
            };

      const result = await api<{
        token: string;
        user: User;
      }>(
        authMode === "login"
          ? "/api/auth/login"
          : "/api/auth/register",
        undefined,
        {
          method: "POST",
          body: JSON.stringify(body)
        }
      );

      localStorage.setItem(TOKEN_KEY, result.token);
      setUser(result.user);
      setToken(result.token);
      setPassword("");

      setNotice(
        authMode === "register"
          ? "Compte créé. Conserve ton NEXORA ID."
          : "Connexion réussie."
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function refresh() {
    if (!token || busy) return;

    clearMessages();
    setBusy(true);

    try {
      await loadWorkspace(token);

      if (selectedConversation) {
        const result = await loadConversationMessages(
          selectedConversation.conversation_id,
          token
        );

        setMessages(result.messages || []);
      }

      setNotice("Données actualisées.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function openConversation(conversation: Conversation) {
    clearMessages();
    setSection("Discussions");
    setSelectedConversation(conversation);
    setDraft("");
  }

  async function sendMessage(event: FormEvent) {
    event.preventDefault();

    const content = draft.trim();
    const conversation = selectedConversation;

    if (!content || !conversation || sending) return;

    clearMessages();
    setSending(true);

    try {
      const result = await api<{
        success: boolean;
        message?: Message;
      }>("/api/messages", token, {
        method: "POST",
        body: JSON.stringify({
          conversation_id: conversation.conversation_id,
          content
        })
      });

      if (result.message) {
        setMessages((current) => [
          ...current,
          result.message!
        ]);
      } else {
        const updated = await loadConversationMessages(
          conversation.conversation_id,
          token
        );

        setMessages(updated.messages || []);
      }

      setDraft("");
      await loadWorkspace(token);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  async function searchUser(event: FormEvent) {
    event.preventDefault();

    clearMessages();
    setFoundUser(null);
    setBusy(true);

    try {
      const result = await api<{
        found: boolean;
        user: User | null;
      }>(
        "/api/users/search?nexora_id=" +
          encodeURIComponent(
            newContactId.trim().toUpperCase()
          ),
        token
      );

      if (!result.found || !result.user) {
        setNotice("Aucun compte trouvé avec ce NEXORA ID.");
      } else {
        setFoundUser(result.user);
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Ajout du contact et ouverture de sa conversation réelle.
  async function addContact() {
    if (!foundUser || busy) return;

    clearMessages();
    setBusy(true);

    try {
      const target = foundUser;

      await api("/api/contacts", token, {
        method: "POST",
        body: JSON.stringify({
          nexora_id: target.nexora_id
        })
      });

      const conversationResult = await api<{
        success: boolean;
        created: boolean;
        conversation_id: string;
        participant?: User;
      }>("/api/conversations/private", token, {
        method: "POST",
        body: JSON.stringify({
          nexora_id: target.nexora_id
        })
      });

      if (
        !conversationResult.success ||
        !conversationResult.conversation_id
      ) {
        throw new Error(
          "Impossible d'ouvrir cette conversation."
        );
      }

      const conversation: Conversation = {
        conversation_id:
          conversationResult.conversation_id,
        type: "private",
        participant_nexora_id: target.nexora_id,
        participant_username: target.username,
        participant_display_name: target.display_name
      };

      await loadWorkspace(token);

      setFoundUser(null);
      setNewContactId("");
      setDraft("");
      setSection("Discussions");
      setSelectedConversation(conversation);
      setNotice("Contact ajouté. Conversation ouverte.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    try {
      await api("/api/auth/logout", token, {
        method: "POST"
      });
    } catch {
      // La session locale est supprimée même si le serveur répond mal.
    }

    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setContacts([]);
    setConversations([]);
    setMessages([]);
    setSelectedConversation(null);
    setSection("Discussions");
    clearMessages();
  }

  if (!token || !user) {
    return (
      <main className="auth-shell">
        <div className="auth-brand">
          <span className="brand-mark">N</span>
          <span>NEXORA</span>
        </div>

        <section className="auth-card">
          <div className="eyebrow">
            <ShieldCheck size={15} />
            MESSAGERIE PRIVÉE
          </div>

          <h1>
            {authMode === "login"
              ? "Bienvenue."
              : "Créer votre compte."}
          </h1>

          <p className="muted">
            {authMode === "login"
              ? "Connectez-vous avec votre NEXORA ID."
              : "Créez votre identité NEXORA."}
          </p>

          <div className="auth-switch">
            <button
              type="button"
              className={authMode === "login" ? "active" : ""}
              onClick={() => {
                setAuthMode("login");
                clearMessages();
              }}
            >
              Connexion
            </button>

            <button
              type="button"
              className={authMode === "register" ? "active" : ""}
              onClick={() => {
                setAuthMode("register");
                clearMessages();
              }}
            >
              Inscription
            </button>
          </div>

          <form onSubmit={submitAuth} className="auth-form">
            {authMode === "register" ? (
              <>
                <label>
                  Pseudo
                  <input
                    required
                    minLength={3}
                    maxLength={24}
                    value={username}
                    onChange={(e) =>
                      setUsername(e.target.value)
                    }
                    placeholder="Votre pseudo"
                    autoComplete="username"
                  />
                </label>

                <label>
                  Nom affiché
                  <input
                    required
                    maxLength={40}
                    value={displayName}
                    onChange={(e) =>
                      setDisplayName(e.target.value)
                    }
                    placeholder="Votre nom"
                  />
                </label>
              </>
            ) : (
              <label>
                NEXORA ID
                <input
                  required
                  value={nexoraId}
                  onChange={(e) =>
                    setNexoraId(e.target.value.toUpperCase())
                  }
                  placeholder="NXR-XXXXXXXX"
                  autoComplete="username"
                />
              </label>
            )}

            <label>
              Mot de passe
              <input
                required
                minLength={8}
                maxLength={128}
                type="password"
                value={password}
                onChange={(e) =>
                  setPassword(e.target.value)
                }
                placeholder="8 caractères minimum"
                autoComplete={
                  authMode === "login"
                    ? "current-password"
                    : "new-password"
                }
              />
            </label>

            <button
              className="primary-button"
              type="submit"
              disabled={busy}
            >
              {busy
                ? "Veuillez patienter..."
                : authMode === "login"
                  ? "Se connecter"
                  : "Créer mon compte"}
            </button>
          </form>

          {notice && <p className="notice">{notice}</p>}
          {error && <p className="error">{error}</p>}
        </section>
      </main>
    );
  }

  const selectedName =
    selectedConversation?.participant_display_name ||
    selectedConversation?.title ||
    selectedConversation?.participant_username ||
    "Conversation";

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <header className="sidebar-header">
          <div className="app-brand">
            <span className="brand-mark">N</span>
            <span>NEXORA</span>
          </div>

          <button
            className="icon-button"
            onClick={refresh}
            disabled={busy}
            title="Actualiser"
          >
            <RefreshCw size={18} />
          </button>
        </header>

        <div className="profile-summary">
          <div className="avatar">
            {getInitials(user.display_name)}
          </div>

          <div className="profile-text">
            <strong>{user.display_name}</strong>
            <span>{user.nexora_id}</span>
          </div>

          <button
            className="icon-button"
            onClick={logout}
            title="Déconnexion"
          >
            <LogOut size={18} />
          </button>
        </div>

        <nav className="main-nav">
          {[
            { name: "Discussions" as Section, icon: MessageCircle },
            { name: "Contacts" as Section, icon: Users },
            { name: "Statuts" as Section, icon: CircleDot },
            { name: "Appels" as Section, icon: Phone },
            { name: "Paramètres" as Section, icon: Settings }
          ].map((item) => {
            const Icon = item.icon;

            return (
              <button
                key={item.name}
                className={
                  section === item.name ? "nav-item active" : "nav-item"
                }
                onClick={() => {
                  clearMessages();
                  setSection(item.name);
                  setSelectedConversation(null);
                }}
              >
                <Icon size={19} />
                <span>{item.name}</span>
              </button>
            );
          })}
        </nav>

        <div className="sidebar-content">
          {section === "Discussions" && (
            <>
              <div className="section-heading">
                <h2>Messages</h2>
                <span>{conversations.length}</span>
              </div>

              <div className="search-box">
                <Search size={17} />
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher"
                />
              </div>

              <button
                className="new-contact-button"
                onClick={() => {
                  setSection("Contacts");
                  setFoundUser(null);
                  clearMessages();
                }}
              >
                <Plus size={17} />
                Nouvelle discussion
              </button>

              {filteredConversations.map((conversation) => (
                <button
                  key={conversation.conversation_id}
                  className={
                    selectedConversation?.conversation_id ===
                    conversation.conversation_id
                      ? "conversation-item active"
                      : "conversation-item"
                  }
                  onClick={() =>
                    openConversation(conversation)
                  }
                >
                  <div className="avatar">
                    {getInitials(
                      conversation.participant_display_name ||
                        conversation.title
                    )}
                  </div>

                  <div className="conversation-info">
                    <div className="conversation-top">
                      <strong>
                        {conversation.participant_display_name ||
                          conversation.title ||
                          conversation.participant_username ||
                          "Conversation"}
                      </strong>
                      <time>
                        {formatTime(conversation.last_message_at)}
                      </time>
                    </div>

                    <p>
                      {conversation.last_message ||
                        "Aucun message"}
                    </p>
                  </div>
                </button>
              ))}

              {!filteredConversations.length && (
                <div className="empty-list">
                  Aucune conversation.
                </div>
              )}
            </>
          )}

          {section === "Contacts" && (
            <>
              <div className="section-heading">
                <h2>Contacts</h2>
                <span>{contacts.length}</span>
              </div>

              <form
                className="contact-search-form"
                onSubmit={searchUser}
              >
                <input
                  value={newContactId}
                  onChange={(e) =>
                    setNewContactId(e.target.value.toUpperCase())
                  }
                  placeholder="NEXORA ID"
                  required
                />

                <button type="submit" disabled={busy}>
                  <Search size={18} />
                </button>
              </form>

              {foundUser && (
                <div className="found-user">
                  <div className="avatar">
                    {getInitials(foundUser.display_name)}
                  </div>

                  <div className="found-user-info">
                    <strong>{foundUser.display_name}</strong>
                    <span>{foundUser.nexora_id}</span>
                  </div>

                  <button
                    className="primary-small"
                    onClick={addContact}
                    disabled={busy}
                  >
                    {busy ? "..." : "Ajouter"}
                  </button>
                </div>
              )}

              {filteredContacts.map((contact) => (
                <button
                  key={contact.nexora_id}
                  className="contact-item"
                  onClick={() => {
                    setNewContactId(contact.nexora_id);
                    setFoundUser(contact);
                  }}
                >
                  <div className="avatar">
                    {getInitials(contact.display_name)}
                  </div>

                  <div className="conversation-info">
                    <strong>{contact.display_name}</strong>
                    <p>{contact.nexora_id}</p>
                  </div>
                </button>
              ))}

              {!filteredContacts.length && (
                <div className="empty-list">
                  Aucun contact enregistré.
                </div>
              )}
            </>
          )}

          {section === "Statuts" && (
            <div className="placeholder-section">
              <CircleDot size={30} />
              <h2>Statuts</h2>
              <p>
                La publication et la consultation des statuts
                seront disponibles après le branchement complet
                du module.
              </p>
            </div>
          )}

          {section === "Appels" && (
            <div className="placeholder-section">
              <Phone size={30} />
              <h2>Appels</h2>
              <p>
                Le module d'appels nécessite encore la
                configuration de la signalisation et du média.
              </p>
            </div>
          )}

          {section === "Paramètres" && (
            <div className="placeholder-section">
              <Settings size={30} />
              <h2>Paramètres</h2>
              <p>
                Connecté sous {user.nexora_id}.
              </p>
              <button
                className="secondary-button"
                onClick={logout}
              >
                <LogOut size={17} />
                Se déconnecter
              </button>
            </div>
          )}
        </div>
      </aside>

      <section className="chat-panel">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <button
                className="icon-button mobile-back"
                onClick={() => setSelectedConversation(null)}
              >
                <ArrowLeft size={20} />
              </button>

              <div className="avatar">
                {getInitials(selectedName)}
              </div>

              <div className="chat-header-info">
                <strong>{selectedName}</strong>
                <span>
                  {selectedConversation.participant_nexora_id ||
                    "Conversation privée"}
                </span>
              </div>
            </header>

            <div className="messages-area">
              {messagesLoading ? (
                <div className="empty-state">
                  Chargement des messages...
                </div>
              ) : messages.length ? (
                messages.map((message) => {
                  const ownMessage =
                    message.sender_id === user.id;

                  return (
                    <div
                      key={message.id}
                      className={
                        ownMessage
                          ? "message-row own"
                          : "message-row"
                      }
                    >
                      <div className="message-bubble">
                        <p>
                          {message.deleted_at
                            ? "Message supprimé"
                            : message.content}
                        </p>

                        <time>
                          {formatTime(message.created_at)}
                        </time>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="empty-state">
                  <div className="empty-state-icon">
                    <MessageCircle size={30} />
                  </div>
                  <h2>Votre conversation</h2>
                  <p>
                    Envoyez votre premier message.
                  </p>
                </div>
              )}
            </div>

            <form
              className="message-composer"
              onSubmit={sendMessage}
            >
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Écrire un message..."
                maxLength={10000}
              />

              <button
                type="submit"
                disabled={!draft.trim() || sending}
                title="Envoyer"
              >
                <Send size={19} />
              </button>
            </form>
          </>
        ) : (
          <div className="welcome-panel">
            <div className="welcome-logo">N</div>
            <h1>NEXORA</h1>
            <p>
              Vos conversations, vos contacts, votre espace.
            </p>
            <span>
              Sélectionnez une discussion pour commencer.
            </span>
          </div>
        )}

        {notice && (
          <div className="toast notice">
            {notice}
            <button onClick={() => setNotice("")}>
              <X size={15} />
            </button>
          </div>
        )}

        {error && (
          <div className="toast error">
            {error}
            <button onClick={() => setError("")}>
              <X size={15} />
            </button>
          </div>
        )}

        {loading && (
          <div className="loading-indicator">
            Chargement de NEXORA...
          </div>
        )}
      </section>
    </main>
  );
}
