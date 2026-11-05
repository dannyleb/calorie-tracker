/**
 * One CSV cell. Quotes when needed, and neutralizes text that a spreadsheet
 * would run as a formula (=, +, -, @, tab, CR at the start), since food names
 * can come from crowd-sourced databases or the AI.
 */
export function csvCell(v: string | number): string {
  let s = String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export const csvRow = (cells: (string | number)[]) => cells.map(csvCell).join(',');
