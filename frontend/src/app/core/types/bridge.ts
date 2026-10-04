import type { RowMeta } from './persistence';

/** 桥梁类型 */
export type BridgeType = 'beam' | 'arch' | 'cable';

/** 公路等级 */
export type RoadClass = 'expressway' | 'first' | 'second' | 'third';

export const BRIDGE_TYPE_LABEL: Record<BridgeType, string> = {
  beam: '梁式',
  arch: '拱式',
  cable: '斜拉',
};

export const ROAD_CLASS_LABEL: Record<RoadClass, string> = {
  expressway: '高速公路',
  first: '一级公路',
  second: '二级公路',
  third: '三级公路',
};

export const BRIDGE_TYPES: BridgeType[] = ['beam', 'arch', 'cable'];
export const ROAD_CLASSES: RoadClass[] = ['expressway', 'first', 'second', 'third'];

/** 桥梁 */
export interface Bridge extends RowMeta {
  id: string;
  /** 桥梁名称 */
  name: string;
  /** 跨径组合，如 3×30m */
  spanCombo: string;
  /** 桥型 */
  bridgeType: BridgeType;
  /** 建成年 */
  builtYear: number;
  /** 公路等级 */
  roadClass: RoadClass;
  /** 是否已归档（全部支座验收合格后置位） */
  archived: boolean;
}

/** 桥梁表单草稿 */
export interface BridgeDraft {
  name: string;
  spanCombo: string;
  bridgeType: BridgeType;
  builtYear: number;
  roadClass: RoadClass;
}

/** 桥梁视图：卡片回显墩台数与待换支座数 */
export interface BridgeView extends Bridge {
  pierCount: number;
  bearingCount: number;
  /** 待更换（较重 + 严重）支座数 */
  pendingBearingCount: number;
  /** 严重级支座数 */
  severeBearingCount: number;
  /** 验收完成率（%） */
  acceptanceRate: number;
  /** 累计顶升量（mm） */
  totalLiftMm: number;
}

/** 解析跨径组合的孔数与单孔跨径（如 3×30m → 3 孔 / 30m） */
export function parseSpanCombo(spanCombo: string): { spans: number; spanM: number } {
  const matched = /(\d+)\s*[×x*]\s*(\d+(?:\.\d+)?)/.exec(spanCombo);
  if (!matched) return { spans: 1, spanM: 0 };
  return { spans: Number(matched[1]), spanM: Number(matched[2]) };
}

/** 桥梁总长（m）：孔数 × 单孔跨径 */
export function totalLengthM(spanCombo: string): number {
  const { spans, spanM } = parseSpanCombo(spanCombo);
  return Number((spans * spanM).toFixed(1));
}

/** 桥梁技术状况等级（按建成年与桥型给出养护关注级） */
export function bridgeAgeLevel(builtYear: number, now: Date = new Date()): '一类' | '二类' | '三类' {
  const age = now.getFullYear() - builtYear;
  if (age <= 10) return '一类';
  if (age <= 25) return '二类';
  return '三类';
}

/** 桥型对应的顶升关注点 */
export function bridgeLiftNote(bridgeType: BridgeType): string {
  if (bridgeType === 'arch') return '拱式桥顶升需同步控制拱脚位移，避免拱轴线偏移';
  if (bridgeType === 'cable') return '斜拉桥顶升须与索力监测联动，分级顶升量不宜超过 5mm/级';
  return '梁式桥顶升按墩台逐跨进行，注意相邻跨支座脱空';
}
