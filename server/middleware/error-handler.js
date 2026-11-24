/**
 * 全局错误处理中间件
 * 处理 multer 错误、API 404、兜底错误
 */

/**
 * 路由包装器：同步抛错与 Promise 拒绝统一交给 Express 错误链。
 * Express 4 不会自动捕获 async 处理器中的异常，异步路由必须经此包装。
 */
function wrap(fn) {
  return function wrapped(req, res, next) {
    try {
      const result = fn(req, res, next);
      if (result && typeof result.then === 'function') result.catch(next);
      return result;
    } catch (err) {
      next(err);
    }
  };
}


/**
 * 全局错误处理（multer 文件类型/大小错误、未捕获异常）
 */
function errorHandler(err, req, res, next) {
  if (err.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ success: false, message: '文件大小不能超过 30MB' });
  }
  if (err.message && err.message.startsWith('不支持的文件类型')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  console.error('Unhandled error:', err);
  res.status(500).json({ success: false, message: err.message || '服务器内部错误' });
}

/**
 * 兜底路由：未匹配的 API 返回 404，其它返回 index.html
 */
function fallbackHandler(req, res) {
  const path = require('path');
  const ROOT_DIR = require('../paths').getRootDir();
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ success: false, message: 'API 不存在' });
  }
  res.sendFile(path.join(ROOT_DIR, 'public', 'index.html'));
}

module.exports = { wrap, errorHandler, fallbackHandler };
