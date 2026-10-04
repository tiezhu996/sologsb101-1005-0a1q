/**
 * 应用级动作与统一提示上下文：
 * - appInit / appDataLoaded / appDataFailed：启动与全量数据分发
 * - writeSucceeded / writeFailed：所有写操作的统一结果动作，便于顶部提示
 */
import { createAction, props } from '@ngrx/store';
import type {
  AcceptanceRow,
  BearingRow,
  BridgeRow,
  PierRow,
  ReadingRow,
  StepRow,
} from '../utils/db';

export const appInit = createAction('[app] init');

export const appDataLoaded = createAction(
  '[app] data loaded',
  props<{
    bridges: BridgeRow[];
    piers: PierRow[];
    bearings: BearingRow[];
    steps: StepRow[];
    readings: ReadingRow[];
    acceptances: AcceptanceRow[];
  }>(),
);

export const appDataFailed = createAction('[app] data failed', props<{ error: string }>());

/** 统一写入结果提示（成功 / 失败），供顶部提示区展示 */
export const writeSucceeded = createAction('[app] write succeeded', props<{ message: string }>());
export const writeFailed = createAction('[app] write failed', props<{ message: string }>());
