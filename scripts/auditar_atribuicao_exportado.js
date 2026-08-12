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

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function orderKey(row) {
  return normalize(row.order_sk);
}

function isAllocatedAttribution(row = {}) {
  const ruleText = normalizeText([
    row.regra_atribuicao_real,
    row.regra_join_atribuicao,
    row.flags_qualidade
  ].filter(Boolean).join(' '));
  return ruleText.includes('allocated');
}

function orderChannelType(row = {}) {
  const explicitType = normalizeText(row.tipo_real || row.tipo || row.tipo_canal || row.channel_type);
  if (/(^| )(paid|pago|midia paga|paid media)( |$)/.test(explicitType)) return 'paid';
  if (/(^| )(unmatched|sem origem|sem utm|sem atribuicao|sem match|unattributed|unknown|an unknown source|not set)( |$)/.test(explicitType)) return 'organic';
  if (isUnattributedRow(row)) return 'organic';
  if (/(^| )(owned|crm|email|newsletter|whatsapp|sms|organic|organico|seo|direct|referral|other|outros)( |$)/.test(explicitType)) return 'organic';
  const channelText = normalizeText([
    row.canal_real,
    row.canal,
    row.channel,
    row.chanel,
    row.grupo_canal,
    row.raw_channel,
    row.raw_medium,
    row.raw_source,
    row.utm_medium,
    row.utm_source
  ].filter(Boolean).join(' '));
  if (!channelText) return isAllocatedAttribution(row) ? null : 'organic';
  if (/(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen|cpc|ppc|cpm|paid|ads|anuncio|anuncios|patrocinad)( |$)/.test(channelText)) return 'paid';
  if (isUnattributedRow(row)) return 'organic';
  return 'organic';
}

function isUnattributedRow(row = {}) {
  const text = normalizeText([
    row.tipo_real,
    row.tipo,
    row.tipo_canal,
    row.channel_type,
    row.regra_atribuicao_real,
    row.regra_join_atribuicao,
    row.canal_real,
    row.canal,
    row.channel,
    row.grupo_canal,
    row.raw_channel,
    row.raw_medium,
    row.raw_source
  ].filter(Boolean).join(' '));
  return /(^| )(unmatched|sem origem|sem utm|sem atribuicao|sem match|unattributed|unknown|an unknown source|not set)( |$)/.test(text);
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
    pedidos_crm: new Set(),
    pedidos_direct_unknown: new Set(),
    pedidos_sem_atribuicao: new Set(),
    receita_aprovada: 0,
    receita_paga: 0,
    receita_organica: 0,
    receita_crm: 0,
    receita_direct_unknown: 0,
    receita_sem_atribuicao: 0,
    receita_paga_campo: 0,
    receita_organica_campo: 0,
    receita_crm_campo: 0,
    pedidos_pagos_campo: 0,
    pedidos_organicos_campo: 0,
    possui_alocacao_ssot: false,
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
    const tipo = orderChannelType(row);
    const receita = toNumber(row.receita_bruta ?? row.receita);

    group.linhas_produto += 1;
    group.receita_aprovada += receita;
    group.receita_paga_campo += toNumber(row.receita_paga);
    group.receita_organica_campo += toNumber(row.receita_organica);
    group.receita_crm_campo += toNumber(row.receita_crm);
    group.pedidos_pagos_campo += toNumber(row.pedidos_pagos);
    group.pedidos_organicos_campo += toNumber(row.pedidos_organicos);
    group.possui_alocacao_ssot = group.possui_alocacao_ssot || isAllocatedAttribution(row);
    if (row.d0 && (!group.d0 || row.d0 < group.d0)) group.d0 = row.d0;
    if (row.regra_atribuicao_real) group.regras_atribuicao.add(row.regra_atribuicao_real);
    if (pedido) group.pedidos_aprovados.add(pedido);

    if (tipo) {
      if (pedido) group.pedidos_com_atribuicao.add(pedido);
      if (tipo === 'paid') {
        group.receita_paga += receita;
        if (pedido) group.pedidos_pagos.add(pedido);
      } else if (tipo === 'organic' || tipo === 'owned' || tipo === 'crm') {
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
      const useAllocatedFields = group.possui_alocacao_ssot;
      const pedidosPagos = useAllocatedFields ? group.pedidos_pagos_campo : group.pedidos_pagos.size;
      const pedidosOrganicos = useAllocatedFields ? group.pedidos_organicos_campo : group.pedidos_organicos.size;
      const pedidosClassificados = pedidosPagos + pedidosOrganicos;
      const receitaPaga = useAllocatedFields ? group.receita_paga_campo : group.receita_paga;
      const receitaOrganica = useAllocatedFields ? group.receita_organica_campo : group.receita_organica;
      const receitaPartes = receitaPaga + receitaOrganica;
      return {
        modelo_id: group.modelo_id,
        modelo: group.modelo,
        d0: group.d0,
        linhas_produto: group.linhas_produto,
        pedidos_aprovados: pedidosAprovados,
        metodo_dashboard: useAllocatedFields ? 'campos_pago_organico_alocados_pelo_ssot' : 'origem_granular_do_pedido',
        pedidos_com_atribuicao: roundMoney(pedidosClassificados),
        cobertura_atribuicao_pct: pedidosAprovados ? pct(pedidosClassificados / pedidosAprovados) : null,
        pedidos_pagos: roundMoney(pedidosPagos),
        pedidos_organicos: roundMoney(pedidosOrganicos),
        pedidos_sem_atribuicao: roundMoney(Math.max(0, pedidosAprovados - pedidosClassificados)),
        pedidos_pagos_granular: group.pedidos_pagos.size,
        pedidos_organicos_granular: group.pedidos_organicos.size,
        pedidos_com_origem_granular: group.pedidos_com_atribuicao.size,
        cobertura_origem_granular_pct: pedidosAprovados ? pct(group.pedidos_com_atribuicao.size / pedidosAprovados) : null,
        pedidos_crm_granular: group.pedidos_crm.size,
        pedidos_direct_unknown_granular: group.pedidos_direct_unknown.size,
        pedidos_sem_origem_granular: group.pedidos_sem_atribuicao.size,
        receita_aprovada: roundMoney(group.receita_aprovada),
        receita_paga: roundMoney(receitaPaga),
        receita_organica: roundMoney(receitaOrganica),
        receita_sem_atribuicao: roundMoney(Math.max(0, group.receita_aprovada - receitaPartes)),
        receita_paga_granular: roundMoney(group.receita_paga),
        receita_organica_granular: roundMoney(group.receita_organica),
        receita_crm_granular: roundMoney(group.receita_crm),
        receita_direct_unknown_granular: roundMoney(group.receita_direct_unknown),
        receita_sem_origem_granular: roundMoney(group.receita_sem_atribuicao),
        receita_paga_campo: roundMoney(group.receita_paga_campo),
        receita_organica_campo: roundMoney(group.receita_organica_campo),
        receita_crm_campo: roundMoney(group.receita_crm_campo),
        pedidos_pagos_campo: roundMoney(group.pedidos_pagos_campo),
        pedidos_organicos_campo: roundMoney(group.pedidos_organicos_campo),
        reconciliacao_pedidos_ok: Math.abs(pedidosAprovados - pedidosClassificados) < 0.05,
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
