-- 数据库摘要：恢复、演练与正式切换时在两边各跑一次，逐行对比（只读）。
-- 用法：psql -XAt -F= -f db-summary.sql <库>
SELECT 'users', count(*)::text FROM users
UNION ALL SELECT 'sessions', count(*)::text FROM sessions
UNION ALL SELECT 'credit_ledger', count(*)::text FROM credit_ledger
UNION ALL SELECT 'credit_ledger_units_sum', coalesce(sum(amount_units), 0)::text FROM credit_ledger
UNION ALL SELECT 'usage_events', count(*)::text FROM usage_events
UNION ALL SELECT 'subscriptions', count(*)::text FROM subscriptions
UNION ALL SELECT 'orders', count(*)::text FROM orders
UNION ALL SELECT 'payment_events', count(*)::text FROM payment_events
UNION ALL SELECT 'last_migration', max(name) FROM schema_migrations;
