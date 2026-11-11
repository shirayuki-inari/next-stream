// 存档绑定的平衡规则包。新游戏使用 CURRENT_BALANCE_ID；旧存档按其 rulesets.balance 继续结算。
import { BALANCE as BALANCE_0_1 } from "./balance_standard_0_1.js";
import { BALANCE as BALANCE_0_2 } from "./balance_standard_0_2.js";

// 0_1 发布时，以下负荷与支出规则写在引擎中而非规则文件；这里按原值显式冻结，保证旧存档回放不变。
const LEGACY_0_1_DYNAMICS = Object.freeze({
  recovery: Object.freeze({ model: "FLAT", daily: Object.freeze({ fatigue: 4, stress: 2 }) }),
  overload: null,
  cashShortfall: null,
  costs: Object.freeze({ ...BALANCE_0_1.costs, channelOperations: null }),
});

export const BALANCE_PROFILES = Object.freeze({
  [BALANCE_0_1.id]: Object.freeze({ ...BALANCE_0_1, ...LEGACY_0_1_DYNAMICS }),
  [BALANCE_0_2.id]: BALANCE_0_2,
});

export const CURRENT_BALANCE_ID = BALANCE_0_2.id;
export const SUPPORTED_BALANCE_IDS = Object.freeze(Object.keys(BALANCE_PROFILES));

export function balanceOf(state) {
  return BALANCE_PROFILES[state?.rulesets?.balance] || BALANCE_PROFILES[CURRENT_BALANCE_ID];
}
