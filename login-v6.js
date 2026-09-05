/* Plansul — V13 Login + recuperação de senha por e-mail.
 * O login valida a credencial, grava a sessão e reinicia a página em um estado limpo.
 * Na recarga, a sessão é restaurada e o painel é iniciado sem misturar o ciclo do formulário
 * com o carregamento dos módulos financeiros. */
(function(){
  'use strict';

  const SESSION_KEY='plansul_fluxo_caixa_session';
  const ENDPOINT='https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  const AUTH_TIMEOUT_MS=60000;
  const RESET_TIMEOUT_MS=60000;
  const RESET_RESEND_SECONDS=60;
  let submitting=false;
  let resuming=false;

  window.PlansulLoginEndpoint=ENDPOINT;
  window.__PLANSUL_V12_LOGIN__=true;
  window.__PLANSUL_V13_PASSWORD_RESET__=true;

  function el(id){ return document.getElementById(id); }
  function userIcon(){
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="7" r="4"></circle><path d="M4.5 21v-2.2c0-4.1 3.3-7.3 7.5-7.3s7.5 3.2 7.5 7.3V21"></path></svg>';
  }
  function lockIcon(){
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10" width="14" height="11" rx="2"></rect><path d="M8 10V7a4 4 0 0 1 8 0v3"></path><path d="M12 14v3"></path></svg>';
  }
  function arrowIcon(){
    return '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13"></path><path d="m14 7 5 5-5 5"></path></svg>';
  }
  function buttonIdleHtml(){ return 'Entrar'+arrowIcon(); }

  function readStoredSession(){
    try{
      const raw=sessionStorage.getItem(SESSION_KEY);
      if(!raw) return null;
      const parsed=JSON.parse(raw);
      return parsed&&parsed.token?parsed:null;
    }catch(e){ return null; }
  }
  function clearStoredSession(){
    try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
  }

  function ensureCss(){
    if(!document.querySelector('link[data-login-v12]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='login-v8.css?v=12';
      link.dataset.loginV12='1';
      document.head.appendChild(link);
    }
    if(!document.querySelector('link[data-login-effects-v12]')){
      const fx=document.createElement('link');
      fx.rel='stylesheet';
      fx.href='login-v10-effects.css?v=12';
      fx.dataset.loginEffectsV12='1';
      document.head.appendChild(fx);
    }
    if(!document.querySelector('link[data-password-reset-v13]')){
      const resetCss=document.createElement('link');
      resetCss.rel='stylesheet';
      resetCss.href='password-reset.css?v=13';
      resetCss.dataset.passwordResetV13='1';
      document.head.appendChild(resetCss);
    }
  }

  function transformMarkup(){
    const overlay=el('loginOverlay');
    if(!overlay||overlay.dataset.v12Markup==='1') return;
    overlay.dataset.v12Markup='1';
    overlay.className='';
    overlay.setAttribute('aria-label','Acesso à Tesouraria');
    overlay.innerHTML=`
      <section class="login-v8-visual" aria-hidden="true"></section>
      <section class="login-v8-sheet">
        <form class="login-v8-form" id="loginForm" novalidate>
          <div class="login-v8-field">
            <span class="login-v8-field-icon">${userIcon()}</span>
            <label for="loginUser">Usuário</label>
            <input type="text" id="loginUser" autocomplete="username" inputmode="text" placeholder="Usuário" required>
          </div>
          <div class="login-v8-field">
            <span class="login-v8-field-icon">${lockIcon()}</span>
            <label for="loginPass">Senha</label>
            <input type="password" id="loginPass" autocomplete="current-password" placeholder="Senha" required>
          </div>
          <p class="login-v8-message" id="loginError" hidden role="status" aria-live="polite"></p>
          <div class="login-v8-actions">
            <button type="submit" class="login-v8-submit" id="loginSubmit">${buttonIdleHtml()}</button>
          </div>
          <button type="button" class="login-forgot-link" id="forgotPasswordBtn">Esqueci minha senha</button>
        </form>
      </section>`;
  }

  function setMessage(text,isError){
    const box=el('loginError');
    if(!box) return;
    box.textContent=text||'';
    box.hidden=!text;
    box.classList.toggle('login-v8-info',!!text&&!isError);
  }

  function setBusy(on,label){
    const overlay=el('loginOverlay');
    const btn=el('loginSubmit');
    if(overlay) overlay.classList.toggle('login-v10-authenticating',!!on);
    if(!btn) return;
    btn.disabled=!!on;
    btn.innerHTML=on?`<span class="login-v8-spinner" aria-hidden="true"></span>${label||'Entrando…'}`:buttonIdleHtml();
  }

  function keepLoginVisible(){
    const overlay=el('loginOverlay');
    const app=el('app');
    if(overlay){
      overlay.hidden=false;
      overlay.classList.remove('login-v10-leaving');
    }
    if(app) app.hidden=true;
  }

  function friendly(code){
    if(code==='invalid_credentials') return 'Usuário ou senha inválidos.';
    if(code==='locked') return 'Acesso temporariamente bloqueado. Aguarde alguns minutos e tente novamente.';
    if(code==='timeout') return 'A validação demorou mais que o esperado. Tente novamente.';
    if(code==='network') return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    return 'Não foi possível realizar o acesso. Tente novamente.';
  }

  async function authenticate(username,password){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),AUTH_TIMEOUT_MS);
    const progress=setTimeout(()=>setMessage('Validando acesso…',false),1800);
    try{
      const response=await fetch(ENDPOINT,{
        method:'POST',
        redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action:'login',token:null,username,password}),
        signal:controller.signal
      });
      if(!response.ok) throw Object.assign(new Error('network'),{code:'network'});
      let json;
      try{ json=await response.json(); }
      catch(e){ throw Object.assign(new Error('network'),{code:'network'}); }
      if(!json||!json.ok){
        const code=(json&&json.error)||'api-error';
        throw Object.assign(new Error(code),{code});
      }
      const sess={token:json.token,username:json.username,role:json.role,nome:json.nome};
      sessionStorage.setItem(SESSION_KEY,JSON.stringify(sess));
      return sess;
    }catch(err){
      if(err&&err.name==='AbortError') throw Object.assign(new Error('timeout'),{code:'timeout'});
      if(err&&err.code) throw err;
      throw Object.assign(new Error('network'),{code:'network'});
    }finally{
      clearTimeout(timer);
      clearTimeout(progress);
    }
  }


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

  async function ensureDashboardLoader(){
    if(typeof window.PlansulLoadDashboard==='function') return true;
    const existing=[...document.scripts].find(s=>(s.getAttribute('src')||'').includes('app.js'));
    if(existing){
      const until=Date.now()+5000;
      while(Date.now()<until){
        if(typeof window.PlansulLoadDashboard==='function') return true;
        await new Promise(r=>setTimeout(r,40));
      }
    }
    if(typeof window.PlansulLoadDashboard==='function') return true;

    await new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='app.js?v=12';
      script.async=false;
      script.onload=resolve;
      script.onerror=()=>reject(new Error('bootstrap'));
      document.head.appendChild(script);
    });
    return typeof window.PlansulLoadDashboard==='function';
  }

  async function resumeSavedSession(){
    const stored=readStoredSession();
    if(!stored||resuming) return false;
    resuming=true;
    setBusy(true,'Abrindo painel…');
    setMessage('Abrindo painel…',false);
    try{
      if(!(await ensureDashboardLoader())) throw new Error('bootstrap');
      await window.PlansulLoadDashboard();
      if(typeof window.PlansulBoot!=='function') throw new Error('bootstrap');
      const opened=await window.PlansulBoot();
      if(opened===false){
        clearStoredSession();
        keepLoginVisible();
        setMessage('Sua sessão expirou. Entre novamente.',true);
        setBusy(false);
        return false;
      }
      return true;
    }catch(err){
      console.error('V12 resume session',err);
      keepLoginVisible();
      setMessage('Não foi possível iniciar o painel. Recarregue a página e tente novamente.',true);
      setBusy(false);
      return false;
    }finally{
      resuming=false;
    }
  }

  async function submit(e){
    e.preventDefault();
    if(submitting) return;

    const user=el('loginUser');
    const pass=el('loginPass');
    const username=(user&&user.value||'').trim();
    const password=pass&&pass.value||'';

    if(!username||!password){
      setMessage('Informe usuário e senha.',true);
      (username?pass:user)?.focus();
      return;
    }

    submitting=true;
    setBusy(true,'Entrando…');
    setMessage('',false);
    try{
      await authenticate(username,password);
      setMessage('Acesso autorizado. Abrindo painel…',false);
      setBusy(true,'Abrindo painel…');

      /*
       * Reiniciar a página depois da autenticação é deliberado: mantém sessionStorage,
       * mas elimina qualquer estado parcial criado pela tela de login. Na recarga,
       * resumeSavedSession() abre o dashboard usando um ciclo limpo de scripts.
       */
      setTimeout(()=>window.location.reload(),120);
    }catch(err){
      console.error('V12 login',err);
      if(pass){ pass.value=''; pass.focus(); }
      setMessage(friendly(err&&err.code),true);
      setBusy(false);
      submitting=false;
    }
  }

  function init(){
    ensureCss();
    transformMarkup();
    keepLoginVisible();

    const form=el('loginForm');
    const user=el('loginUser');
    const pass=el('loginPass');
    if(user){
      user.setAttribute('autocapitalize','none');
      user.setAttribute('spellcheck','false');
    }
    if(form&&!form.dataset.v12Bound){
      form.dataset.v12Bound='1';
      form.addEventListener('submit',submit);
    }
    ensureResetModal();
    const forgot=el('forgotPasswordBtn');
    if(forgot&&!forgot.dataset.resetBound){forgot.dataset.resetBound='1';forgot.addEventListener('click',openResetModal);}

    const stored=readStoredSession();
    if(stored){
      setTimeout(resumeSavedSession,0);
    }else{
      requestAnimationFrame(()=>{ try{user?.focus({preventScroll:true});}catch(e){} });
    }
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();

  window.addEventListener('pageshow',event=>{
    if(event.persisted){
      const stored=readStoredSession();
      if(stored) resumeSavedSession();
      else keepLoginVisible();
    }
  });
})();
