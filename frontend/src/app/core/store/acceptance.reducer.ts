import { createReducer, on } from '@ngrx/store';
import { acceptanceActions } from './acceptance.actions';
import { appDataFailed, appDataLoaded } from './app.actions';
import type { AcceptanceRow } from '../utils/db';

export interface AcceptanceState {
  acceptances: AcceptanceRow[];
  selectedBearingIds: string[];
  lastArchiveSummary: string;
  loading: boolean;
  error: string;
}

export const initialAcceptanceState: AcceptanceState = {
  acceptances: [],
  selectedBearingIds: [],
  lastArchiveSummary: '',
  loading: false,
  error: '',
};

export const acceptanceReducer = createReducer(
  initialAcceptanceState,
  on(acceptanceActions.load, (state) => ({ ...state, loading: true, error: '' })),
  on(acceptanceActions.loadSuccess, (state, { acceptances }) => ({ ...state, loading: false, acceptances })),
  on(acceptanceActions.loadFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(acceptanceActions.selectBearings, (state, { bearingIds }) => ({ ...state, selectedBearingIds: bearingIds })),
  on(acceptanceActions.archiveResult, (state, { summary }) => ({ ...state, lastArchiveSummary: summary })),
  on(acceptanceActions.writeFailure, (state, { error }) => ({ ...state, error })),
  on(appDataLoaded, (state, { acceptances }) => ({ ...state, loading: false, error: '', acceptances })),
  on(appDataFailed, (state, { error }) => ({ ...state, loading: false, error })),
);
