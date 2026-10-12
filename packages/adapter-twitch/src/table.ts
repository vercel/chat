/**
 * Twitch chat is one line, so multi-part output is joined with a visible
 * separator instead of line breaks that would collapse into plain spaces.
 */
export const PART_SEPARATOR = " · ";

/**
 * Flatten a table to one line of chat text.
 *
 * Each row renders as `Header: value, Header: value` (or just the values when
 * there is no header for a column), empty cells are skipped, and rows are
 * joined with ` · `.
 */
export function tableToTwitchText(headers: string[], rows: string[][]): string {
  const renderedRows: string[] = [];
  for (const row of rows) {
    const cells: string[] = [];
    for (const [index, cell] of row.entries()) {
      const value = cell.trim();
      if (!value) {
        continue;
      }
      const header = headers[index]?.trim();
      cells.push(header ? `${header}: ${value}` : value);
    }
    if (cells.length > 0) {
      renderedRows.push(cells.join(", "));
    }
  }
  return renderedRows.join(PART_SEPARATOR);
}
