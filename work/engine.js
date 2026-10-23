import * as P from './portfolio.js';
export const uid=()=>globalThis.crypto.randomUUID();
export const today=()=>new Date().toLocaleDateString('sv-SE');
export const stamp=()=>new Date().toISOString();
export const empty=()=>({version:2,portfolios:[],instruments:[],settlements:[],revision:0,started:false,demo:false,settings:{base:'RUB'},currencies:[{code:'RUB',precision:2},{code:'USD',precision:2},{code:'EUR',precision:2},{code:'USDT',precision:6}],accounts:[],assets:[],debts:[],events:[],rates:[],categories:['Зарплата','Продукты','Транспорт','Дом','Здоровье','Отдых','Подарки','Проценты','Комиссии','Другое'],audit:[]});
export function migrate(s){if(!s||s.version!==1)return s;const next=structuredClone(s);next.version=2;next.portfolios=[];next.instruments=[];next.settlements=[];if(!next.currencies.some(c=>c.code==='USDT'))next.currencies.push({code:'USDT',precision:6});return next;}
const fail=m=>{throw Error(m)};
export function dateOK(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!isNaN(Date.parse(s))&&new Date(s+'T12:00:00Z').toISOString().slice(0,10)===s;}
export function precision(s,c){return s.currencies.find(x=>x.code===c)?.precision??fail('Неизвестная валюта '+c);}
export function parseMoney(v,p=2){const t=String(v).trim();if(!/^[-+]?\d+(?:[.,]\d+)?$/.test(t))fail('Введите число без пробелов, например 1250,50');const [a,b='']=t.replace(',','.').replace(/^\+/,'').split('.');if(b.length>p)fail('Допустимо знаков после запятой: '+p);return (BigInt(a)*10n**BigInt(p)+(a.startsWith('-')?-1n:1n)*BigInt(b.padEnd(p,'0')||'0')).toString();}
export function decimal(n,p=2){let v=BigInt(n);return (v<0n?'-':'')+(p?(v<0n?-v:v).toString().padStart(p+1,'0').replace(new RegExp('(\\d{'+p+'})$'),'.$1'):(v<0n?-v:v).toString());}
export function round(n,d){if(d<=0n)fail('Некорректный делитель');return (n<0n?-1n:1n)*((n<0n?-n:n)+d/2n)/d;}
export function ratio(v){if(!/^\d+(?:[.,]\d{1,10})?$/.test(String(v)))fail('Курс: положительное число, до 10 знаков после запятой');const [a,b='']=String(v).replace(',','.').split('.');const n=BigInt(a+b),d=10n**BigInt(b.length);if(n<=0n)fail('Курс должен быть больше нуля');return {n:n.toString(),d:d.toString()};}
export function rateAt(s,c,date){if(c===s.settings.base)return {n:'1',d:'1',date};return s.rates.filter(r=>r.currency===c&&r.date<=date).sort((a,b)=>b.date.localeCompare(a.date)||b.createdAt.localeCompare(a.createdAt))[0]||null;}
export function convert(s,amount,c,date,rate){const r=rate===undefined?rateAt(s,c,date):rate;if(!r)return null;return round(BigInt(amount)*BigInt(r.n)*10n**BigInt(precision(s,s.settings.base)),BigInt(r.d)*10n**BigInt(precision(s,c)));}
const int=v=>typeof v==='string'&&/^-?\d+$/.test(v);
const positive=v=>int(v)&&BigInt(v)>0n;
export function sorted(s){return [...s.events].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order||a.id.localeCompare(b.id));}
export function makeEvent(s,input){const now=stamp();return {...input,id:input.id||uid(),order:input.order??Math.max(0,...s.events.map(e=>e.order))+1,createdAt:input.createdAt||now,updatedAt:now};}
export function snapshot(s,date=today()){
 const money=Object.fromEntries(s.accounts.filter(a=>a.date<=date).map(a=>[a.id,BigInt(a.opening)]));
 const assets=Object.fromEntries(s.assets.filter(a=>a.date<=date).map(a=>[a.id,BigInt(a.opening)]));
 const debts=Object.fromEntries(s.debts.filter(a=>a.date<=date).map(a=>[a.id,BigInt(a.opening)]));
 for(const e of sorted(s).filter(e=>!e.planned&&e.date<=date))for(const p of e.postings){const target=p.bucket==='money'?money:p.bucket==='asset'?assets:debts;target[p.id]=(target[p.id]??0n)+BigInt(p.amount);}
 return {money,assets,debts};
}
export function capital(s,date=today()){
 const balances=snapshot(s,date), missing=new Set(),parts={money:0n,assets:0n,receivables:0n,liabilities:0n,heldFunds:0n};
 for(const [bucket,items] of [['money',s.accounts],['assets',s.assets],['debts',s.debts]])for(const item of items){const value=balances[bucket][item.id];if(value===undefined||value===0n)continue;const base=convert(s,value,item.currency,date);if(base===null){missing.add(item.currency);continue;}parts[bucket==='debts'?(item.internalSettlementId?'heldFunds':item.direction==='owed'?'liabilities':'receivables'):bucket]+=base;}
 const investment=P.contribution(s,date);for(const c of investment.missing)missing.add(c);return {...parts,investments:investment.total,total:parts.money+parts.assets+parts.receivables-parts.liabilities-parts.heldFunds+investment.total,missing:[...missing],balances};
}
export function period(s,from,to){let income=0n,expense=0n;let flowBase=0n,exchangeEffect=0n;const flowMissing=new Set(),missing=new Set(),categories={},flows={},kinds={};for(const e of sorted(s).filter(e=>!e.planned&&e.date>=from&&e.date<=to)){
 for(const l of e.pnl||[]){const v=convert(s,l.amount,l.currency,e.date,l.rate);if(v===null){missing.add(l.currency);continue;}if(l.kind==='income')income+=v;else{expense+=v;categories[l.category]=(categories[l.category]||0n)+v;}}
 for(const p of e.postings.filter(p=>p.bucket==='money')){const c=s.accounts.find(a=>a.id===p.id).currency;flows[c]=(flows[c]||0n)+BigInt(p.amount);const value=convert(s,p.amount,c,e.date);if(value===null)flowMissing.add(c);else if(e.kind==='exchange'&&e.postings.indexOf(p)<2)exchangeEffect+=value;else flowBase+=value;}
 kinds[e.kind]=(kinds[e.kind]||0)+1;
 }return {income,expense,result:income-expense,missing:[...missing],categories,flows,kinds,flowBase,exchangeEffect,flowMissing:[...flowMissing]};}
function ref(s,b,id){return (b==='money'?s.accounts:b==='asset'?s.assets:s.debts).find(x=>x.id===id)||fail('Не найдена связанная запись');}
export function operation(s,v,checking=false){
 if(v.kind?.startsWith('inv:'))return P.operation(s,v,checking);
 const date=v.date||today(),postings=[],pnl=[];const add=(bucket,id,amount)=>{if(BigInt(amount)!==0n)postings.push({bucket,id,amount:amount.toString()});};
 const amount=BigInt(v.amount||'0'),fee=BigInt(v.fee||'0'),interest=BigInt(v.interest||'0');
 if(amount<0n||fee<0n||interest<0n)fail('Суммы должны быть положительными');
 const account=v.account?s.accounts.find(a=>a.id===v.account):null;
 const money=(a,n)=>{if(!a)fail('Выберите счёт');if(a.archived&&!checking)fail('Счёт в архиве');add('money',a.id,n);};
 const profit=(kind,n,c,category)=>{if(n!==0n)pnl.push({kind,amount:n.toString(),currency:c,category:category||'Другое',rate:rateAt(s,c,date)});};
 const asset=v.asset?s.assets.find(a=>a.id===v.asset):null, debt=v.debt?s.debts.find(a=>a.id===v.debt):null;
 if(!dateOK(date))fail('Проверьте дату');
 if(!['debtPayment','writeoff','revalue'].includes(v.kind)&&amount<=0n)fail('Введите сумму больше нуля');
 if(v.kind==='personTransfer'){if(!v.recipient?.trim())fail('Укажите получателя');money(account,-amount);profit('expense',amount,account.currency,v.category||'Переводы людям');}
 else if(v.kind==='debtReduce'){if(!debt)fail('Выберите долг');if(debt.archived&&!checking)fail('Долг в архиве');add('debt',debt.id,-amount);if(v.trackMoney){if(account?.currency!==debt.currency)fail('Счёт должен быть в валюте долга');money(account,(debt.direction==='owed'?-1n:1n)*amount);}}
 else if(v.kind==='income'||v.kind==='expense'){money(account,v.kind==='income'?amount:-amount);profit(v.kind,amount,account.currency,v.category);}
 else if(v.kind==='transfer'||v.kind==='exchange'){
 const target=s.accounts.find(a=>a.id===v.target);if(!account||!target||account.id===target.id)fail('Выберите два разных счёта');
 if(v.kind==='transfer'&&account.currency!==target.currency)fail('Для разных валют используйте обмен');
 if(v.kind==='exchange'&&account.currency===target.currency)fail('Для одной валюты используйте перевод');
 const received=v.kind==='transfer'?amount:BigInt(v.received||'0');if(received<=0n)fail('Введите полученную сумму');money(account,-amount);money(target,received);
 }else if(['settlementReceipt','settlementPayout','settlementExchange','settlementTransfer'].includes(v.kind)){
  const held=(id,currency)=>{const d=s.debts.find(x=>x.id===id&&x.internalSettlementId===v.settlementId&&x.currency===currency);if(!d)fail('Не найдено обязательство расчёта');return d;};
  const source=held(v.heldSource,v.currency),target=['settlementExchange','settlementTransfer'].includes(v.kind)?s.accounts.find(a=>a.id===v.target):null;
  if(account?.currency!==v.currency)fail('Валюта счёта не совпадает с расчётом');
  if(v.kind==='settlementReceipt'){money(account,amount);add('debt',source.id,amount);}
  if(v.kind==='settlementPayout'){money(account,-amount);add('debt',source.id,-amount);}
  if(v.kind==='settlementExchange'){const received=BigInt(v.received||'0');if(!target||target.currency!==v.receivedCurrency||target.id===account.id||received<=0n||v.receivedCurrency===v.currency)fail('Проверьте обе стороны обмена');const destination=held(v.heldTarget,v.receivedCurrency);money(account,-amount);money(target,received);add('debt',source.id,-amount);add('debt',destination.id,received);}
  if(v.kind==='settlementTransfer'){if(!target||target.currency!==v.currency||target.id===account.id)fail('Выберите два разных счёта одной валюты');money(account,-amount);money(target,amount);}
  if(fee>0n){const feeCurrency=v.feeCurrency||v.currency,feeAccount=feeCurrency===v.receivedCurrency&&v.kind==='settlementExchange'?target:account,feeDebt=held(v.heldFee,feeCurrency);money(feeAccount,-fee);add('debt',feeDebt.id,-fee);}
  return makeEvent(s,{...v,date,postings,pnl,planned:date>today()||!!v.planned});
 }else if(v.kind==='adjust'){if(!v.reason?.trim())fail('Укажите причину корректировки');money(account,v.sign==='minus'?-amount:amount);}
 else if(['debtIncrease','debtPayment','writeoff'].includes(v.kind)){
 if(!debt)fail('Выберите долг');if(debt.archived&&!checking)fail('Долг в архиве');const sign=debt.direction==='owed'?1n:-1n;
 if(v.kind==='debtIncrease'){add('debt',debt.id,amount);if(!v.noMoney){if(account?.currency!==debt.currency)fail('Счёт должен быть в валюте долга');money(account,sign*amount);}}
 else if(v.kind==='debtPayment'){if(amount+interest+fee<=0n)fail('Введите основную сумму, проценты или комиссию');if(account?.currency!==debt.currency)fail('Счёт должен быть в валюте долга');add('debt',debt.id,-amount);money(account,-sign*(amount+interest));profit(debt.direction==='owed'?'expense':'income',interest,debt.currency,'Проценты');}
 else {if(!v.reason?.trim())fail('Укажите причину списания');const current=snapshot(s,date).debts[debt.id]||0n;if(current<=0n)fail('Нет остатка для списания');add('debt',debt.id,-current);}
 }else if(['assetBuy','assetSell','revalue'].includes(v.kind)){
 if(!asset)fail('Выберите актив');if(asset.archived&&!checking)fail('Актив в архиве');const current=snapshot(s,date).assets[asset.id]||0n;
 if(v.kind==='assetBuy'){if(account?.currency!==asset.currency)fail('Счёт должен быть в валюте актива');if(current!==0n)fail('Актив уже имеет оценку');money(account,-amount);add('asset',asset.id,amount);}
 else if(v.kind==='assetSell'){if(current<=0n)fail('Актив уже продан или не имеет оценки');if(account?.currency!==asset.currency)fail('Счёт должен быть в валюте актива');money(account,amount);add('asset',asset.id,-current);}
 else {add('asset',asset.id,amount-current);}
 }else if(v.kind==='refund'){
 const original=s.events.find(e=>e.id===v.original);if(!original||!['expense','income'].includes(original.kind))fail('Возврат доступен для дохода или расхода');const line=original.pnl[0],a=s.accounts.find(a=>a.id===original.postings[0].id);money(a,original.kind==='expense'?amount:-amount);profit(line.kind,-amount,line.currency,line.category);
 }else fail('Неизвестный тип операции');
 if(fee>0n){const fa=s.accounts.find(a=>a.id===v.feeAccount)||account;if(v.kind==='debtPayment'&&fa?.currency!==debt.currency)fail('Комиссия платежа должна быть в валюте долга');money(fa,-fee);profit('expense',fee,fa.currency,'Комиссии');}
 if(!postings.length)fail('Операция не меняет состояние');
 return makeEvent(s,{...v,date,postings,pnl,planned:date>today()||!!v.planned});
}
export function validate(s){
 s=migrate(s);
 if(!s||s.version!==2||!Number.isSafeInteger(s.revision)||s.revision<0||typeof s.started!=='boolean'||typeof s.demo!=='boolean'||!s.settings||s.settings.base!=='RUB')fail('Неподдерживаемый формат резервной копии');
 for(const key of ['currencies','accounts','assets','debts','events','rates','categories','audit'])if(!Array.isArray(s[key])||s[key].length>100000)fail('Некорректный список '+key);
 if(!s.currencies.some(c=>c.code==='RUB'&&c.precision===2))fail('Не найдена базовая валюта RUB');
 const codes=new Set();for(const c of s.currencies){if(!/^[A-Z]{3,8}$/.test(c.code)||codes.has(c.code)||!Number.isInteger(c.precision)||c.precision<0||c.precision>6)fail('Некорректная валюта');codes.add(c.code);}
 if(s.settlements===undefined)s.settlements=[];
 if(!Array.isArray(s.settlements)||s.settlements.length>10000)fail('Некорректный список расчётов');
 const settlementIds=new Set(),stepIds=new Set();
 for(const settlement of s.settlements){if(typeof settlement.id!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(settlement.id)||settlementIds.has(settlement.id)||typeof settlement.title!=='string'||settlement.title.length>200||typeof settlement.counterparty!=='string'||settlement.counterparty.length>240||!Array.isArray(settlement.steps)||settlement.steps.length>10000)fail('Некорректный расчёт');settlementIds.add(settlement.id);if(settlement.targetAmount!==''&&settlement.targetAmount!==undefined&&(!int(settlement.targetAmount)||BigInt(settlement.targetAmount)<=0n||!s.currencies.some(c=>c.code===settlement.targetCurrency)))fail('Некорректная сумма к передаче');for(const step of settlement.steps){if(typeof step.id!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(step.id)||stepIds.has(step.id)||!['receipt','payout','exchange','transfer'].includes(step.kind)||!['held','own'].includes(step.funding)||!dateOK(step.date)||!positive(step.amount)||!s.currencies.some(c=>c.code===step.currency)||!int(step.fee||'0')||BigInt(step.fee||'0')<0n)fail('Некорректный шаг расчёта');stepIds.add(step.id);if(step.kind==='exchange'&&(!positive(step.received)||!s.currencies.some(c=>c.code===step.receivedCurrency)||step.currency===step.receivedCurrency))fail('Некорректный обмен расчёта');}}
 if(s.categories.some(x=>typeof x!=='string'||!x.trim()||x.length>120))fail('Некорректная категория');
 const ids=new Set();for(const x of [...s.accounts,...s.assets,...s.debts,...s.events,...s.rates]){if(typeof x.id!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(x.id)||ids.has(x.id))fail('Повторяющийся или пустой идентификатор');ids.add(x.id);}
 for(const [bucket,items] of [['money',s.accounts],['asset',s.assets],['debt',s.debts]])for(const item of items){if(typeof item.name!=='string'||!item.name.trim()||item.name.length>200||!codes.has(item.currency)||!dateOK(item.date)||!int(item.opening))fail('Некорректные исходные данные');if(bucket!=='money'&&BigInt(item.opening)<0n)fail('Отрицательная исходная оценка или долг');if(bucket==='debt'&&!['owed','lent'].includes(item.direction))fail('Некорректное направление долга');if(item.due&&!dateOK(item.due))fail('Некорректный срок');if(bucket==='asset'&&(!/^\d+(?:\.\d{1,4})?$/.test(item.share)||Number(item.share)<=0||Number(item.share)>100))fail('Доля должна быть от 0 до 100%');}
 for(const r of s.rates)if(!codes.has(r.currency)||r.currency==='RUB'||!dateOK(r.date)||!positive(r.n)||!positive(r.d)||typeof r.createdAt!=='string')fail('Некорректный курс');
 const balances={money:{},asset:{},debt:{}},active={};for(const [b,items] of [['money',s.accounts],['asset',s.assets],['debt',s.debts]])for(const x of items){balances[b][x.id]=BigInt(x.opening);if(b==='asset')active[x.id]=BigInt(x.opening)>0n;}
 const refunds={};const kinds=['personTransfer','debtReduce','income','expense','transfer','exchange','adjust','debtIncrease','debtPayment','writeoff','assetBuy','assetSell','revalue','refund','settlementReceipt','settlementPayout','settlementExchange','settlementTransfer'];
 for(const e of sorted(s)){
 if((!kinds.includes(e.kind)&&!P.investmentKinds[e.kind])||!dateOK(e.date)||!Number.isSafeInteger(e.order)||typeof e.createdAt!=='string'||isNaN(Date.parse(e.createdAt))||typeof e.updatedAt!=='string'||isNaN(Date.parse(e.updatedAt))||typeof e.planned!=='boolean'||!Array.isArray(e.postings)||(!e.postings.length&&!P.investmentKinds[e.kind])||!Array.isArray(e.pnl))fail('Некорректное событие');
 if(!e.planned&&e.date>today())fail('Будущая операция должна быть запланированной');
 if(e.postings.length>10||e.pnl.length>4)fail('Слишком много частей операции');
 for(const p of e.postings){if(!['money','asset','debt'].includes(p.bucket)||!int(p.amount))fail('Некорректное движение');const item=ref(s,p.bucket,p.id);if(item.date>e.date)fail('Операция раньше начала учёта связанной записи');}
 for(const p of e.pnl){if(!['income','expense'].includes(p.kind)||!int(p.amount)||!codes.has(p.currency)||typeof p.category!=='string')fail('Некорректный доход или расход');if(p.rate!==null&&(!p.rate||!positive(p.rate.n)||!positive(p.rate.d)||!dateOK(p.rate.date)||p.rate.date>e.date))fail('Некорректный зафиксированный курс');}
 // Reconstruct derived parts, rejecting forged imports or broken links.
 const prefix={...s,events:s.events.filter(x=>!x.planned&&(x.date<e.date||(x.date===e.date&&(x.order<e.order||(x.order===e.order&&x.id<e.id)))))};
 const reconstructed=operation(prefix,{...e,id:undefined},true);
 if(JSON.stringify(e.postings)!==JSON.stringify(reconstructed.postings)||JSON.stringify(e.pnl)!==JSON.stringify(reconstructed.pnl.map((p,i)=>({...p,rate:e.pnl[i]?.rate}))))fail('Части операции не соответствуют её полям');
 if(e.kind==='refund'){const original=s.events.find(x=>x.id===e.original);if(!original||original.planned||original.date>e.date)fail('Нет исходной операции для возврата');refunds[e.original]=(refunds[e.original]||0n)+BigInt(e.amount);if(refunds[e.original]>BigInt(original.amount))fail('Возврат превышает исходную сумму');}
 if(e.planned)continue;
 if(e.kind==='revalue'&&!active[e.asset])fail('Нельзя переоценить проданный или ещё не приобретённый актив');
 if(e.kind==='assetBuy'&&active[e.asset])fail('Актив уже приобретён');
 if(e.kind==='assetSell'&&!active[e.asset])fail('Актив уже продан');
 for(const p of e.postings){balances[p.bucket][p.id]+=BigInt(p.amount);if(p.bucket!=='money'&&balances[p.bucket][p.id]<0n)fail(p.bucket==='debt'?'Погашение превышает остаток долга на дату платежа':'Отрицательная оценка актива');}
 if(e.kind==='assetBuy')active[e.asset]=true;if(e.kind==='assetSell')active[e.asset]=false;
 }
 P.validate(s);return s;
}
export function recalculate(s){const next=migrate(structuredClone(s)),all=sorted(next);next.events=[];for(const e of all){if(e.kind.startsWith('inv:')){const g=operation(next,e,true);next.events.push({...e,postings:g.postings,pnl:g.pnl.map((l,j)=>({...l,rate:e.pnl[j]?e.pnl[j].rate:l.rate}))});}else if(['revalue','assetSell','writeoff'].includes(e.kind)){const generated=operation(next,e,true);next.events.push({...e,postings:generated.postings});}else next.events.push(e);}return next;}
export function commitEvent(s,e){const next=structuredClone(s),i=next.events.findIndex(x=>x.id===e.id);if(i<0)next.events.push(e);else{const old=next.events[i];next.events[i]=e;next.audit.push({id:uid(),at:stamp(),action:'Изменена операция',entity:e.id,before:old,after:e});}return validate(recalculate(next));}
export function removeEvent(s,id){const next=structuredClone(s),e=next.events.find(x=>x.id===id);next.events=next.events.filter(x=>x.id!==id);next.audit.push({id:uid(),at:stamp(),action:'Удалена операция со всеми частями',entity:id,before:e});return validate(recalculate(next));}
export function backup(s){return JSON.stringify({...s,exportedAt:stamp()},null,2);}
export function importData(text){if(new TextEncoder().encode(text).length>10*1024*1024)fail('Файл больше 10 МБ');let s;try{s=JSON.parse(text)}catch{fail('Файл не является корректным JSON')}return validate(s);}
export function csv(s){const esc=x=>'"'+String(x??'').replace(/^[\s]*[=+@\-\t\r]/,"'$&").replaceAll('"','""')+'"';const currency=e=>e.currency||s.accounts.find(a=>a.id===e.account)?.currency||s.debts.find(d=>d.id===e.debt)?.currency||s.assets.find(a=>a.id===e.asset)?.currency||'RUB';return '\uFEFF'+[['Дата','Тип','Сумма','Валюта','Категория','Комментарий','Статус','Получатель','Инструмент','Количество','Цена','Комиссия'],...sorted(s).map(e=>[e.date,e.kind,decimal(e.amount||'0',precision(s,currency(e))),currency(e),e.category,e.comment,e.planned?'Запланировано':'Проведено',e.recipient,s.instruments?.find(i=>i.id===e.instrument)?.ticker,e.quantity?decimal(e.quantity,8):'',e.price?decimal(e.price,8):'',decimal(e.fee||'0',precision(s,currency(e)))])].map(row=>row.map(esc).join(';')).join('\r\n');}
