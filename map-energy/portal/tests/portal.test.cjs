// Run with: node --test map-energy/portal/tests/portal.test.cjs
const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const path=require('node:path');
function portal(){
  const context=vm.createContext({
    URLSearchParams, Intl, Date, DOMException,
    window:{location:{search:''}}, sessionStorage:{getItem:()=>null},
    document:{addEventListener:()=>{},getElementById:()=>null}
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../portal.js'),'utf8'),context);
  return context;
}
test('missing readings remain unavailable, while genuine zero remains zero',()=>{
 const p=portal();
 for(const name of ['fmtKw','fmtKwh','fmtKwhNumber','fmtNodeKw','fmtRate','fmtMoney']){
   assert.equal(p[name](null),'--',name);
   assert.equal(p[name](undefined),'--',name);
   assert.equal(p[name](''),'--',name);
   assert.notEqual(p[name](0),'--',name);
 }
 assert.equal(Number.isNaN(p.nodeValue({battery_soc:null},'battery')),true);
 assert.equal(p.nodeValue({import_kwh:.2,export_kwh:.5},'grid'),-.3);
});
test('Home Assistant and restore reserve actions have useful descriptions',()=>{
 const p=portal();
 assert.equal(p.actionText({type:'home_assistant_event'}),'Send a Home Assistant event');
 assert.equal(p.actionText({type:'restore_backup_reserve'}),'Restore previous backup reserve');
});
test('responses started for an old site are rejected before rendering',async()=>{
 const p=portal();let finish;
 p.fetch=()=>new Promise(resolve=>{finish=resolve});
 const pending=p.api('/v1/web/history?site_key=old');
 vm.runInContext('contextVersion++',p);
 finish({ok:true,json:async()=>({site_key:'old'})});
 await assert.rejects(pending,{name:'AbortError'});
});
test('zero-power energy flow has no animated paths',()=>{
 const p=portal(); assert.equal(p.allocateLiveFlows({}).size,0);
 const flows=p.allocateLiveFlows({solar_kw:4,home_kw:1,ev_kw:0,grid_kw:-1,battery_kw:-2});
 assert.equal(flows.get('solar:home'),1);
 assert.equal(flows.get('solar:battery'),2);
 assert.equal(flows.get('solar:grid'),1);
});
test('today totals always show one decimal place, including zero and whole numbers',()=>{
 const p=portal();
 for(const [value,expected] of [[0,'0.0'],[1,'1.0'],[12.36,'12.4'],[null,'--']]) assert.equal(p.fmtKwhNumber(value),expected);
});
test('Powerwall editors accept known settings and preserve export aliases',()=>{
 const p=portal();
 assert.equal(p.settingValue('backup',{backup_reserve_percent:0}),0);
 assert.equal(p.settingValue('backup',{backup_reserve_percent:100}),100);
 for(const value of [null,'',-1,101,'invalid']) assert.equal(p.settingValue('backup',{backup_reserve_percent:value}),null);
 assert.equal(p.settingValue('export',{export_rule:'no_export'}),'never');
 assert.equal(p.settingValue('mode',{operation_mode:'autonomous'}),'autonomous');
 assert.equal(p.settingValue('mode',{operation_mode:'unknown'}),null);
});
