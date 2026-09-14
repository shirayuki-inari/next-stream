export const ACTIONS = Object.freeze({
  LIVE_GAME: { label: "游戏／专业直播", shortLabel: "游戏直播", slots: 1, cost: 0n, fatigue: 6, stress: 2, skill: "specialty", kind: "live", tone: "cyan" },
  LIVE_CHAT: { label: "杂谈", shortLabel: "杂谈", slots: 1, cost: 0n, fatigue: 6, stress: 3, skill: "expression", kind: "live", tone: "violet" },
  LIVE_MUSIC: { label: "歌回", shortLabel: "歌回", slots: 1, cost: 0n, fatigue: 7, stress: 2, skill: "performance", kind: "live", tone: "rose" },
  LIVE_COLLAB: { label: "联动", shortLabel: "联动", slots: 1, cost: 0n, fatigue: 6, stress: 2, skill: "collaboration", kind: "live", tone: "amber", unavailable: "联动必须绑定本时段已确认的 NPC 预约" },
  MAKE_SHORT: { label: "制作并发布短视频", shortLabel: "短视频", slots: 1, cost: 0n, fatigue: 5, stress: 1, skill: "production", kind: "video", tone: "cyan" },
  EDIT_VIDEO: { label: "公开剪辑／专题视频", shortLabel: "专题视频", slots: 1, cost: 0n, fatigue: 5, stress: 1, skill: "production", kind: "video", tone: "violet" },
  PREPARE_CONTENT: { label: "专项准备", shortLabel: "内容准备", slots: 1, cost: 0n, fatigue: 3, stress: 1, skill: "planning", kind: "support", tone: "amber" },
  PRACTICE: { label: "练习／学习", shortLabel: "练习", slots: 1, cost: 0n, fatigue: 4, stress: 0, skill: "specialty", kind: "growth", tone: "cyan" },
  REVIEW: { label: "复盘", shortLabel: "复盘", slots: 1, cost: 0n, fatigue: 2, stress: -2, skill: "planning", kind: "growth", tone: "violet" },
  PROJECT_WORK: { label: "项目制作", shortLabel: "项目制作", slots: 1, cost: 0n, fatigue: 6, stress: 2, skill: "production", kind: "project", tone: "rose", unavailable: "尚无处于可推进阶段的项目" },
  BUSINESS_ADMIN: { label: "商务／客服／合同处理", shortLabel: "经营事务", slots: 1, cost: 0n, fatigue: 3, stress: 2, skill: "planning", kind: "support", tone: "amber" },
  NETWORK: { label: "公开交流／合作准备", shortLabel: "合作准备", slots: 1, cost: 0n, fatigue: 3, stress: 1, skill: "collaboration", kind: "support", tone: "cyan" },
  AUDITION_PREP: { label: "招募资料／面试准备", shortLabel: "招募准备", slots: 1, cost: 0n, fatigue: 4, stress: 2, skill: "planning", kind: "career", tone: "violet", unavailable: "尚无可准备的招募申请" },
  AUDITION_TEST: { label: "面试／测试", shortLabel: "招募测试", slots: 1, cost: 0n, fatigue: 5, stress: 4, skill: "collaboration", kind: "career", tone: "rose", unavailable: "当前没有已获邀的面试或测试" },
  TRANSFER_PREP: { label: "新身份准备", shortLabel: "身份准备", slots: 1, cost: 0n, fatigue: 5, stress: 2, skill: "production", kind: "career", tone: "violet", unavailable: "尚无需要准备的新身份方案" },
  PART_TIME: { label: "兼职（同日连续两格）", shortLabel: "兼职", slots: 2, cost: 0n, fatigue: 8, stress: 2, skill: null, kind: "cash", tone: "amber", income: 20000n },
  REST: { label: "额外休息", shortLabel: "休息", slots: 1, cost: 0n, fatigue: -10, stress: -6, motivation: 2, skill: null, kind: "rest", tone: "quiet" },
  LIFE: { label: "生活保留", shortLabel: "生活", slots: 1, cost: 0n, fatigue: -3, stress: -1, skill: null, kind: "life", tone: "quiet" },
});

export const PLANNABLE_ACTION_IDS = Object.freeze(Object.keys(ACTIONS).filter((id) => id !== "LIFE"));
