# 升级说明 v1.x → v2.0.0

## 概述

v2.0.0 是一次**重大代码重构升级**，对后端和前端代码进行了彻底模块化拆分，**零功能变更**，但大幅提升了代码的可读性、可维护性和可扩展性。

## 主要变更

### 后端重构
- **server/index.js**：从 1335 行缩减为 80 行，只负责路由注册和启动
- **新增 8 个路由模块**：按功能拆分到 `server/routes/` 目录
  - `orders.js` — 需求单 CRUD
  - `meetings.js` — 会议管理
  - `schedules.js` — 排期操作
  - `files.js` — 文件上传下载
  - `specs.js` — 需规归档
  - `config-routes.js` — 配置管理
  - `import-export.js` — Excel 导入导出
  - `assessment.js` — Word 文档生成
- **新增工具层**：`server/utils.js`（分页、日期格式化等）
- **提取 Schema**：`server/schema.js`（建表语句独立管理）
- **提取中间件**：`server/middleware/`（文件上传、错误处理）

### 前端重构
- **public/js/app.js**：从 2025 行缩减为 105 行，只做入口和全局注册
- **新增 6 个页面模块**：`public/js/pages/`
  - `orders.js`、`meetings.js`、`schedules.js`、`files.js`、`specs.js`、`config.js`
- **新增 4 个功能模块**：`public/js/features/`
  - `renderers.js`（分页/卡片渲染）、`navigation.js`（导航）、`search.js`（搜索）、`import-export.js`（导入导出）

### 其他
- 所有依赖保持不变
- 数据库 Schema 无变化
- HTML 结构和 onclick 调用完全兼容

## 升级步骤

```bash
# 1. 备份旧版本
cp -r server server.bak
cp -r public/js public/js.bak

# 2. 更新代码（覆盖旧文件）
# server/index.js 已重构
# 新增 server/utils.js, server/schema.js
# 新增 server/middleware/
# 新增 server/routes/
# public/js/app.js 已精简
# 新增 public/js/pages/
# 新增 public/js/features/
# public/index.html 更新了 script 引用

# 3. 启动服务
node server/index.js

# 4. 验证
# 访问 http://localhost:3000 确认所有功能正常
```

## 回退方案

如遇到问题，恢复旧版本即可：
```bash
cp -r server.bak server
cp -r public/js.bak public/js
# 同时恢复 index.html 的旧 script 引用
```

## 验证清单

- [ ] 需求单列表/创建/编辑/删除
- [ ] 需求点增删改查
- [ ] 会议管理（创建/编辑/删除/上传纪要）
- [ ] 排期操作（单条/批量/修改/移除）
- [ ] 排期查询筛选
- [ ] 流转文件上传/下载/删除
- [ ] 需规归档扫描/匹配
- [ ] 参数配置（部门/版本/系统/文件类型）
- [ ] Excel 导出/导入
- [ ] Word 评估表生成
- [ ] 全局搜索
