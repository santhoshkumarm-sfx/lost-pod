import 'server-only';
import { sheets as sheetsApi } from '@googleapis/sheets';
import { googleAuth, SCOPES } from './auth';
import { bridgeConfigured, callBridge } from './bridge';

function client() {
  return sheetsApi({ version: 'v4', auth: googleAuth(SCOPES.sheets, 'sheets') });
}

/** Accepts a full Google Sheets URL or a bare workbook id. */
export function parseWorkbookId(input: string): string | null {
  const s = input.trim();
  const m = s.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]{20,})/);
  if (m) return m[1];
  return /^[a-zA-Z0-9-_]{20,}$/.test(s) ? s : null;
}

export interface WorkbookInfo {
  title: string;
  tabs: { title: string; rows: number; cols: number; hidden: boolean }[];
}

export async function getWorkbook(workbookId: string): Promise<WorkbookInfo> {
  if (bridgeConfigured()) return callBridge<WorkbookInfo>('workbook', { workbookId });
  const res = await client().spreadsheets.get({
    spreadsheetId: workbookId,
    fields: 'properties.title,sheets.properties(title,hidden,gridProperties(rowCount,columnCount))',
  });
  return {
    title: res.data.properties?.title ?? workbookId,
    tabs: (res.data.sheets ?? []).map((s) => ({
      title: s.properties?.title ?? '',
      rows: s.properties?.gridProperties?.rowCount ?? 0,
      cols: s.properties?.gridProperties?.columnCount ?? 0,
      hidden: !!s.properties?.hidden,
    })),
  };
}

const quote = (name: string) => `'${name.replace(/'/g, "''")}'`;

/**
 * Values exactly as shown in the sheet (FORMATTED_VALUE), so "17 Jul", "#REF!" and typed text
 * arrive the way the team wrote them; normalisation happens in the app.
 */
export async function readTab(workbookId: string, sheetName: string, maxRows?: number): Promise<string[][]> {
  if (bridgeConfigured()) {
    const rows = await callBridge<unknown[][]>('readTab', { workbookId, sheetName, maxRows: maxRows ?? null });
    return rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
  }
  const range = maxRows ? `${quote(sheetName)}!A1:ZZ${maxRows}` : quote(sheetName);
  const res = await client().spreadsheets.values.get({
    spreadsheetId: workbookId,
    range,
    valueRenderOption: 'FORMATTED_VALUE',
    majorDimension: 'ROWS',
  });
  return (res.data.values ?? []).map((r) => r.map((c) => (c == null ? '' : String(c))));
}
