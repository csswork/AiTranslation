-- 用户在扩展设置里自愿开启后，扩展每天汇总一次「自带 Key / DeepL / 本机翻译」的功能使用次数（见 docs/extension/usage-sharing.md）。
-- 只存「本地日期 × 功能 × 平台」的计数，不含原文、译文、网址、语言或模型；点数翻译不在这里，仍按 usage_events 统计。
-- id 由扩展为每个计数生成，重复提交不重复记录；保留 180 天，随账户删除。
CREATE TABLE shared_feature_usage (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  day date NOT NULL,
  feature text NOT NULL
    CHECK (feature IN ('selection', 'panel', 'page', 'site', 'image', 'pdf', 'reader', 'subtitle', 'alternatives')),
  provider text NOT NULL CHECK (provider IN ('openai', 'deepseek', 'deepl', 'local')),
  requests integer NOT NULL CHECK (requests BETWEEN 1 AND 10000),
  failures integer NOT NULL CHECK (failures >= 0 AND failures <= requests),
  ext_version text CHECK (ext_version ~ '^[0-9]{1,5}(\.[0-9]{1,5}){0,3}$'),
  browser text CHECK (browser IN ('chrome', 'edge', 'firefox', 'other')),
  browser_major smallint CHECK (browser_major BETWEEN 1 AND 999),
  os text CHECK (os IN ('windows', 'macos', 'linux', 'chromeos', 'other')),
  received_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX shared_feature_usage_day ON shared_feature_usage (day DESC);
CREATE INDEX shared_feature_usage_user ON shared_feature_usage (user_id, day DESC);
