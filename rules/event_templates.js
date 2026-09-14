const commonTrigger = (minimumWeek = 1) => ({ all: [{ field: "weekIndex", op: "GTE", value: minimumWeek }] });
const statEffect = (field, value) => ({ type: "PERFORMER_STAT_DELTA", field, value });
const choice = (id, label, effects, { costJpy = "0", requirements = [] } = {}) => ({
  id,
  label,
  costs: costJpy === "0" ? [] : [{ type: "CASH_FREE", amountJpy: costJpy }],
  requirements,
  effects,
});

const THEMES = [
  ["equipment_mic_noise", "设备", "收音杂音", "试听回放里出现了稳定可复现的底噪。", "检查线材并做降噪测试", "按安全参数完成本周内容", "fatigue", 1],
  ["equipment_network_instability", "设备", "网络不稳", "测速记录显示晚间上行波动，直播前已有征兆。", "改用备用线路", "缩短直播并保留复盘", "stress", 1],
  ["equipment_tracking_offset", "设备", "追踪偏移", "校准画面显示表情捕捉有轻微偏移。", "安排完整校准", "采用稳定的简化动作", "fatigue", 1],
  ["equipment_backup_proposal", "设备", "备用设备提案", "供应商提供了一套可选的备用设备方案。", "支付押金预留设备", "记录需求后暂缓", "motivation", 2],
  ["content_new_game_trend", "内容", "新游戏热潮", "公开榜单显示新游戏讨论度正在上升。", "做一场有准备的尝试", "维持原定内容节奏", "motivation", 1],
  ["content_series_fatigue", "内容", "系列内容疲劳", "近几期同系列回访率缓慢下降。", "暂停一期并复盘", "改换较轻的切入角度", "stress", -2],
  ["content_clip_viral", "内容", "片段被广泛传播", "一段公开片段正在获得额外传播，但转载许可仍需核对。", "发布带上下文的公开回应", "只补充许可说明", "motivation", 2],
  ["content_unexpected_long_tail", "内容", "意外长尾增长", "旧作品的搜索观看连续数日温和增加。", "补充关联内容入口", "保留自然增长", "motivation", 1],
  ["collab_schedule_conflict", "合作", "档期冲突", "双方日历出现了可见的重复预约。", "尽早提出替代档期", "取消本次并保留关系", "stress", -1],
  ["collab_rules_disagreement", "合作", "联动规则分歧", "合作前确认单显示互动边界理解不一致。", "重新对齐规则", "礼貌退出本次合作", "workReputation", 1],
  ["collab_guest_absence", "合作", "临时来宾缺席", "来宾提前说明健康负荷，无法按原计划出席。", "改为单人备用企划", "安全延期", "stress", -1],
  ["collab_show_invitation", "合作", "合作节目邀请", "一名合作对象发来节目草案与候选档期。", "先确认节目边界", "婉拒并保留未来窗口", "workReputation", 1, true],
  ["music_recording_rework", "音乐", "录音返工", "审听记录标记了两处可以修正的演唱段落。", "安排一次定向返录", "保留版本并调整编排", "fatigue", 1],
  ["music_mix_delay", "音乐", "混音延期", "制作方提前报告队列拥堵和新的交付日期。", "接受延期并重排发布", "改用可交付的简版", "stress", -1, true],
  ["music_original_song_proposal", "音乐", "原创曲提案", "合作方提交了范围、预算与权利结构明确的提案。", "进入小范围可行性评估", "归档提案暂不投入", "motivation", 2],
  ["music_stage_rehearsal_feedback", "音乐", "舞台排练反馈", "排练记录建议降低一段动作密度。", "按反馈优化编排", "保留动作并增加练习", "fatigue", -1],
  ["merch_sample_color_mismatch", "商品", "样品色差", "打样到货后，色卡比确认稿偏暗。", "支付返工费并延后", "改用已验证的简化设计", "stress", -1, true],
  ["merch_order_below_moq", "商品", "订单不足起订量", "预售结束前的订单仍低于起订量。", "评估补量与库存风险", "准备退款并停止追加", "stress", -1, true],
  ["merch_logistics_delay", "商品", "物流延迟", "承运方提供了延迟预警和受影响批次。", "主动更新履约日期", "切换可追踪的替代线路", "workReputation", 1, true],
  ["merch_aftersales_surge", "商品", "售后集中咨询", "同一物流批次带来短期集中咨询。", "集中处理并发布说明", "分批处理且明确时限", "stress", -2],
  ["agency_resource_approved", "企业", "资源申请获批", "共享资源批次已经完成公开排序。", "确认使用窗口", "释放资源给候补项目", "workReputation", 1],
  ["agency_resource_conflict_delay", "企业", "资源冲突延期", "同截止日申请超过了本周资源容量。", "接受缩减并重排", "转用外部方案", "stress", -1],
  ["agency_manager_change", "企业", "经纪人变更沟通", "团队提前给出了交接清单与联系人。", "安排交接会议", "用书面清单异步交接", "workReputation", 1],
  ["agency_cross_department_invite", "企业", "跨部门企划邀请", "其他部门发来目标与资源范围明确的邀请。", "评估后加入企划", "保留关系并婉拒", "motivation", 1],
  ["audition_portfolio_supplement", "招募", "作品集补充", "招募方请求补充一项能说明持续性的公开作品。", "整理现有作品说明", "撤回本轮申请", "stress", -1],
  ["audition_interview_invitation", "招募", "面试邀请", "初筛结果给出了面试范围和候选日期。", "确认面试并准备", "申请下一个可用窗口", "motivation", 1, true],
  ["audition_conditional_offer", "招募", "条件性录取", "书面意向列明了尚待确认的合同条件。", "进入合同审阅", "保留记录后拒绝", "workReputation", 1],
  ["audition_offer_extension", "招募", "意向延期协商", "意向即将到期，但仍有一次可协商延长期。", "申请一次延期", "按期作出决定", "stress", -1],
  ["career_indie_preparation", "职业", "独立准备", "退出清单显示新身份仍需资金与两格真实工作。", "先完成可逆的准备", "暂停并保留方案", "motivation", 1, true],
  ["career_character_license_negotiation", "职业", "角色许可谈判", "资产清单显示所有权与合同后使用许可需要分别确认。", "逐项提出许可方案", "采用新身份安全退出", "workReputation", 1, true],
  ["career_new_channel_return", "职业", "新频道回流", "迁移联络数据显示旧观众正分批看到新频道通知。", "发布一次清晰迁移说明", "维持低频联络", "motivation", 1],
  ["career_historical_rerelease", "职业", "历史作品再发行", "旧作品权利清单中出现了可重新发行的条目。", "核对许可后再发行", "保持归档", "workReputation", 1],
  ["community_member_benefit_schedule", "社群", "会员福利排期", "本期共享福利包进入到期提醒窗口。", "安排一格兑现", "暂停未来收费并补排", "stress", -1],
  ["community_clip_context", "社群", "切片上下文误解", "公开片段脱离前后文后产生了温和的理解偏差。", "补充完整上下文", "联系切片者更新说明", "workReputation", 1],
  ["community_subtitle_team_invite", "社群", "字幕组合作邀请", "志愿字幕组询问公开片段的翻译许可范围。", "提供有限公开片段许可", "建议使用付费委托流程", "motivation", 1],
  ["community_boundary_discussion", "社群", "互动边界讨论", "常规互动中出现了需要统一说明的边界问题。", "发布平静清晰的边界说明", "调整互动形式", "stress", -1],
  ["life_continuous_high_load", "生活", "连续高负荷", "多周状态记录显示疲劳或压力持续偏高。", "主动减量并恢复", "保留必要工作、取消可选项", "fatigue", -4],
  ["life_part_time_overtime", "生活", "兼职加班", "兼职方提前询问是否能增加本周班次。", "拒绝额外班次", "接受一次并预留恢复", "stress", 1],
  ["life_family_schedule_conflict", "生活", "家庭日程冲突", "家庭安排提前占用了一个可调整时段。", "保护家庭时段", "协商改到空闲时段", "motivation", 1],
  ["life_long_term_goal_review", "生活", "长期目标复盘", "阶段记录提示可以重新检查职业目标与负荷。", "保留目标并调整节奏", "记录新的阶段重点", "motivation", 2],
];

const CHAIN_IDS = new Set(THEMES.filter((item) => item[8]).map((item) => item[0]));

function buildTemplate([id, category, title, publicInfo, activeLabel, safeLabel, effectField, effectValue, isChain], index) {
  const activeEffects = effectField === "workReputation" ? [{ type: "WORK_REPUTATION_DELTA", value: effectValue }] : [statEffect(effectField, effectValue)];
  const safeEffects = [statEffect("stress", -1)];
  const baseChoices = [
    choice("active", activeLabel, activeEffects, index % 9 === 3 ? { costJpy: "20000", requirements: [{ field: "cash.free", op: "GTE_MONEY", value: "20000" }] } : {}),
    choice("safe", safeLabel, safeEffects),
  ];
  const template = {
    id,
    title,
    category,
    scope: ["商品", "音乐"].includes(category) ? "PROJECT" : category === "合作" ? "RELATIONSHIP" : "PLAYER",
    applicableStates: ["PLANNING"],
    trigger: commonTrigger(index < 8 ? 1 : Math.floor(index / 4) + 1),
    weight: 80 + index % 5 * 10,
    cooldownWeeks: 12,
    severity: id === "life_continuous_high_load" ? "HIGH" : index % 3 === 0 ? "MEDIUM" : "LOW",
    maxOccurrences: 2,
    publicInfo,
    cause: `${category}系统的可追溯周记录触发了本次检查。`,
    warningSign: publicInfo,
    mitigation: safeLabel,
    choices: baseChoices,
    safeDefaultChoiceId: "safe",
    followUp: isChain ? { type: "NEXT_STAGE", stageId: `${id}_follow_up` } : null,
    explanationTags: [category, title, "可缓解"],
  };
  if (isChain) template.chainStages = [
    { id: `${id}_opening`, title, publicInfo, choices: baseChoices, safeDefaultChoiceId: "safe" },
    {
      id: `${id}_follow_up`,
      title: `${title} · 后续确认`,
      publicInfo: `前一阶段已经记录；现在确认${safeLabel}后的执行结果。`,
      choices: [choice("confirm", "确认执行并关闭事项", [statEffect("stress", -1)]), choice("safe", "采用安全默认并关闭", [{ type: "NO_EFFECT" }])],
      safeDefaultChoiceId: "safe",
    },
  ];
  return template;
}

export const EVENT_TEMPLATES = Object.freeze(THEMES.map(buildTemplate));
export const EVENT_TEMPLATE_BY_ID = Object.freeze(Object.fromEntries(EVENT_TEMPLATES.map((template) => [template.id, template])));
export const EVENT_CHAIN_IDS = Object.freeze([...CHAIN_IDS]);

export const EVENT_CONDITION_FIELDS = Object.freeze(["weekIndex", "phase", "cash.free", "performer.fatigue", "performer.stress", "routeId"]);
export const EVENT_CONDITION_OPERATORS = Object.freeze(["EQ", "GTE", "LTE", "IN", "GTE_MONEY"]);
export const EVENT_EFFECT_TYPES = Object.freeze(["PERFORMER_STAT_DELTA", "WORK_REPUTATION_DELTA", "PROJECT_DELAY_DAYS", "WORLD_SUPPLY_DELTA", "PREPARATION_BANK_DELTA", "NO_EFFECT"]);
