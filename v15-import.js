'use strict';
// Import V14 et export V15 : aucun import initial n'ecrase un stock commun existant.
function normDate(v){
 if(v===null||v===undefined||v===''||v==='/')return'';
 if(typeof v==='number'){
  if(!window.XLSX)return'';
  var d=XLSX.SSF.parse_date_code(v);
  if(!d||!d.y)return'';
  return String(d.d).padStart(2,'0')+'/'+String(d.m).padStart(2,'0')+'/'+String(d.y);
 }
 var s=String(v).trim(),iso=s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
 if(iso)return iso[3]+'/'+iso[2]+'/'+iso[1];
 return s;
}
function normQty(v){
 if(v===null||v===undefined||v==='')return null;
 var n=Number(typeof v==='string'?v.replace(',','.'):v);
 return Number.isSafeInteger(n)&&n>=0?n:null;
}
function addLotLocal(lots,dateRaw,qtyRaw){
 var qty=normQty(qtyRaw),date=normDate(dateRaw);
 if(qty===null||qty===0)return;
 var existing=lots.find(function(l){return l.date===date});
 if(existing)existing.qty+=qty;else lots.push({date:date,qty:qty});
}
async function sendInitial(payload){
 if(!ready)return message('importMessage','Connecte-toi d’abord.',true);
 if(records.length)return message('importMessage','Stock commun déjà rempli. Pour éviter tout écrasement, l’import initial est bloqué.',true);
 if(!payload||!Array.isArray(payload.products)||!payload.products.length)return message('importMessage','Aucun produit dans ce fichier.',true);
 if(!window.confirm('Importer '+payload.products.length+' produits dans le stock commun ? Vérifie ta sauvegarde avant de confirmer. Cette opération ne fonctionne que si le stock partagé est vide.'))return;
 writing=true;message('importMessage','Envoi de l’inventaire initial en cours…');
 try{
  var r=await supa.rpc('laudaflo_seed_inventory',{p_payload:payload});
  if(r.error)throw r.error;
  writing=false;await refresh();
  message('importMessage',r.data+' produits transférés. L’inventaire est maintenant commun.');
 }catch(err){
  writing=false;message('importMessage','Échec de l’import : '+err.message,true);await refresh();
 }
}
async function importJson(){
 var file=el('jsonInput').files&&el('jsonInput').files[0];
 if(!file)return message('importMessage','Choisis le fichier .json de la sauvegarde V14.',true);
 try{
  var data=JSON.parse(await file.text());
  if(!data||!Array.isArray(data.products))throw new Error('Fichier Laudaflo invalide.');
  await sendInitial(data);
 }catch(err){message('importMessage',err.message,true)}
}
function readExcelRows(){
 var input=el('excelInput'),file=input.files&&input.files[0];
 if(!file)throw new Error('Choisis le fichier Excel.');
 if(!window.XLSX)throw new Error('Outil Excel indisponible. Recharge la page.');
 return file.arrayBuffer().then(function(buffer){
  var workbook=XLSX.read(buffer,{type:'array'});
  var all=[];
  var drinks=workbook.Sheets['Boissons'];
  if(drinks){
   var rows=XLSX.utils.sheet_to_json(drinks,{header:1,defval:null,raw:true});
   var first=(rows[0]||[]).map(function(x){return String(x||'').toLowerCase()});
   // La V14 accepte une structure historique (lots a l'index 3)
   // et exporte une colonne supplementaire "Total cave" (lots a l'index 4).
   var start=first[3]&&/total|cave.*total|stock.*cave/.test(first[3])?4:3;
   for(var i=1;i<rows.length;i++){
    var row=rows[i]||[],name=String(row[0]||'').trim();if(!name)continue;
    var lots=[];
    for(var k=start;k+1<row.length;k+=2)addLotLocal(lots,row[k],row[k+1]);
    all.push({type:'Boisson',name:name,shopDate:normDate(row[1]),shopQty:normQty(row[2]),lots:lots});
   }
  }
  var dry=workbook.Sheets['Sec'];
  if(dry){
   var rowsS=XLSX.utils.sheet_to_json(dry,{header:1,defval:null,raw:true});
   var headersS=(rowsS[0]||[]).map(function(x){return String(x||'').toLowerCase()});
   var startS=headersS[1]&&/total|stock/.test(headersS[1])?2:1;
   for(var j=1;j<rowsS.length;j++){
    var rowS=rowsS[j]||[],nameS=String(rowS[0]||'').trim();if(!nameS)continue;
    var lotsS=[];
    for(var z=startS;z+1<rowS.length;z+=2)addLotLocal(lotsS,rowS[z],rowS[z+1]);
    all.push({type:'Sec',name:nameS,lots:lotsS});
   }
  }
  // Une exportation V15 peut contenir plusieurs dates distinctes au frigo.
  var fridgeSheet=workbook.Sheets['Frigo_lots'];
  if(fridgeSheet){
   var fridgeRows=XLSX.utils.sheet_to_json(fridgeSheet,{header:1,defval:null,raw:true});
   var drinkMap=new Map();
   all.forEach(function(p){if(p.type==='Boisson'){p.shopLots=[];drinkMap.set(p.name,p)}});
   for(var k=1;k<fridgeRows.length;k++){
    var fr=fridgeRows[k]||[];
    var productName=String(fr[0]||'').trim(),matched=drinkMap.get(productName);
    if(matched)addLotLocal(matched.shopLots,fr[1],fr[2]);
   }
  }
  if(!all.length)throw new Error('Aucune feuille Boissons ou Sec exploitable.');
  return {app:'Laudaflo',products:all,barcodeMap:{},movementHistory:[]};
 });
}
async function importExcel(){
 if(!ready)return message('importMessage','Connecte-toi.',true);
 if(records.length)return message('importMessage','Stock déjà rempli : import initial bloqué.',true);
 try{
  var data=await readExcelRows();
  await sendInitial(data);
 }catch(err){message('importMessage',err.message,true)}
}
function makeSheets(){
 if(!window.XLSX)throw new Error('Bibliothèque Excel indisponible.');
 var book=XLSX.utils.book_new();
 var drinks=records.filter(function(p){return p.type==='Boisson'});
 var dry=records.filter(function(p){return p.type==='Sec'});
 var maxD=Math.max(0,...drinks.map(function(p){return p.lots.length}));
 var maxS=Math.max(0,...dry.map(function(p){return p.lots.length}));
 var drinkHeaders=['Produit','Date frigo','Qte frigo','Total cave'];
 for(var d=0;d<maxD;d++)drinkHeaders.push('Date cave '+(d+1),'Qte cave '+(d+1));
 var drinkRows=[drinkHeaders];
 drinks.forEach(function(p){
  var row=[p.name,p.shopDate||'',p.shopQty===null?'':p.shopQty,totalLots(p)];
  for(var x=0;x<maxD;x++){var lot=p.lots[x];row.push(lot?lot.date:'',lot?lot.qty:'')}
  drinkRows.push(row);
 });
 var dryHeaders=['Produit','Stock total'];
 for(var s=0;s<maxS;s++)dryHeaders.push('Date '+(s+1),'Qte '+(s+1));
 var dryRows=[dryHeaders];
 dry.forEach(function(p){
  var row=[p.name,totalLots(p)];
  for(var z=0;z<maxS;z++){var lot=p.lots[z];row.push(lot?lot.date:'',lot?lot.qty:'')}
  dryRows.push(row);
 });
 var fridgeRows=[['Produit','Date du lot au frigo','Quantité']];
 drinks.forEach(function(p){
  (p.shopLots||[]).forEach(function(l){fridgeRows.push([p.name,l.date,l.qty])});
 });
 var codeRows=[['Code-barres','Produit']];
 Object.keys(barcodes).sort().forEach(function(b){codeRows.push([b,barcodes[b]])});
 var historyRows=[['Date','Mouvement','Produit','Date lot','Variation']];
 movements.forEach(function(m){historyRows.push([m.ts,m.type,m.product,m.date,m.qty])});
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(drinkRows),'Boissons');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(dryRows),'Sec');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(fridgeRows),'Frigo_lots');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(codeRows),'Codes-barres');
 XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet(historyRows),'Historique');
 return book;
}
function exportExcel(){
 try{XLSX.writeFile(makeSheets(),'Laudaflo_V15_'+new Date().toISOString().slice(0,10)+'.xlsx')}
 catch(err){message('importMessage','Erreur de l’export Excel : '+err.message,true)}
}
function escapeCsv(v){
 var s=String(v==null?'':v);
 return '"'+s.replace(/"/g,'""')+'"';
}
function exportCsv(){
 var lines=[['Catégorie','Produit','Lieu','Date du lot','Quantité']];
 records.forEach(function(p){
  if(p.type==='Boisson'){
   (p.shopLots||[]).forEach(function(l){lines.push([p.type,p.name,'Frigo',l.date,l.qty])});
   if(!(p.shopLots||[]).length)lines.push([p.type,p.name,'Frigo','',p.shopQty==null?'':p.shopQty]);
  }
  p.lots.forEach(function(l){lines.push([p.type,p.name,p.type==='Boisson'?'Cave':'Stock',l.date,l.qty])});
  if(!p.lots.length&&p.type!=='Boisson')lines.push([p.type,p.name,'Stock','',0]);
 });
 saveFile('Laudaflo_stock_'+new Date().toISOString().slice(0,10)+'.csv',
 '\ufeff'+lines.map(function(r){return r.map(escapeCsv).join(';')}).join('\r\n'),'text/csv;charset=utf-8');
}
document.addEventListener('DOMContentLoaded',function(){
 el('importJson').onclick=importJson;
 el('importExcel').onclick=importExcel;
 el('exportExcel').onclick=exportExcel;
 var csv=document.createElement('button');csv.textContent='Exporter en CSV (facile à ouvrir sur smartphone)';
 csv.className='secondary';csv.onclick=exportCsv;
 el('exportExcel').insertAdjacentElement('afterend',csv);
});
