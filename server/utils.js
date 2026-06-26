/**
 * 通用工具函数
 * 从 server/index.js 中提取的跨模块共用函数
 */

const path = require('path');
const fs = require('fs');

/** 数字补零 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * 日期统一格式化：支持 2026/6/11、2026-6-11、20260611 → 2026-06-11
 * 兼容 Excel M/D/YY 和 Excel 序列号格式
 */
function normalizeDate(v) {
  if (!v) return '';
  const s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  let m = s.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (m) return `${m[1]}-${pad2(m[2])}-${pad2(m[3])}`;
  m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  // 兼容 Excel M/D/YY 或 M/D/YYYY 格式
  m = s.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/);
  if (m) {
    let y = parseInt(m[3]);
    if (y < 100) y += y < 50 ? 2000 : 1900;
    return `${y}-${pad2(parseInt(m[1]))}-${pad2(parseInt(m[2]))}`;
  }
  // 兼容 Excel 序列号（如 46185 → 2026-06-12）
  const num = Number(v);
  if (!isNaN(num) && num > 1 && num < 200000) {
    const d = new Date((num - 25569) * 86400000);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }
  return s;
}

/**
 * 版本号递增 v1.0.0 → v1.0.1
 */
function bumpVersion(v) {
  const m = v.match(/v(\d+)\.(\d+)\.(\d+)/);
  if (!m) return 'v1.0.1';
  return `v${m[1]}.${m[2]}.${parseInt(m[3]) + 1}`;
}

/**
 * 分页查询辅助
 * @param {string} sql - 完整查询 SQL（不含 LIMIT/OFFSET）
 * @param {any[]} params - SQL 参数
 * @param {number} page - 页码（从 1 开始）
 * @param {number} pageSize - 每页条数
 * @returns {{ items, total, page, pageSize, totalPages }}
 */
function paginate(sql, params, page, pageSize) {
  const { getDatabase } = require('./database');
  const db = getDatabase();
  const countSql = `SELECT COUNT(*) as total FROM (${sql})`;
  const total = db.prepare(countSql).get(...params).total;
  const offset = (page - 1) * pageSize;
  const items = db.prepare(`${sql} LIMIT ? OFFSET ?`).all(...params, pageSize, offset);
  return { items, total, page, pageSize, totalPages: Math.ceil(total / pageSize) };
}

/**
 * 递归遍历目录，返回所有文件的完整路径数组
 */
function walkDir(dir) {
  const results = [];
  const list = fs.readdirSync(dir);
  for (const item of list) {
    const fullPath = path.join(dir, item);
    const stat = fs.statSync(fullPath);
    if (stat.isDirectory()) {
      results.push(...walkDir(fullPath));
    } else if (stat.isFile()) {
      results.push(fullPath);
    }
  }
  return results;
}

/**
 * 修正文件名编码（latin1 → utf8）
 */
function encodeName(name) {
  try { return Buffer.from(name, 'latin1').toString('utf8'); } catch (e) { return name; }
}

module.exports = { pad2, normalizeDate, bumpVersion, paginate, walkDir, encodeName };
