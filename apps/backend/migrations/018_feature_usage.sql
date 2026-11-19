ALTER TABLE usage_events DROP CONSTRAINT usage_events_surface_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_surface_check
  CHECK (surface IN ('selection', 'panel', 'page', 'site', 'image', 'pdf', 'reader', 'subtitle', 'alternatives'));
ALTER TABLE usage_events ADD COLUMN count_feature_use boolean NOT NULL DEFAULT false;
CREATE INDEX usage_events_counted_feature ON usage_events (created_at DESC)
  WHERE count_feature_use AND status = 'ok';

-- 用户明确授权支持人员查看一个固定报告期间。统计从原有请求记录计算。
CREATE TABLE feature_usage_shares (
  user_id uuid PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  end_day date NOT NULL,
  time_zone text NOT NULL,
  expires_at timestamptz NOT NULL
);
