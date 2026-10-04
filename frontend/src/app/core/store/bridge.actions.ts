/**
 * NgRx Actions：桥梁与墩台台账
 * 页面通过 dispatch 触发加载与写操作，写操作成功后由 ChangeBusService 广播重载。
 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { BridgeDraft } from '../types/bridge';
import type { PierDraft } from '../types/pier';
import type { BridgeRow, PierRow } from '../utils/db';

export const bridgeActions = createActionGroup({
  source: 'bridge',
  events: {
    /** 加载桥梁与墩台及派生统计所需的关联数据 */
    'Load': emptyProps(),
    'Load Success': props<{ bridges: BridgeRow[]; piers: PierRow[] }>(),
    'Load Failure': props<{ error: string }>(),

    /** 选择当前桥梁 */
    'Select Bridge': props<{ bridgeId: string }>(),

    /** 新建 / 更新 / 删除桥梁 */
    'Create Bridge': props<{ draft: BridgeDraft }>(),
    'Update Bridge': props<{ id: string; draft: BridgeDraft }>(),
    'Delete Bridge': props<{ id: string }>(),

    /** 新建 / 更新 / 删除墩台 */
    'Create Pier': props<{ draft: PierDraft }>(),
    'Update Pier': props<{ id: string; draft: PierDraft }>(),
    'Delete Pier': props<{ id: string }>(),

    /** 归档桥梁（全部支座验收合格后调用） */
    'Archive Bridge': props<{ id: string; archived: boolean }>(),

    /** 写操作失败 */
    'Write Failure': props<{ error: string }>(),
  },
});
