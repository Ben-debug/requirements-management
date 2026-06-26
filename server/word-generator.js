const path = require('path');
const fs = require('fs');
const JSZip = require('jszip');
const config = require('./config');

const TEMPLATE_FILENAME = '意向书评估表模板.docx';

/** XML 转义 */
function xmlEscape(str) {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * 合并同一段落内相邻的 <w:t> 文本，确保占位符不被拆散
 */
function coalesceTextRuns(xml, placeholderPattern) {
  const regex = placeholderPattern || /\[[一-鿿\w]+\]/;
  return xml.replace(/<w:p\b[^>]*>[\s\S]*?<\/w:p>/g, pMatch => {
    const tRegex = /<w:t[^>]*>([\s\S]*?)<\/w:t>/g;
    const runs = [];
    let tMatch;
    while ((tMatch = tRegex.exec(pMatch)) !== null) {
      runs.push(tMatch[1]);
    }
    const combined = runs.join('');
    if (!regex.test(combined)) return pMatch;
    const pPrMatch = pMatch.match(/<w:pPr[\s\S]*?<\/w:pPr>/);
    const pPr = pPrMatch ? pPrMatch[0] : '';
    const rPrMatch = pMatch.match(/<w:rPr[\s\S]*?<\/w:rPr>/);
    const rPr = rPrMatch ? rPrMatch[0] : '';
    return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${combined}</w:t></w:r></w:p>`;
  });
}

/**
 * 在 docx XML 中处理多段落占位符替换
 */
function expandMultiParagraphInXml(xml, placeholder, values) {
  if (!values || values.length === 0) {
    const escPH = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return xml.replace(new RegExp(`<w:p[^>]*>(?:(?!<\\/w:p>)[\\s\\S])*?\\[${escPH}\\](?:(?!<\\/w:p>)[\\s\\S])*?<\\/w:p>`, 'g'), '');
  }
  if (values.length === 1) {
    return xml.split(`[${placeholder}]`).join(xmlEscape(values[0]));
  }
  const escapeRegex = placeholder.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pRegex = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;
  let result = '';
  let lastIdx = 0;
  let match;
  while ((match = pRegex.exec(xml)) !== null) {
    if (match[0].includes(`[${placeholder}]`)) {
      result += xml.slice(lastIdx, match.index);
      const origP = match[0];
      const pPrMatch = origP.match(/<w:pPr[\s\S]*?<\/w:pPr>/);
      const pPr = pPrMatch ? pPrMatch[0] : '';
      const firstRunMatch = origP.match(/<w:r\b[^>]*>[\s\S]*?<\/w:r>/);
      const runTemplate = firstRunMatch ? firstRunMatch[0] : '<w:r><w:t></w:t></w:r>';
      const newRun = runTemplate.replace(/<w:t[^>]*>[\s\S]*?<\/w:t>/, () => '<w:t xml:space="preserve">__VAL__</w:t>');
      const newParagraphs = values.map(v => {
        const escaped = xmlEscape(v);
        return `<w:p>${pPr}${newRun.replace('__VAL__', escaped)}</w:p>`;
      });
      result += newParagraphs.join('');
      lastIdx = match.index + match[0].length;
    }
  }
  result += xml.slice(lastIdx);
  return result;
}

/**
 * 读取 Word 模板，替换占位符，生成新的 docx 文件
 */
async function generateAssessmentDoc(templatePath, outputPath, simpleData, multiParagraphValues) {
  const templateBuf = fs.readFileSync(templatePath);
  const zip = await JSZip.loadAsync(templateBuf);

  const xmlFiles = ['word/document.xml'];
  for (const name of Object.keys(zip.files)) {
    if (/^word\/(header|footer)\d+\.xml$/.test(name)) {
      xmlFiles.push(name);
    }
  }

  const phKeys = Object.keys(simpleData).filter(k => k !== '需求点描述');
  phKeys.push('需求点描述');
  const phPattern = new RegExp(phKeys.map(k => `\\[${k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`).join('|'));

  for (const xmlPath of xmlFiles) {
    const file = zip.file(xmlPath);
    if (!file) continue;
    let content = await file.async('string');
    content = coalesceTextRuns(content, phPattern);
    if (multiParagraphValues !== undefined) {
      content = expandMultiParagraphInXml(content, '需求点描述', multiParagraphValues);
      delete simpleData['需求点描述'];
    }
    for (const [key, value] of Object.entries(simpleData)) {
      if (value == null) continue;
      content = content.split(`[${key}]`).join(xmlEscape(String(value)));
    }
    zip.file(xmlPath, content);
  }

  const outData = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(outputPath, outData);
}

/** 获取模板目录路径 */
function getTemplateDir() {
  const customDataDir = config.getPath('data_dir');
  if (customDataDir) {
    const dir = path.join(customDataDir, 'templates');
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  }
  const rootDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
  const base = process.pkg ? path.join(path.dirname(process.execPath), 'data') : path.join(rootDir, 'data');
  const dir = path.join(base, 'templates');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 获取流转文件目录路径 */
function getFlowFileDir() {
  const custom = config.getPath('flow_files_dir');
  if (custom) return custom;
  const rootDir = process.pkg ? path.dirname(process.execPath) : path.join(__dirname, '..');
  return path.join(rootDir, 'public', 'uploads', 'flow_files');
}

/**
 * 为单个需求单生成意向书评估表
 */
async function generateAssessmentForOrder(orderId, meetingId, db) {
  const order = db.prepare('SELECT * FROM requirement_orders WHERE id=?').get(orderId);
  if (!order) return { generated: false, message: '需求单不存在' };

  const templatePath = path.join(getTemplateDir(), TEMPLATE_FILENAME);
  if (!fs.existsSync(templatePath)) return { generated: false, message: '请先上传 Word 模板（参数配置 → 模板管理）' };

  if (meetingId) {
    const existing = db.prepare("SELECT id, file_path FROM flow_files WHERE order_id=? AND file_type='需求意向书及评估表'").get(orderId);
    if (existing) {
      if (fs.existsSync(existing.file_path)) {
        return { generated: false, message: `"${order.order_number}-${order.name}" 已存在，跳过` };
      }
      db.prepare("DELETE FROM flow_files WHERE id=?").run(existing.id);
    }
  }

  let points, schedules;
  if (meetingId) {
    points = db.prepare(`SELECT rp.* FROM requirement_points rp
      JOIN ccb_schedules cs ON cs.point_id=rp.id
      WHERE rp.order_id=? AND cs.meeting_id=? ORDER BY rp.point_number`).all(orderId, meetingId);
    schedules = db.prepare(`SELECT cs.*, cm.meeting_name, cm.meeting_date
      FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id
      WHERE cs.order_id=? AND cs.meeting_id=?`).all(orderId, meetingId);
  } else {
    points = db.prepare('SELECT * FROM requirement_points WHERE order_id=? ORDER BY point_number').all(orderId);
    schedules = db.prepare(`SELECT cs.*, cm.meeting_name, cm.meeting_date
      FROM ccb_schedules cs JOIN ccb_meetings cm ON cs.meeting_id=cm.id
      WHERE cs.order_id=?`).all(orderId);
  }

  if (meetingId && (!schedules || !schedules.length)) {
    return { generated: false, message: `"${order.order_number}-${order.name}" 在该会议中无排期，跳过` };
  }

  const data = {
    '需求单编号': order.order_number || '',
    '需求单名称': order.name || '',
    '提出背景': order.background || '',
  };

  if (schedules && schedules.length > 0) {
    const systemsSet = new Set();
    const versionsSet = new Set();
    schedules.forEach(s => {
      if (s.system) s.system.split(',').filter(Boolean).forEach(sys => systemsSet.add(sys.trim()));
      if (s.version) versionsSet.add(s.version.trim());
    });
    data['涉及系统'] = Array.from(systemsSet).join('、') || '';
    data['排期版本'] = Array.from(versionsSet).join('、') || '';
    const sorted = [...schedules].sort((a, b) => (a.meeting_date < b.meeting_date) ? 1 : (a.meeting_date > b.meeting_date ? -1 : 0));
    data['会议日期'] = sorted[0].meeting_date || '';
  } else {
    data['涉及系统'] = '';
    data['排期版本'] = '';
    data['会议日期'] = '';
  }

  const pointDescriptions = points.filter(p => p.description).map(p => p.description.trim());
  const safeName = (order.name || '未命名').replace(/[<>:"/\\|?*]/g, '_');
  const outputFileName = `【需求意向书及评估表】${order.order_number}-${safeName}.docx`;

  const flowDir = getFlowFileDir();
  if (!fs.existsSync(flowDir)) fs.mkdirSync(flowDir, { recursive: true });

  let destPath = path.join(flowDir, outputFileName);
  let counter = 1;
  while (fs.existsSync(destPath)) {
    const ext = path.extname(outputFileName);
    const base = path.basename(outputFileName, ext);
    destPath = path.join(flowDir, `${base}(${counter++})${ext}`);
  }

  await generateAssessmentDoc(templatePath, destPath, data, pointDescriptions);

  db.prepare('INSERT INTO flow_files (order_id,file_type,original_name,stored_name,file_path) VALUES (?,?,?,?,?)')
    .run(orderId, '需求意向书及评估表', outputFileName, path.basename(destPath), destPath);

  return { generated: true, file_name: outputFileName, message: `"${order.order_number}-${order.name}" 生成成功` };
}

module.exports = {
  generateAssessmentForOrder,
  getTemplateDir,
  getFlowFileDir,
  TEMPLATE_FILENAME,
};
