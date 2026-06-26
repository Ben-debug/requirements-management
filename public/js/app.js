/**
 * 需求单信息管理系统 — 主入口
 *
 * 职责：
 * 1. 全局 state 定义
 * 2. 加载各个页面/功能模块
 * 3. 全局事件委托
 * 4. 注册所有 window 函数（供 HTML onclick 调用）
 */

// ============================================================
// 全局状态
// ============================================================
const state = {
  currentPage: 'orders', orders: [], currentOrder: null, meetings: [],
  editingOrderId: null, editingPointId: null, editingMeetingId: null, editingScheduleId: null,
  orderPage: 1, schedulePage: 1, specPage: 1
};

// ============================================================
// 页面模块均通过 <script> 标签加载到全局作用域，
// 此处负责将它们的函数注册到 window（供 HTML onclick 属性调用）
// ============================================================

// ---- config.js ----
window.loadConfig = loadConfig;
window.showAddConfig = showAddConfig;
window.addConfigItem = addConfigItem;
window.deleteConfigItem = deleteConfigItem;
window.loadPaths = loadPaths;
window.savePaths = savePaths;
window.onPathChange = onPathChange;
window.openFolderPicker = openFolderPicker;
window.browseDir = browseDir;
window.loadTemplateStatus = loadTemplateStatus;
window.uploadTemplate = uploadTemplate;
window.deleteTemplate = deleteTemplate;
window.loadDropdowns = loadDropdowns;
window.loadRelatedDeptCheckboxes = loadRelatedDeptCheckboxes;
window.onDeptChange = onDeptChange;

// ---- orders.js ----
window.loadOrders = loadOrders;
window.applyFilters = applyFilters;
window.onFilterChange = onFilterChange;
window.resetFilters = resetFilters;
window.gotoOrderPage = gotoOrderPage;
window.toggleOrderGroup = toggleOrderGroup;
window.showCreateOrder = showCreateOrder;
window.viewOrder = viewOrder;
window.editOrder = editOrder;
window.deleteOrder = deleteOrder;
window.showAddPoint = showAddPoint;
window.editPoint = editPoint;
window.deletePoint = deletePoint;
window.togglePointDesc = togglePointDesc;
window.updatePointBatchPreview = updatePointBatchPreview;
window.uploadFile = uploadFile;
window.deleteFile = deleteFile;
window.batchScheduleSubOrder = batchScheduleSubOrder;
window.confirmBatchSchedule = confirmBatchSchedule;
window.renderFiles = renderFiles;

// ---- meetings.js ----
window.loadMeetings = loadMeetings;
window.showCreateMeeting = showCreateMeeting;
window.editMeeting = editMeeting;
window.deleteMeeting = deleteMeeting;
window.uploadMeetingFile = uploadMeetingFile;
window.refreshMeetingFileDisplay = refreshMeetingFileDisplay;

// ---- schedules.js ----
window.viewMeeting = viewMeeting;
window.showScheduleModal = showScheduleModal;
window.confirmQuickSchedule = confirmQuickSchedule;
window.openEditScheduleModal = openEditScheduleModal;
window.confirmEditSchedule = confirmEditSchedule;
window.deleteScheduleFromDetail = deleteScheduleFromDetail;
window.deleteScheduleFromMeeting = deleteScheduleFromMeeting;
window.openEditScheduleModalFromMeeting = openEditScheduleModalFromMeeting;
window.batchGenerateAssessments = batchGenerateAssessments;
window.loadBatchScheduleTable = loadBatchScheduleTable;
window.saveBatchSchedules = saveBatchSchedules;
window.toggleScheduleOrder = toggleScheduleOrder;
window.toggleOrderPoints = toggleOrderPoints;
window.toggleBatchBody = toggleBatchBody;
window.toggleBatchPoints = toggleBatchPoints;
window.toggleBatchDesc = toggleBatchDesc;
window.loadScheduleFilter = loadScheduleFilter;
window.applyFilter = applyFilter;
window.resetFilter = resetFilter;
window.gotoSchedulePage = gotoSchedulePage;

// ---- files.js ----
window.loadFiles = loadFiles;
window.applyFileFilter = applyFileFilter;
window.resetFileFilter = resetFileFilter;
window.gotoFilePage = gotoFilePage;
window.deleteFileFromList = deleteFileFromList;

// ---- specs.js ----
window.loadSpecs = loadSpecs;
window.gotoSpectPage = gotoSpectPage;
window.scanSpecDocs = scanSpecDocs;
window.openSpecMatch = openSpecMatch;
window.confirmSpecMatch = confirmSpecMatch;
window.deleteSpec = deleteSpec;
window.toggleSpecPoints = toggleSpecPoints;

// ---- navigation.js ----
window.navigate = navigate;
window.switchTab = switchTab;
window.switchMeetingTab = switchTab;   // 别名：HTML 中用的 switchMeetingTab
window.switchDetailTab = switchDetailTab;

// ---- import-export.js ----
window.exportExcel = exportExcel;
window.exportFiltered = exportFiltered;
window.doExport = doExport;
window.importExcel = importExcel;
window.downloadTemplate = downloadTemplate;

// ---- search.js ----
window.doGlobalSearch = doGlobalSearch;
window.closeSearchAndView = closeSearchAndView;

// ---- renderers.js ----
window.renderPagination = renderPagination;
window.renderScheduledCard = renderScheduledCard;
window.renderScheduleHierarchy = renderScheduleHierarchy;
window.renderScheduleResultsGrouped = renderScheduleResultsGrouped;
