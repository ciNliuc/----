/* ════════════════════════════════════════════════════════════════
   src/ui.volunteer.js   ← ④ 志愿者 · 附近响应者（宫格右下）
   负责人：D
   契约：contract.md §3 §4 §5      调试：App.jump('VIDEO_SESSION')
   本模块负责：接单倒计时与超时转派 / 地图路线动画 / 距离递减 /
               拉起视频 / 到场打卡

   ─── 本次改动要点（D 分支） ───
   1. 接单 5 秒倒计时 + 超时自动转派下一位（需求 UI-31 / dev-board P0）
   2. 距离递减改用「进入本阶段起」的相对时间，不再用全局 elapsedMs
      （原来进 VIDEO_SESSION 时全局早已超过 MAP_TRAVEL_SEC，距离恒为 0）
   3. 地图上志愿者圆点随路线真正移动（原实现只改数字、点不动）
   4. 到场打卡只 emit volunteer:onSite，不自己 App.next()（契约 §1）
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  /* ───────── 本模块运行时状态 ───────── */
  var list      = D.volunteers;      /* 按距离升序，[0] 最近 */
  var activeIdx = 0;                 /* 当前被派单的是哪一位 */
  var accepted  = false;             /* 是否已接单 */
  var declined  = false;             /* 上一个是否已转派（用于地图双路线） */
  var onSite    = false;             /* 是否已到场 */
  var distance  = list[0].distance;  /* 当前剩余距离 km */
  var travelBase = null;             /* 进入 VIDEO_SESSION 的时刻，距离递减的零点 */
  var ackLeft   = null;              /* 接单倒计剩余秒 */
  var ackTimer  = null;
  var tickTimer = null;              /* 通话时长 */
  var callSec   = 0;

  /* ───────── 路演用：志愿者真拨打电话的状态 ─────────
     'none' → 'calling' → 'connected'
     网页拿不到真实通话状态（电话一接通，系统把通话交给电话 App，
     浏览器被切后台，收不到任何事件；麦克风检测又需要 secure context，
     而我们是 file:// 打开的）。所以「已接通」由志愿者点一下确认 ——
     真实产品里志愿者本来也要点这一下。 */
  var callState = 'none';
  var callStart = null;

  var MAP = { x0: 26, y0: 96, x1: 122, y1: 44 };   /* 地图坐标：起点(远) → 终点(求助者) */

  /* ───────── 路演：志愿者拨号 ─────────
     Demo 阶段用假号码，与 DEMO_DATA.contacts[0].phone 保持一致，
     免得大屏上两个地方显示不同数字，被看出破绽。
     ⚠️ 没有放进 data.demo.js —— 给 volunteers 加 phone 字段算改契约 §7 的
        字段结构，按规矩要先跟框架负责人报备。等报了再搬过去。 */
  var VOL_PHONE = '138****0000';

  function cur() { return list[activeIdx]; }

  /* ───────── 计时器收拾干净 ───────── */
  function clearAck() {
    if (ackTimer) { clearInterval(ackTimer); ackTimer = null; }
    ackLeft = null;
  }
  function clearTick() {
    if (tickTimer) { clearInterval(tickTimer); tickTimer = null; }
    callSec = 0;
  }
  function clearAll() { clearAck(); clearTick(); }

  /* ───────── 距离 → 地图坐标 ─────────
     同一位志愿者的起点固定：距离越远的画得越靠左下（离求助者越远）。
     这样转派时地图上能同时看见两条路线，一眼看懂"换人了"。 */
  var maxD = Math.max.apply(null, list.map(function (v) { return v.distance; })) || 1;

  function originOf(i) {
    var ratio = maxD > 0 ? list[i].distance / maxD : 1;
    return {
      x: MAP.x1 + (MAP.x0 - MAP.x1) * ratio,
      y: MAP.y1 + (MAP.y0 - MAP.y1) * ratio
    };
  }

  function at(i, t) {
    var o = originOf(i);
    return { x: o.x + (MAP.x1 - o.x) * t, y: o.y + (MAP.y1 - o.y) * t };
  }

  /* ───────── 地图（纯手绘，不依赖在线地图，离线可用） ───────── */
  function mapSVG(nowMs) {
    var pct = travelPct(nowMs);
    /* 接单后才画"移动中的我"；未接单时人还停在起点 */
    var vxy = accepted ? at(activeIdx, pct) : null;

    var svg = '<svg viewBox="0 0 160 120" preserveAspectRatio="none">' +
      '<defs>' +
        '<pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">' +
          '<path d="M16 0H0V16" fill="none" stroke="#1e2733" stroke-width="1"/>' +
        '</pattern>' +
      '</defs>' +
      '<rect width="160" height="120" fill="url(#grid)"/>';

    /* 转派后：上一位的路线留成灰色虚线，表示"这段没走完" */
    if (declined && activeIdx > 0) {
      var o0 = originOf(0);
      svg += '<line x1="' + o0.x + '" y1="' + o0.y + '" x2="' + MAP.x1 + '" y2="' + MAP.y1 +
             '" stroke="#30363d" stroke-width="3" stroke-linecap="round" stroke-dasharray="4 4"/>';
    }

    /* 当前志愿者的完整路线（底色）+ 已走部分（上色） */
    var o = originOf(accepted ? activeIdx : 0);
    svg += '<line x1="' + o.x + '" y1="' + o.y + '" x2="' + MAP.x1 + '" y2="' + MAP.y1 +
           '" stroke="#2d3748" stroke-width="4" stroke-linecap="round"/>';
    if (vxy) {
      svg += '<line class="live-track" x1="' + o.x + '" y1="' + o.y + '" x2="' + vxy.x + '" y2="' + vxy.y +
             '" stroke="#2f81f7" stroke-width="4" stroke-linecap="round"/>';
    }

    /* 终点：求助者 */
    svg += '<circle cx="' + MAP.x1 + '" cy="' + MAP.y1 + '" r="9" fill="#f85149" opacity=".25"/>' +
           '<circle cx="' + MAP.x1 + '" cy="' + MAP.y1 + '" r="5" fill="#f85149"/>';

    /* 其他没被派单的志愿者：画成小灰点 */
    for (var k = 0; k < list.length; k++) {
      if (k === activeIdx) continue;
      var ok = originOf(k);
      svg += '<circle cx="' + ok.x + '" cy="' + ok.y + '" r="3.5" fill="#30363d"/>';
    }

    /* 我：未接单时停在起点，接单后随路线移动 */
    var me = vxy || originOf(accepted ? activeIdx : 0);
    svg += '<circle cx="' + me.x + '" cy="' + me.y + '" r="6" fill="#2f81f7"' +
           (vxy ? ' class="dot-me"' : '') + '/>';

    return svg + '</svg>';
  }

  /* nowMs 省略时取当前时刻（未接单时 travelPct 恒为 0，人停在起点） */
  function mapHTML(nowMs) {
    var el = (nowMs === undefined) ? Date.now() : nowMs;
    return '<div class="map">' +
        mapSVG(el) +
        '<div class="map-tag me" data-tag="me">' + App.esc(cur().name) + '</div>' +
        '<div class="map-tag him">' + App.esc(D.user.name) + '</div>' +
        '<div class="map-dist" data-dist>' + distText() + '</div>' +
      '</div>';
  }

  function distText() {
    if (onSite) return '已到达';
    if (!accepted) return cur().distance.toFixed(1) + ' km';
    return distance.toFixed(1) + ' km';
  }

  /* 只改数字与点位，不重建整块 DOM —— 免得每 200ms 把动画和按钮状态冲掉 */
  function patchMap() {
    var sc = App.el('volunteer-screen');
    if (!sc) return;

    var pct = travelPct();
    var i   = accepted ? activeIdx : 0;
    var vxy = accepted ? at(i, pct) : originOf(0);

    var dot = sc.querySelector('.dot-me');
    if (dot) { dot.setAttribute('cx', vxy.x); dot.setAttribute('cy', vxy.y); }

    var line = sc.querySelector('line.live-track');
    if (line) { line.setAttribute('x2', vxy.x); line.setAttribute('y2', vxy.y); }

    var dEl = sc.querySelector('[data-dist]');
    if (dEl) dEl.textContent = distText();

    var tag = sc.querySelector('[data-tag="me"]');
    if (tag && tag.textContent !== cur().name) tag.textContent = cur().name;
  }

  /* ───────── 距离递减（用进入本阶段的真实时刻做零点） ─────────
     ⚠️ 不要用 App.state.elapsedMs：那个全局计时器只在正常点按钮求助时
        才启动，用 App.jump() 跳阶段时它不跑，elapsedMs 恒为 0，
        距离就会冻在起点、地图上那个点也不动。
        Date.now() 与计时器无关，任何进入方式都能正常走。 */
  function travelPct(nowMs) {
    if (travelBase == null) return 0;
    var travel = (C.MAP_TRAVEL_SEC || 30) * 1000;
    var t = ((nowMs == null ? Date.now() : nowMs) - travelBase) / travel;
    return Math.max(0, Math.min(1, t));
  }

  function recalcDistance() {
    if (onSite) { distance = 0; return; }
    /* 接单前不推进；接单后按相对时间从自己起点线性走到 0 */
    distance = accepted ? cur().distance * (1 - travelPct()) : cur().distance;
  }

  /* ───────── 派单卡片（含 5 秒倒计时 / 转派态） ───────── */
  function dispatchCardHTML() {
    var v = cur(), nxt = list[activeIdx + 1];

    /* 卡片头：首次派单是红色警报，转派后是黄色说明 */
    var card = declined
      ? '<div class="push-card expired">' +
          '<div class="card-title">↻ 已自动转派</div>' +
          '<div class="card-body">上一位志愿者未在 ' + C.VOLUNTEER_ACK_SEC + ' 秒内响应<br>' +
            '正在通知下一位：<b>' + App.esc(v.name) + '</b>　' + v.distance.toFixed(1) + 'km</div>' +
        '</div>'
      : '<div class="push-card">' +
          '<div class="card-title">📣 紧急派单</div>' +
          '<div class="card-body">距您 <b>' + v.distance.toFixed(1) + 'km</b> 有人求助<br>' +
            '求助者：' + App.esc(D.user.name) + '</div>' +
        '</div>';

    var left = (ackLeft == null) ? C.VOLUNTEER_ACK_SEC : ackLeft;
    var pct  = Math.max(0, Math.min(1, left / C.VOLUNTEER_ACK_SEC)) * 100;

    /* 转派后**必须**仍然能接单 —— 否则下一位接不了，流程就断在这了 */
    return card +
      mapHTML() +
      '<div class="ack-block">' +
        '<div class="tiny dim">请在时限内响应，超时将自动转派' +
          (nxt ? '给 ' + App.esc(nxt.name) : '（暂无下一位）') + '</div>' +
        '<div class="ack-bar"><i data-ack-bar style="width:' + pct + '%"></i></div>' +
        '<div class="tiny dim">剩余 <b class="mono" data-ack-num>' + left + '</b> 秒</div>' +
      '</div>' +
      '<button class="primary-btn" data-act="accept">立即响应（' + C.VOLUNTEER_ACK_SEC + ' 秒内）</button>' +
      '<div class="tiny dim center">响应后将开启位置共享与打卡</div>';
  }

  function patchAck() {
    var sc = App.el('volunteer-screen');
    if (!sc) return;
    var pct  = Math.max(0, Math.min(1, (ackLeft || 0) / C.VOLUNTEER_ACK_SEC)) * 100;
    var bar  = sc.querySelector('[data-ack-bar]');
    var num  = sc.querySelector('[data-ack-num]');
    if (bar) bar.style.width = pct + '%';
    if (num) num.textContent = Math.max(0, ackLeft || 0);
  }

  function startAckCountdown() {
    clearAck();
    ackLeft = C.VOLUNTEER_ACK_SEC;
    ackTimer = setInterval(function () {
      ackLeft--;
      if (ackLeft <= 0) { clearAck(); onAckTimeout(); return; }
      patchAck();
    }, 1000);
  }

  /* 超时：转派下一位。没有下一位就留在原地，演示不中断。 */
  function onAckTimeout() {
    var nxt = list[activeIdx + 1];
    if (!nxt) {
      App.log('全部志愿者均未在时限内响应，等待人工介入');
      App.render('volunteer');
      return;
    }
    declined  = true;
    activeIdx++;
    distance  = cur().distance;
    App.log('志愿者 ' + list[activeIdx - 1].name + ' 超时未响应，已转派 ' + cur().name, { hi: true });
    App.render('volunteer');
    startAckCountdown();
  }

  /* ───────── 路演：拨打电话 ─────────
     求助者的号码刻意做成"最小披露"：志愿者只能看到脱敏的 138****0000。
     真拨号由志愿者在自己手机上完成，网页这边只跟进通话状态。 */
  function callCardHTML() {
    if (callState === 'none') {
      return '<div class="call-card">' +
          '<div class="tiny dim">求助者号码（最小披露）</div>' +
          '<div class="call-num mono">' + App.esc(VOL_PHONE) + '</div>' +
          '<div class="tiny dim">请用你自己的手机拨打，本机只记录通话状态</div>' +
          '<button class="primary-btn danger" data-act="dial">📞 拨打求助者</button>' +
        '</div>';
    }

    if (callState === 'calling') {
      return '<div class="call-card calling">' +
          '<div class="tiny dim">正在呼叫…</div>' +
          '<div class="call-num mono">' + App.esc(VOL_PHONE) + '</div>' +
          '<div class="wave">' +
            '<i></i><i></i><i></i><i></i><i></i>' +
          '</div>' +
          '<button class="primary-btn" data-act="connect">已接通，开始计时</button>' +
          '<div class="tiny dim center">接通后点一下，大屏计时与台上对齐</div>' +
        '</div>';
    }

    /* 通话中 */
    return '<div class="call-card connected">' +
        '<div class="call-live">● 通话中</div>' +
        '<div class="call-timer-lg"><b class="mono" data-vol-timer>' +
          App.fmtTime(callSec * 1000) + '</b></div>' +
        '<div class="wave">' +
          '<i></i><i></i><i></i><i></i><i></i>' +
        '</div>' +
        '<div class="tiny dim center">只倾听与陪伴 · 不承诺结果 · 不替医生做诊断</div>' +
        '<button class="ghost-btn" data-act="hangup">结束通话，我出发了</button>' +
      '</div>';
  }
  /* ───────── 视频区 ───────── */
  function isLive() {
    return App.state.stage === 'VIDEO_SESSION' && !!App.state.videoRoom;
  }

  function videoHTML() {
    if (!isLive()) {
      return '<div class="video-stage empty tiny dim center">' +
               '尚未接通视频 · 点击下方按钮开始' +
             '</div>';
    }
    /* 通话画面统一由 feature.video.js 提供（单一来源，避免两处画不一样） */
    return '<div class="video-stage">' +
        App.callScreenHTML({
          name:      cur().name,
          seconds:   callSec,
          showRoom:  !App.videoIsFallback()
        }) +
        '<div class="tiny dim center" style="padding:6px">' +
          '通话中请不要承诺结果，只倾听与陪伴</div>' +
      '</div>';
  }

  function startCallTicker() {
    clearTick();
    tickTimer = setInterval(function () {
      callSec++;
      var sc = App.el('volunteer-screen');
      var t  = sc && sc.querySelector('[data-vol-timer]');
      if (t) { t.textContent = App.fmtTime(callSec * 1000); return; }
      /* 元素暂时不在（重绘间隙）就跳过这一秒，别把计时器停了 */
    }, 1000);
  }

  /* ───────── 渲染：必须处理全部 7 个阶段（契约 §4.2） ───────── */
  App.define('volunteer', function (state) {
    var s = state.stage;

    /* ── 待机三态 ── */
    if (s === 'IDLE' || s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      return {
        badge: '在线待命', tone: 'ok',
        html:
          '<div class="screen-title">志愿者工作台</div>' +
          '<div class="tiny dim">' + App.esc(cur().name) + ' · 距求助点 ' +
            cur().distance.toFixed(1) + 'km</div>' +
          '<div class="grow center col" style="gap:8px">' +
            '<div class="tiny dim">' + App.esc(cur().skills.join(' / ')) + '</div>' +
            '<div class="tiny dim">等待派单…</div>' +
          '</div>' +
          '<div class="tiny dim center">已通过实名审核 · 培训考核 · 服务协议</div>'
      };
    }

    /* ── 派单 / 接单 ── */
    if (s === 'AUTO_ESCALATE') {
      if (!accepted) {
        return { badge: declined ? '↻ 已转派' : '● 新派单', tone: 'danger', html: dispatchCardHTML() };
      }
      return {
        badge: '已接单', tone: 'on',
        html:
          '<div class="screen-title">已接单，正在赶往现场</div>' +
          mapHTML() +
          (callState === 'none'
            ? '<button class="primary-btn danger" data-act="dial">📞 拨打求助者</button>'
            : '<div class="tiny dim center">通话已发起，往下看通话状态</div>') +
          '<button class="ghost-btn" data-act="video">改用视频疏导</button>' +
          '<div class="tiny dim center">建议双人同行 · 开启位置共享</div>'
      };
    }

    /* ── 通话 / 视频疏导 ──
       路演主线走这里的 phone-call 分支：志愿者真拨电话，网页跟进状态。
       原来那套"拉起第三方视频房间"保留着（加法，没删），随时能退回去。 */
    if (s === 'VIDEO_SESSION') {
      if (callState !== 'none') {
        return {
          badge: callState === 'connected' ? '● 通话中' : '● 呼叫中',
          tone:  callState === 'connected' ? 'ok' : 'warn',
          html:
            '<div class="screen-title">' +
              (callState === 'connected' ? '正在与求助者通话' : '正在呼叫求助者') + '</div>' +
            callCardHTML() +
            mapHTML() +
            '<button class="ghost-btn" data-act="arrive">我已到达现场</button>'
        };
      }
      return {
        badge: isLive() ? '● 视频中' : '● 待接通',
        tone:  isLive() ? 'on' : 'warn',
        html:
          '<div class="screen-title">' +
            (isLive() ? '正在视频疏导' : '准备视频疏导') + '</div>' +
          videoHTML() +
          mapHTML() +
          '<button class="primary-btn" data-act="video">' +
            (isLive() ? '重新打开视频窗口' : '▶ 打开视频窗口') + '</button>' +
          '<button class="ghost-btn" data-act="arrive">我已到达现场</button>'
      };
    }

    /* ── 到场 ── */
    if (s === 'ON_SITE') {
      return {
        badge: callState === 'connected' ? '● 通话中' : '已到场',
        tone: 'ok',
        html:
          '<div class="screen-title">已到达求助者身边</div>' +
          /* 人在路上、电话还通着 —— 这时候把通话状态切掉会很奇怪 */
          (callState === 'connected' ? callCardHTML() : '') +
          mapHTML() +
          '<div class="card ok">' +
            '<div class="card-title">✓ 到场打卡已完成</div>' +
            '<div class="card-body">位置已共享给平台与家属<br>每 15 分钟自动汇报一次</div>' +
          '</div>' +
          '<button class="ghost-btn" data-act="record">填写处置记录</button>' +
          '<div class="tiny dim center">交接给家属或专业机构后再撤离</div>'
      };
    }

    /* ── 闭环 ── */
    return {
      badge: '已闭环', tone: 'ok',
      html:
        '<div class="screen-title">本次事件已闭环</div>' +
        '<div class="grow center col" style="gap:10px">' +
          '<div style="font-size:32px">🤝</div>' +
          '<div class="tiny dim center">感谢你的响应</div>' +
        '</div>' +
        '<div class="card blue">' +
          '<div class="card-title">48 小时内会推送心理支持</div>' +
          '<div class="card-body">参与高危处置的志愿者需要同伴支持</div>' +
        '</div>'
    };
  });

  /* ───────── 交互 ─────────
     ⚠️ 这里**故意不用 App.delegate**。
     core.state.js 里的 App.delegate 有缺陷：它用 sc.__delegated 做一次性
     守卫，第一次调用后就 return，后面所有调用全部静默失效（一个角色
     只有**第一个** App.delegate 是活的）；它还把 selector / handler 闭包
     死在第一次调用的那个上，eventName 参数根本没被用到。

     绕开办法：自己在 volunteer-screen 上绑**一个**原生委托，按 data-act 分派。
     容器 #volunteer-screen 永不重建（只有 innerHTML 变），所以只需绑一次。

     —— 该缺陷已登记在 tools/dev-board.md §五，等框架负责人评估改成
        sc.__delegates 数组；A 的求助者端（不再用 delegate）与 C 的家属端
        （一个 role 只调一次 + 逗号选择器）也各自绕开了，互不阻塞。 */
  (function bindVolunteerActions() {
    var sc = App.el('volunteer-screen');
    if (!sc) { console.error('[ui.volunteer] 找不到 #volunteer-screen'); return; }

    var actions = {
      /* 接单 */
      accept: function () {
        accepted = true;
        clearAck();
        travelBase = Date.now();
        distance = cur().distance;
        App.log('志愿者 ' + cur().name + ' 已接单', { hi: true });
        App.emit('volunteer:accept', { name: cur().name, distance: cur().distance });
        App.render('volunteer');
      },

      /* 拉起视频。⚠️ App.openVideo 必须同步调用，包在 setTimeout 里会被拦弹窗 */
      video: function () {
        App.openVideo();
        App.render('volunteer');
      },

      /* 到场打卡。契约 §5：volunteer:onSite → core 推进阶段，本模块不自己 next。
         ⚠️ 不要在这里 clearTick()：到场时电话通常还通着，停表会让
         大屏上的通话计时冻在 00:00，看着像坏了。挂断动作里才停表。 */
      arrive: function () {
        onSite   = true;
        distance = 0;
        App.log('志愿者已到达现场并完成打卡', { hi: true });
        App.emit('volunteer:onSite', { at: Date.now() });
        App.render('volunteer');
      },

      record: function () {
        App.log('志愿者已提交处置记录（结构化表单）');
      },

      /* ── 路演：真拨电话这三个动作 ── */

      /* 志愿者在自己手机上拨号，网页这边进入"呼叫中" */
      dial: function () {
        callState = 'calling';
        App.log('志愿者 ' + cur().name + ' 正在拨打求助者 ' + VOL_PHONE, { hi: true });
        App.render('volunteer');
      },

      /* 志愿者点一下确认接通 —— 网页无法自动感知真实接通，见文件上方说明 */
      connect: function () {
        callState = 'connected';
        callStart = Date.now();
        callSec   = 0;
        startCallTicker();
        App.log('通话已接通，志愿者与求助者开始对话', { hi: true });
        App.render('volunteer');
      },

      hangup: function () {
        callState = 'none';
        callStart = null;
        clearTick();
        App.log('通话结束，志愿者出发前往现场', { hi: true });
        App.render('volunteer');
      }
    };

    sc.addEventListener('click', function (ev) {
      var hit = ev.target.closest && ev.target.closest('[data-act]');
      if (!hit || !sc.contains(hit)) return;
      var fn = actions[hit.getAttribute('data-act')];
      if (!fn) return;
      ev.preventDefault();
      try { fn(); }
      catch (err) { console.error('[ui.volunteer] 动作 ' + hit.getAttribute('data-act') + ' 出错：', err); }
    });
  })();

  /* ───────── 距离递减：用相对时间，并在重绘前先打补丁 ───────── */
  App.on('timer:tick', function () {
    if (!accepted || onSite) return;
    if (App.state.stage !== 'VIDEO_SESSION') return;
    /* 通话期间人在原地打电话，不该继续"往前走" */
    if (callState === 'connected') return;
    recalcDistance();
    patchMap();
    if (distance <= 0.05) {
      /* 只是展示"已到楼下"，真正的到场由志愿者点按钮确认 */
      distance = 0;
    }
  });

  /* ───────── 阶段进出：管理计时器生命周期 ───────── */
  App.on('stage:change', function (e) {
    if (e.to === 'AUTO_ESCALATE' && !accepted) startAckCountdown();
    if (e.to !== 'AUTO_ESCALATE') clearAck();

    if (e.to === 'VIDEO_SESSION') {
      travelBase = Date.now();
      /* 重新进入本阶段时若通话还在继续，把表接回去 */
      if (callState === 'connected' && !tickTimer) startCallTicker();
    }
    /* 只有离开"通话可能进行中"的阶段才停表；
       VIDEO_SESSION → ON_SITE 时电话可能还通着，计时不能断。 */
    if (e.to !== 'VIDEO_SESSION' && e.to !== 'ON_SITE') clearTick();

    if (e.to === 'IDLE') resetAll();
  });

  App.on('app:reset', resetAll);

  function resetAll() {
    clearAll();
    activeIdx   = 0;
    accepted    = false;
    declined    = false;
    onSite      = false;
    distance    = list[0].distance;
    travelBase  = null;
    callState   = 'none';
    callStart   = null;
  }

  console.log('[ui.volunteer] 已注册');
})();
