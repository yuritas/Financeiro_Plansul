/* Plansul — V4.1: filtros de período consistentes.
 * - filtro geral visível também no mobile;
 * - Matriz por descrição usa o mesmo padrão visual do cabeçalho;
 * - desktop: 2 calendários; mobile: 1 calendário por vez. */
(function(){
  let matrixCursor='';
  let matrixPendingStart='';
  let matrixPendingEnd='';

  function p2(n){ return String(n).padStart(2,'0'); }
  function iso(y,m,d){ return `${y}-${p2(m)}-${p2(d)}`; }
  function monthStart(value){ return String(value||todayISO()).slice(0,7)+'-01'; }
  function monthShift(value,delta){
    const [y,m]=monthStart(value).split('-').map(Number);
    const d=new Date(y,m-1+delta,1);
    return iso(d.getFullYear(),d.getMonth()+1,1);
  }
  function monthEnd(value){
    const [y,m]=monthStart(value).split('-').map(Number);
    return iso(y,m,new Date(y,m,0).getDate());
  }
  function monthTitle(value){
    const [y,m]=monthStart(value).split('-').map(Number);
    return `${MONTH_NAMES[m-1]} ${y}`;
  }
  function monthCells(value){
    const [y,m]=monthStart(value).split('-').map(Number);
    const first=new Date(y,m-1,1), offset=first.getDay();
    const start=new Date(y,m-1,1-offset), out=[];
    for(let i=0;i<42;i++){
      const d=new Date(start.getFullYear(),start.getMonth(),start.getDate()+i);
      out.push({ date:iso(d.getFullYear(),d.getMonth()+1,d.getDate()), day:d.getDate(), same:d.getMonth()===m-1 });
    }
    return out;
  }
  function selected(d){ return matrixPendingStart && matrixPendingEnd && d>=matrixPendingStart && d<=matrixPendingEnd; }
  function calendarMonth(value,second){
    return `<div class="drp-month ${second?'second':''}">
      <div class="drp-month-head">
        ${second?'':'<button class="drp-nav" data-matrix-nav="-1" type="button" aria-label="Mês anterior">‹</button>'}
        <span>${monthTitle(value)}</span>
        ${second?'<button class="drp-nav" data-matrix-nav="1" type="button" aria-label="Próximo mês">›</button>':'<button class="drp-nav drp-next-mobile" data-matrix-nav="1" type="button" aria-label="Próximo mês">›</button>'}
      </div>
      <div class="drp-week"><span>Dom</span><span>Seg</span><span>Ter</span><span>Qua</span><span>Qui</span><span>Sex</span><span>Sáb</span></div>
      <div class="drp-grid">${monthCells(value).map(c=>{
        const cls=['drp-day'];
        if(!c.same) cls.push('out');
        if(selected(c.date)) cls.push('in-range');
        if(c.date===matrixPendingStart) cls.push('start');
        if(c.date===matrixPendingEnd) cls.push('end');
        return `<button type="button" class="${cls.join(' ')}" data-matrix-date="${c.date}">${c.day}</button>`;
      }).join('')}</div>
    </div>`;
  }
  function preset(kind){
    const today=todayISO();
    if(kind==='today'){ matrixPendingStart=today; matrixPendingEnd=today; }
    if(kind==='7'){ matrixPendingEnd=today; matrixPendingStart=addDaysISO(today,-6); }
    if(kind==='30'){ matrixPendingEnd=today; matrixPendingStart=addDaysISO(today,-29); }
    if(kind==='month'){ matrixPendingStart=monthStart(today); matrixPendingEnd=monthEnd(today); }
    if(kind==='prev'){
      const prev=monthShift(today,-1); matrixPendingStart=prev; matrixPendingEnd=monthEnd(prev);
    }
    if(kind==='general'){
      try{
        const r=getRangeBounds(currentRangeId,activeData().transactions||[]);
        matrixPendingStart=r.start; matrixPendingEnd=r.end;
      }catch(e){ matrixPendingStart=monthStart(today); matrixPendingEnd=monthEnd(today); }
    }
    matrixCursor=monthStart(matrixPendingStart||today);
  }

  function ensureMatrixControl(){
    const filters=document.getElementById('tableFilters');
    if(!filters) return null;
    const legacy=filters.querySelector('.matrix-date-filter');
    if(legacy) legacy.hidden=true;
    let wrap=document.getElementById('matrixRangeWrap');
    if(!wrap){
      wrap=document.createElement('div');
      wrap.id='matrixRangeWrap';
      wrap.className='matrix-range-wrap header-dropdown';
      wrap.innerHTML=`<button class="header-dropdown-trigger matrix-range-trigger" id="matrixRangeTrigger" type="button" aria-haspopup="true" aria-expanded="false" aria-label="Selecionar período da Matriz por descrição">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/></svg>
        <span id="matrixRangeLabel">Período da matriz</span>
        <svg class="hdt-chev" viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button><div class="header-dropdown-pop date-range-pop matrix-range-pop" id="matrixRangePop" hidden></div>`;
      filters.prepend(wrap);
      const trigger=wrap.querySelector('#matrixRangeTrigger');
      trigger.onclick=(e)=>{
        e.stopPropagation();
        const pop=wrap.querySelector('#matrixRangePop'), opening=pop.hidden;
        document.querySelectorAll('.header-dropdown-pop').forEach(p=>{ if(p!==pop) p.hidden=true; });
        pop.hidden=!opening; trigger.setAttribute('aria-expanded',opening?'true':'false');
        if(opening){
          matrixPendingStart=state.filters.dateStart||'';
          matrixPendingEnd=state.filters.dateEnd||'';
          if(!matrixPendingStart) preset('general');
          matrixCursor=monthStart(matrixPendingStart||todayISO());
          renderMatrixPopover();
        }
      };
    }
    return wrap;
  }

  function renderMatrixPopover(){
    const wrap=ensureMatrixControl(); if(!wrap) return;
    const pop=wrap.querySelector('#matrixRangePop');
    const trigger=wrap.querySelector('#matrixRangeTrigger');
    const label=wrap.querySelector('#matrixRangeLabel');
    const currentStart=state.filters.dateStart||matrixPendingStart, currentEnd=state.filters.dateEnd||matrixPendingEnd;
    if(label) label.textContent=currentStart&&currentEnd ? `${formatDateBR(currentStart)} – ${formatDateBR(currentEnd)}` : 'Selecionar período';
    if(pop.hidden) return;
    if(!matrixCursor) matrixCursor=monthStart(matrixPendingStart||currentStart||todayISO());
    pop.innerHTML=`<div class="drp-head"><div><div class="drp-title">Intervalo da Matriz por descrição</div><div class="drp-value">${matrixPendingStart?formatDateBR(matrixPendingStart):'—'} → ${matrixPendingEnd?formatDateBR(matrixPendingEnd):'selecione a data final'}</div></div></div>
      <div class="drp-shortcuts"><button class="drp-shortcut" data-matrix-preset="general">Mesmo período do Fluxo</button><button class="drp-shortcut" data-matrix-preset="today">Hoje</button><button class="drp-shortcut" data-matrix-preset="7">Últimos 7 dias</button><button class="drp-shortcut" data-matrix-preset="30">Últimos 30 dias</button><button class="drp-shortcut" data-matrix-preset="month">Este mês</button><button class="drp-shortcut" data-matrix-preset="prev">Mês anterior</button></div>
      <div class="drp-calendars">${calendarMonth(matrixCursor,false)}${calendarMonth(monthShift(matrixCursor,1),true)}</div>
      <div class="drp-foot"><span class="field-hint">Selecione a data inicial e a final.</span><span class="spacer"></span><button type="button" class="btn btn-primary btn-small" data-matrix-apply ${!matrixPendingStart?'disabled':''}>Aplicar</button></div>`;
    pop.querySelectorAll('[data-matrix-nav]').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); matrixCursor=monthShift(matrixCursor,Number(b.dataset.matrixNav)); renderMatrixPopover(); });
    pop.querySelectorAll('[data-matrix-date]').forEach(b=>b.onclick=(e)=>{
      e.stopPropagation(); const d=b.dataset.matrixDate;
      if(!matrixPendingStart || matrixPendingEnd){ matrixPendingStart=d; matrixPendingEnd=''; }
      else { matrixPendingEnd=d; if(matrixPendingEnd<matrixPendingStart){ const x=matrixPendingStart; matrixPendingStart=matrixPendingEnd; matrixPendingEnd=x; } }
      renderMatrixPopover();
    });
    pop.querySelectorAll('[data-matrix-preset]').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); preset(b.dataset.matrixPreset); renderMatrixPopover(); });
    const apply=pop.querySelector('[data-matrix-apply]');
    if(apply) apply.onclick=(e)=>{
      e.stopPropagation(); if(!matrixPendingStart) return; if(!matrixPendingEnd) matrixPendingEnd=matrixPendingStart;
      state.filters.dateStart=matrixPendingStart; state.filters.dateEnd=matrixPendingEnd; state.matrixRangeTouched=true; state.descMatrixPage=1;
      pop.hidden=true; trigger.setAttribute('aria-expanded','false');
      renderDescMatrix(activeData().transactions||[]); updateMatrixLabel();
    };
  }
  function updateMatrixLabel(){
    const wrap=ensureMatrixControl(); if(!wrap) return;
    const label=wrap.querySelector('#matrixRangeLabel');
    if(label) label.textContent=state.filters.dateStart&&state.filters.dateEnd ? `${formatDateBR(state.filters.dateStart)} – ${formatDateBR(state.filters.dateEnd)}` : 'Selecionar período';
  }

  const originalRenderAllDateV4=renderAll;
  renderAll=function(){ const out=originalRenderAllDateV4.apply(this,arguments); ensureMatrixControl(); updateMatrixLabel(); return out; };
  const originalWireDateV4=wireStaticEvents;
  wireStaticEvents=function(){ const out=originalWireDateV4.apply(this,arguments); ensureMatrixControl(); updateMatrixLabel(); return out; };

  document.addEventListener('click',(e)=>{
    const wrap=document.getElementById('matrixRangeWrap'); if(!wrap||wrap.contains(e.target)) return;
    const pop=document.getElementById('matrixRangePop'), trigger=document.getElementById('matrixRangeTrigger');
    if(pop) pop.hidden=true; if(trigger) trigger.setAttribute('aria-expanded','false');
  });

  ensureMatrixControl(); updateMatrixLabel();
})();
