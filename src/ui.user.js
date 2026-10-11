/* ════════════════════════════════════════════════════════════════
   src/ui.user.js   ← ① 求助者本人（宫格左上）
   负责人：A（本文件的唯一负责人，其他人不要改）

   契约：src/contract.md §3 DOM 约定 / §4 注册契约 / §5 事件表 / §6 常量
   调试：App.jump('SOS_TRIGGERED') … App.jump('CLOSED')，App.reset()

   ── 本文件覆盖的需求（需求.md §4.1）────────────────────────────
     UI-01  大号圆形「我需要帮助」按钮（呼吸灯）           P0  ✅
     UI-02  倒计时圆环 + 可取消窗口                        P0  ✅
     UI-03  状态文案区（4 段状态随阶段推进）               P0  ✅
     UI-04  四步进度条：发起→机构→家属→志愿者到场         P1  ✅
     UI-05  兜底按钮「拨打 110 / 120」（不真拨号）         P1  ✅
     UI-06  定位显示「已获取您的位置」                     P1  ✅

   ── 契约纪律（重要）────────────────────────────────────────
     · render 是纯函数：只读 state，只写 #user-badge / #user-screen
     · **不自己改阶段**：取消窗口走完只 emit('sos:tap')，
       由 core.state.js 订阅后推进到 SOS_TRIGGERED（contract.md §1 §5）
     · 不在 render 里起计时器：所有计时器只在交互回调里起
     · 不新增事件名：只 emit 契约 §5 已冻结的 sos:tap
     · 跨模块不直接用别人的数据 —— 读 App.DATA / App.state 只读快照
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  /* ═══════════ 模块私有状态（只影响本格渲染） ═══════════ */

  /* 取消窗口：UI-02。演示为 1 秒（C.CANCEL_WINDOW_SEC），真实产品 3 秒 */
  var WINDOW_MS = Math.max(200, (C.CANCEL_WINDOW_SEC || 1) * 1000);
  /* 长按求助：UI-01 提到的"长按"。演示压缩为 1.2 秒，太快容易被误触 */
  var HOLD_MS   = 1200;

  var pending = false;   /* 是否处于「已按下、仍在可取消窗口内」 */
  var leftMs  = 0;       /* 窗口剩余毫秒（驱动圆环进度） */
  var timer   = null;    /* 取消窗口计时器 */
  var hold    = null;    /* 长按计时器 */

  function clearTimer() { if (timer) { clearInterval(timer); timer = null; } }
  function clearHold()  { if (hold)  { clearTimeout(hold);   hold  = null; } }

  /* ═══════════ UI-04 四步进度条 ═══════════
     4 步（需求.md UI-04）：发起 → 机构响应 → 家属响应 → 志愿者到场
     下面把 7 个阶段映射到 4 步：
       发起求助 0 · 机构响应 1 · 家属响应 2 · 志愿者到场 3
     注意 volunteer:accept 只改 state 不改阶段，所以这里会出现
     "阶段仍是 AUTO_ESCALATE，但志愿者已接单" 的情形 —— 单独文案处理。 */
  var STEPS = ['发起求助', '机构响应', '家属响应', '志愿者到场'];

  function stepBar(current) {
    return '<div class="steps">' + STEPS.map(function (s, i) {
      var cls = i < current ? 'done' : (i === current ? 'now' : '');
      return '<div class="step ' + cls + '"><i></i><span>' + App.esc(s) + '</span></div>';
    }).join('') + '</div>';
  }

  /* ═══════════ 辅助判断（只读 App 上的快照） ═══════════ */

  /* 是否已登记紧急联系人（契约 §7：agreed 表示登记时已确认同意） */
  function familyCount() {
    if (!D.user.registered) return 0;
    return (D.contacts || []).filter(function (c) { return c.agreed !== false; }).length;
  }

  /* 志愿者是否已接单（由 D 模块 emit('volunteer:accept') 写入 state） */
  function volunteerAccepted() {
    return !!(App.state.volunteer && App.state.volunteer.accepted);
  }

  function volunteerName() {
    var v = App.state.volunteer;
    if (v && v.name) return v.name;
    return (D.volunteers && D.volunteers[0] && D.volunteers[0].name) || '志愿者';
  }

  /* ═══════════ UI-03 状态文案区（七阶段全覆盖，不缺格） ═══════════
     需求.md UI-03 规定的四段主文案：
       「正在联系…」→「已联系到家属」→「志愿者正在赶来」→「志愿者已到达」 */
  function statusTitle(s) {
    var n = familyCount();

    switch (s) {
      case 'SOS_TRIGGERED':
        return '正在联系…';

      case 'INSTITUTION_ALERT':
        return '专业机构正在接入…';

      case 'AUTO_ESCALATE':
        /* 未登记分支：契约 §5 FR-05，跳过家属直接派志愿者 */
        if (n > 0) return '已联系到 ' + n + ' 位家属';
        return '已联系附近志愿者';

      case 'VIDEO_SESSION':
        return volunteerAccepted() ? '志愿者正在赶来' : '正在为你接通志愿者…';

      case 'ON_SITE':
        return '志愿者已到达';

      case 'CLOSED':
        return '已有人在你身边';

      default:
        return '处理中…';
    }
  }

  /* UI-06 定位显示：从"已获取"到"已发送"，比一句静态文案更有过程感 */
  function locationLine(s) {
    if (s === 'SOS_TRIGGERED') return '📍 已获取您的位置，正在发送…';
    if (s === 'CLOSED')        return '📍 ' + D.user.address;
    return '📍 位置已发送给响应者';
  }

  /* ═══════════ 各阶段附加内容 ═══════════ */

  /* UI-05 兜底按钮：仅展示，绝不真拨号（需求.md §1.2 红线） */
  function fallbackHTML() {
    return '<button id="btn-call110" class="ghost-btn">拨打 110 / 120（兜底）</button>' +
           '<div class="tiny dim center">演示不会真的拨号</div>';
  }

  /* 进行中的脉冲主体 */
  function pulseHTML(s) {
    return '<div class="pulse-dot big"></div>' +
           '<div class="tiny dim center">' + App.esc(locationLine(s)) + '</div>';
  }

  /* ═══════════ 渲染（contract.md §4：纯函数，返回 {badge, tone, html}） ═══════════ */
  App.define('user', function (state) {
    var s = state.stage;

    /* ───────── IDLE：分「待机」与「可取消窗口」两态 ─────────
       UI-01 大按钮 + UI-02 倒计时圆环。两条触发路径：
         ① 单击「我需要帮助」 → 进入可取消窗口
         ② 长按 1.2 秒         → 直接进入可取消窗口
       窗口内可点「取消」撤回；走完才 emit('sos:tap') 由 core 推进阶段。 */
    if (s === 'IDLE') {
      var pct  = pending ? Math.max(0, Math.min(1, leftMs / WINDOW_MS)) : 0;
      var dash = 2 * Math.PI * 96;                    /* r=96 → 周长 */
      var off  = dash * (1 - pct);

      var ring =
        '<svg class="sos-ring-svg" viewBox="0 0 200 200" aria-hidden="true">' +
          '<circle class="sos-ring-bg" cx="100" cy="100" r="96"></circle>' +
          '<circle class="sos-ring-fg" cx="100" cy="100" r="96" ' +
                  'stroke-dasharray="' + dash.toFixed(1) + '" ' +
                  'stroke-dashoffset="' + off.toFixed(1) + '"></circle>' +
        '</svg>';

      var sosBtn =
        '<button id="btn-sos" class="sos-btn"' + (pending ? ' disabled' : '') + '>' +
          '<span class="sos-text">' + (pending ? '已收到' : '我需要<br>帮助') + '</span>' +
        '</button>';

      var cancel =
        '<button id="btn-cancel" class="ghost-btn">取消</button>' +
        '<div class="tiny dim center">' +
          (pending ? '误触了？现在还来得及取消' : '按下去就行，不用打一个字') +
        '</div>';

      var idleBody = pending
        ? '正在发出求助…<br><span class="tiny dim">' +
            Math.ceil(Math.max(0, leftMs) / 1000) + ' 秒内可取消</span>'
        : '如果你正在犹豫';

      return {
        badge: pending ? '发出中…' : '待机',
        tone:  pending ? 'danger' : null,
        html:
          '<div class="screen-title center" style="font-size:22px;text-align:center">' +
            idleBody +
          '</div>' +
          '<div class="grow center" style="position:relative">' +
            ring + sosBtn +
          '</div>' +
          '<div class="tiny dim center">📍 ' + App.esc(D.user.address) + '</div>' +
          (pending ? '' : '<div class="tiny dim center">长按 1.2 秒同样可以求助</div>') +
          cancel
      };
    }

    /* ───────── 已求助之后（6 个阶段）───────── */
    var idx = { SOS_TRIGGERED: 0, INSTITUTION_ALERT: 1, AUTO_ESCALATE: 2 }[s];
    if (idx == null) idx = 3;                    /* VIDEO_SESSION / ON_SITE / CLOSED */

    /* AUTO_ESCALATE 且志愿者已接单 → 家属与志愿者两步都已完成 */
    if (s === 'AUTO_ESCALATE' && volunteerAccepted()) idx = 3;

    var badge, tone;
    if (s === 'CLOSED')                { badge = '已闭环'; tone = 'ok'; }
    else if (s === 'ON_SITE')          { badge = '志愿者已到'; tone = 'ok'; }
    else if (volunteerAccepted())      { badge = '志愿者已接单'; tone = 'on'; }
    else                               { badge = '求助中'; tone = 'danger'; }

    return {
      badge: badge,
      tone:  tone,
      html:
        '<div class="screen-title center" style="font-size:22px;text-align:center">' +
          App.esc(statusTitle(s)) +
        '</div>' +
        '<div class="grow center col" style="gap:12px">' +
          pulseHTML(s) +
        '</div>' +
        stepBar(idx) +
        fallbackHTML()
    };
  });

  /* ═══════════ UI-02 取消窗口：开始 / 结束 / 取消 ═══════════ */
  function armWindow() {
    if (pending) return;                     /* 幂等：长按与单击可能同时到 */
    clearTimer();

    pending = true;
    leftMs  = WINDOW_MS;
    App.render('user');

    timer = setInterval(function () {
      leftMs -= 80;
      if (leftMs <= 0) { confirmSend(); return; }
      App.render('user');
    }, 80);
  }

  /* 窗口走完 → 正式发出求助。
     阶段流转权在 core：这里只 emit 契约 §5 冻结的 'sos:tap'。
     core.state.js 已订阅该事件并执行 IDLE → SOS_TRIGGERED（见该文件
     "求助触发" 一节），因此本模块不自行调用 App.next()，符合
     contract.md §1「模块不得自己改阶段」。 */
  function confirmSend() {
    clearTimer();
    pending = false;
    leftMs  = 0;
    App.log('用户按下「我需要帮助」，已发出', { hi: true });
    App.emit('sos:tap', { at: Date.now() });
    App.render('user');
  }

  function cancelSend() {
    clearTimer();
    pending = false;
    leftMs  = 0;
    App.log('用户在可取消窗口内取消了本次求助');
    App.render('user');
  }

  /* ═══════════ 交互绑定 ═══════════
     容器 #user-screen 常驻不重建（core.state.js 只换 innerHTML），
     所以事件直接绑在容器上做委托，且只需绑一次。 */
  (function wire() {
    var sc = App.el('user-screen');
    if (!sc || sc.__userWired) return;
    sc.__userWired = true;

    /* ① 单击 SOS → 进入可取消窗口 */
    sc.addEventListener('click', function (e) {
      if (e.target.closest('#btn-sos') && !pending) armWindow();

      /* 取消：窗口内撤回 */
      if (e.target.closest('#btn-cancel') && pending) cancelSend();

      /* UI-05 兜底拨号：仅打日志，红线要求不真拨号 */
      if (e.target.closest('#btn-call110')) {
        App.log('（演示）用户点击兜底拨号；真实产品此处直接呼出 110 / 120');
      }
    });

    /* ② 长按兜底入口：UI-01 的"长按同样可以求助" */
    function startHold(e) {
      if (!e.target.closest('#btn-sos') || pending) return;
      clearHold();
      hold = setTimeout(function () {
        hold = null;
        armWindow();
      }, HOLD_MS);
    }
    function endHold() { clearHold(); }

    if (window.PointerEvent) {
      sc.addEventListener('pointerdown', startHold);
      sc.addEventListener('pointerup', endHold);
      sc.addEventListener('pointercancel', endHold);
      sc.addEventListener('pointerleave', endHold);
    } else {
      sc.addEventListener('mousedown', startHold);
      sc.addEventListener('mouseup', endHold);
      sc.addEventListener('touchstart', startHold, { passive: true });
      sc.addEventListener('touchend', endHold);
    }

    /* ③ 键盘救场：Esc 取消窗口（与全局快捷键不冲突） */
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && pending) cancelSend();
    });
  })();

  /* ═══════════ 重置：清干净本模块所有私有状态 ═══════════ */
  App.on('app:reset', function () {
    clearTimer();
    clearHold();
    pending = false;
    leftMs  = 0;
  });

  console.log('[ui.user] 已注册 · 取消窗口 ' + (WINDOW_MS / 1000) + 's · 长按 ' +
              (HOLD_MS / 1000) + 's');
})();
