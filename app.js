/* Plansul — V10 bootstrap leve e resiliente.
 * O login permanece imediato; após autenticação os módulos do dashboard são carregados
 * e o bridge V10 abre o shell do painel antes da carga pesada de dados. */
(function(){
  'use strict';
  window.__PLANSUL_DEFER_BOOT__ = true;
  window.__PLANSUL_ASSET_VERSION__ = 10;

  const OLD_ENDPOINT = 'https://script.google.com/macros/s/AKfycbycMtivGfXTx4pKa3ltR29cY0owrV37fJG0Iy9MVlgg-dE99KuqOc7XgcFe0tjKHQ/exec';
  const NEW_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  window.PlansulLoginEndpoint = NEW_ENDPOINT;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    if(typeof input === 'string' && input === OLD_ENDPOINT) input = NEW_ENDPOINT;
    else if(typeof Request!=='undefined' && input instanceof Request && input.url === OLD_ENDPOINT) input = new Request(NEW_ENDPOINT, input);
    return nativeFetch(input, init);
  };

  const dashboardCss = ['login-fix.css','tesouraria-v3.css','fluxo-v4.css','fluxo-v4-fundcards.css','fluxo-v5-theme.css'];
  const coreScripts = ['app-core.js','competencias-aplicacoes.js','competencias-wizard.js','tesouraria-v3.js','fluxo-v4.js','fluxo-v4-ui.js','fluxo-v4-datefilters.js','fluxo-v5-theme.js'];
  const bridgeScript = 'dashboard-bridge-v10.js';
  let dashboardPromise = null;

  function loadCss(href){
    if(document.querySelector(`link[data-plansul-dashboard-css="${href}"]`)) return;
    const css=document.createElement('link');
    css.rel='stylesheet';
    css.href=href+'?v=10';
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
      const el=document.createElement('script');
      el.src=src+'?v=10';
      el.async=false;
      el.dataset.plansulModule=src;
      el.onload=()=>{ el.dataset.loaded='1'; resolve(src); };
      el.onerror=()=>reject(new Error('Falha ao carregar '+src));
      document.head.appendChild(el);
    });
  }

  async function waitLegacyBootstrap(){
    if(typeof window.PlansulBoot==='function') return true;
    const existingCore=[...document.scripts].some(s=>(s.getAttribute('src')||'').includes('app-core.js'));
    if(!existingCore) return false;
    const limit=Date.now()+3000;
    while(Date.now()<limit){
      if(typeof window.PlansulBoot==='function') return true;
      await new Promise(r=>setTimeout(r,40));
    }
    return typeof window.PlansulBoot==='function';
  }

  window.PlansulLoadDashboard = function(){
    if(window.__PLANSUL_BRIDGE_V10__ && typeof window.PlansulBoot==='function') return Promise.resolve(true);
    if(dashboardPromise) return dashboardPromise;

    dashboardPromise=(async()=>{
      dashboardCss.forEach(loadCss);

      // Compatibilidade com uma página antiga que eventualmente já tenha carregado app-core.js.
      // Nesse caso evitamos redeclarar constantes globais e carregamos apenas o bridge corretivo.
      const legacyReady=await waitLegacyBootstrap();
      if(!legacyReady){
        for(const src of coreScripts) await loadScript(src);
      }
      await loadScript(bridgeScript);
      return true;
    })().catch(err=>{
      dashboardPromise=null;
      console.error('Falha ao carregar o dashboard Plansul:',err);
      throw err;
    });
    return dashboardPromise;
  };
})();
