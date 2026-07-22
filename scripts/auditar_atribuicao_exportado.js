#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const sourcePath = process.argv[2] || path.join(__dirname, '..', 'data', 'lancamentos_produtos_dia.json');

function toNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : 0;
}

function pct(value) {
  return Math.round(value * 10000) / 100;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}

function normalize(value) {
  return String(value || '').trim();
}

function orderKey(row) {
  return normalize(row.order_sk || row.source_order_id || row.order_name);
}

function readRows(filePath) {
  const payload = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload.rows)) return payload.rows;
  throw new Error(`Formato inesperado em ${filePath}: esperado array ou objeto com rows.`);
}

function emptyGroup(row) {
  return {
    modelo_id: row.modelo_id || null,
    modelo: row.modelo || row.modelo_id || null,
    d0: row.d0 || null,
    linhas_produto: 0,
    pedidos_aprovados: new Set(),
    pedidos_com_atribuicao: new Set(),
    pedidos_pagos: new Set(),
    pedidos_organicos: new Set(),
    pedidos_direct_unknown: new Set(),
    pedidos_sem_atribuicao: new Set(),
    receita_aprovada: 0,
    receita_paga: 0,
    receita_organica: 0,
    receita_direct_unknown: 0,
    receita_sem_atribuicao: 0,
    receita_paga_campo: 0,
    receita_organica_campo: 0,
    regras_atribuicao: new Set()
  };
}

function summarize(rows) {
  const groups = new Map();

  rows.forEach(row => {
    const modeloId = normalize(row.modelo_id) || 'sem_modelo';
    if (!groups.has(modeloId)) groups.set(modeloId, emptyGroup(row));

    const group = groups.get(modeloId);
    const pedido = orderKey(row);
    const tipo = normalize(row.tipo_real).toLowerCase();
    const receita = toNumber(row.receita_bruta ?? row.receita);

    group.linhas_produto += 1;
    group.receita_aprovada += receita;
    group.receita_paga_campo += toNumber(row.receita_paga);
    group.receita_organica_campo += toNumber(row.receita_organica);
    if (row.d0 && (!group.d0 || row.d0 < group.d0)) group.d0 = row.d0;
    if (row.regra_atribuicao_real) group.regras_atribuicao.add(row.regra_atribuicao_real);
    if (pedido) group.pedidos_aprovados.add(pedido);

    if (tipo) {
      if (pedido) group.pedidos_com_atribuicao.add(pedido);
      if (tipo === 'paid') {
        group.receita_paga += receita;
        if (pedido) group.pedidos_pagos.add(pedido);
      } else if (tipo === 'organic') {
        group.receita_organica += receita;
        if (pedido) group.pedidos_organicos.add(pedido);
      } else {
        group.receita_direct_unknown += receita;
        if (pedido) group.pedidos_direct_unknown.add(pedido);
      }
    } else {
      group.receita_sem_atribuicao += receita;
      if (pedido) group.pedidos_sem_atribuicao.add(pedido);
    }
  });

  return Array.from(groups.values())
    .sort((a, b) => String(a.d0 || '').localeCompare(String(b.d0 || '')) || String(a.modelo_id).localeCompare(String(b.modelo_id)))
    .map(group => {
      const pedidosAprovados = group.pedidos_aprovados.size;
      const receitaPartes = group.receita_paga + group.receita_organica + group.receita_direct_unknown + group.receita_sem_atribuicao;
      return {
        modelo_id: group.modelo_id,
        modelo: group.modelo,
        d0: group.d0,
        linhas_produto: group.linhas_produto,
        pedidos_aprovados: pedidosAprovados,
        pedidos_com_atribuicao: group.pedidos_com_atribuicao.size,
        cobertura_atribuicao_pct: pedidosAprovados ? pct(group.pedidos_com_atribuicao.size / pedidosAprovados) : null,
        pedidos_pagos: group.pedidos_pagos.size,
        pedidos_organicos: group.pedidos_organicos.size,
        pedidos_direct_unknown: group.pedidos_direct_unknown.size,
        pedidos_sem_atribuicao: group.pedidos_sem_atribuicao.size,
        receita_aprovada: roundMoney(group.receita_aprovada),
        receita_paga: roundMoney(group.receita_paga),
        receita_organica: roundMoney(group.receita_organica),
        receita_direct_unknown: roundMoney(group.receita_direct_unknown),
        receita_sem_atribuicao: roundMoney(group.receita_sem_atribuicao),
        receita_paga_campo: roundMoney(group.receita_paga_campo),
        receita_organica_campo: roundMoney(group.receita_organica_campo),
        reconciliacao_receita_ok: Math.abs(group.receita_aprovada - receitaPartes) < 0.05,
        regras_atribuicao: Array.from(group.regras_atribuicao).sort()
      };
    });
}

const rows = readRows(sourcePath);
const result = {
  generated_at: new Date().toISOString(),
  source: path.resolve(sourcePath),
  rows: rows.length,
  modelos: summarize(rows)
};

console.log(JSON.stringify(result, null, 2));
