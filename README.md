# 自杀干预 · 黑客松 Demo（协作版）

> 三小时黑客松项目。目标：大屏四宫格，一键触发，四角色全链路联动，8 分钟演示。
> 完整需求见 [需求.md](需求.md)。

---

## 1. 这是什么

一个**多人并行开发**的 Demo 骨架。

与"单文件 index.html"方案的区别：单文件在多人协作时是灾难（两个人同时写一个文件必然冲突），所以这里**按模块拆成互不重叠的文件，每人只碰自己的文件**。

```
浏览器打开  index.html
              └─ 顺序加载 src/*.js → 每个模块注册到 App
```

## 2. 目录结构

```
自杀干预/
├── 需求.md                    ← 完整需求 v2.0（先读这个）
├── README.md                  ← 你在这里
├── 协作指南.md                 ← 仓库、分支、冲突、集成流程
├── 项目原始构想.md             ← 最初那份需求原文（原 RESDME.md，已改名）
├── .gitignore                 ← 排除临时文件与演示私人物料
├── .gitattributes             ← 统一换行符为 LF，避免跨平台整文件冲突
├── index.html                 ← 骨架外壳 + 四个手机框容器（只改一次，之后冻结）
├── src/
│   ├── boot.js                ← 启动器：加载顺序、App 命名空间     [建框架的人]
│   ├── contract.md            ← 接口契约：状态机、事件、渲染签名   [建框架的人]
│   ├── data.demo.js           ← 假数据（演示坐标、姓名、电话）      [全员可改]
│   ├── core.state.js          ← 状态机 + 事件总线                  [建框架的人]
│   ├── core.timeline.js       ← 全局事件时间线 + 计时器            [建框架的人]
│   ├── ui.user.js             ← ① 求助者（本人手机）               [A]
│   ├── ui.institution.js      ← ② 专业机构工作台                   [B]
│   ├── ui.family.js           ← ③ 紧急联系人（家人手机）           [C]
│   ├── ui.volunteer.js        ← ④ 志愿者 + 地图 + 视频             [D]
│   ├── feature.video.js       ← 真实视频通话拉起 + 降级            [D]
│   ├── feature.speech.js      ← 中文语音播报                       [C]
│   ├── feature.voice.js       ← ⑤「留声」：录一段话，求助时可选放出 [框架]
│   └── ui.report.js           ← 收尾回访卡片 + 数据小结            [B]
├── styles/
│   ├── base.css               ← 深色主题、变量、四列布局            [冻结]
│   └── modules.css            ← 各模块私有样式（每人加自己的段落）  [各自追加]
├── docs/
│   ├── 家属端细化设计.md       ← ③ 家属端设计说明与自测清单          [C]
│   └── 志愿者端细化设计.md     ← ④ 志愿者端 + 视频的设计说明与自测清单 [D]
└── tools/
    ├── dev-board.md           ← 任务看板：谁在做什么、卡在哪
    ├── family-smoke.js        ← ③ 家属端逻辑自测（Node 零依赖，57 项）
    ├── volunteer-smoke.js     ← ④ 志愿者端 + 视频逻辑自测（Node 零依赖，94 项）
    └── voice-smoke.js         ← ⑤ 留声逻辑自测（Node 零依赖，52 项）
```

## 3. 怎么跑

双击 `index.html`，或：

```powershell
# Windows PowerShell
Start-Process .\index.html
```

无需构建、无需依赖、无需服务器。

## 4. 分工（3–4 人）

| 角色 | 负责文件 | 产出 |
|---|---|---|
| **框架 / 集成** | `index.html`、`src/boot.js`、`src/core.*.js`、`src/contract.md`、`styles/base.css` | 状态机、布局、集成、最终联调 |
| **A · 求助者端** | `src/ui.user.js` | 求救按钮、倒计时圆环、状态文案、步骤条 |
| **B · 机构 + 收尾** | `src/ui.institution.js`、`src/ui.report.js` | 告警卡片、确认倒计时、自动升级横幅、回访看板 |
| **C · 家属 + 语音** | `src/ui.family.js`、`src/feature.speech.js` | 来电动画、响应选项、未登记分支、中文播报 |
| **D · 志愿者 + 视频** | `src/ui.volunteer.js`、`src/feature.video.js` | 接单与超时转派、地图路线动画、距离递减、真实视频通话 + 纯 CSS 降级、路演真拨电话 |

**2 人团队**：框架/A 一人，B+C+D 合并给另一人（优先级：机构 → 视频 → 家属 → 语音）。
**5 人以上**：拆出专人做 `data.demo.js` 与讲稿、以及 §9 的备份视频录制。

## 5. 铁律（贴在屏幕上）

1. **接口先冻结**：[src/contract.md](src/contract.md) 一旦定稿，任何人不得擅自改函数签名。要改先喊一声。
2. **只改自己的文件**。`index.html`、`core.*.js`、`base.css` 只有框架负责人能动。
3. **每完成一块就 commit + push**，不要攒到最后一起交。
4. **每 30 分钟全员 push 一次并互相拉取**，不要等 3 小时后合并。
5. **20 分钟后停止加功能**，只做打磨和排练（见需求.md §9）。
6. **2:00 前必须录完一版备份视频**，哪怕半成品。

## 6. 当前状态

- [x] 需求文档 v2.1（Demo 版，多文件模块化）
- [x] 协作框架与目录骨架
- [x] 接口契约定稿（[src/contract.md](src/contract.md)）
- [x] 假数据初版（[src/data.demo.js](src/data.demo.js)）—— 请换成团队自己的名字与现场坐标
- [x] 本地 git 仓库已初始化，首次提交 `d5224ca`
- [x] 建远程仓库并 push（见 [协作指南.md](协作指南.md) §2）
- [x] 邀请队友加入仓库（见 [协作指南.md](协作指南.md) §2.3）
- [x] ① 求助者端细化实现（`a/user`）
- [x] ② 机构端细化实现（`b/institution`）
- [x] ③ 家属端细化实现（`c/family`，见 [docs/家属端细化设计.md](docs/家属端细化设计.md)）
- [x] ④ 志愿者端细化实现（`d/volunteer`，见 [docs/志愿者端细化设计.md](docs/志愿者端细化设计.md)）
- [x] 中文语音播报（`src/feature.speech.js`）
- [x] ④ 视频通话拉起 + 纯 CSS 降级（`src/feature.video.js`）
- [x] 四个角色分支全部合并进 `main`（本次合并，见 [tools/dev-board.md](tools/dev-board.md) §五）
- [x] ⑤ **留声**（[需求.md](需求.md) UI-07 / FR-15）：求助前录一段话或选一个音频文件；求助时二选一——「带着留声求助」或「直接求助（原有路径）」；带留声时进 `SOS_TRIGGERED` 放出声音，②③④ 面板头出现留声角标（[src/feature.voice.js](src/feature.voice.js)）
- [ ] 联调 + 视频接通（需要第二台设备现场验"真出人脸"）
- [ ] 录制备份视频
- [ ] 排练 ≥2 遍

### 6.1 已验证 / 未验证

| 项 | 状态 |
|---|---|
| 13 个 JS 文件语法（`node --check`：`src/*.js` + `tools/*.js`） | ✅ 全部通过（新增 `feature.voice.js` 后为 15 个） |
| 七个阶段在四个模块都有渲染分支（不会出现空白格） | ✅ 静态核对通过 |
| 模块注册顺序（四个 ui 均在 boot.js 之前） | ✅ 已确认 |
| ③ 家属端 7 阶段 × 未登记/转呼/重置 分支 | ✅ `node tools/family-smoke.js .` → **57/57 通过** |
| ④ 志愿者端 7 阶段 × 接单/转派/电话三态/重置（94 项） | ✅ `node tools/volunteer-smoke.js .` → **94/94 通过** |
| 四列手机布局（真浏览器渲染） | ✅ Edge 无头实测 1920×1080 / 1366×768，IDLE / AUTO_ESCALATE / VIDEO_SESSION 三态：四格 `scrollHeight == clientHeight`（无溢出、无重叠），等比缩放由 `--phone-scale` 驱动 |
| ⑤ 留声：两条路径 / 二选一可取消 / 降级 / 七阶段（52 项） | ✅ `node tools/voice-smoke.js .` → **52/52 通过** |
| 留声不改变四格屏内容（真浏览器实测） | ✅ 带留声与原有路径的四格 `hid` 完全相同（`institution:hid=20` 两条一致，非留声引起）；角标挂在 `.panel-head` |
| 浏览器实际运行效果 | ⚠️ **仍未测**：视频弹窗与队友人脸、语音播报出声、动画观感需真机现场确认 |
| 留声真录音（MediaRecorder / 麦克风权限） | ⚠️ **仍未测**：`file://` 下部分浏览器会拒麦克风，现场优先试「录一段」，不行就用「选择音频文件」（该路径已验证可用） |
| 四个角色分支合并 | ✅ `a/user` `b/institution` `c/family` `d/volunteer` 已全部并入 `main` |
| git 首次提交 | ✅ 工作区 clean，未推远程 |
