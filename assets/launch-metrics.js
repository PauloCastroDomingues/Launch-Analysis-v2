/* Shared rules for local exports and both dashboard views. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReiseLaunchMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '20260909-launch-review-v1';
  const SOURCES = ['lancamentos_modelos', 'lancamentos_produtos_dia', 'lancamentos_rampa_dia', 'lancamentos_clientes_janelas', 'midia_paga', 'crm_disparos', 'manifest'];
  const number = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function channelType(row = {}) {
    const type = norm(row.tipo_real || row.tipo || row.tipo_canal || row.channel_type);
    const text = type || norm([row.canal_real, row.canal, row.raw_medium, row.raw_source].join(' '));
    if (!text || /unmatched|nao atribuido|sem match|sem origem|sem atribuicao|unattributed|unknown|not set/.test(text)) return 'unmatched';
    if (/(^| )(paid|pago|midia paga|ads|cpc|ppc|pmax)( |$)/.test(text)) return 'paid';
    if (/(^| )(crm|owned|email|e mail|whatsapp|sms|newsletter)( |$)/.test(text)) return 'crm';
    if (/(^| )(organic|organico|seo)( |$)/.test(text)) return 'organic';
    return 'other';
  }
  function channels(rows) {
    const out = Object.fromEntries(['paid','organic','crm','other','unmatched'].map(k => [k, { receita: 0, pedidos: 0, pares: 0, ids: new Set(), fallback: 0 }]));
    for (const row of rows) {
      const b = out[channelType(row)];
      b.receita += number(row.receita_bruta ?? row.receita) || 0;
      b.pares += number(row.pares) || 0;
      if (row.order_sk) b.ids.add(row.order_sk);
      else b.fallback += number(row.pedidos_validos ?? row.pedidos) || 0;
    }
    for (const b of Object.values(out)) { b.pedidos = b.ids.size + b.fallback; delete b.ids; delete b.fallback; }
    return out;
  }
  function signature(payload) {
    const text = JSON.stringify(payload); let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return text.length + ':' + (hash >>> 0).toString(16);
  }
  const sourceSignatures = data => Object.fromEntries(SOURCES.map(k => [k, signature(data[k])]));
  function derivedMatches(data) {
    const derived = data.lancamentos_analise_avancada;
    return Boolean(derived && derived.rules_version === VERSION && SOURCES.every(k => derived.source_signatures?.[k] === signature(data[k])));
  }
  function audit(data) {
    const keys = new Map(), byModel = {};
    for (const row of data.lancamentos_produtos_dia || []) {
      if (!row.order_sk || !row.sku) continue;
      const key = [row.modelo_id, row.data, row.order_sk, row.sku].join('|');
      const count = keys.get(key) || 0;
      if (count === 1) byModel[row.modelo_id] = (byModel[row.modelo_id] || 0) + 1;
      keys.set(key, count + 1);
    }
    return { repeated_keys_by_model: byModel, repeated_keys: Object.values(byModel).reduce((a,b) => a+b,0),
      reference_models: (data.lancamentos_modelos || []).filter(m => m.data_oficial && m.day_zero_base !== m.data_oficial).map(m => m.modelo_id) };
  }
  function investmentForWindow(model, key, mediaRows, crmRows) {
    const days = Number(String(key).replace('d',''));
    const start = model.day_zero_base;
    const end = start && Number.isFinite(days) ? new Date(Date.parse(start) + days * 86400000).toISOString().slice(0,10) : null;
    const sameKey = row => norm(row.janela).replace(/ /g,'') === key || norm(row.janela).replace(/ /g,'') === 'd'+days;
    const allMedia = mediaRows.filter(r => r.modelo_id === model.modelo_id);
    const media = allMedia.filter(r => sameKey(r) || (r.data_inicio && r.data_fim && r.data_inicio <= end && r.data_fim >= start));
    // Window totals are never added to overlapping campaigns or prorated into shorter windows.
    const exact = media.filter(r => r.data_inicio === start && r.data_fim === end && !r.data_suspeita && !r.valor_suspeito && r.escopo_investimento_validado === true);
    const channelKeys = exact.map(r => norm(r.canal));
    const usable = exact.length > 0 && exact.length === media.length && channelKeys.every(Boolean) && new Set(channelKeys).size === channelKeys.length;
    const sum = rows => rows.length && rows.every(r => number(r.investimento) !== null) ? rows.reduce((s,r) => s + number(r.investimento),0) : null;
    const crm = crmRows.filter(r => r.modelo_id === model.modelo_id && r.data_disparo >= start && r.data_disparo <= end);
    const paid = usable ? sum(exact) : null;
    const crmSpend = sum(crm);
    return { midia_paga: paid, crm: crmSpend, total: paid !== null && crmSpend !== null ? paid + crmSpend : null,
      outros: null, linhas_midia_paga: media.length, linhas_crm: crm.length,
      investimento_com_data_e_canal: paid, investimento_sem_data_confiavel: null,
      confiabilidade: usable ? 'escopo_validado' : 'pendente_validacao_janela_e_escopo',
      observacao: 'Janela inclusiva D0 a D+'+days+'. Totais acumulados, campanhas sobrepostas e escopo sem valida??o n?o s?o somados. CRM mostra apenas a??es registradas.',
      valores_declarados: media.filter(sameKey).map(r => ({ campanha: r.campanha, investimento: number(r.investimento), data_inicio: r.data_inicio || null, data_fim: r.data_fim || null })) };
  }
  const isoDate = value => String(value || '').slice(0, 10);
  const dateValue = value => {
    const iso = isoDate(value);
    const parsed = /^\d{4}-\d{2}-\d{2}$/.test(iso) ? new Date(`${iso}T12:00:00Z`) : null;
    return parsed && Number.isFinite(parsed.getTime()) ? parsed : null;
  };
  const daysBetween = (start, end) => {
    const a = dateValue(start), b = dateValue(end);
    return a && b ? Math.round((b - a) / 86400000) : null;
  };
  const addDays = (value, days) => {
    const date = dateValue(value);
    if (!date) return null;
    date.setUTCDate(date.getUTCDate() + Number(days || 0));
    return date.toISOString().slice(0, 10);
  };
  const round = (value, digits = 2) => {
    if (!Number.isFinite(value)) return null;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  };
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    if (!sorted.length) return null;
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  };
  function completeLaunchWeeks(launch, rows, cutoffDate) {
    const d0 = isoDate(launch.analytical_d0 || launch.day_zero_base);
    const cutoff = isoDate(cutoffDate);
    const elapsedDays = daysBetween(d0, cutoff);
    const completeWeeks = elapsedDays === null || elapsedDays < 6 ? 0 : Math.floor((elapsedDays + 1) / 7);
    const buckets = Array.from({ length: completeWeeks }, (_, index) => ({
      week: index + 1,
      start_day: index * 7,
      end_day: index * 7 + 6,
      start_date: addDays(d0, index * 7),
      end_date: addDays(d0, index * 7 + 6),
      revenue: 0,
      pairs: 0,
      orders: 0
    }));
    for (const row of rows || []) {
      if (row.modelo_id !== launch.launch_id) continue;
      const day = number(row.dia_desde_d0) ?? daysBetween(d0, row.data);
      if (day === null || day < 0) continue;
      const weekIndex = Math.floor(day / 7);
      if (!buckets[weekIndex]) continue;
      buckets[weekIndex].revenue += number(row.receita_bruta ?? row.receita) || 0;
      buckets[weekIndex].pairs += number(row.pares) || 0;
      buckets[weekIndex].orders += number(row.pedidos_validos ?? row.pedidos) || 0;
    }
    return buckets.map(week => ({
      ...week,
      revenue_per_day: round(week.revenue / 7),
      pairs_per_day: round(week.pairs / 7, 3),
      orders_per_day: round(week.orders / 7, 3),
      revenue: round(week.revenue),
      coverage_status: 'complete_confirmed_by_manifest'
    }));
  }
  function legacyStability(weeks, tolerance = 0.1) {
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
      const values = window.map(week => week.revenue_per_day);
      const pairValues = window.map(week => week.pairs_per_day);
      const peakToDate = Math.max(...weeks.slice(0, index + 1).map(week => week.revenue_per_day));
      const changes = [values[1] / values[0] - 1, values[2] / values[1] - 1];
      const drift = values[2] / values[0] - 1;
      const level = median(values);
      const pairLevel = median(pairValues);
      const regular = values.every(value => value > 0)
        && changes.every(value => Math.abs(value) <= tolerance)
        && Math.abs(drift) <= tolerance;
      const material = level >= Math.max(500, peakToDate * 0.2) && pairLevel >= 1;
      if (!regular || !material) continue;
      const lower = level * (1 - tolerance * 1.5);
      const upper = level * (1 + tolerance * 1.5);
      const holdout = weeks.slice(index + 1, index + 1 + holdoutWeeks);
      const confirmed = holdout.length === holdoutWeeks && holdout.every(week => week.revenue_per_day >= lower && week.revenue_per_day <= upper);
      let breakWeek = null;
      for (let cursor = index + 1; cursor < weeks.length - 1; cursor += 1) {
        const outsideA = weeks[cursor].revenue_per_day < lower || weeks[cursor].revenue_per_day > upper;
        const outsideB = weeks[cursor + 1].revenue_per_day < lower || weeks[cursor + 1].revenue_per_day > upper;
        if (outsideA && outsideB) { breakWeek = weeks[cursor].week; break; }
      }
      return {
        state: confirmed ? (breakWeek ? 'patamar_interrompido' : 'sinal_confirmado') : (breakWeek ? 'sinal_desfeito' : 'sinal_candidato'),
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
  function stabilityEvents(launches, rows, cutoffDate) {
    return (launches || []).map(launch => {
      const weeks = completeLaunchWeeks(launch, rows, cutoffDate);
      const operational = operationalStability(weeks);
      return {
        launch_id: launch.launch_id,
        comparability: launch.comparability,
        rule_version: VERSION,
        cutoff_date: isoDate(cutoffDate),
        complete_weeks: weeks.length,
        legacy: legacyStability(weeks),
        operational,
        sensitivity: [0.1, 0.15, 0.2].map(tolerance => {
          const result = operationalStability(weeks, { tolerance });
          return { tolerance, state: result.state, detected_week: result.signal?.detected_week || null, confirmed_week: result.signal?.confirmed_week || null };
        }),
        limitation: launch.comparability === 'descritivo_apenas'
          ? 'D0 oficial nao esta coberto; resultado descreve apenas o trecho observado.'
          : 'Heuristica operacional; regularidade nao prova independencia, sucesso ou causalidade.'
      };
    });
  }
  function cumulativeRevenueSeries(launches, rows) {
    return (launches || []).map(launch => {
      let cumulative = 0;
      const points = (rows || [])
        .filter(row => row.modelo_id === launch.launch_id)
        .sort((a, b) => Number(a.dia_desde_d0) - Number(b.dia_desde_d0))
        .map(row => {
          cumulative += number(row.receita_bruta ?? row.receita) || 0;
          return { day: Number(row.dia_desde_d0), value: round(cumulative) };
        });
      return { launch_id: launch.launch_id, points };
    });
  }
  function rpsContextSeries(launch, rpsModel, targetRows, windowDays = 7) {
    const points = (rpsModel?.pontos || [])
      .filter(point => number(point.dias_desde_lancamento) !== null)
      .sort((a, b) => Number(a.dias_desde_lancamento) - Number(b.dias_desde_lancamento));
    const investmentByDate = new Map();
    for (const month of targetRows || []) {
      for (const row of month.daily || []) {
        const acquisition = number(row.investimento_aquisicao);
        const realized = number(row.investimento_realizado);
        if (acquisition !== null) {
          investmentByDate.set(row.data, { value: acquisition, source: 'acquisition' });
        } else if (realized !== null) {
          investmentByDate.set(row.data, { value: realized, source: 'realized' });
        }
      }
    }
    const average = values => {
      const known = values.map(number).filter(value => value !== null);
      return known.length ? known.reduce((sum, value) => sum + value, 0) / known.length : null;
    };
    const summarize = selected => {
      const sessions = selected.map(point => number(point.sessoes)).filter(value => value !== null);
      const revenue = selected.map(point => number(point.receita_total)).filter(value => value !== null);
      const sessionTotal = sessions.reduce((sum, value) => sum + value, 0);
      return {
        rps: sessionTotal && revenue.length ? revenue.reduce((sum, value) => sum + value, 0) / sessionTotal : null,
        sessions: average(sessions),
        investment: average(selected.map(point => investmentByDate.get(point.data_calendario)?.value))
      };
    };
    const baseline = summarize(points.filter(point => Number(point.dias_desde_lancamento) <= 30));
    const indexed = value => base => value !== null && base ? round(value / base * 100, 3) : null;
    const output = points.map((point, index) => {
      const current = summarize(points.slice(Math.max(0, index - Math.max(1, windowDays) + 1), index + 1));
      return {
        day: Number(point.dias_desde_lancamento),
        rps: current.rps,
        sessions: current.sessions,
        investment: current.investment,
        rps_index: indexed(current.rps)(baseline.rps),
        sessions_index: indexed(current.sessions)(baseline.sessions),
        investment_index: indexed(current.investment)(baseline.investment)
      };
    });
    const investmentSources = new Set(points.map(point => investmentByDate.get(point.data_calendario)?.source).filter(Boolean));
    return {
      launch_id: launch?.launch_id,
      baseline,
      points: output,
      investment_source: investmentSources.size > 1 ? 'acquisition_with_realized_fallback' : investmentSources.has('acquisition') ? 'acquisition' : investmentSources.has('realized') ? 'realized' : 'missing'
    };
  }
  return { VERSION, SOURCES, number, channelType, channels, signature, sourceSignatures, derivedMatches, audit, investmentForWindow, completeLaunchWeeks, operationalStability, stabilityEvents, cumulativeRevenueSeries, rpsContextSeries };
});
