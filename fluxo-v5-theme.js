/* Plansul — V5: alternância de tema mobile Clean / Dark.
 * Mantém o logo institucional atual e persiste a preferência no navegador. */
(function(){
  const STORAGE_KEY='plansul-mobile-theme';
  const root=document.documentElement;

  function normalizeTheme(value){ return value==='dark' ? 'dark' : 'clean'; }
  function savedTheme(){
    try{ return normalizeTheme(localStorage.getItem(STORAGE_KEY)); }
    catch(e){ return 'clean'; }
  }
  function themeIcon(theme){
    return theme==='dark'
      ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a9 9 0 1 0 9 9c0-.46-.03-.91-.1-1.35A7 7 0 0 1 12 3Z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.42 1.42M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.42-1.42M17.66 6.34l1.41-1.41"/></svg>';
  }
  function updateToggle(){
    const btn=document.getElementById('mobileThemeToggle');
    if(!btn) return;
    const current=normalizeTheme(root.dataset.mobileTheme);
    const next=current==='dark'?'clean':'dark';
    btn.innerHTML=themeIcon(current)+`<span class="mobile-theme-toggle-label">${current==='dark'?'Dark':'Clean'}</span>`;
    btn.setAttribute('aria-label',`Alternar para tema ${next==='dark'?'escuro':'claro'}`);
    btn.title=`Alternar para tema ${next==='dark'?'Dark':'Clean'}`;
    btn.dataset.theme=current;
  }
  function applyTheme(theme,persist){
    const next=normalizeTheme(theme);
    root.dataset.mobileTheme=next;
    root.style.colorScheme=next==='dark'?'dark':'light';
    if(persist!==false){
      try{ localStorage.setItem(STORAGE_KEY,next); }catch(e){}
    }
    updateToggle();
  }
  function ensureToggle(){
    if(document.getElementById('mobileThemeToggle')){ updateToggle(); return; }
    const controls=document.querySelector('.topbar-controls');
    if(!controls) return;
    const btn=document.createElement('button');
    btn.id='mobileThemeToggle';
    btn.type='button';
    btn.className='mobile-theme-toggle icon-btn-outline';
    btn.addEventListener('click',()=>{
      const current=normalizeTheme(root.dataset.mobileTheme);
      applyTheme(current==='dark'?'clean':'dark',true);
    });
    const refresh=document.getElementById('btnRefresh');
    if(refresh) controls.insertBefore(btn,refresh); else controls.prepend(btn);
    updateToggle();
  }

  applyTheme(savedTheme(),false);
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',ensureToggle,{once:true});
  else ensureToggle();

  // Mantém o botão disponível após renderizações/reautenticação sem duplicá-lo.
  const observer=new MutationObserver(()=>ensureToggle());
  if(document.body) observer.observe(document.body,{childList:true,subtree:true});
})();
