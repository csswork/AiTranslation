import pg from 'pg';

export function createPool(connectionString) {
  return new pg.Pool({ connectionString, max: 10 });
}

/** 在一个事务里运行 fn(client)；fn 抛错时回滚。 */
export async function transaction(pool, fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export const isUniqueViolation = (error, constraint) =>
  error?.code === '23505' && (!constraint || error.constraint === constraint);
