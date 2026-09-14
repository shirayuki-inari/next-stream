# 下一场直播

依据 [游戏开发规格书](game_development_spec.md) 实施的虚拟主播生涯周回合经营游戏。

当前版本完成规格书 P0：三路线创建、14 格排期、原子周结算、内容与观众、资格与分层财务、三种商品模式、四种长期项目、招募面试、公司资源和完整转籍，并加入 20 名持久 NPC、三维关系、无订阅硬门槛的邀请与真实档期、世界活动、NPC 自主行为、40 个白名单事件模板、8 条双阶段事件链、可跳过教程、六类职业评价、104 周回顾、继续经营及玩家主动归档。付费切片与字幕翻译绑定具体源内容和独立许可，只形成有限传播机会。角色所有权、使用许可、频道控制、主所属合同、旧应收和未交付责任分别保存；新频道不复制旧订阅。

九个主页面采用任务导向摘要，复杂数据默认折叠；内容、交易与账本历史渐进加载。重大操作使用五项影响确认卡，键盘、390 px 移动端、名称包和减少动效均已联调。正式存档使用 IndexedDB 原子事务、最近三份边界快照、规则清单、SHA-256 校验和与迁移回滚；导出包可离线验证。详细边界见 [实施状态](docs/implementation-status.md)，完整证据见 [P0 验收报告](docs/p0-validation-report.md)。

## 运行

需要 Node.js 20 或更高版本。

```powershell
npm start
```

浏览器打开 `http://localhost:4173`。

## 验证

```powershell
npm run check
npm run validate:replay
npm run validate:balance
npm run validate:performance
npm run validate:large-save
```

`validate:balance` 会执行 100 个种子 × 3 条路线 × 4 种策略的 1,200 条 104 周轨迹，耗时明显长于普通回归。项目不需要安装第三方运行依赖；测试使用 Node.js 内置测试运行器。

`validate:large-save` 生成约 12 MB 的本地压力测试存档；该可再生成文件已从 Git 跟踪中排除。
