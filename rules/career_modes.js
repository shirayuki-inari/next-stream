// 生涯长度模式。与 balance_standard_0_1 分开冻结：两种模式共用同一套模拟数值、日历与平台窗口，
// 只改变回顾生成的周次和职业目标的评价门槛，因此不影响既有 104 周平衡轨迹。
const STANDARD_GOAL_THRESHOLDS = Object.freeze({
  livelihood: Object.freeze({ sampleWeeks: 8, cashCoverageWeeks: 4, averageStressBelow: 70, fulfillmentRate: 80 }),
  creator: Object.freeze({ portfolioCount: 3, publishedContentCount: 8, contentFormats: 2 }),
  stage: Object.freeze({ stageAndMusicCount: 6, collaborationCount: 2, performance: 60 }),
  community: Object.freeze({ active28dEstimate: 1000, fulfillmentRate: 80, averageStressBelow: 70 }),
  brand: Object.freeze({ playerOwnedAssets: 2, incomeSourceCount: 3, cashCoverageWeeks: 4 }),
  reach: Object.freeze({ active28dEstimate: 10000, publishedContentCount: 16, contentFormats: 3 }),
});

export const CAREER_MODES = Object.freeze({
  id: "career_modes_1_0",
  sourceType: "DESIGN_VALUE",
  defaultModeId: "standard",
  modes: Object.freeze({
    standard: Object.freeze({
      id: "standard",
      label: "标准生涯",
      summary: "104 周后生成两年回顾，可继续经营",
      periodLabel: "两年",
      reviewWeeks: Object.freeze([104]),
      goalThresholds: STANDARD_GOAL_THRESHOLDS,
    }),
    short: Object.freeze({
      id: "short",
      label: "短篇生涯",
      summary: "26 周后生成半年回顾，约 20 分钟；继续经营到第 104 周会再生成两年回顾",
      periodLabel: "半年",
      reviewWeeks: Object.freeze([26, 104]),
      // 26 周内日历时间受限的目标按比例降低；其余门槛在 26 周内已可正常达成，保持不变。
      goalThresholds: Object.freeze({
        ...STANDARD_GOAL_THRESHOLDS,
        creator: Object.freeze({ portfolioCount: 1, publishedContentCount: 8, contentFormats: 2 }),
        stage: Object.freeze({ stageAndMusicCount: 6, collaborationCount: 1, performance: 55 }),
      }),
    }),
  }),
});

export const CAREER_MODE_IDS = Object.freeze(Object.keys(CAREER_MODES.modes));
