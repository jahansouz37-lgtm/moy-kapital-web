import {dateOK,parseMoney,decimal} from './work/engine.js';
export const currencies={RUB:2,USD:2,EUR:2,USDT:6};
export const blank=()=>({version:1,revision:0,personal:{accounts:[],events:[]},pending:[],settings:{space:'personal',hidden:false,widgets:{personal:['tasks','balances','operations'],work:['income','expense','pending','balances','flow']}}});
export const uid=()=>crypto.randomUUID();
export const minor=(value,currency)=>{if(!(currency in currencies))throw Error('Неизвестная валюта');return parseMoney(value,currencies[currency]);};
export const display=(value,currency)=>decimal(value,currencies[currency]);
const fail=message=>{throw Error(message)};
const idOK=x=>typeof x==='string'&&/^[-\w:.]{1,120}$/.test(x);
const textOK=(x,max=240)=>typeof x==='string'&&x.length<=max;
export function validate(s){
 if(!s||s.version!==1||!Number.isSafeInteger(s.revision)||s.revision<0||!s.personal||!Array.isArray(s.personal.accounts)||!Array.isArray(s.personal.events)||!Array.isArray(s.pending)||!s.settings)fail('Неподдерживаемый формат данных');
 if(s.personal.accounts.length>10000||s.personal.events.length>100000||s.pending.length>100000)fail('Слишком много записей');
 const ids=new Set();
 for(const a of s.personal.accounts){if(!idOK(a.id)||ids.has(a.id)||!textOK(a.name)||!a.name.trim()||!(a.currency in currencies)||!dateOK(a.date)||!/^[-]?\d+$/.test(a.opening))fail('Некорректный личный счёт');ids.add(a.id);}
 for(const e of s.personal.events){const account=s.personal.accounts.find(a=>a.id===e.account);if(!idOK(e.id)||ids.has(e.id)||!['income','expense'].includes(e.kind)||!dateOK(e.date)||!account||!/^\d+$/.test(e.amount)||BigInt(e.amount)<=0n||!textOK(e.category)||!textOK(e.comment,2000))fail('Некорректная личная операция');ids.add(e.id);if(account.date>e.date)fail('Операция раньше даты открытия счёта');}
 for(const p of s.pending){if(!idOK(p.id)||ids.has(p.id)||!['receipt','payout','transfer','exchange'].includes(p.kind)||!dateOK(p.date)||!textOK(p.counterparty)||!textOK(p.category)||!textOK(p.comment,2000)||!(p.currency in currencies)||!/^\d+$/.test(p.amount)||BigInt(p.amount)<=0n)fail('Некорректная нераспределённая запись');ids.add(p.id);if(p.kind==='exchange'&&(!(p.receivedCurrency in currencies)||!/^\d+$/.test(p.received)||BigInt(p.received)<=0n))fail('Некорректный обмен');}
 if(!['personal','work'].includes(s.settings.space)||typeof s.settings.hidden!=='boolean')fail('Некорректные настройки');
 return s;
}
export function personalBalances(s,date){const result={};for(const a of s.personal.accounts){if(a.date<=date)result[a.id]=BigInt(a.opening);}for(const e of s.personal.events){if(e.date<=date&&e.account in result)result[e.account]+=BigInt(e.amount)*(e.kind==='income'?1n:-1n);}return result;}
export function personalTotals(s,date){const b=personalBalances(s,date),out={};for(const a of s.personal.accounts){if(!(a.id in b))continue;out[a.currency]=(out[a.currency]||0n)+b[a.id];}return out;}
export function workRow(s,form,capital){const kind=form.kind,date=form.date,amount=minor(form.amount,form.currency),fee=minor(form.fee||'0',form.currency);if(!dateOK(date)||BigInt(amount)<=0n||BigInt(fee)<0n)fail('Проверьте дату и сумму');if(!(form.currency in currencies))fail('Неизвестная валюта');const base={kind,date,amount,currency:form.currency,fee,comment:(form.comment||'').trim(),category:(form.category||'').trim(),counterparty:(form.counterparty||'').trim(),account:form.account||'',target:form.target||'',receiptType:form.receiptType||'income',debt:form.debt||''};if(kind==='exchange'){base.receivedCurrency=form.receivedCurrency;base.received=minor(form.received,form.receivedCurrency);if(BigInt(base.received)<=0n||base.receivedCurrency===base.currency)fail('Укажите две разные валюты и обе суммы');}
 const account=capital.accounts.find(a=>a.id===base.account),target=capital.accounts.find(a=>a.id===base.target);if(account&&account.currency!==base.currency)fail('Валюта исходного счёта не совпадает с записью');if(kind==='exchange'&&target&&target.currency!==base.receivedCurrency)fail('Валюта счёта зачисления не совпадает с записью');if(kind==='transfer'&&target&&target.currency!==base.currency)fail('Для разных валют выберите обмен');
 return base;
}
export function postable(row,capital){const a=capital.accounts.find(x=>x.id===row.account),b=capital.accounts.find(x=>x.id===row.target);if(!a||a.archived)return false;if(row.kind==='receipt')return row.receiptType==='income'||row.receiptType==='debt'&&!!capital.debts.find(x=>x.id===row.debt&&x.direction==='lent');if(row.kind==='payout')return true;if(row.kind==='transfer'||row.kind==='exchange')return !!b&&!b.archived&&a.id!==b.id;return false;}
export function toCapitalInput(row){const common={date:row.date,amount:row.amount,fee:row.fee,account:row.account,comment:row.comment,category:row.category||'Без категории',sourceQuickKind:row.kind,sourcePendingId:row.id||'',counterparty:row.counterparty,receiptType:row.receiptType};if(row.kind==='receipt'&&row.receiptType==='debt')return {...common,kind:'debtPayment',debt:row.debt,interest:'0'};if(row.kind==='receipt')return {...common,kind:'income'};if(row.kind==='payout')return {...common,kind:row.counterparty?'personTransfer':'expense',recipient:row.counterparty};if(row.kind==='transfer')return {...common,kind:'transfer',target:row.target};return {...common,kind:'exchange',target:row.target,received:row.received};}
