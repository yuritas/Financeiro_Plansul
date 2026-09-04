/* Plansul — Fluxo de Caixa v4
 * Mobile compacto, semântica correta das Aplicações Financeiras,
 * rentabilidade por fundo e aceite de fundos com atualização periódica. */
(function(){
  const originalApiGetDataV4 = Api.getData.bind(Api);
  const originalSaveApplicationsDataV4 = saveApplicationsData;
  const originalRenderAllV4 = renderAll;

  function fundIdentity(f){
    return applicationsFundKey(f&&f.contaCod, f&&f.banco, f&&f.fundo);
  }
  function competenciaMesV4(value){
    const s=String(value||''); return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):'';
  }
  function monthYear(value){
    const m=competenciaMesV4(value); return m ? `${m.slice(5,7)}/${m.slice(0,4)}` : '—';
  }
  function parseLiquidityValue(v){
    if(v===null||v===undefined||v==='') return null;
    if(typeof v==='number' && isFinite(v)) return Math.max(0,Math.round(v));
    const s=normalizeTypeText(String(v));
    if(/imediat|mesmo dia/.test(s)) return 0;
    const m=s.match(/(?:d\s*\+?\s*)?(\d+)/i); return m?Math.max(0,Number(m[1])):null;
  }
  function calcFundRent(f){
    if(f.rendimentosPct!==null && f.rendimentosPct!==undefined && isFinite(Number(f.rendimentosPct))) return Number(f.rendimentosPct);
    const base=(Number(f.saldoInicial)||0)+(Number(f.aplicacoes)||0);
    return base>0 ? (Number(f.rendimentos)||0)/base*100 : null;
  }
  function vinculoClasse(f){
    const s=normalizeTypeText(String(f.classificacaoVinculo||''));
    if(/livre/.test(s)) return 'Livre';
    if(/vincul/.test(s)) return 'Vinculada';
    return f.classificacaoVinculo||'Não informado';
  }

  function parseApplicationsWorkbookV4(wb){
    const consName=findSheetName(wb,[/consolidad/]);
    if(!consName) throw new Error('sheet-consolidado-not-found');
    const infoName=findSheetName(wb,[/informac.*fund/,/fund.*informac/]);
    const consMatrix=sheetToMatrix(wb,consName), headerIdx=guessHeaderRow(consMatrix), header=consMatrix[headerIdx]||[];
    const col={
      banco:findHeaderIndex(header,/^banco$/), banco2:findHeaderIndex(header,/banco\s*2|banco2/),
      contaCod:findHeaderIndex(header,/cod.*conta/), competencia:findHeaderIndex(header,/competenc/), fundo:findHeaderIndex(header,/fundo/),
      saldoInicial:findHeaderIndex(header,/saldo.*inicial/), aplicacoes:findHeaderIndex(header,/aplicac/),
      rendimentosPct:findHeaderIndex(header,/rendiment.*%|%.*rendiment/), rendimentos:findHeaderIndex(header,/rendiment/,/%/),
      imposto:findHeaderIndex(header,/imposto/), resgate:findHeaderIndex(header,/resgate/), saldoFinal:findHeaderIndex(header,/saldo.*final/)
    };
    const infoByKey=new Map();
    if(infoName){
      const m=sheetToMatrix(wb,infoName), hi=guessHeaderRow(m), h=m[hi]||[];
      const ic={
        contaCod:findHeaderIndex(h,/cod.*conta/), banco:findHeaderIndex(h,/^banco$/), fundo:findHeaderIndex(h,/fundo/),
        liquidezDias:findHeaderIndex(h,/liquidez.*dias/), classificacaoVinculo:findHeaderIndex(h,/classific.*vinculo/),
        vinculo:findHeaderIndex(h,/^vinculo$/), garantia:findHeaderIndex(h,/garantia/), indexador:findHeaderIndex(h,/indexador/), cotizacao:findHeaderIndex(h,/cotiza/)
      };
      for(let r=hi+1;r<m.length;r++){
        const row=m[r]; if(!row)continue; const fundo=ic.fundo>=0?row[ic.fundo]:null; if(fundo==null||String(fundo).trim()==='')continue;
        const conta=ic.contaCod>=0?row[ic.contaCod]:'', banco=ic.banco>=0?row[ic.banco]:'';
        infoByKey.set(applicationsFundKey(conta,banco,fundo),{
          liquidezDias:ic.liquidezDias>=0?parseLiquidityValue(row[ic.liquidezDias]):null,
          classificacaoVinculo:ic.classificacaoVinculo>=0?String(row[ic.classificacaoVinculo]??'').trim():'',
          vinculo:ic.vinculo>=0?String(row[ic.vinculo]??'').trim():'',
          garantia:ic.garantia>=0?String(row[ic.garantia]??'').trim():'',
          indexador:ic.indexador>=0?String(row[ic.indexador]??'').trim():'',
          cotizacaoResgate:ic.cotizacao>=0?String(row[ic.cotizacao]??'').trim():''
        });
      }
    }
    const funds=[];
    for(let r=headerIdx+1;r<consMatrix.length;r++){
      const row=consMatrix[r]; if(!row)continue; const fundoRaw=col.fundo>=0?row[col.fundo]:null; if(fundoRaw==null||String(fundoRaw).trim()==='')continue;
      const competencia=col.competencia>=0?parseDateCell(row[col.competencia]):null; if(!competencia)continue;
      const banco2=col.banco2>=0?row[col.banco2]:null, bancoRaw=(banco2!=null&&String(banco2).trim()!=='')?banco2:(col.banco>=0?row[col.banco]:'');
      const contaCod=col.contaCod>=0?String(row[col.contaCod]??'').trim():'', banco=String(bancoRaw||'').trim(), fundo=String(fundoRaw).trim();
      const key=applicationsFundKey(contaCod,banco,fundo), info=infoByKey.get(key)||{};
      const item={
        id:`${key}|${competencia}`, fundKey:key, banco:banco||'—', fundo, contaCod, competencia,
        saldoInicial:numOrZero(row[col.saldoInicial]), aplicacoes:numOrZero(row[col.aplicacoes]), rendimentos:numOrZero(row[col.rendimentos]),
        imposto:numOrZero(row[col.imposto]), resgate:numOrZero(row[col.resgate]), saldoFinal:numOrZero(row[col.saldoFinal]),
        rendimentosPct:col.rendimentosPct>=0?parseNumberCell(row[col.rendimentosPct]):null,
        liquidezDias:info.liquidezDias??null, classificacaoVinculo:info.classificacaoVinculo||'', vinculo:info.vinculo||'',
        garantia:info.garantia||'', indexador:info.indexador||'', cotizacaoResgate:info.cotizacaoResgate||'', periodicAccepted:false
      };
      if(item.rendimentosPct==null||!isFinite(item.rendimentosPct)) item.rendimentosPct=calcFundRent(item);
      if(item.liquidezDias!=null) item.cotizacaoResgate=`D+${item.liquidezDias}`;
      funds.push(item);
    }
    funds.sort((a,b)=>a.competencia<b.competencia?1:a.competencia>b.competencia?-1:b.saldoFinal-a.saldoFinal);
    const asOfMonth=funds.reduce((m,f)=>competenciaMesV4(f.competencia)>m?competenciaMesV4(f.competencia):m,'');
    const currentFunds=groupApplicationsV4(funds).funds;
    const totalBalance=currentFunds.reduce((s,f)=>s+(Number(f.saldoFinal)||0),0), map=new Map();
    currentFunds.forEach(f=>map.set(f.banco,(map.get(f.banco)||0)+(Number(f.saldoFinal)||0)));
    return {funds,allFunds:funds,totalBalance,byBank:[...map.entries()].map(([banco,total])=>({banco,total})),asOfDate:asOfMonth?asOfMonth+'-01':'',asOfMonth,staleCount:0,sourceSheetCons:consName,sourceSheetInfo:infoName||null};
  }

  // Substitui o parser de aplicações: preserva todas as competências existentes
  // no CONSOLIDADO para permitir filtro histórico sem depender de uploads antigos.
  parseApplicationsWorkbook=parseApplicationsWorkbookV4;

  function groupApplicationsV4(rawFunds){
    const all=(rawFunds||[]).map(f=>({...f,rendimentosPct:calcFundRent(f)}));
    const maxMonth=all.reduce((m,f)=>competenciaMesV4(f.competencia)>m?competenciaMesV4(f.competencia):m,'');
    const groups=new Map();
    all.forEach(f=>{const k=f.fundKey||fundIdentity(f);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);});
    const funds=[],reviewFunds=[];
    groups.forEach(list=>{
      list.sort((a,b)=>a.competencia<b.competencia?1:-1); const latest=list[0];
      if(competenciaMesV4(latest.competencia)===maxMonth || latest.periodicAccepted) funds.push(latest);
      else if(Number(latest.saldoFinal)>0) reviewFunds.push({...latest,reviewStatus:'verificar'});
    });
    funds.sort((a,b)=>Number(b.saldoFinal)-Number(a.saldoFinal));
    reviewFunds.sort((a,b)=>Number(b.saldoFinal)-Number(a.saldoFinal));
    return {allFunds:all,funds,reviewFunds,reviewCount:reviewFunds.length,asOfMonth:maxMonth,asOfDate:maxMonth?maxMonth+'-01':''};
  }
  function normalizeAppsV4(app){
    if(!app)return app; const grouped=groupApplicationsV4(app.allFunds||app.funds||[]), map=new Map();
    grouped.funds.forEach(f=>map.set(f.banco,(map.get(f.banco)||0)+(Number(f.saldoFinal)||0)));
    return {...app,...grouped,totalBalance:grouped.funds.reduce((s,f)=>s+(Number(f.saldoFinal)||0),0),byBank:[...map.entries()].map(([banco,total])=>({banco,total})).sort((a,b)=>b.total-a.total)};
  }
  Api.getData=async function(){const d=await originalApiGetDataV4();if(d&&d.applications)d.applications=normalizeAppsV4(d.applications);return d;};

  // Liquidez: a coluna "Liquidez (Dias)" é a fonte oficial; cotização é apenas fallback legado.
  parseLiquidezDias=function(value){return parseLiquidityValue(value);};
  computeAppsInsights=function(funds){
    const withDias=funds.map(f=>({f,dias:f.liquidezDias!=null?Number(f.liquidezDias):parseLiquidityValue(f.cotizacaoResgate)}));
    const totalSaldo=funds.reduce((s,f)=>s+(Number(f.saldoFinal)||0),0), totalRendimentos=funds.reduce((s,f)=>s+(Number(f.rendimentos)||0),0), totalSaldoInicial=funds.reduce((s,f)=>s+(Number(f.saldoInicial)||0),0);
    const bancoMap=new Map(), vincMap=new Map(), liqValMap=new Map(), liqCountMap=new Map();
    funds.forEach(f=>{bancoMap.set(f.banco,(bancoMap.get(f.banco)||0)+(Number(f.saldoFinal)||0));const k=vinculoClasse(f);vincMap.set(k,(vincMap.get(k)||0)+(Number(f.saldoFinal)||0));});
    withDias.forEach(({f,dias})=>{const l=liquidezBucketLabel(dias);liqValMap.set(l,(liqValMap.get(l)||0)+(Number(f.saldoFinal)||0));liqCountMap.set(l,(liqCountMap.get(l)||0)+1);});
    const order=['D+0','D+1','D+2 a D+7','D+8 a D+30','Acima de D+30','Não informado'];
    const ranked=funds.filter(f=>calcFundRent(f)!=null).map(f=>({...f,rendimentosPct:calcFundRent(f)})).sort((a,b)=>b.rendimentosPct-a.rendimentosPct);
    const weightedBase=funds.reduce((s,f)=>s+(Number(f.saldoInicial)||0)+(Number(f.aplicacoes)||0),0);
    return {
      totalSaldo,totalRendimentos,totalSaldoInicial,
      byBanco:[...bancoMap.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value),
      byVinculo:[...vincMap.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value),
      byLiquidez:order.filter(l=>liqValMap.has(l)).map(label=>({label,value:liqValMap.get(label)||0,count:liqCountMap.get(label)||0})),
      liqD0:withDias.filter(x=>x.dias===0).reduce((s,x)=>s+(Number(x.f.saldoFinal)||0),0),
      liqAte7:withDias.filter(x=>x.dias!=null&&x.dias<=7).reduce((s,x)=>s+(Number(x.f.saldoFinal)||0),0),
      liqAte30:withDias.filter(x=>x.dias!=null&&x.dias<=30).reduce((s,x)=>s+(Number(x.f.saldoFinal)||0),0),
      livres:vincMap.get('Livre')||0,vinculadas:vincMap.get('Vinculada')||0,
      rentMedia:weightedBase>0?totalRendimentos/weightedBase*100:0,melhor:ranked[0]||null,
      topRent:ranked.slice(0,6).map(f=>({label:`${f.fundo} · ${f.banco}`,value:f.rendimentosPct,isPct:true})),
      staleCount:0,asOfDate:funds.reduce((m,f)=>String(f.competencia||'')>m?String(f.competencia||''):m,'')
    };
  };

  function applicationRangeFunds(app){
    if(!app)return[]; const all=app.allFunds||app.funds||[]; let range;
    try{range=getRangeBounds(currentRangeId,activeData().transactions||[]);}catch(e){range={start:'',end:''};}
    if(!range.start||!range.end)return app.funds||[];
    const startM=range.start.slice(0,7), endM=range.end.slice(0,7);
    return all.filter(f=>{const m=competenciaMesV4(f.competencia);return m>=startM&&m<=endM;}).sort((a,b)=>a.competencia<b.competencia?1:a.competencia>b.competencia?-1:Number(b.saldoFinal)-Number(a.saldoFinal));
  }

  function updateApplicationsDetail(){
    const app=normalizeAppsV4(activeData().applications); if(!app)return;
    let rows=applicationRangeFunds(app); if(state.applicationsBankFilter)rows=rows.filter(f=>f.banco===state.applicationsBankFilter);
    const table=document.getElementById('appsTable'), body=document.getElementById('appsTableBody'), foot=document.getElementById('appsFooter'); if(!table||!body)return;
    const head=table.querySelector('thead tr'); if(head)head.innerHTML='<th>Banco</th><th>Fundo</th><th class="num-col">Saldo inicial</th><th class="num-col">Aplicações</th><th class="num-col">Rendimentos</th><th class="num-col">Imposto</th><th class="num-col">Resgate</th><th class="num-col">Saldo final</th><th class="num-col">Rent. %</th><th>Classificação</th><th>Vínculo</th><th>Garantia</th><th>Indexador</th>';
    body.innerHTML=rows.length?rows.map(f=>`<tr><td><div class="bank-name-cell">${bankBadgeHtml(f.banco,22)}<span>${escapeHtml(f.banco)}</span></div></td><td>${escapeHtml(f.fundo)}${f.periodicAccepted?' <span class="periodic-fund-badge">Periódico</span>':''}</td><td class="num-col num">${formatBRL(f.saldoInicial,true)}</td><td class="num-col num">${formatBRL(f.aplicacoes,true)}</td><td class="num-col num pos">${formatBRL(f.rendimentos,true)}</td><td class="num-col num">${formatBRL(f.imposto,true)}</td><td class="num-col num">${formatBRL(f.resgate,true)}</td><td class="num-col num">${formatBRL(f.saldoFinal,true)}</td><td class="num-col num">${calcFundRent(f)==null?'—':calcFundRent(f).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'}</td><td>${escapeHtml(vinculoClasse(f))}</td><td>${escapeHtml(f.vinculo||'—')}</td><td>${escapeHtml(f.garantia||'—')}</td><td>${escapeHtml(f.indexador||'—')}</td></tr>`).join(''):'<tr><td colspan="13"><div class="empty-state">Nenhum fundo corresponde ao período selecionado.</div></td></tr>';
    if(foot)foot.textContent=`${rows.length} fundo${rows.length===1?'':'s'} no período filtrado`;
  }

  const prevRenderApplicationsV4=renderApplications;
  renderApplications=function(){
    prevRenderApplicationsV4();
    const app=normalizeAppsV4(activeData().applications); if(!app)return;
    const rows=state.applicationsBankFilter?app.funds.filter(f=>f.banco===state.applicationsBankFilter):app.funds;
    const ins=computeAppsInsights(rows);
    const liq=document.getElementById('appsLiquidityKpiRow');
    if(liq){liq.innerHTML=appsKpiTilesHtml([
      {label:'Liquidez D+0',icon:'clock',iconCls:'in',value:formatBRL(ins.liqD0)},
      {label:'Liquidez até D+7',icon:'clock',value:formatBRL(ins.liqAte7)},
      {label:'Liquidez até D+30',icon:'calendar',value:formatBRL(ins.liqAte30)},
      {label:'Melhor aplicação',icon:'trendingUp',iconCls:'in',cls:'pos',value:ins.melhor?ins.melhor.rendimentosPct.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%':'—',sub:ins.melhor?`${ins.melhor.fundo} — ${ins.melhor.banco}`:'Sem dado'},
      {label:'Fundos a verificar',icon:'bell',iconCls:app.reviewCount?'out':'',cls:app.reviewCount?'neg':'',value:String(app.reviewCount||0),sub:'Competência anterior não reconhecida como periódica'},
      {label:'Dados até',icon:'history',value:monthYear(app.asOfDate||app.asOfMonth),sub:'Competência mais recente'}
    ]);}
    updateApplicationsDetail();
  };

  // Ao salvar uma nova planilha, o conjunto completo substitui o anterior.
  saveApplicationsData=async function(payload){
    const funds=(payload&&payload.funds)||[]; return originalSaveApplicationsDataV4({...payload,funds});
  };

  async function acceptPeriodicFund(f){
    const app=normalizeAppsV4(activeData().applications); if(!app)return;
    const key=f.fundKey||fundIdentity(f); const all=(app.allFunds||[]).map(x=>({...x,periodicAccepted:(x.fundKey||fundIdentity(x))===key?true:!!x.periodicAccepted}));
    try{
      await Api.saveApplications({funds:all,filename:'Ajuste de fundo periódico'});
      await loadData(); renderVerification(); showToast(`${f.fundo} adicionado como fundo de atualização periódica.`);
    }catch(e){guardSession(e);showToast('Não foi possível adicionar o fundo.',true);}
  }

  renderVerification=function(){
    const {history}=activeData(), app=normalizeAppsV4(activeData().applications), list=document.getElementById('verifList'), kpi=document.getElementById('verifKpiRow'); if(!list||!kpi)return;
    const reviews=(app&&app.reviewFunds||[]).filter(f=>!state.verificationBankFilter||f.banco===state.verificationBankFilter);
    const hist=(history||[]).filter(h=>!state.verificationBankFilter||h.bank===state.verificationBankFilter).map(h=>({h,issues:decodeHistoryIssues(h)})).filter(x=>x.h.status==='erro'||x.issues.length);
    const banks=[...new Set([...(history||[]).map(h=>h.bank),...(app&&app.reviewFunds||[]).map(f=>f.banco)].filter(Boolean))].sort(), sel=document.getElementById('verifBankFilter'); if(sel){const cur=state.verificationBankFilter;sel.innerHTML='<option value="">Todos os bancos</option>'+banks.map(b=>`<option value="${escapeHtml(b)}" ${b===cur?'selected':''}>${escapeHtml(b)}</option>`).join('');}
    kpi.style.gridTemplateColumns='repeat(3,1fr)';kpi.innerHTML=appsKpiTilesHtml([{label:'Envios com inconsistência',icon:'bell',value:String(hist.length)},{label:'Fundos a verificar',icon:'clock',value:String(reviews.length)},{label:'Fundos periódicos ativos',icon:'refresh',value:String((app&&app.funds||[]).filter(f=>f.periodicAccepted).length)}]);
    const appHtml=reviews.map(f=>`<div class="issue-card"><div class="issue-card-head"><div><span class="issue-card-title">${escapeHtml(f.banco)}</span><span class="issue-card-meta"> — ${escapeHtml(f.fundo)}</span></div><span class="pill pill-previsto">Verificar</span></div><div class="issue-row"><div class="issue-row-msg">Saldo de ${formatBRL(Number(f.saldoFinal)||0)} na competência ${monthYear(f.competencia)}, enquanto a carteira mais recente é ${monthYear(app.asOfDate||app.asOfMonth)}.</div><div class="issue-row-suggestion">Se este fundo é atualizado em periodicidade diferente dos demais, use “Adicionar Fundo”. Ele continuará com sua competência original, mas passará a compor a posição atual.</div>${state.canEdit?`<div class="issue-fund-action"><button class="btn btn-small btn-primary" data-add-periodic="${escapeHtml(f.id)}">Adicionar Fundo</button></div>`:''}</div></div>`).join('');
    const histHtml=hist.map(({h,issues})=>`<div class="issue-card ${h.status==='erro'?'is-error':''}"><div class="issue-card-head"><div><span class="issue-card-title">${escapeHtml(h.bank)}</span><span class="issue-card-meta"> — ${escapeHtml(h.filename||'—')}</span></div></div>${issues.map(i=>`<div class="issue-row"><div class="issue-row-msg">${escapeHtml(i.message)}</div>${i.suggestion?`<div class="issue-row-suggestion">${escapeHtml(i.suggestion)}</div>`:''}</div>`).join('')}</div>`).join('');
    list.innerHTML=(appHtml+histHtml)||'<div class="empty-state">Nenhuma inconsistência ou fundo para verificar.</div>';
    list.querySelectorAll('[data-add-periodic]').forEach(b=>b.onclick=()=>{const f=reviews.find(x=>String(x.id)===String(b.dataset.addPeriodic));if(f)acceptPeriodicFund(f);});
  };

  // Corrige a inversão semântica na Matriz por descrição — desktop e mobile.
  descMatrixRowHtml=function(t){const sign=t.type==='recebimento'?'+':'-',cls=t.type==='recebimento'?'matrix-in':'matrix-out';return `<tr><td class="matrix-date">${formatDateBR(t.date)}</td><td>${escapeHtml(t.category||'—')}</td><td>${escapeHtml(t.account||'—')}</td><td class="matrix-muted">${escapeHtml(t.description||'—')}</td><td class="num-col num ${cls}">${sign}${formatBRL(t.value,true)}</td><td><span class="pill ${t.status==='realizado'?'pill-realizado':'pill-previsto'}">${STATUS_LABEL[t.status]||t.status}</span></td></tr>`;};
  descMatrixCardHtml=function(t){const sign=t.type==='recebimento'?'+':'-',cls=t.type==='recebimento'?'in':'out';return `<div class="movement-card"><div class="movement-card-top"><div class="movement-card-desc">${escapeHtml(t.category||'—')}</div><div class="movement-card-val ${cls} num">${sign}${formatBRL(t.value,true)}</div></div><div class="movement-card-meta"><span>${formatDateBR(t.date)}</span><span>${escapeHtml(t.account||'—')}</span><span>${escapeHtml(t.description||'—')}</span><span class="pill ${t.status==='realizado'?'pill-realizado':'pill-previsto'}">${STATUS_LABEL[t.status]||t.status}</span></div></div>`;};

  function setupMobileGroups(){
    const kpi=document.getElementById('kpiRow'),risk=document.getElementById('cashRiskRow');
    if(kpi&&!kpi.previousElementSibling?.classList?.contains('mobile-section-label')){const l=document.createElement('div');l.className='mobile-section-label';l.textContent='Disponibilidade e movimentação';kpi.parentNode.insertBefore(l,kpi);}
    if(risk&&!risk.previousElementSibling?.classList?.contains('mobile-section-label')){const l=document.createElement('div');l.className='mobile-section-label';l.textContent='Risco de caixa';risk.parentNode.insertBefore(l,risk);}
  }
  renderAll=function(){originalRenderAllV4();setupMobileGroups();};

  // Se o wizard estiver processando Aplicações, salva todas as competências do CONSOLIDADO.
  const prevFinishApplicationsWizard=finishApplicationsWizard;
  finishApplicationsWizard=async function(){
    if(!wz||!wz.appsResult)return prevFinishApplicationsWizard();
    const nextBtn=document.getElementById('wizardNext');nextBtn.disabled=true;nextBtn.textContent='Salvando…';
    try{let fileBase64=null;try{fileBase64=await fileToBase64(wz.file);}catch(e){}const funds=wz.appsResult.allFunds||wz.appsResult.funds||[];await saveApplicationsData({filename:wz.file.name,asOfDate:wz.appsResult.asOfDate,totalBalance:wz.appsResult.totalBalance,byBank:wz.appsResult.byBank,funds,fileBase64,fileMime:wz.file.type||''});logUploadHistory({bank:APPLICATIONS_SOURCE,filename:wz.file.name,status:'concluido',rowCount:funds.length});closeUploadModal();showToast(`Aplicações Financeiras atualizadas: ${funds.length} registros.`);}catch(e){guardSession(e);showToast('Não foi possível salvar as Aplicações Financeiras.',true);nextBtn.disabled=false;nextBtn.textContent='Salvar dados';}
  };
})();
