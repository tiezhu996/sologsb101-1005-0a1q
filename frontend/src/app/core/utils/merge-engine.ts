/**
 * 离线合并引擎（纯函数）：对一份「带冻结基线的作业包」与当前主台账做三方比对，
 * 产出可直接落库的写入计划与差异清单；不触碰 IndexedDB，便于单测与重试复用。
 *
 * 规则（对应交接制度）：
 * 1. 只接基线后的单边变化：base → offline 改了且 base → master 未改，采纳离线值；
 * 2. 两边都改：base → offline、base → master 均变，保留 master 原值，登记 blocking / warning 差异；
 * 3. 新增读数按「步骤 + 测点」唯一键追加，主台账已有同键跳过，包内同键以末条为准；
 * 4. 只改了主台账（离线未动）：主台账原值自然保留，不登记；
 * 5. 离线新增实体找不到基线 / 主台账父级 → unverifiable 差异，不猜着落库。
 */
import type { Bearing } from '../types/bearing';
import type { Reading } from '../types/reading';
import type { Step } from '../types/step';
import type { Bridge } from '../types/bridge';
import type { Pier } from '../types/pier';
import type {
  MergeDifference,
  MergeDifferenceType,
  MergeEntityKind,
  OfflinePackage,
} from '../types/merge';
import {
  STEP_FIELD_LABEL,
  STEP_MERGE_FIELDS,
  diseaseGradeText,
  fieldText,
  readingKey,
  stepStateText,
  syncRequirementText,
  type StepMergeField,
} from '../types/merge';

/** 落库写入计划：全部为「确定可采纳」的行 */
export interface MergeWritePlan {
  /** 单边变化后需要整行覆盖的支座 */
  bearingsToPut: Bearing[];
  /** 单边变化后需要整行覆盖的步骤 */
  stepsToPut: Step[];
  /** 追加的新读数 */
  readingsToPut: Reading[];
  /** 登记的全部差异（双边冲突 / 无法核实 / 已应用 / 跳过） */
  differences: MergeDifference[];
  counts: {
    appliedBearing: number;
    appliedStep: number;
    appendedReading: number;
    skippedReading: number;
    duplicateInPackage: number;
    addedBearing: number;
    addedStep: number;
  };
}

export interface MergeContext {
  bridges: Bridge[];
  piers: Pier[];
  bearings: Bearing[];
  steps: Step[];
  readings: Reading[];
  /** 报告 / 差异 id 前缀（重试保持稳定） */
  reportId: string;
  mergedAt: string;
}

function differenceId(
  reportId: string,
  kind: MergeEntityKind,
  entityId: string,
  field: string,
  type: MergeDifferenceType,
): string {
  return `${reportId}:${kind}:${entityId}:${field}:${type}`;
}

function makeDifference(input: {
  reportId: string;
  packageNo: string;
  kind: MergeEntityKind;
  entityId: string;
  location: string;
  field: string;
  fieldLabel: string;
  masterValue: string;
  offlineValue: string;
  baselineValue: string;
  type: MergeDifferenceType;
  severity?: 'blocking' | 'warning';
  detail: string;
  createdAt: string;
}): MergeDifference {
  return {
    id: differenceId(input.reportId, input.kind, input.entityId, input.field, input.type),
    packageNo: input.packageNo,
    kind: input.kind,
    entityId: input.entityId,
    location: input.location,
    field: input.field,
    fieldLabel: input.fieldLabel,
    masterValue: input.masterValue,
    offlineValue: input.offlineValue,
    baselineValue: input.baselineValue,
    type: input.type,
    severity: input.severity ?? (input.type === 'bothChanged' ? 'warning' : 'warning'),
    detail: input.detail,
    acknowledged: false,
    createdAt: input.createdAt,
  };
}

/** 定位文案：桥梁 · 墩台 · 支座 / 桥梁 · 步骤序 */
export function bearingLocation(bearing: Bearing | undefined, piers: Pier[], bridges: Bridge[]): string {
  if (!bearing) return '未知支座';
  const pier = piers.find((item) => item.id === bearing.pierId);
  const bridge = pier ? bridges.find((item) => item.id === pier.bridgeId) : undefined;
  return `${bridge?.name ?? '未知桥梁'} · ${pier?.code ?? '未知墩台'} · 支座 ${bearing.serial}`;
}

export function stepLocation(step: Step | undefined, bridges: Bridge[]): string {
  if (!step) return '未知步骤';
  const bridge = bridges.find((item) => item.id === step.bridgeId);
  return `${bridge?.name ?? '未知桥梁'} · #${step.seq} 步骤`;
}

function changed(left: unknown, right: unknown): boolean {
  return left !== right;
}

/**
 * 三方比对单字段：返回应采纳的值与是否构成双边冲突。
 * - 单边（仅离线改）：采纳离线值
 * - 双边：返回主台账值（冲突由调用方登记）
 * - 其余：主台账值
 */
function reconcileField(
  baseValue: unknown,
  offlineValue: unknown,
  masterValue: unknown,
): { accepted: unknown; conflict: boolean } {
  const offlineChanged = changed(baseValue, offlineValue);
  const masterChanged = changed(baseValue, masterValue);
  if (offlineChanged && masterChanged) return { accepted: masterValue, conflict: true };
  if (offlineChanged) return { accepted: offlineValue, conflict: false };
  return { accepted: masterValue, conflict: false };
}

/**
 * 构建合并写入计划。假定作业包已通过结构与基线校验（缺基线的包不进入此函数）。
 */
export function planMerge(pkg: OfflinePackage, ctx: MergeContext): MergeWritePlan {
  const baselineBearings = new Map(pkg.baseline!.bearings.map((item) => [item.id, item]));
  const baselineSteps = new Map(pkg.baseline!.steps.map((item) => [item.id, item]));
  const masterBearings = new Map(ctx.bearings.map((item) => [item.id, item]));
  const masterSteps = new Map(ctx.steps.map((item) => [item.id, item]));
  const masterReadingKeys = new Set(ctx.readings.map((item) => readingKey(item.stepId, item.pointCode)));
  const masterStepIds = new Set(ctx.steps.map((item) => item.id));

  const differences: MergeDifference[] = [];
  const bearingsToPut = new Map<string, Bearing>();
  const stepsToPut = new Map<string, Step>();
  const readingsToPut: Reading[] = [];
  const counts = {
    appliedBearing: 0,
    appliedStep: 0,
    appendedReading: 0,
    skippedReading: 0,
    duplicateInPackage: 0,
    addedBearing: 0,
    addedStep: 0,
  };

  /* ------------------------------- 支座 ------------------------------- */
  for (const offline of pkg.changes.bearings) {
    const base = baselineBearings.get(offline.id);
    const master = masterBearings.get(offline.id);

    // 离线新增支座：基线里没有，主台账也没有 → 无法核实归属，不猜着落库
    if (!base) {
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'bearing',
          entityId: offline.id,
          location: bearingLocation(master ?? offline, ctx.piers, ctx.bridges),
          field: 'diseaseGrade',
          fieldLabel: '新增支座',
          masterValue: master ? diseaseGradeText(master.diseaseGrade) : '主台账无此支座',
          offlineValue: diseaseGradeText(offline.diseaseGrade),
          baselineValue: '基线无此支座',
          type: 'unverifiable',
          detail: '离线新增的支座不在冻结基线内，需先回站补登支座再调整等级，已按待核实留档',
          createdAt: ctx.mergedAt,
        }),
      );
      continue;
    }
    if (!master) {
      // 主台账已删除该支座 → 无法核实，不恢复
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'bearing',
          entityId: offline.id,
          location: bearingLocation(base, ctx.piers, ctx.bridges),
          field: 'diseaseGrade',
          fieldLabel: '病害等级',
          masterValue: '主台账已删除',
          offlineValue: diseaseGradeText(offline.diseaseGrade),
          baselineValue: diseaseGradeText(base.diseaseGrade),
          type: 'unverifiable',
          detail: '该支座已在主台账中删除，离线等级调整无法落实',
          createdAt: ctx.mergedAt,
        }),
      );
      continue;
    }

    const location = bearingLocation(master, ctx.piers, ctx.bridges);
    const reconciled: Bearing = { ...master };
    let bearingChanged = false;

    // 病害等级：双边冲突为 blocking，未确认前该支座不得签署验收
    const grade = reconcileField(base.diseaseGrade, offline.diseaseGrade, master.diseaseGrade);
    if (grade.conflict) {
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'bearing',
          entityId: master.id,
          location,
          field: 'diseaseGrade',
          fieldLabel: '病害等级',
          masterValue: diseaseGradeText(master.diseaseGrade),
          offlineValue: diseaseGradeText(offline.diseaseGrade),
          baselineValue: diseaseGradeText(base.diseaseGrade),
          type: 'bothChanged',
          severity: 'blocking',
          detail: '病害等级两边都改过：已保留主台账原值，需技术员核定后确认差异，确认前该支座不得签署验收',
          createdAt: ctx.mergedAt,
        }),
      );
    } else if (changed(base.diseaseGrade, offline.diseaseGrade)) {
      reconciled.diseaseGrade = offline.diseaseGrade;
      bearingChanged = true;
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'bearing',
          entityId: master.id,
          location,
          field: 'diseaseGrade',
          fieldLabel: '病害等级',
          masterValue: diseaseGradeText(master.diseaseGrade),
          offlineValue: diseaseGradeText(offline.diseaseGrade),
          baselineValue: diseaseGradeText(base.diseaseGrade),
          type: 'applied',
          detail: `单边变化已采纳：病害等级由 ${diseaseGradeText(base.diseaseGrade)} 调整为 ${diseaseGradeText(
            offline.diseaseGrade,
          )}`,
          createdAt: ctx.mergedAt,
        }),
      );
    }

    // 病害描述：同样按三方比对，但双边冲突不冻结验收（warning）
    const note = reconcileField(base.diseaseNote ?? '', offline.diseaseNote ?? '', master.diseaseNote ?? '');
    if (note.conflict) {
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'bearing',
          entityId: master.id,
          location,
          field: 'diseaseNote',
          fieldLabel: '病害描述',
          masterValue: fieldText(master.diseaseNote),
          offlineValue: fieldText(offline.diseaseNote),
          baselineValue: fieldText(base.diseaseNote),
          type: 'bothChanged',
          severity: 'warning',
          detail: '病害描述两边都改过：已保留主台账原值',
          createdAt: ctx.mergedAt,
        }),
      );
    } else if (changed(base.diseaseNote ?? '', offline.diseaseNote ?? '')) {
      reconciled.diseaseNote = offline.diseaseNote ?? '';
      bearingChanged = true;
    }

    if (bearingChanged) {
      bearingsToPut.set(reconciled.id, reconciled);
      counts.appliedBearing += 1;
    }
  }

  /* ------------------------------- 步骤 ------------------------------- */
  for (const offline of pkg.changes.steps) {
    const base = baselineSteps.get(offline.id);
    const master = masterSteps.get(offline.id);

    if (!base) {
      // 离线新增步骤：基线没有但桥梁真实存在时允许追加，序由站端重排；否则无法核实
      const bridgeExists = ctx.bridges.some((item) => item.id === offline.bridgeId);
      if (!bridgeExists) {
        differences.push(
          makeDifference({
            reportId: ctx.reportId,
            packageNo: pkg.packageNo,
            kind: 'step',
            entityId: offline.id,
            location: stepLocation(offline, ctx.bridges),
            field: 'targetLiftMm',
            fieldLabel: '新增步骤',
            masterValue: '主台账无此桥梁',
            offlineValue: `目标 ${offline.targetLiftMm} mm`,
            baselineValue: '基线无此步骤',
            type: 'unverifiable',
            detail: '离线新增步骤挂接的桥梁不在主台账，无法追加，已按待核实留档',
            createdAt: ctx.mergedAt,
          }),
        );
        continue;
      }
      const maxSeq = ctx.steps
        .concat([...stepsToPut.values()])
        .filter((item) => item.bridgeId === offline.bridgeId)
        .reduce((max, item) => Math.max(max, item.seq), 0);
      stepsToPut.set(offline.id, { ...offline, seq: maxSeq + 1 });
      counts.addedStep += 1;
      counts.appliedStep += 1;
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'step',
          entityId: offline.id,
          location: stepLocation(offline, ctx.bridges),
          field: 'targetLiftMm',
          fieldLabel: '新增步骤',
          masterValue: '主台账无此步骤',
          offlineValue: `目标 ${offline.targetLiftMm} mm`,
          baselineValue: '基线无此步骤',
          type: 'applied',
          detail: `离线新增步骤已追加到末级（#${maxSeq + 1}），参数以离线包为准`,
          createdAt: ctx.mergedAt,
        }),
      );
      continue;
    }
    if (!master) {
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'step',
          entityId: offline.id,
          location: stepLocation(base, ctx.bridges),
          field: 'targetLiftMm',
          fieldLabel: '顶升步骤',
          masterValue: '主台账已删除',
          offlineValue: `目标 ${offline.targetLiftMm} mm`,
          baselineValue: `目标 ${base.targetLiftMm} mm`,
          type: 'unverifiable',
          detail: '该步骤已在主台账中删除，离线参数调整无法落实',
          createdAt: ctx.mergedAt,
        }),
      );
      continue;
    }

    const location = stepLocation(master, ctx.bridges);
    const reconciled: Step = { ...master };
    let stepChanged = false;

    for (const fieldName of STEP_MERGE_FIELDS) {
      const result = reconcileField(base[fieldName], offline[fieldName], master[fieldName]);
      if (result.conflict) {
        differences.push(
          makeDifference({
            reportId: ctx.reportId,
            packageNo: pkg.packageNo,
            kind: 'step',
            entityId: master.id,
            location,
            field: fieldName,
            fieldLabel: STEP_FIELD_LABEL[fieldName as StepMergeField],
            masterValue: formatStepField(fieldName, master[fieldName]),
            offlineValue: formatStepField(fieldName, offline[fieldName]),
            baselineValue: formatStepField(fieldName, base[fieldName]),
            type: 'bothChanged',
            severity: 'warning',
            detail: `步骤${STEP_FIELD_LABEL[fieldName as StepMergeField]}两边都改过：已保留主台账原值`,
            createdAt: ctx.mergedAt,
          }),
        );
      } else if (changed(base[fieldName], offline[fieldName])) {
        // 仅离线单边改动：采纳
        if (fieldName === 'targetLiftMm') reconciled.targetLiftMm = offline.targetLiftMm;
        else if (fieldName === 'syncRequirement') reconciled.syncRequirement = offline.syncRequirement;
        else if (fieldName === 'limitMm') reconciled.limitMm = offline.limitMm;
        else if (fieldName === 'leader') reconciled.leader = offline.leader;
        stepChanged = true;
        differences.push(
          makeDifference({
            reportId: ctx.reportId,
          packageNo: pkg.packageNo,
            kind: 'step',
            entityId: master.id,
            location,
            field: fieldName,
            fieldLabel: STEP_FIELD_LABEL[fieldName as StepMergeField],
            masterValue: formatStepField(fieldName, master[fieldName]),
            offlineValue: formatStepField(fieldName, offline[fieldName]),
            baselineValue: formatStepField(fieldName, base[fieldName]),
            type: 'applied',
            detail: `单边变化已采纳：${STEP_FIELD_LABEL[fieldName as StepMergeField]}更新为 ${formatStepField(
              fieldName,
              offline[fieldName],
            )}`,
            createdAt: ctx.mergedAt,
          }),
        );
      }
    }

    // 步骤状态也参与三方比对（warning，不冻结验收）
    const stateResult = reconcileField(base.state, offline.state, master.state);
    if (stateResult.conflict) {
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'step',
          entityId: master.id,
          location,
          field: 'state',
          fieldLabel: STEP_FIELD_LABEL.state,
          masterValue: stepStateText(master.state),
          offlineValue: stepStateText(offline.state),
          baselineValue: stepStateText(base.state),
          type: 'bothChanged',
          severity: 'warning',
          detail: '步骤状态两边都改过：已保留主台账原值',
          createdAt: ctx.mergedAt,
        }),
      );
    } else if (changed(base.state, offline.state)) {
      reconciled.state = offline.state;
      stepChanged = true;
    }

    // 顺序 seq 永远以主台账为准，不接收离线序号
    if (stepChanged) {
      stepsToPut.set(reconciled.id, reconciled);
      counts.appliedStep += 1;
    }
  }

  /* ------------------------------- 读数 ------------------------------- */
  const packageReadingKeys = new Set<string>();
  const lastByKey = new Map<string, Reading>();
  // 同包同键去重：以末条为准
  for (const reading of pkg.changes.readings) {
    const key = readingKey(reading.stepId, reading.pointCode);
    if (packageReadingKeys.has(key)) counts.duplicateInPackage += 1;
    packageReadingKeys.add(key);
    lastByKey.set(key, reading);
  }

  for (const reading of lastByKey.values()) {
    const key = readingKey(reading.stepId, reading.pointCode);
    const step = masterSteps.get(reading.stepId);
    const location = step
      ? stepLocation(step, ctx.bridges)
      : `未知步骤 ${reading.stepId}`;

    // 父步骤在基线里都不存在：可能是离线随新步骤带出的读数，跟随步骤处理
    if (!masterStepIds.has(reading.stepId)) {
      const baseStep = baselineSteps.get(reading.stepId);
      const addedStep = stepsToPut.get(reading.stepId);
      if (!baseStep && addedStep) {
        readingsToPut.push(reading);
        masterStepIds.add(reading.stepId);
        counts.appendedReading += 1;
        continue;
      }
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'reading',
          entityId: key,
          location,
          field: 'pointCode',
          fieldLabel: `测点 ${reading.pointCode}`,
          masterValue: '主台账无此步骤',
          offlineValue: `位移 ${reading.displacementMm} mm`,
          baselineValue: baseStep ? '基线步骤存在' : '基线无此步骤',
          type: 'unverifiable',
          detail: `读数挂接的步骤 ${reading.stepId} 无法在主台账核实，已按待核实留档`,
          createdAt: ctx.mergedAt,
        }),
      );
      continue;
    }

    // 唯一键已存在 → 跳过（不覆盖既有读数）
    if (masterReadingKeys.has(key)) {
      counts.skippedReading += 1;
      differences.push(
        makeDifference({
          reportId: ctx.reportId,
          packageNo: pkg.packageNo,
          kind: 'reading',
          entityId: key,
          location,
          field: 'pointCode',
          fieldLabel: `测点 ${reading.pointCode}`,
          masterValue: '主台账已有该步骤+测点读数',
          offlineValue: `位移 ${reading.displacementMm} mm`,
          baselineValue: '—',
          type: 'skipped',
          severity: 'warning',
          detail: '步骤+测点唯一键已存在，按追加规则跳过，未覆盖主台账读数',
          createdAt: ctx.mergedAt,
        }),
      );
      continue;
    }

    readingsToPut.push(reading);
    masterReadingKeys.add(key);
    counts.appendedReading += 1;
  }

  counts.addedBearing = 0; // 离线新增支座一律待核实，不直接落库
  return {
    bearingsToPut: [...bearingsToPut.values()],
    stepsToPut: [...stepsToPut.values()],
    readingsToPut,
    differences,
    counts,
  };
}

function formatStepField(field: string, value: unknown): string {
  if (field === 'syncRequirement') return syncRequirementText(value as Step['syncRequirement']);
  if (field === 'targetLiftMm' || field === 'limitMm') return `${fieldText(value)} mm`;
  return fieldText(value);
}
