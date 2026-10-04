/**
 * NgRx Actions：支座台账与病害等级筛选、更换建议
 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { BearingDraft, DiseaseGrade } from '../types/bearing';
import type { BearingRow } from '../utils/db';

export const bearingActions = createActionGroup({
  source: 'bearing',
  events: {
    'Load': emptyProps(),
    'Load Success': props<{ bearings: BearingRow[] }>(),
    'Load Failure': props<{ error: string }>(),

    /** 等级多选筛选 */
    'Set Grade Filter': props<{ grades: DiseaseGrade[] }>(),

    'Create Bearing': props<{ draft: BearingDraft }>(),
    'Update Bearing': props<{ id: string; draft: BearingDraft }>(),
    'Delete Bearing': props<{ id: string }>(),

    /** 单条改等级 */
    'Set Grade': props<{ id: string; grade: DiseaseGrade }>(),
    /** 批量改等级 */
    'Bulk Set Grade': props<{ ids: string[]; grade: DiseaseGrade }>(),
    /** 批量升级一级 */
    'Bulk Escalate': props<{ ids: string[] }>(),

    'Write Failure': props<{ error: string }>(),
  },
});
