-- 扩展登录（一次性授权码 + PKCE）与托管文字翻译的点数扣减。

-- 扩展授权码：只存哈希，2 分钟有效，只能兑换一次；兑换时校验 PKCE 与回调地址。
CREATE TABLE extension_auth_codes (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash      text NOT NULL UNIQUE,
  user_id        uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  redirect_uri   text NOT NULL,
  code_challenge text NOT NULL,
  expires_at     timestamptz NOT NULL,
  used_at        timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- 托管请求的计费元数据：类型、字数、扣点和结果，不保存原文或译文。
CREATE TABLE usage_events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('text')),
  chars      integer NOT NULL CHECK (chars >= 0),
  cost       integer NOT NULL CHECK (cost >= 0),
  status     text NOT NULL CHECK (status IN ('pending', 'ok', 'failed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_events_user ON usage_events (user_id, created_at DESC);

-- 扣点记在具体某笔发放上（grant_id），发放过期后它剩余的点数随之失效，余额不会变成负数。
-- 预扣（usage）为负数；托管请求失败时按原扣点写入等额返还（refund）。
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_entry_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_entry_type_check
  CHECK (entry_type IN ('trial_grant', 'usage', 'refund'));
ALTER TABLE credit_ledger ADD COLUMN grant_id uuid REFERENCES credit_ledger (id) ON DELETE CASCADE;
ALTER TABLE credit_ledger ADD COLUMN usage_event_id uuid REFERENCES usage_events (id) ON DELETE SET NULL;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_debit_has_grant
  CHECK ((entry_type IN ('usage', 'refund')) = (grant_id IS NOT NULL));
CREATE INDEX credit_ledger_grant ON credit_ledger (grant_id);
