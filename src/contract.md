# 接口契约（src/contract.md）

> **这是全项目唯一的真相源。**
> 本文件定稿后，任何人不得擅自修改函数签名、事件名或 DOM id。
> 需要修改 → 先在群里喊一声 → 由框架负责人在此更新 → 全员同步。

---

## 1. 状态机

```
IDLE → SOS_TRIGGERED → INSTITUTION_ALERT → AUTO_ESCALATE
     → VIDEO_SESSION → ON_SITE → CLOSED
```

| 阶段 | 含义 | 谁负责响应 |
|---|---|---|
| `IDLE` | 待机 | 全员渲染待机态 |
| `SOS_TRIGGERED` | 用户按下求助 | ① ② + 时间线 |
| `INSTITUTION_ALERT` | 机构收到告警，确认倒计时开始 | ② ① |
| `AUTO_ESCALATE` | 机构未确认 → **自动联系家属 / 志愿者** | ③ ④ ② |
| `VIDEO_SESSION` | 视频疏导中 | ④ ① |
| `ON_SITE` | 志愿者到场 | ④ ① |
| `CLOSED` | 结束，回访 | 收尾看板 |

**流转规则**：只能 `App.next()` 前进一步，或 `App.reset()` 回到 `IDLE`。模块**不得**自己改阶段。

---

## 2. 全局对象 `App`

所有模块通过 `window.App` 通信。**不要用全局变量，不要跨模块直接调用。**

| API | 签名 | 用途 |
|---|---|---|
| `App.state` | 只读对象 | 当前状态快照 |
| `App.set(patch)` | `patch: object` | 合并状态字段（**不触发阶段流转**） |
| `App.next()` | — | 推进到下一阶段，触发 `stage:change` |
| `App.jump(stage)` | `stage: string` | 直接跳到某阶段（调试用） |
| `App.reset()` | — | 回到 `IDLE`，清空时间线与计时器 |
| `App.on(event, fn)` | `fn(payload)` | 订阅事件 |
| `App.off(event, fn)` | — | 取消订阅 |
| `App.emit(event, payload)` | — | 触发事件 |
| `App.register(role, renderFn)` | `role: string` | 注册模块渲染函数（见 §4） |
| `App.render(role)` | `role: string` | 手动触发某角色重渲染 |
| `App.el(id)` | `id: string` | `document.getElementById` 简写 |
| `App.log(text)` | `text: string` | 往全局时间线追加一条（带时间戳） |
| `App.CONFIG` | 只读对象 | 常量与演示开关，见 §6 |

---

## 3. DOM 约定

`index.html` 里每个模块有**两个容器**：`{role}-badge`（状态角标）和 `{role}-screen`（手机屏幕内容）。
模块**只允许**操作自己 role 的两个容器，不得操作别人的。

| role | 角标容器 | 屏幕容器 | 负责人 |
|---|---|---|---|
| `user` | `#user-badge` | `#user-screen` | A |
| `institution` | `#institution-badge` | `#institution-screen` | B |
| `family` | `#family-badge` | `#family-screen` | C |
| `volunteer` | `#volunteer-badge` | `#volunteer-screen` | D |

全局容器（**仅框架负责人使用**）：

| id | 用途 |
|---|---|
| `#stage-label` | 顶部当前阶段名 |
| `#global-timer` | 顶部全局计时 |
| `#timeline` | 事件时间线列表 |
| `#report-overlay` | 收尾回访全屏卡片（B 负责内容） |
| `#controls` | 底部控制条：自动演示 / 重置 / 下一步 |
| `#panel-user` 等四个 | 四个宫格外框（布局用，勿改） |

---

## 4. 模块注册契约

每个 `ui.*.js` 文件**必须**在文件末尾这样注册：

```js
App.register('family', function renderFamily(state) {
  const badge  = App.el('family-badge');
  const screen = App.el('family-screen');

  // 用 state.stage 决定渲染什么
  switch (state.stage) {
    case 'IDLE':             badge.textContent = '待机';   screen.innerHTML = idleHTML();      break;
    case 'AUTO_ESCALATE':    badge.textContent = '呼出中'; screen.innerHTML = callingHTML();   break;
    // ...
  }
});
```

**规则**
1. `render` 必须是**纯函数式**的：只读 `state`，只写自己的两个容器。不做副作用、不发请求。
2. `state.stage` 变化时，`core.state.js` 会调用**全部**已注册的 render。所以每个人必须处理**全部 7 个阶段**（哪怕只是显示一句"本角色待机"）。
3. 不要在 render 里启动计时器。需要计时用 `App.on('timer:tick', ...)`。
4. 需要用户交互（点击按钮）时，用事件委托绑在自己的 screen 上：
   ```js
   App.el('user-screen').addEventListener('click', e => {
     if (e.target.closest('#btn-sos')) App.emit('user:sos');
   });
   ```

---

## 5. 事件表（**不得私自新增**，需要就提出来加）

| 事件名 | 触发者 | payload | 谁订阅 |
|---|---|---|---|
| `stage:change` | core | `{ from, to, state }` | 全员（一般不用手写，register 已覆盖） |
| `sos:tap` | A | `{ at }` | core（推进到 `SOS_TRIGGERED`）、B |
| `institution:ack` | B | `{ at }` | core（跳过自动升级，直接进 `VIDEO_SESSION`） |
| `escalate:auto` | core | `{ reason: 'timeout' }` | C（家属外呼）、D（志愿者派单）、B（横幅） |
| `family:answer` | C | `{ choice: 'call' \| 'goto' \| 'unreachable' }` | B、时间线 |
| `volunteer:accept` | D | `{ name, distance }` | B、时间线 |
| `volunteer:onSite` | D | `{ at }` | core（推进到 `ON_SITE`）、A |
| `video:open` | D | `{ room, ok: boolean }` | B、时间线 |
| `demo:closed` | B | `{ at }` | core（推进到 `CLOSED`） |
| `timer:tick` | core | `{ elapsedMs, stage }` | D（距离递减）、A（步骤条） |

---

## 6. 常量 `App.CONFIG`（演示加速开关）

```js
App.CONFIG = {
  AUTO_ESCALATE_SEC: 6,      // 真实产品为 60，演示用 6
  INSTITUTION_ACK_SEC: 5,    // 机构接入倒计时
  VOLUNTEER_ACK_SEC: 5,      // 志愿者接单倒计时
  FAMILY_CALL_SEC: 15,       // 家属外呼时长
  CANCEL_WINDOW_SEC: 1,      // 求救可取消窗口（真实 3 秒）
  AUTO_PLAY: true,           // 自动演示模式，免手动点击
  VIDEO_ROOM: 'suicide-intervention-demo',
  VIDEO_URL: 'https://meet.jit.si/'
};
```

**改常量只在 `src/data.demo.js` 里改，不要写死在业务代码里。**

---

## 7. 假数据 `DEMO_DATA`

在 `src/data.demo.js` 中定义，全局可读。字段固定如下，**不要增删字段名**：

```js
window.DEMO_DATA = {
  user:       { name, registered, address, location: [lat, lng] },
  contacts:   [ { name, relation, phone, agreed } ],   // agreed: 登记时已确认同意
  institution:{ name, hotline },
  volunteers: [ { name, distance, skills: [] } ],
  family:     { name },                                 // ③ 演示用的是哪一位联系人
  timeline:   [ { t, text } ]                           // 事件时间线初始为空
};
```

---

## 8. 模块自测（不等联调）

每个模块可在浏览器控制台单独验证，不需要别人做完：

```js
App.jump('AUTO_ESCALATE')   // 直接跳到你的阶段看渲染
App.jump('VIDEO_SESSION')
App.reset()
```

**这就是并行开发的保障**：接口定好 → 各人用 `App.jump()` 自测 → 联调时只需接上事件。

---

## 9. 变更记录

| 日期 | 修改 | 修改人 |
|---|---|---|
| — | 首次定稿 | 框架负责人 |
| 2026-10-11 | 补实现 §5 已约定但一直缺失的两个订阅（core.state.js）：`institution:ack`（`SOS_TRIGGERED` / `INSTITUTION_ALERT` → **跳过自动升级**直接进 `VIDEO_SESSION`）与 `demo:closed`（`ON_SITE` → `CLOSED`），两者均带 stage 校验；B 端 `ui.institution.js` 的「立即确认接手」「结束处置」按钮由此真正生效。**接口签名/事件名/DOM id 均未改动** | B（机构端 + 收尾） |

> 每次修改本文件，必须在此表追加一行，并在群里同步。
