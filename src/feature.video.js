/* ════════════════════════════════════════════════════════════════
   src/feature.video.js   ← 真实视频通话拉起 + 降级
   负责人：框架负责人

   ⚠️ 2026-10-12 起**已停用**（需求.md v2.2）：④ 进 VIDEO_SESSION 不再弹真实
      视频窗口，只显示「已发起视频通话 / 志愿者正在赶来」，所以本文件的
      App.openVideo() / App.callScreenHTML() 现在**没有任何调用点**。
      代码与 video:open 的 payload 契约原样保留 —— 要退回真视频，只需在
      ui.volunteer.js 进 VIDEO_SESSION 时重新调用 App.openVideo()。

   对外：App.openVideo() → boolean
   依赖：App.CONFIG.VIDEO_URL / VIDEO_ROOM

   ─── 本次改动要点（D 分支） ───
   1. 降级画面改为纯 CSS 绘制，不再依赖 assets/video-fallback.png
      （该文件不在仓库里，load 失败只会剩下一个 emoji 占位）
   2. 弹窗被拦时视为"已接通"（videoRoom 仍写入 fallback- 前缀），
      演示流程继续，不会卡在 VIDEO_SESSION
   3. video:open 的 payload 增加 fallback 字段（原有 room / url / ok 不变）
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var videoActive  = false;    /* 是否已进入"通话中"（含降级） */
  var fallbackMode = false;    /* 是否是占位画面 */

  /**
   * 拉起视频房间。
   * ⚠️ 必须在用户点击的**同步回调**里调用，否则浏览器会当成弹窗广告拦掉。
   *    不要包在 setTimeout / await 之后再调用。
   * @returns {boolean} true = 真实窗口已打开；false = 走了占位画面
   */
  App.openVideo = function () {
    var C    = App.CONFIG;
    /* 每次演示用独立房间名，避免和陌生人撞进同一个房间 */
    var room = C.VIDEO_ROOM + '-' + Date.now().toString(36);
    var url  = C.VIDEO_URL + room;

    var win = null;
    var ok  = false;

    try {
      win = window.open(url, 'dsh-video-demo',
        'width=430,height=320,left=40,top=80,noopener=0');
      ok = !!(win && !win.closed);
    } catch (err) {
      console.warn('[video] window.open 抛错：', err);
      ok = false;
    }

    videoActive  = true;            /* 关键：降级也算已接通，流程不能断 */
    fallbackMode = !ok;

    /* 降级时给一个 fallback- 前缀的房间名：
       ① 宫格④ 会显示"占位画面"并隐藏房间名
       ② 队友看到就知道这次没真的拉起来 */
    App.set({ videoRoom: ok ? room : ('fallback-' + room), videoOpen: ok });

    if (ok) {
      App.log('已拉起视频通话房间：' + room, { hi: true });
      console.log('%c[video] 请让队友在另一台设备打开：' + url,
                  'color:#3fb950;font-weight:700');
    } else {
      App.log('视频窗口被浏览器拦截，已切换为占位画面（流程继续）', { hi: true });
      console.warn('[video] 弹窗被拦。检查：① 是否同步调用 ② 浏览器弹窗设置');
    }

    /* 通话计时由宫格④（ui.volunteer.js）负责，这里不重复起表 */
    App.emit('video:open', { room: room, url: url, ok: ok, fallback: !ok });
    return ok;
  };

  /* ───────── 供宫格④ 渲染通话画面 ─────────
     纯 CSS 绘制，不引用任何图片文件。
     @param {object} [opts] { name, seconds, showRoom }
     @returns {string} HTML（未接通时返回空串）                */
  App.callScreenHTML = function (opts) {
    if (!videoActive) return '';

    opts = opts || {};
    var name    = opts.name || '志愿者';
    var seconds = opts.seconds || 0;
    var initial = String(name).charAt(0);

    var wave = '<div class="call-wave">';
    for (var i = 1; i <= 5; i++) wave += '<i style="--d:' + (i * 0.12).toFixed(2) + 's"></i>';
    wave += '</div>';

    return '<div class="video-call">' +
        '<div class="call-remote">' +
          '<div class="call-avatar">' + App.esc(initial) + '</div>' +
          (fallbackMode ? '<div class="call-flag">⚠ 占位画面（演示用，非真实接通）</div>' : '') +
        '</div>' +
        '<div class="call-pip"><span>我</span></div>' +
        '<div class="call-info">' +
          '<div class="call-name">' + App.esc(name) + '</div>' +
          '<div class="call-timer"><span class="rec-dot"></span>' +
            '<b class="mono" data-call-timer>' + App.fmtTime(seconds * 1000) + '</b></div>' +
        '</div>' +
        wave +
        (opts.showRoom
          ? '<div class="call-room"><div class="tiny dim">房间名（队友需在另一台设备输入）</div>' +
            '<div class="call-room-code mono">' + App.esc(App.state.videoRoom) + '</div></div>'
          : '') +
        '<div class="call-ctrl">' +
          '<span class="call-btn">🎙</span>' +
          '<span class="call-btn">📷</span>' +
          '<span class="call-btn hang">📵</span>' +
        '</div>' +
      '</div>';
  };

  /* 通话画面是否处于"占位"状态（宫格④ 用它决定要不要显示房间名） */
  App.videoIsFallback = function () { return fallbackMode; };

  App.closeVideo = function () {
    videoActive  = false;
    fallbackMode = false;
    App.set({ videoOpen: false });
  };

  App.on('app:reset', function () {
    videoActive  = false;
    fallbackMode = false;
  });

  console.log('[video] 就绪。演示前请让队友提前进入房间，或准备好占位画面。');
})();
