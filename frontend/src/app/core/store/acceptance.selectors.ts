import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { AcceptanceState } from './acceptance.reducer';
import type { AcceptanceRow, BearingRow, BridgeRow, PierRow } from '../utils/db';
import {
  ACCEPTANCE_STAGES,
  ACCEPTANCE_STAGE_LABEL,
  archiveHint,
  stageOrder,
  type AcceptanceStage,
  type AcceptanceView,
} from '../types/acceptance';

export const selectAcceptanceState = createFeatureSelector<AcceptanceState>('acceptance');
export const selectAcceptances = createSelector(selectAcceptanceState, (state) => state.acceptances);
export const selectSelectedBearingIds = createSelector(
  selectAcceptanceState,
  (state) => state.selectedBearingIds,
);
export const selectLastArchiveSummary = createSelector(
  selectAcceptanceState,
  (state) => state.lastArchiveSummary,
);

/** 支座 → 已通过阶段集合 */
export function passedStagesOf(acceptances: AcceptanceRow[], bearingId: string): AcceptanceStage[] {
  return acceptances
    .filter((item) => item.bearingId === bearingId && item.conclusion === 'pass')
    .map((item) => item.stage)
    .filter((stage, index, list) => list.indexOf(stage) === index);
}

/** 支座 → 未通过阶段 */
export function failedStagesOf(acceptances: AcceptanceRow[], bearingId: string): AcceptanceStage[] {
  return acceptances
    .filter((item) => item.bearingId === bearingId && item.conclusion === 'fail')
    .map((item) => item.stage)
    .filter((stage, index, list) => list.indexOf(stage) === index);
}

/** 验收视图：带支座与桥梁上下文 */
export function buildAcceptanceViews(
  acceptances: AcceptanceRow[],
  bearings: BearingRow[],
  piers: PierRow[],
  bridges: BridgeRow[],
): AcceptanceView[] {
  return acceptances
    .map((record) => {
      const bearing = bearings.find((item) => item.id === record.bearingId);
      const pier = bearing ? piers.find((item) => item.id === bearing.pierId) : undefined;
      const bridge = pier ? bridges.find((item) => item.id === pier.bridgeId) : undefined;
      const passed = bearing ? passedStagesOf(acceptances, bearing.id) : [];
      const failed = bearing ? failedStagesOf(acceptances, bearing.id) : [];
      return {
        ...record,
        bearingSerial: bearing?.serial ?? '已删除支座',
        bearingSpec: bearing?.spec ?? '-',
        pierCode: pier?.code ?? '-',
        bridgeId: bridge?.id ?? '',
        bridgeName: bridge?.name ?? '未归属桥梁',
        passedStages: passed.length,
        fullyAccepted: ACCEPTANCE_STAGES.every((stage) => passed.includes(stage)) && failed.length === 0,
        failedStages: failed.map((stage) => ACCEPTANCE_STAGE_LABEL[stage]),
      };
    })
    .sort((a, b) => stageOrder(a.stage) - stageOrder(b.stage));
}

/** 验收阶段统计 */
export const selectAcceptanceStats = createSelector(selectAcceptances, (acceptances) => ({
  total: acceptances.length,
  pass: acceptances.filter((item) => item.conclusion === 'pass').length,
  fail: acceptances.filter((item) => item.conclusion === 'fail').length,
  byStage: ACCEPTANCE_STAGES.map((stage) => ({
    stage,
    label: ACCEPTANCE_STAGE_LABEL[stage],
    count: acceptances.filter((item) => item.stage === stage).length,
    pass: acceptances.filter((item) => item.stage === stage && item.conclusion === 'pass').length,
  })),
}));

/** 归档条件提示（需要支座总数） */
export function selectArchiveHint(fullyAcceptedCount: number, totalBearings: number): string {
  return archiveHint(fullyAcceptedCount, totalBearings);
}
