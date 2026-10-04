import { Component, DestroyRef, computed, inject, signal, type Signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDividerModule } from '@angular/material/divider';
import { ROUTES } from '../../../core/router/app.routes';
import { Router } from '@angular/router';
import { handoffActions } from '../../../core/store/handoff.actions';
import {
  buildConflictViews,
  selectFailedBatches,
  selectHandoffNotice,
  selectMergeBatches,
  selectMergeConflicts,
  selectMergeEvidence,
  selectMergeJournals,
  selectMergeOverview,
  selectPreviewPlan,
  type ConflictView,
} from '../../../core/store/handoff.selectors';
import { selectBridges, selectPiers } from '../../../core/store/bridge.selectors';
import { selectBearings } from '../../../core/store/bearing.selectors';
import { selectSteps } from '../../../core/store/step.selectors';
import { HandoffService } from '../../../core/services/handoff.service';
import { ChangeBusService } from '../../../core/services/change-bus.service';
import {
  downloadJson,
  readJsonFile,
} from '../../../core/utils/export';
import { putBearing, putStep } from '../../../core/utils/db';
import { escalateGrade } from '../../../core/types/bearing';
import type { BearingRow, BridgeRow, PierRow, StepRow } from '../../../core/utils/db';
import type { OfflinePackage } from '../../../core/types/handoff';
import {
  buildLegacyPackage,
  buildSampleAcceptedPackage,
  buildSampleConflictPackage,
  freezeBaseline,
  generatePackageNo,
} from '../../../core/store/handoff-package';
import {
  formatMergeFieldValue,
  MERGE_ENTITY_LABEL,
  MERGE_FIELD_LABEL,
} from '../../../core/store/handoff-labels';
import { StatBadgeComponent } from '../../../shared/components/common/stat-badge.component';
import { EmptyPanelComponent } from '../../../shared/components/common/empty-panel.component';

/**
 * /handoffs 离线合并交接
 * 作业包冻结基线、按包号去重、只接基线后的单边变化；新增读数按步骤 + 测点唯一键追加；
 * 两边都改保留主台账原值并列差异（处理前该支座不能签署验收）；
 * 写入失败恢复主台账并保留差异与未完成批次供重试；旧包缺基线进入待补证区。
 */
@Component({
  selector: 'app-handoff-merge-page',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatFormFieldModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
    MatDividerModule,
    StatBadgeComponent,
    EmptyPanelComponent,
  ],
  templateUrl: './handoff-merge.page.html',
  styleUrl: './handoff-merge.page.scss',
})
export class HandoffMergePage {
  private readonly store = inject(Store);
  private readonly handoff = inject(HandoffService);
  private readonly bus = inject(ChangeBusService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly router = inject(Router);
  private readonly destroyRef = inject(DestroyRef);

  readonly ROUTES = ROUTES;
  readonly fieldLabel = MERGE_FIELD_LABEL;
  readonly entityLabel = MERGE_ENTITY_LABEL;
  readonly formatValue = formatMergeFieldValue;

  readonly bridges: Signal<BridgeRow[]> = toSignal(this.store.select(selectBridges), {
    initialValue: [] as BridgeRow[],
  });
  readonly piers: Signal<PierRow[]> = toSignal(this.store.select(selectPiers), {
    initialValue: [] as PierRow[],
  });
  readonly bearings: Signal<BearingRow[]> = toSignal(this.store.select(selectBearings), {
    initialValue: [] as BearingRow[],
  });
  readonly steps: Signal<StepRow[]> = toSignal(this.store.select(selectSteps), {
    initialValue: [] as StepRow[],
  });

  readonly overview = toSignal(this.store.select(selectMergeOverview), {
    initialValue: {
      receivedPackages: 0,
      openConflicts: 0,
      resolvedConflicts: 0,
      failedBatches: 0,
      evidencePending: 0,
      appendedReadings: 0,
    },
  });
  readonly conflicts = toSignal(this.store.select(selectMergeConflicts), { initialValue: [] });
  readonly journals = toSignal(this.store.select(selectMergeJournals), { initialValue: [] });
  readonly batches = toSignal(this.store.select(selectMergeBatches), { initialValue: [] });
  readonly failedBatches = toSignal(this.store.select(selectFailedBatches), { initialValue: [] });
  readonly evidence = toSignal(this.store.select(selectMergeEvidence), { initialValue: [] });
  readonly previewPlan = toSignal(this.store.select(selectPreviewPlan), { initialValue: null });
  /** 最近一次读入交接区的作业包原文（预览计划的配套载荷，执行合并时用） */
  private readonly stagedPkg = signal<OfflinePackage | null>(null);

  /** 交接演示用的当前桥梁（默认第一座） */
  readonly selectedBridgeId = signal<string>('');

  readonly currentBridge = computed<BridgeRow | null>(() => {
    const list = this.bridges();
    if (list.length === 0) return null;
    const id = this.selectedBridgeId();
    return list.find((item) => item.id === id) ?? list[0];
  });

  /** 差异视图（带支座 / 步骤 / 桥梁上下文） */
  readonly conflictViews: Signal<ConflictView[]> = computed(() =>
    buildConflictViews(
      this.conflicts(),
      this.bearings(),
      this.steps(),
      this.piers(),
      this.bridges().map((item) => ({ id: item.id, name: item.name })),
    ),
  );

  constructor() {
    // 默认选中第一座桥梁供基线冻结与演示包生成
    if (!this.selectedBridgeId() && this.bridges().length > 0) {
      this.selectedBridgeId.set(this.bridges()[0].id);
    }
    // 监听交接动作结果提示
    this.store
      .select(selectHandoffNotice)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((notice) => {
        if (!notice) return;
        this.snackBar.open(notice.message, '关闭', {
          duration: notice.tone === 'error' ? 4200 : 3000,
        });
        this.store.dispatch(handoffActions.clearNotice());
      });
  }

  /* ---------------------------- 作业包读入 ---------------------------- */

  async onFileSelected(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const rawText = await file.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawText);
    } catch {
      this.store.dispatch(
        handoffActions.quarantinePackage({
          rawText,
          reason: 'JSON 解析失败，文件结构无法识别',
          packageNo: file.name,
        }),
      );
      return;
    }
    const result = this.handoff.validate(parsed);
    if (!result.ok) {
      this.store.dispatch(
        handoffActions.quarantinePackage({ rawText, reason: result.reason, packageNo: result.packageNo }),
      );
      return;
    }
    // 按包号去重：已接收的包不再进入交接预览
    this.stagedPkg.set(result.pkg);
    this.store.dispatch(handoffActions.previewPackage({ pkg: result.pkg }));
  }

  applyPreview(): void {
    const plan = this.previewPlan();
    if (!plan) return;
    const pkg = this.previewPkg();
    if (!pkg) return;
    this.store.dispatch(handoffActions.applyPackage({ pkg }));
    this.store.dispatch(handoffActions.previewReady({ plan: null }));
  }

  clearPreview(): void {
    this.store.dispatch(handoffActions.previewReady({ plan: null }));
  }

  /** 预览计划对应的作业包（文件读入 / 演示包生成时缓存） */
  private previewPkg(): OfflinePackage | null {
    return this.stagedPkg();
  }

  /* ---------------------------- 基线冻结 ---------------------------- */

  exportFrozenBaseline(): void {
    const bridge = this.currentBridge();
    if (!bridge) return;
    const bridgePiers = this.piers().filter((item) => item.bridgeId === bridge.id);
    const baseline = freezeBaseline({
      bridge,
      piers: bridgePiers,
      bearings: this.bearings(),
      steps: this.steps(),
      frozenAt: new Date().toISOString(),
    });
    const skeleton: OfflinePackage = {
      kind: 'gbbridgebear-offline-package',
      packageNo: generatePackageNo(),
      bridgeId: bridge.id,
      bridgeName: bridge.name,
      crew: '',
      frozenAt: baseline.frozenAt,
      returnedAt: '',
      baseline,
      takeOffline: { bearings: [], steps: [], readings: [] },
    };
    downloadJson(`offline-package-${skeleton.packageNo}-frozen.json`, skeleton);
    this.notify(`已冻结「${bridge.name}」基线并导出空白作业包，随检修组离线填写`);
  }

  /* ---------------------------- 演示作业包 ---------------------------- */

  generateAcceptedDemo(): void {
    const bridge = this.currentBridge();
    if (!bridge) return;
    const bridgePiers = this.piers().filter((item) => item.bridgeId === bridge.id);
    const pkg = buildSampleAcceptedPackage({
      bridge,
      piers: bridgePiers,
      bearings: this.bearings(),
      steps: this.steps(),
      packageNo: `${generatePackageNo()}-A`,
    });
    if (!pkg) {
      this.notify('当前桥梁缺少支座或步骤，无法生成演示包');
      return;
    }
    downloadJson(`offline-package-${pkg.packageNo}.json`, pkg);
    this.stagedPkg.set(pkg);
    this.store.dispatch(handoffActions.previewPackage({ pkg }));
    this.notify('已生成「正常接收」演示作业包并载入交接区（同时下载 JSON）');
  }

  generateConflictDemo(): void {
    const bridge = this.currentBridge();
    if (!bridge) return;
    const bridgePiers = this.piers().filter((item) => item.bridgeId === bridge.id);
    const pkg = buildSampleConflictPackage({
      bridge,
      piers: bridgePiers,
      bearings: this.bearings(),
      steps: this.steps(),
      packageNo: `${generatePackageNo()}-C`,
    });
    if (!pkg) {
      this.notify('当前桥梁缺少支座或步骤，无法生成演示包');
      return;
    }
    downloadJson(`offline-package-${pkg.packageNo}.json`, pkg);
    this.stagedPkg.set(pkg);
    // 回站交接前主台账在同一字段上又改一次（与离线改动冲突），随后直接按最新主台账算计划
    void this.previewConflictAfterMasterMutation(pkg);
    this.notify('已生成「两边都改」演示包，并在主台账上再改一次同一字段；执行合并即保留主台账原值并列差异');
  }

  /** 先在主台账上制造同字段冲突，再用最新主台账数据计算交接计划（避免 store 重载竞态） */
  private async previewConflictAfterMasterMutation(pkg: OfflinePackage): Promise<void> {
    await this.mutateMasterForConflict(pkg);
    const plan = await this.handoff.plan(pkg);
    this.store.dispatch(handoffActions.previewReady({ plan }));
  }

  /** 演示用：在主台账上把作业包涉及的首个支座等级 / 首步限位再改一次，制造两边都改 */
  private async mutateMasterForConflict(pkg: OfflinePackage): Promise<void> {
    const bearingChange = pkg.takeOffline.bearings[0];
    if (bearingChange) {
      const bearing = this.bearings().find((item) => item.id === bearingChange.id);
      if (bearing) await putBearing({ ...bearing, diseaseGrade: escalateGrade(bearing.diseaseGrade) });
    }
    const stepChange = pkg.takeOffline.steps[0];
    if (stepChange) {
      const step = this.steps().find((item) => item.id === stepChange.id);
      if (step) await putStep({ ...step, limitMm: step.limitMm + 1 });
    }
    this.bus.emit();
  }

  generateLegacyDemo(): void {
    const bridge = this.currentBridge();
    if (!bridge) return;
    const pkg = buildLegacyPackage({ bridge, packageNo: `${generatePackageNo()}-OLD` });
    downloadJson(`offline-package-${pkg.packageNo}-legacy.json`, pkg);
    const rawText = JSON.stringify(pkg, null, 2);
    const result = this.handoff.validate(pkg);
    if (!result.ok) {
      this.store.dispatch(
        handoffActions.quarantinePackage({ rawText, reason: result.reason, packageNo: result.packageNo }),
      );
    }
  }

  /* ---------------------------- 差异裁定 / 批次 ---------------------------- */

  keepMaster(conflictId: string): void {
    this.store.dispatch(handoffActions.resolveConflict({ id: conflictId, resolution: 'keepMaster' }));
  }

  takeOffline(conflictId: string): void {
    this.store.dispatch(handoffActions.resolveConflict({ id: conflictId, resolution: 'takeOffline' }));
  }

  retryBatch(batchId: string): void {
    this.store.dispatch(handoffActions.retryBatch({ batchId }));
  }

  removeBatch(batchId: string): void {
    if (!confirm('确认删除该批次记录？')) return;
    this.store.dispatch(handoffActions.removeBatch({ id: batchId }));
  }

  removeEvidence(id: string, rawJson: string, packageNo: string): void {
    if (!confirm(`确认删除待补证记录「${packageNo}」？删除前建议先下载原始包留档。`)) return;
    this.store.dispatch(handoffActions.removeEvidence({ id }));
    void rawJson;
  }

  downloadEvidence(rawJson: string, packageNo: string): void {
    try {
      downloadJson(`evidence-${packageNo}.json`, JSON.parse(rawJson));
    } catch {
      downloadJson(`evidence-${packageNo}.txt`, rawJson);
    }
  }

  goAcceptance(): void {
    void this.router.navigate([ROUTES.acceptances]);
  }

  /** 合并计划字段级结论文案 */
  planTagText(kind: 'accept' | 'conflict' | 'skip'): string {
    if (kind === 'accept') return '接收单边变化';
    if (kind === 'conflict') return '两边都改 · 保留主台账';
    return '跳过';
  }

  private notify(message: string): void {
    this.snackBar.open(message, '关闭', { duration: 3000 });
  }
}
