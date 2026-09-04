/* Plansul — Fluxo de Caixa v3
 * Intervalo livre de datas, saldo-base por conta, liquidez D+0/D+1,
 * histórico com período detectado automaticamente e exclusão controlada. */
(function(){
  const originalApiGetData = Api.getData.bind(Api);
  const originalApplyEditGating = applyEditGating;
  const originalSwitchView = switchView;
  const originalWireStaticEvents = wireStaticEvents;
  const originalOpenAccountModal = openAccountModal;
  const originalRenderApplications = renderApplications;

  state.filters.dateStart = state.filters.dateStart || '';
  state.filters.dateEnd = state.filters.dateEnd || '';
  state.matrixRangeTouched = false;
  let calendarCursor = null;
  let pendingStart = '';
  let pendingEnd = '';

  function isoMonthStart(dateISO){ return dateISO.slice(0,7)+'-01'; }
  function isoMonthEnd(dateISO){
    const p=dateISO.split('-').map(Number); return isoFromParts(p[0],p[1],new Date(p[0],p[1],0).getDate());
  }
  function rangeId(start,end){ return `custom|${start}|${end}`; }
  function parseRangeId(id){
    const m=/^custom\|(\d{4}-\d{2}-\d{2})\|(\d{4}-\d{2}-\d{2})$/.exec(String(id||''));
    return m ? {start:m[1],end:m[2]} : null;
  }
  function ensureCustomRange(){
    if(parseRangeId(currentRangeId)) return;
    const legacy=/^(\d{4})-(\d{2})$/.exec(String(currentRangeId||''));
    if(legacy){
      const start=legacy[0]+'-01'; currentRangeId=rangeId(start,isoMonthEnd(start)); return;
    }
    const t=todayISO(); currentRangeId=rangeId(isoMonthStart(t),isoMonthEnd(t));
  }
  const originalGetRangeBounds = getRangeBounds;
  getRangeBounds = function(id, transactions){
    const custom=parseRangeId(id);
    if(custom) return custom;
    return originalGetRangeBounds(id,transactions);
  };

  function monthShift(iso,delta){
    const [y,m]=iso.split('-').map(Number); const d=new Date(y,m-1+delta,1);
    return isoFromParts(d.getFullYear(),d.getMonth()+1,1);
  }
  function monthTitle(iso){
    const [y,m]=iso.split('-').map(Number); return `${MONTH_NAMES[m-1]} ${y}`;
  }
  function calendarCells(monthISO){
    const [y,m]=monthISO.split('-').map(Number);
    const first=new Date(y,m-1,1); const startOffset=first.getDay();
    const gridStart=new Date(y,m-1,1-startOffset); const out=[];
    for(let i=0;i<42;i++){
      const d=new Date(gridStart.getFullYear(),gridStart.getMonth(),gridStart.getDate()+i);
      const iso=isoFromParts(d.getFullYear(),d.getMonth()+1,d.getDate());
      out.push({iso,day:d.getDate(),same:d.getMonth()===m-1});
    }
    return out;
  }
  function isBetween(d,a,b){ return !!a && !!b && d>=a && d<=b; }
  function renderMonth(monthISO, second){
    const cells=calendarCells(monthISO);
    return `<div class="drp-month ${second?'second':''}">
      <div class="drp-month-head">
        ${second?'':'<button class="drp-nav" data-cal-nav="-1" type="button" aria-label="Mês anterior">‹</button>'}
        <span>${monthTitle(monthISO)}</span>
        ${second?'<button class="drp-nav" data-cal-nav="1" type="button" aria-label="Próximo mês">›</button>':'<span style="width:30px"></span>'}
      </div>
      <div class="drp-week"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
      <div class="drp-grid">${cells.map(c=>{
        const classes=['drp-day']; if(!c.same) classes.push('out'); if(isBetween(c.iso,pendingStart,pendingEnd)) classes.push('in-range'); if(c.iso===pendingStart) classes.push('start'); if(c.iso===pendingEnd) classes.push('end');
        return `<button type="button" class="${classes.join(' ')}" data-cal-date="${c.iso}">${c.day}</button>`;
      }).join('')}</div>
    </div>`;
  }
  function setPendingPreset(kind){
    const today=todayISO();
    if(kind==='today'){ pendingStart=today; pendingEnd=today; }
    if(kind==='7'){ pendingEnd=today; pendingStart=addDaysISO(today,-6); }
    if(kind==='30'){ pendingEnd=today; pendingStart=addDaysISO(today,-29); }
    if(kind==='month'){ pendingStart=isoMonthStart(today); pendingEnd=isoMonthEnd(today); }
    if(kind==='prev'){
      const prev=monthShift(isoMonthStart(today),-1); pendingStart=prev; pendingEnd=isoMonthEnd(prev);
    }
    if(kind==='all'){
      const tx=(activeData().transactions||[]).map(t=>t.date).filter(Boolean).sort();
      pendingStart=tx[0]||today; pendingEnd=tx[tx.length-1]||today;
    }
    calendarCursor=isoMonthStart(pendingStart||today);
  }
  function bindRangePopover(){
    const pop=document.getElementById('headerRangePop'); const trigger=document.getElementById('headerRangeTrigger');
    if(!pop) return;
    pop.querySelectorAll('[data-cal-nav]').forEach(b=>b.onclick=(e)=>{e.stopPropagation(); calendarCursor=monthShift(calendarCursor,Number(b.dataset.calNav)); renderRangeControl();});
    pop.querySelectorAll('[data-cal-date]').forEach(b=>b.onclick=(e)=>{
      e.stopPropagation(); const d=b.dataset.calDate;
      if(!pendingStart || (pendingStart&&pendingEnd)){ pendingStart=d; pendingEnd=''; }
      else { pendingEnd=d; if(pendingEnd<pendingStart){ const x=pendingStart; pendingStart=pendingEnd; pendingEnd=x; } }
      renderRangeControl();
    });
    pop.querySelectorAll('[data-range-preset]').forEach(b=>b.onclick=(e)=>{e.stopPropagation();setPendingPreset(b.dataset.rangePreset);renderRangeControl();});
    const apply=pop.querySelector('[data-range-apply]'); if(apply) apply.onclick=(e)=>{
      e.stopPropagation(); if(!pendingStart) return; if(!pendingEnd) pendingEnd=pendingStart;
      currentRangeId=rangeId(pendingStart,pendingEnd); state.descMatrixPage=1;
      if(!state.matrixRangeTouched){ state.filters.dateStart=pendingStart; state.filters.dateEnd=pendingEnd; }
      pop.hidden=true; if(trigger) trigger.setAttribute('aria-expanded','false'); renderAll();
    };
  }
  renderRangeControl = function(){
    ensureCustomRange();
    const trigger=document.getElementById('headerRangeTrigger'), label=document.getElementById('headerRangeLabel'), pop=document.getElementById('headerRangePop'); if(!trigger||!pop) return;
    const r=parseRangeId(currentRangeId); if(!pendingStart) pendingStart=r.start; if(!pendingEnd) pendingEnd=r.end; if(!calendarCursor) calendarCursor=isoMonthStart(pendingStart);
    if(label) label.textContent=`${formatDateBR(r.start)} – ${formatDateBR(r.end)}`;
    pop.classList.add('date-range-pop');
    pop.innerHTML=`<div class="drp-head"><div><div class="drp-title">Intervalo do Fluxo de Caixa</div><div class="drp-value">${pendingStart?formatDateBR(pendingStart):'—'} → ${pendingEnd?formatDateBR(pendingEnd):'selecione a data final'}</div></div></div>
      <div class="drp-shortcuts"><button class="drp-shortcut" data-range-preset="today">Hoje</button><button class="drp-shortcut" data-range-preset="7">Últimos 7 dias</button><button class="drp-shortcut" data-range-preset="30">Últimos 30 dias</button><button class="drp-shortcut" data-range-preset="month">Este mês</button><button class="drp-shortcut" data-range-preset="prev">Mês anterior</button><button class="drp-shortcut" data-range-preset="all">Todo período</button></div>
      <div class="drp-calendars">${renderMonth(calendarCursor,false)}${renderMonth(monthShift(calendarCursor,1),true)}</div>
      <div class="drp-foot"><span class="field-hint">Selecione a data inicial e a final.</span><span class="spacer"></span><button type="button" class="btn btn-primary btn-small" data-range-apply ${!pendingStart?'disabled':''}>Aplicar</button></div>`;
    bindRangePopover();
  };

  function normalizeText(v){ return normalizeKeyText(String(v||'')); }
  function isSantanderMax(f){ return normalizeText(f&&f.banco).includes('santander') && /(^|\s)max(\s|$)/i.test(normalizeText(f&&f.fundo)); }
  function normalizeAppsTreasury(app){
    if(!app) return app;
    const funds=(app.funds||[]).filter(f=>!isSantanderMax(f));
    const allFunds=(app.allFunds||app.funds||[]).filter(f=>!isSantanderMax(f));
    const reviewFunds=(app.reviewFunds||[]).filter(f=>!isSantanderMax(f));
    const totalBalance=funds.reduce((s,f)=>s+(Number(f.saldoFinal)||0),0);
    const map=new Map(); funds.forEach(f=>map.set(f.banco,(map.get(f.banco)||0)+(Number(f.saldoFinal)||0)));
    return {...app,funds,allFunds,reviewFunds,reviewCount:reviewFunds.length,totalBalance,byBank:[...map.entries()].map(([banco,total])=>({banco,total})).sort((a,b)=>b.total-a.total)};
  }
  Api.getData = async function(){ const d=await originalApiGetData(); if(d&&d.applications) d.applications=normalizeAppsTreasury(d.applications); return d; };

  function liquidityDays(f){
    const raw=String((f&&f.cotizacaoResgate)||'').trim().toUpperCase().replace(/\s+/g,'');
    if(!raw) return null; if(raw.includes('IMEDIAT')||raw.includes('MESMODIA')) return 0;
    let m=/D\+?(\d+)/.exec(raw); if(m) return Number(m[1]); m=/^(\d+)$/.exec(raw); if(m) return Number(m[1]); return null;
  }
  function immediateApplications(app){ return (app&&app.funds||[]).filter(f=>{const d=liquidityDays(f);return d!==null&&d<=1;}).reduce((s,f)=>s+(Number(f.saldoFinal)||0),0); }

  function realizedNetForAccount(account,transactions,startExclusive,endExclusive,inclusiveEnd){
    let net=0; (transactions||[]).forEach(t=>{
      if(t.status!=='realizado'||!transactionMatchesAccount(t,account,activeData().accounts||[])) return;
      if(startExclusive && t.date<=startExclusive) return;
      if(endExclusive){ if(inclusiveEnd ? t.date>endExclusive : t.date>=endExclusive) return; }
      net += (t.type==='recebimento'?1:-1)*(Number(t.value)||0);
    }); return net;
  }
  function accountOpeningBalance(account,dateISO,transactions){
    const base=Number(account.balance)||0; const baseDate=account.asOfDate||dateISO;
    if(dateISO>baseDate) return base + realizedNetForAccount(account,transactions,baseDate,dateISO,false);
    if(dateISO<baseDate){
      let net=0; (transactions||[]).forEach(t=>{
        if(t.status!=='realizado'||!transactionMatchesAccount(t,account,activeData().accounts||[])) return;
        if(t.date>=dateISO && t.date<=baseDate) net += (t.type==='recebimento'?1:-1)*(Number(t.value)||0);
      }); return base-net;
    }
    return base;
  }
  function totalOpeningBalance(accounts,transactions,dateISO){
    let total=(accounts||[]).filter(a=>a.kind==='conta').reduce((s,a)=>s+accountOpeningBalance(a,dateISO,transactions),0);
    const today=todayISO();
    if(dateISO>today){
      (transactions||[]).forEach(t=>{ if(t.status==='previsto' && t.date>=today && t.date<dateISO) total += (t.type==='recebimento'?1:-1)*(Number(t.value)||0); });
    }
    return total;
  }

  function projectionSeries(transactions,startISO,endISO,opening){
    const daily=computeDailySeries(transactions,startISO,endISO); const today=todayISO(); let running=opening; let overdue=0;
    if(startISO<=today){ (transactions||[]).forEach(t=>{if(t.status==='previsto'&&t.date<today&&t.date>=startISO) overdue+=(t.type==='recebimento'?1:-1)*(Number(t.value)||0);}); }
    return daily.map(d=>{
      let net=0;
      if(d.date<today) net=d.inRealized-d.outRealized;
      else if(d.date===today) net=d.inRealized-d.outRealized+d.inForecast-d.outForecast+overdue;
      else net=d.inRealized-d.outRealized+d.inForecast-d.outForecast;
      running+=net; return {date:d.date,balance:running,mode:d.date<today?'realizado':'projetado'};
    });
  }
  computeCumulativeSeries = function(transactions,dailySeries,currentBankBalance){
    if(!dailySeries||!dailySeries.length) return [];
    return projectionSeries(transactions,dailySeries[0].date,dailySeries[dailySeries.length-1].date,currentBankBalance);
  };
  computeDiarioSeries = function(transactions,startISO,endISO,openingBalance){
    const daily=computeDailySeries(transactions,startISO,endISO); const cum=projectionSeries(transactions,startISO,endISO,openingBalance);
    return daily.map((d,i)=>({date:d.date,entradas:d.inRealized+d.inForecast,saidas:d.outRealized+d.outForecast,saldo:cum[i].balance}));
  };

  computeKPIs = function(accounts,transactions,startISO,endISO,projection){
    const opening=totalOpeningBalance(accounts,transactions,startISO); const app=normalizeAppsTreasury(activeData().applications); const immediate=immediateApplications(app);
    let receivableForecast=0,payableForecast=0,received=0,paid=0;
    (transactions||[]).forEach(t=>{ if(t.date<startISO||t.date>endISO)return; const v=Number(t.value)||0; if(t.status==='previsto'){if(t.type==='recebimento')receivableForecast+=v;else payableForecast+=v;}else{if(t.type==='recebimento')received+=v;else paid+=v;} });
    const last=projection&&projection.length?projection[projection.length-1].balance:opening; const min=projection&&projection.length?projection.reduce((a,b)=>b.balance<a.balance?b:a,projection[0]):{date:startISO,balance:opening};
    return {bankBalance:opening,investBalance:immediate,allInvestBalance:app?Number(app.totalBalance)||0:0,totalBalance:opening+immediate,liquidityTotal:last+immediate,receivableForecast,payableForecast,projectedBalance:last,overdueReceivable:0,overduePayable:0,receivedRealizedTotal:received,paidRealizedTotal:paid,minProjectedBalance:min.balance,minProjectedDate:min.date,cashNeed:Math.max(0,-min.balance)};
  };
  computeKPITrends = function(transactions,startISO,endISO,k){
    const span=daysBetweenISO(startISO,endISO)+1, prevEnd=addDaysISO(startISO,-1), prevStart=addDaysISO(prevEnd,-(span-1)); let pr=0,pp=0;
    (transactions||[]).forEach(t=>{if(t.status==='realizado'&&t.date>=prevStart&&t.date<=prevEnd){if(t.type==='recebimento')pr+=t.value;else pp+=t.value;}});
    const pct=(c,p)=>p?((c-p)/Math.abs(p))*100:null; return {bankBalance:null,receivedRealizedTotal:pct(k.receivedRealizedTotal,pr),paidRealizedTotal:pct(k.paidRealizedTotal,pp),projectedBalance:null};
  };
  renderKPIs = function(k,trends){
    const t=trends||{}; const tiles=[
      {label:'Saldo bancário inicial',value:formatBRL(k.bankBalance),icon:'bank',sub:'Posição no início do intervalo selecionado'},
      {label:'Recebimentos realizados',value:formatBRL(k.receivedRealizedTotal),icon:'arrowDownLeft',iconCls:'in',cls:'pos',trend:t.receivedRealizedTotal,sub:`A receber no período: ${formatBRL(k.receivableForecast)}`},
      {label:'Pagamentos realizados',value:formatBRL(k.paidRealizedTotal),icon:'arrowUpRight',iconCls:'out',cls:'neg',trend:t.paidRealizedTotal,sub:`A pagar no período: ${formatBRL(k.payableForecast)}`},
      {label:'Saldo bancário projetado',value:formatBRL(k.projectedBalance),icon:'trendingUp',iconCls:k.projectedBalance<0?'out':'in',cls:k.projectedBalance<0?'neg':'pos',sub:'Saldo bancário ao fim do intervalo'},
      {label:'Aplicações D+0 / D+1',value:formatBRL(k.investBalance),icon:'clock',sub:'Recursos com liquidez imediata ou até D+1'},
      {label:'Liquidez imediata total',value:formatBRL(k.liquidityTotal),icon:'wallet',iconCls:'accent',strong:true,sub:'Saldo projetado + aplicações D+0/D+1'},
    ];
    const row=document.getElementById('kpiRow'); if(row) row.innerHTML=tiles.map(tile=>`<div class="kpi-tile"><div class="kpi-icon ${tile.iconCls||''}">${svgIcon(tile.icon,18)}</div><div class="kpi-label">${escapeHtml(tile.label)}</div><div class="kpi-value num ${tile.cls||''}">${tile.value}</div>${tile.trend!==undefined?trendHtml(tile.trend):''}${tile.sub?`<div class="kpi-sub">${escapeHtml(tile.sub)}</div>`:''}</div>`).join('');
    const risk=document.getElementById('cashRiskRow'); if(risk){const need=k.cashNeed>0;risk.innerHTML=`<div class="cash-risk-card ${k.minProjectedBalance<0?'danger':'ok'}"><span class="cash-risk-label">Menor saldo projetado</span><strong class="num ${k.minProjectedBalance<0?'neg':'pos'}">${formatBRL(k.minProjectedBalance)}</strong><span class="cash-risk-note">Menor posição bancária no período selecionado</span></div><div class="cash-risk-card"><span class="cash-risk-label">Data crítica</span><strong>${formatDateBR(k.minProjectedDate)}</strong><span class="cash-risk-note">Menor ponto de caixa do período</span></div><div class="cash-risk-card ${need?'danger':'ok'}"><span class="cash-risk-label">Necessidade de Caixa</span><strong class="num ${need?'neg':'pos'}">${formatBRL(k.cashNeed)}</strong><span class="cash-risk-note">${need?'Valor mínimo para evitar saldo bancário negativo':'Não há insuficiência projetada no período'}</span></div>`;}
  };

  renderBankPosition = function(accounts,transactions,startISO,endISO){
    const title=document.getElementById('bankPositionTitle'); if(title) title.textContent='Saldos por Conta Bancária';
    const desc=title&&title.parentElement&&title.parentElement.querySelector('.card-description'); if(desc) desc.textContent='Saldo inicial do intervalo, entradas, saídas e saldo final/projetado por conta.';
    const add=document.getElementById('btnAddAccount'); if(add) add.textContent='+ Conta bancária';
    const table=document.getElementById('bankPositionTable'); if(table){const th=table.querySelectorAll('thead th'); ['Banco','Conta','Saldo inicial','Entradas','Saídas','Saldo final / projetado','Data-base',''].forEach((x,i)=>{if(th[i])th[i].textContent=x;});}
    const body=document.getElementById('bankPositionBody'),foot=document.getElementById('bankPositionFoot'),cards=document.getElementById('bankPositionCards'),toggleWrap=document.getElementById('bankPositionToggleWrap'),toggleBtn=document.getElementById('btnBankPositionToggle');
    const editable=!state.usingDemo&&state.canEdit; const allRows=accounts.filter(a=>a.kind==='conta').sort((a,b)=>(a.order||0)-(b.order||0)).map(a=>{const opening=accountOpeningBalance(a,startISO,transactions);let ins=0,outs=0;(transactions||[]).forEach(t=>{if(t.date<startISO||t.date>endISO||!transactionMatchesAccount(t,a,accounts))return;if(t.type==='recebimento')ins+=Number(t.value)||0;else outs+=Number(t.value)||0;});return{account:a,opening,ins,outs,projected:opening+ins-outs};});
    const showAll=state.bankPositionExpanded||allRows.length<=BANK_POSITION_VISIBLE, rows=showAll?allRows:allRows.slice(0,BANK_POSITION_VISIBLE); if(toggleWrap){toggleWrap.hidden=allRows.length<=BANK_POSITION_VISIBLE;if(toggleBtn)toggleBtn.textContent=state.bankPositionExpanded?'Ver menos':'Ver todas as contas';}
    if(body){body.innerHTML=rows.length?rows.map(r=>`<tr><td><div class="bank-name-cell">${bankBadgeHtml(r.account.name,26)}<span>${escapeHtml(r.account.name)}</span></div></td><td>Conta corrente</td><td class="num-col num">${formatBRL(r.opening,true)}</td><td class="num-col num matrix-in">${formatBRL(r.ins,true)}</td><td class="num-col num matrix-out">${formatBRL(r.outs,true)}</td><td class="num-col num matrix-net ${r.projected<0?'neg':'pos'}">${formatBRL(r.projected,true)}</td><td><span class="num bank-position-date">${formatDateBR(r.account.asOfDate)}</span></td><td class="bp-actions-col">${editable?`<button class="icon-btn" data-edit-acc="${r.account.id}" title="Editar conta">&#9998;</button>`:''}</td></tr>`).join(''):`<tr><td colspan="8"><div class="empty-state">Nenhuma conta bancária cadastrada.</div></td></tr>`;body.querySelectorAll('[data-edit-acc]').forEach(b=>b.onclick=()=>openAccountModal(accounts.find(a=>a.id===b.dataset.editAcc)));}
    if(foot){if(allRows.length){const o=allRows.reduce((s,r)=>s+r.opening,0),i=allRows.reduce((s,r)=>s+r.ins,0),u=allRows.reduce((s,r)=>s+r.outs,0),p=allRows.reduce((s,r)=>s+r.projected,0);foot.innerHTML=`<tr><td>Total</td><td></td><td class="num-col num">${formatBRL(o,true)}</td><td class="num-col num matrix-in">${formatBRL(i,true)}</td><td class="num-col num matrix-out">${formatBRL(u,true)}</td><td class="num-col num matrix-net ${p<0?'neg':'pos'}">${formatBRL(p,true)}</td><td>—</td><td></td></tr>`;}else foot.innerHTML='';}
    if(cards){cards.innerHTML=rows.length?rows.map(r=>`<div class="bank-card"><div class="bank-card-head">${bankBadgeHtml(r.account.name,32)}<div class="bank-card-head-text"><span class="bank-card-name">${escapeHtml(r.account.name)}</span><span class="bank-card-kind">Conta corrente</span></div>${editable?`<button class="icon-btn" data-edit-acc="${r.account.id}">&#9998;</button>`:''}</div><div class="bank-card-balance num">${formatBRL(r.opening,true)}</div><div class="bank-card-foot"><span>Saldo inicial</span><span>${formatDateBR(startISO)}</span></div><details class="bank-card-more"><summary>Ver detalhes</summary><div class="bank-card-more-body"><span>Entradas: <b>${formatBRL(r.ins,true)}</b></span></div><div class="bank-card-more-body"><span>Saídas: <b>${formatBRL(r.outs,true)}</b></span></div><div class="bank-card-more-body"><span>Final/projetado: <b class="${r.projected<0?'neg':'pos'}">${formatBRL(r.projected,true)}</b></span></div><div class="bank-card-more-body"><span>Data-base: <b>${formatDateBR(r.account.asOfDate)}</b></span></div></details></div>`).join(''):`<div class="empty-state">Nenhuma conta cadastrada.</div>`;cards.querySelectorAll('[data-edit-acc]').forEach(b=>b.onclick=()=>openAccountModal(accounts.find(a=>a.id===b.dataset.editAcc)));}
  };

  filteredTransactions = function(transactions){
    const f=state.filters,q=(f.search||'').trim().toLowerCase(); return (transactions||[]).filter(t=>{if(f.dateStart&&t.date<f.dateStart)return false;if(f.dateEnd&&t.date>f.dateEnd)return false;if(f.tipo&&t.type!==f.tipo)return false;if(f.status&&t.status!==f.status)return false;if(f.conta&&t.account!==f.conta&&t.accountId!==f.conta)return false;if(q&&!`${t.description||''} ${t.account||''} ${t.category||''}`.toLowerCase().includes(q))return false;return true;}).sort((a,b)=>a.date<b.date?1:a.date>b.date?-1:0);
  };

  function currentPeriod(rows){ const ds=(rows||[]).map(r=>r.date).filter(Boolean).sort(); return {start:ds[0]||'',end:ds[ds.length-1]||''}; }
  Api.deleteHistory = function(id){ return callApi('deleteHistory',{id}); };
  logUploadHistory = async function(entry){
    try{
      const e={...entry}; if(e.bank!==APPLICATIONS_SOURCE && wz&&Array.isArray(wz.parsedRows)&&wz.parsedRows.length){const p=currentPeriod(wz.parsedRows);e.periodStart=e.periodStart||p.start;e.periodEnd=e.periodEnd||p.end;e.sourceId=e.sourceId||wz.sourceId||slugifySource(wz.sourceName||e.bank);}
      await Api.logHistory({bank:e.bank||'',filename:e.filename||'',status:e.status||'',rowCount:e.rowCount||0,errorMessage:e.errorMessage||'',periodStart:e.periodStart||'',periodEnd:e.periodEnd||'',sourceId:e.sourceId||''}); await loadData({silent:true});
    }catch(err){guardSession(err);}
  };
  saveImportForSource = async function({sourceId,sourceName,filename,sheetName,mapping,headerSignature,rows,fileBase64,fileMime}){
    try{const accounts=activeData().accounts||[],normalizedRows=(rows||[]).map((row,index)=>{const accountName=row.account||sourceName||'',accountId=row.accountId||resolveAccountId(accountName,accounts)||resolveAccountId(sourceName,accounts);return{...row,id:row.id||`${sourceId}_${row.date||'semdata'}_${index+1}`,sourceId,account:accountName,accountId};});const p=currentPeriod(normalizedRows);const closing=(wz&&wz.knownBankResult&&wz.knownBankResult.meta&&wz.knownBankResult.meta.lastBalance!=null)?Number(wz.knownBankResult.meta.lastBalance):null;await Api.saveImport({sourceId,sourceName,filename,sheetName,mapping,headerSignature,rows:normalizedRows,fileBase64,fileMime,periodStart:p.start,periodEnd:p.end,closingBalance:closing});await loadData();}catch(err){guardSession(err);throw err;}
  };

  renderHistory = function(){
    const {history,sources}=activeData(); renderHistoryBankFilterOptions(history); const filtered=state.historyBankFilter?history.filter(h=>h.bank===state.historyBankFilter):history; const body=document.getElementById('historyTableBody'); if(!body)return;
    const table=body.closest('table'); if(table){const tr=table.querySelector('thead tr'); if(tr)tr.innerHTML='<th>Banco</th><th>Arquivo</th><th>Período do extrato</th><th>Carregado em</th><th>Status</th><th class="num-col">Lançamentos</th><th></th>';}
    body.innerHTML=filtered.length?filtered.map(h=>{const ok=h.status==='concluido',period=h.periodStart?`${formatDateBR(h.periodStart)} a ${formatDateBR(h.periodEnd||h.periodStart)}`:'—';return `<tr><td>${escapeHtml(h.bank)}</td><td>${escapeHtml(h.filename||'—')}</td><td class="num">${period}</td><td class="num">${h.at?formatDateBR(h.at.slice(0,10))+' '+h.at.slice(11,16):'—'}</td><td><span class="pill ${ok?'pill-realizado':'pill-previsto'}">${ok?'Concluído':'Erro'}</span></td><td class="num-col num">${ok?h.rowCount:'—'}</td><td>${state.canEdit?`<button class="btn btn-small btn-ghost history-delete" data-del-history="${h.id}">Excluir</button>`:''}</td></tr>`;}).join(''):`<tr><td colspan="7"><div class="empty-state">Nenhum envio registrado ainda.</div></td></tr>`;
    body.querySelectorAll('[data-del-history]').forEach(btn=>btn.onclick=async()=>{const h=history.find(x=>x.id===btn.dataset.delHistory);if(!h)return;if(btn.dataset.confirm!=='1'){btn.dataset.confirm='1';btn.textContent='Confirmar exclusão';return;}try{const src=(sources||[]).find(s=>s.id===h.sourceId&&s.filename===h.filename);if(src)await Api.deleteSource(src.id);await Api.deleteHistory(h.id);await loadData();showToast(src?'Relatório ativo e histórico excluídos.':'Registro do histórico excluído.');}catch(e){guardSession(e);showToast('Não foi possível excluir o relatório.',true);}});
    const foot=document.getElementById('historyFooter'); if(foot)foot.textContent=`${filtered.length} envio${filtered.length===1?'':'s'} registrado${filtered.length===1?'':'s'}`;
  };

  renderSources = function(sources){
    const list=document.getElementById('sourceList');if(!list)return;const sorted=[...(sources||[])].sort((a,b)=>(a.sourceName||'').localeCompare(b.sourceName||''));const accounts=activeData().accounts||[],tx=activeData().transactions||[];
    list.innerHTML=sorted.length?sorted.map(s=>{const period=s.periodStart?`${formatDateBR(s.periodStart)} a ${formatDateBR(s.periodEnd||s.periodStart)}`:'período não identificado';let recon='';if(s.closingBalance!==null&&s.closingBalance!==undefined&&s.periodEnd){const acc=accounts.find(a=>transactionMatchesAccount({account:s.sourceName,accountId:''},a,accounts));if(acc){const next=addDaysISO(s.periodEnd,1),calc=accountOpeningBalance(acc,next,tx),diff=calc-Number(s.closingBalance);recon=`<span class="${Math.abs(diff)<0.01?'recon-ok':'recon-warn'}">${Math.abs(diff)<0.01?'✓ Conciliado':'Diferença '+formatBRL(diff,true)}</span>`;}}return `<div class="account-row"><div><div class="account-name">${escapeHtml(s.sourceName||s.id)}</div><div class="account-kind">${s.rowCount||0} lançamentos · <span class="coverage-pill">${period}</span>${recon?` · ${recon}`:''}</div></div></div>`;}).join(''):`<div class="empty-state">Nenhum relatório carregado ainda.</div>`;
    const hint=list.nextElementSibling;if(hint&&hint.classList.contains('field-hint'))hint.textContent='A cobertura é determinada automaticamente pelas datas encontradas em cada extrato.';
  };

  function setupV3Dom(){
    document.querySelectorAll('[data-view="dashboard"] span').forEach(s=>s.textContent='Fluxo de Caixa');
    document.querySelectorAll('#viewTabs [data-view="dashboard"]').forEach(b=>b.textContent='Fluxo de Caixa');
    const matrixFilters=document.getElementById('tableFilters'); if(matrixFilters&&!document.getElementById('fDateStart')){const wrap=document.createElement('div');wrap.className='matrix-date-filter';wrap.innerHTML='<input type="date" id="fDateStart" aria-label="Data inicial da matriz"><span class="date-sep">até</span><input type="date" id="fDateEnd" aria-label="Data final da matriz">';matrixFilters.prepend(wrap);}
    const l1=document.querySelector('label[for="accBalance"]');if(l1)l1.textContent='Saldo-base (R$)';const l2=document.querySelector('label[for="accDate"]');if(l2)l2.textContent='Data-base do saldo';const kind=document.getElementById('accKind');if(kind){kind.innerHTML='<option value="conta">Conta bancária</option>';kind.disabled=true;}
    const modal=document.getElementById('accountModal');if(modal&&!modal.querySelector('.account-base-note')){const note=document.createElement('div');note.className='account-base-note';note.textContent='Informe uma posição de saldo confiável (inclusive a partir de extrato PDF). O sistema reconstrói os saldos posteriores usando os extratos importados.';modal.querySelector('.modal-body').appendChild(note);}
  }
  openAccountModal = function(acc){ originalOpenAccountModal(acc); const title=document.getElementById('accountModalTitle');if(title)title.textContent=acc?'Editar conta bancária':'Cadastrar conta bancária';const kind=document.getElementById('accKind');if(kind)kind.value='conta'; };
  saveAccountFromModal = async function(){const name=document.getElementById('accName').value.trim();if(!name){showToast('Informe o nome da conta.',true);return;}const balance=parseFloat(document.getElementById('accBalance').value)||0,asOfDate=document.getElementById('accDate').value||todayISO(),existing=state.accounts.find(a=>a.id===editingAccountId);try{await saveAccount({id:editingAccountId,name,kind:'conta',balance,asOfDate,order:existing?existing.order:state.accounts.length});closeAccountModal();showToast('Conta bancária salva.');}catch(e){guardSession(e);showToast('Não foi possível salvar a conta.',true);}};

  applyEditGating = function(){ originalApplyEditGating(); const director=!state.canEdit; document.querySelectorAll('[data-view="history"]').forEach(el=>el.hidden=director); if(director&&document.getElementById('historyView')&&!document.getElementById('historyView').hidden) originalSwitchView('dashboard'); };
  switchView = function(view){ if(view==='history'&&!state.canEdit)view='dashboard'; return originalSwitchView(view); };

  renderAll = function(){
    const {accounts,transactions,sources}=activeData();const demo=document.getElementById('demoBanner');if(demo)demo.hidden=!state.usingDemo;transactions.forEach(t=>{if(!t.accountId)t.accountId=resolveAccountId(t.account,accounts);});ensureCustomRange();renderRangeControl();const {start,end}=getRangeBounds(currentRangeId,transactions);if(!state.matrixRangeTouched){state.filters.dateStart=start;state.filters.dateEnd=end;const a=document.getElementById('fDateStart'),b=document.getElementById('fDateEnd');if(a)a.value=start;if(b)b.value=end;}const opening=totalOpeningBalance(accounts,transactions,start);const daily=computeDailySeries(transactions,start,end),cumulative=projectionSeries(transactions,start,end,opening),k=computeKPIs(accounts,transactions,start,end,cumulative),tr=computeKPITrends(transactions,start,end,k);renderKPIs(k,tr);const pt=document.getElementById('projectionTitle'),pp=document.getElementById('projectionPeriod');if(pt)pt.textContent='Evolução e projeção do caixa';if(pp)pp.textContent=`${formatDateBR(start)} a ${formatDateBR(end)}`;renderDiario(transactions,k,start,end);renderProjectionLegend();drawCumulativeChart(cumulative);renderSources(sources);renderBankPosition(accounts,transactions,start,end);renderAccountFilterOptions(accounts,transactions);renderDescMatrix(transactions);
  };

  renderApplications = function(){ originalRenderApplications(); const apps=normalizeAppsTreasury(activeData().applications); if(!apps)return; const hero=document.getElementById('appsHeroRow'); if(hero){const note=document.createElement('div');note.className='field-hint';note.style.marginTop='8px';note.textContent='Santander MAX é tratado como disponibilidade bancária e não compõe o saldo de aplicações para evitar dupla contagem.';if(!hero.parentElement.querySelector('.max-bank-note')){note.classList.add('max-bank-note');hero.parentElement.insertBefore(note,hero.nextSibling);}} };

  wireStaticEvents = function(){
    originalWireStaticEvents(); setupV3Dom(); if(window.__plansulV3Wired)return;window.__plansulV3Wired=true;
    ['fDateStart','fDateEnd'].forEach(id=>{const el=document.getElementById(id);if(el)el.addEventListener('change',()=>{const a=document.getElementById('fDateStart').value,b=document.getElementById('fDateEnd').value;if(a&&b&&a<=b){state.filters.dateStart=a;state.filters.dateEnd=b;state.matrixRangeTouched=true;state.descMatrixPage=1;renderDescMatrix(activeData().transactions);}});});
  };
  setupV3Dom();
})();
