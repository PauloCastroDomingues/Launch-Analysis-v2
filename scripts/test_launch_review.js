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
