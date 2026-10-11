/* ════════════════════════════════════════════════════════════════
   src/data.demo.js   ← 演示假数据 + 加速开关
   负责人：全员可改（只改值，不改字段名 —— 字段名见 contract.md §7）

   ⚠️ 演示安全：这里只能放假数据。
      禁止填入任何真实用户的姓名、电话、住址。
   ════════════════════════════════════════════════════════════════ */

/* ───────── 演示加速开关（contract.md §6） ───────── */
window.APP_CONFIG = {
  AUTO_ESCALATE_SEC:   6,     // 机构未确认→自动升级。真实产品 60 秒，演示 6 秒
  INSTITUTION_ACK_SEC: 5,     // 机构来电接入倒计时
  VOLUNTEER_ACK_SEC:   5,     // 志愿者接单倒计时
  FAMILY_CALL_SEC:     15,    // 家属外呼时长
  VIDEO_SEC:           12,    // 视频疏导演示时长（给队友留出镜时间）
  MAP_TRAVEL_SEC:      30,    // 地图上志愿者走完全程的时间（距离递减动画）
  CANCEL_WINDOW_SEC:   1,     // 求救可取消窗口。真实 3 秒

  AUTO_PLAY:  true,           // 自动演示模式，免手动点击
  AUTO_PLAY_STEP_MS: 2200,    // 自动模式下每步间隔

  VIDEO_ROOM: 'suicide-intervention-demo',
  VIDEO_URL:  'https://meet.jit.si/'
};

/* ───────── 假数据（contract.md §7） ───────── */
window.DEMO_DATA = {

  /* ① 求助者：把 name 换成团队成员的名字，演示时更有代入感 */
  user: {
    name:       '演示用户 A',
    registered: true,                       // ← 改成 false 可现场演示"未登记"分支
    address:    '演示市演示区演示路 1 号',
    location:   [31.2304, 121.4737]         // ← 改成现场真实坐标更有冲击力
  },

  /* ③ 紧急联系人：登记求助者信息时已一并登记并确认同意 */
  contacts: [
    { name: '张女士', relation: '母亲', phone: '138****0000', agreed: true },
    { name: '李先生', relation: '同事', phone: '139****0000', agreed: true }
  ],

  /* ② 专业机构 */
  institution: {
    name:    '演示区社区精神卫生中心',
    hotline: '021-****0000'
  },

  /* ④ 志愿者：按距离升序，第一个会被自动派单 */
  volunteers: [
    { name: '王医生', distance: 0.8, skills: ['心理咨询', '危机干预'] },
    { name: '陈社工', distance: 1.6, skills: ['危机干预'] }
  ],

  /* ③ 本场演示使用哪一位联系人 */
  family: { name: '张女士' },

  /* 事件时间线，初始为空，由 core.timeline.js 追加 */
  timeline: []
};
