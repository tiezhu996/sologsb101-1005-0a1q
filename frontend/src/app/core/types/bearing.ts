import type { RowMeta } from './persistence';

/** 支座类型 */
export type BearingType = 'plate' | 'pot' | 'spherical';

/** 病害等级 */
export type DiseaseGrade = 'intact' | 'slight' | 'moderate' | 'severe';

export const BEARING_TYPE_LABEL: Record<BearingType, string> = {
  plate: '板式',
  pot: '盆式',
  spherical: '球型',
};

export const DISEASE_GRADE_LABEL: Record<DiseaseGrade, string> = {
  intact: '完好',
  slight: '轻微',
  moderate: '较重',
  severe: '严重',
};

export const BEARING_TYPES: BearingType[] = ['plate', 'pot', 'spherical'];
export const DISEASE_GRADES: DiseaseGrade[] = ['intact', 'slight', 'moderate', 'severe'];

/** 支座 */
export interface Bearing extends RowMeta {
  id: string;
  /** 所属墩台 */
  pierId: string;
  /** 序号，如 1、左-2 */
  serial: string;
  /** 支座类型 */
  type: BearingType;
  /** 规格，如 GJZ 300×400 */
  spec: string;
  /** 病害等级 */
  diseaseGrade: DiseaseGrade;
  /** 病害描述 */
  diseaseNote: string;
}

/** 支座表单草稿 */
export interface BearingDraft {
  pierId: string;
  serial: string;
  type: BearingType;
  spec: string;
  diseaseGrade: DiseaseGrade;
  diseaseNote: string;
}

/** 支座视图：带墩台与桥梁上下文 */
export interface BearingView extends Bearing {
  pierCode: string;
  bridgeId: string;
  bridgeName: string;
  /** 是否需要更换 */
  needReplacement: boolean;
  /** 该支座的验收进度（已通过阶段数 / 4） */
  acceptanceStages: number;
  /** 是否已全部验收合格 */
  accepted: boolean;
}

/** 等级权重：严重 > 较重 > 轻微 > 完好 */
export const DISEASE_WEIGHT: Record<DiseaseGrade, number> = {
  intact: 1,
  slight: 2,
  moderate: 3,
  severe: 4,
};

/** 等级配色（Material 语义） */
export const DISEASE_COLOR: Record<DiseaseGrade, string> = {
  intact: 'primary',
  slight: 'accent',
  moderate: 'warn',
  severe: 'warn',
};

/** 是否需要更换：较重及以上 */
export function needReplacement(grade: DiseaseGrade): boolean {
  return grade === 'moderate' || grade === 'severe';
}

/** 更换建议文案 */
export function replacementAdvice(grade: DiseaseGrade): string {
  if (grade === 'severe') return '立即安排更换，纳入本批次顶升作业并做同步限位';
  if (grade === 'moderate') return '建议本年度更换，顶升前复测支座位移与转角';
  if (grade === 'slight') return '暂不更换，加强观测并在下一年度检查中复评';
  return '状态完好，正常巡检即可';
}

/** 升级一级病害等级 */
export function escalateGrade(grade: DiseaseGrade): DiseaseGrade {
  if (grade === 'intact') return 'slight';
  if (grade === 'slight') return 'moderate';
  if (grade === 'moderate') return 'severe';
  return 'severe';
}

/** 规格解析：GJZ 300×400 → 平面尺寸提示 */
export function specSizeHint(spec: string): string {
  const matched = /(\d+)\s*[×x*]\s*(\d+)/.exec(spec);
  if (!matched) return '规格未含平面尺寸，请补充型号与尺寸';
  const width = Number(matched[1]);
  const depth = Number(matched[2]);
  return `平面尺寸 ${width}×${depth} mm，安装前核对垫石平整度与标高`;
}

/** 分级统计 */
export function countByGrade<T extends { diseaseGrade: DiseaseGrade }>(rows: T[]): Record<DiseaseGrade, number> {
  return {
    intact: rows.filter((item) => item.diseaseGrade === 'intact').length,
    slight: rows.filter((item) => item.diseaseGrade === 'slight').length,
    moderate: rows.filter((item) => item.diseaseGrade === 'moderate').length,
    severe: rows.filter((item) => item.diseaseGrade === 'severe').length,
  };
}
