/* ════════════════════════════════════════════════════════════════
   src/feature.speech.js   ← 中文语音播报
   负责人：C
   对外：App.speak(text) / App.speakStop()
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var supported = ('speechSynthesis' in window);

  /* Chrome 要求用户先与页面交互过一次才出声。
     demo 里第一次点击任意位置就解锁，避免"点了按钮没声音"。 */
  var unlocked = false;
  App.on('sos:tap', function () { unlocked = true; });
  document.addEventListener('click', function () { unlocked = true; }, { once: true });

  function pickChineseVoice() {
    if (!supported) return null;
    var voices = window.speechSynthesis.getVoices() || [];
    for (var i = 0; i < voices.length; i++) {
      var v = voices[i];
      if (/zh[-_]?CN|zh[-_]?Hans|Chinese|中文|普通话/i.test(v.lang + ' ' + v.name)) return v;
    }
    return null;
  }

  /**
   * 播报一段中文
   * @param {string} text
   * @param {object} [opts] { rate, pitch, interrupt }
   */
  App.speak = function (text, opts) {
    if (!supported) { console.warn('[speech] 当前浏览器不支持语音合成，已跳过'); return false; }

    opts = opts || {};
    if (opts.interrupt !== false) window.speechSynthesis.cancel();

    var u = new SpeechSynthesisUtterance(String(text));
    u.lang  = 'zh-CN';
    u.rate  = opts.rate  != null ? opts.rate  : 1.0;
    u.pitch = opts.pitch != null ? opts.pitch : 1.0;

    var v = pickChineseVoice();
    if (v) u.voice = v;

    u.onerror = function (e) { console.warn('[speech] 播报失败：', e.error); };

    window.speechSynthesis.speak(u);
    return true;
  };

  App.speakStop = function () {
    if (supported) window.speechSynthesis.cancel();
  };

  /* 语音列表在部分浏览器是异步加载的，先热一次 */
  if (supported) window.speechSynthesis.getVoices();

  console.log('[speech] 就绪，支持 =', supported);
})();
