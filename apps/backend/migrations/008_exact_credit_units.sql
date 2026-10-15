-- 展示点数只作换算；账本、预扣和返还统一存整数额度，1 单位 = 1 字符，500 单位 = 1 点。
-- 旧记录按原点数乘 500 等值迁移，保留已有余额与历史扣费，不追溯重新计费。
ALTER TABLE credit_ledger RENAME COLUMN amount TO amount_units;
ALTER TABLE credit_ledger ALTER COLUMN amount_units TYPE bigint USING amount_units::bigint * 500;
ALTER TABLE usage_events RENAME COLUMN cost TO cost_units;
ALTER TABLE usage_events ALTER COLUMN cost_units TYPE bigint USING cost_units::bigint * 500;
ALTER TABLE usage_rejections RENAME COLUMN cost TO cost_units;
ALTER TABLE usage_rejections ALTER COLUMN cost_units TYPE bigint USING cost_units::bigint * 500;
ALTER TABLE guest_claims RENAME COLUMN granted TO granted_units;
ALTER TABLE guest_claims ALTER COLUMN granted_units TYPE bigint USING granted_units::bigint * 500;

-- 换算固定为 500，不能再被旧设置或环境变量覆盖；赠送规则仍由管理员配置展示点数。
DELETE FROM app_settings WHERE key = 'chars_per_credit';
