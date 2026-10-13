-- 用户管理界面第一批：账号、登录方式、邮箱验证码、会话与试用点数账本。
-- 账号资料只保留 email 和 username；第三方返回的姓名、头像等资料不建字段。

CREATE TABLE users (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email             text NOT NULL UNIQUE CHECK (email = lower(email)),
  username          text NOT NULL UNIQUE CHECK (username ~ '^[a-z0-9_-]{3,24}$'),
  email_verified_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 第三方登录绑定：只保存平台名和平台内的用户标识（如 Google 的 sub）。
CREATE TABLE identities (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  provider   text NOT NULL CHECK (provider IN ('google')),
  subject    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, subject),
  UNIQUE (user_id, provider)
);

-- 验证码只存 HMAC，不存明文；用过、过期或尝试次数用尽即作废。
CREATE TABLE email_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  purpose     text NOT NULL CHECK (purpose IN ('login', 'change_email')),
  user_id     uuid REFERENCES users (id) ON DELETE CASCADE,
  code_hash   text NOT NULL,
  attempts    integer NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX email_codes_lookup ON email_codes (email, purpose, created_at DESC);

-- 会话令牌只存 SHA-256；不记录设备型号、位置或设备指纹。
CREATE TABLE sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  client       text NOT NULL CHECK (client IN ('web', 'extension')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);
CREATE INDEX sessions_user ON sessions (user_id);

-- 点数账本：只追加。idempotency_key 保证同一笔发放不会重复入账，
-- 例如每个账号只有一条 trial:<user_id>，绑定新的登录方式不会再领试用。
CREATE TABLE credit_ledger (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  entry_type      text NOT NULL CHECK (entry_type IN ('trial_grant')),
  amount          integer NOT NULL,
  expires_at      timestamptz,
  idempotency_key text NOT NULL UNIQUE,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_ledger_user ON credit_ledger (user_id, created_at DESC);
