/* Uses the same grouped-action payloads and site-local schedules as iOS. */
const automationTriggers = {schedule:'Schedule',ev:'EV',battery:'Battery',price:'Price',power:'Power',solar:'Solar',event_import_cap:'Power Hour',edf_power_perks:'Power Perks'};
const automationActions = {adjust_backup_reserve:'Adjust Backup Reserve',freeze_battery_soc:'Freeze Battery SOC',tesla_export:'Set Export Condition',set_op_mode:'Operational Mode',set_grid_charging:'Grid Charging',notification_only:'Send a Notification Only',home_assistant_event:'Send to Home Assistant'};
let automationEditor = null;
let automationData = null;
const autoClone = value => JSON.parse(JSON.stringify(value));
function automationPausable(rule) {
  return ['ev','battery','price','power','solar','edf_power_perks'].includes(rule.payload?.trigger?.type) || (rule.payload?.trigger?.type === 'schedule' && rule.repeat_until != null);
}
function automationManaged(rule) { return Boolean(rule.payload?.system || rule.payload?.iog?.enabled || rule.payload?.power_perks?.managed); }
function autoSelect(name,label,options,value) {
  return `<label>${escapeHtml(label)}<select name="${name}">${Object.entries(options).map(([v,text])=>`<option value="${escapeHtml(v)}" ${String(value)===v?'selected':''}>${escapeHtml(text)}</option>`).join('')}</select></label>`;
}
function autoInput(name,label,value,type='number',extra='') {
  return `<label>${escapeHtml(label)}<input name="${name}" type="${type}" value="${escapeHtml(value ?? '')}" ${extra}></label>`;
}
function autoCheck(name,label,value) { return `<label class="auto-check"><input type="checkbox" name="${name}" ${value?'checked':''}>${escapeHtml(label)}</label>`; }
function autoDays(days) { return `<fieldset class="auto-days"><legend>Days</legend>${['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map((d,i)=>autoCheck(`day${i+1}`,d,days.includes(i+1))).join('')}</fieldset>`; }
function automationNextTime(time,days,zone,now=Date.now()/1000) {
  // Walk actual instants: missing/repeated clock times on DST changes remain valid.
  const fmt = new Intl.DateTimeFormat('en-GB',{timeZone:zone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for(let t=Math.floor(now/60)*60+60, end=t+8*86400;t<end;t+=60) {
    const p=Object.fromEntries(fmt.formatToParts(new Date(t*1000)).map(x=>[x.type,x.value]));
    if(`${p.hour}:${p.minute}`===time && days.includes(weekdays.indexOf(p.weekday)+1)) return t;
  }
  throw new Error('Choose at least one day and a valid time.');
}
function automationDefaultAction(type) {
  return {type,...({adjust_backup_reserve:{backup_reserve_percent:20},freeze_battery_soc:{high_soc_preference:80},tesla_export:{export_policy:'pv_only'},set_op_mode:{op_mode:'self_consumption'},set_grid_charging:{enabled:false},home_assistant_event:{event_name:'map_energy_event',message:''}}[type]||{})};
}
function automationAvailableActions(draft,except=-1) {
  const selected=draft.actions.filter((_,i)=>i!==except).map(a=>a.type);
  return Object.fromEntries(Object.entries(automationActions).filter(([type])=>
    !selected.includes(type) && !selected.includes('notification_only') &&
    !(type==='notification_only' && (selected.length || draft.trigger.type==='schedule')) &&
    !(type==='freeze_battery_soc' && selected.includes('adjust_backup_reserve')) &&
    !(type==='adjust_backup_reserve' && selected.includes('freeze_battery_soc')) &&
    !(type==='tesla_export' && !['never','no_export','pv_only','battery_ok'].includes(currentOverview?.tesla_settings?.export_rule) && draft.actions[except]?.type!==type) &&
    !(type==='home_assistant_event' && !automationData?.capabilities?.home_assistant && draft.actions[except]?.type!==type)));
}
function openAutomationEditor(rule=null) {
  if(!automationData)return;
  const payload=rule?.payload || {};
  automationEditor={rule,siteKey:automationData.site_key,version:contextVersion,saving:false,
    draft:{name:payload.name||'',trigger:autoClone(payload.trigger||{type:'schedule',days:[1,2,3,4,5,6,7],hour:18,minute:0}),actions:autoClone(payload.actions||[rule?payload:automationDefaultAction('adjust_backup_reserve')]),blocking:autoClone(payload.blocking||null)},
    repeating:rule?rule.repeat_until!=null:true,repeatUntil:rule?.repeat_until||7258118400};
  renderAutomationEditor(); $('automationEditor').showModal();
}
function renderAutomationEditor() {
  const e=automationEditor,d=e.draft,t=d.trigger,c=automationData.capabilities||{};
  const minor=c.currency && c.currency!=='GBP'?'cents':'pence';
  const triggers={...automationTriggers};
  if(!c.ev_charger_type || c.ev_charger_type==='none') delete triggers.ev;
  if(!c.power_perks) delete triggers.edf_power_perks;
  if(['otherBlind','other_blind'].includes(c.ev_charger_type)) delete triggers.event_import_cap;
  triggers[t.type]=automationTriggers[t.type];
  let fields='';
  if(t.type==='schedule') fields=autoInput('scheduleTime','Time',`${String(t.hour??18).padStart(2,'0')}:${String(t.minute??0).padStart(2,'0')}`,'time','required')+autoDays(t.days||[1,2,3,4,5,6,7])+autoCheck('repeating','Repeat',e.repeating)+(e.repeating?autoCheck('noEnd','No end date',e.repeatUntil===7258118400)+(e.repeatUntil!==7258118400?autoInput('endDate','Repeat until',new Date(e.repeatUntil*1000).toLocaleDateString('en-CA',{timeZone:automationData.timezone}),'date','required'):''):'');
  if(t.type==='ev') fields=autoSelect('event','EV event',{starts_charging:'Charging Started',stops_charging:'Charging Stopped'},t.event||'starts_charging');
  if(t.type==='edf_power_perks') fields=autoSelect('event','Power Perks event',{announced:'Event Announced',starts:'Free Electricity Starts',ends:'Free Electricity Ends'},t.event||'starts');
  if(t.type==='battery') fields=autoSelect('condition','Battery',{soc_above:'Charges above',soc_below:'Discharges below'},t.condition||'soc_above')+autoInput('value','Battery SOC (%)',t.value??50,'number','min="0" max="100" step="1" required');
  if(['price','power','solar'].includes(t.type)) {
    if(t.type!=='solar') fields+=autoSelect('source',t.type==='price'?'Rate':'Power flow',t.type==='price'?{import:'Import',export:'Export'}:{home:'Home',solar:'Solar',import:'Import',export:'Export',powerwall_charge:'PW Charge',powerwall_discharge:'PW Discharge'},t.source||'import');
    fields+=autoSelect('condition','Condition',{above:'Above',below:'Below'},t.condition||'above');
    fields+=autoInput('value',t.type==='price'?`Price (${minor} per kWh)`:t.type==='power'?'Power (kW)':'Forecast generation (kWh)',t.type==='price'?(t.value??.15)*100:t.type==='power'?(t.value_kw??1):(t.value_kwh??10),'number',`min="0" max="${t.type==='price'?200:t.type==='power'?50:100}" step="${t.type==='solar'?1:.1}" required`);
    if(t.type==='solar') fields+=autoInput('checkTime','Daily forecast check',t.check_time||'06:00','time','required')+'<p class="muted">One solar forecast automation per energy site.</p>';
  }
  if(t.type==='event_import_cap') fields=autoDays(t.days||[1,2,3,4,5,6,7])+autoInput('start','Power Hour starts',t.start||'12:00','time','required')+autoInput('end','Power Hour ends',t.end||'13:00','time','required')+autoInput('cap','Import cap (kWh)',t.import_cap_kwh??10,'number','min="0.1" max="100" step="0.1" required')+autoInput('threshold','Trigger at (kWh)',t.trigger_at_kwh??9,'number','min="0.1" max="100" step="0.1" required');
  if(['ev','battery','price','power'].includes(t.type)) fields+=autoCheck('window','Limit to a time window',t.time_window?.enabled)+(t.time_window?.enabled?autoInput('start','Window starts',t.time_window.start,'time','required')+autoInput('end','Window ends',t.time_window.end,'time','required'):'');
  if(t.type==='schedule') fields+=autoCheck('blocking','Enable blocking condition',!!d.blocking)+(d.blocking?autoSelect('blockCondition','Do not run when',{soc_below:'Battery SOC below',soc_above:'Battery SOC above',import_price_below:'Import price below',import_price_above:'Import price above',export_price_below:'Export price below',export_price_above:'Export price above'},d.blocking.condition)+autoInput('blockValue',d.blocking.condition.startsWith('soc_')?'Battery SOC (%)':`Price (${minor})`,d.blocking.value??50,'number','step="1" required')+(!d.blocking.condition.startsWith('soc_')?autoSelect('blockWindow','Price window',Object.fromEntries([30,60,90,120,150,180].map(v=>[v,`${v} minutes`])),d.blocking.window_minutes||60):''):'');
  const actions=d.actions.map((a,i)=>{
    let input='';
    if(a.type==='adjust_backup_reserve') input=autoInput(`reserve${i}`,'Backup reserve',a.backup_reserve_percent===100?81:a.backup_reserve_percent,'range','min="0" max="81" step="1"')+`<output data-reserve="${i}">${a.backup_reserve_percent}%</output><p class="muted">0–80%, then 100%.</p>`;
    if(a.type==='freeze_battery_soc') input=autoSelect(`freeze${i}`,'When SOC is already high',{80:'Prefer 80%',100:'Prefer 100%'},a.high_soc_preference);
    if(a.type==='tesla_export') input=autoSelect(`export${i}`,'Energy exports',{never:"Don't Export",pv_only:'Solar Only',battery_ok:'Everything'},a.export_policy==='no_export'?'never':a.export_policy);
    if(a.type==='set_op_mode') input=autoSelect(`mode${i}`,'Operational mode',{self_consumption:'Self-Powered',autonomous:'Time-Based Control',backup:'Backup'},a.op_mode);
    if(a.type==='set_grid_charging') input=autoSelect(`grid${i}`,'Grid charging',{false:'Disabled',true:'Enabled'},String(a.enabled));
    if(a.type==='home_assistant_event') input=autoInput(`haEvent${i}`,'Event name',a.event_name,'text','required pattern="[a-z][a-z0-9_]{0,63}" maxlength="64"')+autoInput(`haMessage${i}`,'Message (optional)',a.message,'text','maxlength="200"');
    return `<fieldset class="auto-action"><legend>Action ${i+1}</legend>${autoSelect(`action${i}`,'Action',automationAvailableActions(d,i),a.type)}${input}${d.actions.length>1?`<button type="button" class="button button-quiet" data-remove-action="${i}">Remove action</button>`:''}</fieldset>`;
  }).join('');
  $('automationEditorContent').innerHTML=`<form id="automationForm"><div class="panel-heading"><div><span class="eyebrow">${e.rule?'Edit automation':'New automation'}</span><h2 id="automationEditorTitle">${e.rule?'Edit your rule':'Add an automation'}</h2></div><button type="button" class="button button-quiet" data-auto-close>Cancel</button></div><p class="muted">Times use ${escapeHtml(automationData.timezone)}.${e.rule?.paused?' This automation will remain paused.':''}</p><fieldset><legend>Trigger</legend>${autoSelect('triggerType','Trigger type',triggers,t.type)}<div class="auto-fields">${fields}</div></fieldset>${autoInput('name','Name (optional)',d.name,'text','maxlength="20"')}<div class="auto-actions">${actions}</div>${d.actions.length<4 && Object.keys(automationAvailableActions(d)).length?'<button type="button" class="button button-quiet" id="autoAddAction">＋ Add another action</button>':''}<p id="automationEditorError" class="error hidden" role="alert"></p><div class="auto-footer">${e.rule?'<button type="button" class="button button-quiet" id="autoDelete">Delete automation</button>':''}<button type="submit" class="button button-primary">${e.rule?'Save changes':'Add automation'}</button></div></form>`;
  const f=$('automationForm');
  f.addEventListener('input',()=>{readAutomationForm();d.actions.forEach((a,i)=>{const o=f.querySelector(`[data-reserve="${i}"]`);if(o)o.textContent=`${a.backup_reserve_percent}%`;});});
  f.addEventListener('change',ev=>{
    readAutomationForm();const n=ev.target.name;
    if(n==='triggerType') {d.trigger={type:ev.target.value};if(d.trigger.type==='schedule')d.actions=d.actions.filter(a=>a.type!=='notification_only');if(!d.actions.length)d.actions=[automationDefaultAction('adjust_backup_reserve')];}
    if(/^action\d+$/.test(n)) d.actions[Number(n.slice(6))]=automationDefaultAction(ev.target.value);
    if(['triggerType','repeating','noEnd','window','blocking','blockCondition'].includes(n)||/^action\d+$/.test(n)) renderAutomationEditor();
  });
  f.querySelector('[data-auto-close]').onclick=()=>{if(!e.saving)$('automationEditor').close();};
  f.querySelectorAll('[data-remove-action]').forEach(b=>b.onclick=()=>{readAutomationForm();d.actions.splice(Number(b.dataset.removeAction),1);renderAutomationEditor();});
  if($('autoAddAction')) $('autoAddAction').onclick=()=>{readAutomationForm();d.actions.push(automationDefaultAction(Object.keys(automationAvailableActions(d))[0]));renderAutomationEditor();};
  if($('autoDelete')) $('autoDelete').onclick=async()=>{
    const button=$('autoDelete');
    if(button.dataset.confirm!=='true'){button.dataset.confirm='true';button.textContent='Confirm delete';showError('automationEditorError','Delete this automation and its future runs? Select Confirm delete to continue.');return;}
    e.saving=true;f.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);
    try{await api(`/v1/web/automations?site_key=${encodeURIComponent(e.siteKey)}&automation_id=${encodeURIComponent(e.rule.id)}`,{method:'DELETE'});if(e.version!==contextVersion)return;$('automationEditor').close();await loadAutomations(e.siteKey);showError('automationsStatus','Automation deleted.');}
    catch(error){if(error.name!=='AbortError')showError($('automationEditor').open?'automationEditorError':'automationsStatus',friendlyError(error));}
    finally{e.saving=false;f.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);}
  };
  f.onsubmit=saveAutomationEditor;
}
function readAutomationForm() {
  const e=automationEditor,d=e.draft,t=d.trigger,f=$('automationForm');
  const val=n=>f.elements.namedItem(n)?.value,checked=n=>Boolean(f.elements.namedItem(n)?.checked),num=n=>Number(val(n));
  d.name=val('name')||'';
  if(t.type==='schedule') {const parts=(val('scheduleTime')||'18:00').split(':').map(Number);t.hour=parts[0];t.minute=parts[1];e.repeating=checked('repeating');if(e.repeating){if(checked('noEnd')) e.repeatUntil=7258118400;else if(val('endDate')){const date=val('endDate').split('-').map(Number);e.repeatUntil=detailMidnight(detailShift(date,'day',1),automationData.timezone)-1;}else if(e.repeatUntil===7258118400)e.repeatUntil=Math.floor(Date.now()/1000)+30*86400;}}
  if(['schedule','event_import_cap'].includes(t.type))t.days=[1,2,3,4,5,6,7].filter(i=>checked(`day${i}`));
  if(['ev','edf_power_perks'].includes(t.type)) t.event=val('event');
  if(['battery','price','power','solar'].includes(t.type))t.condition=val('condition');
  if(t.type==='battery')t.value=num('value');
  if(t.type==='price'){t.source=val('source');t.value=num('value')/100;t.unit=t.unit||`${automationData.capabilities?.currency||'GBP'}_per_kwh`;}
  if(t.type==='power'){t.source=val('source');t.value_kw=num('value');}
  if(t.type==='solar'){t.value_kwh=num('value');t.check_time=val('checkTime');}
  if(t.type==='event_import_cap')Object.assign(t,{event:'power_hour',start:val('start'),end:val('end'),import_cap_kwh:num('cap'),trigger_at_kwh:num('threshold')});
  if(['ev','battery','price','power'].includes(t.type)) {if(checked('window')) t.time_window={enabled:true,start:val('start')||'00:00',end:val('end')||'23:59'};else delete t.time_window;}
  if(t.type==='schedule') d.blocking=checked('blocking')?{condition:val('blockCondition')||'soc_below',value:val('blockValue')==null?50:num('blockValue'),window_minutes:num('blockWindow')||60}:null;
  d.actions.forEach((a,i)=>{
    if(a.type==='adjust_backup_reserve'){const v=num(`reserve${i}`);a.backup_reserve_percent=v===81?100:v;}
    if(a.type==='freeze_battery_soc')a.high_soc_preference=num(`freeze${i}`);
    if(a.type==='tesla_export')a.export_policy=val(`export${i}`);
    if(a.type==='set_op_mode')a.op_mode=val(`mode${i}`);
    if(a.type==='set_grid_charging')a.enabled=val(`grid${i}`)==='true';
    if(a.type==='home_assistant_event'){a.event_name=val(`haEvent${i}`)?.trim().toLowerCase();a.message=val(`haMessage${i}`)?.trim();}
  });
}
function automationSaveBody(e,zone,now=Math.floor(Date.now()/1000)) {
  const d=autoClone(e.draft),t=d.trigger;
  let fire=now,expires=now+5*365*86400,repeat=null;
  if(t.type==='schedule') {fire=automationNextTime(`${String(t.hour).padStart(2,'0')}:${String(t.minute).padStart(2,'0')}`,t.days,zone,now);expires=fire+600;repeat=e.repeating?e.repeatUntil:null;if(repeat!=null && repeat<fire)throw new Error('The end date must include the next scheduled run.');}
  if(t.type==='solar'){fire=automationNextTime(t.check_time,[1,2,3,4,5,6,7],zone,now);expires=fire+600;repeat=7258118400;}
  if(t.type==='battery'){fire=0;expires=0;}
  if(t.type==='event_import_cap'){repeat=7258118400;if(!t.days.length)throw new Error('Choose at least one day.');if(t.trigger_at_kwh>t.import_cap_kwh)throw new Error('The trigger threshold cannot exceed the import cap.');}
  const kinds={ev:'ev_event',battery:'battery_soc',price:'price',power:'power',solar:'solar_forecast',event_import_cap:'power_hour',edf_power_perks:'edf_power_perks'};
  const actions=d.actions.map(a=>{if(a.type==='notification_only')return {type:a.type,notification_kind:kinds[t.type]};const clean={...a};delete clean.trigger;delete clean.name;delete clean.blocking;delete clean.name_is_custom;return clean;});
  const payload={type:'grouped_actions',name:d.name.trim(),name_is_custom:!!d.name.trim(),trigger:t,actions};
  if(t.type==='schedule' && d.blocking)payload.blocking=d.blocking;
  return {site_key:e.siteKey,...(e.rule?{automation_id:e.rule.id}:{}),fire_at:fire,expires_at:expires,repeat_until:repeat,payload};
}
async function saveAutomationEditor(event) {
  event.preventDefault();const e=automationEditor;if(!e||e.saving)return;
  readAutomationForm();let body;
  try{body=automationSaveBody(e,automationData.timezone);}catch(error){showError('automationEditorError',error.message);return;}
  e.saving=true;const form=$('automationForm');form.querySelectorAll('button,input,select').forEach(x=>x.disabled=true);showError('automationEditorError','');
  try{await api('/v1/web/automations/create',{method:'POST',body:JSON.stringify(body)});if(e.version!==contextVersion)return;$('automationEditor').close();await loadAutomations(e.siteKey);showError('automationsStatus','Automation saved.');}
  catch(error){if(error.name!=='AbortError')showError($('automationEditor').open?'automationEditorError':'automationsStatus',friendlyError(error));}
  finally{e.saving=false;if(automationEditor===e)form.querySelectorAll('button,input,select').forEach(x=>x.disabled=false);}
}
function bindAutomationControls(data) {
  automationData=data;
  $('addAutomation').disabled=false;
  $('addAutomation').onclick=()=>openAutomationEditor();
  document.querySelectorAll('[data-auto-edit]').forEach(b=>b.onclick=()=>openAutomationEditor(data.automations.find(r=>String(r.id)===b.dataset.autoEdit)));
  document.querySelectorAll('[data-auto-pause]').forEach(b=>b.onclick=async()=>{
    const rule=data.automations.find(r=>String(r.id)===b.dataset.autoPause);b.disabled=true;
    try{await api('/v1/web/automations/pause',{method:'POST',body:JSON.stringify({site_key:data.site_key,automation_id:rule.id,paused:!rule.paused})});await loadAutomations(data.site_key);showError('automationsStatus',rule.paused?'Automation resumed.':'Automation paused.');}
    catch(error){if(error.name!=='AbortError')showError('automationsStatus',friendlyError(error));}finally{b.disabled=false;}
  });
}
document.addEventListener('DOMContentLoaded',()=>{
  $('automationEditor').addEventListener('cancel',event=>{if(automationEditor?.saving)event.preventDefault();});
});
