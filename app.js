/* Plansul — bootstrap da Fase 2.
 * Mantém o núcleo aprovado da Fase 2 isolado em app-core.js e concentra
 * aqui apenas configuração de endpoint e extensões incrementais. */
(function(){
  const OLD_ENDPOINT = 'https://script.google.com/macros/s/AKfycbycMtivGfXTx4pKa3ltR29cY0owrV37fJG0Iy9MVlgg-dE99KuqOc7XgcFe0tjKHQ/exec';
  const NEW_ENDPOINT = 'https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
  const nativeFetch = window.fetch.bind(window);
  window.fetch = function(input, init){
    if(typeof input === 'string' && input === OLD_ENDPOINT) input = NEW_ENDPOINT;
    else if(input instanceof Request && input.url === OLD_ENDPOINT) input = new Request(NEW_ENDPOINT, input);
    return nativeFetch(input, init);
  };

  const css = document.createElement('link');
  css.rel = 'stylesheet';
  css.href = 'login-fix.css';
  document.head.appendChild(css);

  // Estes scripts são carregados durante o parsing, antes de DOMContentLoaded,
  // preservando o ciclo de inicialização original do painel.
  document.write('<script src="app-core.js"><\/script>');
  document.write('<script src="competencias-aplicacoes.js"><\/script>');
})();
