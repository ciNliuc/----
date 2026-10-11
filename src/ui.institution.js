/* ════════════════════════════════════════════════════════════════
   src/ui.institution.js   ← ② 专业机构 · 社区服务（宫格右上）
   负责人：B
   契约：contract.md §3 §4 §5      调试：App.jump('INSTITUTION_ALERT')
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  /* 机构确认倒计时由本模块自己维护（渲染用的剩余秒数） */
  var ackLeft   = null;
  var ackTimer  = null;

  function clearAck() {
    if (ackTimer) { clearInterval(ackTimer); ackTimer = null; }
    ackLeft = null;
  }

  function startAck() {
    clearAck();
    ackLeft = C.INSTITUTION_ACK_SEC;
    ackTimer = setInterval(function () {
      ackLeft--;
      App.render('institution');
      if (ackLeft <= 0) { clearAck(); App.render('institution'); }
    }, 1000);
  }

  /* 用户的档案卡：已登记 / 未登记 两种 */
  function profileCard() {
    if (!D.user.registered) {
      return card('warn', '⚠ 未登记用户',
        '系统未找到该用户的紧急联系人档案<br>' +
        '<b>已自动改派附近志愿者</b>');
    }
    return card('ok', '✓ 已登记用户',
      '紧急联系人 <b>' + D.contacts.length + '</b> 位（登记时已确认同意）<br>' +
      D.contacts.map(function (c) {
        return '· ' + App.esc(c.name) + '（' + App.esc(c.relation) + '）' + App.esc(c.phone);
      }).join('<br>'));
  }

  function card(tone, title, body) {
    return '<div class="card ' + tone + '">' +
             '<div class="card-title">' + title + '</div>' +
             '<div class="card-body">' + body + '</div>' +
           '</div>';
  }

  App.define('institution', function (state) {
    var s = state.stage;

    /* ── 待机 ── */
    if (s === 'IDLE') {
      return {
        badge: '在线待机', tone: 'ok',
        html:
          '<div class="screen-title">' + App.esc(D.institution.name) + '</div>' +
          '<div class="tiny dim">值班中 · 热线 ' + App.esc(D.institution.hotline) + '</div>' +
          '<div class="grow center col" style="gap:8px">' +
            '<div class="tiny dim">暂无待处理的求助工单</div>' +
          '</div>' +
          '<div class="tiny dim center">等待平台推送…</div>'
      };
    }

    /* ── 刚收到告警：确认倒计时中 ── */
    if (s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      if (s === 'INSTITUTION_ALERT' && ackLeft == null) startAck();
      var left = (ackLeft == null) ? C.INSTITUTION_ACK_SEC : ackLeft;
      var pct  = Math.max(0, left / C.INSTITUTION_ACK_SEC) * 100;

      return {
        badge: '● 告警', tone: 'danger',
        html:
          '<div class="alarm">🔔 收到求助工单</div>' +
          '<div class="screen-title">' + App.esc(D.user.name) + '</div>' +
          '<div class="tiny dim">' + App.esc(D.user.address) + '</div>' +
          '<div class="mono tiny dim">坐标 ' + D.user.location.join(', ') + '</div>' +

          '<div class="countdown-block">' +
            '<div class="tiny">等待值班人员确认</div>' +
            '<div class="big-num" style="color:#e3b341">' + left + 's</div>' +
            '<div class="bar"><i style="width:' + pct + '%"></i></div>' +
            '<div class="tiny dim">超时未确认将自动升级</div>' +
          '</div>' +

          '<button id="btn-ack" class="primary-btn">立即确认接手</button>' +
          profileCard()
      };
    }

    /* ── 已自动升级 ── */
    if (s === 'AUTO_ESCALATE') {
      return {
        badge: '超时', tone: 'warn',
        html:
          '<div class="alarm warn">⚡ 自动升级已触发</div>' +
          '<div class="screen-title">值班人员未及时确认</div>' +
          '<div class="tiny dim">系统已代为执行：</div>' +
          card('danger', '① 自动联系紧急联系人',
            D.user.registered
              ? D.contacts.map(function (c) {
                  return '· ' + App.esc(c.name) + '（' + App.esc(c.relation) + '）外呼中';
                }).join('<br>')
              : '无登记联系人，已跳过') +
          card('blue', '② 自动派单最近志愿者',
            D.volunteers.map(function (v, i) {
              return (i === 0 ? '→ ' : '· ') + App.esc(v.name) +
                     '　' + v.distance + 'km' + (i === 0 ? '（已派单）' : '');
            }).join('<br>')) +
          profileCard()
      };
    }

    /* ── 收尾 ── */
    return {
      badge: s === 'CLOSED' ? '已闭环' : '处理中',
      tone:  s === 'CLOSED' ? 'ok' : 'warn',
      html:
        '<div class="screen-title">事件处理中</div>' +
        '<div class="grow center col" style="gap:8px">' +
          '<div class="tiny dim">' + App.esc(D.user.name) + ' · ' + App.esc(D.user.address) + '</div>' +
          (s === 'ON_SITE' ? '<div class="card ok"><div class="card-title">志愿者已到现场</div></div>' : '') +
        '</div>' +
        profileCard()
    };
  });

  /* ───────── 交互 ───────── */
  App.delegate('institution', '#btn-ack', 'institution:ack', function () {
    clearAck();
    App.log('值班人员已确认接手（未触发自动升级）', { hi: true });
    App.emit('institution:ack', { at: Date.now() });
  });

  /* 离开告警阶段就停表，避免定时器泄漏 */
  App.on('stage:change', function (e) {
    if (e.to !== 'SOS_TRIGGERED' && e.to !== 'INSTITUTION_ALERT') clearAck();
  });

  App.on('app:reset', clearAck);

  console.log('[ui.institution] 已注册');
})();
