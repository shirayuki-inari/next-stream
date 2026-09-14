import test from "node:test";
import assert from "node:assert/strict";
import { EVENT_CHAIN_IDS, EVENT_EFFECT_TYPES, EVENT_TEMPLATES } from "../rules/event_templates.js";
import { createGame, settleWeek } from "../src/domain/engine.js";
import { openTextEvent, resolveTextEvent, validateEventTemplate } from "../src/domain/events.js";

const abilities = { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 };
function game(seed = "events") {
  return createGame({ mode: "direct", routeId: "indie", performerCode: "EVENT", characterName: "事件测试", primaryLanguage: "jp", primaryDirection: "creative", careerGoal: "creator", seed, abilities });
}

test("the ruleset contains exactly 40 valid templates across ten categories and exactly eight two-stage chains", () => {
  assert.equal(EVENT_TEMPLATES.length, 40);
  assert.equal(new Set(EVENT_TEMPLATES.map((item) => item.id)).size, 40);
  assert.equal(new Set(EVENT_TEMPLATES.map((item) => item.category)).size, 10);
  for (const category of new Set(EVENT_TEMPLATES.map((item) => item.category))) assert.equal(EVENT_TEMPLATES.filter((item) => item.category === category).length, 4);
  assert.equal(EVENT_CHAIN_IDS.length, 8);
  for (const template of EVENT_TEMPLATES) {
    assert.deepEqual(validateEventTemplate(template), { ok: true });
    assert.ok(template.cause && template.warningSign && template.mitigation);
    assert.ok(template.choices.every((item) => Array.isArray(item.costs) && item.effects.every((effect) => EVENT_EFFECT_TYPES.includes(effect.type))));
    if (EVENT_CHAIN_IDS.includes(template.id)) assert.equal(template.chainStages.length, 2);
  }
});

test("all 40 templates can be instantiated and safely resolved without arbitrary state mutation", () => {
  for (const template of EVENT_TEMPLATES) {
    let state = game(`event-${template.id}`);
    state.textEvents = [];
    const opened = openTextEvent(state, template.id);
    assert.equal(opened.ok, true, template.id);
    let result = resolveTextEvent(opened.state, { eventId: opened.event.id, useSafeDefault: true });
    assert.equal(result.ok, true, template.id);
    if (template.chainStages) {
      assert.equal(result.event.status, "PENDING", template.id);
      result = resolveTextEvent(result.state, { eventId: opened.event.id, useSafeDefault: true });
      assert.equal(result.ok, true, template.id);
    }
    assert.equal(result.event.status, "RESOLVED", template.id);
  }
});

test("a paid event choice charges free cash exactly once with a balanced journal", () => {
  const state = game("paid-event");
  state.textEvents = [];
  const opened = openTextEvent(state, "equipment_backup_proposal");
  const before = BigInt(opened.state.cash.free);
  const resolved = resolveTextEvent(opened.state, { eventId: opened.event.id, choiceId: "active" });
  assert.equal(resolved.ok, true);
  assert.equal(BigInt(resolved.state.cash.free), before - 20000n);
  const journal = resolved.state.history.journalEntries.at(-1);
  assert.equal(journal.lines.reduce((sum, line) => sum + BigInt(line.debit), 0n), journal.lines.reduce((sum, line) => sum + BigInt(line.credit), 0n));
  const replay = resolveTextEvent(resolved.state, { eventId: opened.event.id, choiceId: "active" });
  assert.equal(replay.ok, false);
  assert.equal(BigInt(resolved.state.cash.free), before - 20000n);
});

test("unresolved events use their safe defaults when the week advances", async () => {
  const state = game("safe-default");
  const pending = state.textEvents.find((event) => event.status === "PENDING");
  assert.ok(pending);
  const settled = await settleWeek(state);
  assert.equal(settled.ok, true);
  assert.equal(settled.state.textEvents.find((event) => event.id === pending.id).status, "RESOLVED");
  assert.ok(settled.state.textEvents.find((event) => event.id === pending.id).decisions.every((decision) => decision.usedSafeDefault));
});
