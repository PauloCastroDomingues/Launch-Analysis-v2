const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.join(__dirname, '..');
const DATA = path.join(ROOT, 'data');
const DOCS = path.join(ROOT, 'docs');
const VERSION = '20260925-analysis-contract-v2';
const PHASES = [
  { key: 'd0_d30', label: 'D0-D30', start: 0, end: 30 },
  { key: 'd31_d60', label: 'D31-D60', start: 31, end: 60 },
  { key: 'd61_d90', label: 'D61-D90', start: 61, end: 90 },
  { key: 'd91_d180', label: 'D91-D180', start: 91, end: 180 },
  { key: 'd181_plus', label: 'D181+', start: 181, end: null }
];

function readJson(name, fallback = null) {
  const file = path.join(DATA, name);
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function round(value, digits = 2) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) return null;
  const factor = 10 ** digits;
  return Math.round(Number(value) * factor) / factor;
}

function number(value) {
  return value === null || value === undefined || value === '' || !Number.isFinite(Number(value))
    ? null
    : Number(value);
}

function dateOnly(value) {
  const match = String(value || '').match(/^\d{4}-\d{2}-\d{2}/);
  return match ? match[0] : null;
}

function dayNumber(value) {
  const iso = dateOnly(value);
  return iso ? Math.floor(Date.parse(`${iso}T00:00:00Z`) / 86400000) : null;
}

function daysBetween(start, end) {
  const a = dayNumber(start);
  const b = dayNumber(end);
  return a === null || b === null ? null : b - a;
}

function addDays(date, days) {
  const base = dayNumber(date);
  return base === null ? null : new Date((base + days) * 86400000).toISOString().slice(0, 10);
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + (number(row[field]) || 0), 0);
}

function median(values) {
  const clean = values.map(number).filter((value) => value !== null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const middle = Math.floor(clean.length / 2);
  return clean.length % 2 ? clean[middle] : (clean[middle - 1] + clean[middle]) / 2;
}

function normalizedChannel(row) {
  const raw = String(row.tipo_real || row.canal_real || '').toLowerCase();
  if (!raw || /unmatched|sem.match|unknown|not.set/.test(raw)) return 'unmatched';
  if (/paid|pago|cpc|ppc|ads|pmax/.test(raw)) return 'paid';
  if (/crm|email|whatsapp|sms|owned/.test(raw)) return 'crm';
  if (/organic|organico|seo/.test(raw)) return 'organic';
  return 'other';
}

function distinctOrders(rows) {
  const ids = new Set();
  let fallback = 0;
  rows.forEach((row) => {
    if (row.order_sk) ids.add(String(row.order_sk));
    else fallback += number(row.pedidos_validos ?? row.pedidos) || 0;
  });
  return ids.size + fallback;
}

function aggregate(rows, days = null) {
  const receitaBruta = sum(rows, 'receita_bruta') || sum(rows, 'receita');
  const receitaLiquida = sum(rows, 'receita_liquida');
  const desconto = sum(rows, 'desconto');
  const pares = sum(rows, 'pares');
  const pedidos = distinctOrders(rows);
  return {
    receita_bruta: round(receitaBruta),
    receita_apos_descontos: receitaLiquida ? round(receitaLiquida) : null,
    desconto: desconto ? round(desconto) : 0,
    pedidos,
    pares: round(pares),
    receita_por_dia: days ? round(receitaBruta / days) : null,
    pares_por_dia: days ? round(pares / days, 3) : null,
    valor_bruto_por_par: pares ? round(receitaBruta / pares) : null,
    valor_apos_descontos_por_par: pares && receitaLiquida ? round(receitaLiquida / pares) : null,
    desconto_efetivo_pct: receitaBruta ? round(desconto / receitaBruta, 6) : null
  };
}

function sourceRows(payload) {
  if (Array.isArray(payload)) return payload;
  if (Array.isArray(payload?.rows)) return payload.rows;
  if (Array.isArray(payload?.janelas)) return payload.janelas;
  if (Array.isArray(payload?.launches)) return payload.launches;
  if (Array.isArray(payload?.modelos)) return payload.modelos;
  return [];
}

function logicalRowCount(payload) {
  if (Array.isArray(payload)) return payload.length;
  if (Array.isArray(payload?.rows)) return payload.rows.length;
  if (Array.isArray(payload?.janelas)) return payload.janelas.length;
  if (Array.isArray(payload?.launches)) return payload.launches.length;
  if (payload?.modelos && typeof payload.modelos === 'object') {
    const models = Object.values(payload.modelos);
    const pointRows = models.reduce((total, model) => total + (Array.isArray(model?.pontos) ? model.pontos.length : 0), 0);
    return pointRows || models.length;
  }
  return null;
}

function sourceDateRange(payload) {
  const dates = [];
  const visit = (value, depth = 0) => {
    if (depth > 3 || value === null || value === undefined) return;
    if (typeof value === 'string') {
      const iso = dateOnly(value);
      if (iso) dates.push(iso);
      return;
    }
    if (Array.isArray(value)) value.slice(0, 20000).forEach((item) => visit(item, depth + 1));
    else if (typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
      if (/data|date|generated|updated|inicio|fim|d0/i.test(key)) visit(item, depth + 1);
    });
  };
  visit(payload);
  dates.sort();
  return { min: dates[0] || null, max: dates[dates.length - 1] || null };
}

function sourceInventory(data, manifest) {
  const definitions = {
    'manifest.json': ['controle de snapshot', 'objeto', 'generated_at', 'utilizavel'],
    'lancamentos_modelos.json': ['cadastro de lancamentos', 'lancamento', 'modelo_id', 'requer_validacao'],
    'lancamentos_produtos_dia.json': ['SSOT fct_order_item', 'item de pedido', 'modelo_id + data + order_sk + sku', 'requer_validacao'],
    'lancamentos_rampa_dia.json': ['SSOT agregado', 'lancamento-dia com movimento', 'modelo_id + data', 'utilizavel'],
    'sub_modelos_dia.json': ['SSOT agregado', 'submodelo-dia', 'modelo_id + sub_modelo_id + data_venda', 'utilizavel'],
    'lancamentos_analise_avancada.json': ['derivacao local', 'lancamento-janela', 'modelo_id + janela', 'requer_validacao'],
    'lancamentos_clientes_janelas.json': ['SSOT agregado sem PII', 'lancamento-janela', 'modelo_id + janela', 'utilizavel'],
    'lancamentos_completude_d0.json': ['derivacao local + cobertura SSOT', 'lancamento', 'modelo_id', 'requer_validacao'],
    'share_trajetoria.json': ['contexto de loja', 'lancamento-dia', 'modelo_id + dia', 'requer_validacao'],
    'calendario_br.json': ['cadastro manual', 'evento de calendario', 'data + nome', 'incompleta'],
    'midia_paga.json': ['planilha manual', 'campanha ou total declarado', 'modelo_id + campanha + janela', 'requer_validacao'],
    'crm_disparos.json': ['planilha manual', 'acao declarada', 'modelo_id + data_disparo + campanha', 'incompleta'],
    'estoque.json': ['posicao atual', 'SKU/variacao atual', 'modelo_id + sub_modelo + cor', 'incompleta'],
    'lancamentos_rps_dia.json': ['Bridge + sessoes da loja', 'loja-dia repetido por lancamento', 'modelo_id + data', 'requer_validacao'],
    'metas_mensais.json': ['contexto empresarial', 'mes/dia/canal', 'periodo + canal', 'requer_validacao']
  };
  return Object.entries(definitions).map(([file, definition]) => {
    const payload = data[file];
    if (payload === undefined) return { file: `data/${file}`, origin: definition[0], grain: definition[1], key: definition[2], rows: 0, status: 'ausente_no_pacote' };
    const rows = sourceRows(payload);
    const range = sourceDateRange(payload);
    const sample = rows[0] || payload || {};
    return {
      file: `data/${file}`,
      origin: definition[0],
      grain: definition[1],
      key: definition[2],
      rows: logicalRowCount(payload),
      fields: Object.keys(sample).slice(0, 80),
      date_min: range.min,
      date_max: range.max,
      snapshot: manifest.generated_at || null,
      missing_and_zero: file === 'lancamentos_rampa_dia.json'
        ? 'linha ausente pode ser zero somente ate o corte confirmado no manifest'
        : 'null/ausencia nao deve ser convertido em zero sem cobertura',
      status: definition[3]
    };
  });
}

function repeatedKeys(rows) {
  const counts = new Map();
  rows.forEach((row) => {
    if (!row.modelo_id || !row.data || !row.order_sk || !row.sku) return;
    const key = [row.modelo_id, row.data, row.order_sk, row.sku].join('|');
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const byModel = {};
  for (const [key, count] of counts) {
    if (count < 2) continue;
    const model = key.split('|')[0];
    byModel[model] = (byModel[model] || 0) + 1;
  }
  return { keys: [...counts.values()].filter((count) => count > 1).length, by_model: byModel };
}

function launchRegistry(models, salesRows, asOf) {
  return models.map((model) => {
    const rows = salesRows.filter((row) => row.modelo_id === model.modelo_id && dateOnly(row.data));
    const dates = rows.map((row) => dateOnly(row.data)).filter(Boolean).sort();
    const firstSale = dates[0] || null;
    const official = dateOnly(model.data_oficial || model.data_lancamento);
    const d0 = dateOnly(model.day_zero_base);
    const gap = official && d0 ? daysBetween(official, d0) : null;
    const planned = String(model.status || '').toLowerCase() === 'planejado';
    const d0Status = planned
      ? (d0 && d0 <= asOf ? 'planejado_vencido_sem_realizado' : 'planejado')
      : gap === 0 ? 'confirmado_no_pacote'
        : gap > 0 ? 'provisorio_historico_truncado'
          : 'requer_validacao';
    return {
      launch_id: model.modelo_id,
      name: model.modelo,
      family: model.linha || model.modelo,
      launch_type: model.modelo_id === 'series_2' ? 'relaunch_color' : planned ? 'planned_unconfirmed' : 'unconfirmed',
      official_date: official,
      first_valid_order_date: firstSale,
      source_coverage_start: firstSale,
      analytical_d0: d0,
      d0_gap_days: gap,
      d0_status: d0Status,
      d0_reason: gap === 0 ? 'data oficial e D0 analitico coincidem' : model.observacao || 'requer evidencia',
      d0_evidence: firstSale ? 'primeira venda valida encontrada no export atual' : 'sem venda localizada no pacote',
      decision_version: VERSION,
      commercial_status: model.status || null,
      comparability: d0Status === 'confirmado_no_pacote' ? 'comparavel' : planned ? 'nao_realizado' : 'descritivo_apenas',
      product_scope_rule: model.sku_prefixos || model.termos_busca || null,
      coverage_end: d0 && asOf && d0 <= asOf ? asOf : null,
      observed_age_days: d0 && asOf && d0 <= asOf ? daysBetween(d0, asOf) : null
    };
  });
}

function phaseRowsForLaunch(launch, salesRows) {
  const rows = salesRows.filter((row) => row.modelo_id === launch.launch_id);
  const maxDay = launch.observed_age_days;
  if (launch.commercial_status === 'planejado' || !rows.length) {
    return PHASES.map((phase) => ({
      launch_id: launch.launch_id,
      phase: phase.key,
      label: phase.label,
      start_day: phase.start,
      end_day: phase.end,
      observed_end_day: null,
      start_date: addDays(launch.analytical_d0, phase.start),
      end_date: null,
      status: 'sem_realizado_validado',
      days_expected: phase.end === null ? null : phase.end - phase.start + 1,
      days_covered: 0,
      days_partial: 0,
      days_missing: phase.end === null ? null : phase.end - phase.start + 1,
      coverage_pct: null,
      comparability: launch.comparability,
      metrics: null
    }));
  }
  return PHASES.map((phase) => {
    const effectiveEnd = phase.end === null ? maxDay : Math.min(phase.end, maxDay ?? -1);
    const hasStarted = maxDay !== null && maxDay >= phase.start;
    const isComplete = phase.end === null ? hasStarted : maxDay !== null && maxDay >= phase.end;
    const expectedDays = phase.end === null
      ? (hasStarted ? effectiveEnd - phase.start + 1 : 0)
      : phase.end - phase.start + 1;
    const coveredDays = hasStarted ? Math.max(0, effectiveEnd - phase.start + 1) : 0;
    const selected = hasStarted ? rows.filter((row) => {
      const day = number(row.dia_desde_d0) ?? daysBetween(launch.analytical_d0, row.data);
      return day !== null && day >= phase.start && day <= effectiveEnd;
    }) : [];
    return {
      launch_id: launch.launch_id,
      phase: phase.key,
      label: phase.label,
      start_day: phase.start,
      end_day: phase.end,
      observed_end_day: hasStarted ? effectiveEnd : null,
      start_date: addDays(launch.analytical_d0, phase.start),
      end_date: hasStarted ? addDays(launch.analytical_d0, effectiveEnd) : null,
      status: !hasStarted ? 'janela_nao_iniciada' : isComplete ? (phase.end === null ? 'cauda_observada' : 'fechada') : 'parcial',
      days_expected: expectedDays,
      days_covered: coveredDays,
      days_partial: 0,
      days_missing: hasStarted ? Math.max(0, expectedDays - coveredDays) : expectedDays,
      coverage_pct: expectedDays ? round(coveredDays / expectedDays, 6) : null,
      comparability: launch.comparability,
      metrics: hasStarted ? aggregate(selected, coveredDays) : null
    };
  });
}

function overviewD0D30(launches, salesRows) {
  const observed = launches.filter((launch) => launch.commercial_status !== 'planejado' && launch.analytical_d0);
  const launchById = new Map(observed.map((launch) => [launch.launch_id, launch]));
  const selected = salesRows.filter((row) => {
    const launch = launchById.get(row.modelo_id);
    if (!launch) return false;
    const day = number(row.dia_desde_d0) ?? daysBetween(launch.analytical_d0, row.data);
    return day !== null && day >= 0 && day <= 30;
  });
  const metrics = aggregate(selected, 31);
  const pedidosModeloSoma = observed.reduce((total, launch) => {
    return total + distinctOrders(selected.filter((row) => row.modelo_id === launch.launch_id));
  }, 0);

  return {
    launches: observed.length,
    receita_bruta: metrics.receita_bruta,
    pedidos_unicos: metrics.pedidos,
    pares: metrics.pares,
    pedidos_modelo_soma: pedidosModeloSoma,
    pedidos_multimodelo: Math.max(0, pedidosModeloSoma - metrics.pedidos),
    rule: 'pedidos_unicos usa order_sk distinto entre todos os lancamentos; receita e pares somam itens classificados'
  };
}

function completeWeeks(launch, salesRows) {
  const maxDay = launch.observed_age_days;
  if (maxDay === null || maxDay < 6) return [];
  const rows = salesRows.filter((row) => row.modelo_id === launch.launch_id);
  const count = Math.floor((maxDay + 1) / 7);
  return Array.from({ length: count }, (_, index) => {
    const start = index * 7;
    const end = start + 6;
    const selected = rows.filter((row) => {
      const day = number(row.dia_desde_d0) ?? daysBetween(launch.analytical_d0, row.data);
      return day !== null && day >= start && day <= end;
    });
    const metrics = aggregate(selected, 7);
    return {
      week: index + 1,
      start_day: start,
      end_day: end,
      start_date: addDays(launch.analytical_d0, start),
      end_date: addDays(launch.analytical_d0, end),
      revenue_per_day: metrics.receita_por_dia,
      pairs_per_day: metrics.pares_por_dia,
      orders_per_day: round(metrics.pedidos / 7, 3),
      revenue: metrics.receita_bruta,
      pairs: metrics.pares,
      orders: metrics.pedidos,
      coverage_status: 'complete_confirmed_by_manifest'
    };
  });
}

function currentStability(weeks, tolerance = 0.1) {
  if (weeks.length < 3) return null;
  const peak = weeks.reduce((best, week, index) => !best || week.revenue_per_day > best.value ? { index, value: week.revenue_per_day } : best, null);
  for (let index = Math.max(2, peak.index + 2); index < weeks.length; index += 1) {
    const a = weeks[index - 2].revenue_per_day;
    const b = weeks[index - 1].revenue_per_day;
    const c = weeks[index].revenue_per_day;
    if (!a || !b) continue;
    const change1 = b / a - 1;
    const change2 = c / b - 1;
    if (Math.abs(change1) <= tolerance && Math.abs(change2) <= tolerance) {
      return {
        method: 'legacy_retrospective_peak_then_two_changes',
        version: 'legacy-observed',
        start_week: weeks[index - 1].week,
        start_day: weeks[index - 1].start_day,
        interval_end_day: weeks[index].end_day,
        detected_week: index + 1,
        confirmed_day: weeks[index].end_day,
        level_revenue_per_day: round((a + b + c) / 3),
        future_peak_leakage: true,
        persisted_weeks_observed: weeks.length - index
      };
    }
  }
  return null;
}

function operationalStability(weeks, options = {}) {
  const tolerance = options.tolerance ?? 0.1;
  const holdoutWeeks = options.holdoutWeeks ?? 2;
  if (weeks.length < 3) return { state: 'historico_curto', signal: null };
  for (let index = 2; index < weeks.length; index += 1) {
    const window = weeks.slice(index - 2, index + 1);
    const values = window.map((week) => week.revenue_per_day);
    const pairValues = window.map((week) => week.pairs_per_day);
    const peakToDate = Math.max(...weeks.slice(0, index + 1).map((week) => week.revenue_per_day));
    const changes = [values[1] / values[0] - 1, values[2] / values[1] - 1];
    const drift = values[2] / values[0] - 1;
    const level = median(values);
    const pairLevel = median(pairValues);
    const regular = values.every((value) => value > 0)
      && changes.every((value) => Math.abs(value) <= tolerance)
      && Math.abs(drift) <= tolerance;
    const material = level >= Math.max(500, peakToDate * 0.2) && pairLevel >= 1;
    if (!regular || !material) continue;

    const lower = level * (1 - tolerance * 1.5);
    const upper = level * (1 + tolerance * 1.5);
    const holdout = weeks.slice(index + 1, index + 1 + holdoutWeeks);
    const confirmed = holdout.length === holdoutWeeks && holdout.every((week) => week.revenue_per_day >= lower && week.revenue_per_day <= upper);
    let breakWeek = null;
    for (let cursor = index + 1; cursor < weeks.length - 1; cursor += 1) {
      const outsideA = weeks[cursor].revenue_per_day < lower || weeks[cursor].revenue_per_day > upper;
      const outsideB = weeks[cursor + 1].revenue_per_day < lower || weeks[cursor + 1].revenue_per_day > upper;
      if (outsideA && outsideB) { breakWeek = weeks[cursor].week; break; }
    }
    return {
      state: confirmed
        ? (breakWeek ? 'patamar_interrompido' : 'sinal_confirmado')
        : (breakWeek ? 'sinal_desfeito' : 'sinal_candidato'),
      signal: {
        method: 'operational_three_weeks_plus_holdout',
        version: VERSION,
        tolerance,
        holdout_weeks_required: holdoutWeeks,
        start_week: window[0].week,
        start_day: window[0].start_day,
        detected_week: window[2].week,
        detected_day: window[2].end_day,
        confirmed_week: confirmed ? weeks[index + holdoutWeeks].week : null,
        confirmed_day: confirmed ? weeks[index + holdoutWeeks].end_day : null,
        level_revenue_per_day: round(level),
        level_pairs_per_day: round(pairLevel, 3),
        drift_pct: round(drift, 6),
        persisted_weeks_observed: Math.max(0, weeks.length - index - 1),
        break_week: breakWeek,
        future_peak_leakage: false
      }
    };
  }
  return { state: 'sem_sinal_ate_o_corte', signal: null };
}

function stabilityForLaunch(launch, weeks) {
  const proposed = operationalStability(weeks);
  return {
    launch_id: launch.launch_id,
    comparability: launch.comparability,
    rule_version: VERSION,
    cutoff_date: launch.coverage_end,
    complete_weeks: weeks.length,
    legacy: currentStability(weeks),
    operational: proposed,
    sensitivity: [0.1, 0.15, 0.2].map((tolerance) => {
      const result = operationalStability(weeks, { tolerance });
      return { tolerance, state: result.state, detected_week: result.signal?.detected_week || null, confirmed_week: result.signal?.confirmed_week || null };
    }),
    limitation: launch.comparability === 'descritivo_apenas'
      ? 'D0 oficial nao esta coberto; resultado descreve apenas o trecho observado.'
      : 'Heuristica operacional; regularidade nao prova independencia, sucesso ou causalidade.'
  };
}

function cumulative(weeks, day) {
  const fullWeeks = weeks.filter((week) => week.end_day <= day);
  return fullWeeks.reduce((total, week) => total + week.revenue, 0);
}

function actualAtDay(launch, salesRows, day) {
  const rows = salesRows.filter((row) => row.modelo_id === launch.launch_id).filter((row) => {
    const current = number(row.dia_desde_d0) ?? daysBetween(launch.analytical_d0, row.data);
    return current !== null && current >= 0 && current <= day;
  });
  return aggregate(rows, day + 1);
}

function eligibleReferences(target, originDay, horizon, launches) {
  const originDate = addDays(target.analytical_d0, originDay);
  return launches.filter((candidate) => candidate.launch_id !== target.launch_id
    && candidate.comparability === 'comparavel'
    && candidate.analytical_d0 < target.analytical_d0
    && candidate.observed_age_days >= horizon
    && addDays(candidate.analytical_d0, horizon) <= originDate);
}

function forecastRun(target, originDay, horizon, launches, salesRows) {
  const observed = actualAtDay(target, salesRows, originDay);
  if (!observed.receita_bruta) return null;
  const references = eligibleReferences(target, originDay, horizon, launches);
  const factors = references.map((reference) => {
    const base = actualAtDay(reference, salesRows, originDay).receita_bruta;
    const final = actualAtDay(reference, salesRows, horizon).receita_bruta;
    return base ? { launch_id: reference.launch_id, factor: final / base } : null;
  }).filter(Boolean);
  const recentStart = Math.max(0, originDay - 6);
  const recent = actualAtDay(target, salesRows, originDay).receita_bruta - (recentStart ? actualAtDay(target, salesRows, recentStart - 1).receita_bruta : 0);
  const recentPace = recent / (originDay - recentStart + 1);
  const paceForecast = observed.receita_bruta + recentPace * (horizon - originDay);
  const factorForecast = factors.length ? observed.receita_bruta * median(factors.map((row) => row.factor)) : null;
  const actual = target.observed_age_days >= horizon ? actualAtDay(target, salesRows, horizon).receita_bruta : null;
  const methods = [
    { method: 'recent_7d_pace', predicted: round(paceForecast) },
    { method: 'eligible_historical_multiplier_median', predicted: round(factorForecast) }
  ].map((row) => ({
    ...row,
    actual,
    absolute_error: actual !== null && row.predicted !== null ? round(Math.abs(row.predicted - actual)) : null,
    bias_predicted_minus_actual: actual !== null && row.predicted !== null ? round(row.predicted - actual) : null,
    ape: actual && row.predicted !== null ? round(Math.abs(row.predicted - actual) / actual, 6) : null
  }));
  return {
    id: `${target.launch_id}-d${originDay}-d${horizon}-${VERSION}`,
    target_launch_id: target.launch_id,
    origin_day: originDay,
    origin_date: addDays(target.analytical_d0, originDay),
    horizon_day: horizon,
    horizon_date: addDays(target.analytical_d0, horizon),
    snapshot: target.coverage_end,
    metric: 'receita_bruta_acumulada',
    observed_at_origin: observed.receita_bruta,
    reference_launch_ids: references.map((row) => row.launch_id),
    references_count: references.length,
    methods,
    status: actual === null ? 'forecast_open_horizon' : 'backtest_revised_current_base',
    limitation: references.length < 2 ? 'Amostra de referencias insuficiente para calibracao estatistica.' : null
  };
}

function forecasts(launches, salesRows) {
  const runs = [];
  launches.filter((launch) => launch.comparability === 'comparavel').forEach((target) => {
    [7, 15, 30].forEach((origin) => {
      [30, 60, 90].filter((horizon) => horizon > origin).forEach((horizon) => {
        if (target.observed_age_days >= origin) {
          const run = forecastRun(target, origin, horizon, launches, salesRows);
          if (run && (run.methods[0].actual !== null || (target.observed_age_days < horizon && origin === Math.max(...[7, 15, 30].filter((value) => value <= target.observed_age_days))))) runs.push(run);
        }
      });
    });
  });
  const evaluated = runs.flatMap((run) => run.methods.filter((method) => method.actual !== null && method.predicted !== null).map((method) => ({ ...method, run_id: run.id })));
  const byMethod = [...new Set(evaluated.map((row) => row.method))].map((method) => {
    const rows = evaluated.filter((row) => row.method === method);
    const actualTotal = rows.reduce((total, row) => total + row.actual, 0);
    return {
      method,
      predictions: rows.length,
      distinct_launches: new Set(rows.map((row) => row.run_id.split('-d')[0])).size,
      mae: rows.length ? round(rows.reduce((total, row) => total + row.absolute_error, 0) / rows.length) : null,
      wape: actualTotal ? round(rows.reduce((total, row) => total + row.absolute_error, 0) / actualTotal, 6) : null,
      bias: rows.length ? round(rows.reduce((total, row) => total + row.bias_predicted_minus_actual, 0) / rows.length) : null,
      validation_status: rows.length >= 10 && new Set(rows.map((row) => row.run_id.split('-d')[0])).size >= 5
        ? 'candidate'
        : 'exploratory_small_sample'
    };
  });
  return { runs, backtest_summary: byMethod };
}

function dataRequests() {
  return [
    ['Reconstruir D0 de GT e Avant', 'itens de pedidos validos historicos', 'pedido_item_id, order_sk, SKU, datas comerciais, quantidade, bruto, desconto, status', 'item', '2024-09 ate 2025-12', 'SSOT/legado + Shopify', 'Dados/Engenharia', 'P0', 'unicidade, status, reconciliacao por pedido', 'Desempenho, estabilidade e previsao', 'Sem a abertura real, GT e Avant ficam descritivos.'],
    ['Medir forca e perfil de investimento', 'gasto executado diario', 'data, plataforma, conta, campaign_id, gasto, moeda, launch_id, exclusividade, status', 'campanha-dia', 'D-14 a D+90 de cada lancamento', 'Plataformas de midia/financeiro', 'Midia/Performance', 'P0', 'total de plataforma, moeda, campanhas compartilhadas', 'Investimento, acoes e condicoes', 'Nao e possivel classificar perfil nem calcular receita/gasto defensavel.'],
    ['Interpretar restricao de oferta', 'historico de disponibilidade', 'timestamp, SKU, tamanho, saldo vendavel, publicado, ruptura, reposicao', 'SKU-hora ou SKU-dia', 'D-14 a D+90', 'ERP/Shopify/estoque', 'Produto/Operacoes', 'P0', 'publicado e compravel, fechamento vs intradia', 'Desempenho e estabilidade', 'Quedas podem ser confundidas com menor demanda.'],
    ['Cruzar acoes executadas', 'calendario de esforcos', 'event_id, timestamp, canal, launch_id, tipo, mensagem, publico, executado, custo, evidencia', 'evento', 'D-30 a D+180', 'CRM/conteudo/site/influenciadores', 'Marketing', 'P1', 'evidencia de execucao e deduplicacao', 'Investimento, acoes e condicoes', 'Ausencia de registro nao pode ser lida como ausencia de acao.'],
    ['Separar efeito de preco e mix', 'historico de preco e oferta', 'vigencia, SKU, preco anunciado, preco efetivo, desconto, cashback resgatado, frete, brinde', 'SKU-vigencia', 'D-14 a D+180', 'Shopify/ERP/promocoes', 'Comercial/Ecommerce', 'P1', 'reconciliar desconto de item e pedido', 'Desempenho e expectativa', 'Receita e pares podem divergir sem explicacao.'],
    ['Validar origem de pedidos', 'jornada/atribuicao', 'order_sk, source_order_id, touchpoint, source, medium, campaign, timestamp, regra', 'pedido-touchpoint', 'cobertura integral do snapshot', 'shopify__orders_journey_latest_v', 'Growth/Data', 'P1', 'match rate e cobertura por periodo', 'Investimento e canais', 'Sem match nao pode ser tratado como organico.'],
    ['Montar cenario pre-D0', 'brief do novo lancamento', 'tipo, familia, versoes, data, preco, oferta, estoque, reposicao, plano de midia, calendario', 'lancamento', 'versao vigente antes do D0', 'brief aprovado', 'Produto/Marketing', 'P1', 'data da premissa e responsavel', 'Expectativa', 'Nao existe alvo condicionado; qualquer numero seria manual.'],
    ['Medir conversao de produto', 'funil por produto', 'data, produto, sessoes, view, add_to_cart, checkout, compra, dispositivo, origem', 'produto-dia', 'D-14 a D+90', 'Shopify/analytics validado', 'Ecommerce/Data', 'P2', 'definicao de sessao e tracking', 'Aprofundamento', 'RPS da loja nao pode ser atribuido ao produto.']
  ].map((row) => Object.fromEntries(['question', 'dataset', 'minimum_fields', 'grain', 'period', 'probable_source', 'suggested_owner', 'priority', 'validation', 'view_unlocked', 'consequence'].map((key, index) => [key, row[index]])));
}

function fieldMatrix() {
  return [
    ['Identidade estavel do lancamento', 'data/lancamentos_modelos.json', 'modelo_id', 'preservar chave; nao inferir pelo nome no frontend', 'unicidade e vinculo SKU', 'todas'],
    ['D0 analitico', 'data/lancamentos_modelos.json', 'day_zero_base', 'data local; sem fallback para data oficial', 'comparar com primeira venda e cobertura', 'desempenho, estabilidade, expectativa'],
    ['Data oficial', 'data/lancamentos_modelos.json', 'data_oficial', 'contexto separado do D0', 'evidencia de cadastro', 'qualidade e comparabilidade'],
    ['Pedido distinto', 'data/lancamentos_produtos_dia.json', 'order_sk', 'COUNT DISTINCT no recorte', 'pedido multi-item e multi-lancamento', 'desempenho'],
    ['Pares comerciais', 'data/lancamentos_produtos_dia.json', 'pares', 'soma na mesma base temporal', 'separar brindes e ofertas por quantidade', 'desempenho'],
    ['Receita bruta', 'data/lancamentos_produtos_dia.json', 'receita_bruta', 'soma por fase/semana', 'reconciliar com SSOT', 'desempenho e expectativa'],
    ['Receita apos descontos', 'data/lancamentos_produtos_dia.json', 'receita_liquida', 'renomear na exibicao; nao chamar lucro', 'reconciliar desconto alocado', 'detalhe de desempenho'],
    ['Cobertura diaria', 'data/manifest.json + lancamentos_rampa_dia.json', 'generated_at + data', 'zero apenas entre D0 e corte confirmado', 'dias esperados, cobertos e faltantes', 'todas'],
    ['Origem do pedido', 'data/lancamentos_produtos_dia.json', 'tipo_real/canal_real', 'manter unmatched separado', 'match rate por lancamento e periodo', 'condicoes'],
    ['Gasto executado', 'data/midia_paga.json', 'investimento/data_inicio/data_fim/canal', 'nao ratear nem somar sobreposicoes', 'escopo, moeda e datas', 'condicoes'],
    ['Acao executada', 'data/crm_disparos.json', 'data_disparo/campanha/canal', 'evento contextual separado da venda', 'evidencia e completude do calendario', 'condicoes'],
    ['Disponibilidade', 'data/estoque.json', 'estoque_atual', 'somente posicao atual', 'historico por SKU/tamanho/publicacao', 'condicoes'],
    ['RPS', 'data/lancamentos_rps_dia.json', 'receita_total/sessoes', 'contexto da loja alinhado ao calendario', 'nao atribuir ao produto', 'condicoes']
  ].map((row) => Object.fromEntries(['need', 'source', 'field', 'transformation', 'validation', 'view'].map((key, index) => [key, row[index]])));
}

function evidenceLog(launches, stability, forecastData, quality) {
  const launchName = (id) => launches.find((row) => row.launch_id === id)?.name || id;
  const entries = [
    {
      id: 'd0-gt-avant', question: 'GT e Avant permitem comparar a abertura?', launches: ['gt', 'avant'],
      fact: 'A data oficial antecede o D0 analitico e a primeira venda localizada no pacote.',
      reading: 'O trecho observado pode ser descrito, mas nao representa a abertura comercial completa.',
      hypothesis: 'O historico anterior pode estar em fonte legada ou fora da cobertura atual.',
      limitation: 'Sem transacao anterior reconciliada, nao e possivel reconstruir D0 real.',
      data_needed: 'Historico de itens validos desde as datas oficiais.', status: 'confirmed_restriction'
    },
    {
      id: 'repeated-order-sku-date', question: 'As chaves repetidas sao duplicacoes?', launches: Object.keys(quality.repeated_order_sku_date_keys.by_model),
      fact: `${quality.repeated_order_sku_date_keys.keys} chaves modelo+data+pedido+SKU aparecem mais de uma vez.`,
      reading: 'As vendas foram preservadas porque a chave nao identifica necessariamente o item real.',
      hypothesis: 'Podem ser itens legitimos, split operacional ou duplicacao de origem.',
      limitation: 'O pacote publico nao traz identificador bruto do item.',
      data_needed: 'order_item_id e conciliacao na SSOT.', status: 'open_investigation'
    }
  ];
  stability.filter((row) => row.operational.signal).forEach((row) => entries.push({
    id: `stability-${row.launch_id}`,
    question: `Quando ${launchName(row.launch_id)} apresentou ritmo regular?`,
    launches: [row.launch_id],
    fact: `Estado ${row.operational.state}; sinal detectavel na semana ${row.operational.signal.detected_week}, patamar de ${row.operational.signal.level_revenue_per_day} reais/dia.`,
    reading: row.operational.state === 'sinal_confirmado' ? 'A regularidade persistiu no holdout observado.' : 'O padrao ainda nao sustenta um patamar confirmado e persistente.',
    hypothesis: 'Oferta, apoio, mix ou disponibilidade podem ter mudado junto com o ritmo.',
    limitation: 'Heuristica observacional sem historico completo das condicoes.',
    data_needed: 'Gasto diario, acoes, oferta e disponibilidade historica.', status: row.operational.state
  }));
  forecastData.backtest_summary.forEach((row) => entries.push({
    id: `forecast-${row.method}`,
    question: 'O metodo pode orientar um novo lancamento?', launches: [],
    fact: `${row.predictions} previsoes avaliadas em ${row.distinct_launches} lancamentos; WAPE ${row.wape}.`,
    reading: 'O erro foi medido, mas a quantidade de lancamentos independentes e pequena.',
    hypothesis: 'O metodo pode melhorar com referencias mais semelhantes e condicoes documentadas.',
    limitation: 'Simulacao retrospectiva em base revisada; origens repetidas nao sao experimentos independentes.',
    data_needed: 'Mais lancamentos elegiveis e snapshots historicos.', status: row.validation_status
  }));
  return entries;
}

function sourceSignatures(files) {
  return Object.fromEntries(files.map((file) => {
    const bytes = fs.readFileSync(path.join(DATA, file));
    return [`data/${file}`, `sha256:${crypto.createHash('sha256').update(bytes).digest('hex')}`];
  }));
}

function metricDictionary() {
  return [
    ['receita_acumulada', 'Tamanho acumulado ate D+h', 'soma receita_bruta de D0 a D+h inclusivo', 'R$', 'item de pedido -> lancamento-janela', 'null se a janela nao tem cobertura'],
    ['receita_fase', 'Resultado de fase sem sobreposicao', 'soma receita_bruta entre a e b inclusivos', 'R$', 'lancamento-fase', 'fase parcial identificada'],
    ['receita_por_dia', 'Velocidade de receita', 'receita da fase / dias calendario cobertos', 'R$/dia', 'lancamento-fase', 'nao divide apenas por dias com venda'],
    ['pares_por_dia', 'Velocidade fisica', 'pares comerciais / dias calendario cobertos', 'pares/dia', 'lancamento-fase', 'brinde operacional nao identificado no pacote'],
    ['valor_bruto_por_par', 'Componente de preco/mix', 'receita_bruta / pares', 'R$/par', 'lancamento-fase', 'nao e ticket por pedido'],
    ['desconto_efetivo', 'Reducao observada sobre bruto', 'desconto / receita_bruta', '%', 'lancamento-fase', 'depende da alocacao de desconto da fonte'],
    ['participacao_loja', 'Peso da linha no mesmo calendario', 'receita_lancamento / receita_loja nas mesmas datas', '%', 'lancamento-periodo', 'share_trajetoria requer validacao de base'],
    ['ritmo_semanal', 'Velocidade em semana fixa', 'soma D+7k..D+7k+6 / 7', 'R$/dia ou pares/dia', 'lancamento-semana', 'somente semanas completas'],
    ['receita_gasto_comercial', 'Razao observacional', 'receita comercial definida / gasto validado', 'x', 'lancamento-fase', 'nao e retorno incremental nem ROAS causal']
  ].map((row) => Object.fromEntries(['name', 'purpose', 'formula', 'unit', 'grain', 'null_zero_rule'].map((key, index) => [key, row[index]])));
}

function migrationMap() {
  return [
    ['Visao geral + Pulso comercial', 'Quanto vendeu e como mudou?', 'mistura desempenho, trafego e eficiencia', 'Desempenho por idade', 'alterada', 'separa escala, ritmo e cobertura'],
    ['Evolucao comparativa', 'Como evoluiu?', 'acumulado e estabilidade no mesmo modulo', 'Desempenho + Estabilidade', 'mantida como detalhe', 'graficos de linha permanecem'],
    ['RPS / autosustentacao', 'Vende sem apoio?', 'RPS e da loja e nao prova independencia do produto', 'Investimento, acoes e condicoes', 'rotulo restringido', 'contexto da loja, sem causalidade'],
    ['Clientes e base', 'Quem comprou?', 'nao mede recompra posterior', 'Detalhe de Desempenho/Expectativa', 'mantida', 'apoio, nao pagina principal'],
    ['Mix comercial', 'O que compoe o resultado?', 'detalhe isolado', 'Detalhe de Desempenho', 'mantida', 'explica diferenca de pares e valor'],
    ['Investimento e canais', 'O que mudou junto?', 'gasto manual sem escopo consistente', 'Investimento, acoes e condicoes', 'alterada', 'separa fato, cobertura e hipotese'],
    ['Cenario D+90', 'Quanto pode fechar?', 'sem backtest temporal e aceita D0 truncado', 'Expectativa', 'alterada', 'somente execucoes salvas e status exploratorio']
  ].map((row) => Object.fromEntries(['current_view', 'current_question', 'problem', 'new_location', 'decision', 'reason'].map((key, index) => [key, row[index]])));
}

function qualityReport(manifest, launches, salesRows, inventory) {
  const repeated = repeatedKeys(salesRows);
  const orderIds = new Map();
  salesRows.forEach((row) => {
    if (!row.order_sk) return;
    const current = orderIds.get(row.modelo_id) || { total: new Set(), matched: new Set() };
    current.total.add(row.order_sk);
    if (normalizedChannel(row) !== 'unmatched') current.matched.add(row.order_sk);
    orderIds.set(row.modelo_id, current);
  });
  const attribution = [...orderIds.entries()].map(([launch_id, sets]) => ({
    launch_id,
    orders_total: sets.total.size,
    orders_with_origin: sets.matched.size,
    coverage_pct: sets.total.size ? round(sets.matched.size / sets.total.size, 6) : null
  }));
  return {
    snapshot: manifest.generated_at || null,
    repeated_order_sku_date_keys: repeated,
    d0_restrictions: launches.filter((launch) => launch.comparability !== 'comparavel').map((launch) => ({ launch_id: launch.launch_id, status: launch.d0_status })),
    attribution_coverage: attribution,
    attribution_manifest_mismatch: manifest.data_quality?.atribuicao_canal?.cobertura_pedidos_pct === 1
      ? 'manifest usa cobertura de classificacao/reconciliacao, mas a cobertura real de origem e menor; sem match permanece separado'
      : null,
    source_status_counts: inventory.reduce((out, row) => ({ ...out, [row.status]: (out[row.status] || 0) + 1 }), {}),
    facts: [
      'Vendas do pacote usam fct_order_item com pedido valido e order_sk.',
      'RPS e receita/sessoes da loja, nao uma metrica de produto.',
      'Estoque disponivel e posicao atual, nao historico.',
      'Midia e CRM manuais nao sustentam causalidade nem perfil diario completo.'
    ],
    hypotheses: [
      'Mudancas de venda podem coincidir com midia, CRM, oferta ou disponibilidade; o pacote nao identifica efeito causal.',
      'Chaves repetidas em GT e Avant podem ser linhas legitimas ou problema operacional; nao foram deduplicadas.'
    ]
  };
}

function csvEscape(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function renderAudit(contract) {
  const lines = [
    '# Auditoria de dados, metodos e visoes de lancamentos',
    '',
    `- Contrato: \`${contract.version}\``,
    `- Snapshot analisado: \`${contract.snapshot}\``,
    `- Gerado em: \`${contract.generated_at}\``,
    '- Escopo: dados e dashboard local; sem publicacao e sem alterar fontes canonicas.',
    '',
    '## Matriz principal',
    '',
    '| Pergunta | Dado disponivel | Regra existente | Problema | Correcao aplicada | Dado faltante | Visao |',
    '|---|---|---|---|---|---|---|',
    '| Desempenho por idade | itens, rampa e submodelos | acumulados D+ | mistura tamanho e ritmo; fases sobrepostas | fases nao sobrepostas, dias cobertos e pares/receita por dia | historico anterior ao D0 de GT/Avant | Desempenho |',
    '| Estabilidade | rampa por dia | pico global + duas variacoes de 10% | usa pico futuro, zeros implicitos e nao testa persistencia | detector operacional sem futuro, volume minimo, holdout e sensibilidade | disponibilidade e apoio historicos | Estabilidade |',
    '| Expectativa | vendas e datas D0 | multiplicador ate D90 | referencias truncadas e sem backtest temporal | referencias elegiveis por calendario, execucoes salvas e erro | brief pre-D0 e mais lancamentos independentes | Expectativa |',
    '| Condicoes | midia, CRM, estoque atual e RPS loja | leitura conjunta | cobertura desigual e risco causal | fontes separadas, status e bloqueios explicitos | gasto diario, acoes, oferta e estoque historico | Condicoes |',
    '',
    '## Cadastro e comparabilidade',
    '',
    '| Lancamento | D0 oficial | D0 analitico | Primeiro pedido | Status D0 | Uso |',
    '|---|---:|---:|---:|---|---|',
    ...contract.launch_registry.map((row) => `| ${row.name} | ${row.official_date || '-'} | ${row.analytical_d0 || '-'} | ${row.first_valid_order_date || '-'} | ${row.d0_status} | ${row.comparability} |`),
    '',
    '## Qualidade que muda a leitura',
    '',
    `- Chaves repetidas modelo+data+pedido+SKU: **${contract.quality_report.repeated_order_sku_date_keys.keys}**. Nao foram removidas.`,
    `- GT: ${contract.quality_report.repeated_order_sku_date_keys.by_model.gt || 0}; Avant: ${contract.quality_report.repeated_order_sku_date_keys.by_model.avant || 0}.`,
    `- Atribuicao: ${contract.quality_report.attribution_manifest_mismatch || 'sem divergencia de rotulo identificada'}.`,
    '- Ausencia de linha diaria vira zero somente dentro da cobertura confirmada pelo manifesto.',
    '',
    '## Fontes',
    '',
    '| Arquivo | Grao | Linhas | Periodo observado | Status |',
    '|---|---|---:|---|---|',
    ...contract.source_inventory.map((row) => `| ${row.file} | ${row.grain} | ${row.rows ?? '-'} | ${row.date_min || '-'} a ${row.date_max || '-'} | ${row.status} |`),
    '',
    '## Matriz de campos',
    '',
    '| Necessidade | Fonte | Campo | Transformacao | Validacao | Visao |',
    '|---|---|---|---|---|---|',
    ...contract.field_matrix.map((row) => `| ${row.need} | ${row.source} | ${row.field} | ${row.transformation} | ${row.validation} | ${row.view} |`),
    '',
    '## Estabilidade',
    '',
    '- Regra legada reproduzida: pico de todo o historico seguido da primeira sequencia de duas variacoes semanais dentro de 10%.',
    '- Regra operacional v1: tres semanas completas, variacoes e deriva dentro da tolerancia, nivel material, confirmacao por duas semanas futuras observadas e quebra registrada.',
    '- O metodo permanece heuristico; regularidade nao significa sucesso, independencia de midia ou demanda irrestrita.',
    '',
    '| Lancamento | Semanas | Legado detectado | Operacional | Detectado | Confirmado |',
    '|---|---:|---:|---|---:|---:|',
    ...contract.stability_events.map((row) => `| ${row.launch_id} | ${row.complete_weeks} | ${row.legacy?.detected_week || '-'} | ${row.operational.state} | ${row.operational.signal?.detected_week || '-'} | ${row.operational.signal?.confirmed_week || '-'} |`),
    '',
    '## Previsao e teste temporal',
    '',
    ...contract.forecasts.backtest_summary.map((row) => `- ${row.method}: ${row.predictions} previsoes avaliadas, ${row.distinct_launches} lancamentos, MAE ${row.mae ?? '-'}, WAPE ${row.wape ?? '-'}, status ${row.validation_status}.`),
    ...(contract.forecasts.backtest_summary.length ? [] : ['- Nenhum backtest temporal elegivel neste snapshot.']),
    '- Minimo/maximo de analogos nao e intervalo de confianca. Com a amostra atual, previsoes permanecem exploratorias.',
    '',
    '## Artefatos',
    '',
    '- `data/launch_analysis_contract.json`: contrato consumido pelas visoes.',
    '- `data/lancamentos_completude_d0.json`: cobertura entre D0 oficial e o corte.',
    '- `docs/data_requests_20260924.csv`: solicitacoes priorizadas de dados.',
    '- `scripts/test_launch_analysis_contract.js`: testes de tempo, cobertura, estabilidade e previsao.',
    ''
  ];
  return `${lines.join('\n')}\n`;
}

function build() {
  const manifest = readJson('manifest.json', {});
  const models = readJson('lancamentos_modelos.json', []);
  const salesRows = readJson('lancamentos_produtos_dia.json', []);
  const rampRows = readJson('lancamentos_rampa_dia.json', []);
  const asOf = dateOnly(manifest.generated_at) || sourceDateRange(salesRows).max;
  const files = fs.readdirSync(DATA).filter((file) => file.endsWith('.json') && file !== 'launch_analysis_contract.json');
  const data = Object.fromEntries(files.map((file) => [file, readJson(file)]));
  const inventory = sourceInventory(data, manifest);
  const launches = launchRegistry(models, salesRows, asOf);
  const weeksByLaunch = Object.fromEntries(launches.map((launch) => [launch.launch_id, completeWeeks(launch, rampRows)]));
  const forecastData = forecasts(launches, salesRows);
  const stability = launches.filter((launch) => launch.commercial_status !== 'planejado').map((launch) => stabilityForLaunch(launch, weeksByLaunch[launch.launch_id]));
  const quality = qualityReport(manifest, launches, salesRows, inventory);
  return {
    version: VERSION,
    generated_at: new Date().toISOString(),
    snapshot: manifest.generated_at || asOf,
    timezone: 'America/Sao_Paulo',
    source_signatures: sourceSignatures(files),
    source_inventory: inventory,
    launch_registry: launches,
    field_matrix: fieldMatrix(),
    metric_dictionary: metricDictionary(),
    overview_d0_d30: overviewD0D30(launches, salesRows),
    performance_phases: launches.flatMap((launch) => phaseRowsForLaunch(launch, salesRows)),
    launch_weeks: weeksByLaunch,
    stability_events: stability,
    conditions: {
      paid_media: { status: 'requer_validacao', rows: readJson('midia_paga.json', []).length, limitation: 'janelas, escopo e sobreposicoes nao permitem gasto diario validado por lancamento' },
      crm: { status: 'incompleta', rows: readJson('crm_disparos.json', []).length, limitation: 'calendario registrado nao prova calendario completo nem efeito da acao' },
      stock: { status: 'incompleta', rows: readJson('estoque.json', []).length, limitation: 'posicao atual; nao mede disponibilidade historica ou grade compravel' },
      rps: { status: 'contexto_loja', limitation: 'receita/sessoes da loja; nao mede performance individual do produto' },
      offers: { status: 'ausente_no_pacote', limitation: 'preco, desconto, cashback, frete e brindes nao possuem historico estruturado' }
    },
    forecasts: forecastData,
    planned_launches: launches.filter((launch) => launch.commercial_status === 'planejado').map((launch) => ({
      launch_id: launch.launch_id,
      status: launch.d0_status,
      expectation_status: 'bloqueada_sem_brief_e_sem_realizado_validado',
      missing: ['tipo confirmado', 'preco e oferta', 'estoque por variante', 'plano de midia por fase', 'calendario executado']
    })),
    quality_report: quality,
    evidence_log: evidenceLog(launches, stability, forecastData, quality),
    data_requests: dataRequests(),
    view_migration: migrationMap(),
    acceptance: {
      canonical_sources_unchanged: true,
      missing_is_not_zero_outside_confirmed_coverage: true,
      d0_inclusive: true,
      weeks_are_d0_d6: true,
      forecast_excludes_target_and_future_references: true,
      no_publication: true
    }
  };
}

function writeOutputs(contract) {
  fs.writeFileSync(path.join(DATA, 'launch_analysis_contract.json'), `${JSON.stringify(contract, null, 2)}\n`);
  fs.writeFileSync(path.join(DOCS, 'launch_analysis_audit_20260924.md'), renderAudit(contract));
  const requests = contract.data_requests;
  const headers = Object.keys(requests[0]);
  const csv = [headers.map(csvEscape).join(','), ...requests.map((row) => headers.map((key) => csvEscape(row[key])).join(','))].join('\r\n');
  fs.writeFileSync(path.join(DOCS, 'data_requests_20260924.csv'), `${csv}\r\n`);
}

if (require.main === module) {
  const contract = build();
  writeOutputs(contract);
  console.log(JSON.stringify({
    ok: true,
    version: contract.version,
    launches: contract.launch_registry.length,
    phases: contract.performance_phases.length,
    stability_events: contract.stability_events.length,
    forecast_runs: contract.forecasts.runs.length,
    output: 'data/launch_analysis_contract.json'
  }, null, 2));
}

module.exports = {
  VERSION,
  PHASES,
  build,
  addDays,
  daysBetween,
  aggregate,
  currentStability,
  operationalStability,
  eligibleReferences,
  forecastRun
};
