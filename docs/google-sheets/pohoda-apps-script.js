/* eslint-disable @typescript-eslint/no-unused-vars */

const POHODA_API_BASE = 'https://SEM_DAJ_DOMENU_APLIKACIE';
const POHODA_TOKEN = 'SEM_DAJ_GOOGLE_SHEETS_IMPORT_TOKEN';

const HEADER_ROW = 1;
const COLUMNS = {
  meno: 'meno',
  priezvisko: 'priezvisko',
  email: 'email',
  telefon: 'telefon',
  strava: 'strava',
  skupina: 'skupina',
  od: 'od',
  do: 'do',
  obed: 'obed',
  vecera: 'vecera',
  qr: 'qr',
  stav: 'stav',
  sprava: 'sprava',
  userId: 'user_id',
  qrKod: 'qr_kod',
  skupinyApp: 'skupiny_app',
  narokDni: 'narok_dni',
  obedy: 'obedy',
  vecere: 'vecere',
  aktualizovane: 'aktualizovane'
};

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('POHODA')
    .addItem('Importovať označené riadky', 'importSelectedRows')
    .addItem('Importovať READY riadky', 'importReadyRows')
    .addSeparator()
    .addItem('Aktualizovať označené riadky', 'syncSelectedRows')
    .addItem('Aktualizovať všetky riadky s user_id', 'syncRowsWithUserId')
    .addToUi();
}

function getSheetData_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const values = sheet.getDataRange().getValues();

  if (values.length < HEADER_ROW) {
    throw new Error('Tabuľka nemá hlavičku.');
  }

  const headers = values[HEADER_ROW - 1].map(value => normalizeHeader_(value));
  const headerMap = {};

  headers.forEach((header, index) => {
    if (header) headerMap[header] = index + 1;
  });

  ensureColumns_(sheet, headerMap, [
    COLUMNS.stav,
    COLUMNS.sprava,
    COLUMNS.userId,
    COLUMNS.qrKod,
    COLUMNS.skupinyApp,
    COLUMNS.narokDni,
    COLUMNS.obedy,
    COLUMNS.vecere,
    COLUMNS.aktualizovane
  ]);

  const refreshedValues = sheet.getDataRange().getValues();
  const refreshedHeaders = refreshedValues[HEADER_ROW - 1].map(value => normalizeHeader_(value));
  const refreshedHeaderMap = {};

  refreshedHeaders.forEach((header, index) => {
    if (header) refreshedHeaderMap[header] = index + 1;
  });

  return {
    sheet,
    values: refreshedValues,
    headerMap: refreshedHeaderMap
  };
}

function ensureColumns_(sheet, headerMap, names) {
  let lastColumn = sheet.getLastColumn();

  names.forEach(name => {
    const normalized = normalizeHeader_(name);

    if (headerMap[normalized]) return;

    lastColumn += 1;
    sheet.getRange(HEADER_ROW, lastColumn).setValue(name);
    headerMap[normalized] = lastColumn;
  });
}

function normalizeHeader_(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function cell_(rowValues, headerMap, name) {
  const column = headerMap[normalizeHeader_(name)];
  if (!column) return '';
  return rowValues[column - 1] || '';
}

function setCell_(sheet, rowNumber, headerMap, name, value) {
  const column = headerMap[normalizeHeader_(name)];
  if (!column) return;
  sheet.getRange(rowNumber, column).setValue(value);
}

function setTimestampCell_(sheet, rowNumber, headerMap, name) {
  const column = headerMap[normalizeHeader_(name)];
  if (!column) return;

  sheet
    .getRange(rowNumber, column)
    .setValue(new Date())
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function rowToPayload_(rowNumber, rowValues, headerMap) {
  return {
    rowNumber,
    meno: cell_(rowValues, headerMap, COLUMNS.meno),
    priezvisko: cell_(rowValues, headerMap, COLUMNS.priezvisko),
    email: cell_(rowValues, headerMap, COLUMNS.email),
    telefon: cell_(rowValues, headerMap, COLUMNS.telefon),
    strava: cell_(rowValues, headerMap, COLUMNS.strava),
    skupina: cell_(rowValues, headerMap, COLUMNS.skupina),
    od: cell_(rowValues, headerMap, COLUMNS.od),
    do: cell_(rowValues, headerMap, COLUMNS.do),
    obed: cell_(rowValues, headerMap, COLUMNS.obed),
    vecera: cell_(rowValues, headerMap, COLUMNS.vecera),
    qr: cell_(rowValues, headerMap, COLUMNS.qr),
    userId: cell_(rowValues, headerMap, COLUMNS.userId),
    qrKod: cell_(rowValues, headerMap, COLUMNS.qrKod)
  };
}

function selectedRowNumbers_() {
  const range = SpreadsheetApp.getActiveRange();
  if (!range) return [];

  const start = Math.max(range.getRow(), HEADER_ROW + 1);
  const end = range.getLastRow();
  const rows = [];

  for (let row = start; row <= end; row += 1) {
    rows.push(row);
  }

  return rows;
}

function readyRowNumbers_(data) {
  const rows = [];
  const stavColumn = data.headerMap[normalizeHeader_(COLUMNS.stav)];

  for (let row = HEADER_ROW + 1; row <= data.values.length; row += 1) {
    const status = String(stavColumn ? data.values[row - 1][stavColumn - 1] : '').trim().toUpperCase();
    if (!status || status === 'READY') rows.push(row);
  }

  return rows;
}

function rowsWithUserId_(data) {
  const rows = [];
  const userIdColumn = data.headerMap[normalizeHeader_(COLUMNS.userId)];

  if (!userIdColumn) return rows;

  for (let row = HEADER_ROW + 1; row <= data.values.length; row += 1) {
    const userId = String(data.values[row - 1][userIdColumn - 1] || '').trim();
    if (userId) rows.push(row);
  }

  return rows;
}

function importSelectedRows() {
  importRows_(selectedRowNumbers_());
}

function importReadyRows() {
  const data = getSheetData_();
  importRows_(readyRowNumbers_(data), data);
}

function importRows_(rowNumbers, existingData) {
  const data = existingData || getSheetData_();
  const rows = rowNumbers
    .filter(rowNumber => rowNumber > HEADER_ROW)
    .map(rowNumber => rowToPayload_(rowNumber, data.values[rowNumber - 1], data.headerMap));

  if (!rows.length) {
    SpreadsheetApp.getUi().alert('Nie sú vybrané žiadne dátové riadky.');
    return;
  }

  const response = callApi_('/api/personalista/google-sheets/import-batch', { rows });
  writeImportResults_(data.sheet, data.headerMap, response.results || []);
}

function writeImportResults_(sheet, headerMap, results) {
  results.forEach(result => {
    if (!result.rowNumber) return;

    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.stav, result.status || '');
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.sprava, result.message || '');
    if (result.userId) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.userId, result.userId);
    if (result.qrCode) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.qrKod, result.qrCode);
    setTimestampCell_(sheet, result.rowNumber, headerMap, COLUMNS.aktualizovane);
  });
}

function syncSelectedRows() {
  syncRows_(selectedRowNumbers_());
}

function syncRowsWithUserId() {
  const data = getSheetData_();
  syncRows_(rowsWithUserId_(data), data);
}

function syncRows_(rowNumbers, existingData) {
  const data = existingData || getSheetData_();
  const rows = rowNumbers
    .filter(rowNumber => rowNumber > HEADER_ROW)
    .map(rowNumber => rowToPayload_(rowNumber, data.values[rowNumber - 1], data.headerMap));

  if (!rows.length) {
    SpreadsheetApp.getUi().alert('Nie sú vybrané žiadne dátové riadky.');
    return;
  }

  const response = callApi_('/api/personalista/google-sheets/sync-batch', { rows });
  writeSyncResults_(data.sheet, data.headerMap, response.results || []);
}

function writeSyncResults_(sheet, headerMap, results) {
  results.forEach(result => {
    if (!result.rowNumber) return;

    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.stav, result.status || '');
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.sprava, result.message || '');
    if (result.userId) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.userId, result.userId);
    if (result.meno) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.meno, result.meno);
    if (result.priezvisko) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.priezvisko, result.priezvisko);
    if (result.email) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.email, result.email);
    if (result.telefon) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.telefon, result.telefon);
    if (result.typStravy) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.strava, result.typStravy);
    if (result.qrCode) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.qrKod, result.qrCode);
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.skupinyApp, result.groups || '');
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.narokDni, result.entitlementDays || 0);
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.obedy, result.lunchClaims || 0);
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.vecere, result.dinnerClaims || 0);
    setTimestampCell_(sheet, result.rowNumber, headerMap, COLUMNS.aktualizovane);
  });
}

function callApi_(path, payload) {
  const response = UrlFetchApp.fetch(POHODA_API_BASE.replace(/\/$/, '') + path, {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'x-pohoda-token': POHODA_TOKEN
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });

  const text = response.getContentText();
  const json = text ? JSON.parse(text) : {};

  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300 || json.error) {
    throw new Error(json.error || 'API chyba: ' + response.getResponseCode());
  }

  return json;
}
