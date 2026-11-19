-- 请求的客户端维度：浏览器家族、主版本与系统家族。
-- 只保存低基数枚举，不保存原始 User-Agent；用于兼容性排查和服务统计，不作为设备指纹或安全依据。
ALTER TABLE usage_events ADD COLUMN browser text CHECK (browser IN ('chrome', 'edge', 'firefox', 'other'));
ALTER TABLE usage_events ADD COLUMN browser_major smallint CHECK (browser_major BETWEEN 1 AND 999);
ALTER TABLE usage_events ADD COLUMN os text CHECK (os IN ('windows', 'macos', 'linux', 'chromeos', 'other'));
CREATE INDEX usage_events_client ON usage_events (created_at DESC) WHERE browser IS NOT NULL;

ALTER TABLE guest_claims ADD COLUMN browser text CHECK (browser IN ('chrome', 'edge', 'firefox', 'other'));
ALTER TABLE guest_claims ADD COLUMN browser_major smallint CHECK (browser_major BETWEEN 1 AND 999);
ALTER TABLE guest_claims ADD COLUMN os text CHECK (os IN ('windows', 'macos', 'linux', 'chromeos', 'other'));
