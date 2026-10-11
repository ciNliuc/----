/* ════════════════════════════════════════════════════════════════
   src/ui.volunteer.js   ← ④ 志愿者 · 附近响应者（宫格右下）
   负责人：D
   契约：contract.md §3 §4 §5      调试：App.jump('VIDEO_SESSION')
   本模块负责：接单 / 地图路线动画 / 距离递减 / 拉起视频 / 到场打卡
   ════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  var D = App.DATA;
  var C = App.CONFIG;

  var accepted = false;
  var matched  = D.volunteers[0];        /* 派单给距离最近的那位 */
  var total    = matched.distance;       /* 初始距离，固定不变（分母） */
  var distance = matched.distance;       /* 当前剩余距离 km */
  var onSite   = false;

  function reset() {
    accepted = false;
    matched  = D.volunteers[0];
    total    = matched.distance;
    distance = matched.distance;
    onSite   = false;
  }

  /* ───────── 手绘地图（不依赖在线地图，离线可用） ───────── */
  function mapHTML() {
    var pct = Math.max(0, Math.min(1, 1 - distance / (total || 1)));  /* 0→1 前进度 */
    var x   = 26 + pct * 96;      /* 志愿者的 x 从 26 走到 122 */
    var y   = 96 - pct * 52;      /* y 从 96 走到 44 */

    return '<div class="map">' +
        '<svg viewBox="0 0 160 120" preserveAspectRatio="none">' +
          '<defs>' +
            '<pattern id="grid" width="16" height="16" patternUnits="userSpaceOnUse">' +
              '<path d="M16 0H0V16" fill="none" stroke="#1e2733" stroke-width="1"/>' +
            '</pattern>' +
          '</defs>' +
          '<rect width="160" height="120" fill="url(#grid)"/>' +
          /* 路线 */
          '<line x1="26" y1="96" x2="122" y2="44" stroke="#2d3748" stroke-width="4" stroke-linecap="round"/>' +
          '<line x1="26" y1="96" x2="' + x + '" y2="' + y + '" stroke="#2f81f7" stroke-width="4" ' +
                'stroke-linecap="round"/>' +
          /* 终点：求助者 */
          '<circle cx="122" cy="44" r="9" fill="#f85149" opacity=".25"/>' +
          '<circle cx="122" cy="44" r="5"  fill="#f85149"/>' +
          /* 起点：志愿者 */
          '<circle cx="' + x + '" cy="' + y + '" r="6" fill="#2f81f7"/>' +
        '</svg>' +
        '<div class="map-tag me"  style="left:6%;bottom:6%">' + App.esc(matched.name) + '</div>' +
        '<div class="map-tag him">' + App.esc(D.user.name) + '</div>' +
        '<div class="map-dist">' + (onSite ? '已到达' : distance.toFixed(1) + ' km') + '</div>' +
      '</div>';
  }

  /* ───────── 渲染 ───────── */
  App.define('volunteer', function (state) {
    var s = state.stage;

    /* ── 待机 ── */
    if (s === 'IDLE' || s === 'SOS_TRIGGERED' || s === 'INSTITUTION_ALERT') {
      return {
        badge: '在线待命', tone: 'ok',
        html:
          '<div class="screen-title">志愿者工作台</div>' +
          '<div class="tiny dim">' + App.esc(matched.name) + ' · 距求助高发区 ' +
            matched.distance + 'km</div>' +
          '<div class="grow center col" style="gap:8px">' +
            '<div class="tiny dim">' + App.esc(matched.skills.join(' / ')) + '</div>' +
            '<div class="tiny dim">等待派单…</div>' +
          '</div>' +
          '<div class="tiny dim center">已通过实名审核 · 培训考核 · 服务协议</div>'
      };
    }

    /* ── 派单 ── */
    if (s === 'AUTO_ESCALATE') {
      if (accepted) {
        return {
          badge: '已接单', tone: 'on',
          html: '<div class="screen-title">已接单，准备出发</div>' +
                mapHTML() +
                '<button id="btn-v-video" class="primary-btn">开始视频疏导</button>' +
                '<div class="tiny dim center">建议双人同行 · 开启位置共享</div>'
        };
      }
      return {
        badge: '● 新派单', tone: 'danger',
        html:
          '<div class="push-card">' +
            '<div class="card-title">📣 紧急派单</div>' +
            '<div class="card-body">距您 <b>' + matched.distance + 'km</b> 有人求助<br>' +
              '求助者：' + App.esc(D.user.name) + '</div>' +
          '</div>' +
          mapHTML() +
          '<button id="btn-v-accept" class="primary-btn">立即响应（5 秒内）</button>' +
          '<div class="tiny dim center">响应后将开启位置共享与打卡</div>'
      };
    }

    /* ── 视频疏导 ── */
    if (s === 'VIDEO_SESSION') {
      return {
        badge: '视频中', tone: 'on',
        html:
          '<div class="screen-title">正在视频疏导</div>' +
          mapHTML() +
          '<div class="video-stage" id="video-stage">' +
            (App.state.videoOpen
              ? '<div class="video-live">● 视频已接通 · 房间 ' + App.esc(App.state.videoRoom) + '</div>'
              : '') +
          '</div>' +
          '<button id="btn-v-video" class="primary-btn">' +
            (App.state.videoOpen ? '重新打开视频窗口' : '▶ 打开视频窗口') +
          '</button>' +
          '<button id="btn-v-arrive" class="ghost-btn">我已到达现场</button>' +
          '<div class="tiny dim center">通话中请不要承诺结果，只倾听与陪伴</div>'
      };
    }

    /* ── 到场 ── */
    if (s === 'ON_SITE') {
      return {
        badge: '已到场', tone: 'ok',
        html:
          '<div class="screen-title">已到达求助者身边</div>' +
          mapHTML() +
          '<div class="card ok">' +
            '<div class="card-title">✓ 到场打卡已完成</div>' +
            '<div class="card-body">位置已共享给平台与家属<br>每 15 分钟自动汇报一次</div>' +
          '</div>' +
          '<button id="btn-v-record" class="ghost-btn">填写处置记录</button>' +
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

  /* ───────── 交互 ───────── */
  App.delegate('volunteer', '#btn-v-accept', 'v:accept', function () {
    accepted = true;
    App.log('志愿者 ' + matched.name + ' 已接单', { hi: true });
    App.emit('volunteer:accept', { name: matched.name, distance: matched.distance });
    App.render('volunteer');
  });

  /* ⚠️ 必须同步调用 App.openVideo()，异步会弹窗被拦 */
  App.delegate('volunteer', '#btn-v-video', 'v:video', function () {
    App.openVideo();
    App.render('volunteer');
  });

  App.delegate('volunteer', '#btn-v-arrive', 'v:arrive', function () {
    onSite   = true;
    distance = 0;
    App.log('志愿者已到达现场并完成打卡', { hi: true });
    App.emit('volunteer:onSite', { at: Date.now() });
    App.next();                                  /* VIDEO_SESSION → ON_SITE */
  });

  App.delegate('volunteer', '#btn-v-record', 'v:record', function () {
    App.log('志愿者已提交处置记录（结构化表单）');
  });

  /* ───────── 距离递减动画（contract.md §5 timer:tick） ───────── */
  App.on('timer:tick', function (e) {
    if (e.stage !== 'VIDEO_SESSION' || onSite) return;
    if (distance <= 0.05) return;

    /* 从触发求助算起，用 MAP_TRAVEL_SEC 走完全程（线性，只减不增） */
    var travel = (C.MAP_TRAVEL_SEC || 30) * 1000;
    var pct    = Math.min(1, e.elapsedMs / travel);
    distance   = Math.max(0, total * (1 - pct));

    var dist = App.el('volunteer-screen').querySelector('.map-dist');
    if (dist) dist.textContent = distance.toFixed(1) + ' km';
  });

  App.on('app:reset', reset);
  App.on('escalate:auto', function () {
    if (!D.user.registered) App.log('用户未登记，系统改为自动联系附近志愿者', { hi: true });
  });

  console.log('[ui.volunteer] 已注册');
})();
