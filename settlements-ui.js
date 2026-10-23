import * as E from './work/engine.js';
import * as T from './settlements.js';

const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const dateLabel=value=>new Date(value+'T12:00:00').toLocaleDateString('ru-RU',{day:'numeric',month:'short',year:'numeric'});
const amount=(value,currency,state,hidden=false)=>hidden?'••••••':`${E.decimal(value,E.precision(state,currency)).replace('.',',')} ${currency==='RUB'?'₽':currency}`;
const currencyOptions=(state,selected)=>state.currencies.map(c=>`<option value="${c.code}" ${c.code===selected?'selected':''}>${c.code}</option>`).join('');
const accountOptions=(state,selected='')=>`<option value="">Без счёта · только история расчёта</option>`+state.accounts.filter(a=>!a.archived).map(a=>`<option value="${esc(a.id)}" ${a.id===selected?'selected':''}>${esc(a.name)} · ${a.currency}</option>`).join('');
const label=s=>s.title||s.counterparty||'Расчёт без названия';
const kindOptions=selected=>Object.entries(T.kinds).map(([key,value])=>`<option value="${key}" ${key===selected?'selected':''}>${value}</option>`).join('');
const status=s=>s.closed?'Завершён':'В процессе';
const effect=(step,booked)=>{
  if(!booked)return 'Счета и общий капитал не изменены.';
  if(step.funding==='held')return step.kind==='receipt'?'Счёт и обязательство передать деньги выросли одинаково; личный доход и капитал не выросли.':step.kind==='payout'?'Счёт и обязательство передать деньги уменьшились одинаково; личного расхода нет.':step.kind==='exchange'?'Валюты на счетах и в обязательстве обменялись; основная сумма не стала доходом или расходом.':'Деньги перемещены между своими счетами; дохода и расхода нет.';
  return step.kind==='receipt'?'Свои деньги зачислены как доход.':step.kind==='payout'?'Свои деньги списаны как расход.':step.kind==='exchange'?'Обмен меняет валюты на счетах, но не создаёт доход или расход из основной суммы.':'Перевод между своими счетами не меняет общий капитал.';
};

function graph(state,metric='count'){
  const months=Array.from({length:6},(_,i)=>{const d=new Date(E.today()+'T12:00:00');d.setMonth(d.getMonth()-(5-i));return d.toISOString().slice(0,7);});
  const steps=state.settlements.flatMap(s=>s.steps),filtered=metric==='count'?steps:steps.filter(x=>x.kind===metric),counts=months.map(month=>filtered.filter(x=>x.date.startsWith(month)).length),max=Math.max(1,...counts);
  return `<section class="studio-panel"><div class="section-line"><h2>Активность</h2><span>Количество шагов</span></div><label class="chart-choice">Показать<select id="settlement-chart"><option value="count">Все действия</option>${Object.entries(T.kinds).map(([key,value])=>`<option value="${key}" ${metric===key?'selected':''}>${value}</option>`).join('')}</select></label><div class="mini-bars">${months.map((month,i)=>`<div class="mini-bar"><b style="height:${Math.max(7,counts[i]/max*100)}%" title="${counts[i]} записей"></b><small>${new Date(month+'-15').toLocaleDateString('ru-RU',{month:'short'})}</small></div>`).join('')}</div></section>`;
}

function overview(state,filters,hidden){
  const all=state.settlements||[],query=filters.query.toLocaleLowerCase('ru-RU');
  const items=all.filter(s=>(!query||[s.title,s.counterparty,...s.steps.flatMap(x=>[x.counterparty,x.purpose,x.comment])].join(' ').toLocaleLowerCase('ru-RU').includes(query))
    &&(filters.status==='all'||(filters.status==='open'?!s.closed:s.closed))
    &&(filters.currency==='all'||s.steps.some(x=>x.currency===filters.currency||x.receivedCurrency===filters.currency)||s.targetCurrency===filters.currency)
    &&(filters.kind==='all'||s.steps.some(x=>x.kind===filters.kind))
    &&(!filters.from&&!filters.to||s.steps.some(x=>(!filters.from||x.date>=filters.from)&&(!filters.to||x.date<=filters.to))));
  const held={};for(const s of all.filter(x=>!x.closed))for(const [currency,value] of Object.entries(T.balances(s)))held[currency]=(held[currency]||0n)+value;
  return `<div class="studio-hero"><div><span class="eyebrow">Работа / Расчёты</span><h1>Деньги по шагам.<br>Всё на своих местах.</h1><p>Получили, обменяли, перевели — вся история и остаток в одной цепочке.</p><button class="primary" data-settlement-action="new">＋ Новый расчёт</button></div><div class="hero-orbit" aria-hidden="true"><span>ПОЛУЧИЛ</span><i>→</i><span>ОБМЕНЯЛ</span><i>→</i><span>ПЕРЕДАЛ</span></div></div>
  <div class="studio-stats"><article><small>В процессе</small><strong>${all.filter(x=>!x.closed).length}</strong></article><article><small>Завершено</small><strong>${all.filter(x=>x.closed).length}</strong></article><article><small>На расчётах</small><strong>${Object.entries(held).filter(([,v])=>v!==0n).map(([c,v])=>amount(v,c,state,hidden)).join(' · ')||'Нет остатка'}</strong></article></div>
  <div class="studio-grid"><section class="studio-panel"><div class="section-line"><h2>Цепочки расчётов</h2><span>${items.length} найдено</span></div><div class="settlement-filters"><label>Поиск<input id="settlement-search" type="search" placeholder="Человек или назначение" value="${esc(filters.query)}"></label><label>Статус<select id="settlement-status"><option value="all">Все</option><option value="open" ${filters.status==='open'?'selected':''}>В процессе</option><option value="closed" ${filters.status==='closed'?'selected':''}>Завершены</option></select></label><label>Валюта<select id="settlement-currency"><option value="all">Все</option>${state.currencies.map(c=>`<option value="${c.code}" ${filters.currency===c.code?'selected':''}>${c.code}</option>`).join('')}</select></label><label>Тип<select id="settlement-kind-filter"><option value="all">Все</option>${Object.entries(T.kinds).map(([key,value])=>`<option value="${key}" ${filters.kind===key?'selected':''}>${value}</option>`).join('')}</select></label><label>С даты<input id="settlement-from" type="date" value="${esc(filters.from||'')}"></label><label>По дату<input id="settlement-to" type="date" value="${esc(filters.to||'')}"></label></div>
  ${items.map(s=>{const balances=T.balances(s),values=Object.entries(balances).filter(([,v])=>v!==0n).map(([c,v])=>amount(v,c,state,hidden)).join(' · ');return `<button class="settlement-card" data-settlement-action="open" data-id="${esc(s.id)}"><span><strong>${esc(label(s))}</strong><small>${s.steps.length} шагов · ${esc(s.counterparty||'Контрагент не указан')}</small></span><span class="settlement-card-end"><b>${values||'Без остатка'}</b><small>${status(s)} →</small></span></button>`;}).join('')||'<div class="empty-state"><strong>Расчётов пока нет</strong><p>Начните с получения, выплаты или обмена. Поля счёта и человека можно заполнить позже.</p></div>'}</section>${graph(state,filters.chart)}</div>`;
}

function detail(state,s,hidden){
  const balances=T.balances(s),remaining=T.delivered(s),booked=new Set(state.events.filter(e=>e.settlementId===s.id).map(e=>e.id));
  return `<div class="detail-top"><button class="back-link" data-settlement-action="back">← Все расчёты</button><div class="detail-actions"><button data-settlement-action="edit-meta" data-id="${esc(s.id)}">Изменить описание</button><button data-settlement-action="toggle" data-id="${esc(s.id)}">${s.closed?'Возобновить':'Завершить'}</button><button class="danger" data-settlement-action="delete" data-id="${esc(s.id)}">Удалить</button></div></div>
  <div class="studio-hero detail-hero"><div><span class="eyebrow">Работа / Расчёты · ${status(s)}</span><h1>${esc(label(s))}</h1><p>${esc(s.counterparty||'Контрагент не указан')} · ${s.steps.length} шагов</p><button class="primary" data-settlement-action="new-step" data-id="${esc(s.id)}">＋ Добавить шаг</button></div><div class="hero-orbit" aria-hidden="true"><span>ОДНА ИСТОРИЯ</span></div></div>
  <div class="studio-stats">${Object.entries(balances).filter(([,v])=>v!==0n).map(([c,v])=>`<article><small>Остаток · ${c}</small><strong>${amount(v,c,state,hidden)}</strong></article>`).join('')||'<article><small>Остаток средств</small><strong>Нет остатка</strong></article>'}<article><small>${remaining!==null&&remaining<0n?'Передано сверх цели':'Осталось передать'}</small><strong>${remaining===null?'Цель не указана':amount(remaining<0n?-remaining:remaining,s.targetCurrency,state,hidden)}</strong></article></div>
  <section class="studio-panel timeline-panel"><div class="section-line"><h2>История расчёта</h2><span>По датам операций</span></div>${[...s.steps].map((step,index)=>({step,index})).sort((a,b)=>a.step.date.localeCompare(b.step.date)||a.index-b.index).map(({step})=>`<div class="timeline-item"><span class="timeline-dot"></span><div class="timeline-body"><div class="section-line"><strong>${T.kinds[step.kind]}</strong><time>${dateLabel(step.date)}</time></div><b class="timeline-amount">${amount(step.amount,step.currency,state,hidden)}${step.kind==='exchange'? ` → ${amount(step.received,step.receivedCurrency,state,hidden)}`:''}</b><p>${esc(step.counterparty||s.counterparty||'Человек не указан')}${step.purpose?' · '+esc(step.purpose):''}</p>${step.kind==='exchange'?`<small>Курс: 1 ${step.currency} = ${T.calculatedRate(step,state)} ${step.receivedCurrency}${step.agreedRate?' · согласовано '+esc(step.agreedRate):''}</small>`:''}${BigInt(step.fee||'0')>0n?`<small>Комиссия: ${amount(step.fee,step.feeCurrency,state,hidden)}</small>`:''}<small class="${booked.has(step.id)?'status-ok':'status-pending'}">${booked.has(step.id)?'Проведено через счёт':step.account?'Ожидает связанной проводки или подходящего счёта · остатки не менялись':'Без проводки · счета не менялись'} · ${step.funding==='own'?'Свои деньги':'Средства на расчёте'}</small><p class="effect-note">${effect(step,booked.has(step.id))}${booked.has(step.id)&&BigInt(step.fee||'0')>0n?' Комиссия учтена отдельно и один раз.':''}</p>${step.comment?`<p class="muted">${esc(step.comment)}</p>`:''}<div class="inline"><button data-settlement-action="edit-step" data-id="${esc(s.id)}" data-step="${esc(step.id)}">Изменить</button><button class="danger" data-settlement-action="delete-step" data-id="${esc(s.id)}" data-step="${esc(step.id)}">Удалить</button></div></div></div>`).join('')||'<div class="empty-state">Шагов пока нет. Добавьте получение, выплату, обмен или перевод.</div>'}</section>`;
}

export function render(state,selectedId,filters,hidden){
  const selected=(state.settlements||[]).find(x=>x.id===selectedId);
  return selected?detail(state,selected,hidden):overview(state,filters,hidden);
}

export function newForm(state,date){
  return `<p class="form-intro full">Начните с одного действия. Название, человек и счёт необязательны.</p>
  <label>Что произошло<select name="kind" id="settlement-kind">${kindOptions('receipt')}</select></label>
  <label>Чьи деньги<select name="funding"><option value="held">Средства на расчёте · не доход</option><option value="own">Мои деньги · обычный доход или расход</option></select></label>
  <label>Дата<input name="date" type="date" value="${date}" required></label>
  <label>Сумма<input name="amount" inputmode="decimal" required placeholder="Например, 1000"></label>
  <label>Валюта<select name="currency">${currencyOptions(state,'RUB')}</select></label>
  <label>От кого / кому<input name="counterparty" maxlength="240" placeholder="Можно добавить позже"></label>
  <label data-settlement-field="received" hidden>Получено после обмена<input name="received" inputmode="decimal" placeholder="Сумма"></label>
  <label data-settlement-field="received" hidden>Валюта получения<select name="receivedCurrency">${currencyOptions(state,'USD')}</select></label>
  <label>Счёт списания / поступления<select name="account">${accountOptions(state)}</select></label>
  <label data-settlement-field="target" hidden>Счёт зачисления<select name="targetAccount">${accountOptions(state)}</select></label>
  <details class="advanced full"><summary>Дополнительно: цель, комиссия, комментарий</summary><div class="dialog-form extra-grid"><label>Название расчёта<input name="title" maxlength="200" placeholder="Необязательно"></label><label>Сколько нужно передать<input name="targetAmount" inputmode="decimal" placeholder="Необязательно"></label><label>Валюта цели<select name="targetCurrency">${currencyOptions(state,'RUB')}</select></label><label>Комиссия<input name="fee" inputmode="decimal" placeholder="0"></label><label>Валюта комиссии<select name="feeCurrency">${currencyOptions(state,'RUB')}</select></label><label>Назначение<input name="purpose" maxlength="240"></label><label>Категория<input name="category" maxlength="120"></label><label class="full">Комментарий<textarea name="comment" maxlength="2000"></textarea></label></div></details>
  <p class="hint full">Без счёта запись сохранится только в истории расчёта. «Средства на расчёте» не станут вашим доходом.</p>`;
}

export function metaForm(state,s){
  return `<label>Название<input name="title" value="${esc(s.title)}" maxlength="200"></label><label>Контрагент<input name="counterparty" value="${esc(s.counterparty)}" maxlength="240"></label><label>Сколько нужно передать<input name="targetAmount" inputmode="decimal" value="${s.targetAmount?E.decimal(s.targetAmount,E.precision(state,s.targetCurrency)):''}"></label><label>Валюта цели<select name="targetCurrency">${currencyOptions(state,s.targetCurrency||'RUB')}</select></label><p class="hint full">Если цель не указана, приложение покажет остаток средств по валютам, но не будет угадывать сумму к передаче.</p>`;
}

export function stepForm(state,s,old=null,date){
  const currency=old?.currency||'RUB',receivedCurrency=old?.receivedCurrency||'USD',feeCurrency=old?.feeCurrency||currency;
  const value=(v,c)=>v?E.decimal(v,E.precision(state,c)):'';
  return `<label>Что произошло<select name="kind" id="settlement-kind">${kindOptions(old?.kind||'receipt')}</select></label><label>Чьи деньги<select name="funding"><option value="held" ${old?.funding!=='own'?'selected':''}>Средства на расчёте · не доход</option><option value="own" ${old?.funding==='own'?'selected':''}>Мои деньги · обычный доход или расход</option></select></label><label>Дата<input name="date" type="date" value="${old?.date||date}" required></label><label>Сумма<input name="amount" inputmode="decimal" value="${value(old?.amount,currency)}" required></label><label>Валюта<select name="currency">${currencyOptions(state,currency)}</select></label><label>От кого / кому<input name="counterparty" value="${esc(old?.counterparty||s.counterparty)}" maxlength="240"></label><label data-settlement-field="received">Получено после обмена<input name="received" inputmode="decimal" value="${value(old?.received,receivedCurrency)}"></label><label data-settlement-field="received">Валюта получения<select name="receivedCurrency">${currencyOptions(state,receivedCurrency)}</select></label><label>Счёт списания / поступления<select name="account">${accountOptions(state,old?.account)}</select></label><label data-settlement-field="target">Счёт зачисления<select name="targetAccount">${accountOptions(state,old?.targetAccount)}</select></label><p id="rate-preview" class="hint full" data-settlement-field="received">Курс появится после ввода обеих сумм.</p><details class="advanced full"><summary>Дополнительно: курс, комиссия, назначение</summary><div class="dialog-form extra-grid"><label>Договорной курс<input name="agreedRate" inputmode="decimal" value="${esc(old?.agreedRate||'')}" placeholder="Необязательно"></label><label>Комиссия<input name="fee" inputmode="decimal" value="${value(old?.fee,feeCurrency)}" placeholder="0"></label><label>Валюта комиссии<select name="feeCurrency">${currencyOptions(state,feeCurrency)}</select></label><label>Назначение<input name="purpose" value="${esc(old?.purpose||'')}" maxlength="240"></label><label>Категория<input name="category" value="${esc(old?.category||'')}" maxlength="120"></label><label class="full">Комментарий<textarea name="comment" maxlength="2000">${esc(old?.comment||'')}</textarea></label></div></details><p class="hint full">Без необходимых счетов запись останется без проводки. Если это ваши деньги, выберите «Мои деньги» — поступление станет доходом, выплата расходом.</p>`;
}

export function bindForm(dialog,state){
  const form=dialog.querySelector('form'),kind=form.elements.namedItem('kind');
  if(!kind)return;
  const funding=form.elements.namedItem('funding'),currencyField=form.elements.namedItem('currency'),feeCurrency=form.elements.namedItem('feeCurrency');
  let lastCurrency=currencyField?.value;
  kind.addEventListener('change',()=>{if(form.querySelector('.form-intro')&&funding)funding.value=kind.value==='payout'?'own':'held';});
  currencyField?.addEventListener('change',()=>{if(feeCurrency?.value===lastCurrency)feeCurrency.value=currencyField.value;lastCurrency=currencyField.value;});
  const update=()=>{
    const exchange=kind.value==='exchange',target=exchange||kind.value==='transfer';
    dialog.querySelectorAll('[data-settlement-field="received"]').forEach(x=>x.hidden=!exchange);
    dialog.querySelectorAll('[data-settlement-field="target"]').forEach(x=>x.hidden=!target);
    const rate=dialog.querySelector('#rate-preview');
    if(rate&&exchange){
      try{
        const currency=form.elements.namedItem('currency').value,receivedCurrency=form.elements.namedItem('receivedCurrency').value;
        const amount=E.parseMoney(form.elements.namedItem('amount').value,E.precision(state,currency));
        const received=E.parseMoney(form.elements.namedItem('received').value,E.precision(state,receivedCurrency));
        rate.textContent='Расчётный курс: 1 '+currency+' = '+T.calculatedRate({kind:'exchange',currency,amount,receivedCurrency,received},state)+' '+receivedCurrency;
      }catch{rate.textContent='Введите обе суммы, чтобы увидеть курс.';}
    }
  };
  for(const name of ['kind','amount','currency','received','receivedCurrency'])form.elements.namedItem(name)?.addEventListener('input',update);
  update();
}
