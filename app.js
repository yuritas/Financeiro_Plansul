/* Plansul — V13 bootstrap leve e resiliente.
 * O login é carregado primeiro. O dashboard (um único arquivo consolidado) só entra
 * quando existe sessão válida. A URL do Apps Script agora vive só em um lugar
 * (app-core.js, dentro de dashboard.js) — não há mais patch de fetch aqui. */
(function(){
  'use strict';
  const ASSET_VERSION=13;
  window.__PLANSUL_DEFER_BOOT__=true;
  window.__PLANSUL_ASSET_VERSION__=ASSET_VERSION;

  window.PlansulLoginEndpoint='https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';

  const dashboardCss=['dashboard.css'];
  const coreScripts=['dashboard.js'];
  let dashboardPromise=null;

  function versioned(path){ return path+'?v='+ASSET_VERSION; }

  function loadCss(href){
    if(document.querySelector(`link[data-plansul-dashboard-css="${href}"]`)) return;
    const css=document.createElement('link');
    css.rel='stylesheet';
    css.href=versioned(href);
    css.dataset.plansulDashboardCss=href;
    document.head.appendChild(css);
  }

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const selector=`script[data-plansul-module="${src}"]`;
      const existing=document.querySelector(selector);
      if(existing){
        if(existing.dataset.loaded==='1') return resolve(src);
        existing.addEventListener('load',()=>resolve(src),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Falha ao carregar '+src)),{once:true});
        return;
      }
      const script=document.createElement('script');
      script.src=versioned(src);
      script.async=false;
      script.dataset.plansulModule=src;
      script.onload=()=>{ script.dataset.loaded='1'; resolve(src); };
      script.onerror=()=>reject(new Error('Falha ao carregar '+src));
      document.head.appendChild(script);
    });
  }

  async function waitLegacyBootstrap(){
    if(typeof window.PlansulBoot==='function') return true;
    const existingCore=[...document.scripts].some(s=>(s.getAttribute('src')||'').includes('dashboard.js'));
    if(!existingCore) return false;
    const limit=Date.now()+3000;
    while(Date.now()<limit){
      if(typeof window.PlansulBoot==='function') return true;
      await new Promise(r=>setTimeout(r,40));
    }
    return typeof window.PlansulBoot==='function';
  }

  window.PlansulLoadDashboard=function(){
    if(window.__PLANSUL_BRIDGE_V10__&&typeof window.PlansulBoot==='function') return Promise.resolve(true);
    if(dashboardPromise) return dashboardPromise;

    dashboardPromise=(async()=>{
      dashboardCss.forEach(loadCss);
      const legacyReady=await waitLegacyBootstrap();
      if(!legacyReady){
        for(const src of coreScripts) await loadScript(src);
      }
      return true;
    })().catch(err=>{
      dashboardPromise=null;
      console.error('Falha ao carregar o dashboard Plansul:',err);
      throw err;
    });
    return dashboardPromise;
  };
})();
