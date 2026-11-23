/**
 * 需规归档路由
 * 文档 CRUD、目录扫描、系统匹配、评审会议纪要
 */
const { getDatabase } = require('../database');
const config = require('../config');
const { walkDirAsync, paginate, sendFileInline, sendFileMissing, handleFileOpen } = require('../utils');
const path = require('path');
const fs = require('fs');

module.exports = function (app) {

  const ROOT_DIR = path.join(__dirname, '..', '..');
  const DATA_DIR = process.pkg ? path.dirname(process.execPath) : ROOT_DIR;

  function getSpecDocDir() {
    const custom = config.getPath('spec_docs_dir');
    return custom || path.join(DATA_DIR, 'public', 'uploads', 'spec_docs');
  }

  // ============================================================
  // 系统+需求点映射（用于需规匹配）
  // ============================================================
  app.get('/api/specs/systems', (req, res) => {
    try {
      const db = getDatabase();
      const { version, department } = req.query;
      if (!version) return res.status(400).json({ success: false, message: '请指定版本' });
      const deptFilters = splitNames(department);
      const vs = config.expandNames('version', version);
      const schedules = db.prepare(`
        SELECT cs.point_id, cs.system, rp.point_number, rp.description,
          ro.order_number, ro.name as order_name, ro.department as order_department
        FROM ccb_schedules cs
        JOIN requirement_points rp ON cs.point_id = rp.id
        JOIN requirement_orders ro ON rp.order_id = ro.id
        WHERE cs.version IN (${vs.map(() => '?').join(',')})
        ORDER BY ro.order_number, rp.point_number
      `).all(...vs);
      const systemGroups = {};
      for (const s of schedules) {
        if (deptFilters.length && !deptFilters.includes(String(s.order_department || '').trim())) continue;
        const systems = splitNames(s.system);
        for (const sys of systems) {
          if (!systemGroups[sys]) systemGroups[sys] = [];
          if (!systemGroups[sys].find(p => p.id === s.point_id)) {
            systemGroups[sys].push({ id: s.point_id, point_number: s.point_number, description: s.description, order_number: s.order_number, order_name: s.order_name });
          }
        }
      }
      res.json({ success: true, data: { systems: realSystems(config.getCategory('system')), systemGroups } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 树状数据（版本 → 归档类别 → 文档 → 系统 → 需求单 → 需求点）
  // ============================================================
  app.get('/api/specs/tree', (req, res) => {
    try {
      const db = getDatabase();
      const { version } = req.query;
      const params = [];
      let sql = 'SELECT id, version, file_name, file_path, doc_type, archive_category, notes, meeting_date, created_at, matched_systems, matched_department, auto_matched FROM spec_documents WHERE 1=1';
      if (version) {
        const vs = config.expandNames('version', version);
        sql += ` AND version IN (${vs.map(() => '?').join(',')})`;
        params.push(...vs);
      }
      sql += ' ORDER BY version, archive_category, file_name';
      const rows = db.prepare(sql).all(...params);

      const groups = new Map();
      const docMap = new Map();
      for (const r of rows) {
        if (!groups.has(r.version)) {
          groups.set(r.version, { version: r.version, documents: [], meetings: [], wordVersions: [], signedScans: [] });
        }
        const g = groups.get(r.version);
        const item = {
          id: r.id, file_name: r.file_name, file_path: r.file_path || '', version: r.version,
          matched_systems: r.matched_systems || '', matched_department: r.matched_department || '',
          auto_matched: r.auto_matched || 0,
          archive_category: r.archive_category || 'word_version'
        };
        if (r.archive_category === 'meeting_minutes' || r.doc_type === 'meeting_minutes') {
          item.meeting_name = r.notes || path.basename(r.file_name, path.extname(r.file_name));
          item.meeting_date = r.meeting_date || '';
          g.meetings.push(item);
        } else if (r.archive_category === 'signed_scan') {
          item._systems = new Map();
          g.signedScans.push(item);
          docMap.set(item.id, item);
        } else {
          item._systems = new Map();
          g.wordVersions.push(item);
          docMap.set(item.id, item);
        }
      }

      // 一次查询补全文档 → 系统 → 需求单 → 需求点层级
      if (docMap.size) {
        const ids = [...docMap.keys()];
        const ph = ids.map(() => '?').join(',');
        const hRows = db.prepare(`SELECT sd.id as spec_id, sdp.point_id, sd.matched_department,
            rp.point_number, rp.description, ro.department as order_department,
            ro.id as order_id, ro.order_number, ro.name as order_name,
            cs.system as sched_system
          FROM spec_documents sd
          LEFT JOIN spec_document_points sdp ON sdp.spec_id = sd.id
          LEFT JOIN requirement_points rp ON rp.id = sdp.point_id
          LEFT JOIN requirement_orders ro ON ro.id = rp.order_id
          LEFT JOIN ccb_schedules cs ON cs.point_id = rp.id AND cs.version = sd.version
          WHERE sd.id IN (${ph})
          ORDER BY sd.id, cs.system, ro.order_number, rp.point_number`).all(...ids);
        for (const row of hRows) {
          const doc = docMap.get(row.spec_id);
          if (!doc || !row.point_id) continue;
          if (!departmentMatches(row.matched_department, row.order_department)) continue;
          const pointSystems = splitNames(row.sched_system);
          const docSystems = splitNames(doc.matched_systems);
          const effective = pointSystems.filter(sys => docSystems.includes(sys));
          for (const sys of effective) {
            if (!doc._systems.has(sys)) doc._systems.set(sys, { name: sys, orders: new Map() });
            const sysObj = doc._systems.get(sys);
            const orderKey = row.order_number || '';
            if (!sysObj.orders.has(orderKey)) {
              sysObj.orders.set(orderKey, { order_id: row.order_id, order_number: row.order_number || '', order_name: row.order_name || '', points: [] });
            }
            const order = sysObj.orders.get(orderKey);
            if (!order.points.find(p => p.point_id === row.point_id)) {
              order.points.push({ point_id: row.point_id, point_number: row.point_number || '', description: row.description || '' });
            }
          }
        }
        // 没有排期数据的系统也补一个空节点，保证在树中可见
        for (const doc of docMap.values()) {
          const docSystems = splitNames(doc.matched_systems);
          for (const sys of docSystems) {
            if (!doc._systems.has(sys)) doc._systems.set(sys, { name: sys, orders: new Map() });
          }
          doc.allSystems = [...doc._systems.values()].map(sys => ({
            name: sys.name,
            orders: [...sys.orders.values()].sort((a, b) => a.order_number.localeCompare(b.order_number))
          })).sort((a, b) => a.name.localeCompare(b.name));
          delete doc._systems;
        }
      }

      for (const g of groups.values()) {
        g.meetings.sort((a, b) => (b.meeting_date || '').localeCompare(a.meeting_date || '') || a.file_name.localeCompare(b.file_name));
        g.wordVersions.sort((a, b) => a.file_name.localeCompare(b.file_name));
        g.signedScans.sort((a, b) => a.file_name.localeCompare(b.file_name));
      }

      const allVersions = config.getCategory('version');
      const versionOrder = allVersions.reduce((acc, v, i) => { acc[v] = i; return acc; }, {});
      const sorted = [], unsorted = [];
      for (const g of groups.values()) {
        if (g.version in versionOrder) sorted[versionOrder[g.version]] = g;
        else unsorted.push(g);
      }
      const tree = sorted.filter(Boolean).concat(unsorted);
      res.json({ success: true, data: tree, filters: { versions: allVersions } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // ============================================================
  app.get('/api/specs/query', (req, res) => {
    try {
      const db = getDatabase();
      const { version, system, department, keyword, project_name, group_by, page = 1, pageSize = 20 } = req.query;

      // 基础查询不带相关子查询，避免 COUNT 阶段对每行重复执行
      let sql = "SELECT sd.* FROM spec_documents sd WHERE sd.doc_type='spec_doc'";
      const params = [];
      if (version) {
        const vs = config.expandNames('version', version);
        sql += ` AND sd.version IN (${vs.map(() => '?').join(',')})`;
        params.push(...vs);
      }
      if (system) { sql += ' AND sd.matched_systems LIKE ?'; params.push(`%${system}%`); }
      if (keyword) { sql += ' AND (sd.file_name LIKE ? OR sd.notes LIKE ?)'; const k = `%${keyword}%`; params.push(k, k); }
      if (department) {
        // 文档名含部门时，只认该部门提出的需求单；新旧部门名等价筛选
        const names = config.expandNames('department',department);
        const ph = names.map(() => '?').join(',');
        const likeOrs = names.map(() => "(',' || sd.matched_department || ',') LIKE ?").join(' OR ');
        sql += ` AND EXISTS (SELECT 1 FROM spec_document_points sdp2
                 JOIN requirement_points rp2 ON rp2.id = sdp2.point_id
                 JOIN requirement_orders ro2 ON ro2.id = rp2.order_id
                 WHERE sdp2.spec_id = sd.id AND ro2.department IN (${ph})
                   AND (sd.matched_department IS NULL OR sd.matched_department='' OR ${likeOrs}))`;
        params.push(...names, ...names.map(n => `%,${n},%`));
      }
      if (project_name) {
        const names = config.expandNames('project', project_name);
        sql += ` AND EXISTS (SELECT 1 FROM spec_document_points sdp3
                 JOIN ccb_schedules cs3 ON cs3.point_id = sdp3.point_id
                 WHERE sdp3.spec_id = sd.id AND cs3.is_project=1 AND cs3.project_name IN (${names.map(() => '?').join(',')}))`;
        params.push(...names);
      }
      sql += ' ORDER BY sd.version DESC, sd.file_name';

      const result = paginate(sql, params, parseInt(page), parseInt(pageSize));

      // 仅对当前页批量补全关联需求单 / 部门，单次查询取代逐行子查询
      const ids = result.items.map(x => x.id);
      if (ids.length) {
        const ph = ids.map(() => '?').join(',');
        const relRows = db.prepare(`SELECT sdp.spec_id, ro.order_number, ro.department
          FROM spec_document_points sdp
          JOIN requirement_points rp ON rp.id = sdp.point_id
          JOIN requirement_orders ro ON ro.id = rp.order_id
          WHERE sdp.spec_id IN (${ph})`).all(...ids);
        const specMap = {};
        result.items.forEach(it => { specMap[it.id] = it; });
        const relMap = {};
        for (const r of relRows) {
          const spec = specMap[r.spec_id];
          if (!spec || !departmentMatches(spec.matched_department, r.department)) continue;
          if (!relMap[r.spec_id]) relMap[r.spec_id] = { orders: new Set(), depts: new Set() };
          if (r.order_number) relMap[r.spec_id].orders.add(r.order_number);
          if (r.department) relMap[r.spec_id].depts.add(r.department);
        }
        result.items.forEach(it => {
          const rel = relMap[it.id];
          it.related_orders = rel ? [...rel.orders].join(',') : '';
          it.related_departments = rel ? [...rel.depts].join(',') : '';
        });
      }

      // 仿排期查询：对当前页分组（口径与 /api/schedules/filter 一致）
      let grouped = null;
      if (group_by && group_by !== 'none') {
        const first = v => String(v || '').split(/[,，、\s]+/).filter(Boolean)[0] || '未指定';
        grouped = {};
        result.items.forEach(s => {
          let key;
          if (group_by === 'version') key = s.version || '未指定';
          else if (group_by === 'archive_category') key = s.archive_category || '未指定';
          else if (group_by === 'department') key = first(s.related_departments);
          else if (group_by === 'system') key = first(s.matched_systems);
          else key = '其他';
          if (!grouped[key]) grouped[key] = [];
          grouped[key].push(s);
        });
      }

      const versions = config.getCategory('version');
      const systems = realSystems(config.getCategory('system'));
      const departments = config.getCategory('department');
      const usedProjects = db.prepare("SELECT DISTINCT project_name FROM ccb_schedules WHERE is_project=1 AND project_name IS NOT NULL AND project_name!='' ORDER BY project_name").all().map(r => r.project_name);
      const projects = [...new Set([...config.getCategory('project'), ...usedProjects])];
      res.json({ success: true, ...result, grouped, filters: { versions, systems, departments, projects } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // 扫描允许的文件类型：Word + Office 全套 + PDF
  const ALLOWED_EXTS = new Set([
    '.doc', '.docx', '.docm', '.dot', '.dotx', '.dotm', '.wps', '.rtf', '.odt',
    '.xls', '.xlsx', '.xlsm', '.xlsb', '.et', '.ods',
    '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.odp',
    '.pdf'
  ]);
  // 归档仅三类：PDF → 签字扫描件；文件名含「评审/纪要」或旧 meetings/ 目录 → 评审会议纪要；其余 → word版本
  const MEETING_KEYWORDS = ['评审', '纪要'];
  function classifyArchiveFile(fileName, relPath) {
    if (MEETING_KEYWORDS.some(k => fileName.includes(k)) || relPath.split(/[\\/]/).includes('meetings')) {
      return { category: 'meeting_minutes', docType: 'meeting_minutes' };
    }
    if (path.extname(fileName).toLowerCase() === '.pdf') {
      return { category: 'signed_scan', docType: 'spec_doc' };
    }
    return { category: 'word_version', docType: 'spec_doc' };
  }


  // 系统别名：配置项格式「标准系统名=别名1,别名2」。命中别名仍按标准系统名归类。
  // 占位符（如 "-"）不是真实系统名，必须从匹配来源中剔除，避免归档记录出现假系统。
  const PLACEHOLDER_NAMES = new Set(['-', '—', '－', '–']);
  function splitNames(raw) {
    return String(raw || '').split(/[,，、]+/).map(x => x.trim()).filter(Boolean);
  }
  function isRealName(name) {
    return !!name && !PLACEHOLDER_NAMES.has(name);
  }
  function realSystems(systems) {
    return systems.filter(isRealName);
  }
  // 文档名中的部门（提出部门）用于收窄该系统下的需求单范围
  // 部门改名后旧名保留为别名：文件名含旧名时仍归到当前标准部门
  function matchDepartmentsInFileName(fileName, departments) {
    const aliases = config.getAliases('department');
    const hits = [];
    for (const d of departments) {
      if (!isRealName(d)) continue;
      if (fileName.includes(d)) { hits.push(d); continue; }
      for (const [alias, canonical] of Object.entries(aliases)) {
        if (canonical === d && fileName.includes(alias)) { hits.push(d); break; }
      }
    }
    return hits;
  }
  function departmentMatches(docDepartments, orderDepartment) {
    const filters = splitNames(docDepartments);
    if (!filters.length) return true;
    const orderNames = new Set(config.expandNames('department',orderDepartment));
    return filters.some(f => config.expandNames('department',f).some(n => orderNames.has(n)));
  }

  function getSystemAliases() {
    const map = {};
    for (const entry of config.getCategory('system_alias')) {
      const line = String(entry || '').trim();
      const eq = line.indexOf('=');
      if (eq <= 0) continue;
      const system = line.slice(0, eq).trim();
      if (!system) continue;
      const aliases = line.slice(eq + 1).split(/[,，、]/).map(x => x.trim()).filter(Boolean);
      if (aliases.length) map[system] = aliases;
    }
    return map;
  }
  function matchSystemsInFileName(fileName, systems, aliasMap) {
    return realSystems(systems).filter(sys => {
      if (fileName.includes(sys)) return true;
      return (aliasMap[sys] || []).some(alias => isRealName(alias) && fileName.includes(alias));
    });
  }

  // 系统/Office 临时文件：不参与归档扫描
  const TEMP_EXTS = new Set(['.tmp', '.temp', '.bak', '.swp']);
  const SYSTEM_FILE_NAMES = new Set(['.ds_store', 'thumbs.db', 'desktop.ini']);
  function isTempOrSystemFile(fileName) {
    if (fileName.startsWith('~$') || fileName.startsWith('.')) return true;
    const lower = fileName.toLowerCase();
    return SYSTEM_FILE_NAMES.has(lower) || TEMP_EXTS.has(path.extname(lower));
  }

  // 扫描目录（每个文件归入三类之一，已有记录按新规则覆盖）
  // ============================================================
  app.post('/api/specs/scan', async (req, res) => {
    try {
      const db = getDatabase();
      const { version } = req.body;
      if (!version) return res.status(400).json({ success: false, message: '请选择版本' });

      const specBaseDir = getSpecDocDir();
      const vs = config.expandNames('version', version);
      // 版本改名后磁盘目录可能仍是旧名：新旧名对应的目录都接受，归档记录统一写当前版本名
      let versionDir = path.join(specBaseDir, version);
      if (!fs.existsSync(versionDir) || !fs.statSync(versionDir).isDirectory()) {
        const alt = vs.map(n => path.join(specBaseDir, n))
          .find(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
        if (alt) versionDir = alt;
      }
      if (!fs.existsSync(versionDir) || !fs.statSync(versionDir).isDirectory()) {
        return res.json({ success: true, data: [], count: 0, meeting_count: 0, skipBecauseMissingVersionDir: true,
          message: `需规目录中不存在版本「${version}」对应的文件夹。\n请将文件直接放入需规目录下的「${version}」子文件夹中，扫描规则：\n  · 文件名含「评审」或「纪要」（或旧 meetings/ 目录）→ 评审会议纪要\n  · PDF → 签字扫描件\n  · 其余 Word / Office 文件 → word版本\n  · 除纪要外，文件名必须包含配置中的系统名或系统别名，否则跳过不归档（避免出现非真实系统）\n  · 文件名含部门名时，该系统下只关联该部门提出的需求单\n  · 每个文件只保留一条归档记录，重复扫描按当前规则覆盖旧记录\n\n当前需规目录: ${specBaseDir}` });
      }

      // ---- 遍历版本目录并分类（每个文件恰好属于一类）----
      const discovered = [];
      for (const filePath of await walkDirAsync(versionDir)) {
        const fileName = path.basename(filePath);
        if (isTempOrSystemFile(fileName)) continue;
        if (!ALLOWED_EXTS.has(path.extname(fileName).toLowerCase())) continue;
        const rel = path.relative(versionDir, filePath);
        const { category, docType } = classifyArchiveFile(fileName, rel);
        discovered.push({ file_name: fileName, file_path: filePath, category, docType });
      }
      // 没有可归档文件时也不能提前返回：仍需清理该版本下文件已不存在的失效记录
      // ---- 该版本的失效记录：磁盘文件已不存在 ----
      const staleIds = db.prepare(`SELECT id, file_path FROM spec_documents WHERE version IN (${vs.map(() => '?').join(',')})`).all(...vs)
        .filter(r => !r.file_path || !fs.existsSync(path.resolve(r.file_path)))
        .map(r => r.id);

      const allSystems = config.getCategory('system');
      const allDepartments = config.getCategory('department');
      const aliasMap = getSystemAliases();
      const allScheduled = db.prepare(`
        SELECT cs.point_id, cs.system, ro.department AS order_department
        FROM ccb_schedules cs
        JOIN requirement_points rp ON rp.id = cs.point_id
        JOIN requirement_orders ro ON ro.id = rp.order_id
        WHERE cs.version IN (${vs.map(() => '?').join(',')})`).all(...vs);
      const systemPointMap = {};
      for (const s of allScheduled) {
        for (const sys of splitNames(s.system)) {
          if (!systemPointMap[sys]) systemPointMap[sys] = [];
          if (!systemPointMap[sys].find(p => p.id === s.point_id)) {
            systemPointMap[sys].push({ id: s.point_id, department: s.order_department });
          }
        }
      }

      // 预加载全部已有记录，按解析后的绝对路径归集：同一文件可能残留多条（跨类别/路径写法不同）
      const existingByPath = new Map();
      for (const r of db.prepare('SELECT id, file_path FROM spec_documents').all()) {
        const key = path.resolve(r.file_path);
        if (!existingByPath.has(key)) existingByPath.set(key, []);
        existingByPath.get(key).push(r.id);
      }

      const del = db.prepare('DELETE FROM spec_documents WHERE id=?');
      const ins = db.prepare(`INSERT INTO spec_documents
        (version, file_name, file_path, doc_type, archive_category, notes, matched_systems, matched_department, auto_matched)
        VALUES (?,?,?,?,?,?,?,?,?)`);
      const insPoint = db.prepare('INSERT OR IGNORE INTO spec_document_points (spec_id, point_id) VALUES (?,?)');

      const counts = { meeting_minutes: 0, signed_scan: 0, word_version: 0 };
      const skipped = [];
      let staleCount = 0;
      db.transaction(() => {
        // 先清理失效记录：磁盘文件已不在，其关联的需求点由外键级联删除
        for (const id of staleIds) del.run(id);
        staleCount = staleIds.length;

        for (const f of discovered) {
          const key = path.resolve(f.file_path);
          // 唯一一条归档记录：先删除该文件所有旧记录（不论原类别），再按新规则插入
          for (const id of existingByPath.get(key) || []) del.run(id);

          const isMeeting = f.category === 'meeting_minutes';
          const matchedSystems = isMeeting ? [] : matchSystemsInFileName(f.file_name, allSystems, aliasMap);
          // 匹配不到真实系统的文档不归档，避免出现「关联系统为 -」的假数据
          if (!isMeeting && !matchedSystems.length) {
            skipped.push(f.file_name);
            continue;
          }
          const matchedDepartments = isMeeting ? [] : matchDepartmentsInFileName(f.file_name, allDepartments);
          const autoMatched = matchedSystems.length > 0 ? 1 : 0;
          const notes = isMeeting ? path.basename(f.file_name, path.extname(f.file_name)) : '';
          const result = ins.run(version, f.file_name, f.file_path, f.docType, f.category,
            notes, matchedSystems.join(','), matchedDepartments.join(','), autoMatched);
          counts[f.category]++;
          if (autoMatched) {
            for (const sys of matchedSystems) {
              for (const p of (systemPointMap[sys] || [])) {
                if (!departmentMatches(matchedDepartments, p.department)) continue;
                insPoint.run(result.lastInsertRowid, p.id);
              }
            }
          }
        }
      })();

      const msg = `扫描完成：签字扫描件 ${counts.signed_scan} 份，word版本 ${counts.word_version} 个，评审会议纪要 ${counts.meeting_minutes} 份（每个文件仅保留一条归档记录，旧记录已按当前规则覆盖）`
        + (staleCount > 0 ? `；已清理 ${staleCount} 条文件已不存在的失效记录` : '')
        + (skipped.length ? `；跳过 ${skipped.length} 个未匹配到系统的文档（请改名包含系统名或系统别名）：${skipped.join('、')}` : '');
      res.json({ success: true, data: discovered, count: counts.word_version + counts.signed_scan,
        meeting_count: counts.meeting_minutes, counts, stale_count: staleCount,
        skipped, skipped_count: skipped.length, message: msg });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 评审会议纪要 — 删除（保留，树状图中可删除）
  // ============================================================
  app.delete('/api/specs/meetings/:id', (req, res) => {
    try {
      const db = getDatabase();
      const m = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='meeting_minutes'").get(req.params.id);
      if (!m) return res.status(404).json({ success: false, message: '会议纪要不存在' });
      if (m.file_path && fs.existsSync(m.file_path)) fs.unlinkSync(m.file_path);
      db.prepare('DELETE FROM spec_documents WHERE id=?').run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 需规文档下载 / 在线预览
  // ============================================================
  app.get('/api/specs/:id/download', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='spec_doc'").get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      if (!spec.file_path || !fs.existsSync(spec.file_path)) return sendFileMissing(res, spec.file_name, spec.file_path);
      res.download(spec.file_path, spec.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.get('/api/specs/:id/preview', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='spec_doc'").get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      if (!spec.file_path || !fs.existsSync(spec.file_path)) return sendFileMissing(res, spec.file_name, spec.file_path);
      sendFileInline(res, spec.file_path, spec.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ---- 需规文档智能打开 ----
  app.get('/api/specs/:id/open', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare("SELECT * FROM spec_documents WHERE id=? AND doc_type='spec_doc'").get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      handleFileOpen(req, res, spec.file_path, spec.file_name);
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  // ============================================================
  // 需规文档详情 / 匹配 / 删除
  // ============================================================
  app.get('/api/specs/:id', (req, res) => {
    try {
      const db = getDatabase();
      const spec = db.prepare('SELECT * FROM spec_documents WHERE id=?').get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      const points = db.prepare(`
        SELECT rp.*, ro.order_number, ro.name as order_name,
          cs.system as schedule_system, cs.version as schedule_version,
          cm.meeting_name, cm.meeting_date
        FROM spec_document_points sdp
        JOIN requirement_points rp ON sdp.point_id = rp.id
        JOIN requirement_orders ro ON rp.order_id = ro.id
        LEFT JOIN ccb_schedules cs ON cs.point_id = rp.id
        LEFT JOIN ccb_meetings cm ON cm.id = cs.meeting_id
        WHERE sdp.spec_id = ?
        ORDER BY ro.order_number, rp.point_number
      `).all(req.params.id);
      res.json({ success: true, data: { ...spec, points } });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.put('/api/specs/:id/match', (req, res) => {
    try {
      const db = getDatabase();
      const systems = realSystems(Array.isArray(req.body.systems) ? req.body.systems : []);
      if (!systems.length) return res.status(400).json({ success: false, message: '请至少选择一个真实系统，不允许无系统匹配' });
      const spec = db.prepare('SELECT * FROM spec_documents WHERE id=?').get(req.params.id);
      if (!spec) return res.status(404).json({ success: false, message: '需规文档不存在' });
      const matchedStr = systems.join(',');
      const specVs = config.expandNames('version', spec.version);
      const allScheduled = db.prepare(`
        SELECT cs.point_id, cs.system, ro.department AS order_department
        FROM ccb_schedules cs
        JOIN requirement_points rp ON rp.id = cs.point_id
        JOIN requirement_orders ro ON ro.id = rp.order_id
        WHERE cs.version IN (${specVs.map(() => '?').join(',')})`).all(...specVs);
      const systemPointMap = {};
      for (const s of allScheduled) {
        for (const sys of splitNames(s.system)) {
          if (!systemPointMap[sys]) systemPointMap[sys] = [];
          if (!systemPointMap[sys].find(p => p.id === s.point_id)) {
            systemPointMap[sys].push({ id: s.point_id, department: s.order_department });
          }
        }
      }
      const pointIds = new Set();
      for (const sys of systems) {
        for (const p of (systemPointMap[sys] || [])) {
          if (!departmentMatches(spec.matched_department, p.department)) continue;
          pointIds.add(p.id);
        }
      }
      db.transaction(() => {
        db.prepare("UPDATE spec_documents SET matched_systems=?, auto_matched=0, updated_at=datetime('now','localtime') WHERE id=?").run(matchedStr, req.params.id);
        db.prepare('DELETE FROM spec_document_points WHERE spec_id=?').run(req.params.id);
        const ins = db.prepare('INSERT OR IGNORE INTO spec_document_points (spec_id, point_id) VALUES (?,?)');
        for (const pid of pointIds) ins.run(req.params.id, pid);
      })();
      const deptNote = splitNames(spec.matched_department).length
        ? `（已按文档名中的部门「${spec.matched_department}」限定为该部门提出的需求单）` : '';
      res.json({ success: true, message: '手动匹配已更新，已关联 ' + pointIds.size + ' 个需求点' + deptNote + '（后续扫描将保留此匹配）' });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

  app.delete('/api/specs/:id', (req, res) => {
    try {
      const db = getDatabase();
      db.prepare("DELETE FROM spec_documents WHERE id=? AND doc_type='spec_doc'").run(req.params.id);
      res.json({ success: true });
    } catch (err) { res.status(500).json({ success: false, message: err.message }); }
  });

};
