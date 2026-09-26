/* Live Tesla history with the same interval alignment and usage split as iOS. */
let historyView = null;
let historyRequest = 0;
const historyDecimal = new Intl.NumberFormat("en-GB", {minimumFractionDigits:1,maximumFractionDigits:1});
const historyKwh = value => detailFormat(value,"kWh",1);
const historyRate = value => detailNumber(value)===null?"—":historyDecimal.format(value)+(historyView?.currency && historyView.currency!=="GBP"?"¢/kWh":"p/kWh");
const historyBuckets = [ ['free','Free','#30d158'], ['smart','Smart EV','#af52de'], ['offpeak','Off-peak','#32ade6'], ['standard','Standard','#ff9f0a'] ];
function historyCategory(slot) { return slot.is_free ? 'free' : slot.is_smart ? 'smart' : slot.is_supplier_cheap ? 'offpeak' : 'standard'; }
function historySplit(data) {
  const values = {free:0,smart:0,offpeak:0,standard:0};
  for (const slot of data.slots || []) values[historyCategory(slot)] += Math.max(0, detailNumber(slot.import_kwh) || 0);
  const classified = Object.values(values).reduce((a,b)=>a+b,0), total = Math.max(0,detailNumber(data.totals?.import_kwh)||0);
  // Match HistoryImportSplitView: distribute unbucketed headline energy in
  // proportion to known slices, rather than inventing a Standard segment.
  if (classified > 0 && total > classified) for (const key of Object.keys(values)) values[key] *= total / classified;
  else if (!classified) values.standard = total;
  return values;
}
function historyRing(data) {
  const values=historySplit(data),total=Object.values(values).reduce((a,b)=>a+b,0);
  if(!data.totals) return '';
  let offset=0;
  const segments=historyBuckets.filter(([key])=>values[key]>.001).map(([key,label,color])=>{
    const percent=total?values[key]/total*100:0,start=offset;offset+=percent;
    return `<circle cx="60" cy="60" r="46" fill="none" stroke="${color}" stroke-width="14" pathLength="100" stroke-dasharray="${percent} ${100-percent}" stroke-dashoffset="${-start}" transform="rotate(-90 60 60)"/>`;
  }).join('');
  return `<span class="history-split"><span class="eyebrow">Import usage split</span><span class="history-split-content"><svg viewBox="0 0 120 120" aria-hidden="true"><circle cx="60" cy="60" r="46" class="history-ring-track"/>${segments}<text x="60" y="59" text-anchor="middle" class="history-ring-total">${escapeHtml(historyDecimal.format(total))}</text><text x="60" y="76" text-anchor="middle" class="history-ring-unit">kWh</text></svg><span class="history-split-legend">${historyBuckets.filter(([key])=>values[key]>.001).map(([key,label])=>`<span class="history-slice ${key}"><span>${label}</span><strong>${escapeHtml(historyDecimal.format(values[key]))} kWh</strong><b>${Math.round(values[key]/total*100)}%</b></span>`).join('') || '<span>No grid import</span>'}</span></span></span>`;
}
function historyTotals(data) {
  const slots=(data.slots||[]).filter(s=>s.data_available!==false), t=data.totals;
  const sum=(key)=>slots.reduce((n,s)=>n+(detailNumber(s[key])||0),0);
  const cost=(energy,key,total)=> !t || !slots.length || Math.abs(sum(energy)-(detailNumber(total)||0))>.01 || slots.some(s=>detailNumber(s[key])===null) ? null : sum(key);
  const imported=cost('import_kwh','import_cost',t?.import_kwh), exported=cost('export_kwh','export_revenue',t?.export_kwh);
  const standing=detailNumber(data.import_standing_charge),exportStanding=detailNumber(data.export_standing_charge);
  const balance=imported===null||exported===null?null:imported-exported;
  return {imported,exported,standing,exportStanding,importTotal:imported===null||standing===null?null:imported+standing,exportTotal:exported===null||exportStanding===null?null:exported-exportStanding,balance,net:balance===null||standing===null||exportStanding===null?null:balance+standing+exportStanding,average:imported===null||!t?.import_kwh?null:imported/t.import_kwh*100};
}
function historyMoney(value) { return detailNumber(value)===null?'—':new Intl.NumberFormat('en-GB',{style:'currency',currency:historyView?.currency||'GBP'}).format(value); }
function historyMetric(label,value,kind='') { return `<div class="${kind}"><span>${escapeHtml(label)}</span><strong>${escapeHtml(value)}</strong></div>`; }
function historyDateInput(t,zone) { return detailDate(t,zone).map((n,i)=>i?String(n).padStart(2,'0'):n).join('-'); }
function historyControls() {
 const v=historyView,today=detailMidnight(detailDate(Date.now()/1000,v.zone),v.zone);
 const last=detailMidnight(detailShift(detailDate(today,v.zone),'day',-1),v.zone);
 return `<div class="history-controls"><button class="button button-quiet" id="historyOlder" type="button">← Earlier days</button><label>Choose a day <input id="historyDate" type="date" max="${historyDateInput(last,v.zone)}" value="${historyDateInput(v.days[0].day_start_utc,v.zone)}"></label><button class="button button-quiet" id="historyNewer" type="button" ${v.days[0].day_start_utc>=last?'disabled':''}>Later days →</button></div>`;
}
function renderHistoryList() {
 const v=historyView;if(!v)return;
 $('historyList').innerHTML=historyControls()+v.days.map(day=>{
  const d=v.details.get(day.day_start_utc),costs=d?historyTotals(d):null;
  return `<button type="button" class="glass history-day clickable" data-day="${day.day_start_utc}"><span class="history-day-head"><span class="history-calendar"><svg><use href="/map-energy/assets/map-energy-icons.svg#calendar"></use></svg></span><span><strong>${escapeHtml(fmtDate(day.day_start_utc))}</strong><small>${d?.totals?'Daily energy summary · Tesla':d?.error?'Tesla history unavailable · select to retry':d?'No Tesla readings for this day':'Retrieving Tesla history…'}</small></span><span class="history-chevron">›</span></span>${d?.totals?`<span class="history-metrics">${[['import','Import',d.totals.import_kwh],['export','Export',d.totals.export_kwh],['solar','PV',d.totals.solar_kwh]].map(([kind,label,value])=>`<span class="${kind}"><span>${label}</span><strong>${escapeHtml(historyKwh(value))}</strong></span>`).join('')}<span class="net"><span>${costs.net===null?'Energy balance¹':'Net cost'}</span><strong>${historyMoney(costs.net??costs.balance)}</strong></span></span>${historyRing(d)}`:''}</button>`;
 }).join('')+`<p class="muted history-footnote">¹ Energy balance excludes standing charges when historical charges are unavailable. Missing prices are shown as —. Smart slots are retained for 60 days; confirmed Power Perks sessions are overlaid where recorded. Free slots marked only on your phone are not synced.</p>`;
 document.querySelectorAll('[data-day]').forEach(el=>el.addEventListener('click',()=>loadHistoryDay(v.site,Number(el.dataset.day)).catch(handlePageError)));
 $('historyDate').addEventListener('change',e=>{const parts=e.target.value.split('-').map(Number);if(parts.length===3&&parts.every(Number.isFinite))loadHistoryDay(v.site,detailMidnight(parts,v.zone)).catch(handlePageError);});
 $('historyOlder').addEventListener('click',()=>loadHistory(v.site,detailShift(detailDate(v.days[0].day_start_utc,v.zone),'day',-7)).catch(handlePageError));
 $('historyNewer').addEventListener('click',()=>loadHistory(v.site,detailShift(detailDate(v.days[0].day_start_utc,v.zone),'day',7)).catch(handlePageError));
}
async function loadHistory(siteKey,firstDate=null) {
 const request=++historyRequest,version=contextVersion;
 const index=await api(`/v1/web/history?site_key=${encodeURIComponent(siteKey)}`);
 if(request!==historyRequest||version!==contextVersion)return;
 const zone=index.timezone||siteTimezone();
 let days=Array.isArray(index.days)?index.days:[];
 if(firstDate)days=Array.from({length:7},(_,i)=>({day_start_utc:detailMidnight(detailShift(firstDate,'day',-i),zone)}));
 if(!days.length){$('historyList').innerHTML='<div class="empty">No completed energy history is available yet.</div>';return;}
 const view={site:siteKey,zone,days,details:new Map(),pending:new Map(),selected:null,loadedAt:null};historyView=view;renderHistoryList();
 // Limit Tesla requests to three at a time, and reuse each response for detail.
 let cursor=0;
 await Promise.all(Array.from({length:3},async()=>{
  while(cursor<days.length&&request===historyRequest&&version===contextVersion){
   const day=days[cursor++];let data;
   try {data=await historyFetchDay(view,day.day_start_utc);}catch(e){if(e.name==='AbortError')return;data={error:true};}
   if(request!==historyRequest||version!==contextVersion)return;
   view.currency=data.currency||view.currency;view.details.set(day.day_start_utc,data);view.loadedAt=new Date();if(view.selected===null)renderHistoryList();updateTimestamp();
  }
 }));
}
function historySlotRange(slot,zone) {
 const f=new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',timeZoneName:'short'});
 return `${f.format(new Date(slot.start_ts*1000))} – ${f.format(new Date(slot.end_ts*1000))}`;
}
function historyGraph(data) {
 const slots=data.slots||[],max=Math.max(.01,...slots.flatMap(s=>[s.import_kwh||0,s.export_kwh||0])),width=720,step=width/Math.max(1,slots.length);
 return `<svg class="history-bars" viewBox="0 0 720 250" role="group" aria-label="Half-hour import above the line, export below. Use arrow keys to explore."><line x1="0" y1="115" x2="720" y2="115" class="history-zero"/>${slots.map((s,i)=>{
  const x=i*step+1,ih=Math.max(0,s.import_kwh||0)/max*98,eh=Math.max(0,s.export_kwh||0)/max*98;
  const color=s.is_free?'#63e6be':s.is_smart||s.is_supplier_cheap?'#3b82f6':'#9299a6';
  return `<g data-history-slot="${i}" tabindex="${i===0?0:-1}" role="button" aria-label="${escapeHtml(historySlotRange(s,data.timezone))}${s.data_available===false?', no readings':''}"><rect class="history-hit" x="${x}" y="10" width="${step-2}" height="210"/><rect x="${x}" y="${115-ih}" width="${step-2}" height="${ih}" rx="1" fill="${color}"/><rect x="${x}" y="115" width="${step-2}" height="${eh}" rx="1" fill="#32ade6"/></g>`;
 }).join('')}${[0,Math.floor(slots.length/4),Math.floor(slots.length/2),Math.floor(slots.length*3/4),slots.length-1].filter(i=>slots[i]).map((i,n)=>`<text x="${i*step+step/2}" y="242" text-anchor="${n===0?'start':n===4?'end':'middle'}">${escapeHtml(detailTime(slots[i].start_ts,'day',data.timezone))}</text>`).join('')}</svg>`;
}
async function historyFetchDay(view,dayStart) {
 const saved=view.details.get(dayStart);if(saved&&!saved.error)return saved;
 if(!view.pending.has(dayStart))view.pending.set(dayStart,api(`/v1/web/history-day?site_key=${encodeURIComponent(view.site)}&day_start_utc=${dayStart}`).finally(()=>view.pending.delete(dayStart)));
 const data=await view.pending.get(dayStart);view.details.set(dayStart,data);view.currency=data.currency||view.currency;return data;
}
async function loadHistoryDay(siteKey,dayStart) {
 const v=historyView,version=contextVersion;if(!v||v.site!==siteKey)return;
 v.selected=dayStart;
 let data=v.details.get(dayStart);
 if(!data||data.error){try{data=await historyFetchDay(v,dayStart);}catch(e){if(v===historyView&&v.selected===dayStart){v.selected=null;renderHistoryList();}throw e;}if(v!==historyView||version!==contextVersion||v.selected!==dayStart)return;}
 if(v!==historyView||v.selected!==dayStart)return;
 const costs=historyTotals(data),t=data.totals;
 $('historyList').innerHTML=`<article class="glass history-detail"><div class="history-detail-head"><div><span class="eyebrow">Daily detail · Tesla</span><h2>${escapeHtml(fmtDate(dayStart))}</h2></div><button id="closeDay" class="button button-quiet" type="button">Close</button></div><div class="history-controls"><button id="historyPrevious" class="button button-quiet" type="button">← Previous day</button><button id="historyNext" class="button button-quiet" type="button">Next day →</button></div>${!t?'<p class="empty">Tesla has no readings for this day.</p>':`<section class="history-flow"><div class="history-section-title"><div><strong>30-minute grid flow</strong><small>Import above · export below · hover, tap or use arrow keys</small></div></div>${historyGraph(data)}<div class="history-chart-legend"><span>Grey: standard import</span><span>Blue: off-peak / smart</span><span>Mint: free</span><span>Cyan: export</span></div></section><section class="history-slot-panel"><strong>Slot Details</strong><p id="historySlotTime">Select a bar</p><div id="historySlotMetrics" class="history-summary-grid"></div></section><section class="history-summary"><div class="history-section-title"><div><strong>Energy Summary</strong><small>Costs and energy totals</small></div></div><div class="history-summary-grid">${historyMetric('Import kWh',historyKwh(t.import_kwh),'import')}${historyMetric('Export kWh',historyKwh(t.export_kwh),'export')}${historyMetric(costs.standing===null?'Import energy cost':'Import cost (incl. standing)',historyMoney(costs.importTotal??costs.imported),'import')}${historyMetric('Export revenue',historyMoney(costs.exportTotal??costs.exported),'export')}${historyMetric('Avg import',historyRate(costs.average))}${historyMetric(costs.net===null?'Energy balance¹':'Net',historyMoney(costs.net??costs.balance))}${historyMetric('Import standing charge',historyMoney(costs.standing),'import')}${historyMetric('Export standing charge',historyMoney(costs.exportStanding),'export')}${historyMetric('Solar',historyKwh(t.solar_kwh),'solar')}</div></section>${historyRing(data)}<p class="muted history-footnote">¹ Energy balance excludes standing charges. Net includes them when available. Missing historical rates are shown as —. Smart slots: last 60 days. Free: recorded Power Perks participation; phone-only overrides are not synced.</p>`}</article>`;
 $('closeDay').addEventListener('click',()=>{v.selected=null;renderHistoryList();});
 const shift=amount=>detailMidnight(detailShift(detailDate(dayStart,v.zone),'day',amount),v.zone);
 $('historyPrevious').addEventListener('click',()=>loadHistoryDay(siteKey,shift(-1)).catch(handlePageError));
 $('historyNext').disabled=shift(1)>=detailMidnight(detailDate(Date.now()/1000,v.zone),v.zone);
 $('historyNext').addEventListener('click',()=>loadHistoryDay(siteKey,shift(1)).catch(handlePageError));
 const select=index=>{
  const s=data.slots[index];if(!s)return;
  document.querySelectorAll('[data-history-slot]').forEach(g=>{const selected=Number(g.dataset.historySlot)===index;g.classList.toggle('selected',selected);g.setAttribute('tabindex',selected?'0':'-1');});
  setText('historySlotTime',historySlotRange(s,v.zone)+(s.data_available===false?' · No Tesla readings':` · ${historyBuckets.find(([key])=>key===historyCategory(s))[1]}`));
  $('historySlotMetrics').innerHTML=historyMetric('Import kWh',s.data_available===false?'—':historyKwh(s.import_kwh),'import')+historyMetric('Export kWh',s.data_available===false?'—':historyKwh(s.export_kwh),'export')+historyMetric('Import cost',historyMoney(s.import_cost),'import')+historyMetric('Export revenue',historyMoney(s.export_revenue),'export')+historyMetric('Import rate',historyRate(Object.hasOwn(s,'effective_import_rate_pence')?s.effective_import_rate_pence:s.import_rate_pence),'import')+historyMetric('Export rate',historyRate(s.export_rate_pence),'export');
 };
 document.querySelectorAll('[data-history-slot]').forEach(g=>{
  const i=Number(g.dataset.historySlot);for(const event of ['pointerenter','click','focus'])g.addEventListener(event,()=>select(i));
  g.addEventListener('keydown',e=>{let next=i;if(e.key==='ArrowRight')next++;else if(e.key==='ArrowLeft')next--;else if(e.key==='Home')next=0;else if(e.key==='End')next=data.slots.length-1;else return;e.preventDefault();next=Math.max(0,Math.min(data.slots.length-1,next));select(next);document.querySelector(`[data-history-slot="${next}"]`).focus();});
 });
 v.loadedAt=new Date();updateTimestamp();
}
