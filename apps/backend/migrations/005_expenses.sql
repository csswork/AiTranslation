-- 支出（管理员录入，A2 收支报表）：服务器、域名、发信、营销、模型 API 账单等。
-- 一次性支出记在 start_date 当天；按月 / 按年循环的支出按天分摊到报表周期（从 start_date 起，到 end_date 为止，未设则持续）。
-- 金额以美元分为单位，与收入同一币种口径；删除只做标记，保留审计。
CREATE TABLE expenses (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category     text NOT NULL CHECK (category IN ('server', 'domain', 'mail', 'model_api', 'payment', 'marketing', 'tools', 'other')),
  amount_cents integer NOT NULL CHECK (amount_cents > 0),
  recurring    text NOT NULL DEFAULT 'none' CHECK (recurring IN ('none', 'monthly', 'yearly')),
  start_date   date NOT NULL,
  end_date     date CHECK (end_date IS NULL OR end_date >= start_date),
  note         text,
  created_by   uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  deleted_at   timestamptz
);
CREATE INDEX expenses_dates ON expenses (start_date, end_date) WHERE deleted_at IS NULL;
