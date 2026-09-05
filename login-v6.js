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
  window.__PLANSUL_V12_LOGIN__=true;

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
