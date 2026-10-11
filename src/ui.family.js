/* ════════════════════════════════════════════════════════════════
   src/ui.family.js   ← ③ 紧急联系人 · 家人（宫格左下）
   负责人：C
   契约：contract.md §3 §4 §5      调试：App.jump('AUTO_ESCALATE')
   ────────────────────────────────────────────────────────────────
   本文件负责（需求.md §4.3）：
     UI-20  锁屏式来电界面（含机主 / 登记状态）
     UI-21  呼出中波形 + 呼出进度
     UI-22  已接通 + 逐句播报字幕（与 App.speak 同步）
     UI-23  三选项应答 + 回执 + 下一位联系人自动转呼
     UI-24  未登记分支：整格「无登记信息，已改派附近志愿者」

   三条铁律：
     1. 只渲染 family-badge / family-screen，不碰别人的容器（契约 §3）
     2. render 是纯函数：只读 state 与模块私有态，不起计时器（契约 §4）
     3. 不改阶段：只发 family:answer，推进由 core / boot 负责（契约 §1）
   红线：本模块不拨打任何真实号码，全部为演示模拟界面（需求.md §1.2）
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  /* ───────── 本机信息：③ 用的是哪一位联系人 ───────── */
  var PRIMARY = D.family.name;
  var primary = findContact(PRIMARY);

  /* 下一位登记联系人：主联系人接不上时自动转呼（UI-23 细化） */
  var BACKUP = D.contacts.filter(function (c) { return c.name !== PRIMARY; })[0] || null;

  function findContact(name) {
    for (var i = 0; i < D.contacts.length; i++) {
      if (D.contacts[i].name === name) return D.contacts[i];
    }
    return { name: name, relation: '', phone: '' };
  }

  /* ───────── 会话态（只有事件回调能写它，render 只读） ───────── */
  var phase      = 'idle';   /* idle 未呼出 | ringing 呼出中 | answered 已接通 */
  var choice     = null;     /* call 联系他 | goto 赶过去 | unreachable 无法接通 */
  var reassigned = false;    /* 无法接通 → 已转呼下一位联系人 */
  var ringAt     = 0;        /* 开始振铃的时刻 */
  var lineAt     = 0;        /* 字幕开始播放的时刻 */
  var lineIndex  = 0;        /* 已点亮到第几句 */

  /* 振铃时长：演示节奏用 2s；真实产品走 CONFIG.FAMILY_CALL_SEC（15s） */
  var RING_MS = Math.min(2000, (C.FAMILY_CALL_SEC || 15) * 1000 * 0.35);

  /* ───────── 播报文案（延迟计算，方便现场改 data.demo.js 后仍生效） ───────── */
  var T = null;        /* 句子数组 */
  var OFFSETS = null;  /* 每句的累计结束时刻（ms） */

  function ensureText() {
    if (T) return;
    T = [
      '您好，这里是' + D.institution.name + '。',
      '您登记的家人' + D.user.name + '刚刚发起了紧急求助。',
      '当前位置在' + D.user.address + '，请尽快联系他，或直接赶过去。'
    ];
    var acc = 0;
    OFFSETS = [];
    T.forEach(function (t) {
      acc += Math.max(1400, Math.min(3000, t.length * 150));
      OFFSETS.push(acc);
    });
  }

  /* ───────── 小工具 ───────── */
  function primaryLabel() {
    return App.esc(primary.name) + '　' + App.esc(primary.relation || '紧急联系人');
  }

  function nowText() {
    var d = new Date();
    return {
      time: String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'),
      date: (d.getMonth() + 1) + '月' + d.getDate() + '日'
    };
  }

  var DISCLAIMER = '<div class="lock-foot">演示模拟外呼 · 不会拨打任何真实号码</div>';

  /* ═══════════ ① UI-20 锁屏：还没升级到家属时，这就是一台安静的手机 ═══════════ */
  function lockHTML() {
    var n   = nowText();
    var reg = D.user.registered;

    return '<div class="lock-screen">' +
        '<div class="lock-time">' + n.time + '</div>' +
        '<div class="lock-date">' + n.date + ' · 静音模式</div>' +

        '<div class="grow center col" style="gap:8px">' +
          '<div style="font-size:26px">' + (reg ? '🔔' : '🔕') + '</div>' +
          '<div class="tiny dim center">' +
            (reg ? '已登记为 ' + App.esc(D.user.name) + ' 的紧急联系人'
                 : '本机未被登记为紧急联系人') +
          '</div>' +
        '</div>' +

        '<div class="card ' + (reg ? 'blue' : 'warn') + '">' +
          '<div class="card-title">' + (reg ? '紧急来电可穿透静音' : '本次不会被呼入') + '</div>' +
          '<div class="card-body">' +
            (reg
              ? '登记关系：' + App.esc(primary.relation || '紧急联系人') + '<br>' +
                '登记时已确认同意接收通知'
              : '该求助者未登记紧急联系人<br>超时升级后将改为联系附近志愿者') +
          '</div>' +
        '</div>' +

        '<div class="tiny dim center">等待中 · 暂无来电</div>' +
        DISCLAIMER +
      '</div>';
  }

  /* ═══════════ ② UI-24 未登记分支：这一格从头到尾不该被呼叫 ═══════════ */
  function unregisteredHTML() {
    var v = D.volunteers[0] || { name: '附近志愿者', distance: 0 };

    return '<div class="screen-title">无登记信息</div>' +
      '<div class="grow center col" style="gap:10px">' +
        '<div style="font-size:34px">📭</div>' +
        '<div class="tiny dim center">该求助者未登记紧急联系人</div>' +
        '<div class="tiny dim center">本机未被呼出</div>' +
      '</div>' +
      '<div class="card blue">' +
        '<div class="card-title">已自动改派附近志愿者</div>' +
        '<div class="card-body">' + App.esc(v.name) + '　' + v.distance + 'km 内响应<br>' +
          '正在赶往求助者位置</div>' +
      '</div>' +
      '<div class="card warn">' +
        '<div class="card-title">建议：补登记紧急联系人</div>' +
        '<div class="card-body">下一次，我们能更快找到他身边的人</div>' +
      '</div>' +
      DISCLAIMER;
  }

  /* ═══════════ ③ UI-21 呼出中 ═══════════ */
  function ringingHTML() {
    return '<div class="call-screen">' +
        '<div class="tiny dim">呼出中 · 系统自动通知</div>' +
        '<div class="caller">' + App.esc(D.institution.name) + '</div>' +
        '<div class="tiny dim">非人工坐席 · 紧急通知专线</div>' +

        '<div class="grow center col" style="gap:14px">' +
          '<div class="wave"><i></i><i></i><i></i><i></i><i></i></div>' +
          '<div class="f-ring">' +
            '<div class="f-ring-tip">正在呼叫家属，请留意接听</div>' +
            '<div class="bar f-ring-bar"><i id="f-ring-bar" style="width:0%"></i></div>' +
          '</div>' +
        '</div>' +

        '<div class="tiny dim center">' + primaryLabel() + '　' + App.esc(primary.phone || '') + '</div>' +
        '<div class="tiny dim center">最长响铃 ' + (C.FAMILY_CALL_SEC || 15) + ' 秒后自动重试</div>' +
        DISCLAIMER +
      '</div>';
  }

  /* ═══════════ ④ UI-22 已接通：逐句字幕 ═══════════ */
  function lineCardHTML(count) {
    return '<div class="card blue" style="text-align:left">' +
        '<div class="card-title">系统语音播报</div>' +
        '<div class="card-body f-lines">' +
          T.map(function (t, i) {
            return '<div class="f-line' + (i < count ? ' on' : '') + '">' + App.esc(t) + '</div>';
          }).join('') +
        '</div>' +
      '</div>';
  }

  /* ═══════════ ⑤ UI-23 三选项 + 回执 ═══════════ */
  var SUB = { call: '我现在就联系他', goto: '我马上赶过去', unreachable: '暂时无法接通' };

  function optionsHTML() {
    return '<div class="f-choice">' +
        '<button id="btn-f-call" class="primary-btn">我现在就联系他</button>' +
        '<button id="btn-f-goto" class="primary-btn warn">我马上赶过去</button>' +
        '<button id="btn-f-no"   class="ghost-btn">暂时无法接通</button>' +
      '</div>';
  }

  function receiptHTML() {
    return '<div class="card ok">' +
        '<div class="card-title">✓ 您的选择：' + App.esc(SUB[choice]) + '</div>' +
        '<div class="card-body">已于 ' + App.fmtTime(App.state.elapsedMs) +
          ' 记录，并同步给机构与志愿者</div>' +
      '</div>';
  }

  /* 选择之后，再补一张"接下来会怎样"的卡 */
  function followUpHTML() {
    var s = App.state.stage;

    if (choice === 'goto') {
      return '<div class="card blue">' +
          '<div class="card-title">前往中 · 已开启位置共享</div>' +
          '<div class="card-body">你的位置会同步给求助者与志愿者<br>' +
            '路上请保持手机畅通</div>' +
        '</div>';
    }
    if (choice === 'call') {
      return '<div class="card blue">' +
          '<div class="card-title">通话中 · 请保持电话畅通</div>' +
          '<div class="card-body">机构与志愿者已同步你的响应<br>' +
            '如果他不接，请打开免提，让他听见你</div>' +
        '</div>';
    }
    return '<div class="card warn">' +
        '<div class="card-title">本机已结束呼叫</div>' +
        '<div class="card-body">' +
          (BACKUP ? '系统已转呼下一位联系人：' + App.esc(BACKUP.name) +
                    '（' + App.esc(BACKUP.relation) + '）'
                  : '无其他登记联系人') + '<br>' +
          '附近志愿者同时赶往现场，流程不会中断' +
        '</div>' +
      '</div>' +
      (s === 'AUTO_ESCALATE' || s === 'VIDEO_SESSION'
        ? '<button id="btn-f-undo" class="ghost-btn">等一下，我马上去</button>'
        : '');
  }

  /* ═══════════ ⑥ 通话屏（AUTO_ESCALATE / VIDEO_SESSION 共用） ═══════════ */
  function callHTML() {
    var count = (phase === 'answered') ? lineIndex : T.length;

    return '<div class="call-screen connected">' +
        '<div class="tiny dim">已接通 · 系统语音播报</div>' +
        '<div class="caller">' + App.esc(D.institution.name) + '</div>' +

        lineCardHTML(count) +
        (choice ? receiptHTML() + followUpHTML() : optionsHTML()) +

        '<div class="tiny dim center">' + primaryLabel() + '</div>' +
        DISCLAIMER +
      '</div>';
  }

  /* ═══════════ ⑦ 志愿者已到场 ═══════════ */
  function siteHTML() {
    var v = D.volunteers[0] || { name: '志愿者' };

    return '<div class="screen-title">志愿者已到达他身边</div>' +
      (choice ? receiptHTML() : optionsHTML()) +
      '<div class="card ok">' +
        '<div class="card-title">✓ ' + App.esc(v.name) + ' 已到场打卡</div>' +
        '<div class="card-body">现场已交接，你可以放心了<br>处置结果会同步给你</div>' +
      '</div>' +
      '<div class="card blue">' +
        '<div class="card-title">你可以做的</div>' +
        '<div class="card-body">· 保持手机畅通<br>· 别一个人扛着，回访会打给你</div>' +
      '</div>' +
      DISCLAIMER;
  }

  /* ═══════════ ⑧ 闭环 ═══════════ */
  function closedHTML() {
    return '<div class="screen-title">本次事件已闭环</div>' +
      '<div class="grow center col" style="gap:8px">' +
        '<div style="font-size:30px">🤝</div>' +
        '<div class="tiny dim center">感谢你的响应</div>' +
      '</div>' +
      (choice ? receiptHTML() : '') +
      '<div class="card blue">' +
        '<div class="card-title">48 小时内会有专人回访</div>' +
        '<div class="card-body">家属同样需要被支持，不必独自消化</div>' +
      '</div>' +
      DISCLAIMER;
  }

  /* ═══════════ 角标 ═══════════ */
  function badgeFor(s) {
    if (s === 'IDLE' || s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      return { badge: '待机', tone: null };
    }
    if (!D.user.registered) return { badge: '未呼叫', tone: null };
    if (s === 'CLOSED')     return { badge: '已闭环', tone: 'ok' };
    if (choice)             return { badge: '已应答', tone: 'ok' };
    if (s === 'AUTO_ESCALATE' && phase === 'ringing') {
      return { badge: '● 呼出中', tone: 'danger' };
    }
    return { badge: (phase === 'answered' ? '已接通' : '已通知'), tone: 'on' };
  }

  /* ═══════════════════════ 渲染 ═══════════════════════ */
  App.define('family', function (state) {
    var s = state.stage;
    ensureText();

    var b = badgeFor(s);
    var html;

    if (s === 'IDLE' || s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      html = lockHTML();
    } else if (!D.user.registered) {
      html = unregisteredHTML();
    } else if (s === 'AUTO_ESCALATE' || s === 'VIDEO_SESSION') {
      html = (phase === 'ringing') ? ringingHTML() : callHTML();
    } else if (s === 'ON_SITE') {
      html = siteHTML();
    } else {
      html = closedHTML();
    }

    return { badge: b.badge, tone: b.tone, html: html };
  });

  /* ═══════════ 局部刷新：只改 DOM，不整屏重绘 ═══════════ */
  function paintRing(left) {
    var el = App.el('family-screen');
    if (!el) return;
    var bar = el.querySelector('#f-ring-bar');
    if (bar) {
      var pct = Math.max(0, Math.min(100, 100 - (left / RING_MS) * 100));
      bar.style.width = pct.toFixed(0) + '%';
    }
  }

  function paintLines() {
    var el = App.el('family-screen');
    if (!el) return;
    var nodes = el.querySelectorAll('.f-line');
    for (var i = 0; i < nodes.length; i++) {
      if (i < lineIndex) nodes[i].classList.add('on');
    }
  }

  /* ═══════════ 副作用一：进入自动升级 → 系统外呼家属（契约 §5） ═══════════ */
  App.on('escalate:auto', function () {
    if (!D.user.registered) {
      App.log('求助者未登记紧急联系人，本机（' + D.family.name + '）不会被呼出');
      return;
    }

    phase      = 'ringing';
    choice     = null;
    reassigned = false;
    lineIndex  = 0;
    ringAt     = Date.now();
    lineAt     = 0;

    /* 兜底：若演示者直接从 IDLE 跳到本阶段，全局表还没开 */
    if (!App.state.startedAt) App.startTicker();

    App.log('系统自动外呼紧急联系人：' + D.family.name, { hi: true });
    App.render('family');
  });

  /* ═══════════ 副作用二：用全局心跳驱动呼出计时与字幕（契约 §4.3） ═══════════ */
  App.on('timer:tick', function () {
    /* ① 呼出 → 自动接通 */
    if (phase === 'ringing') {
      var left = RING_MS - (Date.now() - ringAt);
      if (left > 0) { paintRing(left); return; }

      phase     = 'answered';
      lineAt    = Date.now();
      lineIndex = 1;
      App.render('family');
      App.speak(T[0], { interrupt: true });
      return;
    }

    /* ② 已接通 → 逐句点亮字幕，并与语音播报同步 */
    if (phase !== 'answered') return;

    var el = App.el('family-screen');
    if (!el || !el.querySelector('.f-lines')) return;   /* 已切到到场/闭环屏，不再刷 */

    var elapsed = Date.now() - lineAt;
    var idx = 1;
    for (var i = 1; i < T.length; i++) if (elapsed >= OFFSETS[i - 1]) idx = i + 1;

    if (idx > lineIndex) {
      lineIndex = idx;
      paintLines();
      App.speak(T[idx - 1], { interrupt: true });
    }
  });

  /* 演示推进太快（AUTO_ESCALATE 只停留 3 秒）→ 直接视为已接通，字幕继续在视频阶段走完 */
  App.on('stage:change', function (e) {
    if (e.to === 'AUTO_ESCALATE') return;
    if (phase === 'ringing') {
      phase     = 'answered';
      lineIndex = Math.max(lineIndex, 1);
      lineAt    = Date.now();
      App.render('family');
    }
  });

  /* ═══════════ 交互：家属应答 ═══════════ */
  function pick(c, label) {
    if (!D.user.registered) return;

    choice     = c;
    phase      = 'answered';
    reassigned = (c === 'unreachable' && !!BACKUP);
    if (lineIndex === 0) { lineAt = Date.now(); lineIndex = 1; }

    App.speakStop();
    App.log('家属响应：' + label, { hi: true });
    App.emit('family:answer', { choice: c });

    if (reassigned) {
      App.log('已自动转呼下一位联系人：' + BACKUP.name + '（' + BACKUP.relation + '）');
    }
    App.render('family');
  }

  /* ⚠️ core.state.js 的 App.delegate 有个 __delegated 守卫：
       同一个 role 只有【第一次】调用会真正绑上监听，
       后面几次调用的 selector / handler 会被静默丢弃。
     所以四个按钮必须合并进一次委托，用 id 分派。
     （已反馈给框架负责人，见 docs/家属端细化设计.md §5.1；此处是无需改 core 的规避写法） */
  var ACTIONS = {
    'btn-f-call': ['call',        '我现在就联系他'],
    'btn-f-goto': ['goto',        '我马上赶过去'],
    'btn-f-no':   ['unreachable', '暂时无法接通'],
    'btn-f-undo': ['goto',        '取消未接通，我马上赶过去']
  };

  App.delegate('family', '#btn-f-call, #btn-f-goto, #btn-f-no, #btn-f-undo', 'f:pick',
    function (hit) {
      var act = ACTIONS[hit.id];
      if (act) pick(act[0], act[1]);
    });

  /* ═══════════ 重置 ═══════════ */
  App.on('app:reset', function () {
    phase      = 'idle';
    choice     = null;
    reassigned = false;
    ringAt     = 0;
    lineAt     = 0;
    lineIndex  = 0;
    T          = null;
    OFFSETS    = null;
    App.speakStop();
  });

  console.log('[ui.family] 已注册（细化版：锁屏 / 呼出 / 逐句字幕 / 三选项 / 未登记分支）');
})();
