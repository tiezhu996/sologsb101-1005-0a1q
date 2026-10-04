import { createReducer, on } from '@ngrx/store';
import { mergeActions } from './merge.actions';
import { emptyMergeLedger, type MergeLedger } from '../utils/db';

export interface MergeState {
  ledger: MergeLedger;
  loaded: boolean;
  loading: boolean;
  /** 最近一次冻结出包（供页面即时下载） */
  lastFrozenPackageNo: string;
  /** 最近一次交接结果文案（成功 / 失败 / 去重 / 待补证） */
  lastHandoffMessage: string;
  lastHandoffStatus: '' | 'merged' | 'duplicate' | 'quarantined' | 'failed';
  error: string;
}

export const initialMergeState: MergeState = {
  ledger: emptyMergeLedger(),
  loaded: false,
  loading: false,
  lastFrozenPackageNo: '',
  lastHandoffMessage: '',
  lastHandoffStatus: '',
  error: '',
};

export const mergeReducer = createReducer(
  initialMergeState,
  on(mergeActions.loadLedger, (state) => ({ ...state, loading: true, error: '' })),
  on(mergeActions.loadLedgerSuccess, (state, { ledger }) => ({
    ...state,
    ledger,
    loaded: true,
    loading: false,
    error: '',
  })),
  on(mergeActions.loadLedgerFailure, (state, { error }) => ({ ...state, loading: false, error })),
  on(mergeActions.freezePackageSuccess, (state, { pkg }) => ({
    ...state,
    lastFrozenPackageNo: pkg.packageNo,
  })),
  on(mergeActions.handoffResult, (state, { result }) => ({
    ...state,
    lastHandoffMessage: result.message,
    lastHandoffStatus: result.status,
  })),
);
