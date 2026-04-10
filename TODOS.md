# NorthStar TODOS

> Generated from /plan-ceo-review on 2026-04-10 (Architect Workbench Repositioning)
>
> Each item links back to the CEO plan at `~/.gstack/projects/Ruodong-NorthStar/ceo-plans/2026-04-10-architect-workbench.md`

## P0 — Before Development Starts

### [P0] HARD GATE: 访谈 3 名架构师

- **What:** 开发 Architect Workbench 之前必须完成的用户访谈,按 CEO plan 里定义的 8 问脚本
- **Why:** 整个 plan 建立在 "架构师每周会打开 NorthStar 查 App" 的 N=1 假设上。outside voice 戳中了这个点。访谈 2-3 人天换 ~8 周 scope 的 deregret,ROI 不用算
- **Pros:** 避免 "build it and they won't come";gate 不通过可以节约 ~30 CCh
- **Cons:** 需要跟 3 个架构师约到时间;访谈结果可能导致 plan 重写
- **Context:** 见 CEO plan 的 "HARD GATE — 开发前必须完成" 段落,包含完整脚本和通过标准
- **Effort:** 人类 2-3 天 (没有 CCh 节约空间 — 这是人工)
- **Priority:** P0 (blocking)
- **Depends on:** nothing

---

## P1 — 本次 scope 砍掉但未来要做

### [P1] AI 1 句话摘要 pipeline

- **What:** 预计算 pipeline,给每个 App 生成一句 <40 字人话摘要,存 `applications.ai_summary`
- **Why:** 当架构师看 description 字段看不懂时,一句话 TLDR 降低认知成本。**但 outside voice 正确指出:架构师本身懂域,摘要是装饰品。** 等真实使用数据证明用户看不懂 description 了再做
- **Pros:** 让 detail page 更有 "有 AI 感";降低新架构师上手成本
- **Cons:** ~4 CCh 投入 (prompt + eval + 失败处理 + 重生成 UI + 成本监控);中等复杂度的副流程
- **Context:** 完整设计已在 CEO plan 里 (prompt 模板、幂等键 ai_summary_hash_of_source、eval 方法、成本估算)。数据模型字段已可在 PG 先建 (ai_summary TEXT, ai_summary_hash_of_source VARCHAR(64))
- **Effort:** 人类 2 周 / CC ~4 CCh
- **Priority:** P1
- **Depends on:** applications_history + ingestion pipeline 稳定

### [P1] Personal Workbench (SSO + 服务端存储完整版)

- **What:** 架构师个人收藏/书签/notes,跨设备同步
- **Why:** "每日锚定工具" 需要持久化个人状态,localStorage 版在多机器场景下矛盾
- **Pros:** 真正的 retention 杀手锏;架构师换机器不丢数据
- **Cons:** 需要对接 Lenovo AD/SSO,这是独立工程;中间件 + 认证中间层 + 会话管理
- **Context:** localStorage 版被 outside voice 挑战后砍掉。等 SSO 存在后再上完整版
- **Effort:** 人类 2-3 周 (含 SSO 对接) / CC 未知,依赖 Lenovo AD API 复杂度
- **Priority:** P1
- **Depends on:** SSO / Lenovo AD 对接工程 (独立项目)

### [P1] Ask NorthStar (LLM 自然语言查询)

- **What:** 用自然语言问 NorthStar: "哪些 App 跟订单系统集成但状态 Sunset",LLM 生成 Cypher+SQL,校验后执行
- **Why:** reference 产品的圣杯 — 降低 "提问阻力" 到接近零。但 LLM 幻觉第一次负面体验会输掉信任
- **Pros:** 最强差异化;架构师不用学 Cypher;自然语言降低所有认知门槛
- **Cons:** ~10 CCh;prompt 工程高难度;白名单校验;性能监控;成本监控;幻觉检测
- **Context:** 等 Expansion 1+2+3+5 上线 2-4 周后,有足够 retention 数据再上。**先建立用户信任,再上魔法。**
- **Effort:** 人类 2 周 / CC ~10 CCh
- **Priority:** P1
- **Depends on:** Expansion 1+2+3+5 有 4 周使用数据 + 用户未投诉可靠性问题

---

## P2 — 本 scope 不包含,未来可能需要

### [P2] Weekly Diff 邮件订阅

- **What:** What's New reference 版的 push 版本,每周一早上 8:00 发邮件给订阅用户
- **Why:** 当 What's New reference 版证明 "架构师确实会回来看变化" 后,可以用推送把他们从不来的人拉回来
- **Pros:** 拉回失联用户;增加 return frequency
- **Cons:** 需要邮件服务对接;订阅偏好;去重;退订
- **Context:** Outside voice 强烈指出 push 模式不符合 reference 工具定位。保留为可选择的未来扩展,等数据证明被动用户存在
- **Effort:** 人类 1 周 / CC ~4 CCh
- **Priority:** P2
- **Depends on:** What's New reference 版 + ingestion cron 已运行 4-8 周

### [P2] Review Prep Assistant (reconsider)

- **What:** review 会议前的 workflow 页面,生成项目摘要 + 冲突检测 + 影响暴露报告
- **Why:** 被 KILLED 原因是战略判断 "NorthStar 非 workflow 工具"。但访谈结果可能推翻这个判断
- **Pros:** review 流程对价 — 把 2 小时准备压缩到 5 分钟
- **Cons:** 高 workflow 复杂度;依赖真实 review 数据对接 (Confluence review changelog);跟 "reference 工具" 叙事有张力
- **Context:** 访谈 gate 的 Q8 "review 前你怎么准备" 会直接告诉我们这个 feature 是否有需求。若访谈中 >=2 架构师自发描述 review 准备痛点,重新激活这个 TODO
- **Effort:** 人类 1.5 周 / CC ~8 CCh
- **Priority:** P2 (conditional on interview findings)
- **Depends on:** HARD GATE 访谈结果

### [P2] PG 表拆分重构

- **What:** 把 `applications` 的四重职责 (SOR + FTS + diff + NorthStar metadata) 拆成 3 张表: `applications`, `applications_search`, `applications_meta`
- **Why:** 6 个月后技术债会变成真问题。现在用一张表是对的 (简单 > 正确的抽象),但要留记录
- **Pros:** 长期可维护性;边界清晰
- **Cons:** 重构工作量大;迁移窗口;现在动就是过早抽象
- **Context:** 来自 Section 10 long-term trajectory review 发现
- **Effort:** 人类 2 周 / CC ~6 CCh
- **Priority:** P2 (revisit at 6 months)
- **Depends on:** 使用数据证明 PG FTS 有独立扩展需求

---

## P3 — 待定 / 可能永远不做

### [P3] AI 摘要 prompt 版本管理 / A/B 测试

- **What:** 把 AI 摘要的 prompt 提取到配置层,支持多版本 A/B
- **Why:** 当 P1 的 AI 摘要 pipeline 真做了,prompt 调优会是持续问题
- **Context:** 当前 plan 不做 AI 摘要,此 TODO 条件性存在
- **Priority:** P3 (only if P1 AI 摘要 activated)

### [P3] applications_history 精简 diff 语义

- **What:** 比较 CEO plan 里保留的 "简化版 history" 和原本设计的 "complete diff" 之间的空间
- **Why:** 用了简化版后可能发现某些 diff 展示不够细
- **Priority:** P3 (revisit if What's New shows too-coarse diffs)

---

## Archive / Discarded

- **AI 质量评估 (原 MVP spec Capability 4 的一部分)** — 重新定位为 "描述生成" 而非 "质检",但又被 outside voice 挑战砍掉。CEO plan 里的重定位思路保留,但短期内不做。
- **CIO 面向的 governance dashboard** — 原 MVP spec 的叙事,现在 NorthStar 战略重定位后,Dashboard 降级为二级入口。原 dashboard 代码保留,只是不再是首页。

---

## Cross-references

- CEO plan: `~/.gstack/projects/Ruodong-NorthStar/ceo-plans/2026-04-10-architect-workbench.md`
- Original MVP spec: `docs/superpowers/specs/2026-04-09-northstar-mvp-design.md` (需要同步更新战略重定位)
- Design system: `DESIGN.md` (Orbital Ops)
