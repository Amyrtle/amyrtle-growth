import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class Store {
  db: DatabaseSync;
  constructor(path: string) {
    if (path !== ':memory:') mkdirSync(dirname(path), {recursive:true});
    this.db = new DatabaseSync(path);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;');
    this.db.exec(readFileSync(new URL('../db/migrations/001_initial.sql', import.meta.url), 'utf8'));
    if(!this.one('SELECT version FROM schema_migrations WHERE version=2'))this.tx(()=>this.db.exec(readFileSync(new URL('../db/migrations/002_assets.sql',import.meta.url),'utf8')));
  }
  one<T>(sql:string,...args:SQLInputValue[]): T|undefined {return this.db.prepare(sql).get(...args) as T|undefined;}
  all<T>(sql:string,...args:SQLInputValue[]): T[] {return this.db.prepare(sql).all(...args) as T[];}
  run(sql:string,...args:SQLInputValue[]) {return this.db.prepare(sql).run(...args);}
  tx<T>(fn:()=>T):T {this.db.exec('BEGIN IMMEDIATE'); try {const value=fn();this.db.exec('COMMIT');return value;} catch(e){this.db.exec('ROLLBACK');throw e;}}
  close(){this.db.close();}
}
