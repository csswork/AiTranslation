-- 被拒绝的托管请求也记录功能类别，功能统计据此计入「想用但被拒」的需求；旧记录为空。
ALTER TABLE usage_rejections ADD COLUMN surface text
  CHECK (surface IN ('selection', 'panel', 'page', 'site', 'image', 'pdf', 'reader', 'subtitle', 'alternatives'));
