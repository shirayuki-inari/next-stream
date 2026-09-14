export const NAME_PACKS = Object.freeze({
  design_reference: {
    id: "design_reference",
    label: "规格显示名",
    routes: { indie: "个人势", homolive: "Homolive", niji2434: "2434" },
    agencies: { agency_homolive: "Homolive", agency_2434: "2434" },
    releaseNote: "沿用规格书显示名；公开发行前仍需完成名称与素材审查。",
  },
  original_release: {
    id: "original_release",
    label: "原创发行名称包",
    routes: { indie: "独立创作者", homolive: "星潮企划", niji2434: "群岛事务所" },
    agencies: { agency_homolive: "星潮企划", agency_2434: "群岛事务所" },
    releaseNote: "仅替换界面名称；合同、资源、概率、财务和历史 ID 完全不变。",
  },
});
