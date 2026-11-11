import { ROUTES } from "../../rules/agency_profiles.js";
import { balanceOf } from "../../rules/balance_profiles.js";

// 每周固定支出：生活费、个人势工具费，以及 0_2 起随订阅规模增长的频道运营支出。
export function weeklyExpenses(state, profile = balanceOf(state)) {
  const route = ROUTES[state.routeId];
  const living = BigInt(profile.costs.weeklyLivingJpy);
  const tools = route.weeklyToolCost;
  const rule = profile.costs.channelOperations;
  let operations = 0n;
  if (rule) {
    const perThousand = state.affiliation?.agencyId ? rule.companyPerThousandSubscribersJpy : rule.indiePerThousandSubscribersJpy;
    operations = BigInt(Math.min(rule.weeklyCapJpy, Math.floor(state.channel.subscribers / 1000) * perThousand));
  }
  return { living, tools, operations, total: living + tools + operations };
}
