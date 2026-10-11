/* ════════════════════════════════════════════════════════════════
   src/core.state.js   ← 状态机 + 事件总线 + 注册表
   负责人：框架负责人    其他人不要修改本文件
   契约：src/contract.md §2 §3 §4
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ───────── 阶段定义 ───────── */
  var STAGES = [
    'IDLE', 'SOS_TRIGGERED', 'INSTITUTION_ALERT', 'AUTO_ESCALATE',
    'VIDEO_SESSION', 'ON_SITE', 'CLOSED'
  ];

  /* 每个阶段：哪几格亮、亮什么颜色（DOM id 见 contract.md §3） */
  var STAGE_UI = {
    IDLE:              { active: { user: null, institution: null, family: null, volunteer: null } },
    SOS_TRIGGERED:     { active: { user: 'blue', institution: 'danger', family: null, volunteer: null } },
    INSTITUTION_ALERT: { active: { user: 'blue', institution: 'danger', family: null, volunteer: null } },
    AUTO_ESCALATE:     { active: { user: 'blue', institution: 'warn', family: 'danger', volunteer: 'blue' } },
    VIDEO_SESSION:     { active: { user: 'blue', institution: 'warn', family: 'blue', volunteer: 'blue' } },
    ON_SITE:           { active: { user: 'ok',   institution: 'warn', family: 'blue', volunteer: 'ok' } },
    CLOSED:            { active: { user: 'ok',   institution: 'ok',   family: 'ok',   volunteer: 'ok' } }
  };

  var STAGE_LABEL = {
    IDLE:              'IDLE 待机',
    SOS_TRIGGERED:     'SOS 求助已发起',
    INSTITUTION_ALERT: '机构告警中',
    AUTO_ESCALATE:     '⚡ 自动升级',
    VIDEO_SESSION:     '视频疏导中',
    ON_SITE:           '志愿者已到场',
    CLOSED:            '已闭环'
  };

  var PANELS = ['user', 'institution', 'family', 'volunteer'];

  /* ───────── 全局对象 ───────── */
  var App = {};
  window.App = App;

  App.STAGES  = STAGES.slice();
  App.CONFIG  = window.APP_CONFIG;
  App.DATA    = window.DEMO_DATA;

  App.state = {
    stage:      'IDLE',
    startedAt:  null,
    elapsedMs:  0,
    videoRoom:  null,
    videoOpen:  false
  };

  /* ───────── 事件总线 ───────── */
  var handlers = {};

  App.on = function (event, fn) {
    (handlers[event] = handlers[event] || []).push(fn);
    return function off() { App.off(event, fn); };
  };

  App.off = function (event, fn) {
    var list = handlers[event];
    if (!list) return;
    var i = list.indexOf(fn);
    if (i > -1) list.splice(i, 1);
  };

  App.emit = function (event, payload) {
    var list = (handlers[event] || []).slice();
    for (var i = 0; i < list.length; i++) {
      try { list[i](payload || {}); }
      catch (err) { console.error('[App] handler error on "' + event + '":', err); }
    }
  };

  /* ───────── 工具 ───────── */
  App.el = function (id) { return document.getElementById(id); };

  App.fmtTime = function (ms) {
    var s = Math.floor(ms / 1000);
    return String(Math.floor(s / 60)).padStart(2, '0') + ':' +
           String(s % 60).padStart(2, '0');
  };

  /* 转义，模块内拼 HTML 请一律用它包住动态内容 */
  App.esc = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ───────── 状态写入（不流转阶段） ───────── */
  App.set = function (patch) {
    if (!patch) return App.state;
    for (var k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) {
      App.state[k] = patch[k];
    }
    renderAll();
    return App.state;
  };

  /* ───────── 注册表：模块 render（contract.md §4） ───────── */
  var renderers = {};

  App.register = function (role, fn) {
    if (PANELS.indexOf(role) < 0) {
      throw new Error('[App] 未知角色 "' + role + '"，可选：' + PANELS.join(' / '));
    }
    if (typeof fn !== 'function') {
      throw new Error('[App] App.register("' + role + '", fn) 需要传函数');
    }
    renderers[role] = fn;
    safeRender(role);
  };

  function safeRender(role) {
    var fn = renderers[role];
    if (!fn) return;
    try { fn(App.state); }
    catch (err) {
      console.error('[App] render "' + role + '" 抛错：', err);
      /* 单个模块崩了不能白屏整页 —— 契约要求 §8 */
      var sc = App.el(role + '-screen');
      if (sc) sc.innerHTML = '<div class="tiny" style="color:#f85149">' +
        '模块 ' + role + ' 渲染出错，请看控制台</div>';
    }
  }

  function renderAll() {
    for (var i = 0; i < PANELS.length; i++) safeRender(PANELS[i]);
    paintPanels();
    paintHeader();
  }

  App.render = function (role) {
    if (role) safeRender(role); else renderAll();
    return App.state;
  };

  App.renderAll = renderAll;

  /* ───────── 面板高亮 + 顶栏 ───────── */
  function paintPanels() {
    var conf = (STAGE_UI[App.state.stage] || {}).active || {};
    for (var i = 0; i < PANELS.length; i++) {
      var p = App.el('panel-' + PANELS[i]);
      if (!p) continue;
      p.classList.remove('active', 'danger', 'warn', 'ok');
      var c = conf[PANELS[i]];
      if (!c) continue;
      p.classList.add('active');
      if (c !== 'blue') p.classList.add(c);
    }
  }

  function paintHeader() {
    var sl = App.el('stage-label');
    if (sl) sl.textContent = STAGE_LABEL[App.state.stage] || App.state.stage;
    var gt = App.el('global-timer');
    if (gt) gt.textContent = App.fmtTime(App.state.elapsedMs);
  }

  /* ───────── 阶段流转 ───────── */
  App.next = function () {
    var i = STAGES.indexOf(App.state.stage);
    if (i < 0 || i >= STAGES.length - 1) return App.state.stage;
    return setStage(STAGES[i + 1]);
  };

  App.jump = function (stage) {
    if (STAGES.indexOf(stage) < 0) {
      throw new Error('[App] 未知阶段 "' + stage + '"');
    }
    return setStage(stage);
  };

  function setStage(stage) {
    var from = App.state.stage;
    if (from === stage) return stage;

    App.state.stage = stage;

    var isTerminal = (stage === 'CLOSED');

    /* 进入 AUTO_ESCALATE → 广播自动升级（真正的业务动作由各模块订阅） */
    if (stage === 'AUTO_ESCALATE') {
      App.emit('escalate:auto', { reason: 'timeout', at: Date.now() });
    }

    renderAll();
    App.emit('stage:change', { from: from, to: stage, state: App.state });

    /* CLOSED 停表 */
    if (isTerminal && tickerId) { clearInterval(tickerId); tickerId = null; }

    return stage;
  }

  /* ───────── 全局计时 ───────── */
  var tickerId = null;

  function startTicker() {
    if (tickerId) return;
    App.state.startedAt = Date.now();
    tickerId = setInterval(function () {
      App.state.elapsedMs = Date.now() - App.state.startedAt;
      paintHeader();
      App.emit('timer:tick', { elapsedMs: App.state.elapsedMs, stage: App.state.stage });
    }, 200);
  }

  function stopTicker() {
    if (tickerId) { clearInterval(tickerId); tickerId = null; }
  }

  App.startTicker = startTicker;
  App.stopTicker  = stopTicker;

  /* ───────── 出发：进 SOS 时自动开表 ───────── */
  App.on('stage:change', function (e) {
    if (e.to === 'SOS_TRIGGERED' && !App.state.startedAt) startTicker();
  });

  /* ───────── 机构确认接手（contract.md §5：跳过自动升级，直接进 VIDEO_SESSION） ─────────
     B 端（ui.institution.js）点「立即确认接手」时 emit('institution:ack')，
     由这里统一执行阶段流转，模块自己不改阶段。
     加 stage 校验：只有还在"等确认"的两个阶段才允许跳过升级。 */
  App.on('institution:ack', function () {
    if (App.state.stage === 'SOS_TRIGGERED' || App.state.stage === 'INSTITUTION_ALERT') {
      setStage('VIDEO_SESSION');
    }
  });

  /* ───────── 处置闭环（contract.md §5：ON_SITE → CLOSED） ─────────
     B 端（ui.institution.js）点「结束处置」时 emit('demo:closed')。 */
  App.on('demo:closed', function () {
    if (App.state.stage === 'ON_SITE') setStage('CLOSED');
  });

  /* ───────── 重置（contract.md §2） ───────── */
  App.reset = function () {
    stopTicker();
    App.state.stage     = 'IDLE';
    App.state.startedAt = null;
    App.state.elapsedMs = 0;
    App.state.videoRoom = null;
    App.state.videoOpen = false;

    var tl = App.el('timeline');
    if (tl) tl.innerHTML = '';

    var ro = App.el('report-overlay');
    if (ro) { ro.classList.add('hidden'); ro.innerHTML = ''; }

    App.emit('app:reset', {});
    renderAll();
    App.emit('stage:change', { from: null, to: 'IDLE', state: App.state });
    return App.state;
  };

  /* ═══════════ 模块开发辅助（各 ui.*.js 请用这几个） ═══════════
     目的：让每个模块 20 行内就能跑起来，把时间花在视觉而不是样板代码上。
     ═══════════════════════════════════════════════════════════ */

  /* 按阶段取内容，缺省兜底。
     用法：
       App.pick(state, {
         IDLE:          '<div>待机</div>',
         SOS_TRIGGERED: '<div>求助中</div>'
       }, '<div>本角色待机</div>')          ← 第三个参数是可选的兜底 HTML */
  App.pick = function (state, map, fallback) {
    var html = map[state.stage];
    if (html == null) {
      html = (fallback != null) ? fallback
           : '<div class="tiny dim">本角色在 ' + state.stage + ' 阶段待机</div>';
    }
    return html;
  };

  /* 设置角标文字与颜色：tone = 'on' | 'danger' | 'warn' | 'ok' | null */
  App.setBadge = function (role, text, tone) {
    var b = App.el(role + '-badge');
    if (!b) return;
    b.textContent = text || '';
    b.className = 'badge' + (tone ? ' ' + tone : '');
  };

  /* 注册模块：App.define('user', function(state){ return {badge, tone, html}; })
     比直接 App.register 少写一堆 DOM 样板。两种方式等价。 */
  App.define = function (role, fn) {
    App.register(role, function (state) {
      var out = fn(state) || {};
      App.setBadge(role, out.badge, out.tone);
      var sc = App.el(role + '-screen');
      if (sc && out.html != null) sc.innerHTML = out.html;
    });
  };

  /* 在指定角色的手机屏上做事件委托（不用每次重绑，因为容器永不重建） */
  App.delegate = function (role, selector, eventName, handler) {
    var sc = App.el(role + '-screen');
    if (!sc || sc.__delegated) return;
    sc.__delegated = true;
    sc.addEventListener('click', function (ev) {
      var hit = ev.target.closest(selector);
      if (hit && sc.contains(hit)) handler(hit, ev);
    });
  };

  /* ───────── 启动日志 ───────── */
  console.log('%c[App] core.state 就绪', 'color:#2f81f7;font-weight:700',
    '\n可用调试命令：App.jump("AUTO_ESCALATE") / App.next() / App.reset()');
})();
