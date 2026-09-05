/* Plansul — V8 bootstrap leve.
 * O login abre sem carregar os módulos pesados do dashboard.
 * O restante da aplicação só é carregado depois que as credenciais forem validadas. */
(function(){
  'use strict';
  window.__PLANSUL_DEFER_BOOT__ = true;

  const OLD_ENDPOINT = 'https://script.google.com/macros/s/AKfycbycMtivGfXTx4pKa3ltR29cY0owrV37fJG0Iy9MVlgg-dE99KuqOc7XgcFe0tjKHQ/exec';
  const NEW_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  window.PlansulLoginEndpoint = NEW_ENDPOINT;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    if(typeof input === 'string' && input === OLD_ENDPOINT) input = NEW_ENDPOINT;
    else if(input instanceof Request && input.url === OLD_ENDPOINT) input = new Request(NEW_ENDPOINT, input);
    return nativeFetch(input, init);
  };

  const dashboardCss = [
    'login-fix.css',
    'tesouraria-v3.css',
    'fluxo-v4.css',
    'fluxo-v4-fundcards.css',
    'fluxo-v5-theme.css'
  ];
  const dashboardScripts = [
    'app-core.js',
    'competencias-aplicacoes.js',
    'competencias-wizard.js',
    'tesouraria-v3.js',
    'fluxo-v4.js',
    'fluxo-v4-ui.js',
    'fluxo-v4-datefilters.js',
    'fluxo-v5-theme.js'
  ];

  let dashboardPromise = null;

  function loadCss(href){
    if(document.querySelector(`link[data-plansul-dashboard-css="${href}"]`)) return;
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = href + '?v=8';
    css.dataset.plansulDashboardCss = href;
    document.head.appendChild(css);
  }

  function loadScript(src){
    return new Promise((resolve,reject)=>{
      const existing = document.querySelector(`script[data-plansul-module="${src}"]`);
      if(existing){
        if(existing.dataset.loaded==='1') return resolve(src);
        existing.addEventListener('load',()=>resolve(src),{once:true});
        existing.addEventListener('error',()=>reject(new Error('Falha ao carregar '+src)),{once:true});
        return;
      }
      const el = document.createElement('script');
      el.src = src + '?v=8';
      el.async = false;
      el.dataset.plansulModule = src;
      el.onload = ()=>{ el.dataset.loaded='1'; resolve(src); };
      el.onerror = ()=>reject(new Error('Falha ao carregar '+src));
      document.head.appendChild(el);
    });
  }

  window.PlansulLoadDashboard = function(){
    if(dashboardPromise) return dashboardPromise;
    dashboardPromise = (async()=>{
      dashboardCss.forEach(loadCss);
      for(const src of dashboardScripts) await loadScript(src);
      return true;
    })().catch(err=>{
      dashboardPromise = null;
      console.error('Falha ao carregar o dashboard Plansul:', err);
      throw err;
    });
    return dashboardPromise;
  };
})();
