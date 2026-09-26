/* Node detail behaviour mirrors the five iOS NodeTimeline views and EnergyHistoryResponse mappers. */
let nodeDetail = null;
const detailClamp = value => Math.max(0, Math.min(100, value));
const detailNumber = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
function detailDate(epoch, zone) {
  const parts = new Intl.DateTimeFormat('en-CA', {timeZone:zone, year:'numeric', month:'2-digit', day:'2-digit'}).formatToParts(new Date(epoch * 1000));
  const get = type => Number(parts.find(p => p.type === type).value);
  return [get('year'), get('month'), get('day')];
}
function detailMidnight(date, zone) {
  // Solve local midnight using calendar parts rather than assuming a 24-hour day.
  const target = Date.UTC(date[0], date[1]-1, date[2]) / 1000;
  let guess = target;
  const formatter = new Intl.DateTimeFormat('en-GB', {timeZone:zone, year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  for(let i=0;i<5;i++) {
    const p = Object.fromEntries(formatter.formatToParts(new Date(guess*1000)).map(p=>[p.type,p.value]));
    const correction = target-Date.UTC(+p.year,+p.month-1,+p.day,+p.hour,+p.minute,+p.second)/1000;
    guess += correction;
    if(!correction) break;
  }
  return guess;
}
function detailShift(date, period, amount) {
  const d = new Date(Date.UTC(date[0], date[1]-1, date[2]));
  if(period === 'year') d.setUTCFullYear(d.getUTCFullYear()+amount,0,1);
  else if(period === 'month') d.setUTCMonth(d.getUTCMonth()+amount,1);
  else d.setUTCDate(d.getUTCDate()+amount);
  return [d.getUTCFullYear(),d.getUTCMonth()+1,d.getUTCDate()];
}
function detailBounds(date, period, zone) {
  const start = [date[0],period==='year'?1:date[1],period==='day'?date[2]:1];
  return [detailMidnight(start,zone), detailMidnight(detailShift(start,period,1),zone)];
}
function detailRows(data) {
  const inner = data.response || data;
  return (inner.time_series ?? inner.SmartBreakerEnergyLogs ?? []).map(row=>({...row,t:Date.parse(row.timestamp)/1000})).filter(row=>Number.isFinite(row.t)).sort((a,b)=>a.t-b.t);
}
function detailEnergy(row, node) {
  const first = (...values) => values.map(detailNumber).find(v=>v!==null) ?? 0;
  const sum = keys => keys.reduce((total,key)=>total+(detailNumber(row[key])??0),0);
  if(node==='solar') return {a:first(row.total_solar_generation,row.solar_energy_exported,row.solar_energy_wh), b:0};
  if(node==='home') return {a:first(row.home_energy_wh,row.total_home_usage,row.consumption_energy_wh,sum(['consumer_energy_imported_from_grid','consumer_energy_imported_from_solar','consumer_energy_imported_from_battery','consumer_energy_imported_from_generator'])),b:0};
  if(node==='grid') return {a:first(row.grid_energy_imported,Math.max(row.grid_energy_wh||0,0)),b:first(row.grid_energy_exported,row.total_grid_energy_exported,sum(['grid_energy_exported_from_solar','grid_energy_exported_from_battery','grid_energy_exported_from_generator'])||Math.max(-(row.grid_energy_wh||0),0))};
  return {a:first(row.battery_energy_charged,row.total_battery_charge,Math.max(sum(['battery_energy_imported_from_grid','battery_energy_imported_from_solar','battery_energy_imported_from_generator']),sum(['battery_energy_charged_from_grid','battery_energy_charged_from_solar','battery_energy_charged_from_generator']))),b:first(row.battery_energy_discharged,row.total_battery_discharge,row.battery_energy_exported)};
}
function detailPoints(data,node,period,zone,start,end) {
  const rows = detailRows(data).filter(r=>r.t>=start&&r.t<end);
  if(period==='day') return rows.map((row,i)=>{
    const {a,b}=detailEnergy(row,node);
    const hours = Math.max(((rows[i+1]?.t ?? row.t+300)-row.t)/3600,1/12);
    return {t:row.t,a:a/1000,b:b/1000,value:(a-b)/1000/hours};
  });
  const groups = new Map();
  for(const row of rows) {
    const date=detailDate(row.t,zone); if(period==='year') date[2]=1;
    const t=detailMidnight(date,zone), energy=detailEnergy(row,node), p=groups.get(t)||{t,a:0,b:0};
    p.a+=energy.a/1000;p.b+=energy.b/1000;p.value=p.a-p.b;groups.set(t,p);
  }
  return [...groups.values()];
}
function detailSOC(rows,anchor,soc,capacity) {
  const samples=rows.filter(r=>r.t<=anchor).map(r=>({t:r.t,...detailEnergy(r,'battery')}));
  const change=p=>(p.a-p.b)/(Math.max(capacity,.001)*1000)*100;
  let low=0,high=100;
  for(let i=0;i<32;i++) {
    const end=samples.reduce((v,p)=>detailClamp(v+change(p)),(low+high)/2);
    if(end<soc) low=(low+high)/2; else high=(low+high)/2;
  }
  let value=(low+high)/2;
  const result=samples.map(p=>({t:p.t,value:value=detailClamp(value+change(p))}));
  result.push({t:anchor,value:detailClamp(soc)}); return result;
}
function detailEVEnergy(points) {
  return points.slice(0,-1).reduce((sum,p,i)=>sum+Math.max(p.value,0)*Math.min(Math.max((points[i+1].t-p.t)/3600,0),1/6),0);
}
function detailFormat(value,unit,digits=1) {
  return detailNumber(value)===null?'—':`${new Intl.NumberFormat('en-GB',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(value)} ${unit}`;
}
function detailTime(t,period,zone) {
  return new Intl.DateTimeFormat('en-GB',{timeZone:zone,...(period==='day'?{hour:'2-digit',minute:'2-digit'}:period==='month'?{day:'numeric',month:'short'}:{month:'short',year:'numeric'})}).format(new Date(t*1000));
}
async function loadNodeChart(node) {
  const site=$('siteSelect').value;
  if(!site) return;
  nodeDetail={node,site,zone:siteTimezone(),date:detailDate(Date.now()/1000,siteTimezone()),period:'day',tomorrow:false};
  setText('nodeChartTitle',({solar:'Solar',home:'Home / Vehicle',grid:'Grid',battery:'Battery',ev:'EV'})[node]);
  if(!$('nodeChart').open) $('nodeChart').showModal();
  await renderNodeDetail();
}
function detailControls(state) {
  const today=detailDate(Date.now()/1000,state.zone), start=detailBounds(state.date,state.period,state.zone)[0];
  const current=detailBounds(today,state.period,state.zone)[0];
  const limited=(state.node==='battery'||state.node==='ev')&&state.period==='day';
  const earliest=detailMidnight(detailShift(today,'day',-6),state.zone);
  const last=state.node==='solar'&&state.tomorrow&&state.period==='day'?detailMidnight(detailShift(today,'day',1),state.zone):current;
  const label=new Intl.DateTimeFormat('en-GB',{timeZone:state.zone,...(state.period==='day'?{weekday:'short',day:'numeric',month:'short',year:'numeric'}:state.period==='month'?{month:'long',year:'numeric'}:{year:'numeric'})}).format(new Date(start*1000));
  return `<div class="detail-periods" role="group" aria-label="History period">${(state.node==='ev'?['day']:['day','month','year']).map(p=>`<button class="button button-quiet" data-period="${p}" aria-pressed="${p===state.period}">${p[0].toUpperCase()+p.slice(1)}</button>`).join('')}</div><div class="detail-navigation"><button class="button button-quiet" data-shift="-1" aria-label="Previous ${state.period}" ${limited&&start<=earliest?'disabled':''}>‹</button><strong>${escapeHtml(label)}</strong><button class="button button-quiet" data-shift="1" aria-label="Next ${state.period}" ${start>=last?'disabled':''}>›</button></div><div class="detail-actions"><button class="button button-quiet" data-current>${({day:'Today',month:'This month',year:'This year'})[state.period]}</button><button class="button button-quiet" data-reload>Refresh</button></div>`;
}
async function renderNodeDetail() {
  const state=nodeDetail, request=++chartRequest;
  if(!state) return;
  const valid=()=>request===chartRequest&&nodeDetail===state&&$('nodeChart').open;
  const [start,end]=detailBounds(state.date,state.period,state.zone), now=Date.now()/1000;
  const today=detailBounds(detailDate(now,state.zone),'day',state.zone)[0];
  setText('nodeChartSub',`${({solar:'Power and forecast',home:'Energy usage',grid:'Import and export',battery:'Charge and discharge',ev:'Charging power'})[state.node]} · ${state.zone}`);
  $('nodeChartBars').innerHTML=`${detailControls(state)}<div id="detailResults" aria-live="polite"><div class="empty">Loading history…</div></div>`;
  const history=(date,period=state.period)=>api(`/v1/tesla/energy-history?site_key=${encodeURIComponent(state.site)}&period=${period}&end_date=${encodeURIComponent(new Date((detailBounds(date,period,state.zone)[1]-1)*1000).toISOString())}`);
  try {
    let points=[],forecast=[],warnings=[],capacity=13.5,live=null,forecastTotal=null,provider='',reserve=detailNumber(currentOverview?.tesla_settings?.backup_reserve_percent);
    if(state.node==='ev') {
      const data=await api(`/v2/ev/power/today?site_key=${encodeURIComponent(state.site)}`);
      points=(data.points||[]).map(p=>({t:Number(p.timestamp),value:detailNumber(p.kw)})).filter(p=>p.value!==null&&Number.isFinite(p.t)&&p.t>=start&&p.t<end).sort((a,b)=>a.t-b.t);
    } else if(state.node==='battery'&&state.period==='day') {
      const results=await Promise.all([history(state.date),api(`/v1/tesla/live-status?site_key=${encodeURIComponent(state.site)}`),api(`/v1/tesla/site-info?site_key=${encodeURIComponent(state.site)}`).catch(error=>{if(error.name==='AbortError') throw error;return null;})]);
      if(!valid()) return;
      const info=results[2]?.response||results[2];live=results[1]?.response||results[1];
      if(detailNumber(live.percentage_charged)===null) throw new Error('Battery charge is currently unavailable');
      if(detailNumber(info?.nameplate_energy_wh)>0) capacity=Number(info.nameplate_energy_wh)/1000;
      else if(detailNumber(info?.battery_count)>0) capacity=Number(info.battery_count)*13.5;
      else warnings.push('Using the app’s default 13.5 kWh capacity; Powerwall capacity is unavailable.');
      reserve=detailNumber(info?.backup_reserve_percent)??reserve;
      let soc=Number(live.percentage_charged);
      // iOS reconstructs previous days from the current SOC and subsequent charge/discharge energy.
      for(let date=detailShift(state.date,'day',1);detailMidnight(date,state.zone)<=today;date=detailShift(date,'day',1)) {
        const data=await history(date,'day'); if(!valid()) return;
        const [a,b]=detailBounds(date,'day',state.zone), rows=detailRows(data).filter(r=>r.t>=a&&r.t<Math.min(b,now+1));
        if(!rows.length) throw new Error('Battery history is incomplete for this date');
        soc-=rows.reduce((sum,r)=>{const e=detailEnergy(r,'battery');return sum+e.a-e.b;},0)/(capacity*1000)*100;
      }
      const rows=detailRows(results[0]).filter(r=>r.t>=start&&r.t<end);
      if(rows.length||start===today) points=detailSOC(rows,Math.min(end-1,now),detailClamp(soc),capacity);
    } else {
      const data=start>today&&state.node==='solar'&&state.period==='day'?null:await history(state.date);
      if(data) points=detailPoints(data,state.node,state.period,state.zone,start,end);
    }
    if(state.node==='solar'&&state.period==='day'&&start>=today) {
      const target=start===today?'today':'tomorrow';
      try {
        const data=await api(`/v1/pv/forecast-preview?site_key=${encodeURIComponent(state.site)}&target_day=${target}`);
        forecast=(data.points||[]).map(p=>({t:Number(p.timestamp),value:detailNumber(p.pv_estimate),kwh:detailNumber(p.kwh)})).filter(p=>Number.isFinite(p.t)&&p.value!==null&&p.t>=start&&p.t<end).sort((a,b)=>a.t-b.t);
        forecastTotal=detailNumber(data.kwh)??(forecast.length?forecast.reduce((sum,p)=>sum+(p.kwh||0),0):null);provider=data.provider||'';
      } catch(error) {if(error.name==='AbortError') throw error; warnings.push('Solar forecast is unavailable for this day.');}
    }
    if(!valid()) return;
    const model={...state,start,end,today,points,forecast,forecastTotal,provider,reserve,capacity,live};
    $('detailResults').innerHTML=detailSummary(model)+warnings.map(w=>`<p class="detail-note">${escapeHtml(w)}</p>`).join('')+detailGraph(model)+detailEstimate(model);
    bindDetailGraph(model);
    // Tomorrow is offered only when a cached forecast exists, as in iOS.
    if(state.node==='solar'&&state.period==='day'&&!state.tomorrow) {
      try {
        const data=await api(`/v1/pv/forecast-preview?site_key=${encodeURIComponent(state.site)}&target_day=tomorrow&cached_only=true`);
        if(valid()&&data.points?.length) {state.tomorrow=true;const button=$('nodeChartBars').querySelector('[data-shift="1"]');button.disabled=start>=detailMidnight(detailShift(detailDate(now,state.zone),'day',1),state.zone);}
      } catch(_) { /* Forecast may not be configured or cached. Actual history remains available. */ }
    }
  } catch(error) {
    if(valid()&&error.name!=='AbortError') $('detailResults').innerHTML=`<div class="empty">${escapeHtml(friendlyError(error))}. Use Refresh to try again.</div>`;
  }
}
function detailSummary(m) {
  if(!m.points.length&&!m.forecast.length) return '';
  const sum=key=>m.points.reduce((s,p)=>s+(p[key]||0),0),peak=Math.max(0,...m.points.map(p=>p.value));
  const cards=[];
  if(m.node==='ev') cards.push([m.start===m.today?'Now':'Last',detailFormat(m.points.at(-1)?.value,'kW',2)],['Energy',detailFormat(detailEVEnergy(m.points),'kWh')],['Peak',detailFormat(peak,'kW',2)]);
  else if(m.node==='battery'&&m.period==='day') {if(m.start===m.today) cards.push(['State of charge',detailFormat(m.points.at(-1)?.value,'%',0)]);}
  else if(m.node==='battery'||m.node==='grid') cards.push([m.node==='grid'?'Imported':'Charged',detailFormat(sum('a'),'kWh')],[m.node==='grid'?'Exported':'Discharged',detailFormat(sum('b'),'kWh')]);
  else {
    cards.push([m.node==='solar'?'Generated':'Used',m.points.length?detailFormat(sum('a'),'kWh'):'—']);
    if(m.node==='solar'&&m.period==='day'&&m.start>=m.today) cards.push([m.start>m.today?'Tomorrow':m.provider==='solcast'?'Solcast':'Forecast',detailFormat(m.forecastTotal,'kWh')]);
    else cards.push([m.period==='day'?(m.node==='home'?'Peak demand':'Peak power'):m.period==='month'?(m.node==='home'?'Highest day':'Best day'):(m.node==='home'?'Highest month':'Best month'),detailFormat(peak,m.period==='day'?'kW':'kWh',m.period==='day'?2:1)]);
  }
  let status='';
  if(m.node==='ev') status=m.start===m.today?(m.points.at(-1)?.value>.2?'Charging':'Not charging'):'';
  if(m.node==='grid'&&m.period==='day'&&m.points.length) {const kw=m.points.at(-1).value;status=kw>.05?'Importing':kw<-.05?'Exporting':'Idle';}
  if(m.node==='battery'&&m.start===m.today&&m.period==='day'&&detailNumber(m.live?.battery_power)!==null) {const kw=Number(m.live.battery_power)/1000;status=kw>.05?'Discharging':kw<-.05?'Charging':'Idle';}
  return `${status?`<p class="detail-status">${status}</p>`:''}<div class="detail-summary">${cards.map(([label,value])=>`<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`).join('')}</div>`;
}
function detailEstimate(m) {
  if(m.node!=='battery'||m.period!=='day'||m.start!==m.today) return '';
  const power=detailNumber(m.live?.battery_power),soc=m.points.at(-1)?.value;
  if(power===null||soc==null||Math.abs(power)<=50) return '';
  const charging=power<0;
  if(!charging&&m.reserve===null) return '';
  const remaining=charging?100-soc:soc-m.reserve;
  if(remaining<=0) return '';
  const hours=remaining/100*m.capacity/(Math.abs(power)/1000),time=Date.now()/1000+hours*3600;
  const day=detailMidnight(detailDate(time,m.zone),m.zone);
  const prefix=day===m.today?'Today':day===detailMidnight(detailShift(detailDate(m.today,m.zone),'day',1),m.zone)?'Tomorrow':new Intl.DateTimeFormat('en-GB',{timeZone:m.zone,weekday:'short'}).format(new Date(time*1000));
  return `<div class="detail-estimate"><span>${charging?'Charging · Fully charged at':'Discharging · Reserve will be reached at'}</span><strong>${prefix} at ${detailTime(time,'day',m.zone)}</strong><p>About ${hours<1?`${Math.max(1,Math.round(hours*60))} min`:detailFormat(hours,'hours')} at the current rate.</p></div>`;
}
function detailGraph(m) {
  if(!m.points.length&&!m.forecast.length) return `<div class="empty">No ${m.node==='ev'?'EV charging':'energy'} data available for this period.${m.node==='ev'?'<p>EV history is available for today and the previous 6 days.</p>':''}</div>`;
  const soc=m.node==='battery'&&m.period==='day',bars=m.period!=='day',signed=(m.node==='grid'||m.node==='battery')&&!soc;
  const unit=soc?'%':bars?'kWh':'kW';
  const all=m.points.concat(m.forecast);
  const values=all.flatMap(p=>bars&&signed?[p.a,-p.b]:[p.value]);
  const max=soc?100:Math.max(.1,...values)*1.1,min=soc?0:Math.min(0,...values)*1.1;
  const x=t=>48+(t-m.start)/(m.end-m.start)*600,y=v=>230-(v-min)/(max-min)*200;
  m.graph={x,y,unit};
  const line=points=>points.map((p,i)=>`${i?'L':'M'}${x(p.t).toFixed(2)},${y(p.value).toFixed(2)}`).join(' ');
  let marks='';
  if(bars) {
    const width=Math.max(2,600/(m.period==='year'?12:31)*.65);
    marks=m.points.map(p=>(signed?[{v:p.a,c:'detail-positive'},{v:-p.b,c:'detail-negative'}]:[{v:p.value,c:`detail-${m.node}`}]).map(({v,c})=>`<rect class="${c}" x="${x(p.t)+3}" y="${Math.min(y(v),y(0))}" width="${width}" height="${Math.max(0,Math.abs(y(v)-y(0)))}"><title>${escapeHtml(detailTime(p.t,m.period,m.zone))}: ${detailFormat(v,unit)}</title></rect>`).join('')).join('');
  } else marks=`<path class="detail-line detail-${m.node}" d="${line(m.points)}"/>${m.points.map(p=>`<circle class="detail-dot detail-${m.node}" cx="${x(p.t)}" cy="${y(p.value)}" r="1.6"/>`).join('')}`;
  const ticks=Array.from({length:5},(_,i)=>{const value=min+(max-min)*i/4;return `<line class="detail-gridline" x1="48" x2="648" y1="${y(value)}" y2="${y(value)}"/><text x="42" y="${y(value)+4}" text-anchor="end">${Math.abs(value)<.01?'0':value.toFixed(soc?0:1)}</text>`;}).join('');
  const times=Array.from({length:5},(_,i)=>{const t=m.start+(m.end-m.start)*i/4;return `<text x="${x(t)}" y="255" text-anchor="${i===0?'start':i===4?'end':'middle'}">${escapeHtml(detailTime(i===4?t-1:t,m.period,m.zone))}</text>`;}).join('');
  const reserve=soc&&m.reserve!==null?`<line class="detail-reserve" x1="48" x2="648" y1="${y(m.reserve)}" y2="${y(m.reserve)}"/>`:'';
  return `<div class="detail-legend"><span>${soc?'State of charge':signed?(m.node==='battery'?'Charge above zero · Discharge below':'Import above zero · Export below'):unit==='kW'?'Power':'Energy'} (${unit})</span>${m.forecast.length?'<span class="detail-forecast-key">Dashed: solar forecast</span>':''}${reserve?`<span>Dashed: Backup Reserve ${detailFormat(m.reserve,'%',0)}</span>`:''}</div><svg id="detailGraph" class="timeline-svg detail-svg" viewBox="0 0 680 270" role="img" aria-label="${escapeHtml(nodeLabel(m.node))} chart. Use the reading selector below to explore values.">${ticks}<line class="chart-baseline" x1="48" x2="648" y1="${y(0)}" y2="${y(0)}"/>${marks}${m.forecast.length?`<path class="detail-line detail-forecast" d="${line(m.forecast)}"/>`:''}${reserve}<line id="detailCursor" class="detail-cursor" x1="48" x2="48" y1="30" y2="230" visibility="hidden"/>${times}</svg><label class="detail-selector" for="detailReading">Explore readings <input id="detailReading" type="range" min="0" max="${Math.max(0,all.length-1)}" value="0" step="1"></label><div id="detailSelection" class="detail-selection" aria-live="polite">Touch or point at the graph, or use the reading selector.</div>${soc?'<p class="detail-note">SOC history is estimated from Tesla energy history and the current battery charge, as in the app.</p>':''}`;
}
function bindDetailGraph(m) {
  const graph=$('detailGraph');if(!graph) return;
  const entries=[...m.points.map(p=>({...p,forecast:false})),...m.forecast.map(p=>({...p,forecast:true}))].sort((a,b)=>a.t-b.t);
  const select=index=>{
    const p=entries[index];if(!p) return;
    $('detailReading').value=index;
    let value=detailFormat(p.value,m.graph.unit,m.graph.unit==='kW'?2:1);
    if(m.node==='grid'&&m.period==='day') value=`${p.value>=0?'Import':'Export'} ${detailFormat(Math.abs(p.value),'kW',2)}`;
    if(m.period!=='day'&&(m.node==='grid'||m.node==='battery')) value=`${m.node==='grid'?'Imported':'Charged'} ${detailFormat(p.a,'kWh')} · ${m.node==='grid'?'Exported':'Discharged'} ${detailFormat(p.b,'kWh')}`;
    setText('detailSelection',`${detailTime(p.t,m.period,m.zone)} · ${p.forecast?'Forecast · ':''}${value}`);
    $('detailReading').setAttribute('aria-valuetext',$('detailSelection').textContent);
    const cursor=$('detailCursor');cursor.setAttribute('x1',m.graph.x(p.t));cursor.setAttribute('x2',m.graph.x(p.t));cursor.setAttribute('visibility','visible');
  };
  $('detailReading').addEventListener('input',event=>select(Number(event.target.value)));
  graph.addEventListener('pointermove',event=>{
    const rect=graph.getBoundingClientRect(), t=m.start+((event.clientX-rect.left)/rect.width*680-48)/600*(m.end-m.start);
    let nearest=0;for(let i=1;i<entries.length;i++) if(Math.abs(entries[i].t-t)<Math.abs(entries[nearest].t-t)) nearest=i;
    select(nearest);
  });
  graph.addEventListener('pointerdown',event=>{graph.setPointerCapture(event.pointerId);graph.dispatchEvent(new PointerEvent('pointermove',{clientX:event.clientX}));});
}
document.addEventListener('DOMContentLoaded',()=>{
  $('nodeChartBars').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||!nodeDetail) return;
    const today=detailDate(Date.now()/1000,nodeDetail.zone);
    if(button.dataset.period) {nodeDetail.period=button.dataset.period;nodeDetail.date=today;}
    else if(button.dataset.shift) nodeDetail.date=detailShift(nodeDetail.date,nodeDetail.period,Number(button.dataset.shift));
    else if(button.hasAttribute('data-current')) nodeDetail.date=today;
    else if(!button.hasAttribute('data-reload')) return;
    renderNodeDetail();
  });
  $('nodeChart').addEventListener('close',()=>{nodeDetail=null;});
});
