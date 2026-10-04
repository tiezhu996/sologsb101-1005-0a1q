import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  ACCEPTANCE_CONCLUSIONS,
  ACCEPTANCE_CONCLUSION_LABEL,
  ACCEPTANCE_STAGES,
  ACCEPTANCE_STAGE_LABEL,
  archiveHint,
  archiveSummary,
  stageOrder,
  stageOrderHint,
  type AcceptanceConclusion,
  type AcceptanceStage,
  type AcceptanceView,
} from '../../../core/types/acceptance';
import { DISEASE_GRADE_LABEL } from '../../../core/types/bearing';
import { ROUTES } from '../../../core/router/app.routes';
import { acceptanceActions } from '../../../core/store/acceptance.actions';
import {
  buildAcceptanceViews,
  selectAcceptanceStats,
  selectLastArchiveSummary,
} from '../../../core/store/acceptance.selectors';
import { selectBridges, selectPiers } from '../../../core/store/bridge.selectors';
import { selectBearings } from '../../../core/store/bearing.selectors';
import { selectStepStats } from '../../../core/store/step.selectors';
import { selectStepState } from '../../../core/store/step.selectors';
import { bridgeActions } from '../../../core/store/bridge.actions';
import {
  DB_NAME,
  DB_SCHEMA_VERSION,
  ROW_REVISION,
  countAll,
  exportSnapshot,
  importSnapshot,
  resetDatabase,
  schemaInfo,
  type DatabaseSnapshot,
} from '../../../core/utils/db';
import { backupFilename, downloadCsv, downloadJson, nowDateTime, readJsonFile } from '../../../core/utils/export';
import { share } from '../../../core/utils/unit';
import { IdbTableService } from '../../../core/services/idb-table.service';
import { StatBadgeComponent } from '../../../shared/components/common/stat-badge.component';
import { EmptyPanelComponent } from '../../../shared/components/common/empty-panel.component';
import { FilterBarComponent, type FilterSelectSpec } from '../../../shared/components/common/filter-bar.component';
import { GradeTagComponent } from '../../../shared/components/common/grade-tag.component';
import type {
  AcceptanceRow,
  BearingRow,
  BridgeRow,
  PierRow,
} from '../../../core/utils/db';

/**
 * /acceptances 分步验收与归档
 * 四步签署（顶升到位 / 支座就位 / 落梁 / 竣工）、竣工归档与结构版本 JSON 导出 / 导入；
 * 消费 Acceptance、Bearing 与全部模型以及 <EmptyPanel>。
 */
@Component({
  selector: 'app-acceptance-archive-page',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatCheckboxModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
    StatBadgeComponent,
    EmptyPanelComponent,
    FilterBarComponent,
    GradeTagComponent,
  ],
  template: `
    <div class="page-head">
      <div>
        <h2 class="page-title">分步验收与归档</h2>
        <div class="page-sub">
          按「顶升到位 → 支座就位 → 落梁 → 竣工」四步签署验收，全部支座合格后可执行竣工归档，并支持整库 JSON 迁移。
        </div>
      </div>
      <div class="gb-inline-actions">
        <button mat-stroked-button (click)="handleExport()">
          <mat-icon>cloud_download</mat-icon>
          导出 JSON
        </button>
        <label class="upload-label">
          <input type="file" accept="application/json" hidden (change)="handleImport($event)" />
          <span mat-stroked-button>
            <mat-icon>cloud_upload</mat-icon>
            导入 JSON
          </span>
        </label>
        <button mat-flat-button color="warn" (click)="handleReset()">
          <mat-icon>restart_alt</mat-icon>
          重置演示数据
        </button>
      </div>
    </div>

    <div class="stat-grid">
      <app-stat-badge title="验收记录" [value]="stats().total" [suffix]="'条'" color="#1565c0" />
      <app-stat-badge
        title="合格 / 不合格"
        [value]="stats().pass + ' / ' + stats().fail"
        color="#2e7d32"
        hint="不合格记录需整改后重新签署"
      />
      <app-stat-badge
        title="支座验收完成率"
        [value]="acceptanceRate()"
        [suffix]="'%'"
        [percent]="acceptanceRate()"
        color="#00897b"
        [hint]="fullyAcceptedCount() + ' / ' + bearings().length + ' 个支座四步全合格'"
      />
      <app-stat-badge
        title="累计顶升量"
        [value]="stepStats().cumulativeMm"
        [suffix]="'mm'"
        color="#3949ab"
        [hint]="'共 ' + stepStats().total + ' 级顶升、' + stepStats().readingCount + ' 条读数'"
      />
    </div>

    @if (lastArchiveSummary()) {
      <mat-card appearance="outlined" class="gb-section">
        <div style="padding: 12px 14px">
          <div class="gb-card-title">归档提示</div>
          <div class="gb-hint" style="margin-top: 6px">{{ lastArchiveSummary() }}</div>
        </div>
      </mat-card>
    }

    <app-filter-bar
      keywordLabel="关键字"
      keywordPlaceholder="按支座序号 / 规格 / 验收人搜索"
      [keyword]="keyword()"
      [selects]="selects()"
      [values]="filters()"
      [resultCount]="filtered().length"
      countUnit="条验收"
      (keywordChange)="onKeyword($event)"
      (filtersChange)="onFilters($event)"
    >
      <button mat-stroked-button (click)="exportCsv()">
        <mat-icon>download</mat-icon>
        导出 CSV
      </button>
    </app-filter-bar>

    <div class="gb-section">
      <mat-card appearance="outlined">
        <div style="padding: 12px 14px">
          <div class="gb-card-title">批量分步签署</div>
          <div class="gb-inline-actions" style="margin-top: 10px">
            <mat-form-field appearance="outline" style="min-width: 200px">
              <mat-label>验收分步</mat-label>
              <mat-select [ngModel]="batchStage()" (ngModelChange)="batchStage.set($event)">
                @for (stage of stages; track stage) {
                  <mat-option [value]="stage">{{ stageLabel[stage] }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" style="min-width: 170px">
              <mat-label>验收结论</mat-label>
              <mat-select [ngModel]="batchConclusion()" (ngModelChange)="batchConclusion.set($event)">
                @for (conclusion of conclusions; track conclusion) {
                  <mat-option [value]="conclusion">{{ conclusionLabel[conclusion] }}</mat-option>
                }
              </mat-select>
            </mat-form-field>
            <mat-form-field appearance="outline" style="min-width: 180px">
              <mat-label>验收人</mat-label>
              <input matInput [ngModel]="acceptor()" (ngModelChange)="acceptor.set($event)" />
            </mat-form-field>
            <mat-form-field appearance="outline" style="min-width: 240px">
              <mat-label>验收时间</mat-label>
              <input
                matInput
                type="datetime-local"
                [ngModel]="acceptedAt()"
                (ngModelChange)="acceptedAt.set($event)"
              />
            </mat-form-field>
            <button mat-flat-button color="primary" [disabled]="selected().length === 0" (click)="bulkSign()">
              <mat-icon>fact_check</mat-icon>
              批量签署（{{ selected().length }} 个支座）
            </button>
            <button mat-stroked-button (click)="selectAllBearings()">
              全选支座
            </button>
            <button mat-stroked-button (click)="selected.set([])">清空选择</button>
          </div>
          <div class="gb-hint">{{ stageHint() }}</div>
        </div>
      </mat-card>
    </div>

    <div class="gb-section">
      <div class="gb-card-title" style="margin-bottom: 8px">支座验收进度（{{ bearingRows().length }} 个支座）</div>
      @if (bearingRows().length === 0) {
        <app-empty-panel
          title="尚未登记支座"
          description="请先在桥梁与墩台页录入墩台与支座，再进行分步验收。"
          icon="fact_check"
          actionLabel="去桥梁与墩台"
          (action)="go(ROUTES.bridges)"
        />
      } @else {
        <div class="gb-table-wrap">
          <table class="gb-table">
            <thead>
              <tr>
                <th style="width: 42px"></th>
                <th>桥梁 / 墩台</th>
                <th>支座</th>
                <th>规格</th>
                <th>病害等级</th>
                <th>四步进度</th>
                <th>结论摘要</th>
                <th style="width: 190px">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (row of bearingRows(); track row.id) {
                <tr [class.is-selected]="selected().includes(row.id)">
                  <td>
                    <mat-checkbox
                      [checked]="selected().includes(row.id)"
                      (change)="toggleBearing(row.id)"
                    ></mat-checkbox>
                  </td>
                  <td>{{ row.bridgeName }} · {{ row.pierCode }}</td>
                  <td>{{ row.serial }}</td>
                  <td class="gb-mono">{{ row.spec }}</td>
                  <td><app-grade-tag [grade]="row.diseaseGrade" /></td>
                  <td>
                    <div class="gb-tags">
                      @for (stage of stages; track stage) {
                        <mat-chip [class]="chipClass(row.id, stage)">
                          {{ stageLabel[stage] }}{{ passed(row.id, stage) ? ' ✓' : '' }}
                        </mat-chip>
                      }
                    </div>
                  </td>
                  <td class="gb-hint">{{ summaryOf(row.id) }}</td>
                  <td>
                    <div class="gb-row-actions">
                      <button mat-button color="primary" (click)="signOne(row.id, 'lifted')">顶升到位</button>
                      <button mat-button (click)="signOne(row.id, 'bearingPlaced')">支座就位</button>
                      <button mat-button (click)="signOne(row.id, 'beamLowered')">落梁</button>
                      <button mat-button (click)="signOne(row.id, 'completed')">竣工</button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <div class="gb-section">
      <div class="gb-card-title" style="margin-bottom: 8px">验收记录（{{ filtered().length }} 条）</div>
      @if (filtered().length === 0) {
        <app-empty-panel
          title="暂无验收记录"
          description="使用上方批量签署或表格内分步按钮登记验收结论。"
          icon="history"
        />
      } @else {
        <div class="gb-table-wrap">
          <table class="gb-table">
            <thead>
              <tr>
                <th>分步</th>
                <th>桥梁 / 墩台</th>
                <th>支座</th>
                <th>结论</th>
                <th>验收人</th>
                <th>验收时间</th>
                <th style="width: 210px">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (record of filtered(); track record.id) {
                <tr>
                  <td>{{ stageLabel[record.stage] }}</td>
                  <td>{{ record.bridgeName }} · {{ record.pierCode }}</td>
                  <td>{{ record.bearingSerial }} · {{ record.bearingSpec }}</td>
                  <td><app-grade-tag [conclusion]="record.conclusion" /></td>
                  <td>{{ record.acceptor }}</td>
                  <td>{{ record.acceptedAt }}</td>
                  <td>
                    <div class="gb-row-actions">
                      <button mat-button (click)="toggleConclusion(record)">
                        <mat-icon>swap_horiz</mat-icon>
                        {{ record.conclusion === 'pass' ? '改判不合格' : '改判合格' }}
                      </button>
                      <button mat-button color="warn" (click)="deleteRecord(record)">
                        <mat-icon>delete</mat-icon>
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

    <div class="stat-grid gb-section">
      @for (stage of stats().byStage; track stage.stage) {
        <app-stat-badge
          [title]="stage.label + ' 验收'"
          [value]="stage.pass + ' / ' + stage.count"
          [suffix]="'合格/总数'"
          [percent]="share(stage.pass, stage.count)"
          color="#1565c0"
        />
      }
    </div>

    <mat-card appearance="outlined" class="gb-section">
      <div style="padding: 12px 14px">
        <div class="gb-card-title">竣工归档</div>
        <div class="gb-hint" style="margin-top: 6px">{{ archiveHintText() }}</div>
        <div class="gb-tags" style="margin-top: 10px">
          @for (bridge of bridges(); track bridge.id) {
            <mat-chip highlighted>
              {{ bridge.name }}：{{ bridge.archived ? '已归档' : '未归档' }}
              @if (bridge.id === activeBridgeId()) {
                <span>（当前）</span>
              }
            </mat-chip>
          }
        </div>
        <div class="gb-inline-actions" style="margin-top: 10px">
          <button mat-flat-button color="primary" [disabled]="!activeBridgeId()" (click)="archiveActive(true)">
            <mat-icon>archive</mat-icon>
            执行竣工归档
          </button>
          <button mat-stroked-button [disabled]="!activeBridgeId()" (click)="archiveActive(false)">
            <mat-icon>unarchive</mat-icon>
            撤销归档
          </button>
        </div>
      </div>
    </mat-card>

    <mat-card appearance="outlined" class="gb-section">
      <div style="padding: 12px 14px">
        <div class="gb-card-title">结构版本与存储</div>
        <div class="gb-tags" style="margin-top: 8px">
          <mat-chip highlighted>IndexedDB 库名 {{ schema.dbName }}</mat-chip>
          <mat-chip>结构版本 v{{ schema.schemaVersion }}</mat-chip>
          <mat-chip>行修订号 {{ schema.rowRevision }}</mat-chip>
          <mat-chip>基准日期 {{ schema.today }}</mat-chip>
        </div>
        <div class="gb-tags" style="margin-top: 8px">
          @for (entry of tableCounts(); track entry.table) {
            <mat-chip>{{ entry.table }} {{ entry.count }}</mat-chip>
          }
        </div>
        <div class="gb-hint" style="margin-top: 8px">
          全部数据仅保存在当前浏览器 IndexedDB（{{ dbName }}）；数据结构升级登记在 core/utils/db.ts 的 Dexie
          version 与 upgrade 中，导出 JSON 可用于换机迁移与竣工资料留档。
        </div>
      </div>
    </mat-card>
  `,
  styles: [
    `
      .upload-label {
        display: inline-block;
      }
      mat-chip.stage-done {
        background: #e8f5e9 !important;
        color: #1b5e20 !important;
      }
      mat-chip.stage-pending {
        background: #eceff1 !important;
        color: #546e7a !important;
      }
    `,
  ],
})
export class AcceptanceArchivePage {
  private readonly store = inject(Store);
  private readonly idb = inject(IdbTableService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly ROUTES = ROUTES;
  readonly stages = ACCEPTANCE_STAGES;
  readonly conclusions = ACCEPTANCE_CONCLUSIONS;
  readonly stageLabel = ACCEPTANCE_STAGE_LABEL;
  readonly conclusionLabel = ACCEPTANCE_CONCLUSION_LABEL;
  readonly dbName = DB_NAME;
  readonly share = share;
  readonly schema = schemaInfo();

  readonly bridges: Signal<BridgeRow[]> = toSignal(this.store.select(selectBridges), {
    initialValue: [] as BridgeRow[],
  });
  private readonly piers: Signal<PierRow[]> = toSignal(this.store.select(selectPiers), {
    initialValue: [] as PierRow[],
  });
  readonly bearings: Signal<BearingRow[]> = toSignal(this.store.select(selectBearings), {
    initialValue: [] as BearingRow[],
  });
  readonly activeBridgeId = toSignal(this.store.select((state) => state.bridge.activeBridgeId), {
    initialValue: null as string | null,
  });
  private readonly acceptances: Signal<AcceptanceRow[]> = toSignal(
    this.store.select((state) => state.acceptance.acceptances),
    { initialValue: [] as AcceptanceRow[] },
  );
  private readonly counts = toSignal(this.idb.countAll$(), { initialValue: {} as Record<string, number> });

  readonly stats = toSignal(this.store.select(selectAcceptanceStats), {
    initialValue: { total: 0, pass: 0, fail: 0, byStage: [] },
  });
  readonly lastArchiveSummary = toSignal(this.store.select(selectLastArchiveSummary), { initialValue: '' });
  readonly stepStats = toSignal(this.store.select(selectStepStats), {
    initialValue: {
      total: 0,
      cumulativeMm: 0,
      arrived: 0,
      lifting: 0,
      idle: 0,
      readingCount: 0,
      maxLimitMm: 0,
    },
  });

  readonly keyword = signal('');
  readonly filters = signal<Record<string, string[]>>({ bridge: [], stage: [], conclusion: [] });
  readonly selected = signal<string[]>([]);
  readonly batchStage = signal<AcceptanceStage>('lifted');
  readonly batchConclusion = signal<AcceptanceConclusion>('pass');
  readonly acceptor = signal('王监理');
  readonly acceptedAt = signal(nowDateTime().replace(' ', 'T'));

  readonly selects = computed<FilterSelectSpec[]>(() => [
    { key: 'bridge', label: '桥梁', options: this.bridges().map((item) => item.name) },
    { key: 'stage', label: '分步', options: ACCEPTANCE_STAGES.map((stage) => ACCEPTANCE_STAGE_LABEL[stage]) },
    {
      key: 'conclusion',
      label: '结论',
      options: ACCEPTANCE_CONCLUSIONS.map((item) => ACCEPTANCE_CONCLUSION_LABEL[item]),
    },
  ]);

  /** 验收视图（带支座 / 桥梁上下文） */
  readonly acceptanceViews: Signal<AcceptanceView[]> = computed(() =>
    buildAcceptanceViews(this.acceptances(), this.bearings(), this.piers(), this.bridges()),
  );

  readonly filtered = computed(() => {
    const lower = this.keyword().trim().toLowerCase();
    const bridgeNames = this.filters()['bridge'] ?? [];
    const stageLabels = this.filters()['stage'] ?? [];
    const conclusionLabels = this.filters()['conclusion'] ?? [];
    return this.acceptanceViews().filter((record) => {
      if (bridgeNames.length > 0 && !bridgeNames.includes(record.bridgeName)) return false;
      if (stageLabels.length > 0 && !stageLabels.includes(ACCEPTANCE_STAGE_LABEL[record.stage])) return false;
      if (conclusionLabels.length > 0 && !conclusionLabels.includes(ACCEPTANCE_CONCLUSION_LABEL[record.conclusion])) {
        return false;
      }
      if (
        lower &&
        !`${record.bearingSerial} ${record.bearingSpec} ${record.acceptor}`.toLowerCase().includes(lower)
      ) {
        return false;
      }
      return true;
    });
  });

  /** 支座行（带桥梁 / 墩台上下文与验收进度） */
  readonly bearingRows = computed(() => {
    const bridgeMap = new Map(this.bridges().map((item) => [item.id, item.name]));
    const pierMap = new Map(this.piers().map((item) => [item.id, item]));
    return this.bearings().map((bearing) => {
      const pier = pierMap.get(bearing.pierId);
      return {
        ...bearing,
        bridgeName: pier ? (bridgeMap.get(pier.bridgeId) ?? '未归属桥梁') : '未归属桥梁',
        pierCode: pier?.code ?? '-',
      };
    });
  });

  readonly fullyAcceptedCount = computed(
    () => this.bearingRows().filter((bearing) => this.fullyAccepted(bearing.id)).length,
  );

  readonly acceptanceRate = computed(() => share(this.fullyAcceptedCount(), this.bearingRows().length));

  readonly tableCounts = computed(() =>
    Object.entries(this.counts()).map(([table, count]) => ({ table, count })),
  );

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      this.keyword.set(params.get('kw') ?? '');
      const next: Record<string, string[]> = { bridge: [], stage: [], conclusion: [] };
      for (const key of Object.keys(next)) {
        const raw = params.get(key);
        next[key] = raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
      }
      this.filters.set(next);
    });
    // 默认全选待验收支座，便于快速批量签署
    queueMicrotask(() => {
      if (this.selected().length === 0) this.selectAllBearings();
    });
  }

  /** 某支座在指定分步是否已通过 */
  passed(bearingId: string, stage: AcceptanceStage): boolean {
    return this.acceptances().some(
      (item) => item.bearingId === bearingId && item.stage === stage && item.conclusion === 'pass',
    );
  }

  failed(bearingId: string, stage: AcceptanceStage): boolean {
    return this.acceptances().some(
      (item) => item.bearingId === bearingId && item.stage === stage && item.conclusion === 'fail',
    );
  }

  fullyAccepted(bearingId: string): boolean {
    if (this.acceptances().some((item) => item.bearingId === bearingId && item.conclusion === 'fail')) return false;
    return ACCEPTANCE_STAGES.every((stage) => this.passed(bearingId, stage));
  }

  chipClass(bearingId: string, stage: AcceptanceStage): string {
    if (this.failed(bearingId, stage)) return 'stage-pending';
    return this.passed(bearingId, stage) ? 'stage-done' : 'stage-pending';
  }

  summaryOf(bearingId: string): string {
    const passed = ACCEPTANCE_STAGES.filter((stage) => this.passed(bearingId, stage));
    const failed = ACCEPTANCE_STAGES.filter((stage) => this.failed(bearingId, stage));
    if (failed.length > 0) return `不合格分步：${failed.map((stage) => ACCEPTANCE_STAGE_LABEL[stage]).join('、')}`;
    if (passed.length === ACCEPTANCE_STAGES.length) return '四步验收全部合格，可归档';
    const missing = ACCEPTANCE_STAGES.filter((stage) => !passed.includes(stage));
    return `待签署：${missing.map((stage) => ACCEPTANCE_STAGE_LABEL[stage]).join('、')}`;
  }

  stageHint(): string {
    const passedStages = ACCEPTANCE_STAGES.filter((stage) =>
      this.selected().some((bearingId) => this.passed(bearingId, stage)),
    );
    return stageOrderHint(this.batchStage(), passedStages);
  }

  archiveHintText(): string {
    const bridge = this.bridges().find((item) => item.id === this.activeBridgeId());
    if (!bridge) return '请先在桥梁页选择一座桥梁';
    const pierIds = new Set(this.piers().filter((item) => item.bridgeId === bridge.id).map((item) => item.id));
    const owned = this.bearingRows().filter((bearing) => pierIds.has(bearing.pierId));
    const passCount = owned.filter((bearing) => this.fullyAccepted(bearing.id)).length;
    return `${bridge.name}：${archiveHint(passCount, owned.length)}`;
  }

  toggleBearing(bearingId: string): void {
    this.selected.set(
      this.selected().includes(bearingId)
        ? this.selected().filter((item) => item !== bearingId)
        : [...this.selected(), bearingId],
    );
  }

  selectAllBearings(): void {
    this.selected.set(this.bearingRows().map((item) => item.id));
  }

  signOne(bearingId: string, stage: AcceptanceStage): void {
    this.store.dispatch(
      acceptanceActions.bulkSign({
        bearingIds: [bearingId],
        draft: {
          stage,
          conclusion: 'pass',
          acceptor: this.acceptor(),
          acceptedAt: this.acceptedAt().replace('T', ' '),
        },
      }),
    );
    this.notify(`已签署「${ACCEPTANCE_STAGE_LABEL[stage]}」验收`);
  }

  bulkSign(): void {
    const ids = this.selected();
    if (ids.length === 0) return;
    this.store.dispatch(
      acceptanceActions.bulkSign({
        bearingIds: ids,
        draft: {
          stage: this.batchStage(),
          conclusion: this.batchConclusion(),
          acceptor: this.acceptor(),
          acceptedAt: this.acceptedAt().replace('T', ' '),
        },
      }),
    );
    this.notify(
      `已为 ${ids.length} 个支座签署「${ACCEPTANCE_STAGE_LABEL[this.batchStage()]}」结论：${
        ACCEPTANCE_CONCLUSION_LABEL[this.batchConclusion()]
      }`,
    );
  }

  toggleConclusion(record: AcceptanceView): void {
    this.store.dispatch(
      acceptanceActions.updateAcceptance({
        id: record.id,
        draft: {
          bearingId: record.bearingId,
          stage: record.stage,
          conclusion: record.conclusion === 'pass' ? 'fail' : 'pass',
          acceptor: record.acceptor,
          acceptedAt: record.acceptedAt,
        },
      }),
    );
    this.notify(`${ACCEPTANCE_STAGE_LABEL[record.stage]} 结论已改判`);
  }

  deleteRecord(record: AcceptanceView): void {
    if (!confirm(`确认删除「${ACCEPTANCE_STAGE_LABEL[record.stage]}」验收记录？`)) return;
    this.store.dispatch(acceptanceActions.deleteAcceptance({ id: record.id }));
    this.notify('验收记录已删除');
  }

  archiveActive(archived: boolean): void {
    const bridgeId = this.activeBridgeId();
    if (!bridgeId) return;
    const bridge = this.bridges().find((item) => item.id === bridgeId);
    if (!bridge) return;
    const summary = archiveSummary({
      bridgeName: bridge.name,
      bearingCount: this.bearingRows().length,
      totalLiftMm: this.stepStats().cumulativeMm,
      stepCount: this.stepStats().total,
      readingCount: this.stepStats().readingCount,
    });
    if (archived) {
      const pierIds = new Set(this.piers().filter((item) => item.bridgeId === bridgeId).map((item) => item.id));
      const owned = this.bearingRows().filter((bearing) => pierIds.has(bearing.pierId));
      const passCount = owned.filter((bearing) => this.fullyAccepted(bearing.id)).length;
      if (owned.length === 0 || passCount < owned.length) {
        this.notify(`不满足归档条件：${archiveHint(passCount, owned.length)}`);
        return;
      }
    }
    this.store.dispatch(acceptanceActions.archiveBridge({ bridgeId, archived, summary }));
    this.store.dispatch(bridgeActions.archiveBridge({ id: bridgeId, archived }));
    this.notify(archived ? '桥梁已竣工归档' : '已撤销桥梁归档');
  }

  async handleExport(): Promise<void> {
    const snapshot = await exportSnapshot();
    downloadJson(backupFilename(`gbbridgebear-backup-v${DB_SCHEMA_VERSION}`), snapshot);
    this.notify(`已导出 ${snapshot.bridges.length} 座桥梁等全部数据的 JSON 备份`);
  }

  async handleImport(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    try {
      const snapshot = await readJsonFile<DatabaseSnapshot>(file);
      if (!snapshot || !Array.isArray(snapshot.bridges)) {
        this.notify('文件格式不正确：缺少 bridges 数组');
        return;
      }
      await importSnapshot(snapshot);
      this.idb.emitChange();
      this.notify(`导入完成：${snapshot.bridges.length} 座桥梁、${snapshot.bearings?.length ?? 0} 个支座`);
    } catch (error) {
      this.notify(`导入失败：${error instanceof Error ? error.message : '文件解析异常'}`);
    }
  }

  async handleReset(): Promise<void> {
    if (!confirm('确认清空当前全部本地数据并重新播种演示数据？')) return;
    await resetDatabase();
    this.idb.emitChange();
    this.notify('已清空并重新播种演示数据');
  }

  exportCsv(): void {
    const header = ['分步', '桥梁', '墩台', '支座', '规格', '结论', '验收人', '验收时间'];
    const body = this.filtered().map((record) => [
      ACCEPTANCE_STAGE_LABEL[record.stage],
      record.bridgeName,
      record.pierCode,
      record.bearingSerial,
      record.bearingSpec,
      ACCEPTANCE_CONCLUSION_LABEL[record.conclusion],
      record.acceptor,
      record.acceptedAt,
    ]);
    downloadCsv(`gbbridgebear-acceptance-${new Date().toISOString().slice(0, 10)}.csv`, [header, ...body]);
    this.notify('验收清单已导出 CSV');
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }

  onKeyword(value: string): void {
    this.keyword.set(value);
    this.syncQuery(value, this.filters());
  }

  onFilters(values: Record<string, string[]>): void {
    this.filters.set(values);
    this.syncQuery(this.keyword(), values);
  }

  private syncQuery(keyword: string, values: Record<string, string[]>): void {
    const queryParams: Record<string, string> = {};
    if (keyword.trim()) queryParams['kw'] = keyword.trim();
    for (const [key, list] of Object.entries(values)) {
      if (list.length > 0) queryParams[key] = list.join(',');
    }
    void this.router.navigate([], { relativeTo: this.route, queryParams, replaceUrl: true });
  }

  private notify(message: string): void {
    this.snackBar.open(message, '关闭', { duration: 2800 });
  }
}
