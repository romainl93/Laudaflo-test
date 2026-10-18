'use strict';
// Laudaflo V15 - le client ne contient qu'une cle publique Supabase.
// Les autorisations et toutes les ecritures sont controlees par la base.
var supa=null, records=[], barcodes={}, movements=[], selectedKey='', activeView='stock';
var ready=false, loading=false, writing=false, timer=null, scanner=null, liveScanner=false;
var projectUrl='https://bsnlgolauuvktvrkaxtx.supabase.co';
var publishable='sb_publishable_ZUE32prMoTrnlyVnBQRbpQ_hSYTVKBK';
function el(id){return document.getElementById(id)}
function message(id,text,isError){
 var node=el(id);if(!node)return;
 node.textContent=text;node.className='msg '+(isError?'error':'success');
}
function setScreen(granted){
 ready=granted;el('authScreen').classList.toggle('hidden',granted);
 el('app').classList.toggle('hidden',!granted);
 el('nav').classList.toggle('hidden',!granted);
}
async function signUp(){
 if(!supa)return message('authInfo','La connexion cloud est indisponible. Recharge la page.',true);
 var email=el('email').value.trim(),password=el('password').value;
 if(!email||password.length<8)return message('authInfo','Indique ton e-mail et un mot de passe de 8 caractères minimum.',true);
 message('authInfo','Création du compte en cours…');
 try{
  var resp=await supa.auth.signUp({email:email,password:password});
  if(resp.error)throw resp.error;
  message('authInfo','Compte créé. Confirme ton adresse e-mail avec le message de Supabase, puis demande son activation dans ChatGPT. Reviens ensuite ici pour te connecter.');
  if(resp.data&&resp.data.session)await authorize();
 }catch(err){message('authInfo',err.message,true)}
}
async function signIn(){
 if(!supa)return message('authInfo','Connexion au serveur indisponible.',true);
 var email=el('email').value.trim(),password=el('password').value;
 if(!email||!password)return message('authInfo','Entre ton adresse e-mail et ton mot de passe.',true);
 message('authInfo','Connexion en cours…');
 try{
  var resp=await supa.auth.signInWithPassword({email:email,password:password});
  if(resp.error)throw resp.error;
  await authorize();
 }catch(err){message('authInfo',err.message,true)}
}
async function authorize(){
 if(!supa)return;
 try{
  var r=await supa.auth.getUser(),user=r.data&&r.data.user;
  if(r.error||!user){setScreen(false);return;}
  el('accountLabel').textContent=user.email||'Compte Laudaflo';
  el('signOutAuth').classList.remove('hidden');
  if(!user.email_confirmed_at){
   setScreen(false);
   return message('authInfo','Confirme d’abord ton adresse e-mail avec le lien reçu, puis reconnecte-toi.',true);
  }
  var m=await supa.from('laudaflo_members').select('user_id').eq('user_id',user.id).maybeSingle();
  if(m.error)throw m.error;
  if(!m.data){
   setScreen(false);
   return message('authInfo','Ton e-mail est confirmé, mais ton compte attend son activation. Reviens dans ChatGPT et dis « compte créé ». Je vérifierai ta demande pour autoriser l’accès au stock. Ne communique aucun mot de passe.',true);
  }
  setScreen(true);
  if(timer)clearInterval(timer);
  await refresh();
  timer=setInterval(function(){if(document.visibilityState==='visible')refresh()},15000);
 }catch(err){setScreen(false);message('authInfo','Erreur de vérification : '+err.message,true)}
}
async function signOut(){
 if(timer){clearInterval(timer);timer=null}
 await stopCamera();
 try{await supa.auth.signOut()}catch(e){}
 records=[];barcodes={};movements=[];selectedKey='';
 el('password').value='';el('accountLabel').textContent='';
 setScreen(false);el('signOutAuth').classList.add('hidden');
 message('authInfo','Compte déconnecté.');
}
function productKey(p){return p.type+'|'+p.name}
function findProduct(key){return records.find(function(p){return productKey(p)===key})}
async function allRows(table){
 var result=[];
 for(var page=0;page<30;page++){
  var r=await supa.from(table).select('*').range(page*1000,page*1000+999);
  if(r.error)throw r.error;
  var rows=r.data||[];result=result.concat(rows);
  if(rows.length<1000)return result;
 }
 throw new Error('Trop de données : la pagination est incomplète.');
}
async function refresh(){
 if(!ready||loading||writing)return;
 loading=true;
 try{
  var sets=await Promise.all([allRows('laudaflo_products'),allRows('laudaflo_lots'),allRows('laudaflo_barcodes'),allRows('laudaflo_movements'),allRows('laudaflo_shop_lots')]);
  var byId={},latest=[];
  sets[0].forEach(function(p){
   var item={id:p.id,type:p.product_type,name:p.name,shopQty:p.shop_qty===null?null:Number(p.shop_qty),shopDate:p.shop_date||'',lots:[],shopLots:[]};
   latest.push(item);byId[p.id]=item;
  });
  sets[1].forEach(function(l){
   if(byId[l.product_id]&&Number(l.quantity)>0)byId[l.product_id].lots.push({date:l.expiry_date||'',qty:Number(l.quantity)});
  });
  sets[4].forEach(function(l){
   if(byId[l.product_id]&&Number(l.quantity)>0)byId[l.product_id].shopLots.push({date:l.expiry_date||'',qty:Number(l.quantity)});
  });
  var latestBarcodes={};
  sets[2].forEach(function(b){if(byId[b.product_id])latestBarcodes[b.barcode]=productKey(byId[b.product_id])});
  var latestHistory=sets[3].sort(function(a,b){return String(b.created_at).localeCompare(String(a.created_at))}).slice(0,300).map(function(h){
   return {ts:h.created_at,type:h.movement_type,product:h.product_name,date:h.lot_date||'',qty:Number(h.quantity_delta)};
  });
  records=latest;barcodes=latestBarcodes;movements=latestHistory;
  el('connection').textContent='Stock commun actualisé à '+new Date().toLocaleTimeString('fr-BE')+' • '+records.length+' références';
  renderStock();renderDates();renderHistory();
  var focused=document.activeElement;
  if(selectedKey&&!(el('detail').contains(focused)&&/^(INPUT|SELECT)$/.test(focused.tagName)))renderDetail();
 }catch(err){
  el('connection').textContent='Connexion interrompue : '+err.message+'. Réessaie avec « Actualiser ».';
 }finally{loading=false}
}
function switchView(view){
 activeView=view;
 ['stock','scan','dates','history','import'].forEach(function(name){
  el('view-'+name).classList.toggle('hidden',name!==view);
  document.querySelector('[data-view="'+name+'"]').classList.toggle('active',name===view);
 });
 if(view!=='scan')stopCamera();
 if(view==='stock')renderStock();
 if(view==='dates')renderDates();
 if(view==='history')renderHistory();
 window.scrollTo({top:0,behavior:'smooth'});
}
function totalLots(p){return p.lots.reduce(function(sum,l){return sum+Number(l.qty||0)},0)}
function fridgeLotsTotal(p){return (p.shopLots||[]).reduce(function(sum,l){return sum+Number(l.qty||0)},0)}
function renderStock(){
 var search=el('search').value.toLocaleLowerCase().trim();
 var subset=records.filter(function(p){return !search||p.name.toLocaleLowerCase().includes(search)});
 el('stockSummary').textContent=records.length+' références dans le stock commun • '+subset.length+' affichées';
 var list=el('productList');list.replaceChildren();
 subset.slice(0,250).forEach(function(p){
  var btn=document.createElement('button');btn.className='itemButton';
  var title=document.createElement('strong'),sub=document.createElement('span');
  title.textContent=p.name;
  sub.textContent=(p.type==='Boisson'?'Cave : ':'Stock sec : ')+totalLots(p)+' unité(s)';
  btn.append(title,sub);btn.onclick=function(){openProduct(productKey(p))};list.appendChild(btn);
 });
 if(subset.length>250){
  var warning=document.createElement('p');warning.className='muted';warning.textContent='Affichage limité à 250 résultats. Affine la recherche.';
  list.appendChild(warning);
 }
}
function openProduct(key){
 selectedKey=key;switchView('stock');renderDetail();
 el('detail').scrollIntoView({behavior:'smooth',block:'start'});
}
function options(id,p,includeBlank){
 var sel=el(id);sel.replaceChildren();
 var o=document.createElement('option');o.value='';o.textContent=includeBlank;sel.appendChild(o);
 p.lots.forEach(function(l,i){
  var opt=document.createElement('option');opt.value=String(i);
  opt.textContent=(l.date||'Sans date')+' — '+l.qty+' unités';
  sel.appendChild(opt);
 });
}
function fridgeOptions(p){
 var sel=el('fridgeLot');sel.replaceChildren();
 var placeholder=document.createElement('option');placeholder.value='';placeholder.textContent='Choisir le lot du frigo';sel.appendChild(placeholder);
 (p.shopLots||[]).forEach(function(l,i){
  var opt=document.createElement('option');opt.value=String(i);
  opt.textContent=(l.date||'Sans date')+' — '+l.qty+' unités';sel.appendChild(opt);
 });
}
function renderDetail(){
 var p=findProduct(selectedKey);
 el('detail').classList.toggle('hidden',!p);
 if(!p)return;
 el('detailName').textContent=p.name;
 el('detailSummary').textContent=p.type==='Boisson'
  ?'Stock en cave : '+totalLots(p)+' unité(s) | Lots en cave : '+(p.lots.map(function(l){return (l.date||'Sans date')+' ('+l.qty+')'}).join(', ')||'Aucun lot')
  :'Stock : '+totalLots(p)+' | Lots : '+p.lots.map(function(l){return (l.date||'Sans date')+' ('+l.qty+')'}).join(', ');
 el('outSection').classList.toggle('hidden',p.type!=='Boisson');
 // Les relevés de frigo historiques sont conservés, mais le suivi quotidien est centré sur la cave.
 el('fridgeSection').classList.add('hidden');
 if(p.type==='Boisson')fridgeOptions(p);
 options('outLot',p,'Choisir le lot à sortir');
 options('correctionLot',p,'Choisir le lot à corriger');
}
function checkedQty(id,allowZero){
 var raw=el(id).value,n=Number(raw);
 if(raw===''||!Number.isSafeInteger(n)||n<0||(!allowZero&&n===0)||n>100000000)throw new Error('Indique une quantité entière '+(allowZero?'positive ou nulle.':'strictement positive.'));
 return n;
}
function excelDate(value){
 if(!value)return'';
 var a=value.split('-');return a.length===3?a[2]+'/'+a[1]+'/'+a[0]:'';
}
async function operation(type){
 if(writing)return;
 var p=findProduct(selectedKey);
 if(!p)return message('detailMessage','Produit introuvable. Actualise le stock.',true);
 var date='',amount;
 try{
  if(type==='delivery'){
   date=excelDate(el('deliveryDate').value);amount=checkedQty('deliveryQty',false);
   if(!date)throw new Error('Indique la date du lot livré.');
  }else if(type==='restock'){
   if(el('outLot').value===''||!p.lots[Number(el('outLot').value)])throw new Error('Choisis le lot à sortir.');
   date=p.lots[Number(el('outLot').value)].date;amount=checkedQty('outQty',false);
  }else if(type==='fridge_correction'){
   if(p.type!=='Boisson'||el('fridgeLot').value===''||!p.shopLots[Number(el('fridgeLot').value)])throw new Error('Choisis le lot du frigo.');
   date=p.shopLots[Number(el('fridgeLot').value)].date;amount=checkedQty('fridgeQty',true);
  }else{
   if(el('correctionLot').value===''||!p.lots[Number(el('correctionLot').value)])throw new Error('Choisis le lot à corriger.');
   date=p.lots[Number(el('correctionLot').value)].date;amount=checkedQty('correctionQty',true);
  }
  writing=true;
  message('detailMessage','Enregistrement sur le stock commun…');
  var r=type==='restock'
   ?await supa.rpc('laudaflo_restock_fridge',{p_product_key:selectedKey,p_date:date,p_amount:amount})
   :await supa.rpc('laudaflo_change_stock',{p_product_key:selectedKey,p_operation:type,p_date:date,p_amount:amount});
  if(r.error)throw r.error;
  writing=false;await refresh();
  renderDetail();
  message('detailMessage',type==='restock'?
   'Réassort enregistré : '+amount+' unité(s) retirée(s) de la cave. Le comptage des frigos n’a pas été modifié.':
   'Enregistré sur le stock commun. La modification est sauvegardée.');
 }catch(err){
  writing=false;message('detailMessage','Opération non enregistrée : '+err.message,true);
  await refresh();
 }
}
function dateDays(value){
 var m=String(value||'').match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);if(!m)return null;
 var date=new Date(Number(m[3]),Number(m[2])-1,Number(m[1]));
 if(date.getFullYear()!==Number(m[3])||date.getMonth()!==Number(m[2])-1||date.getDate()!==Number(m[1]))return null;
 var now=new Date();
 return Math.round((Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())-Date.UTC(now.getFullYear(),now.getMonth(),now.getDate()))/86400000);
}
function renderDates(){
 var horizon=el('datesWindow').value;
 var maxDays=horizon==='all'?Infinity:Number(horizon);
 var search=el('datesSearch').value.trim().toLocaleLowerCase();
 var matching=[],totalDated=0,unreadable=0,expired=0,soon=0;
 records.forEach(function(p){
  p.lots.forEach(function(l){
   if(!(Number(l.qty)>0))return;
   var d=dateDays(l.date);
   if(d===null){
    if(l.date&&l.date.trim())unreadable++;
    return;
   }
   totalDated++;
   if(d>maxDays || (search&&!p.name.toLocaleLowerCase().includes(search)))return;
   matching.push({p:p,date:l.date,qty:l.qty,days:d,place:p.type==='Boisson'?'Cave':'Stock sec'});
   if(d<0)expired++;
   else if(d<=7)soon++;
  });
 });
 matching.sort(function(a,b){return a.days-b.days||a.p.name.localeCompare(b.p.name,'fr')});
 el('datesSummary').textContent=matching.length+' lot(s) affiché(s) sur '+totalDated+' lot(s) avec une date valide'
  +' • '+expired+' périmé(s) • '+soon+' à échéance sous 7 jours'
  +(unreadable?' • '+unreadable+' date(s) à vérifier':'');
 var box=el('datesList');box.replaceChildren();
 if(!matching.length){
  var empty=document.createElement('p');
  empty.className='muted';
  empty.textContent=search?'Aucun produit ne correspond à cette recherche.':'Aucune date à afficher pour cette période.';
  box.appendChild(empty);return;
 }
 matching.forEach(function(x){
  var b=document.createElement('button');b.className='itemButton';
  var title=document.createElement('strong'),sub=document.createElement('span');
  title.textContent=x.p.name;
  sub.textContent=x.place+' • '+x.date+' • '+x.qty+' unité(s) • '
   +(x.days<0?'Périmé depuis '+(-x.days)+' j':x.days===0?"Expire aujourd'hui":'Dans '+x.days+' j');
  if(x.days<0)sub.className='expired';
  else if(x.days<=7)sub.className='soon';
  b.append(title,sub);b.onclick=function(){openProduct(productKey(x.p))};box.appendChild(b);
 });
}
function renderHistory(){
 var box=el('historyList');box.replaceChildren();
 if(!movements.length){box.textContent='Aucun mouvement enregistré.';return}
 movements.forEach(function(m){
  var row=document.createElement('div'),label=document.createElement('b'),sub=document.createElement('small');
  row.className='row';label.textContent=m.product||'Produit';
  var when=new Date(m.ts);
  var changeText=m.type==='Cave vers frigo'?'Ancien transfert : '+Math.abs(m.qty)+' unité(s) de la cave vers le frigo'
   :m.type==='Réassort frigo'?'Réassort : '+Math.abs(m.qty)+' unité(s) prises en cave'
   :(m.type||'Mouvement')+' : '+(m.qty>0?'+':'')+m.qty+' unité(s)';
  sub.textContent=changeText+' • '+(m.date||'Sans date')+' • '+(isNaN(when.getTime())?'':when.toLocaleString('fr-BE'));
  row.append(label,sub);box.appendChild(row);
 });
}
async function startCamera(){
 if(liveScanner)return;
 if(!window.Html5Qrcode)return message('scanMessage','Bibliothèque du scanner indisponible.',true);
 try{
  scanner=new Html5Qrcode('reader');
  var cameras=await Html5Qrcode.getCameras();
  if(!cameras.length)throw new Error('Aucune caméra détectée.');
  var back=cameras.find(function(c){return /back|rear|environment|arrière/i.test(c.label)})||cameras[cameras.length-1];
  await scanner.start(back.id,{fps:10,qrbox:{width:250,height:130}},function(value){
   el('barcode').value=value;stopCamera();lookupBarcode();
  },function(){});
  liveScanner=true;message('scanMessage','Caméra activée.');
 }catch(err){message('scanMessage','Erreur caméra : '+err.message,true)}
}
async function stopCamera(){
 if(scanner){try{if(liveScanner)await scanner.stop();await scanner.clear()}catch(e){}}
 scanner=null;liveScanner=false;
}
function lookupBarcode(){
 var code=el('barcode').value.trim();if(!code)return message('scanMessage','Indique un code-barres.',true);
 if(barcodes[code]){
  message('scanMessage','Produit reconnu.');el('associate').classList.add('hidden');openProduct(barcodes[code]);
 }else{
  message('scanMessage','Code inconnu. Associe-le à un produit.');
  el('associate').classList.remove('hidden');renderAssociate();
 }
}
function renderAssociate(){
 var needle=el('associateSearch').value.trim().toLowerCase();
 var box=el('associateList');box.replaceChildren();
 records.filter(function(p){return !needle||p.name.toLowerCase().includes(needle)}).slice(0,40).forEach(function(p){
  var b=document.createElement('button');b.className='itemButton';b.textContent=p.name+' — '+p.type;
  b.onclick=function(){associate(p)};box.appendChild(b);
 });
}
async function associate(p){
 var code=el('barcode').value.trim();
 if(!code)return message('scanMessage','Code-barres manquant.',true);
 try{
  var r=await supa.rpc('laudaflo_set_barcode',{p_barcode:code,p_product_key:productKey(p)});
  if(r.error)throw r.error;
  await refresh();el('associate').classList.add('hidden');
  message('scanMessage','Association enregistrée sur le stock commun.');
  openProduct(productKey(p));
 }catch(err){message('scanMessage','Impossible d’associer le produit : '+err.message,true)}
}
function saveFile(filename,contents,mime){
 var blob=new Blob([contents],{type:mime}),url=URL.createObjectURL(blob);
 var link=document.createElement('a');link.href=url;link.download=filename;
 document.body.appendChild(link);link.click();link.remove();
 setTimeout(function(){URL.revokeObjectURL(url)},4000);
}
function backup(){
 saveFile('Laudaflo_V15_'+new Date().toISOString().slice(0,10)+'.json',
 JSON.stringify({app:'Laudaflo',version:'V15',exportedAt:new Date().toISOString(),
  products:records.map(function(p){return {type:p.type,name:p.name,shopDate:p.shopDate,shopQty:p.shopQty,lots:p.lots,shopLots:p.shopLots}}),
  barcodeMap:barcodes,movementHistory:movements},null,2),'application/json');
}
function init(){
 if(!window.supabase){message('authInfo','La connexion Supabase ne s’est pas chargée. Vérifie Internet puis recharge.',true);return;}
 supa=window.supabase.createClient(projectUrl,publishable,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
 el('signUp').onclick=signUp;el('signIn').onclick=signIn;el('signOut').onclick=signOut;el('signOutAuth').onclick=signOut;
 el('refreshButton').onclick=refresh;el('search').oninput=renderStock;
 el('datesWindow').onchange=renderDates;el('datesSearch').oninput=renderDates;
 el('deliveryButton').onclick=function(){operation('delivery')};
 el('outButton').onclick=function(){operation('restock')};
 el('fridgeButton').onclick=function(){operation('fridge_correction')};
 el('correctionButton').onclick=function(){operation('correction')};
 el('startCamera').onclick=startCamera;el('stopCamera').onclick=stopCamera;
 el('lookup').onclick=lookupBarcode;el('associateSearch').oninput=renderAssociate;
 el('backupButton').onclick=backup;
 document.querySelectorAll('nav button[data-view]').forEach(function(b){b.onclick=function(){switchView(b.dataset.view)}});
 document.addEventListener('visibilitychange',function(){if(!document.hidden&&ready)refresh()});
 authorize();
}
document.addEventListener('DOMContentLoaded',init);
