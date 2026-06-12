# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start server (development)
npm start
# Or: node server/index.js

# On Windows (production startup with auto-install)
start.bat

# Build standalone Windows executable
npm run build
# Output: Release/需求单信息管理系统.exe

# Install dependencies (if node_modules missing)
npm install --production --no-audit --no-fund
```

## Architecture

**需求单信息管理系统 (Requirement Order Management System)** — a full-stack SPA for tracking IT requirement orders through CCB (Change Control Board) scheduling. Single-page frontend, Express backend, SQLite storage.

### Stack
- **Backend**: Node.js + Express 4 (port 3000)
- **Frontend**: Vanilla JavaScript SPA in a single HTML file (no framework)
- **Database**: SQLite via better-sqlite3 (WAL mode, foreign keys on)
- **Config**: JSON file (`data/config.json`) for dropdown options
- **File Uploads**: multer with per-directory storage (`public/uploads/flow_files/`, `public/uploads/meeting_files/`)
- **Excel**: xlsx library for import/export

### Data Model (5 tables, auto-created)
| Table | Purpose | Key Fields |
|---|---|---|
| `requirement_orders` | Requirement tickets | `order_number` (pattern: 1 uppercase letter + 2 digits, e.g. A01), `department`, `related_departments` |
| `requirement_points` | Line items within an order | `point_number` (auto: `{order_number}-{seq}`), `description`, `system`, `version` |
| `flow_files` | Uploaded documents attached to orders | `file_type`, `original_name`, `file_path` |
| `ccb_meetings` | CCB meeting records | `meeting_name`, `meeting_date`, `file_name` (minutes) |
| `ccb_schedules` | M:N linking points ↔ meetings | `system` (comma-separated), `version` |
| `upgrade_logs` | Auto-generated on each restart | `version`, `title`, `content` |

### File Layout
```
server/
  index.js    — All Express routes (CRUD, search, import/export, config, upgrade logs)
  database.js — SQLite init/connection (singleton, WAL mode)
  config.js   — JSON config CRUD (department/version/system/file_type options)
public/
  index.html  — SPA shell with modals for orders, meetings, schedules, config
  js/app.js   — All frontend logic (navigation, CRUD, search, batch operations)
  css/style.css — All styles (no framework)
  uploads/    — Gitignored file uploads (flow_files/, meeting_files/)
data/
  config.json — Editable category values (seeded with defaults on first run)
  requirements.db — SQLite database (gitignored)
start.bat     — Windows startup (checks node_modules, auto npm installs)
```

### Key Backend Patterns
- **Singleton DB (`server/database.js`)**: `getDatabase()` lazy-inits and returns one connection; 6 tables created on first call.
- **Config (`server/config.js`)**: In-memory cache with JSON file persistence. Categories: `department`, `version`, `system`, `file_type`. Merges missing categories from defaults on load.
- **File upload naming convention**: Uploaded files must start with `【{file_type}】` prefix (e.g. `【需求服务单】A01-需求名称.docx`). CCB meeting minutes must start with `【会议纪要】`.
- **Pagination helper**: `paginate(sql, params, page, pageSize)` in server/index.js wraps any query.
- **Excel import/export**: `/api/export` generates downloadable `.xlsx`; `/api/import` parses and bulk inserts with transaction.
- **pkg compatibility**: Both database.js and config.js detect `process.pkg` to resolve data paths relative to the executable.
- **Auto-upgrade log**: On server restart, inserts a new `upgrade_logs` row with bumped version.

### Key Frontend Patterns
- **SPA navigation**: `navigate(page)` hides/shows `#page-{name}` divs, toggles nav active state.
- **API wrapper**: `api(url, opts)` wraps fetch, auto-parses JSON, checks `success` field.
- **Modal system**: Overlay divs toggled by `.open` class; click-outside-to-close.
- **State object**: Global `state` holds current page, pagination, editing IDs.
- **System multi-select**: Custom checkbox groups for selecting one or more systems.
- **Search**: Debounced 300ms global search across order number, name, department, proposer, point descriptions.

### Common Tasks
- **Adding a new config category**: Add the key to `defaults` in `server/config.js`, add route handlers if needed, add UI in `public/index.html` and `loadConfig()` in `public/js/app.js`.
- **Adding a new API route**: Add route in `server/index.js` (wrap in try/catch returning `{success, message}`).
- **Database migration**: Schema is auto-created via `CREATE TABLE IF NOT EXISTS` on first `getDatabase()` call. To add a column, add an `ALTER TABLE` migration alongside existing schema.

### Deployment Notes
- **pkg packaging**: `npm run build` bundles into a Windows .exe using `pkg`. Native modules (better-sqlite3) are not bundled — the JS wrapper and `.node` binary must sit next to the exe in a `node_modules/better-sqlite3/` folder.
- **Auto-open browser**: Server attempts to open `http://localhost:3000` after 500ms delay (supports Windows/macOS/Linux).
- **Default port**: 3000. Port-in-use error is handled with a descriptive message.
