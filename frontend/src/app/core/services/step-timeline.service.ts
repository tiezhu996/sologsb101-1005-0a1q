/**
 * 顶升步骤时间线服务（Angular 以 Injectable 实现 useStepTimeline 语义）
 * 提供顶升步骤时间线、累计顶升量与同步偏差的 RxJS 派生流，
 * 被顶升步骤页、测点读数页消费。
 */
import { Injectable, inject } from '@angular/core';
import { Observable, combineLatest, map, shareReplay } from 'rxjs';
import { IdbTableService } from './idb-table.service';
import { listBearings, listBridges, listReadings, listSteps } from '../utils/db';
import type { BridgeRow, BearingRow, ReadingRow, StepRow } from '../utils/db';
import { sortSteps, SYNC_REQUIREMENT_LABEL, type StepView } from '../types/step';
import { meanDisplacement, syncDeviationMm, type ReadingView } from '../types/reading';
import { overallLevel, syncLevel, type ToleranceLevel } from '../utils/tolerance';

/** 步骤时间线的一级节点 */
export interface StepTimelineNode {
  step: StepView;
  /** 该步骤的读数（含偏差） */
  readings: ReadingView[];
  /** 同步偏差等级 */
  deviationLevel: ToleranceLevel;
  /** 综合限位等级 */
  limitLevel: ToleranceLevel;
}

/** 时间线汇总 */
export interface StepTimelineSnapshot {
  steps: StepRow[];
  readings: ReadingRow[];
  bearings: BearingRow[];
  bridges: BridgeRow[];
}

@Injectable({ providedIn: 'root' })
export class StepTimelineService {
  private readonly idb = inject(IdbTableService);

  /** 原始快照流 */
  readonly snapshot$: Observable<StepTimelineSnapshot> = this.idb
    .watch<StepTimelineSnapshot>(
      async () => {
        const [steps, readings, bearings, bridges] = await Promise.all([
          listSteps(),
          listReadings(),
          listBearings(),
          listBridges(),
        ]);
        return { steps, readings, bearings, bridges };
      },
      { steps: [], readings: [], bearings: [], bridges: [] },
    )
    .pipe(shareReplay({ bufferSize: 1, refCount: true }));

  /** 步骤视图流：含累计顶升量、同步偏差与校验结论 */
  readonly stepViews$: Observable<StepView[]> = this.snapshot$.pipe(
    map((snapshot) => this.buildStepViews(snapshot)),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 时间线节点流：步骤 + 该步读数 + 等级判定 */
  readonly timeline$: Observable<StepTimelineNode[]> = combineLatest([
    this.stepViews$,
    this.snapshot$,
  ]).pipe(
    map(([steps, snapshot]) => {
      const bridges = new Map(snapshot.bridges.map((item) => [item.id, item.name]));
      return steps.map((step) => {
        const stepReadings = snapshot.readings
          .filter((item) => item.stepId === step.id)
          .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt))
          .map<ReadingView>((reading) => {
            const sameRound = snapshot.readings.filter(
              (item) => item.stepId === reading.stepId && item.recordedAt === reading.recordedAt,
            );
            const average = meanDisplacement(sameRound);
            return {
              ...reading,
              stepSeq: step.seq,
              bridgeId: step.bridgeId,
              bridgeName: bridges.get(step.bridgeId) ?? '未归属桥梁',
              syncRequirement: SYNC_REQUIREMENT_LABEL[step.syncRequirement],
              deviationMm: Number((reading.displacementMm - average).toFixed(3)),
              overLimit: Math.abs(reading.displacementMm) >= step.limitMm,
              stressAlert: reading.stressMpa >= 12,
            };
          });
        return {
          step,
          readings: stepReadings,
          deviationLevel: syncLevel(step.syncDeviationMm ?? 0),
          limitLevel: stepReadings.reduce<ToleranceLevel>((worst, reading) => {
            const level = overallLevel(reading.displacementMm, step.limitMm, reading.stressMpa);
            if (level === 'exceed' || worst === 'exceed') return 'exceed';
            if (level === 'watch' || worst === 'watch') return 'watch';
            return 'ok';
          }, 'ok'),
        };
      });
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 按桥梁分组的步骤流 */
  readonly stepsByBridge$: Observable<Map<string, StepView[]>> = this.stepViews$.pipe(
    map((steps) => {
      const grouped = new Map<string, StepView[]>();
      for (const step of steps) {
        const list = grouped.get(step.bridgeId) ?? [];
        list.push(step);
        grouped.set(step.bridgeId, list);
      }
      return grouped;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 累计顶升量流：桥梁 id → 累计值 */
  readonly cumulativeLift$: Observable<Record<string, number>> = this.stepViews$.pipe(
    map((steps) => {
      const totals: Record<string, number> = {};
      for (const step of steps) {
        totals[step.bridgeId] = Number(((totals[step.bridgeId] ?? 0) + step.targetLiftMm).toFixed(2));
      }
      return totals;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 同步偏差流：步骤 id → 偏差 */
  readonly syncDeviation$: Observable<Record<string, number>> = this.snapshot$.pipe(
    map((snapshot) => {
      const result: Record<string, number> = {};
      for (const step of snapshot.steps) {
        const rows = snapshot.readings.filter((item) => item.stepId === step.id);
        result[step.id] = syncDeviationMm(rows);
      }
      return result;
    }),
    shareReplay({ bufferSize: 1, refCount: true }),
  );

  /** 构建步骤视图（供派生流与页面共用） */
  buildStepViews(snapshot: StepTimelineSnapshot): StepView[] {
    const bridgeName = new Map(snapshot.bridges.map((item) => [item.id, item.name]));
    const ordered = sortSteps(snapshot.steps);
    const cumulative = new Map<string, number>();
    let running = 0;
    for (const step of ordered) {
      running += step.targetLiftMm;
      cumulative.set(step.id, Number(running.toFixed(2)));
    }
    return ordered.map((step) => {
      const rows = snapshot.readings.filter((item) => item.stepId === step.id);
      const cumulativeLiftMm = cumulative.get(step.id) ?? step.targetLiftMm;
      const deviation = rows.length > 0 ? syncDeviationMm(rows) : null;
      const overLimit = cumulativeLiftMm > step.limitMm;
      return {
        ...step,
        bridgeName: bridgeName.get(step.bridgeId) ?? '未归属桥梁',
        cumulativeLiftMm,
        overLimit,
        readingCount: rows.length,
        syncDeviationMm: deviation,
        validation: overLimit
          ? `累计顶升量 ${cumulativeLiftMm} mm 已超过限位 ${step.limitMm} mm，需立即停止并复核`
          : deviation !== null && syncLevel(deviation) === 'exceed'
            ? `同步偏差 ${deviation.toFixed(2)} mm 超允许值，需调平后继续`
            : '顶升参数与监测数据均在控制范围内',
      };
    });
  }
}
