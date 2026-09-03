/* ==== CONFIG & CONSTANTS ==== */
// Cole aqui a URL do seu Web App do Google Apps Script (termina com /exec).
// Veja SETUP.md — passo "Implantar como Web App".
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbycMtivGfXTx4pKa3ltR29cY0owrV37fJG0Iy9MVlgg-dE99KuqOc7XgcFe0tjKHQ/exec';
const MAX_PREVIEW_ROWS = 8;
const RANGE_PRESETS = [
  { id: '30_45',  label: '30d / +45d', past: 30,  future: 45  },
  { id: '14_30',  label: '14d / +30d', past: 14,  future: 30  },
  { id: '90_90',  label: '90d / +90d', past: 90,  future: 90  },
  { id: 'all',    label: 'Tudo',       past: null, future: null },
];
let currentRangeId = '30_45';

const STATUS_LABEL = { realizado: 'Realizado', previsto: 'Previsto' };
const TYPE_LABEL = { recebimento: 'Recebimento', pagamento: 'Pagamento' };

// Bancos com layout de relatório próprio — cada um vira uma "fonte"
// separada, com seu próprio mapeamento de colunas lembrado.
const BANKS = ['Banco XP', 'BTG Pactual', 'Sicredi', 'CEF', 'Santander', 'Azimut', 'Mercado Pago'];
const OTHER_BANK = 'Outro';
const HISTORY_KEEP = 200; // poda o histórico de uploads acima disso

// Relatório especial "Analise Aplicações" — não é lançamento linha a linha,
// é uma fotografia do saldo de cada fundo. Some ao seletor de bancos do
// assistente, mas segue um fluxo próprio (ver ISSO no wizard mais abaixo).
const APPLICATIONS_SOURCE = 'Análise Aplicações';
const APPLICATIONS_STALE_DAYS = 60; // acima disso, o fundo é marcado como "desatualizado"

/* ==== UTILITIES ==== */
function pad2(n){ return String(n).padStart(2,'0'); }
function todayISO(){
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}
function isoFromParts(y,m,d){ return `${y}-${pad2(m)}-${pad2(d)}`; }
function addDaysISO(iso, days){
  const [y,m,d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m-1, d));
  dt.setUTCDate(dt.getUTCDate()+days);
  return isoFromParts(dt.getUTCFullYear(), dt.getUTCMonth()+1, dt.getUTCDate());
}
function daysBetweenISO(a,b){
  const [ay,am,ad]=a.split('-').map(Number), [by,bm,bd]=b.split('-').map(Number);
  const da=Date.UTC(ay,am-1,ad), db=Date.UTC(by,bm-1,bd);
  return Math.round((db-da)/86400000);
}
function formatDateBR(iso){
  if(!iso) return '—';
  const [y,m,d]=iso.split('-');
  return `${d}/${m}/${y}`;
}
function formatDateShort(iso){
  const [y,m,d]=iso.split('-');
  return `${d}/${m}`;
}
const BRL = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL', maximumFractionDigits:0 });
const BRL_CENTS = new Intl.NumberFormat('pt-BR', { style:'currency', currency:'BRL' });
function formatBRL(v, cents){ return (cents ? BRL_CENTS : BRL).format(v||0); }
function formatCompactBRL(v){
  const abs = Math.abs(v||0);
  if(abs >= 1000000) return (v<0?'-':'') + 'R$ ' + (abs/1000000).toLocaleString('pt-BR',{maximumFractionDigits:1}) + 'mi';
  if(abs >= 1000) return (v<0?'-':'') + 'R$ ' + (abs/1000).toLocaleString('pt-BR',{maximumFractionDigits:0}) + 'mil';
  return formatBRL(v);
}
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}
function uid(prefix){ return (prefix||'id') + '_' + Math.random().toString(36).slice(2,10) + Date.now().toString(36).slice(-4); }
function debounce(fn, ms){ let t; return (...a)=>{ clearTimeout(t); t=setTimeout(()=>fn(...a), ms); }; }
function clamp(v,min,max){ return Math.max(min, Math.min(max, v)); }
function colLetter(i){
  let s='';
  i++;
  while(i>0){ const r=(i-1)%26; s=String.fromCharCode(65+r)+s; i=Math.floor((i-1)/26); }
  return s;
}
function mulberry32(seed){
  return function(){
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function byteLength(obj){ return new Blob([JSON.stringify(obj)]).size; }

/* ==== EXAMPLE DATA ==== */
function generateExampleData(){
  const rnd = mulberry32(20260902);
  const today = todayISO();
  const accounts = [
    { id:'ex_acc_1', name:'Banco XP',      kind:'conta',    balance:184320.55, asOfDate:today, order:0 },
    { id:'ex_acc_2', name:'Sicredi',       kind:'conta',    balance:96140.10,  asOfDate:today, order:1 },
    { id:'ex_acc_3', name:'CEF',           kind:'conta',    balance:41250.30,  asOfDate:today, order:2 },
    { id:'ex_acc_4', name:'Santander',     kind:'conta',    balance:28870.00,  asOfDate:today, order:3 },
    { id:'ex_acc_5', name:'Mercado Pago',  kind:'conta',    balance:12640.20,  asOfDate:today, order:4 },
    { id:'ex_acc_6', name:'BTG Pactual',   kind:'aplicacao',balance:620000.00, asOfDate:today, order:5 },
    { id:'ex_acc_7', name:'Azimut',        kind:'aplicacao',balance:185300.00, asOfDate:today, order:6 },
  ];
  const inCats = [
    'Contrato — Estudo Ambiental BR-101',
    'Contrato — Plano Diretor Municipal',
    'Contrato — Consultoria SANEPAR',
    'Medição de serviços — Obra Itajaí',
    'Assessoria técnica recorrente',
  ];
  const outCats = [
    'Folha de pagamento',
    'Fornecedores e insumos',
    'Impostos e tributos',
    'Aluguel e condomínio',
    'Prestadores de serviço (PJ)',
    'Despesas administrativas',
  ];
  // Só as contas-corrente recebem extratos com lançamentos linha a linha —
  // as aplicações (BTG Pactual, Azimut) só têm saldo, atualizado manualmente.
  const inAccounts = ['Banco XP','Sicredi','CEF','Santander','Mercado Pago'];
  const rows = [];
  const startISO = addDaysISO(today, -45);
  for(let i=0; i<=90; i++){
    const date = addDaysISO(startISO, i);
    const dayOfMonth = Number(date.split('-')[2]);
    const isPast = daysBetweenISO(date, today) >= 0;
    const status = isPast ? 'realizado' : 'previsto';

    // Recebimentos: a few contract installments per month, weighted mid-month
    if(rnd() < 0.16){
      const cat = inCats[Math.floor(rnd()*inCats.length)];
      rows.push({
        date, type:'recebimento', status,
        value: Math.round((9000 + rnd()*38000)*100)/100,
        account: inAccounts[Math.floor(rnd()*inAccounts.length)],
        category: cat,
        description: cat + ' — parcela ' + (1+Math.floor(rnd()*6)),
      });
    }
    // Folha de pagamento: dias 5 e 20
    if(dayOfMonth === 5 || dayOfMonth === 20){
      rows.push({
        date, type:'pagamento', status,
        value: Math.round((46000 + rnd()*6000)*100)/100,
        account: 'CEF',
        category: 'Folha de pagamento',
        description: dayOfMonth===5 ? 'Folha de pagamento — adiantamento' : 'Folha de pagamento — mensal',
      });
    }
    // Impostos: dia 10 e 20
    if(dayOfMonth === 10 || dayOfMonth === 20){
      rows.push({
        date, type:'pagamento', status,
        value: Math.round((7000 + rnd()*9000)*100)/100,
        account: 'Santander',
        category: 'Impostos e tributos',
        description: 'DAS/ISS/INSS — competência',
      });
    }
    // Aluguel: dia 8
    if(dayOfMonth === 8){
      rows.push({
        date, type:'pagamento', status,
        value: 12800,
        account: 'Sicredi',
        category: 'Aluguel e condomínio',
        description: 'Aluguel + condomínio — sede Florianópolis',
      });
    }
    // Fornecedores e PJ: aleatório, mais frequente
    if(rnd() < 0.42){
      const cat = outCats[Math.floor(rnd()*3)+1];
      rows.push({
        date, type:'pagamento', status,
        value: Math.round((350 + rnd()*5200)*100)/100,
        account: inAccounts[Math.floor(rnd()*inAccounts.length)],
        category: cat,
        description: cat + ' — ' + ['NF','fatura','recibo'][Math.floor(rnd()*3)] + ' ' + (1000+Math.floor(rnd()*9000)),
      });
    }
  }
  // A couple of overdue (previsto no passado) to show attention state
  rows.push({ date: addDaysISO(today,-4), type:'recebimento', status:'previsto', value: 18400, account:'Santander', category:inCats[1], description:inCats[1]+' — parcela em atraso' });
  rows.push({ date: addDaysISO(today,-2), type:'pagamento', status:'previsto', value: 3200, account:'Mercado Pago', category:outCats[1], description:outCats[1]+' — pagamento em atraso' });

  rows.sort((a,b)=> a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  rows.forEach(r=>{ r.source = r.account; });

  const sources = inAccounts.map((name,i)=>({
    id: slugifySource(name), sourceName: name,
    filename: 'extrato_' + slugifySource(name) + '_exemplo.xlsx',
    rowCount: rows.filter(r=>r.account===name).length,
    uploadedAt: addDaysISO(today, -i).concat('T09:00:00.000Z'),
  }));

  // Exemplo de histórico — algumas semanas de envios, um deles com falha.
  const history = [];
  inAccounts.forEach((name, bi)=>{
    for(let w=0; w<4; w++){
      const daysAgo = w*7 + bi;
      history.push({
        id: 'ex_hist_'+bi+'_'+w, bank: name,
        filename: 'extrato_'+slugifySource(name)+'_'+addDaysISO(today,-daysAgo)+'.xlsx',
        status: 'concluido', rowCount: 8+Math.floor(rnd()*40),
        at: addDaysISO(today, -daysAgo) + 'T' + pad2(8+bi) + ':' + pad2(10+w) + ':00.000Z',
      });
    }
  });
  history.push({
    id:'ex_hist_erro', bank:'Santander',
    filename:'extrato_santander_layout_antigo.xlsx',
    status:'erro', rowCount:0, errorMessage:'Coluna de data não encontrada no arquivo enviado.',
    at: addDaysISO(today,-11).concat('T14:32:00.000Z'),
  });
  history.sort((a,b)=> a.at < b.at ? 1 : -1);

  const applications = generateExampleApplications(today, rnd);

  return { accounts, transactions: rows, sources, history, applications };
}

function generateExampleApplications(today, rnd){
  const defs = [
    { banco:'BTG Pactual', fundo:'BTG Pactual DI FIC FI', contaCod:'8841-2', saldo: 620000, indexador:'CDI', vinculo:'Livre', garantia:'Não', cotizacao:'D+1', daysAgo:2 },
    { banco:'Azimut', fundo:'Azimut Absoluto FIC FIM', contaCod:'1075-9', saldo: 185300, indexador:'CDI +', vinculo:'Livre', garantia:'Não', cotizacao:'D+30', daysAgo:5 },
    { banco:'Banco XP', fundo:'XP Investor FIC FI RF', contaCod:'55210-4', saldo: 96500, indexador:'CDI', vinculo:'Livre', garantia:'Não', cotizacao:'D+0', daysAgo:1 },
    { banco:'Sicredi', fundo:'Sicredi FIC FI RF Simples', contaCod:'30982-1', saldo: 41200, indexador:'CDI', vinculo:'Livre', garantia:'Não', cotizacao:'D+1', daysAgo:3 },
    { banco:'Santander', fundo:'Santander FIC FI Referenciado DI', contaCod:'71440-8', saldo: 28900, indexador:'CDI', vinculo:'Livre', garantia:'Não', cotizacao:'D+1', daysAgo:8 },
    { banco:'CEF', fundo:'Caixa FIC FI RF Curto Prazo', contaCod:'19023-5', saldo: 15600, indexador:'CDI', vinculo:'Vinculado — garantia contratual', garantia:'Sim', cotizacao:'D+2', daysAgo:96 },
  ];
  let asOfDate = today;
  const funds = defs.map((d,i)=>{
    const competencia = addDaysISO(today, -d.daysAgo);
    if(competencia > asOfDate) asOfDate = competencia;
    const rendimentos = Math.round(d.saldo * (0.008 + rnd()*0.006) * 100)/100;
    const saldoInicial = Math.round((d.saldo - rendimentos) * 100)/100;
    return {
      id: 'ex_fund_'+i, banco: d.banco, fundo: d.fundo, contaCod: d.contaCod,
      saldoInicial, aplicacoes: 0, rendimentos, imposto: 0, resgate: 0,
      saldoFinal: d.saldo, rendimentosPct: Math.round((rendimentos/saldoInicial)*10000)/100,
      competencia, cotizacaoResgate: d.cotizacao, garantia: d.garantia, vinculo: d.vinculo, indexador: d.indexador,
      stale: false, staleDays: 0,
    };
  });
  funds.forEach(f=>{ f.staleDays = daysBetweenISO(f.competencia, asOfDate); f.stale = f.staleDays > APPLICATIONS_STALE_DAYS; });
  funds.sort((a,b)=> b.saldoFinal - a.saldoFinal);
  const totalBalance = funds.reduce((s,f)=>s+f.saldoFinal,0);
  const byBankMap = new Map();
  funds.forEach(f=> byBankMap.set(f.banco, (byBankMap.get(f.banco)||0)+f.saldoFinal));
  const byBank = [...byBankMap.entries()].map(([banco,total])=>({banco,total})).sort((a,b)=>b.total-a.total);
  const staleCount = funds.filter(f=>f.stale).length;
  return { funds, totalBalance, byBank, asOfDate, staleCount, uploadedAt: addDaysISO(today,-1).concat('T09:00:00.000Z'), filename:'analise_aplicacoes_exemplo.xlsx' };
}

/* ==== EXCEL PARSING ==== */
function readWorkbookFile(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = (e)=>{
      try{
        const wb = XLSX.read(e.target.result, { type:'array', cellDates:true });
        resolve(wb);
      }catch(err){ reject(err); }
    };
    reader.onerror = ()=> reject(reader.error);
    reader.readAsArrayBuffer(file);
  });
}
function sheetToMatrix(wb, sheetName){
  const ws = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json(ws, { header:1, raw:true, defval:null, blankrows:false });
}
function guessHeaderRow(matrix){
  let best = 0, bestScore = -1;
  const scanRows = Math.min(matrix.length, 15);
  for(let r=0; r<scanRows; r++){
    const row = matrix[r] || [];
    let strings=0, nonEmpty=0;
    row.forEach(c=>{
      if(c===null || c===undefined || c==='') return;
      nonEmpty++;
      if(typeof c === 'string' && isNaN(Number(c.replace(',','.')))) strings++;
    });
    if(nonEmpty < 2) continue;
    // reward rows dominated by text with a couple of neighboring rows that look numeric
    let score = strings*2 - (nonEmpty-strings);
    const next = matrix[r+1] || [];
    let nextNumeric = 0;
    next.forEach(c=>{ if(typeof c === 'number' || c instanceof Date) nextNumeric++; });
    score += nextNumeric;
    if(score > bestScore){ bestScore = score; best = r; }
  }
  return best;
}
function maxCols(matrix, headerRowIdx){
  let m = 0;
  const end = Math.min(matrix.length, headerRowIdx+40);
  for(let r=headerRowIdx; r<end; r++){ if(matrix[r]) m = Math.max(m, matrix[r].length); }
  return m;
}
function buildColumnOptions(matrix, headerRowIdx){
  const n = maxCols(matrix, headerRowIdx);
  const header = matrix[headerRowIdx] || [];
  const opts = [];
  for(let i=0;i<n;i++){
    const raw = header[i];
    const label = (raw!==null && raw!==undefined && String(raw).trim()!=='')
      ? String(raw).trim()
      : `Coluna ${colLetter(i)}`;
    opts.push({ index:i, label: `${colLetter(i)} — ${label}` });
  }
  return opts;
}
const EXCEL_EPOCH_UTC = Date.UTC(1899,11,30);
function parseDateCell(v){
  if(v===null || v===undefined || v==='') return null;
  if(v instanceof Date){
    if(isNaN(v.getTime())) return null;
    return isoFromParts(v.getUTCFullYear(), v.getUTCMonth()+1, v.getUTCDate());
  }
  if(typeof v === 'number'){
    if(v > 20000 && v < 60000){
      const ms = EXCEL_EPOCH_UTC + v*86400000;
      const d = new Date(ms);
      return isoFromParts(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate());
    }
    return null;
  }
  if(typeof v === 'string'){
    const s = v.trim();
    let m = s.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);
    if(m) return isoFromParts(+m[1], +m[2], +m[3]);
    m = s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/);
    if(m){
      let [_, d, mo, y] = m;
      if(y.length===2) y = (Number(y)>50 ? '19':'20') + y;
      return isoFromParts(+y, +mo, +d);
    }
    const parsed = Date.parse(s);
    if(!isNaN(parsed)){
      const d = new Date(parsed);
      return isoFromParts(d.getUTCFullYear(), d.getUTCMonth()+1, d.getUTCDate());
    }
    return null;
  }
  return null;
}
function parseNumberCell(v){
  if(v===null || v===undefined || v==='') return NaN;
  if(typeof v === 'number') return v;
  let s = String(v).trim();
  if(s==='') return NaN;
  let neg = false;
  if(/^\(.*\)$/.test(s)){ neg = true; s = s.slice(1,-1); }
  s = s.replace(/R\$\s?/gi,'').replace(/\s/g,'');
  if(/^-/.test(s)){ neg = true; s = s.slice(1); }
  if(/^\+/.test(s)) s = s.slice(1);
  if(s.includes(',') ){
    s = s.replace(/\./g,'').replace(',', '.');
  }
  const n = parseFloat(s);
  if(isNaN(n)) return NaN;
  return neg ? -n : n;
}
function normalizeTypeText(s){
  if(s===null || s===undefined) return '';
  return String(s).trim().toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'');
}
function normalizeKeyText(s){
  return normalizeTypeText(s).replace(/\s+/g,' ').trim();
}
function numOrZero(v){
  const n = parseNumberCell(v);
  return isNaN(n) ? 0 : n;
}

/* ==== APLICA\u00c7\u00d5ES (relat\u00f3rio "Analise Aplica\u00e7\u00f5es" \u2014 CONSOLIDADO + Informa\u00e7\u00f5es Fundos) ====
 * Este relat\u00f3rio n\u00e3o \u00e9 lan\u00e7amento linha a linha: \u00e9 uma fotografia peri\u00f3dica
 * do saldo de cada fundo. A CONSOLIDADO tem uma linha por fundo por m\u00eas \u2014
 * pegamos sempre a linha mais recente de cada fundo (identificado de
 * prefer\u00eancia pelo "Cod Conta Corrente", que \u00e9 est\u00e1vel mesmo quando o nome
 * do banco/fundo vem escrito de forma diferente entre um m\u00eas e outro) e
 * cruzamos com a Informa\u00e7\u00f5es Fundos para trazer v\u00ednculo/garantia/indexador. */
function findSheetName(wb, patterns){
  return wb.SheetNames.find(n => patterns.some(re => re.test(normalizeTypeText(n))));
}
function findHeaderIndex(header, re, excludeRe){
  for(let i=0;i<header.length;i++){
    const v = header[i];
    if(v===null || v===undefined || String(v).trim()==='') continue;
    const norm = normalizeTypeText(String(v));
    if(excludeRe && excludeRe.test(norm)) continue;
    if(re.test(norm)) return i;
  }
  return -1;
}
function applicationsFundKey(contaCod, banco, fundo){
  const cc = String(contaCod||'').trim();
  if(cc) return 'cc:'+normalizeKeyText(cc);
  return 'bf:'+normalizeKeyText(banco)+'|'+normalizeKeyText(fundo);
}
function parseApplicationsWorkbook(wb){
  const consName = findSheetName(wb, [/consolidad/]);
  if(!consName){ const e = new Error('sheet-consolidado-not-found'); throw e; }
  const infoName = findSheetName(wb, [/informac.*fund/, /fund.*informac/]);

  const consMatrix = sheetToMatrix(wb, consName);
  const headerIdx = guessHeaderRow(consMatrix);
  const header = consMatrix[headerIdx] || [];
  const col = {
    banco: findHeaderIndex(header, /^banco$/),
    banco2: findHeaderIndex(header, /banco\s*2|banco2/),
    contaCod: findHeaderIndex(header, /cod.*conta/),
    competencia: findHeaderIndex(header, /competenc/),
    fundo: findHeaderIndex(header, /fundo/),
    saldoInicial: findHeaderIndex(header, /saldo.*inicial/),
    aplicacoes: findHeaderIndex(header, /aplicac/),
    rendimentosPct: findHeaderIndex(header, /rendiment.*%|%.*rendiment/),
    rendimentos: findHeaderIndex(header, /rendiment/, /%/),
    imposto: findHeaderIndex(header, /imposto/),
    resgate: findHeaderIndex(header, /resgate/),
    saldoFinal: findHeaderIndex(header, /saldo.*final/),
  };

  const rawRows = [];
  for(let r=headerIdx+1; r<consMatrix.length; r++){
    const row = consMatrix[r];
    if(!row) continue;
    const fundoRaw = col.fundo>=0 ? row[col.fundo] : null;
    if(fundoRaw===null || fundoRaw===undefined || String(fundoRaw).trim()==='') continue;
    const competencia = col.competencia>=0 ? parseDateCell(row[col.competencia]) : null;
    if(!competencia) continue;
    const banco2Val = col.banco2>=0 ? row[col.banco2] : null;
    const bancoRaw = (banco2Val!==null && banco2Val!==undefined && String(banco2Val).trim()!=='')
      ? banco2Val : (col.banco>=0 ? row[col.banco] : '');
    rawRows.push({
      bancoRaw: String(bancoRaw||'').trim(),
      fundoRaw: String(fundoRaw).trim(),
      contaCod: col.contaCod>=0 ? String(row[col.contaCod]==null?'':row[col.contaCod]).trim() : '',
      competencia,
      saldoInicial: numOrZero(row[col.saldoInicial]),
      aplicacoes: numOrZero(row[col.aplicacoes]),
      rendimentos: numOrZero(row[col.rendimentos]),
      imposto: numOrZero(row[col.imposto]),
      resgate: numOrZero(row[col.resgate]),
      saldoFinal: numOrZero(row[col.saldoFinal]),
      rendimentosPct: col.rendimentosPct>=0 ? parseNumberCell(row[col.rendimentosPct]) : NaN,
    });
  }

  const infoByKey = new Map();
  if(infoName){
    const infoMatrix = sheetToMatrix(wb, infoName);
    const infoHeaderIdx = guessHeaderRow(infoMatrix);
    const ih = infoMatrix[infoHeaderIdx] || [];
    const icol = {
      contaCod: findHeaderIndex(ih, /cod.*conta/),
      banco: findHeaderIndex(ih, /^banco$/),
      fundo: findHeaderIndex(ih, /fundo/),
      cotizacao: findHeaderIndex(ih, /cotiza/),
      garantia: findHeaderIndex(ih, /garantia/),
      vinculo: findHeaderIndex(ih, /vinculo/),
      indexador: findHeaderIndex(ih, /indexador/),
    };
    for(let r=infoHeaderIdx+1; r<infoMatrix.length; r++){
      const row = infoMatrix[r];
      if(!row) continue;
      const fundoRaw = icol.fundo>=0 ? row[icol.fundo] : null;
      if(fundoRaw===null || fundoRaw===undefined || String(fundoRaw).trim()==='') continue;
      const contaCodRaw = icol.contaCod>=0 ? row[icol.contaCod] : '';
      const bancoRaw = icol.banco>=0 ? row[icol.banco] : '';
      const key = applicationsFundKey(contaCodRaw, bancoRaw, fundoRaw);
      infoByKey.set(key, {
        cotizacaoResgate: icol.cotizacao>=0 ? String(row[icol.cotizacao]==null?'':row[icol.cotizacao]).trim() : '',
        garantia: icol.garantia>=0 ? String(row[icol.garantia]==null?'':row[icol.garantia]).trim() : '',
        vinculo: icol.vinculo>=0 ? String(row[icol.vinculo]==null?'':row[icol.vinculo]).trim() : '',
        indexador: icol.indexador>=0 ? String(row[icol.indexador]==null?'':row[icol.indexador]).trim() : '',
      });
    }
  }

  const groups = new Map();
  rawRows.forEach(rec=>{
    const key = applicationsFundKey(rec.contaCod, rec.bancoRaw, rec.fundoRaw);
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(rec);
  });

  let asOfDate = '';
  groups.forEach(list=> list.forEach(rec=>{ if(rec.competencia > asOfDate) asOfDate = rec.competencia; }));

  const funds = [];
  groups.forEach((list, key)=>{
    list.sort((a,b)=> a.competencia < b.competencia ? 1 : a.competencia > b.competencia ? -1 : 0);
    const latest = list[0];
    const info = infoByKey.get(key) || {};
    const staleDays = asOfDate ? daysBetweenISO(latest.competencia, asOfDate) : 0;
    funds.push({
      id: key,
      banco: latest.bancoRaw || '\u2014',
      fundo: latest.fundoRaw,
      contaCod: latest.contaCod,
      saldoInicial: latest.saldoInicial, aplicacoes: latest.aplicacoes,
      rendimentos: latest.rendimentos, imposto: latest.imposto, resgate: latest.resgate,
      saldoFinal: latest.saldoFinal,
      rendimentosPct: isNaN(latest.rendimentosPct) ? null : latest.rendimentosPct,
      competencia: latest.competencia,
      cotizacaoResgate: info.cotizacaoResgate || '', garantia: info.garantia || '',
      vinculo: info.vinculo || '', indexador: info.indexador || '',
      stale: staleDays > APPLICATIONS_STALE_DAYS, staleDays,
    });
  });
  funds.sort((a,b)=> b.saldoFinal - a.saldoFinal);

  const totalBalance = funds.reduce((s,f)=>s+f.saldoFinal, 0);
  const byBankMap = new Map();
  funds.forEach(f=> byBankMap.set(f.banco, (byBankMap.get(f.banco)||0) + f.saldoFinal));
  const byBank = [...byBankMap.entries()].map(([banco,total])=>({banco,total})).sort((a,b)=>b.total-a.total);
  const staleCount = funds.filter(f=>f.stale).length;

  return { funds, totalBalance, byBank, asOfDate, staleCount, sourceSheetCons: consName, sourceSheetInfo: infoName || null };
}

/* ==== SESSÃO & CAMADA DE API ==== */
// Este painel não depende mais da Claude — ele fala com o backend que você
// mesmo hospeda no Google Apps Script (veja apps-script/Code.gs e SETUP.md).
const SESSION_KEY = 'plansul_fluxo_caixa_session';
const POLL_MS = 45000; // atualização automática a cada 45s, além de após cada ação

const state = {
  usingDemo: true,
  canEdit: false,       // true quando a sessão logada é do papel "financeiro"
  accounts: [],
  sources: [],           // uma entrada por banco/relatório "fonte" — { id, sourceName, filename, mapping, headerSignature, rowCount, uploadedAt }
  transactions: [],       // lançamentos de todas as fontes, já combinados
  history: [],            // histórico de uploads — { bank, filename, status, rowCount, at, errorMessage? }
  applications: null,     // fotografia mais recente de cada fundo — { funds, totalBalance, byBank, asOfDate, staleCount }
  filters: { search:'', tipo:'', status:'', conta:'' },
  historyBankFilter: '',
  applicationsBankFilter: '',
};

let session = null;      // { token, username, role, nome } depois do login
let pollTimer = null;
let staticEventsWired = false;

function loadStoredSession(){
  try{
    const raw = sessionStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  }catch(e){ return null; }
}
function storeSession(s){
  session = s;
  try{ sessionStorage.setItem(SESSION_KEY, JSON.stringify(s)); }catch(e){ /* não impede o uso do painel */ }
}
function clearSession(){
  session = null;
  try{ sessionStorage.removeItem(SESSION_KEY); }catch(e){ /* non-fatal */ }
}

// Toda chamada ao backend passa por aqui. O Content-Type "text/plain" é
// proposital — evita o preflight de CORS que o Apps Script não sabe
// responder (ver SETUP.md); o corpo continua sendo um JSON de verdade,
// interpretado manualmente do lado do Apps Script.
async function callApi(action, payload){
  if(!APPS_SCRIPT_URL || APPS_SCRIPT_URL.indexOf('COLE_AQUI') === 0){
    const err = new Error('config-missing'); throw err;
  }
  const body = Object.assign({ action, token: session ? session.token : null }, payload||{});
  let res;
  try{
    res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
    });
  }catch(networkErr){
    const err = new Error('network'); throw err;
  }
  if(!res.ok){ const err = new Error('http-'+res.status); throw err; }
  const json = await res.json();
  if(!json.ok){
    const err = new Error(json.error || 'api-error');
    err.code = json.error;
    throw err;
  }
  return json;
}

const Api = {
  async login(username, password){
    const res = await callApi('login', { username, password });
    storeSession({ token: res.token, username: res.username, role: res.role, nome: res.nome });
    return session;
  },
  getData(){ return callApi('getData', {}); },
  saveAccount(account){ return callApi('saveAccount', { account }); },
  deleteAccount(id){ return callApi('deleteAccount', { id }); },
  saveImport(payload){ return callApi('saveImport', payload); },
  deleteSource(sourceId){ return callApi('deleteSource', { sourceId }); },
  logHistory(entry){ return callApi('logHistory', entry); },
  saveApplications(payload){ return callApi('saveApplications', payload); },
};

function guardSession(err){
  if(err && err.code==='session_expired'){ handleSessionExpired(); }
}

function applyEditGating(){
  const show = (id, on)=>{ const el = document.getElementById(id); if(el) el.hidden = !on; };
  state.canEdit = !!(session && session.role === 'financeiro');
  show('btnUpload', state.canEdit);
  show('btnAddAccount', state.canEdit);
  const pill = document.getElementById('readonlyPill');
  if(pill) pill.hidden = state.canEdit;
  const nameEl = document.getElementById('userName');
  if(nameEl) nameEl.textContent = session ? (session.nome || session.username) : '';
  const roleEl = document.getElementById('userRole');
  if(roleEl) roleEl.textContent = state.canEdit ? 'Financeiro' : 'Diretoria · somente leitura';
}

async function loadData(opts){
  const silent = opts && opts.silent;
  try{
    const res = await Api.getData();
    state.accounts = res.accounts || [];
    state.sources = res.sources || [];
    state.transactions = res.transactions || [];
    state.history = res.history || [];
    state.applications = res.applications || null;
    state.usingDemo = state.accounts.length===0 && state.sources.length===0;
    setSync('on', 'Atualizado ' + new Date().toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'}));
    renderAll();
    if(document.getElementById('historyView') && !document.getElementById('historyView').hidden) renderHistory();
    if(document.getElementById('applicationsView') && !document.getElementById('applicationsView').hidden) renderApplications();
  }catch(err){
    console.error('loadData', err);
    guardSession(err);
    if(!silent) setSync('stale', 'Falha ao atualizar — tentando de novo em breve');
  }
}

function startPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = setInterval(()=> loadData({ silent:true }), POLL_MS);
}
function stopPolling(){
  if(pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}

function setSync(kind, label){
  const dot = document.getElementById('syncDot');
  const lbl = document.getElementById('syncLabel');
  if(!dot||!lbl) return;
  dot.className = 'sync-dot' + (kind==='on' ? '' : kind==='stale' ? ' stale' : ' off');
  lbl.textContent = label;
}

function slugifySource(name){
  return normalizeTypeText(name).replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || uid('src');
}

async function saveAccount(acc){
  const id = acc.id || uid('acc');
  const body = {
    id, name: acc.name, kind: acc.kind, balance: Number(acc.balance)||0,
    asOfDate: acc.asOfDate || todayISO(), order: acc.order ?? Date.now(),
  };
  try{
    await Api.saveAccount(body);
    await loadData();
    return id;
  }catch(err){ guardSession(err); throw err; }
}
async function deleteAccount(id){
  try{
    await Api.deleteAccount(id);
    await loadData();
  }catch(err){ guardSession(err); throw err; }
}

// Cada fonte (banco/relatório) grava seus próprios lançamentos separadamente
// no Drive — carregar um novo arquivo de um banco nunca afeta os outros.
async function saveImportForSource({ sourceId, sourceName, filename, sheetName, mapping, headerSignature, rows, fileBase64, fileMime }){
  try{
    await Api.saveImport({ sourceId, sourceName, filename, sheetName, mapping, headerSignature, rows, fileBase64, fileMime });
    await loadData();
  }catch(err){ guardSession(err); throw err; }
}

async function deleteSource(sourceId){
  try{
    await Api.deleteSource(sourceId);
    await loadData();
  }catch(err){ guardSession(err); throw err; }
}

// O relatório de aplicações é uma fotografia única — cada novo envio
// substitui a anterior por completo (ao contrário das fontes bancárias,
// que se somam umas às outras).
async function saveApplicationsData(payload){
  try{
    await Api.saveApplications(payload);
    await loadData();
  }catch(err){ guardSession(err); throw err; }
}

// Log de toda tentativa de upload (sucesso ou falha) — alimenta a aba
// "Histórico de uploads".
async function logUploadHistory({ bank, filename, status, rowCount, errorMessage }){
  try{
    await Api.logHistory({ bank, filename: filename||'', status, rowCount: rowCount||0, errorMessage: errorMessage||'' });
    await loadData({ silent:true });
  }catch(e){ guardSession(e); /* registrar histórico nunca deve travar o upload */ }
}

/* ==== TELA DE LOGIN ==== */
function showLoginScreen(msg, isError){
  stopPolling();
  const overlay = document.getElementById('loginOverlay');
  const app = document.getElementById('app');
  if(overlay) overlay.hidden = false;
  if(app) app.hidden = true;
  const err = document.getElementById('loginError');
  if(err){
    err.textContent = msg || '';
    err.hidden = !msg;
    err.classList.toggle('login-error-info', !isError);
  }
  const passField = document.getElementById('loginPass');
  if(passField) passField.value = '';
}
function hideLoginScreen(){
  const overlay = document.getElementById('loginOverlay');
  const app = document.getElementById('app');
  if(overlay) overlay.hidden = true;
  if(app) app.hidden = false;
}
function handleSessionExpired(){
  clearSession();
  showLoginScreen('Sua sessão expirou. Entre novamente.', true);
}
async function enterApp(){
  hideLoginScreen();
  applyEditGating();
  wireStaticEvents();
  await loadData();
  startPolling();
}
async function doLogin(username, password){
  const btn = document.getElementById('loginSubmit');
  if(btn){ btn.disabled = true; btn.textContent = 'Entrando…'; }
  try{
    await Api.login(username, password);
    await enterApp();
  }catch(err){
    console.error('login', err);
    const msg = (err && err.message==='config-missing')
      ? 'O painel ainda não foi configurado — falta colar a URL do Apps Script no arquivo app.js (veja SETUP.md).'
      : (err && err.message==='network')
        ? 'Não foi possível conectar ao servidor. Verifique sua internet e tente novamente.'
        : (err && err.code==='invalid_credentials')
          ? 'Usuário ou senha incorretos.'
          : (err && err.code==='locked')
            ? 'Muitas tentativas incorretas. Aguarde alguns minutos e tente de novo.'
            : 'Não foi possível entrar. Tente novamente em instantes.';
    showLoginScreen(msg, true);
  }finally{
    if(btn){ btn.disabled = false; btn.textContent = 'Entrar'; }
  }
}
function wireLoginForm(){
  const form = document.getElementById('loginForm');
  if(form) form.addEventListener('submit', (e)=>{
    e.preventDefault();
    const username = document.getElementById('loginUser').value.trim();
    const password = document.getElementById('loginPass').value;
    if(!username || !password) return;
    doLogin(username, password);
  });
  const logoutBtn = document.getElementById('btnLogout');
  if(logoutBtn) logoutBtn.onclick = ()=>{
    clearSession();
    showLoginScreen();
  };
}


/* ==== STATE & COMPUTATION ==== */
let cachedExample = null;
function activeData(){
  if(state.usingDemo){
    if(!cachedExample) cachedExample = generateExampleData();
    return cachedExample;
  }
  return { accounts: state.accounts, transactions: state.transactions, sources: state.sources, history: state.history, applications: state.applications };
}

function getRangeBounds(rangeId, transactions){
  const today = todayISO();
  const preset = RANGE_PRESETS.find(r=>r.id===rangeId) || RANGE_PRESETS[0];
  if(preset.past===null){
    let min = today, max = today;
    transactions.forEach(t=>{ if(t.date<min) min=t.date; if(t.date>max) max=t.date; });
    return { start:min, end:max };
  }
  return { start: addDaysISO(today,-preset.past), end: addDaysISO(today, preset.future) };
}

function computeKPIs(accounts, transactions){
  const today = todayISO();
  const bankBalance = accounts.filter(a=>a.kind==='conta').reduce((s,a)=>s+(Number(a.balance)||0),0);
  const investBalance = accounts.filter(a=>a.kind==='aplicacao').reduce((s,a)=>s+(Number(a.balance)||0),0);
  const totalBalance = bankBalance + investBalance;

  let receivableForecast=0, payableForecast=0, overdueReceivable=0, overduePayable=0;
  let receivedRealizedTotal=0, paidRealizedTotal=0;
  transactions.forEach(t=>{
    if(t.status==='previsto'){
      if(t.type==='recebimento'){
        receivableForecast += t.value;
        if(t.date < today) overdueReceivable += t.value;
      } else {
        payableForecast += t.value;
        if(t.date < today) overduePayable += t.value;
      }
    } else {
      if(t.type==='recebimento') receivedRealizedTotal += t.value;
      else paidRealizedTotal += t.value;
    }
  });
  const projectedBalance = totalBalance + receivableForecast - payableForecast;
  return {
    bankBalance, investBalance, totalBalance,
    receivableForecast, payableForecast, projectedBalance,
    overdueReceivable, overduePayable,
    receivedRealizedTotal, paidRealizedTotal,
  };
}

function computeDailySeries(transactions, startISO, endISO){
  const map = {};
  let d = startISO;
  while(d <= endISO){
    map[d] = { date:d, inRealized:0, inForecast:0, outRealized:0, outForecast:0 };
    d = addDaysISO(d,1);
  }
  transactions.forEach(t=>{
    if(t.date < startISO || t.date > endISO) return;
    const bucket = map[t.date];
    if(!bucket) return;
    if(t.type==='recebimento'){
      if(t.status==='realizado') bucket.inRealized += t.value; else bucket.inForecast += t.value;
    } else {
      if(t.status==='realizado') bucket.outRealized += t.value; else bucket.outForecast += t.value;
    }
  });
  return Object.values(map);
}

function computeCumulativeSeries(transactions, dailySeries, currentTotalBalance){
  const today = todayISO();
  const dates = dailySeries.map(d=>d.date);
  let idxToday = dates.indexOf(today);
  if(idxToday === -1){
    // today outside window: clamp to nearest edge
    idxToday = today < dates[0] ? -1 : dates.length;
  }
  const realizedNet = {};
  const forecastNetToday = {}; // overdue+today previsto folded into 'today'
  transactions.forEach(t=>{
    const net = (t.type==='recebimento'?1:-1) * t.value;
    if(t.status==='realizado'){
      realizedNet[t.date] = (realizedNet[t.date]||0) + net;
    } else if(t.date <= today){
      forecastNetToday[today] = (forecastNetToday[today]||0) + net;
    }
  });
  // future forecast net keyed by its own date
  const forecastNetFuture = {};
  transactions.forEach(t=>{
    if(t.status==='previsto' && t.date > today){
      const net = (t.type==='recebimento'?1:-1) * t.value;
      forecastNetFuture[t.date] = (forecastNetFuture[t.date]||0) + net;
    }
  });

  const balances = new Array(dates.length).fill(0);
  if(idxToday >= 0 && idxToday < dates.length){
    balances[idxToday] = currentTotalBalance + (forecastNetToday[today]||0);
    for(let i=idxToday+1;i<dates.length;i++){
      balances[i] = balances[i-1] + (realizedNet[dates[i]]||0) + (forecastNetFuture[dates[i]]||0);
    }
    for(let i=idxToday-1;i>=0;i--){
      balances[i] = balances[i+1] - (realizedNet[dates[i+1]]||0) - (forecastNetFuture[dates[i+1]]||0);
    }
  } else if(idxToday < 0){
    // whole window is in the future
    let running = currentTotalBalance + (forecastNetToday[today]||0);
    for(let i=0;i<dates.length;i++){
      running += (realizedNet[dates[i]]||0) + (forecastNetFuture[dates[i]]||0);
      balances[i] = running;
    }
  } else {
    // whole window is in the past
    let running = currentTotalBalance + (forecastNetToday[today]||0);
    for(let i=dates.length-1;i>=0;i--){
      balances[i] = running;
      running -= (realizedNet[dates[i]]||0);
    }
  }
  return dates.map((d,i)=>({ date:d, balance: balances[i] }));
}

function computeCategoryBreakdown(transactions, startISO, endISO, limit){
  const totals = {};
  transactions.forEach(t=>{
    if(t.date < startISO || t.date > endISO) return;
    const key = t.category || 'Sem categoria';
    totals[key] = (totals[key]||0) + t.value;
  });
  const arr = Object.entries(totals).map(([name,value])=>({name,value})).sort((a,b)=>b.value-a.value);
  return arr.slice(0, limit||6);
}

function filteredTransactions(transactions){
  const f = state.filters;
  const q = f.search.trim().toLowerCase();
  return transactions.filter(t=>{
    if(f.tipo && t.type!==f.tipo) return false;
    if(f.status && t.status!==f.status) return false;
    if(f.conta && t.account!==f.conta) return false;
    if(q){
      const hay = `${t.description||''} ${t.account||''} ${t.category||''}`.toLowerCase();
      if(!hay.includes(q)) return false;
    }
    return true;
  }).sort((a,b)=> a.date<b.date?1:a.date>b.date?-1:0);
}

/* ==== RENDER: KPIS ==== */
function renderKPIs(k){
  const projNeg = k.projectedBalance < 0;
  const recvBadge = k.overdueReceivable>0 ? {cls:'warn', text:'Atenção'} : null;
  const payBadge = k.overduePayable>0 ? {cls:'crit', text:'Atraso'} : null;
  const tiles = [
    { label:'Saldo bancário', value: formatBRL(k.bankBalance), sub: 'Contas correntes' },
    { label:'Recebimentos', value: formatBRL(k.receivedRealizedTotal), sub: 'Recebido (realizado)', cls:'pos',
      subline: { label:'A receber', value: formatBRL(k.receivableForecast), badge: recvBadge } },
    { label:'Pagamentos realizados', value: formatBRL(k.paidRealizedTotal), sub: 'Pago (realizado)', cls:'neg',
      subline: { label:'A pagar', value: formatBRL(k.payableForecast), badge: payBadge } },
    { label:'Saldo projetado', value: formatBRL(k.projectedBalance), sub: 'Saldo atual + previsto', cls: projNeg?'neg':'pos',
      badge: projNeg ? {cls:'crit', text:'Negativo'} : null },
    { label:'Aplicações', value: formatBRL(k.investBalance), sub: 'Investimentos e reservas' },
    { label:'Saldo total disponível', value: formatBRL(k.totalBalance), sub: 'Bancos + aplicações', strong:true },
  ];
  document.getElementById('kpiRow').innerHTML = tiles.map(t=>`
    <div class="kpi-tile">
      <div class="kpi-label"><span>${escapeHtml(t.label)}</span>${t.badge?`<span class="kpi-badge ${t.badge.cls}">${t.badge.text}</span>`:''}</div>
      <div class="kpi-value num ${t.cls||''}">${t.value}</div>
      <div class="kpi-sub">${escapeHtml(t.sub)}</div>
      ${t.subline ? `<div class="kpi-subline">
        <div class="kpi-subline-top"><span>${escapeHtml(t.subline.label)}</span>${t.subline.badge?`<span class="kpi-badge ${t.subline.badge.cls}">${t.subline.badge.text}</span>`:''}</div>
        <b class="num">${t.subline.value}</b>
      </div>` : ''}
    </div>`).join('');
}

/* ==== RENDER: CHARTS ==== */
function niceCeil(v){
  if(v<=0) return 100;
  const exp = Math.floor(Math.log10(v));
  const base = Math.pow(10, exp);
  const norm = v/base;
  let n;
  if(norm<=1) n=1; else if(norm<=2) n=2; else if(norm<=2.5) n=2.5; else if(norm<=5) n=5; else n=10;
  return n*base;
}
function svgEl(tag, attrs){
  let s = `<${tag}`;
  for(const k in attrs){ if(attrs[k]!==undefined && attrs[k]!==null) s += ` ${k}="${attrs[k]}"`; }
  return s+'/>';
}

function renderDailyLegend(){
  document.getElementById('dailyLegend').innerHTML = `
    <div class="legend-item"><span class="legend-swatch" style="background:var(--in)"></span>Recebido realizado</div>
    <div class="legend-item"><span class="legend-swatch hatched" style="color:var(--in)"></span>Recebido previsto</div>
    <div class="legend-item"><span class="legend-swatch" style="background:var(--out)"></span>Pago realizado</div>
    <div class="legend-item"><span class="legend-swatch hatched" style="color:var(--out)"></span>Pago previsto</div>
  `;
}

let dailySeriesCache = [];
function drawDailyChart(series){
  dailySeriesCache = series;
  const W=960, H=260, mL=54, mR=12, mT=14, mB=28;
  const plotW=W-mL-mR, plotH=H-mT-mB;
  const baselineY = mT + plotH/2;
  const maxIn = Math.max(1, ...series.map(d=>d.inRealized+d.inForecast));
  const maxOut = Math.max(1, ...series.map(d=>d.outRealized+d.outForecast));
  const maxVal = niceCeil(Math.max(maxIn,maxOut));
  const scale = (plotH/2 - 6) / maxVal;
  const n = series.length;
  const slot = plotW/n;
  const barW = clamp(slot*0.64, 1, 22);
  const today = todayISO();

  let grid = '';
  [0,0.5,1].forEach(f=>{
    const yUp = baselineY - f*maxVal*scale;
    const yDn = baselineY + f*maxVal*scale;
    grid += svgEl('line',{x1:mL,x2:W-mR,y1:yUp,y2:yUp,stroke:'var(--line-soft)','stroke-width':1});
    if(f>0) grid += svgEl('line',{x1:mL,x2:W-mR,y1:yDn,y2:yDn,stroke:'var(--line-soft)','stroke-width':1});
    grid += `<text x="${mL-8}" y="${yUp+3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)" font-family="IBM Plex Mono, monospace">${formatCompactBRL(f*maxVal)}</text>`;
    if(f>0) grid += `<text x="${mL-8}" y="${yDn+3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)" font-family="IBM Plex Mono, monospace">-${formatCompactBRL(f*maxVal).replace('-','')}</text>`;
  });
  grid += svgEl('line',{x1:mL,x2:W-mR,y1:baselineY,y2:baselineY,stroke:'var(--baseline, var(--line))','stroke-width':1.2});

  let todayLine = '';
  const todayIdx = series.findIndex(d=>d.date===today);
  if(todayIdx>=0){
    const tx = mL + slot*todayIdx + slot/2;
    todayLine = svgEl('line',{x1:tx,x2:tx,y1:mT,y2:H-mB,stroke:'var(--ink-muted)','stroke-width':1,'stroke-dasharray':'2,3'})
      + `<text x="${tx}" y="${mT-3}" text-anchor="middle" font-size="9.5" fill="var(--ink-muted)">hoje</text>`;
  }

  let bars = '';
  const gap = 2;
  series.forEach((d,i)=>{
    const cx = mL + slot*i + slot/2;
    const x = cx - barW/2;
    // up: realized then forecast stacked outward
    let y = baselineY;
    if(d.inRealized>0){
      const h = d.inRealized*scale;
      bars += rectSeg(x,y-h,barW,h,'var(--in)', h>6);
      y -= h+gap;
    }
    if(d.inForecast>0){
      const h = d.inForecast*scale;
      bars += rectSeg(x,y-h,barW,h,'var(--in)', h>6, true);
      y -= h+gap;
    }
    // down
    y = baselineY;
    if(d.outRealized>0){
      const h = d.outRealized*scale;
      bars += rectSeg(x,y,barW,h,'var(--out)', h>6);
      y += h+gap;
    }
    if(d.outForecast>0){
      const h = d.outForecast*scale;
      bars += rectSeg(x,y,barW,h,'var(--out)', h>6, true);
      y += h+gap;
    }
  });

  let xLabels = '';
  const step = Math.max(1, Math.ceil(n/11));
  series.forEach((d,i)=>{
    if(i%step!==0 && i!==n-1) return;
    const cx = mL + slot*i + slot/2;
    xLabels += `<text x="${cx}" y="${H-mB+16}" text-anchor="middle" font-size="9.5" fill="var(--ink-muted)">${formatDateShort(d.date)}</text>`;
  });

  const svg = document.getElementById('dailyChart');
  svg.innerHTML = grid + todayLine + bars + xLabels;

  attachDailyHover(series, {W,H,mL,mR,mT,mB,slot,n});
}
function rectSeg(x,y,w,h,color,rounded,forecast){
  const r = rounded ? Math.min(4,w/2,h/2) : 0;
  const fill = forecast ? `fill:${color};opacity:0.42` : `fill:${color}`;
  const dash = forecast ? ` stroke="${color}" stroke-width="1" stroke-dasharray="2,2" stroke-opacity="0.9"` : '';
  return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" ry="${r}" style="${fill}"${dash}></rect>`;
}

function attachDailyHover(series, geo){
  const wrap = document.getElementById('dailyChartWrap');
  const tooltip = document.getElementById('dailyTooltip');
  const svg = document.getElementById('dailyChart');
  function onMove(e){
    const rect = svg.getBoundingClientRect();
    const relX = (e.clientX-rect.left)/rect.width * geo.W;
    let idx = Math.floor((relX-geo.mL)/geo.slot);
    idx = clamp(idx,0,series.length-1);
    const d = series[idx];
    if(!d) return;
    const totalIn = d.inRealized+d.inForecast, totalOut = d.outRealized+d.outForecast;
    tooltip.innerHTML = `<div class="tt-title">${formatDateBR(d.date)}</div>
      <div class="tt-row"><span>Recebido realizado</span><b>${formatBRL(d.inRealized,true)}</b></div>
      <div class="tt-row"><span>Recebido previsto</span><b>${formatBRL(d.inForecast,true)}</b></div>
      <div class="tt-row"><span>Pago realizado</span><b>${formatBRL(d.outRealized,true)}</b></div>
      <div class="tt-row"><span>Pago previsto</span><b>${formatBRL(d.outForecast,true)}</b></div>
      <div class="tt-row" style="border-top:1px solid var(--line-soft);margin-top:4px;padding-top:4px;"><span>Líquido do dia</span><b>${formatBRL(totalIn-totalOut,true)}</b></div>`;
    const wrapRect = wrap.getBoundingClientRect();
    let left = e.clientX-wrapRect.left+14, top = e.clientY-wrapRect.top-10;
    left = clamp(left, 4, wrapRect.width-190);
    tooltip.style.left = left+'px';
    tooltip.style.top = top+'px';
    tooltip.classList.add('show');
  }
  wrap.onmousemove = onMove;
  wrap.onmouseleave = ()=> tooltip.classList.remove('show');
}

function drawCumulativeChart(series){
  const W=960, H=200, mL=54, mR=12, mT=14, mB=24;
  const plotW=W-mL-mR, plotH=H-mT-mB;
  const vals = series.map(d=>d.balance);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const span = niceCeil(Math.max(Math.abs(lo),Math.abs(hi), 1));
  lo = -span*0.05; // small negative headroom if all positive
  if(Math.min(...vals) < 0) lo = -span;
  hi = span;
  const range = hi-lo || 1;
  const x = i => mL + (plotW * i/(series.length-1||1));
  const y = v => mT + plotH * (1 - (v-lo)/range);
  const today = todayISO();
  const zeroY = y(0);

  let grid = svgEl('line',{x1:mL,x2:W-mR,y1:zeroY,y2:zeroY,stroke:'var(--line)','stroke-width':1});
  [hi, lo].forEach(v=>{
    const yy=y(v);
    grid += `<text x="${mL-8}" y="${yy+3}" text-anchor="end" font-size="9.5" fill="var(--ink-muted)" font-family="IBM Plex Mono, monospace">${formatCompactBRL(v)}</text>`;
  });

  const todayIdx = series.findIndex(d=>d.date===today);
  let todayLine = '';
  if(todayIdx>=0){
    const tx = x(todayIdx);
    todayLine = svgEl('line',{x1:tx,x2:tx,y1:mT,y2:H-mB,stroke:'var(--ink-muted)','stroke-width':1,'stroke-dasharray':'2,3'});
  }

  let segs = '';
  let areaPts = `M ${x(0)} ${zeroY} `;
  for(let i=0;i<series.length;i++) areaPts += `L ${x(i)} ${y(series[i].balance)} `;
  areaPts += `L ${x(series.length-1)} ${zeroY} Z`;
  segs += `<path d="${areaPts}" fill="var(--accent)" opacity="0.07" stroke="none"></path>`;

  for(let i=0;i<series.length-1;i++){
    const a=series[i], b=series[i+1];
    const neg = a.balance<0 || b.balance<0;
    const forecast = a.date>today;
    const stroke = neg ? 'var(--critical)' : 'var(--accent)';
    segs += svgEl('line',{x1:x(i),y1:y(a.balance),x2:x(i+1),y2:y(b.balance),stroke,'stroke-width':2,'stroke-linecap':'round','stroke-dasharray': forecast?'4,3':'none'});
  }
  if(todayIdx>=0){
    segs += svgEl('circle',{cx:x(todayIdx),cy:y(series[todayIdx].balance),r:3.5,fill:'var(--card)',stroke:'var(--accent)','stroke-width':2});
  }

  let xLabels = '';
  const step = Math.max(1, Math.ceil(series.length/11));
  series.forEach((d,i)=>{
    if(i%step!==0 && i!==series.length-1) return;
    xLabels += `<text x="${x(i)}" y="${H-mB+16}" text-anchor="middle" font-size="9.5" fill="var(--ink-muted)">${formatDateShort(d.date)}</text>`;
  });

  document.getElementById('cumChart').innerHTML = grid+todayLine+segs+xLabels;
  attachCumHover(series, {W,H,mL,mR,mT,mB,x,y});
}
function attachCumHover(series, geo){
  const wrap = document.getElementById('cumChartWrap');
  const tooltip = document.getElementById('cumTooltip');
  const svg = document.getElementById('cumChart');
  function onMove(e){
    const rect = svg.getBoundingClientRect();
    const relX = (e.clientX-rect.left)/rect.width * geo.W;
    let idx = Math.round((relX-geo.mL)/((geo.W-geo.mL-geo.mR)/(series.length-1||1)));
    idx = clamp(idx,0,series.length-1);
    const d = series[idx];
    if(!d) return;
    const neg = d.balance<0;
    tooltip.innerHTML = `<div class="tt-title">${formatDateBR(d.date)}</div>
      <div class="tt-row"><span>Saldo projetado</span><b style="color:${neg?'var(--critical)':'var(--ink)'}">${formatBRL(d.balance,true)}</b></div>`;
    const wrapRect = wrap.getBoundingClientRect();
    let left = e.clientX-wrapRect.left+14, top = e.clientY-wrapRect.top-10;
    left = clamp(left, 4, wrapRect.width-170);
    tooltip.style.left = left+'px';
    tooltip.style.top = top+'px';
    tooltip.classList.add('show');
  }
  wrap.onmousemove = onMove;
  wrap.onmouseleave = ()=> tooltip.classList.remove('show');
}

/* ==== RENDER: ACCOUNTS & CATEGORIES ==== */
function renderAccounts(accounts, kpis){
  const kindLabel = { conta:'Conta corrente', aplicacao:'Aplicação' };
  const sorted = [...accounts].sort((a,b)=>(a.order??0)-(b.order??0));
  const editable = !state.usingDemo && state.canEdit;
  document.getElementById('accountList').innerHTML = sorted.length ? sorted.map(a=>`
    <div class="account-row">
      <div>
        <div class="account-name">${escapeHtml(a.name)}</div>
        <div class="account-kind">${kindLabel[a.kind]||a.kind} &middot; ${formatDateBR(a.asOfDate)}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;">
        <div class="account-bal num">${formatBRL(a.balance)}</div>
        ${editable ? `<div class="account-actions">
          <button class="icon-btn" data-edit-acc="${a.id}" title="Editar">&#9998;</button>
        </div>` : ''}
      </div>
    </div>`).join('') : `<div class="empty-state">Nenhuma conta cadastrada.</div>`;
  document.getElementById('accountTotal').innerHTML = `<span>Total</span><span class="num">${formatBRL(kpis.totalBalance)}</span>`;

  document.querySelectorAll('[data-edit-acc]').forEach(btn=>{
    btn.onclick = ()=> openAccountModal(accounts.find(a=>a.id===btn.dataset.editAcc));
  });
}

function renderSources(sources){
  const list = document.getElementById('sourceList');
  if(!list) return;
  const editable = !state.usingDemo && state.canEdit;
  const sorted = [...sources].sort((a,b)=> (a.sourceName||'').localeCompare(b.sourceName||''));
  list.innerHTML = sorted.length ? sorted.map(s=>`
    <div class="account-row">
      <div>
        <div class="account-name">${escapeHtml(s.sourceName||s.id)}</div>
        <div class="account-kind">${s.rowCount||0} lançamento${s.rowCount===1?'':'s'} &middot; atualizado ${formatDateBR((s.uploadedAt||'').slice(0,10))}</div>
      </div>
      ${editable ? `<div class="account-actions">
        <button class="icon-btn" data-del-src="${s.id}" title="Remover">&#10005;</button>
      </div>` : ''}
    </div>`).join('') : `<div class="empty-state">Nenhum relatório carregado ainda.</div>`;

  list.querySelectorAll('[data-del-src]').forEach(btn=>{
    btn.onclick = async ()=>{
      if(btn.dataset.confirm!=='1'){ btn.dataset.confirm='1'; btn.title='Clique novamente para confirmar'; btn.innerHTML='&#10005;&#10005;'; return; }
      try{ await deleteSource(btn.dataset.delSrc); showToast('Fonte removida.'); }
      catch(err){ console.error(err); showToast('Não foi possível remover esta fonte.', true); }
    };
  });
}

function renderCategories(transactions, startISO, endISO){
  const cats = computeCategoryBreakdown(transactions, startISO, endISO, 6);
  const max = Math.max(1, ...cats.map(c=>c.value));
  document.getElementById('categoryList').innerHTML = cats.length ? cats.map(c=>`
    <div class="category-row">
      <div class="category-top"><span class="category-name">${escapeHtml(c.name)}</span><span class="category-val num">${formatCompactBRL(c.value)}</span></div>
      <div class="category-bar"><div class="category-bar-fill" style="width:${(c.value/max*100).toFixed(1)}%;background:var(--accent)"></div></div>
    </div>`).join('') : `<div class="empty-state">Sem lançamentos no período.</div>`;
}

/* ==== RENDER: TABLE & FILTERS ==== */
function renderRangeControl(){
  document.getElementById('rangeControl').innerHTML = RANGE_PRESETS.map(r=>
    `<button class="range-btn ${r.id===currentRangeId?'active':''}" data-range="${r.id}">${r.label}</button>`
  ).join('');
  document.querySelectorAll('[data-range]').forEach(btn=>{
    btn.onclick = ()=>{ currentRangeId = btn.dataset.range; renderAll(); };
  });
}

function renderAccountFilterOptions(accounts, transactions){
  const sel = document.getElementById('fConta');
  const names = new Set(accounts.map(a=>a.name));
  transactions.forEach(t=> t.account && names.add(t.account));
  const current = state.filters.conta;
  sel.innerHTML = `<option value="">Todas as contas</option>` + [...names].sort().map(n=>
    `<option value="${escapeHtml(n)}" ${n===current?'selected':''}>${escapeHtml(n)}</option>`).join('');
}

function renderTable(transactions){
  const rows = filteredTransactions(transactions);
  const body = document.getElementById('txTableBody');
  const shown = rows.slice(0, 300);
  body.innerHTML = shown.length ? shown.map(t=>`
    <tr>
      <td class="num">${formatDateBR(t.date)}</td>
      <td>${escapeHtml(t.description||'—')}</td>
      <td>${escapeHtml(t.category||'—')}</td>
      <td>${escapeHtml(t.account||'—')}</td>
      <td><span class="pill ${t.status==='realizado'?'pill-realizado':'pill-previsto'}">${STATUS_LABEL[t.status]||t.status}</span></td>
      <td class="num-col num" style="color:${t.type==='recebimento'?'var(--in-text)':'var(--out)'}">${t.type==='recebimento'?'+':'-'}${formatBRL(t.value,true)}</td>
    </tr>`).join('') : `<tr><td colspan="6"><div class="empty-state">Nenhum lançamento encontrado com os filtros atuais.</div></td></tr>`;
  const foot = document.getElementById('tableFooter');
  foot.textContent = rows.length > shown.length
    ? `Mostrando ${shown.length} de ${rows.length} lançamentos — refine os filtros para ver mais detalhes.`
    : `${rows.length} lançamento${rows.length===1?'':'s'}`;
}

function csvEscape(v){
  const s = String(v==null?'':v);
  return /[",\n;]/.test(s) ? '"'+s.replace(/"/g,'""')+'"' : s;
}
async function exportCsv(){
  const { transactions } = activeData();
  const rows = filteredTransactions(transactions);
  if(!rows.length){ showToast('Não há lançamentos para exportar.', true); return; }
  const header = ['Data','Descricao','Categoria','Conta','Tipo','Status','Valor'];
  const lines = [header.join(';')];
  rows.forEach(t=>{
    lines.push([formatDateBR(t.date), t.description||'', t.category||'', t.account||'', TYPE_LABEL[t.type]||t.type, STATUS_LABEL[t.status]||t.status, String(t.value).replace('.',',')].map(csvEscape).join(';'));
  });
  const csv = '﻿' + lines.join('\r\n');
  try{
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `fluxo-caixa-plansul-${todayISO()}.csv`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast('CSV exportado.');
  }catch(e){
    console.error('exportCsv', e);
    showToast('Não foi possível exportar o CSV.', true);
  }
}

/* ==== VIEWS (Painel / Histórico) ==== */
function switchView(view){
  const dash = document.getElementById('dashboardView');
  const hist = document.getElementById('historyView');
  const apps = document.getElementById('applicationsView');
  if(dash) dash.hidden = view!=='dashboard';
  if(hist) hist.hidden = view!=='history';
  if(apps) apps.hidden = view!=='applications';
  document.querySelectorAll('#viewTabs [data-view]').forEach(b=> b.classList.toggle('active', b.dataset.view===view));
  if(view==='history') renderHistory();
  if(view==='applications') renderApplications();
}

function renderHistoryBankFilterOptions(history){
  const sel = document.getElementById('histBankFilter');
  const banks = [...new Set(history.map(h=>h.bank))].sort();
  const current = state.historyBankFilter;
  sel.innerHTML = `<option value="">Todos os bancos</option>` + banks.map(b=>
    `<option value="${escapeHtml(b)}" ${b===current?'selected':''}>${escapeHtml(b)}</option>`).join('');
}

function renderHistory(){
  const { history } = activeData();
  renderHistoryBankFilterOptions(history);
  const filtered = state.historyBankFilter ? history.filter(h=>h.bank===state.historyBankFilter) : history;
  const body = document.getElementById('historyTableBody');
  body.innerHTML = filtered.length ? filtered.map(h=>{
    const ok = h.status==='concluido';
    return `<tr>
      <td>${escapeHtml(h.bank)}</td>
      <td>${escapeHtml(h.filename||'—')}</td>
      <td class="num">${h.at ? formatDateBR(h.at.slice(0,10)) + ' ' + h.at.slice(11,16) : '—'}</td>
      <td><span class="pill ${ok?'pill-realizado':'pill-previsto'}" style="${ok?'':'background:var(--out-soft);color:var(--out);border:none;'}">${ok?'Concluído':'Erro'}</span>${!ok && h.errorMessage ? `<div class="field-hint" style="margin-top:3px;">${escapeHtml(h.errorMessage)}</div>` : ''}</td>
      <td class="num-col num">${ok ? h.rowCount : '—'}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="5"><div class="empty-state">Nenhum envio registrado ainda.</div></td></tr>`;
  document.getElementById('historyFooter').textContent = `${filtered.length} envio${filtered.length===1?'':'s'} registrado${filtered.length===1?'':'s'}`;
}

/* ==== VIEW: APLICAÇÕES ==== */
function renderApplicationsBankFilterOptions(funds){
  const sel = document.getElementById('appsBankFilter');
  if(!sel) return;
  const banks = [...new Set(funds.map(f=>f.banco))].sort();
  const current = state.applicationsBankFilter;
  sel.innerHTML = `<option value="">Todos os bancos</option>` + banks.map(b=>
    `<option value="${escapeHtml(b)}" ${b===current?'selected':''}>${escapeHtml(b)}</option>`).join('');
}

function renderApplications(){
  const { applications } = activeData();
  const kpiRow = document.getElementById('appsKpiRow');
  const byBankList = document.getElementById('appsByBankList');
  const staleBanner = document.getElementById('appsStaleBanner');
  const body = document.getElementById('appsTableBody');
  const footer = document.getElementById('appsFooter');
  if(!kpiRow || !body) return;

  if(!applications || !applications.funds || !applications.funds.length){
    kpiRow.innerHTML = '';
    if(byBankList) byBankList.innerHTML = `<div class="empty-state">Nenhum dado carregado ainda.</div>`;
    if(staleBanner) staleBanner.innerHTML = '';
    body.innerHTML = `<tr><td colspan="14"><div class="empty-state">Nenhum relatório de aplicações carregado ainda${state.canEdit ? ' — use "Carregar relatório" e selecione "Análise Aplicações".' : '.'}</div></td></tr>`;
    if(footer) footer.textContent = '';
    return;
  }

  const tiles = [
    { label:'Saldo total em aplicações', value: formatBRL(applications.totalBalance), sub: `${applications.funds.length} fundo${applications.funds.length===1?'':'s'}` },
    { label:'Dados até', value: formatDateBR(applications.asOfDate), sub: 'Competência mais recente encontrada' },
    { label:'Desatualizados', value: String(applications.staleCount||0), sub: `Sem atualização há mais de ${APPLICATIONS_STALE_DAYS} dias`, cls: applications.staleCount>0?'neg':'' },
  ];
  kpiRow.className = 'kpi-row';
  kpiRow.style.gridTemplateColumns = 'repeat(3,1fr)';
  kpiRow.innerHTML = tiles.map(t=>`
    <div class="kpi-tile">
      <div class="kpi-label"><span>${escapeHtml(t.label)}</span></div>
      <div class="kpi-value num ${t.cls||''}">${escapeHtml(t.value)}</div>
      <div class="kpi-sub">${escapeHtml(t.sub)}</div>
    </div>`).join('');

  if(staleBanner){
    staleBanner.innerHTML = applications.staleCount>0
      ? `<div class="demo-banner"><span>&#9888;</span><span><b>${applications.staleCount} fundo(s)</b> sem atualização há mais de ${APPLICATIONS_STALE_DAYS} dias — exibidos com o aviso "desatualizado" abaixo. Confirme se ainda estão ativos antes de considerar o saldo.</span></div>`
      : '';
  }

  if(byBankList){
    byBankList.innerHTML = applications.byBank.map(b=>`
      <div class="account-row">
        <div><div class="account-name">${escapeHtml(b.banco)}</div></div>
        <div class="account-bal num">${formatBRL(b.total)}</div>
      </div>`).join('') || `<div class="empty-state">Sem dados.</div>`;
  }

  renderApplicationsBankFilterOptions(applications.funds);
  const filtered = state.applicationsBankFilter
    ? applications.funds.filter(f=>f.banco===state.applicationsBankFilter)
    : applications.funds;

  body.innerHTML = filtered.length ? filtered.map(f=>`
    <tr>
      <td>${escapeHtml(f.banco)}</td>
      <td>${escapeHtml(f.fundo)}</td>
      <td>${escapeHtml(f.contaCod||'—')}</td>
      <td class="num">${formatDateBR(f.competencia)}${f.stale?` <span class="kpi-badge warn" title="Sem atualização há ${f.staleDays} dias">desatualizado</span>`:''}</td>
      <td class="num-col num">${formatBRL(f.saldoInicial,true)}</td>
      <td class="num-col num">${formatBRL(f.aplicacoes,true)}</td>
      <td class="num-col num" style="color:var(--in-text)">${formatBRL(f.rendimentos,true)}</td>
      <td class="num-col num">${formatBRL(f.imposto,true)}</td>
      <td class="num-col num">${formatBRL(f.resgate,true)}</td>
      <td class="num-col num" style="font-weight:600;">${formatBRL(f.saldoFinal,true)}</td>
      <td class="num-col num">${f.rendimentosPct==null ? '—' : f.rendimentosPct.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%'}</td>
      <td>${escapeHtml(f.vinculo||'—')}</td>
      <td>${escapeHtml(f.garantia||'—')}</td>
      <td>${escapeHtml(f.indexador||'—')}</td>
    </tr>`).join('') : `<tr><td colspan="14"><div class="empty-state">Nenhum fundo encontrado com o filtro atual.</div></td></tr>`;

  if(footer) footer.textContent = `${filtered.length} fundo${filtered.length===1?'':'s'}`;
}

/* ==== UPLOAD WIZARD ==== */
let wz = null;
function freshWizardState(){
  return {
    step: 0,
    sourceName: '', sourceId: null, headerSignature: null,
    file: null, workbook: null, sheetNames: [], sheetName: null,
    matrix: null, headerRowIdx: 0,
    valueMode: 'signed',
    mapping: {
      dateCol:null, valueCol:null, inValueCol:null, outValueCol:null,
      typeCol:null, typeValueMap:{},
      statusMode:'inferDate', statusCol:null, statusValueMap:{},
      accountCol:null, categoryCol:null, descCol:null, fixedAccount:'',
    },
    parsedRows: [], parseErrorCount: 0,
    appliedSavedMapping: false,
    appsResult: null, appsError: null,
  };
}
function isApplicationsSource(){ return !!wz && wz.sourceName === APPLICATIONS_SOURCE; }
function distinctColumnValues(matrix, headerRowIdx, colIdx, limit){
  if(colIdx===null||colIdx===undefined) return [];
  const map = new Map();
  for(let r=headerRowIdx+1;r<matrix.length;r++){
    const v = matrix[r] ? matrix[r][colIdx] : null;
    if(v===null||v===undefined||v==='') continue;
    const key = String(v).trim();
    map.set(key, (map.get(key)||0)+1);
  }
  return [...map.entries()].sort((a,b)=>b[1]-a[1]).slice(0, limit||24).map(([value,count])=>({value,count}));
}
function guessFlow(value){
  const s = normalizeTypeText(value);
  if(/receit|recebiv|entrada|credito|venda/.test(s)) return 'recebimento';
  if(/despes|pagave|saida|debito|custo/.test(s)) return 'pagamento';
  return 'ignore';
}
function guessStatus(value){
  const s = normalizeTypeText(value);
  if(/pago|liquidad|realizad|efetivad|conciliad|baixad|quitad|confirmad/.test(s)) return 'realizado';
  if(/previst|pendente|abert|agendad|a pagar|a receber|futur|aguard/.test(s)) return 'previsto';
  return 'ignore';
}
function guessMappingFromHeaders(colOptions){
  const find = (re)=>{ const f = colOptions.find(o=>re.test(normalizeTypeText(o.label))); return f?f.index:null; };
  return {
    dateCol: find(/data|dt\b|vencimento|emissao/),
    valueCol: find(/valor|montante|quantia/),
    inValueCol: find(/entrada|receb|credito/),
    outValueCol: find(/saida|pagamento|debito/),
    typeCol: find(/\btipo|natureza|movimento/),
    statusCol: find(/status|situacao|condicao/),
    accountCol: find(/conta|banco/),
    categoryCol: find(/categoria|centro de custo|classificacao/),
    descCol: find(/descri|historico|observ/),
  };
}

function openUploadModal(){
  wz = freshWizardState();
  document.getElementById('uploadModal').hidden = false;
  renderWizardStep();
}
function closeUploadModal(){ document.getElementById('uploadModal').hidden = true; }

function updateWizardChrome(){
  const apps = isApplicationsSource();
  document.querySelectorAll('.step-dot').forEach((el,i)=>{
    if(apps){
      el.style.display = (i===0 || i===3) ? '' : 'none';
      el.classList.toggle('active', i===wz.step);
      el.classList.toggle('done', i===0 && wz.step===3);
    } else {
      el.style.display = '';
      el.classList.toggle('active', i===wz.step);
      el.classList.toggle('done', i<wz.step);
    }
  });
  const titles = apps
    ? ['Carregar relatório', '', '', 'Prévia e confirmação']
    : ['Carregar relatório','Formato dos valores','Mapear colunas','Prévia e confirmação'];
  const subs = apps
    ? ['Envie a planilha "Analise Aplicações" (abas CONSOLIDADO e Informações Fundos).', '', '', 'Confira o saldo mais recente de cada fundo antes de salvar.']
    : [
      'Envie a planilha de fluxo de caixa exportada do seu sistema.',
      'Como as entradas e saídas aparecem na sua planilha?',
      'Diga ao painel onde encontrar cada informação.',
      'Confira os lançamentos antes de salvar.',
    ];
  document.getElementById('wizardTitle').textContent = titles[wz.step];
  document.getElementById('wizardSubtitle').textContent = subs[wz.step];
  document.getElementById('wizardBack').hidden = wz.step===0;
  document.getElementById('wizardNext').textContent = wz.step===3 ? 'Salvar dados' : 'Avançar';
}

function renderWizardStep(){
  updateWizardChrome();
  const body = document.getElementById('wizardBody');
  const nextBtn = document.getElementById('wizardNext');
  if(wz.step===0) return renderStep0(body, nextBtn);
  if(isApplicationsSource() && wz.step===3) return renderApplicationsPreview(body, nextBtn);
  if(wz.step===1) return renderStep1(body, nextBtn);
  if(wz.step===2) return renderStep2(body, nextBtn);
  if(wz.step===3) return renderStep3(body, nextBtn);
}

function renderStep0(body, nextBtn){
  const isKnownBank = wz.sourceName && BANKS.includes(wz.sourceName);
  const isApps = wz.sourceName === APPLICATIONS_SOURCE;
  const isOther = wz.sourceName && !isKnownBank && !isApps;
  body.innerHTML = `
    <div class="field">
      <label for="bankSelect">Banco deste relatório</label>
      <select id="bankSelect">
        <option value="" ${!wz.sourceName ? 'selected' : ''}>— selecione —</option>
        <optgroup label="Bancos">
          ${BANKS.map(b=>`<option value="${escapeHtml(b)}" ${wz.sourceName===b?'selected':''}>${escapeHtml(b)}</option>`).join('')}
          <option value="${OTHER_BANK}" ${isOther?'selected':''}>Outro banco/sistema…</option>
        </optgroup>
        <optgroup label="Relatórios especiais">
          <option value="${escapeHtml(APPLICATIONS_SOURCE)}" ${isApps?'selected':''}>${escapeHtml(APPLICATIONS_SOURCE)} (fundos)</option>
        </optgroup>
      </select>
      <div class="field-hint">${isApps
        ? 'Envie a planilha "Analise Aplicações", com as abas "CONSOLIDADO" e "Informações Fundos" — o painel identifica sozinho o saldo mais recente de cada fundo.'
        : 'O layout do relatório muda conforme o banco — por isso cada um guarda seu próprio mapeamento de colunas, lembrado automaticamente da próxima vez que você enviar um arquivo dele.'}</div>
    </div>
    <div class="field" id="otherBankField" ${isOther ? '' : 'hidden'}>
      <label for="otherBankInput">Nome do banco/sistema</label>
      <input type="text" id="otherBankInput" placeholder="Ex.: Banco Inter, ERP consolidado" value="${isOther ? escapeHtml(wz.sourceName) : ''}">
    </div>
    <div class="dropzone" id="dropzone">
      ${wz.file ? `<b>${escapeHtml(wz.file.name)}</b><br><span class="field-hint">Clique para escolher outro arquivo</span>` : `Clique para escolher um arquivo .xlsx / .xls / .csv<br><span class="field-hint">ou arraste e solte aqui</span>`}
    </div>
    <input type="file" id="fileInput" accept=".xlsx,.xls,.csv" style="display:none">
    <div id="sheetArea"></div>
  `;
  document.getElementById('bankSelect').onchange = (e)=>{
    if(e.target.value===OTHER_BANK){
      wz.sourceName = '';
      document.getElementById('otherBankField').hidden = false;
      document.getElementById('otherBankInput').focus();
    } else {
      wz.sourceName = e.target.value;
      document.getElementById('otherBankField').hidden = true;
    }
    wz.appsResult = null; wz.appsError = null;
    const area = document.getElementById('sheetArea');
    if(area) area.innerHTML = '';
    updateNextEnabled();
  };
  const otherInput = document.getElementById('otherBankInput');
  if(otherInput) otherInput.oninput = (e)=>{ wz.sourceName = e.target.value; updateNextEnabled(); };
  const dz = document.getElementById('dropzone');
  const input = document.getElementById('fileInput');
  dz.onclick = ()=> input.click();
  ['dragover','dragleave','drop'].forEach(evt=>{
    dz.addEventListener(evt, e=>{
      e.preventDefault();
      dz.classList.toggle('drag', evt==='dragover');
      if(evt==='drop' && e.dataTransfer.files[0]) handleFile(e.dataTransfer.files[0]);
    });
  });
  input.onchange = ()=>{ if(input.files[0]) handleFile(input.files[0]); };
  updateNextEnabled();
}

async function handleFile(file){
  wz.file = file;
  wz.appsResult = null; wz.appsError = null;
  try{
    wz.workbook = await readWorkbookFile(file);
    wz.sheetNames = wz.workbook.SheetNames;
    if(isApplicationsSource()){
      try{
        const result = parseApplicationsWorkbook(wz.workbook);
        if(!result.funds.length) throw new Error('no-funds-found');
        wz.appsResult = result;
      }catch(err){
        console.error(err);
        wz.appsResult = null;
        wz.appsError = (err && err.message==='sheet-consolidado-not-found')
          ? 'Não encontramos a aba "CONSOLIDADO" nesta planilha.'
          : 'Não foi possível identificar os fundos neste arquivo. Confira se é o relatório "Analise Aplicações".';
      }
      renderStep0(document.getElementById('wizardBody'), document.getElementById('wizardNext'));
      renderApplicationsSummaryArea();
      updateNextEnabled();
      return;
    }
    wz.sheetName = wz.sheetNames[0];
    loadSheetIntoWizard();
    renderStep0(document.getElementById('wizardBody'), document.getElementById('wizardNext'));
    renderSheetArea();
  }catch(err){
    console.error(err);
    showToast('Não foi possível ler este arquivo. Verifique se é uma planilha Excel válida.', true);
  }
}
function renderApplicationsSummaryArea(){
  const area = document.getElementById('sheetArea');
  if(!area) return;
  if(wz.appsError){
    area.innerHTML = `<div class="demo-banner" style="margin-top:12px;"><span>&#9888;</span><span>${escapeHtml(wz.appsError)}</span></div>`;
    return;
  }
  if(!wz.appsResult){ area.innerHTML = ''; return; }
  const r = wz.appsResult;
  area.innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin:12px 0 0;">
      <div class="kpi-tile"><div class="kpi-label">Fundos encontrados</div><div class="kpi-value num">${r.funds.length}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Saldo total</div><div class="kpi-value num">${formatBRL(r.totalBalance)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Dados até</div><div class="kpi-value num" style="font-size:16px;">${formatDateBR(r.asOfDate)}</div></div>
    </div>
    ${r.staleCount>0 ? `<div class="demo-banner" style="margin-top:12px;"><span>&#9432;</span><span>${r.staleCount} fundo(s) sem atualização recente — serão marcados como "desatualizado" na tela de Aplicações.</span></div>` : ''}
    ${!r.sourceSheetInfo ? `<div class="field-hint" style="margin-top:8px;">Não encontramos a aba "Informações Fundos" — os fundos serão salvos sem vínculo, garantia, cotização e indexador.</div>` : ''}
  `;
}
function loadSheetIntoWizard(){
  wz.matrix = sheetToMatrix(wz.workbook, wz.sheetName);
  wz.headerRowIdx = guessHeaderRow(wz.matrix);
}
// Each source (bank) remembers its own last-used mapping on its `imports/{id}`
// doc. If this file's columns look the same as last time, reapply it as-is;
// otherwise fall back to a heuristic guess from the header text.
function applySavedMappingForSource(){
  wz.sourceId = slugifySource(wz.sourceName);
  const colOptions = buildColumnOptions(wz.matrix, wz.headerRowIdx);
  const signature = colOptions.map(c=>c.label).join('|');
  wz.headerSignature = signature;
  const existing = state.sources.find(s=>s.id===wz.sourceId);
  if(existing && existing.mapping && existing.headerSignature===signature){
    Object.assign(wz.mapping, existing.mapping);
    wz.valueMode = existing.mapping.valueMode || wz.valueMode;
    wz.appliedSavedMapping = true;
  } else {
    const guess = guessMappingFromHeaders(colOptions);
    Object.assign(wz.mapping, guess);
    wz.appliedSavedMapping = false;
  }
}
function renderSheetArea(){
  const area = document.getElementById('sheetArea');
  if(!area) return;
  const maxRow = Math.min(wz.matrix.length-1, 30);
  area.innerHTML = `
    ${wz.sheetNames.length>1 ? `
    <div class="field">
      <label for="sheetSelect">Planilha (aba)</label>
      <select id="sheetSelect">${wz.sheetNames.map(s=>`<option value="${escapeHtml(s)}" ${s===wz.sheetName?'selected':''}>${escapeHtml(s)}</option>`).join('')}</select>
    </div>` : ''}
    <div class="field">
      <label for="headerRowInput">Linha do cabeçalho (contando a partir de 1)</label>
      <input type="number" id="headerRowInput" min="1" max="${maxRow+1}" value="${wz.headerRowIdx+1}">
      <div class="field-hint">Detectamos automaticamente a linha mais provável — ajuste se necessário.</div>
    </div>
    <div class="preview-table-wrap">${renderRawPreviewTable()}</div>
  `;
  const sheetSelect = document.getElementById('sheetSelect');
  if(sheetSelect) sheetSelect.onchange = ()=>{ wz.sheetName = sheetSelect.value; loadSheetIntoWizard(); renderSheetArea(); updateNextEnabled(); };
  document.getElementById('headerRowInput').onchange = (e)=>{
    const v = clamp(parseInt(e.target.value,10)-1, 0, wz.matrix.length-1);
    wz.headerRowIdx = v; renderSheetArea(); updateNextEnabled();
  };
  updateNextEnabled();
}
function renderRawPreviewTable(){
  const rows = wz.matrix.slice(0, Math.min(wz.matrix.length, wz.headerRowIdx+7));
  const cols = maxCols(wz.matrix, wz.headerRowIdx);
  let html = '<table class="preview-table"><thead><tr><th></th>';
  for(let c=0;c<cols;c++) html += `<th>${colLetter(c)}</th>`;
  html += '</tr></thead><tbody>';
  rows.forEach((row,r)=>{
    html += `<tr style="${r===wz.headerRowIdx?'background:var(--accent-soft)':''}"><td style="color:var(--ink-muted)">${r+1}</td>`;
    for(let c=0;c<cols;c++){
      const v = row ? row[c] : null;
      html += `<td>${v instanceof Date ? formatDateBR(parseDateCell(v)) : escapeHtml(v)}</td>`;
    }
    html += '</tr>';
  });
  html += '</tbody></table>';
  return html;
}
function updateNextEnabled(){
  let ok;
  if(isApplicationsSource()){
    ok = !!(wz.appsResult && wz.appsResult.funds.length);
  } else {
    ok = !!(wz.sourceName && wz.sourceName.trim()) && wz.matrix && wz.sheetName && wz.matrix.length > wz.headerRowIdx+1;
  }
  document.getElementById('wizardNext').disabled = !ok;
}

function renderStep1(body, nextBtn){
  const options = [
    { id:'signed', title:'Uma coluna de valor com sinal', desc:'Positivo = recebimento, negativo = pagamento (ou vice-versa).' },
    { id:'twoColumns', title:'Duas colunas — Entradas e Saídas', desc:'Colunas separadas para valores recebidos e valores pagos.' },
    { id:'typedColumn', title:'Uma coluna de valor + uma coluna de tipo', desc:'Ex.: coluna "Valor" e coluna "Tipo" com textos como Receita/Despesa.' },
  ];
  body.innerHTML = `<div class="radio-cards">${options.map(o=>`
    <label class="radio-card ${wz.valueMode===o.id?'selected':''}" data-mode="${o.id}">
      <input type="radio" name="valueMode" value="${o.id}" ${wz.valueMode===o.id?'checked':''}>
      <div class="radio-card-text"><b>${o.title}</b><span>${o.desc}</span></div>
    </label>`).join('')}</div>`;
  document.querySelectorAll('[data-mode]').forEach(el=>{
    el.onclick = ()=>{ wz.valueMode = el.dataset.mode; renderStep1(body, nextBtn); };
  });
  nextBtn.disabled = false;
}

function renderStep2(body, nextBtn){
  const colOptions = buildColumnOptions(wz.matrix, wz.headerRowIdx);
  const colSelect = (id, current, extraNone)=>{
    const needsPlaceholder = extraNone || current===null || current===undefined;
    const placeholder = extraNone ? '— não informado —' : '— selecione —';
    return `<select id="${id}">${needsPlaceholder?`<option value="" ${current==null?'selected':''}>${placeholder}</option>`:''}${colOptions.map(o=>`<option value="${o.index}" ${String(current)===String(o.index)?'selected':''}>${escapeHtml(o.label)}</option>`).join('')}</select>`;
  };
  let html = '';
  if(wz.appliedSavedMapping) html += `<div class="demo-banner" style="margin:0 0 14px;"><span>&#10003;</span><span>Aplicamos automaticamente o mapeamento usado no último envio para esta mesma planilha.</span></div>`;

  html += `<div class="field"><label>Coluna de data</label>${colSelect('mapDate', wz.mapping.dateCol)}</div>`;

  if(wz.valueMode==='signed'){
    html += `<div class="field"><label>Coluna de valor</label>${colSelect('mapValue', wz.mapping.valueCol)}</div>`;
  } else if(wz.valueMode==='twoColumns'){
    html += `<div class="field-row">
      <div class="field"><label>Coluna de entradas (recebimentos)</label>${colSelect('mapInValue', wz.mapping.inValueCol, true)}</div>
      <div class="field"><label>Coluna de saídas (pagamentos)</label>${colSelect('mapOutValue', wz.mapping.outValueCol, true)}</div>
    </div>`;
  } else {
    html += `<div class="field-row">
      <div class="field"><label>Coluna de valor</label>${colSelect('mapValue', wz.mapping.valueCol)}</div>
      <div class="field"><label>Coluna de tipo</label>${colSelect('mapType', wz.mapping.typeCol)}</div>
    </div>
    <div class="field" id="typeValuesField"></div>`;
  }

  html += `<div class="field">
    <label>Status do lançamento</label>
    <div class="radio-cards">
      <label class="radio-card ${wz.mapping.statusMode==='inferDate'?'selected':''}" data-status-mode="inferDate">
        <input type="radio" name="statusMode" ${wz.mapping.statusMode==='inferDate'?'checked':''}>
        <div class="radio-card-text"><b>Inferir pela data</b><span>Até hoje = Realizado; depois de hoje = Previsto.</span></div>
      </label>
      <label class="radio-card ${wz.mapping.statusMode==='column'?'selected':''}" data-status-mode="column">
        <input type="radio" name="statusMode" ${wz.mapping.statusMode==='column'?'checked':''}>
        <div class="radio-card-text"><b>Usar uma coluna de status</b><span>Ex.: "Pago", "Em aberto", "Previsto".</span></div>
      </label>
    </div>
  </div>`;
  if(wz.mapping.statusMode==='column'){
    html += `<div class="field"><label>Coluna de status</label>${colSelect('mapStatus', wz.mapping.statusCol)}</div>
      <div class="field" id="statusValuesField"></div>`;
  }

  html += `<div class="field-row">
    <div class="field"><label>Coluna de conta bancária <span class="field-hint">(opcional)</span></label>${colSelect('mapAccount', wz.mapping.accountCol, true)}</div>
    <div class="field"><label>Coluna de categoria <span class="field-hint">(opcional)</span></label>${colSelect('mapCategory', wz.mapping.categoryCol, true)}</div>
  </div>
  <div class="field"><label>Coluna de descrição <span class="field-hint">(opcional)</span></label>${colSelect('mapDesc', wz.mapping.descCol, true)}</div>`;

  body.innerHTML = html;

  const bind = (id, key, isInt)=>{ const el = document.getElementById(id); if(el) el.onchange = ()=>{ wz.mapping[key] = el.value===''?null:(isInt!==false?parseInt(el.value,10):el.value); renderTypeOrStatusValueMaps(); updateStep2NextEnabled(); }; };
  bind('mapDate','dateCol'); bind('mapValue','valueCol'); bind('mapInValue','inValueCol');
  bind('mapOutValue','outValueCol'); bind('mapType','typeCol'); bind('mapStatus','statusCol');
  bind('mapAccount','accountCol'); bind('mapCategory','categoryCol'); bind('mapDesc','descCol');

  document.querySelectorAll('[data-status-mode]').forEach(el=>{
    el.onclick = ()=>{ wz.mapping.statusMode = el.dataset.statusMode; renderStep2(body, nextBtn); };
  });

  renderTypeOrStatusValueMaps();
  updateStep2NextEnabled();
}
function renderTypeOrStatusValueMaps(){
  const typeField = document.getElementById('typeValuesField');
  if(typeField && wz.mapping.typeCol!==null){
    const vals = distinctColumnValues(wz.matrix, wz.headerRowIdx, wz.mapping.typeCol);
    vals.forEach(v=>{ if(!(v.value in wz.mapping.typeValueMap)) wz.mapping.typeValueMap[v.value] = guessFlow(v.value); });
    typeField.innerHTML = `<label>O que cada valor de "tipo" representa?</label>` + vals.map(v=>`
      <div class="field-row" style="grid-template-columns:1fr 160px;align-items:center;margin-bottom:6px;">
        <span style="font-size:12.5px;">${escapeHtml(v.value)} <span class="field-hint">(${v.count}&times;)</span></span>
        <select data-type-val="${escapeHtml(v.value)}">
          <option value="recebimento" ${wz.mapping.typeValueMap[v.value]==='recebimento'?'selected':''}>Recebimento</option>
          <option value="pagamento" ${wz.mapping.typeValueMap[v.value]==='pagamento'?'selected':''}>Pagamento</option>
          <option value="ignore" ${wz.mapping.typeValueMap[v.value]==='ignore'?'selected':''}>Ignorar</option>
        </select>
      </div>`).join('');
    typeField.querySelectorAll('[data-type-val]').forEach(sel=>{
      sel.onchange = ()=>{ wz.mapping.typeValueMap[sel.dataset.typeVal] = sel.value; };
    });
  }
  const statusField = document.getElementById('statusValuesField');
  if(statusField && wz.mapping.statusMode==='column' && wz.mapping.statusCol!==null){
    const vals = distinctColumnValues(wz.matrix, wz.headerRowIdx, wz.mapping.statusCol);
    vals.forEach(v=>{ if(!(v.value in wz.mapping.statusValueMap)) wz.mapping.statusValueMap[v.value] = guessStatus(v.value); });
    statusField.innerHTML = `<label>O que cada status representa?</label>` + vals.map(v=>`
      <div class="field-row" style="grid-template-columns:1fr 160px;align-items:center;margin-bottom:6px;">
        <span style="font-size:12.5px;">${escapeHtml(v.value)} <span class="field-hint">(${v.count}&times;)</span></span>
        <select data-status-val="${escapeHtml(v.value)}">
          <option value="realizado" ${wz.mapping.statusValueMap[v.value]==='realizado'?'selected':''}>Realizado</option>
          <option value="previsto" ${wz.mapping.statusValueMap[v.value]==='previsto'?'selected':''}>Previsto</option>
          <option value="ignore" ${wz.mapping.statusValueMap[v.value]==='ignore'?'selected':''}>Inferir pela data</option>
        </select>
      </div>`).join('');
    statusField.querySelectorAll('[data-status-val]').forEach(sel=>{
      sel.onchange = ()=>{ wz.mapping.statusValueMap[sel.dataset.statusVal] = sel.value; };
    });
  }
  updateStep2NextEnabled();
}
function updateStep2NextEnabled(){
  const m = wz.mapping;
  let ok = m.dateCol!==null;
  if(wz.valueMode==='signed') ok = ok && m.valueCol!==null;
  else if(wz.valueMode==='twoColumns') ok = ok && (m.inValueCol!==null || m.outValueCol!==null);
  else ok = ok && m.valueCol!==null && m.typeCol!==null;
  if(m.statusMode==='column') ok = ok && m.statusCol!==null;
  const btn = document.getElementById('wizardNext');
  if(btn) btn.disabled = !ok;
}

function buildTransactionsFromMapping(){
  const { matrix, headerRowIdx, mapping, valueMode } = wz;
  const today = todayISO();
  const rows = [];
  let errorCount = 0;
  for(let r=headerRowIdx+1; r<matrix.length; r++){
    const row = matrix[r];
    if(!row) continue;
    const date = parseDateCell(row[mapping.dateCol]);
    if(!date){ if(row.some(c=>c!==null&&c!==undefined&&c!=='')) errorCount++; continue; }

    const candidates = [];
    if(valueMode==='signed'){
      const raw = parseNumberCell(row[mapping.valueCol]);
      if(!isNaN(raw) && raw!==0) candidates.push({ type: raw>=0?'recebimento':'pagamento', value: Math.abs(raw) });
    } else if(valueMode==='twoColumns'){
      if(mapping.inValueCol!==null){
        const inV = parseNumberCell(row[mapping.inValueCol]);
        if(!isNaN(inV) && inV!==0) candidates.push({ type:'recebimento', value: Math.abs(inV) });
      }
      if(mapping.outValueCol!==null){
        const outV = parseNumberCell(row[mapping.outValueCol]);
        if(!isNaN(outV) && outV!==0) candidates.push({ type:'pagamento', value: Math.abs(outV) });
      }
    } else {
      const raw = parseNumberCell(row[mapping.valueCol]);
      const typeRaw = row[mapping.typeCol];
      const mappedType = mapping.typeValueMap[String(typeRaw==null?'':typeRaw).trim()];
      if(!isNaN(raw) && raw!==0 && (mappedType==='recebimento'||mappedType==='pagamento')){
        candidates.push({ type: mappedType, value: Math.abs(raw) });
      }
    }
    if(!candidates.length){ errorCount++; continue; }

    let status;
    if(mapping.statusMode==='inferDate'){
      status = date<=today ? 'realizado' : 'previsto';
    } else {
      const rawStatus = row[mapping.statusCol];
      const mapped = mapping.statusValueMap[String(rawStatus==null?'':rawStatus).trim()];
      status = (mapped==='realizado'||mapped==='previsto') ? mapped : (date<=today?'realizado':'previsto');
    }

    const account = mapping.accountCol!==null ? String(row[mapping.accountCol]==null?'':row[mapping.accountCol]).trim() : '';
    const category = mapping.categoryCol!==null ? String(row[mapping.categoryCol]==null?'':row[mapping.categoryCol]).trim() : '';
    const description = mapping.descCol!==null ? String(row[mapping.descCol]==null?'':row[mapping.descCol]).trim() : '';

    candidates.forEach(c=>{
      rows.push({
        date, type:c.type, status, value: c.value,
        account: account || 'Conta não especificada',
        category: category || 'Sem categoria',
        description: description || category || (c.type==='recebimento'?'Recebimento':'Pagamento'),
      });
    });
  }
  wz.parsedRows = rows;
  wz.parseErrorCount = errorCount;
}

function renderStep3(body, nextBtn){
  buildTransactionsFromMapping();
  const rows = wz.parsedRows;
  const totalIn = rows.filter(r=>r.type==='recebimento').reduce((s,r)=>s+r.value,0);
  const totalOut = rows.filter(r=>r.type==='pagamento').reduce((s,r)=>s+r.value,0);
  body.innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin:0 0 14px;">
      <div class="kpi-tile"><div class="kpi-label">Lançamentos</div><div class="kpi-value num">${rows.length}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Total recebimentos</div><div class="kpi-value num pos">${formatBRL(totalIn)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Total pagamentos</div><div class="kpi-value num neg">${formatBRL(totalOut)}</div></div>
    </div>
    ${wz.parseErrorCount>0 ? `<div class="demo-banner" style="margin-bottom:12px;"><span>&#9888;</span><span>${wz.parseErrorCount} linha(s) ignorada(s) por data ou valor inválido/ausente.</span></div>` : ''}
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead><tr><th>Data</th><th>Tipo</th><th>Status</th><th>Conta</th><th>Categoria</th><th>Descrição</th><th>Valor</th></tr></thead>
        <tbody>${rows.slice(0,MAX_PREVIEW_ROWS).map(r=>`<tr>
          <td>${formatDateBR(r.date)}</td><td>${TYPE_LABEL[r.type]}</td><td>${STATUS_LABEL[r.status]}</td>
          <td>${escapeHtml(r.account)}</td><td>${escapeHtml(r.category)}</td><td>${escapeHtml(r.description)}</td>
          <td>${formatBRL(r.value,true)}</td></tr>`).join('')}</tbody>
      </table>
    </div>
    ${rows.length>MAX_PREVIEW_ROWS ? `<div class="field-hint" style="margin-top:6px;">…e mais ${rows.length-MAX_PREVIEW_ROWS} lançamento(s).</div>` : ''}
  `;
  nextBtn.disabled = rows.length===0;
}

function renderApplicationsPreview(body, nextBtn){
  const r = wz.appsResult;
  if(!r){ body.innerHTML = `<div class="empty-state">Nenhum dado para pré-visualizar.</div>`; nextBtn.disabled = true; return; }
  const byBankRows = r.byBank.map(b=>`<tr><td>${escapeHtml(b.banco)}</td><td class="num-col num">${formatBRL(b.total)}</td></tr>`).join('');
  const fundRows = r.funds.slice(0, MAX_PREVIEW_ROWS).map(f=>`
    <tr>
      <td>${escapeHtml(f.banco)}</td>
      <td>${escapeHtml(f.fundo)}</td>
      <td class="num">${formatDateBR(f.competencia)}${f.stale?` <span class="kpi-badge warn" title="Sem atualização há ${f.staleDays} dias">desatualizado</span>`:''}</td>
      <td class="num-col num">${formatBRL(f.saldoFinal,true)}</td>
    </tr>`).join('');
  body.innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(3,1fr);margin:0 0 14px;">
      <div class="kpi-tile"><div class="kpi-label">Fundos</div><div class="kpi-value num">${r.funds.length}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Saldo total</div><div class="kpi-value num">${formatBRL(r.totalBalance)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Dados até</div><div class="kpi-value num" style="font-size:16px;">${formatDateBR(r.asOfDate)}</div></div>
    </div>
    ${r.staleCount>0 ? `<div class="demo-banner" style="margin-bottom:12px;"><span>&#9888;</span><span>${r.staleCount} fundo(s) sem atualização recente — marcados como "desatualizado" abaixo e na tela de Aplicações.</span></div>` : ''}
    <div class="preview-table-wrap" style="margin-bottom:14px;">
      <table class="preview-table"><thead><tr><th>Banco</th><th class="num-col">Saldo</th></tr></thead><tbody>${byBankRows}</tbody></table>
    </div>
    <div class="preview-table-wrap">
      <table class="preview-table">
        <thead><tr><th>Banco</th><th>Fundo</th><th>Competência</th><th>Saldo final</th></tr></thead>
        <tbody>${fundRows}</tbody>
      </table>
    </div>
    ${r.funds.length>MAX_PREVIEW_ROWS ? `<div class="field-hint" style="margin-top:6px;">…e mais ${r.funds.length-MAX_PREVIEW_ROWS} fundo(s).</div>` : ''}
  `;
  nextBtn.disabled = r.funds.length===0;
}

async function finishApplicationsWizard(){
  const nextBtn = document.getElementById('wizardNext');
  nextBtn.disabled = true; nextBtn.textContent = 'Salvando…';
  try{
    let fileBase64 = null;
    try{ fileBase64 = await fileToBase64(wz.file); }catch(e){ /* guardar o original é best-effort */ }
    await saveApplicationsData({
      filename: wz.file.name, asOfDate: wz.appsResult.asOfDate,
      totalBalance: wz.appsResult.totalBalance, byBank: wz.appsResult.byBank,
      funds: wz.appsResult.funds, fileBase64, fileMime: wz.file.type||'',
    });
    logUploadHistory({ bank: APPLICATIONS_SOURCE, filename: wz.file.name, status:'concluido', rowCount: wz.appsResult.funds.length });
    closeUploadModal();
    showToast(`Relatório de aplicações carregado: ${wz.appsResult.funds.length} fundos.`);
  }catch(err){
    console.error(err);
    const msg = (err && err.code==='forbidden')
      ? 'Você não tem permissão para carregar relatórios neste painel.'
      : (err && err.code==='session_expired')
        ? 'Sua sessão expirou — faça login novamente.'
        : 'Não foi possível salvar os dados. Tente novamente.';
    showToast(msg, true);
    logUploadHistory({ bank: APPLICATIONS_SOURCE, filename: wz.file && wz.file.name, status:'erro', errorMessage: msg });
    nextBtn.disabled = false; nextBtn.textContent = 'Salvar dados';
  }
}

// Lê o arquivo original como base64 puro (sem o prefixo "data:...;base64,")
// para guardarmos uma cópia dele no Drive, além dos lançamentos já extraídos.
function fileToBase64(file){
  return new Promise((resolve, reject)=>{
    const reader = new FileReader();
    reader.onload = ()=>{
      const result = String(reader.result||'');
      const comma = result.indexOf(',');
      resolve(comma>=0 ? result.slice(comma+1) : result);
    };
    reader.onerror = ()=> reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function finishWizard(){
  const nextBtn = document.getElementById('wizardNext');
  nextBtn.disabled = true; nextBtn.textContent = 'Salvando…';
  try{
    const mappingToSave = { ...wz.mapping, valueMode: wz.valueMode };
    let fileBase64 = null;
    try{ fileBase64 = await fileToBase64(wz.file); }catch(e){ /* guardar o original é best-effort */ }
    await saveImportForSource({
      sourceId: wz.sourceId, sourceName: wz.sourceName.trim(),
      filename: wz.file.name, sheetName: wz.sheetName,
      mapping: mappingToSave, headerSignature: wz.headerSignature,
      rows: wz.parsedRows, fileBase64, fileMime: wz.file.type||'',
    });
    logUploadHistory({ bank: wz.sourceName.trim(), filename: wz.file.name, status:'concluido', rowCount: wz.parsedRows.length });
    closeUploadModal();
    showToast(`Relatório de "${wz.sourceName.trim()}" carregado: ${wz.parsedRows.length} lançamentos.`);
  }catch(err){
    console.error(err);
    const msg = (err && err.code==='forbidden')
      ? 'Você não tem permissão para carregar relatórios neste painel.'
      : (err && err.code==='session_expired')
        ? 'Sua sessão expirou — faça login novamente.'
        : 'Não foi possível salvar os dados. Tente novamente.';
    showToast(msg, true);
    logUploadHistory({ bank: (wz.sourceName||'').trim()||'—', filename: wz.file && wz.file.name, status:'erro', errorMessage: msg });
    nextBtn.disabled = false; nextBtn.textContent = 'Salvar dados';
  }
}

function wizardGoNext(){
  if(isApplicationsSource()){
    if(wz.step===0){ wz.step = 3; renderWizardStep(); return; }
    if(wz.step===3){ finishApplicationsWizard(); return; }
  }
  if(wz.step===0){ applySavedMappingForSource(); }
  if(wz.step===3){ finishWizard(); return; }
  wz.step++;
  renderWizardStep();
}
function wizardGoBack(){
  if(isApplicationsSource() && wz.step===3){ wz.step = 0; renderWizardStep(); return; }
  wz.step--;
  renderWizardStep();
}

/* ==== ACCOUNT MODAL ==== */
let editingAccountId = null;
function openAccountModal(acc){
  editingAccountId = acc ? acc.id : null;
  document.getElementById('accountModalTitle').textContent = acc ? 'Editar conta' : 'Nova conta';
  document.getElementById('accName').value = acc ? acc.name : '';
  document.getElementById('accKind').value = acc ? acc.kind : 'conta';
  document.getElementById('accBalance').value = acc ? acc.balance : '';
  document.getElementById('accDate').value = acc ? acc.asOfDate : todayISO();
  const del = document.getElementById('accDelete');
  del.hidden = !acc;
  del.textContent = 'Excluir conta';
  del.dataset.confirm = '';
  document.getElementById('accountModal').hidden = false;
}
function closeAccountModal(){ document.getElementById('accountModal').hidden = true; }
async function saveAccountFromModal(){
  const name = document.getElementById('accName').value.trim();
  if(!name){ showToast('Informe o nome da conta.', true); return; }
  if(!session){ showToast('Sessão expirada — faça login novamente.', true); return; }
  const kind = document.getElementById('accKind').value;
  const balance = parseFloat(document.getElementById('accBalance').value)||0;
  const asOfDate = document.getElementById('accDate').value || todayISO();
  const existing = state.accounts.find(a=>a.id===editingAccountId);
  try{
    await saveAccount({ id: editingAccountId, name, kind, balance, asOfDate, order: existing ? existing.order : state.accounts.length });
    closeAccountModal();
    showToast('Conta salva.');
  }catch(err){ console.error(err); showToast('Não foi possível salvar a conta.', true); }
}
async function deleteAccountFromModal(){
  const btn = document.getElementById('accDelete');
  if(btn.dataset.confirm!=='1'){ btn.dataset.confirm='1'; btn.textContent='Clique para confirmar exclusão'; return; }
  try{
    await deleteAccount(editingAccountId);
    closeAccountModal();
    showToast('Conta excluída.');
  }catch(err){ console.error(err); showToast('Não foi possível excluir a conta.', true); }
}

/* ==== TOAST ==== */
let toastTimer = null;
function showToast(msg, isError){
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast' + (isError?' err':'');
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>{ el.hidden = true; }, 4200);
}

/* ==== INIT ==== */
function renderAll(){
  const { accounts, transactions, sources } = activeData();
  document.getElementById('demoBanner').hidden = !state.usingDemo;

  const kpis = computeKPIs(accounts, transactions);
  renderKPIs(kpis);

  renderRangeControl();
  const { start, end } = getRangeBounds(currentRangeId, transactions);
  const daily = computeDailySeries(transactions, start, end);
  renderDailyLegend();
  drawDailyChart(daily);
  const cumulative = computeCumulativeSeries(transactions, daily, kpis.totalBalance);
  drawCumulativeChart(cumulative);
  renderCategories(transactions, start, end);

  renderAccounts(accounts, kpis);
  renderSources(sources);
  renderAccountFilterOptions(accounts, transactions);
  renderTable(transactions);
}

function wireStaticEvents(){
  if(staticEventsWired) return; // evita duplicar listeners se o login acontecer mais de uma vez
  staticEventsWired = true;
  document.querySelectorAll('#viewTabs [data-view]').forEach(b=>{
    b.onclick = ()=> switchView(b.dataset.view);
  });
  document.getElementById('histBankFilter').addEventListener('change', (e)=>{
    state.historyBankFilter = e.target.value;
    renderHistory();
  });
  const appsBankFilterEl = document.getElementById('appsBankFilter');
  if(appsBankFilterEl) appsBankFilterEl.addEventListener('change', (e)=>{
    state.applicationsBankFilter = e.target.value;
    renderApplications();
  });

  document.getElementById('btnUpload').onclick = openUploadModal;
  document.getElementById('wizardCancel').onclick = closeUploadModal;
  document.getElementById('wizardBack').onclick = wizardGoBack;
  document.getElementById('wizardNext').onclick = wizardGoNext;
  document.getElementById('uploadModal').addEventListener('click', e=>{ if(e.target.id==='uploadModal') closeUploadModal(); });

  document.getElementById('btnAddAccount').onclick = ()=> openAccountModal(null);
  document.getElementById('accCancel').onclick = closeAccountModal;
  document.getElementById('accSave').onclick = saveAccountFromModal;
  document.getElementById('accDelete').onclick = deleteAccountFromModal;
  document.getElementById('accountModal').addEventListener('click', e=>{ if(e.target.id==='accountModal') closeAccountModal(); });

  document.getElementById('btnExport').onclick = exportCsv;

  const onFilterChange = debounce(()=>{
    state.filters.search = document.getElementById('fSearch').value;
    state.filters.tipo = document.getElementById('fTipo').value;
    state.filters.status = document.getElementById('fStatus').value;
    state.filters.conta = document.getElementById('fConta').value;
    renderTable(activeData().transactions);
  }, 120);
  document.getElementById('fSearch').addEventListener('input', onFilterChange);
  document.getElementById('fTipo').addEventListener('change', onFilterChange);
  document.getElementById('fStatus').addEventListener('change', onFilterChange);
  document.getElementById('fConta').addEventListener('change', onFilterChange);

  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){ closeUploadModal(); closeAccountModal(); }
  });
}

function boot(){
  wireLoginForm();
  const stored = loadStoredSession();
  if(stored){
    session = stored;
    enterApp();
  }else{
    showLoginScreen();
  }
}
if(document.readyState==='loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
