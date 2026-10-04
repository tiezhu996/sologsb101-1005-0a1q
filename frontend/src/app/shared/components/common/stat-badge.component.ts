import { Component, input } from '@angular/core';
import { MatCardModule } from '@angular/material/card';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';

/**
 * <app-stat-badge> 计数与占比徽标
 * 展示支座总数、待更换数、验收完成率等指标，被桥梁页、顶升步骤页消费。
 */
@Component({
  selector: 'app-stat-badge',
  standalone: true,
  imports: [MatCardModule, MatProgressBarModule, MatTooltipModule],
  template: `
    @if (inline()) {
      <div class="stat-inline" [matTooltip]="hint()">
        <div class="stat-title">{{ title() }}</div>
        <div class="stat-value" [style.color]="color()">
          {{ value() }}
          @if (suffix()) {
            <span class="stat-suffix">{{ suffix() }}</span>
          }
        </div>
        @if (percent() !== null) {
          <div class="stat-percent" [style.color]="color()">{{ percentText() }}</div>
        }
      </div>
    } @else {
      <mat-card appearance="outlined" class="stat-card" [matTooltip]="hint()">
        <div class="stat-title">{{ title() }}</div>
        <div class="stat-value" [style.color]="color()">
          {{ value() }}
          @if (suffix()) {
            <span class="stat-suffix">{{ suffix() }}</span>
          }
        </div>
        @if (percent() !== null) {
          <mat-progress-bar
            mode="determinate"
            [value]="percent() ?? 0"
            [color]="barColor()"
            class="stat-bar"
          ></mat-progress-bar>
          <div class="stat-percent" [style.color]="color()">{{ percentText() }}</div>
        }
        @if (hint()) {
          <div class="stat-hint">{{ hint() }}</div>
        }
      </mat-card>
    }
  `,
  styles: [
    `
      .stat-card {
        border-radius: 10px;
        padding: 12px 14px;
      }
      .stat-title {
        font-size: 12px;
        color: rgba(22, 34, 46, 0.6);
      }
      .stat-value {
        font-size: 22px;
        font-weight: 600;
        line-height: 1.4;
      }
      .stat-suffix {
        font-size: 12px;
        font-weight: 400;
        color: rgba(22, 34, 46, 0.55);
        margin-left: 4px;
      }
      .stat-bar {
        margin-top: 6px;
        height: 6px;
        border-radius: 3px;
      }
      .stat-percent {
        font-size: 12px;
        font-weight: 600;
        margin-top: 4px;
      }
      .stat-hint {
        font-size: 12px;
        color: rgba(22, 34, 46, 0.55);
        margin-top: 6px;
        line-height: 1.5;
      }
      .stat-inline .stat-value {
        font-size: 17px;
      }
    `,
  ],
})
export class StatBadgeComponent {
  readonly title = input.required<string>();
  readonly value = input.required<string | number>();
  readonly suffix = input('');
  readonly percent = input<number | null>(null);
  readonly color = input('#1565c0');
  readonly hint = input('');
  readonly inline = input(false);

  percentText(): string {
    const value = this.percent();
    return value === null ? '' : `${value.toFixed(1)}%`;
  }

  barColor(): 'primary' | 'accent' | 'warn' {
    const value = this.percent() ?? 0;
    if (value >= 80) return 'primary';
    if (value >= 50) return 'accent';
    return 'warn';
  }
}
