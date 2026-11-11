import { ACTIONS, PLANNABLE_ACTION_IDS } from "../rules/actions.js";
import { AGENCIES, ROUTES } from "../rules/agency_profiles.js";
import { BALANCE } from "../rules/balance_standard_0_1.js";
import { EVENT_TEMPLATE_BY_ID } from "../rules/event_templates.js";
import { NAME_PACKS } from "../rules/name_packs.js";
import {
  DIRECTIONS,
  GOALS,
  SKILLS,
  SKILL_LABELS,
  createGame,
  forecastPlan,
  isoAddDays,
  migrateGame,
  previewWeek,
  slotLoad,
  weekDateRange,
  weeklyExpenses,
} from "./domain/engine.js";
import { balanceOf } from "../rules/balance_profiles.js";
import { adsEligibility, fanFundingEligibility } from "./domain/finance.js";
import { sponsorCandidateMetrics } from "./domain/sponsorship.js";
import { auditionEligibility, auditionScore, isAuditionTerminal } from "./domain/audition.js";
import { invitationScore } from "./domain/world.js";
import { TUTORIAL_STEPS, careerModeOf, evaluateCareerGoal, isCareerReviewWeek, nextCareerReviewWeek, retrospectivePeriodLabel } from "./domain/career.js";
import { CAREER_MODES } from "../rules/career_modes.js";
import { commandEnvelope, executeCommand } from "./application/commands.js";
import { clearGame, exportGame, importGame, loadBackups, loadMigratedGame, loadSaveMetadata, saveGame } from "./storage.js";

const root = document.querySelector("#app");
const DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
const TIME_NAMES = ["10:00", "20:00"];
const PLATFORM_STATUS_LABELS = { INELIGIBLE: "未开通", ELIGIBLE_TO_APPLY: "可申请", UNDER_REVIEW: "审核中", APPROVED: "已批准", REJECTED: "需重新处理", SUSPENDED: "已暂停", REVOKED: "已撤销" };
const SPONSOR_STATUS_LABELS = { OPEN: "待决定", ACCEPTED: "待交付", DELIVERED: "已交付", OFFER_EXPIRED: "报价已过期", CANCELLED: "已取消" };
const MERCH_STATUS_LABELS = { DRAFT: "草案", DESIGNING: "设计中", SAMPLING: "打样等待", READY_TO_SELL: "可开售", ON_SALE: "预售中", SALES_CLOSED: "销售已结束", PRODUCING: "生产中", READY_TO_SHIP: "待发货", FULFILLING: "发货处理中", AFTER_SALES: "售后期", SETTLED: "已结项", CANCELLED: "已取消", PAUSED: "已暂停" };
const MERCH_MODE_LABELS = { PRESALE: "预售生产", READY_STOCK: "少量现货", DIGITAL: "数字商品" };
const MERCH_TEMPLATE_LIST = [BALANCE.merch.acrylicStand, BALANCE.merch.readyStockBadge, BALANCE.merch.digitalVoicePack];
const LONG_PROJECT_STATUS_LABELS = { DRAFT: "草案", REVIEW: "审核中", APPROVED: "已批准", PRE_PRODUCTION: "前期准备", PRODUCTION: "制作中", QUALITY_CHECK: "质量检查", SCHEDULED: "已排期", PUBLISHED: "已发布", LONG_TAIL: "长尾运营", PAUSED: "已暂停", CANCELLED: "已取消", ARCHIVED: "已归档" };
const LONG_PROJECT_TEMPLATE_LIST = Object.values(BALANCE.longProjects);
const RESOURCE_LABELS = { DESIGN_SUPPLIER_ORDER: "设计供应商订单", MANAGER_ASSIST: "经纪协助", RECORDING_SLOT: "录音资源", USAGE_LICENSE: "素材用途许可", SONG_PRODUCTION_SUPPLIER: "词曲与制作供应商", PROJECT_COORDINATION: "企划协调", THREE_D_SLOT: "3D 资源" };
const AUDITION_STATUS_LABELS = { DRAFT_APPLICATION: "申请草案", SUBMITTED: "已提交", SCREENING: "初筛中", INTERVIEW_1: "第一轮面试", INTERVIEW_2: "最终面试", CONDITIONAL_OFFER: "附条件意向", CONTRACT_REVIEW: "合同审阅", PREPARING_DEBUT: "出道准备", COMPLETED: "已录取", REJECTED: "未通过", WITHDRAWN: "已撤回", OFFER_EXPIRED: "意向已过期" };
const AUDITION_CHECK_LABELS = { adult: "成年条件", language: "主语言", availability: "可投入时间", workHistory: "有效作品", contract: "合同可处理" };
const AUDITION_SCORE_LABELS = { coreSpecialty: "核心特长 · 30%", portfolio: "作品集 · 25%", continuity: "持续性 · 20%", collaboration: "协作 · 15%", fit: "方向匹配 · 10%" };
const TRANSFER_STATUS_LABELS = { EXPLORING: "探索中", DESTINATION_CONFIRMED: "目标已确认", EXIT_NEGOTIATION: "退出协商", ASSET_AND_OBLIGATION_PLAN: "资产与责任方案", NOTICE_PERIOD: "通知期", READY_TO_SWITCH: "可切换", SWITCHED: "已切换", REBUILDING: "恢复期", CLOSED: "已完成", DECLINED: "已拒绝", CANCELLED: "已取消", PAUSED: "已暂停" };
const CONTENT_TYPE_LABELS = { LIVE: "直播", SHORT: "短视频", VIDEO: "视频" };
const VISIBILITY_LABELS = { PUBLIC: "公开", UNLISTED: "不公开列出", PRIVATE: "私密", DELETED: "已删除" };
const CAREER_ENDING_LABELS = { PAUSE: "暂停职业活动", PART_TIME: "转为兼职", GRADUATION: "毕业", INDEPENDENT: "以个人势身份结束", STAY_COMPANY: "留在企业并结束" };
const abilityPresets = {
  balanced: { expression: 50, specialty: 50, performance: 50, production: 50, planning: 50, collaboration: 50 },
  talk: { expression: 70, specialty: 50, performance: 35, production: 45, planning: 50, collaboration: 50 },
  stage: { expression: 55, specialty: 35, performance: 70, production: 50, planning: 45, collaboration: 45 },
  maker: { expression: 40, specialty: 45, performance: 35, production: 70, planning: 65, collaboration: 45 },
};

const startupLoad = await loadMigratedGame(migrateGame);
let game = startupLoad.game;
let ui = { view: "overview", selectedSlot: null, notice: startupLoad.error ? { tone: "error", text: startupLoad.error } : null, busy: false, createRoute: "indie", abilityPreset: "balanced", reportOpen: game?.phase === "REPORT", confirmation: null, focusReturn: null, creationDraft: null, financeFilter: "ALL", financeTransactionsOpen: false, financeTransactionLimit: 40, financeJournalLimit: 40, contentLimit: 40, lifeFilter: "ALL" };
let pendingConfirmationResolve = null;

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function money(value) {
  return `${BigInt(value || 0).toLocaleString("zh-CN")} 日元`;
}

function compact(value) {
  const number = Number(value || 0);
  if (number >= 10000) return `${(number / 10000).toFixed(number >= 100000 ? 1 : 2).replace(/\.0$/, "")}万`;
  return number.toLocaleString("zh-CN");
}

function signed(value) {
  const number = Number(value || 0);
  return `${number >= 0 ? "+" : ""}${number.toLocaleString("zh-CN")}`;
}

function affiliationLabel() {
  return routeDisplayLabel(game.routeId);
}

function npcAffiliationLabel(affiliationId) {
  if (affiliationId === "2434") return agencyDisplayLabel("agency_2434");
  if (affiliationId === "homolive") return agencyDisplayLabel("agency_homolive");
  return routeDisplayLabel(affiliationId);
}

function activeNamePack() {
  return NAME_PACKS[game?.preferences?.namePackId] || NAME_PACKS.design_reference;
}

function routeDisplayLabel(routeId) {
  return activeNamePack().routes[routeId] || ROUTES[routeId]?.label || routeId;
}

function agencyDisplayLabel(agencyId) {
  return activeNamePack().agencies[agencyId] || AGENCIES[agencyId]?.label || agencyId;
}

function dateLabel(iso) {
  const [year, month, day] = iso.split("-");
  return `${year}.${month}.${day}`;
}

function slotLabel(slotIndex) {
  return `${DAY_NAMES[Math.floor(slotIndex / 2)]} ${TIME_NAMES[slotIndex % 2]}`;
}

function metricCard(label, value, meta, tone = "default") {
  return `<article class="metric-card metric-${tone}">
    <div class="metric-label">${label}</div>
    <div class="metric-value">${value}</div>
    <div class="metric-meta">${meta}</div>
  </article>`;
}

function statusMeter(label, value, inverse = false) {
  const danger = inverse ? value >= 75 : value <= 35;
  return `<div class="status-meter ${danger ? "is-alert" : ""}">
    <div class="status-meter-head"><span>${label}</span><strong>${value}</strong></div>
    <div class="meter-track" role="meter" aria-label="${label}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${value}"><i style="width:${value}%"></i></div>
  </div>`;
}

function textEventPanel() {
  const event = game.textEvents.find((item) => item.status === "PENDING");
  if (!event) return "";
  const template = EVENT_TEMPLATE_BY_ID[event.templateId];
  const stage = template.chainStages?.[event.stageIndex] || template;
  const effectLabel = (effect) => {
    if (effect.type === "NO_EFFECT") return "无数值变化";
    if (effect.type === "WORK_REPUTATION_DELTA") return `工作信誉 ${signed(effect.value)}`;
    if (effect.type === "PERFORMER_STAT_DELTA") return `${{ fatigue: "疲劳", stress: "压力", motivation: "动力", physicalCondition: "身体" }[effect.field]} ${signed(effect.value)}`;
    return "更新相关数值";
  };
  return `<details class="fold-panel event-decision" open><summary><span><b>${escapeHtml(event.title)}</b><small>${template.category}事件 · ${template.chainStages ? `第 ${event.stageIndex + 1}/2 阶段` : "单次事件"} · 需要决定</small></span><i>收起</i></summary><div class="fold-content"><p class="event-public">${escapeHtml(event.publicInfo)}</p><div class="event-choices">${stage.choices.map((choice) => { const cost = choice.costs.reduce((sum, item) => sum + BigInt(item.amountJpy), 0n); return `<button data-resolve-event="${event.id}" data-event-choice="${choice.id}" class="${choice.id === stage.safeDefaultChoiceId ? "secondary-action" : "primary-action"}"><span><b>${escapeHtml(choice.label)}</b><small>${cost ? `费用 ${money(cost)} · ` : "无费用 · "}${choice.effects.map(effectLabel).join(" · ")}${choice.id === stage.safeDefaultChoiceId ? " · 默认选项" : ""}</small></span><em>→</em></button>`; }).join("")}</div><details class="micro-fold"><summary>查看事件详情</summary><dl class="event-context"><div><dt>起因</dt><dd>${escapeHtml(event.cause)}</dd></div><div><dt>征兆</dt><dd>${escapeHtml(event.warningSign)}</dd></div><div><dt>应对建议</dt><dd>${escapeHtml(event.mitigation)}</dd></div></dl></details><p class="plain-note">未作选择时，推进本周将采用标记为“默认选项”的方案。</p></div></details>`;
}

function tutorialPanel() {
  const tutorial = game.tutorial;
  if (!tutorial || tutorial.skipped || tutorial.rewardGranted || game.weekIndex > 4) return "";
  const labels = { SCHEDULE: "安排一个工作格", FIRST_LIVE: "完成第一场直播", FIRST_VIDEO: "发布一次视频", AUDIENCE_METRICS: "查看订阅与观看区别", FINANCE_LAYERS: "查看应收与现金", CONTRACT_ASSETS: "查看合同与资产" };
  const targets = { SCHEDULE: "schedule", FIRST_LIVE: "schedule", FIRST_VIDEO: "schedule", AUDIENCE_METRICS: "channel", FINANCE_LAYERS: "finance", CONTRACT_ASSETS: "career" };
  const nextStep = TUTORIAL_STEPS.find((step) => !tutorial.completedSteps.includes(step));
  const viewOnly = ["AUDIENCE_METRICS", "FINANCE_LAYERS", "CONTRACT_ASSETS"].includes(nextStep);
  return `<aside class="tutorial-strip"><div><span>新手引导 · ${tutorial.completedSteps.length}/6</span><b>下一步：${labels[nextStep]}</b><small>完成全部步骤可获得 ${money(tutorial.rewardJpy)}（教程效果，仅发放一次）。</small></div><div><button class="secondary-action" data-skip-tutorial>跳过</button><button class="primary-action" ${viewOnly ? `data-tutorial-step="${nextStep}"` : `data-view="${targets[nextStep]}"`}>${viewOnly ? "查看" : "前往"} →</button></div></aside>`;
}

function routeDetail(routeId) {
  const route = ROUTES[routeId] || ROUTES.indie;
  return `<b>${escapeHtml(route.label)}</b> · ${escapeHtml(route.statement)}<span class="route-tags">${route.strengths.map((item) => `<em>${escapeHtml(item)}</em>`).join("")}</span>`;
}

function matchingAbilityPreset(abilities) {
  return Object.entries(abilityPresets).find(([, preset]) => SKILLS.every((skill) => preset[skill] === abilities[skill]))?.[0] || null;
}

function renderCreation() {
  const draft = ui.creationDraft;
  const abilities = draft?.abilities || abilityPresets[ui.abilityPreset];
  const activePreset = matchingAbilityPreset(abilities);
  const routeId = draft?.routeId || ui.createRoute;
  const radio = (name, value, checked, title, note) => `<label><input type="radio" name="${name}" value="${value}" ${checked ? "checked" : ""} /><span><b>${title}</b><small>${note}</small></span></label>`;
  root.innerHTML = `<main class="creation-shell">
    <header class="start-header">
      <div class="brand-lockup"><span class="brand-signal" aria-hidden="true"></span><span>下一场直播</span></div>
      <span class="start-header-note">虚拟主播周回合经营 · 模拟日元</span>
    </header>
    <section class="start-panel">
      ${ui.notice ? `<div class="toast ${ui.notice.tone}" role="status"><span>${escapeHtml(ui.notice.text)}</span><button data-dismiss-notice aria-label="关闭提示">×</button></div>` : ""}
      <form id="create-form" class="start-form" autocomplete="off" aria-labelledby="game-title">
        <div class="form-heading">
          <p class="eyebrow">新游戏</p>
          <h1 id="game-title">创建角色</h1>
          <p>三条出道路线的资源结构不同，不代表难度高低；开始后可通过转籍改变所属。</p>
        </div>
        <div class="form-grid">
          <label class="field"><span>表演者代号</span><input name="performerCode" required maxlength="24" placeholder="例：HIKARI" value="${escapeHtml(draft?.performerCode || "")}" /></label>
          <label class="field"><span>角色名</span><input name="characterName" required maxlength="24" placeholder="例：朝雾光" value="${escapeHtml(draft?.characterName || "")}" /></label>
        </div>
        <fieldset>
          <legend>出道路线</legend>
          <div class="route-options">
            ${Object.values(ROUTES).map((route) => `<label class="route-option ${routeId === route.id ? "selected" : ""}"><input type="radio" name="route" value="${route.id}" ${routeId === route.id ? "checked" : ""} /><b>${route.label}</b><i>${route.id === "indie" ? "自主经营" : "虚构标准合同"}</i></label>`).join("")}
          </div>
          <p class="route-detail" id="route-detail" aria-live="polite">${routeDetail(routeId)}</p>
        </fieldset>
        <div class="option-pair">
          <fieldset>
            <legend>生涯长度</legend>
            <div class="segmented two">${Object.values(CAREER_MODES.modes).map((mode) => radio("careerModeId", mode.id, (draft?.careerModeId || CAREER_MODES.defaultModeId) === mode.id, mode.label, mode.id === "short" ? "26 周 · 约 20 分钟" : "104 周 · 完整两年")).join("")}</div>
          </fieldset>
          <fieldset>
            <legend>开局方式</legend>
            <div class="segmented two">${radio("mode", "direct", draft?.mode !== "history", "直接出道", "立即首播准备")}${radio("mode", "history", draft?.mode === "history", "完整履历", "从准备期积累")}</div>
          </fieldset>
        </div>
        <div class="form-grid triple">
          <label class="field"><span>主语言</span><select name="primaryLanguage"><option value="jp" ${draft?.primaryLanguage !== "en" ? "selected" : ""}>日语市场</option><option value="en" ${draft?.primaryLanguage === "en" ? "selected" : ""}>英语市场</option></select></label>
          <label class="field"><span>内容主方向</span><select name="primaryDirection">${Object.entries(DIRECTIONS).map(([id, label]) => `<option value="${id}" ${draft?.primaryDirection === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>
          <label class="field"><span>职业目标</span><select name="careerGoal">${Object.entries(GOALS).map(([id, label]) => `<option value="${id}" ${draft?.careerGoal === id ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        </div>
        <fieldset class="ability-fieldset">
          <legend>能力配置 <span id="ability-total" class="legend-total">总计 300 / 300</span></legend>
          <div class="preset-row" role="group" aria-label="能力预设">
            ${Object.entries({ balanced: "均衡", talk: "临场表达", stage: "舞台表演", maker: "企划制作" }).map(([id, label]) => `<button type="button" class="preset-button ${activePreset === id ? "active" : ""}" data-preset="${id}" aria-pressed="${activePreset === id}">${label}</button>`).join("")}
          </div>
          <details class="ability-fold" ${activePreset ? "" : "open"}>
            <summary>自定义六项数值与存档种子</summary>
            <div class="ability-grid">
              ${SKILLS.map((skill) => `<label class="ability-control"><span>${SKILL_LABELS[skill]}</span><input type="number" name="ability-${skill}" min="20" max="70" value="${abilities[skill]}" /><i class="ability-bar"><b style="width:${abilities[skill]}%"></b></i></label>`).join("")}
            </div>
            <label class="field seed-field"><span>存档种子</span><input name="seed" maxlength="64" value="${escapeHtml(draft?.seed || "next-stream-001")}" /></label>
          </details>
        </fieldset>
        <button class="primary-action creation-submit" type="submit"><span>开始游戏</span><i>进入第 1 周 →</i></button>
        <p class="simulation-note">金额均为游戏内模拟日元，不涉及真实账号或支付。</p>
      </form>
    </section>
  </main>${ui.confirmation ? confirmationDialog() : ""}`;
  scheduleNoticeDismiss();
  bindCreation();
  bindConfirmation();
  requestAnimationFrame(() => {
    if (ui.confirmation) root.querySelector("[data-confirm-dialog]")?.focus();
    else if (ui.focusReturn) {
      root.querySelector(ui.focusReturn)?.focus();
      ui.focusReturn = null;
    }
  });
}

function bindCreation() {
  root.querySelector("[data-dismiss-notice]")?.addEventListener("click", () => { ui.notice = null; renderCreation(); });
  root.querySelectorAll('input[name="route"]').forEach((input) => input.addEventListener("change", () => {
    ui.createRoute = input.value;
    root.querySelectorAll(".route-option").forEach((label) => label.classList.toggle("selected", label.contains(input)));
    root.querySelector("#route-detail").innerHTML = routeDetail(input.value);
  }));
  // 预设只改写六项数值，不重绘表单，避免清空已填写的代号与角色名。
  root.querySelectorAll("[data-preset]").forEach((button) => button.addEventListener("click", () => {
    ui.abilityPreset = button.dataset.preset;
    const preset = abilityPresets[ui.abilityPreset];
    for (const skill of SKILLS) root.querySelector(`input[name="ability-${skill}"]`).value = preset[skill];
    updateAbilityDisplay();
  }));
  root.querySelectorAll('.ability-control input[type="number"]').forEach((input) => input.addEventListener("input", updateAbilityDisplay));
  root.querySelector("#create-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const abilities = Object.fromEntries(SKILLS.map((skill) => [skill, Number(data.get(`ability-${skill}`))]));
    try {
      ui.creationDraft = { mode: data.get("mode"), routeId: data.get("route"), performerCode: data.get("performerCode"), characterName: data.get("characterName"), primaryLanguage: data.get("primaryLanguage"), primaryDirection: data.get("primaryDirection"), careerGoal: data.get("careerGoal"), careerModeId: data.get("careerModeId"), seed: data.get("seed"), abilities };
      const candidate = createGame(ui.creationDraft);
      if (candidate.contract) {
        const accepted = await requestConfirmation({
          title: "确认虚构标准合同",
          actionLabel: "接受条款并开始游戏",
          currentPlan: `${ROUTES[candidate.routeId].label} · ${candidate.contract.termWeeks} 周 · 主播取得平台分成后收入 ${candidate.contract.creatorPlatformShareBps / 100}%`,
          cost: `每周工具成本 ${money(ROUTES[candidate.routeId].weeklyToolCost)}；无固定工资`,
          lostPermissions: "角色与频道由公司控制；内容、商单与转籍受合同许可约束",
          retainedAssets: "表演者能力、个人现金、履历与依法已归属收入独立保留",
          unresolvedIssues: `提前结束需 ${candidate.contract.noticeWeeks} 周通知；未来资产转移将另行确认`,
        });
        if (!accepted) return;
      }
      game = candidate;
      await saveGame(game);
      ui.view = "overview";
      ui.notice = { tone: "success", text: "存档已创建。下一步：安排第一场直播。" };
      render();
      requestAnimationFrame(() => window.scrollTo({ top: 0 }));
    } catch (error) {
      showInlineError(event.currentTarget, error.message);
    }
  });
}

function updateAbilityDisplay() {
  const inputs = [...root.querySelectorAll('.ability-control input[type="number"]')];
  const total = inputs.reduce((sum, input) => sum + Number(input.value || 0), 0);
  const display = root.querySelector("#ability-total");
  display.textContent = `总计 ${total} / 300`;
  display.classList.toggle("invalid", total !== 300 || inputs.some((input) => input.value < 20 || input.value > 70));
  inputs.forEach((input) => { input.closest(".ability-control").querySelector(".ability-bar b").style.width = `${Math.min(100, Math.max(0, input.value))}%`; });
  const current = Object.fromEntries(inputs.map((input) => [input.name.replace("ability-", ""), Number(input.value)]));
  const preset = matchingAbilityPreset(current);
  root.querySelectorAll("[data-preset]").forEach((button) => { button.classList.toggle("active", button.dataset.preset === preset); button.setAttribute("aria-pressed", String(button.dataset.preset === preset)); });
}

function showInlineError(form, message) {
  form.querySelector(".form-error")?.remove();
  const node = document.createElement("p");
  node.className = "form-error";
  node.setAttribute("role", "alert");
  node.textContent = message;
  form.querySelector(".creation-submit").before(node);
}

function phaseLabel() {
  if (game.phase === "PLANNING") return "排期中";
  if (game.phase === "READY_TO_COMMIT") return "待提交";
  if (game.phase === "REPORT") return "周报待确认";
  if (game.phase === "RETROSPECTIVE") return `${retrospectivePeriodLabel(game.weekIndex)}回顾`;
  if (game.phase === "CAREER_ENDED") return "生涯已归档";
  return "运行中";
}

const NAV_ITEMS = [["overview", "周总览"], ["schedule", "排期"], ["channel", "频道"], ["projects", "项目"], ["industry", "关系／行业"], ["finance", "财务"], ["career", "职业／合同"], ["life", "生涯"], ["settings", "设置／存档"]];
// 手机底部导航只放高频页面，其余收进「更多」。
const BOTTOM_NAV_ITEMS = [["overview", "总览"], ["schedule", "排期"], ["channel", "频道"], ["finance", "财务"]];
const MORE_NAV_IDS = ["projects", "industry", "career", "life", "settings"];

function bottomNav() {
  const moreActive = MORE_NAV_IDS.includes(ui.view);
  return `<nav class="bottom-nav" aria-label="主要页面（底部）">
    ${BOTTOM_NAV_ITEMS.map(([id, label]) => `<button data-view="${id}" class="${ui.view === id ? "active" : ""}" ${ui.view === id ? `aria-current="page"` : ""}>${label}</button>`).join("")}
    <button data-open-more class="${moreActive ? "active" : ""}" aria-haspopup="dialog" aria-expanded="${Boolean(ui.moreOpen)}" ${moreActive ? `aria-label="更多（当前：${NAV_ITEMS.find(([id]) => id === ui.view)[1]}）"` : ""}>更多</button>
  </nav>`;
}

function moreSheet() {
  if (!ui.moreOpen) return "";
  return `<div class="dialog-backdrop more-backdrop" data-close-more><section class="more-sheet" role="dialog" aria-modal="true" aria-labelledby="more-title" tabindex="-1" data-more-panel>
    <header><b id="more-title">更多页面</b><button class="sheet-close" data-dismiss-more aria-label="关闭">×</button></header>
    ${NAV_ITEMS.filter(([id]) => MORE_NAV_IDS.includes(id)).map(([id, label]) => `<button data-view="${id}" class="${ui.view === id ? "active" : ""}">${label}<span aria-hidden="true">→</span></button>`).join("")}
  </section></div>`;
}

// 手机底部操作栏：阻塞阶段（待提交、周报）在任何页面都显示；排期阶段只在排期页显示推进按钮。
function mobileActionBar() {
  if (game.phase === "READY_TO_COMMIT") return `<div class="action-bar"><span><b>本周结算待提交</b><small>提交后写入存档</small></span><button class="primary-action" data-commit-week ${ui.busy ? "disabled" : ""}>${ui.busy ? "正在提交…" : "提交周结算 →"}</button></div>`;
  if (game.phase === "REPORT") return `<div class="action-bar"><span><b>本周已结算</b><small>确认周报后进入下一周</small></span><button class="primary-action" data-open-report>查看周报 →</button></div>`;
  if (game.phase !== "PLANNING" || ui.view !== "schedule") return "";
  const preview = previewWeek(game);
  const riskLabel = preview.risk === "low" ? "负荷可控" : preview.risk === "medium" ? "需要留意" : "建议减量";
  return `<div class="action-bar" data-risk="${preview.risk}"><span><b>工作格 ${preview.workSlots}/12 · ${riskLabel}</b><small>预计疲劳 ${preview.projectedFatigue} · 压力 ${preview.projectedStress} · 直播 ${preview.liveCount} 场</small></span><button class="primary-action" data-settle ${ui.busy ? "disabled" : ""}>${ui.busy ? "正在结算…" : "推进本周 →"}</button></div>`;
}

function shell(content) {
  const range = weekDateRange(game.weekIndex);
  const reviewWeek = nextCareerReviewWeek(game);
  const actionBar = mobileActionBar();
  return `<div class="game-shell ${actionBar ? "has-action-bar" : ""}">
    <header class="topbar">
      <button class="brand-lockup brand-button" data-view="overview" aria-label="返回周总览"><span class="brand-signal" aria-hidden="true"></span><span>下一场直播</span></button>
      <div class="week-clock"><span>第 ${game.weekIndex}${reviewWeek ? ` / ${reviewWeek}` : ""} 周</span><b>${dateLabel(range.start)} — ${dateLabel(range.end)}</b><i>${phaseLabel()}</i></div>
      <div class="mobile-status" role="group" aria-label="第 ${game.weekIndex} 周 · ${phaseLabel()} · 自由现金 ${compact(game.cash.free)} 日元"><b>第 ${game.weekIndex}${reviewWeek ? `<small> / ${reviewWeek}</small>` : ""} 周</b><i>${phaseLabel()}</i><span>现金 ${compact(game.cash.free)}</span></div>
      <div class="identity-chip"><span>${escapeHtml(game.character.name).slice(0, 1)}</span><div><b>${escapeHtml(game.character.name)}</b><small>${affiliationLabel()}</small></div></div>
    </header>
    <nav class="primary-nav" aria-label="主要页面">
      ${NAV_ITEMS.map(([id, label]) => `<button data-view="${id}" class="${ui.view === id ? "active" : ""}" ${ui.view === id ? `aria-current="page"` : ""}>${label}</button>`).join("")}
    </nav>
    ${ui.notice ? `<div class="toast ${ui.notice.tone}" role="status"><span>${escapeHtml(ui.notice.text)}</span><button data-dismiss-notice aria-label="关闭提示">×</button></div>` : ""}
    <main class="workspace">${content}</main>
    <footer class="app-footer"><span>规则版本：${escapeHtml(game.rulesets.balance)}</span><span>模拟货币 · 本地存档 · 不连接真实账号</span></footer>
    ${actionBar}
    ${bottomNav()}
    ${moreSheet()}
    ${activityDialog()}
    ${ui.reportOpen && game.phase === "REPORT" ? reportDialog() : ""}
  </div>`;
}

function careerProgressLabel() {
  const mode = careerModeOf(game);
  const reviewWeek = nextCareerReviewWeek(game);
  return reviewWeek ? `${mode.label} · 第 ${reviewWeek} 周回顾` : `${mode.label} · 继续经营`;
}

function overviewView() {
  if (game.phase === "CAREER_ENDED") return `<section class="page-stack"><div class="page-heading overview-heading"><div><p class="eyebrow">生涯已归档 · 第 ${game.careerEnding?.throughWeek || 104} 周</p><h1>生涯已归档</h1><p>作品、财务、合同、角色、频道与选择记录均可查看和导出。</p></div><div class="heading-actions"><button class="primary-action" data-view="life">查看生涯回顾 →</button></div></div><section class="ended-summary"><article><span>职业结果</span><b>${CAREER_ENDING_LABELS[game.careerEnding?.outcomeId] || "主动结束"}</b><small>${game.careerEnding?.endedAt || weekDateRange(game.careerEnding?.throughWeek || 104).end}</small></article><article><span>最终订阅</span><b>${game.channel.subscribers.toLocaleString()}</b><small>账面订阅数</small></article><article><span>保留记录</span><b>${game.history.contents.length} 条内容</b><small>${game.history.journalEntries.length} 笔不可变分录</small></article></section></section>`;
  const preview = previewWeek(game);
  const range = weekDateRange(game.weekIndex);
  const avg = game.metrics.weeklyAverageConcurrent == null ? "—" : compact(game.metrics.weeklyAverageConcurrent);
  const lastReport = game.history.weeklyReports.at(-1);
  const membershipTodo = game.history.membershipPromises.find((promise) => promise.status === "OVERDUE") || game.history.membershipPromises.find((promise) => promise.status === "DUE");
  return `<section class="page-stack">
    <div class="page-heading overview-heading">
      <div><p class="eyebrow">${dateLabel(range.start)} — ${dateLabel(range.end)} · ${affiliationLabel()} · ${careerProgressLabel()}</p><h1>${game.phase === "REPORT" ? "本周已结算" : game.phase === "READY_TO_COMMIT" ? "本周结算待提交" : "本周总览"}</h1><p>${game.phase === "REPORT" ? "确认周报后进入下一周排期。" : game.phase === "READY_TO_COMMIT" ? "结算结果已暂存，提交后写入存档。" : "安排本周 14 个时间格后推进结算。未安排的格子记为休息。"}</p></div>
      <div class="heading-actions">${game.phase === "REPORT" ? `<button class="primary-action" data-open-report>查看周报</button>` : game.phase === "READY_TO_COMMIT" ? `<button class="primary-action" data-commit-week>提交周结算 <span>→</span></button>` : `<button class="primary-action" data-view="schedule">安排本周 <span>→</span></button>`}</div>
    </div>
    ${tutorialPanel()}
    <div class="metric-grid">
      ${metricCard("频道订阅", compact(game.channel.subscribers), `${game.metrics.subscriberDelta ? `本周 ${signed(game.metrics.subscriberDelta)}` : "本周尚未结算"}`, "signal")}
      ${metricCard("近 28 日活跃", `约 ${compact(game.metrics.active28dEstimate)}`, "模型估计值", "ink")}
      ${metricCard("本周平均同接", avg, game.metrics.weeklyAverageConcurrent == null ? "本周暂无直播" : "观看分钟 ÷ 直播分钟", "ink")}
      ${metricCard("自由现金", compact(game.cash.free), `应收 ${compact(game.cash.receivable)} · SC归属 ${compact(game.finance.scCreatorEarned)}`, "cash")}
    </div>
    <section class="signal-board">
      <div class="section-heading"><div><span class="section-kicker">本周概况</span><h2>待办与预测</h2></div><span class="section-side">预测值按基准情形计算</span></div>
      <div class="signal-grid">
        <article class="decision-card"><span class="decision-index">排期</span><h3>${preview.workSlots} / 12 个工作格</h3><p>${preview.liveCount ? `已安排 ${preview.liveCount} 场直播，预计新增订阅 ${preview.subscriberRange[0]}—${preview.subscriberRange[1]}。` : "尚未安排直播。未安排的格子在结算时记为休息。"}</p><button data-view="schedule">检查 14 格排期 →</button></article>
        <article class="decision-card"><span class="decision-index">状态</span><h3>${preview.risk === "low" ? "负荷可控" : preview.risk === "medium" ? "需要留意" : "建议减量"}</h3><p>预计周末疲劳 ${preview.projectedFatigue}，压力 ${preview.projectedStress}。</p><button data-toggle-detail="state-detail">查看状态详情 ↓</button></article>
        <article class="decision-card ${membershipTodo?.status === "OVERDUE" ? "decision-urgent" : ""}"><span class="decision-index">待办</span><h3>${membershipTodo ? membershipTodo.status === "OVERDUE" ? "会员福利已到期" : "兑现本期会员福利" : game.progression.hasDebuted ? "维持内容节奏" : "完成第一场直播"}</h3><p>${membershipTodo ? `${membershipTodo.benefits.join("＋")}，截止 ${membershipTodo.dueDate}。` : game.progression.hasDebuted ? "可继续安排直播与内容更新。" : "首场直播可获得一次出道曝光加成。"}</p><button data-view="${membershipTodo ? "schedule" : "channel"}">${membershipTodo ? "安排福利处理 →" : "查看频道数据 →"}</button></article>
      </div>
    </section>
    ${textEventPanel()}
    <details class="fold-panel" id="state-detail">
      <summary><span><b>状态与能力</b><small>疲劳、压力、动力、身体状态与六项能力</small></span><i>展开</i></summary>
      <div class="fold-content status-layout">
        <div class="status-group">${statusMeter("疲劳", game.performer.fatigue, true)}${statusMeter("压力", game.performer.stress, true)}${statusMeter("创作动力", game.performer.motivation)}${statusMeter("身体状态", game.performer.physicalCondition)}</div>
        <div class="ability-summary">${SKILLS.map((skill) => `<div><span>${SKILL_LABELS[skill]}</span><b>${game.performer.abilities[skill]}</b><small>${game.performer.experience[skill]} / 100 经验</small></div>`).join("")}</div>
      </div>
    </details>
    <details class="fold-panel">
      <summary><span><b>最近结算摘要</b><small>${lastReport ? `第 ${lastReport.weekIndex} 周 · ${lastReport.activities.length} 项内容活动` : "尚无已结算周报"}</small></span><i>展开</i></summary>
      <div class="fold-content">${lastReport ? reportSummary(lastReport, false) : `<div class="empty-state"><b>还没有历史结果</b><span>完成第一周结算后显示订阅、观看、现金与状态变化。</span></div>`}</div>
    </details>
  </section>`;
}

function pendingEventStrip() {
  const event = game.phase === "PLANNING" ? game.textEvents.find((item) => item.status === "PENDING") : null;
  if (!event) return "";
  return `<aside class="tutorial-strip event-strip"><div><span>本周有待处理事件 · 直接推进将采用默认选项</span><b>${escapeHtml(event.title)}</b></div><div><button class="secondary-action" data-view="overview">去总览处理 →</button></div></aside>`;
}

function scheduleView() {
  const preview = previewWeek(game);
  return `<section class="page-stack">
    <div class="page-heading compact-heading"><div><p class="eyebrow">第 ${game.weekIndex} 周 · 14 个时间格</p><h1>本周排期</h1><p>点击时间格选择活动。未安排的格子在结算时记为休息。</p></div><div class="heading-actions schedule-actions"><button class="secondary-action" data-repeat-plan ${game.phase !== "PLANNING" || !game.previousPlan ? "disabled" : ""} ${game.previousPlan ? "" : `title="完成第一周后可用"`}>沿用上周排期</button><button class="secondary-action" data-auto-plan ${game.phase !== "PLANNING" ? "disabled" : ""}>填入稳健示例</button><button class="primary-action" data-settle ${ui.busy || !["PLANNING", "READY_TO_COMMIT"].includes(game.phase) ? "disabled" : ""}>${ui.busy ? "正在结算…" : game.phase === "READY_TO_COMMIT" ? "提交周结算 →" : game.phase === "REPORT" ? "已结算" : "推进本周 →"}</button></div></div>
    ${pendingEventStrip()}
    <div class="schedule-summary" data-risk="${preview.risk}">
      <div><span>工作格</span><b>${preview.workSlots}<small> / 12</small></b></div><div><span>直播</span><b>${preview.liveCount}<small> 场</small></b></div><div><span>预计疲劳</span><b>${preview.projectedFatigue}<small> 峰值 ${preview.peakFatigue}</small></b></div><div><span>预计压力</span><b>${preview.projectedStress}<small> / 100</small></b></div>
      <p>${preview.overloadSlots ? `疲劳超过 ${balanceOf(game).overload.fatigueThreshold} 后，有 ${preview.overloadSlots} 个格子可能因身体不适取消（预计约 ${preview.expectedCancellations.toFixed(1)} 格）。已约定的联动、商单与福利不会取消。` : preview.risk === "low" ? "当前计划保留了恢复空间。疲劳越高恢复越快，但超过 40 会开始影响内容质量。" : preview.risk === "medium" ? "当前负荷偏高，疲劳超过 40 会降低内容质量，建议检查休息格。" : "当前负荷可能不可持续，建议减量。"}</p>
    </div>
    <div class="schedule-board" aria-label="每周十四格排期">
      ${DAY_NAMES.map((day, dayIndex) => `<section class="day-column ${dayIndex >= 5 ? "weekend" : ""}"><header><span>${day}</span><small>${dateLabel(isoAddDays(weekDateRange(game.weekIndex).start, dayIndex)).slice(5)}</small></header>${[0, 1].map((period) => slotCard(dayIndex * 2 + period, game.phase === "PLANNING" ? preview.slots[dayIndex * 2 + period] : null)).join("")}</section>`).join("")}
    </div>
    <div class="schedule-legend"><span><i class="legend-dot life"></i>生活保留</span><span><i class="legend-dot content"></i>内容活动</span><span><i class="legend-dot growth"></i>成长／经营</span><span>未安排的格子记为休息</span></div>
    <details class="fold-panel">
      <summary><span><b>本周预测区间</b><small>按内容质量随机波动的上下界估算</small></span><i>展开</i></summary>
      <div class="fold-content forecast-grid"><div><span>新增订阅</span><b>${spanLabel(preview.subscriberRange)}</b><small>曝光先转为观看，再判定订阅；未计入事件与过载取消</small></div><div><span>工作负荷</span><b>${preview.workSlots} 格</b><small>上限 12，锁定生活格不可覆盖</small></div><div><span>现金固定支出</span><b>${money(weeklyExpenses(game).total)}</b><small>${weeklyExpenses(game).operations ? `含频道运营 ${money(weeklyExpenses(game).operations)}，随订阅增长` : "生活费于周末结算"}</small></div></div>
    </details>
  </section>`;
}

function spanLabel(values, prefix = "") {
  return values[0] === values[1] ? `${prefix}${values[0]}` : `${prefix}${values[0]}—${values[1]}`;
}

function slotForecastLine(forecast) {
  if (!forecast) return "";
  const risk = forecast.overloadRisk > 0 ? `<span class="slot-risk">过载 ${Math.round(forecast.overloadRisk * 100)}%</span>` : "";
  if (!forecast.quality) return risk ? `<span class="slot-forecast">${risk}</span>` : "";
  return `<span class="slot-forecast">质量 ${spanLabel(forecast.quality.map(Math.round))} · 订阅 ${spanLabel(forecast.subscribers, "+")}${risk}</span>`;
}

function forecastFactors(forecast) {
  const factors = forecast.factors;
  return [
    `相关能力 ${factors.related}`,
    `准备 ${factors.preparation}`,
    `方向匹配 ${factors.match}`,
    factors.stateMultiplier < 1 ? `疲劳与状态 ×${factors.stateMultiplier}` : "",
    factors.launch ? "出道曝光加成" : "",
  ].filter(Boolean).join(" · ");
}

function slotCard(index, forecast = null) {
  const slot = game.plan[index];
  const action = slot.actionId ? ACTIONS[slot.actionId] : null;
  const sponsorship = slot.targetId ? game.sponsorships.find((deal) => deal.id === slot.targetId) : null;
  const membershipPromise = slot.targetId ? game.history.membershipPromises.find((promise) => promise.id === slot.targetId) : null;
  const audition = slot.targetId ? game.auditionApplications.find((application) => application.id === slot.targetId) : null;
  const transfer = slot.targetId ? game.transferCases.find((item) => item.id === slot.targetId) : null;
  const targetProject = slot.targetId ? game.projects.find((project) => project.id === slot.targetId) : null;
  const isSecondPair = slot.pairId && game.plan.findIndex((item) => item.pairId === slot.pairId) !== index;
  if (isSecondPair) return `<div class="slot-card pair-tail tone-${action.tone}" aria-label="${TIME_NAMES[index % 2]} ${action.label}"><span class="slot-time">${TIME_NAMES[index % 2]}</span><b>↳ 继续 ${action.shortLabel}</b></div>`;
  return `<article class="slot-card ${action ? `filled tone-${action.tone}` : "empty"} ${slot.locked ? "locked" : ""} ${slot.flexibleLife ? "flexible-life" : ""}">
    <span class="slot-time">${TIME_NAMES[index % 2]}</span>
    ${action ? `<div class="slot-copy"><b>${action.shortLabel}</b>${slotForecastLine(forecast)}<small>${sponsorship ? `${escapeHtml(sponsorship.brandName)} · 待交付商单` : membershipPromise ? `会员福利包 · 截止 ${membershipPromise.dueDate}` : audition ? `${agencyDisplayLabel(audition.agencyId)} · ${AUDITION_STATUS_LABELS[audition.status] || audition.status}` : transfer ? `${routeDisplayLabel(transfer.targetRouteId)} · ${transfer.identityPreparation.completedUnits}/${transfer.identityPreparation.requiredUnits} 格` : targetProject?.type === "LONG_TERM" ? `${escapeHtml(targetProject.title)} · ${targetProject.workCompleted}/${targetProject.workRequired} 格` : targetProject ? `${escapeHtml(targetProject.title)} · ${targetProject.designWorkCompleted}/${targetProject.designWorkRequired} 格` : slot.locked ? "锁定生活时间" : slot.flexibleLife ? "可确认后转为工作" : action.slots === 2 ? "占用同日两格" : action.label}</small></div>` : `<div class="slot-copy"><b>未安排</b><small>结算时自动休息</small></div>`}
    ${slot.locked || isSecondPair ? "" : `<div class="slot-actions"><button data-pick-slot="${index}" aria-label="${action ? `更改${action.label}` : `安排${DAY_NAMES[Math.floor(index / 2)]}${TIME_NAMES[index % 2]}`}" ${game.phase !== "PLANNING" ? `disabled title="${game.phase === "CAREER_ENDED" ? "生涯已归档，排期只读" : "当前周已进入结算或周报阶段，排期只读"}"` : ""}>${action ? "更改" : "+ 安排"}</button>${action && !slot.flexibleLife ? `<button data-remove-slot="${index}" aria-label="移除${action.label}" ${game.phase !== "PLANNING" ? "disabled" : ""}>×</button>` : ""}</div>`}
  </article>`;
}

function channelView() {
  const contents = [...game.history.contents].reverse();
  const visibleContents = contents.slice(0, ui.contentLimit);
  const commissions = [...game.propagationCommissions].reverse();
  const points = [0, ...game.history.weeklyReports.map((report) => report.subscribers)];
  const max = Math.max(1, ...points);
  const polyline = points.map((value, index) => `${points.length === 1 ? 0 : (index / (points.length - 1)) * 100},${40 - (value / max) * 34}`).join(" ");
  const eligibility = fanFundingEligibility(game.channel);
  const ads = adsEligibility(game.channel);
  const fundingStatus = game.channel.fanFundingStatus;
  const eligibilityTitle = fundingStatus === "APPROVED" ? "SC 与会员已开放" : fundingStatus === "UNDER_REVIEW" ? `预计 ${game.channel.fanFundingReviewDueDate} 完成审核` : fundingStatus === "ELIGIBLE_TO_APPLY" ? "数字门槛已满足" : "数字门槛尚未满足";
  return `<section class="page-stack">
    <div class="page-heading compact-heading"><div><p class="eyebrow">频道 · ${escapeHtml(game.channel.id)}</p><h1>${escapeHtml(game.character.name)} 的频道</h1><p>活跃观众与独立观众均为模型估计值。</p></div><div class="eligibility-badge status-${fundingStatus.toLowerCase()}"><span>粉丝赞助</span><b>${PLATFORM_STATUS_LABELS[fundingStatus] || fundingStatus}</b></div></div>
    <div class="channel-layout">
      <article class="trajectory-card"><div class="section-heading"><div><span class="section-kicker">订阅轨迹</span><h2>${compact(game.channel.subscribers)}</h2></div><span class="section-side">精确账面数</span></div><svg viewBox="0 0 100 44" role="img" aria-label="订阅历史折线图" preserveAspectRatio="none"><path d="M0 40 H100" class="chart-axis"/><polyline points="${polyline}" class="chart-line" vector-effect="non-scaling-stroke"/></svg><div class="chart-footer"><span>开局</span><span>第 ${game.weekIndex} 周</span></div></article>
      <article class="eligibility-card"><span class="section-kicker">收益资格进度</span><h2>${eligibilityTitle}</h2><div class="eligibility-rows"><div class="${eligibility.checks.subscribers ? "passed" : ""}"><span>订阅</span><b>${game.channel.subscribers.toLocaleString()} / 500</b></div><div class="${eligibility.checks.publicUploads ? "passed" : ""}"><span>90 日有效公开上传</span><b>${game.channel.validPublicUploads90d} / 3</b></div><div class="${eligibility.checks.watchOrShorts ? "passed" : ""}"><span>12 个月有效观看小时</span><b>${Math.floor(game.channel.validWatchMinutes12m / 60).toLocaleString()} / 3,000</b></div></div>${fundingStatus === "ELIGIBLE_TO_APPLY" ? `<button class="primary-action eligibility-action" data-apply-fan-funding>阅读条款并申请审核</button>` : ""}<p>${fundingStatus === "APPROVED" ? "批准后的公开直播可产生 SC；短视频不产生 SC。" : fundingStatus === "UNDER_REVIEW" ? "审核期间不产生 SC 与会员收入。" : "满足门槛后需提交申请，审核期 7 个游戏日。"}</p></article>
    </div>
    <details class="fold-panel"><summary><span><b>广告收益资格</b><small>${PLATFORM_STATUS_LABELS[game.channel.adsStatus] || game.channel.adsStatus} · 与粉丝赞助分别审核</small></span><i>展开</i></summary><div class="fold-content ad-eligibility"><div class="eligibility-rows"><div class="${ads.checks.subscribers ? "passed" : ""}"><span>订阅</span><b>${game.channel.subscribers.toLocaleString()} / 1,000</b></div><div class="${ads.checks.watchOrShorts ? "passed" : ""}"><span>12 个月有效观看小时</span><b>${Math.floor(game.channel.validWatchMinutes12m / 60).toLocaleString()} / 4,000</b></div></div>${game.channel.adsStatus === "ELIGIBLE_TO_APPLY" ? `<button class="primary-action eligibility-action" data-apply-ads>申请广告收益审核</button>` : ""}<p>${game.channel.adsStatus === "APPROVED" ? "长视频 RPM 200 日元，Shorts 5 日元（均为平台分成后金额）。" : game.channel.adsStatus === "UNDER_REVIEW" ? `预计 ${game.channel.adsReviewDueDate} 完成审核；审核通过前的播放不计收益。` : "需达到 1,000 订阅，并满足长视频观看时长或 Shorts 播放条件。"}</p></div></details>
    <details class="fold-panel" open>
      <summary><span><b>内容记录</b><small>${contents.length ? `${contents.length} 条已发布内容` : "尚无公开内容"}</small></span><i>收起</i></summary>
      <div class="fold-content content-list">${contents.length ? `${visibleContents.map((content) => `<article><div><span class="content-type">${CONTENT_TYPE_LABELS[content.type] || content.type} · ${content.deletedAt ? "已删除" : VISIBILITY_LABELS[content.visibility] || content.visibility}</span><b>${ACTIONS[content.actionId].label}</b><small>${content.publishedAt} · 质量 ${content.quality}</small>${!content.deletedAt ? `<details class="micro-fold content-controls"><summary data-content-control="${content.id}">公开状态与资格</summary><div><button data-content-visibility="PUBLIC" data-content-id="${content.id}" ${content.visibility === "PUBLIC" ? "disabled" : ""}>公开</button><button data-content-visibility="UNLISTED" data-content-id="${content.id}" ${content.visibility === "UNLISTED" ? "disabled" : ""}>不公开列出</button><button data-content-visibility="PRIVATE" data-content-id="${content.id}" ${content.visibility === "PRIVATE" ? "disabled" : ""}>私密</button><button class="danger-action" data-content-visibility="DELETED" data-content-id="${content.id}">删除</button></div><p>更改后重新计算收益资格；已产生的收入不变。</p></details>` : ""}</div><div class="content-metrics"><span><b>约 ${compact(content.uniqueEstimate)}</b><small>独立观众估计</small></span><span><b>${compact(content.watchMinutes)}</b><small>观看分钟</small></span><span><b>${content.averageConcurrent == null ? "—" : compact(content.averageConcurrent)}</b><small>平均同接</small></span><span><b>${signed(content.subscriberDelta)}</b><small>订阅</small></span></div></article>`).join("")}${contents.length > visibleContents.length ? `<button class="secondary-action history-more" data-load-more-content>再显示 ${Math.min(40, contents.length - visibleContents.length)} 条</button>` : ""}` : `<div class="empty-state"><b>尚无公开内容</b><span>去排期页安排直播、短视频或专题视频。</span><button data-view="schedule">安排内容 →</button></div>`}</div>
    </details>
    <details class="fold-panel"><summary><span><b>切片与翻译传播</b><small>${commissions.filter((item) => ["IN_PROGRESS", "READY"].includes(item.status)).length ? `${commissions.filter((item) => ["IN_PROGRESS", "READY"].includes(item.status)).length} 项处理中` : "付费委托 · 独立许可"}</small></span><i>展开</i></summary><div class="fold-content distribution-panel"><p class="plain-note">切片与字幕翻译需单独委托并授权；公开发布不代表允许转载。</p>${contents.length ? `<div class="distribution-sources">${contents.slice(0, 6).map((content) => `<article><div><span>${content.publishedAt} · ${ACTIONS[content.actionId].label}</span><b>约 ${compact(content.uniqueEstimate)} 独立观众</b><small>${(content.licenseTags || ["PLATFORM_PUBLIC_VIEWING"]).join(" · ")}</small></div><div><button class="secondary-action" data-create-propagation="CLIP_EDIT" data-source-content="${content.id}">公开切片 · 15,000</button><button class="secondary-action" data-create-propagation="SUBTITLE_TRANSLATION" data-source-content="${content.id}" data-target-language="${game.performer.primaryLanguage === "jp" ? "en" : "jp"}">字幕翻译 · 22,000</button></div></article>`).join("")}</div>` : `<div class="empty-state"><b>需要一条公开内容</b><span>委托需指定一条已发布内容。</span></div>`}${commissions.length ? `<details class="micro-fold"><summary>查看委托与许可记录</summary><div class="invitation-history">${commissions.map((item) => `<article><span>${item.orderedAt} — ${item.dueDate}</span><b>${item.serviceType === "CLIP_EDIT" ? "公开切片" : "字幕翻译"} · ${item.status}</b><small>${item.licenseTag} · ${item.licenseScope} · ${money(item.costJpy)}</small></article>`).join("")}</div></details>` : ""}</div></details>
    <details class="fold-panel"><summary><span><b>24 个观众分群</b><small>2 种语言 × 4 种偏好 × 3 种消费档位</small></span><i>展开</i></summary><div class="fold-content"><div class="audience-table" role="table"><div class="audience-row header" role="row"><span>群体</span><span>潜在人口</span><span>已知</span><span>订阅</span><span>忠诚</span></div>${game.audienceSegments.map((segment) => `<div class="audience-row" role="row"><span>${segment.language.toUpperCase()} · ${DIRECTIONS[segment.preference]} · ${segment.spendTier === "none" ? "非主动付费" : segment.spendTier === "light" ? "轻支持" : "高支持"}</span><span>${compact(segment.marketPopulation)}</span><span>约 ${compact(segment.knownViewers)}</span><span>${compact(segment.subscribers)}</span><span>${Math.round(segment.loyalty)}</span></div>`).join("")}</div></div></details>
  </section>`;
}

function financeView() {
  const activeMembers = game.history.membershipBatches.filter((batch) => batch.status === "ACTIVE").reduce((sum, batch) => sum + batch.count, 0);
  const allocatedBudget = game.audienceBudgets.reduce((sum, budget) => sum + BigInt(budget.allocatedJpy || 0), 0n);
  const remainingBudget = game.audienceBudgets.reduce((sum, budget) => sum + BigInt(budget.remainingJpy || 0), 0n);
  const sponsorMetrics = sponsorCandidateMetrics(game, weekDateRange(game.weekIndex).start);
  const sponsorships = [...game.sponsorships].reverse();
  const actionableSponsors = sponsorships.filter((deal) => ["OPEN", "ACCEPTED"].includes(deal.status)).length;
  const membershipPromises = [...game.history.membershipPromises].reverse();
  const membershipTodoCount = membershipPromises.filter((promise) => ["DUE", "OVERDUE"].includes(promise.status)).length;
  const refundPayable = BigInt(game.liabilities.refundPayable || 0);
  const merchRefundPayable = game.projects.reduce((sum, project) => sum + BigInt(project.refundPayableJpy || 0), 0n);
  const platformRefundPayable = refundPayable > merchRefundPayable ? refundPayable - merchRefundPayable : 0n;
  const refundableNow = platformRefundPayable < BigInt(game.cash.free) ? platformRefundPayable : BigInt(game.cash.free);
  const companyMerchProjects = game.projects.filter((project) => project.type === "MERCH" && project.fundingModel === "COMPANY_LED");
  const companyMerchGmv = companyMerchProjects.reduce((sum, project) => sum + BigInt(project.grossOrdersJpy || 0), 0n);
  const companyMerchProfit = companyMerchProjects.filter((project) => project.projectProfitJpy != null).reduce((sum, project) => sum + BigInt(project.projectProfitJpy), 0n);
  const openRoyalty = game.history.receivables.filter((item) => item.type === "ROYALTY" && item.status === "OPEN").reduce((sum, item) => sum + BigInt(item.amountJpy) - BigInt(item.receivedJpy || 0) - BigInt(item.adjustedJpy || 0), 0n);
  const platformTransactions = [...game.history.platformTransactions].reverse();
  const filteredTransactions = platformTransactions.filter((transaction) => ui.financeFilter === "ALL" || transaction.type === ui.financeFilter);
  const visibleTransactions = filteredTransactions.slice(0, ui.financeTransactionLimit);
  const journalEntries = [...game.history.journalEntries].reverse();
  const visibleJournalEntries = journalEntries.slice(0, ui.financeJournalLimit);
  const financeFilterLabels = { ALL: "全部", SC: "SC", MEMBERSHIP: "会员", ADS: "广告" };
  return `<section class="page-stack"><div class="page-heading compact-heading"><div><p class="eyebrow">个人账本</p><h1>财务</h1><p>按流水、平台分成后收入、主播应得、应收与到账分别列示。</p></div></div>
    <div class="finance-buckets">${metricCard("自由现金", money(game.cash.free), "可用于一般支出", "cash")}${metricCard("履约受限资金", money(game.cash.restricted), "只能用于对应项目", "ink")}${metricCard("应收款", money(game.cash.receivable), "已归属、尚未到账", "ink")}${metricCard("应付款", money(game.cash.payable), "已确认、尚未支付", "ink")}</div>
    <details class="fold-panel" open><summary><span><b>SC 收入瀑布</b><small>当前状态：${game.channel.scFeatureEnabled ? "已开通" : "未开通"}</small></span><i>收起</i></summary><div class="fold-content waterfall"><div><span>观众付款累计发生额</span><b>${money(game.finance.scGrossLifetime)}</b></div><i>− 退款 ${money(game.finance.scRefundsLifetime)}</i><div><span>平台后频道归属</span><b>${money(game.finance.scChannelNet)}</b></div><i>× 发生时合同份额</i><div><span>主播归属收益</span><b>${money(game.finance.scCreatorEarned)}</b></div><i>到账以应收账期为准</i><div><span>主播累计到账</span><b>${money(game.finance.scCreatorReceived)}</b></div><p>${game.channel.scFeatureEnabled ? "已开通但无收入时显示 0 日元。" : "未开通时不生成 SC；达到订阅数本身也不会自动开启。"}</p></div></details>
    <details class="fold-panel"><summary><span><b>会员收入、福利与共享预算</b><small>${membershipTodoCount ? `${membershipTodoCount} 项福利待处理` : `${activeMembers} 名有效会员`} · ${game.membershipProgram.chargesPaused ? "新收费已暂停" : "收费中"}</small></span><i>展开</i></summary><div class="fold-content membership-panel">
      <div class="budget-summary"><div><span>会员累计付款</span><b>${money(game.finance.membershipGrossLifetime)}</b></div><div><span>会员主播归属</span><b>${money(game.finance.membershipCreatorEarned)}</b></div><div><span>当前消费周期已分配</span><b>${money(allocatedBudget)}</b></div><div><span>当前消费周期剩余</span><b>${money(remainingBudget)}</b></div><p>SC 与会员共用每个观众群在当前消费周期的预算；非付费观众群预算为 0。</p></div>
      <section class="membership-policy"><div><span>未来周期福利包</span><b>${game.membershipProgram.promisePolicy === "STANDARD" ? "标准 · 2 项" : "轻量 · 1 项"}</b><small>调整不会改写本期既有承诺</small></div><div class="policy-actions"><button class="secondary-action ${game.membershipProgram.promisePolicy === "STANDARD" ? "is-selected" : ""}" data-membership-policy="STANDARD" ${game.phase !== "PLANNING" || game.membershipProgram.promisePolicy === "STANDARD" ? "disabled" : ""}>标准包</button><button class="secondary-action ${game.membershipProgram.promisePolicy === "LIGHT" ? "is-selected" : ""}" data-membership-policy="LIGHT" ${game.phase !== "PLANNING" || game.membershipProgram.promisePolicy === "LIGHT" ? "disabled" : ""}>轻量包</button><button class="secondary-action" data-toggle-membership-charges ${game.phase !== "PLANNING" || !game.channel.membershipFeatureEnabled ? "disabled" : ""}>${game.membershipProgram.chargesPaused ? "恢复新收费" : "暂停新收费"}</button></div></section>
      <div class="promise-list">${membershipPromises.length ? membershipPromises.map((promise) => `<article class="promise-card status-${promise.status.toLowerCase()}"><div><span>${promise.status === "OVERDUE" ? "已逾期" : promise.status === "FULFILLED" ? "已兑现" : "本期待办"}</span><b>${promise.benefits.join("＋")}</b><small>${promise.startsAt} — ${promise.dueDate}</small></div><div class="promise-progress"><span>${promise.fulfilledUnits} / ${promise.requiredUnits}</span><i><b style="width:${Math.min(100, promise.requiredUnits ? promise.fulfilledUnits / promise.requiredUnits * 100 : 100)}%"></b></i></div>${["DUE", "OVERDUE"].includes(promise.status) ? `<button class="secondary-action" data-view="schedule">安排兑现 →</button>` : ""}</article>`).join("") : `<div class="sponsor-empty"><b>尚无会员福利承诺</b><p>产生第一笔会员收费后，系统为该消费周期生成一份福利承诺。</p></div>`}</div>
      <p class="sponsor-footnote">暂停收费后不再接受新入会与续费，已收款周期的福利仍需兑现；福利逾期会影响续费率。</p>
    </div></details>
    <details class="fold-panel"><summary><span><b>广告收入</b><small>${game.channel.adsFeatureEnabled ? "已开通" : "未开通"} · 平台分成后</small></span><i>展开</i></summary><div class="fold-content budget-summary"><div><span>平台后广告收入</span><b>${money(game.finance.adsChannelNet)}</b></div><div><span>主播归属</span><b>${money(game.finance.adsCreatorEarned)}</b></div><div><span>主播累计到账</span><b>${money(game.finance.adsCreatorReceived)}</b></div><div><span>当前状态</span><b>${PLATFORM_STATUS_LABELS[game.channel.adsStatus] || game.channel.adsStatus}</b></div><p>RPM 已经是平台分成后收入，仅继续应用发生时的个人／企业合同份额。</p></div></details>
    <details class="fold-panel"><summary><span><b>商单候选与交付</b><small>${actionableSponsors ? `${actionableSponsors} 项需要处理` : sponsorships.length ? `${sponsorships.length} 项历史合作` : "暂无可接受报价"}</small></span><i>展开</i></summary><div class="fold-content sponsor-panel">
      <div class="sponsor-ledger"><div><span>合同总额（分析）</span><b>${money(game.finance.sponsorGross)}</b></div><div><span>主播已归属</span><b>${money(game.finance.sponsorCreatorEarned)}</b></div><div><span>主播累计到账</span><b>${money(game.finance.sponsorCreatorReceived)}</b></div><div><span>客户预付款负债</span><b>${money(game.liabilities.deferredCustomerFunds)}</b></div></div>
      ${sponsorships.length ? `<div class="sponsor-list">${sponsorships.map((deal) => `<article class="sponsor-card status-${deal.status.toLowerCase()}"><header><div><span>${escapeHtml(deal.brandName)}</span><b>${money(deal.quoteJpy)}</b></div><em>${SPONSOR_STATUS_LABELS[deal.status] || deal.status}</em></header><dl><div><dt>交付</dt><dd>${deal.deliverables} 条公开内容</dd></div><div><dt>${deal.status === "OPEN" ? "报价有效期" : "交付期限"}</dt><dd>${deal.status === "OPEN" ? deal.expiresAt : deal.dueDate}</dd></div><div><dt>用途许可</dt><dd>${escapeHtml(deal.usageLicense)}</dd></div>${deal.reviewNodes?.length ? `<div><dt>审稿节点</dt><dd>${deal.reviewNodes.map((review) => `${review.dueDate} · ${review.status === "SCHEDULED" ? "待审稿" : "已随交付确认"}`).join("；")}</dd></div>` : ""}</dl>${deal.status === "OPEN" && game.phase === "PLANNING" ? `<button class="primary-action sponsor-action" data-accept-sponsor="${escapeHtml(deal.id)}">查看条款并接受</button>` : deal.status === "ACCEPTED" ? `<button class="secondary-action sponsor-action" data-view="schedule">安排商单交付 →</button>` : ""}<details class="micro-fold"><summary>许可与取消条款</summary><p>${escapeHtml(deal.cancellationTerms?.beforeDraft || "按合作模板处理")}；${escapeHtml(deal.cancellationTerms?.afterReview || "审稿后按已发生成本处理")}。</p></details></article>`).join("")}</div>` : `<div class="sponsor-empty"><b>${sponsorMetrics.eligible ? "条件已满足，报价将在周末批次生成" : "继续积累稳定观看与工作信誉"}</b><p>近 28 日平均单条观看约 ${compact(sponsorMetrics.averageViews)} / 800 · 工作信誉 ${sponsorMetrics.workReputation} / 50。新报价在每周结算时生成。</p></div>`}
      <p class="sponsor-footnote">个人势预付 30% 在交付前属于履约受限资金；企业主导商单只把主播应得份额计入个人账，合同总额不会进入个人现金。</p>
    </div></details>
    ${companyMerchProjects.length ? `<details class="fold-panel"><summary><span><b>公司商品项目版税</b><small>${money(game.finance.royaltyCreatorEarned)} 已归属 · ${money(openRoyalty)} 待到账</small></span><i>展开</i></summary><div class="fold-content waterfall"><div><span>公司项目订单额（仅分析）</span><b>${money(companyMerchGmv)}</b></div><i>扣除公司承担的明确成本</i><div><span>公司项目累计损益</span><b>${money(companyMerchProfit)}</b></div><i>× 正利润 30%；亏损按 0 计算</i><div><span>主播已归属版税</span><b>${money(game.finance.royaltyCreatorEarned)}</b></div><i>结项后形成 42 日应收</i><div><span>主播累计到账</span><b>${money(game.finance.royaltyCreatorReceived)}</b></div><p>公司订单额与项目损益记在公司子账，不计入个人收入或现金；项目亏损不由个人承担。</p></div></details>` : ""}
    <details class="fold-panel" ${ui.financeTransactionsOpen ? "open" : ""}><summary><span><b>平台交易与应收</b><small>${game.history.platformTransactions.length} 笔交易 · ${game.history.receivables.filter((item) => item.status === "OPEN").length} 笔待到账</small></span><i>${ui.financeTransactionsOpen ? "收起" : "展开"}</i></summary><div class="fold-content"><div class="filter-bar" role="group" aria-label="平台交易类型筛选">${Object.entries(financeFilterLabels).map(([id, label]) => `<button class="secondary-action ${ui.financeFilter === id ? "is-selected" : ""}" data-finance-filter="${id}" aria-pressed="${ui.financeFilter === id}">${label}</button>`).join("")}</div><div class="transaction-list">${platformTransactions.length ? (filteredTransactions.length ? `${visibleTransactions.map((transaction) => `<article><div><span>${transaction.type}</span><b>${money(transaction.grossJpy)}</b><small>${transaction.date} · 来源 ${transaction.sourceId}</small><details class="micro-fold"><summary>查看发生时合同</summary><p>${transaction.contractId ? `合同 ${escapeHtml(transaction.contractId)} · 主播份额 ${Number(transaction.creatorShareBps || 10000) / 100}%` : "个人势交易 · 无企业合同 · 主播份额 100%"}</p></details></div><div><span>平台后 <b>${money(transaction.channelNetJpy)}</b></span><span>主播归属 <b>${money(transaction.creatorEarnedJpy)}</b></span><span>预计到账 <b>${transaction.dueDate}</b></span></div></article>`).join("")}${filteredTransactions.length > visibleTransactions.length ? `<button class="secondary-action history-more" data-load-more-transactions>再显示 ${Math.min(40, filteredTransactions.length - visibleTransactions.length)} 笔</button>` : ""}` : `<div class="empty-state"><b>该类型暂无交易</b><span>切换筛选条件可查看其他类型。</span></div>`) : `<div class="empty-state"><b>尚无平台交易</b><span>收益资格批准后的合格直播才会生成 SC 与会员交易。</span></div>`}</div></div></details>
    <details class="fold-panel"><summary><span><b>退款与退款应付款</b><small>${refundPayable > 0n ? `待处理 ${money(refundPayable)}` : `${game.history.refundTransactions.length + game.history.merchPostDeliveryRefunds.length} 笔退款记录`}</small></span><i>展开</i></summary><div class="fold-content refund-panel"><div class="refund-callout ${refundPayable > 0n ? "has-payable" : ""}"><div><span>平台／SC 退款应付款</span><b>${money(platformRefundPayable)}</b><small>商品项目应付 ${money(merchRefundPayable)}，请在对应项目内清偿</small></div>${platformRefundPayable > 0n ? `<button class="primary-action" data-pay-refund-payable="${refundableNow}" ${refundableNow === 0n || game.phase !== "PLANNING" ? "disabled" : ""}>${refundableNow > 0n ? `用自由现金支付 ${money(refundableNow)}` : "自由现金不足，暂不能支付"}</button>` : ""}</div><div class="refund-history">${game.history.refundTransactions.length || game.history.merchPostDeliveryRefunds.length ? `${[...game.history.merchPostDeliveryRefunds].reverse().map((refund) => `<article><div><b>${refund.date}</b><span>商品交付后退款 ${refund.refundOrderDelta} 件 · ${money(refund.refundJpy)}</span></div><div><span>恢复库存 ${refund.restockOrderDelta} 件</span><span>恢复成本 ${money(refund.restockValueJpy)}</span><span>${refund.playerImpactJpy === "0" ? "公司项目子账" : "个人项目账"}</span></div></article>`).join("")}${[...game.history.refundTransactions].reverse().map((refund) => `<article><div><b>${refund.date}</b><span>累计退款 ${money(refund.cumulativeRefundJpy)}</span></div><div><span>冲减应收 ${money(refund.receivableReductionJpy)}</span><span>现金退回 ${money(refund.cashPaidJpy)}</span><span>新增应付 ${money(refund.payableCreatedJpy)}</span></div></article>`).join("")}` : `<div class="sponsor-empty"><b>尚无退款记录</b><p>原交易记录保留；多次部分退款按累计净额计算。</p></div>`}</div><p class="sponsor-footnote">退款应付款只能使用自由现金清偿，不能动用商单或项目履约受限资金；公司项目退款留在公司子账。</p></div></details>
    <details class="fold-panel"><summary><span><b>不可变分录</b><small>${game.history.journalEntries.length} 笔 · 每批最多 40 笔</small></span><i>展开</i></summary><div class="fold-content ledger-list">${journalEntries.length ? `${visibleJournalEntries.map((entry) => `<article><div><b>${entry.date}</b><small>${entry.sourceId}</small></div><div>${entry.lines.map((line) => `<span>${line.account}<b>${line.debit !== "0" ? `借 ${money(line.debit)}` : `贷 ${money(line.credit)}`}</b></span>`).join("")}</div></article>`).join("")}${journalEntries.length > visibleJournalEntries.length ? `<button class="secondary-action history-more" data-load-more-journals>再显示 ${Math.min(40, journalEntries.length - visibleJournalEntries.length)} 笔</button>` : ""}` : `<div class="empty-state"><b>尚无结算分录</b><span>第一周结束时将写入生活费、工具费或兼职收入。</span></div>`}</div></details>
  </section>`;
}

function merchProjectActions(project, today) {
  if (!project) return "";
  const button = (type, label, disabled = false, option = "") => `<button class="${type === "CONFIRM_MERCH_PROJECT" || type === "OPEN_MERCH_SALES" ? "primary-action" : "secondary-action"}" data-merch-command="${type}" data-project-id="${escapeHtml(project.id)}" ${option ? `data-option="${option}"` : ""} ${disabled || game.phase !== "PLANNING" ? "disabled" : ""}>${label}</button>`;
  if (project.status === "DRAFT") return button("CONFIRM_MERCH_PROJECT", isCompanyMerch(project) ? "确认公司立项" : `确认并支付 ${money(project.fixedDesignSampleCostJpy)}`);
  if (project.status === "DESIGNING") return `<button class="primary-action" data-view="schedule">安排项目制作 →</button>`;
  if (project.status === "SAMPLING") return button("PROCESS_MERCH_DATE", compareDates(today, project.samplingDueDate) >= 0 ? (project.salesMode === "READY_STOCK" ? "开始生产首批现货" : "确认打样完成") : `等待至 ${project.samplingDueDate}`, compareDates(today, project.samplingDueDate) < 0);
  if (project.status === "READY_TO_SELL") return button("OPEN_MERCH_SALES", "开启 14 日销售");
  if (project.status === "ON_SALE") {
    const closeLabel = project.salesMode === "DIGITAL" ? "关闭销售并准备数字交付" : project.salesMode === "READY_STOCK" ? "关闭销售并准备发货" : "关闭销售并核对起订量";
    return `${button("PROMOTE_MERCH_PROJECT", "宣传本周商品", project.promotionDates?.includes(today))}${button("CLOSE_MERCH_SALES", compareDates(today, project.salesEndDate) >= 0 ? closeLabel : `销售至 ${project.salesEndDate}`, compareDates(today, project.salesEndDate) < 0)}`;
  }
  if (project.status === "SALES_CLOSED" && project.decision?.type === "UNDER_MOQ") return `${button("RESOLVE_MERCH_MOQ", "补足至 50 件", false, "TOP_UP")}${button("RESOLVE_MERCH_MOQ", "协商小批量生产", false, "NEGOTIATE")}${button("RESOLVE_MERCH_MOQ", "取消并生成退款处理", false, "REFUND")}`;
  if (project.status === "SALES_CLOSED") return button("BEGIN_MERCH_PRODUCTION", "按订单量开始生产");
  if (project.status === "PRODUCING") return button("PROCESS_MERCH_DATE", compareDates(today, project.productionDueDate) >= 0 ? (project.salesMode === "READY_STOCK" ? "确认首批现货入库" : "确认工厂交货") : `${project.salesMode === "READY_STOCK" ? "备货" : "生产"}至 ${project.productionDueDate}`, compareDates(today, project.productionDueDate) < 0);
  if (project.status === "READY_TO_SHIP") return button("START_MERCH_FULFILLMENT", "开始 7 日发货处理");
  if (project.status === "FULFILLING") return button("PROCESS_MERCH_DATE", compareDates(today, project.fulfillmentDueDate) >= 0 ? (project.productKind === "DIGITAL" ? "完成数字交付" : "确认订单交付") : `发货处理至 ${project.fulfillmentDueDate}`, compareDates(today, project.fulfillmentDueDate) < 0);
  if (project.status === "AFTER_SALES" && BigInt(project.refundPayableJpy || 0) > 0n) return button("PAY_MERCH_REFUND_PAYABLE", `支付退款应付款 ${money(project.refundPayableJpy)}`);
  if (project.status === "AFTER_SALES") return button("SETTLE_MERCH_PROJECT", compareDates(today, project.afterSalesEndDate) >= 0 ? (isCompanyMerch(project) ? "结束售后并计算版税" : "结束售后并释放剩余资金") : `售后至 ${project.afterSalesEndDate}`, compareDates(today, project.afterSalesEndDate) < 0);
  if (project.status === "CANCELLED" && BigInt(project.refundPayableJpy || 0) > 0n) return button("PAY_MERCH_REFUND_PAYABLE", `支付退款应付款 ${money(project.refundPayableJpy)}`);
  return "";
}

function isCompanyMerch(project) {
  return project?.fundingModel === "COMPANY_LED";
}

function merchStatusLabel(project) {
  if (project?.salesMode === "READY_STOCK" && project.status === "SAMPLING") return "备货准备";
  if (project?.salesMode === "READY_STOCK" && project.status === "PRODUCING") return "现货生产中";
  if (project?.productKind === "DIGITAL" && project.status === "FULFILLING") return "数字交付";
  if (project?.status === "ON_SALE") return project.salesMode === "PRESALE" ? "预售中" : "销售中";
  return MERCH_STATUS_LABELS[project?.status] || project?.status;
}

function compareDates(a, b) {
  return String(a).localeCompare(String(b));
}

function merchProjectPanel() {
  const merchProjects = game.projects.filter((item) => item.type === "MERCH");
  const latestProject = merchProjects.at(-1);
  const project = [...merchProjects].reverse().find((item) => !["SETTLED", "CANCELLED"].includes(item.status));
  const today = weekDateRange(game.weekIndex).start;
  if (!project) {
    const companyLed = game.routeId !== "indie";
    const templateCards = MERCH_TEMPLATE_LIST.map((template) => {
      const note = template.salesMode === "PRESALE" ? `单价 ${template.unitPriceJpy.toLocaleString("zh-CN")} · 固定成本 ${template.fixedDesignSampleCostJpy.toLocaleString("zh-CN")} · 50 件起订` : template.salesMode === "READY_STOCK" ? `先生产 ${template.initialStockQuantity} 件 · 占用资金 ${(template.initialStockQuantity * template.unitProductionCostJpy).toLocaleString("zh-CN")} · 售出扣库存` : `固定制作成本 ${template.fixedDesignSampleCostJpy.toLocaleString("zh-CN")} · 无实体库存 · 跳过物流`;
      return `<article class="merch-template"><div><span>${MERCH_MODE_LABELS[template.salesMode]} · ${companyLed ? "公司主导" : "玩家自营"}</span><b>${escapeHtml(template.name)}</b><small>${note}</small></div><button class="primary-action" data-merch-command="CREATE_MERCH_PROJECT" data-template-id="${template.id}" data-funding-model="${companyLed ? "COMPANY_LED" : "SELF_RUN"}" ${game.phase !== "PLANNING" ? "disabled" : ""}>创建草案</button></article>`;
    }).join("");
    const recentSummary = latestProject ? `${escapeHtml(latestProject.title)} · ${merchStatusLabel(latestProject)}` : "尚无历史项目";
    const recentDetail = latestProject ? `<details class="micro-fold"><summary>最近项目 · ${recentSummary}</summary><div class="merch-detail"><dl><div><dt>订单额</dt><dd>${money(latestProject.grossOrdersJpy)}</dd></div><div><dt>项目损益</dt><dd>${latestProject.projectProfitJpy == null ? "未结算" : money(latestProject.projectProfitJpy)}</dd></div><div><dt>剩余库存资产</dt><dd>${money(latestProject.inventoryValueJpy)}</dd></div><div><dt>退款应付款</dt><dd>${money(latestProject.refundPayableJpy || 0)}</dd></div></dl>${BigInt(latestProject.refundPayableJpy || 0) > 0n ? `<button class="primary-action" data-merch-command="PAY_MERCH_REFUND_PAYABLE" data-project-id="${escapeHtml(latestProject.id)}">支付退款应付款 ${money(latestProject.refundPayableJpy)}</button>` : ""}</div></details>` : "";
    return `<details class="fold-panel"><summary><span><b>商品项目</b><small>${latestProject ? `可创建新项目 · 最近：${recentSummary}` : "3 种销售模式"}</small></span><i>展开</i></summary><div class="fold-content merch-panel"><div class="merch-template-list">${templateCards}</div><p class="plain-note">${companyLed ? "公司承担列明成本并控制商店与履约；玩家只取得正项目利润的 30% 版税，亏损不形成个人债务。" : "三种模式共用同一观众消费预算；数字商品没有库存但仍有制作成本，少量现货必须先付款入库。"}</p>${recentDetail}</div></details>`;
  }
  const active = !["SETTLED", "CANCELLED"].includes(project.status);
  const urgent = project.decision?.type === "UNDER_MOQ";
  const companyLed = isCompanyMerch(project);
  const routeLabel = routeDisplayLabel(game.routeId);
  const projectRestricted = companyLed ? project.companyLedger?.restrictedCashJpy || "0" : project.restrictedBalanceJpy;
  const projectDeferred = companyLed ? project.companyLedger?.deferredCustomerFundsJpy || "0" : project.deferredCustomerFundsJpy;
  const netDeliveredRevenue = BigInt(project.fulfilledRevenueJpy || 0) - BigInt(project.postDeliveryRefundJpy || 0);
  const statusLabel = merchStatusLabel(project);
  const modeLabel = MERCH_MODE_LABELS[project.salesMode] || project.salesMode;
  const lifecycleText = project.salesMode === "DIGITAL" ? "草案 → 设计／录制 → 开售 → 数字交付 → 售后 → 结项；没有打样、生产、库存或发货阶段。" : project.salesMode === "READY_STOCK" ? "草案 → 设计 → 备货准备 → 先付款生产 → 入库 → 开售 → 发货 → 售后 → 结项；订单不能超过可售库存。" : "草案 → 设计 → 打样 → 预售 → 按订单生产 → 发货 → 售后 → 结项；工作量与等待时间不能互相替代。";
  const progressSummary = project.status === "DESIGNING" ? ` · 设计 ${project.designWorkCompleted}/${project.designWorkRequired} 格` : ` · ${project.orderCount} 件订单`;
  return `<details class="fold-panel merch-fold" ${urgent ? "open" : ""}><summary><span><b>商品项目 · ${escapeHtml(project.title)}</b><small>${statusLabel}${urgent ? " · 需要起订量决策" : progressSummary}</small></span><i>${urgent ? "收起" : "展开"}</i></summary><div class="fold-content merch-panel">
    <div class="merch-stage"><span>${statusLabel} · ${modeLabel}</span><b>${escapeHtml(project.title)}</b><small>${project.createdAt} 创建 · ${companyLed ? "公司主导" : "玩家自营"}${project.status === "DESIGNING" ? ` · 已投入 ${project.designWorkCompleted}/${project.designWorkRequired} 格设计工作` : ""}</small></div>
    <div class="merch-metrics"><div><span>订单</span><b>${project.orderCount} 件</b></div><div><span>${companyLed ? "公司项目销售额" : "订单额"}</span><b>${money(project.grossOrdersJpy)}</b></div><div><span>${companyLed ? "公司项目损益" : project.salesMode === "READY_STOCK" ? "可售／预留库存" : "项目受限资金"}</span><b>${companyLed ? (project.projectProfitJpy == null ? "待结项" : money(project.projectProfitJpy)) : project.salesMode === "READY_STOCK" ? `${project.inventoryQuantity} / ${project.reservedInventoryQuantity} 件` : money(projectRestricted)}</b></div><div><span>${companyLed ? "玩家版税" : "净交付收入"}</span><b>${companyLed ? money(project.royaltyJpy) : money(netDeliveredRevenue)}</b></div></div>
    <div class="merch-actions">${active || BigInt(project.refundPayableJpy || 0) > 0n ? merchProjectActions(project, today) : `<span class="plain-note">${project.status === "SETTLED" ? (companyLed ? `项目利润 ${money(project.projectProfitJpy)}；玩家版税 ${money(project.royaltyJpy)}` : `项目利润 ${money(project.projectProfitJpy)}`) : `已生成退款与成本处理；历史项目未被删除。`}</span>`}</div>
    ${project.status === "AFTER_SALES" || Number(project.refundedOrders || 0) > 0 ? `<details class="micro-fold"><summary>售后退款 · ${project.refundedOrders || 0} 件</summary><div class="merch-detail"><p>${project.productKind === "DIGITAL" ? "退款冲减已确认收入；数字商品没有可恢复的实体库存。" : "退款冲减已确认收入；只有实际收回且可再次销售的商品才恢复库存。"}原订单与退款记录都会保留。</p><dl><div><dt>累计退款</dt><dd>${money(project.postDeliveryRefundJpy || 0)}</dd></div><div><dt>恢复库存</dt><dd>${project.restockedOrders || 0} 件</dd></div><div><dt>退款应付款</dt><dd>${money(project.refundPayableJpy || 0)}</dd></div></dl>${project.status === "AFTER_SALES" && Number(project.refundedOrders || 0) < project.deliveredOrders ? `<div class="merch-actions"><button class="secondary-action" data-merch-command="REFUND_DELIVERED_MERCH" data-project-id="${escapeHtml(project.id)}" data-refund-restockable="false">退款 1 件${project.productKind === "DIGITAL" ? "" : " · 不入库"}</button>${project.productKind === "PHYSICAL" ? `<button class="secondary-action" data-merch-command="REFUND_DELIVERED_MERCH" data-project-id="${escapeHtml(project.id)}" data-refund-restockable="true">退款 1 件 · 可再销售</button>` : ""}</div>` : ""}</div></details>` : ""}
    <details class="micro-fold"><summary>阶段、成本与责任</summary><div class="merch-detail"><p>${lifecycleText}</p><dl><div><dt>固定制作成本</dt><dd>${money(project.costs.fixedJpy)}</dd></div><div><dt>生产投入</dt><dd>${money(project.costs.productionJpy)}</dd></div><div><dt>商店及支付费</dt><dd>${money(project.costs.storeFeeJpy)}</dd></div><div><dt>净销售成本</dt><dd>${money(project.costs.cogsJpy)}</dd></div><div><dt>库存资产</dt><dd>${money(project.inventoryValueJpy)}</dd></div><div><dt>${companyLed ? "公司客户预付款" : "客户预付款负债"}</dt><dd>${money(projectDeferred)}</dd></div><div><dt>资金／商店／履约</dt><dd>${companyLed ? routeLabel : "玩家"}</dd></div><div><dt>合同结束后版税</dt><dd>${project.royaltySurvivesExit ? "继续按快照结算" : "不适用"}</dd></div></dl></div></details>
    ${active && !["DRAFT"].includes(project.status) ? `<details class="micro-fold danger-fold"><summary>取消与退款处理</summary><p>${companyLed ? "取消不会删除项目；公司负责未交付订单退款和已发生成本，个人账不承担项目亏损。" : project.salesMode === "DIGITAL" ? "取消不会删除项目；已发生的录制／制作成本不会返还，未交付数字订单将退款。" : project.salesMode === "READY_STOCK" ? "取消不会删除项目；未交付订单将退款，已入库现货作为材料残值保留。" : "取消不会删除项目；已发生的设计、商店或生产成本不会自动返还，未交付预售款将形成退款处理。"}</p><button class="danger-action" data-merch-command="CANCEL_MERCH_PROJECT" data-project-id="${escapeHtml(project.id)}">取消项目并处理退款</button></details>` : ""}
  </div></details>`;
}

function auditionNextStep(application) {
  const steps = {
    DRAFT_APPLICATION: "检查资格并提交",
    SUBMITTED: "进入初筛",
    SCREENING: "查看初筛结果",
    INTERVIEW_1: "在排期中准备并参加第一轮面试",
    INTERVIEW_2: "在排期中准备并参加最终面试",
    CONDITIONAL_OFFER: `在 ${application.conditionalOfferExpiresAt} 前处理意向`,
    CONTRACT_REVIEW: "审阅并确认虚构标准合同",
    PREPARING_DEBUT: "确认录取资格；转籍仍需独立方案",
  };
  return steps[application.status] || application.feedback || "流程记录已保留";
}

function auditionScoreDetail(score) {
  if (!score) return "";
  return `<div class="audition-score-grid">${Object.entries(AUDITION_SCORE_LABELS).map(([key, label]) => `<div><span>${label}</span><b>${Number(score[key]).toFixed(1)}</b></div>`).join("")}</div><p class="plain-note">总分 ${Number(score.total).toFixed(1)}；初筛线 50，最终线 65。订阅数不计入评分。</p>`;
}

function auditionApplicationCard(application) {
  const agency = AGENCIES[application.agencyId];
  const eligibility = application.eligibilitySnapshot || auditionEligibility(game, application.agencyId);
  const score = application.scoreBreakdown || auditionScore(game, application.agencyId);
  const round = application.roundId ? game.auditionRounds.find((item) => item.id === application.roundId) : null;
  const today = weekDateRange(game.weekIndex).start;
  const button = (type, label, primary = false, disabled = false) => `<button class="${primary ? "primary-action" : "secondary-action"}" data-audition-command="${type}" data-application-id="${escapeHtml(application.id)}" ${disabled || game.phase !== "PLANNING" ? "disabled" : ""}>${label}</button>`;
  let actions = "";
  if (application.status === "DRAFT_APPLICATION") actions = button("SUBMIT_APPLICATION", eligibility.eligible ? "提交申请" : "资格尚未满足", true, !eligibility.eligible);
  if (application.status === "SUBMITTED") actions = button("START_AUDITION_SCREENING", "进入初筛", true);
  if (application.status === "SCREENING") actions = button("RESOLVE_AUDITION_SCREENING", "查看初筛结果", true);
  if (["INTERVIEW_1", "INTERVIEW_2"].includes(application.status)) actions = `<button class="primary-action" data-view="schedule">安排准备或面试 →</button>`;
  if (application.status === "CONDITIONAL_OFFER") actions = `${button("BEGIN_AUDITION_CONTRACT_REVIEW", "审阅意向与合同", true)}${!application.offerExtensionUsed ? button("REQUEST_AUDITION_EXTENSION", "申请延长 14 日") : ""}`;
  if (application.status === "CONTRACT_REVIEW") actions = button("ACCEPT_AUDITION_CONTRACT_REVIEW", "确认合同审阅", true);
  if (application.status === "PREPARING_DEBUT") actions = button("COMPLETE_AUDITION", "确认录取资格", true);
  const canWithdraw = !isAuditionTerminal(application.status);
  return `<article class="audition-card status-${application.status.toLowerCase()}">
    <header><div><span>${escapeHtml(agency.auditionTemplate.name)}</span><b>${escapeHtml(agency.label)} · ${AUDITION_STATUS_LABELS[application.status] || application.status}</b></div><em>${score ? Number(score.total).toFixed(1) : "—"} 分</em></header>
    <div class="audition-next"><span>下一步</span><b>${escapeHtml(auditionNextStep(application))}</b></div>
    ${actions ? `<div class="merch-actions">${actions}</div>` : ""}
    <details class="micro-fold"><summary>资格与五项评分</summary><div class="merch-detail"><div class="eligibility-checks">${Object.entries(eligibility.checks || {}).map(([key, passed]) => `<span class="${passed ? "passed" : "failed"}">${passed ? "✓" : "×"} ${AUDITION_CHECK_LABELS[key] || key}</span>`).join("")}</div>${eligibility.reasons?.length ? `<p class="plain-note">${escapeHtml(eligibility.reasons.join("；"))}</p>` : ""}${auditionScoreDetail(score)}<p class="plain-note">有效作品 ${eligibility.validWorks?.length || application.portfolioWorkIds?.length || 0} 件；订阅 ${Number(eligibility.subscriberCountIgnored ?? game.channel.subscribers).toLocaleString("zh-CN")} 仅作参考，不作为门槛。</p></div></details>
    ${round ? `<details class="micro-fold"><summary>本轮竞争与固定参数</summary><div class="merch-detail"><dl><div><dt>轮次</dt><dd>第 ${round.startWeek}—${round.endWeek} 周</dd></div><div><dt>名额</dt><dd>${round.slots} 个</dd></div><div><dt>面试准备加成</dt><dd>+${application.interviewPrepModifier || 0} / 8</dd></div><div><dt>最终测试扰动</dt><dd>${application.finalNoise == null ? "待测试 · -3 至 +3" : Number(application.finalNoise).toFixed(1)}</dd></div><div><dt>最终分／排名</dt><dd>${application.finalScore == null ? "待最终面试" : `${Number(application.finalScore).toFixed(1)} / 第 ${application.candidateRank} 名`}</dd></div><div><dt>同期背景候选</dt><dd>${round.backgroundCandidateScores.map((value) => Number(value).toFixed(1)).join(" / ")}</dd></div></dl><p class="plain-note">名额与竞争者在每轮开始时确定，所有候选人使用同一评分标准。</p></div></details>` : ""}
    ${application.feedback ? `<p class="audition-feedback">${escapeHtml(application.feedback)}</p>` : ""}
    ${canWithdraw ? `<details class="micro-fold danger-fold"><summary>撤回申请</summary><p>撤回后申请记录保留。</p>${button("WITHDRAW_AUDITION", "撤回并保留记录")}</details>` : ""}
  </article>`;
}

function auditionPanel() {
  const active = game.auditionApplications.filter((item) => !isAuditionTerminal(item.status));
  const history = [...game.auditionApplications].reverse().filter((item) => isAuditionTerminal(item.status));
  const needsAction = active.some((item) => !["DRAFT_APPLICATION"].includes(item.status));
  const choices = Object.values(AGENCIES).map((agency) => {
    const eligibility = auditionEligibility(game, agency.id);
    const score = auditionScore(game, agency.id);
    const cooling = history.find((item) => item.agencyId === agency.id && item.status === "REJECTED" && Number(item.cooldownUntilWeek || 0) > game.weekIndex);
    const current = game.affiliation?.agencyId === agency.id;
    return `<article class="merch-template"><div><span>${escapeHtml(agency.auditionTemplate.name)} · 设计参数</span><b>${escapeHtml(agency.label)}</b><small>${eligibility.eligible ? `资格已满足 · 预估 ${score.total.toFixed(1)} 分` : eligibility.reasons.join("；")}。订阅数不作为门槛。</small></div><button class="primary-action" data-audition-command="CREATE_AUDITION_APPLICATION" data-agency-id="${agency.id}" ${current || cooling || game.phase !== "PLANNING" ? "disabled" : ""}>${current ? "当前所属" : cooling ? `第 ${cooling.cooldownUntilWeek} 周可再申请` : "建立申请草案"}</button></article>`;
  }).join("");
  return `<details class="fold-panel audition-panel" ${needsAction ? "open" : ""}><summary><span><b>招募与面试</b><small>${active.length ? `${active.length} 份进行中 · ${auditionNextStep(active[0])}` : "资格、评分与竞争情况"}</small></span><i>${needsAction ? "收起" : "展开"}</i></summary><div class="fold-content merch-panel">
    ${active.length ? `<div class="audition-card-list">${active.map(auditionApplicationCard).join("")}</div>` : `<div class="merch-template-list audition-choice-list">${choices}</div><p class="plain-note">每 4 周一轮、初始 2 个名额；落选后 12 周内不能再次申请同一机构。草案不占名额，提交后锁定本轮资料。</p>`}
    ${history.length ? `<details class="micro-fold"><summary>历史申请 · ${history.length} 份</summary><div class="audition-history">${history.map((item) => `<article><div><b>${escapeHtml(agencyDisplayLabel(item.agencyId))}</b><span>${AUDITION_STATUS_LABELS[item.status] || item.status}</span></div><p>${escapeHtml(item.feedback || "记录已保留")}${item.cooldownUntilWeek ? ` · 第 ${item.cooldownUntilWeek} 周可再次申请` : ""}</p></article>`).join("")}</div></details>` : ""}
  </div></details>`;
}

function transferPanel() {
  const terminal = new Set(["CLOSED", "CANCELLED", "DECLINED"]);
  const active = [...game.transferCases].reverse().find((item) => !terminal.has(item.status));
  const history = [...game.transferCases].reverse().filter((item) => terminal.has(item.status));
  const today = weekDateRange(game.weekIndex).start;
  const completedAgencies = new Set(game.auditionApplications.filter((item) => item.status === "COMPLETED" && item.transferEligibility?.granted).map((item) => item.transferEligibility.agencyId));
  const targetRoutes = Object.values(ROUTES).filter((route) => route.id !== game.routeId && (route.id === "indie" || completedAgencies.has(route.agencyId)));
  if (!active) {
    const choices = targetRoutes.map((route) => `<article class="merch-template"><div><span>${route.id === "indie" ? "企业退出 · 无需新机构意向" : "已取得录取资格"}</span><b>${escapeHtml(routeDisplayLabel(route.id))}</b><small>${route.id === "indie" ? "低现金也可进入处理；资产、频道、订单与通知期逐项核对。" : "建立转籍案不会立即覆盖当前所属；先处理退出、资产与责任。"}</small></div><button class="primary-action" data-transfer-command="CREATE_TRANSFER_CASE" data-target-route-id="${route.id}" ${game.phase !== "PLANNING" ? "disabled" : ""}>建立转籍案</button></article>`).join("");
    return `<details class="fold-panel transfer-panel"><summary><span><b>所属变更与退出</b><small>${history.length ? `${history.length} 份历史方案 · 当前无进行中转籍` : "角色、频道、合同与责任分别处理"}</small></span><i>展开</i></summary><div class="fold-content merch-panel">${choices ? `<div class="merch-template-list audition-choice-list">${choices}</div>` : `<p class="plain-note">暂无可选目标。加入企业需先通过对应招募。</p>`}${history.length ? `<details class="micro-fold"><summary>历史转籍 · ${history.length} 份</summary><div class="audition-history">${history.map((item) => `<article><div><b>${routeDisplayLabel(item.sourceRouteId)} → ${routeDisplayLabel(item.targetRouteId)}</b><span>${TRANSFER_STATUS_LABELS[item.status] || item.status}</span></div><p>${item.switchedAt ? `${item.switchedAt} 生效` : "未发生所属切换"}</p></article>`).join("")}</div></details>` : ""}</div></details>`;
  }
  const button = (type, label, primary = false, disabled = false, extra = "") => `<button class="${primary ? "primary-action" : "secondary-action"}" data-transfer-command="${type}" data-transfer-id="${escapeHtml(active.id)}" ${extra} ${disabled || game.phase !== "PLANNING" ? "disabled" : ""}>${label}</button>`;
  const avatar = game.assets.find((asset) => game.character.assetIds.includes(asset.id) && asset.type === "AVATAR");
  const canKeepCharacter = avatar?.ownerParty === "PLAYER" || game.licenses.some((license) => license.assetId === avatar?.id && license.licenseeParty === "PLAYER" && license.survivesTermination);
  const canKeepChannel = game.channel.controller === "PLAYER";
  let actions = "";
  if (active.status === "DESTINATION_CONFIRMED") actions = button("BEGIN_TRANSFER_EXIT_NEGOTIATION", "开始退出协商", true);
  if (active.status === "EXIT_NEGOTIATION") actions = `<div class="transfer-plan-options">${button("CONFIRM_TRANSFER_PLAN", "保留角色与频道", false, !(canKeepCharacter && canKeepChannel), 'data-asset-plan="KEEP_ALL"')}${button("CONFIRM_TRANSFER_PLAN", "保留角色 · 新频道", false, !canKeepCharacter, 'data-asset-plan="KEEP_CHARACTER_NEW_CHANNEL"')}${button("CONFIRM_TRANSFER_PLAN", "新角色 · 新频道", true, false, 'data-asset-plan="NEW_IDENTITY"')}</div>`;
  if (active.status === "PAUSED") actions = button("RESUME_TRANSFER", `筹足 ${money(active.identityPreparation?.costJpy || 0)} 后恢复`, true, BigInt(game.cash.free) < BigInt(active.identityPreparation?.costJpy || 0));
  if (active.status === "ASSET_AND_OBLIGATION_PLAN") {
    const preparation = active.identityPreparation;
    if (preparation && preparation.completedUnits < preparation.requiredUnits) actions = `<button class="primary-action" data-view="schedule">安排新身份准备 · ${preparation.completedUnits}/${preparation.requiredUnits} →</button>`;
    else actions = button("START_TRANSFER_NOTICE", preparation && compareDates(today, preparation.earliestReadyDate) < 0 ? `等待身份制作至 ${preparation.earliestReadyDate}` : active.exitChecklist.noticePeriod.requiredWeeks ? `确认方案并开始 ${active.exitChecklist.noticePeriod.requiredWeeks} 周通知期` : "确认方案并进入切换准备", true, Boolean(preparation && compareDates(today, preparation.earliestReadyDate) < 0));
  }
  if (active.status === "NOTICE_PERIOD") actions = button("PROCESS_TRANSFER_NOTICE", compareDates(today, active.noticeEndsAt) >= 0 ? "完成通知期" : `通知期至 ${active.noticeEndsAt}`, true, compareDates(today, active.noticeEndsAt) < 0);
  if (active.status === "READY_TO_SWITCH") actions = button("SWITCH_AFFILIATION", "正式切换主所属", true);
  if (active.status === "REBUILDING") actions = button("CLOSE_TRANSFER", "完成恢复期并归档", true);
  const obligations = active.exitChecklist.obligations || [];
  return `<details class="fold-panel transfer-panel" open><summary><span><b>所属变更 · ${routeDisplayLabel(active.sourceRouteId)} → ${routeDisplayLabel(active.targetRouteId)}</b><small>${TRANSFER_STATUS_LABELS[active.status] || active.status} · 转换生效前旧所属继续有效</small></span><i>收起</i></summary><div class="fold-content merch-panel">
    <div class="merch-stage"><span>转籍 · ${TRANSFER_STATUS_LABELS[active.status] || active.status}</span><b>${routeDisplayLabel(active.sourceRouteId)} → ${routeDisplayLabel(active.targetRouteId)}</b><small>${active.pauseReason || "主所属、角色、频道和合同不会被同一个按钮隐式覆盖。"}</small></div>
    <div class="merch-actions">${actions}</div>
    <details class="micro-fold"><summary>退出清单与责任 · ${obligations.length} 项进行中义务</summary><div class="merch-detail"><dl><div><dt>通知期</dt><dd>${active.exitChecklist.noticePeriod.requiredWeeks} 周 · ${active.exitChecklist.noticePeriod.status}</dd></div><div><dt>资产方案</dt><dd>${active.assetPlan?.type || "待选择"}</dd></div><div><dt>角色可保留</dt><dd>${canKeepCharacter ? "已有权利依据" : "无终止后许可"}</dd></div><div><dt>频道可保留</dt><dd>${canKeepChannel ? "玩家控制" : "原机构控制"}</dd></div><div><dt>旧应收</dt><dd>${active.exitChecklist.financialItems.openReceivableIds.length} 笔 · 原合同结算</dd></div><div><dt>公告范围</dt><dd>${escapeHtml(active.exitChecklist.announcement.publicScope)}</dd></div></dl>${obligations.length ? `<div class="transfer-obligations">${obligations.map((item) => `<p><b>${escapeHtml(item.label)}</b><span>${item.treatment ? "已保留原责任主体" : "待确认责任处理"} · ${escapeHtml(item.responsibleParty)}</span></p>`).join("")}</div>` : `<p class="plain-note">当前没有未交付商单、商品或长期项目；历史应收仍按发生时合同到账。</p>`}</div></details>
    ${active.identityPreparation ? `<details class="micro-fold"><summary>新身份最低方案 · ${active.identityPreparation.completedUnits}/${active.identityPreparation.requiredUnits} 格</summary><div class="merch-detail"><dl><div><dt>费用</dt><dd>${money(active.identityPreparation.costJpy)} · ${escapeHtml(active.identityPreparation.fundingParty)}</dd></div><div><dt>最早完成</dt><dd>${active.identityPreparation.earliestReadyDate}</dd></div></dl><p class="plain-note">独立方案包含基础静态形象与商业使用权；需同时满足工作格与 14 日制作时间。</p></div></details>` : ""}
    ${!["REBUILDING"].includes(active.status) ? `<details class="micro-fold danger-fold"><summary>取消转籍案</summary><p>取消仅终止尚未生效的转籍；已发生的费用、订单与履约责任保留。</p>${button("CANCEL_TRANSFER", "取消并保留既有责任")}</details>` : ""}
  </div></details>`;
}

function longProjectActions(project, today) {
  const button = (type, label, disabled = false, primary = false) => `<button class="${primary ? "primary-action" : "secondary-action"}" data-long-command="${type}" data-project-id="${escapeHtml(project.id)}" ${disabled || game.phase !== "PLANNING" ? "disabled" : ""}>${label}</button>`;
  if (project.status === "DRAFT") return button("SUBMIT_LONG_PROJECT", game.routeId === "indie" ? "确认方案" : "提交公司审核", false, true);
  if (project.status === "REVIEW") return button("APPROVE_LONG_PROJECT", "完成审核并批准", false, true);
  if (project.status === "APPROVED") return button("START_LONG_PROJECT", `正式启动 · 支付 ${money(project.paymentPlan.startupJpy)}`, false, true);
  if (project.status === "PRE_PRODUCTION" && project.pendingResourceRequirements?.some((item) => item.status !== "APPROVED")) return `<span class="plain-note">需先完成下方公司资源申请；缩减配额或排队中的资源不满足依赖要求。</span>`;
  if (project.status === "PRE_PRODUCTION") return button("ENTER_LONG_PROJECT_PRODUCTION", `确认制作 · 支付 ${money(project.paymentPlan.productionJpy)}`, false, true);
  if (project.status === "PRODUCTION" && project.workCompleted < project.workRequired) return `<button class="primary-action" data-view="schedule">安排项目制作 →</button>`;
  if (project.status === "PRODUCTION") return button("PROCESS_LONG_PROJECT_DATE", compareDates(today, project.earliestPublishDate) >= 0 ? "进入质量检查" : `等待至 ${project.earliestPublishDate}`, compareDates(today, project.earliestPublishDate) < 0, true);
  if (project.status === "QUALITY_CHECK") return button("PASS_LONG_PROJECT_QUALITY", `通过验收 · 支付 ${money(project.paymentPlan.acceptanceJpy)}`, false, true);
  if (project.status === "SCHEDULED") return button("PUBLISH_LONG_PROJECT", "按排期发布", compareDates(today, project.scheduledPublishDate) < 0, true);
  if (project.status === "PUBLISHED") return button("ADVANCE_LONG_PROJECT_TAIL", "转入长尾运营");
  if (project.status === "PAUSED") return button("RESUME_LONG_PROJECT", `恢复至${LONG_PROJECT_STATUS_LABELS[project.pausedFromStatus] || project.pausedFromStatus}`, false, true);
  return "";
}

function longProjectResourcePanel(project) {
  const requirements = project.pendingResourceRequirements || [];
  if (!requirements.length) return "";
  const attention = requirements.some((item) => item.status !== "APPROVED");
  const rows = requirements.map((requirement) => {
    const request = requirement.requestId ? game.resourceRequests.find((item) => item.id === requirement.requestId) : null;
    let action = "";
    if (!request) action = `<button class="secondary-action" data-resource-command="REQUEST_AGENCY_RESOURCE" data-project-id="${escapeHtml(project.id)}" data-resource-type="${requirement.resourceType}" data-quantity="${requirement.quantity}" data-desired-date="${requirement.desiredDate}">提交同批申请</button>`;
    else if (request.status === "PENDING") action = `<button class="primary-action" data-resource-command="RESOLVE_AGENCY_RESOURCE" data-round-id="${escapeHtml(request.roundId)}">按截止时间统一结算</button>`;
    const status = !request ? "待申请" : request.status === "APPROVED" ? "足额获批" : request.status === "DOWNSCALED" ? "缩配建议" : request.status === "QUEUED" ? "延期排队" : "同批待结算";
    return `<article class="resource-request-card status-${(request?.status || "unrequested").toLowerCase()}"><div><span>${RESOURCE_LABELS[requirement.resourceType] || requirement.resourceType} · ${requirement.desiredDate}</span><b>${status} · ${request?.allocatedQuantity || 0}/${requirement.quantity}</b><small>${escapeHtml(request?.resultExplanation || "尚未占用公司容量；提交后与同期背景申请统一排序。")}</small></div>${action}</article>`;
  }).join("");
  return `<details class="micro-fold resource-fold" ${attention ? "open" : ""}><summary>公司共享资源 · ${requirements.length} 项${attention ? " · 需要处理" : ""}</summary><div class="resource-request-list">${rows}</div><p class="plain-note">评分 = 准备度 35% + 匹配度 25% + 工作信誉 20% + 项目价值 20%；同分按请求顺序，连续未满足有封顶补偿。资源按周刷新且不会累积。</p></details>`;
}

function longProjectPanel() {
  const projects = game.projects.filter((item) => item.type === "LONG_TERM");
  const latest = projects.at(-1);
  const project = [...projects].reverse().find((item) => !["LONG_TAIL", "CANCELLED", "ARCHIVED"].includes(item.status));
  const today = weekDateRange(game.weekIndex).start;
  if (!project) {
    const templates = LONG_PROJECT_TEMPLATE_LIST.map((template) => `<article class="merch-template"><div><span>${template.minimumCalendarDays} 日最低日历 · ${template.workUnits} 格工作</span><b>${escapeHtml(template.name)}</b><small>预算 ${template.budgetJpy.toLocaleString("zh-CN")} · 分 30% / 40% / 30% 三节点确认</small></div><button class="primary-action" data-long-command="CREATE_LONG_PROJECT" data-template-id="${template.id}" ${game.phase !== "PLANNING" ? "disabled" : ""}>创建草案</button></article>`).join("");
    const recent = latest ? `<details class="micro-fold"><summary>最近项目 · ${escapeHtml(latest.title)} · ${LONG_PROJECT_STATUS_LABELS[latest.status] || latest.status}</summary><div class="merch-detail"><dl><div><dt>已发生成本</dt><dd>${money(latest.spentCostJpy)}</dd></div><div><dt>完成资产</dt><dd>${latest.completedAssetIds.length} 项</dd></div><div><dt>工作量</dt><dd>${latest.workCompleted}/${latest.workRequired} 格</dd></div><div><dt>取消退款</dt><dd>${money(latest.cancellationTreatment?.refundedJpy || 0)}</dd></div></dl>${latest.status === "LONG_TAIL" ? `<button class="secondary-action" data-long-command="ARCHIVE_LONG_PROJECT" data-project-id="${escapeHtml(latest.id)}">停止后续活动并归档</button>` : ""}</div></details>` : "";
    return `<details class="fold-panel"><summary><span><b>长期作品与角色资产</b><small>${latest ? `可创建新项目 · 视觉制作项 ${game.character.visualProductionBonus}/20` : "4 种项目模板"}</small></span><i>展开</i></summary><div class="fold-content merch-panel"><div class="merch-template-list long-project-template-list">${templates}</div><p class="plain-note">工作格与外包等待时间需分别满足；参考预算已含常规资源。项目完成不保证盈利。</p>${recent}</div></details>`;
  }
  const resources = project.reservedResourceIds.map((id) => game.resourceReservations.find((item) => item.id === id)).filter(Boolean);
  const workPercent = Math.round(100 * project.workCompleted / project.workRequired);
  const paid = BigInt(project.spentCostJpy);
  const cancellable = ["DRAFT", "REVIEW", "APPROVED", "PRE_PRODUCTION", "PRODUCTION", "QUALITY_CHECK", "SCHEDULED", "PAUSED"].includes(project.status);
  const resourceAttention = project.pendingResourceRequirements?.some((item) => item.status !== "APPROVED");
  const open = ["REVIEW", "QUALITY_CHECK", "SCHEDULED"].includes(project.status) || resourceAttention;
  return `<details class="fold-panel" ${open ? "open" : ""}><summary><span><b>${escapeHtml(project.title)} · ${LONG_PROJECT_STATUS_LABELS[project.status] || project.status}</b><small>${resourceAttention ? "公司资源需要处理" : project.status === "PRODUCTION" ? `工作 ${project.workCompleted}/${project.workRequired} · 最早 ${project.earliestPublishDate}` : `已发生成本 ${money(paid)} · 视觉制作项 ${game.character.visualProductionBonus}/20`}</small></span><i>${open ? "收起" : "展开"}</i></summary><div class="fold-content merch-panel">
    <div class="merch-stage"><span>长期项目 · ${escapeHtml(project.projectType)}</span><b>${LONG_PROJECT_STATUS_LABELS[project.status] || project.status}</b><small>${project.status === "PRODUCTION" ? `制作进度 ${workPercent}%` : project.status === "PAUSED" ? `原阶段：${LONG_PROJECT_STATUS_LABELS[project.pausedFromStatus]}` : `推进前会检查阶段依赖`}</small></div>
    <div class="merch-metrics"><div><span>工作量</span><b>${project.workCompleted} / ${project.workRequired}</b></div><div><span>最低日历</span><b>${project.externalWaitDays} 日</b></div><div><span>已发生成本</span><b>${money(project.spentCostJpy)}</b></div><div><span>交付／最早发布</span><b>${project.deliveryDate || "启动后确定"}</b></div></div>
    <div class="merch-actions">${longProjectActions(project, today)}</div>
    ${longProjectResourcePanel(project)}
    <details class="micro-fold"><summary>阶段依赖、付款与资源预约</summary><div class="merch-detail"><p>草案 → 审核中 → 已批准 → 前期准备 → 制作中 → 质量检查 → 已排期 → 已发布 → 长尾运营。个人势无外部审核时跳过“审核中”。</p><dl><div><dt>启动 30%</dt><dd>${money(project.paymentPlan.startupJpy)} · ${project.paymentPlan.paidNodes.includes("startup") ? "已付" : "未发生"}</dd></div><div><dt>制作 40%</dt><dd>${money(project.paymentPlan.productionJpy)} · ${project.paymentPlan.paidNodes.includes("production") ? "已付" : "未发生"}</dd></div><div><dt>验收 30%</dt><dd>${money(project.paymentPlan.acceptanceJpy)} · ${project.paymentPlan.paidNodes.includes("acceptance") ? "已付" : "未发生"}</dd></div><div><dt>资金承担方</dt><dd>玩家自由现金</dd></div>${resources.map((resource) => `<div><dt>${RESOURCE_LABELS[resource.resourceType] || resource.resourceType} × ${resource.quantity}</dt><dd>${resource.date} · ${resource.status === "RESERVED" ? "已预约" : resource.status === "FULFILLED" ? "已落实" : "已取消"}</dd></div>`).join("") || `<div><dt>关键资源</dt><dd>正式启动后预约到具体日期</dd></div>`}</dl></div></details>
    <details class="micro-fold"><summary>资产许可与完成效果</summary><div class="merch-detail"><p>${escapeHtml(project.downstreamRevenueBasis)}</p><dl><div><dt>计划资产所有者</dt><dd>${project.ownerParty === "PLAYER" ? "玩家" : routeDisplayLabel(game.routeId)}</dd></div><div><dt>玩家使用许可</dt><dd>${project.assetPermission.playerUses.join(" / ")}</dd></div><div><dt>商品素材</dt><dd>${project.assetPermission.merchMaterialEligible ? (project.assetPermission.merchSaleLicenseGranted ? "开放且可自营" : "素材开放，销售仍需许可") : "不适用"}</dd></div><div><dt>视觉制作项</dt><dd>${project.projectType === "NEW_OUTFIT" ? `完成 +5，累计上限 20；当前 ${game.character.visualProductionBonus}` : "不直接增加"}</dd></div></dl></div></details>
    ${cancellable ? `<details class="micro-fold danger-fold"><summary>暂停或取消</summary><div class="merch-actions">${project.status !== "PAUSED" ? `<button class="secondary-action" data-long-command="PAUSE_LONG_PROJECT" data-project-id="${escapeHtml(project.id)}">暂停项目</button>` : ""}<button class="danger-action" data-long-command="CANCEL_LONG_PROJECT" data-project-id="${escapeHtml(project.id)}">取消并保留已发生成本</button></div><p>${escapeHtml(project.failureAndCancellation)}</p></details>` : ""}
  </div></details>`;
}

function industryView() {
  const worldWeek = game.worldWeeks.find((item) => item.weekIndex === game.weekIndex);
  const confirmed = game.collaborationReservations.filter((item) => item.weekIndex === game.weekIndex && item.status === "CONFIRMED");
  const unscheduledConfirmed = confirmed.filter((reservation) => !game.plan.some((slot) => slot.targetId === reservation.id));
  const incoming = game.npcInvitations.filter((item) => item.weekIndex === game.weekIndex && item.status === "OPEN");
  const occupiedSlots = new Set(confirmed.map((item) => item.slotIndex));
  const candidateRows = game.npcs.map((npc) => {
    const score = invitationScore(game, npc.id);
    const relation = game.relationships.find((item) => item.subjectA === game.performer.id && item.subjectB === npc.id) || npc.relationship;
    const openSlots = npc.availableSlots.filter((slotIndex) => !game.plan[slotIndex]?.actionId && !occupiedSlots.has(slotIndex));
    return { npc, score, relation, openSlots };
  }).sort((left, right) => right.score.total - left.score.total || left.npc.id.localeCompare(right.npc.id));
  const actionable = candidateRows.filter((item) => item.openSlots.length && item.score.total >= 55);
  const latestInvitations = game.collaborationInvitations.slice(-6).reverse();
  const candidateCard = ({ npc, score, relation, openSlots }, featured = false) => `<article class="industry-candidate ${featured ? "is-featured" : ""}">
    <header><div><span>${escapeHtml(npcAffiliationLabel(npc.affiliationId))} · ${npc.language.toUpperCase()} · ${DIRECTIONS[npc.direction]}</span><b>${escapeHtml(npc.name)}</b><small>${escapeHtml(npc.currentProject.title)} · ${npc.sizeTier === "NEWCOMER" ? "新人" : npc.sizeTier === "GROWING" ? "成长中" : "成熟"}频道</small></div><em>${score.total}<small> / 100</small></em></header>
    <p>熟悉 ${relation.familiarity} · 工作信任 ${relation.workTrust} · 内容契合 ${relation.contentSynergy}</p>
    ${openSlots.length && game.phase === "PLANNING" ? `<div class="invite-control"><label><span>可用档期</span><select data-invite-slot="${npc.id}">${openSlots.map((slotIndex) => `<option value="${slotIndex}">${slotLabel(slotIndex)}</option>`).join("")}</select></label><button class="${score.total >= 55 ? "primary-action" : "secondary-action"}" data-submit-invitation="${npc.id}">${score.total >= 55 ? "发送邀请" : "仍要询问"}</button></div>` : `<small class="no-slot">本周没有双方都空闲的档期</small>`}
    <details class="micro-fold"><summary>查看邀请评分与频道资料</summary><div class="score-breakdown"><span>内容契合 <b>${score.contentFit}</b> · 35%</span><span>工作信任 <b>${score.workTrust}</b> · 25%</span><span>共同项目价值 <b>${score.mutualProjectValue}</b> · 20%</span><span>准备度 <b>${score.preparation}</b> · 20%</span></div><p>频道 ${compact(npc.channelSize)} 订阅 · 负荷 ${npc.healthLoad}/100。订阅差距不是邀请门槛，只间接影响合作价值。</p></details>
  </article>`;
  return `<section class="page-stack"><div class="page-heading compact-heading"><div><p class="eyebrow">关系与行业</p><h1>行业与关系</h1><p>查看合作邀请、可用档期与行业动态。</p></div></div>
    <section class="industry-pulse"><div><span>本周趋势</span><b>${escapeHtml(worldWeek?.trendingTopic || "常规内容周期")}</b><small>${escapeHtml(worldWeek?.publicFestival || "无公共节庆")} · ${escapeHtml(worldWeek?.debutWindow || "常规出道密度")}</small></div><div><span>可接受邀请</span><b>${actionable.length} 位</b><small>评分 ≥ 55 且当前存在共同空档${incoming.length ? ` · 收到 ${incoming.length} 份来邀` : ""}</small></div><div><span>待排确认</span><b>${unscheduledConfirmed.length} 场</b><small>${unscheduledConfirmed.length ? "请在对应时段排入联动" : confirmed.length ? "本周确认合作均已安排" : "当前没有已占用的联动档期"}</small></div></section>
    ${incoming.length ? `<details class="fold-panel action-fold" open><summary><span><b>收到 NPC 合作邀请</b><small>${incoming.length} 份来邀需要回应</small></span><i>收起</i></summary><div class="fold-content confirmed-collabs">${incoming.map((invitation) => { const npc = game.npcs.find((item) => item.id === invitation.npcId); return `<article><div><span>${slotLabel(invitation.slotIndex)} · ${escapeHtml(npcAffiliationLabel(npc.affiliationId))}</span><b>${escapeHtml(invitation.response)}</b><small>接受后锁定双方档期；婉拒不影响关系。</small></div><div class="button-row"><button class="secondary-action" data-respond-npc-invitation="${invitation.id}" data-accept="false">婉拒</button><button class="primary-action" data-respond-npc-invitation="${invitation.id}" data-accept="true">接受</button></div></article>`; }).join("")}</div></details>` : ""}
    ${confirmed.length ? `<details class="fold-panel action-fold" ${unscheduledConfirmed.length ? "open" : ""}><summary><span><b>已确认合作${unscheduledConfirmed.length ? " · 需要排期" : ""}</b><small>${confirmed.length} 份预约已占用双方档期</small></span><i>${unscheduledConfirmed.length ? "收起" : "展开"}</i></summary><div class="fold-content confirmed-collabs">${confirmed.map((reservation) => { const npc = game.npcs.find((item) => item.id === reservation.npcId); const scheduled = game.plan.some((slot) => slot.targetId === reservation.id); return `<article><div><span>${slotLabel(reservation.slotIndex)}</span><b>${escapeHtml(npc.name)} · 联动直播</b><small>${scheduled ? "已排入本周计划" : "预约已确认，尚未排入计划"}</small></div><button class="secondary-action" data-open-collab-slot="${reservation.slotIndex}" ${scheduled ? "disabled" : ""}>${scheduled ? "已安排" : "去排期"}</button></article>`; }).join("")}</div></details>` : ""}
    <section class="signal-board"><div class="section-heading"><div><span class="section-kicker">优先候选</span><h2>${actionable.length ? "当前最匹配的合作窗口" : "先积累准备与工作信任"}</h2></div><span class="section-side">接受线 55 分 · 无订阅门槛</span></div><div class="industry-candidate-grid">${candidateRows.slice(0, 4).map((item) => candidateCard(item, true)).join("")}</div></section>
    <details class="fold-panel"><summary><span><b>完整 20 人行业网络</b><small>三种所属均含新人、成长中与成熟频道</small></span><i>展开</i></summary><div class="fold-content industry-roster">${candidateRows.map((item) => candidateCard(item)).join("")}</div></details>
    <details class="fold-panel"><summary><span><b>本周行业供需</b><small>行业动态与资源供给</small></span><i>展开</i></summary><div class="fold-content"><div class="world-supply"><div><span>重大活动</span><b>${escapeHtml(worldWeek?.majorEvent || "无重大公共活动")}</b></div><div><span>商品发布密度</span><b>${worldWeek?.merchDensity || 0} / 100</b></div><div><span>外部供应资源</span><b>${worldWeek?.supplyResources || 0} / 100</b></div></div><div class="world-event-list">${(worldWeek?.worldEvents || []).map((event) => `<p><b>${escapeHtml(event.title)}</b><span>${event.startDate} — ${event.endDate} · ${event.phase === "ACTIVE" ? "进行中" : "余热衰减"} ${event.heat}/100</span></p>`).join("") || "<p>本周没有处于活动期或余热期的公开事件。</p>"}${(worldWeek?.npcUpdates || []).map((update) => `<p><b>${escapeHtml(game.npcs.find((npc) => npc.id === update.npcId)?.name || update.npcId)}</b><span>${escapeHtml(update.explanation)}</span></p>`).join("")}</div></div></details>
    <details class="fold-panel"><summary><span><b>邀请记录</b><small>${game.collaborationInvitations.length} 次提交</small></span><i>展开</i></summary><div class="fold-content invitation-history">${latestInvitations.length ? latestInvitations.map((invitation) => { const npc = game.npcs.find((item) => item.id === invitation.npcId); return `<article><span>${slotLabel(invitation.slotIndex)}</span><b>${escapeHtml(npc.name)} · ${invitation.status === "ACCEPTED" ? "已接受" : "暂未接受"}</b><small>${escapeHtml(invitation.response)} · 评分 ${invitation.score.total}/55</small></article>`; }).join("") : `<div class="empty-state"><b>尚未发送邀请</b><span>选择双方都空闲的档期后发出邀请。</span></div>`}</div></details>
  </section>`;
}

function projectsView() {
  const activeMerch = game.projects.filter((project) => project.type === "MERCH" && !["SETTLED", "CANCELLED"].includes(project.status));
  const activeLong = game.projects.filter((project) => project.type === "LONG_TERM" && !["ARCHIVED", "CANCELLED"].includes(project.status));
  const scheduledWork = game.plan.filter((slot) => slot.actionId === "PROJECT_WORK").length;
  return `<section class="page-stack"><div class="page-heading compact-heading"><div><p class="eyebrow">项目</p><h1>项目</h1><p>需要处理的项目会自动展开。</p></div><div class="heading-actions"><button class="primary-action" data-view="schedule">安排项目工作 →</button></div></div>
    <section class="project-pulse"><div><span>进行中商品</span><b>${activeMerch.length}</b><small>订单额不等于利润或自由现金</small></div><div><span>进行中长期作品</span><b>${activeLong.length}</b><small>工作格与日历等待不能互相替代</small></div><div><span>本周项目工作</span><b>${scheduledWork} 格</b><small>必须绑定具体项目</small></div></section>
    ${longProjectPanel()}
    ${merchProjectPanel()}
  </section>`;
}

function careerView() {
  const route = ROUTES[game.routeId];
  const goal = evaluateCareerGoal(game);
  return `<section class="page-stack"><div class="page-heading compact-heading"><div><p class="eyebrow">表演者 · 角色 · 频道 · 所属</p><h1>职业与资产</h1><p>四项分别记录，转籍时逐项处理。</p></div></div>
    <details class="fold-panel"><summary><span><b>${GOALS[goal.goalId]} · ${goal.achieved ? "当前达成" : "仍在积累"}</b><small>按所选职业目标的指标评估</small></span><i>展开</i></summary><div class="fold-content career-evaluation">${Object.entries(goal.measures).map(([key, value]) => `<div><span>${escapeHtml({ sampleWeeks: "有效周数", averageStress: "八周平均压力", incomeTotalJpy: "八周归属收入", averageWeeklyIncomeJpy: "周均归属收入", weeklyBasicsJpy: "每周基本成本", cashCoverageWeeks: "现金覆盖周数", fulfillmentRate: "承诺履行率", portfolioCount: "代表作品", publishedContentCount: "公开内容", contentFormats: "内容形式", stageAndMusicCount: "舞台／音乐内容", collaborationCount: "完成合作", performance: "舞台能力", active28dEstimate: "近28日活跃", playerOwnedAssets: "个人资产", incomeSourceCount: "收入来源" }[key] || key)}</span><b>${String(key).endsWith("Jpy") ? money(value) : key === "fulfillmentRate" ? `${value}%` : value}</b></div>`).join("")}</div></details>
    ${auditionPanel()}
    ${transferPanel()}
    <div class="entity-map"><article><span>表演者</span><b>${escapeHtml(game.performer.code)}</b><small>能力、履历与个人现金</small></article><i>使用</i><article><span>当前角色</span><b>${escapeHtml(game.character.name)}</b><small>${game.character.active ? "活动中" : "已归档"}</small></article><i>运营</i><article><span>当前频道</span><b>${compact(game.channel.subscribers)} 订阅</b><small>${game.channel.controller === "PLAYER" ? "玩家控制" : "公司控制"}</small></article><i>隶属</i><article><span>当前所属</span><b>${routeDisplayLabel(route.id)}</b><small>${game.contract ? "有效合同" : "无主所属合同"}</small></article></div>
    <details class="fold-panel" open><summary><span><b>当前条款</b><small>${game.contract ? "虚构标准合同 · 设计参数" : "个人经营"}</small></span><i>收起</i></summary><div class="fold-content contract-grid">${game.contract ? `<div><span>平台分成后收入主播份额</span><b>${game.contract.creatorPlatformShareBps / 100}%</b></div><div><span>合同期</span><b>${game.contract.termWeeks} 周</b></div><div><span>提前结束通知</span><b>${game.contract.noticeWeeks} 周</b></div><div><span>固定工资</span><b>无</b></div>` : `<div><span>平台分成后收入主播份额</span><b>100%</b></div><div><span>每周基础工具费</span><b>${money(route.weeklyToolCost)}</b></div><div><span>内容自主</span><b>玩家</b></div><div><span>资产管理</span><b>玩家</b></div>`}<p>这些数值是游戏设计参数，不代表真实企业内部待遇或合同。</p></div></details>
    <details class="fold-panel"><summary><span><b>资产与使用许可</b><small>${game.assets.length} 项资产 · ${game.licenses.length} 项许可</small></span><i>展开</i></summary><div class="fold-content asset-list">${game.assets.map((asset) => { const license = game.licenses.find((item) => item.assetId === asset.id); const project = asset.projectId ? game.projects.find((item) => item.id === asset.projectId) : null; return `<article><div><span>${asset.type}</span><b>${project ? escapeHtml(project.title) : `${escapeHtml(game.character.name)} 基础形象`}</b></div><div><span>所有者 <b>${asset.ownerParty === "PLAYER" ? "玩家" : routeDisplayLabel(route.id)}</b></span><span>当前许可 <b>${license?.allowedUses?.join(" / ") || "无玩家许可"}</b></span><span>合同结束后保留 <b>${license?.survivesTermination ? "是" : "否"}</b></span></div></article>`; }).join("")}</div></details>
  </section>`;
}

function lifeView() {
  const selectedWeeks = [...new Set([1, 26, 52, 104, game.weekIndex - 1].filter((week) => week > 0 && week < game.weekIndex))].sort((a, b) => b - a);
  const milestones = selectedWeeks.map((week) => game.history.weeklyReports.find((report) => report.weekIndex === week)).filter(Boolean);
  const affiliations = [...game.affiliationHistory, game.affiliation].filter(Boolean);
  const eventHistory = [...game.textEvents].filter((event) => event.status === "RESOLVED").reverse();
  const retrospective = game.careerRetrospectives.at(-1);
  const lifeFilterLabels = { ALL: "全部", MILESTONES: "里程碑", IDENTITY: "角色与所属", EVENTS: "事件选择" };
  return `<section class="page-stack"><div class="page-heading compact-heading"><div><p class="eyebrow">生涯记录</p><h1>生涯</h1><p>转籍或更换角色后，历史记录均保留。</p></div></div>
    ${game.careerEnding ? `<section class="career-ending-banner"><span>生涯已归档 · ${game.careerEnding.endedAt}</span><b>${CAREER_ENDING_LABELS[game.careerEnding.outcomeId] || game.careerEnding.outcomeId}</b><p>生涯已按你的选择归档。历史记录只读，可继续导出。</p></section>` : ""}
    <section class="life-summary"><article><span>已经营</span><b>${game.weekIndex - 1} 周</b><small>当前第 ${game.weekIndex} 周</small></article><article><span>公开内容</span><b>${game.history.contents.length}</b><small>${game.history.portfolioWorks.length} 项代表作品</small></article><article><span>合作</span><b>${game.collaborationHistory.length}</b><small>${new Set(game.collaborationHistory.map((item) => item.npcId)).size} 位伙伴</small></article><article><span>历史所属</span><b>${affiliations.length}</b><small>当前 ${affiliationLabel()}</small></article></section>
    <div class="filter-bar life-filter" role="group" aria-label="生涯历史筛选">${Object.entries(lifeFilterLabels).map(([id, label]) => `<button class="secondary-action ${ui.lifeFilter === id ? "is-selected" : ""}" data-life-filter="${id}" aria-pressed="${ui.lifeFilter === id}">${label}</button>`).join("")}</div>
    ${retrospective ? `<details class="fold-panel"><summary><span><b>第 ${retrospective.throughWeek} 周生涯回顾</b><small>${GOALS[retrospective.goalEvaluation.goalId]} · ${retrospective.goalEvaluation.achieved ? "达成" : "继续积累"}</small></span><i>展开</i></summary><div class="fold-content retrospective-inline"><p>${escapeHtml(retrospective.outcomePolicy)}</p><div class="career-evaluation"><div><span>作品</span><b>${retrospective.works.published}</b></div><div><span>合作</span><b>${retrospective.collaborations.completed}</b></div><div><span>转籍</span><b>${retrospective.transfers.completed}</b></div><div><span>平均压力</span><b>${retrospective.healthLoad.averageStress}</b></div></div></div></details>` : ""}
    <details class="fold-panel" ${ui.lifeFilter === "MILESTONES" ? "open" : ""} ${!["ALL", "MILESTONES"].includes(ui.lifeFilter) ? "hidden" : ""}><summary><span><b>阶段里程碑</b><small>${milestones.length ? `${milestones.length} 个关键周摘要` : "完成周结算后生成"}</small></span><i>${ui.lifeFilter === "MILESTONES" ? "收起" : "展开"}</i></summary><div class="fold-content milestone-list">${milestones.length ? milestones.map((report) => `<article><span>第 ${report.weekIndex} 周 · ${report.dateEnd}</span><b>${report.subscribers.toLocaleString()} 订阅 · 本周 ${signed(report.subscriberDelta)}</b><small>独立观众约 ${compact(report.weeklyUniqueEstimate)} · 周末疲劳 ${report.state.fatigue} / 压力 ${report.state.stress}</small></article>`).join("") : `<div class="empty-state"><b>尚无已确认周报</b><span>完成第一周结算后显示。</span></div>`}</div></details>
    <details class="fold-panel" ${ui.lifeFilter === "IDENTITY" ? "open" : ""} ${!["ALL", "IDENTITY"].includes(ui.lifeFilter) ? "hidden" : ""}><summary><span><b>角色、频道与所属历史</b><small>${game.historicalCharacters.length} 个旧角色 · ${game.historicalChannels.length} 个旧频道 · ${affiliations.length} 段所属</small></span><i>${ui.lifeFilter === "IDENTITY" ? "收起" : "展开"}</i></summary><div class="fold-content history-columns"><section><h3>角色</h3>${[...game.historicalCharacters, game.character].map((item) => `<p><b>${escapeHtml(item.name)}</b><span>${item.active ? "当前活动" : "已归档"}</span></p>`).join("")}</section><section><h3>频道</h3>${[...game.historicalChannels, game.channel].map((item) => `<p><b>${escapeHtml(item.id)}</b><span>${Number(item.subscribers || 0).toLocaleString()} 订阅 · ${item.id === game.channel.id ? "当前" : "历史"}</span></p>`).join("")}</section><section><h3>所属</h3>${affiliations.map((item) => `<p><b>${item.agencyId ? agencyDisplayLabel(item.agencyId) : routeDisplayLabel("indie")}</b><span>${item.effectiveFrom} — ${item.effectiveTo || "当前"}</span></p>`).join("")}</section></div></details>
    <details class="fold-panel" ${ui.lifeFilter === "EVENTS" ? "open" : ""} ${!["ALL", "EVENTS"].includes(ui.lifeFilter) ? "hidden" : ""}><summary><span><b>关键事件选择</b><small>${eventHistory.length} 件已处理事件</small></span><i>${ui.lifeFilter === "EVENTS" ? "收起" : "展开"}</i></summary><div class="fold-content invitation-history">${eventHistory.length ? eventHistory.slice(0, 20).map((event) => `<article><span>第 ${event.weekIndex} 周 · ${event.explanationTags.join(" / ")}</span><b>${escapeHtml(event.title)}</b><small>${event.decisions.map((decision) => `${decision.stageId}: ${decision.choiceId}`).join(" → ")}</small></article>`).join("") : `<div class="empty-state"><b>尚无已处理事件</b><span>已处理事件的选择（含默认选项）会记录在这里。</span></div>`}</div></details>
  </section>`;
}

function settingsView() {
  const pack = activeNamePack();
  const saveMetadata = loadSaveMetadata();
  const savedAt = saveMetadata?.savedAt ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(saveMetadata.savedAt)) : "尚无时间记录";
  return `<section class="page-stack"><div class="page-heading compact-heading"><div><p class="eyebrow">存档与设置</p><h1>存档与规则</h1><p>管理本地存档、规则版本与显示选项。</p></div></div>
    <div class="settings-grid"><article><span class="section-kicker">当前存档</span><h2>第 ${game.weekIndex} 周 · 版本 ${game.snapshotVersion}</h2><p>最后保存 ${savedAt}；保留最近 3 份成功快照。</p><div class="button-row"><button class="secondary-action" data-export>导出 JSON</button><label class="secondary-action file-button">导入 JSON<input type="file" data-import accept="application/json" /></label></div></article><article><span class="section-kicker">规则版本</span><h2>已锁定</h2><dl><div><dt>平台</dt><dd>${game.rulesets.platform}</dd></div><div><dt>平衡</dt><dd>${game.rulesets.balance}</dd></div><div><dt>内容</dt><dd>${game.rulesets.content}</dd></div></dl></article></div>
    <details class="fold-panel"><summary><span><b>本地快照</b><small>${loadBackups().length} / 3 份备份</small></span><i>展开</i></summary><div class="fold-content"><p class="plain-note">修改排期与周结算时自动保存。清除浏览器数据会删除本地快照，建议定期导出。</p></div></details>
    <details class="fold-panel"><summary><span><b>显示与辅助选项</b><small>${pack.label} · ${game.preferences.reduceMotion ? "已减少动效" : "标准动效"}</small></span><i>展开</i></summary><div class="fold-content preference-panel"><label><span>名称包</span><select data-name-pack>${Object.values(NAME_PACKS).map((item) => `<option value="${item.id}" ${item.id === pack.id ? "selected" : ""}>${item.label}</option>`).join("")}</select><small>${escapeHtml(pack.releaseNote)}</small></label><label class="toggle-setting"><input type="checkbox" data-reduce-motion ${game.preferences.reduceMotion ? "checked" : ""} /><span><b>减少界面动效</b><small>关闭面板过渡、滚动动画与数值动画。</small></span></label><button class="primary-action" data-save-preferences>保存显示设置</button></div></details>
    <details class="fold-panel danger-fold"><summary><span><b>重新开始</b><small>删除当前浏览器中的主存档</small></span><i>展开</i></summary><div class="fold-content"><button class="danger-action" data-reset>删除当前存档并重新创建</button></div></details>
  </section>`;
}

function activityDialog() {
  if (ui.selectedSlot == null || game.phase !== "PLANNING") return "";
  const slot = game.plan[ui.selectedSlot];
  const day = DAY_NAMES[Math.floor(ui.selectedSlot / 2)];
  const acceptedSponsors = game.sponsorships.filter((deal) => deal.status === "ACCEPTED");
  const collaborationReservations = game.collaborationReservations.filter((reservation) => reservation.weekIndex === game.weekIndex && reservation.slotIndex === ui.selectedSlot && reservation.status === "CONFIRMED" && !game.plan.some((slot) => slot.index !== ui.selectedSlot && slot.targetId === reservation.id));
  const pendingMembershipPromises = game.history.membershipPromises.filter((promise) => ["DUE", "OVERDUE"].includes(promise.status)).sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  const designProjects = game.projects.filter((project) => project.type === "MERCH" && project.status === "DESIGNING");
  const longWorkProjects = game.projects.filter((project) => project.type === "LONG_TERM" && project.status === "PRODUCTION" && project.workCompleted < project.workRequired);
  const interviewApplications = game.auditionApplications.filter((application) => ["INTERVIEW_1", "INTERVIEW_2"].includes(application.status));
  const identityTransfers = game.transferCases.filter((transfer) => transfer.status === "ASSET_AND_OBLIGATION_PLAN" && transfer.identityPreparation?.funded && transfer.identityPreparation.completedUnits < transfer.identityPreparation.requiredUnits);
  const candidateForecast = (actionId) => {
    const pairId = slot.pairId;
    const plan = game.plan.map((item) => (item.index === ui.selectedSlot ? { ...item, actionId, targetId: null, targetType: null, pairId: null } : pairId && item.pairId === pairId ? { ...item, actionId: null, targetId: null, targetType: null, pairId: null } : item));
    return forecastPlan({ ...game, plan }).slots[ui.selectedSlot];
  };
  const profile = balanceOf(game);
  const actionNote = (id, action) => {
    if (action.unavailable) return action.unavailable;
    if (["live", "video"].includes(action.kind)) {
      const forecast = candidateForecast(id);
      return `质量 ${spanLabel(forecast.quality.map(Math.round))} · 订阅 ${spanLabel(forecast.subscribers, "+")} · 疲劳 ${signed(action.fatigue)}${forecast.overloadRisk ? ` · 过载 ${Math.round(forecast.overloadRisk * 100)}%` : ""}<br>${forecastFactors(forecast)}`;
    }
    const load = slotLoad(profile, id, game.performer);
    return `${action.slots} 格 · 疲劳 ${signed(load.fatigue)} · 压力 ${signed(load.stress)}${action.income ? ` · 到账 ${money(action.income)}` : ""}${id === "PREPARE_CONTENT" ? " · 下一条内容准备 +20" : ""}${id === "REST" && profile.recovery.model === "PROPORTIONAL" ? " · 越累恢复越多" : ""}`;
  };
  const groups = [
    ["内容", ["LIVE_GAME", "LIVE_CHAT", "LIVE_MUSIC", "MAKE_SHORT", "EDIT_VIDEO"]],
    ["准备与成长", ["PREPARE_CONTENT", "PRACTICE", "REVIEW", "NETWORK"]],
    ["经营与职业", ["BUSINESS_ADMIN", "PROJECT_WORK", "PART_TIME"]],
    ["恢复", ["REST"]],
  ];
  const collaborationSection = collaborationReservations.length ? `<section class="sponsor-pick collaboration-pick"><h3>已确认的联动</h3><div>${collaborationReservations.map((reservation) => { const npc = game.npcs.find((item) => item.id === reservation.npcId); return `<button data-choose-action="LIVE_COLLAB" data-target-id="${escapeHtml(reservation.id)}" data-target-type="COLLAB_RESERVATION"><i class="action-swatch tone-amber"></i><span><b>${escapeHtml(npc.name)} · 联动直播</b><small>1 格 · 双方已确认档期</small></span><em>→</em></button>`; }).join("")}</div></section>` : "";
  const promiseSection = pendingMembershipPromises.length ? `<section class="sponsor-pick promise-pick"><h3>${pendingMembershipPromises.some((promise) => promise.status === "OVERDUE") ? "逾期福利 · 优先" : "本期会员福利"}</h3><div>${pendingMembershipPromises.map((promise) => `<button data-choose-action="BUSINESS_ADMIN" data-target-id="${escapeHtml(promise.id)}" data-target-type="MEMBERSHIP_PROMISE"><i class="action-swatch tone-amber"></i><span><b>兑现会员福利包</b><small>1 格 · ${promise.dueDate} 截止 · ${promise.benefits.join("＋")}</small></span><em>→</em></button>`).join("")}</div></section>` : "";
  const auditionSection = interviewApplications.length ? `<section class="sponsor-pick audition-pick"><h3>面试邀请</h3><div>${interviewApplications.map((application) => `${application.interviewPrepModifier < BALANCE.audition.interviewPrepCap ? `<button data-choose-action="AUDITION_PREP" data-target-id="${escapeHtml(application.id)}" data-target-type="AUDITION_APPLICATION"><i class="action-swatch tone-violet"></i><span><b>${escapeHtml(agencyDisplayLabel(application.agencyId))} · 面试准备</b><small>1 格 · 每格 +2 · 当前 +${application.interviewPrepModifier}/8</small></span><em>→</em></button>` : ""}<button data-choose-action="AUDITION_TEST" data-target-id="${escapeHtml(application.id)}" data-target-type="AUDITION_APPLICATION"><i class="action-swatch tone-rose"></i><span><b>${escapeHtml(agencyDisplayLabel(application.agencyId))} · ${application.status === "INTERVIEW_1" ? "第一轮面试" : "最终面试"}</b><small>1 格 · 结算时进行，成绩浮动 ±3</small></span><em>→</em></button>`).join("")}</div></section>` : "";
  const transferSection = identityTransfers.length ? `<section class="sponsor-pick audition-pick"><h3>转籍方案 · 新身份准备</h3><div>${identityTransfers.map((transfer) => `<button data-choose-action="TRANSFER_PREP" data-target-id="${escapeHtml(transfer.id)}" data-target-type="TRANSFER_CASE"><i class="action-swatch tone-violet"></i><span><b>${routeDisplayLabel(transfer.targetRouteId)} · 新身份准备</b><small>1 格 · ${transfer.identityPreparation.completedUnits}/${transfer.identityPreparation.requiredUnits} · 最早 ${transfer.identityPreparation.earliestReadyDate}</small></span><em>→</em></button>`).join("")}</div></section>` : "";
  const projectSection = designProjects.length ? `<section class="sponsor-pick project-pick"><h3>商品制作 · 项目工作</h3><div>${designProjects.map((project) => { const nextStep = project.salesMode === "DIGITAL" ? "完成后可直接开售" : project.salesMode === "READY_STOCK" ? "完成后进入备货等待" : "完成后仍需等待打样"; return `<button data-choose-action="PROJECT_WORK" data-target-id="${escapeHtml(project.id)}" data-target-type="MERCH_PROJECT"><i class="action-swatch tone-cyan"></i><span><b>${escapeHtml(project.title)}</b><small>1 格 · 设计 ${project.designWorkCompleted}/${project.designWorkRequired} · ${nextStep}</small></span><em>→</em></button>`; }).join("")}</div></section>` : "";
  const longProjectSection = longWorkProjects.length ? `<section class="sponsor-pick project-pick"><h3>长期作品 · 项目工作</h3><div>${longWorkProjects.map((project) => `<button data-choose-action="PROJECT_WORK" data-target-id="${escapeHtml(project.id)}" data-target-type="LONG_TERM_PROJECT"><i class="action-swatch tone-cyan"></i><span><b>${escapeHtml(project.title)}</b><small>1 格 · 工作 ${project.workCompleted}/${project.workRequired} · 最早 ${project.earliestPublishDate}</small></span><em>→</em></button>`).join("")}</div></section>` : "";
  const sponsorSection = acceptedSponsors.length ? `<section class="sponsor-pick"><h3>待交付商单</h3><div>${acceptedSponsors.map((deal) => `<button data-choose-action="EDIT_VIDEO" data-target-id="${escapeHtml(deal.id)}" data-target-type="SPONSOR"><i class="action-swatch tone-violet"></i><span><b>${escapeHtml(deal.brandName)} 商单内容</b><small>1 格 · ${deal.dueDate} 前交付 · 已签合同</small></span><em>→</em></button>`).join("")}</div></section>` : "";
  return `<div class="dialog-backdrop" data-close-dialog><section class="activity-drawer" role="dialog" aria-modal="true" aria-labelledby="activity-title" tabindex="-1" data-dialog-panel><header><div><span>${day} · ${TIME_NAMES[ui.selectedSlot % 2]}</span><h2 id="activity-title">安排一个活动</h2></div><button data-close-dialog aria-label="关闭">×</button></header>${slot.actionId && !slot.locked && !slot.flexibleLife ? `<div class="drawer-current"><span>当前安排<b>${ACTIONS[slot.actionId].label}</b></span><button class="secondary-action" data-remove-slot="${ui.selectedSlot}">清空此格</button></div>` : ""}<div class="activity-groups">${collaborationSection}${transferSection}${auditionSection}${promiseSection}${longProjectSection}${projectSection}${sponsorSection}${groups.map(([name, ids]) => `<section><h3>${name}</h3><div>${ids.map((id) => { const action = ACTIONS[id]; return `<button data-choose-action="${id}" ${action.unavailable ? "disabled" : ""}><i class="action-swatch tone-${action.tone}"></i><span><b>${action.label}</b><small>${actionNote(id, action)}</small></span><em>→</em></button>`; }).join("")}</div></section>`).join("")}</div>${slot.flexibleLife ? `<footer><span>此格原为生活保留时间。</span><label><input type="checkbox" data-confirm-life /> 我确认把这一格转为工作</label></footer>` : ""}</section></div>`;
}

function reportNotices(report) {
  const notices = [];
  if (report.cancelledSlots?.length) notices.push(`疲劳过高，${report.cancelledSlots.length} 个格子因身体不适临时取消：${report.cancelledSlots.map((item) => `${slotLabel(item.slotIndex)} ${ACTIONS[item.actionId].shortLabel}`).join("、")}。下周留出休息格可避免。`);
  if (report.cashShortfallJpy) notices.push(`自由现金不足以支付本周固定支出，缺口 ${money(report.cashShortfallJpy)} 靠压缩生活撑过，压力上升、动力下降。可以安排兼职或减少开支。`);
  if (report.expenses && BigInt(report.expenses.channelOperationsJpy) > 0n) notices.push(`本周频道运营支出 ${money(report.expenses.channelOperationsJpy)}，随订阅规模增长。`);
  return notices.length ? `<ul class="report-notices">${notices.map((item) => `<li>${item}</li>`).join("")}</ul>` : "";
}

function reportSummary(report, includeDetails = true) {
  const commerce = report.commerce || { scGrossJpy: "0", scCreatorEarnedJpy: "0", membershipGrossJpy: "0", membershipCreatorEarnedJpy: "0", membersJoined: 0, membershipPromisesFulfilled: 0, adsChannelNetJpy: "0", adsCreatorEarnedJpy: "0", sponsorGrossJpy: "0", sponsorCreatorEarnedJpy: "0" };
  return `<div class="report-summary">
    <div class="report-numbers"><div><span>订阅变化</span><b>${signed(report.subscriberDelta)}</b></div><div><span>独立观众</span><b>约 ${compact(report.weeklyUniqueEstimate)}</b></div><div><span>平均同接</span><b>${report.averageConcurrent == null ? "—" : compact(report.averageConcurrent)}</b></div><div><span>现金变化</span><b>${signed(report.cashChange)} 日元</b></div></div>
    ${reportNotices(report)}
    ${includeDetails ? `<details><summary>查看内容计算依据</summary><div class="result-list">${report.contents.length ? report.contents.map((content) => `<article><div><b>${ACTIONS[content.actionId].label}${content.sponsorship ? " · 商单交付" : ""}</b><span>${content.publishedAt}</span></div><div><span>质量 <b>${content.quality}</b></span><span>独立观众 <b>约 ${compact(content.uniqueEstimate)}</b></span><span>订阅 <b>${signed(content.subscriberDelta)}</b></span></div><p>${content.reasons.join(" · ")}</p></article>`).join("") : `<p>本周没有直播或视频；平均同接显示为“—”。</p>`}</div></details>
    <details><summary>查看本周收入明细</summary><div class="commerce-report"><div><span>SC 付款发生额</span><b>${money(commerce.scGrossJpy)}</b></div><div><span>SC 主播归属</span><b>${money(commerce.scCreatorEarnedJpy)}</b></div><div><span>会员付款发生额</span><b>${money(commerce.membershipGrossJpy)}</b></div><div><span>新增会员</span><b>${commerce.membersJoined} 人</b></div><div><span>兑现福利周期</span><b>${commerce.membershipPromisesFulfilled || 0} 项</b></div><div><span>平台后广告</span><b>${money(commerce.adsChannelNetJpy || 0)}</b></div><div><span>广告主播归属</span><b>${money(commerce.adsCreatorEarnedJpy || 0)}</b></div><div><span>商单合同总额</span><b>${money(commerce.sponsorGrossJpy || 0)}</b></div><div><span>商单主播归属</span><b>${money(commerce.sponsorCreatorEarnedJpy || 0)}</b></div><p>主播应得收入先计入应收，到账后才计入自由现金。本周旧应收到款 ${money(report.dueReceiptsJpy || 0)}。个人商单预付款在交付前仍属于负债。</p></div></details>` : ""}
  </div>`;
}

function reportDialog() {
  const report = game.history.weeklyReports.at(-1);
  if (!report) return "";
  return `<div class="dialog-backdrop report-backdrop"><section class="report-dialog" role="dialog" aria-modal="true" aria-labelledby="report-title"><header><span>第 ${report.weekIndex} 周 · 周报</span><button data-close-report aria-label="暂时关闭周报">×</button></header><div class="report-hero"><p>${dateLabel(report.dateStart)} — ${dateLabel(report.dateEnd)}</p><h2 id="report-title">本周结算结果</h2><span>结算结果已写入存档。</span></div>${reportSummary(report, true)}<div class="report-state"><h3>周末状态</h3>${statusMeter("疲劳", report.state.fatigue, true)}${statusMeter("压力", report.state.stress, true)}${statusMeter("创作动力", report.state.motivation)}${statusMeter("身体状态", report.state.physicalCondition)}</div><footer><button class="secondary-action" data-close-report>留在本周查看</button><button class="primary-action" data-next-week>${isCareerReviewWeek(game, report.weekIndex) && !game.careerRetrospectives.some((item) => item.throughWeek === report.weekIndex) ? `确认周报，查看${retrospectivePeriodLabel(report.weekIndex)}回顾` : `确认周报，进入第 ${report.weekIndex + 1} 周`} →</button></footer></section></div>`;
}

function retrospectiveDialog() {
  const review = game.careerRetrospectives.at(-1);
  if (!review || game.phase !== "RETROSPECTIVE") return "";
  const income = Object.values(review.incomeStructure).reduce((sum, value) => sum + BigInt(value), 0n);
  return `<div class="dialog-backdrop report-backdrop"><section class="report-dialog retrospective-dialog" role="dialog" aria-modal="true" aria-labelledby="retrospective-title"><header><span>截至第 ${review.throughWeek} 周 · 生涯回顾</span></header><div class="report-hero"><p>${dateLabel(game.createdAt)} — ${dateLabel(weekDateRange(review.throughWeek).end)}</p><h2 id="retrospective-title">${retrospectivePeriodLabel(review.throughWeek)}回顾</h2><span>可以继续经营，也可以选择结束本次生涯。</span></div><div class="retrospective-grid"><article><span>公开作品</span><b>${review.works.published}</b><small>代表作 ${review.works.portfolio} · 完结项目 ${review.works.projects}</small></article><article><span>完成合作</span><b>${review.collaborations.completed}</b><small>${review.collaborations.partners} 位不同合作对象</small></article><article><span>所属变化</span><b>${review.transfers.completed}</b><small>${review.transfers.affiliationHistory} 段历史所属</small></article><article><span>累计归属收入</span><b>${compact(income)}</b><small>跨平台、商单、商品与项目记录</small></article><article><span>平均负荷</span><b>${review.healthLoad.averageFatigue} / ${review.healthLoad.averageStress}</b><small>疲劳 / 压力 · 身体 ${review.healthLoad.currentPhysicalCondition}</small></article><article><span>${GOALS[review.goalEvaluation.goalId]}</span><b>${review.goalEvaluation.achieved ? "已达成" : "继续积累"}</b><small>目标专属评价</small></article></div><details class="micro-fold"><summary>查看收入结构与关键选择</summary><div class="retrospective-details"><p>${Object.entries(review.incomeStructure).map(([key, value]) => `${key}：${money(value)}`).join(" · ")}</p><p>${review.keyChoices.length ? review.keyChoices.map((item) => `${item.title}［${item.choices.join(" → ")}］`).join("；") : "本阶段没有已处理事件。"}</p></div></details><details class="micro-fold career-ending-fold"><summary>主动结束并归档本次生涯</summary><p>结束后历史记录保留。以下选项不分优劣。</p><div>${Object.entries(CAREER_ENDING_LABELS).map(([id, label]) => `<button class="secondary-action" data-end-career="${id}">${label}</button>`).join("")}</div></details><p class="retrospective-policy">${escapeHtml(review.outcomePolicy)}</p><footer><button class="primary-action" data-continue-career>继续经营，进入第 ${review.throughWeek + 1} 周 →</button></footer></section></div>`;
}

function confirmationDialog() {
  const item = ui.confirmation;
  if (!item) return "";
  const rows = [
    ["当前方案", item.currentPlan],
    ["成本与资金", item.cost],
    ["将失去的权限", item.lostPermissions],
    ["仍保留的资产", item.retainedAssets],
    ["未解决事项", item.unresolvedIssues],
  ];
  return `<div class="dialog-backdrop report-backdrop confirmation-backdrop"><section class="confirmation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirmation-title" tabindex="-1" data-confirm-dialog><header><span>操作确认</span><button data-confirm-choice="cancel" aria-label="取消并关闭">×</button></header><div class="confirmation-copy"><p>重大操作确认</p><h2 id="confirmation-title">${escapeHtml(item.title)}</h2><span>请逐项核对。取消不会改变存档。</span></div><dl>${rows.map(([label, value]) => `<div><dt>${label}</dt><dd>${escapeHtml(value || "无")}</dd></div>`).join("")}</dl><footer><button class="secondary-action" data-confirm-choice="cancel">返回检查</button><button class="${item.danger ? "danger-action" : "primary-action"}" data-confirm-choice="accept">${escapeHtml(item.actionLabel || "确认继续")}</button></footer></section></div>`;
}

function requestConfirmation(details) {
  ui.focusReturn = activeFocusSelector();
  ui.confirmation = details;
  return new Promise((resolve) => {
    pendingConfirmationResolve = resolve;
    render();
  });
}

function activeFocusSelector() {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) return null;
  if (active.dataset.contentId) return `[data-content-control="${CSS.escape(active.dataset.contentId)}"]`;
  for (const key of ["transferCommand", "auditionCommand", "longCommand", "merchCommand", "contentVisibility"]) {
    if (active.dataset[key]) return `[data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${CSS.escape(active.dataset[key])}"]`;
  }
  if (active.matches("[data-import]")) return "[data-import]";
  if (active.matches(".creation-submit")) return ".creation-submit";
  return null;
}

function closeConfirmation(accepted) {
  const resolve = pendingConfirmationResolve;
  pendingConfirmationResolve = null;
  ui.confirmation = null;
  render();
  resolve?.(accepted);
}

function bindConfirmation() {
  root.querySelectorAll("[data-confirm-choice]").forEach((button) => button.addEventListener("click", () => closeConfirmation(button.dataset.confirmChoice === "accept")));
}

// 成功提示数秒后自动淡出；错误提示保留到玩家手动关闭。只移除提示节点，不整页重绘，避免打断正在进行的操作。
const NOTICE_AUTO_DISMISS_MS = 4000;
let noticeTimer = null;
let noticeTimerFor = null;

function scheduleNoticeDismiss() {
  const notice = ui.notice;
  if (notice === noticeTimerFor) return;
  clearTimeout(noticeTimer);
  noticeTimerFor = notice;
  if (!notice || notice.tone === "error") return;
  noticeTimer = setTimeout(() => {
    if (ui.notice !== notice) return;
    ui.notice = null;
    root.querySelector(".toast")?.remove();
  }, NOTICE_AUTO_DISMISS_MS);
}

function render() {
  if (!game) return renderCreation();
  const views = { overview: overviewView, schedule: scheduleView, channel: channelView, projects: projectsView, industry: industryView, finance: financeView, career: careerView, life: lifeView, settings: settingsView };
  root.innerHTML = shell((views[ui.view] || overviewView)());
  restoreFolds();
  scheduleNoticeDismiss();
  root.classList.toggle("reduce-motion", game.preferences.reduceMotion);
  if (game.phase === "RETROSPECTIVE") root.insertAdjacentHTML("beforeend", retrospectiveDialog());
  if (ui.confirmation) root.insertAdjacentHTML("beforeend", confirmationDialog());
  bindGame();
  bindConfirmation();
  requestAnimationFrame(() => {
    if (ui.confirmation) root.querySelector("[data-confirm-dialog]")?.focus();
    else if (ui.selectedSlot != null) root.querySelector("[data-dialog-panel]")?.focus();
    else if (ui.moreOpen) root.querySelector("[data-more-panel] button")?.focus();
    else if (ui.reportOpen) root.querySelector("[data-close-report]")?.focus();
    else if (ui.focusReturn) {
      const target = firstVisible(ui.focusReturn) || firstVisible(`[data-view="${ui.view}"]`);
      target?.focus();
      ui.focusReturn = null;
    }
    centerActiveTab();
  });
}

function firstVisible(selector) {
  return [...root.querySelectorAll(selector)].find((node) => node.getClientRects().length) || null;
}

function closeMoreSheet() {
  ui.moreOpen = false;
  ui.focusReturn = "[data-open-more]";
  render();
}

// 平板宽度下顶部导航横向滚动，保证当前页标签始终可见。只改导航自身的 scrollLeft，不滚动页面。
function centerActiveTab() {
  const nav = root.querySelector(".primary-nav");
  const active = nav?.querySelector("button.active");
  if (!active || nav.scrollWidth <= nav.clientWidth) return;
  nav.scrollLeft = active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2;
}

// 整页重绘会重置 <details> 的展开状态。按「页面 + 面板标题」记住玩家手动展开或收起的面板；
// 若模板给出的默认状态发生变化（如筛选切换、出现紧急事项），以模板为准并丢弃旧记录。
function foldKeyOf(detail, seen) {
  const summary = detail.querySelector(":scope > summary");
  const base = detail.id || summary?.dataset.contentControl || (summary?.querySelector("b")?.textContent || summary?.textContent || "").trim();
  const occurrence = seen.get(base) || 0;
  seen.set(base, occurrence + 1);
  return `${ui.view}|${base}|${occurrence}`;
}

function restoreFolds() {
  ui.folds ||= {};
  ui.foldDefaults ||= {};
  const seen = new Map();
  root.querySelectorAll("details").forEach((detail) => {
    const key = foldKeyOf(detail, seen);
    detail.dataset.foldKey = key;
    const templateOpen = detail.open;
    const previousDefault = ui.foldDefaults[key];
    ui.foldDefaults[key] = templateOpen;
    if (!(key in ui.folds)) return;
    if (previousDefault !== undefined && previousDefault !== templateOpen) { delete ui.folds[key]; return; }
    detail.open = ui.folds[key];
    const marker = detail.querySelector(":scope > summary > i");
    if (marker) marker.textContent = detail.open ? "收起" : "展开";
  });
}

function bindGame() {
  root.querySelectorAll("[data-view]").forEach((button) => button.addEventListener("click", () => { ui.view = button.dataset.view; ui.selectedSlot = null; ui.moreOpen = false; ui.notice = null; render(); window.scrollTo({ top: 0, behavior: "smooth" }); }));
  root.querySelectorAll("[data-finance-filter]").forEach((button) => button.addEventListener("click", () => { ui.financeFilter = button.dataset.financeFilter; ui.financeTransactionsOpen = true; ui.financeTransactionLimit = 40; render(); }));
  root.querySelector("[data-load-more-content]")?.addEventListener("click", () => { ui.contentLimit += 40; render(); });
  root.querySelector("[data-load-more-transactions]")?.addEventListener("click", () => { ui.financeTransactionLimit += 40; ui.financeTransactionsOpen = true; render(); });
  root.querySelector("[data-load-more-journals]")?.addEventListener("click", () => { ui.financeJournalLimit += 40; render(); });
  root.querySelectorAll("[data-life-filter]").forEach((button) => button.addEventListener("click", () => { ui.lifeFilter = button.dataset.lifeFilter; render(); }));
  root.querySelectorAll("[data-content-visibility]").forEach((button) => button.addEventListener("click", async () => {
    const visibility = button.dataset.contentVisibility;
    const contentId = button.dataset.contentId;
    if (visibility === "DELETED") {
      const accepted = await requestConfirmation({ title: "永久删除这条内容", actionLabel: "确认删除", danger: true, currentPlan: "删除后内容状态不可恢复，也不能再次公开", cost: "不退款；既有收入与财务凭证不回滚", lostPermissions: "失去重新公开、传播委托与继续计入资格的权限", retainedAssets: "历史内容记录、已结算观看、订阅与收入完整保留", unresolvedIssues: "90 日上传与 12 个月观看资格将立即重算" });
      if (!accepted) return;
    }
    const result = await dispatchCommand("CHANGE_CONTENT_VISIBILITY", { contentId, visibility, date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: visibility === "DELETED" ? "error" : "success", text: visibility === "DELETED" ? "内容已删除并保留历史凭证；资格窗口已重算。" : `内容已改为${VISIBILITY_LABELS[visibility]}；资格窗口已重算，既有收入保持不变。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelector("[data-save-preferences]")?.addEventListener("click", async () => {
    const result = await dispatchCommand("UPDATE_PREFERENCES", { reduceMotion: Boolean(root.querySelector("[data-reduce-motion]")?.checked), namePackId: root.querySelector("[data-name-pack]")?.value });
    if (result.ok) { game = result.state; await saveGame(game); ui.notice = { tone: "success", text: "显示设置已保存。" }; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  });
  root.querySelectorAll("[data-submit-invitation]").forEach((button) => button.addEventListener("click", async () => {
    const npcId = button.dataset.submitInvitation;
    const selector = root.querySelector(`[data-invite-slot="${npcId}"]`);
    const result = await dispatchCommand("SUBMIT_INVITATION", { npcId, slotIndex: Number(selector?.value) });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const invitation = game.collaborationInvitations.at(-1);
      ui.notice = { tone: invitation.status === "ACCEPTED" ? "success" : "error", text: invitation.response };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-respond-npc-invitation]").forEach((button) => button.addEventListener("click", async () => {
    const accept = button.dataset.accept === "true";
    const result = await dispatchCommand("RESPOND_NPC_INVITATION", { invitationId: button.dataset.respondNpcInvitation, accept });
    if (result.ok) { game = result.state; await saveGame(game); ui.notice = { tone: "success", text: game.npcInvitations.find((item) => item.id === button.dataset.respondNpcInvitation).responseResult }; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-open-collab-slot]").forEach((button) => button.addEventListener("click", () => {
    ui.view = "schedule";
    ui.selectedSlot = Number(button.dataset.openCollabSlot);
    ui.notice = null;
    render();
  }));
  root.querySelectorAll("[data-resolve-event]").forEach((button) => button.addEventListener("click", async () => {
    const result = await dispatchCommand("RESOLVE_TEXT_EVENT", { eventId: button.dataset.resolveEvent, choiceId: button.dataset.eventChoice });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const event = game.textEvents.find((item) => item.id === button.dataset.resolveEvent);
      ui.notice = { tone: "success", text: event.status === "PENDING" ? `第一阶段已记录：${event.title}` : "事件已处理。" };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelector("[data-skip-tutorial]")?.addEventListener("click", async () => {
    const result = await dispatchCommand("SKIP_TUTORIAL", {});
    if (result.ok) { game = result.state; await saveGame(game); ui.notice = { tone: "success", text: "已跳过新手引导。" }; }
    render();
  });
  root.querySelectorAll("[data-tutorial-step]").forEach((button) => button.addEventListener("click", async () => {
    const stepId = button.dataset.tutorialStep;
    const target = { AUDIENCE_METRICS: "channel", FINANCE_LAYERS: "finance", CONTRACT_ASSETS: "career" }[stepId];
    const result = await dispatchCommand("ACKNOWLEDGE_TUTORIAL_STEP", { stepId, date: weekDateRange(game.weekIndex).start });
    if (result.ok) { game = result.state; await saveGame(game); ui.view = target; ui.notice = { tone: "success", text: "已完成该引导步骤。" }; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-create-propagation]").forEach((button) => button.addEventListener("click", async () => {
    const label = button.dataset.createPropagation === "CLIP_EDIT" ? "公开切片" : "字幕翻译";
    if (!confirm(`确认创建${label}付费委托？许可只覆盖此内容和所列用途，不包含任意转载。`)) return;
    const result = await dispatchCommand("CREATE_PROPAGATION_COMMISSION", { sourceContentId: button.dataset.sourceContent, serviceType: button.dataset.createPropagation, targetLanguage: button.dataset.targetLanguage || null, date: weekDateRange(game.weekIndex).start });
    if (result.ok) { game = result.state; await saveGame(game); ui.notice = { tone: "success", text: `${label}委托已创建；完成后增加推荐曝光，不直接带来订阅。` }; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelector("[data-continue-career]")?.addEventListener("click", async () => {
    const result = await dispatchCommand("CONTINUE_AFTER_RETROSPECTIVE", {});
    if (result.ok) { game = result.state; await saveGame(game); ui.view = "overview"; ui.notice = { tone: "success", text: `${retrospectivePeriodLabel(game.weekIndex - 1)}回顾已保存。第 ${game.weekIndex} 周开始。${nextCareerReviewWeek(game) ? `第 ${nextCareerReviewWeek(game)} 周会再生成一次回顾。` : ""}` }; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  });
  root.querySelectorAll("[data-end-career]").forEach((button) => button.addEventListener("click", async () => {
    const outcomeId = button.dataset.endCareer;
    const accepted = await requestConfirmation({ title: `${CAREER_ENDING_LABELS[outcomeId]}并归档`, actionLabel: "确认结束本次生涯", danger: true, currentPlan: `在第 ${game.weekIndex} 周以“${CAREER_ENDING_LABELS[outcomeId]}”结束生涯`, cost: "无额外费用；既有责任照常保留", lostPermissions: "不能再推进周次、修改排期或启动新经营项目", retainedAssets: "作品、订阅、角色、频道、合同、全部财务流水与回顾可继续查看和导出", unresolvedIssues: "未交付订单、应收、应付与合同责任只读保留，不会被终止操作抹除" });
    if (!accepted) return;
    const result = await dispatchCommand("END_CAREER", { outcomeId, date: weekDateRange(game.weekIndex).end });
    if (result.ok) { game = result.state; await saveGame(game); ui.view = "life"; ui.notice = { tone: "success", text: "生涯已归档，历史记录可查看与导出。" }; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelector("[data-dismiss-notice]")?.addEventListener("click", () => { ui.notice = null; render(); });
  root.querySelectorAll("[data-pick-slot]").forEach((button) => button.addEventListener("click", () => { ui.selectedSlot = Number(button.dataset.pickSlot); render(); }));
  root.querySelectorAll("[data-remove-slot]").forEach((button) => button.addEventListener("click", async () => {
    const slotIndex = Number(button.dataset.removeSlot);
    const result = await dispatchCommand("REMOVE_PLAN_ACTION", { slotIndex });
    if (result.ok) { game = result.state; await saveGame(game); ui.selectedSlot = null; ui.focusReturn = `[data-pick-slot="${slotIndex}"]`; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-close-dialog]").forEach((node) => node.addEventListener("click", (event) => { if (event.currentTarget === event.target || event.currentTarget.matches("button")) { ui.focusReturn = `[data-pick-slot="${ui.selectedSlot}"]`; ui.selectedSlot = null; render(); } }));
  root.querySelector("[data-dialog-panel]")?.addEventListener("click", (event) => event.stopPropagation());
  root.querySelectorAll("[data-choose-action]").forEach((button) => button.addEventListener("click", async () => {
    const confirmFlexibleLife = Boolean(root.querySelector("[data-confirm-life]")?.checked);
    const result = await dispatchCommand("UPDATE_PLAN", { slotIndex: ui.selectedSlot, actionId: button.dataset.chooseAction, confirmFlexibleLife, targetId: button.dataset.targetId || null, targetType: button.dataset.targetType || null });
    if (result.ok) { game = result.state; await saveGame(game); ui.selectedSlot = null; ui.notice = null; }
    else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelector("[data-auto-plan]")?.addEventListener("click", applySafePlan);
  root.querySelector("[data-repeat-plan]")?.addEventListener("click", repeatPreviousPlan);
  // 页面标题区与手机底部操作栏可能同时存在同一操作。
  root.querySelectorAll("[data-settle], [data-commit-week]").forEach((button) => button.addEventListener("click", runWeek));
  root.querySelectorAll("[data-open-more]").forEach((button) => button.addEventListener("click", () => { ui.moreOpen = true; render(); }));
  root.querySelector("[data-close-more]")?.addEventListener("click", (event) => { if (event.target === event.currentTarget) closeMoreSheet(); });
  root.querySelector("[data-dismiss-more]")?.addEventListener("click", closeMoreSheet);
  root.querySelector("[data-apply-fan-funding]")?.addEventListener("click", async () => {
    if (!confirm("提交后进入 7 个游戏日审核。确认接受本游戏的模拟商业条款，并申请开启 SC 与会员功能吗？")) return;
    const result = await dispatchCommand("APPLY_FAN_FUNDING", { date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: "success", text: `收益化申请已提交，预计 ${game.channel.fanFundingReviewDueDate} 完成审核。审核期间不会产生 SC。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  });
  root.querySelector("[data-apply-ads]")?.addEventListener("click", async () => {
    if (!confirm("广告收益与粉丝赞助分别审核。确认提交广告收益申请吗？")) return;
    const result = await dispatchCommand("APPLY_ADS", { date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: "success", text: `广告收益申请已提交，预计 ${game.channel.adsReviewDueDate} 完成审核。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  });
  root.querySelectorAll("[data-accept-sponsor]").forEach((button) => button.addEventListener("click", async () => {
    const deal = game.sponsorships.find((item) => item.id === button.dataset.acceptSponsor);
    const contractNote = game.routeId === "indie" ? "30% 预付款会先进入履约受限资金，交付后才确认为收入。" : "企业主导合作只把主播应得的 70% 计入个人账。";
    if (!deal || !confirm(`接受 ${deal.brandName} 的模拟商单？${contractNote}`)) return;
    const result = await dispatchCommand("ACCEPT_SPONSOR", { offerId: deal.id, date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: "success", text: `商单已签署：请在 ${deal.dueDate || result.state.sponsorships.find((item) => item.id === deal.id).dueDate} 前从排期抽屉选择“待交付商单”。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-membership-policy]").forEach((button) => button.addEventListener("click", async () => {
    const result = await dispatchCommand("SET_MEMBERSHIP_POLICY", { promisePolicy: button.dataset.membershipPolicy, chargesPaused: game.membershipProgram.chargesPaused, date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: "success", text: `未来会员周期已改为${game.membershipProgram.promisePolicy === "STANDARD" ? "标准福利包" : "轻量福利包"}；本期既有承诺没有改变。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelector("[data-toggle-membership-charges]")?.addEventListener("click", async () => {
    const nextPaused = !game.membershipProgram.chargesPaused;
    const result = await dispatchCommand("SET_MEMBERSHIP_POLICY", { promisePolicy: game.membershipProgram.promisePolicy, chargesPaused: nextPaused, date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: "success", text: nextPaused ? "新入会与续费已暂停；既有福利承诺仍需兑现。" : "新入会与续费已恢复，将继续受共享消费预算约束。" };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  });
  root.querySelector("[data-pay-refund-payable]")?.addEventListener("click", async (event) => {
    const amountJpy = event.currentTarget.dataset.payRefundPayable;
    if (!confirm(`使用自由现金支付 ${money(amountJpy)} 退款应付款？履约受限资金不会被使用。`)) return;
    const result = await dispatchCommand("PAY_REFUND_PAYABLE", { amountJpy, date: weekDateRange(game.weekIndex).start });
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      ui.notice = { tone: "success", text: `已支付 ${money(amountJpy)}，剩余退款应付款 ${money(game.liabilities.refundPayable)}。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  });
  root.querySelectorAll("[data-audition-command]").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.auditionCommand;
    const applicationId = button.dataset.applicationId || null;
    const agencyId = button.dataset.agencyId || null;
    const application = applicationId ? game.auditionApplications.find((item) => item.id === applicationId) : null;
    const agency = AGENCIES[agencyId || application?.agencyId];
    const confirmations = {
      SUBMIT_APPLICATION: "提交后锁定本轮资料与评分，订阅数不计入评分。确认提交？",
      REQUEST_AUDITION_EXTENSION: "仅可延长一次 14 日，且必须已有可验证的合同处理进度。确认申请吗？",
      BEGIN_AUDITION_CONTRACT_REVIEW: "附条件意向不等于签约。确认进入虚构标准合同审阅吗？",
      ACCEPT_AUDITION_CONTRACT_REVIEW: "确认已审阅标准条款？此步骤不会改变当前所属、角色或频道。",
      COMPLETE_AUDITION: "确认取得录取资格？后续转籍仍会独立核对合同、资产、角色与频道方案。",
      WITHDRAW_AUDITION: "确认撤回申请？申请记录将保留。",
    };
    if (type === "ACCEPT_AUDITION_CONTRACT_REVIEW") {
      const accepted = await requestConfirmation({ title: "确认已审阅标准合同", actionLabel: "接受审阅结果", currentPlan: `${agencyDisplayLabel(agency?.id) || "目标公司"} · 进入出道准备`, cost: "此步骤不立即扣款；未来收入按最终合同分层", lostPermissions: "当前所属、角色或频道不会在此步骤自动覆盖；最终转籍另行处理", retainedAssets: "既有作品、能力、工作信誉与历史记录全部保留", unresolvedIssues: "资产归属、频道控制、未交付责任仍需在转籍案中逐项确认" });
      if (!accepted) return;
    } else if (confirmations[type] && !confirm(confirmations[type])) return;
    const payload = { date: weekDateRange(game.weekIndex).start };
    if (applicationId) payload.applicationId = applicationId;
    if (agencyId) payload.agencyId = agencyId;
    const result = await dispatchCommand(type, payload);
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const current = applicationId ? game.auditionApplications.find((item) => item.id === applicationId) : game.auditionApplications.at(-1);
      ui.notice = { tone: "success", text: `${agency?.label || "招募"}流程已更新：${AUDITION_STATUS_LABELS[current?.status] || current?.status}。${current?.feedback || "状态与历史已保存。"}` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-transfer-command]").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.transferCommand;
    const transferId = button.dataset.transferId || null;
    const targetRouteId = button.dataset.targetRouteId || null;
    const assetPlanType = button.dataset.assetPlan || null;
    const transfer = transferId ? game.transferCases.find((item) => item.id === transferId) : null;
    const confirmations = {
      CREATE_TRANSFER_CASE: `建立前往 ${ROUTES[targetRouteId]?.label || "目标所属"} 的转籍案？这不会立即改变当前所属。`,
      CONFIRM_TRANSFER_PLAN: `确认选择“${assetPlanType === "KEEP_ALL" ? "保留角色与频道" : assetPlanType === "KEEP_CHARACTER_NEW_CHANNEL" ? "保留角色并新建频道" : "新角色与新频道"}”？未交付订单、项目和旧应收仍保留原责任。`,
      START_TRANSFER_NOTICE: "确认锁定资产与责任方案并开始通知期？之后仍不会在到期前改变所属。",
      SWITCH_AFFILIATION: "这是正式转籍：旧主所属与合同将在同一事务中关闭，新所属立即生效；角色和频道按已确认方案处理。确认继续吗？",
      CANCEL_TRANSFER: "确认取消尚未生效的转籍案？已发生费用、订单和履约责任不会删除。",
    };
    if (["CONFIRM_TRANSFER_PLAN", "SWITCH_AFFILIATION"].includes(type)) {
      const planLabel = assetPlanType === "KEEP_ALL" ? "保留角色与频道" : assetPlanType === "KEEP_CHARACTER_NEW_CHANNEL" ? "保留角色并新建频道" : transfer?.assetPlanType === "KEEP_ALL" ? "保留角色与频道" : transfer?.assetPlanType === "KEEP_CHARACTER_NEW_CHANNEL" ? "保留角色并新建频道" : "新角色与新频道";
      const accepted = await requestConfirmation({
        title: type === "SWITCH_AFFILIATION" ? "正式切换所属" : "锁定资产与责任方案",
        actionLabel: type === "SWITCH_AFFILIATION" ? "确认正式转籍" : "确认资产方案",
        danger: type === "SWITCH_AFFILIATION",
        currentPlan: `${planLabel} · 前往 ${routeDisplayLabel(targetRouteId || transfer?.targetRouteId)}`,
        cost: `已发生费用 ${money(transfer?.costJpy || 0)} 不撤销；旧应收按发生时合同结算`,
        lostPermissions: planLabel === "保留角色与频道" ? "按新合同重新核定内容与商业权限" : planLabel === "保留角色并新建频道" ? "失去旧频道控制与其订阅关系" : "失去旧角色使用权与旧频道控制权",
        retainedAssets: "表演者能力、履历、个人现金、既有归属收入与工作信誉保留",
        unresolvedIssues: "未交付订单、项目、退款与旧应收仍由原责任主体处理",
      });
      if (!accepted) return;
    } else if (confirmations[type] && !confirm(confirmations[type])) return;
    const payload = { date: weekDateRange(game.weekIndex).start };
    if (transferId) payload.transferId = transferId;
    if (targetRouteId) payload.targetRouteId = targetRouteId;
    if (assetPlanType) Object.assign(payload, { assetPlanType, obligationTreatment: "PRESERVE_EXISTING_RESPONSIBILITY" });
    const result = await dispatchCommand(type, payload);
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const current = transferId ? game.transferCases.find((item) => item.id === transferId) : game.transferCases.at(-1);
      ui.notice = { tone: current?.status === "PAUSED" ? "error" : "success", text: `转籍案已更新：${TRANSFER_STATUS_LABELS[current?.status] || current?.status}。${current?.pauseReason || "角色、频道、合同与责任继续分别记录。"}` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-resource-command]").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.resourceCommand;
    const payload = { date: weekDateRange(game.weekIndex).start };
    if (type === "REQUEST_AGENCY_RESOURCE") Object.assign(payload, { projectId: button.dataset.projectId, resourceType: button.dataset.resourceType, quantity: Number(button.dataset.quantity), desiredDate: button.dataset.desiredDate, weekIndex: game.weekIndex });
    else payload.roundId = button.dataset.roundId;
    const confirmation = type === "REQUEST_AGENCY_RESOURCE" ? "提交后与同批申请统一按评分排序，不按提交先后。确认提交？" : "确认按本周截止时间统一结算？名额与排序结果已确定。";
    if (!confirm(confirmation)) return;
    const result = await dispatchCommand(type, payload);
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const request = type === "REQUEST_AGENCY_RESOURCE" ? game.resourceRequests.at(-1) : game.resourceRequests.find((item) => item.roundId === payload.roundId);
      ui.notice = { tone: request?.status === "DOWNSCALED" || request?.status === "QUEUED" ? "error" : "success", text: request?.resultExplanation || "公司资源申请已进入同批结算。" };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-long-command]").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.longCommand;
    const projectId = button.dataset.projectId || null;
    const templateId = button.dataset.templateId || null;
    const selectedProject = projectId ? game.projects.find((item) => item.id === projectId) : null;
    const selectedTemplate = templateId ? LONG_PROJECT_TEMPLATE_LIST.find((item) => item.id === templateId) : null;
    const confirmations = {
      START_LONG_PROJECT: `确认正式启动并从自由现金支付 30% 启动款 ${money(selectedProject?.paymentPlan.startupJpy || 0)}？资源将预约到具体游戏日期。`,
      ENTER_LONG_PROJECT_PRODUCTION: `确认资源预约无误，并从自由现金支付 40% 制作款 ${money(selectedProject?.paymentPlan.productionJpy || 0)}？支付后仍需安排全部项目工作格。`,
      PASS_LONG_PROJECT_QUALITY: `确认质量检查通过，并从自由现金支付最后 30% 验收款 ${money(selectedProject?.paymentPlan.acceptanceJpy || 0)}？`,
      PUBLISH_LONG_PROJECT: selectedProject?.projectType === "NEW_OUTFIT" ? "确认发布新衣装资产？视觉相关制作项只增加 5 分、累计上限 20。" : "确认发布并写入独立作品、资产与作品集记录？完成不保证项目盈利。",
      CANCEL_LONG_PROJECT: `确认取消 ${selectedProject?.title || "长期项目"}？已发生的 ${money(selectedProject?.spentCostJpy || 0)} 不会返还，未落实预约会标记取消。`,
      ARCHIVE_LONG_PROJECT: "确认停止该作品的后续活动并归档？作品、资产和既有记录不会删除。",
    };
    if (type === "CANCEL_LONG_PROJECT") {
      const accepted = await requestConfirmation({ title: `取消${selectedProject?.title || "长期项目"}`, actionLabel: "确认取消项目", danger: true, currentPlan: `${LONG_PROJECT_STATUS_LABELS[selectedProject?.status] || selectedProject?.status} · ${selectedProject?.workCompleted || 0}/${selectedProject?.workRequired || 0} 工作格`, cost: `已发生 ${money(selectedProject?.spentCostJpy || 0)} 不返还`, lostPermissions: "取消未落实预约与后续发布流程", retainedAssets: "已确认付款、已完成工作与项目历史保留", unresolvedIssues: "已发生的合同、退款或交付责任仍需继续处理" });
      if (!accepted) return;
    } else if (confirmations[type] && !confirm(confirmations[type])) return;
    const payload = { date: weekDateRange(game.weekIndex).start };
    if (projectId) payload.projectId = projectId;
    if (templateId) payload.templateId = templateId;
    const result = await dispatchCommand(type, payload);
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const current = projectId ? game.projects.find((item) => item.id === projectId) : game.projects.filter((item) => item.type === "LONG_TERM").at(-1);
      ui.notice = { tone: "success", text: type === "CREATE_LONG_PROJECT" ? `${selectedTemplate?.name || "长期项目"}草案已建立；尚未扣款或占用资源。` : `长期项目已更新：${LONG_PROJECT_STATUS_LABELS[current?.status] || current?.status}。` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-merch-command]").forEach((button) => button.addEventListener("click", async () => {
    const type = button.dataset.merchCommand;
    const projectId = button.dataset.projectId || null;
    const option = button.dataset.option || null;
    const fundingModel = button.dataset.fundingModel || null;
    const templateId = button.dataset.templateId || null;
    const refundRestockable = button.dataset.refundRestockable === "true";
    const selectedProject = projectId ? game.projects.find((item) => item.id === projectId) : null;
    const selectedTemplate = templateId ? MERCH_TEMPLATE_LIST.find((item) => item.id === templateId) : null;
    const companyLed = isCompanyMerch(selectedProject) || fundingModel === "COMPANY_LED";
    const confirmations = {
      CONFIRM_MERCH_PROJECT: companyLed ? "确认由公司承担列明成本并控制商店与履约？玩家只取得正利润 30% 版税，不承担项目亏损。" : `确认启动自营商品项目并从自由现金支付 ${money(selectedProject?.fixedDesignSampleCostJpy || 0)} 固定制作成本？`,
      OPEN_MERCH_SALES: companyLed ? "确认开启 14 个游戏日公司销售？订单款只进入公司项目子账，不进入个人现金。" : selectedProject?.salesMode === "READY_STOCK" ? "确认开启 14 个游戏日现货销售？订单不能超过已经入库的可售数量。" : selectedProject?.salesMode === "DIGITAL" ? "确认开启 14 个游戏日数字商品销售？制作成本已经发生，数字商品没有实体库存。" : "确认开启 14 个游戏日预售？预售款会进入项目受限资金和客户预付款负债，不会立即成为利润。",
      BEGIN_MERCH_PRODUCTION: companyLed ? "确认由公司按订单量承担生产与商店费用并开始 28 日生产？" : "确认按订单量支付生产与商店费用并开始 28 日生产？",
      RESOLVE_MERCH_MOQ: option === "TOP_UP" ? (companyLed ? "确认由公司补足至 50 件并承担剩余库存？" : "确认使用项目受限资金与必要的自由现金补足至 50 件，并承担剩余库存？") : option === "NEGOTIATE" ? "确认以更高单件成本协商小批量生产？" : "确认取消项目并生成退款、材料残值和未付费用处理？",
      CANCEL_MERCH_PROJECT: companyLed ? "确认取消公司项目？公司负责未交付订单退款与已发生成本，个人账不承担亏损。" : selectedProject?.salesMode === "DIGITAL" ? "确认取消数字商品项目？已发生的制作成本不会消失，未交付数字订单会退款。" : selectedProject?.salesMode === "READY_STOCK" ? "确认取消少量现货项目？未交付订单会退款，已入库现货将作为材料残值保留。" : "确认取消预售项目？已发生成本不会消失，未交付预售款会生成退款处理。",
      REFUND_DELIVERED_MERCH: refundRestockable ? "确认退款 1 件，并且该商品已经实际收回、可再次销售，因此恢复 1 件库存？" : "确认退款 1 件？该商品不会恢复库存。",
      PAY_MERCH_REFUND_PAYABLE: `确认使用自由现金支付该项目的 ${money(selectedProject?.refundPayableJpy || 0)} 退款应付款？`,
      START_MERCH_FULFILLMENT: `确认开始 ${selectedProject?.timing?.fulfillmentDays || 0} 个游戏日发货处理？只有完成交付后才确认商品收入。`,
      SETTLE_MERCH_PROJECT: companyLed ? "确认售后责任已经结束并结项？系统将按公司项目正利润的 30% 生成玩家版税应收。" : "确认售后责任已经结束并结项？系统只会释放扣除成本与责任后的项目剩余资金。",
    };
    if (type === "CANCEL_MERCH_PROJECT" || (type === "RESOLVE_MERCH_MOQ" && option === "REFUND")) {
      const accepted = await requestConfirmation({ title: `取消${selectedProject?.title || "商品项目"}`, actionLabel: "确认取消并处理责任", danger: true, currentPlan: `${merchStatusLabel(selectedProject)} · ${selectedProject?.salesMode ? MERCH_MODE_LABELS[selectedProject.salesMode] : "待定销售模式"}`, cost: `${companyLed ? "公司项目成本留在公司子账" : `个人已发生成本 ${money(selectedProject?.spentCostJpy || selectedProject?.fixedDesignSampleCostJpy || 0)}`}，不会抹除`, lostPermissions: "停止后续销售、生产或发货流程", retainedAssets: "既有订单、账务、材料残值与已交付记录保留", unresolvedIssues: "未交付订单将退款；不足部分形成明确应付款，不会凭空消失" });
      if (!accepted) return;
    } else if (confirmations[type] && !confirm(confirmations[type])) return;
    const payload = { date: weekDateRange(game.weekIndex).start };
    if (projectId) payload.projectId = projectId;
    if (option) payload.option = option;
    if (fundingModel) payload.fundingModel = fundingModel;
    if (templateId) payload.templateId = templateId;
    if (type === "REFUND_DELIVERED_MERCH") {
      payload.transactionId = `merch_return_${projectId}_${game.snapshotVersion + 1}`;
      payload.cumulativeRefundOrders = Number(selectedProject.refundedOrders || 0) + 1;
      payload.cumulativeRestockableOrders = Number(selectedProject.restockedOrders || 0) + (refundRestockable ? 1 : 0);
    }
    if (type === "PAY_MERCH_REFUND_PAYABLE") payload.amountJpy = selectedProject.refundPayableJpy;
    const result = await dispatchCommand(type, payload);
    if (result.ok) {
      game = result.state;
      await saveGame(game);
      const current = projectId ? game.projects.find((item) => item.id === projectId) : game.projects.at(-1);
      ui.notice = { tone: "success", text: type === "CREATE_MERCH_PROJECT" ? (fundingModel === "COMPANY_LED" ? `${selectedTemplate?.name || "公司商品"}草案已建立；尚未发生个人收入，确认后成本进入公司项目子账。` : `${selectedTemplate?.name || "商品"}草案已建立；尚未扣款，确认项目后才会支付固定制作成本。`) : `商品项目已更新：${merchStatusLabel(current)}。${isCompanyMerch(current) ? "公司项目子账与个人版税边界已同步。" : "资金与责任已同步写入个人账。"}` };
    } else ui.notice = { tone: "error", text: result.message };
    render();
  }));
  root.querySelectorAll("[data-open-report]").forEach((button) => button.addEventListener("click", () => { ui.focusReturn = "[data-open-report]"; ui.reportOpen = true; render(); }));
  root.querySelectorAll("[data-close-report]").forEach((button) => button.addEventListener("click", () => { ui.reportOpen = false; render(); }));
  root.querySelector("[data-next-week]")?.addEventListener("click", async () => { const result = await dispatchCommand("ACKNOWLEDGE_REPORT", { weekIndex: game.weekIndex }); if (result.ok) { game = result.state; await saveGame(game); ui.reportOpen = false; ui.view = game.phase === "PLANNING" ? "schedule" : "overview"; ui.notice = game.phase === "RETROSPECTIVE" ? null : { tone: "success", text: `第 ${game.weekIndex} 周开始。` }; render(); } });
  root.querySelector("[data-export]")?.addEventListener("click", async () => {
    try {
      await exportGame(game);
      ui.notice = { tone: "success", text: "存档已导出（含规则版本与校验信息）。" };
    } catch (error) {
      ui.notice = { tone: "error", text: `导出失败：${error.message}` };
    }
    render();
  });
  root.querySelector("[data-import]")?.addEventListener("change", handleImport);
  root.querySelector("[data-reset]")?.addEventListener("click", async () => {
    const accepted = await requestConfirmation({ title: "删除当前本地主存档", actionLabel: "确认删除存档", danger: true, currentPlan: `删除第 ${game.weekIndex} 周本地主存档并返回创建页`, cost: "不涉及真实付款；浏览器内进度不可恢复", lostPermissions: "失去当前主存档与本地自动备份的访问", retainedAssets: "此前手动导出的 JSON 文件不受影响", unresolvedIssues: "如需保留进度，请先返回设置页导出 JSON" });
    if (accepted) { await clearGame(); game = null; ui = { view: "overview", selectedSlot: null, notice: null, busy: false, createRoute: "indie", abilityPreset: "balanced", reportOpen: false, confirmation: null, focusReturn: null, creationDraft: null, financeFilter: "ALL", financeTransactionsOpen: false, financeTransactionLimit: 40, financeJournalLimit: 40, contentLimit: 40, lifeFilter: "ALL" }; render(); }
  });
  root.querySelectorAll("[data-toggle-detail]").forEach((button) => button.addEventListener("click", () => { const detail = root.querySelector(`#${button.dataset.toggleDetail}`); if (detail) { detail.open = true; detail.scrollIntoView({ behavior: "smooth", block: "center" }); } }));
  root.querySelectorAll("details").forEach((detail) => detail.addEventListener("toggle", () => {
    const marker = detail.querySelector(":scope > summary > i");
    if (marker) marker.textContent = detail.open ? "收起" : "展开";
    if (detail.dataset.foldKey) ui.folds[detail.dataset.foldKey] = detail.open;
  }));
}

async function repeatPreviousPlan() {
  const result = await dispatchCommand("REPEAT_PREVIOUS_PLAN", {});
  if (!result.ok) { ui.notice = { tone: "error", text: result.message }; render(); return; }
  game = result.state;
  await saveGame(game);
  const skipped = result.summary?.skipped || [];
  const lifeKept = skipped.filter((item) => item.code === "LIFE_CONFIRM_REQUIRED").length;
  const invalid = skipped.length - lifeKept;
  ui.notice = { tone: "success", text: `已沿用上周 ${result.summary?.copied || 0} 项活动。${invalid ? `${invalid} 项绑定已失效，已留空。` : ""}${lifeKept ? `${lifeKept} 个弹性生活格保持休息，如需工作请手动确认。` : ""}` };
  render();
}

async function applySafePlan() {
  const actions = ["PREPARE_CONTENT", "LIVE_GAME", "REST", "MAKE_SHORT", "PRACTICE", "LIVE_CHAT", "REST", "REVIEW"];
  let next = structuredClone(game);
  const slots = [0, 1, 2, 3, 4, 6, 7, 8];
  for (let i = 0; i < slots.length; i += 1) {
    const envelope = commandEnvelope(next, "UPDATE_PLAN", { slotIndex: slots[i], actionId: actions[i], confirmFlexibleLife: false });
    const result = await executeCommand(next, envelope);
    if (result.ok) next = result.state;
  }
  game = next;
  await saveGame(game);
  ui.notice = { tone: "success", text: "已填入稳健示例：准备、两场直播、短视频、练习与复盘，并保留恢复空间。" };
  render();
}

async function runWeek() {
  if (ui.busy || !["PLANNING", "READY_TO_COMMIT"].includes(game.phase)) return;
  ui.busy = true;
  ui.notice = null;
  render();
  if (game.phase === "PLANNING") {
    const beforeStart = game;
    const started = await dispatchCommand("START_WEEK", { planRevision: game.snapshotVersion });
    if (!started.ok) {
      ui.busy = false;
      ui.notice = { tone: "error", text: started.message };
      render();
      return;
    }
    game = started.state;
    try {
      await saveGame(game);
    } catch {
      game = beforeStart;
      ui.busy = false;
      ui.notice = { tone: "error", text: "本周数据保存失败，存档未改变。请释放浏览器存储空间后重试。" };
      render();
      return;
    }
  }
  const checkpoint = game;
  const result = await dispatchCommand("COMMIT_WEEK", { runId: game.weekRun.id, runRevision: game.weekRun.runRevision });
  ui.busy = false;
  if (!result.ok) { ui.notice = { tone: "error", text: result.message }; render(); return; }
  game = result.state;
  try {
    await saveGame(game);
  } catch {
    game = checkpoint;
    ui.notice = { tone: "error", text: "提交失败，存档未改变，可以重试。" };
    render();
    return;
  }
  ui.reportOpen = true;
  ui.view = "overview";
  render();
}

async function dispatchCommand(type, payload) {
  return executeCommand(game, commandEnvelope(game, type, payload));
}

async function handleImport(event) {
  try {
    const imported = await importGame(event.target.files[0]);
    const accepted = await requestConfirmation({ title: "覆盖当前本地主存档", actionLabel: "确认导入并覆盖", danger: true, currentPlan: `导入“${imported.character?.name || "未命名角色"}”的第 ${imported.weekIndex} 周存档`, cost: "不涉及真实付款；当前主存档将被替换", lostPermissions: "覆盖后不能在游戏内撤销到当前主存档", retainedAssets: "导入文件保持不变；当前存档的最近本地备份仍按备份策略保存", unresolvedIssues: `导入规则集：${imported.rulesets?.balance || "未知"}；确认前请核对角色与周数` });
    if (!accepted) return;
    game = migrateGame(imported);
    await saveGame(game);
    ui.view = "overview";
    ui.notice = { tone: "success", text: "存档已导入。" };
    ui.reportOpen = game.phase === "REPORT";
    render();
  } catch (error) {
    ui.notice = { tone: "error", text: `导入失败：${error.message}` };
    render();
  }
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (ui.confirmation) { event.preventDefault(); closeConfirmation(false); return; }
    if (ui.selectedSlot != null) { event.preventDefault(); ui.focusReturn = `[data-pick-slot="${ui.selectedSlot}"]`; ui.selectedSlot = null; render(); return; }
    if (ui.moreOpen) { event.preventDefault(); closeMoreSheet(); return; }
    if (ui.reportOpen && game?.phase === "REPORT") { event.preventDefault(); ui.reportOpen = false; render(); }
    return;
  }
  if (event.key !== "Tab") return;
  const dialog = root.querySelector("[data-confirm-dialog], [data-dialog-panel], [data-more-panel], .report-dialog");
  if (!dialog) return;
  const focusable = [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]')];
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
});

render();
