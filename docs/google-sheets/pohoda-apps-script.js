/* eslint-disable @typescript-eslint/no-unused-vars */

const POHODA_API_BASE = 'https://SEM_DAJ_DOMENU_APLIKACIE';
const POHODA_TOKEN = 'SEM_DAJ_GOOGLE_SHEETS_IMPORT_TOKEN';

const HEADER_ROW = 1;
const VALIDATION_START_ROW = 2;
const VALIDATION_ROW_COUNT = 1000;
const UNSAVED_COLOR = '#fce5cd';
const LOCK_COLOR = '#f4cccc';
const CLEAN_COLOR = '#ffffff';
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
  qr: 'registracia_qr',
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
const EDITABLE_COLUMNS = [
  COLUMNS.meno,
  COLUMNS.priezvisko,
  COLUMNS.telefon,
  COLUMNS.strava,
  COLUMNS.skupina,
  COLUMNS.od,
  COLUMNS.do,
  COLUMNS.obed,
  COLUMNS.vecera
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('POHODA')
    .addItem('1. Nastavit vyberove zoznamy', 'setupDropdowns')
    .addSeparator()
    .addItem('2. Importovat oznacene nove riadky', 'importSelectedRows')
    .addItem('3. Importovat READY riadky', 'importReadyRows')
    .addSeparator()
    .addItem('4. Ulozit oznacene zmeny', 'saveSelectedRows')
    .addItem('5. Ulozit vsetky neulozene zmeny', 'saveUnsavedRows')
    .addSeparator()
    .addItem('Nacitat oznacene riadky z aplikacie', 'syncSelectedRows')
    .addItem('Nacitat vsetky riadky s user_id', 'syncRowsWithUserId')
    .addToUi();
}

function onEdit(e) {
  if (!e || !e.range) return;

  const range = e.range;
  const sheet = range.getSheet();
  const rowNumber = range.getRow();
  const columnNumber = range.getColumn();

  if (rowNumber <= HEADER_ROW) return;

  const data = getSheetData_();
  if (sheet.getSheetId() !== data.sheet.getSheetId()) return;

  const header = normalizeHeader_(data.values[HEADER_ROW - 1][columnNumber - 1]);
  const rowValues = data.values[rowNumber - 1];
  const userId = String(cell_(rowValues, data.headerMap, COLUMNS.userId)).trim();

  if (!userId) return;

  if (header === normalizeHeader_(COLUMNS.qr)) {
    range.setBackground(LOCK_COLOR);
    setStatusCell_(sheet, rowNumber, data.headerMap, 'LOCKED');
    setCell_(sheet, rowNumber, data.headerMap, COLUMNS.sprava, 'Registracia QR plati iba pri novom importe. Aktualny QR zmen v aplikacii.');
    return;
  }

  if (header === normalizeHeader_(COLUMNS.email)) {
    range.setBackground(LOCK_COLOR);
    setStatusCell_(sheet, rowNumber, data.headerMap, 'UNSAVED');
    setCell_(sheet, rowNumber, data.headerMap, COLUMNS.sprava, 'E-mail sa ulozi iba ak osoba v aplikacii este nema e-mail a novy e-mail nie je duplicitny.');
    return;
  }

  if (!EDITABLE_COLUMNS.map(normalizeHeader_).includes(header)) return;

  range.setBackground(UNSAVED_COLOR);
  setStatusCell_(sheet, rowNumber, data.headerMap, 'UNSAVED');
  setCell_(sheet, rowNumber, data.headerMap, COLUMNS.sprava, 'Zmeny nie su ulozene v aplikacii.');
}

function getSheetData_() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const values = sheet.getDataRange().getValues();

  if (values.length < HEADER_ROW) {
    throw new Error('Tabulka nema hlavicku.');
  }

  const headers = values[HEADER_ROW - 1].map(value => normalizeHeader_(value));
  const headerMap = {};

  headers.forEach((header, index) => {
    if (header) headerMap[header] = index + 1;
  });

  migrateOldQrHeader_(sheet, headerMap);

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

function migrateOldQrHeader_(sheet, headerMap) {
  const oldQr = normalizeHeader_('qr');
  const newQr = normalizeHeader_(COLUMNS.qr);

  if (headerMap[oldQr] && !headerMap[newQr]) {
    sheet.getRange(HEADER_ROW, headerMap[oldQr]).setValue(COLUMNS.qr);
    headerMap[newQr] = headerMap[oldQr];
    delete headerMap[oldQr];
  }
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

function setStatusCell_(sheet, rowNumber, headerMap, value) {
  const column = headerMap[normalizeHeader_(COLUMNS.stav)];
  if (!column) return;

  const status = String(value || '').toUpperCase();
  const color =
    status === 'OK' ? '#d9ead3' :
    status === 'ERROR' ? '#f4cccc' :
    status === 'UNSAVED' ? UNSAVED_COLOR :
    status === 'EMAIL_LOCKED' ? LOCK_COLOR :
    status === 'LOCKED' ? '#eeeeee' :
    status === 'READY' ? '#d9eaf7' :
    '#ffffff';

  sheet.getRange(rowNumber, column).setValue(value).setBackground(color);
}

function setTimestampCell_(sheet, rowNumber, headerMap, name) {
  const column = headerMap[normalizeHeader_(name)];
  if (!column) return;

  sheet
    .getRange(rowNumber, column)
    .setValue(new Date())
    .setNumberFormat('yyyy-mm-dd hh:mm:ss');
}

function applyDropdown_(sheet, headerMap, name, values, allowInvalid) {
  const column = headerMap[normalizeHeader_(name)];
  if (!column || !values || !values.length) return;

  const validation = SpreadsheetApp
    .newDataValidation()
    .requireValueInList(values, true)
    .setAllowInvalid(Boolean(allowInvalid))
    .build();

  sheet
    .getRange(VALIDATION_START_ROW, column, VALIDATION_ROW_COUNT, 1)
    .setDataValidation(validation);
}

function setupDropdowns() {
  const data = getSheetData_();
  const options = callApi_('/api/personalista/google-sheets/options', {});
  const groupNames = (options.groups || []).map(group => group.name).filter(Boolean);

  applyDropdown_(data.sheet, data.headerMap, COLUMNS.strava, options.foodTypes || ['MASO', 'VEGE', 'DIETA'], false);
  applyDropdown_(data.sheet, data.headerMap, COLUMNS.obed, options.yesNo || ['ANO', 'NIE'], false);
  applyDropdown_(data.sheet, data.headerMap, COLUMNS.vecera, options.yesNo || ['ANO', 'NIE'], false);
  applyDropdown_(data.sheet, data.headerMap, COLUMNS.qr, options.yesNo || ['ANO', 'NIE'], false);
  applyDropdown_(data.sheet, data.headerMap, COLUMNS.stav, options.statuses || ['READY', 'UNSAVED', 'OK', 'ERROR', 'EMAIL_LOCKED', 'LOCKED'], false);
  applyDropdown_(data.sheet, data.headerMap, COLUMNS.skupina, groupNames, true);

  SpreadsheetApp.getUi().alert('Vyberove zoznamy boli nastavene.');
}

function clearRowHighlights_(sheet, rowNumber, headerMap) {
  EDITABLE_COLUMNS.forEach(name => {
    const column = headerMap[normalizeHeader_(name)];
    if (column) sheet.getRange(rowNumber, column).setBackground(CLEAN_COLOR);
  });

  const emailColumn = headerMap[normalizeHeader_(COLUMNS.email)];
  if (emailColumn) sheet.getRange(rowNumber, emailColumn).setBackground(CLEAN_COLOR);

  const registrationQrColumn = headerMap[normalizeHeader_(COLUMNS.qr)];
  if (registrationQrColumn) sheet.getRange(rowNumber, registrationQrColumn).setBackground(CLEAN_COLOR);
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
    registracia_qr: cell_(rowValues, headerMap, COLUMNS.qr),
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
  const userIdColumn = data.headerMap[normalizeHeader_(COLUMNS.userId)];

  for (let row = HEADER_ROW + 1; row <= data.values.length; row += 1) {
    const status = String(stavColumn ? data.values[row - 1][stavColumn - 1] : '').trim().toUpperCase();
    const userId = String(userIdColumn ? data.values[row - 1][userIdColumn - 1] : '').trim();

    if (userId || status === 'OK' || status === 'LOCKED') continue;
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

function unsavedRowNumbers_(data) {
  const rows = [];
  const stavColumn = data.headerMap[normalizeHeader_(COLUMNS.stav)];
  const userIdColumn = data.headerMap[normalizeHeader_(COLUMNS.userId)];

  if (!stavColumn || !userIdColumn) return rows;

  for (let row = HEADER_ROW + 1; row <= data.values.length; row += 1) {
    const status = String(data.values[row - 1][stavColumn - 1] || '').trim().toUpperCase();
    const userId = String(data.values[row - 1][userIdColumn - 1] || '').trim();
    if (userId && status === 'UNSAVED') rows.push(row);
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
  const rows = [];

  rowNumbers
    .filter(rowNumber => rowNumber > HEADER_ROW)
    .forEach(rowNumber => {
      const rowValues = data.values[rowNumber - 1];
      const status = String(cell_(rowValues, data.headerMap, COLUMNS.stav)).trim().toUpperCase();
      const userId = String(cell_(rowValues, data.headerMap, COLUMNS.userId)).trim();

      if (userId || status === 'OK' || status === 'LOCKED') {
        setCell_(data.sheet, rowNumber, data.headerMap, COLUMNS.sprava, 'Riadok uz ma user_id alebo stav OK, import preskoceny.');
        setTimestampCell_(data.sheet, rowNumber, data.headerMap, COLUMNS.aktualizovane);
        return;
      }

      rows.push(rowToPayload_(rowNumber, rowValues, data.headerMap));
    });

  if (!rows.length) {
    SpreadsheetApp.getUi().alert('Nie su vybrane ziadne nove riadky na import.');
    return;
  }

  const response = callApi_('/api/personalista/google-sheets/import-batch', { rows });
  writeImportResults_(data.sheet, data.headerMap, response.results || []);
}

function saveSelectedRows() {
  saveRows_(selectedRowNumbers_());
}

function saveUnsavedRows() {
  const data = getSheetData_();
  saveRows_(unsavedRowNumbers_(data), data);
}

function saveRows_(rowNumbers, existingData) {
  const data = existingData || getSheetData_();
  const rows = rowNumbers
    .filter(rowNumber => rowNumber > HEADER_ROW)
    .filter(rowNumber => {
      const status = String(cell_(data.values[rowNumber - 1], data.headerMap, COLUMNS.stav)).trim().toUpperCase();
      return status !== 'LOCKED';
    })
    .map(rowNumber => rowToPayload_(rowNumber, data.values[rowNumber - 1], data.headerMap))
    .filter(row => String(row.userId || '').trim());

  if (!rows.length) {
    SpreadsheetApp.getUi().alert('Nie su vybrane ziadne riadky s user_id na ulozenie. Ak je stav LOCKED, najprv nacitaj riadok z aplikacie.');
    return;
  }

  const response = callApi_('/api/personalista/google-sheets/update-batch', { rows });
  writeSyncResults_(data.sheet, data.headerMap, response.results || []);
}

function writeImportResults_(sheet, headerMap, results) {
  results.forEach(result => {
    if (!result.rowNumber) return;

    setStatusCell_(sheet, result.rowNumber, headerMap, result.status || '');
    setCell_(sheet, result.rowNumber, headerMap, COLUMNS.sprava, result.message || '');
    if (result.userId) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.userId, result.userId);
    if (result.qrCode) setCell_(sheet, result.rowNumber, headerMap, COLUMNS.qrKod, result.qrCode);
    if (result.status === 'OK') clearRowHighlights_(sheet, result.rowNumber, headerMap);
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
    SpreadsheetApp.getUi().alert('Nie su vybrane ziadne datove riadky.');
    return;
  }

  const response = callApi_('/api/personalista/google-sheets/sync-batch', { rows });
  writeSyncResults_(data.sheet, data.headerMap, response.results || []);
}

function writeSyncResults_(sheet, headerMap, results) {
  results.forEach(result => {
    if (!result.rowNumber) return;

    setStatusCell_(sheet, result.rowNumber, headerMap, result.status || '');
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
    if (result.status === 'OK') clearRowHighlights_(sheet, result.rowNumber, headerMap);
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
