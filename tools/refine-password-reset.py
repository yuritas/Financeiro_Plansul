from pathlib import Path

p=Path('apps-script/Code.gs')
s=p.read_text(encoding='utf-8')

def rep(old,new,label):
    global s
    if old not in s: raise SystemExit('Padrão ausente: '+label)
    s=s.replace(old,new,1)

rep("""  pruneResetTokens(sheet);
  return { id:id };
}""","""  pruneResetTokens(sheet);
  return { id:id, sheet:sheet, rowIndex:sheet.getLastRow() };
}""",'token row reference')

old="""  const user = findUserByIdentifier(key);
  if(user && user.email && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(user.email)){
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
          htmlBody:'<div style=\"font-family:Arial,sans-serif;color:#153544;line-height:1.5\"><p>Olá,</p><p>Use o código abaixo para redefinir sua senha de acesso à <b>Plansul Tesouraria</b>:</p><p style=\"font-size:30px;font-weight:700;letter-spacing:8px;color:#024766;margin:24px 0\">' + code + '</p><p>O código expira em <b>' + RESET_CODE_TTL_MINUTES + ' minutos</b> e pode ser usado uma única vez.</p><p style=\"color:#687d86;font-size:12px\">Se você não solicitou esta alteração, ignore este e-mail.</p></div>'
        });
        cache.put(canonicalThrottleKey, '1', RESET_REQUEST_THROTTLE_SECONDS);
      }catch(mailErr){
        markResetTokenUsed({sheet:getResetTokenSheet(),rowIndex:getResetTokenSheet().getLastRow()});
        console.error('requestPasswordReset MailApp', mailErr);
      }
    }
  }
  return { message:RESET_GENERIC_MESSAGE };
}"""
new="""  const user = findUserByIdentifier(key);
  if(user && user.email && /^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(user.email)){
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
                htmlBody:'<div style=\"font-family:Arial,sans-serif;color:#153544;line-height:1.5\"><p>Olá,</p><p>Use o código abaixo para redefinir sua senha de acesso à <b>Plansul Tesouraria</b>:</p><p style=\"font-size:30px;font-weight:700;letter-spacing:8px;color:#024766;margin:24px 0\">' + code + '</p><p>O código expira em <b>' + RESET_CODE_TTL_MINUTES + ' minutos</b> e pode ser usado uma única vez.</p><p style=\"color:#687d86;font-size:12px\">Se você não solicitou esta alteração, ignore este e-mail.</p></div>'
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
}"""
rep(old,new,'request lock')

rep("""function doVerifyResetCode(identifier, code){
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
}""","""function doVerifyResetCode(identifier, code){
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
}""",'verify/reset locks')

p.write_text(s,encoding='utf-8')
print('Refinamentos aplicados.')
