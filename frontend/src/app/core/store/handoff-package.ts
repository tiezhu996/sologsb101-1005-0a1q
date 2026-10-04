/**
 * 离线作业包构造：作业包冻结基线、演示作业包（正常 / 冲突 / 旧包缺基线）。
 * 纯浏览器实现，供检修组交接场景演示与端到端验证。
 */
import type { BearingRow, BridgeRow, StepRow } from '../utils/db';
import {
  OFFLINE_PACKAGE_KIND,
  type OfflinePackage,
} from '../types/handoff';
import { nowDateTime } from '../utils/export';

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 生成包号：PKG-日期-时分组 */
export function generatePackageNo(now: Date = new Date()): string {
  return `PKG-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
    now.getMinutes(),
  )}`;
}

/**
 * 冻结作业包基线：导出前对主台账中该桥梁相关的支座 / 步骤参数拍快照。
 * 读数不入基线（读数只追加），桥梁 / 墩台不参与合并。
 */
export function freezeBaseline(input: {
  bridge: BridgeRow;
  piers: Array<{ id: string }>;
  bearings: BearingRow[];
  steps: StepRow[];
  frozenAt: string;
}) {
  const pierIds = new Set(input.piers.map((item) => item.id));
  return {
    frozenAt: input.frozenAt,
    bearings: input.bearings
      .filter((item) => pierIds.has(item.pierId))
      .map((item) => ({ id: item.id, diseaseGrade: item.diseaseGrade })),
    steps: input.steps
      .filter((item) => item.bridgeId === input.bridge.id)
      .map((item) => ({
        id: item.id,
        targetLiftMm: item.targetLiftMm,
        limitMm: item.limitMm,
        syncRequirement: item.syncRequirement,
        leader: item.leader,
      })),
  };
}

/**
 * 构造一个「正常接收」演示作业包：
 * - 第一个支座离线单边升级病害等级；
 * - 第一条步骤离线单边调整目标顶升量 / 限位；
 * - 为第一条「非未开始」步骤追加一个主台账没有的测点读数。
 */
export function buildSampleAcceptedPackage(input: {
  bridge: BridgeRow;
  piers: Array<{ id: string }>;
  bearings: BearingRow[];
  steps: StepRow[];
  packageNo: string;
}): OfflinePackage | null {
  const pierIds = new Set(input.piers.map((item) => item.id));
  const bearings = input.bearings.filter((item) => pierIds.has(item.pierId));
  const steps = input.steps.filter((item) => item.bridgeId === input.bridge.id);
  const bearing = bearings[0];
  const step = steps[0];
  if (!bearing || !step) return null;

  const nextGrade = bearing.diseaseGrade === 'severe' ? 'moderate' : 'severe';
  const frozenAt = nowDateTime(new Date(Date.now() - 3 * 3600_000));
  const returnedAt = nowDateTime();

  const pkg: OfflinePackage = {
    kind: OFFLINE_PACKAGE_KIND,
    packageNo: input.packageNo,
    bridgeId: input.bridge.id,
    bridgeName: input.bridge.name,
    crew: '离线检修一组',
    frozenAt,
    returnedAt,
    baseline: freezeBaseline({
      bridge: input.bridge,
      piers: input.piers,
      bearings: input.bearings,
      steps: input.steps,
      frozenAt,
    }),
    takeOffline: {
      bearings: [{ id: bearing.id, diseaseGrade: nextGrade }],
      steps: [
        {
          id: step.id,
          targetLiftMm: step.targetLiftMm + 1,
          limitMm: step.limitMm,
          syncRequirement: step.syncRequirement,
          leader: step.leader,
        },
      ],
      readings: [
        {
          stepId: step.id,
          pointCode: 'J1',
          displacementMm: Number((step.targetLiftMm + 0.8).toFixed(2)),
          stressMpa: 9.6,
          recordedAt: returnedAt,
          operator: '离线检修一组',
        },
      ],
    },
  };
  return pkg;
}

/**
 * 构造一个「两边都改」演示作业包：冻结当前主台账为基线，随后作业包里把
 * 第一个支座等级与第一条步骤参数改为另一值。回站合并前需先在主台账上
 * 再改一次同一字段（交接页提供按钮），即可复现冲突、保留主台账原值并列差异。
 */
export function buildSampleConflictPackage(input: {
  bridge: BridgeRow;
  piers: Array<{ id: string }>;
  bearings: BearingRow[];
  steps: StepRow[];
  packageNo: string;
}): OfflinePackage | null {
  const pierIds = new Set(input.piers.map((item) => item.id));
  const bearings = input.bearings.filter((item) => pierIds.has(item.pierId));
  const steps = input.steps.filter((item) => item.bridgeId === input.bridge.id);
  const bearing = bearings[0];
  const step = steps[0];
  if (!bearing || !step) return null;

  const offlineGrade = bearing.diseaseGrade === 'slight' ? 'severe' : 'slight';
  const frozenAt = nowDateTime(new Date(Date.now() - 5 * 3600_000));
  const returnedAt = nowDateTime();

  return {
    kind: OFFLINE_PACKAGE_KIND,
    packageNo: input.packageNo,
    bridgeId: input.bridge.id,
    bridgeName: input.bridge.name,
    crew: '离线检修二组',
    frozenAt,
    returnedAt,
    baseline: freezeBaseline({
      bridge: input.bridge,
      piers: input.piers,
      bearings: input.bearings,
      steps: input.steps,
      frozenAt,
    }),
    takeOffline: {
      bearings: [{ id: bearing.id, diseaseGrade: offlineGrade }],
      steps: [
        {
          id: step.id,
          targetLiftMm: step.targetLiftMm,
          limitMm: step.limitMm + 2,
          syncRequirement: step.syncRequirement === 'sync' ? 'cross' : 'sync',
          leader: step.leader,
        },
      ],
      readings: [],
    },
  };
}

/**
 * 构造一个「旧包缺基线」演示作业包：结构可识别但没有 baseline，
 * 合并交接时只能进入待补证区，不能猜着覆盖。
 */
export function buildLegacyPackage(input: { bridge: BridgeRow; packageNo: string }): OfflinePackage {
  const returnedAt = nowDateTime();
  return {
    kind: OFFLINE_PACKAGE_KIND,
    packageNo: input.packageNo,
    bridgeId: input.bridge.id,
    bridgeName: input.bridge.name,
    crew: '历史检修班组（旧版作业包）',
    frozenAt: '',
    returnedAt,
    // 无 baseline 字段：模拟旧版终端导出的作业包
    takeOffline: {
      bearings: [],
      steps: [],
      readings: [],
    },
  };
}
