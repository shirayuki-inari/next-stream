import { NAME_PACKS } from "../../rules/name_packs.js";

export function createPreferences() {
  return { reduceMotion: false, namePackId: "design_reference" };
}

export function updatePreferences(sourceState, { reduceMotion, namePackId }) {
  if (typeof reduceMotion !== "boolean" || !NAME_PACKS[namePackId]) return { ok: false, code: "INVALID_COMMAND", message: "辅助设置或名称包无效" };
  const state = structuredClone(sourceState);
  state.preferences = { reduceMotion, namePackId };
  state.snapshotVersion += 1;
  return { ok: true, state };
}
