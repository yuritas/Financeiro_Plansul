/* Plansul — V8 Login leve. Mantido neste nome por compatibilidade com páginas em cache. */
(function(){
  'use strict';
  const SESSION_KEY='plansul_fluxo_caixa_session';
  const ENDPOINT='https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  let submitting=false;
  window.PlansulLoginEndpoint=window.PlansulLoginEndpoint||ENDPOINT;
  window.__PLANSUL_V8_ACTIVE__=true;

  function el(id){ return document.getElementById(id); }
  function ensureCss(){
    if(document.querySelector('link[data-login-v8]')) return;
    const link=document.createElement('link');
    link.rel='stylesheet';
    link.href='login-v8.css?v=8';
    link.dataset.loginV8='1';
    document.head.appendChild(link);
  }
  function transformMarkup(){
    const overlay=el('loginOverlay');
    if(!overlay||overlay.dataset.v8Markup==='1') return;
    overlay.dataset.v8Markup='1';
    overlay.className='';
    overlay.setAttribute('aria-label','Acesso à Tesouraria');
    overlay.innerHTML=`
      <section class="login-v8-visual" aria-hidden="true">
        <div class="login-v8-brand">
          <img class="login-v8-logo" src="assets/plansul-wordmark.png" alt="">
          <span class="login-v8-kicker">Tesouraria</span>
        </div>
      </section>
      <section class="login-v8-sheet">
        <form class="login-v8-form" id="loginForm" novalidate>
          <div class="login-v8-field">
            <label for="loginUser">Usuário</label>
            <input type="text" id="loginUser" autocomplete="username" inputmode="text" required>
          </div>
          <div class="login-v8-field">
            <label for="loginPass">Senha</label>
            <input type="password" id="loginPass" autocomplete="current-password" required>
          </div>
          <p class="login-v8-message" id="loginError" hidden role="status" aria-live="polite"></p>
          <div class="login-v8-actions">
            <button type="submit" class="login-v8-submit" id="loginSubmit">Entrar</button>
          </div>
          <p class="login-v8-note">Ambiente interno Plansul</p>
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
  function setButtonLoading(loading,label){
    const btn=el('loginSubmit');
    if(!btn) return;
    btn.disabled=!!loading;
    btn.innerHTML=loading?`<span class="login-v8-spinner" aria-hidden="true"></span>${label||'Entrando…'}`:'Entrar';
  }
  function keepVisible(){
    const overlay=el('loginOverlay'), app=el('app');
    if(overlay) overlay.hidden=false;
    if(app) app.hidden=true;
  }
  function friendly(code){
    if(code==='invalid_credentials') return 'Usuário ou senha inválidos.';
    if(code==='locked') return 'Acesso temporariamente bloqueado. Aguarde alguns minutos e tente novamente.';
    if(code==='timeout') return 'O servidor demorou mais que o esperado. Tente novamente.';
    if(code==='network') return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    return 'Não foi possível realizar o acesso. Tente novamente.';
  }
  async function authenticate(username,password){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    let response;
    try{
      response=await fetch(window.PlansulLoginEndpoint||ENDPOINT,{
        method:'POST',redirect:'follow',cache:'no-store',credentials:'omit',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action:'login',token:null,username,password}),
        signal:controller.signal
      });
    }catch(err){
      const code=err&&err.name==='AbortError'?'timeout':'network';
      throw Object.assign(new Error(code),{code});
    }finally{ clearTimeout(timer); }
    if(!response.ok) throw Object.assign(new Error('network'),{code:'network'});
    let json;
    try{ json=await response.json(); }
    catch(e){ throw Object.assign(new Error('network'),{code:'network'}); }
    if(!json||!json.ok){
      const code=(json&&json.error)||'api-error';
      throw Object.assign(new Error(code),{code});
    }
    const sess={token:json.token,username:json.username,role:json.role,nome:json.nome};
    try{ sessionStorage.setItem(SESSION_KEY,JSON.stringify(sess)); }catch(e){}
    return sess;
  }
  async function waitForLoader(){
    const started=Date.now();
    while(typeof window.PlansulLoadDashboard!=='function'&&Date.now()-started<2500){
      await new Promise(r=>setTimeout(r,25));
    }
    if(typeof window.PlansulLoadDashboard!=='function') throw Object.assign(new Error('network'),{code:'network'});
  }
  async function openDashboard(){
    await waitForLoader();
    setButtonLoading(true,'Preparando painel…');
    setMessage('Acesso confirmado. Preparando o painel…',false);
    await window.PlansulLoadDashboard();
    if(typeof window.PlansulBoot!=='function') throw Object.assign(new Error('network'),{code:'network'});
    const ok=await window.PlansulBoot();
    if(ok===false) throw Object.assign(new Error('dashboard-load-failed'),{code:'dashboard-load-failed'});
  }
  async function submit(e){
    e.preventDefault(); e.stopImmediatePropagation();
    if(submitting) return;
    const user=el('loginUser'),pass=el('loginPass');
    const username=(user&&user.value||'').trim(),password=pass&&pass.value||'';
    if(!username||!password){ setMessage('Informe usuário e senha.',true); (username?pass:user)?.focus(); return; }
    submitting=true; setButtonLoading(true,'Entrando…'); setMessage('',false);
    try{
      await authenticate(username,password);
      await openDashboard();
    }catch(err){
      keepVisible();
      if(pass){ pass.value=''; pass.focus(); }
      if(err&&err.code==='dashboard-load-failed') setMessage('Acesso confirmado, mas o painel não terminou de carregar. Tente novamente.',true);
      else setMessage(friendly(err&&err.code),true);
    }finally{
      submitting=false;
      const app=el('app');
      if(!app||app.hidden) setButtonLoading(false);
    }
  }
  function init(){
    ensureCss(); transformMarkup(); keepVisible();
    const form=el('loginForm'),user=el('loginUser'),pass=el('loginPass');
    if(user){ user.placeholder='Usuário'; user.setAttribute('autocapitalize','none'); user.setAttribute('spellcheck','false'); }
    if(pass) pass.placeholder='Senha';
    if(form&&!form.dataset.v8Bound){ form.dataset.v8Bound='1'; form.addEventListener('submit',submit,true); }
    requestAnimationFrame(()=>{ try{user?.focus({preventScroll:true});}catch(e){} });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true}); else init();
  window.addEventListener('pageshow',()=>{ const app=el('app'); if(!app||app.hidden) keepVisible(); });
})();
