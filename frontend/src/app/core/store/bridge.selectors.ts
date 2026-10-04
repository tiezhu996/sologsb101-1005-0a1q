import { createFeatureSelector, createSelector } from '@ngrx/store';
import type { BridgeState } from './bridge.reducer';
import type { BridgeRow, PierRow } from '../utils/db';
import { parseSpanCombo, totalLengthM, type BridgeView } from '../types/bridge';
import { pierOrder, workPlatformHint, type PierView } from '../types/pier';
import { needReplacement } from '../types/bearing';
import { share } from '../utils/unit';

export const selectBridgeState = createFeatureSelector<BridgeState>('bridge');

export const selectBridges = createSelector(selectBridgeState, (state) => state.bridges);
export const selectPiers = createSelector(selectBridgeState, (state) => state.piers);
export const selectBearings = createSelector(selectBridgeState, (state) => state.bearings);
export const selectActiveBridgeId = createSelector(selectBridgeState, (state) => state.activeBridgeId);
export const selectBridgeLoading = createSelector(selectBridgeState, (state) => state.loading);
export const selectBridgeError = createSelector(selectBridgeState, (state) => state.error);

/** 当前选中桥梁 */
export const selectActiveBridge = createSelector(
  selectBridges,
  selectActiveBridgeId,
  (bridges, activeId): BridgeRow | null => bridges.find((item) => item.id === activeId) ?? null,
);

/** 当前桥梁下的墩台列表（按编号排序） */
export const selectActiveBridgePiers = createSelector(
  selectPiers,
  selectActiveBridgeId,
  (piers, activeId): PierRow[] =>
    piers.filter((item) => item.bridgeId === activeId).sort((a, b) => pierOrder(a.code) - pierOrder(b.code)),
);

/** 墩台视图：带桥梁上下文与支座统计 */
export const selectPierViews = createSelector(selectPiers, selectBridges, selectBearings, (piers, bridges, bearings): PierView[] =>
  piers
    .map((pier) => {
      const bridge = bridges.find((item) => item.id === pier.bridgeId);
      const owned = bearings.filter((item) => item.pierId === pier.id);
      return {
        ...pier,
        bridgeName: bridge?.name ?? '未归属桥梁',
        registeredBearingCount: owned.length,
        pendingBearingCount: owned.filter((item) => needReplacement(item.diseaseGrade)).length,
        stepCount: 0,
      };
    })
    .sort((a, b) => a.capElevation - b.capElevation),
);

/** 桥梁视图：卡片回显墩台数与待换支座数 */
export const selectBridgeViews = createSelector(selectBridges, selectPiers, selectBearings, (bridges, piers, bearings): BridgeView[] =>
  bridges.map((bridge) => {
    const ownedPiers = piers.filter((item) => item.bridgeId === bridge.id);
    const pierIds = new Set(ownedPiers.map((item) => item.id));
    const ownedBearings = bearings.filter((item) => pierIds.has(item.pierId));
    const pending = ownedBearings.filter((item) => needReplacement(item.diseaseGrade)).length;
    const { spans, spanM } = parseSpanCombo(bridge.spanCombo);
    return {
      ...bridge,
      pierCount: ownedPiers.length,
      bearingCount: ownedBearings.length,
      pendingBearingCount: pending,
      severeBearingCount: ownedBearings.filter((item) => item.diseaseGrade === 'severe').length,
      acceptanceRate: share(ownedBearings.length - pending, ownedBearings.length),
      totalLiftMm: Number((spans * spanM * 0).toFixed(2)),
    };
  }),
);

/** 桥梁概览统计 */
export const selectBridgeStats = createSelector(selectBridgeViews, (views) => ({
  total: views.length,
  piers: views.reduce((sum, item) => sum + item.pierCount, 0),
  bearings: views.reduce((sum, item) => sum + item.bearingCount, 0),
  pending: views.reduce((sum, item) => sum + item.pendingBearingCount, 0),
  severe: views.reduce((sum, item) => sum + item.severeBearingCount, 0),
  archived: views.filter((item) => item.archived).length,
}));

/** 桥梁跨径与总长提示 */
export const selectBridgeSpanInfo = createSelector(selectActiveBridge, (bridge) => {
  if (!bridge) return null;
  const { spans, spanM } = parseSpanCombo(bridge.spanCombo);
  return { spans, spanM, totalM: totalLengthM(bridge.spanCombo) };
});

/** 当前桥梁的顶升作业面提示 */
export const selectPlatformHint = createSelector(selectActiveBridgePiers, (piers) => {
  if (piers.length === 0) return '该桥梁尚未登记墩台';
  const lowest = piers.reduce((min, item) => Math.min(min, item.capElevation), Number.POSITIVE_INFINITY);
  return workPlatformHint(piers[0].capElevation, lowest);
});
