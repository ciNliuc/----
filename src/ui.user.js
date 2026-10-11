/* ════════════════════════════════════════════════════════════════
   src/ui.user.js   ← ① 求助者本人（宫格左上）
   负责人：A
   契约：contract.md §3 §4 §5      调试：App.jump('AUTO_ESCALATE')
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  /* ───────── 各阶段文案 ───────── */
  var STEPS = ['发起求助', '机构响应', '家属响应', '志愿者到场'];

  function stepBar(current) {
    return '<div class="steps">' + STEPS.map(function (s, i) {
      var cls = i < current ? 'done' : (i === current ? 'now' : '');
      return '<div class="step ' + cls + '"><i></i><span>' + App.esc(s) + '</span></div>';
    }).join('') + '</div>';
  }

  var TEXT = {
    SOS_TRIGGERED:     '已发出求助，正在联系…',
    INSTITUTION_ALERT: '专业机构正在接入…',
    AUTO_ESCALATE:     '已同时通知家人与附近志愿者',
    VIDEO_SESSION:     '有人正在陪你，别挂断',
    ON_SITE:           '志愿者正在赶来 / 已到楼下',
    CLOSED:            '已联系上，本次求助结束'
  };

  App.define('user', function (state) {
    var s = state.stage;

    /* ── 待机：大按钮 ── */
    if (s === 'IDLE') {
      return {
        badge: '待机', tone: null,
        html:
          '<div class="screen-title">如果你正在犹豫</div>' +
          '<div class="screen-sub">按下去就行，不用打一个字</div>' +
          '<div class="grow center">' +
            '<button id="btn-sos" class="sos-btn">' +
              '<span class="sos-ring"></span>' +
              '<span class="sos-text">我需要<br>帮助</span>' +
            '</button>' +
          '</div>' +
          '<div class="tiny dim center">' + App.esc(D.user.address) + '</div>' +
          '<div class="tiny dim center">长按 3 秒同样可以求助</div>'
      };
    }

    /* ── 已求助 ── */
    var stepIdx = { SOS_TRIGGERED: 0, INSTITUTION_ALERT: 1, AUTO_ESCALATE: 2 }[s];
    if (stepIdx == null) stepIdx = 3;

    return {
      badge: s === 'CLOSED' ? '已闭环' : '求助中',
      tone:  s === 'CLOSED' ? 'ok' : 'danger',
      html:
        '<div class="screen-title">' + App.esc(TEXT[s] || '处理中') + '</div>' +
        '<div class="grow center col" style="gap:12px">' +
          '<div class="pulse-dot big"></div>' +
          '<div class="tiny dim center">你的位置已发送给响应者</div>' +
        '</div>' +
        stepBar(stepIdx) +
        '<button id="btn-call110" class="ghost-btn">拨打 110 / 120（兜底）</button>' +
        '<div class="tiny dim center">本演示不会真的拨号</div>'
    };
  });

  /* ───────── 交互 ───────── */
  App.delegate('user', '#btn-sos', 'sos:tap', function () {
    App.log('用户按下「我需要帮助」', { hi: true });
    App.emit('sos:tap', { at: Date.now() });
    App.next();                       /* IDLE → SOS_TRIGGERED */
  });

  App.delegate('user', '#btn-call110', 'user:callFallback', function () {
    App.log('（演示）用户点击兜底拨号，真实产品此处直接呼出');
  });

  console.log('[ui.user] 已注册');
})();
