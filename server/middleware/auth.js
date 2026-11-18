/**
 * 访问鉴权
 * 主方式：签名 Cookie 会话（8 小时）
 * 备用方式：Basic Auth（供脚本 / curl 调用；不发送 WWW-Authenticate，避免浏览器原生弹窗）
 */
const crypto = require('crypto');
const config = require('../config');

const AUTH_USER = 'admin';
const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;
const COOKIE_NAME = 'session';

function sessionKey(password) {
  return crypto.createHash('sha256').update('reqmgr-session|' + password).digest();
}

function createSessionToken(password, exp) {
  const payload = Buffer.from(JSON.stringify({ u: AUTH_USER, exp: exp })).toString('base64url');
  const sig = crypto.createHmac('sha256', sessionKey(password)).update(payload).digest('base64url');
  return payload + '.' + sig;
}

function verifySession(token, password) {
  if (!password || !token || typeof token !== 'string') return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const payload = parts[0], sig = parts[1];
  try {
    const expected = crypto.createHmac('sha256', sessionKey(password)).update(payload).digest();
    const actual = Buffer.from(sig, 'base64url');
    if (expected.length !== actual.length) return false;
    if (!crypto.timingSafeEqual(expected, actual)) return false;
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.u === AUTH_USER && typeof data.exp === 'number' && data.exp > Math.floor(Date.now() / 1000);
  } catch (e) { return false; }
}

function parseCookies(req) {
  const out = {};
  const header = req.headers.cookie || '';
  header.split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i < 0) return;
    const k = part.slice(0, i).trim();
    if (k) out[k] = part.slice(i + 1).trim();
  });
  return out;
}

function checkBasic(req, password) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Basic ') || !password) return false;
  try {
    const decoded = Buffer.from(header.slice(6).trim(), 'base64').toString('utf8');
    const sep = decoded.indexOf(':');
    if (sep < 0) return false;
    const user = decoded.slice(0, sep);
    const pass = decoded.slice(sep + 1);
    const hash = s => crypto.createHash('sha256').update(s).digest();
    return user === AUTH_USER && crypto.timingSafeEqual(hash(pass), hash(password));
  } catch (e) { return false; }
}

function isAuthenticated(req) {
  const password = config.getAuthPassword();
  if (!password) return false;
  const token = parseCookies(req)[COOKIE_NAME];
  if (token && verifySession(token, password)) return true;
  return checkBasic(req, password);
}

function authMiddleware(req, res, next) {
  const p = req.path || (req.originalUrl || '').split('?')[0];
  if (p === '/login' || p === '/favicon.ico' || p.startsWith('/api/auth/')) return next();
  if (isAuthenticated(req)) return next();

  // 拒绝时绝不设置 WWW-Authenticate，否则浏览器会弹出原生登录框
  if (p.startsWith('/api/')) {
    return res.status(401).json({ success: false, message: '未登录或会话已过期' });
  }
  const accept = req.headers.accept || '';
  const looksLikePage = req.method === 'GET' && accept.indexOf('text/html') !== -1 && !/\.[a-zA-Z0-9]+$/.test(p);
  if (looksLikePage) return res.redirect(302, '/login');
  return res.status(401).send('未登录或会话已过期');
}

module.exports = {
  AUTH_USER, SESSION_MAX_AGE_SECONDS, COOKIE_NAME,
  createSessionToken, verifySession, isAuthenticated, authMiddleware
};
