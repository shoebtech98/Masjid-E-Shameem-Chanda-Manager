// D1-compatible shim over node:sqlite (in-memory) — test harness only.
// Lets the Cloudflare app (Hono fetch handler + src/db.js D1 adapter) run
// entirely in Node for endpoint-level QA without a Cloudflare account.
// Implements the subset of the D1 API the app uses:
//   prepare(sql).bind(...).all()/.first()/.run()
//   exec(sql)  ·  batch([{ sql, params }])
import { DatabaseSync } from 'node:sqlite';

export function createD1Shim() {
  const s = new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys = ON;');

  const prepare = (sql) => ({
    bind(...args) {
      this._args = args.map((a) => (a === undefined ? null : a));
      return this;
    },
    all() {
      const rows = s.prepare(sql).all(...(this._args || []));
      return { results: rows, success: true };
    },
    first() {
      return s.prepare(sql).get(...(this._args || [])) ?? null;
    },
    run() {
      const r = s.prepare(sql).run(...(this._args || []));
      return {
        meta: {
          changes: Number(r.changes),
          last_row_id: r.lastInsertRowid === undefined || r.lastInsertRowid === null
            ? null
            : Number(r.lastInsertRowid),
        },
        success: true,
      };
    },
  });

  return {
    prepare,
    exec(sql) {
      s.exec(sql);
      return { success: true };
    },
    batch(stmts) {
      s.exec('BEGIN');
      try {
        const results = stmts.map((st) => prepare(st.sql).bind(...(st.params || [])).run());
        s.exec('COMMIT');
        return results;
      } catch (err) {
        s.exec('ROLLBACK');
        throw err;
      }
    },
    _sqlite: s,
  };
}
