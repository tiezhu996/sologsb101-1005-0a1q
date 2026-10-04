import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { HandoffState } from './handoff.reducer';
import type { BearingRow, StepRow } from '../utils/db';
import type { MergeConflictRow, MergeEntityType, MergeField, MergeOverview, MergeResolution } from '../types/handoff';

export const selectHandoffState = createFeatureSelector<HandoffState>('handoff');
export const selectMergeConflicts = createSelector(selectHandoffState, (state) => state.conflicts);
export const selectMergeJournals = createSelector(selectHandoffState, (state) => state.journals);
export const selectMergeBatches = createSelector(selectHandoffState, (state) => state.batches);
export const selectMergeEvidence = createSelector(selectHandoffState, (state) => state.evidence);
export const selectPreviewPlan = createSelector(selectHandoffState, (state) => state.previewPlan);
export const selectHandoffNotice = createSelector(selectHandoffState, (state) => state.notice);

export const selectOpenConflicts = createSelector(selectMergeConflicts, (rows) =>
  rows.filter((item) => item.status === 'open'),
);

export const selectFailedBatches = createSelector(selectMergeBatches, (rows) =>
  rows.filter((item) => item.status === 'failed'),
);

/** 存在未裁定差异的支座 id 集合：验收签署前据此卡签 */
export const selectHeldBearingIds = createSelector(selectOpenConflicts, (rows) => {
  const set = new Set<string>();
  for (const row of rows) {
    if (row.entity === 'bearing') set.add(row.entityId);
  }
  return set;
});

/** 离线合并追加的读数 id 集合（读数页标记来源用） */
export const selectOfflineReadingIds = createSelector(selectMergeJournals, (journals) => {
  const set = new Set<string>();
  for (const journal of journals) {
    for (const id of journal.appendedReadingIds) set.add(id);
  }
  return set;
});

/** 被离线合并接收过单边变化的步骤 id 集合（步骤页标记用） */
export const selectOfflineTouchedStepIds = createSelector(selectMergeJournals, (journals) => {
  const set = new Set<string>();
  for (const journal of journals) {
    for (const id of journal.acceptedStepIds) set.add(id);
  }
  return set;
});

/** 交接台账概览 */
export const selectMergeOverview = createSelector(
  selectMergeConflicts,
  selectMergeJournals,
  selectMergeBatches,
  selectMergeEvidence,
  (conflicts, journals, batches, evidence): MergeOverview => ({
    receivedPackages: journals.length,
    openConflicts: conflicts.filter((item) => item.status === 'open').length,
    resolvedConflicts: conflicts.filter((item) => item.status === 'resolved').length,
    failedBatches: batches.filter((item) => item.status === 'failed').length,
    evidencePending: evidence.length,
    appendedReadings: journals.reduce((sum, item) => sum + item.appendedReadingIds.length, 0),
  }),
);

/** 差异视图：附带支座 / 步骤、桥梁上下文文案 */
export interface ConflictView {
  id: string;
  packageNo: string;
  entity: MergeEntityType;
  entityId: string;
  field: MergeField;
  masterValue: string | number;
  offlineValue: string | number;
  baselineValue: string | number;
  status: 'open' | 'resolved';
  resolution: MergeResolution | null;
  contextLabel: string;
  bridgeName: string;
}

export function buildConflictViews(
  conflicts: MergeConflictRow[],
  bearings: BearingRow[],
  steps: StepRow[],
  piers: Array<{ id: string; bridgeId: string; code: string }>,
  bridges: Array<{ id: string; name: string }>,
): ConflictView[] {
  const bearingMap = new Map(bearings.map((item) => [item.id, item]));
  const stepMap = new Map(steps.map((item) => [item.id, item]));
  const pierMap = new Map(piers.map((item) => [item.id, item]));
  const bridgeMap = new Map(bridges.map((item) => [item.id, item]));

  return conflicts.map((row) => {
    let contextLabel = `#${row.entityId}`;
    let bridgeName = '';
    if (row.entity === 'bearing') {
      const bearing = bearingMap.get(row.entityId);
      const pier = bearing ? pierMap.get(bearing.pierId) : undefined;
      bridgeName = pier ? bridgeMap.get(pier.bridgeId)?.name ?? '' : '';
      contextLabel = `${pier?.code ?? '已删除墩台'} · 支座 ${bearing?.serial ?? row.entityId}`;
    } else {
      const step = stepMap.get(row.entityId);
      bridgeName = step ? bridgeMap.get(step.bridgeId)?.name ?? '' : '';
      contextLabel = `顶升步骤 #${step?.seq ?? '-'}`;
    }
    return { ...row, contextLabel, bridgeName: bridgeName || '未归属桥梁' };
  });
}
