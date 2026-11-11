import { BALANCE } from "../../rules/balance_standard_0_2.js";

// 新游戏的开局自由现金加上测试场景中的确定变化量，避免把平衡参数写死在账务断言里。
export function openingCash(delta = 0) {
  return String(BigInt(BALANCE.initialState.cashFreeJpy) + BigInt(delta));
}
