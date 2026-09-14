import { recalculateEligibilityWindows } from "./finance.js";

const VISIBILITIES = new Set(["PUBLIC", "UNLISTED", "PRIVATE", "DELETED"]);

export function changeContentVisibility(sourceState, { contentId, visibility, date }) {
  if (sourceState.phase !== "PLANNING") return { ok: false, code: "INVALID_PHASE", message: "只能在排期阶段修改内容公开状态" };
  if (!VISIBILITIES.has(visibility)) return { ok: false, code: "INVALID_COMMAND", message: "目标公开状态无效" };
  const source = sourceState.history.contents.find((content) => content.id === contentId);
  if (!source) return { ok: false, code: "INVALID_COMMAND", message: "内容记录不存在" };
  if (source.deletedAt) return { ok: false, code: "INVALID_COMMAND", message: "已删除内容只保留历史与财务记录，不能重新公开" };
  const current = source.visibility;
  if (current === visibility) return { ok: false, code: "NO_CHANGE", message: "内容已经处于该公开状态" };
  const state = structuredClone(sourceState);
  const content = state.history.contents.find((item) => item.id === contentId);
  content.visibilityHistory ??= [];
  content.visibilityHistory.push({ from: current, to: visibility, date });
  if (visibility === "DELETED") {
    content.visibility = "PRIVATE";
    content.deletedAt = date;
    content.validForEligibility = false;
  } else {
    content.visibility = visibility;
    content.validForEligibility = visibility === "PUBLIC";
  }
  recalculateEligibilityWindows(state, date);
  state.snapshotVersion += 1;
  return { ok: true, state, content };
}
