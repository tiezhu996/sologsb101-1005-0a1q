/**
 * NgRx Effects：离线作业包冻结 / 交接 / 重试 / 差异确认，全部落到 MergeHandoffService。
 * 主台账写入成功后同时广播 IdbTableService 变更，各业务 store 自动重载。
 */
import { Injectable, inject } from '@angular/core';
import { Actions, createEffect, ofType } from '@ngrx/effects';
import { catchError, from, map, of, switchMap, tap } from 'rxjs';
import { mergeActions } from './merge.actions';
import { writeFailed } from './app.actions';
import { MergeHandoffService } from '../services/merge-handoff.service';
import { IdbTableService } from '../services/idb-table.service';
import { downloadJson } from '../utils/export';

@Injectable()
export class MergeEffects {
  private readonly actions$ = inject(Actions);
  private readonly handoff = inject(MergeHandoffService);
  private readonly idb = inject(IdbTableService);

  /** 加载合并交接台账 */
  readonly loadLedger$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.loadLedger, mergeActions.ledgerChanged),
      switchMap(() =>
        from(this.handoff.loadLedger()).pipe(
          map((ledger) => mergeActions.loadLedgerSuccess({ ledger })),
          catchError((error: unknown) =>
            of(
              mergeActions.loadLedgerFailure({
                error: error instanceof Error ? error.message : '合并台账读取失败',
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** 冻结基线并下载作业包 */
  readonly freezePackage$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.freezePackage),
      switchMap(({ options }) =>
        from(this.handoff.freezePackage(options)).pipe(
          tap((pkg) => {
            downloadJson(`offline-package-${pkg.packageNo}.json`, pkg);
          }),
          map((pkg) => mergeActions.freezePackageSuccess({ pkg })),
          catchError((error: unknown) =>
            of(writeFailed({ message: error instanceof Error ? error.message : '冻结作业包失败' })),
          ),
        ),
      ),
    ),
  );

  /** 交接文件文本 */
  readonly handoffText$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.handoffText),
      switchMap(({ text }) =>
        from(this.handoff.handoffJsonText(text)).pipe(
          tap((result) => {
            if (result.status === 'merged') this.idb.emitChange();
          }),
          map((result) => mergeActions.handoffResult({ result })),
          catchError((error: unknown) =>
            of(
              mergeActions.handoffResult({
                result: {
                  status: 'failed',
                  message: error instanceof Error ? error.message : '作业包交接失败',
                },
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** 直接交接已解析作业包 */
  readonly handoffParsed$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.handoffParsed),
      switchMap(({ pkg }) =>
        from(this.handoff.handoffParsed(pkg)).pipe(
          tap((result) => {
            if (result.status === 'merged') this.idb.emitChange();
          }),
          map((result) => mergeActions.handoffResult({ result })),
          catchError((error: unknown) =>
            of(
              mergeActions.handoffResult({
                result: {
                  status: 'failed',
                  message: error instanceof Error ? error.message : '作业包交接失败',
                },
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** 任何交接结果后刷新合并台账 */
  readonly refreshAfterHandoff$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.handoffResult),
      map(() => mergeActions.ledgerChanged()),
    ),
  );

  /** 重试未完成批次 */
  readonly retryPending$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.retryPending),
      switchMap(({ pendingId }) =>
        from(this.handoff.retryPending(pendingId)).pipe(
          tap((result) => {
            if (result.status === 'merged') this.idb.emitChange();
          }),
          map((result) => mergeActions.handoffResult({ result })),
          catchError((error: unknown) =>
            of(
              mergeActions.handoffResult({
                result: {
                  status: 'failed',
                  message: error instanceof Error ? error.message : '重试失败',
                },
              }),
            ),
          ),
        ),
      ),
    ),
  );

  /** 放弃未完成批次后刷新 */
  readonly discardPending$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.discardPending),
      switchMap(({ pendingId }) =>
        from(this.handoff.discardPending(pendingId)).pipe(
          map(() => mergeActions.ledgerChanged()),
          catchError((error: unknown) =>
            of(writeFailed({ message: error instanceof Error ? error.message : '放弃批次失败' })),
          ),
        ),
      ),
    ),
  );

  /** 清理待补证条目后刷新 */
  readonly dismissQuarantine$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.dismissQuarantine),
      switchMap(({ id }) =>
        from(this.handoff.dismissQuarantine(id)).pipe(
          map(() => mergeActions.ledgerChanged()),
          catchError((error: unknown) =>
            of(writeFailed({ message: error instanceof Error ? error.message : '清理待补证条目失败' })),
          ),
        ),
      ),
    ),
  );

  /** 确认差异后刷新台账（解除验收冻结） */
  readonly acknowledge$ = createEffect(() =>
    this.actions$.pipe(
      ofType(mergeActions.acknowledgeDifference),
      switchMap(({ differenceId }) =>
        from(this.handoff.acknowledgeDifference(differenceId)).pipe(
          map(() => mergeActions.ledgerChanged()),
          catchError((error: unknown) =>
            of(writeFailed({ message: error instanceof Error ? error.message : '差异确认失败' })),
          ),
        ),
      ),
    ),
  );
}
