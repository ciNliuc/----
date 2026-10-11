/* ════════════════════════════════════════════════════════════════
   src/core.timeline.js   ← 全局事件时间线
   负责人：框架负责人
   对外：App.log(text, opts)   ← 各模块往时间线追加一条（contract.md §2）
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var MAX_ROWS = 60;   /* 防止刷屏把底栏撑爆 */

  /**
   * 往时间线追加一条记录
   * @param {string} text  文案
   * @param {object} [opts] { hi: true } 高亮（用于"自动升级"这类爆点）
   */
  App.log = function (text, opts) {
    var list = App.el('timeline');
    if (!list) return;

    var li = document.createElement('li');
    if (opts && opts.hi) li.className = 'hi';

    var stamp = App.fmtTime(App.state.elapsedMs) ;
    li.innerHTML = '<b>[' + stamp + ']</b> ' + App.esc(text);

    list.appendChild(li);

    /* 只保留最近 MAX_ROWS 条 */
    while (list.children.length > MAX_ROWS) list.removeChild(list.firstChild);

    /* 自动滚到底 */
    list.scrollTop = list.scrollHeight;

    /* 同时留在数据里，方便复盘 */
    App.DATA.timeline.push({ t: stamp, text: text });
  };

  /* ───────── 关键阶段自动打点 ─────────
     各模块自己的业务日志请自行调用 App.log，
     这里只记录"阶段变更"本身，不重复业务动作。 */
  var AUTO_LOG = {
    SOS_TRIGGERED:     ['用户按下求助按钮', false],
    INSTITUTION_ALERT: ['平台推送告警至属地专业机构', false],
    AUTO_ESCALATE:     ['⚠ 机构未在时限内确认，系统自动升级', true],
    VIDEO_SESSION:     ['进入视频疏导', false],
    ON_SITE:           ['志愿者已到达现场', true],
    CLOSED:            ['本次事件闭环，进入回访', false]
  };

  App.on('stage:change', function (e) {
    var row = AUTO_LOG[e.to];
    if (row) App.log(row[0], { hi: row[1] });
  });

  /* 重置时清空数据层记录 */
  App.on('app:reset', function () {
    App.DATA.timeline.length = 0;
  });

})();
