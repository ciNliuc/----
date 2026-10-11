/* ════════════════════════════════════════════════════════════════
   src/ui.report.js   ← 收尾：回访卡片 + 数据小结
   负责人：B
   对外：无（订阅 stage:change，进入 CLOSED 时展示）
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  function buildHTML() {
    var used = App.fmtTime(App.state.elapsedMs);

    /* 从时间线里统计响应链条 */
    var rows = D.timeline.map(function (r) {
      return '<div class="rep-row"><span class="mono dim">[' + App.esc(r.t) + ']</span>' +
             '<span>' + App.esc(r.text) + '</span></div>';
    }).join('') || '<div class="tiny dim">（无记录）</div>';

    return '<div class="report-card">' +
        '<div class="rep-hi">🤝 已经有人在他身边</div>' +
        '<div class="rep-sub">从按下按钮到响应完成，共用时 <b class="mono">' + used + '</b></div>' +

        '<div class="rep-metrics">' +
          metric('响应角色', '4 方', '求助者 / 机构 / 家属 / 志愿者') +
          metric('紧急联系人', D.user.registered ? D.contacts.length + ' 位' : '未登记', '登记时已确认同意') +
          metric('志愿者', D.volunteers[0].name, D.volunteers[0].distance + 'km 内自动匹配') +
          metric('响应方式', '视频 + 到场', '远程优先，到场留痕') +
        '</div>' +

        '<div class="rep-timeline">' + rows + '</div>' +

        '<div class="rep-note tiny">' +
          '真实产品中，每次求助 24 小时内必须回访；志愿者处置后 48 小时内推送心理支持。' +
        '</div>' +

        '<button id="btn-rep-close" class="ctrl">↺ 重置，再来一次</button>' +
      '</div>';
  }

  function metric(label, value, sub) {
    return '<div class="rep-metric">' +
             '<div class="tiny dim">' + App.esc(label) + '</div>' +
             '<div class="rep-value">' + App.esc(value) + '</div>' +
             '<div class="tiny dim">' + App.esc(sub) + '</div>' +
           '</div>';
  }

  App.showReport = function () {
    var ov = App.el('report-overlay');
    if (!ov) return;
    ov.innerHTML = buildHTML();
    ov.classList.remove('hidden');

    var btn = App.el('btn-rep-close');
    if (btn) btn.addEventListener('click', function () { App.reset(); });
  };

  App.on('stage:change', function (e) {
    if (e.to === 'CLOSED') App.showReport();
  });

  App.on('app:reset', function () {
    var ov = App.el('report-overlay');
    if (ov) { ov.classList.add('hidden'); ov.innerHTML = ''; }
  });

  console.log('[ui.report] 已注册');
})();
