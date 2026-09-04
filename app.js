/* ==== CONFIG & CONSTANTS ==== */
// Cole aqui a URL do seu Web App do Google Apps Script (termina com /exec).
// Veja SETUP.md — passo "Implantar como Web App".
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbzhn3VwSmd3DIXNFuKvgIeqtpTk6qdTZKlh1fFyVLxQlTrvrt3WFcFFDtp-rJEzD3lk/exec';
const MAX_PREVIEW_ROWS = 8;
// Período do painel = competência (mês-calendário), como nos extratos bancários,
// em vez de janelas de "N dias atrás / N dias à frente".
const MONTH_NAMES = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
const COMPETENCIA_MONTHS_BACK = 12; // quantos meses passados aparecem na lista, além do mês atual
function monthId(y,m){ return `${y}-${pad2(m)}`; }
function monthLabel(y,m){ return `${MONTH_NAMES[m-1]}/${y}`; }
function currentMonthId(){ const d=new Date(); return monthId(d.getFullYear(), d.getMonth()+1); }
function generateCompetencias(){
  const now = new Date();
  const list = [];
  for(let offset=0; offset<=COMPETENCIA_MONTHS_BACK; offset++){
    const d = new Date(now.getFullYear(), now.getMonth()-offset, 1);
    list.push({ id: monthId(d.getFullYear(), d.getMonth()+1), label: monthLabel(d.getFullYear(), d.getMonth()+1) });
  }
  return list;
}
let currentRangeId = currentMonthId();

const STATUS_LABEL = { realizado: 'Realizado', previsto: 'Previsto' };
const TYPE_LABEL = { recebimento: 'Recebimento', pagamento: 'Pagamento' };

// Bancos com layout de relatório próprio — cada um vira uma "fonte"
// separada, com seu próprio mapeamento de colunas lembrado.
const BANKS = ['Banco XP', 'BTG Pactual', 'Sicredi', 'CEF Itabuna', 'CEF Salvador', 'CEF Transitória', 'Santander', 'Azimut', 'Mercado Pago'];
const OTHER_BANK = 'Outro';
const HISTORY_KEEP = 200; // poda o histórico de uploads acima disso

// Relatório especial "Analise Aplicações" — não é lançamento linha a linha,
// é uma fotografia do saldo de cada fundo. Some ao seletor de bancos do
// assistente, mas segue um fluxo próprio (ver ISSO no wizard mais abaixo).
const APPLICATIONS_SOURCE = 'Análise Aplicações';
const APPLICATIONS_STALE_DAYS = 60; // acima disso, o fundo é marcado como "desatualizado"
const ACCOUNT_STALE_DAYS = 1; // saldo de conta com mais de N dias aparece como "Desatualizada" na Posição por banco
const BANK_POSITION_VISIBLE = 6; // quantas contas aparecem antes do link "Ver todos os bancos"
const DESC_MATRIX_PAGE_SIZE = 20; // quantos lançamentos cada página da matriz por descrição mostra

/* ==== ÍCONES (SVG inline, sem biblioteca externa) ==== */
const ICON_PATHS = {
  bank: '<path d="M4 21h16"/><path d="M6 21v-9"/><path d="M10 21v-9"/><path d="M14 21v-9"/><path d="M18 21v-9"/><path d="M2 10l10-6 10 6"/>',
  arrowDownLeft: '<path d="M17 7 7 17"/><path d="M17 17H7V7"/>',
  arrowUpRight: '<path d="M7 17 17 7"/><path d="M7 7h10v10"/>',
  trendingUp: '<path d="M3 17l6-6 4 4 8-8"/><path d="M17 7h4v4"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 3"/>',
  wallet: '<path d="M3 7a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/><path d="M16 12h2"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 4v5h-5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6"/><path d="M10 20a2 2 0 0 0 4 0"/>',
  chevronDown: '<path d="m6 9 6 6 6-6"/>',
  calendar: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 10h18"/>',
  home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/>',
  history: '<path d="M14 3v5h5"/><path d="M6 3h8l5 5v13H6z"/><path d="M9 13h6M9 17h6"/>',
  layers: '<path d="m12 3 9 5-9 5-9-5 9-5Z"/><path d="m3 13 9 5 9-5"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronsLeft: '<path d="m17 6-6 6 6 6"/><path d="m11 6-6 6 6 6"/>',
  chevronsRight: '<path d="m7 6 6 6-6 6"/><path d="m13 6 6 6-6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  percent: '<circle cx="7" cy="7" r="2.2"/><circle cx="17" cy="17" r="2.2"/><path d="M18 6 6 18"/>',
};
function svgIcon(name, size){
  const s = size || 18;
  const d = ICON_PATHS[name] || '';
  return `<svg viewBox="0 0 24 24" width="${s}" height="${s}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

/* ==== SELOS (badges) de banco ====
   Ideal seria usar o logo oficial de cada banco, mas este ambiente de nuvem
   só tem acesso de rede a registros de pacotes (npm/pip) — não consegue
   baixar imagens de sites externos (bloqueado pelo firewall do sandbox).
   Onde há um ícone de marca disponível via biblioteca de pacotes (Simple
   Icons, CC0, mantida para representar marcas/empresas) usamos o logo real;
   nos demais bancos, ainda não localizados numa biblioteca de pacotes,
   caímos de volta no monograma colorido — ver relatório de entrega. */
const BANK_LOGO_SVG = {
  // Mercado Pago — via Simple Icons (CC0), cor oficial da marca.
  'mercado pago': {
    color: '#00B1EA',
    path: 'M11.115 16.479a.93.927 0 0 1-.939-.886c-.002-.042-.006-.155-.103-.155-.04 0-.074.023-.113.059-.112.103-.254.206-.46.206a.816.814 0 0 1-.305-.066c-.535-.214-.542-.578-.521-.725.006-.038.007-.08-.02-.11l-.032-.03h-.034c-.027 0-.055.012-.093.039a.788.786 0 0 1-.454.16.7.699 0 0 1-.253-.05c-.708-.27-.65-.928-.617-1.126.005-.041-.005-.072-.03-.092l-.05-.04-.047.043a.728.726 0 0 1-.505.203.73.728 0 0 1-.732-.725c0-.4.328-.722.732-.722.364 0 .675.27.721.63l.026.195.11-.165c.01-.018.307-.46.852-.46.102 0 .21.016.316.05.434.13.508.52.519.68.008.094.075.1.09.1.037 0 .064-.024.083-.045a.746.744 0 0 1 .54-.225c.128 0 .263.03.402.09.69.293.379 1.158.374 1.167-.058.144-.061.207-.005.244l.027.013h.02c.03 0 .07-.014.134-.035.093-.032.235-.08.367-.08a.944.942 0 0 1 .94.93.936.934 0 0 1-.94.928zm7.302-4.171c-1.138-.98-3.768-3.24-4.481-3.77-.406-.302-.685-.462-.928-.533a1.559 1.554 0 0 0-.456-.07c-.182 0-.376.032-.58.095-.46.145-.918.505-1.362.854l-.023.018c-.414.324-.84.66-1.164.73a1.986 1.98 0 0 1-.43.049c-.362 0-.687-.104-.81-.258-.02-.025-.007-.066.04-.125l.008-.008 1-1.067c.783-.774 1.525-1.506 3.23-1.545h.085c1.062 0 2.12.469 2.24.524a7.03 7.03 0 0 0 3.056.724c1.076 0 2.188-.263 3.354-.795a9.135 9.11 0 0 0-.405-.317c-1.025.44-2.003.66-2.946.66-.962 0-1.925-.229-2.858-.68-.05-.022-1.22-.567-2.44-.57-.032 0-.065 0-.096.002-1.434.033-2.24.536-2.782.976-.528.013-.982.138-1.388.25-.361.1-.673.186-.979.185-.125 0-.35-.01-.37-.012-.35-.01-2.115-.437-3.518-.962-.143.1-.28.203-.415.31 1.466.593 3.25 1.053 3.812 1.089.157.01.323.027.491.027.372 0 .744-.103 1.104-.203.213-.059.446-.123.692-.17l-.196.194-1.017 1.087c-.08.08-.254.294-.14.557a.705.703 0 0 0 .268.292c.243.162.677.27 1.08.271.152 0 .297-.015.43-.044.427-.095.874-.448 1.349-.82.377-.296.913-.672 1.323-.782a1.494 1.49 0 0 1 .37-.05.611.61 0 0 1 .095.005c.27.034.533.125 1.003.472.835.62 4.531 3.815 4.566 3.846.002.002.238.203.22.537-.007.186-.11.352-.294.466a.902.9 0 0 1-.484.15.804.802 0 0 1-.428-.124c-.014-.01-1.28-1.157-1.746-1.543-.074-.06-.146-.115-.22-.115a.122.122 0 0 0-.096.045c-.073.09.01.212.105.294l1.48 1.47c.002 0 .184.17.204.395.012.244-.106.447-.35.606a.957.955 0 0 1-.526.171.766.764 0 0 1-.42-.127l-.214-.206a21.035 20.978 0 0 0-1.08-1.009c-.072-.058-.148-.112-.221-.112a.127.127 0 0 0-.094.038c-.033.037-.056.103.028.212a.698.696 0 0 0 .075.083l1.078 1.198c.01.01.222.26.024.511l-.038.048a1.18 1.178 0 0 1-.1.096c-.184.15-.43.164-.527.164a.8.798 0 0 1-.147-.012c-.106-.018-.178-.048-.212-.089l-.013-.013c-.06-.06-.602-.609-1.054-.98-.059-.05-.133-.11-.21-.11a.128.128 0 0 0-.096.042c-.09.096.044.24.1.293l.92 1.003a.204.204 0 0 1-.033.062c-.033.044-.144.155-.479.196a.91.907 0 0 1-.122.007c-.345 0-.712-.164-.902-.264a1.343 1.34 0 0 0 .13-.576 1.368 1.365 0 0 0-1.42-1.357c.024-.342-.025-.99-.697-1.274a1.455 1.452 0 0 0-.575-.125c-.146 0-.287.025-.42.075a1.153 1.15 0 0 0-.671-.564 1.52 1.515 0 0 0-.494-.085c-.28 0-.537.08-.767.242a1.168 1.165 0 0 0-.903-.43 1.173 1.17 0 0 0-.82.335c-.287-.217-1.425-.93-4.467-1.613a17.39 17.344 0 0 1-.692-.189 4.822 4.82 0 0 0-.077.494l.67.157c3.108.682 4.136 1.391 4.309 1.525a1.145 1.142 0 0 0-.09.442 1.16 1.158 0 0 0 1.378 1.132c.096.467.406.821.879 1.003a1.165 1.162 0 0 0 .415.08c.09 0 .179-.012.266-.034.086.22.282.493.722.668a1.233 1.23 0 0 0 .457.094c.122 0 .241-.022.355-.063a1.373 1.37 0 0 0 1.269.841c.37.002.726-.147.985-.41.221.121.688.341 1.163.341.06 0 .118-.002.175-.01.47-.059.689-.24.789-.382a.571.57 0 0 0 .048-.078c.11.032.234.058.373.058.255 0 .501-.086.75-.265.244-.174.418-.424.444-.637v-.01c.083.017.167.026.251.026.265 0 .527-.082.773-.242.48-.31.562-.715.554-.98a1.28 1.279 0 0 0 .978-.194 1.04 1.04 0 0 0 .502-.808 1.088 1.085 0 0 0-.16-.653c.804-.342 2.636-1.003 4.795-1.483a4.734 4.721 0 0 0-.067-.492 27.742 27.667 0 0 0-5.049 1.62zm5.123-.763c0 4.027-5.166 7.293-11.537 7.293-6.372 0-11.538-3.266-11.538-7.293 0-4.028 5.165-7.293 11.539-7.293 6.371 0 11.537 3.265 11.537 7.293zm.46.004c0-4.272-5.374-7.755-12-7.755S.002 7.277.002 11.55L0 12.004c0 4.533 4.695 8.203 11.999 8.203 7.347 0 12-3.67 12-8.204z',
  },
};
/* ==== SELOS (badges) de banco — iniciais coloridas, fallback para quando não há logo real disponível ==== */
const BANK_BADGE_MAP = {
  'banco xp': { bg:'#fdecd9', fg:'#a85717', initials:'XP' },
  'xp': { bg:'#fdecd9', fg:'#a85717', initials:'XP' },
  'btg pactual': { bg:'#e2e9fb', fg:'#1f3d8f', initials:'BTG' },
  'sicredi': { bg:'#e1f3e4', fg:'#1f7a3d', initials:'SI' },
  'cef': { bg:'#dde9fb', fg:'#0d4f96', initials:'CX' },
  'caixa': { bg:'#dde9fb', fg:'#0d4f96', initials:'CX' },
  'cef itabuna': { bg:'#dde9fb', fg:'#0d4f96', initials:'CX' },
  'cef salvador': { bg:'#dde9fb', fg:'#0d4f96', initials:'CX' },
  'cef transitória': { bg:'#dde9fb', fg:'#0d4f96', initials:'CX' },
  'santander': { bg:'#fbe3e2', fg:'#b8202f', initials:'SA' },
  'azimut': { bg:'#e6e6f2', fg:'#3d3d7a', initials:'AZ' },
};
const BANK_BADGE_PALETTE = [
  { bg:'#e0ebef', fg:'#024766' }, { bg:'#dff3f0', fg:'#0f7d70' },
  { bg:'#fbe3e2', fg:'#b23b3b' }, { bg:'#fdf1de', fg:'#9a6b12' },
  { bg:'#efe7f7', fg:'#5b3e91' },
];
function hashStr(s){ let h=0; for(let i=0;i<s.length;i++){ h=(h*31+s.charCodeAt(i))|0; } return Math.abs(h); }
function bankInitials(name){
  const words = String(name||'').trim().split(/\s+/).filter(Boolean);
  if(words.length>=2) return (words[0][0]+words[1][0]).toUpperCase();
  return String(name||'??').slice(0,2).toUpperCase();
}
function bankBadge(name){
  const key = String(name||'').trim().toLowerCase();
  if(BANK_BADGE_MAP[key]) return BANK_BADGE_MAP[key];
  const p = BANK_BADGE_PALETTE[hashStr(key) % BANK_BADGE_PALETTE.length];
  return { bg:p.bg, fg:p.fg, initials:bankInitials(name) };
}
function bankBadgeHtml(name, size){
  const key = String(name||'').trim().toLowerCase();
  const s = size||30;
  const logo = BANK_LOGO_SVG[key];
  if(logo){
    const iconSize = Math.round(s*0.56);
    return `<span class="bank-badge bank-badge-logo" style="width:${s}px;height:${s}px;min-width:${s}px;background:#fff;border:1px solid var(--line-soft);color:${logo.color};">`
      + `<svg viewBox="0 0 24 24" width="${iconSize}" height="${iconSize}" fill="currentColor" aria-hidden="true"><path d="${logo.path}"/></svg></span>`;
  }
  const b = bankBadge(name);
  return `<span class="bank-badge" style="width:${s}px;height:${s}px;min-width:${s}px;background:${b.bg};color:${b.fg};font-size:${Math.max(9,Math.round(s*0.34))}px;">${escapeHtml(b.initials)}</span>`;
}

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
    { id:'ex_acc_1', name:'Banco XP',        kind:'conta',    balance:184320.55, asOfDate:today, order:0 },
    { id:'ex_acc_2', name:'Sicredi',         kind:'conta',    balance:96140.10,  asOfDate:today, order:1 },
    { id:'ex_acc_3', name:'CEF Itabuna',     kind:'conta',    balance:22150.10,  asOfDate:today, order:2 },
    { id:'ex_acc_3b',name:'CEF Salvador',    kind:'conta',    balance:14300.80,  asOfDate:today, order:3 },
    { id:'ex_acc_3c',name:'CEF Transitória', kind:'conta',    balance:4799.40,   asOfDate:today, order:4 },
    { id:'ex_acc_4', name:'Santander',       kind:'conta',    balance:28870.00,  asOfDate:today, order:5 },
    { id:'ex_acc_5', name:'Mercado Pago',    kind:'conta',    balance:12640.20,  asOfDate:today, order:6 },
    { id:'ex_acc_6', name:'BTG Pactual',     kind:'aplicacao',balance:620000.00, asOfDate:today, order:7 },
    { id:'ex_acc_7', name:'Azimut',          kind:'aplicacao',balance:185300.00, asOfDate:today, order:8 },
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
  const inAccounts = ['Banco XP','Sicredi','CEF Itabuna','CEF Salvador','CEF Transitória','Santander','Mercado Pago'];
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
        account: 'CEF Itabuna',
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
  // Exemplo de envio concluído mas com inconsistências (mesmo formato usado
  // pelos leitores automáticos reais) — mostra como a tela "Verificação de
  // Importação" exibe um aviso sem bloquear o carregamento.
  history.push({
    id:'ex_hist_aviso', bank:'CEF Salvador',
    filename:'extrato_cef_salvador_exemplo.xlsx',
    status:'concluido', rowCount:84,
    errorMessage: JSON.stringify({ issues: buildParseIssues({
      errorCount: 0, unmappedCodes: new Map([['TAR NOVA', 2]]),
    }) }),
    at: addDaysISO(today,-3).concat('T09:40:00.000Z'),
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

/* ==== LEITURA AUTOMÁTICA DE EXTRATOS POR BANCO ====
 * Cada banco exporta o extrato sempre no mesmo layout fixo — por isso, para
 * estes bancos, pulamos o assistente genérico de mapeamento de colunas: o
 * usuário só escolhe o banco e o arquivo, e o painel já sabe onde está cada
 * coluna. Mapeamento levantado a partir de extratos reais (mai–ago/2026) de
 * cada banco. Se o banco mudar o layout do extrato no futuro, o parser
 * falha de forma controlada (mensagem de erro), em vez de ler dado errado —
 * nesse caso o mapeamento aqui precisa ser atualizado. */

function findExactHeaderRow(matrix, requiredCols, maxScan){
  const limit = Math.min(matrix.length, maxScan||25);
  for(let r=0;r<limit;r++){
    const row = matrix[r]||[];
    if(requiredCols.every(rc => rc.re.test(normalizeTypeText(row[rc.index])))) return r;
  }
  return -1;
}

// Nomes de mês em português (sem acento) para datas por extenso, ex.:
// "Segunda, 31 de agosto de 2026" (Santander).
const MONTH_NAMES_NORM = MONTH_NAMES.map(m=>normalizeTypeText(m));
function parsePtLongDate(s){
  if(!s) return null;
  const norm = normalizeTypeText(s);
  const m = norm.match(/(\d{1,2})\s+de\s+([a-z]+)\s+de\s+(\d{4})/);
  if(!m) return null;
  const day = +m[1], monName = m[2], year = +m[3];
  const monIdx = MONTH_NAMES_NORM.indexOf(monName);
  if(monIdx<0) return null;
  return isoFromParts(year, monIdx+1, day);
}
// CEF exporta a data como número AAAAMMDD (ex.: 20260803).
function parseCEFDateInt(v){
  const s = String(typeof v==='number' ? Math.trunc(v) : v).trim();
  const m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
  if(!m) return null;
  return isoFromParts(+m[1], +m[2], +m[3]);
}

function toTitleCasePt(s){
  const small = new Set(['de','da','do','das','dos','e','em','para','com','a','o']);
  return String(s||'').trim().toLowerCase().split(/\s+/).map((w,i)=>{
    if(!w) return w;
    if(i>0 && small.has(w)) return w;
    return w[0].toUpperCase()+w.slice(1);
  }).join(' ');
}

/* Regras de consolidação de descrição: descrições brutas de extrato costumam
 * vir com um sufixo variável (CPF/CNPJ do favorecido + nome truncado) que
 * torna cada lançamento único mesmo quando são o mesmo tipo de movimento —
 * ex.: "RECEBIMENTO PIX 27215016587 EVA CARDOSO DE OLIVE". Para a
 * diretoria, o que importa é o tipo do lançamento — por isso normalizamos a
 * descrição para um rótulo consolidado ("Recebimento PIX") e guardamos o
 * complemento (nome/CPF-CNPJ) na coluna Categoria, que continua
 * pesquisável (campo de busca inclui descrição + categoria + conta). A
 * ordem importa: regras mais específicas primeiro, catch-alls por último. */
const DESC_CONSOLIDATION_RULES = [
  { re: /^RECEBIMENTO\s+PIX\b/i, label: 'Recebimento PIX' },
  { re: /^PIX\s+RECEBIDO\b/i, label: 'Recebimento PIX' },
  { re: /^CRED\.?\s*PIX\b/i, label: 'Recebimento PIX' },
  { re: /^PAGAMENTO\s+PIX\b/i, label: 'Pagamento PIX' },
  { re: /^PIX\s+ENVIADO\b/i, label: 'Pagamento PIX' },
  { re: /^TARIFA\s+AVULSA\s+ENVIO\s+PIX\b/i, label: 'Tarifa — envio de PIX' },
  { re: /^TRANSF(?:ERENCIA)?\s+ENTRE\s+CONTAS\b/i, label: 'Transferência entre contas' },
  { re: /^DOC\s*\/\s*TED\s+INTERNET\s+PJ\b/i, label: 'Tarifa — DOC/TED' },
  { re: /^DEBITO\s+TED\s*\/\s*IB\b/i, label: 'Transferência enviada (TED)' },
  { re: /^ENVIO\s+TED\b/i, label: 'Transferência enviada (TED)' },
  { re: /^ENVIO\s+TEV\b/i, label: 'Transferência enviada (TEV)' },
  { re: /^CRED\.?\s*TED\b/i, label: 'Recebimento (TED)' },
  { re: /^CRED\.?\s*TEV\b/i, label: 'Recebimento (TEV)' },
  { re: /^COB\s*TED\b/i, label: 'Cobrança (TED)' },
  { re: /^TED\b/i, label: 'Transferência (TED)' },
  { re: /^DEP(?:OSITO)?\s+DINHEIRO\b/i, label: 'Depósito em dinheiro' },
  { re: /^DEBITO\s+CONVENIOS\b/i, label: 'Débito de convênio' },
  { re: /^DEBITO\s+ARRECADACAO\b/i, label: 'Débito de arrecadação' },
  { re: /^LIQUIDACAO\s+DE\s+PARCELA\b/i, label: 'Liquidação de parcela' },
  { re: /^BLOQUEIO\s+JUDICIAL\b/i, label: 'Bloqueio judicial de valor' },
  { re: /^CRED\.?\s*DESBLOQUEIO\s+JUDICIAL\b/i, label: 'Desbloqueio judicial de valor' },
  { re: /^INTEGR\.?\s*CAPITAL\s+SUBSCRITO\b/i, label: 'Integralização de capital' },
  { re: /^LIQUIDACAO\s+BOLETO\b/i, label: 'Pagamento de boleto' },
  { re: /^PAG\s+BOLETO\b/i, label: 'Pagamento de boleto' },
  { re: /^TARIFA\s+PAGAMENTO\s+BOLETO\s+VIA\s+QRCODE\b/i, label: 'Tarifa — pagamento de boleto (QR Code)' },
  { re: /^PAGAMENTO\s+CARTAO\s+DE\s+CREDITO\b/i, label: 'Pagamento de fatura de cartão' },
  { re: /^PAGAMENTO\s+CARTAO\s+DE\s+DEBITO\b/i, label: 'Compra no cartão de débito' },
  { re: /^DEB\.?\s*CTA\.?\s*FATURA\b/i, label: 'Pagamento de fatura (débito em conta)' },
  { re: /^APLICACAO\b/i, label: 'Aplicação financeira' },
  { re: /^RESGATE\b/i, label: 'Resgate de aplicação' },
  { re: /^CONSORCIO\b/i, label: 'Consórcio' },
  { re: /^PAG\.?\s*FONE\b/i, label: 'Pagamento de telefone' },
  { re: /^PAG\s+AGUA\b/i, label: 'Pagamento de água' },
  { re: /^PG\s*LUZ\s*\/?\s*GAS\b/i, label: 'Pagamento de luz/gás' },
  { re: /^PG\s*ORG\s*GOV\b/i, label: 'Pagamento a órgão governamental' },
  { re: /^PREST\.?\s*EMPR\b/i, label: 'Prestação de empréstimo' },
  { re: /^DB\s*T\s*CESTA\b/i, label: 'Tarifa — cesta de serviços' },
  { re: /^TAR\.?\s*MAN\s*CC\b/i, label: 'Tarifa — manutenção de conta' },
  { re: /^TARIFA\s+MENSALIDADE\s+PACOTE\s+SERVICOS\b/i, label: 'Tarifa — mensalidade de pacote de serviços' },
  { re: /^TAR\s*LIQ\s*COB/i, label: 'Tarifa — liquidação de cobrança' },
  { re: /^TAR\s*BAIXA\s*COB/i, label: 'Tarifa — baixa de cobrança' },
  { re: /^COB\s*MAN/i, label: 'Tarifa — manutenção de cobrança' },
  { re: /^COB\s*BX/i, label: 'Tarifa — baixa de cobrança' },
  { re: /^COB\s*COMPE\b/i, label: 'Cobrança compensada' },
  { re: /^COB\s*LOT/i, label: 'Cobrança — lotérica' },
  { re: /^COB\s*INTERN/i, label: 'Cobrança — internet banking' },
  { re: /^DEB\s*COB\s*AT/i, label: 'Débito de cobrança em atraso' },
  { re: /^CR\s*COB\b/i, label: 'Cobrança compensada' },
  { re: /^BLQ\s*VLR\s*JD\b/i, label: 'Bloqueio judicial de valor' },
  { re: /^DBLQ\s*VL\s*JD\b/i, label: 'Desbloqueio judicial de valor' },
  { re: /^SAQUE\b/i, label: 'Saque' },
  { re: /^DEBITO\s+CHEQUE\b/i, label: 'Cheque compensado' },
  { re: /^CHEQUE\b/i, label: 'Cheque' },
  { re: /^TAR(?:IFA)?\b/i, label: 'Tarifa bancária' },
  { re: /^COB\b/i, label: 'Cobrança' },
];
// O terceiro campo, "matched", indica se uma regra de DESC_CONSOLIDATION_RULES
// realmente reconheceu a descrição (true) ou se caímos num dos fallbacks
// genéricos (false) — usado pela tela de Verificação de Importação para
// contar quantos lançamentos de um extrato ficaram com o texto original do
// banco em vez de um rótulo consolidado.
function consolidateDescription(raw){
  const s = String(raw||'').trim();
  if(!s) return { label:'Lançamento', detail:'', matched:true };
  for(const rule of DESC_CONSOLIDATION_RULES){
    if(rule.re.test(s)){
      const rest = s.replace(rule.re,'').trim().replace(/^\d{11,14}\s*/,'').trim();
      return { label: rule.label, detail: rest, matched:true };
    }
  }
  // Nenhuma regra bateu: se ainda assim houver um CPF/CNPJ embutido no meio
  // do texto, separamos o prefixo (vira o rótulo) do CPF/CNPJ+nome (vira o
  // complemento) — rede de segurança para tipos de lançamento não previstos
  // nas regras acima, para não deixar número de documento solto no rótulo.
  const m = s.match(/^(.*?)\s+(\d{11,14})\s+(.+)$/);
  if(m) return { label: toTitleCasePt(m[1]), detail: m[3].trim(), matched:false };
  return { label: toTitleCasePt(s), detail:'', matched:false };
}

// Monta a lista de "issues" (inconsistências) encontradas ao ler
// automaticamente um extrato — alimenta a tela "Verificação de Importação"
// (log de inconsistências + sugestão do que fazer para resolver, visível só
// para o financeiro). Cada issue: { code, message, count, suggestion }.
function buildParseIssues({ errorCount, fallbackCount, fallbackSamples, unmappedCodes }){
  const issues = [];
  if(errorCount>0){
    issues.push({
      code:'linhas_ignoradas',
      message: `${errorCount} linha${errorCount===1?'':'s'} do arquivo não p${errorCount===1?'ô':'u'}de${errorCount===1?'':'ram'} ser lida${errorCount===1?'':'s'} (data ou valor em formato inesperado) e ${errorCount===1?'foi':'foram'} ignorada${errorCount===1?'':'s'}.`,
      count: errorCount,
      suggestion: 'Confira se o arquivo é o extrato original exportado direto do banco, sem edições manuais (linhas ou colunas movidas, por exemplo). Se o problema persistir, envie o arquivo para revisão.',
    });
  }
  if(fallbackCount>0){
    const sample = (fallbackSamples||[]).slice(0,3).map(s=>`"${s}"`).join(', ');
    issues.push({
      code:'descricao_nao_consolidada',
      message: `${fallbackCount} lançamento${fallbackCount===1?'':'s'} com descrição não reconhecida por nenhuma regra de consolidação${sample?` (ex.: ${sample})`:''} — ${fallbackCount===1?'ficou':'ficaram'} com o texto original do banco.`,
      count: fallbackCount,
      suggestion: 'Não impede o uso do painel — o lançamento aparece normalmente, só não foi resumido a um rótulo padrão. Se esse tipo de descrição for frequente, avise para adicionarmos uma regra de consolidação para ela.',
    });
  }
  if(unmappedCodes && unmappedCodes.size>0){
    const codes = [...unmappedCodes.keys()].slice(0,5).join(', ');
    const total = [...unmappedCodes.values()].reduce((a,b)=>a+b,0);
    issues.push({
      code:'codigo_cef_nao_mapeado',
      message: `${total} lançamento${total===1?'':'s'} com código de histórico da Caixa ainda não mapeado (${codes}) — exibido${total===1?'':'s'} com o código original em vez de uma descrição.`,
      count: total,
      suggestion: 'Confira o significado do código no extrato original (ou com o gerente da conta) e avise para adicionarmos ao dicionário de tradução da Caixa.',
    });
  }
  return issues;
}

// Códigos do "Historico" da CEF — abreviações fixas do sistema bancário,
// sem nome de favorecido embutido. Mapeamento levantado a partir dos
// extratos reais das 3 contas (mai–ago/2026). Código não mapeado cai no
// nome original (title case), para nunca esconder um lançamento.
const CEF_HISTORICO_MAP = {
  'PAG BOLETO': 'Pagamento de boleto',
  'CONSORCIO': 'Consórcio',
  'PAG FONE': 'Pagamento de telefone',
  'PAG AGUA': 'Pagamento de água',
  'PG LUZ/GAS': 'Pagamento de luz/gás',
  'PG ORG GOV': 'Pagamento a órgão governamental',
  'ENVIO TEV': 'Transferência enviada (TEV)',
  'ENVIO TED': 'Transferência enviada (TED)',
  'CRED TEV': 'Recebimento (TEV)',
  'CRED TED': 'Recebimento (TED)',
  'CRED PIX': 'Recebimento PIX',
  'COB TED': 'Cobrança (TED)',
  'COB COMPE': 'Cobrança compensada',
  'COB MAN061': 'Tarifa — manutenção de cobrança',
  'COB BX 063': 'Tarifa — baixa de cobrança',
  'COB LOT DH': 'Cobrança — lotérica (dinheiro)',
  'COB LOTERI': 'Tarifa — cobrança lotérica',
  'COB INTERN': 'Cobrança — internet banking',
  'DEB COB AT': 'Débito de cobrança em atraso',
  'TAR TEV AG': 'Tarifa — TEV',
  'TAR MAN CC': 'Tarifa — manutenção de conta',
  'TAR REN CA': 'Tarifa — renovação cadastral',
  'DB T CESTA': 'Tarifa — cesta de serviços',
  'PREST EMPR': 'Prestação de empréstimo',
  'BLQ VLR JD': 'Bloqueio judicial de valor',
  'DBLQ VL JD': 'Desbloqueio judicial de valor',
  'DQ SOL DB': 'Solicitação de débito',
  'SOL DB BLV': 'Solicitação de débito (bloqueio de valor)',
  'BQ SOL CR': 'Bloqueio de solicitação de crédito',
  'SOL CR BLQ': 'Solicitação de crédito bloqueado',
  'DQ TR VLR': 'Transferência de valor',
  'TR VLR OU': 'Transferência de valor (outra conta)',
};

/* ---- Sicredi: aba única "Extrato". Cabeçalho fixo Data/Descrição/
 * Documento/Valor (R$)/Saldo (R$); logo abaixo, uma linha "Saldo Anterior".
 * O Valor já vem com sinal (positivo=crédito, negativo=débito). Depois da
 * lista de lançamentos realizados, o arquivo ainda traz um bloco
 * "Lançamentos Futuros (Próximos 30 dias)" no mesmo formato (sem
 * Documento/Saldo) — lemos como previsto. */
function parseSicrediWorkbook(wb, accountName){
  const sheetName = wb.SheetNames.find(n=>/extrato/i.test(n)) || wb.SheetNames[0];
  // sheetToMatrix usa blankrows:false — linhas totalmente em branco são
  // removidas pelo próprio SheetJS, então não existe "linha vazia" no
  // resultado para marcar o fim da lista de lançamentos. Em vez disso,
  // procuramos o marcador de texto "Saldo da Conta em ..." que a Sicredi
  // sempre imprime logo depois do último lançamento realizado.
  const matrix = sheetToMatrix(wb, sheetName);
  const headerIdx = findExactHeaderRow(matrix, [
    {index:0, re:/^data$/}, {index:1, re:/descri/}, {index:4, re:/saldo/},
  ]);
  if(headerIdx<0){ const e = new Error('sicredi-header-not-found'); throw e; }
  let endIdx = matrix.length;
  for(let r=headerIdx+1; r<matrix.length; r++){
    const c0 = normalizeTypeText((matrix[r]||[])[0]);
    if(/^saldo da conta/.test(c0)){ endIdx = r; break; }
  }
  const rows = [];
  let errorCount = 0;
  let fallbackCount = 0; const fallbackSamples = [];
  let lastBalance = null, lastDate = null;
  for(let r=headerIdx+1; r<endIdx; r++){
    const row = matrix[r];
    if(!row) continue;
    const desc = String(row[1]||'').trim();
    const dateRaw = row[0];
    const dateEmpty = (dateRaw===null||dateRaw===undefined||dateRaw==='');
    if(dateEmpty && /saldo anterior/i.test(desc)){ continue; }
    const date = parseDateCell(dateRaw);
    if(!date){ if(desc) errorCount++; continue; }
    const valor = parseNumberCell(row[3]);
    if(isNaN(valor) || valor===0) continue;
    const { label, detail, matched } = consolidateDescription(desc);
    if(!matched){ fallbackCount++; if(fallbackSamples.length<5) fallbackSamples.push(desc); }
    const saldo = parseNumberCell(row[4]);
    if(!isNaN(saldo)){ lastBalance = saldo; lastDate = date; }
    rows.push({
      date, type: valor>0 ? 'recebimento':'pagamento', status:'realizado',
      value: Math.abs(valor), account: accountName, category: detail || label,
      description: label,
    });
  }
  // bloco opcional "Lançamentos Futuros" (mesmas colunas Data/Descrição/
  // Valor, sem Documento/Saldo) — vem depois do marcador de saldo.
  let futIdx = -1;
  for(let i=endIdx;i<matrix.length;i++){
    const c0 = normalizeTypeText((matrix[i]||[])[0]);
    if(/lancamentos futuros/.test(c0)){ futIdx = i; break; }
  }
  if(futIdx>=0){
    const futHeader = findExactHeaderRow(matrix.slice(futIdx), [{index:0,re:/^data$/},{index:1,re:/descri/}], 5);
    const start = futIdx + (futHeader>=0?futHeader:1) + 1;
    for(let i=start;i<matrix.length;i++){
      const row = matrix[i];
      if(!row) break;
      const desc = String(row[1]||'').trim();
      const date = parseDateCell(row[0]);
      if(!date || !desc) break;
      const valor = parseNumberCell(row[2]);
      if(isNaN(valor) || valor===0) continue;
      const { label, detail, matched } = consolidateDescription(desc);
      if(!matched){ fallbackCount++; if(fallbackSamples.length<5) fallbackSamples.push(desc); }
      rows.push({
        date, type: valor>0?'recebimento':'pagamento', status:'previsto',
        value: Math.abs(valor), account: accountName, category: detail || label,
        description: label,
      });
    }
  }
  const issues = buildParseIssues({ errorCount, fallbackCount, fallbackSamples });
  return { rows, errorCount, meta: { lastBalance, lastDate }, issues };
}

/* ---- Santander: aba única (nome do arquivo/aba variável). Título + linha
 * do titular + período nas primeiras linhas; cabeçalho fixo Data/Descrição/
 * Crédito (R$)/Débito (R$); data por extenso ("Segunda, 31 de agosto de
 * 2026"); última linha é um total (Descrição="TOTAL"), que ignoramos. Não
 * traz saldo por lançamento. */
function parseSantanderWorkbook(wb, accountName){
  const sheetName = wb.SheetNames[0];
  const matrix = sheetToMatrix(wb, sheetName);
  const headerIdx = findExactHeaderRow(matrix, [
    {index:0, re:/^data$/}, {index:1, re:/descri/},
  ]);
  if(headerIdx<0){ const e = new Error('santander-header-not-found'); throw e; }
  const rows = [];
  let errorCount = 0;
  let fallbackCount = 0; const fallbackSamples = [];
  for(let r=headerIdx+1; r<matrix.length; r++){
    const row = matrix[r];
    if(!row) continue;
    const desc = String(row[1]||'').trim();
    if(desc.toUpperCase()==='TOTAL') continue;
    if(!desc && (row[2]==null||row[2]==='') && (row[3]==null||row[3]==='')) continue;
    const date = parsePtLongDate(row[0]);
    if(!date){ if(desc) errorCount++; continue; }
    const { label, detail, matched } = consolidateDescription(desc);
    if(!matched){ fallbackCount++; if(fallbackSamples.length<5) fallbackSamples.push(desc); }
    const credito = numOrZero(row[2]);
    const debito = numOrZero(row[3]);
    if(credito>0){
      rows.push({ date, type:'recebimento', status:'realizado', value:credito, account:accountName, category: detail||label, description: label });
    }
    if(debito>0){
      rows.push({ date, type:'pagamento', status:'realizado', value:debito, account:accountName, category: detail||label, description: label });
    }
    if(credito<=0 && debito<=0) errorCount++;
  }
  const issues = buildParseIssues({ errorCount, fallbackCount, fallbackSamples });
  return { rows, errorCount, meta:{}, issues };
}

/* ---- CEF (Caixa): sem cabeçalho de texto — a primeira linha já é o
 * cabeçalho de colunas fixo Conta/Data_Mov/Nr_Doc/Historico/Valor/
 * Deb_Cred. Data em AAAAMMDD, Valor em texto com ponto decimal, Deb_Cred =
 * "D"/"C". Historico é um código curto (sem nome de favorecido embutido) —
 * traduzido via CEF_HISTORICO_MAP. As 3 contas da Caixa (Itabuna/Salvador/
 * Transitória) usam exatamente este mesmo layout — accountName é passado
 * pelo chamador para identificar qual delas. */
function parseCEFWorkbook(wb, accountName){
  const sheetName = wb.SheetNames[0];
  const matrix = sheetToMatrix(wb, sheetName);
  const headerIdx = findExactHeaderRow(matrix, [
    {index:1, re:/data.?mov/}, {index:3, re:/historico/}, {index:4, re:/valor/},
  ], 5);
  if(headerIdx<0){ const e = new Error('cef-header-not-found'); throw e; }
  const rows = [];
  let errorCount = 0;
  const unmappedCodes = new Map();
  for(let r=headerIdx+1; r<matrix.length; r++){
    const row = matrix[r];
    if(!row) continue;
    const date = parseCEFDateInt(row[1]);
    if(!date){ if(row[3]) errorCount++; continue; }
    const valor = parseNumberCell(row[4]);
    if(isNaN(valor) || valor===0) continue;
    const dc = String(row[5]||'').trim().toUpperCase();
    if(dc!=='C' && dc!=='D'){ errorCount++; continue; }
    const rawHist = String(row[3]||'').trim();
    const histKey = rawHist.toUpperCase();
    const mapped = CEF_HISTORICO_MAP[histKey];
    const label = mapped || toTitleCasePt(rawHist);
    if(!mapped && rawHist) unmappedCodes.set(histKey, (unmappedCodes.get(histKey)||0)+1);
    rows.push({
      date, type: dc==='C'?'recebimento':'pagamento', status:'realizado',
      value: Math.abs(valor), account: accountName, category: rawHist, description: label,
    });
  }
  const issues = buildParseIssues({ errorCount, unmappedCodes });
  return { rows, errorCount, meta:{}, issues };
}

// Registro dos bancos com leitura automática — ao escolher um destes no
// assistente de carregamento, pulamos direto para a prévia (sem os passos
// de "formato dos valores" e "mapear colunas"). As 3 contas CEF (Itabuna,
// Salvador, Transitória) usam o mesmo layout de extrato — o mesmo parser
// (parseCEFWorkbook) atende as 3, cada uma como uma fonte separada.
const BANK_PARSERS = {
  'Sicredi': parseSicrediWorkbook,
  'Santander': parseSantanderWorkbook,
  'CEF Itabuna': parseCEFWorkbook,
  'CEF Salvador': parseCEFWorkbook,
  'CEF Transitória': parseCEFWorkbook,
};
function knownBankParser(){
  return (wz && BANK_PARSERS[wz.sourceName]) || null;
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
  verificationBankFilter: '',
  descMatrixPage: 1,                 // página atual (1-based) da matriz por descrição, em lançamentos
  descMatrixPageSize: DESC_MATRIX_PAGE_SIZE, // quantos lançamentos cada página mostra
  bankPositionExpanded: false,      // "Ver todos os bancos" — mostra todas as contas, não só as primeiras
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
  const avatarEl = document.getElementById('avatarCircle');
  if(avatarEl) avatarEl.textContent = bankInitials(session ? (session.nome || session.username) : '?');
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
    setSync('on', 'Atualizado ' + friendlyUpdatedAt(new Date()));
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

function friendlyUpdatedAt(date){
  const time = date.toLocaleTimeString('pt-BR', {hour:'2-digit', minute:'2-digit'});
  const iso = date.toISOString().slice(0,10);
  const diff = daysBetweenISO(iso, todayISO());
  const dayLabel = diff===0 ? 'hoje' : diff===1 ? 'ontem' : date.toLocaleDateString('pt-BR');
  return `${dayLabel}, ${time}`;
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
  if(rangeId === 'all'){
    const today = todayISO();
    let min = today, max = today;
    transactions.forEach(t=>{ if(t.date<min) min=t.date; if(t.date>max) max=t.date; });
    return { start:min, end:max };
  }
  const m = /^(\d{4})-(\d{2})$/.exec(rangeId);
  if(m){
    const y = +m[1], mo = +m[2];
    const lastDay = new Date(y, mo, 0).getDate(); // dia 0 do mês seguinte = último dia deste mês
    return { start: isoFromParts(y, mo, 1), end: isoFromParts(y, mo, lastDay) };
  }
  return getRangeBounds(currentMonthId(), transactions); // fallback: mês atual
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

// Variação "vs. período anterior" dos KPIs, para o selo de tendência nos cards.
// Só calculamos onde dá pra comparar com dado real: Recebimentos/Pagamentos
// (somas de lançamentos realizados no período anterior de mesmo tamanho) e os
// saldos que derivam de contas-corrente (saldo atual menos o fluxo realizado
// do período = saldo de antes do período). "Aplicações" não tem histórico de
// saldo — não inventamos um número para ela, o card simplesmente não mostra
// selo de tendência.
function computeKPITrends(transactions, startISO, endISO, k){
  const spanDays = daysBetweenISO(startISO, endISO) + 1;
  const prevEnd = addDaysISO(startISO, -1);
  const prevStart = addDaysISO(prevEnd, -(spanDays-1));

  let prevReceived=0, prevPaid=0, netCurrentRealized=0, netCurrentAll=0;
  transactions.forEach(t=>{
    if(t.date>=prevStart && t.date<=prevEnd && t.status==='realizado'){
      if(t.type==='recebimento') prevReceived += t.value; else prevPaid += t.value;
    }
    if(t.date>=startISO && t.date<=endISO){
      const signed = t.type==='recebimento' ? t.value : -t.value;
      if(t.status==='realizado') netCurrentRealized += signed;
      netCurrentAll += signed;
    }
  });

  const prevBankBalance = k.bankBalance - netCurrentRealized;
  const prevProjectedBalance = k.projectedBalance - netCurrentAll;
  const prevTotalBalance = prevBankBalance + k.investBalance; // aplicações tratada como constante (sem histórico)

  const pct = (curr, prev)=>{
    if(prev===0) return curr===0 ? 0 : null;
    return ((curr-prev)/Math.abs(prev))*100;
  };
  return {
    bankBalance: pct(k.bankBalance, prevBankBalance),
    receivedRealizedTotal: pct(k.receivedRealizedTotal, prevReceived),
    paidRealizedTotal: pct(k.paidRealizedTotal, prevPaid),
    projectedBalance: pct(k.projectedBalance, prevProjectedBalance),
    totalBalance: pct(k.totalBalance, prevTotalBalance),
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

// Diário: um lançamento por dia do período com Entradas, Saídas e Saldo
// acumulado — o saldo acumulado reconcilia com o saldo bancário real (contas
// corrente, sem aplicações), não é só uma soma de lançamentos.
function computeDiarioSeries(transactions, startISO, endISO, bankBalance){
  const daily = computeDailySeries(transactions, startISO, endISO);
  const cumulative = computeCumulativeSeries(transactions, daily, bankBalance);
  return daily.map((d,i)=>({
    date: d.date,
    entradas: d.inRealized + d.inForecast,
    saidas: d.outRealized + d.outForecast,
    saldo: cumulative[i].balance,
  }));
}

function renderDiario(transactions, kpis, startISO, endISO){
  const body = document.getElementById('diarioBody');
  const cards = document.getElementById('diarioCards');
  const footer = document.getElementById('diarioFooter');
  const period = document.getElementById('diarioPeriod');
  if(!body && !cards) return;
  if(period) period.textContent = `${formatDateBR(startISO)} a ${formatDateBR(endISO)}`;

  const series = computeDiarioSeries(transactions, startISO, endISO, kpis.bankBalance);
  const today = todayISO();
  const movementDays = series.filter(d=>d.entradas||d.saidas).length;

  if(footer) footer.textContent = `${series.length} dia${series.length===1?'':'s'} no período • ${movementDays} com movimentação • saldo acumulado reconciliado com o saldo bancário`;

  const dateCell = d => `${formatDateBR(d.date)}${d.date>today ? ` <span class="pill pill-previsto">Previsto</span>` : ''}`;

  if(body){
    body.innerHTML = series.length ? series.map(d=>`
      <tr>
        <td class="matrix-date">${dateCell(d)}</td>
        <td class="num-col num matrix-in">${d.entradas ? '+'+formatBRL(d.entradas,true) : '—'}</td>
        <td class="num-col num matrix-out">${d.saidas ? '-'+formatBRL(d.saidas,true) : '—'}</td>
        <td class="num-col num matrix-net ${d.saldo<0?'neg':'pos'}">${formatBRL(d.saldo,true)}</td>
      </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state">Nenhum dia neste período.</div></td></tr>`;
  }
  if(cards){
    cards.innerHTML = series.length ? series.map(d=>`
      <div class="matrix-day-card">
        <div class="matrix-day-card-date">${dateCell(d)}</div>
        <div class="matrix-day-card-row"><span>Entradas</span><b class="num matrix-in">${d.entradas?'+'+formatBRL(d.entradas,true):'—'}</b></div>
        <div class="matrix-day-card-row"><span>Saídas</span><b class="num matrix-out">${d.saidas?'-'+formatBRL(d.saidas,true):'—'}</b></div>
        <div class="matrix-day-card-net ${d.saldo<0?'neg':'pos'}"><span>Saldo acumulado</span><span class="num">${formatBRL(d.saldo,true)}</span></div>
      </div>`).join('') : `<div class="empty-state">Nenhum dia neste período.</div>`;
  }
}

/* ==== RENDER: POSIÇÃO POR BANCO ==== */
function isAccountFresh(asOfDate){
  if(!asOfDate) return false;
  return daysBetweenISO(asOfDate, todayISO()) <= ACCOUNT_STALE_DAYS;
}
function freshnessPillHtml(asOfDate){
  const fresh = isAccountFresh(asOfDate);
  return `<span class="pill ${fresh?'pill-fresh':'pill-stale'}">${fresh?'Atualizada':'Desatualizada'}</span>`;
}

function renderBankPosition(accounts, transactions){
  const body = document.getElementById('bankPositionBody');
  const foot = document.getElementById('bankPositionFoot');
  const cards = document.getElementById('bankPositionCards');
  const toggleWrap = document.getElementById('bankPositionToggleWrap');
  const toggleBtn = document.getElementById('btnBankPositionToggle');
  if(!body && !cards) return;
  const editable = !state.usingDemo && state.canEdit;
  const kindLabel = { conta:'Conta corrente', aplicacao:'Aplicação' };
  const sorted = [...accounts].sort((a,b)=>(a.order??0)-(b.order??0));

  const allRows = sorted.map(a=>{
    let receivable=0, payable=0;
    transactions.forEach(t=>{
      if(t.account!==a.name || t.status!=='previsto') return;
      if(t.type==='recebimento') receivable += t.value; else payable += t.value;
    });
    const projected = (Number(a.balance)||0) + receivable - payable;
    return { account:a, receivable, payable, projected };
  });
  const showAll = state.bankPositionExpanded || allRows.length <= BANK_POSITION_VISIBLE;
  const rows = showAll ? allRows : allRows.slice(0, BANK_POSITION_VISIBLE);

  if(toggleWrap){
    toggleWrap.hidden = allRows.length <= BANK_POSITION_VISIBLE;
    if(toggleBtn) toggleBtn.textContent = state.bankPositionExpanded ? 'Ver menos' : 'Ver todos os bancos';
  }

  if(body){
    body.innerHTML = rows.length ? rows.map(r=>`
      <tr>
        <td><div class="bank-name-cell">${bankBadgeHtml(r.account.name,26)}<span>${escapeHtml(r.account.name)}</span></div></td>
        <td>${kindLabel[r.account.kind]||r.account.kind}</td>
        <td class="num-col num">${formatBRL(r.account.balance,true)}</td>
        <td class="num-col num matrix-in">${formatBRL(r.receivable,true)}</td>
        <td class="num-col num matrix-out">${formatBRL(r.payable,true)}</td>
        <td class="num-col num matrix-net ${r.projected<0?'neg':r.projected>0?'pos':''}">${formatBRL(r.projected,true)}</td>
        <td>${freshnessPillHtml(r.account.asOfDate)} <span class="num bank-position-date">${formatDateBR(r.account.asOfDate)}</span></td>
        <td class="bp-actions-col">${editable ? `<button class="icon-btn" data-edit-acc="${r.account.id}" title="Editar conta">&#9998;</button>` : ''}</td>
      </tr>`).join('') : `<tr><td colspan="8"><div class="empty-state">Nenhuma conta cadastrada.</div></td></tr>`;
    body.querySelectorAll('[data-edit-acc]').forEach(btn=>{
      btn.onclick = ()=> openAccountModal(accounts.find(a=>a.id===btn.dataset.editAcc));
    });
  }
  if(foot){
    if(allRows.length){
      const totBal = allRows.reduce((s,r)=>s+(Number(r.account.balance)||0),0);
      const totRecv = allRows.reduce((s,r)=>s+r.receivable,0);
      const totPay = allRows.reduce((s,r)=>s+r.payable,0);
      const totProj = allRows.reduce((s,r)=>s+r.projected,0);
      foot.innerHTML = `<tr>
        <td>Total</td><td></td>
        <td class="num-col num">${formatBRL(totBal,true)}</td>
        <td class="num-col num matrix-in">${formatBRL(totRecv,true)}</td>
        <td class="num-col num matrix-out">${formatBRL(totPay,true)}</td>
        <td class="num-col num matrix-net ${totProj<0?'neg':totProj>0?'pos':''}">${formatBRL(totProj,true)}</td>
        <td>—</td>
        <td></td>
      </tr>`;
    } else {
      foot.innerHTML = '';
    }
  }

  if(cards){
    cards.innerHTML = rows.length ? rows.map(r=>`
      <div class="bank-card">
        <div class="bank-card-head">
          ${bankBadgeHtml(r.account.name,32)}
          <div class="bank-card-head-text">
            <span class="bank-card-name">${escapeHtml(r.account.name)}</span>
            <span class="bank-card-kind">${kindLabel[r.account.kind]||r.account.kind}</span>
          </div>
          ${editable ? `<button class="icon-btn" data-edit-acc="${r.account.id}" title="Editar conta">&#9998;</button>` : ''}
        </div>
        <div class="bank-card-balance num">${formatBRL(r.account.balance,true)}</div>
        <div class="bank-card-foot">
          <span class="num bank-position-date">${formatDateBR(r.account.asOfDate)}</span>
          ${freshnessPillHtml(r.account.asOfDate)}
        </div>
        <details class="bank-card-more">
          <summary>Ver detalhes</summary>
          <div class="bank-card-more-body">
            <span>A receber: <b class="num">${formatBRL(r.receivable,true)}</b></span>
          </div>
          <div class="bank-card-more-body">
            <span>A pagar: <b class="num">${formatBRL(r.payable,true)}</b></span>
          </div>
          <div class="bank-card-more-body">
            <span>Projetado: <b class="num ${r.projected<0?'neg':r.projected>0?'pos':''}">${formatBRL(r.projected,true)}</b></span>
          </div>
        </details>
      </div>`).join('') : `<div class="empty-state">Nenhuma conta cadastrada.</div>`;
    cards.querySelectorAll('[data-edit-acc]').forEach(btn=>{
      btn.onclick = ()=> openAccountModal(accounts.find(a=>a.id===btn.dataset.editAcc));
    });
  }
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
function trendHtml(pct){
  if(pct===null || pct===undefined || !isFinite(pct)) return '';
  const up = pct >= 0;
  const cls = up ? 'pos' : 'neg';
  const arrow = up ? '&#8593;' : '&#8595;';
  return `<div class="kpi-trend ${cls}"><span aria-hidden="true">${arrow}</span> ${Math.abs(pct).toLocaleString('pt-BR',{maximumFractionDigits:2})}% <span class="kpi-trend-label">vs. período anterior</span></div>`;
}

function renderKPIs(k, trends){
  const t = trends || {};
  const tiles = [
    { label:'Saldo bancário', value: formatBRL(k.bankBalance), icon:'bank', iconCls:'', trend: t.bankBalance },
    { label:'Recebimentos', value: formatBRL(k.receivedRealizedTotal), icon:'arrowDownLeft', iconCls:'in', cls:'pos', trend: t.receivedRealizedTotal,
      sub: `A receber: ${formatBRL(k.receivableForecast)}` },
    { label:'Pagamentos realizados', value: formatBRL(k.paidRealizedTotal), icon:'arrowUpRight', iconCls:'out', cls:'neg', trend: t.paidRealizedTotal,
      sub: `A pagar: ${formatBRL(k.payableForecast)}` },
    { label:'Saldo projetado', value: formatBRL(k.projectedBalance), icon:'trendingUp', iconCls: k.projectedBalance<0?'out':'in',
      cls: k.projectedBalance<0?'neg':'pos', trend: t.projectedBalance },
    { label:'Aplicações', value: formatBRL(k.investBalance), icon:'clock', iconCls:'', sub:'Investimentos e reservas' },
    { label:'Saldo total disponível', value: formatBRL(k.totalBalance), icon:'wallet', iconCls:'accent', strong:true, trend: t.totalBalance },
  ];
  document.getElementById('kpiRow').innerHTML = tiles.map(tile=>`
    <div class="kpi-tile">
      <div class="kpi-icon ${tile.iconCls}">${svgIcon(tile.icon,18)}</div>
      <div class="kpi-label">${escapeHtml(tile.label)}</div>
      <div class="kpi-value num ${tile.cls||''}">${tile.value}</div>
      ${tile.trend!==undefined ? trendHtml(tile.trend) : ''}
      ${tile.sub?`<div class="kpi-sub">${escapeHtml(tile.sub)}</div>`:''}
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

function renderProjectionLegend(){
  const el = document.getElementById('dailyLegend');
  if(!el) return;
  el.innerHTML = `
    <div class="legend-item"><span class="legend-swatch" style="background:var(--accent)"></span>Realizado / projetado</div>
    <div class="legend-item"><span class="legend-swatch dashed" style="border-color:var(--accent)"></span>Projeção</div>
  `;
}

function drawCumulativeChart(series){
  const W=960, H=260, mL=54, mR=12, mT=20, mB=24;
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
    todayLine = svgEl('line',{x1:tx,x2:tx,y1:mT,y2:H-mB,stroke:'var(--ink-muted)','stroke-width':1,'stroke-dasharray':'2,3'})
      + `<text x="${tx}" y="${mT-6}" text-anchor="middle" font-size="9.5" fill="var(--ink-muted)">Hoje</text>`;
  }

  const gradDefs = `<defs><linearGradient id="cumAreaGrad" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="var(--accent)" stop-opacity="0.22"/>
    <stop offset="100%" stop-color="var(--accent)" stop-opacity="0"/>
  </linearGradient></defs>`;
  let segs = gradDefs;
  let areaPts = `M ${x(0)} ${zeroY} `;
  for(let i=0;i<series.length;i++) areaPts += `L ${x(i)} ${y(series[i].balance)} `;
  areaPts += `L ${x(series.length-1)} ${zeroY} Z`;
  segs += `<path d="${areaPts}" fill="url(#cumAreaGrad)" stroke="none"></path>`;

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

/* ==== RENDER: FONTES ==== */
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

/* ==== RENDER: TABLE & FILTERS ==== */
function renderRangeControl(){
  const trigger = document.getElementById('headerRangeTrigger');
  const label = document.getElementById('headerRangeLabel');
  const pop = document.getElementById('headerRangePop');
  if(!trigger || !pop) return;
  const competencias = generateCompetencias();
  const active = competencias.find(r=>r.id===currentRangeId);
  if(label) label.textContent = active ? active.label : (currentRangeId==='all' ? 'Todo o período' : monthLabel(...currentRangeId.split('-').map(Number)));
  const items = competencias.map(r=>
    `<button type="button" class="range-pop-item ${r.id===currentRangeId?'active':''}" data-range="${r.id}" role="menuitemradio" aria-checked="${r.id===currentRangeId}">${escapeHtml(r.label)}</button>`
  ).join('');
  pop.innerHTML = items + `<div class="range-pop-divider"></div>` +
    `<button type="button" class="range-pop-item ${currentRangeId==='all'?'active':''}" data-range="all" role="menuitemradio" aria-checked="${currentRangeId==='all'}">Todo o período com dados</button>`;
  pop.querySelectorAll('[data-range]').forEach(btn=>{
    btn.onclick = ()=>{ currentRangeId = btn.dataset.range; pop.hidden = true; trigger.setAttribute('aria-expanded','false'); renderAll(); };
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

/* ==== RENDER: MATRIZ POR DESCRIÇÃO ==== */
// Lista única de lançamentos (entradas e saídas juntas, por descrição),
// ordenada por data — substitui as duas colunas Entradas/Pagamentos por uma
// tabela só, mais fácil de ler e de paginar.
function descMatrixRowHtml(t){
  const sign = t.type==='recebimento' ? '+' : '-';
  const cls = t.type==='recebimento' ? 'matrix-in' : 'matrix-out';
  return `<tr>
    <td class="matrix-date">${formatDateBR(t.date)}</td>
    <td>${escapeHtml(t.description||'—')}</td>
    <td>${escapeHtml(t.account||'—')}</td>
    <td class="matrix-muted">${escapeHtml(t.category||'—')}</td>
    <td class="num-col num ${cls}">${sign}${formatBRL(t.value,true)}</td>
    <td><span class="pill ${t.status==='realizado'?'pill-realizado':'pill-previsto'}">${STATUS_LABEL[t.status]||t.status}</span></td>
  </tr>`;
}
function descMatrixCardHtml(t){
  const sign = t.type==='recebimento' ? '+' : '-';
  const cls = t.type==='recebimento' ? 'in' : 'out';
  return `<div class="movement-card">
    <div class="movement-card-top">
      <div class="movement-card-desc">${escapeHtml(t.description||'—')}</div>
      <div class="movement-card-val ${cls} num">${sign}${formatBRL(t.value,true)}</div>
    </div>
    <div class="movement-card-meta">
      <span>${formatDateBR(t.date)}</span>
      <span>${escapeHtml(t.account||'—')}</span>
      <span>${escapeHtml(t.category||'—')}</span>
      <span class="pill ${t.status==='realizado'?'pill-realizado':'pill-previsto'}">${STATUS_LABEL[t.status]||t.status}</span>
    </div>
  </div>`;
}

function renderDescMatrix(transactions){
  const rows = filteredTransactions(transactions);
  const pageSize = state.descMatrixPageSize;
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows/pageSize));
  if(state.descMatrixPage > totalPages) state.descMatrixPage = totalPages;
  if(state.descMatrixPage < 1) state.descMatrixPage = 1;
  const page = state.descMatrixPage;
  const pageRows = rows.slice((page-1)*pageSize, page*pageSize);

  const body = document.getElementById('descMatrixBody');
  const cards = document.getElementById('descMatrixCards');
  if(body){
    body.innerHTML = pageRows.length ? pageRows.map(descMatrixRowHtml).join('')
      : `<tr><td colspan="6"><div class="empty-state">Nenhum lançamento encontrado com os filtros atuais.</div></td></tr>`;
  }
  if(cards){
    cards.innerHTML = pageRows.length ? pageRows.map(descMatrixCardHtml).join('')
      : `<div class="empty-state">Nenhum lançamento encontrado com os filtros atuais.</div>`;
  }

  const foot = document.getElementById('tableFooter');
  if(foot) foot.textContent = `${totalRows} lançamento${totalRows===1?'':'s'}`;

  renderDescMatrixPagination(totalRows, totalPages, page, pageRows.length);
}

function renderDescMatrixPagination(totalRows, totalPages, page, shownRows){
  const wrap = document.getElementById('movementsPagination');
  const summary = document.getElementById('movementsPaginationSummary');
  if(summary) summary.textContent = totalRows ? `Exibindo ${shownRows} de ${totalRows} lançamento${totalRows===1?'':'s'}` : 'Nenhum lançamento encontrado.';
  if(!wrap) return;
  if(totalRows===0){ wrap.innerHTML = ''; return; }

  const pageBtn = (p, label, opts)=>{
    const o = opts||{};
    return `<button type="button" class="page-btn ${p===page?'active':''}" data-page="${p}" ${o.disabled?'disabled':''} aria-label="${o.aria||('Página '+p)}" ${p===page?'aria-current="page"':''}>${label}</button>`;
  };
  let numbered = '';
  const windowSize = 5;
  let from = Math.max(1, page-Math.floor(windowSize/2));
  let to = Math.min(totalPages, from+windowSize-1);
  from = Math.max(1, to-windowSize+1);
  if(from>1) numbered += pageBtn(1,'1') + (from>2?'<span class="page-ellipsis">…</span>':'');
  for(let p=from;p<=to;p++) numbered += pageBtn(p, String(p));
  if(to<totalPages) numbered += (to<totalPages-1?'<span class="page-ellipsis">…</span>':'') + pageBtn(totalPages,String(totalPages));

  wrap.innerHTML = `
    ${pageBtn(1, svgIcon('chevronsLeft',15), {disabled:page===1, aria:'Primeira página'})}
    ${pageBtn(page-1, svgIcon('chevronLeft',15), {disabled:page===1, aria:'Página anterior'})}
    ${numbered}
    ${pageBtn(page+1, svgIcon('chevronRight',15), {disabled:page===totalPages, aria:'Próxima página'})}
    ${pageBtn(totalPages, svgIcon('chevronsRight',15), {disabled:page===totalPages, aria:'Última página'})}
  `;
  wrap.querySelectorAll('[data-page]').forEach(btn=>{
    if(btn.disabled) return;
    btn.onclick = ()=>{ state.descMatrixPage = Number(btn.dataset.page); renderDescMatrix(activeData().transactions); };
  });
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
// O cabeçalho fixo pode variar de altura (quebra de linha em telas médias,
// fontes carregando, etc.) — medimos a altura real e ajustamos a variável
// CSS que o conteúdo usa como padding-top, para o cabeçalho nunca cobrir
// as seções abaixo dele, em qualquer largura de tela.
let headerResizeObserver = null;
function syncHeaderHeight(){
  const topbar = document.querySelector('.topbar');
  if(!topbar) return;
  const h = Math.ceil(topbar.getBoundingClientRect().height);
  if(h>0) document.documentElement.style.setProperty('--header-h', h + 'px');
}
function watchHeaderHeight(){
  const topbar = document.querySelector('.topbar');
  if(!topbar) return;
  syncHeaderHeight();
  if(headerResizeObserver) return;
  if(typeof ResizeObserver === 'function'){
    headerResizeObserver = new ResizeObserver(()=> syncHeaderHeight());
    headerResizeObserver.observe(topbar);
  }else{
    window.addEventListener('resize', debounce(syncHeaderHeight, 100));
  }
}

function switchView(view){
  const dash = document.getElementById('dashboardView');
  const hist = document.getElementById('historyView');
  const apps = document.getElementById('applicationsView');
  const verif = document.getElementById('verificationView');
  if(dash) dash.hidden = view!=='dashboard';
  if(hist) hist.hidden = view!=='history';
  if(apps) apps.hidden = view!=='applications';
  if(verif) verif.hidden = view!=='verification';
  document.querySelectorAll('#viewTabs [data-view], #mobileBottomNav [data-view]').forEach(b=>{
    const active = b.dataset.view===view;
    b.classList.toggle('active', active);
    if(active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  if(view==='history') renderHistory();
  if(view==='applications') renderApplications();
  if(view==='verification') renderVerification();
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

/* ==== VIEW: VERIFICAÇÃO DE IMPORTAÇÃO (só financeiro) ====
 * Cada envio (bem-sucedido ou não) fica registrado em state.history. Os
 * leitores automáticos (Sicredi/Santander/CEF) já guardam, na hora do
 * carregamento, uma lista de "issues" (inconsistências) no mesmo campo
 * errorMessage do histórico — aqui como um JSON { issues:[...] } em vez do
 * texto livre usado antigamente para erros de conexão/permissão. Essa tela
 * decodifica os dois formatos e mostra, para cada envio com algo a revisar,
 * o que aconteceu e o que o financeiro (ou o desenvolvedor) pode fazer. */
function decodeHistoryIssues(h){
  if(!h || !h.errorMessage) return [];
  const raw = String(h.errorMessage);
  try{
    const parsed = JSON.parse(raw);
    if(parsed && Array.isArray(parsed.issues)) return parsed.issues;
  }catch(e){ /* não é JSON — mensagem antiga em texto puro, cai no fallback abaixo */ }
  return [{
    code: h.status==='erro' ? 'falha_no_carregamento' : 'aviso',
    message: raw,
    suggestion: h.status==='erro'
      ? 'Confira o arquivo e tente carregar novamente. Se o erro persistir, envie o arquivo para revisão.'
      : '',
  }];
}
function renderVerificationBankFilterOptions(history){
  const sel = document.getElementById('verifBankFilter');
  if(!sel) return;
  const banks = [...new Set(history.map(h=>h.bank))].sort();
  const current = state.verificationBankFilter;
  sel.innerHTML = `<option value="">Todos os bancos</option>` + banks.map(b=>
    `<option value="${escapeHtml(b)}" ${b===current?'selected':''}>${escapeHtml(b)}</option>`).join('');
}
function renderVerification(){
  const { history } = activeData();
  const listEl = document.getElementById('verifList');
  const kpiRow = document.getElementById('verifKpiRow');
  if(!listEl || !kpiRow) return;
  renderVerificationBankFilterOptions(history);
  const filtered = state.verificationBankFilter ? history.filter(h=>h.bank===state.verificationBankFilter) : history;

  const withIssues = filtered
    .map(h=>({ h, issues: decodeHistoryIssues(h) }))
    .filter(x=> x.h.status==='erro' || x.issues.length>0);
  const errorCount = filtered.filter(h=>h.status==='erro').length;
  const warningCount = withIssues.filter(x=> x.h.status!=='erro').length;
  const cleanCount = filtered.length - withIssues.length;

  const tiles = [
    { label:'Envios com falha', value:String(errorCount), cls: errorCount>0?'neg':'' },
    { label:'Envios com avisos', value:String(warningCount), cls: warningCount>0?'warn':'' },
    { label:'Envios sem inconsistências', value:String(cleanCount), cls:'' },
  ];
  kpiRow.className = 'kpi-row';
  kpiRow.style.gridTemplateColumns = 'repeat(3,1fr)';
  kpiRow.innerHTML = tiles.map(t=>`
    <div class="kpi-tile">
      <div class="kpi-label"><span>${escapeHtml(t.label)}</span></div>
      <div class="kpi-value num ${t.cls}">${t.value}</div>
    </div>`).join('');

  if(!filtered.length){
    listEl.innerHTML = `<div class="empty-state">Nenhum envio registrado ainda.</div>`;
    return;
  }
  if(!withIssues.length){
    listEl.innerHTML = `<div class="empty-state">Nenhuma inconsistência registrada${state.verificationBankFilter?` para ${escapeHtml(state.verificationBankFilter)}`:''} — os envios foram lidos sem avisos.</div>`;
    return;
  }
  listEl.innerHTML = withIssues.map(({h,issues})=>{
    const isError = h.status==='erro';
    const when = h.at ? formatDateBR(h.at.slice(0,10)) + ' ' + h.at.slice(11,16) : '—';
    return `<div class="issue-card ${isError?'is-error':''}">
      <div class="issue-card-head">
        <div>
          <span class="issue-card-title">${escapeHtml(h.bank)}</span>
          <span class="issue-card-meta"> — ${escapeHtml(h.filename||'—')}</span>
        </div>
        <div class="issue-card-meta">${when} &middot; <span class="pill ${isError?'pill-out':'pill-previsto'}">${isError?'Falhou':'Carregado com avisos'}</span></div>
      </div>
      ${issues.map(it=>`
        <div class="issue-row">
          <div class="issue-row-msg">${escapeHtml(it.message)}</div>
          ${it.suggestion ? `<div class="issue-row-suggestion">O que fazer: ${escapeHtml(it.suggestion)}</div>` : ''}
        </div>`).join('')}
    </div>`;
  }).join('');
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

// Extrai o número de dias de um texto de cotização de resgate tipo "D+0",
// "D + 30", "D+2" — usado para agrupar os fundos por faixa de liquidez.
// Texto que não segue esse padrão (vazio, "Não se aplica" etc.) vira null,
// e cai no grupo "Não informado" em vez de ser descartado.
function parseLiquidezDias(cotizacaoResgate){
  const m = String(cotizacaoResgate||'').match(/D\s*\+?\s*(\d+)/i);
  return m ? Number(m[1]) : null;
}
const LIQUIDEZ_BUCKETS = [
  { label:'D+0', test: d => d===0 },
  { label:'D+1', test: d => d===1 },
  { label:'D+2 a D+7', test: d => d>=2 && d<=7 },
  { label:'D+8 a D+30', test: d => d>=8 && d<=30 },
  { label:'Acima de D+30', test: d => d>30 },
];
function liquidezBucketLabel(dias){
  if(dias==null) return 'Não informado';
  const b = LIQUIDEZ_BUCKETS.find(b=>b.test(dias));
  return b ? b.label : 'Não informado';
}
// Classifica o texto livre do campo "Vínculo" da planilha em 3 grupos —
// mesma lógica tolerante usada no resto do app para textos de banco que
// variam de grafia (ver parseApplicationsWorkbook).
function vinculoBucketLabel(vinculo){
  const s = String(vinculo||'').trim();
  if(!s) return 'Não informado';
  if(/^livre/i.test(s)) return 'Livre';
  if(/vincul/i.test(s)) return 'Vinculado';
  return 'Outro';
}

// Todos os números derivados dos fundos (já filtrados por banco, se for o
// caso) que alimentam os cards de destaque, os gráficos e a tabela de
// prazos da tela de Aplicações — centralizado aqui para os vários pedaços
// da tela nunca calcularem o mesmo total de formas diferentes.
function computeAppsInsights(funds){
  const withDias = funds.map(f=>({ f, dias: parseLiquidezDias(f.cotizacaoResgate) }));
  const totalSaldo = funds.reduce((s,f)=>s+(f.saldoFinal||0),0);
  const totalRendimentos = funds.reduce((s,f)=>s+(f.rendimentos||0),0);
  const totalSaldoInicial = funds.reduce((s,f)=>s+(f.saldoInicial||0),0);

  const bancoMap = new Map();
  funds.forEach(f=> bancoMap.set(f.banco, (bancoMap.get(f.banco)||0) + (f.saldoFinal||0)));
  const byBanco = [...bancoMap.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);

  const vincMap = new Map();
  funds.forEach(f=>{ const k = vinculoBucketLabel(f.vinculo); vincMap.set(k, (vincMap.get(k)||0) + (f.saldoFinal||0)); });
  const byVinculo = [...vincMap.entries()].map(([label,value])=>({label,value})).sort((a,b)=>b.value-a.value);

  const liqValMap = new Map(), liqCountMap = new Map();
  withDias.forEach(({f,dias})=>{
    const label = liquidezBucketLabel(dias);
    liqValMap.set(label, (liqValMap.get(label)||0) + (f.saldoFinal||0));
    liqCountMap.set(label, (liqCountMap.get(label)||0) + 1);
  });
  const liqOrder = ['D+0','D+1','D+2 a D+7','D+8 a D+30','Acima de D+30','Não informado'];
  const byLiquidez = liqOrder.filter(l=>liqValMap.has(l)).map(label=>({ label, value: liqValMap.get(label)||0, count: liqCountMap.get(label)||0 }));

  const liqD0 = withDias.filter(x=>x.dias===0).reduce((s,x)=>s+(x.f.saldoFinal||0),0);
  const liqAte7 = withDias.filter(x=>x.dias!=null && x.dias<=7).reduce((s,x)=>s+(x.f.saldoFinal||0),0);
  const liqAte30 = withDias.filter(x=>x.dias!=null && x.dias<=30).reduce((s,x)=>s+(x.f.saldoFinal||0),0);

  const livres = vincMap.get('Livre')||0;
  const vinculadas = vincMap.get('Vinculado')||0;

  const rentMedia = totalSaldoInicial>0
    ? (totalRendimentos/totalSaldoInicial*100)
    : (funds.length ? funds.reduce((s,f)=>s+(f.rendimentosPct||0),0)/funds.length : 0);

  const ranked = funds.filter(f=>f.rendimentosPct!=null).sort((a,b)=>b.rendimentosPct-a.rendimentosPct);
  const melhor = ranked[0] || null;
  const topRent = ranked.slice(0,6).map(f=>({ label:`${f.fundo} · ${f.banco}`, value:f.rendimentosPct, isPct:true }));

  const staleCount = funds.filter(f=>f.stale).length;
  const asOfDate = funds.reduce((max,f)=> (!max || (f.competencia && f.competencia>max)) ? f.competencia : max, null);

  return {
    totalSaldo, totalRendimentos, totalSaldoInicial, byBanco, byVinculo, byLiquidez,
    liqD0, liqAte7, liqAte30, livres, vinculadas, rentMedia, melhor, topRent, staleCount, asOfDate,
  };
}

// Lista de barras horizontais com degradê — usada nos 3 gráficos "por
// banco/vínculo/liquidez" e no ranking de rentabilidade. `items`:
// [{label, value, isPct?, count?}]. A largura da barra é relativa ao maior
// valor da própria lista (não ao total), pra sempre ter pelo menos uma
// barra cheia e as diferenças ficarem visíveis mesmo com poucos itens.
function hbarListHtml(items, opts){
  opts = opts || {};
  if(!items || !items.length) return `<div class="empty-state">Sem dados.</div>`;
  const max = Math.max(...items.map(i=>Math.abs(i.value)), 1);
  const total = opts.total!=null ? opts.total : items.reduce((s,i)=>s+i.value,0);
  const colors = ['c1','c2','c3','c4'];
  return `<div class="hbar-list">${items.map((it,idx)=>{
    const pctOfMax = Math.max(3, Math.round(Math.abs(it.value)/max*100));
    const pctOfTotal = total>0 ? (it.value/total*100) : 0;
    const valLabel = it.isPct
      ? `${it.value.toLocaleString('pt-BR',{maximumFractionDigits:2})}%`
      : formatBRL(it.value);
    return `<div class="hbar-row">
      <div class="hbar-top"><span class="hbar-name">${escapeHtml(it.label)}</span><span class="hbar-val">${valLabel}</span></div>
      <div class="hbar-track"><div class="hbar-fill ${colors[idx%colors.length]}" style="width:${pctOfMax}%"></div></div>
      ${!it.isPct ? `<span class="hbar-pct">${pctOfTotal.toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total${it.count!=null?` · ${it.count} fundo${it.count===1?'':'s'}`:''}</span>` : ''}
    </div>`;
  }).join('')}</div>`;
}

function appsKpiTilesHtml(tiles){
  return tiles.map(t=>`
    <div class="kpi-tile">
      <div class="kpi-icon ${t.iconCls||''}">${svgIcon(t.icon,18)}</div>
      <div class="kpi-label"><span>${escapeHtml(t.label)}</span></div>
      <div class="kpi-value num ${t.cls||''}">${escapeHtml(t.value)}</div>
      ${t.sub?`<div class="kpi-sub">${escapeHtml(t.sub)}</div>`:''}
    </div>`).join('');
}

function renderApplications(){
  const { applications } = activeData();
  const heroRow = document.getElementById('appsHeroRow');
  const kpiRow = document.getElementById('appsKpiRow');
  const liqKpiRow = document.getElementById('appsLiquidityKpiRow');
  const staleBanner = document.getElementById('appsStaleBanner');
  const body = document.getElementById('appsTableBody');
  const footer = document.getElementById('appsFooter');
  if(!kpiRow || !body) return;

  if(!applications || !applications.funds || !applications.funds.length){
    if(heroRow) heroRow.innerHTML = '';
    kpiRow.innerHTML = '';
    if(liqKpiRow) liqKpiRow.innerHTML = '';
    ['appsChartBanco','appsChartVinculo','appsChartLiquidez','appsChartTopRent'].forEach(id=>{
      const el = document.getElementById(id);
      if(el) el.innerHTML = `<div class="empty-state">Sem dados.</div>`;
    });
    const prazosBody = document.getElementById('appsPrazosBody');
    if(prazosBody) prazosBody.innerHTML = `<tr><td colspan="4"><div class="empty-state">Sem dados.</div></td></tr>`;
    if(staleBanner) staleBanner.innerHTML = '';
    body.innerHTML = `<tr><td colspan="14"><div class="empty-state">Nenhum relatório de aplicações carregado ainda${state.canEdit ? ' — use "Carregar relatório" e selecione "Análise Aplicações".' : '.'}</div></td></tr>`;
    if(footer) footer.textContent = '';
    return;
  }

  renderApplicationsBankFilterOptions(applications.funds);
  const filtered = state.applicationsBankFilter
    ? applications.funds.filter(f=>f.banco===state.applicationsBankFilter)
    : applications.funds;

  const ins = computeAppsInsights(filtered);

  if(staleBanner){
    staleBanner.innerHTML = ins.staleCount>0
      ? `<div class="demo-banner"><span>&#9888;</span><span><b>${ins.staleCount} fundo(s)</b> sem atualização há mais de ${APPLICATIONS_STALE_DAYS} dias — exibidos com o aviso "desatualizado" na tabela abaixo. Confirme se ainda estão ativos antes de considerar o saldo.</span></div>`
      : '';
  }

  if(heroRow){
    const bancosCount = ins.byBanco.length;
    heroRow.innerHTML = `
      <div class="apps-hero-card">
        <div class="apps-hero-label"><span class="apps-hero-icon">${svgIcon('wallet',20)}</span>Saldo total em aplicações</div>
        <div class="apps-hero-value num">${formatBRL(ins.totalSaldo)}</div>
        <div class="apps-hero-sub">${filtered.length} fundo${filtered.length===1?'':'s'}${state.applicationsBankFilter?'':` em ${bancosCount} banco${bancosCount===1?'':'s'}`} · rentabilidade média ${ins.rentMedia.toLocaleString('pt-BR',{maximumFractionDigits:2})}%</div>
      </div>
      <div class="apps-hero-card alt">
        <div class="apps-hero-label"><span class="apps-hero-icon">${svgIcon('clock',20)}</span>Liquidez imediata (D+0)</div>
        <div class="apps-hero-value num">${formatBRL(ins.liqD0)}</div>
        <div class="apps-hero-sub">${(ins.totalSaldo>0? ins.liqD0/ins.totalSaldo*100:0).toLocaleString('pt-BR',{maximumFractionDigits:1})}% do total disponível sem prazo de resgate</div>
      </div>`;
  }

  kpiRow.className = 'kpi-row';
  kpiRow.style.gridTemplateColumns = '';
  kpiRow.innerHTML = appsKpiTilesHtml([
    { label:'Total aplicado', icon:'wallet', iconCls:'accent', value: formatBRL(ins.totalSaldo) },
    { label:'Aplicações livres', icon:'arrowUpRight', iconCls:'in', value: formatBRL(ins.livres) },
    { label:'Aplicações vinculadas', icon:'lock', value: formatBRL(ins.vinculadas) },
    { label:'Rendimento do período', icon:'trendingUp', iconCls:'in', cls:'pos', value: formatBRL(ins.totalRendimentos) },
    { label:'Rentabilidade média', icon:'percent', value: ins.rentMedia.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%' },
    { label:'Qtd. de fundos', icon:'layers', value: String(filtered.length) },
  ]);

  const chartBanco = document.getElementById('appsChartBanco');
  if(chartBanco) chartBanco.innerHTML = hbarListHtml(ins.byBanco, { total: ins.totalSaldo });
  const chartVinculo = document.getElementById('appsChartVinculo');
  if(chartVinculo) chartVinculo.innerHTML = hbarListHtml(ins.byVinculo, { total: ins.totalSaldo });
  const chartLiquidez = document.getElementById('appsChartLiquidez');
  if(chartLiquidez) chartLiquidez.innerHTML = hbarListHtml(ins.byLiquidez, { total: ins.totalSaldo });
  const chartTopRent = document.getElementById('appsChartTopRent');
  if(chartTopRent) chartTopRent.innerHTML = hbarListHtml(ins.topRent);

  if(liqKpiRow){
    liqKpiRow.className = 'kpi-row';
    liqKpiRow.innerHTML = appsKpiTilesHtml([
      { label:'Liquidez D+0', icon:'clock', iconCls:'in', value: formatBRL(ins.liqD0) },
      { label:'Liquidez até D+7', icon:'clock', value: formatBRL(ins.liqAte7) },
      { label:'Liquidez até D+30', icon:'calendar', value: formatBRL(ins.liqAte30) },
      { label:'Melhor aplicação', icon:'trendingUp', iconCls:'in', cls:'pos',
        value: ins.melhor ? ins.melhor.rendimentosPct.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%' : '—',
        sub: ins.melhor ? `${ins.melhor.fundo} — ${ins.melhor.banco}` : 'Sem dado de rentabilidade' },
      { label:'Fundos desatualizados', icon:'bell', iconCls: ins.staleCount>0?'out':'', cls: ins.staleCount>0?'neg':'',
        value: String(ins.staleCount), sub: `Sem atualização há mais de ${APPLICATIONS_STALE_DAYS} dias` },
      { label:'Dados até', icon:'history', value: ins.asOfDate ? formatDateBR(ins.asOfDate) : '—', sub:'Competência mais recente' },
    ]);
  }

  const prazosBody = document.getElementById('appsPrazosBody');
  if(prazosBody){
    prazosBody.innerHTML = ins.byLiquidez.length ? ins.byLiquidez.map(b=>`
      <tr>
        <td>${escapeHtml(b.label)}</td>
        <td class="num-col num">${formatBRL(b.value,true)}</td>
        <td class="num-col num">${(ins.totalSaldo>0? b.value/ins.totalSaldo*100:0).toLocaleString('pt-BR',{maximumFractionDigits:1})}%</td>
        <td class="num-col num">${b.count}</td>
      </tr>`).join('') : `<tr><td colspan="4"><div class="empty-state">Sem dados.</div></td></tr>`;
  }

  body.innerHTML = filtered.length ? filtered.map(f=>`
    <tr>
      <td><div class="bank-name-cell">${bankBadgeHtml(f.banco,22)}<span>${escapeHtml(f.banco)}</span></div></td>
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
    knownBankResult: null, knownBankError: null,
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
  const knownBank = !!knownBankParser();
  const skipMapping = apps || knownBank;
  document.querySelectorAll('.step-dot').forEach((el,i)=>{
    if(skipMapping){
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
    : knownBank
      ? ['Carregar relatório', '', '', 'Prévia e confirmação']
      : ['Carregar relatório','Formato dos valores','Mapear colunas','Prévia e confirmação'];
  const subs = apps
    ? ['Envie a planilha "Analise Aplicações" (abas CONSOLIDADO e Informações Fundos).', '', '', 'Confira o saldo mais recente de cada fundo antes de salvar.']
    : knownBank
      ? ['Envie o extrato exportado do banco — o painel já sabe ler este layout.', '', '', 'Confira os lançamentos antes de salvar.']
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

function bankHintText(){
  if(wz.sourceName === APPLICATIONS_SOURCE){
    return 'Envie a planilha "Analise Aplicações", com as abas "CONSOLIDADO" e "Informações Fundos" — o painel identifica sozinho o saldo mais recente de cada fundo.';
  }
  if(BANK_PARSERS[wz.sourceName]){
    return 'Este banco tem leitura automática — é só enviar o extrato exportado direto do banco que o painel já reconhece data, valores e lançamentos, sem precisar mapear colunas.';
  }
  return 'O layout do relatório muda conforme o banco — por isso cada um guarda seu próprio mapeamento de colunas, lembrado automaticamente da próxima vez que você enviar um arquivo dele.';
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
      <div class="field-hint" id="bankHint">${bankHintText()}</div>
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
    wz.knownBankResult = null; wz.knownBankError = null;
    wz.file = null; wz.workbook = null;
    const hintEl = document.getElementById('bankHint');
    if(hintEl) hintEl.textContent = bankHintText();
    const dzEl = document.getElementById('dropzone');
    if(dzEl) dzEl.innerHTML = `Clique para escolher um arquivo .xlsx / .xls / .csv<br><span class="field-hint">ou arraste e solte aqui</span>`;
    const area = document.getElementById('sheetArea');
    if(area) area.innerHTML = '';
    updateNextEnabled();
  };
  const otherInput = document.getElementById('otherBankInput');
  if(otherInput) otherInput.oninput = (e)=>{ wz.sourceName = e.target.value; const hintEl=document.getElementById('bankHint'); if(hintEl) hintEl.textContent = bankHintText(); updateNextEnabled(); };
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
  wz.knownBankResult = null; wz.knownBankError = null;
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
    const parser = knownBankParser();
    if(parser){
      try{
        const result = parser(wz.workbook, wz.sourceName.trim());
        if(!result.rows.length) throw new Error('no-rows-found');
        wz.knownBankResult = result;
        wz.parsedRows = result.rows;
        wz.parseErrorCount = result.errorCount;
      }catch(err){
        console.error(err);
        wz.knownBankResult = null;
        wz.knownBankError = 'Não foi possível reconhecer este arquivo como um extrato de ' + wz.sourceName.trim() + '. Confira se é o extrato exportado direto do banco, sem edições.';
      }
      renderStep0(document.getElementById('wizardBody'), document.getElementById('wizardNext'));
      renderKnownBankSummaryArea();
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
// Banner reutilizado no passo de resumo (step0) e na prévia final (step3)
// do assistente de carregamento — mostra as inconsistências encontradas pelo
// leitor automático, com uma sugestão do que fazer para cada uma. As mesmas
// issues ficam salvas no histórico e reaparecem na tela "Verificação de
// Importação" (acesso do financeiro).
function issuesBannerHtml(issues){
  if(!issues || !issues.length) return '';
  return `<div class="issue-banner">
    <div class="issue-banner-head">&#9888; ${issues.length} inconsistência${issues.length===1?'':'s'} encontrada${issues.length===1?'':'s'} na leitura deste arquivo — o carregamento pode continuar, mas vale revisar:</div>
    ${issues.map(it=>`
      <div class="issue-row">
        <div class="issue-row-msg">${escapeHtml(it.message)}</div>
        ${it.suggestion ? `<div class="issue-row-suggestion">O que fazer: ${escapeHtml(it.suggestion)}</div>` : ''}
      </div>`).join('')}
  </div>`;
}
function renderKnownBankSummaryArea(){
  const area = document.getElementById('sheetArea');
  if(!area) return;
  if(wz.knownBankError){
    area.innerHTML = `<div class="demo-banner" style="margin-top:12px;"><span>&#9888;</span><span>${escapeHtml(wz.knownBankError)}</span></div>`;
    return;
  }
  if(!wz.knownBankResult){ area.innerHTML = ''; return; }
  const r = wz.knownBankResult;
  const dates = r.rows.map(x=>x.date).sort();
  const periodo = dates.length ? `${formatDateBR(dates[0])} a ${formatDateBR(dates[dates.length-1])}` : '—';
  area.innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(${r.meta&&r.meta.lastBalance!=null?3:2},1fr);margin:12px 0 0;">
      <div class="kpi-tile"><div class="kpi-label">Lançamentos encontrados</div><div class="kpi-value num">${r.rows.length}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Período</div><div class="kpi-value num" style="font-size:15px;">${periodo}</div></div>
      ${r.meta && r.meta.lastBalance!=null ? `<div class="kpi-tile"><div class="kpi-label">Saldo final do extrato</div><div class="kpi-value num">${formatBRL(r.meta.lastBalance,true)}</div></div>` : ''}
    </div>
    <div style="margin-top:12px;">${issuesBannerHtml(r.issues)}</div>
  `;
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
  } else if(knownBankParser()){
    ok = !!(wz.knownBankResult && wz.knownBankResult.rows.length);
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
  const knownBank = knownBankParser();
  if(!knownBank) buildTransactionsFromMapping();
  const rows = wz.parsedRows;
  const totalIn = rows.filter(r=>r.type==='recebimento').reduce((s,r)=>s+r.value,0);
  const totalOut = rows.filter(r=>r.type==='pagamento').reduce((s,r)=>s+r.value,0);
  const lastBalance = knownBank && wz.knownBankResult && wz.knownBankResult.meta ? wz.knownBankResult.meta.lastBalance : null;
  body.innerHTML = `
    <div class="kpi-row" style="grid-template-columns:repeat(${lastBalance!=null?4:3},1fr);margin:0 0 14px;">
      <div class="kpi-tile"><div class="kpi-label">Lançamentos</div><div class="kpi-value num">${rows.length}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Total recebimentos</div><div class="kpi-value num pos">${formatBRL(totalIn)}</div></div>
      <div class="kpi-tile"><div class="kpi-label">Total pagamentos</div><div class="kpi-value num neg">${formatBRL(totalOut)}</div></div>
      ${lastBalance!=null ? `<div class="kpi-tile"><div class="kpi-label">Saldo final do extrato</div><div class="kpi-value num">${formatBRL(lastBalance,true)}</div></div>` : ''}
    </div>
    ${knownBank ? issuesBannerHtml(wz.knownBankResult && wz.knownBankResult.issues) : (wz.parseErrorCount>0 ? `<div class="demo-banner" style="margin-bottom:12px;"><span>&#9888;</span><span>${wz.parseErrorCount} linha(s) ignorada(s) por data ou valor inválido/ausente.</span></div>` : '')}
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
    const knownBankIssues = wz.knownBankResult && wz.knownBankResult.issues;
    const issuesPayload = (knownBankIssues && knownBankIssues.length) ? JSON.stringify({ issues: knownBankIssues }) : '';
    logUploadHistory({ bank: wz.sourceName.trim(), filename: wz.file.name, status:'concluido', rowCount: wz.parsedRows.length, errorMessage: issuesPayload });
    closeUploadModal();
    showToast(`Relatório de "${wz.sourceName.trim()}" carregado: ${wz.parsedRows.length} lançamentos.${knownBankIssues && knownBankIssues.length ? ' Algumas inconsistências foram registradas em Verificação de Importação.' : ''}`);
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
  if(knownBankParser()){
    if(wz.step===0){ wz.sourceId = slugifySource(wz.sourceName); wz.step = 3; renderWizardStep(); return; }
    if(wz.step===3){ finishWizard(); return; }
  }
  if(wz.step===0){ applySavedMappingForSource(); }
  if(wz.step===3){ finishWizard(); return; }
  wz.step++;
  renderWizardStep();
}
function wizardGoBack(){
  if((isApplicationsSource() || knownBankParser()) && wz.step===3){ wz.step = 0; renderWizardStep(); return; }
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
  const { accounts, transactions, sources, applications } = activeData();
  document.getElementById('demoBanner').hidden = !state.usingDemo;

  const kpis = computeKPIs(accounts, transactions);
  renderRangeControl();
  const { start, end } = getRangeBounds(currentRangeId, transactions);
  const trends = computeKPITrends(transactions, start, end, kpis);
  renderKPIs(kpis, trends);

  renderDiario(transactions, kpis, start, end);
  renderProjectionLegend();
  const daily = computeDailySeries(transactions, start, end);
  const cumulative = computeCumulativeSeries(transactions, daily, kpis.totalBalance);
  drawCumulativeChart(cumulative);

  renderSources(sources);
  renderBankPosition(accounts, transactions);
  renderAccountFilterOptions(accounts, transactions);
  renderDescMatrix(transactions);
}

function wireStaticEvents(){
  if(staticEventsWired) return; // evita duplicar listeners se o login acontecer mais de uma vez
  staticEventsWired = true;
  watchHeaderHeight();
  document.querySelectorAll('#viewTabs [data-view], #mobileBottomNav [data-view]').forEach(b=>{
    b.onclick = ()=> switchView(b.dataset.view);
  });

  const btnRefresh = document.getElementById('btnRefresh');
  if(btnRefresh) btnRefresh.onclick = ()=>{
    if(state.usingDemo){ renderAll(); showToast('Painel atualizado.'); return; }
    loadData();
  };

  const pageSizeSel = document.getElementById('movementsPageSize');
  if(pageSizeSel) pageSizeSel.addEventListener('change', (e)=>{
    state.descMatrixPageSize = Number(e.target.value) || DESC_MATRIX_PAGE_SIZE;
    state.descMatrixPage = 1;
    renderDescMatrix(activeData().transactions);
  });

  // Dropdowns do cabeçalho (período e avatar) — mesmo padrão de abrir/fechar
  // do popover de notificações: um botão-gatilho com aria-expanded e um
  // painel que fecha ao clicar fora ou apertar Esc.
  function wireHeaderDropdown(triggerId, popId){
    const trigger = document.getElementById(triggerId);
    const pop = document.getElementById(popId);
    if(!trigger || !pop) return;
    trigger.onclick = (e)=>{
      e.stopPropagation();
      const willOpen = pop.hidden;
      document.querySelectorAll('.header-dropdown-pop').forEach(p=>{ if(p!==pop) p.hidden = true; });
      document.querySelectorAll('.header-dropdown-trigger').forEach(t=>{ if(t!==trigger) t.setAttribute('aria-expanded','false'); });
      pop.hidden = !willOpen;
      trigger.setAttribute('aria-expanded', willOpen ? 'true' : 'false');
    };
    document.addEventListener('click', (e)=>{
      if(!pop.hidden && !pop.contains(e.target) && e.target!==trigger && !trigger.contains(e.target)){
        pop.hidden = true;
        trigger.setAttribute('aria-expanded','false');
      }
    });
  }
  wireHeaderDropdown('headerRangeTrigger','headerRangePop');
  wireHeaderDropdown('avatarTrigger','avatarPop');

  const btnBankToggle = document.getElementById('btnBankPositionToggle');
  if(btnBankToggle) btnBankToggle.onclick = ()=>{
    state.bankPositionExpanded = !state.bankPositionExpanded;
    renderBankPosition(activeData().accounts, activeData().transactions);
  };

  document.getElementById('histBankFilter').addEventListener('change', (e)=>{
    state.historyBankFilter = e.target.value;
    renderHistory();
  });
  const appsBankFilterEl = document.getElementById('appsBankFilter');
  if(appsBankFilterEl) appsBankFilterEl.addEventListener('change', (e)=>{
    state.applicationsBankFilter = e.target.value;
    renderApplications();
  });
  const verifBankFilterEl = document.getElementById('verifBankFilter');
  if(verifBankFilterEl) verifBankFilterEl.addEventListener('change', (e)=>{
    state.verificationBankFilter = e.target.value;
    renderVerification();
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
    state.descMatrixPage = 1;
    renderDescMatrix(activeData().transactions);
  }, 120);
  document.getElementById('fSearch').addEventListener('input', onFilterChange);
  document.getElementById('fTipo').addEventListener('change', onFilterChange);
  document.getElementById('fStatus').addEventListener('change', onFilterChange);
  document.getElementById('fConta').addEventListener('change', onFilterChange);

  document.addEventListener('keydown', e=>{
    if(e.key==='Escape'){
      closeUploadModal(); closeAccountModal();
    }
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
