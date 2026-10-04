/**
 * 离线合并计划引擎（纯函数，无 IndexedDB 副作用，便于核验规则）。
 *
 * 规则：
 * - 作业包冻结基线：只对基线内的支座 / 步骤做三方比较，基线外一律不猜不接。
 * - 按包号去重：由持久化层 mergeJournals 保证，计划引擎只对「未接收」的包算计划。
 * - 只接基线后的单边变化：离线相对基线改了、主台账相对基线没改 → accept；两边都改 → conflict。
 * - 新增读数：按「步骤 + 测点」唯一键，主台账已有任意读数即跳过（dup），否则追加（append）。
 */
import type { BearingRow, ReadingRow, StepRow } from '../utils/db';
import type {
  MergeFieldPlan,
  MergePlan,
  MergeReadingPlan,
  OfflinePackage,
  StepParamField,
} from '../types/handoff';
import { STEP_PARAM_FIELDS } from './handoff-labels';

/** 离线追加读数的确定 id：同一包同一唯一键永远只写一行（失败重试幂等） */
export function offlineReadingId(packageNo: string, stepId: string, pointCode: string): string {
  return `read-offline-${sanitize(packageNo)}-${sanitize(stepId)}-${sanitize(pointCode)}`;
}

function sanitize(value: string): string {
  return value.replace(/[^a-zA-Z0-9_-]/g, '_');
}

function valuesEqual(a: unknown, b: unknown): boolean {
  if (typeof a === 'number' && typeof b === 'number') return a === b;
  return String(a) === String(b);
}

/** 计算支座病害等级字段的三方计划 */
function planBearings(
  pkg: OfflinePackage,
  masterBearings: Map<string, BearingRow>,
): MergeFieldPlan[] {
  const baselineMap = new Map((pkg.baseline?.bearings ?? []).map((item) => [item.id, item]));
  const plans: MergeFieldPlan[] = [];

  for (const change of pkg.takeOffline.bearings) {
    const baseline = baselineMap.get(change.id);
    // 基线外 / 基线缺该支座：不能猜着覆盖
    if (!baseline) continue;
    const master = masterBearings.get(change.id);
    if (!master) continue; // 主台账已无该支座，跳过（级联删除后不复活）

    const baselineValue = baseline.diseaseGrade;
    const masterValue = master.diseaseGrade;
    const offlineValue = change.diseaseGrade;

    // 离线相对基线未改：无需接收
    if (valuesEqual(offlineValue, baselineValue)) continue;

    // 主台账相对基线也改了：两边都改 → 冲突，保留主台账原值
    const kind = valuesEqual(masterValue, baselineValue) ? 'accept' : 'conflict';
    plans.push({
      entity: 'bearing',
      entityId: change.id,
      field: 'diseaseGrade',
      baselineValue,
      masterValue,
      offlineValue,
      kind,
    });
  }
  return plans;
}

/** 计算步骤参数字段（目标顶升量 / 限位 / 同步要求 / 负责人）的三方计划 */
function planSteps(pkg: OfflinePackage, masterSteps: Map<string, StepRow>): MergeFieldPlan[] {
  const baselineMap = new Map((pkg.baseline?.steps ?? []).map((item) => [item.id, item]));
  const plans: MergeFieldPlan[] = [];

  for (const change of pkg.takeOffline.steps) {
    const baseline = baselineMap.get(change.id);
    if (!baseline) continue; // 基线外步骤：不猜不接
    const master = masterSteps.get(change.id);
    if (!master) continue; // 主台账已删除该步骤，不复活

    for (const field of STEP_PARAM_FIELDS) {
      const baselineValue = baseline[field];
      const masterValue = master[field];
      const offlineValue = change[field];
      if (valuesEqual(offlineValue, baselineValue)) continue;
      const kind = valuesEqual(masterValue, baselineValue) ? 'accept' : 'conflict';
      plans.push({
        entity: 'step',
        entityId: change.id,
        field: field as StepParamField,
        baselineValue,
        masterValue,
        offlineValue,
        kind,
      });
    }
  }
  return plans;
}

/** 计算新增读数追加计划：步骤 + 测点唯一键，主台账已有读数即跳过 */
function planReadings(
  pkg: OfflinePackage,
  masterSteps: Map<string, StepRow>,
  existingKeySet: Set<string>,
): MergeReadingPlan[] {
  const baselineStepIds = new Set((pkg.baseline?.steps ?? []).map((item) => item.id));
  const plans: MergeReadingPlan[] = [];
  const seenInPackage = new Set<string>();

  for (const draft of pkg.takeOffline.readings) {
    const key = `${draft.stepId} ${draft.pointCode}`;
    // 包内同唯一键重复：只取第一条，其余视为 dup
    if (seenInPackage.has(key)) continue;
    seenInPackage.add(key);

    // 只接收基线内且主台账仍存在的步骤的读数；基线外不猜
    if (!baselineStepIds.has(draft.stepId)) continue;
    if (!masterSteps.has(draft.stepId)) continue;

    const dup = existingKeySet.has(key);
    plans.push({
      stepId: draft.stepId,
      pointCode: draft.pointCode,
      draft,
      kind: dup ? 'dup' : 'append',
      targetId: offlineReadingId(pkg.packageNo, draft.stepId, draft.pointCode),
    });
  }
  return plans;
}

/** 读入作业包，结合主台账现状算出合并计划（不落库） */
export function buildMergePlan(
  pkg: OfflinePackage,
  master: {
    bearings: BearingRow[];
    steps: StepRow[];
    readings: ReadingRow[];
  },
): MergePlan {
  const masterBearings = new Map(master.bearings.map((item) => [item.id, item]));
  const masterSteps = new Map(master.steps.map((item) => [item.id, item]));
  // 主台账「步骤 + 测点」唯一键集合：该键已有任意读数即不再追加
  const existingKeySet = new Set(master.readings.map((item) => `${item.stepId} ${item.pointCode}`));

  const bearingPlans = planBearings(pkg, masterBearings);
  const stepPlans = planSteps(pkg, masterSteps);
  const readingPlans = planReadings(pkg, masterSteps, existingKeySet);

  const fieldPlans = [...bearingPlans, ...stepPlans];
  return {
    packageNo: pkg.packageNo,
    bridgeId: pkg.bridgeId,
    bridgeName: pkg.bridgeName,
    crew: pkg.crew,
    frozenAt: pkg.frozenAt,
    returnedAt: pkg.returnedAt,
    bearingPlans,
    stepPlans,
    readingPlans,
    acceptCount: fieldPlans.filter((item) => item.kind === 'accept').length,
    conflictCount: fieldPlans.filter((item) => item.kind === 'conflict').length,
    appendReadingCount: readingPlans.filter((item) => item.kind === 'append').length,
    dupReadingCount: readingPlans.filter((item) => item.kind === 'dup').length,
  };
}
