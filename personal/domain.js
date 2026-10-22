import {defaultPlanner,validatePlanner,reconcilePlanner} from './planner.js';
export const CATEGORIES=['Бизнес','Финансы','Учёба','Спорт','Личное'];
export const TASK_STATES=['Запланирована','В работе','Завершена'];
export const PROJECT_STATES=['Запланирован','В работе','Завершён'];
export const PRIORITIES=['Низкий','Обычный','Высокий'];
export const localDay=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const shiftDay=(day,n)=>{let [y,m,d]=day.split('-').map(Number);return localDay(new Date(y,m-1,d+n,12));};
export const validDay=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number(v.slice(0,4))>=1000&&localDay(new Date(+v.slice(0,4),+v.slice(5,7)-1,+v.slice(8),12))===v;
export const emptyData=()=>({version:2,initialized:true,demo:false,goals:[],projects:[],tasks:[],planner:defaultPlanner()});
export const stamp=()=>new Date().toISOString();
export const makeEntity=(type,fields={})=>({id:crypto.randomUUID(),title:'',description:'',category:'Личное',due:null,createdAt:stamp(),updatedAt:stamp(),...(type==='tasks'?{priority:'Обычный',status:'Запланирована',projectId:null,goalId:null,completedAt:null,estimate:null,effort:null}:type==='projects'?{status:'Запланирован',goalId:null}:{}),...fields});
export function tasksFor(data,type,id){if(type==='projects')return data.tasks.filter(t=>t.projectId===id);let ids=new Set(data.projects.filter(p=>p.goalId===id).map(p=>p.id));return data.tasks.filter(t=>t.goalId===id||ids.has(t.projectId));}
export function progress(tasks){const total=tasks.length,done=tasks.filter(t=>t.status==='Завершена').length;return {total,done,percent:total?Math.round(done/total*100):null};}
export function sorted(tasks){return [...tasks].sort((a,b)=>(a.status==='Завершена')-(b.status==='Завершена')||PRIORITIES.indexOf(b.priority)-PRIORITIES.indexOf(a.priority)||(a.due||'9999').localeCompare(b.due||'9999')||a.createdAt.localeCompare(b.createdAt));}
export function removeEntity(data,type,id){let d=structuredClone(data),now=stamp();d[type]=d[type].filter(x=>x.id!==id);if(type==='goals'){d.projects.forEach(p=>{if(p.goalId===id){p.goalId=null;p.updatedAt=now;}});d.tasks.forEach(t=>{if(t.goalId===id){t.goalId=null;t.updatedAt=now;}});}if(type==='projects'){const goal=data.projects.find(p=>p.id===id)?.goalId||null;d.tasks.forEach(t=>{if(t.projectId===id){t.projectId=null;t.goalId=goal;t.updatedAt=now;}});}return reconcilePlanner(d);}
export function validateData(input){
 const fail=m=>{throw new Error(m);};
 if(!input||typeof input!=='object'||![1,2].includes(input.version)||input.initialized!==true||typeof input.demo!=='boolean')fail('Неподдерживаемый формат резервной копии.');
 if(!['goals','projects','tasks'].every(k=>Array.isArray(input[k])&&input[k].length<=50000))fail('Ожидались списки целей, проектов и задач.');
 const ids=new Set(),stampOK=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}T/.test(v)&&Number.isFinite(Date.parse(v));
 for(const type of ['goals','projects','tasks'])for(const e of input[type]){
 if(!e||typeof e!=='object'||typeof e.id!=='string'||!e.id.trim()||e.id.length>200||ids.has(e.id))fail('Идентификаторы отсутствуют или повторяются.');ids.add(e.id);
 if(typeof e.title!=='string'||!e.title.trim()||e.title.length>500||typeof e.description!=='string'||e.description.length>20000||!CATEGORIES.includes(e.category)||!(e.due===null||validDay(e.due))||!stampOK(e.createdAt)||!stampOK(e.updatedAt))fail('Некорректные поля записи: название, категория, дата или время.');
 if(type==='projects'&&(!PROJECT_STATES.includes(e.status)||!(e.goalId===null||typeof e.goalId==='string')))fail('Некорректный проект.');
 if(type==='tasks'&&(!TASK_STATES.includes(e.status)||!PRIORITIES.includes(e.priority)||!(e.goalId===null||typeof e.goalId==='string')||!(e.projectId===null||typeof e.projectId==='string')||((e.status==='Завершена')?!stampOK(e.completedAt):e.completedAt!==null)))fail('Некорректная задача или дата завершения.');
 }
 const goals=new Set(input.goals.map(e=>e.id)),projects=new Set(input.projects.map(e=>e.id));
 for(const p of input.projects)if(p.goalId!==null&&!goals.has(p.goalId))fail('Проект ссылается на отсутствующую цель.');
 for(const t of input.tasks)if((t.projectId!==null&&!projects.has(t.projectId))||(t.goalId!==null&&!goals.has(t.goalId))||(t.projectId!==null&&t.goalId!==null))fail('У задачи отсутствующая или конфликтующая связь.');
 // Copy only known fields: imported text is always rendered with escaping.
 let clean={...structuredClone(input),...emptyData()};clean.demo=input.demo;delete clean.exportedAt;
 for(const type of ['goals','projects','tasks'])clean[type]=input[type].map(e=>({...e,...Object.fromEntries(['id','title','description','category','due','createdAt','updatedAt',...(type==='projects'?['status','goalId']:type==='tasks'?['priority','status','goalId','projectId','completedAt']:[])].map(k=>[k,e[k]]))}));
 clean.planner=validatePlanner(input.planner??(input.version===1?defaultPlanner():null),clean,validDay);
 return clean;
}
export function demoData(today=localDay()){
 let d=emptyData();d.demo=true;
 let g=makeEntity('goals',{title:'Читать и узнавать новое',description:'Небольшие регулярные шаги к новым знаниям.',category:'Учёба',due:shiftDay(today,60)});d.goals.push(g);
 let p=makeEntity('projects',{title:'Месяц осознанного чтения',description:'Выбрать книгу, читать понемногу и записывать главные мысли.',category:'Учёба',goalId:g.id,status:'В работе',due:shiftDay(today,25)});d.projects.push(p);
 let sport=makeEntity('goals',{title:'Двигаться регулярно',category:'Спорт',description:'Найти комфортный ритм тренировок.'});d.goals.push(sport);
 const add=(fields)=>d.tasks.push(makeEntity('tasks',fields));
 add({title:'Выбрать книгу для чтения',category:'Учёба',projectId:p.id,due:today,status:'Завершена',completedAt:stamp()});
 add({title:'Прочитать 20 страниц',category:'Учёба',projectId:p.id,due:today,priority:'Высокий'});
 add({title:'Записать три главные мысли',category:'Учёба',projectId:p.id,due:shiftDay(today,2)});
 add({title:'Лёгкая тренировка — 25 минут',category:'Спорт',goalId:sport.id,due:today});
 add({title:'Составить план недели',due:shiftDay(today,-1),priority:'Высокий'});
 add({title:'Выбрать тему для изучения',category:'Учёба',goalId:g.id});
 return d;
}
export function monthGrid(year,month){const first=new Date(year,month,1,12),offset=(first.getDay()+6)%7;return Array.from({length:42},(_,i)=>localDay(new Date(year,month,1-offset+i,12)));}
