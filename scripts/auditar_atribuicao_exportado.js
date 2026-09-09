#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const Rules = require('../assets/launch-metrics');
const source = process.argv[2] || path.join(__dirname,'..','data','lancamentos_produtos_dia.json');
function summarize(rows) {
  return [...new Set(rows.map(r=>r.modelo_id))].map(modelo_id => {
    const group=rows.filter(r=>r.modelo_id===modelo_id), buckets=Rules.channels(group);
    const ids=new Set(group.map(r=>r.order_sk).filter(Boolean));
    const identified=new Set(group.filter(r=>Rules.channelType(r)!=='unmatched').map(r=>r.order_sk).filter(Boolean));
    const receita=group.reduce((s,r)=>s+Number(r.receita_bruta??r.receita??0),0);
    const sumOrders=Object.values(buckets).reduce((s,b)=>s+b.pedidos,0);
    const sumRevenue=Object.values(buckets).reduce((s,b)=>s+b.receita,0);
    return { modelo_id, linhas_produto:group.length, pedidos_aprovados:ids.size, receita_aprovada:receita,
      pedidos_com_atribuicao:identified.size, cobertura_atribuicao_pct:ids.size?Math.round(10000*identified.size/ids.size)/100:null,
      pedidos_pagos:buckets.paid.pedidos,pedidos_organicos:buckets.organic.pedidos,pedidos_crm:buckets.crm.pedidos,pedidos_outros:buckets.other.pedidos,pedidos_sem_atribuicao:buckets.unmatched.pedidos,
      receita_paga:buckets.paid.receita,receita_organica:buckets.organic.receita,receita_crm:buckets.crm.receita,receita_outros:buckets.other.receita,receita_sem_atribuicao:buckets.unmatched.receita,
      reconciliacao_pedidos_ok:sumOrders===ids.size,reconciliacao_receita_ok:Math.abs(receita-sumRevenue)<.01 };
  });
}
if(require.main===module) {
 const payload=JSON.parse(fs.readFileSync(source,'utf8')); const rows=Array.isArray(payload)?payload:payload.rows;
 const modelos=summarize(rows);const ok=modelos.every(m=>m.reconciliacao_pedidos_ok&&m.reconciliacao_receita_ok);
 console.log(JSON.stringify({ok,rows:rows.length,modelos,observacao:'Conciliação não valida a origem: sem atribuição permanece separado; classificação de canal não prova causalidade.'},null,2));
 if(!ok)process.exitCode=1;
}
module.exports={summarize};
