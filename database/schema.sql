
PRAGMA foreign_keys = ON;

-- =====================================
-- 1. UTILISATEURS ET PROFILS
-- =====================================

CREATE TABLE IF NOT EXISTS profiles (
  id TEXT PRIMARY KEY,
  nexora_id TEXT NOT NULL UNIQUE,
  username TEXT NOT NULL,
  display_name TEXT NOT NULL,
  avatar_url TEXT,
  bio TEXT DEFAULT '',
  status_text TEXT DEFAULT '',
  is_online INTEGER DEFAULT 0,
  last_seen TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_profiles_username
ON profiles(username);

CREATE INDEX IF NOT EXISTS idx_profiles_display_name
ON profiles(display_name);

-- =====================================
-- 2. IDENTIFIANTS DE CONNEXION
-- =====================================

CREATE TABLE IF NOT EXISTS credentials (
  user_id TEXT PRIMARY KEY,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================
-- 3. SESSIONS
-- =====================================

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_sessions_user
ON sessions(user_id);

-- =====================================
-- 4. CONVERSATIONS
-- =====================================

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL DEFAULT 'direct',
  title TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by)
    REFERENCES profiles(id)
);

-- =====================================
-- 5. MEMBRES DES CONVERSATIONS
-- =====================================

CREATE TABLE IF NOT EXISTS conversation_members (
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT DEFAULT 'member',
  joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_members_user
ON conversation_members(user_id);

-- =====================================
-- 6. MESSAGES
-- =====================================

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,
  content TEXT,
  message_type TEXT DEFAULT 'text',
  reply_to TEXT,
  edited_at TEXT,
  deleted_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id)
    REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id)
    REFERENCES profiles(id),
  FOREIGN KEY (reply_to)
    REFERENCES messages(id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation
ON messages(conversation_id, created_at);

-- =====================================
-- 7. CONTACTS
-- =====================================

CREATE TABLE IF NOT EXISTS contacts (
  user_id TEXT NOT NULL,
  contact_user_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id, contact_user_id),
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================
-- 8. BLOQUAGES
-- =====================================

CREATE TABLE IF NOT EXISTS blocks (
  blocker_id TEXT NOT NULL,
  blocked_id TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id)
    REFERENCES profiles(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================
-- 9. STATUTS
-- =====================================

CREATE TABLE IF NOT EXISTS statuses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  media_url TEXT,
  caption TEXT,
  media_type TEXT DEFAULT 'text',
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================
-- 10. VUES DES STATUTS
-- =====================================

CREATE TABLE IF NOT EXISTS status_views (
  status_id TEXT NOT NULL,
  viewer_id TEXT NOT NULL,
  viewed_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (status_id, viewer_id),
  FOREIGN KEY (status_id)
    REFERENCES statuses(id) ON DELETE CASCADE,
  FOREIGN KEY (viewer_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================
-- 11. REACTIONS AUX MESSAGES
-- =====================================

CREATE TABLE IF NOT EXISTS message_reactions (
  message_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  reaction TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (message_id, user_id),
  FOREIGN KEY (message_id)
    REFERENCES messages(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

-- =====================================
-- 12. NOTIFICATIONS
-- =====================================

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  content TEXT NOT NULL,
  read_at TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id)
    REFERENCES profiles(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_notifications_user
ON notifications(user_id, created_at);

-- =====================================
-- 13. SIGNALEMENTS
-- =====================================

CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY,
  reporter_id TEXT NOT NULL,
  reported_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  details TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (reporter_id)
    REFERENCES profiles(id),
  FOREIGN KEY (reported_user_id)
    REFERENCES profiles(id)
);

-- =====================================
-- FIN DU SCHEMA NEXORA PRO
-- =====================================
