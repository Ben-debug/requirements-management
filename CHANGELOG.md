# 变更日志

## v2.0.0（2026-06-26）— 代码架构重构

### 🏗️ 后端重构
- **server/index.js** 从 1335 行精简至 ~80 行，只保留启动入口和路由注册
- 新增 `server/routes/` 目录，按功能拆分为 8 个独立模块
- 新增 `server/utils.js` 公共工具函数（paginate、normalizeDate 等）
- 新增 `server/schema.js` 数据库 Schema 独立管理
- 新增 `server/middleware/` 中间件（文件上传、错误处理）

### 🎨 前端重构
- **public/js/app.js** 从 2025 行精简至 ~105 行，只做入口和全局注册
- 新增 `public/js/pages/` 目录（6 个页面模块）
- 新增 `public/js/features/` 目录（4 个功能模块）
- 提取公共渲染器 `renderers.js` 统一分页/卡片渲染

### 📦 新增文件总览
```
新增 22 个文件，重构 3 个核心文件
```

### ✅ 验证
- 所有 API 端点测试通过（20+ 测试用例）
- 零功能变更，完全向后兼容

---

## v1.9.0
- config 路径提示、流转文件按部门分组、config 加载 bug 修复

## v1.8.0
- 排期查询汇总条、筛选改名、CCB 改排期管理

## v1.7.0
- 导出功能完善（补全字段、is_project 筛选、文件名编码）
