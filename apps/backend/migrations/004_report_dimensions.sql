-- 运营报表的维度（A2）。都是元数据：国家只到两位国家代码（由反向代理的地理请求头或支付平台的账单国家给出，
-- 不保存 IP、城市或坐标），语言是语言代码；不保存原文译文。

-- 托管请求：请求时所在国家、目标语言与源语言（未指定源语言时为空，表示自动检测）。
ALTER TABLE usage_events ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE usage_events ADD COLUMN target_lang text;
ALTER TABLE usage_events ADD COLUMN source_lang text;

-- 访客领取（扩展安装）：安装时所在国家与扩展界面语言。
ALTER TABLE guest_claims ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');
ALTER TABLE guest_claims ADD COLUMN ui_lang text;

-- 订单：支付平台给出的账单国家（用于按国家统计收入）。
ALTER TABLE orders ADD COLUMN country text CHECK (country ~ '^[A-Z]{2}$');

