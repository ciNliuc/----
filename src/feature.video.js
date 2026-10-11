/* ════════════════════════════════════════════════════════════════
   src/feature.video.js   ← 真实视频通话拉起 + 降级
   负责人：D
   对外：App.openVideo() → boolean
   依赖：App.CONFIG.VIDEO_URL / VIDEO_ROOM
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  /* ⚠️ 关键：本函数必须在用户点击的**同步回调**里被调用，
         否则浏览器会判定为弹窗广告并拦截。
         不要包在 setTimeout / await 之后再调用。 */
  App.openVideo = function () {
    var C    = App.CONFIG;
    /* 每次演示用独立房间名，避免和陌生人在同一个房间里 */
    var room = C.VIDEO_ROOM + '-' + Date.now().toString(36);
    var url  = C.VIDEO_URL + room;

    var ok  = false;
    var win = null;

    try {
      win = window.open(url, 'dsh-video-demo',
        'width=430,height=320,left=40,top=80,noopener=0');
      ok = !!(win && !win.closed);
    } catch (err) {
      console.warn('[video] window.open 抛错：', err);
      ok = false;
    }

    App.set({ videoRoom: room, videoOpen: ok });

    if (ok) {
      App.log('已拉起视频通话房间：' + room, { hi: true });
      console.log('%c[video] 请让队友在另一台设备打开：' + url,
                  'color:#3fb950;font-weight:700');
    } else {
      App.log('视频窗口被拦截，已切换为降级展示', { hi: true });
      showFallback();
    }

    App.emit('video:open', { room: room, url: url, ok: ok });
    return ok;
  };

  /**
   * 降级展示：弹窗被拦截时，在志愿者手机屏里显示一张"通话中"占位图。
   * 把一张真实视频截图放到 assets/video-fallback.png 即可自动生效。
   */
  function showFallback() {
    var sc = App.el('volunteer-screen');
    if (!sc) return;

    var box = sc.querySelector('.video-stage');
    if (!box) {
      box = document.createElement('div');
      box.className = 'video-stage';
      sc.appendChild(box);
    }

    box.innerHTML =
      '<img src="assets/video-fallback.png" alt="视频通话中" ' +
      '  onerror="this.style.display=\'none\';this.nextElementSibling.style.display=\'flex\'">' +
      '<div class="video-placeholder" style="display:none">' +
      '  <div style="font-size:34px">📹</div>' +
      '  <div style="font-weight:700">视频通话中</div>' +
      '  <div class="tiny">（窗口被浏览器拦截，此为降级展示）</div>' +
      '</div>';
  }

  App.closeVideo = function () {
    App.set({ videoOpen: false });
  };

  console.log('[video] 就绪。演示前请让队友提前进入房间。');
})();
