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
import { MatDialog, MatDialogModule, MatDialogRef, MAT_DIALOG_DATA } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { Inject } from '@angular/core';
import {
  BEARING_TYPES,
  BEARING_TYPE_LABEL,
  DISEASE_GRADES,
  DISEASE_GRADE_LABEL,
  escalateGrade,
  needReplacement,
  replacementAdvice,
  specSizeHint,
  type BearingDraft,
  type BearingType,
  type BearingView,
  type DiseaseGrade,
} from '../../../core/types/bearing';
import { ROUTES } from '../../../core/router/app.routes';
import { bearingActions } from '../../../core/store/bearing.actions';
import {
  buildBearingViews,
  selectBearingGradeCounts,
  selectBearingStats,
} from '../../../core/store/bearing.selectors';
import { selectBridges, selectPiers } from '../../../core/store/bridge.selectors';
import { share } from '../../../core/utils/unit';
import { StatBadgeComponent } from '../../../shared/components/common/stat-badge.component';
import { EmptyPanelComponent } from '../../../shared/components/common/empty-panel.component';
import { FilterBarComponent, type FilterSelectSpec } from '../../../shared/components/common/filter-bar.component';
import { GradeTagComponent } from '../../../shared/components/common/grade-tag.component';
import type { BearingRow, BridgeRow, PierRow } from '../../../core/utils/db';

/** 支座表单对话框数据 */
export interface BearingDialogData {
  draft: BearingDraft;
  editingId: string | null;
  piers: Array<{ id: string; label: string }>;
}

/** 支座表单对话框 */
@Component({
  selector: 'app-bearing-dialog',
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
    <h2 mat-dialog-title>{{ data.editingId ? '编辑支座' : '登记支座' }}</h2>
    <mat-dialog-content>
      <div class="gb-form-grid">
        <mat-form-field appearance="outline">
          <mat-label>所属墩台</mat-label>
          <mat-select [(ngModel)]="draft.pierId">
            @for (pier of data.piers; track pier.id) {
              <mat-option [value]="pier.id">{{ pier.label }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>支座序号</mat-label>
          <input matInput [(ngModel)]="draft.serial" placeholder="如 1、左-2" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>支座类型</mat-label>
          <mat-select [(ngModel)]="draft.type">
            @for (type of bearingTypes; track type) {
              <mat-option [value]="type">{{ bearingTypeLabel[type] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>规格</mat-label>
          <input matInput [(ngModel)]="draft.spec" placeholder="如 GJZ 300×400" />
        </mat-form-field>
        <mat-form-field appearance="outline">
          <mat-label>病害等级</mat-label>
          <mat-select [(ngModel)]="draft.diseaseGrade">
            @for (grade of diseaseGrades; track grade) {
              <mat-option [value]="grade">{{ diseaseGradeLabel[grade] }}</mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <mat-form-field appearance="outline" style="width: 100%">
        <mat-label>病害描述</mat-label>
        <textarea matInput rows="3" [(ngModel)]="draft.diseaseNote"></textarea>
      </mat-form-field>
      <p class="gb-hint">{{ advice }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button (click)="close()">取消</button>
      <button mat-flat-button color="primary" [disabled]="!draft.serial.trim()" (click)="submit()">保存</button>
    </mat-dialog-actions>
  `,
})
export class BearingDialogComponent {
  readonly bearingTypes = BEARING_TYPES;
  readonly bearingTypeLabel = BEARING_TYPE_LABEL;
  readonly diseaseGrades = DISEASE_GRADES;
  readonly diseaseGradeLabel = DISEASE_GRADE_LABEL;
  readonly draft: BearingDraft;

  constructor(
    private readonly dialogRef: MatDialogRef<BearingDialogComponent>,
    @Inject(MAT_DIALOG_DATA) readonly data: BearingDialogData,
  ) {
    this.draft = { ...data.draft };
  }

  get advice(): string {
    return `${replacementAdvice(this.draft.diseaseGrade)} · ${specSizeHint(this.draft.spec)}`;
  }

  close(): void {
    this.dialogRef.close(null);
  }

  submit(): void {
    this.dialogRef.close({ ...this.draft });
  }
}

/**
 * /bearings 支座与评级
 * 登记支座规格并评定病害等级，按等级批量处置；
 * 消费 Bearing、Pier 与 <GradeTag>、<FilterBar>。
 */
@Component({
  selector: 'app-bearing-board-page',
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
    MatCheckboxModule,
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
        <h2 class="page-title">支座与评级</h2>
        <div class="page-sub">
          登记支座规格并评定病害等级（完好 / 轻微 / 较重 / 严重），支持批量调级与升级，较重及以上触发更换建议。
        </div>
      </div>
      <div class="gb-inline-actions">
        <button mat-stroked-button (click)="go(ROUTES.bridges)">
          <mat-icon>foundation</mat-icon>
          桥梁与墩台
        </button>
        <button mat-flat-button color="primary" (click)="openDialog(null)">
          <mat-icon>add</mat-icon>
          登记支座
        </button>
      </div>
    </div>

    <div class="stat-grid">
      <app-stat-badge title="支座总数" [value]="stats().total" [suffix]="'个'" color="#1565c0" />
      <app-stat-badge
        title="待更换"
        [value]="stats().pending"
        [suffix]="'个'"
        [percent]="pendingShare()"
        color="#c62828"
        hint="较重 + 严重级支座，进度条为占比"
      />
      <app-stat-badge
        title="严重级"
        [value]="stats().severe"
        [suffix]="'个'"
        color="#e65100"
        hint="严重级支座建议立即更换并纳入本批次顶升"
      />
      <app-stat-badge
        title="完好 / 轻微"
        [value]="stats().intact + ' / ' + stats().slight"
        color="#2e7d32"
        hint="完好与轻微级支座按巡检跟踪即可"
      />
    </div>

    <app-filter-bar
      keywordLabel="关键字"
      keywordPlaceholder="按序号 / 规格 / 墩台搜索"
      [keyword]="keyword()"
      [selects]="selects()"
      [values]="filters()"
      [resultCount]="filtered().length"
      countUnit="个支座"
      (keywordChange)="onKeyword($event)"
      (filtersChange)="onFilters($event)"
    >
      <mat-form-field appearance="outline" style="min-width: 170px">
        <mat-label>批量等级</mat-label>
        <mat-select [(ngModel)]="bulkGrade">
          @for (grade of diseaseGrades; track grade) {
            <mat-option [value]="grade">{{ diseaseGradeLabel[grade] }}</mat-option>
          }
        </mat-select>
      </mat-form-field>
      <button mat-stroked-button [disabled]="selected().length === 0" (click)="bulkSetGrade()">
        <mat-icon>tune</mat-icon>
        批量设置（{{ selected().length }}）
      </button>
      <button mat-stroked-button [disabled]="selected().length === 0" (click)="bulkEscalate()">
        <mat-icon>trending_up</mat-icon>
        批量升级
      </button>
      <button mat-stroked-button [disabled]="selected().length === 0" (click)="selected.set([])">
        清空选择
      </button>
    </app-filter-bar>

    @if (replacementList().length > 0) {
      <mat-card appearance="outlined" class="gb-section">
        <div style="padding: 12px 14px">
          <div class="gb-card-title">更换建议清单（较重及以上 {{ replacementList().length }} 个）</div>
          <div class="gb-tags" style="margin-top: 8px">
            @for (item of replacementList().slice(0, 12); track item.id) {
              <mat-chip highlighted>{{ item.pierCode }} · {{ item.serial }} · {{ item.spec }}（{{ diseaseGradeLabel[item.grade] }}）</mat-chip>
            }
          </div>
          <div class="gb-hint" style="margin-top: 8px">
            {{ replacementList()[0].advice }}；{{ replacementList()[0].sizeHint }}
          </div>
        </div>
      </mat-card>
    }

    <div class="gb-section">
      @if (filtered().length === 0) {
        <app-empty-panel
          title="没有匹配的支座"
          description="可登记支座并评定病害等级，或清空筛选条件后重试。"
          icon="view_module"
          actionLabel="登记支座"
          (action)="openDialog(null)"
          secondaryLabel="清空筛选"
          (secondary)="clearFilters()"
        />
      } @else {
        <div class="gb-table-wrap">
          <table class="gb-table">
            <thead>
              <tr>
                <th style="width: 42px">
                  <mat-checkbox
                    [checked]="allSelected()"
                    [indeterminate]="someSelected()"
                    (change)="toggleAll()"
                  ></mat-checkbox>
                </th>
                <th>桥梁 / 墩台</th>
                <th>序号</th>
                <th>类型</th>
                <th>规格</th>
                <th>病害等级</th>
                <th>病害描述</th>
                <th>更换建议</th>
                <th style="width: 210px">操作</th>
              </tr>
            </thead>
            <tbody>
              @for (bearing of filtered(); track bearing.id) {
                <tr [class.is-selected]="selected().includes(bearing.id)">
                  <td>
                    <mat-checkbox
                      [checked]="selected().includes(bearing.id)"
                      (change)="toggleOne(bearing.id)"
                    ></mat-checkbox>
                  </td>
                  <td>{{ bearing.bridgeName }} · {{ bearing.pierCode }}</td>
                  <td>{{ bearing.serial }}</td>
                  <td>{{ bearingTypeLabel[bearing.type] }}</td>
                  <td class="gb-mono">{{ bearing.spec }}</td>
                  <td><app-grade-tag [grade]="bearing.diseaseGrade" /></td>
                  <td class="gb-hint">{{ bearing.diseaseNote || '—' }}</td>
                  <td class="gb-hint">{{ needReplacement(bearing.diseaseGrade) ? '需更换' : '跟踪观测' }}</td>
                  <td>
                    <div class="gb-row-actions">
                      <button mat-button (click)="openDialog(bearing)">
                        <mat-icon>edit</mat-icon>
                        评级
                      </button>
                      <button mat-button (click)="escalateOne(bearing)">
                        <mat-icon>trending_up</mat-icon>
                        升级
                      </button>
                      <button mat-button color="warn" (click)="deleteBearing(bearing)">
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
    </div>

    <mat-card appearance="outlined" class="gb-section">
      <div style="padding: 12px 14px">
        <div class="gb-card-title">等级分布与处置口径</div>
        <div class="gb-tags" style="margin-top: 8px">
          @for (grade of diseaseGrades; track grade) {
            <mat-chip highlighted>
              {{ diseaseGradeLabel[grade] }}：{{ gradeCounts()[grade] }} 个（{{ adviceOf(grade) }}）
            </mat-chip>
          }
        </div>
      </div>
    </mat-card>
  `,
})
export class BearingBoardPage {
  private readonly store = inject(Store);
  private readonly dialog = inject(MatDialog);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  readonly ROUTES = ROUTES;
  readonly diseaseGrades = DISEASE_GRADES;
  readonly diseaseGradeLabel = DISEASE_GRADE_LABEL;
  readonly bearingTypeLabel = BEARING_TYPE_LABEL;
  readonly needReplacement = needReplacement;

  readonly bridges: Signal<BridgeRow[]> = toSignal(this.store.select(selectBridges), {
    initialValue: [] as BridgeRow[],
  });
  readonly piers: Signal<PierRow[]> = toSignal(this.store.select(selectPiers), {
    initialValue: [] as PierRow[],
  });
  readonly bearings: Signal<BearingRow[]> = toSignal(this.store.select((state) => state.bearing.bearings), {
    initialValue: [] as BearingRow[],
  });

  readonly bearingViews: Signal<BearingView[]> = computed(() =>
    buildBearingViews(this.bearings(), this.piers(), this.bridges()),
  );
  readonly stats = toSignal(this.store.select(selectBearingStats), {
    initialValue: { total: 0, intact: 0, slight: 0, moderate: 0, severe: 0, pending: 0 },
  });
  readonly gradeCounts: Signal<Record<DiseaseGrade, number>> = toSignal(
    this.store.select(selectBearingGradeCounts),
    { initialValue: { intact: 0, slight: 0, moderate: 0, severe: 0 } },
  );

  readonly keyword = signal('');
  readonly filters = signal<Record<string, string[]>>({ bridge: [], grade: [] });
  readonly bulkGrade = signal<DiseaseGrade>('moderate');
  readonly selected = signal<string[]>([]);

  readonly selects = computed<FilterSelectSpec[]>(() => [
    {
      key: 'bridge',
      label: '桥梁',
      options: this.bridges().map((item) => item.name),
    },
    {
      key: 'grade',
      label: '病害等级',
      options: DISEASE_GRADES.map((grade) => DISEASE_GRADE_LABEL[grade]),
    },
  ]);

  readonly filtered = computed(() => {
    const lower = this.keyword().trim().toLowerCase();
    const bridgeNames = this.filters()['bridge'] ?? [];
    const gradeLabels = this.filters()['grade'] ?? [];
    return this.bearingViews().filter((bearing) => {
      if (bridgeNames.length > 0 && !bridgeNames.includes(bearing.bridgeName)) return false;
      if (gradeLabels.length > 0 && !gradeLabels.includes(DISEASE_GRADE_LABEL[bearing.diseaseGrade])) return false;
      if (
        lower &&
        !`${bearing.serial} ${bearing.spec} ${bearing.pierCode} ${bearing.diseaseNote}`.toLowerCase().includes(lower)
      ) {
        return false;
      }
      return true;
    });
  });

  readonly replacementList = computed(() => {
    const bridges = new Map(this.bridges().map((item) => [item.id, item.name]));
    const piers = new Map(this.piers().map((item) => [item.id, item]));
    return this.bearingViews()
      .filter((item) => item.needReplacement)
      .map((item) => {
        const pier = piers.get(item.pierId);
        const bridgeName = pier ? (bridges.get(pier.bridgeId) ?? '未归属桥梁') : '未归属桥梁';
        return {
          id: item.id,
          pierCode: `${bridgeName} ${item.pierCode}`,
          serial: item.serial,
          spec: item.spec,
          grade: item.diseaseGrade,
          advice: replacementAdvice(item.diseaseGrade),
          sizeHint: specSizeHint(item.spec),
        };
      });
  });

  readonly pendingShare = computed(() => {
    const stats = this.stats();
    return share(stats.pending, stats.total);
  });

  readonly allSelected = computed(
    () => this.filtered().length > 0 && this.selected().length === this.filtered().length,
  );
  readonly someSelected = computed(
    () => this.selected().length > 0 && this.selected().length < this.filtered().length,
  );

  constructor() {
    this.route.queryParamMap.subscribe((params) => {
      this.keyword.set(params.get('kw') ?? '');
      const next: Record<string, string[]> = { bridge: [], grade: [] };
      for (const key of Object.keys(next)) {
        const raw = params.get(key);
        next[key] = raw ? raw.split(',').map((item) => item.trim()).filter(Boolean) : [];
      }
      this.filters.set(next);
    });
  }

  adviceOf(grade: DiseaseGrade): string {
    return replacementAdvice(grade);
  }

  go(path: string): void {
    void this.router.navigate([path]);
  }

  toggleAll(): void {
    this.selected.set(this.allSelected() ? [] : this.filtered().map((item) => item.id));
  }

  toggleOne(id: string): void {
    this.selected.set(
      this.selected().includes(id) ? this.selected().filter((item) => item !== id) : [...this.selected(), id],
    );
  }

  bulkSetGrade(): void {
    const ids = this.selected();
    if (ids.length === 0) return;
    this.store.dispatch(bearingActions.bulkSetGrade({ ids, grade: this.bulkGrade() }));
    this.notify(`已把 ${ids.length} 个支座等级设为${DISEASE_GRADE_LABEL[this.bulkGrade()]}`);
    this.selected.set([]);
  }

  bulkEscalate(): void {
    const ids = this.selected();
    if (ids.length === 0) return;
    this.store.dispatch(bearingActions.bulkEscalate({ ids }));
    this.notify(`已升级 ${ids.length} 个支座的病害等级`);
    this.selected.set([]);
  }

  escalateOne(bearing: BearingView): void {
    const next = escalateGrade(bearing.diseaseGrade);
    this.store.dispatch(bearingActions.setGrade({ id: bearing.id, grade: next }));
    this.notify(`${bearing.serial} 号支座等级已升级为${DISEASE_GRADE_LABEL[next]}`);
  }

  openDialog(bearing: BearingView | null): void {
    const pierOptions = this.piers().map((pier) => {
      const bridge = this.bridges().find((item) => item.id === pier.bridgeId);
      return { id: pier.id, label: `${bridge?.name ?? '未归属桥梁'} · ${pier.code}` };
    });
    const draft: BearingDraft = bearing
      ? {
          pierId: bearing.pierId,
          serial: bearing.serial,
          type: bearing.type,
          spec: bearing.spec,
          diseaseGrade: bearing.diseaseGrade,
          diseaseNote: bearing.diseaseNote,
        }
      : {
          pierId: pierOptions[0]?.id ?? '',
          serial: String(this.bearingViews().length + 1),
          type: 'plate',
          spec: 'GJZ 300×400',
          diseaseGrade: 'slight',
          diseaseNote: '',
        };

    this.dialog
      .open(BearingDialogComponent, {
        width: '640px',
        data: { draft, editingId: bearing?.id ?? null, piers: pierOptions } satisfies BearingDialogData,
      })
      .afterClosed()
      .subscribe((result: BearingDraft | null) => {
        if (!result) return;
        if (bearing) {
          this.store.dispatch(bearingActions.updateBearing({ id: bearing.id, draft: result }));
          this.notify('支座信息已更新');
        } else {
          this.store.dispatch(bearingActions.createBearing({ draft: result }));
          this.notify('支座已登记，可继续评级或编排顶升');
        }
      });
  }

  deleteBearing(bearing: BearingView): void {
    if (!confirm(`确认删除支座「${bearing.serial}」及其验收记录？`)) return;
    this.store.dispatch(bearingActions.deleteBearing({ id: bearing.id }));
    this.notify('支座及其验收记录已删除');
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
    this.filters.set({ bridge: [], grade: [] });
    this.syncQuery('', { bridge: [], grade: [] });
    this.selected.set([]);
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
