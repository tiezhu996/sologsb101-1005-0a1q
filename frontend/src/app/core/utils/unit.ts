/** 单位换算与位移有效位格式化：毫米/米、兆帕/千牛 */

/** mm → m（保留 3 位） */
export function mmToM(mm: number): number {
  return Number((mm / 1000).toFixed(3));
}

/** m → mm */
export function mToMm(m: number): number {
  return Number((m * 1000).toFixed(1));
}

/** 位移格式化：小于 1mm 显示 0.01 位，否则 0.1 位 */
export function formatMm(mm: number): string {
  const abs = Math.abs(mm);
  if (abs < 1) return `${mm.toFixed(2)} mm`;
  return `${mm.toFixed(1)} mm`;
}

/** 顶升量格式化：带正负号 */
export function formatLift(mm: number): string {
  const sign = mm > 0 ? '+' : '';
  return `${sign}${formatMm(mm)}`;
}

/** 标高格式化：米，保留 3 位 */
export function formatElevation(m: number): string {
  return `${m.toFixed(3)} m`;
}

/** MPa → kN（按 1 MPa = 1 N/mm²，取有效承压面积 cm² 折算） */
export function mpaToKn(mpa: number, areaCm2: number): number {
  const areaMm2 = areaCm2 * 100;
  return Number(((mpa * areaMm2) / 1000).toFixed(2));
}

/** 应力格式化 */
export function formatStress(mpa: number): string {
  if (Math.abs(mpa) >= 100) return `${mpa.toFixed(0)} MPa`;
  return `${mpa.toFixed(2)} MPa`;
}

/** 应力格式化（千牛口径） */
export function formatStressKn(mpa: number, areaCm2 = 100): string {
  return `${mpaToKn(mpa, areaCm2).toFixed(1)} kN`;
}

/** 跨径组合格式化：3×30m → 全长 90 m */
export function formatSpanCombo(spanCombo: string, spans: number, spanM: number): string {
  return `${spanCombo}（${spans} 孔 × ${spanM} m）`;
}

/** 百分比 */
export function formatPercent(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

/** 占比计算 */
export function share(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0;
  return Number(((numerator / denominator) * 100).toFixed(1));
}
