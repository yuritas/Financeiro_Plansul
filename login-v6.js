/* Plansul — V6: pequenos aprimoramentos de UX do login. */
(function(){
  function prepareLogin(){
    const user=document.getElementById('loginUser');
    const pass=document.getElementById('loginPass');
    if(user){
      user.placeholder='Informe seu usuário';
      user.setAttribute('autocapitalize','none');
      user.setAttribute('spellcheck','false');
    }
    if(pass) pass.placeholder='Informe sua senha';
    const overlay=document.getElementById('loginOverlay');
    if(overlay && !overlay.hidden && user && !user.value){
      requestAnimationFrame(()=>{ try{ user.focus({preventScroll:true}); }catch(e){ user.focus(); } });
    }
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',prepareLogin,{once:true});
  else prepareLogin();

  function keepVisibleSurface(){
    const overlay=document.getElementById('loginOverlay');
    const app=document.getElementById('app');
    if(!overlay || !app) return;
    if(app.hidden){
      if(overlay.hidden) overlay.hidden=false;
    }else if(!overlay.hidden){
      overlay.hidden=true;
    }
  }
  function installRecovery(){
    keepVisibleSurface();
    const app=document.getElementById('app');
    if(app) new MutationObserver(keepVisibleSurface).observe(app,{attributes:true,attributeFilter:['hidden']});
  }
  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',installRecovery,{once:true});
  else installRecovery();
  window.addEventListener('error',()=>setTimeout(keepVisibleSurface,0));
  window.addEventListener('unhandledrejection',()=>setTimeout(keepVisibleSurface,0));
  setTimeout(keepVisibleSurface,250);
  setTimeout(keepVisibleSurface,1200);
})();
