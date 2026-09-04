from pathlib import Path
import re

p = Path('app-core.js')
s = p.read_text(encoding='utf-8')
old = "if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);\nelse boot();"
new = "window.PlansulBoot = boot;\nif(!window.__PLANSUL_DEFER_BOOT__){\n  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);\n  else boot();\n}"
if old not in s:
    raise SystemExit('boot block not found')
p.write_text(s.replace(old, new, 1), encoding='utf-8')

p = Path('app.js')
s = p.read_text(encoding='utf-8')
marker = '(function(){\n'
if marker not in s:
    raise SystemExit('app iife not found')
s = s.replace(marker, marker + "  window.__PLANSUL_DEFER_BOOT__ = true;\n", 1)
paths = re.findall(r'''document\.write\('<script src="([^"]+)"''', s)
if len(paths) < 5:
    raise SystemExit('module list not found: %s' % len(paths))
s = re.sub(r'^\s*document\.write\([^\n]+\);\n?', '', s, flags=re.M)
loader = '''
  const moduleScripts = __PATHS__;
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
'''.replace('__PATHS__', repr(paths))
idx = s.rfind('})();')
if idx < 0:
    raise SystemExit('app iife end not found')
s = s[:idx] + loader + s[idx:]
p.write_text(s, encoding='utf-8')

p = Path('login-v6.js')
s = p.read_text(encoding='utf-8')
needle = "  else prepareLogin();\n})();"
replacement = '''  else prepareLogin();

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
})();'''
if needle not in s:
    raise SystemExit('login extension point not found')
p.write_text(s.replace(needle, replacement, 1), encoding='utf-8')
