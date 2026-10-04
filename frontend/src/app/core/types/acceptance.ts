import type { RowMeta } from './persistence';

/** 验收分步 */
export type AcceptanceStage = 'lifted' | 'bearingPlaced' | 'beamLowered' | 'completed';

/** 验收结论 */
export type AcceptanceConclusion = 'pass' | 'fail';

export const ACCEPTANCE_STAGE_LABEL: Record<AcceptanceStage, string> = {
  lifted: '顶升到位',
  bearingPlaced: '支座就位',
  beamLowered: '落梁',
  completed: '竣工',
};

export const ACCEPTANCE_CONCLUSION_LABEL: Record<AcceptanceConclusion, string> = {
  pass: '合格',
  fail: '不合格',
};

export const ACCEPTANCE_STAGES: AcceptanceStage[] = ['lifted', 'bearingPlaced', 'beamLowered', 'completed'];
export const ACCEPTANCE_CONCLUSIONS: AcceptanceConclusion[] = ['pass', 'fail'];

/** 验收记录 */
export interface Acceptance extends RowMeta {
  id: string;
  /** 关联支座 */
  bearingId: string;
  /** 分步 */
  stage: AcceptanceStage;
  /** 结论 */
  conclusion: AcceptanceConclusion;
  /** 验收人 */
  acceptor: string;
  /** 验收时间 yyyy-MM-dd HH:mm */
  acceptedAt: string;
}

/** 验收表单草稿 */
export interface AcceptanceDraft {
  bearingId: string;
  stage: AcceptanceStage;
  conclusion: AcceptanceConclusion;
  acceptor: string;
  acceptedAt: string;
}

/** 验收视图：带支座与桥梁上下文 */
export interface AcceptanceView extends Acceptance {
  bearingSerial: string;
  bearingSpec: string;
  pierCode: string;
  bridgeId: string;
  bridgeName: string;
  /** 该支座已通过阶段数 */
  passedStages: number;
  /** 该支座是否已全部合格 */
  fullyAccepted: boolean;
  /** 未通过阶段提示 */
  failedStages: string[];
}

/** 阶段序号，用于判断验收顺序 */
export function stageOrder(stage: AcceptanceStage): number {
  return ACCEPTANCE_STAGES.indexOf(stage);
}

/** 校验验收顺序：必须先完成上一分步 */
export function stageOrderHint(
  stage: AcceptanceStage,
  passedStages: AcceptanceStage[],
): string {
  const index = stageOrder(stage);
  if (index === 0) return '首步验收：顶升到位后测量支座垫石标高与位移';
  const missing = ACCEPTANCE_STAGES.slice(0, index).filter((item) => !passedStages.includes(item));
  if (missing.length > 0) {
    return `建议先完成 ${missing.map((item) => ACCEPTANCE_STAGE_LABEL[item]).join('、')} 的验收`;
  }
  return '前序分步已完成，可按序签署本步验收';
}

/** 归档条件文案 */
export function archiveHint(fullyAcceptedCount: number, totalBearings: number): string {
  if (totalBearings === 0) return '尚未登记支座，无法归档';
  if (fullyAcceptedCount >= totalBearings) {
    return `全部 ${totalBearings} 个支座四步验收合格，可执行竣工归档`;
  }
  return `还差 ${totalBearings - fullyAcceptedCount} 个支座完成四步验收，暂不能归档`;
}

/** 竣工归档后的移交清单摘要 */
export function archiveSummary(input: {
  bridgeName: string;
  bearingCount: number;
  totalLiftMm: number;
  stepCount: number;
  readingCount: number;
}): string {
  return `${input.bridgeName}：${input.stepCount} 级顶升、累计 ${input.totalLiftMm} mm、${input.bearingCount} 个支座更换、${input.readingCount} 条测点读数已归档`;
}
