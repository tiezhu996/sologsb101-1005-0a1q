import { createReducer, on } from '@ngrx/store';
import { bridgeActions } from './bridge.actions';
import { appDataFailed, appDataLoaded } from './app.actions';
import type { BearingRow, BridgeRow, PierRow } from '../utils/db';

export interface BridgeState {
  bridges: BridgeRow[];
  piers: PierRow[];
  bearings: BearingRow[];
  activeBridgeId: string | null;
  loading: boolean;
  error: string;
}

export const initialBridgeState: BridgeState = {
  bridges: [],
  piers: [],
  bearings: [],
  activeBridgeId: null,
  loading: false,
  error: '',
};

export const bridgeReducer = createReducer(
  initialBridgeState,
  on(bridgeActions.load, (state) => ({ ...state, loading: true, error: '' })),
  on(bridgeActions.loadSuccess, (state, { bridges, piers }) => ({
    ...state,
    loading: false,
    bridges,
    piers,
    activeBridgeId:
      state.activeBridgeId && bridges.some((item) => item.id === state.activeBridgeId)
        ? state.activeBridgeId
        : (bridges[0]?.id ?? null),
  })),
  on(bridgeActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(bridgeActions.selectBridge, (state, { bridgeId }) => ({ ...state, activeBridgeId: bridgeId })),
  on(bridgeActions.writeFailure, (state, { error }) => ({ ...state, error })),
  // 应用级数据加载（一次性把全部表分发到各 feature store）
  on(appDataLoaded, (state, { bridges, piers, bearings }) => ({
    ...state,
    loading: false,
    error: '',
    bridges,
    piers,
    bearings,
    activeBridgeId:
      state.activeBridgeId && bridges.some((item) => item.id === state.activeBridgeId)
        ? state.activeBridgeId
        : (bridges[0]?.id ?? null),
  })),
  on(appDataFailed, (state, { error }) => ({ ...state, loading: false, error })),
);
