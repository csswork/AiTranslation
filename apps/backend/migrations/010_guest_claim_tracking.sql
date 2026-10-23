-- 安装记录追踪：访客合并或删除后 user_id 会被置空，另存原访客 ID、合并时间与实际转入额度，
-- 以及欢迎页识别出的同一浏览器的已有账户（重装接回的旧访客，或已注册的正式账户），供管理端按用户查看安装历史。
-- 这些列都不设外键：引用的账户删除后仍保留 ID 以便追溯。
ALTER TABLE guest_claims ADD COLUMN guest_id uuid;
ALTER TABLE guest_claims ADD COLUMN merged_at timestamptz;
ALTER TABLE guest_claims ADD COLUMN transferred_units bigint CHECK (transferred_units >= 0);
ALTER TABLE guest_claims ADD COLUMN linked_user_id uuid;

UPDATE guest_claims SET guest_id = user_id WHERE user_id IS NOT NULL;

-- 已合并的旧记录：转入流水的幂等键是 transfer:<访客 ID>，与合并在同一事务里写入。
-- 只在某个正式账户的合并记录数与转入流水数相同时按时间先后一一对应补齐，对不上的保持为空。
WITH c AS (
  SELECT id, merged_user_id, ROW_NUMBER() OVER (PARTITION BY merged_user_id ORDER BY created_at) AS n,
         COUNT(*) OVER (PARTITION BY merged_user_id) AS total
  FROM guest_claims WHERE merged_user_id IS NOT NULL AND guest_id IS NULL
), t AS (
  SELECT user_id, substring(idempotency_key FROM 10)::uuid AS guest_id, amount_units, created_at,
         ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at) AS n,
         COUNT(*) OVER (PARTITION BY user_id) AS total
  FROM credit_ledger WHERE entry_type = 'transfer' AND idempotency_key ~ '^transfer:[0-9a-f-]{36}$'
)
UPDATE guest_claims g SET guest_id = t.guest_id, merged_at = t.created_at, transferred_units = t.amount_units
FROM c JOIN t ON t.user_id = c.merged_user_id AND t.n = c.n AND t.total = c.total
WHERE g.id = c.id;

CREATE INDEX guest_claims_merged ON guest_claims (merged_user_id) WHERE merged_user_id IS NOT NULL;
CREATE INDEX guest_claims_guest ON guest_claims (guest_id) WHERE guest_id IS NOT NULL;
CREATE INDEX guest_claims_linked ON guest_claims (linked_user_id) WHERE linked_user_id IS NOT NULL;
