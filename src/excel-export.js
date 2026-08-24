/**
 * excel-export.js — Excel 分配表生成 / 回收（统一使用 ExcelJS 引擎）
 *
 * 此前导出用 exceljs、导入用 xlsx，两个库全量 CDN 加载（约 1MB+）。
 * 实测 SheetJS 社区版（xlsx）在写入时忽略 dataValidation 与单元格样式，
 * 无法承担「下拉校验 + 列锁定 + 表头样式」，故统一保留 ExcelJS（读写均可），
 * 删除 xlsx。导入读取改用 ExcelJS。
 *
 * v2：在 member 列后新增 remark（备注）列，用户可填写备忘；回收时一并写回。
 */

export async function exportAssignments(lines, members, songTitle, type = 'assignment') {
  if (!window.ExcelJS) throw new Error('ExcelJS 引擎尚未加载');
  validateMembers(members);
  const workbook = new window.ExcelJS.Workbook();
  const sheet = workbook.addWorksheet(type === 'print' ? '分词表' : '歌词分配');
  const isPrint = type === 'print';
  sheet.columns = isPrint ? [
    { header: '行号', key: 'line_id', width: 10 },
    { header: '时间', key: 'time', width: 14 },
    { header: '歌词', key: 'text', width: 52 },
    { header: '成员', key: 'member', width: 16 },
    { header: '备注', key: 'remark', width: 24 },
  ] : [
    { header: '行号', key: 'line_id', width: 12 },
    { header: '时间', key: 'time', width: 14 },
    { header: '歌词', key: 'text', width: 48 },
    { header: '成员', key: 'member', width: 18 },
    { header: '备注', key: 'remark', width: 24 },
  ];
  const memberNames = new Map(members.map(m => [m.id, m.name]));
  const memberColors = new Map(members.map(m => [m.id, m.color]));
  lines.forEach(line => line.segments.forEach((segment, index) => {
    const ids = Array.isArray(segment.member_ids) ? segment.member_ids : (segment.member_id ? [segment.member_id] : []);
    const names = ids.map(id => memberNames.get(id)).filter(Boolean).join('·');
    sheet.addRow({
      line_id: line.segments.length > 1 ? `${line.line_id}${suffix(index)}` : line.line_id,
      time: line.time,
      text: segment.text,
      member: names,
      remark: segment.remark || '',
    });
  }));
  const names = members.map(m => m.name.replace(/"/g, '')).filter(Boolean).join(',');
  const lastRow = lines.reduce((sum, line) => sum + Math.max(1, line.segments.length), 0) + 1;

  sheet.eachRow((row, index) => {
    if (index === 1) {
      row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0052D9' } };
      row.eachCell(cell => { cell.protection = { locked: true }; });
      return;
    }
    if (isPrint) {
      // 打印分词表：有成员的歌词行加粗 + 成员颜色
      const memberCell = row.getCell(4).value;
      if (memberCell && String(memberCell).trim()) {
        const firstMemberName = String(memberCell).split('·')[0].trim();
        const member = members.find(m => m.name === firstMemberName);
        if (member) {
          const colorHex = hexToArgb(member.color);
          row.getCell(3).font = { bold: true, color: { argb: colorHex } };
          row.getCell(4).font = { bold: true, color: { argb: colorHex } };
        } else {
          row.getCell(3).font = { bold: true };
        }
      }
      row.getCell(1).protection = { locked: true };
      row.getCell(2).protection = { locked: true };
      row.getCell(3).protection = { locked: true };
      row.getCell(4).protection = { locked: true };
      row.getCell(5).protection = { locked: true };
      return;
    }
    row.getCell(1).protection = { locked: true };
    row.getCell(2).protection = { locked: true };
    row.getCell(3).protection = { locked: true };
    row.getCell(4).protection = { locked: false };
    row.getCell(4).dataValidation = { type: 'list', allowBlank: true, formulae: [`"${names}"`] };
    row.getCell(5).protection = { locked: false };
  });

  if (isPrint) {
    // 添加工程信息
    sheet.spliceRows(1, 0, [
      [songTitle || '未命名歌曲', '', '', '', ''],
      [`成员：${members.map(m => m.name).join('、')}`, '', '', '', ''],
      ['', '', '', '', ''],
    ]);
    sheet.mergeCells('A1:E1');
    sheet.mergeCells('A2:E2');
    sheet.getCell('A1').font = { bold: true, size: 16 };
    sheet.getCell('A1').alignment = { horizontal: 'center' };
    sheet.getCell('A2').font = { size: 11, color: { argb: 'FF666666' } };
    sheet.getCell('A2').alignment = { horizontal: 'center' };
  }

  if (!isPrint) {
    members.forEach(member => {
      sheet.addConditionalFormatting({
        ref: `A2:E${lastRow}`,
        rules: [{
          type: 'expression',
          formulae: [`$D2="${member.name.replace(/"/g, '""')}"`],
          style: { fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: hexToArgb(member.color) } } },
          priority: 1,
        }],
      });
    });
    sheet.autoFilter = `A1:E${lastRow}`;
    await sheet.protect('', { selectLockedCells: false, selectUnlockedCells: true, formatCells: false, formatColumns: false, formatRows: false, insertColumns: false, insertRows: false, deleteColumns: false, deleteRows: false, sort: false, autoFilter: true });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
  link.download = `${songTitle || '歌词分配'}_${isPrint ? '分词表' : '分配表'}.xlsx`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 500);
}

export async function importAssignments(file, members, lines = []) {
  if (!window.ExcelJS) throw new Error('Excel 读取引擎尚未加载');
  validateMembers(members);
  const workbook = new window.ExcelJS.Workbook();
  await workbook.xlsx.load(await file.arrayBuffer());
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error('Excel 文件为空或没有工作表');
  const rows = [];
  sheet.eachRow({ includeEmpty: false }, row => {
    const values = [];
    for (let c = 1; c <= 5; c++) values.push(cellValueToString(row.getCell(c).value));
    rows.push(values);
  });
  if (!rows.length) throw new Error('Excel 文件为空');
  const header = rows[0].join('|');
  // 表头契约：中文（新版）或英文（旧版），remark/备注列可选
  const CN4 = '行号|时间|歌词|成员';
  const CN5 = '行号|时间|歌词|成员|备注';
  const EN4 = 'line_id|time|text|member';
  const EN5 = 'line_id|time|text|member|remark';
  if (![CN4, CN5, EN4, EN5].includes(header)) {
    throw new Error('表头不符合 行号 / 时间 / 歌词 / 成员 / 备注 契约');
  }
  const hasRemark = header === CN5 || header === EN5;
  const names = new Map(members.map(m => [m.name, m]));
  const known = new Set(lines.map(line => line.line_id));
  const seen = new Set();
  const errors = [];
  const assignments = [];
  rows.slice(1).forEach((row, index) => {
    if (!row[0]) return;
    const lineId = String(row[0]).trim();
    const baseId = lineId.replace(/[a-z]+$/i, '');
    const time = String(row[1]).trim();
    const text = String(row[2] ?? '');
    const member = String(row[3] || '').trim();
    const remark = hasRemark ? String(row[4] ?? '').trim() : '';
    if (seen.has(lineId)) errors.push(`第 ${index + 2} 行：line_id 重复“${lineId}”`);
    seen.add(lineId);
    if (known.size && !known.has(baseId)) errors.push(`第 ${index + 2} 行：未知歌词行“${lineId}”`);
    if (!/^\d{2}:\d{2}\.\d{3}$/.test(time)) errors.push(`第 ${index + 2} 行：时间必须为 mm:ss.xxx`);
    if (member && member.split('·').some(name => !names.has(name))) errors.push(`第 ${index + 2} 行：未识别成员名“${member}”`);
    assignments.push({ line_id: lineId, base_id: baseId, time, text, member: member || null, remark });
  });
  return { assignments, errors };
}

function cellValueToString(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if (Array.isArray(value.richText)) return value.richText.map(r => r?.text ?? '').join('');
    if (value.result !== undefined) return String(value.result);
    if (value.text !== undefined) return String(value.text);
    return '';
  }
  return String(value);
}

function suffix(index) {
  let value = index + 1, result = '';
  while (value) { value -= 1; result = String.fromCharCode(97 + value % 26) + result; value = Math.floor(value / 26); }
  return result;
}

function validateMembers(members) {
  const names = members.map(m => m.name.trim());
  if (names.some(name => !name)) throw new Error('成员姓名不能为空');
  if (new Set(names).size !== names.length) throw new Error('成员姓名不能重复，否则 Excel 无法准确回收');
}

function hexToArgb(hex) {
  const clean = String(hex || '').replace('#', '');
  const full = clean.length === 3 ? clean.split('').map(c => c + c).join('') : clean;
  return `FF${(full || '999999').toUpperCase()}`;
}
