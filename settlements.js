import * as E from './work/engine.js?v=studio3';

export const kinds={receipt:'Получил',payout:'Передал человеку',exchange:'Обменял',transfer:'Между своими счетами'};
const fail=message=>{throw Error(message);};
const trim=(value,max)=>String(value??'').trim().slice(0,max);
const money=(value,currency,state)=>{
  const precision=E.precision(state,currency);
  const result=E.parseMoney(value,precision);
  if(BigInt(result)<=0n)fail('Сумма должна быть больше нуля');
  return result;
};
const ordered=steps=>steps.map((step,index)=>({step,index}))
  .sort((a,b)=>a.step.date.localeCompare(b.step.date)||a.index-b.index).map(x=>x.step);
const debtId=(id,currency)=>`held:${id}:${currency}`;

export function makeSettlement(form,state,old=null){
  const targetCurrency=form.targetCurrency||'RUB';
  const targetAmount=String(form.targetAmount||'').trim();
  const next={
    id:old?.id||E.uid(),title:trim(form.title,200),counterparty:trim(form.counterparty,240),
    targetAmount:targetAmount?money(targetAmount,targetCurrency,state):'',
    targetCurrency:targetAmount?targetCurrency:'',
    closed:old?.closed||false,createdAt:old?.createdAt||E.stamp(),steps:old?.steps||[]
  };
  return next;
}

export function makeStep(form,state,old=null){
  const kind=form.kind;
  if(!(kind in kinds))fail('Выберите тип записи');
  if(!E.dateOK(form.date))fail('Проверьте дату');
  const currency=form.currency,amount=money(form.amount,currency,state);
  const receivedCurrency=kind==='exchange'?form.receivedCurrency:'';
  const received=kind==='exchange'?money(form.received,receivedCurrency,state):'';
  if(kind==='exchange'&&currency===receivedCurrency)fail('Для одной валюты используйте перевод');
  const hasFee=String(form.fee||'').trim()!==''&&Number(String(form.fee).replace(',','.'))!==0;
  const feeCurrency=hasFee?String(form.feeCurrency||currency):currency;
  if(!state.currencies.some(c=>c.code===feeCurrency))fail('Неизвестная валюта комиссии');
  if(kind!=='exchange'&&feeCurrency!==currency)fail('Комиссия должна быть в валюте операции');
  if(kind==='exchange'&&![currency,receivedCurrency].includes(feeCurrency))fail('Комиссия должна быть в одной из валют обмена');
  const fee=E.parseMoney(form.fee||'0',E.precision(state,feeCurrency));
  if(BigInt(fee)<0n)fail('Комиссия не может быть отрицательной');
  const agreedRate=trim(form.agreedRate,40);
  if(agreedRate)E.ratio(agreedRate);
  const funding=form.funding==='own'?'own':'held';
  return {
    id:old?.id||E.uid(),kind,funding,date:form.date,amount,currency,received,receivedCurrency,
    fee,feeCurrency,agreedRate,account:String(form.account||''),targetAccount:String(form.targetAccount||''),
    counterparty:trim(form.counterparty,240),purpose:trim(form.purpose,240),
    category:trim(form.category,120),comment:trim(form.comment,2000),
    createdAt:old?.createdAt||E.stamp()
  };
}

export function balances(settlement){
  const result={};
  const add=(currency,value)=>{result[currency]=(result[currency]||0n)+value;if(result[currency]<0n)fail('В расчёте недостаточно средств в '+currency+' на дату операции');};
  for(const step of ordered(settlement.steps)){
    if(step.funding==='own')continue;
    const amount=BigInt(step.amount),fee=BigInt(step.fee||'0');
    if(step.kind==='receipt')add(step.currency,amount);
    if(step.kind==='payout'||step.kind==='exchange')add(step.currency,-amount);
    if(step.kind==='exchange')add(step.receivedCurrency,BigInt(step.received));
    if(fee)add(step.feeCurrency||step.currency,-fee);
  }
  return result;
}

export function delivered(settlement){
  if(!settlement.targetAmount)return null;
  const paid=settlement.steps.filter(x=>x.kind==='payout'&&x.currency===settlement.targetCurrency)
    .reduce((sum,x)=>sum+BigInt(x.amount),0n);
  return BigInt(settlement.targetAmount)-paid;
}

export function calculatedRate(step,state){
  if(step.kind!=='exchange')return '';
  const precisionFrom=E.precision(state,step.currency),precisionTo=E.precision(state,step.receivedCurrency);
  const scaled=E.round(BigInt(step.received)*10n**BigInt(precisionFrom+6),BigInt(step.amount)*10n**BigInt(precisionTo));
  return E.decimal(scaled,6).replace(/0+$/,'').replace(/\.$/,'');
}

export function isPostable(step,state){
  const account=state.accounts.find(x=>x.id===step.account&&!x.archived&&x.currency===step.currency&&x.date<=step.date);
  if(!account)return false;
  if(!['exchange','transfer'].includes(step.kind))return true;
  const targetCurrency=step.kind==='exchange'?step.receivedCurrency:step.currency;
  return !!state.accounts.find(x=>x.id===step.targetAccount&&!x.archived&&x.currency===targetCurrency&&x.date<=step.date&&x.id!==account.id);
}

function check(state){
  const ids=new Set();
  for(const settlement of state.settlements){
    if(ids.has(settlement.id))fail('Повторяющийся расчёт');
    ids.add(settlement.id);
    balances(settlement);
    if(settlement.closed&&(Object.values(balances(settlement)).some(x=>x!==0n)||delivered(settlement)>0n))fail('Чтобы завершить расчёт, сначала закройте остатки и сумму к передаче');
  }
}

export function rebuild(input){
  const state=structuredClone(input);
  state.settlements??=[];
  check(state);
  state.events=state.events.filter(e=>!e.settlementId);
  state.debts=state.debts.filter(d=>!d.internalSettlementId);
  for(const settlement of state.settlements){
    const booked={};
    const available=currency=>booked[currency]||0n;
    const addBooked=(currency,value)=>{booked[currency]=available(currency)+value;};
    const currencies=new Set();
    for(const step of settlement.steps){currencies.add(step.currency);if(step.kind==='exchange')currencies.add(step.receivedCurrency);if(BigInt(step.fee||'0')>0n)currencies.add(step.feeCurrency||step.currency);}
    for(const currency of currencies){
      const earliest=ordered(settlement.steps)[0]?.date||E.today();
      state.debts.push({id:debtId(settlement.id,currency),name:'Средства на расчёте',counterparty:settlement.counterparty,currency,date:earliest,opening:'0',direction:'owed',archived:false,internalSettlementId:settlement.id});
    }
    for(const step of ordered(settlement.steps)){
      if(!isPostable(step,state))continue;
      if(step.funding==='held'){
        const amount=BigInt(step.amount),fee=BigInt(step.fee||'0'),feeCurrency=step.feeCurrency||step.currency;
        const sourceNeed=(step.kind==='payout'||step.kind==='exchange'?amount:0n)+(feeCurrency===step.currency?fee:0n);
        const targetNeed=step.kind==='exchange'&&feeCurrency===step.receivedCurrency?fee:0n;
        if(available(step.currency)+(step.kind==='receipt'?amount:0n)<sourceNeed||targetNeed>BigInt(step.received||'0'))continue;
      }
      if(step.funding==='own'){
        const kind=step.kind==='receipt'?'income':step.kind==='payout'?(step.counterparty?'personTransfer':'expense'):step.kind;
        state.events.push(E.operation(state,{
          id:step.id,settlementId:settlement.id,kind,date:step.date,amount:step.amount,
          received:step.received,account:step.account,target:step.targetAccount,fee:step.fee,
          feeAccount:step.kind==='exchange'&&step.feeCurrency===step.receivedCurrency?step.targetAccount:step.account,
          recipient:step.counterparty,category:step.category||'Другое',comment:step.comment,
          createdAt:step.createdAt
        }));
        continue;
      }
      const inputEvent={
        id:step.id,settlementId:settlement.id,kind:'settlement'+step.kind[0].toUpperCase()+step.kind.slice(1),
        date:step.date,amount:step.amount,currency:step.currency,fee:step.fee,feeCurrency:step.feeCurrency,
        received:step.received,receivedCurrency:step.receivedCurrency,account:step.account,target:step.targetAccount,
        heldSource:debtId(settlement.id,step.currency),
        heldTarget:step.kind==='exchange'?debtId(settlement.id,step.receivedCurrency):'',
        heldFee:debtId(settlement.id,step.feeCurrency||step.currency),
        counterparty:step.counterparty,recipient:step.counterparty,purpose:step.purpose,comment:step.comment,
        createdAt:step.createdAt
      };
      state.events.push(E.operation(state,inputEvent));
      if(step.kind==='receipt')addBooked(step.currency,BigInt(step.amount));
      if(step.kind==='payout'||step.kind==='exchange')addBooked(step.currency,-BigInt(step.amount));
      if(step.kind==='exchange')addBooked(step.receivedCurrency,BigInt(step.received));
      if(BigInt(step.fee||'0')>0n)addBooked(step.feeCurrency||step.currency,-BigInt(step.fee));
    }
  }
  return E.validate(state);
}

export function upsertSettlement(state,settlement){
  const next=structuredClone(state),index=(next.settlements||[]).findIndex(x=>x.id===settlement.id);
  next.settlements??=[];
  if(index<0)next.settlements.push(settlement);else next.settlements[index]=settlement;
  next.audit.push({id:E.uid(),at:E.stamp(),action:index<0?'Создан расчёт':'Изменён расчёт',entity:settlement.id});
  return rebuild(next);
}

export function removeSettlement(state,id){
  const next=structuredClone(state),index=(next.settlements||[]).findIndex(x=>x.id===id);
  if(index<0)fail('Расчёт не найден');
  const [old]=next.settlements.splice(index,1);
  next.audit.push({id:E.uid(),at:E.stamp(),action:'Удалён расчёт',entity:id,before:old});
  return rebuild(next);
}
