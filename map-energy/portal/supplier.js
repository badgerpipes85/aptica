/* Supplier cards follow SupplierView and TariffRateBarChart in iOS. */
let supplierView = null;
let supplierRequest = 0;
const supplierSelections = new Map();
function supplierNumber(value) { return value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value); }
function supplierRate(value, source, perDay = false) {
  const number=supplierNumber(value); if(number===null) return '—';
  const unit=source==='amber'||source==='comed'?'¢':'p';
  return `${new Intl.NumberFormat('en-GB',{minimumFractionDigits:perDay?2:1,maximumFractionDigits:perDay?2:1}).format(number)}${unit}/${perDay?'day':'kWh'}`;
}
function supplierSlots(tariff,zone) {
  const today=detailMidnight(detailDate(Date.now()/1000,zone),zone);
  const start=supplierNumber(tariff.day_start_utc)??today;
  const end=supplierNumber(tariff.day_end_utc)??detailMidnight(detailShift(detailDate(start,zone),'day',1),zone);
  const count=Math.round((end-start)/1800);
  return Array.from({length:count},(_,i)=>({start:start+i*1800,end:Math.min(end,start+(i+1)*1800),value:supplierNumber(tariff.slots?.[i])}));
}
function supplierSlotLabel(slot,zone) {
  const time=ts=>new Intl.DateTimeFormat('en-GB',{timeZone:zone,hour:'2-digit',minute:'2-digit',hourCycle:'h23',timeZoneName:'short'}).format(new Date(ts*1000));
  return `${time(slot.start)}–${time(slot.end)}`;
}
function supplierBand(value,bands) {
  if(value===null) return 'missing';
  if(value<0) return 'offpeak';
  if(bands.length<2||bands.length>4) return 'mid';
  const index=bands.findIndex(p=>Math.abs(p-value)<.01);
  return bands.length===4?['offpeak','low','mid','peak'][index]||'mid':index===0?'offpeak':index===bands.length-1?'peak':'mid';
}
function supplierTimestamp(value,zone) {
  return supplierNumber(value)>0?new Intl.DateTimeFormat('en-GB',{timeZone:zone,day:'numeric',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit',timeZoneName:'short'}).format(new Date(value*1000)):'Unavailable';
}
function tariffCard(tariff, zone, index=0) {
  const slots=supplierSlots(tariff,zone),values=slots.map(s=>s.value).filter(v=>v!==null);
  const bands=[...new Set(values)].sort((a,b)=>a-b);
  const max=Math.max(0,...values),min=Math.min(0,...values),range=Math.max(max-min,.01);
  const y=value=>120-(value-min)/range*100;
  const now=Date.now()/1000,current=slots.findIndex(s=>s.start<=now&&s.end>now);
  const title=tariff.kind==='export'?'Export':'Import';
  const source=tariff.display_name||({edf:'EDF UK',eon:'E.ON Next',octopus:'Octopus Energy',amber:'Amber Electric',comed:'ComEd',manual:'Custom tariff'})[tariff.source]||'Supplier tariff';
  const currentValue=tariff.stale?null:slots[current]?.value;
  const bars=slots.map((slot,i)=>`<g class="supplier-slot ${current===i&&!tariff.stale?'current':''}" data-slot="${i}"><rect class="supplier-price ${supplierBand(slot.value,bands)}" x="${10+i*600/slots.length}" y="${slot.value===null?y(0):Math.min(y(slot.value),y(0))}" width="${Math.max(1,600/slots.length-2)}" height="${slot.value===null?0:Math.max(1,Math.abs(y(slot.value)-y(0)))}" rx="2"/><rect class="supplier-hit" x="${10+i*600/slots.length}" y="10" width="${600/slots.length}" height="115"><title>${escapeHtml(supplierSlotLabel(slot,zone))}: ${escapeHtml(supplierRate(slot.value,tariff.source))}</title></rect></g>`).join('');
  const ticks=[0,.25,.5,.75,1].map((fraction,i)=>`<text x="${10+600*fraction}" y="146" text-anchor="${i===0?'start':i===4?'end':'middle'}">${escapeHtml(detailTime(slots[0].start+(slots.at(-1).end-slots[0].start)*fraction-(i===4?1:0),'day',zone))}</text>`).join('');
  const status=tariff.rate_origin==='supplier'?`Supplier rates checked ${supplierTimestamp(tariff.rates_checked_at,zone)}`:`Saved rates · ${supplierTimestamp(tariff.updated_at,zone)}`;
  return `<article class="glass supplier-card ${tariff.kind==='export'?'export':'import'}" data-supplier-card="${index}"><div class="tariff-heading"><span class="tariff-icon"><svg><use href="/map-energy/assets/map-energy-icons.svg#${tariff.kind==='export'?'export':'import'}"></use></svg></span><div><h2>${title}</h2><p>${escapeHtml(source)}</p></div></div>
    ${tariff.stale?`<p class="notice notice-error">Today’s rates are unavailable. Showing saved rates for ${escapeHtml(fmtDate(tariff.day_start_utc))}; these are not current prices.</p>`:''}
    <div class="supplier-rate-chart"><output class="supplier-hover hidden" aria-hidden="true"></output><svg class="supplier-svg" viewBox="0 0 620 155" role="img" aria-label="${title} electricity prices. Hover over the bars or use the reading selector below."><line class="supplier-zero" x1="10" x2="610" y1="${y(0)}" y2="${y(0)}"/>${bars}${ticks}</svg></div>
    <div class="supplier-legend"><span>Prices include VAT</span><span class="legend-now">Yellow: current / selected</span></div>
    <label class="supplier-reading-label">Explore rates<input class="supplier-reading" aria-label="Select ${title.toLowerCase()} rate" type="range" min="0" max="${slots.length-1}" value="${Math.max(0,current)}" step="1"></label>
    <div class="tariff-footer"><div><strong>${escapeHtml(supplierRate(tariff.standing_charge_pence,tariff.source,true))}</strong><small>Standing charge</small></div><div class="current-rate" aria-live="polite"><strong>${escapeHtml(supplierRate(currentValue,tariff.source))}</strong><small>${tariff.stale?'Current rate unavailable':'Current rate'}</small></div></div>
    <p class="supplier-range">Lowest ${escapeHtml(supplierRate(values.length?Math.min(...values):null,tariff.source))} · Highest ${escapeHtml(supplierRate(values.length?Math.max(...values):null,tariff.source))}</p>
    <details class="supplier-data-info"><summary>Rate information</summary><p>${escapeHtml(status)}</p>${tariff.rate_origin!=='supplier'?'<p>Saved by MAP Energy. Opening this page does not change the saved-rate timestamp.</p>':''}${tariff.refresh_unavailable?'<p>The supplier could not be refreshed. Saved rates are shown.</p>':''}${tariff.standing_charge_pence==null?'<p>The standing charge is not available from the connected data.</p>':''}</details>
  </article>`;
}
function supplierReferral(config,tariffs) {
  if(!config?.enabled||!tariffs.some(t=>['edf','eon','octopus'].includes(t.source))) return '';
  let url;try{url=new URL(config.url);}catch{return '';}
  if(url.protocol!=='https:'||!['edfenergy.com','www.edfenergy.com'].includes(url.hostname)||!url.pathname.startsWith('/quote/refer-a-friend/')) return '';
  const reward=supplierNumber(config.reward_gbp);if(reward===null||reward<0) return '';
  return `<article class="glass supplier-referral"><h2>Switching supplier?</h2><p>Join EDF Energy through MAP Energy’s referral link.</p><div class="supplier-referral-reward"><img src="/map-energy/assets/supplier-edf.png" alt="EDF Energy"><strong>You get £${new Intl.NumberFormat('en-GB',{maximumFractionDigits:2}).format(reward)} credit when you join.</strong></div><p>Referral code: <strong>${escapeHtml(config.code)}</strong></p><a class="button" href="${escapeHtml(url.href)}" target="_blank" rel="noopener noreferrer">Join EDF Energy ↗</a></article>`;
}
async function loadSupplier(siteKey) {
  const request=++supplierRequest, version=contextVersion;
  clearSupplierSelections();
  $('supplierCards').innerHTML='<div class="empty">Loading supplier rates…</div>';
  const [data,referral]=await Promise.all([api(`/v1/web/supplier?site_key=${encodeURIComponent(siteKey)}`),api('/v1/config/edf-referral').catch(()=>null)]);
  if(request!==supplierRequest||version!==contextVersion) return;
  supplierView={data,referral,loadedAt:new Date()};
  updateTimestamp();
  const tariffs=data.tariffs||[],zone=data.timezone||siteTimezone();
  $('supplierCards').innerHTML=`<div class="supplier-page-heading"><div><h2>Today’s import and export rates</h2><p>Times shown in ${escapeHtml(zone)}</p></div>${tariffs.some(t=>t.is_agile)?'<button id="openAgile" class="button button-quiet" type="button">🐙 Agile</button>':''}<span class="chip">${tariffs.length&&tariffs.every(t=>t.source==='manual')?'Custom':'Supplier tariffs'}</span></div>${tariffs.length?tariffs.map((t,i)=>tariffCard(t,zone,i)).join(''):'<div class="empty">No supplier tariffs are available for this site yet. Check the supplier connection in the MAP Energy app.</div>'}${supplierReferral(referral,tariffs)}`;
  bindSupplierCharts();
  $("openAgile")?.addEventListener("click",openSupplierAgile);
}
function clearSupplierSelections() {
  for(const timer of supplierSelections.values()) clearTimeout(timer);
  supplierSelections.clear();
}
function bindSupplierCharts(container=$('supplierCards'), tariffs=supplierView.data.tariffs, zone=supplierView.data.timezone||siteTimezone()) {
  for(const card of container.querySelectorAll('[data-supplier-card]')) {
    const tariff=tariffs[Number(card.dataset.supplierCard)],slots=supplierSlots(tariff,zone);
    const read=card.querySelector('.current-rate'),slider=card.querySelector('.supplier-reading'),tooltip=card.querySelector('.supplier-hover');
    const show=(index,selected)=>{
      const slot=slots[index],now=Date.now()/1000,current=slots.findIndex(s=>s.start<=now&&s.end>now);
      card.querySelectorAll('.supplier-slot').forEach((bar,i)=>{bar.classList.toggle('selected',selected&&i===index);bar.classList.toggle('current',!selected&&!tariff.stale&&i===current);});
      const value=selected?slot?.value:tariff.stale?null:slots[current]?.value;
      read.querySelector('strong').textContent=supplierRate(value,tariff.source);
      read.querySelector('small').textContent=selected?`Rate at ${supplierSlotLabel(slot,zone)}`:tariff.stale?'Current rate unavailable':'Current rate';
      if(selected) {slider.value=index;slider.setAttribute('aria-valuetext',`${supplierSlotLabel(slot,zone)} · ${supplierRate(value,tariff.source)}`);tooltip.textContent=`${supplierSlotLabel(slot,zone)} · ${supplierRate(value,tariff.source)}`;}
      tooltip.classList.toggle('hidden',!selected);
    };
    const select=index=>{clearTimeout(supplierSelections.get(card));show(index,true);supplierSelections.set(card,setTimeout(()=>{show(0,false);supplierSelections.delete(card);},5000));};
    const graph=card.querySelector('.supplier-svg');
    graph.addEventListener('pointermove',event=>{const bar=event.target.closest('[data-slot]');if(bar) select(Number(bar.dataset.slot));});
    graph.addEventListener('pointerdown',event=>{const bar=event.target.closest('[data-slot]');if(bar) select(Number(bar.dataset.slot));});
    graph.addEventListener('pointerleave',()=>{clearTimeout(supplierSelections.get(card));show(0,false);});
    slider.addEventListener('input',()=>select(Number(slider.value)));
  }
}
document.addEventListener('DOMContentLoaded',()=>{
  setInterval(()=>{
    if(activePage==='supplier'&&!document.hidden&&supplierView) {
      for(const card of $('supplierCards').querySelectorAll('[data-supplier-card]')) {
        if(card.querySelector('.supplier-slot.selected')) continue;
        const tariff=supplierView.data.tariffs[Number(card.dataset.supplierCard)],slots=supplierSlots(tariff,supplierView.data.timezone||siteTimezone()),now=Date.now()/1000,index=slots.findIndex(s=>s.start<=now&&s.end>now);
        card.querySelectorAll('.supplier-slot').forEach((bar,i)=>bar.classList.toggle('current',!tariff.stale&&i===index));
        card.querySelector('.current-rate strong').textContent=supplierRate(tariff.stale?null:slots[index]?.value,tariff.source);
      }
    }
  },60000);
});

let supplierAgile = null;
function openSupplierAgile() {
  supplierAgile={day:'today',mode:'graph',import:true,export:true};
  $('supplierAgile').showModal();renderSupplierAgile();
}
function renderSupplierAgile() {
  if(!supplierAgile||!supplierView) return;
  const state=supplierAgile,zone=supplierView.data.timezone||siteTimezone();
  const all=supplierView.data.tariffs.filter(t=>t.is_agile);
  const available=all.some(t=>t.tomorrow_slots?.some(v=>supplierNumber(v)!==null));
  const tariffs=all.filter(t=>state[t.kind]).map(t=>state.day==='today'?t:{...t,slots:t.tomorrow_slots||[],day_start_utc:t.tomorrow_start_utc,day_end_utc:t.tomorrow_end_utc,stale:false});
  const controls=`<div class="detail-periods" role="group" aria-label="Agile day">${['today','tomorrow'].map(day=>`<button class="button button-quiet" data-agile-day="${day}" aria-pressed="${state.day===day}" ${day==='tomorrow'&&!available?'disabled':''}>${day==='today'?'Today':'Tomorrow'}</button>`).join('')}</div><div class="detail-periods" role="group" aria-label="Agile display">${['graph','list'].map(mode=>`<button class="button button-quiet" data-agile-mode="${mode}" aria-pressed="${state.mode===mode}">${mode==='graph'?'Graph':'List'}</button>`).join('')}</div><div class="detail-periods">${['import','export'].filter(kind=>all.some(t=>t.kind===kind)).map(kind=>`<label><input type="checkbox" data-agile-kind="${kind}" ${state[kind]?'checked':''}> ${kind==='import'?'Import':'Export'}</label>`).join('')}</div>${!available?'<p class="detail-note">Tomorrow’s Agile rates are not available yet.</p>':''}`;
  let content='';
  if(!tariffs.length) content='<div class="empty">Select Import or Export to show rates.</div>';
  else if(state.mode==='graph') content=tariffs.map((t,i)=>tariffCard(t,zone,i)).join('');
  else {
    const slots=supplierSlots(tariffs[0],zone);
    content=`<div class="supplier-rate-list"><table><thead><tr><th>Time</th>${tariffs.map(t=>`<th>${t.kind==='import'?'Import':'Export'}</th>`).join('')}</tr></thead><tbody>${slots.map((slot,i)=>`<tr><th scope="row">${escapeHtml(supplierSlotLabel(slot,zone))}</th>${tariffs.map(t=>`<td>${escapeHtml(supplierRate(t.slots?.[i],t.source))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  $('supplierAgileContent').innerHTML=controls+`<div class="supplier-agile-results">${content}</div>`;
  if(state.mode==='graph') bindSupplierCharts($('supplierAgileContent'),tariffs,zone);
}
document.addEventListener('DOMContentLoaded',()=>{
  $('closeSupplierAgile').addEventListener('click',()=>$('supplierAgile').close());
  $('supplierAgile').addEventListener('close',()=>{supplierAgile=null;});
  $('supplierAgileContent').addEventListener('click',event=>{
    const button=event.target.closest('button');if(!button||!supplierAgile) return;
    if(button.dataset.agileDay) supplierAgile.day=button.dataset.agileDay;
    else if(button.dataset.agileMode) supplierAgile.mode=button.dataset.agileMode;
    else return;
    renderSupplierAgile();
  });
  $('supplierAgileContent').addEventListener('change',event=>{
    if(!event.target.dataset.agileKind||!supplierAgile) return;
    supplierAgile[event.target.dataset.agileKind]=event.target.checked;renderSupplierAgile();
  });
});
