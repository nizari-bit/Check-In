import fs from 'fs';
import path from 'path';
import mysql from 'mysql2/promise';
import { fileURLToPath } from 'url';
import { config } from '../config.js';

const dir = path.dirname(fileURLToPath(import.meta.url));
const { database, ...conn } = config.db;
const db = await mysql.createConnection({ ...conn, multipleStatements: true });
await db.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
await db.query(`USE \`${database}\``);
await db.query(fs.readFileSync(path.join(dir, '../schema.sql'), 'utf8'));
async function addColumn(table, column, ddl) {
  const [r] = await db.query(
    'SELECT COUNT(*) AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?',
    [database, table, column]);
  if (Number(r[0].c) === 0) { await db.query(`ALTER TABLE \`${table}\` ADD COLUMN ${ddl}`); return true; }
  return false;
}
await addColumn('guests', 'card_type', "card_type ENUM('single','double') NOT NULL DEFAULT 'single' AFTER table_no");
if (await addColumn('guests', 'admitted_count', 'admitted_count TINYINT UNSIGNED NOT NULL DEFAULT 0 AFTER card_type')) {
  await db.query('UPDATE guests SET admitted_count = 1 WHERE checked_in_at IS NOT NULL');
}
console.log(`Database "${database}" is ready.`);
await db.end();
