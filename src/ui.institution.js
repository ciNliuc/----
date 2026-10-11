/* ════════════════════════════════════════════════════════════════
   src/ui.institution.js   ← ② 专业机构 · 社区服务（宫格右上）
   负责人：B（本文件的唯一负责人，其他人不要改）

   契约：src/contract.md §3 DOM 约定 / §4 注册契约 / §5 事件表 / §6 常量 / §7 假数据
   调试：App.jump('INSTITUTION_ALERT') / App.jump('AUTO_ESCALATE') / App.reset()

   ── 本文件覆盖的需求（需求.md §4.2 宫格② 机构工作台）─────────────
     UI-10  红色告警卡片 + 声音提示（WebAudio 双音蜂鸣，不可用则降级语音） P0 ✅
     UI-11  确认倒计时进度条（AUTO_ESCALATE_SEC，演示 6s，走到头自动升级）  P0 ✅
     UI-12  「自动升级已触发」红色横幅                                     P0 ✅
     UI-13  用户档案卡：称呼 / 常住地址 / 坐标 / 风险备注（含"未登记"分支） P0 ✅
     UI-14  派单列表：自动联系的家属 + 匹配到的志愿者，含实时状态标记       P1 ✅
     UI-15  机构处置日志：每步打时间戳，并同步进底部全局时间线              P1 ✅

   ── 契约纪律（重要）──────────────────────────────────────────
     · render 是纯函数：只读 state，只写 #institution-badge / #institution-screen
     · 不在 render 里起计时器：倒计时由 core 的 timer:tick 驱动重绘，
       而且只改文本与进度条宽度、不重建 DOM（否则点击瞬间按钮被换掉会丢 click）
     · 不自己改阶段：确认接手只 emit('institution:ack')、结束处置只
       emit('demo:closed')，阶段流转交给 core.state.js 的订阅者（contract.md §1 §5）
     · 不新增事件名：只 emit 契约 §5 已冻结的 institution:ack / demo:closed
     · 跨模块不直接调用别人的函数：只读 App.DATA / App.state / App.CONFIG 快照
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  /* ═══════════ 模块私有状态（只影响本格渲染） ═══════════ */

  var ticketNo    = null;   /* 演示工单号，收到求助时生成 */
  var ticketAt    = null;   /* 建单时刻（Date.now()），用来判断工单是不是刚建的 */
  var ackStartedAt = null;  /* 工单到达时刻（Date.now()），值班来电接入倒计时起点 */
  var escStartedAt = null;  /* 进入 INSTITUTION_ALERT 的时刻，自动升级倒计时起点 */
  var ackRinging  = true;   /* 值班分机是否仍在响铃（接入倒计时未走完） */
  var overdue     = false;  /* 倒计时已归零、等待系统执行升级 */
  var acked       = false;  /* 值班人员已确认接手 */
  var escalated   = false;  /* 已收到 escalate:auto 广播 */
  var familySay   = null;   /* 家属应答：'call' | 'goto' | 'unreachable' */
  var volSay      = null;   /* 志愿者接单：{ name, distance } */
  var onSiteMs    = null;   /* 志愿者到场时的全局 elapsedMs */
  var oplog       = [];     /* UI-15 机构处置日志（最多留 5 条） */
  var seq         = 0;      /* 工单序号，重置后继续累加，避免每轮都是同一张工单 */

  var OPLOG_MAX = 5;

  /* 清掉"本次求助"的临时状态。
     ⚠️ 不清 ticketNo / oplog：sos:tap 与进入 SOS_TRIGGERED 是两个先后到达的
     信号（A 端 emit 在前，boot/ core 推进阶段在后），工单必须先建后留，
     否则刚打上的工单号会被自己的 reset 抹掉。 */
  function clearTransient() {
    ackStartedAt = null;
    escStartedAt = null;
    ackRinging   = true;
    overdue      = false;
    acked        = false;
    escalated    = false;
    familySay    = null;
    volSay       = null;
    onSiteMs     = null;
  }

  /* 完整重置（App.reset() 时才用） */
  function reset() {
    clearTransient();
    ticketNo = null;
    ticketAt = null;
    oplog    = [];
  }

  /* 建单：每轮演示一个新工单号。
     幂等 —— 两种到达顺序都要成立：
       ① 本分支（main）：sos:tap 先到（建单）→ 随后推进阶段（已建，跳过）
       ② A 分支：core 订阅了 sos:tap，先推进阶段 → 我的 sos:tap 回调后到
     所以 5 秒内只允许建一张单，避免工单号跳号 + 时间线出现两条重复记录。 */
  function openTicket() {
    if (ticketNo && ticketAt && (Date.now() - ticketAt) < 5000) return;
    seq += 1;
    ticketNo = 'TK-' + (1000 + seq);
    ticketAt = Date.now();
    oplog    = [];
    instLog('收到工单 ' + ticketNo + '（' + D.user.name + ' · ' + D.user.address + '）',
            { hi: true });
  }

  /* ═══════════ 工具 ═══════════ */

  /* 倒计时剩余毫秒：用 Date.now() 而不是 App.state.elapsedMs，
     这样即使有人直接 App.jump() 跳到告警阶段、core 的表还没跑起来也不会算错。 */
  function remainMs(startedAt, totalSec) {
    var total = (totalSec || 0) * 1000;
    if (startedAt == null) return total;
    var left = total - (Date.now() - startedAt);
    return Math.max(0, Math.min(total, left));
  }

  function esc(s) { return App.esc(s); }

  /* UI-15：机构侧处置日志 —— 面板内留一份，同时进底部全局时间线 */
  function instLog(text, opts) {
    oplog.push({ t: App.fmtTime(App.state.elapsedMs || 0), text: text });
    while (oplog.length > OPLOG_MAX) oplog.shift();
    App.log(text, opts);
  }

  /* UI-10 声音提示：短促双音蜂鸣。
     浏览器策略不允许时静默跳过（流程绝不因为没声音而中断），
     再兜一层语音播报（feature.speech.js 提供，C 负责）。 */
  var audioCtx = null;
  function alarmBeep() {
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) { fallbackVoice(); return; }
    try {
      if (!audioCtx) audioCtx = new AC();
      if (audioCtx.state === 'suspended' && audioCtx.resume) audioCtx.resume();

      [0, 0.26].forEach(function (delay, i) {
        var osc = audioCtx.createOscillator();
        var gain = audioCtx.createGain();
        osc.type = 'square';
        osc.frequency.value = i ? 660 : 880;
        osc.connect(gain);
        gain.connect(audioCtx.destination);

        var t0 = audioCtx.currentTime + delay;
        gain.gain.setValueAtTime(0.0001, t0);
        gain.gain.exponentialRampToValueAtTime(0.10, t0 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.20);
        osc.start(t0);
        osc.stop(t0 + 0.22);
      });
    } catch (err) {
      console.warn('[ui.institution] 告警音被浏览器策略拦下，已跳过：', err);
      fallbackVoice();
    }
  }

  function fallbackVoice() {
    if (typeof App.speak !== 'function') return;
    App.speak('紧急求助工单，请立即确认接手', { rate: 1.05 });
  }

  /* ═══════════ UI-13 用户档案卡 ═══════════ */

  function profileHTML(compact) {
    var registered = !!D.user.registered;
    var coords = (D.user.location || []).join(', ');

    var risk;
    if (registered) {
      var n = (D.contacts || []).length;
      risk = '风险备注：已登记，含 <b>' + n + ' 位</b>紧急联系人（登记时已确认同意）';
      if (!compact) {
        risk += '<br>' + (D.contacts || []).map(function (c) {
          return '· ' + esc(c.name) + '（' + esc(c.relation) + '）' + esc(c.phone);
        }).join('<br>');
      }
    } else {
      risk = '风险备注：<b>未登记</b>紧急联系人档案<br>按预案自动改派其位置附近的志愿者';
    }

    return '<div class="card ' + (registered ? 'ok' : 'warn') + '">' +
        '<div class="card-title">' +
          (registered ? '✓ 已登记用户档案' : '⚠ 未登记用户') +
        '</div>' +
        '<div class="card-body">' +
          '称呼 <b>' + esc(D.user.name) + '</b><br>' +
          '常住地址 ' + esc(D.user.address) + '<br>' +
          '<span class="mono">坐标 ' + esc(coords) + '（已定位）</span><br>' +
          risk +
        '</div>' +
      '</div>';
  }

  /* ═══════════ 抬头 / 工单号 ═══════════ */

  /* 抬头。compact = 告警阶段用：
     面板头已经写着「② 专业机构 · 社区服务」，再占一行机构名会把
     「立即确认接手」按钮挤到手机屏可视区（约 277px）以下，值班人员得滚动才能点。
     所以告警阶段只留一行 工单号 + 热线，把首屏让给告警 / 倒计时 / 按钮。 */
  function headHTML(compact) {
    return (compact ? '' :
        '<div class="wb-head">' +
          '<div class="wb-name">' + esc(D.institution.name) + '</div>' +
          '<span class="wb-live"><i></i>值班中</span>' +
        '</div>') +
      '<div class="ticket-bar">' +
        '<span class="mono dim">热线 ' + esc(D.institution.hotline) + '</span>' +
        (ticketNo ? '<span class="mono ticket-no">' + esc(ticketNo) + '</span>'
                  : '<span class="tiny dim">暂无在办工单</span>') +
      '</div>';
  }

  /* ═══════════ UI-10 告警横幅 ═══════════ */

  function alarmHTML(text) {
    return '<div class="alarm">' + text + '</div>';
  }

  /* ═══════════ 值班来电接入（INSTITUTION_ACK_SEC） ═══════════ */

  function ringHTML() {
    if (!ackRinging) {
      return '<div class="ring-row on">' +
          '<span class="ringwave"><i></i><i></i><i></i><i></i></span>' +
          '<span class="ring-text">✓ 值班来电已接入，请确认接手</span>' +
        '</div>';
    }
    var leftSec = Math.ceil(remainMs(ackStartedAt, C.INSTITUTION_ACK_SEC) / 1000);
    return '<div class="ring-row">' +
        '<span class="ringwave"><i></i><i></i><i></i><i></i></span>' +
        '<span class="ring-text">值班分机响铃中 · ' +
          '<b class="mono" id="inst-ack-left">' + leftSec + 's</b> 后接入</span>' +
      '</div>';
  }

  /* ═══════════ UI-11 自动升级倒计时进度条 ═══════════ */

  function escalateCountdownHTML() {
    var total   = (C.AUTO_ESCALATE_SEC || 0) * 1000;
    var leftMs  = remainMs(escStartedAt, C.AUTO_ESCALATE_SEC);
    var leftSec = Math.ceil(leftMs / 1000);
    var pct     = total ? Math.max(0, Math.min(100, leftMs / total * 100)) : 0;
    var color   = leftSec <= 2 ? 'var(--danger)' : 'var(--warn)';

    return '<div class="countdown-block">' +
        '<div class="tiny">自动升级倒计时 · 超时未确认由系统代为处置</div>' +
        '<div class="big-num" id="inst-esc-left" style="color:' + color + '">' +
          (overdue ? '已超时' : leftSec + 's') +
        '</div>' +
        '<div class="bar"><i id="inst-esc-bar" style="width:' + pct.toFixed(1) +
          '%;background:' + color + '"></i></div>' +
        '<div class="tiny dim">' +
          (overdue ? '等待系统执行自动升级…'
                   : '阈值 ' + C.AUTO_ESCALATE_SEC + 's（真实产品 60s）') +
        '</div>' +
      '</div>';
  }

  /* ═══════════ UI-14 派单列表 ═══════════ */

  /* 阶段本身就是"已升级"的证据：直接 App.jump 到后半程时状态也要说得通 */
  function isEscalated() {
    var s = App.state.stage;
    return escalated || s === 'AUTO_ESCALATE' || s === 'VIDEO_SESSION' ||
           s === 'ON_SITE' || s === 'CLOSED';
  }

  function familyTone() {
    if (!isEscalated()) return { text: '待外呼', tone: 'dim' };
    if (!familySay)     return { text: '呼出中', tone: 'danger' };
    return {
      call:        { text: '已联系求助者', tone: 'ok' },
      goto:        { text: '正在赶过去',   tone: 'on' },
      unreachable: { text: '暂时未接通',   tone: 'warn' }
    }[familySay] || { text: '已应答', tone: 'ok' };
  }

  function volunteerTone(v) {
    var s = App.state.stage;
    if (volSay && volSay.name === v.name) {
      return (s === 'ON_SITE' || s === 'CLOSED')
        ? { text: '已到场', tone: 'ok' }
        : { text: '已接单', tone: 'ok' };
    }
    if (!isEscalated()) return { text: '就近匹配中', tone: 'dim' };
    return (D.volunteers[0] && D.volunteers[0].name === v.name)
      ? { text: '已派单', tone: 'warn' }
      : { text: '备选（超时转派）', tone: 'dim' };
  }

  function drow(kick, kickCls, who, meta, st) {
    return '<div class="drow">' +
        '<span class="kick ' + kickCls + '">' + kick + '</span>' +
        '<span class="who">' + who +
          (meta ? ' <span class="dim">' + meta + '</span>' : '') + '</span>' +
        '<span class="pill ' + (st.tone || 'dim') + '">' + st.text + '</span>' +
      '</div>';
  }

  function dispatchHTML() {
    var rows = [];

    if (!D.user.registered) {
      rows.push(drow('家属', 'fam', '未登记紧急联系人', '', { text: '已跳过', tone: 'dim' }));
    } else {
      var ft = familyTone();
      (D.contacts || []).forEach(function (c) {
        rows.push(drow('家属', 'fam', esc(c.name),
          esc(c.relation) + ' · ' + esc(c.phone), ft));
      });
    }

    (D.volunteers || []).forEach(function (v) {
      rows.push(drow('志愿者', 'vol', esc(v.name),
        v.distance + 'km · ' + esc((v.skills || []).join('/')), volunteerTone(v)));
    });

    return '<div class="sec-title">派单与响应</div>' +
           '<div class="dispatch">' + rows.join('') + '</div>';
  }

  /* ═══════════ UI-15 处置日志（面板内） ═══════════ */

  function oplogHTML() {
    if (!oplog.length) return '';
    return '<div class="sec-title">机构处置日志</div>' +
      '<div class="oplog">' + oplog.map(function (r) {
        return '<div class="oplog-row"><time class="mono">' + esc(r.t) + '</time>' +
               '<span>' + esc(r.text) + '</span></div>';
      }).join('') + '</div>';
  }

  /* ═══════════ 渲染（contract.md §4：纯函数，返回 {badge, tone, html}） ═══════════ */

  App.define('institution', function (state) {
    var s = state.stage;

    /* ───────── IDLE 待机 ───────── */
    if (s === 'IDLE') {
      return {
        badge: '在线待机', tone: 'ok',
        html: headHTML() +
          '<div class="card blue">' +
            '<div class="card-title">工作台已就绪</div>' +
            '<div class="card-body">属地值班 2 人 · 覆盖 3 个社区<br>' +
              '位置服务 / 档案库 / 派单通道 均在线</div>' +
          '</div>' +
          '<div class="grow center col" style="gap:8px">' +
            '<div class="tiny dim">暂无待处理的求助工单</div>' +
          '</div>' +
          '<div class="tiny dim center">等待平台推送…</div>'
      };
    }

    /* ───────── 工单到达 / 值班来电接入（UI-10 + UI-11） ───────── */
    if (s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      /* 首屏优先级：告警 → 倒计时 → 「确认接手」按钮，其余（响铃详情、档案、日志）往后排。
         手机屏可视高度只有 ~277px，堆太多会让按钮掉到折叠线以下。 */
      var pre  = (s === 'INSTITUTION_ALERT')
        ? escalateCountdownHTML()                     /* UI-11 倒计时进度条 */
        : ringHTML();                                 /* 刚收到求助：先响铃 */

      var post = (s === 'INSTITUTION_ALERT')
        ? ringHTML()                                  /* 来电接入进度，放在按钮之后 */
        : '<div class="tiny dim center">来电接入后开始自动升级倒计时（' +
            C.AUTO_ESCALATE_SEC + 's）</div>';

      return {
        badge: ackRinging ? '● 响铃中' : '● 来电接入',
        tone:  'danger',
        html: headHTML(true) +
          alarmHTML('🔔 ' + (ackRinging ? '收到紧急求助工单' : '值班来电已接入，等待确认')) +
          pre +
          (acked
            ? '<div class="card ok">' +
                '<div class="card-title">✓ 已确认接手</div>' +
                '<div class="card-body">已跳过自动升级，正在接通远程视频疏导</div>' +
              '</div>'
            : '<button id="btn-ack" class="primary-btn">立即确认接手（跳过自动升级）</button>') +
          post +
          profileHTML(true) +
          oplogHTML()
      };
    }

    /* ───────── AUTO_ESCALATE 自动升级（UI-12 + UI-14） ───────── */
    if (s === 'AUTO_ESCALATE') {
      var famCard = D.user.registered
        ? '<div class="card danger">' +
            '<div class="card-title">① 已自动外呼紧急联系人</div>' +
            '<div class="card-body">' +
              (D.contacts || []).map(function (c) {
                return '· ' + esc(c.name) + '（' + esc(c.relation) + '）' + esc(c.phone);
              }).join('<br>') +
              '<br>共 ' + (D.contacts || []).length + ' 位，登记时已确认同意' +
            '</div>' +
          '</div>'
        : '<div class="card warn">' +
            '<div class="card-title">① 紧急联系人：未登记</div>' +
            '<div class="card-body">该用户未登记紧急联系人，已跳过<br>' +
              '按预案改为直接派单附近志愿者</div>' +
          '</div>';

      return {
        badge: '⚠ 已自动升级', tone: 'warn',
        html: headHTML() +
          '<div class="escalate">⚡ 自动升级已触发</div>' +
          '<div class="tiny dim">值班人员未在 ' + C.AUTO_ESCALATE_SEC +
            ' 秒内确认，系统已代为执行：</div>' +
          famCard +
          '<div class="card blue">' +
            '<div class="card-title">② 已自动派单最近志愿者</div>' +
            '<div class="card-body">' +
              (D.volunteers[0]
                ? '→ ' + esc(D.volunteers[0].name) + ' · ' + D.volunteers[0].distance +
                  'km · ' + esc((D.volunteers[0].skills || []).join('/'))
                : '附近暂无可派单志愿者（真实产品将升一级上报）') +
              '<br>响应倒计时 ' + C.VOLUNTEER_ACK_SEC + 's，超时自动转派下一位' +
            '</div>' +
          '</div>' +
          dispatchHTML() +
          '<div class="tiny dim center">本单已由系统接管 · 值班人员可继续旁听与介入</div>' +
          oplogHTML()
      };
    }

    /* ───────── VIDEO_SESSION 远程疏导（机构侧视角） ───────── */
    if (s === 'VIDEO_SESSION') {
      return {
        badge: '疏导中', tone: 'on',
        html: headHTML() +
          '<div class="card ok">' +
            '<div class="card-title">● 远程视频疏导中 · 值班人员旁听</div>' +
            '<div class="card-body">' +
              (state.videoOpen
                ? '房间已接通 <span class="mono">' + esc(state.videoRoom) + '</span>'
                : '等待志愿者拉起视频房间…') +
            '</div>' +
          '</div>' +
          dispatchHTML() +
          oplogHTML() +
          '<div class="tiny dim center">需要时值班人员可直接转入线下干预与转介</div>'
      };
    }

    /* ───────── ON_SITE 志愿者到场（收尾入口） ───────── */
    if (s === 'ON_SITE') {
      return {
        badge: '已到场', tone: 'ok',
        html: headHTML() +
          '<div class="card ok">' +
            '<div class="card-title">✓ 志愿者已到达求助者身边</div>' +
            '<div class="card-body">到场用时 <b class="mono">' +
              App.fmtTime(onSiteMs || 0) + '</b><br>' +
              '位置已共享给平台与家属 · 剩余距离 0.0km</div>' +
          '</div>' +
          /* 闭环按钮紧跟到场卡片，保证在首屏内可点（手机屏可视区约 277px） */
          '<button id="btn-close-ticket" class="primary-btn">结束处置 → 生成回访任务</button>' +
          '<div class="tiny dim center">闭环后自动创建 24 小时内回访任务</div>' +
          dispatchHTML() +
          oplogHTML()
      };
    }

    /* ───────── CLOSED 工单归档 ───────── */
    var familyName = (D.family && D.family.name) || '家属';
    var familyLine = D.user.registered
      ? ('家属 ' + esc(familyName) + '（' +
         (familySay === 'goto' ? '正在赶过去'
           : familySay === 'unreachable' ? '暂时未接通'
           : '已联系求助者') + '）')
      : '家属（未登记 · 已跳过）';

    return {
      badge: '已归档', tone: 'ok',
      html: headHTML() +
        '<div class="card ok">' +
          '<div class="card-title">✓ 工单已归档</div>' +
          '<div class="card-body">' +
            '工单 <b class="mono">' + esc(ticketNo || '临时工单') + '</b> · 总用时 ' +
              '<b class="mono">' + App.fmtTime(state.elapsedMs) + '</b><br>' +
            '响应链条：机构（' + (acked ? '人工确认接手' : '系统自动升级') + '）→ ' +
              familyLine + ' → 志愿者（已到场）<br>' +
            '回访任务已创建：24 小时内首次回访' +
          '</div>' +
        '</div>' +
        dispatchHTML() +
        oplogHTML()
    };
  });

  /* ═══════════ 阶段变化：初始化本模块私有状态（不在 render 里做） ═══════════ */

  App.on('stage:change', function (e) {
    var stage = e.to;

    if (stage === 'SOS_TRIGGERED') {
      /* 工单是不是刚刚由 sos:tap 建的（两种到达顺序见 openTicket 注释） */
      if (ticketNo && ticketAt && (Date.now() - ticketAt) < 5000) clearTransient();
      openTicket();                              /* 没有本单则建单，有则幂等跳过 */

      ackStartedAt = Date.now();
      if (typeof App.startTicker === 'function') App.startTicker();  /* 已在跑则幂等 */
      alarmBeep();                                                  /* UI-10 声音提示 */
    } else if (stage === 'INSTITUTION_ALERT') {
      /* 自动升级倒计时从"来电接入"这一刻算起，与 boot.js 的 HOLD 一致 */
      escStartedAt = Date.now();
      /* 用 App.jump 直接跳进来时没有 SOS_TRIGGERED，响铃表也要有个起点 */
      if (ackStartedAt == null) ackStartedAt = Date.now();
      overdue      = false;
      if (typeof App.startTicker === 'function') App.startTicker();
    } else if (stage === 'ON_SITE') {
      onSiteMs = App.state.elapsedMs || 0;
    }

    App.render('institution');
  });

  /* ═══════════ 契约 §5 事件订阅 ═══════════ */

  /* 工单到达：A 端 emit，core 推进阶段；这里只做机构侧建单登记 */
  App.on('sos:tap', function () {
    openTicket();
    App.render('institution');
  });

  /* 自动升级广播（core emit）：横幅由阶段驱动，这里只记一笔 */
  App.on('escalate:auto', function () {
    escalated = true;
    if (D.user.registered) {
      instLog('超时未确认，系统已自动外呼 ' + (D.contacts || []).length + ' 位紧急联系人');
    } else {
      instLog('用户未登记紧急联系人，系统改为直接派单附近志愿者');
    }
    App.render('institution');
  });

  /* 家属应答（C 端 emit）：机构侧同步状态，便于值班人员判断 */
  App.on('family:answer', function (e) {
    familySay = e.choice;
    var line = {
      call:        '家属已确认联系求助者，机构侧同步状态',
      goto:        '家属自行前往现场，已同步位置给志愿者',
      unreachable: '家属暂时未接通，维持志愿者派单与到场处置'
    }[e.choice];
    if (line) instLog(line);
    App.render('institution');
  });

  /* 志愿者接单（D 端 emit） */
  App.on('volunteer:accept', function (e) {
    volSay = { name: e.name, distance: e.distance };
    instLog('已转交志愿者 ' + e.name + '（' + e.distance + 'km）并开启位置共享');
    App.render('institution');
  });

  /* 视频房间（D 端 emit）：机构侧显示旁听状态 */
  App.on('video:open', function (e) {
    if (e.ok) {
      instLog('远程视频已接通，值班人员开始旁听');
    } else {
      instLog('视频窗口被拦截，机构侧显示降级画面，流程继续');
    }
    App.render('institution');
  });

  /* ═══════════ 倒计时重绘（contract.md §4 规则 3：用 timer:tick，不在 render 里起表） ═══════════
     只改文本与进度条宽度，**不重建 DOM**：否则 200ms 一次的重绘会在
     值班人员按住「确认接手」的瞬间把按钮换掉，click 事件直接丢失。 */
  App.on('timer:tick', function (e) {
    if (e.stage !== 'SOS_TRIGGERED' && e.stage !== 'INSTITUTION_ALERT') return;

    var sc = App.el('institution-screen');
    if (!sc) return;

    /* 值班来电接入倒计时（与自动升级倒计时并行，两个都在走） */
    var ackNum = sc.querySelector('#inst-ack-left');
    if (ackNum) {
      ackNum.textContent =
        Math.max(0, Math.ceil(remainMs(ackStartedAt, C.INSTITUTION_ACK_SEC) / 1000)) + 's';
    }

    /* 响铃 → 已接入：这一次需要换视图（按钮与文案都变） */
    if (ackRinging && remainMs(ackStartedAt, C.INSTITUTION_ACK_SEC) <= 0) {
      ackRinging = false;
      App.render('institution');
      return;
    }

    var leftMs = remainMs(escStartedAt, C.AUTO_ESCALATE_SEC);

    if (!overdue) {
      var num = sc.querySelector('#inst-esc-left');
      if (num) {
        var leftSec = Math.ceil(leftMs / 1000);
        num.textContent = leftSec + 's';
        num.style.color = leftSec <= 2 ? 'var(--danger)' : 'var(--warn)';
      }
    }

    var bar = sc.querySelector('#inst-esc-bar');
    if (bar) {
      var total = (C.AUTO_ESCALATE_SEC || 1) * 1000;
      bar.style.width = (leftMs / total * 100).toFixed(1) + '%';
    }

    if (leftMs <= 0 && !overdue && e.stage === 'INSTITUTION_ALERT') {
      overdue = true;
      instLog('确认倒计时归零，等待系统执行自动升级');
      App.render('institution');
    }
  });

  /* ═══════════ 交互（绑在常驻容器上做委托，容器不随 render 重建） ═══════════
     注意：core 的 App.delegate() 每个 role 只允许绑一次（内部 __delegated 标记），
     本模块有两个按钮，所以这里自己绑，等价且更稳。 */
  (function wire() {
    var sc = App.el('institution-screen');
    if (!sc || sc.__instWired) return;
    sc.__instWired = true;

    sc.addEventListener('click', function (ev) {
      /* UI-11 值班人员确认接手：只 emit 契约 §5 冻结的 institution:ack，
         由 core.state.js 决定"跳过自动升级直接进 VIDEO_SESSION"。 */
      if (ev.target.closest('#btn-ack')) {
        acked = true;
        instLog('值班人员已确认接手，跳过自动升级', { hi: true });
        App.emit('institution:ack', { at: Date.now() });
        App.render('institution');
        return;
      }

      /* 结束处置：只 emit 契约 §5 冻结的 demo:closed，由 core 推进到 CLOSED */
      if (ev.target.closest('#btn-close-ticket')) {
        instLog('机构确认处置完成，工单归档并生成 24 小时回访任务', { hi: true });
        App.emit('demo:closed', { at: Date.now() });
        App.render('institution');
      }
    });
  })();

  /* ═══════════ 重置：清干净本模块所有私有状态 ═══════════ */
  App.on('app:reset', function () {
    reset();
    if (audioCtx && audioCtx.close) {
      try { audioCtx.close(); } catch (err) { /* 关不掉也不影响流程 */ }
      audioCtx = null;
    }
    App.render('institution');
  });

  console.log('[ui.institution] 已注册 · UI-10~UI-15 · 自动升级阈值 ' +
              C.AUTO_ESCALATE_SEC + 's');
})();
