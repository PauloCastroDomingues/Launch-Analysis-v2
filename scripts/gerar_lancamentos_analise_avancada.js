#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = path.join(ROOT, 'data');
const OUTPUT = path.join(DATA_DIR, 'lancamentos_analise_avancada.json');
const WINDOW_DAYS = { '7d': 7, '15d': 15, '30d': 30, '60d': 60, '90d': 90 };
const FIXED_WINDOWS = Object.keys(WINDOW_DAYS);

function readJson(name, fallback) {
  try {
    return JSON.parse(fs.readFileSync(path.join(DATA_DIR, name), 'utf8'));
  } catch (error) {
    return fallback;
  }
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
}

function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function round(value, digits = 2) {
  const n = numberOrNull(value);
  if (n === null) return null;
  const factor = 10 ** digits;
  return Math.round(n * factor) / factor;
}

function ratio(numerator, denominator, digits = 4) {
  const n = numberOrNull(numerator);
  const d = numberOrNull(denominator);
  if (n === null || d === null || d === 0) return null;
  return round(n / d, digits);
}

function medianKnown(values, digits = 4) {
  const valid = values
    .map((value) => numberOrNull(value))
    .filter((value) => value !== null)
    .sort((a, b) => a - b);
  if (!valid.length) return null;
  const mid = Math.floor(valid.length / 2);
  const value = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
  return round(value, digits);
}

function sumKnown(rows, field) {
  const values = rows
    .map((row) => numberOrNull(row[field]))
    .filter((value) => value !== null);
  return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
}

function parseIso(iso) {
  const [y, m, d] = String(iso || '').slice(0, 10).split('-').map(Number);
  if ([y, m, d].some(Number.isNaN)) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(date) {
  return date instanceof Date && !Number.isNaN(date.getTime())
    ? date.toISOString().slice(0, 10)
    : null;
}

function addDays(iso, days) {
  const date = parseIso(iso);
  if (!date) return null;
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return toIso(date);
}

function dayIndex(d0, iso) {
  const start = parseIso(d0);
  const end = parseIso(iso);
  if (!start || !end) return null;
  return Math.floor((end - start) / 86400000);
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function windowLabel(key) {
  return key === 'extended' ? 'Rampa estendida' : `D+${WINDOW_DAYS[key]}`;
}

function manifestRampCoverage(manifest) {
  const ramp = manifest?.data_quality?.rampa_produtos_dia || {};
  const status = normalizeText(ramp.status);
  const explicitEnd = String(ramp.data_fim_exportada || '').slice(0, 10);
  const manifestEnd = String(manifest?.generated_at || '').slice(0, 10);
  const dataFimExportada = parseIso(explicitEnd) ? explicitEnd : parseIso(manifestEnd) ? manifestEnd : null;
  return {
    coversCurrentDate: status === 'd0 ate data atual',
    status: ramp.status || 'desconhecida',
    data_fim_exportada: dataFimExportada
  };
}

function sourceQualityFromRule(rule) {
  const text = normalizeText(rule);
  if (!text || text.includes('sem atribuicao')) return 'pendente';
  if (text.includes('allocated') || text.includes('alocado')) return 'alocado_ssot';
  if (text.includes('core_order_origin_fields')) return 'inferido';
  if (text.includes('customer_journey') || text.includes('last_click') || text.includes('mirror')) return 'real';
  return 'inferido';
}

function mergeQuality(current, next) {
  const rank = { pendente: 0, inferido: 1, alocado_ssot: 2, real: 3, misto: 4 };
  if (!current) return next;
  if (!next || current === next) return current;
  if (current === 'pendente') return next;
  if (next === 'pendente') return current;
  return rank[current] >= 3 && rank[next] >= 3 ? 'real' : 'misto';
}

function isPaidRow(row) {
  const explicitType = normalizeText(row.tipo_real || row.tipo || row.tipo_canal || row.channel_type);
  if (/(^| )(paid|pago|midia paga|paid media)( |$)/.test(explicitType)) return true;
  if (explicitType) return false;
  const text = normalizeText([
    row.canal_real,
    row.canal,
    row.raw_medium,
    row.raw_source,
    row.regra_atribuicao_real
  ].join(' '));
  if (/(^| )(paid|pago|midia paga|facebook ads|instagram ads|google ads|adwords|gads|pmax|cpc|ppc|ads)( |$)/.test(text)) return true;
  return numberOrNull(row.receita_paga) !== null && Number(row.receita_paga || 0) > 0;
}

function channelName(row) {
  if (isPaidRow(row)) return 'paid';
  const type = normalizeText(row.tipo_real);
  const channel = normalizeText(row.canal_real || row.canal);
  if (/(^| )(crm|email|newsletter|whatsapp|sms)( |$)/.test(type) || /(^| )(crm|email|newsletter|whatsapp|sms)( |$)/.test(channel)) return 'crm';
  if (type || channel || numberOrNull(row.receita_organica) !== null) return 'organic';
  return 'pending';
}

function emptyChannel() {
  return {
    receita: null,
    pedidos: null,
    pares: null,
    clientes: null,
    ticket_medio: null,
    qualidade: 'pendente'
  };
}

function addChannelMetric(bucket, row) {
  const receita = numberOrNull(row.receita_bruta ?? row.receita);
  const pedidos = numberOrNull(row.pedidos_validos ?? row.pedidos);
  const pares = numberOrNull(row.pares);
  bucket.receita = (bucket.receita ?? 0) + Number(receita || 0);
  bucket.pedidos = (bucket.pedidos ?? 0) + Number(pedidos || 0);
  bucket.pares = (bucket.pares ?? 0) + Number(pares || 0);
  bucket.qualidade = mergeQuality(bucket.qualidade, sourceQualityFromRule(row.regra_atribuicao_real));
}

function finalizeChannel(bucket) {
  return {
    receita: round(bucket.receita),
    pedidos: round(bucket.pedidos),
    pares: round(bucket.pares),
    clientes: null,
    ticket_medio: ratio(bucket.receita, bucket.pedidos, 2),
    qualidade: bucket.qualidade || 'pendente'
  };
}

function aggregateSales(rows) {
  const orderIds = new Set();
  let pedidosFallback = 0;
  let receita = 0;
  let pares = 0;
  let desconto = 0;
  let receitaLiquida = 0;
  let hasReceita = false;
  let hasDesconto = false;
  let hasLiquida = false;
  let novosPedidosClassificados = 0;
  let recorrentesPedidosClassificados = 0;
  let hasClientClassification = false;
  const channels = {
    paid: emptyChannel(),
    organic: emptyChannel(),
    crm: emptyChannel(),
    other: emptyChannel(),
    pending: emptyChannel()
  };
  let qualidade = null;

  rows.forEach((row) => {
    const revenue = numberOrNull(row.receita_bruta ?? row.receita);
    if (revenue !== null) {
      receita += revenue;
      hasReceita = true;
    }
    const net = numberOrNull(row.receita_liquida);
    if (net !== null) {
      receitaLiquida += net;
      hasLiquida = true;
    }
    const discount = numberOrNull(row.desconto);
    if (discount !== null) {
      desconto += discount;
      hasDesconto = true;
    }
    pares += Number(row.pares || 0);
    const orderId = String(row.order_sk || '').trim();
    if (orderId) orderIds.add(orderId);
    else pedidosFallback += Number(row.pedidos_validos ?? row.pedidos ?? 0);

    const novos = numberOrNull(row.novos);
    const recorrentes = numberOrNull(row.recorrentes);
    if (novos !== null || recorrentes !== null) {
      novosPedidosClassificados += Number(novos || 0);
      recorrentesPedidosClassificados += Number(recorrentes || 0);
      hasClientClassification = true;
    }

    const channel = channelName(row);
    addChannelMetric(channels[channel] || channels.other, row);
    qualidade = mergeQuality(qualidade, sourceQualityFromRule(row.regra_atribuicao_real));
  });

  const pedidos = orderIds.size || pedidosFallback || null;
  const clientesClassificados = hasClientClassification
    ? novosPedidosClassificados + recorrentesPedidosClassificados
    : null;

  return {
    receita: hasReceita ? round(receita) : null,
    receita_liquida: hasLiquida ? round(receitaLiquida) : null,
    desconto: hasDesconto ? round(desconto) : null,
    pedidos: pedidos === null ? null : round(pedidos),
    pares: rows.length ? round(pares) : null,
    ticket_medio: ratio(receita, pedidos, 2),
    preco_medio_par: ratio(receita, pares, 2),
    pedidos_classificados_novos: hasClientClassification ? round(novosPedidosClassificados) : null,
    pedidos_classificados_recorrentes: hasClientClassification ? round(recorrentesPedidosClassificados) : null,
    pedidos_classificados_novos_pct: ratio(novosPedidosClassificados, clientesClassificados),
    clientes_unicos: null,
    novos_clientes: null,
    recorrentes_clientes: null,
    receita_por_cliente: null,
    pedidos_por_cliente: null,
    pares_por_cliente: null,
    unidades_por_cliente: null,
    pct_base_ativada: null,
    clientes_base_compraram: null,
    canais: Object.fromEntries(Object.entries(channels).map(([key, bucket]) => [key, finalizeChannel(bucket)])),
    canal_qualidade: qualidade || 'pendente'
  };
}

function normalizeClientPayload(payload) {
  const janelas = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.janelas) ? payload.janelas : [];
  const baseAtual = numberOrNull(payload?.base_atual?.base_atual_clientes)
    ?? medianKnown(janelas.map((row) => row.base_atual_clientes), 0);
  return {
    generated_at: payload?.generated_at || null,
    export_date: payload?.export_date || null,
    fonte: payload?.fonte || null,
    base_atual: baseAtual === null ? null : {
      data_referencia: payload?.base_atual?.data_referencia || payload?.export_date || null,
      base_atual_clientes: baseAtual,
      fonte: payload?.base_atual?.fonte || 'lancamentos_clientes_janelas'
    },
    janelas
  };
}

function clientWindowMap(clientPayload) {
  const map = new Map();
  (clientPayload?.janelas || []).forEach((row) => {
    const modelId = String(row.modelo_id || '').trim();
    const janela = String(row.janela || '').trim();
    if (modelId && janela) map.set(`${modelId}|${janela}`, row);
  });
  return map;
}

function emptySalesWithChannels() {
  return {
    receita: null,
    receita_liquida: null,
    desconto: null,
    pedidos: null,
    pares: null,
    ticket_medio: null,
    preco_medio_par: null,
    pedidos_classificados_novos: null,
    pedidos_classificados_recorrentes: null,
    pedidos_classificados_novos_pct: null,
    clientes_unicos: null,
    novos_clientes: null,
    recorrentes_clientes: null,
    receita_por_cliente: null,
    pedidos_por_cliente: null,
    pares_por_cliente: null,
    unidades_por_cliente: null,
    pct_base_ativada: null,
    clientes_base_compraram: null,
    canais: Object.fromEntries(Object.entries({
      paid: emptyChannel(),
      organic: emptyChannel(),
      crm: emptyChannel(),
      other: emptyChannel(),
      pending: emptyChannel()
    }).map(([key, bucket]) => [key, finalizeChannel(bucket)])),
    canal_qualidade: 'pendente'
  };
}

function mergeClientMetrics(sales, clientRow) {
  if (!clientRow) return sales;
  const merged = sales ? { ...sales } : emptySalesWithChannels();

  ['receita', 'pedidos', 'pares'].forEach((field) => {
    const value = numberOrNull(clientRow[field]);
    if (merged[field] === null || merged[field] === undefined) merged[field] = value;
  });

  [
    'clientes_unicos',
    'novos_clientes',
    'recorrentes_clientes',
    'receita_por_cliente',
    'pedidos_por_cliente',
    'pares_por_cliente',
    'unidades_por_cliente',
    'pct_base_ativada',
    'clientes_base_compraram',
    'base_total_d0',
    'base_atual_clientes',
    'pedidos_com_customer_key',
    'pedidos_sem_customer_key',
    'customer_key_coverage_pct'
  ].forEach((field) => {
    merged[field] = numberOrNull(clientRow[field]);
  });

  if (merged.unidades_por_cliente === null) merged.unidades_por_cliente = merged.pares_por_cliente;
  if (merged.pct_base_ativada === null) {
    merged.pct_base_ativada = ratio(merged.clientes_base_compraram, merged.base_total_d0, 6);
  }
  merged.clientes_status = clientRow.status || null;
  merged.clientes_qualidade = clientRow.qualidade || 'pendente';
  merged.clientes_fonte = clientRow.fonte || 'lancamentos_clientes_janelas';
  return merged;
}

function windowRows(rows, endDay) {
  return rows.filter((row) => {
    const day = numberOrNull(row.__day);
    return day !== null && day >= 0 && day <= endDay;
  });
}

function dailyRows(rows) {
  const map = new Map();
  rows.forEach((row) => {
    const day = numberOrNull(row.__day);
    if (day === null || day < 0) return;
    const key = `${day}|${row.data}`;
    const current = map.get(key) || { day, data: row.data, rows: [] };
    current.rows.push(row);
    map.set(key, current);
  });
  return [...map.values()]
    .sort((a, b) => a.day - b.day)
    .map((item) => ({ day: item.day, data: item.data, ...aggregateSales(item.rows) }));
}

function peak(rows, field) {
  const candidates = rows.filter((row) => numberOrNull(row[field]) !== null);
  if (!candidates.length) return null;
  const top = candidates.sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0) || a.day - b.day)[0];
  return {
    day: top.day,
    data: top.data,
    receita: top.receita,
    pedidos: top.pedidos,
    pares: top.pares,
    metrica: field,
    valor: top[field]
  };
}

function milestoneDay(daily, pct) {
  const total = daily.reduce((acc, row) => acc + Number(row.receita || 0), 0);
  if (!total) return null;
  const target = total * pct;
  let acc = 0;
  for (const row of daily) {
    acc += Number(row.receita || 0);
    if (acc >= target) return row.day;
  }
  return null;
}

function averageDaily(rows) {
  const values = rows.map((row) => numberOrNull(row.receita)).filter((value) => value !== null);
  return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
}

function lifeMetrics(daily) {
  if (!daily.length) {
    return {
      peak_revenue_day: null,
      peak_orders_day: null,
      peak_pairs_day: null,
      days_to_50pct_revenue: null,
      days_to_80pct_revenue: null,
      days_to_90pct_revenue: null,
      post_peak_decay_pct: null,
      commercial_life_days: null,
      hype_initial_revenue_pct: null,
      sustain_revenue_pct: null,
      leitura: 'sem_dados'
    };
  }

  const revenuePeak = peak(daily, 'receita');
  const first7 = daily.filter((row) => row.day <= 7).reduce((acc, row) => acc + Number(row.receita || 0), 0);
  const after15 = daily.filter((row) => row.day > 15).reduce((acc, row) => acc + Number(row.receita || 0), 0);
  const total = daily.reduce((acc, row) => acc + Number(row.receita || 0), 0);
  const peakDay = revenuePeak?.day ?? null;
  const postPeakRows = peakDay === null ? [] : daily.filter((row) => row.day > peakDay && row.day <= peakDay + 7);
  const prePeakRows = peakDay === null ? [] : daily.filter((row) => row.day >= Math.max(0, peakDay - 6) && row.day <= peakDay);
  const preAvg = averageDaily(prePeakRows);
  const postAvg = averageDaily(postPeakRows);
  const latestDayWithRelevantSales = daily
    .filter((row) => Number(row.receita || 0) >= Math.max(500, (total / Math.max(daily.length, 1)) * 0.25))
    .map((row) => row.day)
    .sort((a, b) => a - b)
    .pop();
  const hypePct = ratio(first7, total);
  const sustainPct = ratio(after15, total);

  return {
    peak_revenue_day: revenuePeak,
    peak_orders_day: peak(daily, 'pedidos'),
    peak_pairs_day: peak(daily, 'pares'),
    days_to_50pct_revenue: milestoneDay(daily, 0.5),
    days_to_80pct_revenue: milestoneDay(daily, 0.8),
    days_to_90pct_revenue: milestoneDay(daily, 0.9),
    post_peak_decay_pct: preAvg && postAvg !== null ? round((postAvg / preAvg) - 1, 4) : null,
    commercial_life_days: latestDayWithRelevantSales ?? daily[daily.length - 1]?.day ?? null,
    hype_initial_revenue_pct: hypePct,
    sustain_revenue_pct: sustainPct,
    leitura: hypePct !== null && hypePct >= 0.55
      ? 'hype_inicial_forte'
      : sustainPct !== null && sustainPct >= 0.45
        ? 'sustentacao_relevante'
        : 'misto'
  };
}

function trustedCrm(row) {
  const text = normalizeText([row.metodologia, row.aviso, row.status].join(' '));
  return !text.includes('correlacao') && !text.includes('contexto') && numberOrNull(row.receita_base ?? row.receita_atribuida) !== null;
}

function rowWindowKey(row) {
  const raw = normalizeText(row.janela).replace(/\s+/g, '');
  if (raw === 'd7' || raw === '7d' || raw === '7') return '7d';
  if (raw === 'd15' || raw === '15d' || raw === '15') return '15d';
  if (raw === 'd30' || raw === '30d' || raw === '30') return '30d';
  if (raw === 'd60' || raw === '60d' || raw === '60') return '60d';
  if (raw === 'd90' || raw === '90d' || raw === '90') return '90d';
  return null;
}

function rowOverlapsWindow(row, model, key) {
  if (rowWindowKey(row) === key) return true;
  const d0 = model.day_zero_base;
  const end = addDays(d0, WINDOW_DAYS[key]);
  const start = row.data_inicio || row.data_disparo;
  const finish = row.data_fim || row.data_disparo || start;
  if (!d0 || !end || !start || !finish) return false;
  return finish >= d0 && start <= end;
}

function investmentForWindow(model, key, mediaRows, crmRows) {
  const media = mediaRows.filter((row) => row.modelo_id === model.modelo_id && rowOverlapsWindow(row, model, key));
  const crm = crmRows.filter((row) => row.modelo_id === model.modelo_id && rowOverlapsWindow(row, model, key));
  const mediaInvestment = sumKnown(media, 'investimento');
  const crmInvestment = sumKnown(crm, 'investimento');
  const totalParts = [mediaInvestment, crmInvestment].filter((value) => value !== null);
  const manualNoDate = [...media, ...crm].filter((row) => (
    !row.data_inicio && !row.data_fim && !row.data_disparo
  ) || row.data_suspeita);
  return {
    midia_paga: round(mediaInvestment),
    crm: round(crmInvestment),
    outros: null,
    total: totalParts.length ? round(totalParts.reduce((acc, value) => acc + value, 0)) : null,
    linhas_midia_paga: media.length,
    linhas_crm: crm.length,
    investimento_com_data_e_canal: round(sumKnown([...media, ...crm].filter((row) => (
      (row.data_inicio || row.data_disparo) && (row.canal || row.campanha)
    )), 'investimento')),
    investimento_sem_data_confiavel: round(sumKnown(manualNoDate, 'investimento')),
    confiabilidade: manualNoDate.length ? 'declarado_manual_sem_data_confiavel' : media.length || crm.length ? 'declarado_com_data' : 'pendente'
  };
}

function roasForWindow(sales, investment) {
  const paidRevenue = numberOrNull(sales?.canais?.paid?.receita);
  const mediaInvestment = numberOrNull(investment?.midia_paga);
  const totalInvestment = numberOrNull(investment?.total);
  const quality = sales?.canais?.paid?.qualidade || 'pendente';
  if (paidRevenue === null && totalInvestment !== null) {
    return {
      midia_paga: null,
      status: 'investimento_declarado_roas_pendente',
      qualidade_receita: quality,
      observacao: 'Existe investimento, mas a receita atribuida confiavel ainda nao esta disponivel.'
    };
  }
  if (mediaInvestment === null || mediaInvestment === 0) {
    return {
      midia_paga: null,
      status: 'sem_investimento_midia_paga',
      qualidade_receita: quality,
      observacao: 'Sem investimento de midia paga na janela.'
    };
  }
  return {
    midia_paga: ratio(paidRevenue, mediaInvestment, 4),
    status: quality === 'real' ? 'calculado_receita_atribuida' : 'calculado_com_receita_alocada_ou_inferida',
    qualidade_receita: quality,
    observacao: quality === 'real'
      ? 'Receita paga por classificacao de pedido.'
      : 'Valor e leitura do SSOT, nao causalidade absoluta.'
  };
}

function modelWindows(model, rows, mediaRows, crmRows, availableDay, clientsByWindow) {
  const result = {};
  FIXED_WINDOWS.forEach((key) => {
    const endDay = WINDOW_DAYS[key];
    const clientRow = clientsByWindow?.get(`${model.modelo_id}|${key}`) || null;
    const rowsForWindow = availableDay >= endDay ? windowRows(rows, endDay) : [];
    const sales = mergeClientMetrics(rowsForWindow.length ? aggregateSales(rowsForWindow) : null, clientRow);
    const investment = investmentForWindow(model, key, mediaRows, crmRows);
    result[key] = {
      label: windowLabel(key),
      start_day: 0,
      end_day: endDay,
      start_date: model.day_zero_base || null,
      end_date: model.day_zero_base ? addDays(model.day_zero_base, endDay) : null,
      status: clientRow?.status || (availableDay >= endDay ? 'fechada' : availableDay >= 0 ? 'janela_aberta' : 'sem_dados'),
      vendas: sales,
      investimento: investment,
      roas: roasForWindow(sales, investment)
    };
  });
  return result;
}

function nextLaunchExpectation(modelsOut, clientPayload) {
  const baseAtualClientes = numberOrNull(clientPayload?.base_atual?.base_atual_clientes);
  const closedRows = Object.values(modelsOut)
    .flatMap((model) => FIXED_WINDOWS.map((key) => ({
      key,
      model,
      vendas: model.janelas?.[key]?.vendas,
      status: model.janelas?.[key]?.status
    })))
    .filter((row) => row.status === 'fechada' && row.vendas?.receita !== null);

  const byWindow = {};
  FIXED_WINDOWS.forEach((key) => {
    const rows = closedRows.filter((row) => row.key === key);
    const avg = (field) => {
      const values = rows.map((row) => numberOrNull(row.vendas?.[field])).filter((value) => value !== null);
      return values.length ? round(values.reduce((acc, value) => acc + value, 0) / values.length) : null;
    };
    const taxaClientesSobreBase = medianKnown(rows.map((row) => ratio(row.vendas?.clientes_unicos, row.vendas?.base_total_d0, 6)), 6);
    const pedidosPorCliente = medianKnown(rows.map((row) => row.vendas?.pedidos_por_cliente), 4);
    const paresPorCliente = medianKnown(rows.map((row) => row.vendas?.pares_por_cliente ?? row.vendas?.unidades_por_cliente), 4);
    const receitaPorCliente = medianKnown(rows.map((row) => row.vendas?.receita_por_cliente), 2);
    const clientesEsperados = baseAtualClientes !== null && taxaClientesSobreBase !== null
      ? round(baseAtualClientes * taxaClientesSobreBase, 0)
      : null;
    const pedidosEsperados = clientesEsperados !== null && pedidosPorCliente !== null
      ? round(clientesEsperados * pedidosPorCliente, 0)
      : avg('pedidos');
    const paresEsperados = clientesEsperados !== null && paresPorCliente !== null
      ? round(clientesEsperados * paresPorCliente, 0)
      : avg('pares');
    const receitaEsperada = clientesEsperados !== null && receitaPorCliente !== null
      ? round(clientesEsperados * receitaPorCliente)
      : avg('receita');

    byWindow[key] = {
      clientes_esperados: clientesEsperados,
      pedidos_esperados: pedidosEsperados,
      pares_esperados: paresEsperados,
      receita_esperada: receitaEsperada,
      taxa_clientes_sobre_base_mediana: taxaClientesSobreBase,
      pedidos_por_cliente_mediana: pedidosPorCliente,
      pares_por_cliente_mediana: paresPorCliente,
      receita_por_cliente_mediana: receitaPorCliente,
      metodo: clientesEsperados !== null
        ? 'base_atual_clientes_x_mediana_historica_de_clientes_sobre_base'
        : rows.length
          ? 'media_simples_dos_lancamentos_com_janela_fechada_para_metricas_de_venda'
          : 'pendente',
      observacao: clientesEsperados !== null
        ? 'Estimativa usa base atual e comportamento historico das janelas fechadas; nao e forecast causal.'
        : 'Clientes esperados dependem do export agregado de clientes/base; vendas usam historico local como fallback.'
    };
  });

  return {
    base_atual_clientes: baseAtualClientes,
    base_atual_fonte: clientPayload?.base_atual?.fonte || 'pendente_export_ssot_customer_lifecycle_dashboard_latest_v',
    janelas: byWindow
  };
}

function build() {
  const models = readJson('lancamentos_modelos.json', []);
  const salesRows = readJson('lancamentos_produtos_dia.json', []);
  const rampRows = readJson('lancamentos_rampa_dia.json', []);
  const clientPayload = normalizeClientPayload(readJson('lancamentos_clientes_janelas.json', { janelas: [], base_atual: null }));
  const clientsByWindow = clientWindowMap(clientPayload);
  const mediaRows = readJson('midia_paga.json', []);
  const crmRows = readJson('crm_disparos.json', []);
  const manifest = readJson('manifest.json', {});
  const rampCoverage = manifestRampCoverage(manifest);
  const modelsOut = {};

  models.forEach((model) => {
    const d0 = model.day_zero_base || model.data_lancamento || model.data_oficial || null;
    const modelRows = salesRows
      .filter((row) => row.modelo_id === model.modelo_id)
      .map((row) => ({ ...row, __day: numberOrNull(row.dia_desde_d0) ?? dayIndex(d0, row.data) }))
      .filter((row) => numberOrNull(row.__day) !== null && row.__day >= 0);
    const modelRampRows = (rampRows.length ? rampRows : salesRows)
      .filter((row) => row.modelo_id === model.modelo_id)
      .map((row) => ({ ...row, __day: numberOrNull(row.dia_desde_d0) ?? numberOrNull(row.day) ?? dayIndex(d0, row.data) }))
      .filter((row) => numberOrNull(row.__day) !== null && row.__day >= 0);
    const maxDay = modelRampRows.length ? Math.max(...modelRampRows.map((row) => numberOrNull(row.__day))) : -1;
    const hasExtendedRampCoverage = ['historico', 'ativo'].includes(normalizeText(model.status));
    const coveredDay = hasExtendedRampCoverage && rampCoverage.coversCurrentDate && d0 && rampCoverage.data_fim_exportada
      ? dayIndex(d0, rampCoverage.data_fim_exportada)
      : null;
    const exportEndDay = coveredDay !== null ? Math.max(maxDay, coveredDay) : maxDay;
    const exportCappedAtD90 = normalizeText(model.status) === 'historico' && maxDay === 90 && !rampCoverage.coversCurrentDate;
    const daily = dailyRows(modelRampRows);
    const extendedClientRow = clientsByWindow.get(`${model.modelo_id}|extended`) || null;
    const extendedSales = mergeClientMetrics(daily.length ? aggregateSales(windowRows(modelRampRows, maxDay)) : null, extendedClientRow);
    const fixed = modelWindows({ ...model, day_zero_base: d0 }, modelRows, mediaRows, crmRows, exportEndDay, clientsByWindow);
    const extendedInvestment = FIXED_WINDOWS
      .filter((key) => WINDOW_DAYS[key] <= maxDay)
      .map((key) => fixed[key]?.investimento)
      .filter(Boolean)
      .pop() || investmentForWindow({ ...model, day_zero_base: d0 }, '90d', mediaRows, crmRows);
    const hasClientDataForModel = FIXED_WINDOWS.some((key) => (
      fixed[key]?.vendas?.clientes_unicos !== null
      && fixed[key]?.vendas?.clientes_unicos !== undefined
    ));

    modelsOut[model.modelo_id] = {
      modelo_id: model.modelo_id,
      modelo: model.modelo,
      linha: model.linha || null,
      status: model.status || null,
      day_zero_base: d0,
      data_oficial: model.data_oficial || null,
      disponibilidade: {
        ultimo_dia_disponivel: maxDay >= 0 ? maxDay : null,
        ultimo_dia_com_venda: maxDay >= 0 ? maxDay : null,
        ultimo_dia_exportado: exportEndDay >= 0 ? exportEndDay : null,
        ultima_data_disponivel: daily.length ? daily[daily.length - 1].data : null,
        data_fim_exportada: rampCoverage.data_fim_exportada,
        cobertura_export: rampCoverage.status,
        export_atual_limitado_a_d90: exportCappedAtD90,
        janela_estendida_status: maxDay > 90
          ? 'estendida_real'
          : rampCoverage.coversCurrentDate && exportEndDay > maxDay
            ? 'ate_data_atual_com_dias_sem_venda_omitidos'
            : maxDay >= 0 ? 'ate_ultimo_dia_no_json' : 'sem_dados'
      },
      janelas: fixed,
      rampa_estendida: {
        label: 'Ate ultimo dia disponivel no JSON',
        start_day: 0,
        end_day: exportEndDay >= 0 ? exportEndDay : null,
        start_date: d0,
        end_date: exportEndDay >= 0 ? addDays(d0, exportEndDay) : null,
        vendas: extendedSales,
        investimento: extendedInvestment,
        roas: roasForWindow(extendedSales, extendedInvestment),
        vida_util: lifeMetrics(daily),
        daily_points: daily.map((row) => ({
          day: row.day,
          data: row.data,
          receita: row.receita,
          pedidos: row.pedidos,
          pares: row.pares
        }))
      },
      alertas: [
        hasClientDataForModel ? null : 'clientes_unicos_e_base_ativada_pendentes_export_ssot',
        exportCappedAtD90 ? 'export_atual_nao_mostra_pos_d90' : null,
        fixed['90d']?.status === 'janela_aberta' ? 'janela_d90_aberta' : null
      ].filter(Boolean)
    };
  });

  const modelList = Object.values(modelsOut);
  const rampaPosD90Disponivel = modelList.some((model) => (
    numberOrNull(model.disponibilidade?.ultimo_dia_disponivel) > 90
    || numberOrNull(model.disponibilidade?.ultimo_dia_exportado) > 90
  ));
  const algumHistoricoNoD90 = modelList.some((model) => model.disponibilidade?.export_atual_limitado_a_d90);
  const clientesDisponiveis = (clientPayload.janelas || []).some((row) => numberOrNull(row.clientes_unicos) !== null);
  const baseAtualDisponivel = numberOrNull(clientPayload.base_atual?.base_atual_clientes) !== null;

  return {
    generated_at: new Date().toISOString(),
    manifest_generated_at: manifest.generated_at || null,
    source_files: [
      'data/lancamentos_modelos.json',
      'data/lancamentos_rampa_dia.json',
      'data/lancamentos_clientes_janelas.json',
      'data/lancamentos_produtos_dia.json',
      'data/midia_paga.json',
      'data/crm_disparos.json',
      'data/manifest.json'
    ],
    metodologia: {
      vendas: 'Derivado do JSON local de vendas por item/dia; pedidos usam order_sk quando disponivel.',
      clientes: 'Clientes unicos, novos/recorrentes e base ativada usam data/lancamentos_clientes_janelas.json quando o SSOT exporta o agregado sem PII.',
      canais: 'Midia paga, organico e CRM seguem classificacao de pedido existente no payload; alocacao SSOT aparece como qualidade, nao causalidade.',
      investimento: 'Midia paga vem de midia_paga.json; CRM vem de crm_disparos.json; linhas sem data confiavel ficam marcadas.',
      roas: 'ROAS de midia paga usa receita paga classificada e investimento de midia paga. CRM nao entra como midia paga.',
      previsao_base: 'Proximo lancamento usa base atual de clientes x mediana historica de clientes unicos/base D0 quando disponivel; caso contrario usa media simples de vendas fechadas.'
    },
    data_quality: {
      clientes_agregado_disponivel: clientesDisponiveis,
      base_atual_disponivel: baseAtualDisponivel,
      rampa_pos_d90_disponivel: rampaPosD90Disponivel,
      alertas: [
        algumHistoricoNoD90 ? 'lancamentos_produtos_dia.json ainda tem historicos terminando exatamente em D+90; rode o export atualizado para confirmar pos-D90.' : null,
        clientesDisponiveis && baseAtualDisponivel ? null : 'clientes unicos, base ativada e expectativa por base atual exigem export agregado do SSOT.',
        'ROAS com qualidade alocado_ssot/inferido deve ser lido como alocacao ou inferencia, nao atribuicao causal absoluta.'
      ].filter(Boolean)
    },
    modelos: modelsOut,
    proximos_lancamentos: nextLaunchExpectation(modelsOut, clientPayload)
  };
}

const payload = build();
writeJson(OUTPUT, payload);
console.log(JSON.stringify({
  ok: true,
  output: path.relative(ROOT, OUTPUT).replace(/\\/g, '/'),
  modelos: Object.keys(payload.modelos).length,
  generated_at: payload.generated_at
}, null, 2));
