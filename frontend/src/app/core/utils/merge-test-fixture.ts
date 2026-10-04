import { db } from './db';
import { ROW_REVISION } from '../types/persistence';

/** 服务层测试用最小主台账：1 桥 1 墩台 1 支座 1 步骤 */
export async function seedMasterForTest(): Promise<void> {
  const stamp = '2026-09-30T08:00:00.000Z';
  await db.transaction(
    'rw',
    [db.bridges, db.piers, db.bearings, db.steps, db.readings, db.acceptances],
    async () => {
      await db.bridges.bulkPut([
        {
          id: 'b1',
          name: '测试大桥',
          spanCombo: '1×20m',
          bridgeType: 'beam',
          builtYear: 2010,
          roadClass: 'first',
          archived: false,
          createdAt: stamp,
          revision: ROW_REVISION,
        },
      ]);
      await db.piers.bulkPut([
        {
          id: 'p1',
          bridgeId: 'b1',
          code: '1#墩',
          capElevation: 40,
          type: 'pier',
          bearingCount: 1,
          createdAt: stamp,
          revision: ROW_REVISION,
        },
      ]);
      await db.bearings.bulkPut([
        {
          id: 'br1',
          pierId: 'p1',
          serial: '1',
          type: 'plate',
          spec: 'GJZ',
          diseaseGrade: 'intact',
          diseaseNote: '',
          createdAt: stamp,
          revision: ROW_REVISION,
        },
      ]);
      await db.steps.bulkPut([
        {
          id: 's1',
          bridgeId: 'b1',
          seq: 1,
          targetLiftMm: 3,
          syncRequirement: 'sync',
          limitMm: 12,
          leader: '陈立强',
          state: 'idle',
          createdAt: stamp,
          revision: ROW_REVISION,
        },
      ]);
    },
  );
}
