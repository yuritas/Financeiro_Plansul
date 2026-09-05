from pathlib import Path


def replace_once(text, old, new, label):
    if old not in text:
        raise SystemExit(f'Padrão não encontrado: {label}')
    return text.replace(old, new, 1)

# ---------- Backend ----------
p = Path('apps-script/Code.gs')
s = p.read_text(encoding='utf-8')

s = replace_once(s,
"const SHEET_APPLICATIONS = 'Aplicacoes';\nconst APPLICATIONS_STALE_DAYS = 60;",
"const SHEET_APPLICATIONS = 'Aplicacoes';\nconst SHEET_RESET_TOKENS = 'ResetTokens';\nconst RESET_CODE_TTL_MINUTES = 10;\nconst RESET_MAX_ATTEMPTS = 5;\nconst RESET_REQUEST_THROTTLE_SECONDS = 60;\nconst RESET_TOKEN_KEEP = 500;\nconst RESET_GENERIC_MESSAGE = 'Se o e-mail existir, um código foi enviado.';\nconst APPLICATIONS_STALE_DAYS = 60;",
'constantes de reset')

s = replace_once(s,
"      case 'login':\n        result = doLogin(body.username, body.password);\n        break;\n      case 'getData':",
"      case 'login':\n        result = doLogin(body.username, body.password);\n        break;\n      case 'requestPasswordReset':\n        result = doRequestPasswordReset(body.identifier || body.username || body.email);\n        break;\n      case 'verifyResetCode':\n        result = doVerifyResetCode(body.identifier || body.username || body.email, body.code);\n        break;\n      case 'resetPassword':\n        result = doResetPassword(body.identifier || body.username || body.email, body.code, body.newPassword);\n        break;\n      case 'getData':",
'rotas de reset')

old_session = """function requireSession(token){
  if(!token) throw mkError('session_expired');
  const raw = CacheService.getScriptCache().get('sess_' + token);
  if(!raw) throw mkError('session_expired');
  const sess = JSON.parse(raw);
  sess.token = token;
  return sess;
}"""
new_session = """function normalizeUserSessionKey(username){
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
}"""
s = replace_once(s, old_session, new_session, 'versão de sessão')

s = replace_once(s,
"    CacheService.getScriptCache().put('sess_'+token, JSON.stringify({ username: row[0], role, nome }), SESSION_TTL_SECONDS);",
"    CacheService.getScriptCache().put('sess_'+token, JSON.stringify({ username: row[0], role, nome, authVersion:getUserSessionVersion(row[0]) }), SESSION_TTL_SECONDS);",
'sessão com versão')

reset_backend = r'''

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
  return { id:id };
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
        markResetTokenUsed({sheet:getResetTokenSheet(),rowIndex:getResetTokenSheet().getLastRow()});
        console.error('requestPasswordReset MailApp', mailErr);
      }
    }
  }
  return { message:RESET_GENERIC_MESSAGE };
}
function doVerifyResetCode(identifier, code){
  verifyResetCodeInternal(identifier, code);
  return { verified:true };
}
function doResetPassword(identifier, code, newPassword){
  const verified = verifyResetCodeInternal(identifier, code);
  const user = verified.user;
  validateNewPassword(newPassword, user.username);
  setUserPassword(user.username, String(user.row[3]||''), String(user.row[4]||user.username), newPassword, user.email);
  markResetTokenUsed(verified.token);
  bumpUserSessionVersion(user.username);
  return { reset:true, username:user.username };
}
'''

s = replace_once(s,
"\n/* ==== LEITURA DOS DADOS DO PAINEL ==== */",
reset_backend + "\n/* ==== LEITURA DOS DADOS DO PAINEL ==== */",
'bloco de recuperação')

s = replace_once(s,
"  ensureSheet(ss, SHEET_USERS, ['username','salt','passwordHash','role','nome','tentativasFalhas','bloqueadoAte']);",
"  ensureSheet(ss, SHEET_USERS, ['username','salt','passwordHash','role','nome','tentativasFalhas','bloqueadoAte','email']);",
'coluna email')

s = replace_once(s,
"  ensureSheet(ss, SHEET_APPLICATIONS, ['id','banco','fundo','contaCod','competencia','saldoInicial','aplicacoes','rendimentos','imposto','resgate','saldoFinal','rendimentosPct','cotizacaoResgate','garantia','vinculo','indexador','updatedAt','liquidezDias','classificacaoVinculo','periodicAccepted']);\n  getRootFolder();",
"  ensureSheet(ss, SHEET_APPLICATIONS, ['id','banco','fundo','contaCod','competencia','saldoInicial','aplicacoes','rendimentos','imposto','resgate','saldoFinal','rendimentosPct','cotizacaoResgate','garantia','vinculo','indexador','updatedAt','liquidezDias','classificacaoVinculo','periodicAccepted']);\n  ensureSheet(ss, SHEET_RESET_TOKENS, ['id','username','codeHash','expiresAt','usedAt','attempts','requestedAt']);\n  getRootFolder();",
'aba ResetTokens')

s = replace_once(s,
"    .addItem('Definir senha de usuário', 'promptSetPassword')\n    .addItem('Criar novo usuário', 'promptCreateUser')",
"    .addItem('Definir senha de usuário', 'promptSetPassword')\n    .addItem('Definir e-mail de usuário', 'promptSetUserEmail')\n    .addItem('Criar novo usuário', 'promptCreateUser')",
'menu email')

s = replace_once(s,
"  const n = ui.prompt('Nome de exibição', 'Nome que aparece no painel (ex.: André Silva):', ui.ButtonSet.OK_CANCEL);\n  if(n.getSelectedButton() !== ui.Button.OK) return;\n  const nome = n.getResponseText().trim() || username;\n\n  const p = ui.prompt('Senha inicial', 'Digite a senha para \"'+username+'\":', ui.ButtonSet.OK_CANCEL);",
"  const n = ui.prompt('Nome de exibição', 'Nome que aparece no painel (ex.: André Silva):', ui.ButtonSet.OK_CANCEL);\n  if(n.getSelectedButton() !== ui.Button.OK) return;\n  const nome = n.getResponseText().trim() || username;\n\n  const e = ui.prompt('E-mail para recuperação', 'E-mail cadastrado para redefinição de senha:', ui.ButtonSet.OK_CANCEL);\n  if(e.getSelectedButton() !== ui.Button.OK) return;\n  const email = e.getResponseText().trim();\n  if(email && !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)){ ui.alert('E-mail inválido.'); return; }\n\n  const p = ui.prompt('Senha inicial', 'Digite a senha para \"'+username+'\":', ui.ButtonSet.OK_CANCEL);",
'prompt de email')

s = replace_once(s,
"  setUserPassword(username, role, nome, p.getResponseText());",
"  setUserPassword(username, role, nome, p.getResponseText(), email);",
'criação com email')

email_admin = r'''

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
'''
s = replace_once(s,
"\nfunction setUserPassword(username, role, nome, plainPassword){",
email_admin + "\nfunction setUserPassword(username, role, nome, plainPassword, email){",
'admin email e assinatura setUserPassword')

old_set = """  const salt = Utilities.getUuid();
  const hash = makePasswordHash(salt, plainPassword);
  const values = [username, salt, hash, role, nome, 0, ''];
  if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);"""
new_set = """  const existingEmail = rowIndex > 0 ? String(sheet.getRange(rowIndex,8).getValue()||'') : '';
  const finalEmail = email === undefined || email === null ? existingEmail : String(email||'').trim();
  const salt = Utilities.getUuid();
  const hash = makePasswordHash(salt, plainPassword);
  const values = [username, salt, hash, role, nome, 0, '', finalEmail];
  if(rowIndex > 0) sheet.getRange(rowIndex, 1, 1, values.length).setValues([values]);
  else sheet.appendRow(values);"""
s = replace_once(s, old_set, new_set, 'preservação de email em setUserPassword')

p.write_text(s, encoding='utf-8')

# ---------- Frontend login ----------
p = Path('login-v6.js')
s = p.read_text(encoding='utf-8')

s = s.replace('/* Plansul — V12 Login final + fluxo de autenticação resiliente.', '/* Plansul — V13 Login + recuperação de senha por e-mail.')
s = s.replace("  const AUTH_TIMEOUT_MS=60000;", "  const AUTH_TIMEOUT_MS=60000;\n  const RESET_TIMEOUT_MS=60000;\n  const RESET_RESEND_SECONDS=60;")
s = s.replace("  window.__PLANSUL_V12_LOGIN__=true;", "  window.__PLANSUL_V12_LOGIN__=true;\n  window.__PLANSUL_V13_PASSWORD_RESET__=true;")

s = replace_once(s,
"    if(!document.querySelector('link[data-login-effects-v12]')){\n      const fx=document.createElement('link');\n      fx.rel='stylesheet';\n      fx.href='login-v10-effects.css?v=12';\n      fx.dataset.loginEffectsV12='1';\n      document.head.appendChild(fx);\n    }",
"    if(!document.querySelector('link[data-login-effects-v12]')){\n      const fx=document.createElement('link');\n      fx.rel='stylesheet';\n      fx.href='login-v10-effects.css?v=12';\n      fx.dataset.loginEffectsV12='1';\n      document.head.appendChild(fx);\n    }\n    if(!document.querySelector('link[data-password-reset-v13]')){\n      const resetCss=document.createElement('link');\n      resetCss.rel='stylesheet';\n      resetCss.href='password-reset.css?v=13';\n      resetCss.dataset.passwordResetV13='1';\n      document.head.appendChild(resetCss);\n    }",
'css reset')

s = replace_once(s,
"          <div class=\"login-v8-actions\">\n            <button type=\"submit\" class=\"login-v8-submit\" id=\"loginSubmit\">${buttonIdleHtml()}</button>\n          </div>\n        </form>",
"          <div class=\"login-v8-actions\">\n            <button type=\"submit\" class=\"login-v8-submit\" id=\"loginSubmit\">${buttonIdleHtml()}</button>\n          </div>\n          <button type=\"button\" class=\"login-forgot-link\" id=\"forgotPasswordBtn\">Esqueci minha senha</button>\n        </form>",
'transform forgot link')

reset_frontend = r'''

  const resetState={ step:1, identifier:'', code:'', verified:false, resendUntil:0, timer:null, busy:false };

  function resetFriendly(code){
    if(code==='reset_code_invalid') return 'Código inválido. Confira os 6 dígitos e tente novamente.';
    if(code==='reset_code_expired') return 'Este código expirou. Solicite um novo código.';
    if(code==='reset_attempts_exceeded') return 'Limite de tentativas excedido. Solicite um novo código.';
    if(code==='reset_throttled') return 'Aguarde 60 segundos antes de solicitar um novo código.';
    if(code==='weak_password') return 'Use pelo menos 10 caracteres, com letra maiúscula, letra minúscula e número.';
    if(code==='timeout') return 'A solicitação demorou mais que o esperado. Tente novamente.';
    if(code==='network') return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
    return 'Não foi possível concluir a solicitação. Tente novamente.';
  }

  async function resetApi(action,payload){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),RESET_TIMEOUT_MS);
    try{
      const response=await fetch(ENDPOINT,{
        method:'POST',redirect:'follow',headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(Object.assign({action,token:null},payload||{})),signal:controller.signal
      });
      if(!response.ok) throw Object.assign(new Error('network'),{code:'network'});
      let json;
      try{json=await response.json();}catch(e){throw Object.assign(new Error('network'),{code:'network'});}
      if(!json||!json.ok){const code=(json&&json.error)||'api-error';throw Object.assign(new Error(code),{code,message:json&&json.message});}
      return json;
    }catch(err){
      if(err&&err.name==='AbortError') throw Object.assign(new Error('timeout'),{code:'timeout'});
      if(err&&err.code) throw err;
      throw Object.assign(new Error('network'),{code:'network'});
    }finally{clearTimeout(timer);}
  }

  function ensureResetModal(){
    if(el('passwordResetOverlay')) return;
    const node=document.createElement('div');
    node.id='passwordResetOverlay';
    node.className='password-reset-overlay';
    node.hidden=true;
    node.innerHTML=`<section class="password-reset-dialog" role="dialog" aria-modal="true" aria-labelledby="passwordResetTitle">
      <header class="password-reset-head"><div><span class="password-reset-eyebrow">TESOURARIA</span><h2 id="passwordResetTitle">Redefinir senha</h2><p id="passwordResetSubtitle">Informe seu usuário ou e-mail cadastrado.</p></div><button type="button" class="password-reset-close" id="passwordResetClose" aria-label="Fechar">×</button></header>
      <div class="password-reset-steps" aria-label="Etapas"><span data-reset-step="1" class="active">1</span><i></i><span data-reset-step="2">2</span><i></i><span data-reset-step="3">3</span></div>
      <form id="passwordResetForm" class="password-reset-form" novalidate><div id="passwordResetBody"></div><p id="passwordResetMessage" class="password-reset-message" hidden role="status" aria-live="polite"></p><footer class="password-reset-actions"><button type="button" class="password-reset-secondary" id="passwordResetBack" hidden>Voltar</button><span class="password-reset-spacer"></span><button type="submit" class="password-reset-primary" id="passwordResetNext">Enviar código</button></footer></form>
    </section>`;
    document.body.appendChild(node);
    el('passwordResetClose').addEventListener('click',closeResetModal);
    node.addEventListener('click',e=>{if(e.target===node) closeResetModal();});
    el('passwordResetBack').addEventListener('click',()=>{ if(resetState.step>1){resetState.step--;renderResetStep();} });
    el('passwordResetForm').addEventListener('submit',handleResetSubmit);
  }

  function resetMessage(text,isError){
    const box=el('passwordResetMessage'); if(!box)return;
    box.textContent=text||''; box.hidden=!text; box.classList.toggle('is-error',!!isError);
  }
  function setResetBusy(on,label){
    resetState.busy=!!on;
    const btn=el('passwordResetNext'); if(btn){btn.disabled=!!on; if(label)btn.textContent=label;}
    const back=el('passwordResetBack'); if(back)back.disabled=!!on;
  }
  function stopResendTimer(){ if(resetState.timer){clearInterval(resetState.timer);resetState.timer=null;} }
  function updateResendButton(){
    const btn=el('passwordResetResend'); if(!btn)return;
    const remaining=Math.max(0,Math.ceil((resetState.resendUntil-Date.now())/1000));
    btn.disabled=remaining>0||resetState.busy;
    btn.textContent=remaining>0?`Reenviar em ${remaining}s`:'Reenviar código';
  }
  function startResendTimer(){
    stopResendTimer(); updateResendButton();
    resetState.timer=setInterval(()=>{updateResendButton();if(Date.now()>=resetState.resendUntil)stopResendTimer();},1000);
  }
  function renderResetStep(){
    const body=el('passwordResetBody'), title=el('passwordResetTitle'), sub=el('passwordResetSubtitle'), next=el('passwordResetNext'), back=el('passwordResetBack');
    if(!body||!next)return;
    resetMessage('',false);
    document.querySelectorAll('[data-reset-step]').forEach(x=>x.classList.toggle('active',Number(x.dataset.resetStep)<=resetState.step));
    if(back)back.hidden=resetState.step===1;
    if(resetState.step===1){
      title.textContent='Redefinir senha'; sub.textContent='Informe seu usuário ou e-mail cadastrado.'; next.textContent='Enviar código';
      body.innerHTML=`<label class="password-reset-label" for="resetIdentifier">Usuário ou e-mail</label><input class="password-reset-input" id="resetIdentifier" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" placeholder="Ex.: financeiro ou nome@empresa.com" value="${escapeReset(resetState.identifier)}" required><p class="password-reset-hint">Por segurança, a resposta é sempre a mesma, exista ou não uma conta correspondente.</p>`;
      setTimeout(()=>el('resetIdentifier')?.focus(),0);
    }else if(resetState.step===2){
      title.textContent='Digite o código'; sub.textContent='Enviamos um código de 6 dígitos para o e-mail cadastrado, se a conta existir.'; next.textContent='Validar código';
      body.innerHTML=`<label class="password-reset-label" for="resetCode">Código de verificação</label><input class="password-reset-input password-reset-code" id="resetCode" type="text" inputmode="numeric" autocomplete="one-time-code" maxlength="6" pattern="[0-9]{6}" placeholder="000000" value="${escapeReset(resetState.code)}" required><div class="password-reset-inline"><span>O código expira em 10 minutos.</span><button type="button" id="passwordResetResend" class="password-reset-resend">Reenviar código</button></div>`;
      el('passwordResetResend').addEventListener('click',resendResetCode); startResendTimer(); setTimeout(()=>el('resetCode')?.focus(),0);
    }else{
      stopResendTimer(); title.textContent='Crie uma nova senha'; sub.textContent='A nova senha substituirá a senha atual imediatamente.'; next.textContent='Salvar nova senha';
      body.innerHTML=`<label class="password-reset-label" for="resetNewPassword">Nova senha</label><input class="password-reset-input" id="resetNewPassword" type="password" autocomplete="new-password" placeholder="Nova senha" required><label class="password-reset-label" for="resetConfirmPassword">Confirmar nova senha</label><input class="password-reset-input" id="resetConfirmPassword" type="password" autocomplete="new-password" placeholder="Repita a nova senha" required><p class="password-reset-hint">Mínimo de 10 caracteres, com letra maiúscula, letra minúscula e número.</p>`;
      setTimeout(()=>el('resetNewPassword')?.focus(),0);
    }
  }
  function escapeReset(value){return String(value||'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function openResetModal(){
    ensureResetModal();
    const current=(el('loginUser')&&el('loginUser').value||'').trim();
    resetState.step=1;resetState.identifier=current;resetState.code='';resetState.verified=false;resetState.resendUntil=0;resetState.busy=false;
    const overlay=el('passwordResetOverlay');overlay.hidden=false;document.body.classList.add('password-reset-open');renderResetStep();
  }
  function closeResetModal(){
    stopResendTimer(); const overlay=el('passwordResetOverlay');if(overlay)overlay.hidden=true;document.body.classList.remove('password-reset-open');resetState.busy=false;
  }
  async function resendResetCode(){
    if(Date.now()<resetState.resendUntil||resetState.busy)return;
    setResetBusy(true);resetMessage('',false);
    try{
      const json=await resetApi('requestPasswordReset',{identifier:resetState.identifier});
      resetState.resendUntil=Date.now()+RESET_RESEND_SECONDS*1000;resetMessage(json.message||'Se o e-mail existir, um código foi enviado.',false);startResendTimer();
    }catch(err){resetMessage(resetFriendly(err&&err.code),true);}finally{setResetBusy(false,'Validar código');updateResendButton();}
  }
  async function handleResetSubmit(e){
    e.preventDefault(); if(resetState.busy)return;
    resetMessage('',false);
    if(resetState.step===1){
      const identifier=(el('resetIdentifier')&&el('resetIdentifier').value||'').trim(); if(!identifier){resetMessage('Informe seu usuário ou e-mail.',true);return;}
      setResetBusy(true,'Enviando…');
      try{
        const json=await resetApi('requestPasswordReset',{identifier}); resetState.identifier=identifier;resetState.resendUntil=Date.now()+RESET_RESEND_SECONDS*1000;resetState.step=2;renderResetStep();resetMessage(json.message||'Se o e-mail existir, um código foi enviado.',false);
      }catch(err){resetMessage(resetFriendly(err&&err.code),true);}finally{setResetBusy(false,resetState.step===2?'Validar código':'Enviar código');}
      return;
    }
    if(resetState.step===2){
      const code=String(el('resetCode')&&el('resetCode').value||'').replace(/\D/g,''); if(code.length!==6){resetMessage('Digite os 6 dígitos do código.',true);return;}
      setResetBusy(true,'Validando…');
      try{await resetApi('verifyResetCode',{identifier:resetState.identifier,code});resetState.code=code;resetState.verified=true;resetState.step=3;renderResetStep();}
      catch(err){resetMessage(resetFriendly(err&&err.code),true);}finally{setResetBusy(false,resetState.step===3?'Salvar nova senha':'Validar código');}
      return;
    }
    const password=el('resetNewPassword')&&el('resetNewPassword').value||'';
    const confirm=el('resetConfirmPassword')&&el('resetConfirmPassword').value||'';
    if(password!==confirm){resetMessage('As senhas não coincidem.',true);return;}
    if(password.length<10||!/[a-z]/.test(password)||!/[A-Z]/.test(password)||!/\d/.test(password)){resetMessage(resetFriendly('weak_password'),true);return;}
    setResetBusy(true,'Salvando…');
    try{
      const json=await resetApi('resetPassword',{identifier:resetState.identifier,code:resetState.code,newPassword:password});
      closeResetModal();
      const user=el('loginUser'),pass=el('loginPass');if(user&&json.username)user.value=json.username;if(pass){pass.value='';pass.focus();}
      setMessage('Senha redefinida com sucesso. Entre com a nova senha.',false);
    }catch(err){resetMessage(resetFriendly(err&&err.code),true);setResetBusy(false,'Salvar nova senha');}
  }
'''

s = replace_once(s,
"\n  async function ensureDashboardLoader(){",
reset_frontend + "\n  async function ensureDashboardLoader(){",
'frontend recuperação')

s = replace_once(s,
"    if(form&&!form.dataset.v12Bound){\n      form.dataset.v12Bound='1';\n      form.addEventListener('submit',submit);\n    }",
"    if(form&&!form.dataset.v12Bound){\n      form.dataset.v12Bound='1';\n      form.addEventListener('submit',submit);\n    }\n    ensureResetModal();\n    const forgot=el('forgotPasswordBtn');\n    if(forgot&&!forgot.dataset.resetBound){forgot.dataset.resetBound='1';forgot.addEventListener('click',openResetModal);}",
'bind forgot')

p.write_text(s, encoding='utf-8')

# ---------- HTML ----------
for filename in ('index.html','diretoria.html'):
    p=Path(filename); s=p.read_text(encoding='utf-8')
    s=s.replace('login-v6.css?v=12', 'login-v6.css?v=13')
    s=s.replace('<link rel="stylesheet" href="login-v6.css?v=13">', '<link rel="stylesheet" href="login-v6.css?v=13">\n<link rel="stylesheet" href="password-reset.css?v=13">')
    s=s.replace('login-v6.js?v=12', 'login-v6.js?v=13')
    old='''      <div class="login-v8-actions">\n        <button type="submit" class="login-v8-submit" id="loginSubmit">Entrar<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"></path><path d="m14 7 5 5-5 5"></path></svg></button>\n      </div>\n    </form>'''
    new='''      <div class="login-v8-actions">\n        <button type="submit" class="login-v8-submit" id="loginSubmit">Entrar<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"></path><path d="m14 7 5 5-5 5"></path></svg></button>\n      </div>\n      <button type="button" class="login-forgot-link" id="forgotPasswordBtn">Esqueci minha senha</button>\n    </form>'''
    if old not in s: raise SystemExit(f'login markup não encontrado em {filename}')
    s=s.replace(old,new,1)
    p.write_text(s,encoding='utf-8')

# ---------- CSS novo ----------
Path('password-reset.css').write_text(r'''/* Plansul Tesouraria — recuperação de senha V13 */
.login-forgot-link{display:block;margin:18px auto 0;border:0;background:transparent;color:#4d758a;font:600 13px/1.2 "IBM Plex Sans",system-ui,sans-serif;cursor:pointer;padding:8px 12px;border-radius:9px;transition:color .15s,background .15s}.login-forgot-link:hover{color:#024766;background:rgba(2,71,102,.06)}.login-forgot-link:focus-visible{outline:2px solid #1aa7a0;outline-offset:2px}.password-reset-overlay[hidden]{display:none!important}.password-reset-overlay{position:fixed;inset:0;z-index:2000;display:flex;align-items:center;justify-content:center;padding:22px;background:rgba(0,26,39,.62);backdrop-filter:blur(12px);-webkit-backdrop-filter:blur(12px)}body.password-reset-open{overflow:hidden}.password-reset-dialog{width:min(100%,480px);max-height:min(90vh,720px);overflow:auto;background:#fff;color:#183541;border-radius:24px;box-shadow:0 30px 80px rgba(0,25,38,.34);border:1px solid rgba(255,255,255,.55)}.password-reset-head{display:flex;align-items:flex-start;gap:20px;padding:28px 28px 16px}.password-reset-head>div{flex:1}.password-reset-eyebrow{display:inline-flex;align-items:center;gap:7px;color:#159b97;font-size:10px;font-weight:800;letter-spacing:.18em}.password-reset-eyebrow:before{content:'';width:7px;height:7px;border-radius:50%;background:#23c7bc}.password-reset-head h2{font-size:24px;line-height:1.15;margin:8px 0 6px;color:#063e59}.password-reset-head p{margin:0;color:#708791;font-size:13px;line-height:1.45}.password-reset-close{width:36px;height:36px;border:0;border-radius:50%;background:#f1f5f6;color:#627983;font-size:24px;line-height:1;cursor:pointer}.password-reset-close:hover{background:#e6eef0;color:#173f50}.password-reset-steps{display:grid;grid-template-columns:28px 1fr 28px 1fr 28px;align-items:center;padding:4px 28px 22px}.password-reset-steps span{width:28px;height:28px;border-radius:50%;display:grid;place-items:center;background:#e8eff1;color:#80959e;font-size:12px;font-weight:800;transition:.2s}.password-reset-steps span.active{background:linear-gradient(135deg,#0c8f9d,#024766);color:#fff;box-shadow:0 5px 14px rgba(2,71,102,.18)}.password-reset-steps i{height:1px;background:#dce6e9}.password-reset-form{padding:0 28px 28px}.password-reset-label{display:block;margin:16px 0 7px;color:#456371;font-size:12px;font-weight:700}.password-reset-input{width:100%;height:50px;border:1px solid #cedce1;border-radius:12px;background:#fafdfe;color:#173846;padding:0 14px;font:500 15px "IBM Plex Sans",system-ui,sans-serif;outline:0;transition:border .15s,box-shadow .15s,background .15s}.password-reset-input:focus{border-color:#159b97;background:#fff;box-shadow:0 0 0 3px rgba(21,155,151,.11)}.password-reset-code{text-align:center;font-family:"IBM Plex Mono",monospace;font-size:24px;font-weight:700;letter-spacing:.28em;padding-left:calc(14px + .28em)}.password-reset-hint{margin:10px 2px 0;color:#82959d;font-size:11.5px;line-height:1.45}.password-reset-inline{display:flex;align-items:center;justify-content:space-between;gap:12px;margin:12px 2px 0;color:#82959d;font-size:11.5px}.password-reset-resend{border:0;background:transparent;padding:5px 0;color:#087b83;font-weight:700;font-size:11.5px;cursor:pointer}.password-reset-resend:disabled{color:#9aacb3;cursor:default}.password-reset-message{margin:16px 0 0;padding:11px 12px;border-radius:10px;background:#e7f5f3;color:#167568;font-size:12px;line-height:1.4}.password-reset-message.is-error{background:#fff0ef;color:#b74343}.password-reset-actions{display:flex;align-items:center;gap:10px;margin-top:22px}.password-reset-spacer{flex:1}.password-reset-secondary,.password-reset-primary{min-height:44px;border-radius:12px;padding:0 16px;font:700 12.5px "IBM Plex Sans",system-ui,sans-serif;cursor:pointer}.password-reset-secondary{border:1px solid #d8e3e6;background:#fff;color:#57707b}.password-reset-primary{border:0;min-width:140px;background:linear-gradient(100deg,#0b9aaa 0%,#024766 100%);color:#fff;box-shadow:0 10px 24px -15px rgba(2,71,102,.7)}.password-reset-primary:disabled,.password-reset-secondary:disabled{opacity:.55;cursor:wait}@media(max-width:600px){.password-reset-overlay{align-items:flex-end;padding:0;background:rgba(0,26,39,.5)}.password-reset-dialog{width:100%;max-height:88vh;border-radius:28px 28px 0 0;border-bottom:0}.password-reset-head{padding:26px 22px 14px}.password-reset-steps{padding:4px 22px 18px}.password-reset-form{padding:0 22px max(26px,env(safe-area-inset-bottom))}.password-reset-actions{position:sticky;bottom:0;background:#fff;padding:12px 0 0}.password-reset-primary{min-width:148px}.login-forgot-link{margin-top:14px;font-size:12.5px}}
''',encoding='utf-8')

print('Password reset V13 aplicado nos arquivos de trabalho.')
