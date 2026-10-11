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
    VIDEO_SESSION:     0,      /* ⚠️ 必须人工点击开视频（否则弹窗被拦） */
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

  /* 视频窗口打开后，让它停留 VIDEO_SEC 再自动进"到场" */
  App.on('video:open', function (e) {
    if (!e.ok) return;
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
      } else if (s === 'VIDEO_SESSION') {
        play.textContent = '▶ 打开视频窗口';
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
        /* 走和用户点按钮完全相同的路径 */
        playing = true;
        App.emit('sos:tap', { at: Date.now() });
        App.next();

      } else if (s === 'VIDEO_SESSION') {
        /* ⚠️ 这里是真实用户手势，openVideo 必须同步调用 */
        App.openVideo();
        App.render('volunteer');
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
      if (App.state.stage === 'IDLE') { App.emit('sos:tap', {}); App.next(); }
      else App.next();
    }
    /* R ：重置 */
    if (e.key === 'r' || e.key === 'R') { clearTimers(); playing = false; App.reset(); }
    /* V ：视频 */
    if (e.key === 'v' || e.key === 'V') { App.openVideo(); App.render('volunteer'); }
    /* 1–7 ：直接跳到某个阶段（调试 / 救场） */
    var n = parseInt(e.key, 10);
    if (n >= 1 && n <= App.STAGES.length) { clearTimers(); App.jump(App.STAGES[n - 1]); }
  });

  /* ═══════════ 启动 ═══════════ */
  wire();
  updateButtons();

  console.log('%c[App] boot 完成 —— Demo 就绪',
    'color:#3fb950;font-weight:700',
    '\n快捷键：空格/→ 推进　R 重置　V 视频　1-7 直接跳阶段' +
    '\n自动演示：' + (autoOn() ? '开' : '关'));
})();
