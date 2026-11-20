CREATE TABLE calls (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  UUID NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  caller_id        UUID NOT NULL REFERENCES users(id),
  callee_id        UUID NOT NULL REFERENCES users(id),
  type             VARCHAR(10) NOT NULL CHECK (type IN ('audio', 'video')),
  status           VARCHAR(10) NOT NULL DEFAULT 'ringing'
                   CHECK (status IN ('ringing', 'accepted', 'ended', 'rejected', 'missed', 'cancelled', 'busy')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  answered_at      TIMESTAMPTZ,
  ended_at         TIMESTAMPTZ
);
CREATE INDEX idx_calls_conversation ON calls(conversation_id, started_at DESC);

-- Tin nhan co 3 loai: van ban, hinh anh (kem chu thich tuy chon) va ban ghi cuoc goi.
ALTER TABLE messages
  ADD COLUMN type VARCHAR(10) NOT NULL DEFAULT 'text' CHECK (type IN ('text', 'image', 'call')),
  ADD COLUMN call_id UUID REFERENCES calls(id);
ALTER TABLE messages DROP CONSTRAINT messages_content_check;
ALTER TABLE messages ADD CONSTRAINT messages_content_check
  CHECK (length(content) <= 4000 AND (type <> 'text' OR length(btrim(content)) >= 1));

CREATE TABLE attachments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  message_id     BIGINT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
  -- Ten file tren dia do server sinh ra, khong dung ten nguoi dung gui len.
  storage_key    VARCHAR(100) NOT NULL UNIQUE,
  original_name  VARCHAR(255) NOT NULL DEFAULT '',
  mime_type      VARCHAR(50) NOT NULL,
  size_bytes     INTEGER NOT NULL CHECK (size_bytes > 0),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
