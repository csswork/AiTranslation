/**
 * 管理端用户列表（A3）：搜索、筛选、排序与分页。
 *
 * 筛选全部在服务端完成（管理端不用浏览器脚本），取值不在白名单里时按未设置处理。
 * 扩展版本来自 user_extensions.version（扩展请求头 X-Huaci-Version，见 api/extension.js），
 * 「最近使用」取扩展最近请求与最近托管请求中较晚的一个。
 */
import { EXTENSION_STORES } from '../auth/extension.js';

export const USERS_PER_PAGE = 100;
const ENTITLED = ['active', 'trialing', 'paid', 'scheduled_cancel', 'past_due'];

export const USER_FILTERS = {
  kind: { member: '注册用户', guest: '访客', all: '全部类型' },
  sub: { active: '订阅中', none: '未订阅' },
  active: { 7: '7 天内使用过', 30: '30 天内使用过', 90: '90 天内使用过', idle30: '30 天以上未使用', never: '从未使用' },
  frozen: { 1: '已冻结' },
  sort: { created: '注册时间', active: '最近使用', balance: '点数余额', usage: '30 天字数' },
};

const pick = (value, options) => (Object.hasOwn(options, String(value ?? '')) ? String(value) : '');

/** 把查询参数整理成有效的筛选条件。versions 是已知版本列表（用于校验 version 参数）。 */
export function readUserFilters(query, versions = []) {
  const q = String(query.q || '').trim().toLowerCase().slice(0, 254);
  const browser = String(query.browser || '').toLowerCase();
  const browserId = Object.entries(EXTENSION_STORES).find(([, name]) => name.toLowerCase() === browser)?.[0] || null;
  const version = String(query.version || '');
  const page = Number.parseInt(query.page, 10);
  return {
    q,
    browser: browserId ? browser : '',
    browserId,
    version: version === 'none' || version === 'outdated' || versions.some((v) => v.version === version) ? version : '',
    kind: pick(query.kind, USER_FILTERS.kind),
    sub: pick(query.sub, USER_FILTERS.sub),
    active: pick(query.active, USER_FILTERS.active),
    frozen: pick(query.frozen, USER_FILTERS.frozen),
    sort: pick(query.sort, USER_FILTERS.sort) || 'created',
    page: Number.isInteger(page) && page > 1 ? Math.min(page, 10_000) : 1,
  };
}

/*
 * 发布版本只看前三位：Firefox 商店包在 manifest 版本后加一位商店修订号（2.4.0.1），
 * 与 Chrome/Edge 的 2.4.0 是同一版，不能因此把 2.4.0 判成旧版。
 */
export const releaseVersion = (version) => (version ? String(version).split('.').slice(0, 3).join('.') : null);
const RELEASE = (column) => `(string_to_array(${column}, '.')::int[])[1:3]`;

/** 当前最新的发布版本（三位）；versions 来自 extensionVersions，第一项版本号最大。 */
export const latestRelease = (versions) => releaseVersion(versions[0]?.version);

/** 账户在用的扩展版本分布（每个版本有多少账户），按版本号从新到旧。 */
export async function extensionVersions(db) {
  const { rows } = await db.query(
    `SELECT version, COUNT(DISTINCT user_id)::int AS users FROM user_extensions
     WHERE version IS NOT NULL GROUP BY version ORDER BY string_to_array(version, '.')::int[] DESC`,
  );
  return rows;
}

/** 按筛选条件列出用户。返回 { users, total }；latest 是当前最新的发布版本（三位，判断「旧版」用）。 */
export async function listUsers(db, filters, latest = null) {
  const params = [];
  const p = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  const where = [];
  // 不搜索时默认只看注册用户（访客很多）；搜索时默认在全部类型里找。
  const kind = filters.kind || (filters.q ? 'all' : 'member');
  if (kind !== 'all') where.push(`u.kind = ${p(kind)}`);
  if (filters.q) {
    const exact = p(filters.q);
    where.push(`(u.email = ${exact} OR u.username LIKE ${p(`%${filters.q.replace(/[%_\\]/g, '\\$&')}%`)} OR u.id::text = ${exact})`);
  }
  // 浏览器与版本作用于同一条扩展记录：「Edge 上的 2.2.0」。
  const ext = filters.browserId ? `e.extension_id = ${p(filters.browserId)}` : 'TRUE';
  if (filters.browserId) where.push(`EXISTS (SELECT 1 FROM user_extensions e WHERE e.user_id = u.id AND ${ext})`);
  if (filters.version === 'none') {
    where.push(`NOT EXISTS (SELECT 1 FROM user_extensions e WHERE e.user_id = u.id AND ${ext} AND e.version IS NOT NULL)`);
  } else if (filters.version === 'outdated') {
    where.push(latest
      ? `(SELECT MAX(${RELEASE('e.version')}) FROM user_extensions e WHERE e.user_id = u.id AND ${ext}) < string_to_array(${p(latest)}, '.')::int[]`
      : 'FALSE');
  } else if (filters.version) {
    where.push(`EXISTS (SELECT 1 FROM user_extensions e WHERE e.user_id = u.id AND ${ext} AND e.version = ${p(filters.version)})`);
  }
  if (filters.sub) {
    const entitled = `EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id AND s.status = ANY(${p(ENTITLED)}::text[])
                      AND (s.current_period_end IS NULL OR s.current_period_end > now()))`;
    where.push(filters.sub === 'active' ? entitled : `NOT ${entitled}`);
  }
  if (filters.frozen) where.push('u.hosted_frozen_at IS NOT NULL');

  const activeWhere = {
    7: "last_active > now() - interval '7 days'",
    30: "last_active > now() - interval '30 days'",
    90: "last_active > now() - interval '90 days'",
    idle30: "last_active <= now() - interval '30 days'",
    never: 'last_active IS NULL',
  }[filters.active] || 'TRUE';
  const order = {
    created: 'created_at DESC',
    active: 'last_active DESC NULLS LAST, created_at DESC',
    balance: 'balance_units DESC, created_at DESC',
    usage: 'chars_30d DESC, created_at DESC',
  }[filters.sort];
  const latestParam = p(latest);
  const limit = p(USERS_PER_PAGE);
  const offset = p((filters.page - 1) * USERS_PER_PAGE);

  const { rows } = await db.query(
    `WITH base AS (
       SELECT u.id, u.kind, u.email, u.username, u.created_at, u.hosted_frozen_at,
         GREATEST((SELECT MAX(e.last_seen_at) FROM user_extensions e WHERE e.user_id = u.id),
                  (SELECT MAX(ev.created_at) FROM usage_events ev WHERE ev.user_id = u.id)) AS last_active,
         (SELECT COALESCE(SUM(g.amount_units + COALESCE((SELECT SUM(x.amount_units) FROM credit_ledger x WHERE x.grant_id = g.id), 0)), 0)
            FROM credit_ledger g WHERE g.user_id = u.id AND g.grant_id IS NULL AND g.amount_units > 0
              AND (g.expires_at IS NULL OR g.expires_at > now())) AS balance_units,
         (SELECT COALESCE(SUM(ev.chars), 0) FROM usage_events ev
            WHERE ev.user_id = u.id AND ev.status = 'ok' AND ev.created_at > now() - interval '30 days')::bigint AS chars_30d
       FROM users u
       WHERE ${where.length ? where.join(' AND ') : 'TRUE'}
     )
     SELECT b.id, b.kind, b.email, b.username, b.created_at, b.hosted_frozen_at, b.last_active, b.balance_units::text AS balance_units, b.chars_30d,
       COUNT(*) OVER ()::int AS total,
       (SELECT status FROM subscriptions s WHERE s.user_id = b.id ORDER BY updated_at DESC LIMIT 1) AS sub_status,
       (SELECT COUNT(*) FROM guest_claims c
          WHERE c.guest_id = b.id OR c.merged_user_id = b.id OR c.linked_user_id = b.id
             OR c.linked_user_id IN (SELECT m.guest_id FROM guest_claims m WHERE m.merged_user_id = b.id))::int AS installs,
       (SELECT array_agg(e.extension_id ORDER BY e.first_seen_at) FROM user_extensions e WHERE e.user_id = b.id) AS extension_ids,
       (SELECT json_agg(json_build_object('extensionId', e.extension_id, 'version', e.version) ORDER BY e.first_seen_at)
          FROM user_extensions e WHERE e.user_id = b.id AND e.version IS NOT NULL) AS versions,
       ${latestParam}::text IS NOT NULL AND (SELECT MAX(${RELEASE('e.version')}) FROM user_extensions e WHERE e.user_id = b.id)
         < string_to_array(${latestParam}, '.')::int[] AS outdated
     FROM base b
     WHERE ${activeWhere}
     ORDER BY ${order}
     LIMIT ${limit} OFFSET ${offset}`,
    params,
  );
  // 越过最后一页时没有行，也就拿不到总数；再数一次，让页面能显示总数并回到有效页。
  let total = rows[0]?.total ?? 0;
  if (!rows.length && filters.page > 1) {
    total = (await listUsers(db, { ...filters, page: 1 }, latest)).total;
  }
  return { users: rows, total };
}
