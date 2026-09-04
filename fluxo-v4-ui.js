/* Plansul — acabamento visual V4 da tela de Aplicações */
(function(){
  const prevRenderApplicationsUI=renderApplications;
  function mes(v){const s=String(v||'');return /^\d{4}-\d{2}/.test(s)?s.slice(0,7):'';}
  function mmYYYY(v){const m=mes(v);return m?`${m.slice(5,7)}/${m.slice(0,4)}`:'—';}
  function identity(f){return applicationsFundKey(f&&f.contaCod,f&&f.banco,f&&f.fundo);}
  function rent(f){
    if(f&&f.rendimentosPct!==null&&f.rendimentosPct!==undefined&&isFinite(Number(f.rendimentosPct)))return Number(f.rendimentosPct);
    const base=(Number(f&&f.saldoInicial)||0)+(Number(f&&f.aplicacoes)||0);return base>0?(Number(f&&f.rendimentos)||0)/base*100:null;
  }
  function classe(f){const s=normalizeTypeText(String(f&&f.classificacaoVinculo||''));if(/livre/.test(s))return'Livre';if(/vincul/.test(s))return'Vinculada';return f&&f.classificacaoVinculo||'Não informado';}
  function groupedApp(app){
    if(!app)return null;const all=(app.allFunds||app.funds||[]).map(f=>({...f})),max=all.reduce((m,f)=>mes(f.competencia)>m?mes(f.competencia):m,''),groups=new Map();
    all.forEach(f=>{const k=f.fundKey||identity(f);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(f);});
    const funds=[],reviewFunds=[];groups.forEach(list=>{list.sort((a,b)=>a.competencia<b.competencia?1:-1);const x=list[0];if(mes(x.competencia)===max||x.periodicAccepted)funds.push(x);else if(Number(x.saldoFinal)>0)reviewFunds.push(x);});
    return {...app,allFunds:all,funds,reviewFunds,reviewCount:reviewFunds.length,asOfMonth:max,asOfDate:max?max+'-01':''};
  }
  function rangeRows(app){
    const all=app&&app.allFunds||[];let r;try{r=getRangeBounds(currentRangeId,activeData().transactions||[]);}catch(e){return app&&app.funds||[];}
    const a=(r.start||'').slice(0,7),b=(r.end||'').slice(0,7);return all.filter(f=>{const m=mes(f.competencia);return m>=a&&m<=b;});
  }
  function ensureFundCards(){
    const table=document.getElementById('appsTable');if(!table)return null;let cards=document.getElementById('appsFundCards');if(cards)return cards;
    cards=document.createElement('div');cards.id='appsFundCards';cards.className='apps-fund-cards';table.closest('.table-wrap').insertAdjacentElement('afterend',cards);return cards;
  }
  renderApplications=function(){
    prevRenderApplicationsUI();
    const app=groupedApp(activeData().applications);if(!app)return;
    if(!state.usingDemo)state.applications=app;
    const current=state.applicationsBankFilter?app.funds.filter(f=>f.banco===state.applicationsBankFilter):app.funds;
    const ins=computeAppsInsights(current);
    const hero=document.getElementById('appsHeroRow');if(hero)hero.innerHTML=`<div class="apps-hero-card"><div class="apps-hero-label"><span class="apps-hero-icon">${svgIcon('wallet',20)}</span>Saldo total em aplicações</div><div class="apps-hero-value num">${formatBRL(ins.totalSaldo)}</div><div class="apps-hero-sub">${current.length} fundo${current.length===1?'':'s'} · rentabilidade média ${ins.rentMedia.toLocaleString('pt-BR',{maximumFractionDigits:2})}%</div></div><div class="apps-hero-card alt"><div class="apps-hero-label"><span class="apps-hero-icon">${svgIcon('clock',20)}</span>Liquidez imediata (D+0)</div><div class="apps-hero-value num">${formatBRL(ins.liqD0)}</div><div class="apps-hero-sub">${(ins.totalSaldo?ins.liqD0/ins.totalSaldo*100:0).toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total</div></div>`;
    const kpi=document.getElementById('appsKpiRow');if(kpi)kpi.innerHTML=appsKpiTilesHtml([{label:'Total aplicado',icon:'wallet',iconCls:'accent',value:formatBRL(ins.totalSaldo)},{label:'Aplicações livres',icon:'arrowUpRight',iconCls:'in',value:formatBRL(ins.livres)},{label:'Aplicações vinculadas',icon:'lock',value:formatBRL(ins.vinculadas)},{label:'Rendimento do período',icon:'trendingUp',iconCls:'in',cls:'pos',value:formatBRL(ins.totalRendimentos)},{label:'Rentabilidade média',icon:'percent',value:ins.rentMedia.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'},{label:'Qtd. de fundos',icon:'layers',value:String(current.length)}]);
    const banco=document.getElementById('appsChartBanco');if(banco)banco.innerHTML=hbarListHtml(ins.byBanco,{total:ins.totalSaldo});
    const vinc=document.getElementById('appsChartVinculo');if(vinc)vinc.innerHTML=hbarListHtml(ins.byVinculo,{total:ins.totalSaldo});
    const liqchart=document.getElementById('appsChartLiquidez');if(liqchart)liqchart.innerHTML=hbarListHtml(ins.byLiquidez,{total:ins.totalSaldo});
    const rentchart=document.getElementById('appsChartTopRent');if(rentchart)rentchart.innerHTML=hbarListHtml(ins.topRent);
    const liq=document.getElementById('appsLiquidityKpiRow');if(liq)liq.innerHTML=appsKpiTilesHtml([{label:'Liquidez D+0',icon:'clock',iconCls:'in',value:formatBRL(ins.liqD0)},{label:'Liquidez até D+7',icon:'clock',value:formatBRL(ins.liqAte7)},{label:'Liquidez até D+30',icon:'calendar',value:formatBRL(ins.liqAte30)},{label:'Melhor aplicação',icon:'trendingUp',iconCls:'in',cls:'pos',value:ins.melhor?Number(ins.melhor.rendimentosPct).toLocaleString('pt-BR',{maximumFractionDigits:2})+'%':'—',sub:ins.melhor?`${ins.melhor.fundo} — ${ins.melhor.banco}`:'Sem dado'},{label:'Fundos a verificar',icon:'bell',iconCls:app.reviewCount?'out':'',cls:app.reviewCount?'neg':'',value:String(app.reviewCount||0),sub:'Competência anterior não reconhecida como periódica'},{label:'Dados até',icon:'history',value:mmYYYY(app.asOfDate||app.asOfMonth),sub:'Competência mais recente'}]);
    const cards=ensureFundCards();if(cards){let rows=rangeRows(app);if(state.applicationsBankFilter)rows=rows.filter(f=>f.banco===state.applicationsBankFilter);rows.sort((a,b)=>Number(b.saldoFinal)-Number(a.saldoFinal));cards.innerHTML=rows.length?rows.map(f=>{const rr=rent(f),dias=f.liquidezDias==null?'Não informado':`D+${Number(f.liquidezDias)}`;return `<article class="apps-fund-card"><div class="apps-fund-head"><div><b>${escapeHtml(f.fundo)}</b><span>${escapeHtml(f.banco)}</span></div><strong class="num">${formatBRL(Number(f.saldoFinal)||0)}</strong></div><div class="apps-fund-grid"><div><span>Rentabilidade</span><b class="${rr!=null&&rr>=0?'pos':''}">${rr==null?'—':rr.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'}</b></div><div><span>Liquidez</span><b>${dias}</b></div><div><span>Classificação</span><b>${escapeHtml(classe(f))}</b></div><div><span>Vínculo</span><b>${escapeHtml(f.vinculo||'—')}</b></div></div>${f.periodicAccepted?'<span class="periodic-fund-badge">Atualização periódica</span>':''}</article>`;}).join(''):'<div class="empty-state">Nenhum fundo corresponde ao período selecionado.</div>';}
  };
})();
