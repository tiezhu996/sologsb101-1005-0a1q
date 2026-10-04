/** 整库 JSON 备份与导出（纯浏览器实现） */

/** 触发下载 JSON */
export function downloadJson(filename: string, data: unknown): void {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 触发下载 CSV（含 BOM，便于 Excel 识别中文） */
export function downloadCsv(filename: string, rows: Array<Array<string | number>>): void {
  const text = rows
    .map((row) =>
      row
        .map((cell) => {
          const value = String(cell);
          return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
        })
        .join(','),
    )
    .join('\n');
  const blob = new Blob([`\ufeff${text}`], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 读取用户选择的 JSON 文件 */
export async function readJsonFile<T>(file: File): Promise<T> {
  return JSON.parse(await file.text()) as T;
}

/** 带时间戳的备份文件名 */
export function backupFilename(prefix: string, now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${prefix}-${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(
    now.getHours(),
  )}${pad(now.getMinutes())}.json`;
}

/** 当前时间：yyyy-MM-dd HH:mm */
export function nowDateTime(now: Date = new Date()): string {
  const pad = (value: number): string => String(value).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(
    now.getMinutes(),
  )}`;
}

/** 今天日期：yyyy-MM-dd */
export function todayDate(now: Date = new Date()): string {
  return nowDateTime(now).slice(0, 10);
}

/** 日期偏移 */
export function shiftDate(days: number, from: Date = new Date()): string {
  const date = new Date(from.getTime());
  date.setDate(date.getDate() + days);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
