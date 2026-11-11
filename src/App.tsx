
import { useCallback, useEffect, useMemo, useState } from "react";
import type { FormEvent } from "react";
import {
  MessageCircle, Users, CircleDot, Phone, Settings, Search,
  LogOut, RefreshCw, ShieldCheck, X, ArrowLeft, Send
} from "lucide-react";

type User = {
  id?: string;
  nexora_id: string;
  username: string;
  display_name: string;
};

type Contact = User & {
  avatar_url?: string | null;
  is_online?: number | boolean;
};

type Conversation = {
  conversation_id: string;
  type: string;
  title?: string | null;
  participant_nexora_id?: string | null;
  participant_username?: string | null;
  participant_display_name?: string | null;
  last_message?: string | null;
  last_message_at?: string | null;
};

type Message = {
  id: string;
  conversation_id: string;
  sender_id: string;
  content: string;
  message_type: string;
  reply_to: string | null;
  edited_at: string | null;
  deleted_at: string | null;
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
      "Adresse API non configurée. Ajoute VITE_API_URL dans les variables Vercel."
    );
  }

  const response = await fetch(API_URL + path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.error || "Une erreur est survenue.");
  }

  return data as T;
}

function initials(value: string) {
  return value.trim().slice(0, 1).toUpperCase() || "N";
}

function formatMessageTime(value?: string | null) {
  if (!value) return "";

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) return "";

  return date.toLocaleTimeString("fr-FR", {
    hour: "2-digit",
    minute: "2-digit"
  });
}

export default function App() {
  const [token, setToken] = useState(
    () => localStorage.getItem(TOKEN_KEY) || ""
  );

  const [user, setUser] = useState<User | null>(null);

  const [authMode, setAuthMode] = useState<"login" | "register">(
    "login"
  );

  const [nexoraId, setNexoraId] = useState("");
  const [username, setUsername] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");

  const [section, setSection] = useState<Section>("Discussions");

  const [contacts, setContacts] = useState<Contact[]>([]);
  const [conversations, setConversations] = useState<Conversation[]>([]);

  const [selectedConversation, setSelectedConversation] =
    useState<Conversation | null>(null);

  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState("");

  const [messagesLoading, setMessagesLoading] = useState(false);
  const [sending, setSending] = useState(false);

  const [search, setSearch] = useState("");
  const [newContactId, setNewContactId] = useState("");
  const [foundUser, setFoundUser] = useState<User | null>(null);

  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);

  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");

  const clearMessages = () => {
    setError("");
    setNotice("");
  };

  const loadWorkspace = useCallback(async (session: string) => {
    const [me, contactData, conversationData] = await Promise.all([
      api<{ user: User }>("/api/auth/me", session),
      api<{ contacts: Contact[] }>("/api/contacts", session),
      api<{ conversations: Conversation[] }>("/api/conversations", session)
    ]);

    setUser(me.user);
    setContacts(contactData.contacts || []);
    setConversations(conversationData.conversations || []);
  }, []);

  const loadConversationMessages = useCallback(
    async (conversationId: string, session: string) => {
      return api<{ success: boolean; messages: Message[] }>(
        "/api/messages?conversation_id=" +
          encodeURIComponent(conversationId),
        session
      );
    },
    []
  );

  // Charger les vrais messages quand une conversation est ouverte.
  useEffect(() => {
    const conversationId = selectedConversation?.conversation_id;

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
        if (!cancelled) {
          setError(e.message);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setMessagesLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    token,
    selectedConversation?.conversation_id,
    loadConversationMessages
  ]);

  // Récupérer le compte et les données réelles à la connexion.
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

  const filteredConversations = useMemo(() => {
    const q = search.trim().toLowerCase();

    return conversations.filter((c) =>
      [
        c.participant_display_name,
        c.participant_username,
        c.participant_nexora_id,
        c.last_message
      ].some((value) =>
        (value || "").toLowerCase().includes(q)
      )
    );
  }, [conversations, search]);

  const filteredContacts = useMemo(() => {
    const q = search.trim().toLowerCase();

    return contacts.filter((c) =>
      [c.display_name, c.username, c.nexora_id].some((value) =>
        value.toLowerCase().includes(q)
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
    if (!token) return;

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
        message: Message;
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
          result.message
        ]);
      } else {
        const updated = await loadConversationMessages(
          conversation.conversation_id,
          token
        );

        setMessages(updated.messages || []);
      }

      setDraft("");

      // Mettre à jour le dernier message dans la liste.
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
          encodeURIComponent(newContactId.trim().toUpperCase()),
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

  async function addContact() {
    if (!foundUser) return;

    clearMessages();
    setBusy(true);

    try {
      await api("/api/contacts", token, {
        method: "POST",
        body: JSON.stringify({
          nexora_id: foundUser.nexora_id
        })
      });

      const conversationResult = await api<{
        conversation?: Conversation;
      }>("/api/conversations/private", token, {
        method: "POST",
        body: JSON.stringify({
          nexora_id: foundUser.nexora_id
        })
      });

      await loadWorkspace(token);

      setFoundUser(null);
      setNewContactId("");
      setSection("Discussions");

      if (conversationResult.conversation) {
        openConversation(conversationResult.conversation);
      }

      setNotice("Contact ajouté.");
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
      // La déconnexion locale reste possible.
    }

    localStorage.removeItem(TOKEN_KEY);
    setToken("");
    setUser(null);
    setContacts([]);
    setConversations([]);
    setMessages([]);
    setSelectedConversation(null);
    setSection("Discussions");
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
                    pattern="[A-Za-z0-9_]+"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Votre_pseudo"
                  />
                </label>

                <label>
                  Nom affiché
                  <input
                    required
                    maxLength={40}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
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
                />
              </label>
            )}

            <label>
              Mot de passe
              <input
                required
                minLength={authMode === "register" ? 8 : 1}
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Mot de passe"
              />
            </label>

            {error && (
              <p className="feedback error">{error}</p>
            )}

            {notice && (
              <p className="feedback success">{notice}</p>
            )}

            <button className="primary-btn" disabled={busy}>
              {busy
                ? "Veuillez patienter…"
                : authMode === "login"
                  ? "Se connecter"
                  : "Créer mon compte"}
            </button>
          </form>

          <p className="auth-foot">
            Aucun contact ni message fictif.
          </p>
        </section>

        <span className="version-label">
          NEXORA PRO · ESPACE SÉCURISÉ
        </span>
      </main>
    );
  }

  const navItems = [
    { label: "Discussions" as Section, icon: MessageCircle },
    { label: "Contacts" as Section, icon: Users },
    { label: "Statuts" as Section, icon: CircleDot },
    { label: "Appels" as Section, icon: Phone },
    { label: "Paramètres" as Section, icon: Settings }
  ];

  const conversationTitle = selectedConversation
    ? selectedConversation.participant_display_name ||
      selectedConversation.title ||
      selectedConversation.participant_username ||
      selectedConversation.participant_nexora_id ||
      "Conversation"
    : "";

  return (
    <main
      className={
        selectedConversation
          ? "app-shell chat-open"
          : "app-shell"
      }
    >
      <aside className="rail">
        <div className="brand-mark">N</div>

        <nav className="rail-nav">
          {navItems.map(({ label, icon: Icon }) => (
            <button
              type="button"
              key={label}
              className={
                section === label ? "rail-item active" : "rail-item"
              }
              onClick={() => {
                setSection(label);
                if (label !== "Discussions") {
                  setSelectedConversation(null);
                }
              }}
              title={label}
            >
              <Icon size={20} />
              <span>{label}</span>
            </button>
          ))}
        </nav>

        <button
          type="button"
          className="rail-profile"
          onClick={() => {
            setSection("Paramètres");
            setSelectedConversation(null);
          }}
          title="Mon profil"
        >
          {initials(user.display_name)}
        </button>
      </aside>

      <section className="list-panel">
        <header className="panel-header">
          <div>
            <div className="eyebrow">ESPACE PERSONNEL</div>
            <h1>{section}</h1>
          </div>

          <button
            type="button"
            className="icon-btn"
            onClick={refresh}
            disabled={busy}
            title="Actualiser"
          >
            <RefreshCw size={18} />
          </button>
        </header>

        {section !== "Paramètres" &&
          section !== "Statuts" &&
          section !== "Appels" && (
            <div className="search-box">
              <Search size={17} />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Rechercher"
              />
            </div>
          )}

        {section === "Discussions" && (
          <>
            <div className="section-caption">
              MES CONVERSATIONS
            </div>

            {loading ? (
              <div className="empty-state">Chargement…</div>
            ) : filteredConversations.length === 0 ? (
              <div className="empty-state">
                <MessageCircle size={28} />
                <strong>Aucune discussion</strong>
                <span>
                  Ajoute un contact avec son NEXORA ID pour commencer.
                </span>
                <button
                  type="button"
                  className="text-action"
                  onClick={() => setSection("Contacts")}
                >
                  Ajouter un contact
                </button>
              </div>
            ) : (
              filteredConversations.map((c) => (
                <button
                  type="button"
                  className={
                    selectedConversation?.conversation_id ===
                    c.conversation_id
                      ? "list-entry conversation-entry selected"
                      : "list-entry conversation-entry"
                  }
                  key={c.conversation_id}
                  onClick={() => openConversation(c)}
                >
                  <span className="avatar">
                    {initials(
                      c.participant_display_name ||
                        c.participant_username ||
                        "N"
                    )}
                  </span>

                  <span className="entry-copy">
                    <strong>
                      {c.participant_display_name ||
                        c.title ||
                        "Conversation"}
                    </strong>
                    <span>
                      {c.last_message ||
                        c.participant_nexora_id ||
                        "Aucun message"}
                    </span>
                  </span>

                  <span className="entry-time">
                    {c.last_message_at
                      ? new Date(c.last_message_at).toLocaleDateString(
                          "fr-FR"
                        )
                      : ""}
                  </span>
                </button>
              ))
            )}
          </>
        )}

        {section === "Contacts" && (
          <>
            <div className="section-caption">
              AJOUTER UN UTILISATEUR
            </div>

            <form className="add-contact-form" onSubmit={searchUser}>
              <label htmlFor="contact-id">NEXORA ID</label>

              <div className="inline-field">
                <input
                  id="contact-id"
                  value={newContactId}
                  onChange={(e) =>
                    setNewContactId(e.target.value.toUpperCase())
                  }
                  placeholder="NXR-XXXXXXXX"
                />

                <button
                  disabled={busy || !newContactId.trim()}
                  aria-label="Rechercher un utilisateur"
                >
                  <Search size={17} />
                </button>
              </div>
            </form>

            {foundUser && (
              <div className="found-user">
                <div className="avatar">
                  {initials(foundUser.display_name)}
                </div>

                <div className="entry-copy">
                  <strong>{foundUser.display_name}</strong>
                  <span>@{foundUser.username}</span>
                  <span>{foundUser.nexora_id}</span>
                </div>

                <button
                  type="button"
                  className="primary-small"
                  onClick={addContact}
                  disabled={busy}
                >
                  Ajouter
                </button>
              </div>
            )}

            <div className="section-caption">
              MES CONTACTS · {contacts.length}
            </div>

            {filteredContacts.length === 0 ? (
              <div className="empty-state">
                <Users size={26} />
                <strong>Aucun contact enregistré</strong>
                <span>
                  Les comptes réels apparaîtront ici après leur ajout.
                </span>
              </div>
            ) : (
              filteredContacts.map((c) => (
                <div className="list-entry" key={c.nexora_id}>
                  <div className="avatar">
                    {initials(c.display_name)}
                  </div>

                  <div className="entry-copy">
                    <strong>{c.display_name}</strong>
                    <span>@{c.username}</span>
                    <span>{c.nexora_id}</span>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {section === "Statuts" && (
          <div className="empty-state">
            <CircleDot size={28} />
            <strong>Statuts</strong>
            <span>Aucun statut disponible.</span>
          </div>
        )}

        {section === "Appels" && (
          <div className="empty-state">
            <Phone size={28} />
            <strong>Appels</strong>
            <span>
              Le système d'appels audio et vidéo n'est pas encore
              opérationnel.
            </span>
          </div>
        )}

        {section === "Paramètres" && (
          <div className="settings-card">
            <div className="avatar large">
              {initials(user.display_name)}
            </div>

            <h2>{user.display_name}</h2>
            <p>@{user.username}</p>

            <div className="id-box">
              <span>VOTRE NEXORA ID</span>
              <strong>{user.nexora_id}</strong>
            </div>

            <button
              type="button"
              className="logout-btn"
              onClick={logout}
            >
              <LogOut size={17} />
              Se déconnecter
            </button>
          </div>
        )}
      </section>

      <section className="workspace">
        {selectedConversation ? (
          <>
            <header className="chat-header">
              <button
                type="button"
                className="chat-back"
                onClick={() => setSelectedConversation(null)}
                aria-label="Retour aux discussions"
              >
                <ArrowLeft size={19} />
              </button>

              <div className="avatar">
                {initials(conversationTitle)}
              </div>

              <div className="chat-header-copy">
                <strong>{conversationTitle}</strong>
                <span>
                  {selectedConversation.participant_nexora_id ||
                    "Conversation privée"}
                </span>
              </div>

              <button
                type="button"
                className="icon-btn"
                onClick={refresh}
                disabled={busy || messagesLoading}
                title="Actualiser les messages"
              >
                <RefreshCw size={17} />
              </button>
            </header>

            <div className="message-list">
              {messagesLoading ? (
                <div className="empty-state">
                  Chargement des messages…
                </div>
              ) : messages.length === 0 ? (
                <div className="empty-state chat-empty">
                  <MessageCircle size={28} />
                  <strong>Aucun message</strong>
                  <span>
                    Cette conversation est vide. Envoie le premier
                    message.
                  </span>
                </div>
              ) : (
                messages.map((message) => {
                  const ownMessage =
                    Boolean(user.id) && message.sender_id === user.id;

                  return (
                    <div
                      key={message.id}
                      className={
                        ownMessage
                          ? "message-row own"
                          : "message-row received"
                      }
                    >
                      <div className="message-bubble">
                        <p>{message.content}</p>
                        <span className="message-time">
                          {message.edited_at ? "Modifié · " : ""}
                          {formatMessageTime(message.created_at)}
                        </span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <form className="message-composer" onSubmit={sendMessage}>
              <input
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Écrire un message…"
                maxLength={10000}
                disabled={sending}
                aria-label="Votre message"
              />

              <button
                type="submit"
                disabled={!draft.trim() || sending}
                aria-label="Envoyer le message"
              >
                <Send size={18} />
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="workspace-top">
              <div className="workspace-logo">N</div>
              <div>
                <strong>NEXORA PRO</strong>
                <span>Messagerie personnelle</span>
              </div>
            </div>

            <div className="workspace-center">
              <div className="workspace-emblem">N</div>
              <h2>Votre espace de discussion</h2>
              <p>
                Sélectionne une conversation pour afficher les messages.
              </p>
              <span>
                Connecté en tant que {user.display_name}
              </span>
            </div>
          </>
        )}

        {(error || notice) && (
          <div className={error ? "toast error" : "toast"}>
            {error || notice}
            <button type="button" onClick={clearMessages}>
              <X size={15} />
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
