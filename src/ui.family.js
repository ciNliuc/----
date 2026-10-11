/* ════════════════════════════════════════════════════════════════
   src/ui.family.js   ← ③ 紧急联系人 · 家人（宫格左下）
   负责人：C
   契约：contract.md §3 §4 §5      调试：App.jump('AUTO_ESCALATE')
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  var answered = false;      /* 家属是否已应答 */
  var choice   = null;

  /* ───────── 语音播报文案 ───────── */
  function announceText() {
    return '您好，这里是社区关怀中心。您登记的家人' + D.user.name +
           '刚刚发起了紧急求助，位置在' + D.user.address +
           '。请现在联系他，或者立即赶过去。';
  }

  /* ───────── 未登记分支 ───────── */
  function unregisteredHTML() {
    return '<div class="screen-title">无登记信息</div>' +
      '<div class="grow center col" style="gap:10px">' +
        '<div style="font-size:34px">📭</div>' +
        '<div class="tiny dim center">该求助者未登记紧急联系人</div>' +
      '</div>' +
      '<div class="card blue">' +
        '<div class="card-title">已自动改派</div>' +
        '<div class="card-body">系统已改为联系其位置附近的志愿者</div>' +
      '</div>' +
      '<div class="tiny dim center">当前号码未被呼叫</div>';
  }

  /* ───────── 来电界面 ───────── */
  function incomingHTML() {
    return '<div class="call-screen">' +
        '<div class="tiny dim">来电</div>' +
        '<div class="caller">' + App.esc(D.institution.name) + '</div>' +
        '<div class="tiny dim">系统自动通知 · 非人工坐席</div>' +
        '<div class="grow center col" style="gap:14px">' +
          '<div class="wave"><i></i><i></i><i></i><i></i><i></i></div>' +
          '<div class="tiny" style="color:#e3b341">呼出中…</div>' +
        '</div>' +
        '<div class="tiny dim center">' + App.esc(D.family.name) + '　' +
          App.esc((D.contacts.find(function (c) { return c.name === D.family.name; }) || {}).relation || '') +
        '</div>' +
      '</div>';
  }

  function connectedHTML() {
    var sub = { call: '正在联系求助者', goto: '正在赶往现场', unreachable: '暂时无法接通' }[choice];
    return '<div class="call-screen connected">' +
        '<div class="tiny dim">已接通 · 系统语音播报</div>' +
        '<div class="caller">' + App.esc(D.institution.name) + '</div>' +
        '<div class="grow center col" style="gap:10px">' +
          '<div class="card blue" style="text-align:left">' +
            '<div class="card-body">' + App.esc(announceText()) + '</div>' +
          '</div>' +
          (choice ? '<div class="card ok"><div class="card-title">您的选择：' + App.esc(sub) + '</div></div>' : '') +
        '</div>' +
        (choice ? '' :
          '<div class="col" style="gap:8px">' +
            '<button id="btn-f-call" class="primary-btn">我现在就联系他</button>' +
            '<button id="btn-f-goto" class="primary-btn warn">我马上赶过去</button>' +
            '<button id="btn-f-no"   class="ghost-btn">暂时无法接通</button>' +
          '</div>') +
      '</div>';
  }

  /* ───────── 渲染 ───────── */
  App.define('family', function (state) {
    var s = state.stage;

    if (s === 'IDLE' || s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      return {
        badge: '待机', tone: null,
        html:
          '<div class="screen-title">' + App.esc(D.family.name) + ' 的手机</div>' +
          '<div class="tiny dim">已登记为' + App.esc(D.user.name) + '的紧急联系人' +
            '（登记时已确认同意）</div>' +
          '<div class="grow center col" style="gap:8px">' +
            '<div class="tiny dim">暂无来电</div>' +
          '</div>' +
          '<div class="tiny dim center">锁定屏幕</div>'
      };
    }

    /* 自动升级 → 系统自动外呼家属（未登记则跳过） */
    if (s === 'AUTO_ESCALATE') {
      if (!D.user.registered) {
        return { badge: '未呼叫', tone: null, html: unregisteredHTML() };
      }
      return {
        badge: answered ? '已应答' : '● 呼出中',
        tone:  answered ? 'ok' : 'danger',
        html:  answered ? connectedHTML() : incomingHTML()
      };
    }

    /* 之后阶段：保持已接通态 */
    if (!D.user.registered) {
      return { badge: '未呼叫', tone: null, html: unregisteredHTML() };
    }

    return {
      badge: answered ? '已应答' : '已通知',
      tone:  'ok',
      html:  answered ? connectedHTML()
        : '<div class="screen-title">系统已通知家属</div>' +
          '<div class="grow center col" style="gap:8px">' +
            '<div class="tiny dim">' + App.esc(D.family.name) + ' 正在响应</div>' +
          '</div>'
    };
  });

  /* ───────── 自动升级时播报（contract.md §5） ───────── */
  App.on('escalate:auto', function () {
    if (!D.user.registered) return;
    answered = false;
    choice   = null;
    App.log('系统自动外呼紧急联系人：' + D.family.name, { hi: true });
    App.speak(announceText());
    /* 播报后自动标记接通，让演示继续往下走 */
    setTimeout(function () {
      if (App.state.stage === 'AUTO_ESCALATE' && D.user.registered) {
        answered = true;
        App.render('family');
      }
    }, (C.FAMILY_CALL_SEC || 15) * 1000 * 0.55);
  });

  /* ───────── 交互 ───────── */
  function pick(c, label) {
    choice = c;
    answered = true;
    App.speakStop();
    App.log('家属响应：' + label, { hi: true });
    App.emit('family:answer', { choice: c });
    App.render('family');
  }

  App.delegate('family', '#btn-f-call', 'f:call', function () { pick('call', '我现在就联系他'); });
  App.delegate('family', '#btn-f-goto', 'f:goto', function () { pick('goto', '我马上赶过去'); });
  App.delegate('family', '#btn-f-no',   'f:no',   function () { pick('unreachable', '暂时无法接通'); });

  App.on('app:reset', function () {
    answered = false;
    choice   = null;
    App.speakStop();
  });

  console.log('[ui.family] 已注册');
})();
