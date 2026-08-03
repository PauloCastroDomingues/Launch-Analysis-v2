#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');

function readJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function dataJson(name, fallback) {
  return readJson(path.join(dataDir, name), fallback);
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function pct(part, total) {
  return total ? round(part / total, 6) : null;
}

function orderKey(row) {
  return String(row.order_sk || `${row.modelo_id || ''}|${row.data || ''}|${row.sku || ''}|${row.nome_produto || ''}`);
}

function addOrder(set, key) {
  if (key) set.add(key);
}

function emptyBucket(modeloId) {
  return {
    modelo_id: modeloId,
    orders: new Set(),
    classified: new Set(),
    paid: new Set(),
    organic: new Set(),
    crm: new Set(),
    other: new Set(),
    receita_total: 0,
    receita_classificada: 0,
    receita_paga_tipo: 0,
    receita_organica_tipo: 0,
    receita_crm_tipo: 0,
    receita_outros_tipo: 0,
    receita_paga_campo: 0,
    receita_organica_campo: 0,
    receita_crm_campo: 0
  };
}

function addToBucket(bucket, row) {
  const key = orderKey(row);
  const tipo = String(row.tipo_real || '').trim().toLowerCase();
  const receita = numberOrNull(row.receita_bruta) ?? numberOrNull(row.receita) ?? 0;
  const receitaPagaCampo = numberOrNull(row.receita_paga);
  const receitaOrganicaCampo = numberOrNull(row.receita_organica);
  const receitaCrmCampo = numberOrNull(row.receita_crm);

  addOrder(bucket.orders, key);
  bucket.receita_total += receita;
  if (receitaPagaCampo !== null) bucket.receita_paga_campo += receitaPagaCampo;
  if (receitaOrganicaCampo !== null) bucket.receita_organica_campo += receitaOrganicaCampo;
  if (receitaCrmCampo !== null) bucket.receita_crm_campo += receitaCrmCampo;

  if (!tipo) return;
  addOrder(bucket.classified, key);
  bucket.receita_classificada += receita;
  if (tipo === 'paid') {
    addOrder(bucket.paid, key);
    bucket.receita_paga_tipo += receita;
  } else if (tipo === 'organic') {
    addOrder(bucket.organic, key);
    bucket.receita_organica_tipo += receita;
  } else if (tipo === 'owned' || tipo === 'crm') {
    addOrder(bucket.crm, key);
    bucket.receita_crm_tipo += receita;
  } else {
    addOrder(bucket.other, key);
    bucket.receita_outros_tipo += receita;
  }
}

function summarizeBucket(bucket) {
  return {
    modelo_id: bucket.modelo_id,
    pedidos_total: bucket.orders.size,
    pedidos_classificados: bucket.classified.size,
    cobertura_pedidos_pct: pct(bucket.classified.size, bucket.orders.size),
    pedidos_pagos: bucket.paid.size,
    pedidos_organicos: bucket.organic.size,
    pedidos_crm: bucket.crm.size,
    pedidos_outros_canais: bucket.other.size,
    receita_total: round(bucket.receita_total),
    receita_classificada: round(bucket.receita_classificada),
    cobertura_receita_pct: pct(bucket.receita_classificada, bucket.receita_total),
    receita_paga_por_tipo: round(bucket.receita_paga_tipo),
    receita_organica_por_tipo: round(bucket.receita_organica_tipo),
    receita_crm_por_tipo: round(bucket.receita_crm_tipo),
    receita_outros_canais: round(bucket.receita_outros_tipo),
    receita_paga_no_campo: round(bucket.receita_paga_campo),
    receita_organica_no_campo: round(bucket.receita_organica_campo),
    receita_crm_no_campo: round(bucket.receita_crm_campo),
    diff_receita_paga_campo_vs_tipo: round(bucket.receita_paga_campo - bucket.receita_paga_tipo),
    diff_receita_organica_campo_vs_tipo: round(bucket.receita_organica_campo - bucket.receita_organica_tipo),
    diff_receita_crm_campo_vs_tipo: round(bucket.receita_crm_campo - bucket.receita_crm_tipo)
  };
}

function auditRows(rows) {
  const total = emptyBucket('total');
  const byModel = new Map();

  rows.forEach((row) => {
    const modeloId = String(row.modelo_id || 'sem_modelo').trim() || 'sem_modelo';
    if (!byModel.has(modeloId)) byModel.set(modeloId, emptyBucket(modeloId));
    addToBucket(total, row);
    addToBucket(byModel.get(modeloId), row);
  });

  return {
    total: summarizeBucket(total),
    por_modelo: [...byModel.values()]
      .map(summarizeBucket)
      .sort((a, b) => a.modelo_id.localeCompare(b.modelo_id))
  };
}

function parseArgs() {
  const args = process.argv.slice(2);
  const result = {};
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--baseline') {
      result.baseline = args[i + 1];
      i += 1;
    }
  }
  return result;
}

const args = parseArgs();
const rows = dataJson('lancamentos_produtos_dia.json', []);
const audit = auditRows(Array.isArray(rows) ? rows : []);
const issues = [];
const warnings = [];

if (!rows.length) {
  issues.push('lancamentos_produtos_dia.json nao tem linhas.');
}
if (audit.total.pedidos_total && !audit.total.pedidos_classificados) {
  issues.push('Nenhum pedido veio com tipo_real; a mirror ainda nao alimentou canal real.');
}
if (audit.total.cobertura_pedidos_pct !== null && audit.total.cobertura_pedidos_pct < 0.8) {
  warnings.push('Cobertura de tipo_real abaixo de 80%; leitura por canal deve ser tratada como parcial.');
}
if (Math.abs(audit.total.diff_receita_paga_campo_vs_tipo || 0) > 0.01) {
  issues.push('receita_paga no campo nao bate com a soma das linhas tipo_real=paid.');
}
if (Math.abs(audit.total.diff_receita_organica_campo_vs_tipo || 0) > 0.01) {
  issues.push('receita_organica no campo nao bate com a soma das linhas tipo_real=organic.');
}
if (Math.abs(audit.total.diff_receita_crm_campo_vs_tipo || 0) > 0.01) {
  issues.push('receita_crm no campo nao bate com a soma das linhas tipo_real=owned.');
}

let baseline = null;
if (args.baseline) {
  const baselineRows = readJson(path.resolve(args.baseline), []);
  const baselineAudit = auditRows(Array.isArray(baselineRows) ? baselineRows : []);
  baseline = {
    file: args.baseline,
    receita_total_antes: baselineAudit.total.receita_total,
    receita_total_depois: audit.total.receita_total,
    diff_receita_total: round(audit.total.receita_total - baselineAudit.total.receita_total),
    pedidos_total_antes: baselineAudit.total.pedidos_total,
    pedidos_total_depois: audit.total.pedidos_total,
    diff_pedidos_total: audit.total.pedidos_total - baselineAudit.total.pedidos_total
  };
  if (Math.abs(baseline.diff_receita_total || 0) > 0.01) {
    issues.push('Receita total mudou vs baseline; a atribuicao nao deveria alterar venda total.');
  }
  if (baseline.diff_pedidos_total !== 0) {
    issues.push('Pedidos totais mudaram vs baseline; a atribuicao nao deveria alterar quantidade de pedidos.');
  }
}

console.log(JSON.stringify({
  ok: issues.length === 0,
  generated_at: new Date().toISOString(),
  status: !audit.total.pedidos_classificados ? 'sem_atribuicao_real' : warnings.length ? 'parcial' : 'ok',
  total: audit.total,
  por_modelo: audit.por_modelo,
  baseline,
  warnings,
  issues
}, null, 2));
