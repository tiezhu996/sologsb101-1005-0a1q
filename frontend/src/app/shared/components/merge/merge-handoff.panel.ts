import { Component, computed, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Store } from '@ngrx/store';
import { toSignal } from '@angular/core/rxjs-interop';
import { MatCardModule } from '@angular/material/card';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSnackBar, MatSnackBarModule } from '@angular/material/snack-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { mergeActions } from '../../../core/store/merge.actions';
import {
  selectAllDifferences,
  selectAttentionCount,
  selectQuarantinedPackages,
  selectPendingMerges,
  selectMergeReports,
  type FlatDifference,
} from '../../../core/store/merge.selectors';
import type { MergeDifference } from '../../../core/types/merge';
import { selectBridges } from '../../../core/store/bridge.selectors';
import type { BridgeRow } from '../../../core/utils/db';

/**
 * <app-merge-handoff-panel> 离线作业包合并交接面板
 *
 * 出工冻结基线下载作业包；回站按包号交接：
 * - 包号去重、旧包缺基线进待补证区、双边改动留主台账原值并登记差异
 * - 写入失败保留未完成批次可重试，成功后差异可逐条确认
 * 嵌入验收页使用，也可被任意页面复用。
 */
@Component({
  selector: 'app-merge-handoff-panel',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSnackBarModule,
    MatTooltipModule,
  ],
  template: `
    <mat-card appearance="outlined" class="gb-section merge-panel">
      <div style="padding: 12px 14px">
        <div class="gb-inline-actions" style="justify-content: space-between">
          <div>
            <div class="gb-card-title">离线作业包交接</div>
            <div class="gb-hint" style="margin-top: 4px">
              出工冻结基线 · 回站按包号交接 · 只接基线后单边变化 · 双边改动保留主台账原值并登记差异
            </div>
          </div>
          <div class="gb-tags">
            <mat-chip [class]="attention().openDiffs > 0 ? 'chip-warn' : 'chip-ok'">
              未确认差异 {{ attention().openDiffs }}
            </mat-chip>
            <mat-chip [class]="attention().pending > 0 ? 'chip-warn' : 'chip-ok'">
              待重试批次 {{ attention().pending }}
            </mat-chip>
            <mat-chip [class]="attention().quarantined > 0 ? 'chip-warn' : 'chip-ok'">
              待补证 {{ attention().quarantined }}
            </mat-chip>
          </div>
        </div>

        <!-- 冻结基线 + 回站交接 -->
        <div class="merge-actions">
          <div class="merge-action-block">
            <div class="merge-action-title">
              <mat-icon>ac_unit</mat-icon>
              出工冻结（生成离线作业包）
            </div>
            <div class="gb-inline-actions" style="margin-top: 8px; align-items: flex-start">
              <mat-form-field appearance="outline" style="min-width: 220px">
                <mat-label>作业桥梁</mat-label>
                <mat-select [(ngModel)]="freezeBridgeId">
                  @for (bridge of bridges(); track bridge.id) {
                    <mat-option [value]="bridge.id">{{ bridge.name }}</mat-option>
                  }
                </mat-select>
              </mat-form-field>
              <mat-form-field appearance="outline" style="min-width: 150px">
                <mat-label>作业组 / 负责人</mat-label>
                <input matInput [(ngModel)]="freezeCrew" placeholder="如 陈立强班组" />
              </mat-form-field>
              <mat-form-field appearance="outline" style="min-width: 200px">
                <mat-label>包号（留空自动生成）</mat-label>
                <input matInput [(ngModel)]="freezePackageNo" placeholder="PKG-..." />
              </mat-form-field>
              <button mat-flat-button color="primary" [disabled]="!freezeBridgeId()" (click)="freeze()">
                <mat-icon>download</mat-icon>
                冻结基线并下载作业包
              </button>
            </div>
            <div class="gb-hint">
              作业包内含冻结时刻该桥支座病害等级与步骤参数快照；离线端只能在此基线上改动，回站据此三方比对。
            </div>
          </div>

          <div class="merge-action-block">
            <div class="merge-action-title">
              <mat-icon>move_to_inbox</mat-icon>
              回站交接（并入主台账）
            </div>
            <div class="gb-inline-actions" style="margin-top: 8px">
              <label class="upload-label">
                <input type="file" accept="application/json" hidden (change)="handoffFile($event)" />
                <span mat-flat-button color="accent">
                  <mat-icon>upload_file</mat-icon>
                  选择离线作业包
                </span>
              </label>
              <span class="gb-hint">同包号重复交接自动忽略；缺基线旧包进入待补证区，不会猜着覆盖。</span>
            </div>
          </div>
        </div>

        <!-- 待重试批次 -->
        @if (pending().length > 0) {
          <div class="merge-subsection">
            <div class="merge-subtitle">
              <mat-icon>pending_actions</mat-icon>
              未完成批次（主台账已恢复，差异保留，可重试）
            </div>
            <div class="gb-table-wrap">
              <table class="gb-table">
                <thead>
                  <tr>
                    <th>包号</th>
                    <th>桥梁</th>
                    <th>作业组</th>
                    <th>失败原因</th>
                    <th>已保留差异</th>
                    <th>尝试次数</th>
                    <th style="width: 200px">操作</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of pending(); track item.id) {
                    <tr>
                      <td class="gb-mono">{{ item.packageNo }}</td>
                      <td>{{ bridgeName(item.bridgeId) }}</td>
                      <td>{{ item.crew }}</td>
                      <td class="gb-hint">{{ item.lastError }}</td>
                      <td>
                        @if (pendingDiffSummary(item.differences); as summary) {
                          <mat-chip class="chip-warn"
                            [matTooltip]="pendingDiffLocations(item.differences)">
                            {{ summary }}
                          </mat-chip>
                        } @else {
                          <span class="gb-hint">无</span>
                        }
                      </td>
                      <td>{{ item.attempts }}</td>
                      <td>
                        <div class="gb-row-actions">
                          <button mat-flat-button color="primary" (click)="retry(item.id)">
                            <mat-icon>replay</mat-icon>
                            重试交接
                          </button>
                          <button mat-button color="warn" (click)="discardPending(item.id)">
                            <mat-icon>delete_outline</mat-icon>
                            放弃
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- 待补证区 -->
        @if (quarantined().length > 0) {
          <div class="merge-subsection">
            <div class="merge-subtitle">
              <mat-icon>rule_folder</mat-icon>
              待补证区（旧包缺少冻结基线，禁止猜着覆盖）
            </div>
            <div class="gb-table-wrap">
              <table class="gb-table">
                <thead>
                  <tr>
                    <th>包号</th>
                    <th>桥梁</th>
                    <th>作业组</th>
                    <th>接收时间</th>
                    <th>原因</th>
                    <th style="width: 160px">操作</th>
                  </tr>
                </thead>
                <tbody>
                  @for (item of quarantined(); track item.id) {
                    <tr>
                      <td class="gb-mono">{{ item.packageNo }}</td>
                      <td>{{ bridgeName(item.bridgeId) }}</td>
                      <td>{{ item.crew }}</td>
                      <td>{{ shortTime(item.receivedAt) }}</td>
                      <td class="gb-hint">{{ item.reason }}</td>
                      <td>
                        <div class="gb-row-actions">
                          <label>
                            <input type="file" accept="application/json" hidden (change)="supplementFile($event, item.packageNo)" />
                            <span mat-button mat-stroked-button>
                              <mat-icon>post_add</mat-icon>
                              补交新包
                            </span>
                          </label>
                          <button mat-button color="warn" (click)="dismissQuarantine(item.id)">
                            <mat-icon>delete_outline</mat-icon>
                            移除
                          </button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="gb-hint">补交的新包必须带冻结基线且使用同一包号；新包成功并入后可移除待补证旧包。</div>
          </div>
        }

        <!-- 已并入批次 -->
        @if (reports().length > 0) {
          <div class="merge-subsection">
            <div class="merge-subtitle">
              <mat-icon>history</mat-icon>
              已并入批次（{{ reports().length }}）
            </div>
            <div class="gb-table-wrap">
              <table class="gb-table">
                <thead>
                  <tr>
                    <th>包号</th>
                    <th>桥梁</th>
                    <th>并入时间</th>
                    <th>支座</th>
                    <th>步骤</th>
                    <th>新增读数</th>
                    <th>跳过重复</th>
                    <th>未确认差异</th>
                  </tr>
                </thead>
                <tbody>
                  @for (report of reports(); track report.id) {
                    <tr>
                      <td class="gb-mono">{{ report.packageNo }}</td>
                      <td>{{ report.bridgeName }}</td>
                      <td>{{ shortTime(report.mergedAt) }}</td>
                      <td>{{ report.appliedBearingCount }}</td>
                      <td>{{ report.appliedStepCount }}</td>
                      <td>{{ report.appendedReadingCount }}</td>
                      <td>{{ report.skippedReadingCount }}</td>
                      <td>
                        @if (openCount(report.differences) > 0) {
                          <mat-chip class="chip-warn">{{ openCount(report.differences) }} 条待确认</mat-chip>
                        } @else {
                          <mat-chip class="chip-ok">已结清</mat-chip>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }

        <!-- 差异清单 -->
        @if (differences().length > 0) {
          <div class="merge-subsection">
            <div class="merge-subtitle">
              <mat-icon>difference</mat-icon>
              差异清单（双边冲突保留主台账原值，确认后解除验收冻结）
            </div>
            <div class="gb-table-wrap">
              <table class="gb-table">
                <thead>
                  <tr>
                    <th>类型</th>
                    <th>定位</th>
                    <th>字段</th>
                    <th>主台账（保留）</th>
                    <th>离线（未采纳）</th>
                    <th>基线</th>
                    <th>说明</th>
                    <th style="width: 110px">状态</th>
                  </tr>
                </thead>
                <tbody>
                  @for (diff of differences(); track diff.id) {
                    <tr [class.is-blocking]="isBlocking(diff)">
                      <td>
                        <mat-chip [class]="diffTypeClass(diff)">{{ diffTypeLabel(diff) }}</mat-chip>
                      </td>
                      <td>{{ diff.location }}</td>
                      <td>{{ diff.fieldLabel }}</td>
                      <td class="gb-mono">{{ diff.masterValue }}</td>
                      <td class="gb-mono">{{ diff.offlineValue }}</td>
                      <td class="gb-mono gb-hint">{{ diff.baselineValue }}</td>
                      <td class="gb-hint">{{ diff.detail }}</td>
                      <td>
                        @if (diff.acknowledged) {
                          <mat-chip class="chip-ok">已确认</mat-chip>
                        } @else {
                          <button
                            mat-stroked-button
                            color="primary"
                            [matTooltip]="diff.severity === 'blocking' ? '确认后主台账原值生效，解除该支座验收冻结' : '已知悉该差异'"
                            (click)="acknowledge(diff)"
                          >
                            <mat-icon>done_all</mat-icon>
                            确认差异
                          </button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          </div>
        }
      </div>
    </mat-card>
  `,
  styles: [
    `
      .merge-panel {
        border-color: rgba(230, 81, 0, 0.35);
      }
      .merge-actions {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 14px;
        margin-top: 12px;
      }
      .merge-action-block {
        border: 1px dashed rgba(22, 34, 46, 0.18);
        border-radius: 10px;
        padding: 10px 12px;
      }
      .merge-action-title,
      .merge-subtitle {
        display: flex;
        align-items: center;
        gap: 6px;
        font-weight: 600;
        font-size: 13px;
      }
      .merge-subsection {
        margin-top: 14px;
      }
      .merge-subtitle {
        margin-bottom: 8px;
        color: #bf360c;
      }
      mat-chip.chip-warn {
        background: #fff3e0 !important;
        color: #e65100 !important;
      }
      mat-chip.chip-ok {
        background: #e8f5e9 !important;
        color: #1b5e20 !important;
      }
      mat-chip.chip-skipped {
        background: #eceff1 !important;
        color: #455a64 !important;
      }
      tr.is-blocking {
        background: #fff8e1;
      }
      .upload-label span[mat-button],
      .upload-label span[mat-flat-button] {
        display: inline-flex;
        align-items: center;
        gap: 4px;
      }
      @media (max-width: 1100px) {
        .merge-actions {
          grid-template-columns: 1fr;
        }
      }
    `,
  ],
})
export class MergeHandoffPanelComponent {
  private readonly store = inject(Store);
  private readonly snackBar = inject(MatSnackBar);

  readonly bridges = toSignal(this.store.select(selectBridges), { initialValue: [] as BridgeRow[] });
  readonly pending = toSignal(this.store.select(selectPendingMerges), { initialValue: [] });
  readonly quarantined = toSignal(this.store.select(selectQuarantinedPackages), { initialValue: [] });
  readonly reports = toSignal(this.store.select(selectMergeReports), { initialValue: [] });
  readonly differences = toSignal(this.store.select(selectAllDifferences), { initialValue: [] as FlatDifference[] });
  readonly attention = toSignal(this.store.select(selectAttentionCount), {
    initialValue: { pending: 0, quarantined: 0, openDiffs: 0 },
  });

  readonly freezeBridgeId = signal('');
  readonly freezeCrew = signal('');
  readonly freezePackageNo = signal('');

  /** 默认桥梁：store 当前加载完成后取第一座（若用户未选） */
  constructor() {
    effect(() => {
      if (!this.freezeBridgeId() && this.bridges().length > 0) {
        this.freezeBridgeId.set(this.bridges()[0].id);
      }
    });
  }

  freeze(): void {
    const bridgeId = this.freezeBridgeId();
    if (!bridgeId) {
      this.notify('请先选择作业桥梁');
      return;
    }
    if (!this.freezeCrew().trim()) {
      this.notify('请填写作业组 / 负责人');
      return;
    }
    this.store.dispatch(
      mergeActions.freezePackage({
        options: {
          bridgeId,
          crew: this.freezeCrew().trim(),
          packageNo: this.freezePackageNo().trim() || undefined,
        },
      }),
    );
    this.notify('作业包已冻结并开始下载，离线端在包内 changes 中填写变化');
  }

  handoffFile(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file.text().then((text) => this.store.dispatch(mergeActions.handoffText({ text })));
  }

  /** 待补证区补交：选择新包文件，校验包号一致后交接 */
  supplementFile(event: Event, expectedPackageNo: string): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    void file.text().then((text) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        this.notify('补交文件不是合法 JSON');
        return;
      }
      const pkg = parsed as { packageNo?: string };
      if (!pkg || typeof pkg.packageNo !== 'string' || pkg.packageNo.trim() !== expectedPackageNo) {
        this.notify(`补交包号必须与待补证包一致（${expectedPackageNo}）`);
        return;
      }
      this.store.dispatch(mergeActions.handoffText({ text }));
    });
  }

  retry(pendingId: string): void {
    this.store.dispatch(mergeActions.retryPending({ pendingId }));
    this.notify('正在按当前主台账重新规划并写入…');
  }

  discardPending(pendingId: string): void {
    if (!confirm('放弃该未完成批次？已登记的差异仍会保留，但作业包将移出待重试列表。')) return;
    this.store.dispatch(mergeActions.discardPending({ pendingId }));
    this.notify('未完成批次已放弃');
  }

  dismissQuarantine(id: string): void {
    if (!confirm('从待补证区移除该旧包？（请确认同包号新包已成功并入）')) return;
    this.store.dispatch(mergeActions.dismissQuarantine({ id }));
    this.notify('待补证旧包已移除');
  }

  acknowledge(diff: FlatDifference): void {
    const tip =
      diff.severity === 'blocking'
        ? '确认主台账原值为准？确认后该支座可继续签署验收。'
        : '确认已知悉该差异（主台账原值保留）？';
    if (!confirm(tip)) return;
    this.store.dispatch(mergeActions.acknowledgeDifference({ differenceId: diff.id }));
    this.notify('差异已确认');
  }

  bridgeName(bridgeId: string): string {
    return this.bridges().find((item) => item.id === bridgeId)?.name ?? bridgeId;
  }

  openCount(list: ReadonlyArray<{ acknowledged: boolean }>): number {
    return list.filter((item) => !item.acknowledged).length;
  }

  /** 未完成批次已保留差异的摘要 */
  pendingDiffSummary(list: MergeDifference[] | undefined): string {
    if (!list || list.length === 0) return '';
    const blocking = list.filter((d) => d.severity === 'blocking' && !d.acknowledged).length;
    const both = list.filter((d) => d.type === 'bothChanged').length;
    const unverifiable = list.filter((d) => d.type === 'unverifiable').length;
    const skipped = list.filter((d) => d.type === 'skipped').length;
    const parts = [`共 ${list.length} 条`];
    if (blocking) parts.push(`冻结 ${blocking}`);
    if (both) parts.push(`双边 ${both}`);
    if (unverifiable) parts.push(`无法核实 ${unverifiable}`);
    if (skipped) parts.push(`跳过 ${skipped}`);
    return parts.join(' · ');
  }

  pendingDiffLocations(list: MergeDifference[] | undefined): string {
    if (!list || list.length === 0) return '';
    return list.slice(0, 6).map((d) => `· ${d.location} ${d.fieldLabel}：保留「${d.masterValue}」`).join('\n');
  }

  shortTime(iso: string): string {
    return iso.replace('T', ' ').slice(0, 16);
  }

  isBlocking(diff: FlatDifference): boolean {
    return diff.type === 'bothChanged' && diff.severity === 'blocking' && !diff.acknowledged;
  }

  diffTypeLabel(diff: FlatDifference): string {
    if (diff.type === 'bothChanged') return diff.severity === 'blocking' ? '双边冲突·冻结' : '双边改动';
    if (diff.type === 'unverifiable') return '无法核实';
    if (diff.type === 'skipped') return '重复跳过';
    return '单边采纳';
  }

  diffTypeClass(diff: FlatDifference): string {
    if (diff.type === 'bothChanged') return diff.severity === 'blocking' ? 'chip-warn' : 'chip-warn';
    if (diff.type === 'unverifiable') return 'chip-warn';
    if (diff.type === 'skipped') return 'chip-skipped';
    return 'chip-ok';
  }

  private notify(message: string): void {
    this.snackBar.open(message, '关闭', { duration: 3000 });
  }
}
