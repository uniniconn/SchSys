import JSZip from 'jszip';

/**
 * 轻量 XLSX 读写（基于 jszip 直接操作 OOXML，零原生依赖）。
 * 写入：生成最小可用的 xlsx（内联字符串，兼容 Excel / WPS / LibreOffice）。
 * 读取：解析 sharedStrings 与 sheet1 的单元格，返回二维字符串数组。
 */

/* --------------------------------- 写入 --------------------------------- */

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export type SheetData = {
  name: string;
  rows: Array<Array<string | number | null | undefined>>;
  /** 表头行（加粗 + 冻结首行） */
  headerRow?: boolean;
  columnWidths?: number[];
};

export async function buildXlsx(sheets: SheetData[]): Promise<Buffer> {
  const zip = new JSZip();

  const sheetXmlList = sheets.map((sheet) => {
    const rowsXml = sheet.rows
      .map((row, rowIndex) => {
        const cells = row
          .map((cell, colIndex) => {
            if (cell === null || cell === undefined || cell === '') return '';
            const ref = `${columnName(colIndex)}${rowIndex + 1}`;
            const isHeader = sheet.headerRow && rowIndex === 0;
            if (typeof cell === 'number' && Number.isFinite(cell)) {
              return `<c r="${ref}"${isHeader ? ' s="1"' : ''}><v>${cell}</v></c>`;
            }
            return `<c r="${ref}" t="inlineStr"${isHeader ? ' s="1"' : ''}><is><t xml:space="preserve">${escapeXml(String(cell))}</t></is></c>`;
          })
          .join('');
        return `<row r="${rowIndex + 1}">${cells}</row>`;
      })
      .join('');

    const cols =
      sheet.columnWidths && sheet.columnWidths.length > 0
        ? `<cols>${sheet.columnWidths
            .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
            .join('')}</cols>`
        : '';

    const pane = sheet.headerRow
      ? '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
      : '';

    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${pane}${cols}<sheetData>${rowsXml}</sheetData></worksheet>`;
  });

  const workbookSheets = sheets
    .map((sheet, i) => `<sheet name="${escapeXml(sheet.name.slice(0, 31) || `Sheet${i + 1}`)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('');

  const workbookRels = sheets
    .map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
    .join('');

  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  );

  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
  );

  zip.file(
    'xl/workbook.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${workbookSheets}</sheets></workbook>`,
  );

  zip.file(
    'xl/_rels/workbook.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${workbookRels}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );

  zip.file(
    'xl/styles.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="2"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="11"/><name val="Microsoft YaHei"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>`,
  );

  sheets.forEach((_, i) => {
    zip.file(`xl/worksheets/sheet${i + 1}.xml`, sheetXmlList[i]);
  });

  const out = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  return out;
}

/* --------------------------------- 读取 --------------------------------- */

function decodeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&amp;/g, '&');
}

function columnIndexFromRef(ref: string): number {
  const letters = ref.replace(/[^A-Z]/gi, '').toUpperCase();
  let index = 0;
  for (const ch of letters) index = index * 26 + (ch.charCodeAt(0) - 64);
  return Math.max(0, index - 1);
}

/** 读取 xlsx 的第一个工作表，返回二维字符串数组（已去掉完全空行） */
export async function readXlsxFirstSheet(buffer: Buffer | Uint8Array): Promise<string[][]> {
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.keys(zip.files);

  // 解析 sharedStrings
  const sharedStrings: string[] = [];
  const sharedEntry = entries.find((name) => /xl\/sharedStrings\.xml$/i.test(name));
  if (sharedEntry) {
    const xml = await zip.file(sharedEntry)!.async('string');
    for (const match of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) {
      const chunk = match[1];
      const texts = [...chunk.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1]));
      sharedStrings.push(texts.join(''));
    }
  }

  // 找到第一个工作表的路径
  let sheetPath = entries.find((name) => /xl\/worksheets\/sheet1\.xml$/i.test(name));
  const workbookEntry = entries.find((name) => /xl\/workbook\.xml$/i.test(name));
  if (workbookEntry) {
    const workbookXml = await zip.file(workbookEntry)!.async('string');
    const firstSheet = workbookXml.match(/<sheet[^>]*r:id="([^"]+)"/i);
    const relsEntry = entries.find((name) => /xl\/_rels\/workbook\.xml\.rels$/i.test(name));
    if (firstSheet && relsEntry) {
      const relsXml = await zip.file(relsEntry)!.async('string');
      const rel = relsXml.match(new RegExp(`<Relationship[^>]*Id="${firstSheet[1]}"[^>]*>`, 'i'));
      const target = rel?.[0].match(/Target="([^"]+)"/i)?.[1];
      if (target) {
        const normalized = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
        if (entries.includes(normalized)) sheetPath = normalized;
      }
    }
  }
  if (!sheetPath) throw new Error('未在 XLSX 文件中找到工作表');

  const sheetXml = await zip.file(sheetPath)!.async('string');
  const rows: string[][] = [];

  for (const rowMatch of sheetXml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const rowXml = rowMatch[1];
    const cells: string[] = [];
    for (const cellMatch of rowXml.matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cellMatch[1];
      const body = cellMatch[2];
      const ref = attrs.match(/r="([A-Za-z]+\d+)"/)?.[1];
      const colIndex = ref ? columnIndexFromRef(ref) : cells.length;
      const type = attrs.match(/t="([^"]+)"/)?.[1] ?? 'n';
      let value = '';
      if (type === 'inlineStr') {
        value = [...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => decodeXml(m[1])).join('');
      } else if (type === 's') {
        const idx = Number(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '-1');
        value = sharedStrings[idx] ?? '';
      } else if (type === 'str') {
        value = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      } else {
        value = decodeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
      }
      while (cells.length < colIndex) cells.push('');
      cells[colIndex] = value.trim();
    }
    if (cells.some((cell) => cell !== '')) rows.push(cells);
  }

  return rows;
}
