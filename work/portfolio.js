import * as E from './engine.js?v=studio3';
export const SCALE=100000000n;
export const investmentKinds={ 'inv:fund':'Пополнение портфеля','inv:withdraw':'Вывод из портфеля','inv:existing':'Начальная позиция','inv:buy':'Покупка','inv:sell':'Продажа','inv:price':'Ручная оценка','inv:coupon':'Купон','inv:dividend':'Дивиденды / проценты','inv:redeem':'Погашение облигации','inv:open':'Открытие фьючерса','inv:close':'Закрытие фьючерса','inv:levels':'Тейки и стоп','inv:fee':'Комиссия портфеля'};
export const typeNames={crypto:'Криптовалюта',stock:'Акции',bond:'Облигации',future:'Фьючерсы'};
const fail=m=>{throw Error(m)};
const bi=v=>BigInt(v||'0');
const integer=v=>typeof v==='string'&&/^-?\d{1,40}$/.test(v);
const nonnegative=v=>integer(v)&&bi(v)>=0n;
export const exact=(v)=>E.parseMoney(v,8);
export function units(v){return E.decimal(v,8).replace(/\.?0+$/,'')||'0';}
export function gross(s,instrument,quantity,price){return E.round(bi(quantity)*bi(price)*10n**BigInt(E.precision(s,instrument.currency)),SCALE*SCALE);}
export function perUnit(s,instrument,amount,quantity){return bi(quantity)>0n?E.round(bi(amount)*SCALE*SCALE,bi(quantity)*10n**BigInt(E.precision(s,instrument.currency))):0n;}
export function pnlFuture(s,i,q,entry,exit,direction){return gross(s,i,q,bi(exit)-bi(entry))*(direction==='short'?-1n:1n);}
export const instrument=(s,id)=>s.instruments?.find(i=>i.id===id);
export const portfolio=(s,id)=>s.portfolios?.find(p=>p.id===id);
export function accountFor(s,p,c){return s.accounts.find(a=>a.portfolio===p.id&&a.currency===c);}
function blank(){return {quantity:0n,cost:0n,accrued:0n,price:null,nkd:0n,priceDate:null,realized:0n,paid:0n,fees:0n,turnover:0n,closed:false,entry:0n,margin:0n,direction:'long',leverage:'1',targets:[],stop:null,levels:[],transactions:[],netIncome:0n};}
export function project(s,date=E.today(),skipChecks=false){
 const positions=Object.fromEntries((s.instruments||[]).map(i=>[i.id,blank()])),cash={},portStats={};
 for(const p of s.portfolios||[]){cash[p.id]={};portStats[p.id]={contributions:{},withdrawals:{},fees:{},income:{},realized:{}};}
 const add=(o,c,n)=>{o[c]=(o[c]||0n)+n;};
 // Ordinary transfers into linked accounts remain visible as portfolio funding.
 for(const e of E.sorted(s).filter(e=>!e.kind.startsWith('inv:')&&!e.planned&&e.date<=date&&['transfer','exchange'].includes(e.kind))){const src=s.accounts.find(a=>a.id===e.account),dst=s.accounts.find(a=>a.id===e.target);if(src?.portfolio!==dst?.portfolio){if(src?.portfolio)add(portStats[src.portfolio].withdrawals,src.currency,bi(e.amount));if(dst?.portfolio)add(portStats[dst.portfolio].contributions,dst.currency,e.kind==='exchange'?bi(e.received):bi(e.amount));}const fa=s.accounts.find(a=>a.id===(e.feeAccount||e.account));if(fa?.portfolio&&bi(e.fee)>0n)add(portStats[fa.portfolio].fees,fa.currency,bi(e.fee));}
 for(const e of E.sorted(s).filter(e=>e.kind.startsWith('inv:')&&!e.planned&&e.date<=date)){
 const p=portfolio(s,e.portfolio),i=instrument(s,e.instrument),pos=i?positions[i.id]:null,c=i?.currency||e.currency,q=bi(e.quantity),price=bi(e.price),nkd=bi(e.nkd),fee=bi(e.fee),v=bi(e.amount),stats=portStats[p.id];let delta=0n,cashDelta=0n;
 const cashMove=n=>{cashDelta+=n;if(p.mode==='independent')add(cash[p.id],c,n);};
 const book=(name,n)=>add(stats[name],c,n);
 const base=gross(s,i||{currency:c},q,price);
 if(e.kind==='inv:fund'){cashMove(v);book('contributions',v);}
 else if(e.kind==='inv:withdraw'){cashMove(-v);book('withdrawals',v);}
 else if(e.kind==='inv:fee'){cashMove(-fee);book('fees',fee);}
 else if(e.kind==='inv:existing'||e.kind==='inv:buy'){
 if(pos.closed)pos.closed=false;pos.quantity+=q;pos.cost+=e.kind==='inv:existing'&&e.cost!==undefined?bi(e.cost):base;pos.accrued+=nkd;pos.turnover+=base;
 if(e.kind==='inv:buy')cashMove(-base-nkd-fee);else book('contributions',base+nkd);
 pos.price=price;pos.priceDate=e.date;pos.nkd=q?perUnit(s,i,nkd,q):0n;pos.fees+=fee;book('fees',fee);
 }else if(e.kind==='inv:sell'||e.kind==='inv:redeem'){
 if(q<=0n||q>pos.quantity)fail('Продажа или погашение превышает количество на дату события');
 const cost=q===pos.quantity?pos.cost:E.round(pos.cost*q,pos.quantity),accrued=q===pos.quantity?pos.accrued:E.round(pos.accrued*q,pos.quantity);
 const profit=base-cost+nkd-accrued;pos.quantity-=q;pos.cost-=cost;pos.accrued-=accrued;pos.realized+=profit;book('realized',profit);pos.fees+=fee;book('fees',fee);cashMove(base+nkd-fee);delta=profit;pos.closed=pos.quantity===0n;
 }else if(e.kind==='inv:coupon'||e.kind==='inv:dividend'){
 if(pos.quantity<=0n)fail('Выплату можно записать только при наличии позиции на дату выплаты');
 const recovered=e.kind==='inv:coupon'?(v<pos.accrued?v:pos.accrued):0n;pos.accrued-=recovered;if(e.kind==='inv:coupon')pos.nkd=0n;delta=v-recovered;pos.netIncome+=delta;pos.paid+=v;book('income',delta);cashMove(v-fee);pos.fees+=fee;book('fees',fee);
 }else if(e.kind==='inv:price'){pos.price=price;pos.nkd=nkd;pos.priceDate=e.date;}
 else if(e.kind==='inv:open'){
 if(pos.quantity>0n||pos.closed)fail('Для новой фьючерсной сделки создайте отдельную карточку');
 pos.quantity=q;pos.entry=price;pos.price=price;pos.priceDate=e.date;pos.margin=v;pos.direction=e.direction;pos.leverage=e.leverage;pos.fees+=fee;cashMove(-v-fee);book('fees',fee);pos.turnover+=base;
 }else if(e.kind==='inv:close'){
 if(pos.quantity<=0n||pos.closed)fail('Фьючерсная сделка уже закрыта или ещё не открыта');
 delta=pnlFuture(s,i,pos.quantity,pos.entry,price,pos.direction);cashMove(pos.margin+delta-fee);book('realized',delta);book('fees',fee);pos.realized+=delta;pos.fees+=fee;pos.quantity=0n;pos.margin=0n;pos.closed=true;pos.price=price;pos.priceDate=e.date;
 }else if(e.kind==='inv:levels'){pos.targets=e.targets||[];pos.stop=e.stop||null;pos.levels.push({date:e.date,targets:pos.targets,stop:pos.stop,comment:e.comment,updatedAt:e.updatedAt});}
 if(pos){pos.transactions.push({id:e.id,date:e.date,kind:e.kind,quantity:e.quantity,price:e.price,amount:e.amount,fee:e.fee,nkd:e.nkd,result:delta.toString(),comment:e.comment,planned:false,valuationRate:e.valuationRate===undefined?E.rateAt(s,c,e.date):e.valuationRate});}
 if(!skipChecks&&p.mode==='independent'&&cashDelta<0n&&e.kind!=='inv:close'&&(cash[p.id][c]||0n)<0n)fail('Недостаточно денег в независимом портфеле на дату операции. Сначала внесите пополнение.');
 }
 for(const p of s.portfolios||[])if(p.mode==='linked'){for(const a of s.accounts.filter(a=>a.portfolio===p.id)){cash[p.id][a.currency]=E.snapshot(s,date).money[a.id]||0n;}}
 return {positions,cash,portStats};
}
export function valuation(s,date=E.today()){
 const projection=project(s,date),result=[],missing=new Set();
 for(const p of (s.portfolios||[]).filter(p=>p.date<=date)){
 let total=0n,cashBase=0n,holdings=0n,margin=0n,unrealized=0n,realized=0n,fees=0n,income=0n,contributions=0n,withdrawals=0n;const absent=new Set(),rows=[],allocation={crypto:0n,stock:0n,bond:0n,future:0n,cash:0n};
 const cv=(v,c)=>{if(v===0n)return 0n;const n=E.convert(s,v,c,date);if(n===null){absent.add(c);return 0n;}return n;};
 for(const [c,v] of Object.entries(projection.cash[p.id]))cashBase+=cv(v,c);total+=cashBase;allocation.cash=cashBase;
 for(const i of s.instruments.filter(i=>i.portfolio===p.id)){
 const pos=projection.positions[i.id];let value=0n,profit=0n,priceMissing=false;
 if(pos.quantity>0n){if(pos.price===null){absent.add('цена '+i.ticker);priceMissing=true;}else if(i.type==='future'){profit=pnlFuture(s,i,pos.quantity,pos.entry,pos.price,pos.direction);value=pos.margin+profit;margin+=cv(pos.margin,i.currency);}else{value=gross(s,i,pos.quantity,pos.price)+(i.type==='bond'?gross(s,i,pos.quantity,pos.nkd):0n);profit=value-pos.cost-pos.accrued;}
 const b=cv(value,i.currency);holdings+=b;total+=b;allocation[i.type]+=b;unrealized+=cv(profit,i.currency);}
 rows.push({...pos,...i,value,unrealized:profit,priceMissing,average:perUnit(s,i,pos.cost,pos.quantity)});
 }
 const stats=projection.portStats[p.id];for(const [key,setter] of [['realized',v=>realized+=v],['fees',v=>fees+=v],['income',v=>income+=v],['contributions',v=>contributions+=v],['withdrawals',v=>withdrawals+=v]])for(const [c,v] of Object.entries(stats[key]))setter(cv(v,c));
 // Performance is converted on event dates, independently from current capital valuation.
 let performance=0n;const perfMissing=new Set();for(const i of s.instruments.filter(i=>i.portfolio===p.id))for(const t of projection.positions[i.id].transactions){const v=bi(t.result)-bi(t.fee);if(v){const x=E.convert(s,v,i.currency,t.date,t.valuationRate);if(x===null)perfMissing.add(i.currency);else performance+=x;}}
 for(const e of s.events.filter(e=>e.kind==='inv:fee'&&e.portfolio===p.id&&!e.planned&&e.date<=date)){const v=E.convert(s,e.fee,e.currency,e.date,e.valuationRate===undefined?E.rateAt(s,e.currency,e.date):e.valuationRate);if(v===null)perfMissing.add(e.currency);else performance-=v;}
 for(const e of s.events.filter(e=>!e.kind.startsWith('inv:')&&!e.planned&&e.date<=date&&['transfer','exchange'].includes(e.kind))){const fa=s.accounts.find(a=>a.id===(e.feeAccount||e.account));if(fa?.portfolio===p.id&&bi(e.fee)>0n){const rate=e.pnl.find(l=>l.category==='Комиссии'&&l.currency===fa.currency)?.rate;const v=E.convert(s,e.fee,fa.currency,e.date,rate);if(v===null)perfMissing.add(fa.currency);else performance-=v;}}
 for(const c of absent)missing.add(c);
 result.push({...p,total,cashBase,holdings,margin,unrealized,realized,fees,income,contributions,withdrawals,performance,net:performance+unrealized,allocation,rows,cash:projection.cash[p.id],missing:[...absent],performanceMissing:[...perfMissing]});
 }
 return {portfolios:result,missing:[...missing]};
}
export function contribution(s,date=E.today()){
 let total=0n;const missing=new Set();for(const p of valuation(s,date).portfolios.filter(p=>p.includeCapital)){total+=p.mode==='linked'?p.holdings:p.total;for(const c of p.missing)missing.add(c);}return {total,missing:[...missing]};
}
export function operation(s,v,checking=false){
 const p=portfolio(s,v.portfolio);if(!p)fail('Выберите портфель');const kind=v.kind,date=v.date||E.today(),i=instrument(s,v.instrument),c=i?.currency||v.currency;
 if(!investmentKinds[kind])fail('Неизвестное инвестиционное событие');if(!E.dateOK(date)||date<p.date)fail('Дата раньше начала портфеля или некорректна');
 if(!s.currencies.some(x=>x.code===c))fail('Неизвестная валюта');if(!['inv:fund','inv:withdraw','inv:fee'].includes(kind)&&(!i||i.portfolio!==p.id||date<i.date))fail('Выберите инструмент этого портфеля');
 for(const key of ['quantity','price','amount','fee','nkd','cost'])if(v[key]!==undefined&&!nonnegative(v[key]))fail('Некорректная сумма или точность '+key);
 const q=bi(v.quantity),price=bi(v.price),amount=bi(v.amount),fee=bi(v.fee),nkd=bi(v.nkd),postings=[],pnl=[];
 if(v.valuationRate!==undefined&&v.valuationRate!==null){const r=v.valuationRate;if(!integer(r.n)||!integer(r.d)||bi(r.n)<=0n||bi(r.d)<=0n||!E.dateOK(r.date)||r.date>date)fail('Некорректный зафиксированный курс инвестиционного события');}
 const current=project(s,date),pos=i?current.positions[i.id]:null;
 const cash=n=>{if(p.mode==='linked'&&n!==0n){const a=accountFor(s,p,c);if(!a||a.archived&&!checking)fail('Нет доступного инвестиционного счёта в валюте '+c);postings.push({bucket:'money',id:a.id,amount:n.toString()});}};
 const profit=(k,n,category)=>{if(p.mode==='linked'&&n!==0n)pnl.push({kind:k,amount:n.toString(),currency:c,category,rate:E.rateAt(s,c,date)});};
 if(['inv:fund','inv:withdraw'].includes(kind)){
 if(amount<=0n)fail('Введите сумму больше нуля');if(fee!==0n)fail('Комиссию пополнения запишите отдельно');
 if(p.mode==='linked'){const a=s.accounts.find(a=>a.id===v.source);if(!a||a.currency!==c||a.archived&&!checking||a.portfolio)fail('Выберите обычный счёт в той же валюте');const sign=kind==='inv:fund'?1n:-1n;postings.push({bucket:'money',id:a.id,amount:(-sign*amount).toString()});cash(sign*amount);}
 }else if(['inv:buy','inv:existing','inv:sell','inv:redeem'].includes(kind)){
 if(i.type==='future')fail('Используйте открытие / закрытие фьючерса');if(q<=0n)fail('Количество должно быть больше нуля');if(price<=0n)fail('Цена должна быть больше нуля');if(i.type==='bond'&&q%SCALE!==0n)fail('Количество облигаций должно быть целым');
 if(i.type!=='bond'&&nkd!==0n)fail('НКД доступен только для облигаций');if(kind==='inv:redeem'&&i.type!=='bond')fail('Погашение доступно только для облигаций');
 const value=gross(s,i,q,price);if(value<=0n)fail('Стоимость меньше минимальной единицы валюты');
 if(['inv:sell','inv:redeem'].includes(kind)&&q>pos.quantity)fail('Недостаточно бумаг на дату операции');
 if(kind==='inv:existing'){if(fee)fail('Начальную комиссию запишите отдельным событием');if(v.fromAsset){const a=s.assets.find(a=>a.id===v.fromAsset);const old=E.snapshot(s,date).assets[v.fromAsset]||0n;if(!a||a.currency!==c||old<=0n||old!==value+nkd)fail('Для переноса стоимость позиции с НКД должна совпадать с текущей оценкой исходного актива в той же валюте');postings.push({bucket:'asset',id:a.id,amount:(-old).toString()});if(!p.includeCapital)fail('Перенос из капитала доступен только в включённый портфель');}else if(!v.confirmExisting)fail('Подтвердите отсутствие двойного учёта исходной позиции');}
 else cash((kind==='inv:buy'?-value-nkd:value+nkd)-fee);
 }else if(['inv:coupon','inv:dividend'].includes(kind)){
 if(amount<=0n)fail('Введите сумму выплаты');if(i.type==='future')fail('Для фьючерса используйте закрытие');if(kind==='inv:coupon'&&i.type!=='bond')fail('Купон доступен для облигаций');if(pos.quantity<=0n)fail('Нет позиции на дату выплаты');cash(amount-fee);const recovered=kind==='inv:coupon'?(amount<pos.accrued?amount:pos.accrued):0n;profit('income',amount-recovered,kind==='inv:coupon'?'Купоны':'Дивиденды и проценты');
 }else if(kind==='inv:price'){if(price<=0n)fail('Введите положительную цену');if(i.type!=='bond'&&nkd!==0n)fail('НКД доступен только для облигаций');if(fee)fail('Оценка не должна иметь комиссию');}
 else if(kind==='inv:open'){
 if(i.type!=='future'||!['USD','USDT'].includes(c))fail('Поддержаны только линейные фьючерсы USD / USDT');if(q<=0n||price<=0n||amount<=0n)fail('Введите количество, цену и маржу больше нуля');if(pos.quantity||pos.closed)fail('Одна карточка — одна фьючерсная сделка');if(!['long','short'].includes(v.direction))fail('Выберите лонг или шорт');const leverage=E.ratio(v.leverage||'1');if(bi(leverage.n)<bi(leverage.d)||bi(leverage.n)>125n*bi(leverage.d))fail('Плечо от 1 до 125');const minimum=E.round(gross(s,i,q,price)*bi(leverage.d),bi(leverage.n));if(amount<minimum)fail('Маржа меньше номинала, делённого на указанное плечо');cash(-amount-fee);
 }else if(kind==='inv:close'){
 if(i.type!=='future'||pos.quantity<=0n||price<=0n)fail('Выберите открытую фьючерсную сделку и цену выхода');cash(pos.margin+pnlFuture(s,i,pos.quantity,pos.entry,price,pos.direction)-fee);
 }else if(kind==='inv:levels'){
 if(!Array.isArray(v.targets)||v.targets.length>10)fail('До 10 целей тейк-профита');if(v.targets.some(t=>!integer(t.price)||bi(t.price)<=0n||typeof t.note!=='string'||typeof t.reached!=='boolean'))fail('Некорректная цель тейк-профита');if(v.stop!==null&&v.stop!==undefined&&(!integer(v.stop)||bi(v.stop)<=0n))fail('Некорректный стоп-лосс');if(fee)fail('Плановые уровни не имеют комиссии');
 }else if(kind==='inv:fee'){if(fee<=0n)fail('Введите комиссию');cash(-fee);}
 profit('expense',fee,'Комиссии');
 return E.makeEvent(s,{...v,valuationRate:v.valuationRate===undefined?E.rateAt(s,c,date):v.valuationRate,currency:c,kind,date,quantity:q.toString(),price:price.toString(),amount:amount.toString(),nkd:nkd.toString(),fee:fee.toString(),postings,pnl,planned:!!v.planned||date>E.today()});
}
export function validate(s){
 if(!Array.isArray(s.portfolios)||!Array.isArray(s.instruments)||s.portfolios.length>1000||s.instruments.length>10000)fail('Некорректный список портфелей');const ids=new Set([...s.accounts,...s.assets,...s.debts,...s.events,...s.rates].map(x=>x.id));
 for(const p of s.portfolios){if(typeof p.id!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(p.id)||ids.has(p.id)||typeof p.name!=='string'||!p.name.trim()||p.name.length>200||!['independent','linked'].includes(p.mode)||typeof p.includeCapital!=='boolean'||p.mode==='linked'&&!p.includeCapital||!E.dateOK(p.date))fail('Некорректный портфель');ids.add(p.id);}
 for(const i of s.instruments){if(typeof i.id!=='string'||!/^[-A-Za-z0-9_.:]{1,120}$/.test(i.id)||ids.has(i.id)||!portfolio(s,i.portfolio)||!typeNames[i.type]||typeof i.name!=='string'||!i.name.trim()||i.name.length>200||typeof i.ticker!=='string'||!i.ticker.trim()||!s.currencies.some(c=>c.code===i.currency)||!E.dateOK(i.date)||i.date<portfolio(s,i.portfolio).date)fail('Некорректный инструмент');if(i.type==='future'&&!['USD','USDT'].includes(i.currency))fail('Неподдерживаемая валюта фьючерса');if(i.type==='bond'&&(!integer(i.nominal)||bi(i.nominal)<=0n||!E.dateOK(i.maturity)||i.maturity<i.date))fail('Проверьте номинал и срок облигации');ids.add(i.id);}
 const accounts=new Set();for(const a of s.accounts.filter(a=>a.portfolio)){const p=portfolio(s,a.portfolio);if(!p||p.mode!=='linked'||a.date<p.date||accounts.has(p.id+':'+a.currency))fail('Некорректная связь инвестиционного счёта');accounts.add(p.id+':'+a.currency);}
 // Replay full chronology, including ordinary linked cash movements.
 const prefix={...s,events:[]};
 for(const e of E.sorted(s)){
 if(e.kind.startsWith('inv:')){const generated=operation(prefix,e,true);if(JSON.stringify(generated.postings)!==JSON.stringify(e.postings)||JSON.stringify(generated.pnl.map((l,j)=>({...l,rate:e.pnl[j]?.rate})))!==JSON.stringify(e.pnl))fail('Инвестиционные движения не соответствуют событию');}
 prefix.events.push(e);
 if(!e.planned&&e.kind.startsWith('inv:')){project(prefix,e.date);const p=portfolio(s,e.portfolio);if(p.mode==='linked'){const cash=project(prefix,e.date).cash[p.id];if(Object.values(cash).some(v=>v<0n)&&['inv:buy','inv:withdraw','inv:open','inv:fee'].includes(e.kind))fail('Недостаточно денег на инвестиционном счёте на дату операции');}}
 }
 project(s,E.today());return s;
}
