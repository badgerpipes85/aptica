const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const path=require('node:path');
const context=vm.createContext({Intl,Date,console,document:{addEventListener(){}},currentOverview:{tesla_settings:{export_rule:'pv_only'}},escapeHtml:value=>String(value??'')});
vm.runInContext(fs.readFileSync(path.join(__dirname,'../automations.js'),'utf8'),context);
const plain=x=>JSON.parse(JSON.stringify(x));
test('iOS pausing rules exclude one-off schedules and Power Hour',()=>{for(const type of ['ev','battery','price','power','solar','edf_power_perks'])assert.equal(context.automationPausable({payload:{trigger:{type}}}),true);assert.equal(context.automationPausable({payload:{trigger:{type:'schedule'}},repeat_until:null}),false);assert.equal(context.automationPausable({payload:{trigger:{type:'schedule'}},repeat_until:7258118400}),true);assert.equal(context.automationPausable({payload:{trigger:{type:'event_import_cap'}}}),false);});
test('next schedule follows site time and weekday across daylight-saving changes',()=>{const run=(now,time,days)=>new Date(context.automationNextTime(time,days,'Europe/London',Date.parse(now)/1000)*1000).toISOString();assert.equal(run('2026-09-27T08:00:00Z','18:30',[1]),'2026-09-27T17:30:00.000Z');assert.equal(run('2026-03-28T23:00:00Z','02:30',[1]),'2026-03-29T01:30:00.000Z');assert.equal(run('2026-10-24T23:00:00Z','02:30',[1]),'2026-10-25T02:30:00.000Z');assert.throws(()=>run('2026-09-27T08:00:00Z','18:30',[]),/Choose/);});
test('edit keeps ID, grouped actions, windows and trigger values',()=>{const e={siteKey:'site',rule:{id:'original',paused:true},draft:{name:'Reserve',trigger:{type:'price',source:'import',condition:'below',value:.123,unit:'GBP_per_kwh',time_window:{enabled:true,start:'23:00',end:'05:00'}},actions:[{type:'adjust_backup_reserve',backup_reserve_percent:100},{type:'home_assistant_event',event_name:'reserve_change',message:'Ready'}]}};const result=plain(context.automationSaveBody(e,'Europe/London',1790496000));assert.equal(result.automation_id,'original');assert.deepEqual(result.payload.trigger,e.draft.trigger);assert.deepEqual(result.payload.actions,e.draft.actions);assert.equal(result.repeat_until,null);assert.equal(result.paused,undefined);});
test('notification kind follows the selected trigger and expired repeats are rejected',()=>{const e={siteKey:'site',draft:{name:'',trigger:{type:'edf_power_perks',event:'starts'},actions:[{type:'notification_only',notification_kind:'battery_soc'}]}};assert.equal(context.automationSaveBody(e,'Europe/London').payload.actions[0].notification_kind,'edf_power_perks');e.draft.trigger={type:'schedule',hour:18,minute:0,days:[1,2,3,4,5,6,7]};e.repeating=true;e.repeatUntil=1;assert.throws(()=>context.automationSaveBody(e,'Europe/London'),/end date/);});
test('mutually exclusive actions and four-action limit use iOS choices',()=>{const options=plain(context.automationAvailableActions({trigger:{type:'battery'},actions:[{type:'adjust_backup_reserve'}]}));assert.equal(options.adjust_backup_reserve,undefined);assert.equal(options.freeze_battery_soc,undefined);assert.equal(options.notification_only,undefined);assert.ok(options.set_op_mode);assert.equal(context.automationAvailableActions({trigger:{type:'schedule'},actions:[]}).notification_only,undefined);});

test('Power Hour requires Octopus capability and measurable charger',()=>{assert.equal(context.automationPowerHourAvailable({power_hour:true}),true);for(const capabilities of [{},{power_hour:false},{power_hour:true,ev_charger_type:'otherBlind'},{power_hour:true,ev_charger_type:'other_blind'}])assert.equal(context.automationPowerHourAvailable(capabilities),false);});
test('Power Perks card is exclusive to registered EDF capability data',()=>{assert.equal(context.powerPerksAutomationCard({power_perks:null}), '');const html=context.powerPerksAutomationCard({power_perks:{enabled:true,trigger_home_assistant:true,fallback_backup_reserve_percent:10},capabilities:{home_assistant:true}});assert.match(html,/Power Perks Action/);assert.match(html,/powerPerksEnabled/);assert.match(html,/checked/);assert.match(html,/powerPerksHA/);});

test('re-use copies historical settings into a new draft and requires review',()=>{
  const run={id:'history-id',automation_id:'original',type:'grouped_actions',payload:{type:'grouped_actions',name:'Evening export',trigger:{type:'schedule',hour:18,minute:30,days:[2,3]},blocking:{condition:'soc_below',value:40},actions:[{type:'tesla_export',export_policy:'battery_ok'},{type:'set_op_mode',op_mode:'autonomous'}]}};
  const original=JSON.stringify(run);
  const e=context.automationReuseEditor(run,{site_key:'site',capabilities:{}},7);
  assert.equal(e.rule,null);assert.equal(e.repeating,false);
  assert.throws(()=>context.automationSaveBody(e,'Europe/London'),/Review/);
  e.reuseReviewed=true;
  const body=plain(context.automationSaveBody(e,'Europe/London',1790496000));
  assert.equal(body.automation_id,undefined);assert.equal(body.repeat_until,null);
  assert.ok(body.fire_at>1790496000);
  assert.deepEqual(body.payload.actions,run.payload.actions);
  assert.deepEqual(body.payload.blocking,run.payload.blocking);
  e.draft.actions[0].export_policy='pv_only';assert.equal(JSON.stringify(run),original);
});
test('re-use rejects managed, incomplete and unavailable history',()=>{
  const base={type:'grouped_actions',payload:{type:'grouped_actions',trigger:{type:'schedule',hour:18,minute:0,days:[1]},actions:[{type:'set_op_mode',op_mode:'autonomous'}]}};
  for(const extra of [{system:'mappy'},{iog:{enabled:true}},{power_perks:{managed:true}},{actions:[]},{actions:[{type:'restore_previous'}]},{trigger:{type:'unknown'}}])assert.equal(context.automationReusable({...base,payload:{...base.payload,...extra}}),false);
  assert.equal(context.automationReusable({type:'accepted_mappy_export',payload:base.payload}),false);
  const hour={...base,payload:{...base.payload,trigger:{type:'event_import_cap'}}};
  assert.equal(context.automationReusable(hour,{power_hour:false}),false);
});

test('missing action values are not silently defaulted when re-used',()=>{
  for(const type of ['adjust_backup_reserve','freeze_battery_soc','tesla_export','set_op_mode','set_grid_charging','home_assistant_event']) {
    assert.equal(context.automationReusable({type:'grouped_actions',payload:{trigger:{type:'schedule'},actions:[{type}]}}),false);
  }
});
test('legacy mobile schedules recover the time using the site timezone',()=>{
  const run={type:'grouped_actions',executed_at:Date.parse('2026-09-28T17:30:00Z')/1000,payload:{trigger:{type:'schedule',days:[2]},actions:[{type:'set_grid_charging',enabled:false}]}};
  const e=context.automationReuseEditor(run,{site_key:'site',timezone:'Europe/London'},1);
  assert.equal(e.draft.trigger.hour,18);assert.equal(e.draft.trigger.minute,30);
  assert.equal(run.payload.trigger.hour,undefined);
});
