-- 被拒绝的托管请求：点数不足、冻结、超长、过频、超过订阅用户月度上限、服务停用。
-- 没有调用模型、不扣点；只记录用户、原因和元数据（字数、语言、国家），不保存原文。
-- 与 usage_events 分开存放，原有的请求、成本与月度用量统计不受影响。
CREATE TABLE usage_rejections (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  reason      text NOT NULL CHECK (reason IN ('insufficient_credits', 'frozen', 'too_long', 'rate_limited', 'fair_use', 'hosted_unavailable')),
  audience    text CHECK (audience IN ('guest', 'member', 'subscriber')),
  chars       integer NOT NULL DEFAULT 0 CHECK (chars >= 0),
  cost        integer,
  target_lang text,
  country     text CHECK (country ~ '^[A-Z]{2}$'),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX usage_rejections_user ON usage_rejections (user_id, created_at DESC);
CREATE INDEX usage_rejections_created ON usage_rejections (created_at DESC);
