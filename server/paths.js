/**
 * 统一路径解析
 *
 * 所有存储目录的默认值只在此处定义一次：
 * - 源码运行时根目录为项目根；pkg 打包后根目录为 exe 所在目录
 * - flow_files_dir / backup_dir 等自定义路径来自 config.json，未配置时回退到默认值
 * - config.json 自身可能被 data_dir 切换到自定义目录，备份目录随之变化
 */
const path = require('path');
const config = require('./config');

/** 项目根目录（源码）/ exe 所在目录（pkg） */
function getRootDir() {
  return process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
}

/** 数据目录：存放 config.json、数据库、模板 */
function getDataDir() {
  return path.join(getRootDir(), 'data');
}

/** config.json 所在目录（可能因 data_dir 切换而改变） */
function getConfigDir() {
  return path.dirname(config.getConfigPath());
}

/** 上传根目录 */
function getUploadBaseDir() {
  return path.join(getRootDir(), 'public', 'uploads');
}

function getFlowFileDir() {
  return config.getPath('flow_files_dir') || path.join(getUploadBaseDir(), 'flow_files');
}

function getMeetingFileDir() {
  return config.getPath('meeting_files_dir') || path.join(getUploadBaseDir(), 'meeting_files');
}

function getServiceOrderDir() {
  return config.getPath('service_order_dir') || path.join(getUploadBaseDir(), 'service_orders');
}

function getSpecDocDir() {
  return config.getPath('spec_docs_dir') || path.join(getUploadBaseDir(), 'spec_docs');
}

function getBackupDir() {
  return config.getPath('backup_dir') || path.join(getConfigDir(), 'backups');
}

module.exports = {
  getRootDir, getDataDir, getConfigDir, getUploadBaseDir,
  getFlowFileDir, getMeetingFileDir, getServiceOrderDir,
  getSpecDocDir, getBackupDir
};
