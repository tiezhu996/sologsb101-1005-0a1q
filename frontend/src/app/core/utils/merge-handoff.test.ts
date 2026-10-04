/* 服务层失败恢复 / 去重 / 待补证验证（使用 fake-indexeddb） */
import 'fake-indexeddb/auto';
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { MergeHandoffService } from '../services/merge-handoff.service';
import { db, listBearings, listSteps, listReadings, getMergeLedger } from '../utils/db';
import { seedMasterForTest } from './merge-test-fixture';
import {
  OFFLINE_PACKAGE_KIND,
  OFFLINE_PACKAGE_VERSION,
  type OfflinePackage,
} from '../types/merge';
import { ROW_REVISION } from '../types/persistence';

beforeEach(async () => {
  // 每个用例使用独立库：删除并重新打开 Dexie
  await db.delete();
  await db.open();
  await seedMasterForTest();
});

function validPackage(overrides: Partial<OfflinePackage> = {}): OfflinePackage {
  return {
    kind: OFFLINE_PACKAGE_KIND,
    packageVersion: OFFLINE_PACKAGE_VERSION,
    packageNo: 'PKG-100',
    bridgeId: 'b1',
    crew: '甲组',
    packedAt: '2026-10-01T08:00:00.000Z',
    baseline: {
      frozenAt: '2026-10-01T08:00:00.000Z',
      bearings: [
        {
          id: 'br1',
          pierId: 'p1',
          serial: '1',
          type: 'plate',
          spec: 'GJZ',
          diseaseGrade: 'intact',
          diseaseNote: '',
          createdAt: 'x',
          revision: ROW_REVISION,
        },
      ],
      steps: [
        {
          id: 's1',
          bridgeId: 'b1',
          seq: 1,
          targetLiftMm: 3,
          syncRequirement: 'sync',
          limitMm: 12,
          leader: '陈立强',
          state: 'idle',
          createdAt: 'x',
          revision: ROW_REVISION,
        },
      ],
    },
    changes: {
      // 单边改等级
      bearings: [
        {
          id: 'br1',
          pierId: 'p1',
          serial: '1',
          type: 'plate',
          spec: 'GJZ',
          diseaseGrade: 'severe',
          diseaseNote: '离线发现裂纹',
          createdAt: 'x',
          revision: ROW_REVISION,
        },
      ],
      steps: [],
      // 新增读数
      readings: [
        {
          id: 'rd-new-1',
          stepId: 's1',
          pointCode: 'P9',
          displacementMm: 3.2,
          stressMpa: 9,
          recordedAt: '2026-10-02 10:00',
          operator: '赵启明',
          createdAt: 'x',
          revision: ROW_REVISION,
        },
      ],
    },
    ...overrides,
  };
}

test('正常交接：主台账被更新、读数追加、报告落账', async () => {
  const service = new MergeHandoffService();
  const result = await service.handoffParsed(validPackage());
  assert.equal(result.status, 'merged');

  const bearing = (await listBearings()).find((b) => b.id === 'br1')!;
  assert.equal(bearing.diseaseGrade, 'severe');
  const readings = await listReadings();
  assert.ok(readings.some((r) => r.stepId === 's1' && r.pointCode === 'P9'));

  const ledger = await getMergeLedger();
  assert.equal(ledger.reports.length, 1);
  assert.equal(ledger.reports[0].appendedReadingCount, 1);
});

test('同包号重复交接：忽略且不重复追加', async () => {
  const service = new MergeHandoffService();
  await service.handoffParsed(validPackage());
  const second = await service.handoffParsed(validPackage());
  assert.equal(second.status, 'duplicate');
  const readings = await listReadings();
  assert.equal(readings.filter((r) => r.pointCode === 'P9').length, 1);
});

test('缺基线旧包：进入待补证区，主台账不变', async () => {
  const service = new MergeHandoffService();
  const oldPkg = validPackage();
  delete (oldPkg as Partial<OfflinePackage>).baseline;
  const result = await service.handoffParsed(oldPkg);
  assert.equal(result.status, 'quarantined');
  const bearing = (await listBearings()).find((b) => b.id === 'br1')!;
  assert.equal(bearing.diseaseGrade, 'intact'); // 未被覆盖
  const ledger = await getMergeLedger();
  assert.equal(ledger.quarantined.length, 1);
});

test('写入失败：主台账恢复原状，差异台账外的未完成批次可重试成功', async () => {
  const service = new MergeHandoffService();

  // 让 bearings 写入首次失败（只失败一次，重试恢复）
  let failedOnce = false;
  const originalBulkPut = db.bearings.bulkPut.bind(db.bearings);
  db.bearings.bulkPut = (async (rows: unknown[]) => {
    if (!failedOnce && rows.length > 0) {
      failedOnce = true;
      throw new Error('模拟写入故障 quota-exceeded');
    }
    return originalBulkPut(rows as never);
  }) as typeof db.bearings.bulkPut;

  const result = await service.handoffParsed(validPackage());
  assert.equal(result.status, 'failed');

  // 主台账恢复：等级未变、读数未追加
  const bearing = (await listBearings()).find((b) => b.id === 'br1')!;
  assert.equal(bearing.diseaseGrade, 'intact');
  assert.equal((await listReadings()).filter((r) => r.pointCode === 'P9').length, 0);

  // 未完成批次保留
  let ledger = await getMergeLedger();
  assert.equal(ledger.pending.length, 1);
  assert.match(ledger.pending[0].lastError, /quota-exceeded/);
  const pendingId = ledger.pending[0].id;

  // 恢复 bulkPut 后重试
  db.bearings.bulkPut = originalBulkPut;
  const retry = await service.retryPending(pendingId);
  assert.equal(retry.status, 'merged');

  const bearingAfter = (await listBearings()).find((b) => b.id === 'br1')!;
  assert.equal(bearingAfter.diseaseGrade, 'severe');
  ledger = await getMergeLedger();
  assert.equal(ledger.pending.length, 0);
  assert.equal(ledger.reports.length, 1);
});

test('blocking 差异确认前存在，确认后 acknowledged=true', async () => {
  const service = new MergeHandoffService();
  // 主台账等级也改成 moderate，构成双边冲突
  const steps = await listSteps();
  void steps;
  const pkg = validPackage();
  await service.handoffParsed(pkg);
  // 上面是单边；再造一个双边冲突包
  const conflictPkg = validPackage({ packageNo: 'PKG-200' });
  // 主台账当前 severe；基线需为 intact（仍是），离线给 slight → base intact / master severe / offline slight
  conflictPkg.changes = {
    ...conflictPkg.changes,
    bearings: [
      {
        id: 'br1',
        pierId: 'p1',
        serial: '1',
        type: 'plate',
        spec: 'GJZ',
        diseaseGrade: 'slight',
        diseaseNote: '',
        createdAt: 'x',
        revision: ROW_REVISION,
      },
    ],
  };
  const result = await service.handoffParsed(conflictPkg);
  assert.equal(result.status, 'merged');
  const ledger = await getMergeLedger();
  const blocking = ledger.reports[0].differences.find(
    (d) => d.type === 'bothChanged' && d.field === 'diseaseGrade',
  );
  assert.ok(blocking);
  assert.equal(blocking!.acknowledged, false);
  await service.acknowledgeDifference(blocking!.id);
  const after = await getMergeLedger();
  const found = after.reports
    .flatMap((r) => r.differences)
    .find((d) => d.id === blocking!.id);
  assert.equal(found!.acknowledged, true);
});
