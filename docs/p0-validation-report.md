# P0 验收报告

本报告以 `game_development_spec.md` 第 24—25 章为唯一验收口径。验证结果来自领域测试、确定性长周期重放、真实浏览器窄屏检查和可复核的输出文件；页面上出现入口或文案不计为通过。

## 结论

- 金样本 G-01—G-12：全部通过。
- 验收场景 A-01—A-40：全部通过。
- 工程场景 E-01—E-15：全部通过。
- 长周期平衡：100 个确定性种子 × 3 条路线 × 4 种策略，共 1,200 条 104 周轨迹；详细分布见 `output/validation/d9-balance-report.md` 和机器可读的 `output/validation/d9-balance-report.json`。
- 性能与容量：代表性 104 周轨迹的 312 次周结算 P95 为 509.91 ms；最大代表性状态 12.18 MB。实际导出的 104 周签名存档为 12,440,144 字节，并已在 390 px 浏览器中完成导入、重载和回顾页恢复。

这些结果证明当前冻结规则在本规格的 P0 范围内可运行、可恢复且存在可持续策略，但不把初始参数宣称为已完成商业平衡，也不用于预测现实平台或现实职业结果。

## 可复现命令

```powershell
npm run check
npm run validate:replay
npm run validate:balance
npm run validate:performance
npm run validate:large-save
```

测试运行器为 Node.js 内置测试；平衡批测使用相同的初始能力和配对种子，仅改变路线与排期策略。存档、规则和浏览器持久化不依赖第三方服务。

## 金样本 G-01—G-12

| 编号 | 结果 | 自动化证据 |
|---|---|---|
| G-01、G-02、G-12 | 通过 | `test/finance.test.js`：SC 瀑布、个人势应收、3 日元整数守恒 |
| G-03、G-04、G-08 | 通过 | `test/merch.test.js`：自营／公司商品损益、版税、盈亏平衡件数 |
| G-05、G-09、G-10、G-11 | 通过 | `test/engine.test.js`：平均同接、质量、状态乘数、重复触达并集 |
| G-06、G-07 | 通过 | `test/acceptance-matrix.test.js`：稳定回流估计、自由与受限资金隔离 |

## 验收场景 A-01—A-40

| 范围 | 结果 | 自动化证据 |
|---|---|---|
| A-01—A-05 | 通过 | `test/engine.test.js` 与 `test/acceptance-matrix.test.js`：三路线、履历落选保留、生活格、连续活动、空周 |
| A-06—A-10 | 通过 | `test/world.test.js`、`test/commands.test.js`、`test/acceptance-matrix.test.js`、`test/engine.test.js`：预约冲突、只读预览、噪声边界、曝光转化分离、无直播周 |
| A-11—A-19 | 通过 | `test/finance.test.js` 与 `test/content.test.js`：资格、审核、可见性、Shorts、窗口边界、共享预算、赠送会员、观众谱系 |
| A-20—A-27 | 通过 | `test/merch.test.js` 与 `test/projects.test.js`：候选池、受限资金、取消、MOQ、交付、累计退款、视觉加成上限 |
| A-28—A-30 | 通过 | `test/audition.test.js` 与 `test/resources.test.js`：无订阅门槛、冷却、资源缩配和去重 |
| A-31—A-39 | 通过 | `test/transfers.test.js`：资产许可、频道控制、发生时合同、单一主所属、低现金退出和责任保留 |
| A-40 | 通过 | `test/career.test.js`：第 104 周回顾保留并明确进入第 105 周 |

## 工程场景 E-01—E-15

| 范围 | 结果 | 自动化／浏览器证据 |
|---|---|---|
| E-01、E-02 | 通过 | `test/commands.test.js`：命令幂等、陈旧版本拒绝 |
| E-03 | 通过 | `test/storage.test.js`：模拟写入失败不覆盖正式存档 |
| E-04、E-05 | 通过 | `test/acceptance-matrix.test.js`：事件刷新稳定、运行阶段拒绝项目和转籍写入 |
| E-06 | 通过 | `test/engine.test.js`：相同种子与命令序列得到相同领域哈希 |
| E-07 | 通过 | `test/acceptance-matrix.test.js`：仅改旁白不改变数值、随机与财务 |
| E-08—E-12 | 通过 | `test/storage.test.js`：指令／HTML／原型污染、账务与预算、规则包与引用、迁移回滚、未完成 WeekRun 往返 |
| E-13 | 通过 | `test/long-run.test.js` 与 1,200 条长周期批测：无悬空引用、重复 ID、负库存或负预算 |
| E-14 | 通过 | 390 px 真实浏览器完成创建、排期、内容、财务、商品、项目、招募、转籍、世界事件、回顾、存档导入与分页；全程无拖拽、无横向溢出、控制台 0 错误／0 警告 |
| E-15 | 通过 | `test/preferences.test.js`：完整原创名称包切换前后模拟数值一致 |

## 数据可视化与认知负荷

九个主页面先显示任务摘要和下一步，明细、历史、财务瀑布、资源竞争、事件记录与回顾指标默认折叠。390 px 下使用“选格 → 选活动”的排期流程，不要求拖拽；内容、交易和不可变账本按 40 条渐进加载，测试数据达到 120 条时页面仍只实例化当前 40 条。折叠控件、筛选和确认卡保留键盘焦点、`aria-expanded`／`aria-pressed` 状态与 Escape 返回。

浏览器证据包括：

- `output/playwright/d9-history-pagination-mobile.png`
- `output/playwright/d9-finance-pagination-mobile.png`
- `output/playwright/d9-large-save-retrospective-mobile.png`
- `output/playwright/d8-content-visibility-mobile.png`
- `output/playwright/d8-contract-confirm-mobile.png`
- `output/playwright/d7-overview-mobile.png`
- `output/playwright/d6-transfer-mobile.png`

## 平衡判定与已知限制

- 三条路线都必须至少有一种可持续策略；可持续定义为第 104 周仍有自由现金、疲劳和压力低于 80、身体状态至少 30、没有项目违约且会员承诺履行率至少 80%。
- “只做同一种活动”不得同时赢得全部六类职业目标。追热点和音乐高负荷策略故意使用全部普通工作格，其健康代价会被模型真实结算，而不是额外注入失败事件。
- 个人势的保守策略包含现金不足时的两格兼职修复路径，并检查第 104 周现金 P05 大于 0。
- 公司商品仍需两个真实设计工作格；销售只生成一次候选池，每次宣传只触达未触达部分，并与其他消费共享 28 日预算。公司承担项目成本不等于个人账取得销售额，玩家只在正项目利润结算后取得 30% 应收。判定同时检查公司路线存在不可持续策略、项目收益跨种子变化且商品经营没有支配全部职业目标。
- 高频转籍循环专项测试确认不会凭空增加自由现金，也不会同时产生两份主所属。
- 规则参数仍标记为 `DESIGN_VALUE`。后续调整必须保留种子、报告和前后分布，不以单局体验替代批量证据。

## 输出清单

| 文件 | 用途 |
|---|---|
| `output/validation/d9-balance-report.json` | 1,200 条轨迹的检查点、组别分布和逐样本结果 |
| `output/validation/d9-balance-report.md` | 人可读的平衡摘要 |
| `output/validation/d9-performance-report.json` | 周结算延迟与状态尺寸 |
| `output/validation/d9-large-save.json` | `npm run validate:large-save` 在本地生成的可导入 104 周签名存档；体积较大，不纳入 Git |
