#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dataDir = path.join(root, 'data');
const WINDOW_DAYS = { '7d': 7, '15d': 15, '30d': 30, '60d': 60, '90d': 90 };
const WINDOW_KEYS = Object.keys(WINDOW_DAYS);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, name), 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sumValues(...values) {
  const known = values.filter((value) => value !== null && value !== undefined);
  return known.length ? known.reduce((acc, value) => acc + Number(value || 0), 0) : null;
}

function sumKnown(rows, field) {
  const values = rows
    .map((row) => numberOrNull(row[field]))
    .filter((value) => value !== null);
  return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
}

function round(value, digits = 2) {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratioOrNull(numerator, denominator) {
  const n = numberOrNull(numerator);
  const d = numberOrNull(denominator);
  return n !== null && d !== null && d !== 0 ? n / d : null;
}

function toDate(iso) {
  if (!iso) return null;
  const [year, month, day] = String(iso).slice(0, 10).split('-').map(Number);
  if ([year, month, day].some(Number.isNaN)) return null;
  return new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
}

function toIsoDate(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(iso, days) {
  const date = toDate(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return toIsoDate(date);
}

function daysBetween(startIso, endIso) {
  const start = toDate(startIso);
  const end = toDate(endIso);
  if (!start || !end) return null;
  return Math.floor((end - start) / 86400000);
}

function dayIndex(startIso, dateIso) {
  return daysBetween(startIso, dateIso);
}

function fmtMoney(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: 'BRL',
    maximumFractionDigits: 0
  }).format(value).replace(/\u00a0/g, ' ');
}

function fmtNumber(value, digits = 0) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
}

function fmtRatio(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${fmtNumber(value, 2)}x`;
}

function fmtPct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return '-';
  return `${fmtNumber(value * 100, 1)}%`;
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
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

function janelaEmDias(value) {
  const match = String(value || '').match(/(\d+)d/);
  return match ? Number(match[1]) : null;
}

function commercialWindowKey(row) {
  const raw = String(row?.janela || '').trim().toLowerCase();
  return WINDOW_KEYS.includes(raw) ? raw : raw || 'sem_janela';
}

function nonNegativeRoundedRemainder(total, known, precision = 2) {
  const totalValue = numberOrNull(total);
  const knownValue = numberOrNull(known);
  if (totalValue === null || knownValue === null) return null;
  const factor = 10 ** precision;
  const value = Math.round((totalValue - knownValue) * factor) / factor;
  return value < 0 ? 0 : value;
}

function parseArgs() {
  const out = {};
  const args = process.argv.slice(2);
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--out') {
      out.markdown = args[i + 1];
      i += 1;
    } else if (args[i] === '--json-out') {
      out.json = args[i + 1];
      i += 1;
    }
  }
  return out;
}

const manifest = readJson('manifest.json', {});
const modelos = readJson('lancamentos_modelos.json', []);
const salesRows = readJson('lancamentos_produtos_dia.json', []);
const midiaRows = readJson('midia_paga.json', []);
const crmRows = readJson('crm_disparos.json', []);
const metasPayload = readJson('metas_mensais.json', { rows: [] });
const metasRows = Array.isArray(metasPayload?.rows) ? metasPayload.rows : (Array.isArray(metasPayload) ? metasPayload : []);
const metasDailyRows = metasRows.flatMap((month) => (
  (Array.isArray(month.daily) ? month.daily : []).map((row) => ({
    ...row,
    mes: month.mes,
    month_label: month.month_label
  }))
));

const snapshotIso = String(manifest.generated_at || '').slice(0, 10)
  || salesRows.map((row) => String(row.data || '').slice(0, 10)).filter(Boolean).sort().at(-1)
  || toIsoDate(new Date());

function dashboardRevenue(row) {
  return numberOrNull(row?.receita_bruta) ?? numberOrNull(row?.receita);
}

function latestLaunchDataDay(model) {
  const d0 = model.day_zero_base;
  const days = salesRows
    .filter((row) => row.modelo_id === model.modelo_id)
    .map((row) => dayIndex(d0, row.data))
    .filter((idx) => idx !== null && idx >= 0);
  return days.length ? Math.max(...days) : null;
}

function availableDay(model, targetDay) {
  const dataDay = latestLaunchDataDay(model);
  const snapshotDay = daysBetween(model.day_zero_base, snapshotIso);
  const candidates = [dataDay, snapshotDay].filter((value) => value !== null);
  const maxAvailable = candidates.length ? Math.max(...candidates) : targetDay;
  return Math.max(0, Math.min(90, targetDay, maxAvailable));
}

function salesWindow(model, key) {
  const targetDay = WINDOW_DAYS[key];
  const observedDay = availableDay(model, targetDay);
  const rows = salesRows.filter((row) => {
    if (row.modelo_id !== model.modelo_id) return false;
    const idx = dayIndex(model.day_zero_base, row.data);
    return idx !== null && idx >= 0 && idx <= observedDay;
  });
  const orderIds = new Set(rows.map((row) => row.order_sk).filter(Boolean));
  const pedidosFallback = rows.some((row) => numberOrNull(row.pedidos_validos) !== null)
    ? rows.reduce((acc, row) => acc + Number(row.pedidos_validos || 0), 0)
    : rows.reduce((acc, row) => acc + Number(row.pedidos || 0), 0);
  const receita = rows.some((row) => dashboardRevenue(row) !== null)
    ? rows.reduce((acc, row) => acc + Number(dashboardRevenue(row) || 0), 0)
    : null;
  const pares = rows.some((row) => numberOrNull(row.pares) !== null)
    ? rows.reduce((acc, row) => acc + Number(row.pares || 0), 0)
    : null;
  const pedidos = orderIds.size || pedidosFallback || null;
  const allocatedAttribution = rows.some((row) => isAllocatedAttribution(row));
  const typedAttribution = !allocatedAttribution && rows.some((row) => orderChannelType(row));
  const hasExplicitAttribution = rows.some((row) => [
    row.receita_paga,
    row.receita_organica,
    row.pedidos_pagos,
    row.pedidos_organicos
  ].some((value) => numberOrNull(value) !== null));
  const hasChannelAttribution = allocatedAttribution || typedAttribution || hasExplicitAttribution;
  const explicitReceitaPaga = sumKnown(rows, 'receita_paga');
  const explicitReceitaOrganica = sumKnown(rows, 'receita_organica') ?? sumKnown(rows, 'receita_crm');
  const realReceitaPaga = allocatedAttribution || !typedAttribution
    ? explicitReceitaPaga
    : rows.filter((row) => orderChannelType(row) === 'paid')
      .reduce((acc, row) => acc + Number(dashboardRevenue(row) || 0), 0);
  const realReceitaCrm = hasChannelAttribution ? 0 : sumKnown(rows, 'receita_crm');
  const realReceitaOrganicaBase = allocatedAttribution || !typedAttribution
    ? explicitReceitaOrganica
    : rows.filter((row) => orderChannelType(row) === 'organic')
      .reduce((acc, row) => acc + Number(dashboardRevenue(row) || 0), 0);
  const realReceitaOrganica = realReceitaOrganicaBase !== null
    ? realReceitaOrganicaBase
    : nonNegativeRoundedRemainder(receita, realReceitaPaga);
  const pedidosPorTipo = (types) => {
    const filtered = rows.filter((row) => types.includes(orderChannelType(row)));
    const ids = new Set(filtered.map((row) => row.order_sk).filter(Boolean));
    return ids.size;
  };
  const explicitPedidosPagos = sumKnown(rows, 'pedidos_pagos');
  const explicitPedidosOrganicos = sumKnown(rows, 'pedidos_organicos') ?? sumKnown(rows, 'pedidos_crm');
  const realPedidosPagos = allocatedAttribution || !typedAttribution
    ? explicitPedidosPagos
    : pedidosPorTipo(['paid']);
  const realPedidosCrm = hasChannelAttribution ? 0 : sumKnown(rows, 'pedidos_crm');
  const realPedidosOrganicosBase = allocatedAttribution || !typedAttribution
    ? explicitPedidosOrganicos
    : pedidosPorTipo(['organic']);
  const realPedidosOrganicos = realPedidosOrganicosBase !== null
    ? realPedidosOrganicosBase
    : nonNegativeRoundedRemainder(pedidos, realPedidosPagos, 0);
  const pedidosClassificados = allocatedAttribution
    ? sumValues(realPedidosPagos, realPedidosOrganicos)
    : typedAttribution
      ? new Set(rows.filter((row) => orderChannelType(row)).map((row) => row.order_sk).filter(Boolean)).size
      : sumValues(realPedidosPagos, realPedidosOrganicos) || 0;
  const granularOrderIds = new Set(
    rows
      .filter((row) => !isAllocatedAttribution(row) && ['paid', 'organic'].includes(orderChannelType(row)))
      .map((row) => row.order_sk)
      .filter(Boolean)
  );
  const allocatedOrderIds = new Set(
    rows
      .filter((row) => isAllocatedAttribution(row))
      .map((row) => row.order_sk)
      .filter(Boolean)
  );
  const granularPct = pedidos ? granularOrderIds.size / pedidos : null;
  const allocatedPct = pedidos ? allocatedOrderIds.size / pedidos : null;
  const attributionConfidence = granularPct === null
    ? 'sem_base'
    : granularPct >= 0.8
      ? 'granular'
      : granularPct >= 0.5
        ? 'mista'
        : 'alocada';
  return {
    key,
    targetDay,
    observedDay,
    status: observedDay >= targetDay ? 'fechada' : 'parcial',
    range: `${model.day_zero_base}..${addDays(model.day_zero_base, observedDay)}`,
    linhas: rows.length,
    pedidos,
    pares,
    receita: round(receita),
    ticket: round(ratioOrNull(receita, pedidos)),
    receita_paga: realReceitaPaga === null ? null : round(realReceitaPaga),
    receita_crm: realReceitaCrm === null ? null : round(realReceitaCrm),
    receita_organica: realReceitaOrganica === null ? null : round(realReceitaOrganica),
    pedidos_pagos: realPedidosPagos,
    pedidos_crm: realPedidosCrm,
    pedidos_organicos: realPedidosOrganicos,
    pedidos_classificados: pedidosClassificados,
    cobertura_origem_pct: pedidos ? pedidosClassificados / pedidos : null,
    pedidos_granulares: granularOrderIds.size,
    pedidos_alocados: allocatedOrderIds.size,
    cobertura_granular_pct: granularPct,
    cobertura_alocada_pct: allocatedPct,
    confianca_atribuicao: attributionConfidence
  };
}

function acquisitionChannelKey(row) {
  const text = normalizeText(`${row?.tipo || ''} ${row?.canal || ''}`);
  if (/(paid media|meta ads|google ads|facebook ads|instagram ads|ads|paid|pago)/.test(text)) return 'paid';
  if (/(organico|organic|seo|organic search|organic social)/.test(text)) return 'organic';
  if (/(crm|email|whatsapp|sms|owned)/.test(text)) return 'organic';
  return 'organic';
}

function legacyAttributionCandidate(model, sales, observedDay) {
  const startIso = model.day_zero_base;
  const endIso = addDays(startIso, observedDay);
  const rows = metasDailyRows.filter((row) => row.data && row.data >= startIso && row.data <= endIso);
  const hasSalesChannels = rows.some((day) => Array.isArray(day.canais_venda) && day.canais_venda.length);
  if (!hasSalesChannels) return null;
  const totals = {
    investmentRevenue: null,
    investmentOrders: null,
    organicRevenue: null,
    organicOrders: null,
    rows: rows.length
  };
  rows.forEach((day) => {
    (Array.isArray(day.canais_venda) ? day.canais_venda : []).forEach((channel) => {
      const key = acquisitionChannelKey(channel);
      if (key === 'paid') {
        totals.investmentRevenue = (totals.investmentRevenue || 0) + Number(channel.receita || 0);
        totals.investmentOrders = (totals.investmentOrders || 0) + Number(channel.pedidos || 0);
      } else if (key === 'organic') {
        totals.organicRevenue = (totals.organicRevenue || 0) + Number(channel.receita || 0);
        totals.organicOrders = (totals.organicOrders || 0) + Number(channel.pedidos || 0);
      }
    });
  });
  if (
    totals.investmentRevenue === null
    && totals.investmentOrders === null
    && totals.organicRevenue === null
    && totals.organicOrders === null
  ) return null;
  const combined = sumValues(totals.investmentRevenue, totals.organicRevenue);
  const total = numberOrNull(sales.receita);
  const tolerance = total !== null ? Math.max(1, Math.abs(total) * 0.02) : null;
  const exceeds = (value) => (
    total !== null
    && numberOrNull(value) !== null
    && Number(value) - total > tolerance
  );
  const rejected = total !== null && (
    exceeds(totals.investmentRevenue)
    || exceeds(totals.organicRevenue)
    || (combined !== null && combined - total > tolerance)
  );
  return {
    source: 'base_antiga',
    rejected,
    investmentRevenue: round(totals.investmentRevenue),
    investmentOrders: totals.investmentOrders,
    organicRevenue: round(totals.organicRevenue),
    organicOrders: totals.organicOrders,
    rows: totals.rows
  };
}

function parseManualLaunchDateCandidates(text) {
  const match = String(text || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!match) return [];
  const day = Number(match[1]);
  const month = Number(match[2]);
  const rawYear = match[3];
  const baseYear = rawYear.length === 2 ? 2000 + Number(rawYear) : Number(rawYear);
  const years = rawYear.length === 2 ? [baseYear, baseYear + 1] : [baseYear];
  return [...new Set(years)].map((year) => {
    const iso = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const date = toDate(iso);
    return date && date.getUTCMonth() === month - 1 && date.getUTCDate() === day ? iso : null;
  }).filter(Boolean);
}

function manualCommercialReferenceDate(model) {
  const candidates = midiaRows
    .filter((row) => row.modelo_id === model.modelo_id)
    .flatMap((row) => parseManualLaunchDateCandidates(row.observacao));
  if (!candidates.length) return model.day_zero_base;
  const crmForModel = crmRows.filter((row) => row.modelo_id === model.modelo_id);
  const score = (candidate) => crmForModel.reduce((acc, row) => {
    const idx = dayIndex(candidate, row.data_disparo || row.data || row.date);
    if (idx === null || idx < 0 || idx > 90) return acc;
    return acc + 1 + (numberOrNull(row.receita_linha) || 0) / 100000 + (numberOrNull(row.investimento) || 0) / 1000000;
  }, 0);
  return candidates
    .map((candidate, index) => ({ candidate, index, score: score(candidate) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate || model.day_zero_base;
}

function mediaRowMatchesExactWindow(row, model, selectedKey) {
  const key = commercialWindowKey(row);
  if (WINDOW_KEYS.includes(key)) return key === selectedKey;
  if (row.data_inicio || row.data_fim) {
    const start = toDate(row.data_inicio || row.data_fim);
    const end = toDate(row.data_fim || row.data_inicio);
    if (!start || !end) return false;
    const span = Math.floor((end - start) / 86400000) + 1;
    return WINDOW_DAYS[selectedKey] === span;
  }
  return false;
}

function crmRowMatchesPeriodEnd(row, model, selectedEnd, referenceDate) {
  if (row.janela) {
    const key = commercialWindowKey(row);
    const days = janelaEmDias(key) ?? WINDOW_DAYS[key] ?? null;
    if (days !== null) return days <= selectedEnd;
  }
  const idx = dayIndex(referenceDate, row.data_disparo || row.data || row.date);
  return idx !== null && idx >= 0 && idx <= selectedEnd;
}

function midiaValidaParaGraficoComercial(row) {
  if (!row) return false;
  const hasDeclaredWindow = janelaEmDias(row.janela) !== null;
  const hasInvestment = numberOrNull(row.investimento) !== null;
  if (!hasInvestment) return false;
  if (hasDeclaredWindow) return true;
  return !row.data_suspeita && !row.valor_suspeito;
}

function manualRows(model, observedDay, windowKey) {
  const referenceDate = manualCommercialReferenceDate(model);
  const matchedMedia = midiaRows
    .filter((row) => row.modelo_id === model.modelo_id)
    .filter((row) => mediaRowMatchesExactWindow(row, model, windowKey))
    .filter(midiaValidaParaGraficoComercial);
  const channelMedia = matchedMedia.filter((row) => normalizeText(row.canal || row.channel) !== 'total');
  const media = (channelMedia.length ? channelMedia : matchedMedia)
    .map((row) => ({
      ...row,
      source: 'midia_paga',
      receita_fallback: numberOrNull(row.receita_atribuida)
    }));
  const crm = crmRows
    .filter((row) => row.modelo_id === model.modelo_id)
    .filter((row) => crmRowMatchesPeriodEnd(row, model, observedDay, referenceDate))
    .map((row) => ({
      ...row,
      source: 'crm_disparos',
      receita_fallback: numberOrNull(row.receita_linha)
    }));
  return { media, crm, referenceDate };
}

function manualInvestmentWindow(model, observedDay, windowKey) {
  const rows = manualRows(model, observedDay, windowKey);
  const combined = [...rows.media, ...rows.crm];
  const investimento = sumKnown(combined, 'investimento');
  return {
    source: investimento !== null ? 'base_investimento' : null,
    referenceDate: rows.referenceDate,
    investimento: round(investimento),
    hasMediaInvestment: rows.media.length > 0,
    mediaRows: rows.media.length,
    crmRows: rows.crm.length,
    rows: combined.map((row) => ({
      source: row.source,
      campanha: row.campanha,
      janela: row.janela || null,
      data: row.data_disparo || row.data_inicio || row.data || null,
      investimento: numberOrNull(row.investimento),
      receita_fallback: row.receita_fallback,
      pedidos: numberOrNull(row.pedidos)
    }))
  };
}

function manualAttributionWindow(model, sales, observedDay, windowKey) {
  const rows = manualRows(model, observedDay, windowKey);
  const combined = rows.media.filter((row) => row.receita_fallback !== null || numberOrNull(row.pedidos) !== null);
  const investmentRevenue = sumValues(...combined.map((row) => row.receita_fallback));
  const investmentOrders = sumValues(...combined.map((row) => numberOrNull(row.pedidos)));
  if (investmentRevenue === null && investmentOrders === null) return null;
  return {
    source: 'base_manual',
    referenceDate: rows.referenceDate,
    investmentRevenue: round(investmentRevenue),
    investmentOrders,
    organicRevenue: nonNegativeRoundedRemainder(sales.receita, investmentRevenue),
    organicOrders: investmentOrders !== null ? nonNegativeRoundedRemainder(sales.pedidos, investmentOrders, 0) : null,
    rows: combined.length
  };
}

function attributionChoice(model, sales, observedDay) {
  const realInvestmentRevenue = sales.receita_paga;
  const realInvestmentOrders = sales.pedidos_pagos;
  if (
    realInvestmentRevenue !== null
    || realInvestmentOrders !== null
    || sales.receita_organica !== null
    || sales.pedidos_organicos !== null
  ) {
    return {
      source: 'canal_pedido',
      investmentRevenue: round(realInvestmentRevenue),
      investmentOrders: realInvestmentOrders,
      organicRevenue: round(sales.receita_organica),
      organicOrders: sales.pedidos_organicos
    };
  }
  const legacy = legacyAttributionCandidate(model, sales, observedDay);
  return legacy?.rejected ? { rejectedLegacy: legacy } : null;
}

function auditWindow(model, key) {
  const sales = salesWindow(model, key);
  const investment = manualInvestmentWindow(model, sales.observedDay, key);
  const attribution = attributionChoice(model, sales, sales.observedDay);
  const investmentRevenue = attribution?.investmentRevenue ?? null;
  const organicRevenue = attribution?.organicRevenue ?? null;
  const revenueParts = [investmentRevenue, organicRevenue]
    .filter((value) => value !== null && value !== undefined);
  const revenueReconciled = revenueParts.length >= 2 && sales.receita !== null
    ? Math.abs(revenueParts.reduce((acc, value) => acc + Number(value || 0), 0) - Number(sales.receita || 0)) < 0.05
    : null;
  const orderParts = [attribution?.investmentOrders, attribution?.organicOrders]
    .filter((value) => value !== null && value !== undefined);
  const ordersReconciled = orderParts.length >= 2 && sales.pedidos !== null
    ? Math.abs(orderParts.reduce((acc, value) => acc + Number(value || 0), 0) - Number(sales.pedidos)) < 0.05
    : null;
  const issues = [];
  if (!sales.linhas) issues.push('sem_linhas_pipeline');
  if (sales.pedidos && sales.pedidos_classificados === 0) issues.push('sem_canal_pedido_bigquery');
  if (attribution?.rejectedLegacy) issues.push('base_antiga_inconsistente_rejeitada');
  if (revenueReconciled === false) issues.push('receita_atribuida_mais_organica_nao_fecha');
  if (ordersReconciled === false) issues.push('pedidos_atribuidos_mais_organicos_nao_fecham');
  return {
    modelo_id: model.modelo_id,
    modelo: model.modelo,
    janela: key,
    status_janela: sales.status,
    range: sales.range,
    observed_day: sales.observedDay,
    target_day: sales.targetDay,
    pipeline: sales,
    investimento: investment,
    atribuicao: attribution,
    roas: sales.status === 'fechada' && investment.hasMediaInvestment
      ? ratioOrNull(investmentRevenue, investment.investimento)
      : null,
    checks: {
      receita_reconciliada: revenueReconciled,
      pedidos_reconciliados: ordersReconciled,
      cobertura_origem_pct: sales.cobertura_origem_pct,
      status: issues.length ? 'revisar' : 'ok',
      issues
    }
  };
}

function audit() {
  const eligibleModels = modelos
    .filter((model) => ['historico', 'ativo'].includes(String(model.status || '').trim().toLowerCase()))
    .filter((model) => model.day_zero_base);
  const windows = eligibleModels.flatMap((model) => WINDOW_KEYS.map((key) => auditWindow(model, key)));
  const summary = {
    generated_at: new Date().toISOString(),
    snapshot: snapshotIso,
    modelos: eligibleModels.length,
    janelas: windows.length,
    janelas_revisar: windows.filter((row) => row.checks.status === 'revisar').length,
    janelas_sem_canal_pedido: windows.filter((row) => row.checks.issues.includes('sem_canal_pedido_bigquery')).length,
    janelas_baixa_cobertura_granular: windows.filter((row) => numberOrNull(row.pipeline.cobertura_granular_pct) !== null && row.pipeline.cobertura_granular_pct < 0.5).length,
    janelas_cobertura_granular_mista: windows.filter((row) => numberOrNull(row.pipeline.cobertura_granular_pct) !== null && row.pipeline.cobertura_granular_pct >= 0.5 && row.pipeline.cobertura_granular_pct < 0.8).length,
    janelas_com_receita_reconciliada: windows.filter((row) => row.checks.receita_reconciliada === true).length,
    janelas_com_pedidos_reconciliados: windows.filter((row) => row.checks.pedidos_reconciliados === true).length
  };
  return { summary, windows };
}

function toMarkdown(result) {
  const lines = [];
  lines.push('# Auditoria de Amostragem de Lancamentos');
  lines.push('');
  lines.push(`Gerado em: ${result.summary.generated_at}`);
  lines.push(`Snapshot base: ${result.summary.snapshot}`);
  lines.push('');
  lines.push('## Leitura executiva');
  lines.push('');
  lines.push(`- Modelos auditados: ${result.summary.modelos}`);
  lines.push(`- Janelas auditadas: ${result.summary.janelas}`);
  lines.push(`- Janelas que precisam revisar algum ponto: ${result.summary.janelas_revisar}`);
  lines.push(`- Janelas sem canal de pedido no BigQuery local: ${result.summary.janelas_sem_canal_pedido}`);
  lines.push(`- Janelas com baixa cobertura granular de UTM/last-click (<50%): ${result.summary.janelas_baixa_cobertura_granular}`);
  lines.push(`- Janelas com cobertura granular mista (50%-79%): ${result.summary.janelas_cobertura_granular_mista}`);
  lines.push(`- Janelas em que atribuido + organico fecha com faturamento: ${result.summary.janelas_com_receita_reconciliada}`);
  lines.push(`- Janelas em que pedidos atribuidos + organicos fecham com pedidos totais: ${result.summary.janelas_com_pedidos_reconciliados}`);
  lines.push('');
  lines.push('## Amostra por janela');
  lines.push('');
  lines.push('| Modelo | Janela | Status | Pedidos | Pares | Faturamento | Investimento | Midia paga | Ped. midia | Organico | Ped. org. | Granular | Alocado | Confianca | ROAS | Origem canal | Checks |');
  lines.push('| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | ---: | --- | --- |');
  result.windows.forEach((row) => {
    const checks = row.checks.issues.length ? row.checks.issues.join(', ') : 'ok';
    const fmtOrders = (value) => value === null || value === undefined ? '-' : fmtNumber(value);
    lines.push([
      row.modelo,
      row.janela,
      row.status_janela === 'fechada' ? 'fechada' : `parcial D+${row.observed_day}`,
      fmtNumber(row.pipeline.pedidos),
      fmtNumber(row.pipeline.pares),
      fmtMoney(row.pipeline.receita),
      fmtMoney(row.investimento.investimento),
      fmtMoney(row.atribuicao?.investmentRevenue),
      fmtOrders(row.atribuicao?.investmentOrders),
      fmtMoney(row.atribuicao?.organicRevenue),
      fmtOrders(row.atribuicao?.organicOrders),
      fmtPct(row.pipeline.cobertura_granular_pct),
      fmtPct(row.pipeline.cobertura_alocada_pct),
      row.pipeline.confianca_atribuicao || '-',
      fmtRatio(row.roas),
      row.atribuicao?.source || '-',
      checks
    ].map((cell) => String(cell).replace(/\|/g, '/')).join(' | ').replace(/^/, '| ').replace(/$/, ' |'));
  });
  lines.push('');
  lines.push('## Regras usadas');
  lines.push('');
  lines.push('- Faturamento, pedidos e pares: soma do `lancamentos_produtos_dia.json`, com pedidos distintos por `order_sk`.');
  lines.push('- Investimento: soma das linhas por canal de `midia_paga.json` na janela exata selecionada, mais os disparos de `crm_disparos.json` ocorridos dentro da janela observada. Quando existe total e abertura por canal na mesma janela, prevalece a abertura por canal para evitar duplicidade.');
  lines.push('- Atribuicao paga/organica: linhas granulares usam `canal_real`/`tipo_real`; linhas com regra `*_allocated` preservam os campos pagos e organicos calculados pelo SSOT, sem reclassificacao no frontend.');
  lines.push('- Confianca de atribuicao: `granular` significa 80% ou mais dos pedidos com origem/UTM por pedido; `mista` fica entre 50% e 79%; `alocada` fica abaixo de 50% e deve ser apresentada como leitura binaria estimada pelo SSOT.');
  lines.push('- Base antiga e base manual nao preenchem pedidos pagos/organicos nesta auditoria; elas ficam apenas como contexto de investimento/campanha.');
  lines.push('- Pedidos pagos/organicos so aparecem quando a origem real do pedido vem do BigQuery. O relatorio nao estima pedidos por ticket medio nem por resto do faturamento.');
  lines.push('');
  lines.push('## Pontos que ainda dependem de validacao externa');
  lines.push('');
  if (result.summary.janelas_sem_canal_pedido > 0) {
    lines.push('- O arquivo local ainda tem janelas sem `canal_real` e `tipo_real`; reexecute o export BigQuery com a mirror de origem funcionando.');
    lines.push('- Nessas janelas, ROAS atribuido, pedidos pagos e pedidos organicos ficam pendentes por desenho.');
  } else {
    lines.push('- Todas as janelas auditadas possuem classificacao paga/organica e conciliam o faturamento.');
    lines.push('- A conciliacao valida o payload exportado; a cobertura historica de UTM/last-click ainda deve ser conferida na tabela de jornada Shopify.');
  }
  return `${lines.join('\n')}\n`;
}

const args = parseArgs();
const result = audit();
const json = `${JSON.stringify(result, null, 2)}\n`;
const markdown = toMarkdown(result);

if (args.json) {
  const target = path.resolve(root, args.json);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json, 'utf8');
}

if (args.markdown) {
  const target = path.resolve(root, args.markdown);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, markdown, 'utf8');
}

console.log(args.markdown || args.json ? JSON.stringify({
  ok: true,
  markdown: args.markdown || null,
  json: args.json || null,
  summary: result.summary
}, null, 2) : markdown);
