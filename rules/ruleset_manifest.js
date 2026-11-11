export const RULESET_MANIFEST = Object.freeze({
  platform: Object.freeze({
    id: "platform_youtube_reference_2026_09_12_v1",
    sha256: "1a9a661b04b3c5f854263e7f3cbe62d02a6fb2514b3328fc02bd1965d0b04a1a",
  }),
  balance: Object.freeze({
    id: "balance_standard_0_2",
    sha256: "2b22068ca5576fd86a13d75ebf7b47c401f4e8567371894a60fca0909567a0f8",
  }),
  content: Object.freeze({
    id: "content_core_1_0",
    sha256: "8b6206722219b6ba3daab0a01232c3c644cb2b532d74222cbc35ab1d2b2849c1",
  }),
  careerModes: Object.freeze({
    id: "career_modes_1_0",
    sha256: "de6948d414bc6e8bcbd1f99877a2046988b7deb2a7d291cb1aa6daeb47bf606f",
  }),
});

// 仍可载入与继续结算的旧规则包。已开始的存档绑定其创建时的版本，导出包按存档实际绑定的版本声明。
export const SUPPORTED_RULESET_VERSIONS = Object.freeze({
  balance: Object.freeze({
    balance_standard_0_1: "de9959e650f267d3beb2339d6a0d53701ce1c5d258fbad470a0f221ef6becd9b",
    [RULESET_MANIFEST.balance.id]: RULESET_MANIFEST.balance.sha256,
  }),
});

export function rulesetManifestFor(game) {
  const balanceId = game?.rulesets?.balance;
  const balanceSha = SUPPORTED_RULESET_VERSIONS.balance[balanceId];
  if (!balanceSha) return RULESET_MANIFEST;
  return { ...RULESET_MANIFEST, balance: { id: balanceId, sha256: balanceSha } };
}
