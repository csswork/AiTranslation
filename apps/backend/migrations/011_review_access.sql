-- 由运营者在命令行建立的审核专用普通账户；随机凭据只保存 SHA-256。
-- 独立于邮箱验证码，不为普通账户新增密码或验证码例外。
CREATE TABLE review_access (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  credential_hash text NOT NULL UNIQUE CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
