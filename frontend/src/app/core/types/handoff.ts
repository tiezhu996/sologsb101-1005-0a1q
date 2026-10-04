/**
 * 离线作业包与离线合并交接的核心类型定义。
 *
 * 术语：
 * - 作业包冻结基线（baseline）：检修组离线作业开始前，对主台账相关支座 / 步骤 / 读数拍的快照。
 * - 离线变化（takeOffline）：回站时作业包内带回的、相对基线发生的单边变化与新增读数。
 * - 三方合并：基线 vs 主台账当前值 vs 离线值，仅在「主台账未改、离线改了」时接收单边变化。
 */
import type { DiseaseGrade } from './bearing';
import type { SyncRequirement } from './step';

/** 作业包结构版本号（作业包文件自身的结构，与 IndexedDB 结构版本无关） */
export const OFFLINE_PACKAGE_KIND = 'gbbridgebear-offline-package';

/* ============================== 作业包 ============================== */

/** 基线快照：支座只冻结参与合并的字段，步骤冻结参数字段 */
export interface OfflineBaseline {
  frozenAt: string;
  bearings: Array<{
    id: string;
    diseaseGrade: DiseaseGrade;
  }>;
  steps: Array<{
    id: string;
    targetLiftMm: number;
    limitMm: number;
    syncRequirement: SyncRequirement;
    leader: string;
  }>;
}

/** 离线带回的支座变化（按支座 id） */
export interface OfflineBearingChange {
  id: string;
  diseaseGrade: DiseaseGrade;
}

/** 离线带回的步骤参数变化（按步骤 id；步骤状态属作业流转，不在合并范围） */
export interface OfflineStepChange {
  id: string;
  targetLiftMm: number;
  limitMm: number;
  syncRequirement: SyncRequirement;
  leader: string;
}

/** 离线新增的测点读数（步骤 + 测点编号为唯一键，追加而非覆盖） */
export interface OfflineReadingDraft {
  stepId: string;
  pointCode: string;
  displacementMm: number;
  stressMpa: number;
  recordedAt: string;
  operator: string;
}

/** 检修组离线作业带回的作业包 */
export interface OfflinePackage {
  kind: typeof OFFLINE_PACKAGE_KIND;
  /** 包号：合并交接按包号去重（已接收的包号不再接收） */
  packageNo: string;
  bridgeId: string;
  bridgeName: string;
  crew: string;
  frozenAt: string;
  returnedAt: string;
  /** 冻结基线；旧包可能缺失，缺基线的包只能进入待补证区 */
  baseline?: OfflineBaseline;
  takeOffline: {
    bearings: OfflineBearingChange[];
    steps: OfflineStepChange[];
    readings: OfflineReadingDraft[];
  };
}

/* ============================== 合并计划 ============================== */

/** 合并涉及的实体类别 */
export type MergeEntityType = 'bearing' | 'step';

/** 步骤参数字段名（作业包步骤只合并这四个参数字段） */
export type StepParamField = 'targetLiftMm' | 'limitMm' | 'syncRequirement' | 'leader';

/** 支座合并字段名 */
export type BearingField = 'diseaseGrade';

/** 合并字段（支座病害等级或步骤参数） */
export type MergeField = BearingField | StepParamField;

/** 计划阶段的合并结论 */
export type MergePlanKind = 'accept' | 'conflict' | 'skip';

/** 单条字段级合并计划 */
export interface MergeFieldPlan {
  entity: MergeEntityType;
  entityId: string;
  field: MergeField;
  baselineValue: string | number;
  masterValue: string | number;
  offlineValue: string | number;
  /** accept：仅离线单边改；conflict：两边都改；skip：离线未改 / 无主台账行 */
  kind: MergePlanKind;
}

/** 单条读数追加计划 */
export interface MergeReadingPlan {
  stepId: string;
  pointCode: string;
  draft: OfflineReadingDraft;
  /** append：主台账该「步骤 + 测点」尚无读数；dup：已存在，跳过 */
  kind: 'append' | 'dup';
  /** append 时计划写入的确定 id（保证失败重试幂等） */
  targetId: string;
}

/** 读入作业包后的合并计划（不落库，仅用于交接区预览与执行） */
export interface MergePlan {
  packageNo: string;
  bridgeId: string;
  bridgeName: string;
  crew: string;
  frozenAt: string;
  returnedAt: string;
  bearingPlans: MergeFieldPlan[];
  stepPlans: MergeFieldPlan[];
  readingPlans: MergeReadingPlan[];
  /** 计划阶段统计 */
  acceptCount: number;
  conflictCount: number;
  appendReadingCount: number;
  dupReadingCount: number;
}

/* ============================== 交接台账行 ============================== */

/** 差异状态：open 待裁定（未处理前该支座不能签署验收）；resolved 已裁定 */
export type MergeConflictStatus = 'open' | 'resolved';

/** 差异裁定结果：keepMaster 保留主台账原值；takeOffline 采用离线值 */
export type MergeResolution = 'keepMaster' | 'takeOffline';

/** 字段级差异：支座病害等级或步骤参数两边都改过时，保留主台账原值并列出差异 */
export interface MergeConflictRow {
  id: string;
  packageNo: string;
  bridgeId: string;
  entity: MergeEntityType;
  entityId: string;
  field: MergeField;
  /** 主台账原值（冲突时保留，不被离线值覆盖） */
  masterValue: string | number;
  /** 离线带回值 */
  offlineValue: string | number;
  /** 冻结基线值 */
  baselineValue: string | number;
  status: MergeConflictStatus;
  resolution: MergeResolution | null;
  createdAt: string;
  resolvedAt: string;
}

/** 已接收作业包的去重流水（按包号唯一；同时承载追加读数来源标记） */
export interface MergeJournalRow {
  id: string;
  packageNo: string;
  bridgeId: string;
  bridgeName: string;
  crew: string;
  receivedAt: string;
  acceptedBearingIds: string[];
  acceptedStepIds: string[];
  appendedReadingIds: string[];
}

/** 合并批次（失败后保留差异和未完成批次供重试） */
export interface MergeBatchRow {
  id: string;
  packageNo: string;
  bridgeId: string;
  bridgeName: string;
  crew: string;
  status: 'failed' | 'succeeded';
  /** 失败原因 */
  error: string;
  createdAt: string;
  finishedAt: string;
  attempts: number;
  /** 失败时的作业包全文（供重试，避免再次选择文件） */
  packageJson: string;
  /** 失败时计划好的待接收条数（重试点数提示） */
  pendingAccept: number;
  pendingReadings: number;
}

/** 待补证区记录：旧包缺基线（或结构无法识别），只登记不猜着覆盖 */
export interface MergeEvidenceRow {
  id: string;
  /** 尽力解析出的包号；解析不出来用 unknown */
  packageNo: string;
  reason: string;
  createdAt: string;
  /** 原始文件全文，留作补证依据 */
  rawJson: string;
}

/** 交接台账概览统计 */
export interface MergeOverview {
  receivedPackages: number;
  openConflicts: number;
  resolvedConflicts: number;
  failedBatches: number;
  evidencePending: number;
  appendedReadings: number;
}
