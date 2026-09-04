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
})();
