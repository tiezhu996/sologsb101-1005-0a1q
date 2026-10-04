/**
 * 离线合并交接服务：
 * - 校验作业包（结构 / 基线是否齐全；旧包缺基线 → 待补证区，不猜着覆盖）
 * - 按包号去重（mergeJournals）
 * - 三方计划落库：只接基线后的单边变化；两边都改保留主台账原值并列差异
 * - 新增读数按「步骤 + 测点」唯一键幂等追加
 * - 单事务写入；失败后恢复主台账（事务回滚 + 失败前快照显式恢复），保留差异与批次供重试
 */
import { Injectable, inject } from '@angular/core';
import {
  db,
  listBearings,
  listReadings,
  listSteps,
  newId,
  putBearings,
  putMergeBatch,
  putMergeConflicts,
  putMergeEvidence,
  putMergeJournal,
  putReadings,
  putSteps,
  rowMeta,
  type BearingRow,
  type ReadingRow,
  type StepRow,
} from '../utils/db';
import { OFFLINE_PACKAGE_KIND, type MergeConflictRow, type MergePlan, type OfflinePackage } from '../types/handoff';
import { buildMergePlan } from '../store/handoff-merge';

export type PackageValidation =
  | { ok: true; pkg: OfflinePackage }
  | { ok: false; reason: string; packageNo: string };

/** 合并执行结果（成功或失败，失败携带未完成批次 id 供重试） */
export type MergeOutcome =
  | {
      ok: true;
      packageNo: string;
      acceptedFields: number;
      conflicts: number;
      appendedReadings: number;
      dupReadings: number;
    }
  | {
      ok: false;
      packageNo: string;
      error: string;
      batchId: string;
      plan: MergePlan;
    };

@Injectable({ providedIn: 'root' })
export class HandoffService {
  /** 严格校验作业包；返回可用作业包或不能合并的原因（旧包缺基线走待补证区） */
  validate(raw: unknown): PackageValidation {
    if (!raw || typeof raw !== 'object') {
      return { ok: false, reason: '文件不是有效的 JSON 对象', packageNo: 'unknown' };
    }
    const obj = raw as Record<string, unknown>;
    const packageNo = typeof obj['packageNo'] === 'string' && obj['packageNo'].trim() ? obj['packageNo'] : 'unknown';

    if (obj['kind'] !== OFFLINE_PACKAGE_KIND) {
      return { ok: false, reason: `缺少作业包标识 kind=${OFFLINE_PACKAGE_KIND}`, packageNo };
    }
    if (packageNo === 'unknown') {
      return { ok: false, reason: '缺少包号 packageNo', packageNo };
    }
    if (typeof obj['bridgeId'] !== 'string' || !obj['bridgeId']) {
      return { ok: false, reason: '缺少桥梁标识 bridgeId', packageNo };
    }
    if (typeof obj['frozenAt'] !== 'string') {
      return { ok: false, reason: '缺少冻结时间 frozenAt', packageNo };
    }
    const takeOffline = obj['takeOffline'] as Record<string, unknown> | undefined;
    if (!takeOffline || !Array.isArray(takeOffline['bearings']) || !Array.isArray(takeOffline['steps']) ||
      !Array.isArray(takeOffline['readings'])) {
      return { ok: false, reason: '缺少离线变化集合 takeOffline（bearings / steps / readings）', packageNo };
    }
    // 旧包缺基线：不猜着覆盖，进入待补证区
    const baseline = obj['baseline'] as Record<string, unknown> | undefined;
    if (!baseline || typeof baseline !== 'object') {
      return { ok: false, reason: '作业包缺少冻结基线（旧版包），需补齐基线凭证后再交接', packageNo };
    }
    if (!Array.isArray(baseline['bearings']) || !Array.isArray(baseline['steps'])) {
      return { ok: false, reason: '冻结基线不完整（缺 bearings / steps 快照）', packageNo };
    }
    return { ok: true, pkg: raw as OfflinePackage };
  }

  /** 把不能合并的作业包登记到待补证区（含旧包缺基线） */
  async quarantine(rawText: string, reason: string, packageNo: string): Promise<void> {
    await putMergeEvidence({
      id: newId('evidence'),
      packageNo,
      reason,
      createdAt: new Date().toISOString(),
      rawJson: rawText,
    });
  }

  /** 结合主台账现状计算合并计划（交接区预览用） */
  async plan(pkg: OfflinePackage): Promise<MergePlan> {
    const [bearings, steps, readings] = await Promise.all([listBearings(), listSteps(), listReadings()]);
    return buildMergePlan(pkg, { bearings, steps, readings });
  }

  /**
   * 执行合并：
   * 1) 包号去重（mergeJournals）；
   * 2) 拍失败前快照（受影响行）；
   * 3) 单事务应用单边变化 + 追加读数 + 写差异 + 写流水；
   * 4) 任一步失败 → Dexie 事务回滚，并显式按快照恢复主台账，登记 failed 批次供重试。
   *
   * @param priorBatchId 重试时传入旧的失败批次 id：再次失败则在原批次上递增 attempts，
   *                     避免同一包堆积多条未完成批次。
   */
  async apply(pkg: OfflinePackage, knownPlan?: MergePlan, priorBatchId?: string): Promise<MergeOutcome> {
    // 去重：包号已接收则直接返回当前结果，不重复落库
    const already = await db.mergeJournals.where('packageNo').equals(pkg.packageNo).first();
    if (already) {
      return {
        ok: true,
        packageNo: pkg.packageNo,
        acceptedFields: already.acceptedBearingIds.length + already.acceptedStepIds.length,
        conflicts: 0,
        appendedReadings: already.appendedReadingIds.length,
        dupReadings: 0,
      };
    }

    const plan = knownPlan ?? (await this.plan(pkg));

    // 失败前快照：只备份本次将要改动 / 依赖的行，显式恢复时按快照回写
    const affectedBearingIds = new Set(plan.bearingPlans.map((item) => item.entityId));
    const affectedStepIds = new Set(plan.stepPlans.map((item) => item.entityId));
    const appendReadingIds = plan.readingPlans.filter((item) => item.kind === 'append').map((item) => item.targetId);

    const before: {
      bearings: BearingRow[];
      steps: StepRow[];
    } = {
      bearings: (await listBearings()).filter((item) => affectedBearingIds.has(item.id)),
      steps: (await listSteps()).filter((item) => affectedStepIds.has(item.id)),
    };

    try {
      await this.applyInTransaction(pkg, plan, appendReadingIds);
      return {
        ok: true,
        packageNo: pkg.packageNo,
        acceptedFields: plan.acceptCount,
        conflicts: plan.conflictCount,
        appendedReadings: plan.appendReadingCount,
        dupReadings: plan.dupReadingCount,
      };
    } catch (error) {
      // 事务回滚后再显式按快照恢复主台账，双保险确保主台账不被半成品污染
      await this.restoreMaster(before.bearings, before.steps, appendReadingIds);
      const message = error instanceof Error ? error.message : '合并写入失败';
      const batchId = await this.recordFailedBatch(pkg, plan, message, priorBatchId);
      return { ok: false, packageNo: pkg.packageNo, error: message, batchId, plan };
    }
  }

  /** 单事务应用：单边变化更新、读数追加、差异落库、包流水登记 */
  private async applyInTransaction(
    pkg: OfflinePackage,
    plan: MergePlan,
    appendReadingIds: string[],
  ): Promise<void> {
    await db.transaction(
      'rw',
      [
        db.bearings,
        db.steps,
        db.readings,
        db.mergeConflicts,
        db.mergeJournals,
      ],
      async () => {
        const stamp = new Date().toISOString();

        // —— 支座：只接 accept（主台账未改、离线改了）；conflict 保留主台账原值 ——
        const bearingMaster = await db.bearings.bulkGet(
          [...new Set(plan.bearingPlans.map((item) => item.entityId))],
        );
        const bearingMap = new Map(bearingMaster.filter((item): item is BearingRow => !!item).map((item) => [item.id, item]));
        const acceptedBearingIds: string[] = [];
        const bearingUpdates: BearingRow[] = [];
        for (const fieldPlan of plan.bearingPlans) {
          if (fieldPlan.kind !== 'accept') continue;
          const row = bearingMap.get(fieldPlan.entityId);
          if (!row) continue;
          bearingUpdates.push({ ...row, diseaseGrade: fieldPlan.offlineValue as BearingRow['diseaseGrade'] });
          if (!acceptedBearingIds.includes(row.id)) acceptedBearingIds.push(row.id);
        }
        if (bearingUpdates.length) await putBearings(bearingUpdates);

        // —— 步骤：逐字段接 accept，多字段 accept 合并为一次行更新 ——
        const stepMaster = await db.steps.bulkGet(
          [...new Set(plan.stepPlans.map((item) => item.entityId))],
        );
        const stepMap = new Map(stepMaster.filter((item): item is StepRow => !!item).map((item) => [item.id, item]));
        const acceptedStepIds: string[] = [];
        const stepUpdates = new Map<string, StepRow>();
        for (const fieldPlan of plan.stepPlans) {
          if (fieldPlan.kind !== 'accept') continue;
          const row = stepMap.get(fieldPlan.entityId);
          if (!row) continue;
          const next = stepUpdates.get(row.id) ?? { ...row };
          (next as unknown as Record<string, unknown>)[fieldPlan.field] = fieldPlan.offlineValue;
          stepUpdates.set(row.id, next);
          if (!acceptedStepIds.includes(row.id)) acceptedStepIds.push(row.id);
        }
        if (stepUpdates.size) await putSteps([...stepUpdates.values()]);

        // —— 新增读数：幂等追加（确定 id，已存在则跳过）——
        const readings: ReadingRow[] = plan.readingPlans
          .filter((item) => item.kind === 'append')
          .map((item) => ({
            id: item.targetId,
            stepId: item.draft.stepId,
            pointCode: item.draft.pointCode,
            displacementMm: item.draft.displacementMm,
            stressMpa: item.draft.stressMpa,
            recordedAt: item.draft.recordedAt,
            operator: item.draft.operator,
            ...rowMeta(),
          }));
        if (readings.length) await putReadings(readings);

        // —— 差异清单：两边都改的字段逐条落库（确定性 id，重试幂等）——
        const conflicts: MergeConflictRow[] = [...plan.bearingPlans, ...plan.stepPlans]
          .filter((item) => item.kind === 'conflict')
          .map((item) => ({
            id: `conflict-${pkg.packageNo}-${item.entity}-${item.entityId}-${item.field}`,
            packageNo: pkg.packageNo,
            bridgeId: pkg.bridgeId,
            entity: item.entity,
            entityId: item.entityId,
            field: item.field,
            masterValue: item.masterValue,
            offlineValue: item.offlineValue,
            baselineValue: item.baselineValue,
            status: 'open',
            resolution: null,
            createdAt: stamp,
            resolvedAt: '',
          }));
        if (conflicts.length) await putMergeConflicts(conflicts);

        // —— 包流水：按包号去重的依据 ——
        await putMergeJournal({
          id: `journal-${pkg.packageNo}`,
          packageNo: pkg.packageNo,
          bridgeId: pkg.bridgeId,
          bridgeName: pkg.bridgeName,
          crew: pkg.crew,
          receivedAt: stamp,
          acceptedBearingIds,
          acceptedStepIds,
          appendedReadingIds: appendReadingIds,
        });
      },
    );
  }

  /** 显式恢复主台账：回写失败前快照，并删除可能已追加的读数 */
  private async restoreMaster(bearings: BearingRow[], steps: StepRow[], appendedReadingIds: string[]): Promise<void> {
    try {
      await db.transaction(
        'rw',
        [db.bearings, db.steps, db.readings],
        async () => {
          if (bearings.length) await putBearings(bearings);
          if (steps.length) await putSteps(steps);
          if (appendedReadingIds.length) await db.readings.bulkDelete(appendedReadingIds);
        },
      );
    } catch {
      // 恢复事务本身失败时不再抛出覆盖原始错误；Dexie 外层事务回滚已保证一致性
    }
  }

  /** 登记失败批次：保留作业包全文与计划规模，供下次重试；重试仍失败则在原批次上递增 attempts */
  private async recordFailedBatch(
    pkg: OfflinePackage,
    plan: MergePlan,
    error: string,
    priorBatchId?: string,
  ): Promise<string> {
    const stamp = new Date().toISOString();
    const previous = priorBatchId ? await db.mergeBatches.get(priorBatchId) : undefined;
    const id = previous?.id ?? newId('batch');
    await putMergeBatch({
      id,
      packageNo: pkg.packageNo,
      bridgeId: pkg.bridgeId,
      bridgeName: pkg.bridgeName,
      crew: pkg.crew,
      status: 'failed',
      error,
      createdAt: previous?.createdAt ?? stamp,
      finishedAt: stamp,
      attempts: (previous?.attempts ?? 0) + 1,
      packageJson: JSON.stringify(pkg),
      pendingAccept: plan.acceptCount,
      pendingReadings: plan.appendReadingCount,
    });
    return id;
  }
}
