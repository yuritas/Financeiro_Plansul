/* Plansul — bootstrap do Fluxo de Caixa.
 * O núcleo financeiro aprovado fica em app-core.js; regras incrementais
 * permanecem isoladas para reduzir risco de regressão em futuras mudanças. */
(function(){
  const OLD_ENDPOINT = 'https://script.google.com/macros/s/AKfycbycMtivGfXTx4pKa3ltR29cY0owrV37fJG0Iy9MVlgg-dE99KuqOc7XgcFe0tjKHQ/exec';
  const NEW_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    if(typeof input === 'string' && input === OLD_ENDPOINT) input = NEW_ENDPOINT;
    else if(input instanceof Request && input.url === OLD_ENDPOINT) input = new Request(NEW_ENDPOINT, input);
    return nativeFetch(input, init);
  };
  ['login-fix.css','tesouraria-v3.css','fluxo-v4.css','fluxo-v4-fundcards.css'].forEach(href=>{
    const css=document.createElement('link'); css.rel='stylesheet'; css.href=href; document.head.appendChild(css);
  });
  document.write('<script src="app-core.js"><\/script>');
  document.write('<script src="competencias-aplicacoes.js"><\/script>');
  document.write('<script src="competencias-wizard.js"><\/script>');
  document.write('<script src="tesouraria-v3.js"><\/script>');
  document.write('<script src="fluxo-v4.js"><\/script>');
  document.write('<script src="fluxo-v4-ui.js"><\/script>');
  document.write('<script src="fluxo-v4-datefilters.js"><\/script>');
})();
