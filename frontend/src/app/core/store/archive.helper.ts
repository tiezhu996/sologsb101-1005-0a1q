/**
 * 归档判定辅助：检查是否所有支座均已完成四步验收，返回可归档的桥梁摘要。
 * 被 acceptance store 的批量签署 effect 调用。
 */
import { listAcceptances, listBearings, listBridges, listPiers, listReadings, listSteps } from '../utils/db';
import { ACCEPTANCE_STAGES } from '../types/acceptance';
import { archiveSummary } from '../types/acceptance';

export interface ArchiveCheckResult {
  /** 已满足归档条件的桥梁 id */
  archivableBridgeIds: string[];
  /** 摘要文案 */
  summaries: string[];
}

/** 检查全部桥梁的归档条件 */
export async function checkBridgeArchived(): Promise<ArchiveCheckResult> {
  const [bridges, piers, bearings, acceptances, steps, readings] = await Promise.all([
    listBridges(),
    listPiers(),
    listBearings(),
    listAcceptances(),
    listSteps(),
    listReadings(),
  ]);

  const archivableBridgeIds: string[] = [];
  const summaries: string[] = [];

  for (const bridge of bridges) {
    const pierIds = new Set(piers.filter((item) => item.bridgeId === bridge.id).map((item) => item.id));
    const ownedBearings = bearings.filter((item) => pierIds.has(item.pierId));
    if (ownedBearings.length === 0) continue;
    const fullyAccepted = ownedBearings.filter((bearing) => {
      const passed = new Set(
        acceptances
          .filter((item) => item.bearingId === bearing.id && item.conclusion === 'pass')
          .map((item) => item.stage),
      );
      const failed = acceptances.some(
        (item) => item.bearingId === bearing.id && item.conclusion === 'fail',
      );
      return !failed && ACCEPTANCE_STAGES.every((stage) => passed.has(stage));
    });
    if (fullyAccepted.length < ownedBearings.length) continue;

    const bridgeSteps = steps.filter((item) => item.bridgeId === bridge.id);
    const stepIds = new Set(bridgeSteps.map((item) => item.id));
    archivableBridgeIds.push(bridge.id);
    summaries.push(
      archiveSummary({
        bridgeName: bridge.name,
        bearingCount: ownedBearings.length,
        totalLiftMm: Number(bridgeSteps.reduce((sum, item) => sum + item.targetLiftMm, 0).toFixed(2)),
        stepCount: bridgeSteps.length,
        readingCount: readings.filter((item) => stepIds.has(item.stepId)).length,
      }),
    );
  }

  return { archivableBridgeIds, summaries };
}
