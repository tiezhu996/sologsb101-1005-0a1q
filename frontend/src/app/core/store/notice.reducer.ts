/**
 * 应用级提示状态：承接所有写操作的成功 / 失败提示。
 * 页面通过 select 读取，用于顶部提示与错误展示。
 */
import { createFeatureSelector, createSelector } from '@ngrx/store';
import { createReducer, on } from '@ngrx/store';
import { appDataFailed, writeFailed, writeSucceeded } from './app.actions';

export interface NoticeState {
  /** 最近一次成功提示 */
  success: string;
  /** 最近一次失败提示 */
  error: string;
}

export const initialNoticeState: NoticeState = {
  success: '',
  error: '',
};

export const noticeReducer = createReducer(
  initialNoticeState,
  on(writeSucceeded, (state, { message }) => ({ ...state, success: message, error: '' })),
  on(writeFailed, (state, { message }) => ({ ...state, error: message, success: '' })),
  on(appDataFailed, (state, { error }) => ({ ...state, error })),
);

export const selectNoticeState = createFeatureSelector<NoticeState>('notice');
export const selectSuccessNotice = createSelector(selectNoticeState, (state) => state.success);
export const selectErrorNotice = createSelector(selectNoticeState, (state) => state.error);
