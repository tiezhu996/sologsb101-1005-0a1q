/**
 * 离线作业包合并交接服务。
 *
 * 职责：
 * - freezePackage：出工前冻结基线，生成带包号的离线作业包
 * - handoffPackage：回站交接入口（校验 → 按包号去重 → 缺基线入待补证区 → 三方比对落库）
 * - retryPending：对未完成批次重试（基于重试时的最新主台账重新规划）
 * - acknowledgeDifference / dismissQuarantine：差异确认与待补证清理
 *
 * 失败安全：主台账写入在单个 Dexie 事务内完成（事务回滚保证原子性），
 * 捕获到异常后再执行一次显式恢复写（恢复事务开始前快照），双重保险；
 * 合并台账（差异 / 未完成批次）独立于主台账写入，始终保留供重试。
 */
import { Injectable, inject } from '@angular/core';
import {
  db,
  getMergeLedger,
  saveMergeLedger,
  emptyMergeLedger,
  listBridges,
  listPiers,
  listBearings,
  listSteps,
  listReadings,
  newId,
  type MergeLedger,
} from '../utils/db';
import { planMerge, type MergeWritePlan } from '../utils/merge-engine';
import {
  OFFLINE_PACKAGE_KIND,
  OFFLINE_PACKAGE_VERSION,
  isOfflinePackage,
  normalizePackageNo,
  packageMissingBaseline,
  type MergeDifference,
  type MergeReport,
  type OfflinePackage,
} from '../types/merge';
import type { Bearing } from '../types/bearing';
import type { Step } from '../types/step';
import type { Reading } from '../types/reading';

export interface FreezeOptions {
  bridgeId: string;
  crew: string;
  packageNo?: string;
}

export interface HandoffResult {
  status: 'merged' | 'duplicate' | 'quarantined' | 'failed';
  message: string;
  report?: MergeReport;
}

@Injectable({ providedIn: 'root' })
export class MergeHandoffService {
  /** 出工冻结：拷贝该桥梁当前支座 / 步骤作为基线，changes 留空待离线填写 */
  async freezePackage(options: FreezeOptions): Promise<OfflinePackage> {
    const [bearings, piers, steps] = await Promise.all([listBearings(), listPiers(), listSteps()]);
    const pierIds = new Set(piers.filter((item) => item.bridgeId === options.bridgeId).map((item) => item.id));
    const now = new Date().toISOString();
    const pkg: OfflinePackage = {
      kind: OFFLINE_PACKAGE_KIND,
      packageVersion: OFFLINE_PACKAGE_VERSION,
      packageNo: options.packageNo?.trim() || this.generatePackageNo(),
      bridgeId: options.bridgeId,
      crew: options.crew.trim(),
      packedAt: now,
      baseline: {
        frozenAt: now,
        bearings: bearings.filter((item) => pierIds.has(item.pierId)),
        steps: steps.filter((item) => item.bridgeId === options.bridgeId),
      },
      changes: { bearings: [], steps: [], readings: [] },
    };
    return pkg;
  }

  /**
   * 离线端模拟：基于已冻结包构造回站作业包（供交接演练 / 无离线端时的端到端验证）。
   * - bearingGrades：支座 id → 离线病害等级
   * - stepParams：步骤 id → 覆盖的步骤参数子集
   * - newReadings：追加的测点读数
   */
  withOfflineChanges(
    frozen: OfflinePackage,
    changes: {
      bearingGrades?: Record<string, Bearing['diseaseGrade']>;
      stepParams?: Record<string, Partial<Pick<Step, 'targetLiftMm' | 'syncRequirement' | 'limitMm' | 'leader' | 'state'>>>;
      newReadings?: Reading[];
    },
  ): OfflinePackage {
    if (!frozen.baseline) throw new Error('作业包缺少冻结基线，无法产生离线变化');
    const bearings = frozen.baseline.bearings
      .filter((item) => changes.bearingGrades?.[item.id])
      .map((item) => ({ ...item, diseaseGrade: changes.bearingGrades![item.id] }));
    const steps = frozen.baseline.steps
      .filter((item) => changes.stepParams?.[item.id])
      .map((item) => ({ ...item, ...changes.stepParams![item.id] }));
    return {
      ...frozen,
      handedAt: new Date().toISOString(),
      changes: { bearings, steps, readings: changes.newReadings ?? [] },
    };
  }

  /** 回站交接：解析 + 校验 + 去重 + 合并 */
  async handoffParsed(pkg: OfflinePackage): Promise<HandoffResult> {
    const normalized: OfflinePackage = { ...pkg, packageNo: normalizePackageNo(pkg.packageNo) };
    const ledger = await this.loadLedger();

    // 按包号去重：已成功并入 / 待重试的同包号一律不重复处理
    const duplicate =
      ledger.reports.some((item) => item.packageNo === normalized.packageNo) ||
      ledger.pending.some((item) => item.packageNo === normalized.packageNo);
    if (duplicate) {
      return { status: 'duplicate', message: `作业包 ${normalized.packageNo} 已交接过，按包号去重忽略` };
    }

    // 旧包缺基线 → 待补证区，不能猜着覆盖
    if (packageMissingBaseline(normalized)) {
      // 同号的缺基线包只保留一份，重复补交旧包直接提示
      if (ledger.quarantined.some((item) => item.packageNo === normalized.packageNo)) {
        return { status: 'duplicate', message: `作业包 ${normalized.packageNo} 已在待补证区，请补交带冻结基线的新包` };
      }
      ledger.quarantined.push({
        id: newId('quarantine'),
        packageNo: normalized.packageNo,
        bridgeId: normalized.bridgeId,
        crew: normalized.crew ?? '',
        receivedAt: new Date().toISOString(),
        reason: '作业包缺少冻结基线（baseline），无法进行基线后单边变化比对',
        pkg: normalized,
      });
      await saveMergeLedger(ledger);
      return {
        status: 'quarantined',
        message: `作业包 ${normalized.packageNo} 缺少冻结基线，已进入待补证区，补交含基线的新包后再交接`,
      };
    }

    // 含冻结基线的新包可顶替同号的待补证旧包：旧包留档移除，新包正常并入
    ledger.quarantined = ledger.quarantined.filter((item) => item.packageNo !== normalized.packageNo);

    return this.applyPackage(normalized, ledger);
  }

  /** 从文件文本交接（供页面调用，解析失败直接抛错） */
  async handoffJsonText(text: string): Promise<HandoffResult> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error('作业包文件不是合法 JSON');
    }
    if (!isOfflinePackage(parsed)) {
      throw new Error('文件不是可识别的离线作业包（缺少 kind / packageNo / changes 等字段）');
    }
    return this.handoffParsed(parsed);
  }

  /** 重试未完成批次：以当前主台账重新规划（主台账可能已被其他作业改过） */
  async retryPending(pendingId: string): Promise<HandoffResult> {
    const ledger = await this.loadLedger();
    const item = ledger.pending.find((entry) => entry.id === pendingId);
    if (!item) throw new Error('未完成批次不存在或已处理');
    const pkg: OfflinePackage = {
      ...item.pkg,
      packageNo: item.packageNo,
    };
    // 先从待重试列表摘掉；若再次失败 applyPackage 会重新登记
    ledger.pending = ledger.pending.filter((entry) => entry.id !== pendingId);
    return this.applyPackage(pkg, ledger, item.attempts);
  }

  /** 放弃未完成批次（差异保留，包移出待重试） */
  async discardPending(pendingId: string): Promise<void> {
    const ledger = await this.loadLedger();
    ledger.pending = ledger.pending.filter((entry) => entry.id !== pendingId);
    await saveMergeLedger(ledger);
  }

  /** 清理待补证条目（通常在补交同号新包并成功合并后） */
  async dismissQuarantine(id: string): Promise<void> {
    const ledger = await this.loadLedger();
    ledger.quarantined = ledger.quarantined.filter((entry) => entry.id !== id);
    await saveMergeLedger(ledger);
  }

  /**
   * 确认一条 blocking 差异：技术员核定「保留主台账原值」无误后解除该支座的验收冻结。
   * warning 差异也可确认留痕。
   */
  async acknowledgeDifference(differenceId: string): Promise<void> {
    const ledger = await this.loadLedger();
    for (const report of ledger.reports) {
      const target = report.differences.find((item) => item.id === differenceId);
      if (target) target.acknowledged = true;
    }
    await saveMergeLedger(ledger);
  }

  async loadLedger(): Promise<MergeLedger> {
    try {
      return await getMergeLedger();
    } catch {
      return emptyMergeLedger();
    }
  }

  /* ------------------------------ 内部实现 ------------------------------ */

  private async applyPackage(
    pkg: OfflinePackage,
    ledger: MergeLedger,
    previousAttempts = 0,
  ): Promise<HandoffResult> {
    const [bridges, piers, bearings, steps, readings] = await Promise.all([
      listBridges(),
      listPiers(),
      listBearings(),
      listSteps(),
      listReadings(),
    ]);
    const reportId = newId('merge');
    const mergedAt = new Date().toISOString();
    const plan: MergeWritePlan = planMerge(pkg, {
      bridges,
      piers,
      bearings,
      steps,
      readings,
      reportId,
      mergedAt,
    });

    // 事务前快照（仅本包触及的行），用于异常路径显式恢复
    const bearingIds = new Set(plan.bearingsToPut.map((item) => item.id));
    const stepIds = new Set(plan.stepsToPut.map((item) => item.id));
    const restoreSnapshot = {
      bearings: bearings.filter((item) => bearingIds.has(item.id)),
      steps: steps.filter((item) => stepIds.has(item.id)),
      readings: [] as Reading[],
    };

    try {
      await db.transaction(
        'rw',
        [db.bearings, db.steps, db.readings],
        async () => {
          if (plan.bearingsToPut.length) await db.bearings.bulkPut(plan.bearingsToPut);
          if (plan.stepsToPut.length) await db.steps.bulkPut(plan.stepsToPut);
          if (plan.readingsToPut.length) await db.readings.bulkPut(plan.readingsToPut);
        },
      );
    } catch (error) {
      // 主台账恢复：事务本应回滚，此处再做一次显式补偿写，保证主台账回到合并前
      await this.restoreMaster(restoreSnapshot.bearings, restoreSnapshot.steps).catch(() => undefined);

      ledger.pending.push({
        id: newId('pending-merge'),
        packageNo: pkg.packageNo,
        bridgeId: pkg.bridgeId,
        crew: pkg.crew ?? '',
        receivedAt: mergedAt,
        lastError: error instanceof Error ? error.message : '主台账写入失败',
        attempts: previousAttempts + 1,
        pkg,
        differences: plan.differences,
      });
      await saveMergeLedger(ledger).catch(() => undefined);
      return {
        status: 'failed',
        message: `作业包 ${pkg.packageNo} 写入失败，主台账已恢复，批次保留可重试：${
          error instanceof Error ? error.message : '未知错误'
        }`,
      };
    }

    const bridge = bridges.find((item) => item.id === pkg.bridgeId);
    const report: MergeReport = {
      id: reportId,
      packageNo: pkg.packageNo,
      bridgeId: pkg.bridgeId,
      bridgeName: bridge?.name ?? '未归属桥梁',
      crew: pkg.crew ?? '',
      mergedAt,
      status: 'merged',
      appliedBearingCount: plan.counts.appliedBearing,
      appliedStepCount: plan.counts.appliedStep,
      appendedReadingCount: plan.counts.appendedReading,
      skippedReadingCount: plan.counts.skippedReading,
      duplicateInPackageCount: plan.counts.duplicateInPackage,
      addedBearingCount: plan.counts.addedBearing,
      addedStepCount: plan.counts.addedStep,
      differences: plan.differences,
    };
    ledger.reports.unshift(report);
    await saveMergeLedger(ledger);

    return {
      status: 'merged',
      report,
      message: this.summaryMessage(report),
    };
  }

  /** 异常补偿：把触及的行恢复成快照原值（新增读数随事务回滚，无需显式删除） */
  private async restoreMaster(bearings: Bearing[], steps: Step[]): Promise<void> {
    await db.transaction('rw', [db.bearings, db.steps], async () => {
      if (bearings.length) await db.bearings.bulkPut(bearings);
      if (steps.length) await db.steps.bulkPut(steps);
    });
  }

  private summaryMessage(report: MergeReport): string {
    const blocking = report.differences.filter(
      (item) => item.type === 'bothChanged' && item.severity === 'blocking',
    ).length;
    const unverifiable = report.differences.filter((item) => item.type === 'unverifiable').length;
    const parts = [
      `作业包 ${report.packageNo} 已并入`,
      `支座 ${report.appliedBearingCount}`,
      `步骤 ${report.appliedStepCount}`,
      `新增读数 ${report.appendedReadingCount} 条`,
    ];
    if (report.skippedReadingCount) parts.push(`跳过重复读数 ${report.skippedReadingCount} 条`);
    if (blocking) parts.push(`⚠ ${blocking} 处等级双边冲突待核定（冻结相关支座验收）`);
    if (unverifiable) parts.push(`${unverifiable} 条数据无法核实已登记`);
    return parts.join('，');
  }

  private generatePackageNo(): string {
    const now = new Date();
    const pad = (v: number) => String(v).padStart(2, '0');
    const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(
      now.getMinutes(),
    )}`;
    return `PKG-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }
}

/** blocking 差异筛选工具：未确认的支座病害等级双边冲突 */
export function isBlockingDifference(diff: MergeDifference): boolean {
  return diff.type === 'bothChanged' && diff.severity === 'blocking' && !diff.acknowledged;
}
