/* Plansul — regra de competência das Aplicações Financeiras.
 * A competência máxima do arquivo é a carteira atual.
 * Fundo com saldo positivo em competência anterior fica fora do saldo atual
 * e aparece em Verificação de importação com status "Verificar". */
(function(){
  function competenciaMes(value){
    const text = String(value || '');
    return /^\d{4}-\d{2}/.test(text) ? text.slice(0,7) : '';
  }

  function classificarAplicacoes(raw){
    if(!raw) return raw;
    const origem = Array.isArray(raw.allFunds) ? raw.allFunds : (Array.isArray(raw.funds) ? raw.funds : []);
    const allFunds = origem.map(f=>({ ...f }));
    const maxMonth = allFunds.reduce((max,f)=>{
      const m = competenciaMes(f.competencia);
      return m > max ? m : max;
    }, '');
    if(!maxMonth) return { ...raw, allFunds, reviewFunds:[], reviewCount:0 };

    const funds = allFunds.filter(f=>competenciaMes(f.competencia) === maxMonth).map(f=>({ ...f, stale:false, staleDays:0 }));
    const reviewFunds = allFunds
      .filter(f=>competenciaMes(f.competencia) < maxMonth && Number(f.saldoFinal) > 0)
      .map(f=>({ ...f, reviewStatus:'verificar' }));

    const totalBalance = funds.reduce((s,f)=>s+(Number(f.saldoFinal)||0),0);
    const byBankMap = new Map();
    funds.forEach(f=>byBankMap.set(f.banco,(byBankMap.get(f.banco)||0)+(Number(f.saldoFinal)||0)));
    const byBank = [...byBankMap.entries()].map(([banco,total])=>({banco,total})).sort((a,b)=>b.total-a.total);
    const asOfDate = funds.reduce((max,f)=>String(f.competencia||'')>max?String(f.competencia||''):max,'');
    return { ...raw, allFunds, funds, reviewFunds, reviewCount:reviewFunds.length, totalBalance, byBank, asOfDate, asOfMonth:maxMonth };
  }

  // Normaliza respostas reais do Apps Script antes de entrarem no state.
  const originalGetData = Api.getData.bind(Api);
  Api.getData = async function(){
    const data = await originalGetData();
    if(data && data.applications) data.applications = classificarAplicacoes(data.applications);
    return data;
  };

  // Normaliza também a massa de exemplo por mês, sem interferir no fluxo real.
  const originalGenerateExampleApplications = generateExampleApplications;
  generateExampleApplications = function(today, rnd){
    return classificarAplicacoes(originalGenerateExampleApplications(today, rnd));
  };

  // Mantém todos os fundos lidos no wizard para gravação, mas acrescenta a
  // classificação que alimenta a prévia e a tela de Verificação.
  const originalParseApplicationsWorkbook = parseApplicationsWorkbook;
  parseApplicationsWorkbook = function(wb){
    const parsed = originalParseApplicationsWorkbook(wb);
    const classified = classificarAplicacoes(parsed);
    parsed.allFunds = classified.allFunds;
    parsed.activeFunds = classified.funds;
    parsed.reviewFunds = classified.reviewFunds;
    parsed.reviewCount = classified.reviewCount;
    parsed.currentTotalBalance = classified.totalBalance;
    parsed.currentByBank = classified.byBank;
    parsed.currentAsOfDate = classified.asOfDate;
    return parsed;
  };

  function itensAplicacoesParaVerificar(applications){
    const a = classificarAplicacoes(applications);
    if(!a || !Array.isArray(a.reviewFunds)) return [];
    return a.reviewFunds.map(f=>({
      bank:f.banco || 'Aplicações Financeiras',
      filename:a.filename || 'Aplicações Financeiras',
      at:a.uploadedAt || '',
      status:'verificar',
      issues:[{
        code:'aplicacao_competencia_anterior',
        message:`${f.fundo}: saldo de ${formatBRL(Number(f.saldoFinal)||0)} na competência ${formatDateBR(f.competencia)}, enquanto a carteira atual é ${a.asOfMonth || competenciaMes(a.asOfDate)}.`,
        suggestion:'Verifique se o fundo continua ativo. Se continuar, atualize o relatório com a competência atual. Se já tiver sido liquidado, nenhuma ação é necessária; ele continuará fora do saldo atual do painel.'
      }]
    }));
  }

  renderVerificationBankFilterOptions = function(history){
    const sel = document.getElementById('verifBankFilter');
    if(!sel) return;
    const apps = activeData().applications;
    const banks = [...new Set([
      ...(history||[]).map(h=>h.bank),
      ...itensAplicacoesParaVerificar(apps).map(x=>x.bank)
    ].filter(Boolean))].sort();
    const current = state.verificationBankFilter;
    sel.innerHTML = `<option value="">Todos os bancos</option>` + banks.map(b=>
      `<option value="${escapeHtml(b)}" ${b===current?'selected':''}>${escapeHtml(b)}</option>`).join('');
  };

  renderVerification = function(){
    const { history, applications } = activeData();
    const listEl = document.getElementById('verifList');
    const kpiRow = document.getElementById('verifKpiRow');
    if(!listEl || !kpiRow) return;
    renderVerificationBankFilterOptions(history||[]);

    const items = [
      ...itensAplicacoesParaVerificar(applications).map(r=>({ h:r, issues:r.issues, source:'application' })),
      ...(history||[]).map(h=>({ h, issues:decodeHistoryIssues(h), source:'history' }))
    ];
    const filtered = state.verificationBankFilter ? items.filter(x=>x.h.bank===state.verificationBankFilter) : items;
    const withIssues = filtered.filter(x=>x.h.status==='erro' || x.h.status==='verificar' || x.issues.length>0);
    const errorCount = filtered.filter(x=>x.h.status==='erro').length;
    const verifyCount = filtered.filter(x=>x.h.status==='verificar').length;
    const warningCount = withIssues.filter(x=>x.h.status!=='erro' && x.h.status!=='verificar').length;
    const historyItems = filtered.filter(x=>x.source==='history');
    const historyWithIssues = withIssues.filter(x=>x.source==='history');
    const cleanCount = Math.max(0, historyItems.length-historyWithIssues.length);

    const tiles = [
      { label:'Envios com falha', value:String(errorCount), cls:errorCount>0?'neg':'' },
      { label:'Envios com avisos', value:String(warningCount), cls:warningCount>0?'warn':'' },
      { label:'Aplicações a verificar', value:String(verifyCount), cls:verifyCount>0?'warn':'' },
      { label:'Envios sem inconsistências', value:String(cleanCount), cls:'' },
    ];
    kpiRow.className='kpi-row';
    kpiRow.style.gridTemplateColumns='repeat(4,1fr)';
    kpiRow.innerHTML=tiles.map(t=>`<div class="kpi-tile"><div class="kpi-label"><span>${escapeHtml(t.label)}</span></div><div class="kpi-value num ${t.cls}">${t.value}</div></div>`).join('');

    if(!filtered.length){ listEl.innerHTML='<div class="empty-state">Nenhum envio ou pendência registrado ainda.</div>'; return; }
    if(!withIssues.length){ listEl.innerHTML='<div class="empty-state">Nenhuma inconsistência registrada — os envios foram lidos sem avisos.</div>'; return; }

    listEl.innerHTML=withIssues.map(({h,issues})=>{
      const isError=h.status==='erro';
      const isVerify=h.status==='verificar';
      const when=h.at ? formatDateBR(String(h.at).slice(0,10)) + (String(h.at).length>10?' '+String(h.at).slice(11,16):'') : '—';
      const label=isError?'Falhou':isVerify?'Verificar':'Carregado com avisos';
      return `<div class="issue-card ${isError?'is-error':''}"><div class="issue-card-head"><div><span class="issue-card-title">${escapeHtml(h.bank)}</span><span class="issue-card-meta"> — ${escapeHtml(h.filename||'—')}</span></div><div class="issue-card-meta">${when} &middot; <span class="pill ${isError?'pill-out':'pill-previsto'}">${label}</span></div></div>${issues.map(it=>`<div class="issue-row"><div class="issue-row-msg">${escapeHtml(it.message)}</div>${it.suggestion?`<div class="issue-row-suggestion">O que fazer: ${escapeHtml(it.suggestion)}</div>`:''}</div>`).join('')}</div>`;
    }).join('');
  };

  const originalRenderApplications = renderApplications;
  renderApplications = function(){
    const data = activeData();
    if(data.applications){
      const normalized = classificarAplicacoes(data.applications);
      if(!state.usingDemo) state.applications = normalized;
      else data.applications = normalized;
    }
    originalRenderApplications();
    const apps = activeData().applications;
    const review = apps && Array.isArray(apps.reviewFunds)
      ? (state.applicationsBankFilter ? apps.reviewFunds.filter(f=>f.banco===state.applicationsBankFilter) : apps.reviewFunds)
      : [];
    const banner=document.getElementById('appsStaleBanner');
    if(banner) banner.innerHTML=review.length ? `<div class="demo-banner"><span>&#9888;</span><span><b>${review.length} fundo(s) para verificar.</b> Possuem saldo positivo em competência anterior e, por segurança, não entram no saldo atual. Consulte "Verificação de importação".</span></div>` : '';
    const row=document.getElementById('appsLiquidityKpiRow');
    if(row){
      [...row.querySelectorAll('.kpi-tile')].forEach(tile=>{
        const label=tile.querySelector('.kpi-label');
        if(label && label.textContent.trim()==='Fundos desatualizados'){
          label.textContent='Fundos a verificar';
          const value=tile.querySelector('.kpi-value'); if(value) value.textContent=String(review.length);
          const sub=tile.querySelector('.kpi-sub'); if(sub) sub.textContent='Saldo positivo em competência anterior';
        }
      });
    }
  };

  renderApplicationsPreview = function(body, nextBtn){
    const r=wz.appsResult;
    if(!r){ body.innerHTML='<div class="empty-state">Nenhum dado para pré-visualizar.</div>'; nextBtn.disabled=true; return; }
    const c=classificarAplicacoes({ ...r, allFunds:r.funds });
    const byBankRows=c.byBank.map(b=>`<tr><td>${escapeHtml(b.banco)}</td><td class="num-col num">${formatBRL(b.total)}</td></tr>`).join('');
    const fundRows=c.funds.slice(0,MAX_PREVIEW_ROWS).map(f=>`<tr><td>${escapeHtml(f.banco)}</td><td>${escapeHtml(f.fundo)}</td><td class="num">${formatDateBR(f.competencia)}</td><td class="num-col num">${formatBRL(f.saldoFinal,true)}</td></tr>`).join('');
    const reviewRows=c.reviewFunds.slice(0,MAX_PREVIEW_ROWS).map(f=>`<tr><td><span class="kpi-badge warn">Verificar</span></td><td>${escapeHtml(f.banco)}</td><td>${escapeHtml(f.fundo)}</td><td>${formatDateBR(f.competencia)}</td><td class="num-col num">${formatBRL(f.saldoFinal,true)}</td></tr>`).join('');
    body.innerHTML=`<div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin:0 0 14px;"><div class="kpi-tile"><div class="kpi-label">Fundos atuais</div><div class="kpi-value num">${c.funds.length}</div></div><div class="kpi-tile"><div class="kpi-label">Saldo atual</div><div class="kpi-value num">${formatBRL(c.totalBalance)}</div></div><div class="kpi-tile"><div class="kpi-label">Competência atual</div><div class="kpi-value num" style="font-size:16px;">${c.asOfMonth||'—'}</div></div></div>${c.reviewFunds.length?`<div class="demo-banner" style="margin-bottom:12px;"><span>&#9888;</span><span><b>${c.reviewFunds.length} fundo(s) para verificar.</b> Não entram no saldo atual até análise do Financeiro.</span></div>`:''}<div class="preview-table-wrap" style="margin-bottom:14px;"><table class="preview-table"><thead><tr><th>Banco</th><th class="num-col">Saldo atual</th></tr></thead><tbody>${byBankRows}</tbody></table></div><div class="preview-table-wrap"><table class="preview-table"><thead><tr><th>Banco</th><th>Fundo</th><th>Competência</th><th>Saldo final</th></tr></thead><tbody>${fundRows}</tbody></table></div>${reviewRows?`<div class="preview-table-wrap" style="margin-top:14px;"><table class="preview-table"><thead><tr><th>Status</th><th>Banco</th><th>Fundo</th><th>Última competência</th><th>Saldo</th></tr></thead><tbody>${reviewRows}</tbody></table></div>`:''}`;
    nextBtn.disabled=r.funds.length===0;
  };
})();
