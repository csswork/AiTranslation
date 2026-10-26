-- 扩展来源：记录请求来自哪个商店的扩展（Chrome、Edge 各有自己的扩展 ID），供管理端区分浏览器。
-- 扩展 ID 是商店公开的渠道标识，不是用户或设备标识。迁移前的记录无法判断来源，保持为空。

-- 每次安装（访客领取）来自哪个扩展。
ALTER TABLE guest_claims ADD COLUMN extension_id text CHECK (extension_id ~ '^[a-p]{32}$');
CREATE INDEX guest_claims_extension ON guest_claims (extension_id, created_at DESC) WHERE extension_id IS NOT NULL;

-- 账户用过哪些扩展：建立扩展会话（访客领取或扩展登录）时写入。扩展会话退出后会删除，所以单独保存首次与最近时间。
CREATE TABLE user_extensions (
  user_id       uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  extension_id  text NOT NULL CHECK (extension_id ~ '^[a-p]{32}$'),
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, extension_id)
);
