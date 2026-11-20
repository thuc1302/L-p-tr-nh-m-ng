CREATE EXTENSION IF NOT EXISTS citext;

CREATE TABLE users (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email          CITEXT NOT NULL UNIQUE,
  username       CITEXT NOT NULL UNIQUE CHECK (username ~ '^[a-zA-Z0-9_.]{3,30}$'),
  display_name   VARCHAR(60) NOT NULL CHECK (length(btrim(display_name)) > 0),
  password_hash  TEXT NOT NULL,
  bio            VARCHAR(200) NOT NULL DEFAULT '',
  role           VARCHAR(10) NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  status         VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'locked')),
  locked_reason  VARCHAR(300),
  locked_at      TIMESTAMPTZ,
  last_seen_at   TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE user_sessions (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash    CHAR(64) NOT NULL UNIQUE,
  user_agent    VARCHAR(300),
  ip_address    VARCHAR(64),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL,
  revoked_at    TIMESTAMPTZ
);
CREATE INDEX idx_user_sessions_user ON user_sessions(user_id);

CREATE TABLE conversations (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type             VARCHAR(10) NOT NULL DEFAULT 'direct' CHECK (type IN ('direct')),
  -- Hai user_id sap xep tang dan: moi cap nguoi dung chi co mot hoi thoai.
  direct_key       VARCHAR(80) NOT NULL UNIQUE,
  created_by       UUID NOT NULL REFERENCES users(id),
  last_message_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_conversations_created ON conversations(created_at);

CREATE TABLE conversation_members (
  conversation_id            UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  user_id                    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  joined_at                  TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_delivered_message_id  BIGINT NOT NULL DEFAULT 0,
  last_read_message_id       BIGINT NOT NULL DEFAULT 0,
  hidden_at                  TIMESTAMPTZ,
  PRIMARY KEY (conversation_id, user_id)
);
CREATE INDEX idx_members_user ON conversation_members(user_id);

CREATE TABLE messages (
  id                 BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversation_id    UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  sender_id          UUID NOT NULL REFERENCES users(id),
  -- Khoa chong trung: gui lai cung ma nay khong tao them tin nhan.
  client_message_id  UUID NOT NULL,
  content            TEXT NOT NULL CHECK (length(btrim(content)) BETWEEN 1 AND 4000),
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  deleted_at         TIMESTAMPTZ,
  UNIQUE (sender_id, client_message_id)
);
CREATE INDEX idx_messages_conversation ON messages(conversation_id, id DESC);
CREATE INDEX idx_messages_created ON messages(created_at);

CREATE TABLE reports (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id       UUID NOT NULL REFERENCES users(id),
  reported_user_id  UUID NOT NULL REFERENCES users(id),
  conversation_id   UUID NOT NULL REFERENCES conversations(id),
  message_id        BIGINT REFERENCES messages(id),
  -- Ban sao noi dung bi bao cao: admin xu ly ma khong can doc ca hoi thoai.
  message_snapshot  TEXT,
  reason            VARCHAR(20) NOT NULL CHECK (reason IN ('spam', 'harassment', 'scam', 'other')),
  description       VARCHAR(500) NOT NULL DEFAULT '',
  status            VARCHAR(10) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
  resolved_by       UUID REFERENCES users(id),
  resolution_note   VARCHAR(500),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at       TIMESTAMPTZ
);
CREATE INDEX idx_reports_status ON reports(status, created_at DESC);

CREATE TABLE admin_audit_logs (
  id              BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id        UUID NOT NULL REFERENCES users(id),
  action          VARCHAR(30) NOT NULL,
  target_user_id  UUID REFERENCES users(id),
  report_id       UUID REFERENCES reports(id),
  detail          JSONB NOT NULL DEFAULT '{}',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_audit_created ON admin_audit_logs(created_at DESC);
