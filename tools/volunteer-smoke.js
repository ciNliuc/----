/* ════════════════════════════════════════════════════════════════
   tools/volunteer-smoke.js   ← ④ 志愿者端 + 视频逻辑自测（Node，零依赖）
   负责人：D
   用法： 在仓库根目录执行
              node tools/volunteer-smoke.js .
   做什么：用最小 DOM 桩 + 可控时钟，按 index.html 的顺序真加载
           data.demo.js → core.state.js → core.timeline.js → feature.speech.js
           → feature.video.js → ui.volunteer.js → boot.js，
           再逐个断言 D 端的这些行为（静态读代码看不出来）：
             · 接单 5 秒倒计时 + 超时自动转派下一位
             · 距离递减用「进入本阶段的相对时间」，不是全局 elapsedMs
             · 地图上志愿者圆点真的在移动
             · 到场只 emit volunteer:onSite，阶段由 core 统一推进（契约 §5）
             · 视频弹窗成功 / 被拦两条路都能走，降级画纯 CSS
             · 路演真拨电话：未拨 / 呼叫中 / 通话中三态 + 计时不冻表
             · 七个阶段逐格非空、重置无残留
   只读不改：不会修改仓库里任何文件。
   历史：原先这份自测跑在 jsdom 上（需 npm i jsdom + 一份仓库副本），
         为保持"零依赖、双击即跑"的仓库约定，已改写为自带 DOM 桩，
         断言表沿用原版（多了一条 core 订阅的断言）。
   ════════════════════════════════════════════════════════════════ */

'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.argv[2] || '.';

/* ═══════════ 可控时钟 + 虚拟定时器 ═══════════
   模块里既有 setInterval 心跳（200ms 全局计时 / 1s 接单倒计时 / 1s 通话计时），
   又有 Date.now() 相对时间（距离递减）。两者必须同一个钟，否则"时间走了但
   定时器没走"这类 bug 测不出来。 */
let NOW = 1000000;
let SEQ = 1;
const TIMERS = new Map();

function setInterval_(fn, ms) {
  const id = SEQ++;
  TIMERS.set(id, { fn, ms: ms || 1, next: NOW + (ms || 1), repeat: true });
  return id;
}
function setTimeout_(fn, ms) {
  const id = SEQ++;
  TIMERS.set(id, { fn, ms: ms || 1, next: NOW + (ms || 1), repeat: false });
  return id;
}
function clearTimer(id) { TIMERS.delete(id); }

function advance(ms) {
  const target = NOW + ms;
  for (;;) {
    let bestId = null, best = null;
    for (const [id, t] of TIMERS) {
      if (t.next > target) continue;
      if (!best || t.next < best.next || (t.next === best.next && id < bestId)) { best = t; bestId = id; }
    }
    if (!best) break;
    NOW = best.next;
    if (best.repeat) best.next = NOW + best.ms; else TIMERS.delete(bestId);
    try { best.fn(); } catch (e) { console.error('[timer] 回调抛错：', e); }
  }
  NOW = target;
}

/* ═══════════ 最小 DOM 桩 ═══════════
   比 family-smoke.js 的桩多两件事，D 端离不开它们：
     ① querySelector 要能取到"同一个节点"，因为模块是
        setAttribute('cx') / textContent = ... 局部打补丁，不是整屏重绘；
     ② click() 要把事件派发给模块绑在容器上的 data-act 委托。 */

const VOID_TAGS = ['circle', 'line', 'path', 'rect', 'img', 'br', 'input'];

function parseSelector(sel) {
  let rest = String(sel).trim();
  let tag = null;
  const tm = /^([a-zA-Z][\w-]*)/.exec(rest);
  if (tm) { tag = tm[1].toLowerCase(); rest = rest.slice(tm[1].length); }
  const attrs = [];
  const re = /\[([\w-]+)(?:\s*=\s*["']?([^\]"']*)["']?)?\]/g;
  let m;
  while ((m = re.exec(rest))) attrs.push({ name: m[1], value: m[2] != null ? m[2] : null });
  const classes = (rest.match(/\.([\w-]+)/g) || []).map(c => c.slice(1));
  return { tag, attrs, classes };
}

function parseAttrs(raw) {
  const out = {};
  const re = /([\w:-]+)(?:\s*=\s*"([^"]*)")?/g;
  let m;
  while ((m = re.exec(raw))) {
    if (m[2] != null) out[m[1]] = m[2];
    else if (out[m[1]] == null) out[m[1]] = '';
  }
  return out;
}

function matchesSpec(attrsStr, spec) {
  const attrs = parseAttrs(attrsStr);
  for (const a of spec.attrs) {
    if (!(a.name in attrs)) return false;
    if (a.value != null && attrs[a.name] !== a.value) return false;
  }
  if (spec.classes.length) {
    const cls = (attrs['class'] || '').split(/\s+/);
    if (!spec.classes.every(c => cls.indexOf(c) > -1)) return false;
  }
  return true;
}

function findElements(html, sel) {
  const spec = parseSelector(sel);
  const out = [];
  const re = /<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let m;
  while ((m = re.exec(html))) {
    const tag = m[1].toLowerCase();
    if (spec.tag && spec.tag !== tag) continue;
    if (!matchesSpec(m[2], spec)) continue;
    const selfClose = m[3] === '/' || VOID_TAGS.indexOf(tag) > -1;
    let inner = '';
    if (!selfClose) {
      const close = html.indexOf('</' + tag + '>', re.lastIndex);
      if (close > -1) inner = html.slice(re.lastIndex, close);
    }
    out.push({ tag, attrs: m[2], parsed: parseAttrs(m[2]), selfClose, inner, order: out.length });
  }
  return out;
}

function stripTags(html) {
  return String(html).replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ');
}

function makeNode(owner, sel, meta, idx) {
  let textOverride = null;
  const attrOverride = {};
  const node = {
    tagName: String(meta.tag).toUpperCase(),
    _sel: sel, _idx: idx, _meta: meta,
    style: {},
    classList: {
      add() {}, remove() {}, contains: () => false
    },
    getAttribute(name) {
      if (name in attrOverride) return attrOverride[name];
      return (name in meta.parsed) ? meta.parsed[name] : null;
    },
    setAttribute(name, value) { attrOverride[name] = String(value); },
    hasAttribute(name) { return node.getAttribute(name) != null; },
    closest(s) { return matchesSpec(meta.attrs, parseSelector(s)) ? node : null; },
    click() {
      const fn = owner._click;
      if (!fn) throw new Error('未绑定事件委托（' + owner.id + '）');
      fn({ target: node, preventDefault() {}, stopPropagation() {} });
    }
  };
  Object.defineProperty(node, 'textContent', {
    get() { return textOverride != null ? textOverride : stripTags(meta.inner); },
    set(v) { textOverride = String(v); }
  });
  return node;
}

function makeEl(id) {
  const cls = new Set();
  const el = {
    id, _click: null, className: '', textContent: '', innerHTML: '',
    style: {}, children: [], disabled: false, checked: false,
    scrollTop: 0,
    classList: {
      add: (...c) => c.forEach(x => cls.add(x)),
      remove: (...c) => c.forEach(x => cls.delete(x)),
      contains: c => cls.has(c)
    },
    addEventListener(ev, fn) { if (ev === 'click') this._click = fn; },
    contains: () => true,
    querySelector: () => null,
    querySelectorAll: () => [],
    appendChild(c) { this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    get scrollHeight() { return this.children.length; }
  };
  return el;
}

function makeScreen(id) {
  const el = makeEl(id);
  let html = '';
  const cache = new Map();

  el.querySelector = function (sel) { return pick(this, sel, 0); };
  el.querySelectorAll = function (sel) {
    const metas = findElements(html, sel);
    return metas.map((m, i) => pick(this, sel, i));
  };
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) { html = String(v); cache.clear(); }      /* 整屏重绘 → 节点补丁作废 */
  });
  Object.defineProperty(el, 'textContent', {
    get() { return stripTags(html); },
    set(v) { html = String(v); cache.clear(); }
  });
  el._cache = cache;
  return el;

  function pick(owner, sel, idx) {
    const key = sel + '|' + idx;
    if (cache.has(key)) return cache.get(key);
    const metas = findElements(html, sel);
    if (!metas[idx]) return null;
    const node = makeNode(owner, sel, metas[idx], idx);
    cache.set(key, node);
    return node;
  }
}

const els = {};
const doc = {
  getElementById: id => (els[id] = els[id] || (/-screen$/.test(id) ? makeScreen(id) : makeEl(id))),
  createElement: tag => makeEl(tag),
  addEventListener: () => {}
};
['user', 'institution', 'family', 'volunteer'].forEach(r => {
  doc.getElementById(r + '-badge');
  doc.getElementById(r + '-screen');
  doc.getElementById('panel-' + r);
});
['timeline', 'report-overlay', 'stage-label', 'global-timer',
 'btn-play', 'btn-next', 'btn-reset', 'chk-auto'].forEach(id => doc.getElementById(id));

/* ═══════════ 造 vm 沙箱并加载真实源码 ═══════════ */
const RealDate = Date;
function VDate() {
  return arguments.length ? new RealDate(...arguments) : new RealDate(NOW);
}
VDate.now = () => NOW;
VDate.parse = RealDate.parse;
VDate.UTC = RealDate.UTC;
VDate.prototype = RealDate.prototype;

const sandbox = {
  console,
  document: doc,
  Date: VDate,
  setTimeout: setTimeout_,
  setInterval: setInterval_,
  clearTimeout: clearTimer,
  clearInterval: clearTimer,
  open: () => null,                                  /* 默认：弹窗被拦 → 走降级 */
  SpeechSynthesisUtterance: function (t) { this.text = t; },
  speechSynthesis: { getVoices: () => [], speak() {}, cancel() {} }
};
sandbox.window = sandbox;
vm.createContext(sandbox);

const load = f => vm.runInContext(
  fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });

['src/data.demo.js', 'src/core.state.js', 'src/core.timeline.js',
 'src/feature.speech.js', 'src/feature.video.js', 'src/feature.voice.js',
 'src/ui.volunteer.js', 'src/boot.js'].forEach(load);

const App  = sandbox.App;
const vsc  = () => els['volunteer-screen'];
const text = () => vsc().textContent;
const q    = sel => vsc().querySelector(sel);

/* ═══════════ 断言工具 ═══════════ */
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : '')); }
}
const readDist = sc => { const el = sc.querySelector('[data-dist]'); return el ? parseFloat(el.textContent) : NaN; };
const readDot  = sc => { const el = sc.querySelector('.dot-me'); return el ? { cx: el.getAttribute('cx'), cy: el.getAttribute('cy') } : null; };

/* 走 boot 的重置按钮：既回 IDLE，又清掉 boot 排的自动演示定时器 */
function hardReset() {
  const b = els['btn-reset'];
  if (b && b._click) b._click(); else App.reset();
}

(async () => {

  /* ── 0. 加载 ── */
  console.log('\n\u2550\u2550\u2550 0. 加载 \u2550\u2550\u2550');
  ok(!!App, 'App 已挂载');
  ok(App.state.stage === 'IDLE', '初始阶段 = IDLE', App.state.stage);
  ok(!!vsc() && text().trim().length > 4, '宫格④ 有内容（非空白）', text().slice(0, 40));
  ok(typeof App.openVideo === 'function' && typeof App.callScreenHTML === 'function',
     'feature.video.js 提供了 openVideo / callScreenHTML');
  ok(typeof App.videoIsFallback === 'function', 'feature.video.js 提供了 videoIsFallback');

  /* ── 1. 待机 ── */
  console.log('\n\u2550\u2550\u2550 1. IDLE 待机 \u2550\u2550\u2550');
  ok(/志愿者工作台/.test(text()), '显示"志愿者工作台"');
  ok(/王医生/.test(text()), '显示最近志愿者王医生');
  ok(/心理咨询 \/ 危机干预/.test(text()), '显示技能标签');
  ok(!q('.map'), '待机时不显示地图');
  ok(els['volunteer-badge'].textContent === '在线待命' && /ok/.test(els['volunteer-badge'].className),
     '角标=在线待命/绿', els['volunteer-badge'].textContent + '|' + els['volunteer-badge'].className);

  /* ── 2. 推进到派单 ── */
  console.log('\n\u2550\u2550\u2550 2. 推进到 AUTO_ESCALATE 派单 \u2550\u2550\u2550');
  App.emit('sos:tap', { at: NOW });
  ok(App.state.stage === 'SOS_TRIGGERED', '进入 SOS_TRIGGERED');
  App.next();
  ok(App.state.stage === 'INSTITUTION_ALERT', '进入 INSTITUTION_ALERT');
  ok(!q('.map'), '机构告警阶段志愿者仍未接到单');

  App.jump('AUTO_ESCALATE');
  advance(60);
  ok(/紧急派单/.test(text()), '出现派单卡片');
  ok(/0\.8/.test(text()), '显示距离 0.8km');
  ok(/演示用户 A/.test(text()), '显示求助者姓名');
  ok(!!q('[data-ack-bar]'), '有接单倒计时进度条');
  const left0 = q('[data-ack-num]');
  ok(left0 && Number(left0.textContent) >= 4, '倒计时从 5 开始', left0 && left0.textContent);
  ok(/超时将自动转派给 陈社工/.test(text()), '写明超时转派给谁');
  ok(els['volunteer-badge'].textContent === '\u25cf 新派单', '角标=新派单', els['volunteer-badge'].textContent);

  /* ── 3. 5 秒超时 → 自动转派 ── */
  console.log('\n\u2550\u2550\u2550 3. 5 秒超时 → 自动转派陈社工 \u2550\u2550\u2550');
  advance(5400);
  ok(/已自动转派/.test(text()), '显示"已自动转派"');
  ok(/陈社工/.test(text()), '转派给陈社工');
  ok(/王医生 超时未响应/.test(App.DATA.timeline.map(t => t.text).join('|')), '时间线记录转派原因');
  ok(!!q('[data-act="accept"]'), '转派后仍能接单（否则流程卡死）');
  ok(!!q('.map'), '转派后地图还在');
  ok(/stroke-dasharray/.test(vsc().innerHTML) && /#30363d/.test(vsc().innerHTML),
     '地图上留下上一位的灰色虚线路线');
  ok(els['volunteer-badge'].textContent === '\u21bb 已转派', '角标=已转派', els['volunteer-badge'].textContent);

  /* ── 4. 接单 ── */
  console.log('\n\u2550\u2550\u2550 4. 陈社工接单 \u2550\u2550\u2550');
  const gotAccept = [];
  App.on('volunteer:accept', e => gotAccept.push(e));
  q('[data-act="accept"]').click();
  advance(40);
  ok(gotAccept.length === 1, 'emit 了 volunteer:accept');
  ok(gotAccept[0] && gotAccept[0].name === '陈社工', '携带正确的志愿者姓名', gotAccept[0] && gotAccept[0].name);
  ok(/已接单/.test(text()), '界面切到"已接单"');
  ok(!!q('.dot-me'), '地图上有可移动的圆点 .dot-me');
  ok(!!q('[data-act="dial"]'), '接单后出现"拨打求助者"按钮');
  ok(!q('[data-ack-bar]'), '接单后倒计时收起');

  /* ── 5. 视频阶段：距离递减 + 圆点移动 ── */
  console.log('\n\u2550\u2550\u2550 5. VIDEO_SESSION 距离递减 / 圆点移动 \u2550\u2550\u2550');
  App.next();
  ok(App.state.stage === 'VIDEO_SESSION', '进入 VIDEO_SESSION', App.state.stage);

  sandbox.open = () => null;                    /* 弹窗被拦 → 降级 */
  App.openVideo();
  advance(80);
  ok(!!q('.video-call'), '降级后仍渲染通话画面 .video-call');
  ok(/占位画面/.test(text()), '明确标注"占位画面（演示用，非真实接通）"');
  ok(App.state.videoRoom && App.state.videoRoom.indexOf('fallback-') === 0,
     'videoRoom 写入 fallback- 前缀', App.state.videoRoom);
  ok(!/fallback-/.test(text()), '降级时不把房间名显示给队友');
  ok(App.videoIsFallback() === true, 'videoIsFallback() = true');

  const d0 = readDist(vsc()), c0 = readDot(vsc());
  advance(6000);
  const d1 = readDist(vsc()), c1 = readDot(vsc());
  ok(d1 < d0, '距离在递减（' + d0 + ' → ' + d1 + '）');
  ok(d1 > 0, '距离不会在 30 秒内瞬间归零（相对时间生效）', d1);
  ok(c0 && c1 && (c0.cx !== c1.cx || c0.cy !== c1.cy), '地图圆点真的在移动',
     JSON.stringify({ c0, c1 }));
  ok(/通话中请不要承诺结果/.test(text()), '视频区带"只倾听与陪伴"提示');

  /* ── 6. 到场打卡：只 emit，阶段由 core 统一推进 ── */
  console.log('\n\u2550\u2550\u2550 6. 到场打卡（契约 §5：core 推进阶段） \u2550\u2550\u2550');
  const gotSite = [];
  const stageLog = [];
  App.on('volunteer:onSite', e => gotSite.push(e));
  App.on('stage:change', e => stageLog.push(e.from + '\u2192' + e.to));
  q('[data-act="arrive"]').click();
  advance(40);
  ok(gotSite.length === 1, 'emit 了 volunteer:onSite');
  ok(gotSite[0] && typeof gotSite[0].at === 'number', 'payload 带 at 时间戳');
  ok(stageLog.indexOf('VIDEO_SESSION\u2192ON_SITE') > -1,
     'core 收到事件后统一推进 VIDEO_SESSION → ON_SITE（模块自己没 next）', stageLog.join(','));
  ok(App.state.stage === 'ON_SITE', '当前阶段 = ON_SITE', App.state.stage);
  ok(/已到达/.test(text()), '地图距离显示"已到达"');
  App.emit('volunteer:onSite', { at: NOW });        /* 越级守卫：已不在视频阶段 */
  ok(App.state.stage === 'ON_SITE', '重复 emit 不会越级推进（core 带 stage 校验）', App.state.stage);

  /* ── 7. ON_SITE / CLOSED ── */
  console.log('\n\u2550\u2550\u2550 7. ON_SITE / CLOSED \u2550\u2550\u2550');
  ok(/到场打卡已完成/.test(text()), 'ON_SITE 显示打卡完成');
  ok(!!q('[data-act="record"]'), 'ON_SITE 有"填写处置记录"');
  App.next();
  ok(App.state.stage === 'CLOSED', '进入 CLOSED', App.state.stage);
  ok(/已闭环/.test(text()), 'CLOSED 显示闭环');
  ok(/48 小时内会推送心理支持/.test(text()), '闭环给出志愿者同伴支持');

  /* ── 8. 七个阶段逐格非空 ── */
  console.log('\n\u2550\u2550\u2550 8. 七个阶段逐格非空（契约 §4.2） \u2550\u2550\u2550');
  for (const st of App.STAGES) {
    App.jump(st);
    const t = text().trim();
    ok(t.length > 4 && !/渲染出错/.test(t), st + ' 有渲染内容', t.slice(0, 40));
  }

  /* ── 9. 重置 ── */
  console.log('\n\u2550\u2550\u2550 9. 重置 \u2550\u2550\u2550');
  hardReset();
  ok(App.state.stage === 'IDLE', '回到 IDLE');
  ok(/志愿者工作台/.test(text()), '界面回到待机');
  ok(!/通话中|正在呼叫|已自动转派/.test(text()), '重置后没有残留状态文案');
  App.jump('AUTO_ESCALATE');
  advance(60);
  ok(/紧急派单/.test(text()) && !/已自动转派/.test(text()), '重置后重新派单，不再是转派态');
  ok(/王医生/.test(text()), '重置回王医生（activeIdx 复位）');

  /* ── 10. 弹窗成功的分支 ── */
  console.log('\n\u2550\u2550\u2550 10. 弹窗成功的分支 \u2550\u2550\u2550');
  hardReset();
  sandbox.open = () => ({ closed: false });       /* 这次"成功" */
  App.jump('AUTO_ESCALATE');
  q('[data-act="accept"]').click();
  App.jump('VIDEO_SESSION');
  const okFlag = App.openVideo();
  advance(80);
  ok(okFlag === true, 'openVideo 返回 true');
  ok(App.state.videoRoom && App.state.videoRoom.indexOf('fallback-') !== 0,
     'videoRoom 是真实房间名', App.state.videoRoom);
  ok(/call-room-code/.test(vsc().innerHTML), '成功时显示房间名给队友看');
  ok(!/占位画面/.test(text()), '成功时不显示"占位画面"');
  ok(App.videoIsFallback() === false, 'videoIsFallback() = false');

  /* ── 11. 四个动作按钮都要真的能点 ── */
  console.log('\n\u2550\u2550\u2550 11. 四个动作按钮都要真的能点 \u2550\u2550\u2550');
  hardReset();                                   /* 顺手清掉 boot 的 12 秒自动推进 */
  sandbox.open = () => ({ closed: false });
  App.jump('AUTO_ESCALATE');
  advance(60);
  const fired = [];
  App.on('volunteer:accept', () => fired.push('accept'));
  App.on('volunteer:onSite',  () => fired.push('onSite'));
  App.on('video:open',        () => fired.push('video'));

  q('[data-act="accept"]').click();
  advance(40);
  ok(fired.indexOf('accept') > -1, '① 接单按钮 → volunteer:accept');
  ok(!!q('.map'), '接单后地图出现');

  App.jump('VIDEO_SESSION');
  advance(40);
  q('[data-act="video"]').click();
  advance(60);
  ok(fired.indexOf('video') > -1, '② 视频按钮 → video:open');
  ok(!!q('.video-call'), '视频按钮点完画面真的出来了');

  q('[data-act="arrive"]').click();
  advance(40);
  ok(fired.indexOf('onSite') > -1, '③ 到场按钮 → volunteer:onSite');

  App.jump('ON_SITE');
  const before = App.DATA.timeline.length;
  q('[data-act="record"]').click();
  ok(App.DATA.timeline.length > before, '④ 处置记录按钮 → 真的往时间线写了一条');

  /* ── 12. 路演主线：志愿者真拨电话 ── */
  console.log('\n\u2550\u2550\u2550 12. 路演真拨电话（志愿者端） \u2550\u2550\u2550');
  hardReset();
  sandbox.open = () => null;                      /* 走电话线，不碰视频 */
  /* 走一遍 SOS 让 core 的 200ms 心跳跑起来 —— 距离递减挂在 timer:tick 上，
     没有心跳的话"通话期间距离冻结"这条断言会变成空断言。 */
  App.emit('sos:tap', { at: NOW });
  App.next();
  App.jump('AUTO_ESCALATE');
  advance(60);

  ok(!!q('[data-act="accept"]'), '① 派单页有接单按钮');
  q('[data-act="accept"]').click();
  advance(40);
  ok(!!q('[data-act="dial"]'), '② 接单后出现"拨打求助者"按钮');
  q('[data-act="dial"]').click();
  advance(40);
  App.jump('VIDEO_SESSION');
  advance(60);
  ok(/正在呼叫/.test(text()), '③ 进入"正在呼叫"');
  ok(/138\*\*\*\*0000/.test(text()), '④ 显示脱敏号码（最小披露）');
  ok(!!q('[data-act="connect"]'), '⑤ 有"已接通"确认按钮');

  const dCallA = readDist(vsc());
  advance(2000);
  ok(readDist(vsc()) < dCallA, '⑥ 呼叫中距离仍在递减（心跳活着）',
     dCallA + ' → ' + readDist(vsc()));

  q('[data-act="connect"]').click();
  advance(40);
  ok(/通话中/.test(text()), '⑦ 切到"通话中"');
  const t0 = (q('[data-vol-timer]') || {}).textContent;
  ok(t0 === '00:00', '⑧ 计时从 00:00 开始', t0);

  const dBefore = readDist(vsc());
  advance(3200);
  const t1 = (q('[data-vol-timer]') || {}).textContent;
  ok(t1 === '00:03', '⑨ 通话计时真的在走（00:00 → 00:03）', t1);
  ok(readDist(vsc()) === dBefore, '⑩ 通话期间距离冻结（人在原地打电话，不该继续往前走）',
     dBefore + ' → ' + readDist(vsc()));

  /* 通话中进到场，计时必须**继续走**（电话还通着）。
     ⚠️ 断言秒数在增长，不能只断言计时元素存在 ——
        只查元素的话，"表停了但元素还在"这种 bug 会漏过去。 */
  const tBeforeNext = (q('[data-vol-timer]') || {}).textContent;
  App.next();
  advance(1300);
  const tAfterNext = (q('[data-vol-timer]') || {}).textContent;
  ok(App.state.stage === 'ON_SITE' && !!q('[data-vol-timer]'),
     '⑪ 到场后通话状态与计时都保留（电话还通着）', App.state.stage);
  ok(tAfterNext !== tBeforeNext && tAfterNext !== '00:00',
     '⑪b 到场后计时**仍在走**，没有冻住', tBeforeNext + ' → ' + tAfterNext);

  q('[data-act="hangup"]').click();
  advance(40);
  ok(!/通话中/.test(text()), '⑫ 挂断后不再是通话中');
  ok(!q('[data-vol-timer]'), '⑬ 挂断后计时元素消失');
  ok(/到场打卡已完成/.test(text()), '⑭ 挂断后仍显示已到场');

  hardReset();
  App.jump('VIDEO_SESSION');
  advance(60);
  ok(!/通话中|正在呼叫/.test(text()), '⑮ 重置后通话状态被清空（回到视频兜底分支）');
  ok(!q('.dot-me'), '⑯ 重置后地图上没有移动中的点');

  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
  process.exit(fail ? 1 : 0);

})().catch(e => { console.error('测试脚手架自身出错：', e); process.exit(2); });
