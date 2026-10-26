// Read-only projections for attention and search. No financial totals are changed here.
export function attention(rhythm, capital, pending, day){
  const tasks=(rhythm?.tasks||[]).filter(x=>x.status!=='Завершена'&&x.due);
  const groups=[
    ['overdue','Просроченные задачи',tasks.filter(x=>x.due<day),'tasks'],
    ['today','Задачи на сегодня',tasks.filter(x=>x.due===day),'tasks'],
    ['soon','Ближайшие сроки',tasks.filter(x=>x.due>day&&x.due<=shift(day,7)),'tasks']
  ];
  const personal=groups.filter(([, ,rows])=>rows.length).map(([id,title,rows,page])=>({id,title,count:rows.length,examples:rows.slice(0,3).map(x=>x.title),records:rows.slice(0,3).map(x=>({id:x.id,title:x.title})),page,space:'personal'}));
  const open=(capital?.settlements||[]).filter(x=>!x.closed);
  const work=[];
  if(open.length)work.push({id:'settlements',title:'Незавершённые расчёты',count:open.length,examples:open.slice(0,3).map(x=>x.title||x.counterparty||'Расчёт без названия'),records:open.slice(0,3).map(x=>({id:x.id,title:x.title||x.counterparty||'Расчёт'})),page:'settlements',space:'work'});
  if(pending.length)work.push({id:'pending',title:'Записи без счёта',count:pending.length,examples:pending.slice(0,3).map(x=>x.counterparty||x.person||x.comment||'Запись без счёта'),records:pending.slice(0,3).map(x=>({id:x.id,title:x.counterparty||x.person||x.comment||'Запись'})),page:'journal',space:'work'});
  return {personal,work};
}
function shift(day,n){const [y,m,d]=day.split('-').map(Number);const x=new Date(y,m-1,d+n,12);return `${x.getFullYear()}-${String(x.getMonth()+1).padStart(2,'0')}-${String(x.getDate()).padStart(2,'0')}`;}
export function searchRecords(rhythm,spaces,capital){
  const rows=[];
  for(const [type,label] of [['tasks','Задача'],['goals','Цель'],['projects','Проект']])for(const x of rhythm?.[type]||[])rows.push({id:x.id,space:'personal',page:type,type:label,title:x.title||label,detail:[x.description,x.category].filter(Boolean).join(' · '),words:[x.title,x.description,x.category].join(' ')});
  for(const x of spaces?.personal?.events||[])rows.push({id:x.id,space:'personal',page:'accounts',type:'Личная операция',title:x.comment||x.category||'Операция',detail:x.date||'',words:[x.comment,x.category,x.date].join(' ')});
  for(const x of capital?.settlements||[])rows.push({id:x.id,space:'work',page:'settlements',type:'Расчёт',title:x.title||x.counterparty||'Расчёт',detail:x.counterparty||'',words:[x.title,x.counterparty,...(x.steps||[]).flatMap(s=>[s.counterparty,s.wallet,s.purpose,s.comment])].join(' ')});
  for(const x of spaces?.pending||[])rows.push({id:x.id,space:'work',page:'journal',type:'Запись без счёта',title:x.counterparty||x.person||x.comment||'Запись без счёта',detail:x.date||'',words:Object.values(x).filter(v=>typeof v==='string').join(' ')});
  for(const x of capital?.events||[])if(!x.settlementId)rows.push({id:x.id,space:'work',page:'journal',type:'Операция',title:x.recipient||x.counterparty||x.comment||x.category||'Операция',detail:x.date||'',words:[x.recipient,x.counterparty,x.comment,x.category,x.date].join(' ')});
  for(const x of spaces?.reports||[])rows.push({id:x.id,space:'work',page:'reports',type:'Свободный отчёт',title:x.title||x.note?.slice(0,70)||'Отчёт',detail:[x.from,x.to,x.date].filter(Boolean).join(' · '),words:[x.title,x.note,x.from,x.to,x.date].join(' ')});
  return rows;
}
export function filterSearch(rows,query,space,both=false){const q=String(query||'').trim().toLocaleLowerCase('ru');if(!q)return [];return rows.filter(x=>(both||x.space===space)&&x.words.toLocaleLowerCase('ru').includes(q)).slice(0,50);}
