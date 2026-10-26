-- 迁移 012 之前没有记录扩展来源。当时扩展只在 Chrome 商店上架，按运营决定把这些历史记录统一归为 Chrome
-- （hogimafgjmlpdlnepojgigjkhaccbcbj）。截止时间取 012 的执行时间，之后的记录由服务端按请求来源写入，不受影响。
WITH cutoff AS (SELECT applied_at FROM schema_migrations WHERE name = '012_extension_source.sql')
UPDATE guest_claims SET extension_id = 'hogimafgjmlpdlnepojgigjkhaccbcbj'
WHERE extension_id IS NULL AND created_at < (SELECT applied_at FROM cutoff);

-- 用过扩展的账户：历史安装对应的访客或转成的正式账户，以及截止前已有扩展会话的账户。
WITH cutoff AS (SELECT applied_at FROM schema_migrations WHERE name = '012_extension_source.sql'),
seen AS (
  SELECT user_id, created_at AS at FROM guest_claims
  WHERE user_id IS NOT NULL AND created_at < (SELECT applied_at FROM cutoff)
  UNION ALL
  SELECT merged_user_id, COALESCE(merged_at, created_at) FROM guest_claims
  WHERE merged_user_id IS NOT NULL AND created_at < (SELECT applied_at FROM cutoff)
  UNION ALL
  SELECT user_id, created_at FROM sessions
  WHERE client = 'extension' AND created_at < (SELECT applied_at FROM cutoff)
  UNION ALL
  SELECT user_id, last_used_at FROM sessions
  WHERE client = 'extension' AND created_at < (SELECT applied_at FROM cutoff)
)
INSERT INTO user_extensions (user_id, extension_id, first_seen_at, last_seen_at)
SELECT user_id, 'hogimafgjmlpdlnepojgigjkhaccbcbj', MIN(at), MAX(at) FROM seen GROUP BY user_id
ON CONFLICT (user_id, extension_id) DO UPDATE SET
  first_seen_at = LEAST(user_extensions.first_seen_at, EXCLUDED.first_seen_at),
  last_seen_at = GREATEST(user_extensions.last_seen_at, EXCLUDED.last_seen_at);
