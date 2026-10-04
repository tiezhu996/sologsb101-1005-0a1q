/** 持久化元信息：与 core/utils/db.ts 的 Dexie 行结构保持一致 */
export const ROW_REVISION = 2;

/** 每行数据的结构修订号，用于按行迁移 */
export interface Revisioned {
  revision: number;
}

/** 通用行基础字段 */
export interface RowMeta extends Revisioned {
  createdAt: string;
}
