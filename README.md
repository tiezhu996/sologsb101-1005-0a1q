# 桥梁支座更换与顶升监测台（sologsb101-1005 / gbbridgebear）

## 一、Docker 一键启动（推荐）

```bash
cd sologsb101-1005
cp .env.example .env
docker compose up -d --build
```

启动后访问：**http://localhost:22805**

停止与清理：

```bash
docker compose down          # 停止并删除容器
docker compose up -d --build # 代码改动后重建
```

## 二、项目简介

面向桥梁养护项目的技术员与施工班组，按墩台编排支座更换作业，并在顶升过程中按测点逐级记录位移与应力，最后分步验收归档。

核心动作：

- 建立桥梁与墩台台账（跨径组合、桥型、建成年、公路等级、盖梁标高）
- 登记支座并按完好 / 轻微 / 较重 / 严重四级评定病害，较重及以上触发更换建议，支持批量调级与升级
- 编排分级顶升步骤（目标顶升量、同步要求、限位值、负责人），支持上移 / 下移调序与**累计顶升量校验**
- 按步骤批量录入多测点位移与应力，实时计算**同步偏差**（同批次极差）并按限位值给出告警
- 四步签署验收（顶升到位 → 支座就位 → 落梁 → 竣工），全部支座合格后可执行竣工归档
- **离线合并交接**：检修组离线作业回站后，作业包冻结基线、按包号去重、只接基线后的单边变化，新增读数按「步骤 + 测点」唯一键追加；支座病害等级 / 步骤参数两边都改时保留主台账原值并列差异（裁定前该支座挂起验收）；写入失败自动恢复主台账并保留未完成批次重试；旧包缺基线进入待补证区
- 查看 IndexedDB 结构版本并导出 / 导入整库 JSON

本项目为**纯前端单页应用**：无后端、无数据库服务、无外部接口，全部数据保存在浏览器 IndexedDB。

## 三、技术栈

| 分类 | 选型 | 版本 |
| --- | --- | --- |
| 框架 | Angular | 18.2 |
| 语言 | TypeScript | 5.5 |
| UI 组件库 | Angular Material + CDK | 18.2 |
| 响应式 | RxJS | 7.8 |
| 状态管理 | NgRx（@ngrx/store + effects + store-devtools） | 18.1 |
| 路由 | Angular Router（懒加载 + Hash 策略） | 18.2 |
| 本地持久化 | Dexie（IndexedDB） | 4.0 |
| 构建 | @angular-devkit/build-angular:application | 18.2 |
| 容器 | 多阶段构建 node:20-alpine → nginx:alpine | — |

## 四、路由一览

| 路由 | 页面组件 | 说明 |
| --- | --- | --- |
| `/bridges` | `BridgeListPage` | 建立桥梁与墩台台账，按桥型与建成年筛选 |
| `/bearings` | `BearingBoardPage` | 登记支座规格并评定病害等级，按等级批量处置 |
| `/steps` | `StepPlanPage` | 顶升步骤编排、顺序调整与累计顶升量校验 |
| `/readings` | `ReadingEntryPage` | 按步骤批量录入位移与应力，同步偏差与限位告警 |
| `/acceptances` | `AcceptanceArchivePage` | 四步签署、竣工归档与结构版本 JSON 导出 / 导入 |
| `/handoffs` | `HandoffMergePage` | 离线作业包冻结基线、三方合并交接、差异裁定、失败重试与待补证区 |

> 路由定义在 `src/app/core/router/app.routes.ts`，使用默认的 `PathLocationStrategy`（history 模式），与 nginx 的 `try_files $uri $uri/ /index.html` 配合，直接访问上述深链接（含刷新）都能命中对应页面。

## 五、目录结构

```
sologsb101-1005/
├── README.md
├── docker-compose.yml                    # 顶层 name: gbbridgebear，无 version 字段
├── .env / .env.example                   # COMPOSE_PROJECT_NAME / FRONTEND_PORT
├── .gitignore
└── frontend/
    ├── Dockerfile                        # 多阶段：node:20-alpine 构建 → nginx:alpine 托管
    ├── nginx.conf                        # try_files 前端路由回退 + gzip
    ├── .dockerignore
    ├── package.json / angular.json / tsconfig.json / tsconfig.app.json
    ├── public/favicon.svg
    └── src/
        ├── main.ts                       # bootstrapApplication(AppComponent, appConfig)
        ├── index.html
        ├── styles.scss                   # Angular Material 主题 + 全局样式
        └── app/
            ├── app.component.ts          # 应用外壳（工具栏 + 侧边导航 + 统计）
            ├── app.config.ts             # provideRouter / provideStore / provideEffects
            ├── core/
            │   ├── types/                # bridge.ts pier.ts bearing.ts step.ts reading.ts acceptance.ts persistence.ts handoff.ts
            │   ├── store/                # app.actions.ts notice.reducer.ts archive.helper.ts
            │   │                         # bridge.store/reducer/selectors、bearing.*、step.*、acceptance.*、handoff.*（离线合并）、app.effects.ts
            │   ├── services/             # idb-table.service.ts step-timeline.service.ts change-bus.service.ts handoff.service.ts
            │   ├── router/app.routes.ts
            │   └── utils/                # unit.ts tolerance.ts db.ts export.ts
            ├── shared/components/common/ # grade-tag / filter-bar / stat-badge / empty-panel
            └── features/
                ├── bridges/pages/bridge-list.page.ts
                ├── bearings/pages/bearing-board.page.ts
                ├── steps/pages/step-plan.page.ts
                ├── readings/pages/reading-entry.page.ts
                ├── acceptances/pages/acceptance-archive.page.ts
                └── handoffs/pages/handoff-merge.page.ts    # 离线合并交接页
```

## 六、数据存储说明

- **存储介质**：浏览器 IndexedDB，库名 **`gbbridgebear`**，通过 Dexie 4.x 封装。
- **数据结构版本**：`core/utils/db.ts` 中 `DB_SCHEMA_VERSION = 3`：v2 补齐行修订号并迁移 `span → spanCombo`、`grade → diseaseGrade`、`syncType → syncRequirement`、`limit → limitMm`、新增 `settings` 表；**v3 新增离线合并交接四张表**（`mergeConflicts` 差异清单、`mergeJournals` 按包号去重流水、`mergeBatches` 未完成批次、`mergeEvidence` 待补证区），业务六表结构不变，整库导出 / 导入同步携带交接台账。
- **数据表**：

  | 表名 | 实体 | 主要索引 |
  | --- | --- | --- |
  | `bridges` | 桥梁 | id / name / bridgeType / builtYear / roadClass / archived |
  | `piers` | 墩台 | id / bridgeId / code / capElevation / [bridgeId+code] |
  | `bearings` | 支座 | id / pierId / diseaseGrade / type / serial / [pierId+serial] |
  | `steps` | 顶升步骤 | id / bridgeId / seq / state / syncRequirement / [bridgeId+seq] |
  | `readings` | 测点读数 | id / stepId / pointCode / recordedAt / [stepId+pointCode] |
  | `acceptances` | 分步验收 | id / bearingId / stage / conclusion / [bearingId+stage] |
  | `settings` | 自定义字典 | id |
  | `mergeConflicts` | 离线合并差异 | id / packageNo / bridgeId / entity / entityId / field / status / [entity+entityId+status] |
  | `mergeJournals` | 已接收包流水 | id / packageNo / bridgeId / receivedAt |
  | `mergeBatches` | 合并批次 | id / packageNo / bridgeId / status / createdAt |
  | `mergeEvidence` | 待补证区 | id / packageNo / createdAt |

- **首屏自动播种**：`initDatabase()` 在 `bridges` 表为空时写入演示数据（幂等）——2 座桥梁 × 各 2~3 个墩台 × 各 2~3 个支座（四级病害各覆盖）+ 2~3 级顶升步骤 + 每级多测点读数 + 分步验收记录，父子记录通过 `bridgeId / pierId / bearingId / stepId` 互相引用。
- **跨页状态**：全部放在 NgRx store（`bridge / bearing / step / acceptance` + `notice` 提示），页面只通过 `select` 读 store、通过 `dispatch` 写；Dexie 写入后由 `ChangeBusService` 广播，`AppEffects` 重新加载全部表。
- **数据不出浏览器**：容器无状态，不挂载卷、不使用数据库服务。

## 七、离线合并交接规则（`/handoffs`）

检修组离线作业回站后，在交接页读入作业包完成并回主台账：

1. **作业包冻结基线**：出发前在「交接工具箱」按桥梁冻结当前支座病害等级与顶升步骤参数（目标顶升量 / 限位值 / 同步要求 / 负责人），基线随作业包带走。
2. **按包号去重**：`mergeJournals` 以 `packageNo` 为唯一键，已接收的包重复交接直接忽略，不二次写入。
3. **只接基线后的单边变化**：离线值 ≠ 基线值且主台账现值 = 基线值（仅离线单边改）才接收；基线外的支座 / 步骤 / 读数一律不猜不接。
4. **新增读数按唯一键追加**：以「步骤 + 测点编号」为唯一键，主台账已有该键读数即跳过（`dup`），否则用确定性 id 幂等追加（`read-offline-<包号>-<步骤>-<测点>`），失败重试不产生重复行。
5. **两边都改 → 保留主台账原值并列差异**：支座病害等级或步骤参数基线后两边都改时，不覆盖主台账，差异写入 `mergeConflicts`；**裁定（保留主台账 / 采用离线值）完成前该支座在验收页置灰、禁止勾选与四步签署**（UI 与 effect 双重卡口）。
6. **写入失败恢复 + 重试**：全部写入在单个 Dexie 事务内完成；失败时事务回滚并按失败前快照显式恢复主台账，作业包全文与差异写入 `mergeBatches`（failed），在交接页一键重试（同一批次 `attempts` 递增，成功后清理）。
7. **旧包缺基线进待补证区**：缺 `kind` / 包号 / 基线的作业包或无法解析的文件只登记到 `mergeEvidence`（可下载原始包补证），绝不猜着覆盖。
8. **四页读取合并结果**：总表（桥梁页顶部合并概览条）、步骤页（「离线并入」标记 + 合并步骤统计）、读数页（「离线」标记 + 并入读数统计）、验收页（差异挂起的支座禁止签署）。

## 八、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:22805（ng serve）
npm run typecheck  # tsc --noEmit -p tsconfig.app.json
npm run build      # ng build（含 Angular 模板类型检查与 TS 校验）
```

## 九、容器化细节

- `Dockerfile` 两阶段构建：`node:20-alpine` 安装依赖并执行 `npm run build`，随后把 `dist/gbbridgebear/browser` 拷贝到 `nginx:alpine` 的 `/usr/share/nginx/html`。
- 运行阶段在 COPY 之后执行 `RUN chmod -R a+rX /usr/share/nginx/html`，规避历史遗留的 favicon 权限 0600 导致 nginx 403 的问题。
- `nginx.conf` 使用 `try_files $uri $uri/ /index.html;` 支持前端路由直接刷新，并开启 gzip。
- `docker-compose.yml` 不写 `version:`，顶层 `name: gbbridgebear` 兜底（避免中文目录名导致项目名为空），服务名 `frontend`，容器名 `${COMPOSE_PROJECT_NAME:-gbbridgebear}-frontend`，端口 `${FRONTEND_PORT:-22805}:80`，`restart: unless-stopped`。
