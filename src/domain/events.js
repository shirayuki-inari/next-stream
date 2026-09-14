import { EVENT_CONDITION_FIELDS, EVENT_CONDITION_OPERATORS, EVENT_EFFECT_TYPES, EVENT_TEMPLATE_BY_ID, EVENT_TEMPLATES } from "../../rules/event_templates.js";

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function stableUnit(...parts) {
  const text = parts.join("/");
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967296;
}

function fieldValue(state, field) {
  if (!EVENT_CONDITION_FIELDS.includes(field)) throw new Error(`事件条件字段不在白名单：${field}`);
  if (field === "weekIndex") return state.weekIndex;
  if (field === "phase") return state.phase;
  if (field === "cash.free") return state.cash.free;
  if (field === "routeId") return state.routeId;
  if (field === "performer.fatigue") return state.performer.fatigue;
  if (field === "performer.stress") return state.performer.stress;
  return undefined;
}

function conditionMatches(state, condition) {
  if (!EVENT_CONDITION_OPERATORS.includes(condition.op)) throw new Error(`事件条件操作不在白名单：${condition.op}`);
  const actual = fieldValue(state, condition.field);
  if (condition.op === "EQ") return actual === condition.value;
  if (condition.op === "GTE") return Number(actual) >= Number(condition.value);
  if (condition.op === "LTE") return Number(actual) <= Number(condition.value);
  if (condition.op === "IN") return condition.value.includes(actual);
  if (condition.op === "GTE_MONEY") return BigInt(actual) >= BigInt(condition.value);
  return false;
}

export function validateEventTemplate(template) {
  const required = ["id", "title", "scope", "applicableStates", "trigger", "weight", "cooldownWeeks", "severity", "maxOccurrences", "publicInfo", "choices", "safeDefaultChoiceId", "explanationTags"];
  for (const field of required) if (template[field] == null) return { ok: false, reason: `缺少 ${field}` };
  for (const condition of template.trigger.all || []) if (!EVENT_CONDITION_FIELDS.includes(condition.field) || !EVENT_CONDITION_OPERATORS.includes(condition.op)) return { ok: false, reason: "条件不在白名单" };
  const stages = template.chainStages || [template];
  if (template.followUp && stages.length < 2) return { ok: false, reason: "事件链缺少第二阶段" };
  for (const stage of stages) {
    if (!stage.choices?.some((item) => item.id === stage.safeDefaultChoiceId)) return { ok: false, reason: "安全默认选项不存在" };
    for (const item of stage.choices || []) {
      if (!Array.isArray(item.costs) || !Array.isArray(item.effects)) return { ok: false, reason: "选项缺少代价或效果列表" };
      for (const requirement of item.requirements || []) if (!EVENT_CONDITION_FIELDS.includes(requirement.field) || !EVENT_CONDITION_OPERATORS.includes(requirement.op)) return { ok: false, reason: "选项条件不在白名单" };
      for (const effect of item.effects) if (!EVENT_EFFECT_TYPES.includes(effect.type)) return { ok: false, reason: `效果不在白名单：${effect.type}` };
    }
  }
  return { ok: true };
}

export function eligibleEventTemplates(state) {
  return EVENT_TEMPLATES.filter((template) => {
    if (!template.applicableStates.includes(state.phase)) return false;
    if (!(template.trigger.all || []).every((condition) => conditionMatches(state, condition))) return false;
    const history = (state.textEvents || []).filter((event) => event.templateId === template.id);
    if (history.length >= template.maxOccurrences) return false;
    const lastWeek = Math.max(0, ...history.map((event) => event.weekIndex));
    return !lastWeek || state.weekIndex - lastWeek >= template.cooldownWeeks;
  });
}

function instantiateEvent(template, weekIndex) {
  const stage = template.chainStages?.[0] || template;
  return {
    id: `text_event_w${weekIndex}_${template.id}`,
    templateId: template.id,
    weekIndex,
    status: "PENDING",
    stageIndex: 0,
    stageId: stage.id || template.id,
    title: stage.title,
    publicInfo: stage.publicInfo,
    severity: template.severity,
    cause: template.cause,
    warningSign: template.warningSign,
    mitigation: template.mitigation,
    explanationTags: [...template.explanationTags],
    decisions: [],
  };
}

export function ensureWeeklyEvent(state) {
  state.textEvents ??= [];
  state.eventWeeksProcessed ??= [];
  if (state.eventWeeksProcessed.includes(state.weekIndex)) return state.textEvents.find((event) => event.weekIndex === state.weekIndex) || null;
  state.eventWeeksProcessed.push(state.weekIndex);
  if (state.textEvents.some((event) => event.status === "PENDING")) return null;
  const eligible = eligibleEventTemplates(state);
  if (!eligible.length) return null;
  const totalWeight = eligible.reduce((sum, template) => sum + template.weight, 0);
  let cursor = stableUnit(state.seed, state.weekIndex, "text-event") * totalWeight;
  const selected = eligible.find((template) => (cursor -= template.weight) <= 0) || eligible.at(-1);
  const event = instantiateEvent(selected, state.weekIndex);
  state.textEvents.push(event);
  return event;
}

export function openTextEvent(sourceState, templateId) {
  const template = EVENT_TEMPLATE_BY_ID[templateId];
  if (!template) return { ok: false, code: "EVENT_NOT_FOUND", message: "事件模板不存在" };
  const validation = validateEventTemplate(template);
  if (!validation.ok) return { ok: false, code: "EVENT_TEMPLATE_INVALID", message: validation.reason };
  const state = structuredClone(sourceState);
  state.textEvents ??= [];
  const event = instantiateEvent(template, state.weekIndex);
  event.id = `${event.id}_${state.textEvents.length + 1}`;
  state.textEvents.push(event);
  state.snapshotVersion += 1;
  return { ok: true, state, event };
}

function currentStage(template, event) {
  return template.chainStages?.[event.stageIndex] || template;
}

function applyEffect(state, effect) {
  if (!EVENT_EFFECT_TYPES.includes(effect.type)) throw new Error(`事件效果不在白名单：${effect.type}`);
  if (effect.type === "NO_EFFECT") return;
  if (effect.type === "PERFORMER_STAT_DELTA") {
    if (!["fatigue", "stress", "motivation", "physicalCondition"].includes(effect.field)) throw new Error("表演者状态字段不在白名单");
    state.performer[effect.field] = clamp(Number(state.performer[effect.field]) + Number(effect.value), 0, 100);
  } else if (effect.type === "WORK_REPUTATION_DELTA") {
    state.performer.workReputation = clamp(Number(state.performer.workReputation) + Number(effect.value), 0, 100);
  } else if (effect.type === "PROJECT_DELAY_DAYS") {
    const project = state.projects.find((item) => !["CANCELLED", "ARCHIVED", "SETTLED"].includes(item.status));
    if (project) project.eventDelayDays = Number(project.eventDelayDays || 0) + Number(effect.value);
  } else if (effect.type === "WORLD_SUPPLY_DELTA") {
    const world = state.worldWeeks.find((item) => item.weekIndex === state.weekIndex);
    if (world) world.supplyResources = clamp(Number(world.supplyResources) + Number(effect.value), 0, 100);
  } else if (effect.type === "PREPARATION_BANK_DELTA") {
    state.progression.preparationBank = clamp(Number(state.progression.preparationBank || 0) + Number(effect.value), 0, 2);
  }
}

export function resolveTextEvent(sourceState, { eventId, choiceId, useSafeDefault = false }) {
  const state = structuredClone(sourceState);
  const event = state.textEvents?.find((item) => item.id === eventId);
  if (!event || event.status !== "PENDING") return { ok: false, code: "EVENT_NOT_PENDING", message: "事件不存在或已经处理" };
  const template = EVENT_TEMPLATE_BY_ID[event.templateId];
  const stage = currentStage(template, event);
  const selectedId = useSafeDefault ? stage.safeDefaultChoiceId : choiceId;
  const selected = stage.choices.find((item) => item.id === selectedId);
  if (!selected) return { ok: false, code: "EVENT_CHOICE_INVALID", message: "事件选项无效" };
  if (!(selected.requirements || []).every((requirement) => conditionMatches(state, requirement))) return { ok: false, code: "EVENT_REQUIREMENT_UNMET", message: "当前状态不满足这个选项的条件" };
  const totalCost = selected.costs.reduce((sum, cost) => sum + BigInt(cost.amountJpy), 0n);
  if (BigInt(state.cash.free) < totalCost) return { ok: false, code: "INSUFFICIENT_FREE_CASH", message: "自由现金不足，仍可选择安全默认方案" };
  if (totalCost > 0n) {
    state.cash.free = String(BigInt(state.cash.free) - totalCost);
    state.history.journalEntries.push({ id: `journal_${event.id}_s${event.stageIndex}`, date: state.worldWeeks.find((item) => item.weekIndex === state.weekIndex)?.startDate || state.createdAt, sourceId: event.id, lines: [{ account: "EVENT_EXPENSE", debit: String(totalCost), credit: "0" }, { account: "CASH_FREE", debit: "0", credit: String(totalCost) }] });
  }
  for (const effect of selected.effects) applyEffect(state, effect);
  event.decisions.push({ stageId: stage.id || template.id, choiceId: selected.id, costs: structuredClone(selected.costs), effects: structuredClone(selected.effects), usedSafeDefault: useSafeDefault });
  if (template.chainStages && event.stageIndex + 1 < template.chainStages.length) {
    event.stageIndex += 1;
    const nextStage = currentStage(template, event);
    event.stageId = nextStage.id;
    event.title = nextStage.title;
    event.publicInfo = nextStage.publicInfo;
  } else {
    event.status = "RESOLVED";
    event.resolvedWeekIndex = state.weekIndex;
  }
  state.snapshotVersion += 1;
  return { ok: true, state, event };
}

export function resolvePendingEventsWithSafeDefaults(sourceState) {
  let state = sourceState;
  while (state.textEvents?.some((event) => event.status === "PENDING")) {
    const event = state.textEvents.find((item) => item.status === "PENDING");
    const result = resolveTextEvent(state, { eventId: event.id, useSafeDefault: true });
    if (!result.ok) throw new Error(result.message);
    state = result.state;
  }
  return state;
}
