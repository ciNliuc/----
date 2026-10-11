/* ════════════════════════════════════════════════════════════════
   src/boot.js   ← 启动器 + 演示总指挥（自动播放流程）
   负责人：框架负责人
   最后加载。负责：
     1. 控制条按钮（开始演示 / 下一步 / 重置 / 自动演示开关）
     2. 自动演示的时间编排（谁在什么阶段停留多久）
     3. 键盘快捷键
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var C       = App.CONFIG;
  var timers  = [];
  var playing = false;

  function later(fn, ms) {
    var id = setTimeout(fn, ms);
    timers.push(id);
    return id;
  }

  function clearTimers() {
    timers.forEach(clearTimeout);
    timers = [];
  }

  function autoOn() {
    var chk = App.el('chk-auto');
    return !!(chk && chk.checked);
  }

  /* ═══════════ 自动演示编排 ═══════════
     每个阶段进来后停留多久，然后自动推进到下一阶段。
     返回 0 表示"停在这里，等人手动操作"。
     ═════════════════════════════════════ */
  var HOLD = {
    SOS_TRIGGERED:     2200,   /* 看求助者与机构同时亮起 */
    INSTITUTION_ALERT: function () { return C.AUTO_ESCALATE_SEC * 1000; },  /* 走完自动升级倒计时 */
    AUTO_ESCALATE:     3000,   /* 看家属外呼 + 志愿者派单 */
    VIDEO_SESSION:     0,      /* 不真弹视频窗：进阶段即「已发起」，停留时长交给 video:open 接管 */
    ON_SITE:           5000,
    CLOSED:            0       /* 到底了 */
  };

  function scheduleNext(stage) {
    if (!playing || !autoOn()) return;

    var hold = HOLD[stage];
    if (typeof hold === 'function') hold = hold();
    if (!hold) return;

    later(function () {
      if (App.state.stage === stage) App.next();
    }, hold);
  }

  App.on('stage:change', function (e) {
    updateButtons();
    if (e.to === 'CLOSED') { playing = false; updateButtons(); return; }
    scheduleNext(e.to);
  });

  /* 家属应答 / 志愿者接单 都可以加快节奏（可选，留作扩展） */
  App.on('family:answer',    function () { updateButtons(); });
  App.on('volunteer:accept', function () { updateButtons(); });

  /* 视频通话「已发起」后，停留 VIDEO_SEC 再自动进"到场"。
     需求变更后不再弹真实视频窗：这个事件由 ④（ui.volunteer.js）在进入
     VIDEO_SESSION 时模拟发出（ok:true），节奏与原来一致。
     ⚠️ 只在「自动演示」打开时自动推进；手动模式由操作手按 下一步/空格，
        否则操作手还没讲完就被自动跳走了。 */
  App.on('video:open', function (e) {
    if (!e.ok) return;
    if (!playing || !autoOn()) return;
    later(function () {
      if (App.state.stage === 'VIDEO_SESSION') App.next();
    }, (C.VIDEO_SEC || 12) * 1000);
  });

  /* ═══════════ 控制条 ═══════════ */
  function updateButtons() {
    var s    = App.state.stage;
    var play = App.el('btn-play');
    var next = App.el('btn-next');

    if (play) {
      if (s === 'IDLE') {
        play.textContent = '▶ 开始演示';
        play.disabled = false;
      } else if (s === 'CLOSED') {
        play.textContent = '▶ 已结束';
        play.disabled = true;
      } else {
        play.textContent = '▶ 演示中…';
        play.disabled = true;
      }
    }

    if (next) {
      next.textContent = (s === 'ON_SITE') ? '结束演示 ▸' : '下一步 →';
      next.disabled = (s === 'IDLE' || s === 'CLOSED');
    }
  }

  function wire() {
    var play = App.el('btn-play');
    var next = App.el('btn-next');
    var rst  = App.el('btn-reset');

    if (play) play.addEventListener('click', function () {
      var s = App.state.stage;

      if (s === 'IDLE') {
        /* 走和用户点按钮完全相同的路径。
           ⚠️ 契约 §5：sos:tap 由 core 统一推进 IDLE → SOS_TRIGGERED，
           这里**不能**再补一次 App.next()，否则会连跳两级、跳过 SOS_TRIGGERED。
           留声：自动演示没有二选一的界面，已留声时就按「带留声」这条线走
           （voiceReady 为假则与原行为完全一致）。 */
        playing = true;
        App.emit('sos:tap', { at: Date.now(), voice: !!App.state.voiceReady });
      }
    });

    if (next) next.addEventListener('click', function () {
      playing = playing || autoOn();
      /* ON_SITE 时按"结束演示"直接闭环 */
      App.next();
    });

    if (rst) rst.addEventListener('click', function () {
      clearTimers();
      playing = false;
      App.reset();
    });

    var chk = App.el('chk-auto');
    if (chk) chk.addEventListener('change', function () {
      if (!chk.checked) clearTimers();
      else if (App.state.stage !== 'IDLE' && App.state.stage !== 'CLOSED') scheduleNext(App.state.stage);
    });
  }

  /* ═══════════ 键盘快捷键（演示时救场用） ═══════════ */
  document.addEventListener('keydown', function (e) {
    /* 空格 / → ：推进 */
    if (e.key === 'ArrowRight' || e.key === ' ') {
      e.preventDefault();
      playing = true;
      /* 契约 §5：IDLE 下的 sos:tap 已由 core 推进，勿再补 App.next()。
         留声：与 ▶ 按钮一致，已留声时按「带留声」走。 */
      if (App.state.stage === 'IDLE') {
        App.emit('sos:tap', { voice: !!App.state.voiceReady });
      }
      else App.next();
    }
    /* R ：重置 */
    if (e.key === 'r' || e.key === 'R') { clearTimers(); playing = false; App.reset(); }
    /* 1–7 ：直接跳到某个阶段（调试 / 救场） */
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= App.STAGES.length) { clearTimers(); App.jump(App.STAGES[n - 1]); }
  });

  /* ═══════════ 四列手机等比缩放（framework 维护） ═══════════
     设计宽度固定 360px（需求.md §4），高度默认 640px。
     四列并排时面板的可用宽/高常常小于设计尺寸，于是整台手机等比缩小，
     而不是去改内部尺寸——内部尺寸一动，各模块的绝对定位元素就会挤在一起。
     规则：
       · 先按宽度定标；若定标后高度还有富余，就把手机拉高到占满（逻辑高度
         上限 900px），这样大屏上不会留一大条空白，内容也不容易溢出要滚动；
       · 高度不够时按高度定标，逻辑高度守着 640px 下限。
     只写 --phone-scale 与 --phone-h 两个变量，占位盒大小交给 base.css 算。 */
  var PHONE_W = 360, PHONE_MIN_H = 640, PHONE_MAX_H = 900;

  function fitPhones() {
    var grid = App.el('grid');
    if (!grid || !grid.firstElementChild) return;          /* 单测桩里没有真实布局 */

    var panel = grid.firstElementChild;
    var head  = panel.querySelector ? panel.querySelector('.panel-head') : null;
    var availW = (panel.clientWidth  || 0) - 20;           /* 左右各留 10px 余量 */
    var availH = (panel.clientHeight || 0) - (head ? head.offsetHeight : 0) - 16;
    if (!(availW > 0) || !(availH > 0)) return;

    var scaleMax = Math.min(availW / PHONE_W, availH / PHONE_MIN_H);
    var scale    = Math.max(0.45, Math.min(scaleMax, 2.2));   /* 兜底上下限，防极端窗口 */
    var h        = Math.min(availH / scale, PHONE_MAX_H);
    if (!(h >= PHONE_MIN_H)) h = PHONE_MIN_H;

    var root = document.documentElement;
    if (root && root.style && root.style.setProperty) {
      root.style.setProperty('--phone-scale', scale.toFixed(4));
      root.style.setProperty('--phone-h', Math.round(h) + 'px');
    }
    App.state.phoneScale = scale;                          /* 仅调试用 */
    App.state.phoneH     = Math.round(h);
  }

  fitPhones();
  if (window.addEventListener) {
    window.addEventListener('resize', fitPhones);
    window.addEventListener('orientationchange', fitPhones);
    window.addEventListener('load', fitPhones);            /* 字体加载完再量一次 */
  }
  if (window.requestAnimationFrame) window.requestAnimationFrame(fitPhones);

  /* ═══════════ 启动 ═══════════ */
  wire();
  updateButtons();

  console.log('%c[App] boot 完成 —— Demo 就绪',
    'color:#3fb950;font-weight:700',
    '\n快捷键：空格/→ 推进　R 重置　1-7 直接跳阶段' +
    '\n自动演示：' + (autoOn() ? '开' : '关'));
})();
