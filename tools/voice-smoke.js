/* ════════════════════════════════════════════════════════════════
   tools/voice-smoke.js   ← ⑤ 留声逻辑自测（Node，零依赖）
   负责人：框架负责人

   用法：在仓库根目录执行
           node tools/voice-smoke.js .

   做什么：用最小 DOM 桩 + 真实的 src/*.js，按 index.html 的顺序加载
           data.demo.js → core.state.js → core.timeline.js
           → feature.voice.js → ui.user.js，
           再逐条断言留声的两条路径：
             · 没留声 / 选了「直接求助」 → 原有路径（voiceMode='plain'，四格无角标）
             · 录了留声并选「带着留声求助」→ voiceMode='voice'，②③④ 出现角标
           以及二选一可取消、reset 不清留声、能力缺失时优雅降级、七阶段不白屏。

   只读不改：不会修改仓库里任何文件。
   ════════════════════════════════════════════════════════════════ */

'use strict';
const fs   = require('fs');
const vm   = require('vm');
const path = require('path');

const ROOT = process.argv[2] || '.';

/* ───────── 最小 DOM 桩 ───────── */
const els    = new Map();
const errors = [];

function makeEl(id) {
  const el = {
    id: id || '',
    textContent: '',
    className: '',
    style: {},
    children: [],
    dataset: {},
    __ids: new Set(),
    __h: {},
    scrollTop: 0,
    scrollHeight: 0,
    classList: {
      add(...c) {
        const s = new Set(el.className.split(/\s+/).filter(Boolean));
        c.forEach((x) => s.add(x));
        el.className = Array.from(s).join(' ');
      },
      remove(...c) {
        const s = new Set(el.className.split(/\s+/).filter(Boolean));
        c.forEach((x) => s.delete(x));
        el.className = Array.from(s).join(' ');
      },
      contains(c) { return el.className.split(/\s+/).indexOf(c) >= 0; }
    },
    addEventListener(type, fn) { (el.__h[type] = el.__h[type] || []).push(fn); },
    removeEventListener() {},
    appendChild(c) { el.children.push(c); return c; },
    removeChild(c) { el.children = el.children.filter((x) => x !== c); return c; },
    insertBefore(c) { el.children.push(c); return c; },
    querySelector(sel) {
      if (sel.charAt(0) === '#') {
        const t = sel.slice(1);
        return el.__ids.has(t) ? getEl(t) : null;
      }
      return null;                                  /* 不支持类选择器：安全返回 null */
    },
    querySelectorAll() { return []; },
    contains() { return true; },
    closest() { return null; },
    get firstChild()  { return el.children[0] || null; },
    get firstElementChild() { return el.children[0] || null; }
  };
  let html = '';
  Object.defineProperty(el, 'innerHTML', {
    get() { return html; },
    set(v) {
      html = String(v == null ? '' : v);
      el.children = [];
      el.__ids = new Set(Array.from(html.matchAll(/id="([^"]+)"/g)).map((m) => m[1]));
    }
  });
  return el;
}

function getEl(id) {
  if (!els.has(id)) els.set(id, makeEl(id));
  return els.get(id);
}

global.window = global;
global.document = {
  getElementById: getEl,
  createElement: () => makeEl(''),
  addEventListener() {},
  removeEventListener() {},
  querySelector: () => null
};
/* 故意不提供 Audio / MediaRecorder / navigator.mediaDevices / URL.createObjectURL：
   用来验证「录不了音的环境」也能优雅降级，不会抛错。 */

/* ───────── 输出 ───────── */
const say = (s) => process.stdout.write(String(s) + '\n');
let pass = 0, fail = 0;
function ok(name, cond, extra) {
  if (cond) { pass++; say('  \u2713 ' + name); }
  else { fail++; say('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : '')); }
}
function section(t) { say('\n' + t); }
function noThrow(name, fn) {
  try { const r = fn(); ok(name, true); return r; }
  catch (err) { ok(name, false, (err && err.message) || String(err)); return undefined; }
}

/* ───────── 加载真实源码（顺序同 index.html） ───────── */
const load = (f) => vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

console.error = (...a) => errors.push(a.map(String).join(' '));
console.warn  = () => {};
console.log   = () => {};

load('src/data.demo.js');
/* 把可取消窗口压到 200ms，用例不必真等 1 秒（ui.user.js 在加载时读这个值） */
window.APP_CONFIG.CANCEL_WINDOW_SEC = 0.2;
load('src/core.state.js');
global.App = window.App;
load('src/core.timeline.js');
load('src/feature.voice.js');
load('src/ui.user.js');

const App = global.App;

/* ───────── 工具 ───────── */
const usc = () => getEl('user-screen');
const html = () => usc().innerHTML;
const timelineText = () => getEl('timeline').children
  .map((li) => String(li.innerHTML || '').replace(/<[^>]+>/g, '')).join('\n');

function clickOn(selector) {
  const ev = { target: { closest: (s) => (s === selector ? {} : null) }, preventDefault() {} };
  (usc().__h.click || []).forEach((fn) => fn(ev));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ═══════════ 用例 ═══════════ */
(async function main() {

  section('[1] 待机：还没留声时给两个入口');
  App.reset();
  App.set({ voiceReady: false, voiceName: '', voiceDurMs: 0 });
  ok('出现留声卡', html().indexOf('留声') >= 0);
  ok('有「录一段」入口', html().indexOf('btn-voice-rec') >= 0);
  ok('有「选择音频」入口（录不了音时的兜底）', html().indexOf('btn-voice-file') >= 0);
  ok('还没留声时不显示试听', html().indexOf('btn-voice-play') < 0);

  section('[2] 没留声时按求助 = 原有路径，不出现二选一');
  clickOn('#btn-sos');
  ok('不出现「要用你的留声吗」', html().indexOf('要用你的留声吗') < 0);
  ok('直接进入可取消窗口（按钮显示已收到）', html().indexOf('已收到') >= 0);
  await sleep(400);
  ok('窗口走完 → SOS_TRIGGERED', App.state.stage === 'SOS_TRIGGERED', App.state.stage);
  ok('voiceMode = plain（原有路径）', App.state.voiceMode === 'plain', String(App.state.voiceMode));
  ok('②③④ 无留声角标', App.voiceChipHTML() === '', App.voiceChipHTML());

  section('[3] 已留声时待机渲染 + 按下求助出现二选一');
  App.reset();
  App.set({ voiceReady: true, voiceName: '现场录制', voiceDurMs: 9000 });
  ok('显示「已留声」', html().indexOf('已留声') >= 0);
  ok('显示时长 00:09', html().indexOf('00:09') >= 0);
  ok('有试听 / 重录 / 删除', html().indexOf('btn-voice-play') >= 0 &&
     html().indexOf('btn-voice-rec') >= 0 && html().indexOf('btn-voice-del') >= 0);

  clickOn('#btn-sos');
  ok('出现二选一：要用你的留声吗', html().indexOf('要用你的留声吗') >= 0);
  ok('选项一：带着留声求助', html().indexOf('btn-sos-voice') >= 0);
  ok('选项二：直接求助（原有路径）', html().indexOf('btn-sos-plain') >= 0);
  ok('二选一不是新阶段（仍是 IDLE）', App.state.stage === 'IDLE', App.state.stage);

  section('[4] 选「带着留声求助」→ 走完窗口 → voice 路径');
  clickOn('#btn-sos-voice');
  await sleep(400);
  ok('阶段推进到 SOS_TRIGGERED', App.state.stage === 'SOS_TRIGGERED', App.state.stage);
  ok('voiceMode = voice', App.state.voiceMode === 'voice', String(App.state.voiceMode));
  ok('②③④ 角标 = 已收到留声', App.voiceChipHTML().indexOf('已收到留声') >= 0,
     App.voiceChipHTML());
  ok('角标带时长 00:09', App.voiceChipHTML().indexOf('00:09') >= 0);
  ok('① 显示「留声已随求助发出」', html().indexOf('留声已随求助发出') >= 0);
  ok('时间线记了一笔「带上留声」', timelineText().indexOf('带上留声') >= 0);

  section('[5] 选「直接求助」→ 原有路径，四格一条角标都不加');
  App.reset();
  ok('reset 后留声仍在（可反复演示）', App.state.voiceReady === true);
  ok('reset 后 voiceMode 清空', App.state.voiceMode === null, String(App.state.voiceMode));
  clickOn('#btn-sos');
  clickOn('#btn-sos-plain');
  await sleep(400);
  ok('阶段推进到 SOS_TRIGGERED', App.state.stage === 'SOS_TRIGGERED', App.state.stage);
  ok('voiceMode = plain', App.state.voiceMode === 'plain', String(App.state.voiceMode));
  ok('②③④ 无角标', App.voiceChipHTML() === '', App.voiceChipHTML());
  ok('① 不显示留声卡', html().indexOf('留声已随求助发出') < 0);

  section('[6] 二选一可以取消（不发出求助）');
  App.reset();
  clickOn('#btn-sos');
  ok('先进入二选一', html().indexOf('要用你的留声吗') >= 0);
  clickOn('#btn-cancel');
  ok('取消后回到正常待机', html().indexOf('要用你的留声吗') < 0 && html().indexOf('btn-sos') >= 0);
  ok('阶段仍是 IDLE', App.state.stage === 'IDLE', App.state.stage);

  section('[7] 录不了音的环境（本桩无 MediaRecorder / Audio）优雅降级');
  ok('voiceCanRecord() = false', App.voiceCanRecord() === false);
  noThrow('voiceRecordStart() 不抛错', () => App.voiceRecordStart());
  ok('voiceRecordStart() 返回 false', App.voiceRecordStart() === false);
  ok('voiceIsRecording() = false', App.voiceIsRecording() === false);
  noThrow('voiceRecordStop() 不抛错', () => App.voiceRecordStop());
  noThrow('voicePickFile() 不抛错', () => App.voicePickFile());
  noThrow('voiceClear() 不抛错', () => App.voiceClear());
  ok('清掉后 voiceReady = false', App.state.voiceReady === false);
  noThrow('voicePlay() 不抛错', () => App.voicePlay());
  ok('没有留声时 voicePlay() 返回 false', App.voicePlay() === false);
  noThrow('voiceStop() 不抛错', () => App.voiceStop());

  section('[8] 跨模块角标注入：桩里没有 .panel-head，也不能抛错');
  App.set({ voiceMode: 'voice', voiceDurMs: 5000, voicePlaying: false });
  noThrow('paintVoiceHeads() 安全返回', () => App.paintVoiceHeads());
  ok('播放中时角标文案切换', (function () {
    App.set({ voicePlaying: true });
    const s = App.voiceChipHTML();
    App.set({ voicePlaying: false });
    return s.indexOf('正在播放留声') >= 0;
  })());
  App.set({ voiceMode: 'plain' });
  ok('plain 时角标为空串', App.voiceChipHTML() === '');

  section('[9] 带留声模式下七个阶段逐格渲染（不能白屏 / 不能抛错）');
  for (const st of App.STAGES) {
    errors.length = 0;
    App.reset();
    if (st !== 'IDLE') App.set({ voiceMode: 'voice' });
    App.jump(st);
    ok('jump(' + st + ') ① 有内容且无抛错',
       html().length > 60 && html().indexOf('undefined') < 0 && errors.length === 0,
       'len=' + html().length + ' err=' + errors.join(' | '));
  }

  section('结果');
  say('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  if (fail) process.exitCode = 1;
})();
