from pathlib import Path

p=Path('apps-script/Code.gs')
s=p.read_text(encoding='utf-8')

def replace_function(text,name,new_code):
    sig=f'function {name}('
    start=text.find(sig)
    if start<0: raise RuntimeError(f'{name} not found')
    brace=text.find('{',start)
    if brace<0: raise RuntimeError(f'brace for {name} not found')
    depth=0
    i=brace
    while i<len(text):
        ch=text[i]
        if ch=='{': depth+=1
        elif ch=='}':
            depth-=1
            if depth==0:
                return text[:start]+new_code.strip()+text[i+1:]
        i+=1
    raise RuntimeError(f'end of {name} not found')

read_apps=r'''function readApplications(){
  const sheet = getSheet(SHEET_APPLICATIONS);
  const data = sheet.getDataRange().getValues();
  const funds = [];
  let asOfDate = '';
  for(let i=1;i<data.length;i++){
    const row = data[i];
    if(!row[0]) continue;
    const competencia = String(row[4]||'');
    if(competencia > asOfDate) asOfDate = competencia;
    const contaCod = String(row[3]||''), banco = String(row[1]||''), fundo = String(row[2]||'');
    const fundKey = contaCod ? ('cc:'+normalizeAccountServer(contaCod)) : ('bf:'+normalizeAccountServer(banco)+'|'+normalizeAccountServer(fundo));
    funds.push({
      id:String(row[0]), fundKey, banco, fundo, contaCod, competencia,
      saldoInicial:Number(row[5])||0, aplicacoes:Number(row[6])||0, rendimentos:Number(row[7])||0,
      imposto:Number(row[8])||0, resgate:Number(row[9])||0, saldoFinal:Number(row[10])||0,
      rendimentosPct:(row[11]===''||row[11]===null||row[11]===undefined)?null:Number(row[11]),
      cotizacaoResgate:String(row[12]||''), garantia:String(row[13]||''), vinculo:String(row[14]||''), indexador:String(row[15]||''),
      updatedAt:formatDateValue(row[16]),
      liquidezDias:(row[17]===''||row[17]===null||row[17]===undefined)?null:Number(row[17]),
      classificacaoVinculo:String(row[18]||''), periodicAccepted:String(row[19]||'').toLowerCase()==='true'||row[19]===true,
    });
  }
  funds.sort((a,b)=> a.competencia<b.competencia?1:a.competencia>b.competencia?-1:b.saldoFinal-a.saldoFinal);
  const maxMonth = asOfDate ? String(asOfDate).slice(0,7) : '';
  const latestByFund = {};
  funds.forEach(f=>{ if(!latestByFund[f.fundKey] || f.competencia>latestByFund[f.fundKey].competencia) latestByFund[f.fundKey]=f; });
  const currentFunds = Object.keys(latestByFund).map(k=>latestByFund[k]).filter(f=>String(f.competencia).slice(0,7)===maxMonth || f.periodicAccepted);
  const totalBalance=currentFunds.reduce((s,f)=>s+f.saldoFinal,0), byBankMap={};
  currentFunds.forEach(f=>{byBankMap[f.banco]=(byBankMap[f.banco]||0)+f.saldoFinal;});
  return {funds,allFunds:funds,totalBalance,byBank:Object.keys(byBankMap).map(banco=>({banco,total:byBankMap[banco]})).sort((a,b)=>b.total-a.total),asOfDate,asOfMonth:maxMonth,staleCount:0};
}'''

save_apps=r'''function doSaveApplications(body){
  const lock = LockService.getScriptLock();
  if(!lock.tryLock(10000)) throw mkError('busy','outra atualização está em andamento');
  try{
    const funds = Array.isArray(body.funds) ? body.funds : [];
    const sheet = getSheet(SHEET_APPLICATIONS);
    const lastRow = sheet.getLastRow(), colCount = Math.max(sheet.getLastColumn(),20);
    const previousValues = lastRow>1 ? sheet.getRange(2,1,lastRow-1,colCount).getValues() : [];
    const periodicMap = {};
    previousValues.forEach(row=>{
      const cc=String(row[3]||'').trim(), key=cc?('cc:'+normalizeAccountServer(cc)):('bf:'+normalizeAccountServer(row[1])+'|'+normalizeAccountServer(row[2]));
      const accepted=String(row[19]||'').toLowerCase()==='true'||row[19]===true;
      if(accepted) periodicMap[key]=true;
    });
    const now = new Date().toISOString();
    const values = funds.map(f=>{
      const cc=String(f.contaCod||'').trim(), key=cc?('cc:'+normalizeAccountServer(cc)):('bf:'+normalizeAccountServer(f.banco)+'|'+normalizeAccountServer(f.fundo));
      const periodicAccepted=!!f.periodicAccepted||!!periodicMap[key];
      return [String(f.id||''),String(f.banco||''),String(f.fundo||''),String(f.contaCod||''),String(f.competencia||''),
        Number(f.saldoInicial)||0,Number(f.aplicacoes)||0,Number(f.rendimentos)||0,Number(f.imposto)||0,Number(f.resgate)||0,Number(f.saldoFinal)||0,
        (f.rendimentosPct===null||f.rendimentosPct===undefined||f.rendimentosPct==='')?'':Number(f.rendimentosPct),
        String(f.cotizacaoResgate||''),String(f.garantia||''),String(f.vinculo||''),String(f.indexador||''),now,
        (f.liquidezDias===null||f.liquidezDias===undefined||f.liquidezDias==='')?'':Number(f.liquidezDias),String(f.classificacaoVinculo||''),periodicAccepted];
    });
    try{
      if(lastRow>1) sheet.getRange(2,1,lastRow-1,colCount).clearContent();
      if(values.length) sheet.getRange(2,1,values.length,values[0].length).setValues(values);
    }catch(writeErr){
      const newLast=sheet.getLastRow();
      if(newLast>1) sheet.getRange(2,1,newLast-1,Math.max(sheet.getLastColumn(),colCount)).clearContent();
      if(previousValues.length) sheet.getRange(2,1,previousValues.length,previousValues[0].length).setValues(previousValues);
      throw writeErr;
    }
    if(body.fileBase64){
      try{
        const originaisFolder=getSubFolder('originais'), files=originaisFolder.getFiles();
        while(files.hasNext()){const f=files.next();if(/^aplicacoes(?:__|_atual__)/i.test(f.getName()))f.setTrashed(true);}
        const bytes=Utilities.base64Decode(body.fileBase64), blob=Utilities.newBlob(bytes,body.fileMime||'application/octet-stream',body.filename||'aplicacoes_financeiras');
        blob.setName('aplicacoes_atual__'+(body.filename||'arquivo')); originaisFolder.createFile(blob);
      }catch(e){console.error('guardar original de aplicações',e);}
    }
    return {};
  }finally{lock.releaseLock();}
}'''

setup=r'''function setupSpreadsheet(){
  const ss = getSS();
  ensureSheet(ss, SHEET_USERS, ['username','salt','passwordHash','role','nome','tentativasFalhas','bloqueadoAte']);
  ensureSheet(ss, SHEET_ACCOUNTS, ['id','name','kind','balance','asOfDate','order','updatedAt']);
  ensureSheet(ss, SHEET_SOURCES, ['id','sourceName','filename','sheetName','mappingJSON','headerSignature','rowCount','uploadedAt','periodStart','periodEnd','closingBalance']);
  ensureSheet(ss, SHEET_HISTORY, ['id','bank','filename','status','rowCount','errorMessage','at','periodStart','periodEnd','sourceId']);
  ensureSheet(ss, SHEET_APPLICATIONS, ['id','banco','fundo','contaCod','competencia','saldoInicial','aplicacoes','rendimentos','imposto','resgate','saldoFinal','rendimentosPct','cotizacaoResgate','garantia','vinculo','indexador','updatedAt','liquidezDias','classificacaoVinculo','periodicAccepted']);
  getRootFolder();
  SpreadsheetApp.getUi().alert('Planilha configurada/atualizada com sucesso.');
}'''

s=replace_function(s,'readApplications',read_apps)
s=replace_function(s,'doSaveApplications',save_apps)
s=replace_function(s,'setupSpreadsheet',setup)
p.write_text(s,encoding='utf-8')
