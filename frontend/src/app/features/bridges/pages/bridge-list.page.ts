import { Component, computed, inject, signal, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router } from '@angular/router';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { filter as rxFilter } from 'rxjs';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Inject } from '@angular/core';
import {
  BRIDGE_TYPES,
  BRIDGE_TYPE_LABEL,
  ROAD_CLASSES,
  ROAD_CLASS_LABEL,
  bridgeAgeLevel,
  bridgeLiftNote,
  parseSpanCombo,
  totalLengthM,
  type BridgeDraft,
  type BridgeType,
  type BridgeView,
  type RoadClass,
} from '../../../core/types/bridge';
import {
  PIER_TYPES,
  PIER_TYPE_LABEL,
  bearingCountHint,
  type PierDraft,
  type PierType,
  type PierView,
} from '../../../core/types/pier';
import { ROUTES } from '../../../core/router/app.routes';
import { bridgeActions } from '../../../core/store/bridge.actions';
import { selectBridgeStats, selectBridgeViews, selectActiveBridgeId } from '../../../core/store/bridge.selectors';
import { selectBearings } from '../../../core/store/bearing.selectors';
import type { PierRow } from '../../../core/utils/db';
import { needReplacement } from '../../../core/types/bearing';
import { share } from '../../../core/utils/unit';
import { StatBadgeComponent } from '../../../shared/components/common/stat-badge.component';
import { EmptyPanelComponent } from '../../../shared/components/common/empty-panel.component';
import { FilterBarComponent, type FilterSelectSpec } from '../../../shared/components/common/filter-bar.component';
import { GradeTagComponent } from '../../../shared/components/common/grade-tag.component';

/** 桥梁表单对话框数据 */
export interface BridgeDialogData {
  draft: BridgeDraft;
  editingId: string | null;
}

/** 桥梁表单对话框 */
@Component({
  selector: 'app-bridge-dialog',
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
    <h2 mat-dialog-title>{{ data.editingId ? '编辑桥梁档案' : '新建桥梁档案' }}</h2>
    <mat-dialog-content>
      <div class="gb-form-grid">
        <mat-form-field appearance="outline">
          <mat-label>桥梁名称</mat-label>
          <input matInput [(ngModel)]="draft.name" required />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>跨径组合</mat-label>
          <input matInput [(ngModel)]="draft.spanCombo" placeholder="如 3×30m" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>桥型</mat-label>
          <mat-select [(ngModel)]="draft.bridgeType">
            @for (type of bridgeTypes; track type) {
              <mat-option [value]="type">{{ bridgeTypeLabel[type] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>建成年</mat-label>
          <input matInput type="number" [(ngModel)]="draft.builtYear" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>公路等级</mat-label>
          <mat-select [(ngModel)]="draft.roadClass">
            @for (item of roadClasses; track item) {
              <mat-option [value]="item">{{ roadClassLabel[item] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <p class="gb-hint">
        跨径组合示例 3×30m 表示 3 孔 30 m；桥型决定顶升关注点，可在卡片详情中查看建议。
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">取消</button>
      <button mat-flat-button color="primary" [disabled]="!draft.name.trim()" (click)="submit()">保存</button>
    </mat-dialog-actions>
  `,
})
export class BridgeDialogComponent {
  readonly bridgeTypes = BRIDGE_TYPES;
  readonly roadClasses = ROAD_CLASSES;
  readonly bridgeTypeLabel = BRIDGE_TYPE_LABEL;
  readonly roadClassLabel = ROAD_CLASS_LABEL;
  readonly draft: BridgeDraft;

  constructor(
    private readonly dialogRef: MatDialogRef<BridgeDialogComponent>,
    @Inject(MAT_DIALOG_DATA) readonly data: BridgeDialogData,
  ) {
    this.draft = { ...data.draft };
  }

  close(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    this.dialogRef.close({ ...this.draft });
  }
}

/** 墩台表单对话框数据 */
export interface PierDialogData {
  draft: PierDraft;
  editingId: string | null;
  bridges: Array<{ id: string; name: string }>;
}

/** 墩台表单对话框 */
@Component({
  selector: 'app-pier-dialog',
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
    <h2 mat-dialog-title>{{ data.editingId ? '编辑墩台' : '新增墩台' }}</h2>
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
          <mat-label>墩台编号</mat-label>
          <input matInput [(ngModel)]="draft.code" placeholder="如 1#墩" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>盖梁标高（m）</mat-label>
          <input matInput type="number" step="0.01" [(ngModel)]="draft.capElevation" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>墩台类型</mat-label>
          <mat-select [(ngModel)]="draft.type">
            @for (type of pierTypes; track type) {
              <mat-option [value]="type">{{ pierTypeLabel[type] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>设计支座数</mat-label>
          <input matInput type="number" [(ngModel)]="draft.bearingCount" />
        </mat-form-field>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">取消</button>
      <button mat-flat-button color="primary" [disabled]="!draft.code.trim()" (click)="submit()">保存</button>
    </mat-dialog-actions>
  `,
})
export class PierDialogComponent {
  readonly pierTypes = PIER_TYPES;
  readonly pierTypeLabel = PIER_TYPE_LABEL;
  readonly draft: PierDraft;

  constructor(
    private readonly dialogRef: MatDialogRef<PierDialogComponent>,
    @Inject(MAT_DIALOG_DATA) readonly data: PierDialogData,
  ) {
    this.draft = { ...data.draft };
  }

  close(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    this.dialogRef.close({ ...this.draft });
  }
}

/**
 * /bridges 桥梁与墩台
 * 建立桥梁与墩台台账，按桥型与建成年筛选；卡片回显墩台数与待换支座数。
 * 消费 Bridge、Pier 与 <StatBadge>、<EmptyPanel>、<FilterBar>。
 */
@Component({
  selector: 'app-bridge-list-page',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatDialogModule,
    MatSnackBarModule,
    StatBadgeComponent,
    EmptyPanelComponent,
    FilterBarComponent,
    GradeTagComponent,
  ],
  template: `
    <div class="page-head">
      <div>
        <h2 class="page-title">桥梁与墩台</h2>
        <div class="page-sub">
          建立桥梁与墩台台账，按桥型与建成年筛选；卡片回显墩台数、支座数与待换支座数。
        </div>
      </div>
      <div class="gb-inline-actions">
        <button mat-stroked-button (click)="go(ROUTES.bearings)">
          <mat-icon>view_module</mat-icon>
          支座与评级
        </button>
        <button mat-flat-button color="primary" (click)="openBridgeDialog(null)">
          <mat-icon>add</mat-icon>
          新建桥梁
        </button>
      </div>
    </div>

    <div class="stat-grid">
      <app-stat-badge title="桥梁总数" [value]="stats().total" [suffix]="'座'" color="#1565c0" hint="按里程与建成年维护台账" />
      <app-stat-badge title="墩台总数" [value]="stats().piers" [suffix]="'个'" color="#00897b" />
      <app-stat-badge
        title="支座总数"
        [value]="stats().bearings"
        [suffix]="'个'"
        color="#3949ab"
        [hint]="'待更换 ' + stats().pending + ' 个（较重及以上）'"
      />
      <app-stat-badge
        title="待换支座占比"
        [value]="stats().pending"
        [suffix]="'个'"
        [percent]="pendingShare()"
        color="#c62828"
        hint="进度条为待换支座 / 支座总数"
      />
    </div>

    <app-filter-bar
      keywordLabel="关键字"
      keywordPlaceholder="按桥梁名称 / 跨径组合搜索"
      [keyword]="keyword()"
      [selects]="selects()"
      [values]="filters()"
      [resultCount]="filtered().length"
      countUnit="座桥梁"
      (keywordChange)="onKeyword($event)"
      (filtersChange)="onFilters($event)"
    >
      <button mat-stroked-button (click)="clearFilters()">
        <mat-icon>filter_alt_off</mat-icon>
        清空
      </button>
    </app-filter-bar>

    @if (filtered().length === 0) {
      <app-empty-panel
        title="没有匹配的桥梁"
        description="可新建桥梁档案并录入墩台与支座，或清空筛选条件后重试。"
        icon="foundation"
        actionLabel="新建桥梁"
        (action)="openBridgeDialog(null)"
        secondaryLabel="清空筛选"
        (secondary)="clearFilters()"
      />
    } @else {
      <div class="card-grid">
        @for (bridge of filtered(); track bridge.id) {
          <div class="gb-card" [class.is-active]="activeBridgeId() === bridge.id" (click)="select(bridge.id)">
            <div class="gb-inline-actions" style="justify-content: space-between">
              <div>
                <div class="gb-card-title">{{ bridge.name }}</div>
                <div class="gb-hint">
                  {{ bridge.spanCombo }} · 全长 {{ lengthOf(bridge) }} m · {{ bridge.builtYear }} 年建成 ·
                  {{ roadClassLabel[bridge.roadClass] }}
                </div>
              </div>
              <mat-chip-set>
                <mat-chip>{{ bridgeTypeLabel[bridge.bridgeType] }}</mat-chip>
                <mat-chip [class]="bridge.archived ? 'chip-archived' : 'chip-open'">
                  {{ bridge.archived ? '已归档' : ageLevel(bridge.builtYear) }}
                </mat-chip>
              </mat-chip-set>
            </div>

            <div class="stat-grid" style="margin: 10px 0 6px">
              <app-stat-badge title="墩台" [value]="bridge.pierCount" [suffix]="'个'" [inline]="true" color="#00897b" />
              <app-stat-badge title="支座" [value]="bridge.bearingCount" [suffix]="'个'" [inline]="true" color="#1565c0" />
              <app-stat-badge
                title="待更换"
                [value]="bridge.pendingBearingCount"
                [suffix]="'个'"
                [inline]="true"
                [color]="bridge.pendingBearingCount > 0 ? '#c62828' : '#2e7d32'"
              />
              <app-stat-badge
                title="严重级"
                [value]="bridge.severeBearingCount"
                [suffix]="'个'"
                [inline]="true"
                color="#e65100"
              />
            </div>

            <div class="gb-tags">
              @for (pier of piersOf(bridge.id); track pier.id) {
                <mat-chip highlighted (click)="openPierDialog(pier, $event)">
                  {{ pier.code }} · {{ pier.capElevation }} m ·
                  {{ pier.registeredBearingCount }}/{{ pier.bearingCount }} 支座
                </mat-chip>
              }
              @if (piersOf(bridge.id).length === 0) {
                <mat-chip>暂无墩台</mat-chip>
              }
            </div>

            <div class="gb-hint" style="margin-top: 8px">{{ liftNote(bridge.bridgeType) }}</div>

            <div class="gb-inline-actions" style="margin-top: 8px; justify-content: space-between">
              <button mat-button color="primary" (click)="openPierDialogNew(bridge.id, $event)">
                <mat-icon>add</mat-icon>
                新增墩台
              </button>
              <div class="gb-inline-actions">
                <button mat-button (click)="openBridgeDialog(bridge, $event)">
                  <mat-icon>edit</mat-icon>
                  编辑
                </button>
                <button mat-button color="warn" (click)="deleteBridge(bridge, $event)">
                  <mat-icon>delete</mat-icon>
                  删除
                </button>
                <button mat-button (click)="go(ROUTES.steps, $event)">
                  <mat-icon>stairs</mat-icon>
                  顶升编排
                </button>
              </div>
            </div>
          </div>
        }
      </div>
    }

    @if (activeBridge(); as bridge) {
      <div class="gb-section">
        <mat-card appearance="outlined">
          <div class="gb-inline-actions" style="justify-content: space-between; padding: 12px 14px">
            <div>
              <div class="gb-card-title">{{ bridge.name }} · 墩台与支座明细</div>
              <div class="gb-hint">
                跨径 {{ spanInfo(bridge) }} · 顶升作业面提示：{{ platformHint() }}
              </div>
            </div>
            <mat-chip-set>
              <mat-chip>墩台 {{ piersOf(bridge.id).length }} 个</mat-chip>
              <mat-chip>支座 {{ bearingsOf(bridge.id).length }} 个</mat-chip>
              <mat-chip highlighted>待换 {{ pendingOf(bridge.id).length }} 个</mat-chip>
            </mat-chip-set>
          </div>
          <div class="gb-table-wrap">
            <table class="gb-table">
              <thead>
                <tr>
                  <th>墩台编号</th>
                  <th>类型</th>
                  <th>盖梁标高</th>
                  <th>支座数</th>
                  <th>编号 / 规格</th>
                  <th>病害等级</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                @for (pier of piersOf(bridge.id); track pier.id) {
                  @for (bearing of bearingsOfPier(pier.id); track bearing.id; let first = $first) {
                    <tr>
                      <td>{{ first ? pier.code : '' }}</td>
                      <td>{{ first ? pierTypeLabel[pier.type] : '' }}</td>
                      <td>{{ first ? pier.capElevation + ' m' : '' }}</td>
                      <td>{{ first ? pier.registeredBearingCount + '/' + pier.bearingCount : '' }}</td>
                      <td>{{ bearing.serial }} · {{ bearing.spec }}</td>
                      <td><app-grade-tag [grade]="bearing.diseaseGrade" /></td>
                      <td>
                        @if (first) {
                          <div class="gb-row-actions">
                            <button mat-button (click)="openPierDialog(pier, $event)">
                              <mat-icon>edit</mat-icon>
                              墩台
                            </button>
                            <button mat-button color="warn" (click)="deletePier(pier.id)">
                              <mat-icon>delete</mat-icon>
                            </button>
                          </div>
                        }
                      </td>
                    </tr>
                  }
                  @if (bearingsOfPier(pier.id).length === 0) {
                    <tr>
                      <td>{{ pier.code }}</td>
                      <td>{{ pierTypeLabel[pier.type] }}</td>
                      <td>{{ pier.capElevation }} m</td>
                      <td>{{ pier.bearingCount }}</td>
                      <td class="gb-hint">{{ bearingHint(pier.bearingCount, 0) }}</td>
                      <td>—</td>
                      <td>
                        <button mat-button color="warn" (click)="deletePier(pier.id)">
                          <mat-icon>delete</mat-icon>
                          删除墩台
                        </button>
                      </td>
                    </tr>
                  }
                }
                @if (piersOf(bridge.id).length === 0) {
                  <tr>
                    <td colspan="7">
                      <app-empty-panel
                        title="该桥梁还没有墩台"
                        description="先建墩台，再在墩台下登记支座并评定病害等级。"
                        icon="layers"
                        actionLabel="新增墩台"
                        (action)="openPierDialogNew(bridge.id)"
                      />
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </mat-card>
      </div>
    }
  `,
  styles: [
    `
      mat-chip.chip-archived {
        background: #e8f5e9 !important;
        color: #1b5e20 !important;
      }
      mat-chip.chip-open {
        background: #e3f2fd !important;
        color: #0d47a1 !important;
      }
    `,
  ],
})
export class BridgeListPage {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly ROUTES = ROUTES;
  readonly bridgeTypeLabel = BRIDGE_TYPE_LABEL;
  readonly roadClassLabel = ROAD_CLASS_LABEL;
  readonly pierTypeLabel = PIER_TYPE_LABEL;

  readonly bridgeViews = toSignal(this.store.select(selectBridgeViews), { initialValue: [] as BridgeView[] });
  readonly stats = toSignal(this.store.select(selectBridgeStats), {
    initialValue: { total: 0, piers: 0, bearings: 0, pending: 0, severe: 0, archived: 0 },
  });
  readonly activeBridgeId = toSignal(this.store.select(selectActiveBridgeId), { initialValue: null });
  readonly bearings = toSignal(this.store.select(selectBearings), { initialValue: [] });

  /** 墩台原始行（补充支座统计在 piersOf 中派生） */
  readonly pierViews: Signal<PierRow[]> = toSignal(this.store.select((state) => state.bridge.piers), {
    initialValue: [] as PierRow[],
  });

  /** 筛选条件（同步 URL query） */
  readonly keyword = signal('');
  readonly filters = signal<Record<string, string[]>>({ bridgeType: [], builtYear: [] });

  readonly selects = computed<FilterSelectSpec[]>(() => [
    {
      key: 'bridgeType',
      label: '桥型',
      options: BRIDGE_TYPES.map((type) => BRIDGE_TYPE_LABEL[type]),
    },
    {
      key: 'builtYear',
      label: '建成年段',
      options: [...new Set(this.bridgeViews().map((item) => this.yearBand(item.builtYear)))].sort(),
    },
  ]);

  /** 命中筛选的桥梁 */
  readonly filtered = computed(() => {
    const lower = this.keyword().trim().toLowerCase();
    const bridgeTypes = (this.filters()['bridgeType'] ?? []).map((label) =>
      BRIDGE_TYPES.find((type) => BRIDGE_TYPE_LABEL[type] === label),
    );
    const yearBands = this.filters()['builtYear'] ?? [];
    return this.bridgeViews().filter((bridge) => {
      if (bridgeTypes.length > 0 && !bridgeTypes.includes(bridge.bridgeType)) return false;
      if (yearBands.length > 0 && !yearBands.includes(this.yearBand(bridge.builtYear))) return false;
      if (lower && !`${bridge.name} ${bridge.spanCombo}`.toLowerCase().includes(lower)) return false;
      return true;
    });
  });

  readonly activeBridge = computed(() =>
    this.bridgeViews().find((item) => item.id === this.activeBridgeId()) ?? null,
  );

  readonly pendingShare = computed(() => {
    const stats = this.stats();
    return share(stats.pending, stats.bearings);
  });

  constructor() {
    // 从 URL query 恢复筛选条件
    this.route.queryParamMap
      .pipe(rxFilter(() => true))
      .subscribe((params) => {
        this.keyword.set(params.get('kw') ?? '');
        const next: Record<string, string[]> = { bridgeType: [], builtYear: [] };
        for (const key of Object.keys(next)) {
          const raw = params.get(key);
          next[key] = raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
        }
        this.filters.set(next);
      });
  }

  yearBand(builtYear: number): string {
    const start = Math.floor(builtYear / 10) * 10;
    return `${start}-${start + 9}`;
  }

  lengthOf(bridge: BridgeView): number {
    return totalLengthM(bridge.spanCombo);
  }

  spanInfo(bridge: BridgeView): string {
    const { spans, spanM } = parseSpanCombo(bridge.spanCombo);
    return `${spans} 孔 × ${spanM} m`;
  }

  ageLevel(builtYear: number): string {
    return bridgeAgeLevel(builtYear);
  }

  liftNote(bridgeType: BridgeType): string {
    return bridgeLiftNote(bridgeType);
  }

  bearingHint(design: number, registered: number): string {
    return bearingCountHint(design, registered);
  }

  piersOf(bridgeId: string): Array<PierView & { registeredBearingCount: number; pendingBearingCount: number }> {
    return this.pierViews()
      .filter((item) => item.bridgeId === bridgeId)
      .map((pier) => ({
        ...pier,
        bridgeName: this.bridgeViews().find((item) => item.id === pier.bridgeId)?.name ?? '未归属桥梁',
        stepCount: 0,
        registeredBearingCount: this.bearings().filter((item) => item.pierId === pier.id).length,
        pendingBearingCount: this.bearings().filter(
          (item) => item.pierId === pier.id && needReplacement(item.diseaseGrade),
        ).length,
      }))
      .sort((a, b) => a.capElevation - b.capElevation);
  }

  bearingsOfPier(pierId: string) {
    return this.bearings().filter((item) => item.pierId === pierId);
  }

  bearingsOf(bridgeId: string) {
    const pierIds = new Set(this.piersOf(bridgeId).map((item) => item.id));
    return this.bearings().filter((item) => pierIds.has(item.pierId));
  }

  pendingOf(bridgeId: string) {
    return this.bearingsOf(bridgeId).filter((item) => needReplacement(item.diseaseGrade));
  }

  platformHint(): string {
    const bridge = this.activeBridge();
    if (!bridge) return '';
    const piers = this.piersOf(bridge.id);
    if (piers.length === 0) return '该桥梁尚未登记墩台';
    const lowest = Math.min(...piers.map((item) => item.capElevation));
    return `最高盖梁与最低盖梁相差 ${(piers[0].capElevation - lowest).toFixed(2)} m，注意顶升支架高度差`;
  }

  select(bridgeId: string): void {
    this.store.dispatch(bridgeActions.selectBridge({ bridgeId }));
  }

  go(path: string, event?: Event): void {
    event?.stopPropagation();
    void this.router.navigate([path]);
  }

  onKeyword(value: string): void {
    this.keyword.set(value);
    void this.syncQuery(value, this.filters());
  }

  onFilters(values: Record<string, string[]>): void {
    this.filters.set(values);
    void this.syncQuery(this.keyword(), values);
  }

  clearFilters(): void {
    this.keyword.set('');
    this.filters.set({ bridgeType: [], builtYear: [] });
    void this.syncQuery('', { bridgeType: [], builtYear: [] });
  }

  /** 把筛选条件写入 URL query（刷新后保持） */
  private syncQuery(keyword: string, values: Record<string, string[]>): Promise<boolean> {
    const queryParams: Record<string, string> = {};
    if (keyword.trim()) queryParams['kw'] = keyword.trim();
    for (const [key, list] of Object.entries(values)) {
      if (list.length > 0) queryParams[key] = list.join(',');
    }
    return this.router.navigate([], {
      relativeTo: this.route,
      queryParams,
      replaceUrl: true,
    });
  }

  openBridgeDialog(bridge: BridgeView | null, event?: Event): void {
    event?.stopPropagation();
    const draft: BridgeDraft = bridge
      ? {
          name: bridge.name,
          spanCombo: bridge.spanCombo,
          bridgeType: bridge.bridgeType,
          builtYear: bridge.builtYear,
          roadClass: bridge.roadClass,
        }
      : { name: '', spanCombo: '3×30m', bridgeType: 'beam', builtYear: new Date().getFullYear() - 5, roadClass: 'first' };

    this.dialog
      .open(BridgeDialogComponent, {
        width: '620px',
        data: { draft, editingId: bridge?.id ?? null } satisfies BridgeDialogData,
      })
      .afterClosed()
      .subscribe((result: BridgeDraft | null) => {
        if (!result) return;
        if (bridge) {
          this.store.dispatch(bridgeActions.updateBridge({ id: bridge.id, draft: result }));
          this.notify('桥梁档案已更新');
        } else {
          this.store.dispatch(bridgeActions.createBridge({ draft: result }));
          this.notify('桥梁档案已创建，可继续录入墩台');
        }
      });
  }

  openPierDialogNew(bridgeId: string, event?: Event): void {
    event?.stopPropagation();
    const draft: PierDraft = {
      bridgeId,
      code: `${this.piersOf(bridgeId).length}#墩`,
      capElevation: 40,
      type: 'pier',
      bearingCount: 2,
    };
    this.openPierDialogWith(draft, null);
  }

  openPierDialog(pier: { id: string; bridgeId: string; code: string; capElevation: number; type: PierType; bearingCount: number }, event?: Event): void {
    event?.stopPropagation();
    this.openPierDialogWith(
      {
        bridgeId: pier.bridgeId,
        code: pier.code,
        capElevation: pier.capElevation,
        type: pier.type,
        bearingCount: pier.bearingCount,
      },
      pier.id,
    );
  }

  private openPierDialogWith(draft: PierDraft, editingId: string | null): void {
    this.dialog
      .open(PierDialogComponent, {
        width: '600px',
        data: {
          draft,
          editingId,
          bridges: this.bridgeViews().map((item) => ({ id: item.id, name: item.name })),
        } satisfies PierDialogData,
      })
      .afterClosed()
      .subscribe((result: PierDraft | null) => {
        if (!result) return;
        if (editingId) {
          this.store.dispatch(bridgeActions.updatePier({ id: editingId, draft: result }));
          this.notify('墩台已更新');
        } else {
          this.store.dispatch(bridgeActions.createPier({ draft: result }));
          this.notify('墩台已新增，可继续登记支座');
        }
      });
  }

  deleteBridge(bridge: BridgeView, event?: Event): void {
    event?.stopPropagation();
    if (!confirm(`确认删除桥梁「${bridge.name}」及其全部墩台、支座、顶升步骤与验收记录？`)) return;
    this.store.dispatch(bridgeActions.deleteBridge({ id: bridge.id }));
    this.notify('桥梁及其下级数据已删除');
  }

  deletePier(pierId: string): void {
    if (!confirm('确认删除该墩台及其支座与验收记录？')) return;
    this.store.dispatch(bridgeActions.deletePier({ id: pierId }));
    this.notify('墩台及其支座已删除');
  }

  private notify(message: string): void {
    this.snackBar.open(message, '关闭', { duration: 2600 });
  }
}
