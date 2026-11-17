-- 响应速度拆分：在已有的 latency_ms（模型调用耗时）之外，记录服务端各段耗时与使用场景，
-- 用于按地域、人群与场景定位慢在哪里。只有毫秒数与固定取值，不含内容。
--   precheck_ms  收到请求 → 开始调用模型（鉴权、订阅与额度检查、预扣）
--   ttft_ms      收到请求 → 发出第一段译文（仅流式）
--   server_ms    收到请求 → 响应就绪（不含最后写这条记录本身）
--   stream       是否流式返回
--   surface      扩展里的使用场景；旧版扩展不传时为空
ALTER TABLE usage_events ADD COLUMN precheck_ms integer CHECK (precheck_ms >= 0);
ALTER TABLE usage_events ADD COLUMN ttft_ms integer CHECK (ttft_ms >= 0);
ALTER TABLE usage_events ADD COLUMN server_ms integer CHECK (server_ms >= 0);
ALTER TABLE usage_events ADD COLUMN stream boolean;
ALTER TABLE usage_events ADD COLUMN surface text
  CHECK (surface IN ('selection', 'panel', 'page', 'site', 'image', 'pdf', 'reader', 'subtitle'));
