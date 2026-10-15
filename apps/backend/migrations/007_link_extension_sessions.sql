-- 扩展会话关联到授权它的网页会话；网页登出只影响这次登录关联的扩展，不退出其他浏览器。
ALTER TABLE sessions ADD COLUMN web_session_id uuid REFERENCES sessions (id) ON DELETE CASCADE;
ALTER TABLE sessions ADD CONSTRAINT sessions_web_parent_is_extension
  CHECK (web_session_id IS NULL OR (client = 'extension' AND web_session_id <> id));
CREATE INDEX sessions_web_session ON sessions (web_session_id) WHERE web_session_id IS NOT NULL;
ALTER TABLE extension_auth_codes ADD COLUMN web_session_id uuid REFERENCES sessions (id) ON DELETE CASCADE;

-- 旧版正式账户的扩展会话无法安全判断属于哪一个浏览器，升级后重新授权一次。
-- 访客会话继续使用，注册合并时再关联到网页会话。
UPDATE sessions SET revoked_at = now()
WHERE client = 'extension' AND revoked_at IS NULL
  AND user_id IN (SELECT id FROM users WHERE kind = 'member');
