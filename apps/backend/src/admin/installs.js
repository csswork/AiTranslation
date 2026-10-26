/**
 * 管理端用户详情里的安装历史：与这个用户有关的每次扩展安装（访客领取记录）。
 *
 * 一条记录与用户的关系（relation）：
 * - own：这个访客自己的安装；
 * - merged：访客合并进了这个正式账户（转入额度 transferred_units；转入规则见 credits/ledger.js）；
 * - linked：欢迎页识别出同一浏览器属于这个账户（已注册浏览器的新访客点数作废，或重装后接回这个访客）；
 * - via_merged：重装后接回的旧访客后来合并进了这个账户。
 * 访客合并或删除后 user_id 会被置空，所以按 guest_id 关联（迁移 010 之前合并的旧记录可能缺少这些字段）。
 */

export async function installHistory(db, userId, { limit = 100 } = {}) {
  const { rows } = await db.query(
    `WITH merged AS (SELECT guest_id FROM guest_claims WHERE merged_user_id = $1 AND guest_id IS NOT NULL)
     SELECT g.id, g.guest_id, g.outcome, g.granted_units::text, g.transferred_units::text, g.merged_at, g.created_at,
            g.country, g.ui_lang, g.extension_id, left(g.ip_hash, 8) AS network, g.user_id IS NOT NULL AS guest_alive,
            g.merged_user_id, mu.username AS merged_username, g.linked_user_id, lu.username AS linked_username,
            CASE
              WHEN g.merged_user_id = $1 THEN 'merged'
              WHEN g.guest_id = $1 THEN 'own'
              WHEN g.linked_user_id = $1 THEN 'linked'
              ELSE 'via_merged'
            END AS relation
     FROM guest_claims g
     LEFT JOIN users mu ON mu.id = g.merged_user_id
     LEFT JOIN users lu ON lu.id = g.linked_user_id
     WHERE g.guest_id = $1 OR g.merged_user_id = $1 OR g.linked_user_id = $1
        OR g.linked_user_id IN (SELECT guest_id FROM merged)
     ORDER BY g.created_at DESC
     LIMIT $2`,
    [userId, limit],
  );
  const merged = rows.filter((r) => r.relation === 'merged');
  return {
    rows: rows.map((r) => ({
      ...r,
      granted_units: BigInt(r.granted_units),
      transferred_units: r.transferred_units == null ? null : BigInt(r.transferred_units),
    })),
    summary: {
      installs: rows.length,
      merged: merged.length,
      transferredUnits: merged.reduce((sum, r) => sum + BigInt(r.transferred_units || 0), 0n),
      notTransferred: merged.filter((r) => r.transferred_units === '0').length,
    },
  };
}
