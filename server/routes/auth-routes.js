/**
 * 登录认证路由：登录页、状态、首次设置、登出、修改口令
 */
const crypto = require('crypto');
const path = require('path');
const config = require('../config');
const { AUTH_USER, SESSION_MAX_AGE_SECONDS, COOKIE_NAME, isAuthenticated, createSessionToken } = require('../middleware/auth');

function hash(s) { return crypto.createHash('sha256').update(s).digest(); }
function hashEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const ha = hash(a), hb = hash(b);
  return ha.length === hb.length && crypto.timingSafeEqual(ha, hb);
}
function issueSession(req, res) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS;
  const token = createSessionToken(config.getAuthPassword(), exp);
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', path: '/',
    maxAge: SESSION_MAX_AGE_SECONDS * 1000, secure: false
  });
}
function validNewPassword(pwd, confirm) {
  return typeof pwd === 'string' && pwd.length >= 6 && pwd === confirm;
}

module.exports = function (app) {
  const ROOT_DIR = path.join(__dirname, '..', '..');

  // 登录页（认证中间件已放行）
  app.get('/login', (req, res) => res.sendFile(path.join(ROOT_DIR, 'public', 'login.html')));

  // 状态：是否需要在首次使用时设置口令
  app.get('/api/auth/status', (req, res) => {
    res.json({ success: true, data: { needsSetup: !config.getAuthPassword(), username: AUTH_USER } });
  });

  // 登录
  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const current = config.getAuthPassword();
    if (!current) return res.status(403).json({ success: false, code: 'NEED_SETUP', message: '请先设置访问口令' });
    if (username !== AUTH_USER || !hashEqual(password, current)) {
      return res.status(401).json({ success: false, message: '用户名或口令错误' });
    }
    issueSession(req, res);
    res.json({ success: true });
  });

  // 首次设置口令（仅在未设置时可用）
  app.post('/api/auth/setup', (req, res) => {
    if (config.getAuthPassword()) return res.status(409).json({ success: false, message: '口令已设置' });
    const { password, confirm } = req.body || {};
    if (!validNewPassword(password, confirm)) {
      return res.status(400).json({ success: false, message: '口令至少 6 位，且两次输入一致' });
    }
    config.setAuthPassword(password);
    issueSession(req, res);
    res.json({ success: true });
  });

  // 登出
  app.post('/api/auth/logout', (req, res) => {
    res.clearCookie(COOKIE_NAME, { path: '/' });
    res.json({ success: true });
  });

  // 修改口令（需已登录）；改后旧会话自动失效，并立即下发新会话
  app.post('/api/auth/password', (req, res) => {
    if (!isAuthenticated(req)) return res.status(401).json({ success: false, message: '未登录或会话已过期' });
    const { current, password, confirm } = req.body || {};
    if (!hashEqual(current, config.getAuthPassword())) {
      return res.status(400).json({ success: false, message: '当前口令不正确' });
    }
    if (!validNewPassword(password, confirm)) {
      return res.status(400).json({ success: false, message: '新口令至少 6 位，且两次输入一致' });
    }
    config.setAuthPassword(password);
    issueSession(req, res);
    res.json({ success: true });
  });
};
