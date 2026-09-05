const fs=require('fs');
const vm=require('vm');
const crypto=require('crypto');

class Range{
  constructor(sheet,row,col,nr=1,nc=1){Object.assign(this,{sheet,row,col,nr,nc});}
  setValue(v){this.sheet.ensure(this.row,this.col);this.sheet.rows[this.row-1][this.col-1]=v;return this;}
  getValue(){this.sheet.ensure(this.row,this.col);return this.sheet.rows[this.row-1][this.col-1];}
  setValues(values){for(let r=0;r<values.length;r++)for(let c=0;c<values[r].length;c++){this.sheet.ensure(this.row+r,this.col+c);this.sheet.rows[this.row+r-1][this.col+c-1]=values[r][c];}return this;}
  clearContent(){for(let r=0;r<this.nr;r++)for(let c=0;c<this.nc;c++){this.sheet.ensure(this.row+r,this.col+c);this.sheet.rows[this.row+r-1][this.col+c-1]='';}return this;}
}
class Sheet{
  constructor(name,headers){this.name=name;this.rows=[headers.slice()];}
  ensure(r,c){while(this.rows.length<r)this.rows.push([]);while(this.rows[r-1].length<c)this.rows[r-1].push('');}
  getDataRange(){return {getValues:()=>this.rows.map(r=>r.slice())};}
  getRange(r,c,nr=1,nc=1){return new Range(this,r,c,nr,nc);}
  appendRow(row){this.rows.push(row.slice());}
  getLastRow(){return this.rows.length;}
  getLastColumn(){return Math.max(...this.rows.map(r=>r.length));}
  deleteRows(start,count){this.rows.splice(start-1,count);}
  deleteRow(row){this.rows.splice(row-1,1);}
  setFrozenRows(){}
}
class Cache{
  constructor(){this.map=new Map();}
  get(k){return this.map.get(k)||null;}
  put(k,v){this.map.set(k,String(v));}
  remove(k){this.map.delete(k);}
}
class Props{
  constructor(){this.map=new Map([['SHEET_ID','sheet-test']]);}
  getProperty(k){return this.map.get(k)||null;}
  setProperty(k,v){this.map.set(k,String(v));}
}
const cache=new Cache(), props=new Props(), sent=[];
const users=new Sheet('Usuarios',['username','salt','passwordHash','role','nome','tentativasFalhas','bloqueadoAte','email']);
const resets=new Sheet('ResetTokens',['id','username','codeHash','expiresAt','usedAt','attempts','requestedAt']);
const sheets={Usuarios:users,ResetTokens:resets};
const ss={getSheetByName:n=>sheets[n]||null};
const context={
  console,
  Date,
  Math,
  JSON,
  String,
  Number,
  RegExp,
  isFinite,
  PropertiesService:{getScriptProperties:()=>props},
  CacheService:{getScriptCache:()=>cache},
  SpreadsheetApp:{openById:()=>ss,getActiveSpreadsheet:()=>ss},
  LockService:{getScriptLock:()=>({tryLock:()=>true,releaseLock:()=>{}})},
  MailApp:{sendEmail:o=>sent.push(o)},
  Utilities:{
    DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},
    computeDigest:(_alg,str)=>Array.from(crypto.createHash('sha256').update(String(str),'utf8').digest()),
    getUuid:()=>crypto.randomUUID()
  },
  ContentService:{createTextOutput:()=>({setMimeType(){return this;}}),MimeType:{JSON:'json'}},
  Session:{getScriptTimeZone:()=> 'America/Bahia'},
  MimeType:{PLAIN_TEXT:'text/plain'}
};
vm.createContext(context);
vm.runInContext(fs.readFileSync('apps-script/Code.gs','utf8'),context,{filename:'Code.gs'});

function assert(ok,msg){if(!ok)throw new Error(msg);}
function expectCode(fn,code){try{fn();throw new Error('Esperava '+code);}catch(e){if(e.code!==code)throw e;}}

const salt='salt-a';
const oldPass='SenhaAntiga123';
users.appendRow(['financeiro',salt,context.makePasswordHash(salt,oldPass),'financeiro','Financeiro',0,'','financeiro@plansul.test']);

// Resposta genérica para conta inexistente e nenhum e-mail enviado.
let r=context.doRequestPasswordReset('naoexiste@plansul.test');
assert(r.message===context.RESET_GENERIC_MESSAGE,'mensagem genérica ausente');
assert(sent.length===0,'não deve enviar para conta inexistente');

// Pedido válido envia código e cria token hashado.
r=context.doRequestPasswordReset('financeiro');
assert(r.message===context.RESET_GENERIC_MESSAGE,'mensagem deve continuar genérica');
assert(sent.length===1,'deveria enviar um e-mail');
assert(resets.rows.length===2,'deveria criar token');
assert(!/\b\d{6}\b/.test(String(resets.rows[1][2])),'hash não deve guardar código puro');
const code=(sent[0].body.match(/\b(\d{6})\b/)||[])[1];
assert(code,'código não encontrado no e-mail simulado');

// Throttle público de 60s.
expectCode(()=>context.doRequestPasswordReset('financeiro'),'reset_throttled');

// Quatro erros mantêm token; quinto invalida.
for(let i=0;i<4;i++)expectCode(()=>context.doVerifyResetCode('financeiro','000000'),'reset_code_invalid');
expectCode(()=>context.doVerifyResetCode('financeiro','000000'),'reset_attempts_exceeded');
assert(resets.rows[1][4],'token deveria estar marcado como usado após 5 erros');

// Novo código após limpar caches simulando passagem dos 60s.
cache.remove(context.resetRequestCacheKey('financeiro'));
cache.remove(context.resetCanonicalCacheKey('financeiro'));
context.doRequestPasswordReset('financeiro');
assert(sent.length===2,'deveria reenviar um novo código');
const code2=(sent[1].body.match(/\b(\d{6})\b/)||[])[1];
assert(context.doVerifyResetCode('financeiro',code2).verified===true,'código correto deveria validar');

// Sessão antiga deve cair depois da redefinição.
cache.put('sess_old',JSON.stringify({username:'financeiro',role:'financeiro',nome:'Financeiro',authVersion:0}));
expectCode(()=>context.doResetPassword('financeiro',code2,'fraca'),'weak_password');
const out=context.doResetPassword('financeiro',code2,'NovaSenhaForte123');
assert(out.reset===true && out.username==='financeiro','reset não concluído');
assert(context.verifyPasswordHash(String(users.rows[1][1]),'NovaSenhaForte123',String(users.rows[1][2])),'nova senha não validou');
assert(!context.verifyPasswordHash(String(users.rows[1][1]),oldPass,String(users.rows[1][2])),'senha antiga continuou válida');
expectCode(()=>context.requireSession('old'),'session_expired');
expectCode(()=>context.doVerifyResetCode('financeiro',code2),'reset_code_invalid');

console.log('OK: fluxo de recuperação de senha validado em ambiente simulado.');
