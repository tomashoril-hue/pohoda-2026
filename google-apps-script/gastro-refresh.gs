var DEFAULT_GASTRO_EXPORT_URL = 'https://www.pohodapass.sk/api/gastro-export?year=2026';
var DEFAULT_GASTRO_SHEET_NAME = 'GASTRO_2026';
var HEADER_ROW = 1;
var DATE_MEAL_COLS = 3;
var PINNED_TOTAL_COL = 4;
var FIRST_GROUP_COL = PINNED_TOTAL_COL + 1;
var TOTAL_HEADER = 'SPOLU';

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('POHODA')
    .addItem('Refresh GASTRO_2026', 'refreshGastro2026')
    .addToUi();
}

function refreshGastro2026() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheetName = getScriptProperty('GASTRO_SHEET_NAME') || DEFAULT_GASTRO_SHEET_NAME;
  var sheet = ss.getSheetByName(sheetName);

  if (!sheet) {
    throw new Error('Harok ' + sheetName + ' neexistuje.');
  }

  ensurePinnedTotalColumn(sheet);

  var exportData = fetchGastroExport();
  var rebuild = rebuildGroupColumns(sheet, exportData.groups || []);
  var rows = rebuildDataRows(sheet, exportData, rebuild.totalCol);
  var rowMap = buildRowMap(sheet);
  var written = writeCounts(sheet, exportData, rowMap, rebuild.columnMap, rebuild.firstGroupCol, rebuild.lastGroupCol);

  refreshTotalFormulas(sheet, rebuild.firstGroupCol, rebuild.lastGroupCol, rebuild.totalCol);
  applyDaySeparators(sheet, rebuild.totalCol);

  SpreadsheetApp.getUi().alert(
    'GASTRO_2026 obnovene.\nSkupiny: ' +
    (exportData.groups || []).length +
    '\nRiadky datum/jedlo: ' +
    rows +
    '\nPolozky z API: ' +
    (exportData.items || []).length +
    '\nZapisane bunky: ' +
    written
  );
}

function normalizeText(value) {
  return String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
}

function normalizeMeal(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeGroupName(value) {
  return normalizeText(value).toLowerCase();
}

function normalizeDate(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  var text = normalizeText(value);
  var iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return text;

  var sk = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (sk) {
    return sk[3] + '-' + String(sk[2]).padStart(2, '0') + '-' + String(sk[1]).padStart(2, '0');
  }

  var parsed = new Date(text);
  if (!isNaN(parsed.getTime())) {
    return Utilities.formatDate(parsed, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }

  return '';
}

function dateToSheetValue(isoDate) {
  var match = normalizeDate(isoDate).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return isoDate || '';

  return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
}

function dayNameFromIsoDate(isoDate) {
  var date = dateToSheetValue(isoDate);
  if (Object.prototype.toString.call(date) !== '[object Date]' || isNaN(date.getTime())) return '';

  return ['Nedeľa', 'Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota'][date.getDay()];
}

function mealSortValue(meal) {
  var normalized = normalizeMeal(meal);
  if (normalized === 'obed mäso' || normalized === 'obed maso' || normalized === 'obed') return 1;
  if (normalized === 'obed vege' || normalized === 'obed v') return 2;
  if (normalized === 'obed diéta' || normalized === 'obed dieta') return 3;
  if (normalized === 'vecera maso' || normalized === 'večera mäso' || normalized === 'večera maso' || normalized === 'vecera' || normalized === 'večera') return 4;
  if (normalized === 'vecera vege' || normalized === 'večera vege' || normalized === 'vecera v' || normalized === 'večera v') return 5;
  if (normalized === 'vecera diéta' || normalized === 'vecera dieta' || normalized === 'večera diéta' || normalized === 'večera dieta') return 6;
  return 99;
}

function columnToLetter(columnNumber) {
  var letter = '';
  var temp = columnNumber;

  while (temp > 0) {
    var remainder = (temp - 1) % 26;
    letter = String.fromCharCode(65 + remainder) + letter;
    temp = Math.floor((temp - remainder) / 26);
  }

  return letter;
}

function getScriptProperty(name) {
  return PropertiesService.getScriptProperties().getProperty(name);
}

function fetchGastroExport() {
  var url = getScriptProperty('GASTRO_EXPORT_URL') || DEFAULT_GASTRO_EXPORT_URL;
  var token = getScriptProperty('GASTRO_EXPORT_TOKEN');

  if (!token) {
    throw new Error('Script Property GASTRO_EXPORT_TOKEN nie je nastavena.');
  }

  var response = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Authorization: 'Bearer ' + token
    }
  });
  var code = response.getResponseCode();
  var text = response.getContentText();

  if (code < 200 || code >= 300) {
    throw new Error('Gastro export zlyhal (' + code + '): ' + text);
  }

  var data = JSON.parse(text);

  if (!Array.isArray(data.groups) || !Array.isArray(data.items)) {
    throw new Error('Gastro export vratil neplatny JSON.');
  }

  return data;
}

function findTotalColumn(sheet) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];

  for (var index = headers.length - 1; index >= 0; index--) {
    if (normalizeText(headers[index]).toUpperCase() === TOTAL_HEADER) {
      return index + 1;
    }
  }

  throw new Error('Stlpec SPOLU sa nenasiel v riadku 1.');
}

function ensurePinnedTotalColumn(sheet) {
  var pinnedHeader = normalizeText(sheet.getRange(HEADER_ROW, PINNED_TOTAL_COL).getValue()).toUpperCase();

  if (pinnedHeader !== TOTAL_HEADER) {
    var totalCol = findTotalColumn(sheet);
    sheet.insertColumnBefore(PINNED_TOTAL_COL);
    if (totalCol >= PINNED_TOTAL_COL) totalCol += 1;

    sheet
      .getRange(1, totalCol, sheet.getMaxRows(), 1)
      .copyTo(sheet.getRange(1, PINNED_TOTAL_COL, sheet.getMaxRows(), 1), { formatOnly: true });
    sheet.getRange(HEADER_ROW, PINNED_TOTAL_COL).setValue(TOTAL_HEADER);
  }

  sheet.setFrozenColumns(PINNED_TOTAL_COL);
}

function rebuildGroupColumns(sheet, groups) {
  var maxRows = sheet.getMaxRows();
  var totalCol = findTotalColumn(sheet);
  var oldGroupCount = Math.max(0, totalCol - FIRST_GROUP_COL);
  var templateCol = oldGroupCount > 0 ? FIRST_GROUP_COL : totalCol;
  var maxCols = sheet.getMaxColumns();

  sheet.insertColumnAfter(maxCols);
  var tempFormatCol = maxCols + 1;
  sheet
    .getRange(1, templateCol, maxRows, 1)
    .copyTo(sheet.getRange(1, tempFormatCol, maxRows, 1), { formatOnly: true });

  if (oldGroupCount > 0) {
    sheet.deleteColumns(FIRST_GROUP_COL, oldGroupCount);
    tempFormatCol -= oldGroupCount;
  }

  var currentTotalCol = FIRST_GROUP_COL;
  var groupCount = groups.length;
  var firstGroupCol = FIRST_GROUP_COL;
  var lastGroupCol = FIRST_GROUP_COL - 1;

  if (groupCount > 0) {
    sheet.insertColumnsBefore(currentTotalCol, groupCount);
    tempFormatCol += groupCount;
    lastGroupCol = firstGroupCol + groupCount - 1;

    for (var col = firstGroupCol; col <= lastGroupCol; col++) {
      sheet
        .getRange(1, tempFormatCol, maxRows, 1)
        .copyTo(sheet.getRange(1, col, maxRows, 1), { formatOnly: true });
    }

    var headers = groups.map(function(group) {
      return group.sheetColumnName || group.name || '';
    });
    sheet.getRange(HEADER_ROW, firstGroupCol, 1, groupCount).setValues([headers]);

    var dataRows = Math.max(0, sheet.getLastRow() - HEADER_ROW);
    if (dataRows > 0) {
      sheet.getRange(HEADER_ROW + 1, firstGroupCol, dataRows, groupCount).clearContent();
    }
  }

  sheet.deleteColumn(tempFormatCol);

  var totalColAfter = FIRST_GROUP_COL + groupCount;
  var columnMap = {};

  groups.forEach(function(group, index) {
    var key = normalizeGroupName(group.sheetColumnName || group.name);
    if (key) columnMap[key] = firstGroupCol + index;
  });

  return {
    firstGroupCol: firstGroupCol,
    lastGroupCol: lastGroupCol,
    totalCol: totalColAfter,
    columnMap: columnMap
  };
}

function buildExportRows(exportData) {
  if (Array.isArray(exportData.rows) && exportData.rows.length > 0) {
    return exportData.rows.slice().sort(function(a, b) {
      var dateCompare = normalizeDate(a.date).localeCompare(normalizeDate(b.date));
      if (dateCompare !== 0) return dateCompare;

      return mealSortValue(a.meal) - mealSortValue(b.meal);
    });
  }

  var seen = {};

  (exportData.items || []).forEach(function(item) {
    var date = normalizeDate(item.date);
    var meal = normalizeText(item.meal);

    if (!date || !meal) return;

    seen[date + '|' + normalizeMeal(meal)] = {
      date: date,
      day: dayNameFromIsoDate(date),
      meal: meal
    };
  });

  return Object.keys(seen)
    .map(function(key) {
      return seen[key];
    })
    .sort(function(a, b) {
      var dateCompare = a.date.localeCompare(b.date);
      if (dateCompare !== 0) return dateCompare;

      return mealSortValue(a.meal) - mealSortValue(b.meal);
    });
}

function rebuildDataRows(sheet, exportData, totalCol) {
  var rows = buildExportRows(exportData);
  var desiredRows = rows.length;
  var currentRows = Math.max(0, sheet.getLastRow() - HEADER_ROW);

  if (currentRows > desiredRows) {
    sheet.deleteRows(HEADER_ROW + desiredRows + 1, currentRows - desiredRows);
  } else if (currentRows < desiredRows) {
    sheet.insertRowsAfter(HEADER_ROW + currentRows, desiredRows - currentRows);
  }

  if (desiredRows === 0) return 0;

  var templateRow = HEADER_ROW + 1;
  sheet
    .getRange(templateRow, 1, 1, totalCol)
    .copyTo(sheet.getRange(HEADER_ROW + 1, 1, desiredRows, totalCol), { formatOnly: true });

  sheet.getRange(HEADER_ROW + 1, 1, desiredRows, totalCol).clearContent();

  var values = rows.map(function(row) {
    var date = normalizeDate(row.date);

    return [
      dayNameFromIsoDate(date),
      dateToSheetValue(date),
      row.meal || ''
    ];
  });

  sheet.getRange(HEADER_ROW + 1, 1, desiredRows, DATE_MEAL_COLS).setValues(values);
  sheet.getRange(HEADER_ROW + 1, 2, desiredRows, 1).setNumberFormat('dd.mm.yyyy');

  return desiredRows;
}

function buildRowMap(sheet) {
  var lastRow = sheet.getLastRow();
  var rowMap = {};

  if (lastRow <= HEADER_ROW) return rowMap;

  var values = sheet.getRange(HEADER_ROW + 1, 1, lastRow - HEADER_ROW, DATE_MEAL_COLS).getValues();

  values.forEach(function(row, index) {
    var date = normalizeDate(row[1]);
    var meal = normalizeMeal(row[2]);

    if (!date || !meal) return;

    rowMap[date + '|' + meal] = HEADER_ROW + 1 + index;
  });

  return rowMap;
}

function writeCounts(sheet, exportData, rowMap, columnMap, firstGroupCol, lastGroupCol) {
  if (lastGroupCol < firstGroupCol) {
    (exportData.items || []).forEach(function(item) {
      Logger.log('Ignored item without group columns: ' + JSON.stringify(item));
    });
    return 0;
  }

  var dataRows = Math.max(0, sheet.getLastRow() - HEADER_ROW);
  var groupCols = lastGroupCol - firstGroupCol + 1;
  var matrix = [];

  for (var r = 0; r < dataRows; r++) {
    var row = [];
    for (var c = 0; c < groupCols; c++) row.push('');
    matrix.push(row);
  }

  var written = 0;

  (exportData.items || []).forEach(function(item) {
    var rowKey = normalizeDate(item.date) + '|' + normalizeMeal(item.meal);
    var sheetRow = rowMap[rowKey];

    if (!sheetRow) {
      Logger.log('No matching date/meal row for item: ' + JSON.stringify(item));
      return;
    }

    var groupKey = normalizeGroupName(item.groupName);
    var sheetCol = columnMap[groupKey];

    if (!sheetCol) {
      Logger.log('No matching group column for item: ' + JSON.stringify(item));
      return;
    }

    var rowIndex = sheetRow - HEADER_ROW - 1;
    var colIndex = sheetCol - firstGroupCol;
    var count = Number(item.count || 0);

    if (!isFinite(count)) count = 0;

    matrix[rowIndex][colIndex] = Number(matrix[rowIndex][colIndex] || 0) + count;
    written += 1;
  });

  if (dataRows > 0) {
    sheet.getRange(HEADER_ROW + 1, firstGroupCol, dataRows, groupCols).setValues(matrix);
  }

  return written;
}

function refreshTotalFormulas(sheet, firstGroupCol, lastGroupCol, totalCol) {
  var lastRow = sheet.getLastRow();
  var dataRows = Math.max(0, lastRow - HEADER_ROW);

  if (dataRows === 0) return;

  var formulas = [];

  for (var row = HEADER_ROW + 1; row <= lastRow; row++) {
    if (lastGroupCol < firstGroupCol) {
      formulas.push(['=0']);
      continue;
    }

    formulas.push([
      '=SUM(' +
      columnToLetter(firstGroupCol) +
      row +
      ':' +
      columnToLetter(lastGroupCol) +
      row +
      ')'
    ]);
  }

  sheet.getRange(HEADER_ROW + 1, PINNED_TOTAL_COL, dataRows, 1).setFormulas(formulas);
  sheet.getRange(HEADER_ROW + 1, totalCol, dataRows, 1).setFormulas(formulas);
}

function applyDaySeparators(sheet, totalCol) {
  var lastRow = sheet.getLastRow();
  var dataRows = Math.max(0, lastRow - HEADER_ROW);

  if (dataRows === 0) return;

  var firstDataRow = HEADER_ROW + 1;
  var dataRange = sheet.getRange(firstDataRow, 1, dataRows, totalCol);
  dataRange.setBorder(null, null, false, null, null, null);

  var dates = sheet.getRange(firstDataRow, 2, dataRows, 1).getValues();

  dates.forEach(function(row, index) {
    var currentDate = normalizeDate(row[0]);
    var nextDate = index + 1 < dates.length ? normalizeDate(dates[index + 1][0]) : '';

    if (!currentDate) return;
    if (currentDate === nextDate) return;

    sheet
      .getRange(firstDataRow + index, 1, 1, totalCol)
      .setBorder(null, null, true, null, null, null, '#777777', SpreadsheetApp.BorderStyle.SOLID);
  });
}
