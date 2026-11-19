-- 旧授权只覆盖扩展主动分享的记录。查看现有托管请求的统计需要用户重新确认范围。
ALTER TABLE feature_usage_shares ADD COLUMN request_counts boolean NOT NULL DEFAULT false;
