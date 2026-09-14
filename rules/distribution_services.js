export const DISTRIBUTION_SERVICES = Object.freeze({
  CLIP_EDIT: { id: "CLIP_EDIT", label: "公开切片制作", costJpy: 15000n, deliveryDays: 7, reachRate: 0.18, licenseTag: "PAID_COMMISSION_PUBLIC_CLIP" },
  SUBTITLE_TRANSLATION: { id: "SUBTITLE_TRANSLATION", label: "字幕翻译", costJpy: 22000n, deliveryDays: 10, reachRate: 0.22, licenseTag: "PAID_COMMISSION_TRANSLATION" },
});

export const CONTENT_LICENSE_TAGS = Object.freeze({
  PLATFORM_PUBLIC_VIEWING: "平台公开观看",
  PAID_COMMISSION_PUBLIC_CLIP: "付费委托公开切片",
  PAID_COMMISSION_TRANSLATION: "付费委托字幕翻译",
  THIRD_PARTY_MATERIAL_RESTRICTED: "第三方素材受限",
});
