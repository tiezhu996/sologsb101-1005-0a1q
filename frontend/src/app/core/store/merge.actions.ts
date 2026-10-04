/**
 * NgRx Actions：离线作业包合并交接
 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { HandoffResult } from '../services/merge-handoff.service';
import type { FreezeOptions } from '../services/merge-handoff.service';
import type { MergeLedger } from '../utils/db';
import type { OfflinePackage } from '../types/merge';

export const mergeActions = createActionGroup({
  source: 'merge',
  events: {
    /** 拉取合并交接台账 */
    'Load Ledger': emptyProps(),
    'Load Ledger Success': props<{ ledger: MergeLedger }>(),
    'Load Ledger Failure': props<{ error: string }>(),

    /** 出工冻结基线并下载作业包 */
    'Freeze Package': props<{ options: FreezeOptions }>(),
    'Freeze Package Success': props<{ pkg: OfflinePackage }>(),

    /** 回站交接（文件文本） */
    'Handoff Text': props<{ text: string }>(),
    /** 直接交接已解析作业包（如测试构造） */
    'Handoff Parsed': props<{ pkg: OfflinePackage }>(),
    'Handoff Result': props<{ result: HandoffResult }>(),

    /** 重试未完成批次 */
    'Retry Pending': props<{ pendingId: string }>(),
    /** 放弃未完成批次 */
    'Discard Pending': props<{ pendingId: string }>(),
    /** 清理待补证条目 */
    'Dismiss Quarantine': props<{ id: string }>(),
    /** 确认差异（解除验收冻结） */
    'Acknowledge Difference': props<{ differenceId: string }>(),

    /** 台账已变更，需重新拉取 */
    'Ledger Changed': emptyProps(),
  },
});
