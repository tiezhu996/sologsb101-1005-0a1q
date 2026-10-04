/**
 * Dexie 表增删改查与可观察订阅封装（Angular 以 Injectable 服务实现 useIdbTable 语义）。
 * 被全部页面消费：提供表快照流、写操作与变更广播。
 */
import { Injectable, inject } from '@angular/core';
import { Observable, defer, startWith, switchMap, shareReplay } from 'rxjs';
import { ChangeBusService } from './change-bus.service';
import { db, countAll, schemaInfo, type SchemaInfo } from '../utils/db';

@Injectable({ providedIn: 'root' })
export class IdbTableService {
  private readonly bus = inject(ChangeBusService);

  /**
   * 订阅某个读取函数的结果流：
   * 首次订阅立即拉取一次，之后每次数据变更广播都会重新拉取。
   */
  watch<T>(loader: () => Promise<T>, initial: T): Observable<T> {
    return this.bus.changes$.pipe(
      startWith(void 0),
      switchMap(() => defer(() => loader())),
      startWith(initial),
      shareReplay({ bufferSize: 1, refCount: true }),
    );
  }

  /** 各表行数统计流 */
  countAll$(): Observable<Record<string, number>> {
    return this.watch(countAll, {});
  }

  /** 结构版本信息（同步读取，无副作用） */
  schemaInfo(): SchemaInfo {
    return schemaInfo();
  }

  /** 直接暴露数据库实例，供 store 的写入场景使用 */
  get database() {
    return db;
  }

  /** 广播一次变更（写入后调用） */
  emitChange(): void {
    this.bus.emit();
  }
}
