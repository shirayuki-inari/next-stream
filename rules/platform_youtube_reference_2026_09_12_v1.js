export const PLATFORM_RULES = Object.freeze({
  id: "platform_youtube_reference_2026_09_12_v1",
  sourceType: "PUBLIC_REFERENCE",
  verifiedAt: "2026-09-12",
  references: ["RF-01", "RF-02", "RF-03", "RF-04"],
  fanFunding: {
    subscribers: 500,
    publicUploads90d: 3,
    validWatchMinutes12m: 180_000,
    shortsViews90d: 3_000_000,
    reviewDays: 7,
  },
  ads: {
    subscribers: 1000,
    validWatchMinutes12m: 240_000,
    shortsViews90d: 10_000_000,
  },
  fanFundingNetShareBps: 7000,
  simplifiedTaxAdjustmentBps: 0,
});

export const SC_DENOMINATIONS = Object.freeze({
  amountsJpy: [200, 500, 1000, 5000, 10000],
  none: [0, 0, 0, 0, 0],
  light: [6500, 2500, 800, 200, 0],
  high: [1500, 2500, 3500, 2000, 500],
});

export const SUPPORT_TIERS = Object.freeze({
  none: { perCapitaCycleBudgetJpy: 0, baseScPaymentRate: 0 },
  light: { perCapitaCycleBudgetJpy: 2000, baseScPaymentRate: 0.025 },
  high: { perCapitaCycleBudgetJpy: 10000, baseScPaymentRate: 0.06 },
});
