import { createReducer, on } from '@ngrx/store';
import { stepActions } from './step.actions';
import { appDataFailed, appDataLoaded } from './app.actions';
import type { ReadingRow, StepRow } from '../utils/db';

export interface StepStateSlice {
  steps: StepRow[];
  readings: ReadingRow[];
  activeBridgeId: string | null;
  loading: boolean;
  error: string;
}

export const initialStepState: StepStateSlice = {
  steps: [],
  readings: [],
  activeBridgeId: null,
  loading: false,
  error: '',
};

export const stepReducer = createReducer(
  initialStepState,
  on(stepActions.load, (state) => ({ ...state, loading: true, error: '' })),
  on(stepActions.loadSuccess, (state, { steps, readings }) => ({
    ...state,
    loading: false,
    steps: [...steps].sort((a, b) => a.seq - b.seq),
    readings,
  })),
  on(stepActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(stepActions.selectBridge, (state, { bridgeId }) => ({ ...state, activeBridgeId: bridgeId })),
  on(stepActions.writeFailure, (state, { error }) => ({ ...state, error })),
  on(appDataLoaded, (state, { steps, readings }) => ({
    ...state,
    loading: false,
    error: '',
    steps: [...steps].sort((a, b) => a.seq - b.seq),
    readings,
  })),
  on(appDataFailed, (state, { error }) => ({ ...state, loading: false, error })),
);
