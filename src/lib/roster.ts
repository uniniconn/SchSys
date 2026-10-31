import { parseCsv } from '@/lib/csv';
import { readXlsxFirstSheet } from '@/lib/xlsx';

export type RosterRow = { name: string; empNo?: string; dept?: string };

/** 姓名归一化：去空白、全角空格、常见不可见字符；用于同名匹配 */
export function normalizeName(name: string): string {
  return name
    .replace(/[\u3000\u00a0]/g, ' ')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

const NAME_HEADERS = ['姓名', '名字', 'name', '员工姓名', '人员姓名'];
const EMPNO_HEADERS = ['工号', '员工工号', '编号', '工号/编号', 'empno', 'employeeid', 'no'];
const DEPT_HEADERS = ['部门', '科室', '所属部门', 'dept', 'department'];

function findColumn(headers: string[], candidates: string[]): number {
  const normalized = headers.map((h) => h.replace(/\s+/g, '').toLowerCase());
  for (const candidate of candidates) {
    const idx = normalized.indexOf(candidate.replace(/\s+/g, '').toLowerCase());
    if (idx >= 0) return idx;
  }
  // 模糊包含
  for (let i = 0; i < normalized.length; i += 1) {
    if (candidates.some((candidate) => normalized[i].includes(candidate.toLowerCase()))) return i;
  }
  return -1;
}

/**
 * 解析名单表格（CSV / XLSX）。
 * 第一行必须是表头，至少包含“姓名”列，可选“工号”“部门”。
 */
export function parseRosterRows(rows: string[][]): { entries: RosterRow[]; errors: string[] } {
  const errors: string[] = [];
  if (rows.length === 0) return { entries: [], errors: ['文件为空'] };

  const headers = rows[0].map((h) => (h ?? '').trim());
  const nameIdx = findColumn(headers, NAME_HEADERS);
  if (nameIdx < 0) {
    errors.push(`表头中未找到“姓名”列。当前表头：${headers.join(' | ') || '(空)'}`);
    return { entries: [], errors };
  }
  const empNoIdx = findColumn(headers, EMPNO_HEADERS);
  const deptIdx = findColumn(headers, DEPT_HEADERS);

  const entries: RosterRow[] = [];
  const seen = new Set<string>();
  for (let i = 1; i < rows.length; i += 1) {
    const row = rows[i];
    const name = (row[nameIdx] ?? '').trim();
    if (!name) continue;
    const key = normalizeName(name);
    if (seen.has(key)) {
      errors.push(`第 ${i + 1} 行：姓名“${name}”重复，已跳过`);
      continue;
    }
    seen.add(key);
    entries.push({
      name,
      empNo: empNoIdx >= 0 ? (row[empNoIdx] ?? '').trim() || undefined : undefined,
      dept: deptIdx >= 0 ? (row[deptIdx] ?? '').trim() || undefined : undefined,
    });
  }
  if (entries.length === 0) errors.push('未解析到任何有效姓名');
  return { entries, errors };
}

/** 根据文件名/内容解析上传的名单文件 */
export async function parseRosterFile(fileName: string, buffer: Buffer): Promise<{ entries: RosterRow[]; errors: string[] }> {
  const lower = (fileName || '').toLowerCase();
  try {
    if (lower.endsWith('.xlsx')) {
      const rows = await readXlsxFirstSheet(buffer);
      return parseRosterRows(rows);
    }
    if (lower.endsWith('.xls')) {
      return { entries: [], errors: ['不支持旧版 .xls，请另存为 .xlsx 或 .csv 后重新上传'] };
    }
    // 默认按 CSV 文本解析（.csv / .txt）
    let text = buffer.toString('utf8');
    // 处理 GBK 等场景：如果替换字符过多，尝试 latin1 解码仅用于提示
    if (text.includes('\uFFFD')) {
      return { entries: [], errors: ['文件编码无法识别，请使用 UTF-8 编码的 CSV，或上传 .xlsx 文件'] };
    }
    text = text.replace(/^\uFEFF/, '');
    return parseRosterRows(parseCsv(text));
  } catch (error) {
    return { entries: [], errors: [`文件解析失败：${(error as Error).message}`] };
  }
}
