import { Component, input } from '@angular/core';
import { MatChipsModule } from '@angular/material/chips';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import {
  DISEASE_GRADE_LABEL,
  replacementAdvice,
  type DiseaseGrade,
} from '../../../core/types/bearing';
import {
  ACCEPTANCE_CONCLUSION_LABEL,
  type AcceptanceConclusion,
} from '../../../core/types/acceptance';

/**
 * <app-grade-tag> 等级 / 结论徽标
 * 按完好 / 轻微 / 较重 / 严重与合格 / 不合格渲染底色与图标，
 * 被支座评级页、顶升步骤页消费。
 */
@Component({
  selector: 'app-grade-tag',
  standalone: true,
  imports: [MatChipsModule, MatIconModule, MatTooltipModule],
  template: `
    <mat-chip-set>
      <mat-chip [class]="chipClass()" [matTooltip]="tooltip()">
        <mat-icon matChipAvatar>{{ iconName() }}</mat-icon>
        {{ label() }}
      </mat-chip>
      @if (sizeMm() !== null && sizeMm() !== undefined) {
        <mat-chip>{{ sizeMm() }} mm</mat-chip>
      }
    </mat-chip-set>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }
      mat-chip.grade-intact {
        background: #e8f5e9 !important;
        color: #1b5e20 !important;
      }
      mat-chip.grade-slight {
        background: #e0f2f1 !important;
        color: #00695c !important;
      }
      mat-chip.grade-moderate {
        background: #fff4e5 !important;
        color: #e65100 !important;
      }
      mat-chip.grade-severe {
        background: #fdecea !important;
        color: #b71c1c !important;
        font-weight: 600;
      }
      mat-chip.grade-pass {
        background: #e8f5e9 !important;
        color: #1b5e20 !important;
      }
      mat-chip.grade-fail {
        background: #fdecea !important;
        color: #b71c1c !important;
        font-weight: 600;
      }
    `,
  ],
})
export class GradeTagComponent {
  /** 病害等级（支座评级使用） */
  readonly grade = input<DiseaseGrade | null>(null);
  /** 验收结论（验收页使用） */
  readonly conclusion = input<AcceptanceConclusion | null>(null);
  /** 可选尺寸（mm） */
  readonly sizeMm = input<number | null>(null);

  label(): string {
    const conclusion = this.conclusion();
    if (conclusion) return ACCEPTANCE_CONCLUSION_LABEL[conclusion];
    const grade = this.grade();
    return grade ? DISEASE_GRADE_LABEL[grade] : '未评级';
  }

  chipClass(): string {
    const conclusion = this.conclusion();
    if (conclusion) return conclusion === 'pass' ? 'grade-pass' : 'grade-fail';
    const grade = this.grade();
    return grade ? `grade-${grade}` : 'grade-intact';
  }

  iconName(): string {
    const conclusion = this.conclusion();
    if (conclusion) return conclusion === 'pass' ? 'check_circle' : 'cancel';
    const grade = this.grade();
    if (grade === 'severe') return 'error';
    if (grade === 'moderate') return 'warning';
    if (grade === 'slight') return 'info';
    return 'verified';
  }

  tooltip(): string {
    const conclusion = this.conclusion();
    if (conclusion) {
      return conclusion === 'pass' ? '该分步验收结论为合格' : '该分步验收结论为不合格，需整改后复验';
    }
    const grade = this.grade();
    return grade ? replacementAdvice(grade) : '尚未评定病害等级';
  }
}
