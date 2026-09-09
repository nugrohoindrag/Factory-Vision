/**
 * Client-side CSV export for the reports whose rows the console already holds.
 *
 * The four v1.7 reports export through a server endpoint, which is right for
 * them: they are unbounded, and the server can stream. The improvement's five
 * are already fetched and already filtered by the date range on screen, so
 * asking the server to compute them a second time would risk exporting
 * something other than what the user is looking at — the one thing an export
 * must never do.
 */

/** A column as the export sees it: a heading and a way to read one cell. */
export interface CsvColumn<T> {
  header: string;
  value: (row: T) => string | number | undefined | null;
}

/**
 * Escapes one field for RFC 4180.
 *
 * A leading `=`, `+`, `-` or `@` is prefixed with an apostrophe: Excel treats
 * such a value as a formula, and a material named `-RM-001` would otherwise
 * execute rather than display. The apostrophe is Excel's own escape and is not
 * shown in the cell.
 */
function escape(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const text = String(value);
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export function toCsv<T>(columns: CsvColumn<T>[], rows: T[]): string {
  const header = columns.map((column) => escape(column.header)).join(',');
  const body = rows.map((row) => columns.map((column) => escape(column.value(row))).join(','));
  return [header, ...body].join('\r\n');
}

/**
 * Saves a CSV to the user's machine.
 *
 * A BOM is prepended because Excel on a Windows machine — which is what a
 * plant office runs — reads a BOM-less UTF-8 file as ANSI and turns every
 * Indonesian name with an accent into mojibake.
 */
export function downloadCsv(filename: string, csv: string): void {
  const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename.endsWith('.csv') ? filename : `${filename}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

/** `laporan-material-2026-09-09.csv` — dated, so two exports never collide. */
export function reportFilename(key: string): string {
  return `laporan-${key}-${new Date().toISOString().slice(0, 10)}.csv`;
}
