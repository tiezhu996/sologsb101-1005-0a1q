import { Component, computed, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatChipsModule } from '@angular/material/chips';

export interface FilterSelectSpec {
  /** 字段名（同时作为筛选值 key，页面对接路由 query 参数） */
  key: string;
  label: string;
  options: string[];
  /** 是否多选，默认 true */
  multiple?: boolean;
}

/**
 * <app-filter-bar> 关键字 + 多选条件筛选条
 * 条件通过 change 事件上报，由页面同步到路由 query 参数，
 * 被支座评级页、测点读数页消费。
 */
@Component({
  selector: 'app-filter-bar',
  standalone: true,
  imports: [
    FormsModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
    MatIconModule,
    MatChipsModule,
  ],
  template: `
    <mat-card appearance="outlined" class="filter-card">
      <div class="filter-row">
        <mat-form-field appearance="outline" class="filter-keyword">
          <mat-label>{{ keywordLabel() }}</mat-label>
          <mat-icon matPrefix>search</mat-icon>
          <input
            matInput
            [ngModel]="keyword()"
            (ngModelChange)="onKeywordChange($event)"
            [placeholder]="keywordPlaceholder()"
          />
        </mat-form-field>

        @for (select of selects(); track select.key) {
          <mat-form-field appearance="outline" class="filter-select">
            <mat-label>{{ select.label }}</mat-label>
            <mat-select
              [multiple]="select.multiple !== false"
              [ngModel]="selectedValues(select.key)"
              (ngModelChange)="onSelectChange(select.key, $event)"
            >
              @for (option of select.options; track option) {
                <mat-option [value]="option">{{ option }}</mat-option>
              }
            </mat-select>
          </mat-form-field>
        }

        <button mat-stroked-button (click)="reset()" [disabled]="activeCount() === 0">
          <mat-icon>clear</mat-icon>
          重置
        </button>

        @if (resultCount() !== null) {
          <mat-chip-set>
            <mat-chip highlighted>{{ resultCount() }} {{ countUnit() }}</mat-chip>
          </mat-chip-set>
        }

        <ng-content></ng-content>
      </div>
    </mat-card>
  `,
  styles: [
    `
      .filter-card {
        border-radius: 10px;
        margin-bottom: 14px;
      }
      .filter-row {
        display: flex;
        align-items: center;
        gap: 12px;
        flex-wrap: wrap;
      }
      .filter-keyword {
        min-width: 250px;
      }
      .filter-select {
        min-width: 180px;
      }
    `,
  ],
})
export class FilterBarComponent {
  readonly keywordLabel = input('关键字');
  readonly keywordPlaceholder = input('按名称 / 编号搜索');
  readonly keyword = input('');
  readonly selects = input<FilterSelectSpec[]>([]);
  readonly values = input<Record<string, string[]>>({});
  readonly resultCount = input<number | null>(null);
  readonly countUnit = input('条');

  readonly keywordChange = output<string>();
  readonly filtersChange = output<Record<string, string[]>>();

  private readonly localKeyword = signal('');

  readonly activeCount = computed(
    () =>
      (this.keyword().trim() ? 1 : 0) +
      Object.values(this.values()).filter((item) => item.length > 0).length,
  );

  /** 读取某字段的当前多选值（索引签名可能缺省，统一兜底为空数组） */
  selectedValues(key: string): string[] {
    return this.values()[key] ?? [];
  }

  onKeywordChange(value: string): void {
    this.localKeyword.set(value);
    this.keywordChange.emit(value);
  }

  onSelectChange(key: string, value: string | string[]): void {
    const next: Record<string, string[]> = { ...this.values() };
    next[key] = Array.isArray(value) ? value : value ? [value] : [];
    this.filtersChange.emit(next);
  }

  reset(): void {
    const cleared: Record<string, string[]> = {};
    for (const select of this.selects()) cleared[select.key] = [];
    this.keywordChange.emit('');
    this.filtersChange.emit(cleared);
  }
}
