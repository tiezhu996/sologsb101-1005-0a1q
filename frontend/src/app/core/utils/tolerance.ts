/** 同步偏差与限位阈值判定、超限等级计算 */

/** 超限等级 */
export type ToleranceLevel = 'ok' | 'watch' | 'exceed';

export const TOLERANCE_LEVEL_LABEL: Record<ToleranceLevel, string> = {
  ok: '正常',
  watch: '关注',
  exceed: '超限',
};

/** 同步偏差允许值（mm）：同步顶升时四角偏差控制要求 */
export const SYNC_TOLERANCE_MM = 1.5;

/** 同步偏差关注值（mm） */
export const SYNC_WATCH_MM = 0.8;

/** 应力关注值（MPa） */
export const STRESS_TOLERANCE_MPA = 12;

/** 同步偏差等级判定 */
export function syncLevel(deviationMm: number): ToleranceLevel {
  const abs = Math.abs(deviationMm);
  if (abs >= SYNC_TOLERANCE_MM) return 'exceed';
  if (abs >= SYNC_WATCH_MM) return 'watch';
  return 'ok';
}

/** 限位判定：位移是否超过限位值 */
export function limitLevel(displacementMm: number, limitMm: number): ToleranceLevel {
  if (limitMm <= 0) return 'ok';
  const ratio = Math.abs(displacementMm) / limitMm;
  if (ratio >= 1) return 'exceed';
  if (ratio >= 0.8) return 'watch';
  return 'ok';
}

/** 应力等级判定 */
export function stressLevel(stressMpa: number): ToleranceLevel {
  if (stressMpa >= STRESS_TOLERANCE_MPA) return 'exceed';
  if (stressMpa >= STRESS_TOLERANCE_MPA * 0.8) return 'watch';
  return 'ok';
}

/** 超限等级 → 颜色（十六进制，用于内联样式） */
export const TOLERANCE_HEX: Record<ToleranceLevel, string> = {
  ok: '#2e7d32',
  watch: '#ed6c02',
  exceed: '#c62828',
};

/** 超限等级 → Material 语义色名 */
export const TOLERANCE_COLOR: Record<ToleranceLevel, 'primary' | 'accent' | 'warn'> = {
  ok: 'primary',
  watch: 'accent',
  exceed: 'warn',
};

/** 综合判定：取位移与应力的最严等级 */
export function overallLevel(
  displacementMm: number,
  limitMm: number,
  stressMpa: number,
): ToleranceLevel {
  const levels: ToleranceLevel[] = [limitLevel(displacementMm, limitMm), stressLevel(stressMpa)];
  if (levels.includes('exceed')) return 'exceed';
  if (levels.includes('watch')) return 'watch';
  return 'ok';
}

/** 限位告警文案 */
export function limitAlertText(displacementMm: number, limitMm: number): string {
  const level = limitLevel(displacementMm, limitMm);
  if (level === 'exceed') return `位移 ${displacementMm.toFixed(2)} mm 已超过限位 ${limitMm} mm，立即停止顶升`;
  if (level === 'watch') return `位移已接近限位（${((displacementMm / limitMm) * 100).toFixed(0)}%），需连续监测`;
  return '位移在限位范围内';
}

/** 同步偏差提示文案 */
export function syncAlertText(deviationMm: number, requirement: string): string {
  const level = syncLevel(deviationMm);
  const base = `同步偏差 ${deviationMm.toFixed(2)} mm`;
  if (level === 'exceed') return `${base} 超过 ${SYNC_TOLERANCE_MM} mm 允许值，需调平后继续（${requirement}）`;
  if (level === 'watch') return `${base} 接近允许值，建议放慢顶升速度（${requirement}）`;
  return `${base} 满足同步要求（${requirement}）`;
}

/** 超限读数统计 */
export function countExceed<T extends { displacementMm: number; stressMpa: number }>(
  rows: T[],
  limitMm: number,
): { exceed: number; watch: number; ok: number } {
  let exceed = 0;
  let watch = 0;
  let ok = 0;
  for (const row of rows) {
    const level = overallLevel(row.displacementMm, limitMm, row.stressMpa);
    if (level === 'exceed') exceed += 1;
    else if (level === 'watch') watch += 1;
    else ok += 1;
  }
  return { exceed, watch, ok };
}
