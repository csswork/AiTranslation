-- 只增加划词 Firefox 的固定公开渠道 ID，保留 Chrome/Edge 的约束。
ALTER TABLE guest_claims DROP CONSTRAINT guest_claims_extension_id_check;
ALTER TABLE guest_claims ADD CONSTRAINT guest_claims_extension_id_check
  CHECK (extension_id ~ '^[a-p]{32}$' OR extension_id = 'huaci@huaci.app');

ALTER TABLE user_extensions DROP CONSTRAINT user_extensions_extension_id_check;
ALTER TABLE user_extensions ADD CONSTRAINT user_extensions_extension_id_check
  CHECK (extension_id ~ '^[a-p]{32}$' OR extension_id = 'huaci@huaci.app');
