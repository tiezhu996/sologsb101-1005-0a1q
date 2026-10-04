/**
 * NgRx Actions：分步验收结论与归档状态
 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { AcceptanceDraft } from '../types/acceptance';
import type { AcceptanceRow } from '../utils/db';

export const acceptanceActions = createActionGroup({
  source: 'acceptance',
  events: {
    'Load': emptyProps(),
    'Load Success': props<{ acceptances: AcceptanceRow[] }>(),
    'Load Failure': props<{ error: string }>(),

    /** 选择用于批量签署的支座 */
    'Select Bearings': props<{ bearingIds: string[] }>(),

    'Create Acceptance': props<{ draft: AcceptanceDraft }>(),
    'Update Acceptance': props<{ id: string; draft: AcceptanceDraft }>(),
    'Delete Acceptance': props<{ id: string }>(),

    /** 批量分步签署（同一分步、同一结论） */
    'Bulk Sign': props<{ bearingIds: string[]; draft: Omit<AcceptanceDraft, 'bearingId'> }>(),

    /** 归档 / 撤销归档（由桥梁 store 承接桥梁 archived 字段） */
    'Archive Bridge': props<{ bridgeId: string; archived: boolean; summary: string }>(),
    'Archive Result': props<{ summary: string }>(),

    'Write Failure': props<{ error: string }>(),
  },
});
