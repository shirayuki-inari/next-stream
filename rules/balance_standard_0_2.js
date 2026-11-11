// balance_standard_0_2：在 0_1 冻结参数之上调整负荷曲线与早期经济压力。
// 0_1 文件保持字节不变，已开始的旧存档继续按 0_1 结算（规格书 2.2：不偷偷替换已开始的游戏规则）。
import { BALANCE as BALANCE_0_1 } from "./balance_standard_0_1.js";

export const BALANCE = Object.freeze({
  ...BALANCE_0_1,
  id: "balance_standard_0_2",
  note: "0_1 之上的负荷与经济调整：比例恢复、过载停播、较低开局现金、随规模增长的频道运营支出。尚未标记为已完成商业平衡。",
  initialState: Object.freeze({ ...BALANCE_0_1.initialState, cashFreeJpy: "250000" }),
  costs: Object.freeze({
    ...BALANCE_0_1.costs,
    // 每千订阅每周的频道运营支出（剪辑外包、管理、设备折旧）；企业路线由公司承担大部分。
    channelOperations: Object.freeze({ indiePerThousandSubscribersJpy: 1500, companyPerThousandSubscribersJpy: 500, weeklyCapJpy: 150000 }),
  }),
  // 恢复量与当前数值成比例：负荷越高恢复越多，因此每种工作量都有居中的稳定点，而不是只有归零或顶满。
  recovery: Object.freeze({
    model: "PROPORTIONAL",
    daily: Object.freeze({ fatigueBase: 0.5, fatigueRate: 0.05, stressBase: 0.2, stressRate: 0.025 }),
    rest: Object.freeze({ fatigueBase: 2, fatigueRate: 0.15, stressBase: 1.5, stressRate: 0.06 }),
    life: Object.freeze({ fatigueBase: 1, fatigueRate: 0.04, stressBase: 0.5, stressRate: 0.03 }),
  }),
  // 疲劳达到阈值后，未绑定承诺的内容与成长格可能因身体不适临时取消，并按休息处理。
  // 风险 = 基础风险 + (疲劳 − 阈值) × 每点风险，上限为最大风险；只在格子开始时疲劳达到阈值才判定。
  overload: Object.freeze({ fatigueThreshold: 60, baseRisk: 0.15, riskPerPoint: 0.025, maximumRisk: 0.6, physicalConditionPenalty: 3, stressPenalty: 2 }),
  // 自由现金不足以支付本周固定支出时，缺口由压缩生活吸收：不计负债，但影响状态。
  cashShortfall: Object.freeze({ stress: 6, motivation: -4 }),
});

export const RULESET_IDS = Object.freeze({
  platform: "platform_youtube_reference_2026_09_12_v1",
  balance: BALANCE.id,
  content: "content_core_1_0",
});
