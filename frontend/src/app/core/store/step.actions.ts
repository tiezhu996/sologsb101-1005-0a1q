/**
 * NgRx Actions：顶升步骤顺序、累计顶升量与同步约束
 */
import { createActionGroup, emptyProps, props } from '@ngrx/store';
import type { StepDraft, StepState } from '../types/step';
import type { ReadingRow, StepRow } from '../utils/db';

export const stepActions = createActionGroup({
  source: 'step',
  events: {
    'Load': emptyProps(),
    'Load Success': props<{ steps: StepRow[]; readings: ReadingRow[] }>(),
    'Load Failure': props<{ error: string }>(),

    'Select Bridge': props<{ bridgeId: string }>(),

    'Create Step': props<{ draft: StepDraft }>(),
    'Update Step': props<{ id: string; draft: StepDraft }>(),
    'Delete Step': props<{ id: string }>(),

    /** 调整步骤顺序（传入期望的顺序 id 列表） */
    'Reorder Steps': props<{ orderedIds: string[] }>(),

    /** 推进步骤状态：未开始 → 顶升中 → 已到位 */
    'Advance State': props<{ id: string; next: StepState }>(),

    'Write Failure': props<{ error: string }>(),
  },
});
