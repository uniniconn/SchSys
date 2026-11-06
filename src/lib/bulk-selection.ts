import type { Choice } from './types.ts';

/** 批量填写选择的纯逻辑（填写端 UI 与测试共用） */

export type CellState = { choice: Choice | null; reason: string };
export type FillCellRef = { date: string; shiftId: string };

export type BulkScope =
  | { type: 'all' }
  | { type: 'row'; date: string }
  | { type: 'column'; shiftId: string }
  | { type: 'range'; dateStart: string; dateEnd: string }
  | { type: 'keys'; keys: string[] };

export function cellKey(date: string, shiftId: string): string {
  return `${date}|${shiftId}`;
}

export function scopeKeys(cells: FillCellRef[], scope: BulkScope): string[] {
  switch (scope.type) {
    case 'all':
      return cells.map((cell) => cellKey(cell.date, cell.shiftId));
    case 'row':
      return cells.filter((cell) => cell.date === scope.date).map((cell) => cellKey(cell.date, cell.shiftId));
    case 'column':
      return cells.filter((cell) => cell.shiftId === scope.shiftId).map((cell) => cellKey(cell.date, cell.shiftId));
    case 'range':
      return cells
        .filter((cell) => cell.date >= scope.dateStart && cell.date <= scope.dateEnd)
        .map((cell) => cellKey(cell.date, cell.shiftId));
    case 'keys':
      return [...new Set(scope.keys)];
    default:
      return [];
  }
}

/**
 * 批量应用选择：
 * - preferred / backup：清除理由
 * - unavailable：保留/使用传入的统一理由（批量“无法”必须提供理由）
 * 返回新的 state，不修改原对象。
 */
export function applyBulkChoice(
  state: Record<string, CellState>,
  keys: string[],
  choice: Choice,
  reason = '',
): Record<string, CellState> {
  const next: Record<string, CellState> = { ...state };
  for (const key of keys) {
    const previous = next[key];
    next[key] = {
      choice,
      reason: choice === 'unavailable' ? (reason || previous?.reason || '') : '',
    };
  }
  return next;
}

/** 把某个模板（如某一天）复制到目标范围 */
export function copyTemplate(
  state: Record<string, CellState>,
  template: Array<{ key: string; state: CellState }>,
  targetKeys: string[],
): Record<string, CellState> {
  if (template.length === 0) return state;
  const next = { ...state };
  targetKeys.forEach((key, index) => {
    const source = template[index % template.length];
    next[key] = { ...source.state };
  });
  return next;
}

/** 校验批量操作：批量“无法”必须填理由 */
export function validateBulk(choice: Choice, reason: string): string | null {
  if (choice === 'unavailable' && !reason.trim()) return '批量设置为“无法排班”时，必须填写统一理由';
  return null;
}
