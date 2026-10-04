import { Component, input, output } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

/**
 * <app-empty-panel> 空数据引导与新建入口
 * 被全部列表页消费，保证任何列表为空时都有明确的下一步动作。
 */
@Component({
  selector: 'app-empty-panel',
  standalone: true,
  imports: [MatButtonModule, MatIconModule],
  template: `
    <div class="gb-empty">
      <mat-icon class="empty-icon">{{ icon() }}</mat-icon>
      <div class="gb-empty-title">{{ title() }}</div>
      <div class="gb-hint">{{ description() }}</div>
      <div class="empty-actions">
        @if (actionLabel()) {
          <button mat-flat-button color="primary" (click)="action.emit()">
            <mat-icon>add</mat-icon>
            {{ actionLabel() }}
          </button>
        }
        @if (secondaryLabel()) {
          <button mat-stroked-button (click)="secondary.emit()">
            <mat-icon>refresh</mat-icon>
            {{ secondaryLabel() }}
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      .empty-icon {
        font-size: 40px;
        width: 40px;
        height: 40px;
        color: rgba(22, 34, 46, 0.28);
      }
      .empty-actions {
        display: flex;
        justify-content: center;
        gap: 8px;
        margin-top: 14px;
        flex-wrap: wrap;
      }
    `,
  ],
})
export class EmptyPanelComponent {
  readonly title = input('暂无数据');
  readonly description = input('当前筛选条件下没有记录，可新建一条或调整筛选条件。');
  readonly icon = input('inbox');
  readonly actionLabel = input('');
  readonly secondaryLabel = input('');
  readonly action = output<void>();
  readonly secondary = output<void>();
}
