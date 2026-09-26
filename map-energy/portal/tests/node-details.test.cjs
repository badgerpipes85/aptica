const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
function load(){const p=vm.createContext({Intl,Date,document:{addEventListener(){}}});vm.runInContext(fs.readFileSync(path.join(__dirname,'../node-details.js'),'utf8'),p);return p;}
test('site-local periods respect DST, month/year boundaries and extreme timezones',()=>{
 const p=load(),zone='Europe/London';
 const spring=p.detailBounds([2026,3,29],'day',zone),fall=p.detailBounds([2026,10,25],'day',zone);
 assert.equal(spring[1]-spring[0],23*3600);assert.equal(fall[1]-fall[0],25*3600);
 assert.equal(new Date(p.detailBounds([2026,9,26],'month',zone)[1]*1000).toISOString(),'2026-09-30T23:00:00.000Z');
 for(const zone of ['Pacific/Kiritimati','America/Los_Angeles','Australia/Sydney']) assert.equal(p.detailDate(p.detailMidnight([2026,9,26],zone),zone).join('-'),'2026-9-26');
 assert.equal(p.detailShift([2026,1,31],'month',1).join('-'),'2026-2-1');
});
test('iOS energy mapping preserves explicit zero and fallback import/export fields',()=>{
 const p=load();assert.equal(p.detailEnergy({total_solar_generation:0,solar_energy_exported:999},'solar').a,0);
 assert.equal(p.detailEnergy({consumer_energy_imported_from_grid:100,consumer_energy_imported_from_solar:200},'home').a,300);
 const grid=p.detailEnergy({grid_energy_wh:-300},'grid');assert.equal(grid.a,0);assert.equal(grid.b,300);
 assert.equal(p.detailEnergy({battery_energy_imported_from_grid:100,battery_energy_charged_from_grid:200},'battery').a,200);
});
test('day power uses sample duration and month/year totals use site-local calendar buckets',()=>{
 const p=load(),t=Date.parse('2026-09-01T23:00:00Z')/1000;
 const data={response:{time_series:[{timestamp:new Date(t*1000).toISOString(),total_solar_generation:100},{timestamp:new Date((t+600)*1000).toISOString(),total_solar_generation:200}]}};
 const day=p.detailPoints(data,'solar','day','Europe/London',t,t+86400);assert.ok(Math.abs(day[0].value-.6)<1e-10);assert.ok(Math.abs(day[1].value-2.4)<1e-10);
 const month=p.detailPoints(data,'solar','month','Europe/London',t,t+86400);assert.equal(month.length,1);assert.ok(Math.abs(month[0].a-.3)<1e-10);
 const year=p.detailPoints(data,'solar','year','Europe/London',t,t+86400);assert.equal(p.detailDate(year[0].t,'Europe/London').join('-'),'2026-9-1');
});
test('battery reconstruction is bounded and ends at the live/derived SOC anchor',()=>{
 const p=load(),rows=[{t:100,battery_energy_charged:1350},{t:400,battery_energy_discharged:675}];
 const result=p.detailSOC(rows,500,55,13.5);assert.ok(Math.abs(result[0].value-60)<1e-6);assert.equal(result.at(-1).value,55);
 assert.ok(p.detailSOC(rows,500,100,13.5).every(p=>p.value>=0&&p.value<=100));
});
test('EV integration caps gaps at ten minutes and does not fabricate final interval energy',()=>{
 const p=load();assert.equal(p.detailEVEnergy([{t:0,value:6},{t:3600,value:7}]),1);assert.equal(p.detailEVEnergy([{t:0,value:6}]),0);assert.equal(vm.runInContext("detailNumber(null)",p),null);
});
