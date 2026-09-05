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
const SHEET_RESET_TOKENS = 'ResetTokens';
const RESET_CODE_TTL_MINUTES = 10;
const RESET_MAX_ATTEMPTS = 5;
const RESET_REQUEST_THROTTLE_SECONDS = 60;
const RESET_TOKEN_KEEP = 500;
const RESET_GENERIC_MESSAGE = 'Se o e-mail existir, um código foi enviado.';
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
      case 'requestPasswordReset':
        result = doRequestPasswordReset(body.identifier || body.username || body.email);
        break;
      case 'verifyResetCode':
        result = doVerifyResetCode(body.identifier || body.username || body.email, body.code);
        break;
      case 'resetPassword':
        result = doResetPassword(body.identifier || body.username || body.email, body.code, body.newPassword);
        break;
      case 'getData':
        requireSession(body.token);
        result = doGetData();
        break;
      case 'logout':
        result = doLogout(body.token);
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
      case 'deleteHistory':
        requireSessionRole(body.token, 'financeiro');
        result = doDeleteHistory(body.id);
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
function normalizeUserSessionKey(username){
  return String(username||'').trim().toLowerCase();
}
function sessionVersionPropertyKey(username){
  return 'AUTH_VERSION_' + sha256Hex(normalizeUserSessionKey(username)).slice(0,32);
}
function getUserSessionVersion(username){
  return Number(PropertiesService.getScriptProperties().getProperty(sessionVersionPropertyKey(username)) || 0);
}
function bumpUserSessionVersion(username){
  const props = PropertiesService.getScriptProperties();
  const key = sessionVersionPropertyKey(username);
  const next = Number(props.getProperty(key) || 0) + 1;
  props.setProperty(key, String(next));
  return next;
}
function requireSession(token){
  if(!token) throw mkError('session_expired');
  const cache = CacheService.getScriptCache();
  const raw = cache.get('sess_' + token);
  if(!raw) throw mkError('session_expired');
  const sess = JSON.parse(raw);
  const cachedVersion = Number(sess.authVersion || 0);
  const currentVersion = getUserSessionVersion(sess.username);
  if(cachedVersion !== currentVersion){
    cache.remove('sess_' + token);
    throw mkError('session_expired');
  }
  sess.token = token;
  return sess;
}
function requireSessionRole(token, role){
  const sess = requireSession(token);
  if(sess.role !== role) throw mkError('forbidden');
  return sess;
}
function doLogout(token){
  if(token) CacheService.getScriptCache().remove('sess_' + token);
  return {};
}

/* ==== LOGIN & SENHAS ==== */
// Senhas nunca ficam em texto puro. Novas senhas usam derivação iterativa
// SHA-256 com salt e versão; hashes legados são atualizados no login. Use o menu "Plansul > Definir senha de usuário" na planilha
// para cadastrar ou trocar uma senha — nunca digite a senha diretamente
// nesta planilha.
function sha256Hex(str){
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(b=>{
    const v = (b < 0 ? b + 256 : b).toString(16);
    return v.length===1 ? '0'+v : v;
  }).join('');
}
const PASSWORD_HASH_ITERATIONS = 4000;
function derivePasswordHash(salt, password, iterations){
  const rounds = Math.max(1, Number(iterations)||PASSWORD_HASH_ITERATIONS);
  let h = sha256Hex(salt + ':' + password);
  for(let i=1;i<rounds;i++) h = sha256Hex(salt + ':' + h);
  return h;
}
function makePasswordHash(salt, password){
  return 'v2$' + PASSWORD_HASH_ITERATIONS + '$' + derivePasswordHash(salt, password, PASSWORD_HASH_ITERATIONS);
}
function verifyPasswordHash(salt, password, stored){
  const text = String(stored||'');
  if(text.indexOf('v2$')===0){
    const parts = text.split('$');
    const rounds = Number(parts[1])||PASSWORD_HASH_ITERATIONS;
    return derivePasswordHash(salt, password, rounds) === String(parts[2]||'');
  }
  return sha256Hex(salt + ':' + password) === text;
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
    const rowIndex = i + 1;

    if(!expectedHash || !verifyPasswordHash(salt, password, expectedHash)){
      const attempts = (Number(row[5])||0) + 1;
      sheet.getRange(rowIndex, 6).setValue(attempts);
      if(attempts >= MAX_FAILED_ATTEMPTS){
        sheet.getRange(rowIndex, 7).setValue(new Date(Date.now() + LOCKOUT_MINUTES*60*1000).toISOString());
      }
      throw mkError('invalid_credentials');
    }

    // Migração transparente de hashes legados para o formato iterativo v2.
    if(expectedHash.indexOf('v2$')!==0) sheet.getRange(rowIndex, 3).setValue(makePasswordHash(salt, password));
    sheet.getRange(rowIndex, 6).setValue(0);
    sheet.getRange(rowIndex, 7).setValue('');
    const role = String(row[3]||'').trim();
    const nome = String(row[4]||row[0]);
    const token = Utilities.getUuid();
    CacheService.getScriptCache().put('sess_'+token, JSON.stringify({ username: row[0], role, nome, authVersion:getUserSessionVersion(row[0]) }), SESSION_TTL_SECONDS);
    return { token, role, nome, username: row[0] };
  }
  throw mkError('invalid_credentials');
}


/* ==== RECUPERAÇÃO DE SENHA POR E-MAIL ==== */
function normalizeResetIdentifier(value){
  return String(value||'').trim().toLowerCase();
}
function findUserByIdentifier(identifier){
  const key = normalizeResetIdentifier(identifier);
  if(!key) return null;
  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    const row = data[i];
    const username = String(row[0]||'').trim();
    const email = String(row[7]||'').trim();
    if(username.toLowerCase() === key || (email && email.toLowerCase() === key)){
      return { sheet, row, rowIndex:i+1, username, email };
    }
  }
  return null;
}
function resetRequestCacheKey(identifier){
  return 'reset_req_' + sha256Hex(normalizeResetIdentifier(identifier)).slice(0,32);
}
function resetCanonicalCacheKey(username){
  return 'reset_mail_' + sha256Hex(normalizeUserSessionKey(username)).slice(0,32);
}
function generateResetCode(){
  const seed = sha256Hex(Utilities.getUuid() + ':' + Date.now() + ':' + Utilities.getUuid());
  return String((parseInt(seed.slice(0,8),16) % 900000) + 100000);
}
function resetCodeHash(tokenId, code){
  return sha256Hex(String(tokenId||'') + ':' + String(code||''));
}
function getResetTokenSheet(){
  return getSheet(SHEET_RESET_TOKENS);
}
function invalidateActiveResetTokens(username){
  const sheet = getResetTokenSheet();
  const data = sheet.getDataRange().getValues();
  const now = new Date().toISOString();
  for(let i=1;i<data.length;i++){
    if(String(data[i][1]||'').trim().toLowerCase() !== String(username||'').trim().toLowerCase()) continue;
    if(data[i][4]) continue;
    sheet.getRange(i+1,5).setValue(now);
  }
}
function appendResetToken(username, code){
  const sheet = getResetTokenSheet();
  const id = Utilities.getUuid();
  const now = new Date();
  sheet.appendRow([
    id,
    username,
    resetCodeHash(id, code),
    new Date(now.getTime() + RESET_CODE_TTL_MINUTES*60*1000).toISOString(),
    '',
    0,
    now.toISOString(),
  ]);
  pruneResetTokens(sheet);
  return { id:id, sheet:sheet, rowIndex:sheet.getLastRow() };
}
function pruneResetTokens(sheet){
  const dataRows = Math.max(0, sheet.getLastRow()-1);
  if(dataRows > RESET_TOKEN_KEEP) sheet.deleteRows(2, dataRows-RESET_TOKEN_KEEP);
}
function latestResetToken(username){
  const sheet = getResetTokenSheet();
  const data = sheet.getDataRange().getValues();
  const key = String(username||'').trim().toLowerCase();
  for(let i=data.length-1;i>=1;i--){
    if(String(data[i][1]||'').trim().toLowerCase() !== key) continue;
    return {
      sheet:sheet,
      rowIndex:i+1,
      id:String(data[i][0]||''),
      username:String(data[i][1]||''),
      codeHash:String(data[i][2]||''),
      expiresAt:String(data[i][3]||''),
      usedAt:String(data[i][4]||''),
      attempts:Number(data[i][5])||0,
      requestedAt:String(data[i][6]||''),
    };
  }
  return null;
}
function markResetTokenUsed(token){
  if(token && token.sheet && token.rowIndex) token.sheet.getRange(token.rowIndex,5).setValue(new Date().toISOString());
}
function validateNewPassword(password, username){
  const p = String(password||'');
  if(p.length < 10 || !/[a-z]/.test(p) || !/[A-Z]/.test(p) || !/\d/.test(p)){
    throw mkError('weak_password','Use pelo menos 10 caracteres, com letra maiúscula, letra minúscula e número.');
  }
  if(normalizeResetIdentifier(p) === normalizeResetIdentifier(username)) throw mkError('weak_password','A senha não pode ser igual ao usuário.');
}
function verifyResetCodeInternal(identifier, code){
  const user = findUserByIdentifier(identifier);
  if(!user || !/^\d{6}$/.test(String(code||''))) throw mkError('reset_code_invalid');
  const token = latestResetToken(user.username);
  if(!token || token.usedAt) throw mkError('reset_code_invalid');
  const expires = token.expiresAt ? new Date(token.expiresAt).getTime() : 0;
  if(!expires || Date.now() > expires){
    markResetTokenUsed(token);
    throw mkError('reset_code_expired');
  }
  if(token.attempts >= RESET_MAX_ATTEMPTS){
    markResetTokenUsed(token);
    throw mkError('reset_attempts_exceeded');
  }
  if(resetCodeHash(token.id, String(code)) !== token.codeHash){
    const attempts = token.attempts + 1;
    token.sheet.getRange(token.rowIndex,6).setValue(attempts);
    if(attempts >= RESET_MAX_ATTEMPTS){
      markResetTokenUsed(token);
      throw mkError('reset_attempts_exceeded');
    }
    throw mkError('reset_code_invalid');
  }
  return { user:user, token:token };
}
function doRequestPasswordReset(identifier){
  const key = normalizeResetIdentifier(identifier);
  if(!key) throw mkError('invalid_argument','Informe usuário ou e-mail.');

  const cache = CacheService.getScriptCache();
  const publicThrottleKey = resetRequestCacheKey(key);
  if(cache.get(publicThrottleKey)) throw mkError('reset_throttled');
  cache.put(publicThrottleKey, '1', RESET_REQUEST_THROTTLE_SECONDS);

  const user = findUserByIdentifier(key);
  if(user && user.email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(user.email)){
    const canonicalThrottleKey = resetCanonicalCacheKey(user.username);
    if(!cache.get(canonicalThrottleKey)){
      const lock = LockService.getScriptLock();
      if(lock.tryLock(8000)){
        try{
          if(!cache.get(canonicalThrottleKey)){
            const code = generateResetCode();
            invalidateActiveResetTokens(user.username);
            const token = appendResetToken(user.username, code);
            try{
              MailApp.sendEmail({
                to:user.email,
                subject:'Código de redefinição de senha — Plansul Tesouraria',
                name:'Plansul Tesouraria',
                body:'Seu código de redefinição de senha é ' + code + '. Ele expira em ' + RESET_CODE_TTL_MINUTES + ' minutos. Se você não solicitou esta alteração, ignore este e-mail.',
                htmlBody:'<div style="font-family:Arial,sans-serif;color:#153544;line-height:1.5"><p>Olá,</p><p>Use o código abaixo para redefinir sua senha de acesso à <b>Plansul Tesouraria</b>:</p><p style="font-size:30px;font-weight:700;letter-spacing:8px;color:#024766;margin:24px 0">' + code + '</p><p>O código expira em <b>' + RESET_CODE_TTL_MINUTES + ' minutos</b> e pode ser usado uma única vez.</p><p style="color:#687d86;font-size:12px">Se você não solicitou esta alteração, ignore este e-mail.</p></div>'
              });
              cache.put(canonicalThrottleKey, '1', RESET_REQUEST_THROTTLE_SECONDS);
            }catch(mailErr){
              markResetTokenUsed(token);
              console.error('requestPasswordReset MailApp', mailErr);
            }
          }
        }finally{ lock.releaseLock(); }
      }
    }
  }
  return { message:RESET_GENERIC_MESSAGE };
}
function doVerifyResetCode(identifier, code){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(8000)) throw mkError('busy');
  try{
    verifyResetCodeInternal(identifier, code);
    return { verified:true };
  }finally{ lock.releaseLock(); }
}
function doResetPassword(identifier, code, newPassword){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(8000)) throw mkError('busy');
  try{
    const verified = verifyResetCodeInternal(identifier, code);
    const user = verified.user;
    validateNewPassword(newPassword, user.username);
    setUserPassword(user.username, String(user.row[3]||''), String(user.row[4]||user.username), newPassword, user.email);
    markResetTokenUsed(verified.token);
    bumpUserSessionVersion(user.username);
    return { reset:true, username:user.username };
  }finally{ lock.releaseLock(); }
}

/* ==== LEITURA DOS DADOS DO PAINEL ==== */
function doGetData(){
  const accounts = readAccounts();
  const sources = readSources();
  const transactions = readConsolidatedTransactions(sources);
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
      periodStart: formatDateValue(row[8]), periodEnd: formatDateValue(row[9]),
      closingBalance: (row[10]==='' || row[10]===null || row[10]===undefined) ? null : Number(row[10]),
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

function readConsolidatedTransactions(sources){
  const folder = getSubFolder('fontes');
  const files = folder.getFilesByName('_consolidated.json');
  if(files.hasNext()){
    try{
      const parsed = JSON.parse(files.next().getBlob().getDataAsString('UTF-8'));
      if(parsed && Array.isArray(parsed.rows)) return parsed.rows;
    }catch(e){ console.error('leitura consolidada', e); }
  }
  const rows = readAllTransactions(sources);
  try{ writeOrReplaceFile(folder, '_consolidated.json', JSON.stringify({ rows:rows, builtAt:new Date().toISOString() }), MimeType.PLAIN_TEXT); }catch(e){}
  return rows;
}

function rebuildConsolidatedTransactions(){
  const rows = readAllTransactions(readSources());
  const folder = getSubFolder('fontes');
  writeOrReplaceFile(folder, '_consolidated.json', JSON.stringify({ rows:rows, builtAt:new Date().toISOString() }), MimeType.PLAIN_TEXT);
  return rows.length;
}

function normalizeAccountServer(value){
  return String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
}
function resolveAccountIdServer(value, accounts){
  const raw = String(value||'').trim();
  if(!raw) return '';
  for(let i=0;i<accounts.length;i++) if(String(accounts[i].id)===raw) return accounts[i].id;
  const key = normalizeAccountServer(raw);
  for(let i=0;i<accounts.length;i++) if(normalizeAccountServer(accounts[i].name)===key) return accounts[i].id;
  return '';
}
function validateAndNormalizeImportRows(rows, sourceId, sourceName){
  if(!Array.isArray(rows)) throw mkError('invalid_argument', 'rows inválido');
  const accounts = readAccounts();
  const importId = Utilities.getUuid();
  return rows.map((r,index)=>{
    if(!r || !/^\d{4}-\d{2}-\d{2}$/.test(String(r.date||''))) throw mkError('invalid_argument', 'data inválida na linha '+(index+1));
    if(r.type!=='recebimento' && r.type!=='pagamento') throw mkError('invalid_argument', 'tipo inválido na linha '+(index+1));
    if(r.status!=='realizado' && r.status!=='previsto') throw mkError('invalid_argument', 'status inválido na linha '+(index+1));
    const value = Number(r.value);
    if(!isFinite(value) || value<=0) throw mkError('invalid_argument', 'valor inválido na linha '+(index+1));
    const account = String(r.account||sourceName||'').trim();
    return Object.assign({}, r, {
      id: r.id || sourceId+'_'+String(r.date)+'_'+String(index+1),
      sourceId: sourceId,
      importId: r.importId || importId,
      account: account,
      accountId: r.accountId || resolveAccountIdServer(account, accounts) || resolveAccountIdServer(sourceName, accounts),
      value: value,
    });
  });
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
      periodStart: formatDateValue(row[7]), periodEnd: formatDateValue(row[8]),
      sourceId: String(row[9]||''),
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
    const contaCod = String(row[3]||''), banco = String(row[1]||''), fundo = String(row[2]||'');
    const fundKey = contaCod ? ('cc:'+normalizeAccountServer(contaCod)) : ('bf:'+normalizeAccountServer(banco)+'|'+normalizeAccountServer(fundo));
    funds.push({
      id:String(row[0]), fundKey, banco, fundo, contaCod, competencia,
      saldoInicial:Number(row[5])||0, aplicacoes:Number(row[6])||0, rendimentos:Number(row[7])||0,
      imposto:Number(row[8])||0, resgate:Number(row[9])||0, saldoFinal:Number(row[10])||0,
      rendimentosPct:(row[11]===''||row[11]===null||row[11]===undefined)?null:Number(row[11]),
      cotizacaoResgate:String(row[12]||''), garantia:String(row[13]||''), vinculo:String(row[14]||''), indexador:String(row[15]||''),
      updatedAt:formatDateValue(row[16]),
      liquidezDias:(row[17]===''||row[17]===null||row[17]===undefined)?null:Number(row[17]),
      classificacaoVinculo:String(row[18]||''), periodicAccepted:String(row[19]||'').toLowerCase()==='true'||row[19]===true,
    });
  }
  funds.sort((a,b)=> a.competencia<b.competencia?1:a.competencia>b.competencia?-1:b.saldoFinal-a.saldoFinal);
  const maxMonth = asOfDate ? String(asOfDate).slice(0,7) : '';
  const latestByFund = {};
  funds.forEach(f=>{ if(!latestByFund[f.fundKey] || f.competencia>latestByFund[f.fundKey].competencia) latestByFund[f.fundKey]=f; });
  const currentFunds = Object.keys(latestByFund).map(k=>latestByFund[k]).filter(f=>String(f.competencia).slice(0,7)===maxMonth || f.periodicAccepted);
  const totalBalance=currentFunds.reduce((s,f)=>s+f.saldoFinal,0), byBankMap={};
  currentFunds.forEach(f=>{byBankMap[f.banco]=(byBankMap[f.banco]||0)+f.saldoFinal;});
  return {funds,allFunds:funds,totalBalance,byBank:Object.keys(byBankMap).map(banco=>({banco,total:byBankMap[banco]})).sort((a,b)=>b.total-a.total),asOfDate,asOfMonth:maxMonth,staleCount:0};
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

  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) throw mkError('busy', 'outra importação está em andamento');
  try{
    const normalizedRows = validateAndNormalizeImportRows(body.rows || [], sourceId, body.sourceName||'');
    const fontesFolder = getSubFolder('fontes');
    const fileName = sourceId + '.json';
    const existing = fontesFolder.getFilesByName(fileName);
    const previousContent = existing.hasNext() ? existing.next().getBlob().getDataAsString('UTF-8') : null;
    const rowsContent = JSON.stringify({ rows: normalizedRows, sourceId:sourceId, builtAt:new Date().toISOString() });

    try{
      writeOrReplaceFile(fontesFolder, fileName, rowsContent, MimeType.PLAIN_TEXT);
      const sheet = getSheet(SHEET_SOURCES);
      const data = sheet.getDataRange().getValues();
      let rowIndex = -1;
      for(let i=1;i<data.length;i++){ if(String(data[i][0])===String(sourceId)){ rowIndex = i+1; break; } }
      const importDates = normalizedRows.map(r=>String(r.date||'')).filter(Boolean).sort();
      const detectedStart = importDates.length ? importDates[0] : '';
      const detectedEnd = importDates.length ? importDates[importDates.length-1] : '';
      const values = [
        sourceId, body.sourceName||'', body.filename||'', body.sheetName||'',
        JSON.stringify(body.mapping||{}), body.headerSignature||'',
        normalizedRows.length, new Date().toISOString(),
        detectedStart, detectedEnd,
        (body.closingBalance===null || body.closingBalance===undefined || body.closingBalance==='') ? '' : Number(body.closingBalance),
      ];
      if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
      else sheet.appendRow(values);
      rebuildConsolidatedTransactions();
    }catch(writeErr){
      if(previousContent!==null) writeOrReplaceFile(fontesFolder, fileName, previousContent, MimeType.PLAIN_TEXT);
      throw writeErr;
    }

    if(body.fileBase64){
      try{
        const originaisFolder = getSubFolder('originais');
        const bytes = Utilities.base64Decode(body.fileBase64);
        const blob = Utilities.newBlob(bytes, body.fileMime || 'application/octet-stream', body.filename || (sourceId+'_original'));
        const stamped = sourceId + '__' + Utilities.formatDate(new Date(), Session.getScriptTimeZone()||'GMT', 'yyyyMMdd_HHmmss') + '__' + (body.filename||'arquivo');
        blob.setName(stamped);
        originaisFolder.createFile(blob);
      }catch(e){ console.error('guardar original', e); }
    }
    return { rowCount:normalizedRows.length };
  }finally{
    lock.releaseLock();
  }
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
  rebuildConsolidatedTransactions();
  return {};
}

/* ==== APLICAÇÕES (relatório "Analise Aplicações") ====
 * Ao contrário das fontes bancárias (que se somam), este relatório
 * substitui por completo o conteúdo anterior a cada novo envio — é sempre
 * a fotografia mais recente de todos os fundos, já processada no navegador
 * (ver parseApplicationsWorkbook em app.js). */
function doSaveApplications(body){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) throw mkError('busy','outra atualização está em andamento');
  try{
    const funds = Array.isArray(body.funds) ? body.funds : [];
    const sheet = getSheet(SHEET_APPLICATIONS);
    const lastRow = sheet.getLastRow(), colCount = Math.max(sheet.getLastColumn(),20);
    const previousValues = lastRow>1 ? sheet.getRange(2,1,lastRow-1,colCount).getValues() : [];
    const periodicMap = {};
    previousValues.forEach(row=>{
      const cc=String(row[3]||'').trim(), key=cc?('cc:'+normalizeAccountServer(cc)):('bf:'+normalizeAccountServer(row[1])+'|'+normalizeAccountServer(row[2]));
      const accepted=String(row[19]||'').toLowerCase()==='true'||row[19]===true;
      if(accepted) periodicMap[key]=true;
    });
    const now = new Date().toISOString();
    const values = funds.map(f=>{
      const cc=String(f.contaCod||'').trim(), key=cc?('cc:'+normalizeAccountServer(cc)):('bf:'+normalizeAccountServer(f.banco)+'|'+normalizeAccountServer(f.fundo));
      const periodicAccepted=!!f.periodicAccepted||!!periodicMap[key];
      return [String(f.id||''),String(f.banco||''),String(f.fundo||''),String(f.contaCod||''),String(f.competencia||''),
        Number(f.saldoInicial)||0,Number(f.aplicacoes)||0,Number(f.rendimentos)||0,Number(f.imposto)||0,Number(f.resgate)||0,Number(f.saldoFinal)||0,
        (f.rendimentosPct===null||f.rendimentosPct===undefined||f.rendimentosPct==='')?'':Number(f.rendimentosPct),
        String(f.cotizacaoResgate||''),String(f.garantia||''),String(f.vinculo||''),String(f.indexador||''),now,
        (f.liquidezDias===null||f.liquidezDias===undefined||f.liquidezDias==='')?'':Number(f.liquidezDias),String(f.classificacaoVinculo||''),periodicAccepted];
    });
    try{
      if(lastRow>1) sheet.getRange(2,1,lastRow-1,colCount).clearContent();
      if(values.length) sheet.getRange(2,1,values.length,values[0].length).setValues(values);
    }catch(writeErr){
      const newLast=sheet.getLastRow();
      if(newLast>1) sheet.getRange(2,1,newLast-1,Math.max(sheet.getLastColumn(),colCount)).clearContent();
      if(previousValues.length) sheet.getRange(2,1,previousValues.length,previousValues[0].length).setValues(previousValues);
      throw writeErr;
    }
    if(body.fileBase64){
      try{
        const originaisFolder=getSubFolder('originais'), files=originaisFolder.getFiles();
        while(files.hasNext()){const f=files.next();if(/^aplicacoes(?:__|_atual__)/i.test(f.getName()))f.setTrashed(true);}
        const bytes=Utilities.base64Decode(body.fileBase64), blob=Utilities.newBlob(bytes,body.fileMime||'application/octet-stream',body.filename||'aplicacoes_financeiras');
        blob.setName('aplicacoes_atual__'+(body.filename||'arquivo')); originaisFolder.createFile(blob);
      }catch(e){console.error('guardar original de aplicações',e);}
    }
    return {};
  }finally{lock.releaseLock();}
}

/* ==== HISTÓRICO DE UPLOADS ==== */
function doLogHistory(body){
  const sheet = getSheet(SHEET_HISTORY);
  sheet.appendRow([
    Utilities.getUuid(), body.bank||'', body.filename||'', body.status||'',
    Number(body.rowCount)||0, body.errorMessage||'', new Date().toISOString(),
    body.periodStart||'', body.periodEnd||'', body.sourceId||'',
  ]);
  pruneHistory(sheet);
  return {};
}

function doDeleteHistory(id){
  if(!id) throw mkError('invalid_argument', 'id do histórico ausente');
  const sheet = getSheet(SHEET_HISTORY);
  const data = sheet.getDataRange().getValues();
  for(let i=1;i<data.length;i++){
    if(String(data[i][0])===String(id)){ sheet.deleteRow(i+1); return {}; }
  }
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
    .addItem('Definir e-mail de usuário', 'promptSetUserEmail')
    .addItem('Criar novo usuário', 'promptCreateUser')
    .addToUi();
}

// Cria as quatro abas com os cabeçalhos certos, se ainda não existirem.
// Rode isso uma vez, logo depois de criar a planilha (veja SETUP.md).
function setupSpreadsheet(){
  const ss = getSS();
  ensureSheet(ss, SHEET_USERS, ['username','salt','passwordHash','role','nome','tentativasFalhas','bloqueadoAte','email']);
  ensureSheet(ss, SHEET_ACCOUNTS, ['id','name','kind','balance','asOfDate','order','updatedAt']);
  ensureSheet(ss, SHEET_SOURCES, ['id','sourceName','filename','sheetName','mappingJSON','headerSignature','rowCount','uploadedAt','periodStart','periodEnd','closingBalance']);
  ensureSheet(ss, SHEET_HISTORY, ['id','bank','filename','status','rowCount','errorMessage','at','periodStart','periodEnd','sourceId']);
  ensureSheet(ss, SHEET_APPLICATIONS, ['id','banco','fundo','contaCod','competencia','saldoInicial','aplicacoes','rendimentos','imposto','resgate','saldoFinal','rendimentosPct','cotizacaoResgate','garantia','vinculo','indexador','updatedAt','liquidezDias','classificacaoVinculo','periodicAccepted']);
  ensureSheet(ss, SHEET_RESET_TOKENS, ['id','username','codeHash','expiresAt','usedAt','attempts','requestedAt']);
  getRootFolder();
  SpreadsheetApp.getUi().alert('Planilha configurada/atualizada com sucesso.');
}

function ensureSheet(ss, name, headers){
  let sheet = ss.getSheetByName(name);
  if(!sheet) sheet = ss.insertSheet(name);
  // Mantém o cabeçalho sincronizado quando novas colunas são adicionadas em upgrades.
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
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

  const e = ui.prompt('E-mail para recuperação', 'E-mail cadastrado para redefinição de senha:', ui.ButtonSet.OK_CANCEL);
  if(e.getSelectedButton() !== ui.Button.OK) return;
  const email = e.getResponseText().trim();
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ ui.alert('E-mail inválido.'); return; }

  const p = ui.prompt('Senha inicial', 'Digite a senha para "'+username+'":', ui.ButtonSet.OK_CANCEL);
  if(p.getSelectedButton() !== ui.Button.OK || !p.getResponseText()) return;

  setUserPassword(username, role, nome, p.getResponseText(), email);
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


function promptSetUserEmail(){
  const ui = SpreadsheetApp.getUi();
  const u = ui.prompt('E-mail de recuperação', 'Nome de usuário existente:', ui.ButtonSet.OK_CANCEL);
  if(u.getSelectedButton() !== ui.Button.OK || !u.getResponseText().trim()) return;
  const username = u.getResponseText().trim();
  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for(let i=1;i<data.length;i++){
    if(String(data[i][0]).trim().toLowerCase() === username.toLowerCase()){ rowIndex = i+1; break; }
  }
  if(rowIndex < 0){ ui.alert('Usuário "'+username+'" não encontrado.'); return; }
  const e = ui.prompt('E-mail de recuperação', 'Informe o e-mail que receberá os códigos:', ui.ButtonSet.OK_CANCEL);
  if(e.getSelectedButton() !== ui.Button.OK) return;
  const email = e.getResponseText().trim();
  if(email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){ ui.alert('E-mail inválido.'); return; }
  sheet.getRange(rowIndex,8).setValue(email);
  ui.alert('E-mail de recuperação atualizado para "'+username+'".');
}

function setUserPassword(username, role, nome, plainPassword, email){
  const sheet = getSheet(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  let rowIndex = -1;
  for(let i=1;i<data.length;i++){
    if(String(data[i][0]).trim().toLowerCase() === username.toLowerCase()){ rowIndex = i+1; break; }
  }
  const existingEmail = rowIndex > 0 ? String(sheet.getRange(rowIndex,8).getValue()||'') : '';
  const finalEmail = email === undefined || email === null ? existingEmail : String(email||'').trim();
  const salt = Utilities.getUuid();
  const hash = makePasswordHash(salt, plainPassword);
  const values = [username, salt, hash, role, nome, 0, '', finalEmail];
  if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);
}
