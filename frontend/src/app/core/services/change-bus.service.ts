/**
 * 状态变更广播：Dexie 写入后通知各 NgRx store 重新拉取，实现跨页响应式刷新。
 * 纯前端单页应用内部的同步机制，不涉及网络。
 */
import { Injectable } from '@angular/core';
import { Observable, Subject } from 'rxjs';

@Injectable({ providedIn: 'root' })
export class ChangeBusService {
  private readonly changes = new Subject<void>();

  /** 变更流：任何写入后推送一次 */
  readonly changes$: Observable<void> = this.changes.asObservable();

  /** 广播一次数据变更 */
  emit(): void {
    this.changes.next();
  }
}
