import pg from "pg";

// Zeitstempel und große Zahlen als JS-Werte statt Strings.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number(v));

export type Queryable = Pick<pg.Pool | pg.PoolClient, "query">;

export interface Db {
  pool: pg.Pool;
  query<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
  tx<T>(fn: (client: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}

export interface Tx {
  query<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T[]>;
  one<T extends pg.QueryResultRow = any>(sql: string, params?: unknown[]): Promise<T | undefined>;
}

function wrap(q: Queryable): Tx {
  return {
    async query(sql, params) {
      return (await q.query(sql, params as any[])).rows;
    },
    async one(sql, params) {
      return (await q.query(sql, params as any[])).rows[0];
    },
  };
}

export function createDb(connectionString: string): Db {
  const pool = new pg.Pool({ connectionString, max: 10 });
  const base = wrap(pool);
  return {
    pool,
    ...base,
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query("begin");
        const result = await fn(wrap(client));
        await client.query("commit");
        return result;
      } catch (err) {
        await client.query("rollback");
        throw err;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}
