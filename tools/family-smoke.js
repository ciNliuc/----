/* ════════════════════════════════════════════════════════════════
   tools/family-smoke.js   ← ③ 家属端逻辑自测（Node，零依赖）
   负责人：C
   用法： 在仓库根目录执行
             node tools/family-smoke.js .
   做什么：用最小 DOM 桩把 data.demo.js → core.state.js → core.timeline.js
           → feature.speech.js → ui.family.js 按 index.html 的顺序真加载进来，
           再用可控时钟驱动 timer:tick，逐个断言 家属端细化设计.md §2 的分支表。
   只读不改：不会修改仓库里任何文件。
   复用：想自测别的模块，把最后几行 load('src/ui.family.js') 换成自己那个文件，
        并把「通过/失败」上方的断言段换掉即可。
   ════════════════════════════════════════════════════════════════ */

'use strict';
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const ROOT = process.argv[2];

/* ── 可控时钟 ── */
let OFFSET = 0;
const realNow = Date.now;
Date.now = () => realNow.call(Date) + OFFSET;
const adv = ms => { OFFSET += ms; };

/* ── 最小 DOM 桩 ── */
let PATCHED = 0;   /* paintLines 实际点亮的节点数（验证局部刷新真的跑了） */

function makeEl(id) {
  const set = new Set();
  return {
    id, innerHTML: '', textContent: '', className: '', style: {},
    children: [],
    classList: {
      add: (...c) => c.forEach(x => set.add(x)),
      remove: (...c) => c.forEach(x => set.delete(x)),
      contains: c => set.has(c)
    },
    _click: null,
    addEventListener(ev, fn) { if (ev === 'click') this._click = fn; },
    contains: () => true,
    querySelector(sel) {
      const key = sel.replace(/^[.#]/, '');
      return this.innerHTML.includes(key) ? makeEl(key) : null;
    },
    querySelectorAll(sel) {
      const key = sel.replace(/^[.#]/, '');
      const re = new RegExp('class="' + key + '(\\s[^"]*)?"', 'g');
      const total = (this.innerHTML.match(re) || []).length;
      const nodes = [];
      for (let i = 0; i < total; i++) {
        nodes.push({ classList: { add: c => { if (c === 'on') PATCHED++; } } });
      }
      return nodes;
    },
    appendChild(c) { this.children.push(c); },
    removeChild(c) { const i = this.children.indexOf(c); if (i > -1) this.children.splice(i, 1); },
    get firstChild() { return this.children[0] || null; },
    get lastChild() { return this.children[this.children.length - 1] || null; },
    scrollHeight: 0, scrollTop: 0
  };
}

const els = {};
const doc = {
  getElementById: id => (els[id] = els[id] || makeEl(id)),
  createElement: () => makeEl('li'),
  addEventListener: () => {}
};

globalThis.window = globalThis;
globalThis.document = doc;
globalThis.console = console;

/* 语音合成桩：记录下来，验证"字幕与声音同源" */
const spoken = [];
globalThis.SpeechSynthesisUtterance = function (t) { this.text = t; };
globalThis.speechSynthesis = {
  getVoices: () => [{ lang: 'zh-CN', name: 'Ting-Ting' }],
  speak: u => { spoken.push(u.text); if (u.onend) u.onend(); },
  cancel: () => { spoken.push('[cancel]'); }
};

['user', 'institution', 'family', 'volunteer'].forEach(r => {
  doc.getElementById(r + '-badge');
  doc.getElementById(r + '-screen');
  doc.getElementById('panel-' + r);
});
doc.getElementById('timeline');

/* ── 加载真实源码（顺序同 index.html） ── */
const load = f => vm.runInThisContext(
  fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });

load('src/data.demo.js');
load('src/core.state.js');
globalThis.App = window.App;
load('src/core.timeline.js');
load('src/feature.speech.js');
load('src/ui.family.js');

/* ── 断言工具 ── */
let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('  \u2713 ' + name); }
  else { fail++; console.log('  \u2717 ' + name + (extra ? '  \u2192 ' + extra : '')); }
}
const screen = () => els['family-screen'].innerHTML;
const badge  = () => els['family-badge'].textContent;
const tone   = () => els['family-badge'].className;
const lit    = () => (screen().match(/f-line on/g) || []).length;

function click(id) {
  const fn = els['family-screen']._click;
  if (!fn) throw new Error('未绑定事件委托');
  fn({ target: { closest: s => s.split(',').map(x => x.trim()).indexOf('#' + id) > -1 ? { id } : null } });
}
function tick(ms) { adv(ms); App.emit('timer:tick', { elapsedMs: OFFSET, stage: App.state.stage }); }

console.log('\n\u2460 待机锁屏');
App.jump('IDLE');
ok(screen().includes('lock-screen'), '渲染锁屏容器');
ok(screen().includes('已登记为 演示用户 A 的紧急联系人'), '显示登记关系');
ok(screen().includes('紧急来电可穿透静音'), '说明静音穿透');
ok(screen().includes('不会拨打任何真实号码'), '带诚实声明');
ok(badge() === '待机', '角标=待机', badge());

console.log('\n\u2461 SOS / 机构告警阶段保持安静');
App.emit('sos:tap', {}); App.jump('SOS_TRIGGERED'); OFFSET = 0;
ok(screen().includes('lock-screen'), 'SOS_TRIGGERED 仍是锁屏');
App.jump('INSTITUTION_ALERT');
ok(screen().includes('lock-screen') && !screen().includes('call-screen'), 'INSTITUTION_ALERT 仍是锁屏');

console.log('\n\u2462 自动升级 → 系统外呼');
App.jump('AUTO_ESCALATE');
ok(screen().includes('call-screen'), '来电界面出现');
ok(screen().includes('f-ring-bar'), '呼出进度条存在');
ok(screen().includes('最长响铃 15 秒'), '读取 CONFIG.FAMILY_CALL_SEC');
ok(screen().includes('非人工坐席'), '注明非人工坐席');
ok(badge() === '\u25cf 呼出中' && tone().includes('danger'), '角标=呼出中/红', badge() + '|' + tone());
ok(App.DATA.timeline.some(t => t.text.includes('系统自动外呼紧急联系人')), '时间线记录外呼');

console.log('\n\u2463 自动接通 + 逐句字幕（按 200ms 心跳逐格推进）');
tick(2500);
App.render('family');
ok(screen().includes('call-screen connected'), '切到已接通');
ok(badge() === '已接通', '角标=已接通', badge());
ok(lit() === 1, '刚接通只点亮第 1 句', 'lit=' + lit());
const said = () => spoken.filter(s => s !== '[cancel]');
ok(said().length === 1 && said()[0].includes('社区精神卫生中心'), '第 1 句同步播报');
ok(screen().includes('btn-f-call') && screen().includes('btn-f-goto') && screen().includes('btn-f-no'),
   '三个响应按钮齐全');
tick(2800);
ok(PATCHED >= 2, '局部刷新真的点亮了字幕节点（未整屏重绘）', 'patched=' + PATCHED);
App.render('family');
ok(lit() === 2, '推进后点亮第 2 句', 'lit=' + lit());
ok(said().filter(s => s.includes('紧急求助')).length === 1, '第 2 句已播报');
tick(3000); App.render('family');
ok(lit() === 3, '三句全部点亮 (重绘后不倒退)', 'lit=' + lit());
ok(said().filter(s => s.includes('请尽快联系他')).length === 1, '第 3 句已播报');

console.log('\n\u2464 响应：我马上赶过去');
click('btn-f-goto');
ok(screen().includes('\u2713 您的选择：我马上赶过去'), '回执卡出现');
ok(screen().includes('前往中 \u00b7 已开启位置共享'), '后续卡=前往中');
ok(badge() === '已应答' && tone().includes('ok'), '角标=已应答/绿', badge() + '|' + tone());
ok(App.DATA.timeline.some(t => t.text.includes('家属响应：我马上赶过去')), '时间线记录响应');
ok(!screen().includes('btn-f-call'), '选项按钮已收起');

console.log('\n\u2465 跨阶段：字幕与回执保留');
App.jump('VIDEO_SESSION'); App.render('family');
ok(screen().includes('call-screen connected'), '视频阶段仍在通话屏');
ok(screen().includes('\u2713 您的选择：我马上赶过去'), '回执保留');
ok(lit() === 3, '已点亮句数不回退', 'lit=' + lit());

console.log('\n\u2466 到场 / 闭环');
App.jump('ON_SITE'); App.render('family');
ok(screen().includes('志愿者已到达他身边'), '到场标题');
ok(screen().includes('已到场打卡'), '到场打卡信息');
ok(badge() === '已应答', '角标沿用已应答', badge());
App.jump('CLOSED'); App.render('family');
ok(screen().includes('本次事件已闭环'), '闭环标题');
ok(screen().includes('48 小时内会有专人回访'), '回访承诺');
ok(badge() === '已闭环' && tone().includes('ok'), '角标=已闭环/绿', badge() + '|' + tone());

console.log('\n\u2467 未登记分支');
App.reset();
ok(screen().includes('lock-screen'), '重置后回到锁屏');
App.DATA.user.registered = false;
App.render('family');
ok(screen().includes('本机未被登记为紧急联系人'), '锁屏即提示未登记');
const spokenBefore = said().length;
App.jump('AUTO_ESCALATE');
ok(screen().includes('无登记信息'), '整格无登记信息');
ok(screen().includes('本机未被呼出'), '明确未被呼出');
ok(screen().includes('已自动改派附近志愿者'), '给出改派对象');
ok(screen().includes('王医生'), '读出真实志愿者姓名');
ok(!screen().includes('call-screen'), '完全没有来电界面');
ok(badge() === '未呼叫', '角标=未呼叫', badge());
ok(said().length === spokenBefore, '未登记时不播报（改了 data 后仍生效）');
App.jump('ON_SITE'); App.render('family');
ok(screen().includes('无登记信息'), '后续阶段仍是未登记分支');
App.DATA.user.registered = true;

console.log('\n\u2468 无法接通 → 自动转呼下一位');
App.reset(); App.jump('AUTO_ESCALATE');
click('btn-f-no');
ok(screen().includes('本机已结束呼叫'), '结束呼叫卡');
ok(screen().includes('已转呼下一位联系人：李先生（同事）'), '转呼下一位联系人');
ok(screen().includes('btn-f-undo'), '提供反悔按钮');
ok(badge() === '已应答', '角标=已应答', badge());
ok(App.DATA.timeline.some(t => t.text.includes('已自动转呼下一位联系人')), '时间线记录转呼');
click('btn-f-undo');
ok(screen().includes('\u2713 您的选择：我马上赶过去'), '反悔后改为赶过去');

console.log('\n\u2469 重置无残留 / 可重跑');
App.reset();
ok(screen().includes('lock-screen') && !screen().includes('btn-f'), '回到锁屏且无残留按钮');
App.jump('AUTO_ESCALATE');
ok(badge() === '\u25cf 呼出中', '重置后可重新走完整流程', badge());
tick(2500); App.render('family');
ok(lit() === 1, '第二轮字幕从第 1 句重新开始', 'lit=' + lit());
App.reset();
ok(screen().includes('lock-screen'), '再次重置干净');

console.log('\n\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500');
console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
process.exit(fail ? 1 : 0);
