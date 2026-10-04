import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { MergeState } from './merge.reducer';
import type { BearingRow, PierRow, StepRow } from '../utils/db';
import type { MergeDifference } from '../types/merge';

export const selectMergeState = createFeatureSelector<MergeState>('merge');
export const selectMergeLedger = createSelector(selectMergeState, (state) => state.ledger);
export const selectMergeLoaded = createSelector(selectMergeState, (state) => state.loaded);
export const selectMergeReports = createSelector(selectMergeLedger, (ledger) => ledger.reports);
export const selectPendingMerges = createSelector(selectMergeLedger, (ledger) => ledger.pending);
export const selectQuarantinedPackages = createSelector(selectMergeLedger, (ledger) => ledger.quarantined);
export const selectLastHandoff = createSelector(selectMergeState, (state) => ({
  message: state.lastHandoffMessage,
  status: state.lastHandoffStatus,
}));

/** 展平的差异清单（带并入时间，新报告在前） */
export interface FlatDifference extends MergeDifference {
  mergedAt: string;
  bridgeId: string;
  bridgeName: string;
}

export const selectAllDifferences = createSelector(selectMergeLedger, (ledger): FlatDifference[] =>
  ledger.reports.flatMap((report) =>
    report.differences.map((diff) => ({
      ...diff,
      mergedAt: report.mergedAt,
      bridgeId: report.bridgeId,
      bridgeName: report.bridgeName,
    })),
  ),
);

/** 未确认的差异（四页读取的「待处理」角标依据） */
export const selectOpenDifferences = createSelector(selectAllDifferences, (list) =>
  list.filter((item) => !item.acknowledged),
);

/** 各桥梁未确认差异数 */
export const selectOpenDifferenceCountByBridge = createSelector(selectOpenDifferences, (list) => {
  const map = new Map<string, number>();
  for (const diff of list) map.set(diff.bridgeId, (map.get(diff.bridgeId) ?? 0) + 1);
  return map;
});

/** 各步骤未确认差异数（步骤页标记） */
export const selectOpenDifferenceCountByStep = createSelector(selectOpenDifferences, (list) => {
  const map = new Map<string, number>();
  for (const diff of list) {
    if (diff.kind !== 'step') continue;
    map.set(diff.entityId, (map.get(diff.entityId) ?? 0) + 1);
  }
  return map;
});

/** 各支座未确认差异数（验收页 / 评级页标记） */
export const selectOpenDifferenceCountByBearing = createSelector(selectOpenDifferences, (list) => {
  const map = new Map<string, number>();
  for (const diff of list) {
    if (diff.kind !== 'bearing') continue;
    map.set(diff.entityId, (map.get(diff.entityId) ?? 0) + 1);
  }
  return map;
});

/**
 * 被冻结验收签署的桥梁集合：桥梁存在未确认的步骤参数双边改动差异时，
 * 该桥全部支座的签署需在步骤参数核定后进行（具体支座集合由 resolveBlockedBearingIds 计算）。
 */
export const selectStepBlockedBridgeIds = createSelector(selectOpenDifferences, (openList) => {
  const bridgeIds = new Set<string>();
  for (const diff of openList) {
    if (diff.type === 'bothChanged' && diff.kind === 'step') bridgeIds.add(diff.bridgeId);
  }
  return bridgeIds;
});

/** 给定支座集合上下文，返回最终不可签署的支座 id（供验收页调用） */
export function resolveBlockedBearingIds(
  openDifferences: FlatDifference[],
  bearings: BearingRow[],
  piers: PierRow[],
  steps: StepRow[],
): Set<string> {
  const bearingGradeBlocks = new Set<string>();
  const stepBlockedBridges = new Set<string>();
  for (const diff of openDifferences) {
    if (diff.acknowledged || diff.type !== 'bothChanged') continue;
    if (diff.kind === 'bearing' && diff.field === 'diseaseGrade') bearingGradeBlocks.add(diff.entityId);
    if (diff.kind === 'step') {
      const step = steps.find((item) => item.id === diff.entityId);
      if (step) stepBlockedBridges.add(step.bridgeId);
      else stepBlockedBridges.add(diff.bridgeId);
    }
  }
  const blockedPiers = new Set(
    piers.filter((pier) => stepBlockedBridges.has(pier.bridgeId)).map((pier) => pier.id),
  );
  const result = new Set<string>();
  for (const bearing of bearings) {
    if (bearingGradeBlocks.has(bearing.id) || blockedPiers.has(bearing.pierId)) result.add(bearing.id);
  }
  return result;
}

/** 待补证 + 待重试总数（全局角标） */
export const selectAttentionCount = createSelector(selectMergeLedger, (ledger) => ({
  pending: ledger.pending.length,
  quarantined: ledger.quarantined.length,
  openDiffs: ledger.reports.reduce(
    (sum, report) => sum + report.differences.filter((item) => !item.acknowledged).length,
    0,
  ),
}));
