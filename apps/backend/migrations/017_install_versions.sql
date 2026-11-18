-- 安装时的扩展版本：访客领取（/api/extension/guest）时请求头 X-Huaci-Version 的值，
-- 用于首页「最近 7 天安装」与用户详情的安装记录，看新安装来自哪个版本。旧版扩展不带时为空。
ALTER TABLE guest_claims ADD COLUMN ext_version text CHECK (ext_version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$');
