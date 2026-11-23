/**
 * 登录认证路由：登录页、状态、首次设置、登出、修改口令
 */
const path = require('path');
const config = require('../config');
const { AUTH_USER, SESSION_MAX_AGE_SECONDS, COOKIE_NAME, isAuthenticated, createSessionToken } = require('../middleware/auth');

// 登录失败锁定：同一 IP 连续失败 5 次后锁定 15 分钟
const loginAttempts = new Map();
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60 * 1000;
function clientIp(req) {
  return String(req.ip || (req.socket && req.socket.remoteAddress) || '').replace(/^::ffff:/, '');
}
function lockState(ip) {
  const s = loginAttempts.get(ip);
  if (!s) return { locked: false, remaining: MAX_FAILS };
  if (s.until) {
    if (s.until > Date.now()) {
      return { locked: true, seconds: Math.ceil((s.until - Date.now()) / 1000) };
    }
    // 锁定已过期，清除计数重新计算
    loginAttempts.delete(ip);
    return { locked: false, remaining: MAX_FAILS };
  }
  return { locked: false, remaining: Math.max(0, MAX_FAILS - s.count) };
}
function recordFail(ip) {
  const s = loginAttempts.get(ip) || { count: 0, until: 0 };
  s.count++;
  if (s.count >= MAX_FAILS) s.until = Date.now() + LOCK_MS;
  loginAttempts.set(ip, s);
}
function clearFails(ip) { loginAttempts.delete(ip); }

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
    const ip = clientIp(req);
    const st = lockState(ip);
    if (st.locked) {
      return res.status(429).json({ success: false, message: `尝试次数过多，请 ${st.seconds} 秒后再试` });
    }
    const current = config.getAuthPassword();
    if (!current) return res.status(403).json({ success: false, code: 'NEED_SETUP', message: '请先设置访问口令' });
    if (username !== AUTH_USER || !config.verifyPassword(password, current)) {
      recordFail(ip);
      return res.status(401).json({ success: false, message: '用户名或口令错误' });
    }
    clearFails(ip);
    if (config.isLegacyPassword(current)) config.setAuthPassword(password); // 旧明文口令透明升级为哈希
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
    if (!config.verifyPassword(current, config.getAuthPassword())) {
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

// 供回归测试清理锁定状态
module.exports.resetLoginAttempts = () => loginAttempts.clear();
