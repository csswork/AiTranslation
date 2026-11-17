-- 扩展版本：扩展在请求头 X-Huaci-Version 里带上自己的版本号（manifest version），
-- 管理端据此查看用户在用哪个版本、按版本筛选与统计。版本号是公开的发布标识，不是用户或设备标识。
-- user_extensions 每个账户 × 扩展只保留最近看到的版本；last_seen_at 起随扩展请求更新（每小时至多一次）。
ALTER TABLE user_extensions ADD COLUMN version text CHECK (version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$');
ALTER TABLE user_extensions ADD COLUMN version_seen_at timestamptz;

-- 每次托管请求时的扩展版本，用于按版本统计用量与响应速度。旧版扩展不带版本时为空。
ALTER TABLE usage_events ADD COLUMN ext_version text CHECK (ext_version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$');
