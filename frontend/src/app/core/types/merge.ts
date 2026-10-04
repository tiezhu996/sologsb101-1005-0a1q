/**
 * 离线作业包与回站合并交接的领域模型。
 *
 * 背景：检修组离线作业前从主台账冻结一份基线作业包，离线期间改动支座病害等级、
 * 顶升步骤参数并新增测点读数；回站时按包号交接合并：
 * - 作业包冻结基线，按包号去重（同一包号只处理一次，重复交接直接忽略）
 * - 只接收相对基线的「单边变化」：基线 → 离线 改了、基线 → 主台账 没改，才覆盖
 * - 两边都改过（基线 → 离线、基线 → 主台账 均变化）保留主台账原值并登记差异
 * - 新增读数按「步骤 + 测点」唯一键追加，已存在则跳过
 * - 旧包缺少冻结基线时进入待补证区，不能猜着覆盖
 */
import type { Bearing, DiseaseGrade } from './bearing';
import type { Step, SyncRequirement, StepState } from './step';
import type { Reading } from './reading';

/** 作业包格式版本（与基线结构绑定） */
export const OFFLINE_PACKAGE_KIND = 'gbbridgebear-offline-package';
export const OFFLINE_PACKAGE_VERSION = 1;

/** 基线冻结快照：仅包含本包作业范围内会被改动 / 追加的数据 */
export interface MergeBaseline {
  /** 冻结时刻 ISO 时间 */
  frozenAt: string;
  /** 冻结时刻主台账内的支座（病害等级三方比对依据） */
  bearings: Bearing[];
  /** 冻结时刻主台账内的顶升步骤（参数三方比对依据） */
  steps: Step[];
}

/** 离线期间相对基线产生的变化 */
export interface OfflineChanges {
  /** 离线改动过的支座（按 id 与基线对齐，未带 diseaseGrade 变化视为未改） */
  bearings: Bearing[];
  /** 离线改动 / 新增的顶升步骤（按 id 与基线对齐） */
  steps: Step[];
  /** 离线新增的测点读数（按 步骤+测点 唯一键追加） */
  readings: Reading[];
}

/**
 * 离线作业包：检修组带回站的交接文件。
 * 缺少 baseline 的旧包一律进入待补证区，禁止猜测覆盖。
 */
export interface OfflinePackage {
  kind: typeof OFFLINE_PACKAGE_KIND;
  packageVersion: number;
  /** 包号：同一作业的唯一凭证，回站按包号去重 */
  packageNo: string;
  /** 作业桥梁 */
  bridgeId: string;
  /** 作业组 / 负责人 */
  crew: string;
  /** 出包（冻结基线）时刻 ISO */
  packedAt: string;
  /** 回站交接时刻（离线端可留空，由站端补） */
  handedAt?: string;
  /** 冻结基线；旧包可能缺失 → 待补证 */
  baseline?: MergeBaseline;
  /** 离线单边变化 */
  changes: OfflineChanges;
}

/* ============================== 差异登记 ============================== */

/** 差异涉及的实体类别 */
export type MergeEntityKind = 'bearing' | 'step' | 'reading';

/** 差异严重级别：diseaseGrade 两边都改会冻结该支座的验收签署 */
export type MergeConflictSeverity = 'blocking' | 'warning';

/**
 * 一条合并差异。
 * - 双边冲突（bothChanged）：主台账原值已保留，仅记录差异，blocking 级别未确认前不得签署
 * - 无法核实（unverifiable）：离线新增数据在基线与主台账中找不到父实体
 * - 已应用（applied）：单边变化已按规则接入主台账，保留痕迹供四页读取
 * - 已跳过（skipped）：读数唯一键已存在 / 包号重复等
 */
export type MergeDifferenceType = 'bothChanged' | 'unverifiable' | 'applied' | 'skipped';

export interface MergeDifference {
  /** 差异唯一号（报告号 + 实体 + 字段 + 实体 id 派生） */
  id: string;
  /** 来源包号 */
  packageNo: string;
  kind: MergeEntityKind;
  /** 实体 id（读数为派生键） */
  entityId: string;
  /** 人类可读定位：桥梁 / 墩台 / 支座序号 / 步骤序 */
  location: string;
  /** 冲突字段（读数类固定 pointCode） */
  field: string;
  fieldLabel: string;
  /** 主台账原值（两边都改时强制保留） */
  masterValue: string;
  /** 离线带回值（未采纳） */
  offlineValue: string;
  /** 基线值 */
  baselineValue: string;
  type: MergeDifferenceType;
  severity: MergeConflictSeverity;
  detail: string;
  /** blocking 差异是否已由技术员确认处理；确认后解除验收冻结 */
  acknowledged: boolean;
  createdAt: string;
}

/* ============================== 合并报告 ============================== */

export type MergeReportStatus = 'merged' | 'failed' | 'quarantined';

/** 一次成功交接的合并报告（失败则不产生报告，进入未完成批次） */
export interface MergeReport {
  id: string;
  packageNo: string;
  bridgeId: string;
  bridgeName: string;
  crew: string;
  mergedAt: string;
  status: MergeReportStatus;
  /** 接入的单边变化数 */
  appliedBearingCount: number;
  appliedStepCount: number;
  /** 追加的新读数条数 */
  appendedReadingCount: number;
  /** 跳过的重复读数条数（步骤+测点唯一键已存在） */
  skippedReadingCount: number;
  /** 包内重复读数条数（同包同键，按末条为准） */
  duplicateInPackageCount: number;
  /** 新增支座 / 步骤数 */
  addedBearingCount: number;
  addedStepCount: number;
  /** 本次产生 / 追加登记的差异 */
  differences: MergeDifference[];
}

/* ============================== 待补证 / 待重试 ============================== */

/**
 * 待补证区条目：旧包缺基线（或基线结构损坏），无法做三方比对，
 * 只能原样留档等待检修组补交含基线的新包，禁止猜着覆盖。
 */
export interface QuarantinedPackage {
  id: string;
  packageNo: string;
  bridgeId: string;
  crew: string;
  receivedAt: string;
  reason: string;
  /** 原始作业包留档（供补交核对） */
  pkg: OfflinePackage;
}

/**
 * 未完成批次：写入主台账失败后，主台账已恢复原状；
 * 作业包、失败原因与本次规划出的差异保留在此，供下次「重试交接」。
 */
export interface PendingMerge {
  id: string;
  packageNo: string;
  bridgeId: string;
  crew: string;
  receivedAt: string;
  lastError: string;
  attempts: number;
  pkg: OfflinePackage;
  /** 失败时已规划但未落库的差异（随批次保留，重试成功后随报告正式登记） */
  differences: MergeDifference[];
}

/* ============================== 三方比对字段定义 ============================== */

/** 步骤参与三方比对的参数字段（seq 由站端统一编排，不接收离线序） */
export const STEP_MERGE_FIELDS = ['targetLiftMm', 'syncRequirement', 'limitMm', 'leader'] as const;
export type StepMergeField = (typeof STEP_MERGE_FIELDS)[number];

export const STEP_FIELD_LABEL: Record<StepMergeField | 'state', string> = {
  targetLiftMm: '目标顶升量',
  syncRequirement: '同步要求',
  limitMm: '限位值',
  leader: '负责人',
  state: '步骤状态',
};

/** 读数唯一键：步骤 + 测点（追加去重依据） */
export function readingKey(stepId: string, pointCode: string): string {
  return `${stepId}__${pointCode}`;
}

/** 包号去重键（兼容包号两侧空白） */
export function normalizePackageNo(packageNo: string): string {
  return packageNo.trim();
}

/** 枚举字段中文展示 */
export function diseaseGradeText(grade: DiseaseGrade | undefined): string {
  const label: Record<DiseaseGrade, string> = {
    intact: '完好',
    slight: '轻微',
    moderate: '较重',
    severe: '严重',
  };
  return grade ? label[grade] : '—';
}

export function syncRequirementText(value: SyncRequirement | undefined): string {
  const label: Record<SyncRequirement, string> = { sync: '同步', cross: '交叉', single: '单点' };
  return value ? label[value] : '—';
}

export function stepStateText(value: StepState | undefined): string {
  const label: Record<StepState, string> = { idle: '未开始', lifting: '顶升中', arrived: '已到位' };
  return value ? label[value] : '—';
}

/** 任意字段值的稳定文本（undefined / null 统一为 —） */
export function fieldText(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  return String(value);
}

/** 校验作业包是否为可识别的包结构（不判断基线，基线缺失归待补证） */
export function isOfflinePackage(input: unknown): input is OfflinePackage {
  if (!input || typeof input !== 'object') return false;
  const candidate = input as Partial<OfflinePackage>;
  return (
    candidate.kind === OFFLINE_PACKAGE_KIND &&
    typeof candidate.packageNo === 'string' &&
    candidate.packageNo.trim().length > 0 &&
    typeof candidate.bridgeId === 'string' &&
    !!candidate.changes &&
    Array.isArray(candidate.changes.bearings) &&
    Array.isArray(candidate.changes.steps) &&
    Array.isArray(candidate.changes.readings)
  );
}

/** 旧包判定：结构可识别但缺少可用的冻结基线 */
export function packageMissingBaseline(pkg: OfflinePackage): boolean {
  const baseline = pkg.baseline;
  if (!baseline || typeof baseline.frozenAt !== 'string') return true;
  return !Array.isArray(baseline.bearings) || !Array.isArray(baseline.steps);
}
