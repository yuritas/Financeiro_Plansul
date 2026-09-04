/* Complemento do wizard de Aplicações: resume a carteira pela competência atual. */
(function(){
  function mes(v){ const s=String(v||''); return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):''; }
  function classificar(raw){
    const all=(raw&&Array.isArray(raw.funds)?raw.funds:[]).map(f=>({ ...f }));
    const max=all.reduce((m,f)=>mes(f.competencia)>m?mes(f.competencia):m,'');
    const funds=all.filter(f=>mes(f.competencia)===max);
    const reviewFunds=all.filter(f=>mes(f.competencia)<max&&Number(f.saldoFinal)>0);
    const totalBalance=funds.reduce((s,f)=>s+(Number(f.saldoFinal)||0),0);
    const map=new Map(); funds.forEach(f=>map.set(f.banco,(map.get(f.banco)||0)+(Number(f.saldoFinal)||0)));
    const byBank=[...map.entries()].map(([banco,total])=>({banco,total})).sort((a,b)=>b.total-a.total);
    const asOfDate=funds.reduce((m,f)=>String(f.competencia||'')>m?String(f.competencia||''):m,'');
    return { funds, reviewFunds, totalBalance, byBank, asOfDate, asOfMonth:max };
  }

  renderApplicationsSummaryArea=function(){
    const area=document.getElementById('sheetArea'); if(!area) return;
    if(wz.appsError){ area.innerHTML=`<div class="demo-banner" style="margin-top:12px;"><span>&#9888;</span><span>${escapeHtml(wz.appsError)}</span></div>`; return; }
    if(!wz.appsResult){ area.innerHTML=''; return; }
    const r=wz.appsResult, c=classificar(r);
    area.innerHTML=`<div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin:12px 0 0;"><div class="kpi-tile"><div class="kpi-label">Fundos na competência atual</div><div class="kpi-value num">${c.funds.length}</div></div><div class="kpi-tile"><div class="kpi-label">Saldo atual</div><div class="kpi-value num">${formatBRL(c.totalBalance)}</div></div><div class="kpi-tile"><div class="kpi-label">Competência atual</div><div class="kpi-value num" style="font-size:16px;">${c.asOfMonth||'—'}</div></div></div>${c.reviewFunds.length?`<div class="demo-banner" style="margin-top:12px;"><span>&#9888;</span><span><b>${c.reviewFunds.length} fundo(s) para verificar.</b> Têm saldo positivo em competência anterior e ficarão fora do saldo atual.</span></div>`:''}${!r.sourceSheetInfo?`<div class="field-hint" style="margin-top:8px;">Não encontramos a aba "Informações Fundos" — os fundos serão salvos sem vínculo, garantia, cotização e indexador.</div>`:''}`;
  };

  finishApplicationsWizard=async function(){
    const nextBtn=document.getElementById('wizardNext'); nextBtn.disabled=true; nextBtn.textContent='Salvando…';
    try{
      let fileBase64=null; try{ fileBase64=await fileToBase64(wz.file); }catch(e){}
      const r=wz.appsResult, c=classificar(r);
      await saveApplicationsData({ filename:wz.file.name, asOfDate:c.asOfDate, totalBalance:c.totalBalance, byBank:c.byBank, funds:r.funds, fileBase64, fileMime:wz.file.type||'' });
      logUploadHistory({ bank:APPLICATIONS_SOURCE, filename:wz.file.name, status:'concluido', rowCount:r.funds.length });
      closeUploadModal();
      showToast(`Aplicações carregadas: ${c.funds.length} fundo(s) na competência atual${c.reviewFunds.length?` · ${c.reviewFunds.length} para verificar`:''}.`);
    }catch(err){
      console.error(err);
      const msg=(err&&err.code==='forbidden')?'Você não tem permissão para carregar relatórios neste painel.':(err&&err.code==='session_expired')?'Sua sessão expirou. Entre novamente.':(err&&err.message)||'Não foi possível salvar o relatório de aplicações.';
      showToast(msg,true); guardSession(err); nextBtn.disabled=false; nextBtn.textContent='Salvar';
    }
  };
})();
