// ═══════════════════════════════════════════════════════════════════════
// ALMA SALUD — Apps Script para Turismo Local / Atenciones a Domicilio
// ───────────────────────────────────────────────────────────────────────
// INSTRUCCIONES DE DEPLOY:
//   1. Creá una nueva Google Spreadsheet vacía
//   2. Extensions > Apps Script → pegá este código completo
//   3. Implementar > Nueva implementación > Aplicación web
//   4. Ejecutar como: "Yo (tu cuenta)"
//   5. Quién tiene acceso: "Cualquier persona"
//   6. Copiá la URL y reemplazá REEMPLAZAR_CON_TU_URL en los 2 HTML
//
// HOJAS QUE SE CREAN AUTOMÁTICAMENTE:
//   · Operativos — servicios / guardias creados desde el panel médico
//   · Pacientes  — historia clínica de cada paciente por operativo
//   · Atenciones — registros de atención médica
// ═══════════════════════════════════════════════════════════════════════

const OP_HEADERS = ['id', 'nombre', 'ubicacion', 'fechaCreacion'];

const PAC_HEADERS = [
  'operativoId', 'id', 'nombre', 'telefono', 'ubicacion',
  'fichaCompletada', 'fechaFicha',
  'edad', 'dni', 'sexo', 'grupoSanguineo', 'enfermedadesCronicas',
  'medicacion', 'alergias', 'cirugias',
  'contactoEmergenciaNombre', 'contactoEmergenciaTel',
  'obraSocial', 'numAfiliado', 'tutorNombre', 'tutorTel', 'obs'
];

const ATEN_HEADERS = [
  'operativoId', 'id', 'fecha', 'hora', 'ubicacion', 'profesional',
  'participanteId', 'participante',
  'edad', 'motivo', 'zona', 'diagnostico', 'atencion',
  'derivacion', 'derDetalle', 'obs', 'fechaRegistro'
];

// ─── doPost ───────────────────────────────────────────────────────────
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result;
    switch (data.tipo) {
      case 'crear_operativo':      result = crearOperativo(ss, data);       break;
      case 'historia_clinica':     result = guardarHistoria(ss, data);      break;
      case 'registrar_atencion':   result = registrarAtencion(ss, data);    break;
      case 'agregar_participantes':result = agregarParticipantes(ss, data); break;
      default: result = { ok: false, error: 'Tipo desconocido: ' + data.tipo };
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// ─── doGet ────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    const p = e.parameter;
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result;
    switch (p.tipo) {
      case 'get_all_operativos': result = getAllOperativos(ss);                                break;
      case 'get_operativo':      result = getOperativo(ss, p.id);                             break;
      case 'get_participantes':  result = getParticipantes(ss, p.operativoId);                break;
      case 'get_participante':   result = getParticipante(ss, p.operativoId, p.participanteId); break;
      case 'get_atenciones':     result = getAtenciones(ss, p.operativoId);                   break;
      default: result = { ok: false, error: 'Tipo desconocido: ' + p.tipo };
    }
    return jsonOut(result);
  } catch (err) {
    return jsonOut({ ok: false, error: err.message });
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────
function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function getOrCreate(ss, name, headers) {
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length)
      .setFontWeight('bold').setBackground('#003D6B').setFontColor('#FFFFFF');
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function sheetToObjects(sheet, filterFn) {
  const data = sheet.getDataRange().getValues();
  if (data.length < 2) return [];
  const headers = data[0].map(String);
  return data.slice(1)
    .map(row => { const obj = {}; headers.forEach((h, i) => { obj[h] = row[i]; }); return obj; })
    .filter(filterFn || (() => true));
}

function rowToValues(headers, data) {
  return headers.map(h => (data[h] !== undefined && data[h] !== null) ? data[h] : '');
}

// ─── crear_operativo ──────────────────────────────────────────────────
function crearOperativo(ss, data) {
  const sheet = getOrCreate(ss, 'Operativos', OP_HEADERS);
  const existing = sheetToObjects(sheet, r => String(r.id) === String(data.id));
  if (existing.length > 0) return { ok: true, msg: 'El operativo ya existía' };
  sheet.appendRow(rowToValues(OP_HEADERS, data));
  return { ok: true };
}

// ─── historia_clinica — crea/actualiza paciente con historia completa ──
function guardarHistoria(ss, data) {
  const sheet = getOrCreate(ss, 'Pacientes', PAC_HEADERS);
  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(String);
  const opIdx = headers.indexOf('operativoId');
  const idIdx = headers.indexOf('id');

  // Intentar actualizar fila existente
  for (let i = 1; i < values.length; i++) {
    if (String(values[i][opIdx]) === String(data.operativoId) &&
        String(values[i][idIdx]) === String(data.participanteId)) {
      const updated = [...values[i]];
      headers.forEach((h, col) => {
        if (h === 'fichaCompletada') { updated[col] = true; return; }
        if (h === 'fechaFicha') { updated[col] = data.fechaEnvio || new Date().toISOString(); return; }
        if (h === 'id') return;
        const val = data[h];
        if (val !== undefined && val !== null && val !== '') updated[col] = val;
      });
      sheet.getRange(i + 1, 1, 1, updated.length).setValues([updated]);
      return { ok: true };
    }
  }

  // No existe: crear fila nueva (flujo normal — historia completamente nueva)
  sheet.appendRow(rowToValues(PAC_HEADERS, {
    operativoId:              data.operativoId,
    id:                       data.participanteId,
    nombre:                   data.nombre || '',
    telefono:                 data.telefono || '',
    ubicacion:                data.ubicacion || '',
    fichaCompletada:          true,
    fechaFicha:               data.fechaEnvio || new Date().toISOString(),
    edad:                     data.edad || '',
    dni:                      data.dni || '',
    sexo:                     data.sexo || '',
    grupoSanguineo:           data.grupoSanguineo || '',
    enfermedadesCronicas:     data.enfermedadesCronicas || '',
    medicacion:               data.medicacion || '',
    alergias:                 data.alergias || '',
    cirugias:                 data.cirugias || '',
    contactoEmergenciaNombre: data.contactoEmergenciaNombre || '',
    contactoEmergenciaTel:    data.contactoEmergenciaTel || '',
    obraSocial:               data.obraSocial || '',
    numAfiliado:              data.numAfiliado || '',
    tutorNombre:              data.tutorNombre || '',
    tutorTel:                 data.tutorTel || '',
    obs:                      data.obs || ''
  }));
  return { ok: true, msg: 'Paciente creado con historia clínica' };
}

// ─── registrar_atencion ───────────────────────────────────────────────
function registrarAtencion(ss, data) {
  const sheet = getOrCreate(ss, 'Atenciones', ATEN_HEADERS);
  sheet.appendRow(rowToValues(ATEN_HEADERS, {
    ...data,
    fechaRegistro: data.fechaRegistro || new Date().toISOString()
  }));
  return { ok: true };
}

// ─── agregar_participantes (sin historia — caso "Otro") ───────────────
function agregarParticipantes(ss, data) {
  const sheet = getOrCreate(ss, 'Pacientes', PAC_HEADERS);
  const lista = Array.isArray(data.participantes) ? data.participantes : [data];
  const operativoId = data.operativoId;
  const existentes = sheetToObjects(sheet, r => String(r.operativoId) === String(operativoId))
    .map(r => String(r.id));
  let added = 0;
  lista.forEach(p => {
    if (existentes.includes(String(p.id))) return;
    sheet.appendRow(rowToValues(PAC_HEADERS, {
      operativoId, id: p.id, nombre: p.nombre,
      telefono: p.telefono || '', ubicacion: p.ubicacion || '',
      fichaCompletada: false, fechaFicha: ''
    }));
    added++;
  });
  return { ok: true, added };
}

// ─── Lecturas ─────────────────────────────────────────────────────────
function getAllOperativos(ss) {
  const sheet = ss.getSheetByName('Operativos');
  if (!sheet) return { ok: true, operativos: [] };
  return { ok: true, operativos: sheetToObjects(sheet) };
}

function getOperativo(ss, id) {
  const sheet = ss.getSheetByName('Operativos');
  if (!sheet) return { ok: true, operativo: null };
  const rows = sheetToObjects(sheet, r => String(r.id) === String(id));
  return { ok: true, operativo: rows[0] || null };
}

function getParticipantes(ss, operativoId) {
  const sheet = ss.getSheetByName('Pacientes');
  if (!sheet) return { ok: true, participantes: [] };
  const rows = sheetToObjects(sheet, r => String(r.operativoId) === String(operativoId));
  rows.forEach(r => {
    r.fichaCompletada = r.fichaCompletada === true || String(r.fichaCompletada).toUpperCase() === 'TRUE';
  });
  return { ok: true, participantes: rows };
}

function getParticipante(ss, operativoId, participanteId) {
  const sheet = ss.getSheetByName('Pacientes');
  if (!sheet) return { ok: true, participante: null };
  const rows = sheetToObjects(sheet, r =>
    String(r.operativoId) === String(operativoId) &&
    String(r.id) === String(participanteId)
  );
  if (rows.length > 0) {
    rows[0].fichaCompletada = rows[0].fichaCompletada === true ||
      String(rows[0].fichaCompletada).toUpperCase() === 'TRUE';
  }
  return { ok: true, participante: rows[0] || null };
}

function getAtenciones(ss, operativoId) {
  const sheet = ss.getSheetByName('Atenciones');
  if (!sheet) return { ok: true, atenciones: [] };
  return { ok: true, atenciones: sheetToObjects(sheet, r => String(r.operativoId) === String(operativoId)) };
}
