import type { RowMeta } from './persistence';

/** 墩台类型 */
export type PierType = 'abutment' | 'pier' | 'transition';

export const PIER_TYPE_LABEL: Record<PierType, string> = {
  abutment: '桥台',
  pier: '桥墩',
  transition: '过渡墩',
};

export const PIER_TYPES: PierType[] = ['abutment', 'pier', 'transition'];

/** 墩台 */
export interface Pier extends RowMeta {
  id: string;
  /** 所属桥梁 */
  bridgeId: string;
  /** 墩台编号，如 0#台、1#墩 */
  code: string;
  /** 盖梁标高（m） */
  capElevation: number;
  /** 墩台类型 */
  type: PierType;
  /** 支座数 */
  bearingCount: number;
}

/** 墩台表单草稿 */
export interface PierDraft {
  bridgeId: string;
  code: string;
  capElevation: number;
  type: PierType;
  bearingCount: number;
}

/** 墩台视图：带桥梁上下文与支座统计 */
export interface PierView extends Pier {
  bridgeName: string;
  /** 实际登记支座数（以支座表为准） */
  registeredBearingCount: number;
  /** 待更换支座数 */
  pendingBearingCount: number;
  /** 已建顶升步骤数 */
  stepCount: number;
}

/** 墩台编号排序权重：0#台 → 1#墩 → … */
export function pierOrder(code: string): number {
  const matched = /(\d+)/.exec(code);
  return matched ? Number(matched[1]) : 999;
}

/** 盖梁标高排序 */
export function sortByElevation<T extends { capElevation: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.capElevation - b.capElevation);
}

/** 支座数校验提示 */
export function bearingCountHint(bearingCount: number, registered: number): string {
  if (registered === bearingCount) return '支座登记数与墩台设计数量一致';
  if (registered < bearingCount) return `还差 ${bearingCount - registered} 个支座未登记`;
  return `已超出设计数量 ${registered - bearingCount} 个，请核对`;
}

/** 顶升作业面高度提示：盖梁标高的高差决定支撑架高度 */
export function workPlatformHint(capElevation: number, referenceElevation = 0): string {
  const diff = Number((capElevation - referenceElevation).toFixed(2));
  if (diff <= 0) return '无需搭设顶升支架（地面作业面）';
  return `需搭设约 ${diff.toFixed(2)} m 高支撑架，注意基础承载力`;
}
