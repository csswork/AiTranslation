-- 公共商店扩展 ID 只在会话建立或旧会话首次同步时登记。
ALTER TABLE sessions ADD COLUMN extension_id text CHECK (extension_id ~ '^[a-p]{32}$' OR extension_id = 'huaci@huaci.app');
ALTER TABLE sessions ADD COLUMN ext_version text CHECK (ext_version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$');

CREATE TABLE extension_upgrades (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  extension_id text NOT NULL CHECK (extension_id ~ '^[a-p]{32}$' OR extension_id = 'huaci@huaci.app'),
  from_version text NOT NULL CHECK (from_version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$'),
  to_version text NOT NULL CHECK (to_version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$'),
  reported_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX extension_upgrades_reported ON extension_upgrades (reported_at DESC);
CREATE INDEX extension_upgrades_user ON extension_upgrades (user_id);
