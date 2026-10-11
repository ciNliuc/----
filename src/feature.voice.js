/* ════════════════════════════════════════════════════════════════
   src/feature.voice.js   ← 「留声」：求助前先录一段话，求助时可选择放出来

   负责人：框架负责人
   为什么单独成文件：留声是**跨模块**能力——① 负责录与选，②③④ 负责显示
   「已收到留声 / 正在播放」。放进任何单个 ui.*.js 都会让别人依赖它，
   所以按 feature.*.js 的老规矩单独放一层。

   对外 API（contract.md §2）
     App.voiceChipHTML()                 ②③④ 顶部的留声条（由 core 自动注入）
     App.voicePlay() / App.voiceStop()   播放 / 停止（① 的试听与重播也用它）
     App.voiceRecordStart() / Stop()     现场录制（MediaRecorder）
     App.voicePickFile()                 选一个本地音频文件（录不了音时的兜底）
     App.voiceClear()                    删掉留声
     App.voiceIsRecording() / voiceRecMs() / voiceCanRecord()

   状态（写进 App.state，contract.md §7 之后的留声字段）
     voiceReady / voiceName / voiceDurMs   留声本身（App.reset 不清，可反复演示）
     voiceMode     null | 'voice' | 'plain'  本次求助走哪条路（由 sos:tap 落库）
     voicePlaying  是否正在播放（②③④ 的条会变「正在播放」）

   事件（contract.md §5）
     voice:recorded  ① → 时间线
     sos:tap         ① → core，payload 增加 voice: boolean（原有 at 不变）
     voice:play      ① → ②③④ + 时间线
     voice:end       ① → ②③④

   ⚠️ 演示环境注意：双击 index.html 走的是 file:// 协议，
      部分浏览器会拒绝 getUserMedia（麦克风）。所以另留了
      「选择音频文件」这条路——录不了音也能演示留声，不会卡住。
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var C = App.CONFIG;
  var MAX_MS = Math.max(3, C.VOICE_MAX_SEC || 30) * 1000;   /* 录制上限，防止录太久 */
  var MAX_FILE = 8 * 1024 * 1024;                           /* 导入文件上限 8MB */

  /* ───────── 留声本体 ───────── */
  var blob  = null;      /* Blob / File */
  var url   = null;      /* objectURL，播放用 */
  var label = '';        /* 来源：现场录制 / 文件名 */
  var durMs = 0;

  /* ───────── 录音机 ───────── */
  var recording = false; /* 已按下录音（含正在等麦克风授权） */
  var recorder  = null;
  var chunks    = [];
  var recStart  = 0;
  var recTicker = null;
  var discard   = false; /* 重置时丢掉这一次录音 */

  /* ───────── 播放器 ───────── */
  var audio = null;      /* 复用一个实例，避免被 GC 提前回收 */

  /* ═══════════ 能力探测（单测桩里这些都不存在，必须全部兜住） ═══════════ */
  function hasAudio() {
    return typeof window.Audio === 'function';
  }
  function hasObjectURL() {
    return !!(window.URL && typeof window.URL.createObjectURL === 'function');
  }
  App.voiceCanRecord = function () {
    return !!(typeof window.MediaRecorder === 'function' &&
              typeof navigator !== 'undefined' && navigator.mediaDevices &&
              typeof navigator.mediaDevices.getUserMedia === 'function');
  };

  App.voiceIsRecording = function () { return recording; };
  App.voiceRecMs = function () { return recording ? Date.now() - recStart : 0; };
  App.voiceMaxMs = function () { return MAX_MS; };
  App.voiceReady = function () { return !!blob; };

  /* ═══════════ 状态同步 ═══════════ */
  function sync() {
    App.set({
      voiceReady: !!blob,
      voiceName:  label,
      voiceDurMs: durMs
    });
  }

  function clearUrl() {
    if (url && window.URL && typeof window.URL.revokeObjectURL === 'function') {
      try { window.URL.revokeObjectURL(url); } catch (e) { /* 忽略 */ }
    }
    url = null;
  }

  /* ═══════════ 收下一段留声 ═══════════ */
  function adopt(b, from, knownMs) {
    clearUrl();
    blob  = b;
    label = from || '留声';
    durMs = knownMs || 0;
    if (hasObjectURL()) url = window.URL.createObjectURL(b);

    sync();

    /* 导入的文件不知道时长，读一次元数据补上（②③④ 的条要显示秒数） */
    if (!durMs && url && hasAudio()) {
      var probe = new window.Audio();
      probe.preload = 'metadata';
      if (typeof probe.addEventListener === 'function') {
        probe.addEventListener('loadedmetadata', function () {
          if (isFinite(probe.duration)) {
            durMs = Math.round(probe.duration * 1000);
            sync();
          }
        });
      }
      probe.src = url;
    }

    App.emit('voice:recorded', { name: label, durMs: durMs });
    App.log('已留声：' + label + (durMs ? '（' + App.fmtTime(durMs) + '）' : ''), { hi: true });
    App.renderAll();
  }

  /* ═══════════ 录制 ═══════════ */
  function stopTicker() {
    if (recTicker) { clearInterval(recTicker); recTicker = null; }
  }

  function startTicker() {
    stopTicker();
    recTicker = setInterval(function () {
      if (!recording) { stopTicker(); return; }
      if (Date.now() - recStart >= MAX_MS) { App.voiceRecordStop(); return; }
      App.render('user');                       /* 只重绘①：录音计时在走 */
    }, 200);
  }

  function stopStream(stream) {
    if (!stream || typeof stream.getTracks !== 'function') return;
    stream.getTracks().forEach(function (t) { try { t.stop(); } catch (e) { /* 忽略 */ } });
  }

  App.voiceRecordStart = function () {
    if (recording) return false;

    if (!App.voiceCanRecord()) {
      App.log('本机不支持录音或未授权麦克风——请改用「选择音频文件」', { hi: true });
      App.render('user');
      return false;
    }

    recording = true;                           /* 先亮灯：等授权时也有反馈 */
    recStart  = Date.now();
    chunks    = [];
    App.render('user');

    navigator.mediaDevices.getUserMedia({ audio: true }).then(function (stream) {
      if (!recording) { stopStream(stream); return; }   /* 授权期间用户已取消 */

      var rec;
      try {
        rec = new window.MediaRecorder(stream);
      } catch (err) {
        recording = false;
        stopStream(stream);
        App.log('录音器初始化失败：' + (err && err.name) + '，请改用「选择音频文件」', { hi: true });
        App.render('user');
        return;
      }

      recorder = rec;
      rec.ondataavailable = function (e) {
        if (e.data && e.data.size) chunks.push(e.data);
      };
      rec.onstop = function () {
        stopStream(stream);
        recorder = null;
        stopTicker();
        if (discard) { discard = false; App.render('user'); return; }
        if (!chunks.length) {
          App.log('没有录到声音，请重试', { hi: true });
          App.render('user');
          return;
        }
        adopt(new Blob(chunks, { type: chunks[0].type || 'audio/webm' }),
              '现场录制', Date.now() - recStart);
      };

      try {
        rec.start();
      } catch (err) {
        recording = false;
        recorder  = null;
        stopStream(stream);
        App.log('录音启动失败：' + (err && err.name), { hi: true });
        App.render('user');
        return;
      }
      startTicker();
      App.render('user');
    }).catch(function (err) {
      recording = false;
      stopTicker();
      App.log('麦克风不可用（' + (err && err.name) + '）——可改用「选择音频文件」', { hi: true });
      App.render('user');
    });

    return true;
  };

  App.voiceRecordStop = function () {
    if (!recording) return false;
    recording = false;
    stopTicker();
    if (recorder && recorder.state !== 'inactive') {
      try { recorder.stop(); } catch (e) { /* onstop 里收尾 */ }
    } else {
      App.render('user');
    }
    return true;
  };

  /* ═══════════ 导入音频文件（录不了音时的兜底，演示一定走得通） ═══════════ */
  App.voicePickFile = function () {
    if (!document || typeof document.createElement !== 'function') return false;

    var inp = document.createElement('input');
    if (!inp) return false;
    inp.type = 'file';
    try { inp.accept = 'audio/*'; } catch (e) { /* 忽略 */ }

    if (typeof inp.addEventListener === 'function') {
      inp.addEventListener('change', function () {
        var f = inp.files && inp.files[0];
        if (!f) return;
        if (f.size > MAX_FILE) {
          App.log('音频文件太大（>8MB），换一个小一点的', { hi: true });
          App.render('user');
          return;
        }
        adopt(f, f.name || '音频文件', 0);
      });
    }

    if (typeof inp.click === 'function') { inp.click(); return true; }
    return false;                                /* 单测桩里没有 click，静默返回 */
  };

  /* ═══════════ 播放 / 停止 ═══════════ */
  App.voicePlay = function () {
    if (!blob || !url) {
      App.log('还没有留声可播放', { hi: true });
      return false;
    }
    if (!hasAudio()) {
      App.log('本机不支持音频播放', { hi: true });
      return false;
    }

    App.voiceStop(true);                         /* 先停掉上一次 */

    audio = new window.Audio();
    audio.src = url;

    if (typeof audio.addEventListener === 'function') {
      audio.addEventListener('ended', function () {
        audio = null;
        App.state.voicePlaying = false;
        App.emit('voice:end', { name: label });
        App.log('留声播放完毕');
        App.renderAll();
      });
      audio.addEventListener('error', function () {
        audio = null;
        App.state.voicePlaying = false;
        App.emit('voice:end', { name: label, error: true });
        App.log('留声播放出错（文件可能不受支持）', { hi: true });
        App.renderAll();
      });
    }

    var p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(function (err) {
        audio = null;
        App.state.voicePlaying = false;
        App.log('留声被浏览器拦住了：再点一次「▶ 试听」就能放（' +
                (err && err.name) + '）', { hi: true });
        App.renderAll();
      });
    }

    App.state.voicePlaying = true;
    App.emit('voice:play', { name: label, durMs: durMs });
    App.log('留声已播放：' + label, { hi: true });
    App.renderAll();
    return true;
  };

  App.voiceStop = function (quiet) {
    if (audio) {
      try { audio.pause(); } catch (e) { /* 忽略 */ }
      audio = null;
    }
    if (App.state.voicePlaying) {
      App.state.voicePlaying = false;
      if (!quiet) {
        App.emit('voice:end', { name: label });
        App.renderAll();
      }
    }
  };

  App.voiceClear = function () {
    App.voiceStop(true);
    clearUrl();
    blob  = null;
    label = '';
    durMs = 0;
    sync();
    App.log('已删除留声');
    App.renderAll();
  };

  /* ═══════════ ②③④ 的留声角标（挂在面板头部，不占手机屏空间） ═══════════
     为什么挂在 .panel-head 而不是手机屏里：机构端在 AUTO_ESCALATE 已经把
     626px 的屏占满，屏内再插一条会溢出、把「机构处置日志」挤到滚动区以下。
     挂在头部则是零布局风险——四格的屏内容与原路径完全一致。 */
  App.voiceChipHTML = function () {
    if (App.state.voiceMode !== 'voice') return '';

    var playing = !!App.state.voicePlaying;
    var dur = App.state.voiceDurMs ? App.fmtTime(App.state.voiceDurMs) : '';

    return '<span class="voice-chip' + (playing ? ' playing' : '') + '">' +
        '<span class="vc-ico">' + (playing ? '🔊' : '🎙') + '</span>' +
        '<span class="vc-text">' + (playing ? '正在播放留声' : '已收到留声') + '</span>' +
        (dur ? '<b class="vc-dur mono">' + App.esc(dur) + '</b>' : '') +
      '</span>';
  };

  /* 由 core.state.js 的 renderAll() 每次渲染后调用：挂上 / 换掉 / 摘掉角标。
     ①（user）不加：它自己有完整的留声卡。 */
  App.paintVoiceHeads = function () {
    if (!document || typeof document.createElement !== 'function') return;

    var roles = ['institution', 'family', 'volunteer'];
    var html  = App.voiceChipHTML();

    for (var i = 0; i < roles.length; i++) {
      var r = roles[i];
      var panel = App.el('panel-' + r);
      if (!panel || typeof panel.querySelector !== 'function') continue;

      var old = panel.querySelector('.voice-chip');
      if (old && old.parentNode && typeof old.parentNode.removeChild === 'function') {
        old.parentNode.removeChild(old);
      }
      if (!html) continue;

      var head  = panel.querySelector('.panel-head');
      var badge = App.el(r + '-badge');
      if (!head || !badge || !badge.parentNode) continue;
      if (typeof head.insertBefore !== 'function') continue;

      var box  = document.createElement('span');
      box.innerHTML = html;
      var chip = box.firstElementChild;
      if (chip) head.insertBefore(chip, badge);
    }
  };

  /* ═══════════ 带留声求助 → 进 SOS 后自动放出声音 ═══════════
     延迟 0.7 秒，让四格先亮起来再出声，观感不乱。 */
  App.on('stage:change', function (e) {
    if (e.to !== 'SOS_TRIGGERED') return;
    if (App.state.voiceMode !== 'voice' || !blob) return;

    setTimeout(function () {
      /* 若这 0.7 秒内演示已经推进走了，就不要再补放 */
      if (App.state.stage === 'IDLE' || App.state.stage === 'CLOSED') return;
      App.voicePlay();
    }, 700);
  });

  /* ═══════════ 重置 ═══════════
     注意：**不清除录好的留声**（voiceReady / voiceName / voiceDurMs 保留），
     这样一场演示可以反复走「带留声」与「原有路径」两条线。 */
  App.on('app:reset', function () {
    App.voiceStop(true);
    stopTicker();
    if (recording || recorder) {
      discard = true;
      recording = false;
      if (recorder && recorder.state !== 'inactive') {
        try { recorder.stop(); } catch (e) { /* 忽略 */ }
      }
      recorder = null;
    }
    App.render('user');
  });

  console.log('%c[voice] 留声就绪', 'color:#a371f7;font-weight:700',
    '\n录制上限 ' + (MAX_MS / 1000) + 's · 录不了音时用「选择音频文件」');
})();
