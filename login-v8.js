/* Plansul — V8 Login leve e independente do dashboard. */
(function(){
  'use strict';
  const SESSION_KEY='plansul_fluxo_caixa_session';
  let submitting=false;

  function byId(id){ return document.getElementById(id); }
  function setMessage(text,isError){
    const box=byId('loginError');
    if(!box) return;
    box.textContent=text||'';
    box.hidden=!text;
    box.classList.toggle('login-v8-info',!!text && !isError);
  }
  function setButtonLoading(loading,label){
    const btn=byId('loginSubmit');
    if(!btn) return;
    btn.disabled=!!loading;
    btn.innerHTML=loading
      ? `<span class="login-v8-spinner" aria-hidden="true"></span>${label||'Entrando…'}`
      : 'Entrar';
  }
  function keepLoginVisible(){
    const overlay=byId('loginOverlay');
    const app=byId('app');
    if(overlay) overlay.hidden=false;
    if(app) app.hidden=true;
  }
  function friendlyError(code){
    if(code==='invalid_credentials') return 'Usuário ou senha inválidos.';
    if(code==='locked') return 'Acesso temporariamente bloqueado. Aguarde alguns minutos e tente novamente.';
    if(code==='timeout') return 'O servidor demorou mais que o esperado. Tente novamente.';
    if(code==='network') return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    return 'Não foi possível realizar o acesso. Tente novamente.';
  }
  async function authenticate(username,password){
    const endpoint=window.PlansulLoginEndpoint;
    if(!endpoint) throw Object.assign(new Error('network'),{code:'network'});
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),12000);
    let response;
    try{
      response=await fetch(endpoint,{
        method:'POST',
        redirect:'follow',
        cache:'no-store',
        credentials:'omit',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action:'login',token:null,username,password}),
        signal:controller.signal
      });
    }catch(err){
      const code=err&&err.name==='AbortError'?'timeout':'network';
      throw Object.assign(new Error(code),{code});
    }finally{
      clearTimeout(timer);
    }
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
  async function openDashboard(){
    if(typeof window.PlansulLoadDashboard!=='function'){
      throw Object.assign(new Error('dashboard-loader-missing'),{code:'network'});
    }
    setButtonLoading(true,'Preparando painel…');
    setMessage('Acesso confirmado. Preparando o painel…',false);
    await window.PlansulLoadDashboard();
    if(typeof window.PlansulBoot!=='function'){
      throw Object.assign(new Error('dashboard-boot-missing'),{code:'network'});
    }
    const ok=await window.PlansulBoot();
    if(ok===false){
      throw Object.assign(new Error('dashboard-load-failed'),{code:'network'});
    }
  }
  async function onSubmit(event){
    event.preventDefault();
    event.stopImmediatePropagation();
    if(submitting) return;
    const user=byId('loginUser');
    const pass=byId('loginPass');
    const username=(user&&user.value||'').trim();
    const password=pass&&pass.value||'';
    if(!username||!password){
      setMessage('Informe usuário e senha.',true);
      (username?pass:user)?.focus();
      return;
    }
    submitting=true;
    setButtonLoading(true,'Entrando…');
    setMessage('',false);
    try{
      await authenticate(username,password);
      await openDashboard();
    }catch(err){
      keepLoginVisible();
      if(pass){ pass.value=''; pass.focus(); }
      const code=err&&err.code;
      if(code==='dashboard-load-failed'){
        setMessage('Acesso confirmado, mas o painel não terminou de carregar. Tente novamente.',true);
      }else{
        setMessage(friendlyError(code),true);
      }
    }finally{
      submitting=false;
      const app=byId('app');
      if(!app||app.hidden) setButtonLoading(false);
    }
  }
  function init(){
    keepLoginVisible();
    const form=byId('loginForm');
    const user=byId('loginUser');
    const pass=byId('loginPass');
    if(user){
      user.placeholder='Usuário';
      user.autocomplete='username';
      user.setAttribute('autocapitalize','none');
      user.setAttribute('spellcheck','false');
      try{
        const stored=JSON.parse(sessionStorage.getItem(SESSION_KEY)||'null');
        if(stored&&stored.username&&!user.value) user.value=stored.username;
      }catch(e){}
    }
    if(pass){ pass.placeholder='Senha'; pass.autocomplete='current-password'; }
    if(form&&!form.dataset.v8Bound){
      form.dataset.v8Bound='1';
      form.addEventListener('submit',onSubmit,true);
    }
    requestAnimationFrame(()=>{
      try{ (user&&!user.value?user:pass)?.focus({preventScroll:true}); }catch(e){}
    });
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',init,{once:true});
  else init();
  window.addEventListener('pageshow',()=>{
    const app=byId('app');
    if(!app||app.hidden) keepLoginVisible();
  });
})();
