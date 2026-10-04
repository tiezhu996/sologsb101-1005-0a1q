import { createReducer, on } from '@ngrx/store';
import { handoffActions, type HandoffNotice } from './handoff.actions';
import type {
  MergeBatchRow,
  MergeConflictRow,
  MergeEvidenceRow,
  MergeJournalRow,
  MergePlan,
} from '../types/handoff';

export interface HandoffState {
  conflicts: MergeConflictRow[];
  journals: MergeJournalRow[];
  batches: MergeBatchRow[];
  evidence: MergeEvidenceRow[];
  /** 交接区当前预览的合并计划（不落库） */
  previewPlan: MergePlan | null;
  loading: boolean;
  notice: HandoffNotice | null;
}

export const initialHandoffState: HandoffState = {
  conflicts: [],
  journals: [],
  batches: [],
  evidence: [],
  previewPlan: null,
  loading: false,
  notice: null,
};

export const handoffReducer = createReducer(
  initialHandoffState,
  on(handoffActions.load, (state) => ({ ...state, loading: true })),
  on(handoffActions.loadSuccess, (state, { conflicts, journals, batches, evidence }) => ({
    ...state,
    loading: false,
    conflicts,
    journals,
    batches,
    evidence,
  })),
  on(handoffActions.previewReady, (state, { plan }) => ({ ...state, previewPlan: plan })),
  on(handoffActions.notice, (state, { notice }) => ({ ...state, notice })),
  on(handoffActions.clearNotice, (state) => ({ ...state, notice: null })),
);
