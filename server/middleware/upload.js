/**
 * 文件上传中间件
 * multer 配置：临时存储、文件类型校验、大小限制
 */
const multer = require('multer');
const path = require('path');

// 允许的文件扩展名
const ALLOWED_EXTENSIONS = [
  '.xlsx', '.xls', '.doc', '.docx', '.ppt', '.pptx',
  '.pdf', '.txt', '.png', '.jpg', '.jpeg', '.gif', '.zip', '.rar'
];

// 文件大小上限 30MB
const MAX_FILE_SIZE = 30 * 1024 * 1024;

/**
 * 创建 multer 上传中间件
 * @param {string} destDir - 临时文件存储目录
 */
function createUploadMiddleware(destDir) {
  return multer({
    dest: destDir,
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (ALLOWED_EXTENSIONS.includes(ext)) return cb(null, true);
      cb(new Error('不支持的文件类型: ' + ext + '（允许: ' + ALLOWED_EXTENSIONS.join(', ') + '）'));
    },
    limits: { fileSize: MAX_FILE_SIZE }
  });
}

/**
 * 获取允许的文件扩展名列表（供外部引用）
 */
function getAllowedExtensions() {
  return [...ALLOWED_EXTENSIONS];
}

module.exports = { createUploadMiddleware, getAllowedExtensions, MAX_FILE_SIZE };
