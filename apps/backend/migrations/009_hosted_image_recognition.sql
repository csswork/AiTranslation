-- 图片识别单独记录模型用量与成本；识别出的文字走现有文字翻译账本，不重复扣点。
ALTER TABLE usage_events DROP CONSTRAINT usage_events_kind_check;
ALTER TABLE usage_events ADD CONSTRAINT usage_events_kind_check CHECK (kind IN ('text', 'image'));
