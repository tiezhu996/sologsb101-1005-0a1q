/**
 * NgRx Actions：离线作业包合并交接
 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type {
  MergeBatchRow,
  MergeConflictRow,
  MergeEvidenceRow,
  MergeJournalRow,
  MergePlan,
  OfflinePackage,
} from '../types/handoff';

export interface HandoffNotice {
  tone: 'success' | 'warn' | 'error';
  message: string;
}

export const handoffActions = createActionGroup({
  source: 'handoff',
  events: {
    'Load': emptyProps(),
    'Load Success': props<{
      conflicts: MergeConflictRow[];
      journals: MergeJournalRow[];
      batches: MergeBatchRow[];
      evidence: MergeEvidenceRow[];
    }>(),

    /** 交接区预览作业包（已通过结构校验、含基线） */
    'Preview Package': props<{ pkg: OfflinePackage }>(),
    'Preview Ready': props<{ plan: MergePlan | null }>(),

    /** 执行合并 / 重试失败批次 */
    'Apply Package': props<{ pkg: OfflinePackage }>(),
    'Retry Batch': props<{ batchId: string }>(),

    /** 待补证区：登记旧包缺基线 / 删除记录 */
    'Quarantine Package': props<{ rawText: string; reason: string; packageNo: string }>(),
    'Remove Evidence': props<{ id: string }>(),

    /** 差异裁定（保留主台账原值 / 采用离线值） */
    'Resolve Conflict': props<{ id: string; resolution: 'keepMaster' | 'takeOffline' }>(),

    /** 删除已成功批次记录（失败批次重试成功后清理） */
    'Remove Batch': props<{ id: string }>(),

    'Notice': props<{ notice: HandoffNotice }>(),
    'Clear Notice': emptyProps(),
  },
});
