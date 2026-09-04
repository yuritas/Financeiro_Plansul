/* Plansul — V6: SheetJS deixa de bloquear a ativação do login.
 * Se o Financeiro tentar importar antes do carregamento terminar, aguardamos a biblioteca. */
(function(){
  let xlsxPromise=null;
  function waitExistingScript(script){
    return new Promise((resolve,reject)=>{
      if(window.XLSX){ resolve(window.XLSX); return; }
      script.addEventListener('load',()=>window.XLSX?resolve(window.XLSX):reject(new Error('SheetJS não ficou disponível.')),{once:true});
      script.addEventListener('error',()=>reject(new Error('Não foi possível carregar SheetJS.')),{once:true});
    });
  }
  window.ensurePlansulXlsx=function(){
    if(window.XLSX) return Promise.resolve(window.XLSX);
    if(xlsxPromise) return xlsxPromise;
    const existing=document.querySelector('script[data-plansul-xlsx],script[src*="xlsx.full.min.js"]');
    if(existing){ xlsxPromise=waitExistingScript(existing); return xlsxPromise; }
    xlsxPromise=new Promise((resolve,reject)=>{
      const script=document.createElement('script');
      script.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      script.async=true;
      script.dataset.plansulXlsx='1';
      script.onload=()=>window.XLSX?resolve(window.XLSX):reject(new Error('SheetJS não ficou disponível.'));
      script.onerror=()=>reject(new Error('Não foi possível carregar SheetJS.'));
      document.head.appendChild(script);
    });
    return xlsxPromise;
  };

  document.addEventListener('click',async function(e){
    const btn=e.target.closest && e.target.closest('#btnUpload');
    if(!btn || window.XLSX) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const oldText=btn.textContent;
    btn.disabled=true;
    btn.textContent='Preparando importação…';
    try{
      await window.ensurePlansulXlsx();
      btn.disabled=false;
      btn.textContent=oldText;
      if(typeof openUploadModal==='function') openUploadModal();
    }catch(err){
      console.error(err);
      btn.disabled=false;
      btn.textContent=oldText;
      if(typeof showToast==='function') showToast('Não foi possível carregar o leitor de Excel. Verifique sua conexão e tente novamente.',true);
    }
  },true);
})();
