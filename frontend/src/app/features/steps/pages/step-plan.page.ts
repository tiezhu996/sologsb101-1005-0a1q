import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Inject } from '@angular/core';
import {
  STEP_STATES,
  STEP_STATE_FLOW,
  STEP_STATE_LABEL,
  SYNC_REQUIREMENTS,
  SYNC_REQUIREMENT_LABEL,
  cumulativeHint,
  liftStepHint,
  syncLayoutHint,
  type StepDraft,
  type StepState,
  type StepView,
  type SyncRequirement,
} from '../../../core/types/step';
import { ROUTES } from '../../../core/router/app.routes';
import { stepActions } from '../../../core/store/step.actions';
import {
  buildStepViews,
  selectStepAverages,
  selectStepStats,
  selectSyncHints,
  selectSyncLevels,
} from '../../../core/store/step.selectors';
import { selectBridges } from '../../../core/store/bridge.selectors';
import { formatLift, formatMm, share } from '../../../core/utils/unit';
import { TOLERANCE_HEX, TOLERANCE_LEVEL_LABEL } from '../../../core/utils/tolerance';
import { StatBadgeComponent } from '../../../shared/components/common/stat-badge.component';
import { EmptyPanelComponent } from '../../../shared/components/common/empty-panel.component';
import { FilterBarComponent, type FilterSelectSpec } from '../../../shared/components/common/filter-bar.component';
import type { BridgeRow, ReadingRow, StepRow } from '../../../core/utils/db';
import type { ToleranceLevel } from '../../../core/utils/tolerance';

/** 顶升步骤表单对话框数据 */
export interface StepDialogData {
  draft: StepDraft;
  editingId: string | null;
  bridges: Array<{ id: string; name: string }>;
}

/** 顶升步骤表单对话框 */
@Component({
  selector: 'app-step-dialog',
  standalone: true,
  imports: [
    FormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.editingId ? '编辑顶升步骤' : '新增顶升步骤' }}</h2>
    <mat-dialog-content>
      <div class="gb-form-grid">
        <mat-form-field appearance="outline">
          <mat-label>所属桥梁</mat-label>
          <mat-select [(ngModel)]="draft.bridgeId">
            @for (bridge of data.bridges; track bridge.id) {
              <mat-option [value]="bridge.id">{{ bridge.name }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>目标顶升量（mm）</mat-label>
          <input matInput type="number" step="0.5" [(ngModel)]="draft.targetLiftMm" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>同步要求</mat-label>
          <mat-select [(ngModel)]="draft.syncRequirement">
            @for (item of syncRequirements; track item) {
              <mat-option [value]="item">{{ syncRequirementLabel[item] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>限位值（mm）</mat-label>
          <input matInput type="number" step="1" [(ngModel)]="draft.limitMm" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>负责人</mat-label>
          <input matInput [(ngModel)]="draft.leader" />
        </mat-form-field>
      </div>
      <p class="gb-hint">{{ hint }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">取消</button>
      <button mat-flat-button color="primary" [disabled]="!draft.leader.trim()" (click)="submit()">保存</button>
    </mat-dialog-actions>
  `,
})
export class StepDialogComponent {
  readonly syncRequirements = SYNC_REQUIREMENTS;
  readonly syncRequirementLabel = SYNC_REQUIREMENT_LABEL;
  readonly draft: StepDraft;

  constructor(
    private readonly dialogRef: MatDialogRef<StepDialogComponent>,
    @Inject(MAT_DIALOG_DATA) readonly data: StepDialogData,
  ) {
    this.draft = { ...data.draft };
  }

  get hint(): string {
    return `${liftStepHint(this.draft.targetLiftMm, this.draft.limitMm)} · ${syncLayoutHint(this.draft.syncRequirement)}`;
  }

  close(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    this.dialogRef.close({ ...this.draft });
  }
}

/**
 * /steps 顶升步骤编排
 * 分级 / 同步 / 限位参数编排与顺序调整、累计顶升量校验；
 * 消费 Step、Bridge 与 <GradeTag>、<StatBadge>。
 */
@Component({
  selector: 'app-step-plan-page',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatDialogModule,
    MatSnackBarModule,
    MatTooltipModule,
    StatBadgeComponent,
    EmptyPanelComponent,
    FilterBarComponent,
  ],
  template: `
    <div class="page-head">
      <div>
        <h2 class="page-title">顶升步骤编排</h2>
        <div class="page-sub">
          按级编排顶升量、同步要求与限位值，支持上移 / 下移调序；累计顶升量超过限位值会即时告警。
        </div>
      </div>
      <div class="gb-inline-actions">
        <button mat-stroked-button (click)="go(ROUTES.readings)">
          <mat-icon>monitor_heart</mat-icon>
          去录入读数
        </button>
        <button mat-flat-button color="primary" [disabled]="!activeBridgeId()" (click)="openDialog(null)">
          <mat-icon>add</mat-icon>
          新增步骤
        </button>
      </div>
    </div>

    <div class="stat-grid">
      <app-stat-badge title="顶升级数" [value]="stats().total" [suffix]="'级'" color="#1565c0" />
      <app-stat-badge
        title="累计目标顶升量"
        [value]="stats().cumulativeMm"
        [suffix]="'mm'"
        color="#00897b"
        [hint]="'最大限位值 ' + stats().maxLimitMm + ' mm'"
      />
      <app-stat-badge
        title="已到位 / 顶升中"
        [value]="stats().arrived + ' / ' + stats().lifting"
        color="#2e7d32"
        [hint]="'未开始 ' + stats().idle + ' 级'"
      />
      <app-stat-badge
        title="测点读数"
        [value]="stats().readingCount"
        [suffix]="'条'"
        color="#3949ab"
        hint="同步偏差按步骤内读数极差计算"
      />
    </div>

    <app-filter-bar
      keywordLabel="关键字"
      keywordPlaceholder="按桥梁 / 负责人搜索"
      [keyword]="keyword()"
      [selects]="selects()"
      [values]="filters()"
      [resultCount]="filtered().length"
      countUnit="级步骤"
      (keywordChange)="onKeyword($event)"
      (filtersChange)="onFilters($event)"
    >
      <button mat-stroked-button (click)="selectActive()">
        <mat-icon>my_location</mat-icon>
        只看当前桥梁
      </button>
      <button mat-stroked-button [disabled]="!activeBridgeId()" (click)="sortByLift()">
        <mat-icon>sort</mat-icon>
        按顶升量重排
      </button>
    </app-filter-bar>

    @if (filtered().length === 0) {
      <app-empty-panel
        title="没有匹配的顶升步骤"
        description="先在桥梁页建档，再编排分级顶升步骤。"
        icon="stairs"
        actionLabel="新增步骤"
        (action)="openDialog(null)"
        secondaryLabel="清空筛选"
        (secondary)="clearFilters()"
      />
    } @else {
      <div class="gb-table-wrap">
        <table class="gb-table">
          <thead>
            <tr>
              <th style="width: 60px">序</th>
              <th>桥梁</th>
              <th>目标顶升量</th>
              <th>累计顶升量</th>
              <th>限位值</th>
              <th>同步要求</th>
              <th>负责人</th>
              <th>状态</th>
              <th>测点 / 偏差</th>
              <th>校验结论</th>
              <th style="width: 260px">操作</th>
            </tr>
          </thead>
          <tbody>
            @for (step of filtered(); track step.id) {
              <tr>
                <td>{{ step.seq }}</td>
                <td>{{ step.bridgeName }}</td>
                <td>{{ formatLift(step.targetLiftMm) }}</td>
                <td [style.color]="step.overLimit ? '#c62828' : '#16222e'">
                  {{ step.cumulativeLiftMm }} mm
                </td>
                <td>{{ step.limitMm }} mm</td>
                <td [matTooltip]="syncHintOf(step)">{{ syncRequirementLabel[step.syncRequirement] }}</td>
                <td>{{ step.leader }}</td>
                <td>
                  <mat-chip-set>
                    <mat-chip [class]="'state-' + step.state">{{ stepStateLabel[step.state] }}</mat-chip>
                  </mat-chip-set>
                </td>
                <td>
                  {{ step.readingCount }} 条
                  @if (step.syncDeviationMm !== null) {
                    <span [style.color]="levelColor(step)">
                      / 偏差 {{ formatMm(step.syncDeviationMm) }}（{{ levelLabel(step) }}）
                    </span>
                  }
                </td>
                <td class="gb-hint">{{ step.validation }}</td>
                <td>
                  <div class="gb-row-actions">
                    <button mat-button [disabled]="$first" (click)="move(step, -1)">
                      <mat-icon>arrow_upward</mat-icon>
                    </button>
                    <button mat-button [disabled]="$last" (click)="move(step, 1)">
                      <mat-icon>arrow_downward</mat-icon>
                    </button>
                    @for (next of nextStates(step.state); track next) {
                      <button mat-button color="primary" (click)="advance(step, next)">
                        <mat-icon>play_arrow</mat-icon>
                        {{ stepStateLabel[next] }}
                      </button>
                    }
                    <button mat-button (click)="openDialog(step)">
                      <mat-icon>edit</mat-icon>
                    </button>
                    <button mat-button color="warn" (click)="deleteStep(step)">
                      <mat-icon>delete</mat-icon>
                    </button>
                  </div>
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }

    <div class="stat-grid gb-section">
      <app-stat-badge
        title="累计顶升余量"
        [value]="remainingMm()"
        [suffix]="'mm'"
        [percent]="usedShare()"
        color="#1565c0"
        hint="进度条为累计顶升量 / 最大限位值"
      />
      <app-stat-badge
        title="同步达标步骤"
        [value]="okSteps().length"
        [suffix]="'/' + filtered().length"
        color="#2e7d32"
        hint="同步偏差处于正常档的步骤数"
      />
      <app-stat-badge
        title="超限步骤"
        [value]="exceedSteps().length"
        [suffix]="'级'"
        color="#c62828"
        hint="累计顶升量超过限位或同步偏差超允许值"
      />
      <app-stat-badge
        title="平均单级顶升量"
        [value]="averageLift()"
        [suffix]="'mm'"
        color="#3949ab"
        hint="单级顶升量建议不超过 5 mm"
      />
    </div>

    <mat-card appearance="outlined" class="gb-section">
      <div style="padding: 12px 14px">
        <div class="gb-card-title">同步要求布置建议</div>
        <div class="gb-tags" style="margin-top: 8px">
          @for (hint of syncHints(); track hint.id) {
            <mat-chip highlighted>#{{ hint.seq }} {{ hint.requirement }}：{{ hint.hint }}</mat-chip>
          }
        </div>
      </div>
    </mat-card>
  `,
  styles: [
    `
      mat-chip.state-idle {
        background: #eceff1 !important;
        color: #37474f !important;
      }
      mat-chip.state-lifting {
        background: #e3f2fd !important;
        color: #0d47a1 !important;
      }
      mat-chip.state-arrived {
        background: #e8f5e9 !important;
        color: #1b5e20 !important;
      }
    `,
  ],
})
export class StepPlanPage {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly ROUTES = ROUTES;
  readonly syncRequirementLabel = SYNC_REQUIREMENT_LABEL;
  readonly stepStateLabel = STEP_STATE_LABEL;
  readonly formatLift = formatLift;
  readonly formatMm = formatMm;

  readonly bridges: Signal<BridgeRow[]> = toSignal(this.store.select(selectBridges), {
    initialValue: [] as BridgeRow[],
  });
  private readonly steps: Signal<StepRow[]> = toSignal(this.store.select((state) => state.step.steps), {
    initialValue: [] as StepRow[],
  });
  private readonly readings: Signal<ReadingRow[]> = toSignal(
    this.store.select((state) => state.step.readings),
    { initialValue: [] as ReadingRow[] },
  );
  readonly activeBridgeId = toSignal(this.store.select((state) => state.step.activeBridgeId), {
    initialValue: null as string | null,
  });

  readonly stats = toSignal(this.store.select(selectStepStats), {
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
  readonly syncLevels: Signal<Record<string, ToleranceLevel>> = toSignal(
    this.store.select(selectSyncLevels),
    { initialValue: {} as Record<string, ToleranceLevel> },
  );
  readonly syncHints = toSignal(this.store.select(selectSyncHints), { initialValue: [] });
  readonly stepAverages = toSignal(this.store.select(selectStepAverages), { initialValue: {} });

  readonly stepViews: Signal<StepView[]> = computed(() =>
    buildStepViews(this.steps(), this.readings(), this.bridges()),
  );

  readonly keyword = signal('');
  readonly filters = signal<Record<string, string[]>>({ bridge: [], state: [], sync: [] });

  readonly selects = computed<FilterSelectSpec[]>(() => [
    { key: 'bridge', label: '桥梁', options: this.bridges().map((item) => item.name) },
    { key: 'state', label: '状态', options: STEP_STATES.map((item) => STEP_STATE_LABEL[item]) },
    { key: 'sync', label: '同步要求', options: SYNC_REQUIREMENTS.map((item) => SYNC_REQUIREMENT_LABEL[item]) },
  ]);

  readonly filtered = computed(() => {
    const lower = this.keyword().trim().toLowerCase();
    const bridgeNames = this.filters()['bridge'] ?? [];
    const stateLabels = this.filters()['state'] ?? [];
    const syncLabels = this.filters()['sync'] ?? [];
    return this.stepViews().filter((step) => {
      if (bridgeNames.length > 0 && !bridgeNames.includes(step.bridgeName)) return false;
      if (stateLabels.length > 0 && !stateLabels.includes(STEP_STATE_LABEL[step.state])) return false;
      if (syncLabels.length > 0 && !syncLabels.includes(SYNC_REQUIREMENT_LABEL[step.syncRequirement])) return false;
      if (lower && !`${step.bridgeName} ${step.leader}`.toLowerCase().includes(lower)) return false;
      return true;
    });
  });

  readonly okSteps = computed(() =>
    this.filtered().filter((step) => (this.syncLevels()[step.id] ?? 'ok') === 'ok' && !step.overLimit),
  );
  readonly exceedSteps = computed(() =>
    this.filtered().filter((step) => step.overLimit || this.syncLevels()[step.id] === 'exceed'),
  );

  readonly remainingMm = computed(() => {
    const stats = this.stats();
    return Number(Math.max(0, stats.maxLimitMm - stats.cumulativeMm).toFixed(2));
  });

  readonly usedShare = computed(() => {
    const stats = this.stats();
    return share(stats.cumulativeMm, stats.maxLimitMm);
  });

  readonly averageLift = computed(() => {
    const steps = this.filtered();
    if (steps.length === 0) return 0;
    return Number((steps.reduce((sum, item) => sum + item.targetLiftMm, 0) / steps.length).toFixed(2));
  });

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      this.keyword.set(params.get('kw') ?? '');
      const next: Record<string, string[]> = { bridge: [], state: [], sync: [] };
      for (const key of Object.keys(next)) {
        const raw = params.get(key);
        next[key] = raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
      }
      this.filters.set(next);
    });
  }

  nextStates(state: StepState): StepState[] {
    return STEP_STATE_FLOW[state];
  }

  syncHintOf(step: StepView): string {
    return syncLayoutHint(step.syncRequirement);
  }

  levelColor(step: StepView): string {
    const level = this.syncLevels()[step.id] ?? 'ok';
    return TOLERANCE_HEX[level];
  }

  levelLabel(step: StepView): string {
    const level = this.syncLevels()[step.id] ?? 'ok';
    return TOLERANCE_LEVEL_LABEL[level];
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }

  selectActive(): void {
    const bridgeId = this.activeBridgeId();
    if (!bridgeId) return;
    const bridge = this.bridges().find((item) => item.id === bridgeId);
    if (!bridge) return;
    const values = { ...this.filters(), bridge: [bridge.name] };
    this.filters.set(values);
    this.syncQuery(this.keyword(), values);
  }

  /** 按目标顶升量升序重排当前桥梁的步骤 */
  sortByLift(): void {
    const bridgeId = this.activeBridgeId();
    if (!bridgeId) return;
    const ordered = this.stepViews()
      .filter((item) => item.bridgeId === bridgeId)
      .sort((a, b) => a.targetLiftMm - b.targetLiftMm)
      .map((item) => item.id);
    this.store.dispatch(stepActions.reorderSteps({ orderedIds: ordered }));
    this.notify('已按目标顶升量从小到大重排步骤');
  }

  move(step: StepView, direction: -1 | 1): void {
    const sameBridge = this.stepViews().filter((item) => item.bridgeId === step.bridgeId);
    const index = sameBridge.findIndex((item) => item.id === step.id);
    const target = index + direction;
    if (target < 0 || target >= sameBridge.length) return;
    const ordered = sameBridge.map((item) => item.id);
    const [moved] = ordered.splice(index, 1);
    ordered.splice(target, 0, moved);
    this.store.dispatch(stepActions.reorderSteps({ orderedIds: ordered }));
    this.notify(`步骤 #${step.seq} 已${direction === -1 ? '上移' : '下移'}`);
  }

  advance(step: StepView, next: StepState): void {
    this.store.dispatch(stepActions.advanceState({ id: step.id, next }));
    this.notify(`步骤 #${step.seq} 已推进为${STEP_STATE_LABEL[next]}`);
  }

  openDialog(step: StepView | null): void {
    const bridgeId = step?.bridgeId ?? this.activeBridgeId() ?? this.bridges()[0]?.id ?? '';
    const draft: StepDraft = step
      ? {
          bridgeId: step.bridgeId,
          targetLiftMm: step.targetLiftMm,
          syncRequirement: step.syncRequirement,
          limitMm: step.limitMm,
          leader: step.leader,
        }
      : { bridgeId, targetLiftMm: 3, syncRequirement: 'sync', limitMm: 10, leader: '陈立强' };

    this.dialog
      .open(StepDialogComponent, {
        width: '660px',
        data: {
          draft,
          editingId: step?.id ?? null,
          bridges: this.bridges().map((item) => ({ id: item.id, name: item.name })),
        } satisfies StepDialogData,
      })
      .afterClosed()
      .subscribe((result: StepDraft | null) => {
        if (!result) return;
        if (step) {
          this.store.dispatch(stepActions.updateStep({ id: step.id, draft: result }));
          this.notify('顶升步骤已更新');
        } else {
          this.store.dispatch(stepActions.createStep({ draft: result }));
          this.notify('顶升步骤已新增，排在末级');
        }
      });
  }

  deleteStep(step: StepView): void {
    if (!confirm(`确认删除步骤 #${step.seq}（目标 ${step.targetLiftMm} mm）及其测点读数？`)) return;
    this.store.dispatch(stepActions.deleteStep({ id: step.id }));
    this.notify('顶升步骤及其读数已删除');
  }

  onKeyword(value: string): void {
    this.keyword.set(value);
    this.syncQuery(value, this.filters());
  }

  onFilters(values: Record<string, string[]>): void {
    this.filters.set(values);
    this.syncQuery(this.keyword(), values);
  }

  clearFilters(): void {
    this.keyword.set('');
    this.filters.set({ bridge: [], state: [], sync: [] });
    this.syncQuery('', { bridge: [], state: [], sync: [] });
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
    this.snackBar.open(message, '关闭', { duration: 2600 });
  }
}
