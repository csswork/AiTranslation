-- 托管功能统计直接按已有成功请求查询，不再需要本人授权；移除授权表与旧的客户端标记列。
DROP TABLE IF EXISTS feature_usage_shares;
DROP INDEX IF EXISTS usage_events_counted_feature;
ALTER TABLE usage_events DROP COLUMN IF EXISTS count_feature_use;
