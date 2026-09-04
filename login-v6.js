/* Plansul — V7 Login independente e resiliente. */
(function(){
  const SESSION_KEY='plansul_fluxo_caixa_session';
  let submitting=false;

  function el(id){ return document.getElementById(id); }
  function showMessage(text,isError){
    const box=el('loginError');
    if(!box) return;
    box.textContent=text||'';
    box.hidden=!text;
    box.classList.toggle('login-error-info',!!text && !isError);
  }
  function ensureLoginVisible(){
    const overlay=el('loginOverlay');
    const app=el('app');
    if(overlay) overlay.hidden=false;
    if(app) app.hidden=true;
  }
  function prepareFields(){
    const user=el('loginUser'), pass=el('loginPass');
    if(user){
      user.placeholder='Digite seu usuário';
      user.setAttribute('autocapitalize','none');
      user.setAttribute('spellcheck','false');
    }
    if(pass) pass.placeholder='Digite sua senha';
  }
  function errorText(code){
    if(code==='invalid_credentials') return 'Usuário ou senha inválidos.';
    if(code==='locked') return 'Acesso temporariamente bloqueado após tentativas inválidas. Tente novamente mais tarde.';
    if(code==='network' || code==='timeout') return 'Não foi possível conectar ao servidor. Verifique sua conexão e tente novamente.';
    return 'Não foi possível realizar o acesso. Tente novamente.';
  }
  async function waitEndpoint(){
    const started=Date.now();
    while(!window.PlansulLoginEndpoint && Date.now()-started<5000){
      await new Promise(r=>setTimeout(r,40));
    }
    return window.PlansulLoginEndpoint||'';
  }
  async function loginDirect(username,password){
    const endpoint=await waitEndpoint();
    if(!endpoint) throw Object.assign(new Error('network'),{code:'network'});
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),20000);
    let response;
    try{
      response=await fetch(endpoint,{
        method:'POST',
        headers:{'Content-Type':'text/plain;charset=utf-8'},
        body:JSON.stringify({action:'login',token:null,username,password}),
        signal:controller.signal
      });
    }catch(err){
      const code=err && err.name==='AbortError' ? 'timeout' : 'network';
      throw Object.assign(new Error(code),{code});
    }finally{ clearTimeout(timer); }
    if(!response.ok) throw Object.assign(new Error('network'),{code:'network'});
    const json=await response.json();
    if(!json || !json.ok) throw Object.assign(new Error((json&&json.error)||'api-error'),{code:(json&&json.error)||'api-error'});
    const sess={token:json.token,username:json.username,role:json.role,nome:json.nome};
    try{ sessionStorage.setItem(SESSION_KEY,JSON.stringify(sess)); }catch(e){}
    return sess;
  }
  async function submit(e){
    e.preventDefault();
    e.stopImmediatePropagation();
    if(submitting) return;
    const user=el('loginUser'), pass=el('loginPass'), btn=el('loginSubmit');
    const username=(user&&user.value||'').trim();
    const password=pass&&pass.value||'';
    if(!username || !password){ showMessage('Informe usuário e senha.',true); return; }
    submitting=true;
    if(btn){ btn.disabled=true; btn.textContent='Entrando…'; }
    showMessage('Validando suas credenciais…',false);
    try{
      await loginDirect(username,password);
      showMessage('Credenciais validadas. Carregando o painel…',false);
      if(typeof window.PlansulBoot==='function') await window.PlansulBoot();
    }catch(err){
      if(pass){ pass.value=''; pass.focus(); }
      showMessage(errorText(err&&err.code),true);
    }finally{
      submitting=false;
      if(btn){ btn.disabled=false; btn.textContent='Entrar'; }
    }
  }
  function init(){
    ensureLoginVisible();
    prepareFields();
    const form=el('loginForm');
    if(form && !form.dataset.v7Bound){
      form.dataset.v7Bound='1';
      form.addEventListener('submit',submit,true);
    }
    const user=el('loginUser');
    if(user && !user.value) requestAnimationFrame(()=>{ try{user.focus({preventScroll:true});}catch(e){user.focus();} });
  }
  init();
  window.addEventListener('pageshow',()=>{
    const app=el('app'), overlay=el('loginOverlay');
    if(app && app.hidden && overlay) overlay.hidden=false;
  });
})();
