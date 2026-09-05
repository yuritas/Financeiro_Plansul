/* Plansul — V10 bridge de abertura do painel.
 * Após autenticar, o shell do dashboard abre imediatamente e os dados carregam em segundo plano.
 * Isso evita que uma carga inicial lenta mantenha o usuário preso na tela de login. */
(function(){
  'use strict';

  function injectStyle(){
    if(document.getElementById('plansulV10BridgeStyle')) return;
    const style=document.createElement('style');
    style.id='plansulV10BridgeStyle';
    style.textContent=`
      #loginOverlay.login-v10-leaving{opacity:0;transform:scale(1.008);pointer-events:none;transition:opacity .22s ease,transform .22s ease}
      #plansulInitialLoader{position:fixed;inset:0;z-index:2500;display:flex;align-items:center;justify-content:center;background:rgba(244,248,249,.92);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);transition:opacity .18s ease}
      #plansulInitialLoader[hidden]{display:none!important}
      .plansul-initial-loader-card{display:flex;align-items:center;gap:13px;padding:14px 18px;border:1px solid rgba(0,74,92,.09);border-radius:16px;background:#fff;box-shadow:0 16px 42px rgba(0,39,54,.12);color:#36535f;font:600 13px/1.3 "IBM Plex Sans",system-ui,sans-serif}
      .plansul-initial-loader-spin{width:18px;height:18px;border:2px solid rgba(0,112,132,.18);border-top-color:#087f8d;border-radius:50%;animation:plansulV10Spin .72s linear infinite}
      @keyframes plansulV10Spin{to{transform:rotate(360deg)}}
      html[data-mobile-theme="dark"] #plansulInitialLoader{background:rgba(7,20,27,.90)}
      html[data-mobile-theme="dark"] .plansul-initial-loader-card{background:#10232b;border-color:rgba(104,220,217,.12);color:#d9e8eb;box-shadow:0 18px 45px rgba(0,0,0,.28)}
      @media(prefers-reduced-motion:reduce){#loginOverlay.login-v10-leaving{transition:none}.plansul-initial-loader-spin{animation-duration:1.2s}}
    `;
    document.head.appendChild(style);
  }

  function loader(on,text){
    injectStyle();
    let el=document.getElementById('plansulInitialLoader');
    if(on){
      if(!el){
        el=document.createElement('div');
        el.id='plansulInitialLoader';
        el.setAttribute('role','status');
        el.setAttribute('aria-live','polite');
        el.innerHTML='<div class="plansul-initial-loader-card"><span class="plansul-initial-loader-spin" aria-hidden="true"></span><span id="plansulInitialLoaderText">Carregando painel…</span></div>';
        document.body.appendChild(el);
      }
      const label=document.getElementById('plansulInitialLoaderText');
      if(label) label.textContent=text||'Carregando painel…';
      el.hidden=false;
    }else if(el){
      el.style.opacity='0';
      setTimeout(()=>{ if(el){ el.hidden=true; el.style.opacity=''; } },180);
    }
  }

  function revealShell(){
    const app=document.getElementById('app');
    const overlay=document.getElementById('loginOverlay');
    if(app) app.hidden=false;
    if(overlay){
      overlay.classList.add('login-v10-leaving');
      setTimeout(()=>{ overlay.hidden=true; overlay.classList.remove('login-v10-leaving'); },220);
    }
    loader(true,'Carregando dados do fluxo de caixa…');
  }

  window.PlansulBoot=async function plansulBootV10(){
    let stored=null;
    try{ stored=typeof loadStoredSession==='function' ? loadStoredSession() : null; }catch(e){}
    if(!stored || !stored.token){
      loader(false);
      if(typeof showLoginScreen==='function') showLoginScreen('Informe usuário e senha para continuar.',false);
      return false;
    }

    try{ session=stored; }catch(e){
      console.error('V10: não foi possível restaurar a sessão.',e);
      if(typeof showLoginScreen==='function') showLoginScreen('Não foi possível restaurar sua sessão. Entre novamente.',true);
      return false;
    }

    try{ if(typeof applyEditGating==='function') applyEditGating(); }catch(e){ console.error('V10 applyEditGating',e); }
    try{ if(typeof wireStaticEvents==='function') wireStaticEvents(); }catch(e){ console.error('V10 wireStaticEvents',e); }

    revealShell();

    let loaded=false;
    try{
      if(typeof loadData!=='function') throw new Error('loadData indisponível');
      loaded=await loadData();
    }catch(err){
      console.error('V10 carga inicial',err);
      loaded=false;
    }

    // loadData limpa `session` quando o backend informa sessão expirada.
    if(!session){
      loader(false);
      const app=document.getElementById('app');
      if(app) app.hidden=true;
      const overlay=document.getElementById('loginOverlay');
      if(overlay) overlay.hidden=false;
      return false;
    }

    loader(false);
    try{ if(typeof hideLoginScreen==='function') hideLoginScreen(); }catch(e){}

    if(loaded){
      try{ if(typeof startPolling==='function') startPolling(); }catch(e){ console.error('V10 polling',e); }
      return true;
    }

    // A autenticação já foi concluída. Se a primeira carga falhar, mantemos o painel aberto
    // e oferecemos o botão Atualizar, em vez de devolver o usuário ao login.
    try{ if(typeof setSync==='function') setSync('stale','Falha ao carregar — toque em atualizar'); }catch(e){}
    try{
      if(typeof showToast==='function') showToast('Acesso realizado. A primeira carga dos dados não terminou; toque em Atualizar para tentar novamente.',true);
    }catch(e){}
    return true;
  };
})();
