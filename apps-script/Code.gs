/**
 * Plansul — Fluxo de Caixa — backend em Google Apps Script.
 *
 * Este script deve ser vinculado a uma Planilha Google (Extensões > Apps
 * Script). Veja SETUP.md para o passo a passo completo de instalação.
 *
 * A planilha guarda: usuários/senhas (com hash), contas bancárias, metadados
 * de cada relatório carregado e o histórico de uploads. Os lançamentos de
 * cada relatório (que podem ser muitos milhares de linhas) e uma cópia do
 * arquivo original ficam em uma pasta do Google Drive, criada
 * automaticamente na primeira execução.
 */

/* ==== CONFIGURAÇÃO ==== */
const ROOT_FOLDER_NAME = 'Plansul - Fluxo de Caixa - Arquivos';
const SESSION_TTL_SECONDS = 21600; // 6 horas — máximo permitido pelo CacheService
const HISTORY_KEEP = 200;          // poda o histórico de uploads acima disso
const MAX_FAILED_ATTEMPTS = 5;
const LOCKOUT_MINUTES = 15;

const SHEET_USERS = 'Usuarios';
const SHEET_ACCOUNTS = 'Contas';
const SHEET_SOURCES = 'Fontes';
const SHEET_HISTORY = 'Historico';
const SHEET_APPLICATIONS = 'Aplicacoes';
const APPLICATIONS_STALE_DAYS = 60; // acima disso, o fundo é marcado como "desatualizado"

/* ==== PONTO DE ENTRADA HTTP ==== */
// O front-end (GitHub Pages) fala com este endpoint via fetch(), sempre com
// Content-Type "text/plain" — isso evita o preflight de CORS que o Apps
// Script não sabe responder. O corpo é sempre um JSON de verdade, só o
// cabeçalho que "finge" ser texto simples. Veja SETUP.md / app.js.
function doPost(e){
  let body;
  try{
    body = JSON.parse(e.postData.contents);
  }catch(err){
    return jsonOut({ ok:false, error:'invalid_argument', message:'corpo da requisição inválido' });
  }
  const action = body.action;
  try{
    let result;
    switch(action){
      case 'login':
        result = doLogin(body.username, body.password);
        break;
      case 'getData':
        requireSession(body.token);
        result = doGetData();
        break;
      case 'saveAccount':
        requireSessionRole(body.token, 'financeiro');
        result = doSaveAccount(body.account || {});
        break;
      case 'deleteAccount':
        requireSessionRole(body.token, 'financeiro');
        result = doDeleteAccount(body.id);
        break;
      case 'saveImport':
        requireSessionRole(body.token, 'financeiro');
        result = doSaveImport(body);
        break;
      case 'deleteSource':
        requireSessionRole(body.token, 'financeiro');
        result = doDeleteSource(body.sourceId);
        break;
      case 'logHistory':
        requireSessionRole(body.token, 'financeiro');
        result = doLogHistory(body);
        break;
      case 'saveApplications':
        requireSessionRole(body.token, 'financeiro');
        result = doSaveApplications(body);
        break;
      default:
        throw mkError('unknown_action');
    }
    return jsonOut(Object.assign({ ok:true }, result || {}));
  }catch(err){
    const code = (err && err.code) || 'internal_error';
    console.error(action, err);
    return jsonOut({ ok:false, error: code, message: String((err && err.message) || err) });
  }
}

// Só para conferir rapidamente, no navegador, se a implantação está no ar.
function doGet(){
  return jsonOut({ ok:true, service:'Plansul Fluxo de Caixa', status:'online' });
}

function jsonOut(obj){
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function mkError(code, message){
  const err = new Error(message || code);
  err.code = code;
  return err;
}

/* ==== SESSÕES (CacheService — expira sozinho, nada fica salvo em disco) ==== */
function requireSession(token){
  if(!token) throw mkError('session_expired');
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if(!raw) throw mkError('session_expired');
  const sess = JSON.parse(raw);
  sess.token = token;
  return sess;
}
function requireSessionRole(token, role){
  const sess = requireSession(token);
  if(sess.role !== role) throw mkError('forbidden');
  return sess;
}

/* ==== LOGIN & SENHAS ==== */
// Senhas nunca ficam em texto puro: guardamos apenas um hash SHA-256 salgado
// por usuário. Use o menu "Plansul > Definir senha de usuário" na planilha
// para cadastrar ou trocar uma senha — nunca digite a senha diretamente
// nesta planilha.
function sha256Hex(str){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b=>{
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length===1 ? '0'+v : v;
  }).join('');
}

function doLogin(username, password){
  if(!username || !password) throw mkError('invalid_credentials');
  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  // colunas: username | salt | passwordHash | role | nome | tentativasFalhas | bloqueadoAte
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(String(row[0]).trim().toLowerCase() !== String(username).trim().toLowerCase()) continue;

    const lockedUntil = row[6] ? new Date(row[6]).getTime() : 0;
    if(lockedUntil && Date.now() < lockedUntil) throw mkError('locked');

    const salt = String(row[1]||'');
    const expectedHash = String(row[2]||'');
    const actualHash = sha256Hex(salt + ':' + password);
    const rowIndex = i + 1;

    if(!expectedHash || actualHash !== expectedHash){
      const attempts = (Number(row[5])||0) + 1;
      sheet.getRange(rowIndex, 6).setValue(attempts);
      if(attempts >= MAX_FAILED_ATTEMPTS){
        sheet.getRange(rowIndex, 7).setValue(new Date(Date.now() + LOCKOUT_MINUTES*60*1000).toISOString());
      }
      throw mkError('invalid_credentials');
    }

    sheet.getRange(rowIndex, 6).setValue(0);
    sheet.getRange(rowIndex, 7).setValue('');
    const role = String(row[3]||'').trim();
    const nome = String(row[4]||row[0]);
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put('sess_'+token, JSON.stringify({ username: row[0], role, nome }), SESSION_TTL_SECONDS);
    return { token, role, nome, username: row[0] };
  }
  throw mkError('invalid_credentials');
}

/* ==== LEITURA DOS DADOS DO PAINEL ==== */
function doGetData(){
  const accounts = readAccounts();
  const sources = readSources();
  const transactions = readAllTransactions(sources);
  const history = readHistory();
  const applications = readApplications();
  return { accounts, sources, transactions, history, applications };
}

function readAccounts(){
  const sheet = getSheet(SHEET_ACCOUNTS);
  const data = sheet.getDataRange().getValues();
  const out = [];
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(!row[0]) continue;
    out.push({
      id: String(row[0]), name: String(row[1]||''), kind: String(row[2]||'conta'),
      balance: Number(row[3])||0, asOfDate: formatDateValue(row[4]),
      order: Number(row[5])||0, updatedAt: formatDateValue(row[6]),
    });
  }
  out.sort((a,b)=> a.order - b.order);
  return out;
}

function readSources(){
  const sheet = getSheet(SHEET_SOURCES);
  const data = sheet.getDataRange().getValues();
  const out = [];
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(!row[0]) continue;
    let mapping = {};
    try{ mapping = JSON.parse(row[4]||'{}'); }catch(e){ /* ignora mapeamento inválido */ }
    out.push({
      id: String(row[0]), sourceName: String(row[1]||''), filename: String(row[2]||''),
      sheetName: String(row[3]||''), mapping, headerSignature: String(row[5]||''),
      rowCount: Number(row[6])||0, uploadedAt: formatDateValue(row[7]),
    });
  }
  return out;
}

function readAllTransactions(sources){
  const folder = getSubFolder('fontes');
  const rows = [];
  sources.forEach(src=>{
    const files = folder.getFilesByName(src.id + '.json');
    if(!files.hasNext()) return;
    try{
      const content = files.next().getBlob().getDataAsString('UTF-8');
      const parsed = JSON.parse(content);
      if(parsed && Array.isArray(parsed.rows)) rows.push.apply(rows, parsed.rows);
    }catch(e){ console.error('leitura de fonte '+src.id, e); }
  });
  rows.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  return rows;
}

function readHistory(){
  const sheet = getSheet(SHEET_HISTORY);
  const data = sheet.getDataRange().getValues();
  const out = [];
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(!row[0]) continue;
    out.push({
      id: String(row[0]), bank: String(row[1]||''), filename: String(row[2]||''),
      status: String(row[3]||''), rowCount: Number(row[4])||0,
      errorMessage: String(row[5]||''), at: formatDateValue(row[6]),
    });
  }
  out.sort((a,b)=> a.at < b.at ? 1 : -1);
  return out.slice(0, HISTORY_KEEP);
}

function formatDateValue(v){
  if(v instanceof Date) return v.toISOString();
  return v ? String(v) : '';
}

// Aplicações é uma fotografia (o saldo mais recente de cada fundo), não um
// somatório de lançamentos — por isso lemos direto da aba, sem combinar
// arquivos, e recalculamos totais/desatualizados aqui para garantir que o
// que o painel mostra sempre bate com o que está gravado na planilha.
function readApplications(){
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  const funds = [];
  let asOfDate = '';
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(!row[0]) continue;
    const competencia = String(row[4]||'');
    if(competencia > asOfDate) asOfDate = competencia;
    funds.push({
      id: String(row[0]), banco: String(row[1]||''), fundo: String(row[2]||''), contaCod: String(row[3]||''),
      competencia,
      saldoInicial: Number(row[5])||0, aplicacoes: Number(row[6])||0,
      rendimentos: Number(row[7])||0, imposto: Number(row[8])||0, resgate: Number(row[9])||0,
      saldoFinal: Number(row[10])||0,
      rendimentosPct: (row[11]===''||row[11]===null||row[11]===undefined) ? null : Number(row[11]),
      cotizacaoResgate: String(row[12]||''), garantia: String(row[13]||''),
      vinculo: String(row[14]||''), indexador: String(row[15]||''),
    });
  }
  funds.forEach(f=>{
    const staleDays = (asOfDate && f.competencia) ? daysBetweenISOSimple(f.competencia, asOfDate) : 0;
    f.staleDays = staleDays;
    f.stale = staleDays > APPLICATIONS_STALE_DAYS;
  });
  funds.sort((a,b)=> b.saldoFinal - a.saldoFinal);
  const totalBalance = funds.reduce((s,f)=>s+f.saldoFinal, 0);
  const byBankMap = {};
  funds.forEach(f=>{ byBankMap[f.banco] = (byBankMap[f.banco]||0) + f.saldoFinal; });
  const byBank = Object.keys(byBankMap).map(banco=>({ banco, total: byBankMap[banco] })).sort((a,b)=>b.total-a.total);
  const staleCount = funds.filter(f=>f.stale).length;
  return { funds, totalBalance, byBank, asOfDate, staleCount };
}

function daysBetweenISOSimple(aISO, bISO){
  const pa = aISO.split('-').map(Number), pb = bISO.split('-').map(Number);
  if(pa.length<3 || pb.length<3) return 0;
  const da = Date.UTC(pa[0], pa[1]-1, pa[2]), db = Date.UTC(pb[0], pb[1]-1, pb[2]);
  return Math.round((db-da)/86400000);
}

/* ==== CONTAS ==== */
function doSaveAccount(account){
  const sheet = getSheet(SHEET_ACCOUNTS);
  const id = account.id || Utilities.getUuid();
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(id)){ rowIndex = i+1; break; } }
  const values = [
    id, account.name||'', account.kind||'conta', Number(account.balance)||0,
    account.asOfDate||'', Number(account.order)||0, new Date().toISOString(),
  ];
  if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  return { id };
}

function doDeleteAccount(id){
  const sheet = getSheet(SHEET_ACCOUNTS);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===String(id)){ sheet.deleteRow(i+1); break; }
  }
  return {};
}

/* ==== IMPORTAÇÃO DE RELATÓRIOS ==== */
function doSaveImport(body){
  const sourceId = body.sourceId;
  if(!sourceId) throw mkError('invalid_argument', 'sourceId ausente');

  const fontesFolder = getSubFolder('fontes');
  const rowsContent = JSON.stringify({ rows: body.rows || [] });
  writeOrReplaceFile(fontesFolder, sourceId + '.json', rowsContent, MimeType.PLAIN_TEXT);

  if(body.fileBase64){
    try{
      const originaisFolder = getSubFolder('originais');
      const bytes = Utilities.base64Decode(body.fileBase64);
      const blob = Utilities.newBlob(bytes, body.fileMime || 'application/octet-stream', body.filename || (sourceId+'_original'));
      const stamped = sourceId + '__' + Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT', 'yyyyMMdd_HHmmss') + '__' + (body.filename||'arquivo');
      blob.setName(stamped);
      originaisFolder.createFile(blob);
    }catch(e){ console.error('guardar original', e); /* best-effort — não deve travar o upload */ }
  }

  const sheet = getSheet(SHEET_SOURCES);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(sourceId)){ rowIndex = i+1; break; } }
  const values = [
    sourceId, body.sourceName||'', body.filename||'', body.sheetName||'',
    JSON.stringify(body.mapping||{}), body.headerSignature||'',
    (body.rows||[]).length, new Date().toISOString(),
  ];
  if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
  return {};
}

function doDeleteSource(sourceId){
  if(!sourceId) throw mkError('invalid_argument', 'sourceId ausente');
  const folder = getSubFolder('fontes');
  const files = folder.getFilesByName(sourceId + '.json');
  while(files.hasNext()) files.next().setTrashed(true);

  const sheet = getSheet(SHEET_SOURCES);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===String(sourceId)){ sheet.deleteRow(i+1); break; }
  }
  return {};
}

/* ==== APLICAÇÕES (relatório "Analise Aplicações") ====
 * Ao contrário das fontes bancárias (que se somam), este relatório
 * substitui por completo o conteúdo anterior a cada novo envio — é sempre
 * a fotografia mais recente de todos os fundos, já processada no navegador
 * (ver parseApplicationsWorkbook em app.js). */
function doSaveApplications(body){
  const funds = Array.isArray(body.funds) ? body.funds : [];
  const sheet = getSheet(SHEET_APPLICATIONS);
  const lastRow = sheet.getLastRow();
  if(lastRow > 1) sheet.getRange(2, 1, lastRow-1, Math.max(sheet.getLastColumn(),17)).clearContent();
  const now = new Date().toISOString();
  if(funds.length){
    const values = funds.map(f=>[
      String(f.id||''), String(f.banco||''), String(f.fundo||''), String(f.contaCod||''),
      String(f.competencia||''),
      Number(f.saldoInicial)||0, Number(f.aplicacoes)||0, Number(f.rendimentos)||0,
      Number(f.imposto)||0, Number(f.resgate)||0, Number(f.saldoFinal)||0,
      (f.rendimentosPct===null || f.rendimentosPct===undefined || f.rendimentosPct==='') ? '' : Number(f.rendimentosPct),
      String(f.cotizacaoResgate||''), String(f.garantia||''), String(f.vinculo||''), String(f.indexador||''),
      now,
    ]);
    sheet.getRange(2, 1, values.length, values[0].length).setValues(values);
  }

  if(body.fileBase64){
    try{
      const originaisFolder = getSubFolder('originais');
      const bytes = Utilities.base64Decode(body.fileBase64);
      const blob = Utilities.newBlob(bytes, body.fileMime || 'application/octet-stream', body.filename || 'analise_aplicacoes');
      const stamped = 'aplicacoes__' + Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT', 'yyyyMMdd_HHmmss') + '__' + (body.filename||'arquivo');
      blob.setName(stamped);
      originaisFolder.createFile(blob);
    }catch(e){ console.error('guardar original de aplicações', e); /* best-effort */ }
  }
  return {};
}

/* ==== HISTÓRICO DE UPLOADS ==== */
function doLogHistory(body){
  const sheet = getSheet(SHEET_HISTORY);
  sheet.appendRow([
    Utilities.getUuid(), body.bank||'', body.filename||'', body.status||'',
    Number(body.rowCount)||0, body.errorMessage||'', new Date().toISOString(),
  ]);
  pruneHistory(sheet);
  return {};
}

function pruneHistory(sheet){
  const lastRow = sheet.getLastRow();
  const dataRows = lastRow - 1;
  if(dataRows > HISTORY_KEEP){
    sheet.deleteRows(2, dataRows - HISTORY_KEEP);
  }
}

/* ==== PLANILHA & DRIVE (auto-configuração) ==== */
// IMPORTANTE: SpreadsheetApp.getActiveSpreadsheet() só funciona quando o
// script roda a partir do menu/editor da planilha — dentro de doPost/doGet
// (chamado de fora, pelo navegador) ele não existe. Por isso guardamos o ID
// da planilha em Script Properties na primeira vez que algo roda a partir do
// menu, e toda leitura passa a usar SpreadsheetApp.openById(id), que funciona
// em qualquer contexto, inclusive dentro do Web App.
function getSS(){
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('SHEET_ID');
  if(id){
    try{ return SpreadsheetApp.openById(id); }catch(e){ /* segue e tenta o contexto ativo abaixo */ }
  }
  let ss = null;
  try{ ss = SpreadsheetApp.getActiveSpreadsheet(); }catch(e){ ss = null; }
  if(!ss) throw mkError('internal_error', 'planilha não configurada — abra a planilha e rode "Plansul > Configurar planilha (1ª vez)" pelo menu.');
  props.setProperty('SHEET_ID', ss.getId());
  return ss;
}

function getSheet(name){
  const ss = getSS();
  const sheet = ss.getSheetByName(name);
  if(!sheet) throw mkError('internal_error', 'aba "'+name+'" não encontrada — rode "Plansul > Configurar planilha (1ª vez)" no menu.');
  return sheet;
}

function writeOrReplaceFile(folder, name, content, mimeType){
  const existing = folder.getFilesByName(name);
  if(existing.hasNext()){ existing.next().setContent(content); return; }
  folder.createFile(name, content, mimeType);
}

function getRootFolder(){
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('ROOT_FOLDER_ID');
  if(id){
    try{ return DriveApp.getFolderById(id); }catch(e){ /* pasta antiga sumiu — recria abaixo */ }
  }
  const it = DriveApp.getFoldersByName(ROOT_FOLDER_NAME);
  const folder = it.hasNext() ? it.next() : DriveApp.createFolder(ROOT_FOLDER_NAME);
  props.setProperty('ROOT_FOLDER_ID', folder.getId());
  return folder;
}

function getSubFolder(name){
  const root = getRootFolder();
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

/* ==== MENU DE ADMINISTRAÇÃO (aparece ao abrir a planilha) ==== */
function onOpen(){
  SpreadsheetApp.getUi()
    .createMenu('Plansul')
    .addItem('Configurar planilha (1ª vez)', 'setupSpreadsheet')
    .addSeparator()
    .addItem('Definir senha de usuário', 'promptSetPassword')
    .addItem('Criar novo usuário', 'promptCreateUser')
    .addToUi();
}

// Cria as quatro abas com os cabeçalhos certos, se ainda não existirem.
// Rode isso uma vez, logo depois de criar a planilha (veja SETUP.md).
function setupSpreadsheet(){
  const ss = getSS();
  ensureSheet(ss, SHEET_USERS, ['username','salt','passwordHash','role','nome','tentativasFalhas','bloqueadoAte']);
  ensureSheet(ss, SHEET_ACCOUNTS, ['id','name','kind','balance','asOfDate','order','updatedAt']);
  ensureSheet(ss, SHEET_SOURCES, ['id','sourceName','filename','sheetName','mappingJSON','headerSignature','rowCount','uploadedAt']);
  ensureSheet(ss, SHEET_HISTORY, ['id','bank','filename','status','rowCount','errorMessage','at']);
  ensureSheet(ss, SHEET_APPLICATIONS, ['id','banco','fundo','contaCod','competencia','saldoInicial','aplicacoes','rendimentos','imposto','resgate','saldoFinal','rendimentosPct','cotizacaoResgate','garantia','vinculo','indexador','updatedAt']);
  getRootFolder(); // já cria a pasta do Drive também
  SpreadsheetApp.getUi().alert('Planilha configurada! Agora use "Plansul > Criar novo usuário" para cadastrar o financeiro e os diretores.');
}

function ensureSheet(ss, name, headers){
  let sheet = ss.getSheetByName(name);
  if(!sheet){
    sheet = ss.insertSheet(name);
  }
  if(sheet.getLastRow() === 0){
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
}

// Pede usuário + papel + senha nova e grava (ou atualiza) a linha correspondente
// na aba "Usuarios", já com a senha transformada em hash — a senha em texto
// puro nunca fica salva em lugar nenhum.
function promptCreateUser(){
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('Novo usuário', 'Nome de usuário (ex.: financeiro, andre, peter):', ui.ButtonSet.OK_CANCEL);
  if(u.getSelectedButton() !== ui.Button.OK || !u.getResponseText().trim()) return;
  const username = u.getResponseText().trim();

  const r = ui.prompt('Papel de acesso', 'Digite "financeiro" (upload + edição) ou "diretoria" (somente leitura):', ui.ButtonSet.OK_CANCEL);
  if(r.getSelectedButton() !== ui.Button.OK) return;
  const role = r.getResponseText().trim().toLowerCase();
  if(role !== 'financeiro' && role !== 'diretoria'){
    ui.alert('Papel inválido. Use exatamente "financeiro" ou "diretoria".');
    return;
  }

  const n = ui.prompt('Nome de exibição', 'Nome que aparece no painel (ex.: André Silva):', ui.ButtonSet.OK_CANCEL);
  if(n.getSelectedButton() !== ui.Button.OK) return;
  const nome = n.getResponseText().trim() || username;

  const p = ui.prompt('Senha inicial', 'Digite a senha para "'+username+'":', ui.ButtonSet.OK_CANCEL);
  if(p.getSelectedButton() !== ui.Button.OK || !p.getResponseText()) return;

  setUserPassword(username, role, nome, p.getResponseText());
  ui.alert('Usuário "'+username+'" criado/atualizado com sucesso.');
}

function promptSetPassword(){
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('Trocar senha', 'Nome de usuário existente:', ui.ButtonSet.OK_CANCEL);
  if(u.getSelectedButton() !== ui.Button.OK || !u.getResponseText().trim()) return;
  const username = u.getResponseText().trim();

  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  let found = null;
  for(let i=1;i<data.length;i++){
    if(String(data[i][0]).trim().toLowerCase() === username.toLowerCase()){ found = data[i]; break; }
  }
  if(!found){ ui.alert('Usuário "'+username+'" não encontrado. Use "Criar novo usuário" primeiro.'); return; }

  const p = ui.prompt('Nova senha', 'Digite a nova senha para "'+username+'":', ui.ButtonSet.OK_CANCEL);
  if(p.getSelectedButton() !== ui.Button.OK || !p.getResponseText()) return;

  setUserPassword(username, String(found[3]), String(found[4]||username), p.getResponseText());
  ui.alert('Senha de "'+username+'" atualizada.');
}

function setUserPassword(username, role, nome, plainPassword){
  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for(let i=1;i<data.length;i++){
    if(String(data[i][0]).trim().toLowerCase() === username.toLowerCase()){ rowIndex = i+1; break; }
  }
  const salt = Utilities.getUuid();
  const hash = sha256Hex(salt + ':' + plainPassword);
  const values = [username, salt, hash, role, nome, 0, ''];
  if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
}
