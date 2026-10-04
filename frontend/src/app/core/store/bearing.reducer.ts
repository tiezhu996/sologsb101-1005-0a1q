import { createReducer, on } from '@ngrx/store';
import { bearingActions } from './bearing.actions';
import { appDataFailed, appDataLoaded } from './app.actions';
import type { BearingRow } from '../utils/db';
import type { DiseaseGrade } from '../types/bearing';

export interface BearingState {
  bearings: BearingRow[];
  gradeFilter: DiseaseGrade[];
  loading: boolean;
  error: string;
}

export const initialBearingState: BearingState = {
  bearings: [],
  gradeFilter: [],
  loading: false,
  error: '',
};

export const bearingReducer = createReducer(
  initialBearingState,
  on(bearingActions.load, (state) => ({ ...state, loading: true, error: '' })),
  on(bearingActions.loadSuccess, (state, { bearings }) => ({ ...state, loading: false, bearings })),
  on(bearingActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(bearingActions.setGradeFilter, (state, { grades }) => ({ ...state, gradeFilter: grades })),
  on(bearingActions.writeFailure, (state, { error }) => ({ ...state, error })),
  on(appDataLoaded, (state, { bearings }) => ({ ...state, loading: false, error: '', bearings })),
  on(appDataFailed, (state, { error }) => ({ ...state, loading: false, error })),
);
