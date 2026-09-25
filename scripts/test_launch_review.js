const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const Rules = require('../assets/launch-metrics');
const {aggregateSales, investmentForWindow, mergeClientMetrics} = require('./gerar_lancamentos_analise_avancada');
const read = name => JSON.parse(fs.readFileSync(require('path').join(__dirname,'..','data',name+'.json'),'utf8'));
test('two items in one order count as one order within a channel',()=>{
 const rows=['A','B'].map(sku=>({sku,order_sk:'one',tipo_real:'paid',receita:10,pares:1,pedidos:1}));
 const data=aggregateSales(rows);assert.equal(data.pedidos,1);assert.equal(data.canais.paid.pedidos,1);assert.equal(data.canais.paid.receita,20);
});
test('unmatched, CRM and other never become organic',()=>{
 const rows=['unmatched','crm','other','organic'].map((tipo_real,i)=>({tipo_real,order_sk:String(i),receita:10,pedidos:1}));
 const data=aggregateSales(rows);assert.equal(data.canais.organic.receita,10);assert.equal(data.canais.pending.receita,10);assert.equal(data.canais.crm.pedidos,1);assert.equal(data.canais.other.pedidos,1);
});
test('a 30-day campaign is not booked in full into D+7',()=>{
 const data=investmentForWindow({modelo_id:'a',day_zero_base:'2026-01-01'},'7d',[{modelo_id:'a',janela:'30d',data_inicio:'2026-01-01',data_fim:'2026-01-31',investimento:300}],[]);
 assert.equal(data.midia_paga,null);assert.equal(data.total,null);
});
test('only exact, scope-validated disjoint channel totals can form spend',()=>{
 const model={modelo_id:'a',day_zero_base:'2026-01-01'};
 const row={modelo_id:'a',janela:'7d',data_inicio:'2026-01-01',data_fim:'2026-01-08',investimento:80,escopo_investimento_validado:true,canal:'Meta'};
 assert.equal(investmentForWindow(model,'7d',[row],[]).midia_paga,80);
 assert.equal(investmentForWindow(model,'7d',[row,{...row}],[]).midia_paga,null);
});
test('open client windows preserve unknown activation',()=>{
 const data=mergeClientMetrics(null,{status:'janela_aberta',base_total_d0:100,clientes_base_compraram:null,pct_base_ativada:null});
 assert.equal(data.pct_base_ativada,null);assert.equal(data.clientes_unicos,null);
});
test('derived data is tied to every current input and the rule version',()=>{
 const data=Object.fromEntries(Rules.SOURCES.map(k=>[k,read(k)]));data.lancamentos_analise_avancada=read('lancamentos_analise_avancada');
 assert.equal(Rules.derivedMatches(data),true);data.midia_paga=[...data.midia_paga,{investimento:1}];assert.equal(Rules.derivedMatches(data),false);
});
test('actual closed windows reconcile all five channels and distinct orders',()=>{
 const rows=read('lancamentos_produtos_dia');
 for(const m of read('lancamentos_modelos')) for(const end of [7,15,30,60,90]) {
  const sample=rows.filter(r=>r.modelo_id===m.modelo_id&&r.dia_desde_d0<=end);if(!sample.length)continue;
  const data=aggregateSales(sample);assert.equal(data.pedidos,new Set(sample.map(r=>r.order_sk)).size);
  const buckets=Object.values(data.canais);assert.equal(buckets.reduce((s,x)=>s+(x.pedidos||0),0),data.pedidos,m.modelo_id+' D+'+end);
  assert.ok(Math.abs(buckets.reduce((s,x)=>s+(x.receita||0),0)-data.receita)<.01);
 }
});
test('suspect repeated keys are reported without deleting sales',()=>{
 const row={modelo_id:'a',data:'2026-01-01',order_sk:'one',sku:'A'};
 const data={lancamentos_modelos:[],lancamentos_produtos_dia:[row,{...row,nome_produto:'other title'},{...row,sku:'B'}]};
 const result=Rules.audit(data);assert.deepEqual(result.repeated_keys_by_model,{a:1});assert.equal(data.lancamentos_produtos_dia.length,3);
});
test('Apps Script attribution coverage excludes unknown revenue and orders',()=>{
 const vm=require('vm');const source=fs.readFileSync(require('path').join(__dirname,'..','apps_script','ExportLaunchAnalysis.gs'),'utf8');
 const start=source.indexOf('function auditarAtribuicaoCanal_(rows) {');const end=source.indexOf('\nfunction logAtribuicaoCanalPorModelo_',start);
 const context={CONFIG:{canalAttributionEnabled:true},numberOrNull_:Rules.number,round2_:v=>Math.round(v*100)/100,round6_:v=>Math.round(v*1e6)/1e6,tipoCanalPedidoRow_:Rules.channelType};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const rows=[{modelo_id:'a',order_sk:'1',tipo_real:'unmatched',receita:100,receita_sem_match_atribuicao:100,pedidos_sem_match_atribuicao:1},{modelo_id:'a',order_sk:'2',tipo_real:'paid',receita:100,receita_paga:100,pedidos_pagos:1}];
 const result=context.auditarAtribuicaoCanal_(rows);assert.equal(result.pedidos_classificados,1);assert.equal(result.cobertura_pedidos_pct,.5);assert.equal(result.cobertura_receita_pct,.5);
});
test('Apps Script attribution refresh limits the main export to the recent lookback',()=>{
 const vm=require('vm');const source=fs.readFileSync(require('path').join(__dirname,'..','apps_script','ExportLaunchAnalysis.gs'),'utf8');
 const start=source.indexOf('function canalAtribuicaoMirrorRefreshBounds_(bounds) {');const end=source.indexOf('\nfunction sincronizarCanalAtribuicaoMirrorSePossivel_',start);
 const context={CONFIG:{canalAttributionLookbackDays:14},addDaysIso_:(value,days)=>{const d=new Date(value+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}};
 vm.createContext(context);vm.runInContext(source.slice(start,end),context);
 const result=context.canalAtribuicaoMirrorRefreshBounds_({minDate:'2024-10-18',maxDate:'2026-09-25',windows:[{modeloId:'old',minDate:'2024-10-18',maxDate:'2026-09-25'},{modeloId:'new',minDate:'2026-09-20',maxDate:'2026-09-25'}]});
 assert.equal(result.minDate,'2026-09-12');assert.equal(result.maxDate,'2026-09-25');assert.equal(result.lookbackDays,14);assert.equal(result.windows[0].minDate,'2026-09-12');assert.equal(result.windows[1].minDate,'2026-09-20');
});
test('live stability advances with the manifest cutoff and extended ramp',()=>{
 const launch={launch_id:'test',analytical_d0:'2026-01-01',comparability:'comparavel'};
 const rows=Array.from({length:5},(_,index)=>({modelo_id:'test',dia_desde_d0:index*7,receita_bruta:7000,pares:7,pedidos:7}));
 const candidate=Rules.stabilityEvents([launch],rows,'2026-01-21')[0];
 const confirmed=Rules.stabilityEvents([launch],rows,'2026-02-04')[0];
 assert.equal(candidate.complete_weeks,3);assert.equal(candidate.operational.state,'sinal_candidato');
 assert.equal(confirmed.complete_weeks,5);assert.equal(confirmed.operational.state,'sinal_confirmado');assert.equal(confirmed.operational.signal.confirmed_week,5);
});
test('generated stability uses the extended ramp instead of the D0-D90 product extract',()=>{
 const contract=read('launch_analysis_contract');const ramp=read('lancamentos_rampa_dia');const manifest=read('manifest');
 const launches=contract.launch_registry.filter(item=>item.commercial_status!=='planejado');
 const live=Rules.stabilityEvents(launches,ramp,manifest.generated_at);
 const gt=live.find(item=>item.launch_id==='gt');const avant=live.find(item=>item.launch_id==='avant');
 assert.equal(gt.complete_weeks,40);assert.notEqual(gt.operational.state,'sem_sinal_ate_o_corte');
 assert.equal(avant.complete_weeks,40);assert.notEqual(avant.operational.state,'sem_sinal_ate_o_corte');
});
test('daily revenue ramp remains cumulative through the latest observed day',()=>{
 const result=Rules.cumulativeRevenueSeries([{launch_id:'a'}],[{modelo_id:'a',dia_desde_d0:1,receita_bruta:20},{modelo_id:'a',dia_desde_d0:0,receita_bruta:10}]);
 assert.deepEqual(result[0].points,[{day:0,value:10},{day:1,value:30}]);
});
test('RPS context uses weighted RPS and preserves missing investment',()=>{
 const launch={launch_id:'a'};
 const rps={pontos:[
  {dias_desde_lancamento:0,data_calendario:'2026-01-01',receita_total:100,sessoes:100},
  {dias_desde_lancamento:1,data_calendario:'2026-01-02',receita_total:300,sessoes:100}
 ]};
 const result=Rules.rpsContextSeries(launch,rps,[],7);
 assert.equal(result.baseline.rps,2);assert.equal(result.points[0].rps_index,50);assert.equal(result.points[1].rps_index,100);
 assert.equal(result.baseline.investment,null);assert.equal(result.points[1].investment_index,null);assert.equal(result.investment_source,'missing');
});
test('every dashboard view exposes a visible help control with its purpose',()=>{
 const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
 assert.equal((html.match(/class="view-info"/g)||[]).length,6);
 assert.equal((html.match(/aria-label="O que a visão/g)||[]).length,6);
 for(const term of ['força inicial','ganhou ou perdeu ritmo','momento da trajetória','ritmo sustentável','fatores externos','faixa futura']) assert.ok(html.includes(term),term);
});
test('simplified dashboard includes full revenue ramp and all-launch RPS context',()=>{
 const html=fs.readFileSync(require('path').join(__dirname,'..','index.html'),'utf8');
 const script=fs.readFileSync(require('path').join(__dirname,'..','assets','overview.js'),'utf8');
 assert.ok(html.includes('Rampa de faturamento'));assert.ok(html.includes('id="rps-context-grid"'));
 assert.ok(script.includes("fetchJson('data/lancamentos_rps_dia.json')"));assert.ok(script.includes("fetchJson('data/metas_mensais.json')"));
 assert.ok(script.includes('Rules.cumulativeRevenueSeries'));assert.ok(script.includes('Rules.rpsContextSeries'));
});
