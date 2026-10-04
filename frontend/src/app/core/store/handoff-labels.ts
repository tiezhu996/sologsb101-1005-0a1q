/**
 * 离线合并交接的字段标签与取值展示：差异清单、待补证区、交接页统一使用。
 */
import { DISEASE_GRADE_LABEL, type DiseaseGrade } from '../types/bearing';
import { SYNC_REQUIREMENT_LABEL, type SyncRequirement } from '../types/step';
import type { MergeEntityType, MergeField, StepParamField } from '../types/handoff';

/** 步骤参与三方合并的参数字段（固定顺序，差异清单按此排列） */
export const STEP_PARAM_FIELDS: StepParamField[] = [
  'targetLiftMm',
  'limitMm',
  'syncRequirement',
  'leader',
];

export const MERGE_FIELD_LABEL: Record<MergeField, string> = {
  diseaseGrade: '病害等级',
  targetLiftMm: '目标顶升量',
  limitMm: '限位值',
  syncRequirement: '同步要求',
  leader: '负责人',
};

export const MERGE_ENTITY_LABEL: Record<MergeEntityType, string> = {
  bearing: '支座',
  step: '顶升步骤',
};

/** 差异值转展示文案（枚举映射为中文，数值带单位） */
export function formatMergeFieldValue(field: MergeField, value: string | number): string {
  if (field === 'diseaseGrade') {
    return DISEASE_GRADE_LABEL[value as DiseaseGrade] ?? String(value);
  }
  if (field === 'syncRequirement') {
    return SYNC_REQUIREMENT_LABEL[value as SyncRequirement] ?? String(value);
  }
  if (field === 'targetLiftMm' || field === 'limitMm') return `${value} mm`;
  return String(value);
}

/** 离线步骤变化里取某个字段的值（供裁定采用离线值时使用） */
export function stepFieldRaw(
  change: {
    targetLiftMm: number;
    limitMm: number;
    syncRequirement: SyncRequirement;
    leader: string;
  },
  field: StepParamField,
): string | number {
  return change[field];
}
