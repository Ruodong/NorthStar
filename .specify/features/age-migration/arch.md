# Neo4j → Apache AGE 架构迁移

| 字段 | 值 |
|------|-----|
| 作者 | Ruodong Yang |
| 日期 | 2026-04-17 |
| 状态 | Draft |

---

## 1. 为什么做这件事

NorthStar 当前图层运行在独立的 **Neo4j 5 Community** 容器里（71 上的
`northstar-neo4j`，占用 7687/7474 端口 + 独立数据卷 + ~1.5GB JVM heap）。架构
文档 (`CLAUDE.md`) 把它定位为"Postgres 的派生投影"，所有写入都通过
`scripts/load_neo4j_from_pg.py` 单一入口。

这份迁移把图层下沉到 **Apache AGE**——Postgres 的一个 extension，和
`ref_application` 等业务表住在**同一个 PG 容器**里。带来的架构收益：

1. **基础设施单一化**：71 上从 `[postgres, neo4j, backend, frontend, converter]`
   缩到 `[postgres-with-age, backend, frontend, converter]`。监控、备份、
   升级各减少一份。
2. **严格开源合规**：Apache 2.0 替代 Neo4j CE 的 GPLv3 + Neo4j Sweden
   Trademark 条款。Lenovo 内部用没有潜在商用风险。
3. **架构哲学落地**："Neo4j 是 PG 的投影"从**逻辑约束**变成**物理事实**——
   图数据就是 PG 里的一组 schema，跨库一致性问题消失。
4. **事务边界统一（未来价值）**：loader 以后如果需要"PG 写 + 图写"原子
   提交，AGE 让这件事变成一个 `BEGIN...COMMIT`。

## 2. 旧架构 vs 新架构

### 迁移前（2026-04-17 当前）

```
┌─────────────────────────────────────────────────────────────┐
│ 71 (192.168.68.71)                                         │
│                                                            │
│  ┌──────────────┐     ┌──────────────┐                    │
│  │ northstar-   │     │ northstar-   │                    │
│  │ postgres     │     │ neo4j        │                    │
│  │ (5434)       │     │ (7687, 7474) │                    │
│  │              │     │              │                    │
│  │ schema:      │     │ graph:       │                    │
│  │  northstar.* │     │  :Application│                    │
│  │  ref_app     │     │  :Project    │                    │
│  │  ref_proj    │     │  :Diagram    │                    │
│  │  conf_page   │     │  INVESTS_IN  │                    │
│  │  ...         │     │  ...         │                    │
│  └──────▲───────┘     └──────▲───────┘                    │
│         │ asyncpg            │ bolt (async)                │
│  ┌──────┴────────────────────┴───────┐                    │
│  │ northstar-backend (host network)  │                    │
│  │  pg_client.py    neo4j_client.py  │                    │
│  └────────────▲──────────────────────┘                    │
└───────────────┼────────────────────────────────────────────┘
                │
      scripts/load_neo4j_from_pg.py (host, .venv-ingest)
      读 PG → 写 Neo4j
```

### 迁移后（PR 3 合并后）

```
┌─────────────────────────────────────────────────────────────┐
│ 71 (192.168.68.71)                                         │
│                                                            │
│  ┌────────────────────────────────────┐                   │
│  │ northstar-postgres                 │                   │
│  │ (5434, apache/age:PG16_latest)     │                   │
│  │                                    │                   │
│  │ schema: northstar.*                │                   │
│  │  ref_app, ref_proj, conf_page, ... │                   │
│  │                                    │                   │
│  │ schema: ns_graph (AGE 图)          │◄──── AGE          │
│  │  "Application" (id, properties)    │                   │
│  │  "Project"    (id, properties)     │                   │
│  │  "INVESTS_IN" (id, start, end, .)  │                   │
│  │  ...                               │                   │
│  │                                    │                   │
│  │ schema: ag_catalog                 │                   │
│  │  ag_graph, ag_label (metadata)     │                   │
│  └─────────────▲──────────────────────┘                   │
│                │ asyncpg (单一连接池)                       │
│  ┌─────────────┴───────────────────┐                      │
│  │ northstar-backend (host)        │                      │
│  │  pg_client.py   graph_client.py │                      │
│  │                 └─ 包装 cypher()│                      │
│  │                    SQL 调用    │                      │
│  └─────────────▲───────────────────┘                      │
└────────────────┼──────────────────────────────────────────┘
                 │
       scripts/load_age_from_pg.py (host, .venv-ingest)
       读 PG 表 → 同 PG 内写入 AGE 图
```

**关键变化：图不再是独立容器，而是同一个 PG 里的一组 schema。**

## 3. 数据流（不变）

```
外部数据源                 Postgres (SoR)              AGE Graph (投影)
───────────────────────────────────────────────────────────────────
EGM master data           ref_application
EAM project data     ───► ref_project        ───►   :Application 节点
                          ref_employee               :Project 节点
Confluence pages          confluence_page            INVESTS_IN 边
+ drawio attachments ───► confluence_attachment ───► :Diagram 节点
                          confluence_diagram_app     INTEGRATES_WITH 边
                                                     DESCRIBED_BY 边
                                                     HAS_CONFLUENCE_PAGE 边

     weekly_sync.sh           load_age_from_pg.py
     (host, 周一 08:00)       (--wipe 全量重建)
```

写入路径不变：**外部 → PG 表 → loader → AGE 图**。唯一差别是最后一步现在
发生在同一个 PG 里。

## 4. 图数据的物理布局（AGE 特有）

AGE 把图数据存成普通的 PG 表。对 NorthStar 的本体（ontology）来说，PG 里
会多出如下对象：

```sql
-- 命名空间
-- northstar 已存在（业务表 ref_application 等），继续用
-- ns_graph 是新的 AGE 图 schema（create_graph 自动建，不能和 northstar 同名）
CREATE SCHEMA ag_catalog;       -- AGE 元数据

-- 节点表（每个 label 一张表，AGE 自动建）
ns_graph."Application"  (id bigint PK, properties agtype)
ns_graph."Project"      (id bigint PK, properties agtype)
ns_graph."Diagram"      (id bigint PK, properties agtype)
ns_graph."ConfluencePage" (id bigint PK, properties agtype)

-- 边表（每种关系类型一张表）
ns_graph."INVESTS_IN"       (id, start_id, end_id, properties)
ns_graph."INTEGRATES_WITH"  (id, start_id, end_id, properties)
ns_graph."HAS_DIAGRAM"      (id, start_id, end_id, properties)
ns_graph."DESCRIBED_BY"     (id, start_id, end_id, properties)
ns_graph."HAS_CONFLUENCE_PAGE" (id, start_id, end_id, properties)
ns_graph."HAS_REVIEW_PAGE"  (id, start_id, end_id, properties)

-- 我们加的索引（替代 Neo4j 的 CREATE CONSTRAINT / CREATE INDEX）
CREATE UNIQUE INDEX app_id_uniq
    ON ns_graph."Application" ((properties->>'app_id'));
CREATE INDEX app_status_idx
    ON ns_graph."Application" ((properties->>'status'));
-- ...详见 backend/sql/018_enable_age.sql + graph_client.ensure_schema
```

**为什么这样设计：**
- `properties` 是 agtype（AGE 的类 JSONB 类型），支持按路径取值、比较、排序
- 表达式索引 `((properties->>'key'))` 让 PG planner 在 Cypher 翻译后仍能走
  索引——这是 AGE 性能好坏的关键
- 唯一约束用 `UNIQUE INDEX` 实现（AGE 不支持 Cypher `CREATE CONSTRAINT`）
- 元数据（label 列表、图名）存在 `ag_catalog.ag_graph` / `ag_label`，应用
  代码不要直接读

## 5. 查询执行路径

### Neo4j 时代

```
graph_query.get_application("A000575")
  ↓
neo4j_client.run_query(cypher, {"app_id": ...})
  ↓
neo4j Python driver (bolt 协议)
  ↓
bolt://localhost:7687
  ↓
northstar-neo4j 容器
  ↓
Cypher 引擎 → 图索引扫描
```

### AGE 时代

```
graph_query.get_application("A000575")
  ↓
graph_client.run_query(cypher, {"app_id": ...})
  ↓
graph_client 内部包一层 SQL：
    SELECT * FROM cypher(
        'ns_graph',
        $$MATCH (a:Application {app_id: $app_id}) ...$$,
        $1::agtype
    ) AS (app agtype, out_edges agtype, ...)
  ↓
asyncpg → postgresql://northstar@localhost:5434
  ↓
northstar-postgres 容器
  ↓
AGE extension 把 Cypher 翻译成 PG 查询计划 → 走表达式索引
  ↓
返回 agtype 列 → graph_client 解析成 Python dict
```

**调用方（`graph_query.py` 里 29 处 `run_query` / `run_write`）不变**——
签名完全兼容。差异只在 client 层内部。

## 6. 迁移的三阶段（再强调一遍）

| 阶段 | 产物 | 风险窗口 | 回滚成本 |
|------|------|---------|---------|
| **PR 1** | PG 镜像换成 apache/age，加 extension + 建空图 | 无（Neo4j 仍然是主）| 改一行 compose，`docker compose up -d --build postgres` |
| **PR 2** | 新 `graph_client.py` + `load_age_from_pg.py` 双写 | 无（backend 还没切换读源）| 删两个新文件 |
| **PR 3** | backend import 切换、移除 Neo4j 容器、更新文档 | **数据丢失窗口**——Neo4j volume 被移除 | 需要 PR 3 部署前手动 `neo4j-admin dump` 保底 |

## 7. 依赖图更新

迁移完成后，`CLAUDE.md` 的 "Data Architecture (Two-Layer)" 段落需要改写。
拟定新文字（PR 3 落地时一起提交）：

> **Data Architecture (Single Layer with Graph Projection):**
>
> NorthStar has ONE database — Postgres — organized into two logical layers:
>
> **Relational layer (`northstar.*` schema):** master data (ref_application,
> ref_project, ref_employee), Confluence raw data (confluence_page,
> confluence_attachment), and NorthStar-owned tables.
>
> **Graph layer (`northstar` AGE graph):** a derived projection of the
> relational layer, populated by `scripts/load_age_from_pg.py`. Queried via
> openCypher embedded in SQL.
>
> **Invariant:** the graph is a projection of the relational layer. All graph
> writes flow through ONE path (the loader). Backend routers may query the
> graph but never write to it.

## 8. 对相关方的影响

| 相关方 | 影响 | 需要做什么 |
|-------|------|----------|
| 架构师（日常用户） | 零影响，URL/UI/数据完全一致 | 无 |
| 运维（71 管理） | 少一个容器要管 | 更新监控，删除 Neo4j 告警规则 |
| Weekly sync cron | stage 2 命令换一条 | 自动随仓库更新 |
| 未来开发者 | 学习成本：需要懂 AGE 的 Cypher-in-SQL 写法 | CLAUDE.md + spec.md 已有详细说明 |
| 备份策略 | 不再需要单独备份 Neo4j | `pg_dump` 会把 AGE 数据一并带走 |
