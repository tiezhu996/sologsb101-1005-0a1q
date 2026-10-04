/**
 * NgRx Effects：离线作业包合并交接的副作用——加载台账、预览计划、执行合并、
 * 失败重试、差异裁定、待补证区登记。写入后广播变更，AppComponent 触发全量重载。
 */
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { from, map, switchMap } from 'rxjs';
import { handoffActions } from './handoff.actions';
import { HandoffService } from '../services/handoff.service';
import { ChangeBusService } from '../services/change-bus.service';
import {
  db,
  listBearings,
  listMergeBatches,
  listMergeConflicts,
  listMergeEvidence,
  listMergeJournals,
  listSteps,
  putBearing,
  putMergeConflict,
  putStep,
  removeMergeBatch,
  removeMergeEvidence,
  type BearingRow,
  type StepRow,
} from '../utils/db';

@Injectable()
export class HandoffEffects {
  private readonly actions$ = inject(Actions);
  private readonly handoff = inject(HandoffService);
  private readonly bus = inject(ChangeBusService);

  /** 加载交接台账四张表 */
  readonly load$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.load),
      switchMap(() =>
        from(
          Promise.all([
            listMergeConflicts(),
            listMergeJournals(),
            listMergeBatches(),
            listMergeEvidence(),
          ]),
        ).pipe(
          map(([conflicts, journals, batches, evidence]) =>
            handoffActions.loadSuccess({ conflicts, journals, batches, evidence }),
          ),
        ),
      ),
    ),
  );

  /** 交接区预览：算合并计划但不落库 */
  readonly preview$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.previewPackage),
      switchMap(({ pkg }) =>
        from(this.handoff.plan(pkg)).pipe(
          map((plan) => handoffActions.previewReady({ plan })),
        ),
      ),
    ),
  );

  /** 执行合并：成功广播重载并提示；失败保留未完成批次 */
  readonly apply$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.applyPackage),
      switchMap(({ pkg }) =>
        from(this.handoff.apply(pkg)).pipe(
          map((outcome) => {
            this.bus.emit();
            if (outcome.ok) {
              return handoffActions.notice({
                notice: {
                  tone: outcome.conflicts > 0 ? 'warn' : 'success',
                  message:
                    `作业包 ${outcome.packageNo} 已交接：接收 ${outcome.acceptedFields} 处单边变化、` +
                    `追加 ${outcome.appendedReadings} 条读数（重复跳过 ${outcome.dupReadings} 条）` +
                    (outcome.conflicts > 0 ? `；${outcome.conflicts} 处两边都改，保留主台账原值并列差异` : ''),
                },
              });
            }
            return handoffActions.notice({
              notice: {
                tone: 'error',
                message:
                  `作业包 ${outcome.packageNo} 写入失败，主台账已恢复；未完成批次与差异已保留，可在交接页重试。` +
                  `（${outcome.error}）`,
              },
            });
          }),
        ),
      ),
    ),
  );

  /** 重试失败批次：用批次保留的作业包全文重新合并；成功后清理批次 */
  readonly retry$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.retryBatch),
      switchMap(({ batchId }) =>
        from(
          (async () => {
            const batch = await db.mergeBatches.get(batchId);
            if (!batch) throw new Error('未完成批次不存在或已被清理');
            const pkg = JSON.parse(batch.packageJson) as Parameters<HandoffService['apply']>[0];
            const outcome = await this.handoff.apply(pkg, undefined, batchId);
            if (outcome.ok) await removeMergeBatch(batchId);
            return outcome;
          })(),
        ).pipe(
          map((outcome) => {
            this.bus.emit();
            if (outcome.ok) {
              return handoffActions.notice({
                notice: { tone: 'success', message: `作业包 ${outcome.packageNo} 重试成功，未完成批次已清理` },
              });
            }
            return handoffActions.notice({
              notice: { tone: 'error', message: `作业包 ${outcome.packageNo} 重试仍失败，主台账已恢复：${outcome.error}` },
            });
          }),
        ),
      ),
    ),
  );

  /** 待补证区：登记旧包缺基线 / 结构无法识别的作业包 */
  readonly quarantine$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.quarantinePackage),
      switchMap(({ rawText, reason, packageNo }) =>
        from(this.handoff.quarantine(rawText, reason, packageNo)).pipe(
          map(() => {
            this.bus.emit();
            return handoffActions.notice({
              notice: { tone: 'warn', message: `作业包 ${packageNo} 已进入待补证区：${reason}` },
            });
          }),
        ),
      ),
    ),
  );

  /** 删除待补证记录 */
  readonly removeEvidence$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.removeEvidence),
      switchMap(({ id }) =>
        from(removeMergeEvidence(id)).pipe(
          map(() => {
            this.bus.emit();
            return handoffActions.notice({ notice: { tone: 'success', message: '待补证记录已删除' } });
          }),
        ),
      ),
    ),
  );

  /** 删除批次记录 */
  readonly removeBatch$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.removeBatch),
      switchMap(({ id }) =>
        from(removeMergeBatch(id)).pipe(
          map(() => {
            this.bus.emit();
            return handoffActions.notice({ notice: { tone: 'success', message: '批次记录已删除' } });
          }),
        ),
      ),
    ),
  );

  /**
   * 差异裁定：
   * - keepMaster：保留主台账原值（只关闭差异）；
   * - takeOffline：采用离线值（按字段更新对应支座 / 步骤后关闭差异）。
   * 裁定前该支座不能签署验收；裁定后解除卡口。
   */
  readonly resolve$ = createEffect(() =>
    this.actions$.pipe(
      ofType(handoffActions.resolveConflict),
      switchMap(({ id, resolution }) =>
        from(
          (async () => {
            const conflict = await db.mergeConflicts.get(id);
            if (!conflict) return;
            if (resolution === 'takeOffline') {
              if (conflict.entity === 'bearing') {
                const bearing = (await listBearings()).find((item) => item.id === conflict.entityId);
                if (bearing) {
                  const next: BearingRow = {
                    ...bearing,
                    diseaseGrade: conflict.offlineValue as BearingRow['diseaseGrade'],
                  };
                  await putBearing(next);
                }
              } else {
                const step = (await listSteps()).find((item) => item.id === conflict.entityId);
                if (step) {
                  const next = {
                    ...step,
                    [conflict.field]: conflict.offlineValue,
                  } as StepRow;
                  await putStep(next);
                }
              }
            }
            await putMergeConflict({
              ...conflict,
              status: 'resolved',
              resolution,
              resolvedAt: new Date().toISOString(),
            });
          })(),
        ).pipe(
          map(() => {
            this.bus.emit();
            return handoffActions.notice({
              notice: {
                tone: 'success',
                message: resolution === 'keepMaster' ? '已裁定：保留主台账原值' : '已裁定：采用离线值并写回',
              },
            });
          }),
        ),
      ),
    ),
  );
}
