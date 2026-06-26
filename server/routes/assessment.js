/**
 * 需求意向书评估表生成路由
 * 单订单生成、按会议批量生成
 */
const wordGenerator = require('../word-generator');
const { getDatabase } = require('../database');

module.exports = function (app) {

  // ---- 按需求单生成 ----
  app.post('/api/orders/:id/generate-assessment', (req, res) => {
    (async () => {
      try {
        const db = getDatabase();
        const orderId = parseInt(req.params.id);
        const result = await wordGenerator.generateAssessmentForOrder(orderId, null, db);
        if (!result.generated) return res.status(400).json({ success: false, message: result.message });
        res.json({ success: true, message: '生成成功', data: { file_name: result.file_name } });
      } catch (err) {
        console.error('生成文档失败:', err);
        res.status(500).json({ success: false, message: '生成失败：' + err.message });
      }
    })();
  });

  // ---- 按会议批量生成 ----
  app.post('/api/meetings/:meetingId/generate-assessments', (req, res) => {
    (async () => {
      try {
        const db = getDatabase();
        const meetingId = parseInt(req.params.meetingId);

        const orderRows = db.prepare('SELECT DISTINCT order_id FROM ccb_schedules WHERE meeting_id=?').all(meetingId);
        if (!orderRows || !orderRows.length) return res.status(400).json({ success: false, message: '该会议中暂无排期数据' });

        const results = [];
        for (const row of orderRows) {
          const result = await wordGenerator.generateAssessmentForOrder(row.order_id, meetingId, db);
          results.push(result);
        }

        const generated = results.filter(r => r.generated).length;
        const skipped = results.filter(r => !r.generated).length;

        res.json({
          success: true,
          message: `处理完成：成功生成 ${generated} 个，跳过 ${skipped} 个`,
          data: { results, generated, skipped }
        });
      } catch (err) {
        console.error('批量生成文档失败:', err);
        res.status(500).json({ success: false, message: '批量生成失败：' + err.message });
      }
    })();
  });

};
