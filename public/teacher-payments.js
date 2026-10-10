"use strict";
const accountTarget = document.getElementById("teacherPaymentsAccounts");
const transfersTarget = document.getElementById("teacherPaymentsTransfers");
const statusTarget = document.getElementById("teacherPaymentsStatus");
const months = new Map();
const rubles = (n) => new Intl.NumberFormat("ru-RU").format(Number(n) || 0) + " ₽";
const dateText = (s) => {
  const [year,month,day] = String(s).split("-");
  return day && month && year ? day + "." + month + "." + year : s;
};
const node = (tag,className,value) => {
  const result = document.createElement(tag);
  if (className) result.className=className;
  if (value !== undefined) result.textContent=String(value);
  return result;
};
function calendar(account,lessonDates) {
  const container=node("div","payment-calendar");
  const cursor=months.get(account.id) || new Date(new Date().getFullYear(),new Date().getMonth(),1);
  months.set(account.id,cursor);
  const header=node("div","payment-calendar-header");
  const nav=node("div","payment-calendar-nav-controls");
  const left=node("button","payment-calendar-arrow","‹");
  left.type="button";
  const right=node("button","payment-calendar-arrow","›");
  right.type="button";
  const picker=node("input","payment-month-picker");
  picker.type="month";
  picker.value=cursor.getFullYear()+"-"+String(cursor.getMonth()+1).padStart(2,"0");
  left.setAttribute("aria-label","Предыдущий месяц");
  right.setAttribute("aria-label","Следующий месяц");
  left.onclick=()=>{ months.set(account.id,new Date(cursor.getFullYear(),cursor.getMonth()-1,1));renderCalendar(); };
  right.onclick=()=>{ months.set(account.id,new Date(cursor.getFullYear(),cursor.getMonth()+1,1));renderCalendar(); };
  picker.onchange=()=>{ if (/^\\d{4}-\\d{2}$/.test(picker.value)){const [y,m]=picker.value.split("-").map(Number);months.set(account.id,new Date(y,m-1,1));renderCalendar();}};
  nav.append(left,picker,right);
  header.append(nav);
  container.append(header);
  const weekdays=node("div","payment-calendar-weekdays");
  ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"].forEach(x=>weekdays.append(node("span","",x)));
  container.append(weekdays);
  const grid=node("div","payment-calendar-grid");
  const y=cursor.getFullYear(), m=cursor.getMonth();
  const leading=(new Date(y,m,1).getDay()+6)%7;
  for(let i=0;i<leading;i++)grid.append(node("span","payment-calendar-spacer"));
  for(let day=1;day<=new Date(y,m+1,0).getDate();day++){
    const iso=y+"-"+String(m+1).padStart(2,"0")+"-"+String(day).padStart(2,"0");
    const marked=lessonDates.has(iso);
    const cell=node("span","payment-calendar-day"+(marked?" is-marked":""),day);
    cell.title=marked?"Занятие проведено · "+rubles(account.lessonPrice):"Занятие не отмечено";
    grid.append(cell);
  }
  container.append(grid);
  return container;
}
let payload;
function renderCalendar(){
  accountTarget.replaceChildren();
  if(!payload.accounts.length) accountTarget.append(node("p","teacher-payments-empty","Пока нет счётов и проведённых занятий."));
  for(const account of payload.accounts){
    const card=node("article","payment-account-card");
    const title=node("h2","",account.subject);
    const top=node("div","teacher-payments-account-summary");
    const info=node("div");
    info.append(node("span","teacher-payments-muted","Стоимость занятия: "+rubles(account.lessonPrice)),node("strong","teacher-payments-number",rubles(account.balance)),node("span","teacher-payments-muted",account.fullLessonsLeft+" полных занятий + "+rubles(account.remainderAfterLessons)));
    const done=node("div");
    done.append(node("span","teacher-payments-muted","Проведено занятий"),node("strong","teacher-payments-number",payload.lessons.filter(x=>x.accountId===account.id).length));
    top.append(info,done);
    const dates=new Set(payload.lessons.filter(x=>x.accountId===account.id).map(x=>x.date));
    card.append(title,top,calendar(account,dates));
    accountTarget.append(card);
  }
}
async function init(){
  try{
    const response=await fetch("/api/teacher/payment-history",{cache:"no-store"});
    if(!response.ok)throw new Error(response.status===403?"Доступ запрещён":"HTTP "+response.status);
    payload=await response.json();
    renderCalendar();
    transfersTarget.replaceChildren();
    const subjects=new Map(payload.accounts.map(a=>[a.id,a.subject]));
    for(const transfer of payload.transfers){
      const tr=node("tr");
      for(const value of [dateText(transfer.date),subjects.get(transfer.accountId)||"Предмет",rubles(transfer.amount)])tr.append(node("td","",value));
      transfersTarget.append(tr);
    }
    if(!payload.transfers.length){const tr=node("tr");const td=node("td","teacher-payments-empty","Переводов пока нет");td.colSpan=3;tr.append(td);transfersTarget.append(tr);}
    statusTarget.hidden=true;
  }catch(e){statusTarget.textContent="Не удалось загрузить оплаты: "+e.message;}
}
init();
