-- 访客试用、订阅收款（Creem）、可调运营规则、托管用量统计与管理员界面。

-- 访客账户：扩展安装后自动创建，没有邮箱，只能通过扩展会话使用；注册或登录时合并进正式账户。
ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ADD COLUMN kind text NOT NULL DEFAULT 'member' CHECK (kind IN ('guest', 'member'));
ALTER TABLE users ADD CONSTRAINT users_member_has_email CHECK ((kind = 'member') = (email IS NOT NULL));
-- 管理员冻结托管服务（A3）：冻结后托管请求被拒绝，账户本身仍可登录。
ALTER TABLE users ADD COLUMN hosted_frozen_at timestamptz;

-- 试用点数不再过期。
UPDATE credit_ledger SET expires_at = NULL WHERE entry_type = 'trial_grant';

-- 点数类型：guest_grant 访客赠送、transfer 访客合并转入、adjust 管理员补发（正数，附原因）、
-- void 作废某笔发放的剩余点数（负数，记在该发放上）。
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_entry_type_check;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_entry_type_check
  CHECK (entry_type IN ('trial_grant', 'guest_grant', 'transfer', 'adjust', 'usage', 'refund', 'void'));
ALTER TABLE credit_ledger DROP CONSTRAINT credit_ledger_debit_has_grant;
ALTER TABLE credit_ledger ADD CONSTRAINT credit_ledger_debit_has_grant
  CHECK ((entry_type IN ('usage', 'refund', 'void')) = (grant_id IS NOT NULL));
ALTER TABLE credit_ledger ADD COLUMN reason text;

-- 访客领取记录：用于 IP 限频、每日总量和转化统计。IP 只存带密钥的哈希（IPv6 按 /64），不存原文。
-- 访客账户合并或删除后记录仍保留（user_id 置空），merged_user_id 记录转成的正式账户。
CREATE TABLE guest_claims (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid REFERENCES users (id) ON DELETE SET NULL,
  ip_hash        text NOT NULL,
  granted        integer NOT NULL CHECK (granted >= 0),
  -- 'granted' 已发放 | 'ip_limited' 同一网络领取过多 | 'daily_cap' 当日总量已满 | 'reinstall' 同一浏览器重装后接回旧访客
  outcome        text NOT NULL CHECK (outcome IN ('granted', 'ip_limited', 'daily_cap', 'reinstall', 'claimed_member')),
  merged_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX guest_claims_ip ON guest_claims (ip_hash, created_at DESC);
CREATE INDEX guest_claims_created ON guest_claims (created_at DESC);

-- 浏览器标记：欢迎页写入的 HttpOnly Cookie（随机值，只存哈希），扩展卸载后仍在，用来识别重装。
CREATE TABLE browser_marks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  mark_hash    text NOT NULL UNIQUE,
  user_id      uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

-- 欢迎页关联码：访客创建时签发，扩展打开欢迎页时带上，把这个浏览器的 Cookie 与访客账户关联。只存哈希，一次性。
CREATE TABLE guest_link_codes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code_hash  text NOT NULL UNIQUE,
  user_id    uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  used_at    timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 托管请求的统计元数据（不含原文译文）：用户类型、服务商与模型、token、估算成本（百万分之一美元）、耗时、错误码。
ALTER TABLE usage_events ADD COLUMN audience text CHECK (audience IN ('guest', 'member', 'subscriber'));
ALTER TABLE usage_events ADD COLUMN provider text;
ALTER TABLE usage_events ADD COLUMN model text;
ALTER TABLE usage_events ADD COLUMN input_tokens integer;
ALTER TABLE usage_events ADD COLUMN cached_tokens integer;
ALTER TABLE usage_events ADD COLUMN output_tokens integer;
ALTER TABLE usage_events ADD COLUMN cost_micros bigint;
ALTER TABLE usage_events ADD COLUMN latency_ms integer;
ALTER TABLE usage_events ADD COLUMN error text;
CREATE INDEX usage_events_created ON usage_events (created_at DESC);

-- 订阅：以已验签的支付回调为准。只保存支付平台的对象 ID 和状态，不保存姓名、邮箱或卡信息。
CREATE TABLE subscriptions (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid REFERENCES users (id) ON DELETE SET NULL,
  provider                 text NOT NULL CHECK (provider IN ('creem')),
  provider_subscription_id text NOT NULL,
  provider_customer_id     text,
  product_id               text,
  plan                     text CHECK (plan IN ('monthly', 'yearly')),
  status                   text NOT NULL,
  current_period_end       timestamptz,
  canceled_at              timestamptz,
  last_event_at            timestamptz NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);
CREATE INDEX subscriptions_user ON subscriptions (user_id);

-- 订单（付款与退款）：金额为最小货币单位的整数并保留币种；收入统计用，不保存个人资料。
CREATE TABLE orders (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid REFERENCES users (id) ON DELETE SET NULL,
  provider                 text NOT NULL CHECK (provider IN ('creem')),
  provider_order_id        text NOT NULL,
  provider_subscription_id text,
  product_id               text,
  plan                     text CHECK (plan IN ('monthly', 'yearly')),
  amount                   integer NOT NULL,
  currency                 text NOT NULL,
  refunded_amount          integer NOT NULL DEFAULT 0,
  status                   text NOT NULL,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_order_id)
);
CREATE INDEX orders_created ON orders (created_at DESC);
CREATE INDEX orders_user ON orders (user_id);

-- 支付回调事件：按平台事件 ID 去重（幂等），处理失败的留下错误码供管理员排查（A8）。不保存回调原文。
CREATE TABLE payment_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL,
  event_id     text NOT NULL,
  event_type   text NOT NULL,
  object_id    text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  error        text,
  UNIQUE (provider, event_id)
);

-- 可调运营规则（A4、A7）：键值形式，值为 JSON；未设置的键使用环境变量或代码默认值。修改记入审计。
CREATE TABLE app_settings (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL,
  updated_by uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 管理员（A1）：由命令行指定，必须启用 TOTP 二步验证；密钥用 AUTH_SECRET 派生的密钥加密存储。
CREATE TABLE admins (
  user_id          uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  totp_secret      text,
  totp_enabled_at  timestamptz,
  totp_last_step   bigint,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- 管理员会话：独立于用户会话，只用于管理端主机；令牌只存哈希，有效期短。
CREATE TABLE admin_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES admins (user_id) ON DELETE CASCADE,
  token_hash   text NOT NULL UNIQUE,
  verified_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz
);

-- 管理操作审计（A9）：谁、何时、对什么、为什么。
CREATE TABLE admin_audit (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id    uuid REFERENCES users (id) ON DELETE SET NULL,
  action      text NOT NULL,
  target_type text,
  target_id   text,
  reason      text,
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_created ON admin_audit (created_at DESC);

-- 管理端登录使用独立用途的邮箱验证码，与用户端登录的验证码互不通用。
ALTER TABLE email_codes DROP CONSTRAINT email_codes_purpose_check;
ALTER TABLE email_codes ADD CONSTRAINT email_codes_purpose_check CHECK (purpose IN ('login', 'change_email', 'admin_login'));
