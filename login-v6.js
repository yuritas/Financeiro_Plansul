/* Plansul — V12 Login final + fluxo de autenticação resiliente.
 * O login valida a credencial, grava a sessão e reinicia a página em um estado limpo.
 * Na recarga, a sessão é restaurada e o painel é iniciado sem misturar o ciclo do formulário
 * com o carregamento dos módulos financeiros. */
(function(){
  'use strict';

  const SESSION_KEY='plansul_fluxo_caixa_session';
  const ENDPOINT='https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  const AUTH_TIMEOUT_MS=60000;
  let submitting=false;
  let resuming=false;

  window.PlansulLoginEndpoint=ENDPOINT;
  window.__PLANSUL_V14_LOGIN__=true;

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

  // "Lembrar de mim" grava a sessão em localStorage (sobrevive a fechar o
  // navegador) em vez de sessionStorage (perdida ao fechar a aba/janela).
  // Em ambos os casos o token continua expirando no servidor no máximo em
  // SESSION_TTL_SECONDS (6h, teto do CacheService do Apps Script) — "lembrar
  // de mim" evita perder a sessão ao fechar o navegador, não estende esse teto.
  function readStoredSession(){
    try{
      const raw=sessionStorage.getItem(SESSION_KEY)||localStorage.getItem(SESSION_KEY);
      if(!raw) return null;
      const parsed=JSON.parse(raw);
      return parsed&&parsed.token?parsed:null;
    }catch(e){ return null; }
  }
  function writeStoredSession(sess,remember){
    try{
      if(remember){
        localStorage.setItem(SESSION_KEY,JSON.stringify(sess));
        sessionStorage.removeItem(SESSION_KEY);
      }else{
        sessionStorage.setItem(SESSION_KEY,JSON.stringify(sess));
        localStorage.removeItem(SESSION_KEY);
      }
    }catch(e){}
  }
  function clearStoredSession(){
    try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){}
    try{ localStorage.removeItem(SESSION_KEY); }catch(e){}
  }

  function ensureCss(){
    if(!document.querySelector('link[data-login-v14]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='login-v8.css?v=14';
      link.dataset.loginV14='1';
      document.head.appendChild(link);
    }
    if(!document.querySelector('link[data-login-effects-v14]')){
      const fx=document.createElement('link');
      fx.rel='stylesheet';
      fx.href='login-v10-effects.css?v=14';
      fx.dataset.loginEffectsV14='1';
      document.head.appendChild(fx);
    }
  }

  function transformMarkup(){
    const overlay=el('loginOverlay');
    if(!overlay||overlay.dataset.v14Markup==='1') return;
    overlay.dataset.v14Markup='1';
    overlay.className='';
    overlay.setAttribute('aria-label','Acesso à Tesouraria');
    overlay.innerHTML=`
      <div class="login-v8-ring login-v8-ring-1" aria-hidden="true"></div>
      <div class="login-v8-ring login-v8-ring-2" aria-hidden="true"></div>
      <div class="login-v8-ring login-v8-ring-3" aria-hidden="true"></div>
      <div class="login-v8-ring login-v8-ring-4" aria-hidden="true"></div>
      <section class="login-v8-visual" aria-hidden="true"></section>
      <div class="login-v8-desktop-brand" aria-hidden="true">
        <img class="login-v8-desktop-logo" src="./assets/plansul-wordmark.png?v=14" alt="">
        <span class="login-v8-desktop-badge">TESOURARIA</span>
      </div>
      <section class="login-v8-sheet">
        <p class="login-v8-desktop-heading">Acesso à Tesouraria</p>
        <p class="login-v8-desktop-sub">Entre com suas credenciais para continuar</p>
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
          <div class="login-v8-desktop-row">
            <label class="login-v8-remember"><input type="checkbox" id="loginRemember"> Lembrar de mim</label>
            <button type="button" class="login-v8-forgot" id="loginForgotBtn">Esqueci minha senha</button>
          </div>
          <p class="login-v8-message" id="loginError" hidden role="status" aria-live="polite"></p>
          <div class="login-v8-actions">
            <button type="submit" class="login-v8-submit" id="loginSubmit">${buttonIdleHtml()}</button>
          </div>
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

  async function authenticate(username,password,remember){
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
      writeStoredSession(sess,!!remember);
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
      script.src='app.js?v=13';
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
    const rememberBox=el('loginRemember');
    const username=(user&&user.value||'').trim();
    const password=pass&&pass.value||'';
    const remember=!!(rememberBox&&rememberBox.checked);

    if(!username||!password){
      setMessage('Informe usuário e senha.',true);
      (username?pass:user)?.focus();
      return;
    }

    submitting=true;
    setBusy(true,'Entrando…');
    setMessage('',false);
    try{
      await authenticate(username,password,remember);
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

  /* ==== "Esqueci minha senha" — wizard de 3 passos ====
   * Reaproveita o padrão visual dos modais já usados no restante do painel
   * (.modal-overlay/.modal/.modal-head/.modal-body/.modal-foot/.field, de
   * styles.css, que já é carregado nesta página) em vez de criar um estilo
   * novo. Fala com o mesmo endpoint do Apps Script, sem precisar de sessão. */
  const reset={step:0,identifier:'',code:'',overlay:null,cooldownTimer:null,cooldownUntil:0};

  async function callResetApi(action,payload){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),AUTH_TIMEOUT_MS);
    try{
      const response=await fetch(ENDPOINT,{
        method:'POST',
        redirect:'follow',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify(Object.assign({action,token:null},payload)),
        signal:controller.signal
      });
      if(!response.ok) throw Object.assign(new Error('network'),{code:'network'});
      let json;
      try{ json=await response.json(); }
      catch(e){ throw Object.assign(new Error('network'),{code:'network'}); }
      if(!json||!json.ok){
        const code=(json&&json.error)||'api-error';
        throw Object.assign(new Error((json&&json.message)||code),{code});
      }
      return json;
    }catch(err){
      if(err&&err.name==='AbortError') throw Object.assign(new Error('timeout'),{code:'timeout'});
      if(err&&err.code) throw err;
      throw Object.assign(new Error('network'),{code:'network'});
    }finally{
      clearTimeout(timer);
    }
  }

  function resetFriendly(code){
    if(code==='invalid_code') return 'Código inválido ou expirado.';
    if(code==='too_many_attempts') return 'Muitas tentativas incorretas. Peça um novo código.';
    if(code==='throttled') return 'Aguarde um minuto antes de pedir um novo código.';
    if(code==='weak_password') return 'A nova senha deve ter pelo menos 8 caracteres.';
    if(code==='invalid_argument') return 'Informe seu usuário ou e-mail.';
    if(code==='timeout') return 'A operação demorou mais que o esperado. Tente novamente.';
    if(code==='network') return 'Não foi possível conectar ao servidor. Verifique sua conexão.';
    return 'Não foi possível concluir. Tente novamente.';
  }

  function buildResetOverlay(){
    if(reset.overlay) return reset.overlay;
    const overlay=document.createElement('div');
    overlay.className='modal-overlay';
    overlay.id='resetOverlay';
    overlay.hidden=true;
    overlay.innerHTML=`
      <div class="modal" style="max-width:440px">
        <div class="modal-head">
          <h2 id="resetTitle">Esqueci minha senha</h2>
          <p id="resetSubtitle"></p>
        </div>
        <div class="steps">
          <span class="step-dot" data-step="0"></span>
          <span class="step-dot" data-step="1"></span>
          <span class="step-dot" data-step="2"></span>
        </div>
        <div class="modal-body" id="resetBody"></div>
        <div class="modal-foot">
          <button type="button" class="btn btn-ghost" id="resetBack">Cancelar</button>
          <span class="spacer"></span>
          <button type="button" class="btn btn-primary" id="resetNext">Continuar</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    overlay.addEventListener('click',e=>{ if(e.target===overlay) closeResetWizard(); });
    overlay.querySelector('#resetBack').addEventListener('click',()=>{
      if(reset.step>0){ reset.step-=1; renderResetStep(); }
      else closeResetWizard();
    });
    overlay.querySelector('#resetNext').addEventListener('click',resetGoNext);
    reset.overlay=overlay;
    return overlay;
  }

  function setResetMessage(text,isError){
    const box=el('resetMsg');
    if(!box) return;
    box.textContent=text||'';
    box.hidden=!text;
    box.classList.toggle('login-error-info',!!text&&!isError);
  }

  function updateResetDots(){
    const overlay=reset.overlay;
    if(!overlay) return;
    overlay.querySelectorAll('.step-dot').forEach(dot=>{
      const step=Number(dot.dataset.step);
      dot.classList.toggle('active',step===reset.step);
      dot.classList.toggle('done',step<reset.step);
    });
  }

  function startResendCooldown(){
    reset.cooldownUntil=Date.now()+60000;
    tickResendCooldown();
  }
  function tickResendCooldown(){
    const btn=el('resetResend');
    if(!btn) return;
    const remaining=Math.ceil((reset.cooldownUntil-Date.now())/1000);
    if(remaining>0){
      btn.disabled=true;
      btn.textContent='Reenviar código ('+remaining+'s)';
      clearTimeout(reset.cooldownTimer);
      reset.cooldownTimer=setTimeout(tickResendCooldown,1000);
    }else{
      btn.disabled=false;
      btn.textContent='Reenviar código';
    }
  }

  function renderResetStep(){
    const overlay=buildResetOverlay();
    updateResetDots();
    const subtitle=el('resetSubtitle');
    const body=el('resetBody');
    const nextBtn=el('resetNext');
    const backBtn=el('resetBack');
    if(reset.step===0){
      subtitle.textContent='Informe seu usuário ou e-mail cadastrado.';
      backBtn.textContent='Cancelar';
      nextBtn.textContent='Enviar código';
      body.innerHTML=`
        <div class="field">
          <label for="resetIdentifier">Usuário ou e-mail</label>
          <input type="text" id="resetIdentifier" autocomplete="username" placeholder="Seu usuário ou e-mail cadastrado">
        </div>
        <p class="login-error" id="resetMsg" hidden></p>`;
      const idInput=el('resetIdentifier');
      idInput.value=reset.identifier;
      idInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); resetGoNext(); } });
      requestAnimationFrame(()=>{ try{idInput.focus({preventScroll:true});}catch(e){} });
    }else if(reset.step===1){
      subtitle.textContent='Digite o código de 6 dígitos enviado por e-mail.';
      backBtn.textContent='Voltar';
      nextBtn.textContent='Verificar código';
      body.innerHTML=`
        <div class="field">
          <label for="resetCode">Código de verificação</label>
          <input type="text" id="resetCode" inputmode="numeric" autocomplete="one-time-code" maxlength="6" placeholder="000000">
          <p class="field-hint">Enviamos um código para o e-mail cadastrado, se ele existir. Expira em 10 minutos.</p>
        </div>
        <button type="button" class="btn btn-ghost btn-small" id="resetResend">Reenviar código</button>
        <p class="login-error" id="resetMsg" hidden></p>`;
      const codeInput=el('resetCode');
      codeInput.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); resetGoNext(); } });
      el('resetResend').addEventListener('click',resetResendCode);
      startResendCooldown();
      requestAnimationFrame(()=>{ try{codeInput.focus({preventScroll:true});}catch(e){} });
    }else if(reset.step===2){
      subtitle.textContent='Defina a nova senha de acesso.';
      backBtn.textContent='Voltar';
      nextBtn.textContent='Redefinir senha';
      body.innerHTML=`
        <div class="field">
          <label for="resetNewPass">Nova senha</label>
          <input type="password" id="resetNewPass" autocomplete="new-password" placeholder="Mínimo 8 caracteres">
        </div>
        <div class="field">
          <label for="resetNewPass2">Confirmar nova senha</label>
          <input type="password" id="resetNewPass2" autocomplete="new-password" placeholder="Repita a nova senha">
        </div>
        <p class="login-error" id="resetMsg" hidden></p>`;
      const p2=el('resetNewPass2');
      p2.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); resetGoNext(); } });
      requestAnimationFrame(()=>{ try{el('resetNewPass').focus({preventScroll:true});}catch(e){} });
    }
  }

  async function resetResendCode(){
    if(Date.now()<reset.cooldownUntil) return;
    setResetMessage('',false);
    try{
      await callResetApi('requestPasswordReset',{identifier:reset.identifier});
      setResetMessage('Novo código enviado.',false);
      startResendCooldown();
    }catch(err){
      console.error('V14 reset resend',err);
      setResetMessage(resetFriendly(err&&err.code),true);
    }
  }

  async function resetGoNext(){
    const nextBtn=el('resetNext');
    if(reset.step===0){
      const idInput=el('resetIdentifier');
      const identifier=(idInput&&idInput.value||'').trim();
      if(!identifier){ setResetMessage('Informe seu usuário ou e-mail.',true); return; }
      reset.identifier=identifier;
      nextBtn.disabled=true; nextBtn.textContent='Enviando…';
      try{
        await callResetApi('requestPasswordReset',{identifier});
        reset.step=1;
        renderResetStep();
      }catch(err){
        console.error('V14 reset request',err);
        setResetMessage(resetFriendly(err&&err.code),true);
      }finally{
        nextBtn.disabled=false;
        if(reset.step===0) nextBtn.textContent='Enviar código';
      }
    }else if(reset.step===1){
      const codeInput=el('resetCode');
      const code=(codeInput&&codeInput.value||'').trim();
      if(!/^\d{6}$/.test(code)){ setResetMessage('Digite o código de 6 dígitos.',true); return; }
      reset.code=code;
      nextBtn.disabled=true; nextBtn.textContent='Verificando…';
      try{
        await callResetApi('verifyResetCode',{identifier:reset.identifier,code});
        reset.step=2;
        renderResetStep();
      }catch(err){
        console.error('V14 reset verify',err);
        setResetMessage(resetFriendly(err&&err.code),true);
      }finally{
        nextBtn.disabled=false;
        if(reset.step===1) nextBtn.textContent='Verificar código';
      }
    }else if(reset.step===2){
      const p1=el('resetNewPass'), p2=el('resetNewPass2');
      const newPassword=p1&&p1.value||'';
      const confirmPassword=p2&&p2.value||'';
      if(newPassword.length<8){ setResetMessage('A nova senha deve ter pelo menos 8 caracteres.',true); return; }
      if(newPassword!==confirmPassword){ setResetMessage('As senhas não coincidem.',true); return; }
      nextBtn.disabled=true; nextBtn.textContent='Salvando…';
      try{
        await callResetApi('resetPassword',{identifier:reset.identifier,code:reset.code,newPassword});
        const identifierForLogin=reset.identifier;
        closeResetWizard();
        const userField=el('loginUser');
        if(userField && identifierForLogin.indexOf('@')===-1) userField.value=identifierForLogin;
        setMessage('Senha redefinida com sucesso. Entre com sua nova senha.',false);
        const passField=el('loginPass');
        if(passField){ passField.value=''; try{passField.focus({preventScroll:true});}catch(e){} }
      }catch(err){
        console.error('V14 reset password',err);
        setResetMessage(resetFriendly(err&&err.code),true);
      }finally{
        nextBtn.disabled=false;
        if(reset.step===2) nextBtn.textContent='Redefinir senha';
      }
    }
  }

  function openResetWizard(){
    reset.step=0;
    reset.identifier='';
    reset.code='';
    const userField=el('loginUser');
    if(userField&&userField.value) reset.identifier=userField.value.trim();
    const overlay=buildResetOverlay();
    overlay.hidden=false;
    renderResetStep();
  }

  function closeResetWizard(){
    if(reset.overlay) reset.overlay.hidden=true;
    clearTimeout(reset.cooldownTimer);
  }

  function init(){
    ensureCss();
    transformMarkup();
    keepLoginVisible();

    const form=el('loginForm');
    const user=el('loginUser');
    const pass=el('loginPass');
    const forgotBtn=el('loginForgotBtn');
    if(user){
      user.setAttribute('autocapitalize','none');
      user.setAttribute('spellcheck','false');
    }
    if(form&&!form.dataset.v12Bound){
      form.dataset.v12Bound='1';
      form.addEventListener('submit',submit);
    }
    if(forgotBtn&&!forgotBtn.dataset.v14Bound){
      forgotBtn.dataset.v14Bound='1';
      forgotBtn.addEventListener('click',openResetWizard);
    }

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
