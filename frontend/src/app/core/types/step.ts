import type { RowMeta } from './persistence';

/** 同步要求 */
export type SyncRequirement = 'sync' | 'cross' | 'single';

/** 步骤状态 */
export type StepState = 'idle' | 'lifting' | 'arrived';

export const SYNC_REQUIREMENT_LABEL: Record<SyncRequirement, string> = {
  sync: '同步',
  cross: '交叉',
  single: '单点',
};

export const STEP_STATE_LABEL: Record<StepState, string> = {
  idle: '未开始',
  lifting: '顶升中',
  arrived: '已到位',
};

export const SYNC_REQUIREMENTS: SyncRequirement[] = ['sync', 'cross', 'single'];
export const STEP_STATES: StepState[] = ['idle', 'lifting', 'arrived'];

/** 步骤状态流转 */
export const STEP_STATE_FLOW: Record<StepState, StepState[]> = {
  idle: ['lifting'],
  lifting: ['arrived'],
  arrived: [],
};

/** 顶升步骤 */
export interface Step extends RowMeta {
  id: string;
  /** 所属桥梁 */
  bridgeId: string;
  /** 序（从 1 开始，可调序） */
  seq: number;
  /** 目标顶升量（mm） */
  targetLiftMm: number;
  /** 同步要求 */
  syncRequirement: SyncRequirement;
  /** 限位值（mm） */
  limitMm: number;
  /** 负责人 */
  leader: string;
  /** 状态 */
  state: StepState;
}

/** 顶升步骤表单草稿 */
export interface StepDraft {
  bridgeId: string;
  targetLiftMm: number;
  syncRequirement: SyncRequirement;
  limitMm: number;
  leader: string;
}

/** 顶升步骤视图：含累计量与校验结论 */
export interface StepView extends Step {
  bridgeName: string;
  /** 本步及之前步骤的累计目标顶升量（mm） */
  cumulativeLiftMm: number;
  /** 累计顶升量与限位值的关系 */
  overLimit: boolean;
  /** 该步骤的测点读数条数 */
  readingCount: number;
  /** 同步偏差（mm），无读数为 null */
  syncDeviationMm: number | null;
  /** 校验结论文案 */
  validation: string;
}

/** 步骤排序 */
export function sortSteps<T extends { seq: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.seq - b.seq);
}

/** 重排序号：按给定 id 顺序重编号，返回新行 */
export function resequenceSteps<T extends { id: string; seq: number }>(rows: T[], orderedIds: string[]): T[] {
  return rows.map((row) => {
    const index = orderedIds.indexOf(row.id);
    return index >= 0 ? { ...row, seq: index + 1 } : row;
  });
}

/** 单级顶升量安全上限（mm）：超过 5mm 需分级 */
export const MAX_LIFT_PER_STEP_MM = 5;

/** 顶升量校验：返回提示文案 */
export function liftStepHint(targetLiftMm: number, limitMm: number): string {
  if (targetLiftMm > limitMm) return '目标顶升量已超过限位值，必须拆分为多级顶升';
  if (targetLiftMm > MAX_LIFT_PER_STEP_MM) {
    return `单级顶升量超过 ${MAX_LIFT_PER_STEP_MM} mm 建议值，宜分级顶升并加密监测`;
  }
  return '单级顶升量在建议范围内，可按同步要求执行';
}

/** 累计顶升量校验 */
export function cumulativeHint(cumulativeLiftMm: number, limitMm: number): string {
  if (cumulativeLiftMm > limitMm) return '累计顶升量超过限位值，立即停止并复核支撑体系';
  if (cumulativeLiftMm >= limitMm * 0.8) return '累计顶升量接近限位值，需连续监测位移';
  return '累计顶升量在限位范围内';
}

/** 同步要求对应的测点布置建议 */
export function syncLayoutHint(requirement: SyncRequirement): string {
  if (requirement === 'sync') return '同步顶升：四角同步，各测点偏差宜控制在 1.5mm 内';
  if (requirement === 'cross') return '交叉顶升：对角交替加力，注意换向时位移回弹';
  return '单点顶升：仅单点受力，须限制单级顶升量并实时观察相邻支座';
}
