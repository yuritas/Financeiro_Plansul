/* Plansul — bootstrap do Fluxo de Caixa.
 * O núcleo financeiro aprovado fica em app-core.js; regras incrementais
 * permanecem isoladas para reduzir risco de regressão em futuras mudanças. */
(function(){
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
  ['login-fix.css','tesouraria-v3.css','fluxo-v4.css','fluxo-v4-fundcards.css','fluxo-v5-theme.css'].forEach(href=>{
    const css=document.createElement('link'); css.rel='stylesheet'; css.href=href; document.head.appendChild(css);
  });

  const moduleScripts = ['app-core.js', 'competencias-aplicacoes.js', 'competencias-wizard.js', 'tesouraria-v3.js', 'fluxo-v4.js', 'fluxo-v4-ui.js', 'fluxo-v4-datefilters.js', 'fluxo-v5-theme.js'];
  function loadPlansulModule(src){
    return new Promise((resolve,reject)=>{
      const el=document.createElement('script');
      el.src=src;
      el.async=false;
      el.onload=()=>resolve(src);
      el.onerror=()=>reject(new Error('Falha ao carregar '+src));
      document.head.appendChild(el);
    });
  }
  async function startPlansulModules(){
    await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));
    try{
      for(const src of moduleScripts) await loadPlansulModule(src);
      if(typeof window.PlansulBoot==='function') window.PlansulBoot();
    }catch(err){
      console.error('Falha no bootstrap Plansul:',err);
      if(typeof window.PlansulBoot==='function'){
        try{ window.PlansulBoot(); }catch(e){ console.error(e); }
      }
      const overlay=document.getElementById('loginOverlay');
      const app=document.getElementById('app');
      if(overlay && (!app || app.hidden)) overlay.hidden=false;
      const error=document.getElementById('loginError');
      if(error && typeof window.PlansulBoot!=='function'){
        error.textContent='Não foi possível carregar todos os componentes. Atualize a página e tente novamente.';
        error.hidden=false;
      }
    }
  }
  startPlansulModules();
})();
