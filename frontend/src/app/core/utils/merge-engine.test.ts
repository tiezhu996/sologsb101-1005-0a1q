/* 合并引擎规则验证（node --test 通过 esbuild 先转译） */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { planMerge } from './merge-engine';
import {
  OFFLINE_PACKAGE_KIND,
  OFFLINE_PACKAGE_VERSION,
  isOfflinePackage,
  packageMissingBaseline,
  readingKey,
  type OfflinePackage,
} from '../types/merge';
import { ROW_REVISION } from '../types/persistence';
import type { Bearing } from '../types/bearing';
import type { Step } from '../types/step';
import type { Reading } from '../types/reading';

const stamp = '2026-10-01T08:00:00.000Z';
function bearing(partial: Partial<Bearing> & Pick<Bearing, 'id' | 'pierId' | 'diseaseGrade'>): Bearing {
  return {
    serial: '1',
    type: 'plate',
    spec: 'GJZ 300×400',
    diseaseNote: '',
    createdAt: stamp,
    revision: ROW_REVISION,
    ...partial,
  };
}
function step(partial: Partial<Step> & Pick<Step, 'id' | 'bridgeId'>): Step {
  return {
    seq: 1,
    targetLiftMm: 3,
    syncRequirement: 'sync',
    limitMm: 12,
    leader: '陈立强',
    state: 'idle',
    createdAt: stamp,
    revision: ROW_REVISION,
    ...partial,
  };
}
function reading(partial: Partial<Reading> & Pick<Reading, 'id' | 'stepId' | 'pointCode'>): Reading {
  return {
    displacementMm: 1,
    stressMpa: 8,
    recordedAt: '2026-10-02 09:00',
    operator: '陈立强',
    createdAt: stamp,
    revision: ROW_REVISION,
    ...partial,
  };
}

const bridges = [{ id: 'b1', name: '沙河大桥' }] as never;
const piers = [{ id: 'p1', bridgeId: 'b1', code: '1#墩' }] as never;

function pkg(changes: OfflinePackage['changes'], baseline: OfflinePackage['baseline']): OfflinePackage {
  return {
    kind: OFFLINE_PACKAGE_KIND,
    packageVersion: OFFLINE_PACKAGE_VERSION,
    packageNo: 'PKG-T1',
    bridgeId: 'b1',
    crew: '甲组',
    packedAt: stamp,
    baseline,
    changes,
  };
}

const ctx = (bearings: Bearing[], steps: Step[], readings: Reading[]) => ({
  bridges: bridges as never,
  piers: piers as never,
  bearings,
  steps,
  readings,
  reportId: 'r1',
  mergedAt: '2026-10-03T08:00:00.000Z',
});

test('仅离线单边改病害等级 → 采纳离线值', () => {
  const base = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'intact' });
  const master = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'intact' });
  const offline = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'severe' });
  const plan = planMerge(
    pkg({ bearings: [offline], steps: [], readings: [] }, { frozenAt: stamp, bearings: [base], steps: [] }),
    ctx([master], [], []),
  );
  assert.equal(plan.bearingsToPut[0].diseaseGrade, 'severe');
  assert.equal(plan.counts.appliedBearing, 1);
  assert.equal(plan.differences.filter((d) => d.type === 'applied').length, 1);
  assert.equal(plan.differences.filter((d) => d.type === 'bothChanged').length, 0);
});

test('两边都改病害等级 → 保留主台账原值并登记 blocking 差异', () => {
  const base = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'intact' });
  const master = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'moderate' });
  const offline = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'severe' });
  const plan = planMerge(
    pkg({ bearings: [offline], steps: [], readings: [] }, { frozenAt: stamp, bearings: [base], steps: [] }),
    ctx([master], [], []),
  );
  assert.equal(plan.bearingsToPut.length, 0);
  const conflict = plan.differences.find((d) => d.type === 'bothChanged' && d.field === 'diseaseGrade');
  assert.ok(conflict);
  assert.equal(conflict!.severity, 'blocking');
  assert.equal(conflict!.masterValue, '较重');
  assert.equal(conflict!.offlineValue, '严重');
  assert.equal(conflict!.acknowledged, false);
});

test('仅主台账单边改 → 主台账原值保留，不产生写入也不登记差异', () => {
  const base = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'intact' });
  const master = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'slight' });
  const offline = bearing({ id: 'br1', pierId: 'p1', diseaseGrade: 'intact' });
  const plan = planMerge(
    pkg({ bearings: [offline], steps: [], readings: [] }, { frozenAt: stamp, bearings: [base], steps: [] }),
    ctx([master], [], []),
  );
  assert.equal(plan.bearingsToPut.length, 0);
  assert.equal(plan.differences.length, 0);
});

test('步骤参数两边都改 → 保留主台账原值（warning 不冻结签署但登记差异）', () => {
  const base = step({ id: 's1', bridgeId: 'b1', targetLiftMm: 3 });
  const master = step({ id: 's1', bridgeId: 'b1', targetLiftMm: 4 });
  const offline = step({ id: 's1', bridgeId: 'b1', targetLiftMm: 5 });
  const plan = planMerge(
    pkg({ bearings: [], steps: [offline], readings: [] }, { frozenAt: stamp, bearings: [], steps: [base] }),
    ctx([], [master], []),
  );
  assert.equal(plan.stepsToPut.length, 0);
  const conflict = plan.differences.find((d) => d.type === 'bothChanged' && d.field === 'targetLiftMm');
  assert.ok(conflict);
  assert.equal(conflict!.masterValue, '4 mm');
});

test('新增读数按步骤+测点唯一键追加；已存在跳过；包内重复以末条为准', () => {
  const existing = reading({ id: 'rd1', stepId: 's1', pointCode: 'P1', displacementMm: 1 });
  const newP2 = reading({ id: 'rd2', stepId: 's1', pointCode: 'P2', displacementMm: 2 });
  const dupP1 = reading({ id: 'rd3', stepId: 's1', pointCode: 'P1', displacementMm: 9 });
  const sameKeyA = reading({ id: 'rd4', stepId: 's1', pointCode: 'P3', displacementMm: 3 });
  const sameKeyB = reading({ id: 'rd5', stepId: 's1', pointCode: 'P3', displacementMm: 4 });
  const steps = [step({ id: 's1', bridgeId: 'b1' })];
  const plan = planMerge(
    pkg(
      { bearings: [], steps: [], readings: [newP2, dupP1, sameKeyA, sameKeyB] },
      { frozenAt: stamp, bearings: [], steps },
    ),
    ctx([], steps, [existing]),
  );
  const appendedKeys = plan.readingsToPut.map((r) => readingKey(r.stepId, r.pointCode));
  assert.deepEqual(appendedKeys.sort(), ['s1__P2', 's1__P3']);
  const p3 = plan.readingsToPut.find((r) => r.pointCode === 'P3')!;
  assert.equal(p3.displacementMm, 4); // 末条为准
  assert.equal(plan.counts.appendedReading, 2);
  assert.equal(plan.counts.skippedReading, 1);
  assert.equal(plan.counts.duplicateInPackage, 1);
});

test('读数挂接未知步骤 → unverifiable，不落库', () => {
  const orphan = reading({ id: 'x', stepId: 'ghost', pointCode: 'P1' });
  const plan = planMerge(
    pkg({ bearings: [], steps: [], readings: [orphan] }, { frozenAt: stamp, bearings: [], steps: [] }),
    ctx([], [], []),
  );
  assert.equal(plan.readingsToPut.length, 0);
  assert.equal(plan.differences.some((d) => d.type === 'unverifiable'), true);
});

test('离线新增支座不在基线 → unverifiable，不猜着落库', () => {
  const offline = bearing({ id: 'new', pierId: 'p1', diseaseGrade: 'severe' });
  const plan = planMerge(
    pkg({ bearings: [offline], steps: [], readings: [] }, { frozenAt: stamp, bearings: [], steps: [] }),
    ctx([], [], []),
  );
  assert.equal(plan.bearingsToPut.length, 0);
  assert.equal(plan.differences[0].type, 'unverifiable');
});

test('离线新增步骤（基线无、桥存在）→ 追加末级；其读数跟随追加', () => {
  const newStep = step({ id: 's9', bridgeId: 'b1', seq: 1, targetLiftMm: 2 });
  const newReading = reading({ id: 'r9', stepId: 's9', pointCode: 'P1' });
  const plan = planMerge(
    pkg(
      { bearings: [], steps: [newStep], readings: [newReading] },
      { frozenAt: stamp, bearings: [], steps: [] },
    ),
    // ctx 类型复用：传 bridges
    { bridges: bridges as never, piers: piers as never, bearings: [], steps: [], readings: [], reportId: 'r', mergedAt: stamp },
  );
  assert.equal(plan.stepsToPut[0].seq, 1);
  assert.equal(plan.readingsToPut.length, 1);
});

test('缺基线旧包：结构可识别但 packageMissingBaseline=true', () => {
  const oldPkg = {
    kind: OFFLINE_PACKAGE_KIND,
    packageVersion: OFFLINE_PACKAGE_VERSION,
    packageNo: 'PKG-OLD',
    bridgeId: 'b1',
    crew: '甲组',
    packedAt: stamp,
    changes: { bearings: [], steps: [], readings: [] },
  } as OfflinePackage;
  assert.equal(isOfflinePackage(oldPkg), true);
  assert.equal(packageMissingBaseline(oldPkg), true);
});
