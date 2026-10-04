import type { RowMeta } from './persistence';

/** 测点读数 */
export interface Reading extends RowMeta {
  id: string;
  /** 所属顶升步骤 */
  stepId: string;
  /** 测点编号，如 P1、J-2 */
  pointCode: string;
  /** 位移（mm） */
  displacementMm: number;
  /** 应力（MPa） */
  stressMpa: number;
  /** 记录时间 yyyy-MM-dd HH:mm */
  recordedAt: string;
  /** 记录人 */
  operator: string;
}

/** 测点读数表单草稿 */
export interface ReadingDraft {
  stepId: string;
  pointCode: string;
  displacementMm: number;
  stressMpa: number;
  recordedAt: string;
  operator: string;
}

/** 测点读数视图：带步骤上下文与偏差 */
export interface ReadingView extends Reading {
  stepSeq: number;
  bridgeId: string;
  bridgeName: string;
  syncRequirement: string;
  /** 同步骤内相对平均位移的偏差（mm） */
  deviationMm: number;
  /** 是否超过限位值 */
  overLimit: boolean;
  /** 应力是否超过关注值 */
  stressAlert: boolean;
}

/** 同一步骤的批量录入行 */
export interface ReadingBatchRow {
  pointCode: string;
  displacementMm: number;
  stressMpa: number;
}

/** 测点编号建议：按同步要求给出四角测点 */
export const POINT_CODES: string[] = ['P1', 'P2', 'P3', 'P4', 'J1', 'J2', 'J3', 'J4'];

/** 应力关注值（MPa）：超过即提示复核 */
export const STRESS_ALERT_MPA = 12;

/** 批量生成测点编号 */
export function suggestPointCodes(bearingCount: number): string[] {
  const count = Math.max(2, Math.min(POINT_CODES.length, bearingCount * 2));
  return POINT_CODES.slice(0, count);
}

/** 位移平均 */
export function meanDisplacement(rows: Array<{ displacementMm: number }>): number {
  if (rows.length === 0) return 0;
  return Number((rows.reduce((sum, item) => sum + item.displacementMm, 0) / rows.length).toFixed(3));
}

/** 同步偏差（mm）：最大位移 − 最小位移 */
export function syncDeviationMm(rows: Array<{ displacementMm: number }>): number {
  if (rows.length === 0) return 0;
  const values = rows.map((item) => item.displacementMm);
  return Number((Math.max(...values) - Math.min(...values)).toFixed(3));
}

/** 读数时间格式校验提示 */
export function readingDateHint(recordedAt: string, stepState: string): string {
  if (!recordedAt) return '请选择记录时间';
  if (stepState === 'idle') return '该步骤尚未开始顶升，录入读数前请先推进状态';
  return '记录时间应晚于步骤开始时间，并按 5~10 分钟间隔连续记录';
}
