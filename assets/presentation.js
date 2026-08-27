(() => {
  const refs = {};
  const state = {
    open: false,
    chart: null,
    returnFocus: null,
    savedScroll: { x: 0, y: 0 },
    appShellWasInert: false,
    filters: {
      modelId: '',
      line: 'all',
      productId: '',
      color: '',
      periodKey: '',
      channel: 'all'
    }
  };

  const WINDOW_DAYS = { '7d': 7, '15d': 15, '30d': 30, '60d': 60, '90d': 90 };
  const WINDOW_LABELS = { '7d': '7 dias', '15d': '15 dias', '30d': '30 dias', '60d': '60 dias', '90d': '90 dias' };
  const WINDOW_KEYS = Object.keys(WINDOW_DAYS);

  const TOOLTIPS = {
    revenue: 'Soma da receita dos lançamentos na janela selecionada. Cada linha é contada desde o próprio D0.',
    shareAvg: 'Média do peso de cada lançamento na receita da empresa dentro da mesma janela de vida.',
    activeNow: 'Quantidade de lançamentos ativos no cadastro, dentro do universo apresentado.',
    orders: 'Pedidos aprovados dos lançamentos na janela selecionada.',
    topShare: 'Linha com maior participação na receita da empresa dentro da janela selecionada.',
    ranking: 'Ranking comparativo na janela escolhida. Linhas sem janela fechada aparecem como pendentes, não como zero.',
    companyRevenue: 'Mostra se a empresa estava crescendo, pressionada ou sem base comparável no período do lançamento.',
    channel: 'Investimento total da planilha principal comparado com pedidos pagos. O SSOT usa origem/UTM granular quando disponível e aloca o mix pago versus orgânico nas lacunas históricas.',
    seasonal: 'Eventos de calendário dentro da janela selecionada, lidos desde o D0 de cada lançamento.'
  };

  const focusableSelector = [
    'button:not([disabled])',
    '[href]',
    'input:not([disabled])',
    'select:not([disabled])',
    'textarea:not([disabled])',
    '[tabindex]:not([tabindex="-1"])'
  ].join(',');

  const $ = (id) => document.getElementById(id);
  const cssVar = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const snapshot = () => window.ReiseLaunchDashboard?.getSnapshot?.() || null;
  const formatters = () => window.ReiseLaunchDashboard?.formatters || {};

  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const normalizeStatus = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');

  const normalizeText = (value) => normalizeStatus(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function round(value, digits = 0) {
    const num = numberOrNull(value);
    if (num === null) return null;
    const factor = 10 ** digits;
    return Math.round(num * factor) / factor;
  }

  function sumNullable(values) {
    const nums = values.map((value) => numberOrNull(value)).filter((value) => value !== null);
    if (!nums.length) return null;
    return round(nums.reduce((acc, value) => acc + value, 0), 0);
  }

  function avgNullable(values, digits = 4) {
    const nums = values.map((value) => numberOrNull(value)).filter((value) => value !== null);
    if (!nums.length) return null;
    return round(nums.reduce((acc, value) => acc + value, 0) / nums.length, digits);
  }

  function fmtBRL(value, compact = false) {
    const num = round(value, 0);
    if (num === null) return '—';
    const formatter = formatters().fmtBRL;
    if (typeof formatter === 'function') return formatter(num, compact);
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: 0,
      notation: compact ? 'compact' : 'standard'
    }).format(num);
  }

  function fmtPct(value, digits = 1) {
    const num = round(value, digits + 2);
    if (num === null) return '—';
    const formatter = formatters().fmtPct;
    if (typeof formatter === 'function') return formatter(num, digits);
    return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: digits }).format(num);
  }

  function fmtNum(value, digits = 0) {
    const num = round(value, digits);
    if (num === null) return '—';
    const formatter = formatters().fmtNum;
    if (typeof formatter === 'function') return formatter(num, digits);
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(num);
  }

  function ratioOrNull(numerator, denominator) {
    const n = numberOrNull(numerator);
    const d = numberOrNull(denominator);
    if (n === null || d === null || d === 0) return null;
    return n / d;
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
    if (/(^| )(owned|crm|email|newsletter|whatsapp|sms|organic|organico|seo|direct|referral|other|outros|unmatched|sem origem|sem utm|sem atribuicao|sem match|unattributed|unknown|not set)( |$)/.test(explicitType)) return 'organic';
    const channelText = normalizeText([
      row.canal_real,
      row.canal,
      row.channel,
      row.raw_channel,
      row.raw_medium,
      row.raw_source,
      row.utm_medium,
      row.utm_source
    ].filter(Boolean).join(' '));
    if (!channelText) return isAllocatedAttribution(row) ? null : 'organic';
    if (/(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen|cpc|ppc|cpm|paid|ads|anuncio|anuncios|patrocinad)( |$)/.test(channelText)) return 'paid';
    return 'organic';
  }

  function attributionQualityMeta(granularPct, allocatedPct = null) {
    const granular = numberOrNull(granularPct);
    if (granular === null) return { tone: 'neutral', label: 'Sem origem', reason: 'Sem base suficiente para medir origem granular.' };
    const detail = `Cobertura granular ${fmtPct(granular, 1)}${allocatedPct === null ? '' : `; alocacao SSOT ${fmtPct(allocatedPct, 1)}`}.`;
    if (granular >= .8) return { tone: 'positive', label: 'Granular', reason: `${detail} Leitura mais forte para apresentar como origem por pedido.` };
    if (granular >= .5) return { tone: 'warning', label: 'Mista', reason: `${detail} Use como leitura comercial, explicando a parcela alocada pelo SSOT.` };
    return { tone: 'warning', label: 'Alocada', reason: `${detail} A divisao pago/organico fecha o total, mas depende majoritariamente de alocacao do SSOT.` };
  }

  function attributionQualityFromRows(rows = [], totalOrders = null) {
    const orderId = (row) => row.order_sk || row.order_id || row.pedido_id;
    const allOrders = new Set(rows.map(orderId).filter(Boolean));
    const total = numberOrNull(totalOrders) ?? allOrders.size;
    if (!total) return { total: null, granularOrders: null, allocatedOrders: null, granularPct: null, allocatedPct: null, ...attributionQualityMeta(null) };
    const granularOrders = new Set(rows.filter((row) => !isAllocatedAttribution(row) && ['paid', 'organic'].includes(orderChannelType(row))).map(orderId).filter(Boolean));
    const allocatedOrders = new Set(rows.filter(isAllocatedAttribution).map(orderId).filter(Boolean));
    const granularPct = granularOrders.size / total;
    const allocatedPct = allocatedOrders.size / total;
    return {
      total,
      granularOrders: granularOrders.size,
      allocatedOrders: allocatedOrders.size,
      granularPct,
      allocatedPct,
      ...attributionQualityMeta(granularPct, allocatedPct)
    };
  }

  function toDate(value) {
    if (!value) return null;
    const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function addDays(value, days) {
    const date = toDate(value);
    if (!date) return null;
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
  }

  function dayIndex(d0, value) {
    const start = toDate(d0);
    const date = toDate(value);
    if (!start || !date) return null;
    return Math.round((date - start) / 86400000);
  }

  function periodKey(current) {
    const key = state.filters.periodKey || current?.analysisPeriodKey;
    return WINDOW_KEYS.includes(key) ? key : '30d';
  }

  function periodLabel(current) {
    const key = periodKey(current);
    return WINDOW_LABELS[key] || current?.analysisPeriodLabel || '30 dias';
  }

  function getWindow(launch, key) {
    return launch?.janelas?.[key] || null;
  }

  function previousWindow(launch, key) {
    const target = WINDOW_DAYS[key] || 30;
    return [...WINDOW_KEYS]
      .filter((item) => WINDOW_DAYS[item] <= target)
      .reverse()
      .map((item) => ({ key: item, data: getWindow(launch, item) }))
      .find((item) => item.data && numberOrNull(item.data.receita) !== null) || null;
  }

  function pointAtOrBefore(points, day) {
    return [...(points || [])]
      .filter((point) => numberOrNull(point.dias_desde_lancamento) !== null && point.dias_desde_lancamento <= day)
      .sort((a, b) => numberOrNull(b.dias_desde_lancamento) - numberOrNull(a.dias_desde_lancamento))[0] || null;
  }

  function help(text) {
    return `<button class="help-button help-button--mini presentation-help" type="button" data-tooltip="${escapeHtml(text)}" aria-label="Ajuda executiva">?</button>`;
  }

  function launchDate(launch) {
    return launch?.day_zero_base || launch?.data_lancamento || launch?.d0 || launch?.data_oficial || null;
  }

  function shareModel(data, launch) {
    return data?.share_trajetoria?.modelos?.[launch.modelo_id] || null;
  }

  function sharePoints(model) {
    return Array.isArray(model?.pontos) ? model.pontos : [];
  }

  function launchWindowRevenue(launch, key) {
    return round(numberOrNull(getWindow(launch, key)?.receita), 0);
  }

  function launchWindowShare(model, key) {
    const day = WINDOW_DAYS[key] || 30;
    const point = pointAtOrBefore(sharePoints(model), day);
    return round(
      numberOrNull(point?.share_acumulado_ate_o_dia)
      ?? (key === '90d' ? numberOrNull(model?.share_acumulado_atual) : null),
      4
    );
  }

  function launchLabel(launch) {
    return launch?.modelo || launch?.linha || launch?.modelo_id || '—';
  }

  function filterKey(value, fallback = 'all') {
    const key = String(value || '').trim();
    if (!key || key === 'todos') return fallback;
    return key;
  }

  function lineFilterKey(current) {
    return filterKey(state.filters.line || current?.lineFilter, 'all');
  }

  function productFilterKey(current) {
    if (state.filters.productId === '') return 'all';
    return filterKey(state.filters.productId || current?.productFilter, 'all');
  }

  function colorFilterKey(current) {
    if (state.filters.color === '') return 'all';
    return filterKey(state.filters.color || current?.productColorFilter, 'all');
  }

  function channelFilterKey(current) {
    const key = filterKey(state.filters.channel || current?.channelFilter, 'all');
    if (key === 'paid') return 'investment';
    if (key === 'crm') return 'organic';
    return key;
  }

  function lineOptionsForLaunches(launches) {
    const options = new Map();
    launches.forEach((launch) => {
      const label = launch?.linha || launchLabel(launch);
      const key = normalizeText(label);
      if (!key) return;
      options.set(key, { key, label });
    });
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function productLabelForRow(row) {
    const id = String(row?.sub_modelo_id || '').trim();
    const labels = {
      rs6gt: 'RS6 GT',
      knitgt: 'KNIT GT',
      '911gt': '911 GT',
      rs6avant: 'RS6 Avant',
      rs7avant: 'RS7 Avant',
      rs8avant: 'RS8 Avant',
      phantom_easy: 'Phantom Easy',
      phantom_slip: 'Phantom Slip On',
      phantom_knit: 'Phantom Knit',
      phteasy: 'Phantom Easy',
      phtslip: 'Phantom Slip On',
      phtknit: 'Phantom Knit',
      rs8avantct: 'RS8 Avant Monochrome',
      rs8avantmc: 'RS8 Avant Monochrome',
      rs8avantab: 'RS8 Avant Monochrome',
      rs8avantcf: 'RS8 Avant Monochrome',
      series2_off_white: 'RS8 Avant Series 2',
      series2_whisky: 'RS8 Avant Series 2',
      series2_azul_marinho: 'RS8 Avant Series 2',
      avant_sem_prefixo: 'Outros Avant'
    };
    if (labels[id]) return labels[id];
    return id || row?.sub_modelo || row?.produto || row?.nome_produto || row?.product_title || '';
  }

  function productKeyForRow(row) {
    return normalizeText(productLabelForRow(row));
  }

  function colorLabelForRow(row) {
    return String(row?.cor || row?.color || 'Sem cor identificada').trim() || 'Sem cor identificada';
  }

  function colorKeyForRow(row) {
    return normalizeText(colorLabelForRow(row));
  }

  function productOptionsForLaunches(data, launches) {
    const ids = new Set(launches.map((launch) => String(launch?.modelo_id || '')).filter(Boolean));
    const options = new Map();
    (data.lancamentos_produtos_dia || [])
      .filter((row) => ids.has(String(row.modelo_id || '')))
      .forEach((row) => {
        const key = productKeyForRow(row);
        if (!key) return;
        const label = productLabelForRow(row);
        const current = options.get(key) || { key, label, count: 0 };
        current.count += 1;
        if (!current.label && label) current.label = label;
        options.set(key, current);
      });
    return [...options.values()]
      .filter((item) => item.label)
      .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function colorOptionsForLaunches(data, launches, productKey) {
    if (!productKey || productKey === 'all') return [];
    const ids = new Set(launches.map((launch) => String(launch?.modelo_id || '')).filter(Boolean));
    const options = new Map();
    (data.lancamentos_produtos_dia || [])
      .filter((row) => ids.has(String(row.modelo_id || '')))
      .filter((row) => productKeyForRow(row) === productKey)
      .forEach((row) => {
        const key = colorKeyForRow(row);
        if (!key) return;
        const label = colorLabelForRow(row);
        options.set(key, { key, label });
      });
    return [...options.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function aggregateSalesRows(rows) {
    const sum = (field) => sumNullable(rows.map((row) => row[field]));
    const receita = sum('receita');
    const orderIds = new Set(rows.map((row) => row.order_sk || row.order_id || row.pedido_id).filter(Boolean));
    const pedidos = orderIds.size || sumNullable(rows.map((row) => row.pedidos_validos ?? row.pedidos));
    const pares = sum('pares');
    const hasOrderAttribution = rows.some((row) => [
      row.receita_paga,
      row.pedidos_pagos,
      row.receita_organica,
      row.pedidos_organicos,
      row.receita_sem_match_atribuicao,
      row.pedidos_sem_match_atribuicao,
      row.receita_outros_canais,
      row.pedidos_outros_canais
    ].some((value) => numberOrNull(value) !== null));
    const receitaOrganica = hasOrderAttribution
      ? sumNullable([sum('receita_organica'), sum('receita_crm'), sum('receita_sem_match_atribuicao'), sum('receita_outros_canais')])
      : null;
    const pedidosOrganicos = hasOrderAttribution
      ? sumNullable([sum('pedidos_organicos'), sum('pedidos_crm'), sum('pedidos_sem_match_atribuicao'), sum('pedidos_outros_canais')])
      : null;
    return {
      receita,
      pedidos,
      pares,
      receita_paga: hasOrderAttribution ? sum('receita_paga') : null,
      receita_organica: receitaOrganica,
      receita_crm: null,
      receita_outros_canais: null,
      pedidos_pagos: hasOrderAttribution ? sum('pedidos_pagos') : null,
      pedidos_organicos: pedidosOrganicos,
      pedidos_crm: null,
      pedidos_outros_canais: null,
      receita_sem_match_atribuicao: null,
      pedidos_sem_match_atribuicao: null,
      ticket: ratioOrNull(receita, pedidos)
    };
  }

  function applyChannelToWindow(windowData, channelKey) {
    if (!windowData || channelKey === 'all') return windowData;
    const channelMap = {
      investment: { receita: ['receita_paga'], pedidos: ['pedidos_pagos'] },
      paid: { receita: ['receita_paga'], pedidos: ['pedidos_pagos'] },
      crm: { receita: ['receita_organica'], pedidos: ['pedidos_organicos'] },
      organic: { receita: ['receita_organica'], pedidos: ['pedidos_organicos'] },
      other: { receita: ['receita_outros_canais'], pedidos: ['pedidos_outros_canais'] }
    };
    const fields = channelMap[channelKey];
    if (!fields) return windowData;
    const fieldValue = (field) => sumNullable(field.map((item) => windowData[item]));
    const receita = fieldValue(fields.receita);
    const pedidos = fieldValue(fields.pedidos);
    return {
      ...windowData,
      receita_total_original: numberOrNull(windowData.receita),
      pedidos_total_original: numberOrNull(windowData.pedidos),
      receita,
      pedidos,
      pares: null,
      ticket: ratioOrNull(receita, pedidos)
    };
  }

  function filteredSalesWindow(data, launch, key, current, { ignoreProduct = false, ignoreChannel = false } = {}) {
    const productKey = ignoreProduct ? 'all' : productFilterKey(current);
    const colorKey = ignoreProduct ? 'all' : colorFilterKey(current);
    const channelKey = ignoreChannel ? 'all' : channelFilterKey(current);
    const days = WINDOW_DAYS[key];
    let windowData = null;

    if (productKey !== 'all' || colorKey !== 'all') {
      const d0 = launchDate(launch);
      const rows = (data.lancamentos_produtos_dia || []).filter((row) => {
        if (String(row.modelo_id || '') !== String(launch?.modelo_id || '')) return false;
        if (productKey !== 'all' && productKeyForRow(row) !== productKey) return false;
        if (colorKey !== 'all' && colorKeyForRow(row) !== colorKey) return false;
        const day = numberOrNull(row.dia_desde_d0) ?? dayIndex(d0, row.data);
        return day !== null && day >= 0 && day <= days;
      });
      windowData = aggregateSalesRows(rows);
      if ([windowData.receita, windowData.pedidos, windowData.pares].every((value) => value === null)) windowData = null;
    } else {
      windowData = getWindow(launch, key);
    }

    return applyChannelToWindow(windowData, channelKey);
  }

  function seasonalWeight(value) {
    const key = normalizeText(value);
    if (key === 'forte') return 3;
    if (key === 'medio') return 2;
    return 1;
  }

  function seasonalScore(data, launch, days) {
    const d0 = launchDate(launch);
    const start = toDate(d0);
    const end = addDays(d0, days);
    if (!start || !end) return { label: 'Sem contexto', score: 0, promotores: 0, ofensores: 0, neutros: 0, strongest: null };
    const events = (data.calendario_br || [])
      .map((event) => {
        const date = toDate(event.data);
        const tipo = normalizeText(event.tipo);
        const sign = tipo === 'promotor' ? 1 : tipo === 'ofensor' ? -1 : 0;
        const score = sign * seasonalWeight(event.peso);
        return { ...event, date, score };
      })
      .filter((event) => event.date && event.date >= start && event.date <= end);
    const counts = events.reduce((acc, event) => {
      const tipo = normalizeText(event.tipo);
      if (tipo === 'promotor') acc.promotores += 1;
      else if (tipo === 'ofensor') acc.ofensores += 1;
      else acc.neutros += 1;
      return acc;
    }, { promotores: 0, ofensores: 0, neutros: 0 });
    const score = events.reduce((acc, event) => acc + event.score, 0);
    const strongest = [...events].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0] || null;
    const label = !events.length ? 'Janela limpa' : score > 0 ? `Favorável +${score}` : score < 0 ? `Pressão ${score}` : 'Neutra';
    return { label, score, strongest, ...counts };
  }

  function dailyRows(data) {
    return (data.metas_mensais?.rows || []).flatMap((month) => (
      Array.isArray(month.daily) ? month.daily : []
    ));
  }

  function acquisitionForLaunch(data, launch, days) {
    const d0 = launchDate(launch);
    const start = toDate(d0);
    const end = addDays(d0, days);
    if (!start || !end) return null;
    const rows = dailyRows(data).filter((row) => {
      const date = toDate(row.data);
      return date && date >= start && date <= end;
    });
    const investimento = sumNullable(rows.map((row) => row.investimento_realizado));
    const receita = sumNullable(rows.map((row) => row.realizado_receita));
    const pedidos = sumNullable(rows.map((row) => row.realizado_pedidos));
    if (investimento === null && receita === null && pedidos === null) return null;
    return {
      investimento,
      receita,
      pedidos,
      roas: ratioOrNull(receita, investimento),
      cpa: ratioOrNull(investimento, pedidos)
    };
  }

  function mediaWindowDays(row) {
    const match = String(row?.janela || '').match(/(\d+)d/i);
    return match ? parseInt(match[1], 10) : null;
  }

  function mediaRowMatchesPresentationWindow(row, launch, days) {
    const declaredDays = mediaWindowDays(row);
    if (declaredDays !== null) return declaredDays === days;
    const d0 = launchDate(launch);
    const start = row?.data_inicio ? dayIndex(d0, row.data_inicio) : null;
    const end = row?.data_fim ? dayIndex(d0, row.data_fim) : start;
    if (start === null && end === null) return false;
    const inferredDays = start !== null && end !== null ? Math.max(1, end - start + 1) : Math.max(1, (end ?? start) + 1);
    return inferredDays === days || (start ?? end) === 0 && (end ?? start) === days - 1;
  }

  function isTotalMediaRow(row) {
    return normalizeText(row?.canal || row?.channel) === 'total';
  }

  function latestSalesDay(data, launch) {
    const d0 = launchDate(launch);
    const days = (data.lancamentos_produtos_dia || [])
      .filter((row) => String(row.modelo_id || '') === String(launch?.modelo_id || ''))
      .map((row) => numberOrNull(row.dia_desde_d0) ?? dayIndex(d0, row.data))
      .filter((day) => day !== null && day >= 0);
    return days.length ? Math.max(...days) : null;
  }

  function manualReferenceDate(data, launch) {
    const candidates = (data.midia_paga || [])
      .filter((row) => String(row.modelo_id || '') === String(launch?.modelo_id || ''))
      .flatMap((row) => {
        const match = String(row.observacao || '').match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!match) return [];
        const baseYear = match[3].length === 2 ? 2000 + Number(match[3]) : Number(match[3]);
        const years = match[3].length === 2 ? [baseYear, baseYear + 1] : [baseYear];
        return years.map((year) => {
          const date = new Date(year, Number(match[2]) - 1, Number(match[1]), 12, 0, 0);
          return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
        }).filter(Boolean);
      });
    if (!candidates.length) return launchDate(launch);
    const crmRows = (data.crm_disparos || []).filter((row) => String(row.modelo_id || '') === String(launch?.modelo_id || ''));
    return candidates
      .map((candidate, index) => ({
        candidate,
        index,
        score: crmRows.reduce((score, row) => {
          const idx = dayIndex(candidate, row.data_disparo || row.data || row.date);
          return idx !== null && idx >= 0 && idx <= 90
            ? score + 1 + (numberOrNull(row.receita_linha) || 0) / 100000 + (numberOrNull(row.investimento) || 0) / 1000000
            : score;
        }, 0)
      }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate || launchDate(launch);
  }

  function investmentForLaunch(data, launch, days) {
    const matchedMediaRows = (data.midia_paga || [])
      .filter((row) => String(row.modelo_id || '') === String(launch?.modelo_id || ''))
      .filter((row) => numberOrNull(row.investimento) !== null)
      .filter((row) => mediaRowMatchesPresentationWindow(row, launch, days));
    const channelMediaRows = matchedMediaRows.filter((row) => !isTotalMediaRow(row));
    const mediaRows = channelMediaRows.length ? channelMediaRows : matchedMediaRows;
    const maxDay = latestSalesDay(data, launch);
    const endDay = maxDay === null ? days : Math.min(days, maxDay);
    const referenceDate = manualReferenceDate(data, launch);
    const crmRows = (data.crm_disparos || [])
      .filter((row) => String(row.modelo_id || '') === String(launch?.modelo_id || ''))
      .filter((row) => numberOrNull(row.investimento) !== null)
      .filter((row) => {
        const dataDisparo = row.data_disparo || row.data || row.date;
        const idx = dayIndex(referenceDate, dataDisparo);
        return idx !== null && idx >= 0 && idx <= endDay;
      });
    return {
      value: sumNullable([...mediaRows, ...crmRows].map((row) => row.investimento)),
      mediaValue: sumNullable(mediaRows.map((row) => row.investimento)),
      crmValue: sumNullable(crmRows.map((row) => row.investimento)),
      hasMedia: mediaRows.length > 0,
      hasCrm: crmRows.length > 0,
      mediaRows,
      crmRows,
      source: mediaRows.length && crmRows.length ? 'mídia paga + CRM' : mediaRows.length ? 'mídia paga' : crmRows.length ? 'somente CRM' : 'sem base'
    };
  }

  function exportableLaunches(current) {
    const data = current?.data || {};
    const key = periodKey(current);
    const days = WINDOW_DAYS[key] || 30;
    const exportedIds = new Set((data.manifest?.exported_models || []).map(String));
    const compareIds = new Set((current?.compareModelIds || []).map(String).filter(Boolean));
    const lineKey = lineFilterKey(current);
    const launches = current?.launches || [];
    return launches
      .filter((launch) => (
        exportedIds.size
          ? exportedIds.has(String(launch.modelo_id))
          : ['historico', 'ativo'].includes(normalizeStatus(launch.status)) && Boolean(launchDate(launch))
      ))
      .filter((launch) => !compareIds.size || compareIds.has(String(launch.modelo_id)))
      .filter((launch) => lineKey === 'all' || normalizeText(launch?.linha || launchLabel(launch)) === lineKey)
      .map((launch) => {
        const model = shareModel(data, launch);
        const availableDay = latestSalesDay(data, launch);
        const isPartial = availableDay !== null && availableDay < days;
        const closedWindow = filteredSalesWindow(data, launch, key, current, { ignoreProduct: true, ignoreChannel: true });
        const win = closedWindow || (isPartial ? aggregateSalesRows(salesRowsForLaunchPeriod(data, launch, days)) : null);
        const fallback = previousWindow(launch, key);
        const revenue = round(numberOrNull(win?.receita), 0);
        const pedidos = round(numberOrNull(win?.pedidos), 0);
        const pares = round(numberOrNull(win?.pares), 0);
        const seasonal = seasonalScore(data, launch, days);
        const investment = investmentForLaunch(data, launch, days);
        const receitaInvestimento = numberOrNull(win?.receita_paga);
        const pedidosInvestimento = numberOrNull(win?.pedidos_pagos);
        const qualityDay = isPartial && availableDay !== null ? Math.min(days, availableDay) : days;
        const attributionQuality = attributionQualityFromRows(salesRowsForLaunchPeriod(data, launch, qualityDay), pedidos);
        const acquisition = investment.value === null ? null : {
          investimento: investment.value,
          receitaInvestimento,
          pedidosInvestimento,
          receitaOrganica: numberOrNull(win?.receita_organica),
          pedidosOrganicos: numberOrNull(win?.pedidos_organicos),
          roas: investment.hasMedia && !isPartial ? ratioOrNull(receitaInvestimento, investment.value) : null,
          cpa: investment.hasMedia && !isPartial ? ratioOrNull(investment.value, pedidosInvestimento) : null
        };
        const filteredShare = false;
        return {
          launch,
          model,
          id: launch.modelo_id,
          label: launchLabel(launch),
          status: normalizeStatus(launch.status),
          windowKey: key,
          window: win,
          fallbackWindow: fallback,
          revenue,
          pedidos,
          pares,
          share: !filteredShare && win ? launchWindowShare(model, key) : null,
          ticket: ratioOrNull(revenue, pedidos),
          variation: round(model?.variacao_receita_empresa_pct, 4),
          companyPre: round(model?.receita_empresa_pre_periodo, 0),
          companyPost: round(model?.receita_empresa_pos_periodo, 0),
          days: availableDay,
          complete: !isPartial,
          isPartial,
          investment,
          requiresValidation: Boolean(acquisition?.roas !== null && acquisition.roas > 20),
          eventsRegistered: round(model?.eventos_comerciais_cadastrados, 0),
          seasonal,
          acquisition,
          attributionQuality,
          points: sharePoints(model)
        };
      });
  }

  function stockRows(data, rows) {
    const modelIds = new Set(rows.map((row) => row.id));
    const soldSkus = new Set((data.lancamentos_produtos_dia || [])
      .filter((row) => modelIds.has(String(row.modelo_id)))
      .map((row) => String(row.sku || '').trim())
      .filter(Boolean));

    return (data.estoque || [])
      .filter((row) => modelIds.has(String(row.modelo_id)) || soldSkus.has(String(row.sub_modelo || '').trim()))
      .map((row) => ({
        model: row.modelo_id || '—',
        sku: row.sub_modelo || row.sku || '—',
        color: row.cor || '—',
        available: round(row.estoque_atual ?? row.available ?? row.available_total, 0)
      }))
      .filter((row) => row.available !== null)
      .sort((a, b) => b.available - a.available)
      .slice(0, 5);
  }

  function productOptionsForLaunch(data, focus) {
    if (!focus?.id) return [];
    const sourceRows = Array.isArray(data.sub_modelos_dia) ? data.sub_modelos_dia : [];
    const byId = new Map();
    sourceRows
      .filter((row) => String(row.modelo_id || '') === String(focus.id))
      .forEach((row) => {
        const id = String(row.sub_modelo_id || row.sub_modelo || row.produto || '').trim();
        if (!id) return;
        byId.set(id, row.sub_modelo || row.produto || id);
      });
    return [...byId.entries()]
      .map(([id, label]) => ({ id, label }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }

  function seasonalText(row) {
    const values = Array.from(new Set(row.points
      .map((point) => point.evento_sazonal)
      .filter(Boolean)));
    return values.length ? values.join(', ') : '—';
  }

  function commercialText(row) {
    if (row.eventsRegistered === 0) return 'pendente';
    const values = Array.from(new Set(row.points
      .map((point) => point.evento_comercial_tipo)
      .filter(Boolean)));
    return values.length ? values.join(', ') : '—';
  }

  function salesRowsForLaunchPeriod(data, launch, days) {
    const d0 = launchDate(launch);
    return (data.lancamentos_produtos_dia || []).filter((row) => {
      if (String(row.modelo_id || '') !== String(launch?.modelo_id || '')) return false;
      const day = numberOrNull(row.dia_desde_d0) ?? dayIndex(d0, row.data);
      return day !== null && day >= 0 && day <= days;
    });
  }

  function groupedProductPerformance(rows, keyForRow, labelForRow, current) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = keyForRow(row);
      if (!key) return;
      const currentGroup = groups.get(key) || { key, label: labelForRow(row), rows: [] };
      currentGroup.rows.push(row);
      groups.set(key, currentGroup);
    });
    return [...groups.values()]
      .map((group) => ({
        ...group,
        metrics: applyChannelToWindow(aggregateSalesRows(group.rows), channelFilterKey(current))
      }))
      .sort((a, b) => (numberOrNull(b.metrics?.receita) || 0) - (numberOrNull(a.metrics?.receita) || 0) || a.label.localeCompare(b.label, 'pt-BR'));
  }

  function colorMixForProduct(product, current) {
    const productRevenue = numberOrNull(product?.metrics?.receita) || 0;
    if (!product?.rows?.length || !productRevenue) return [];
    return groupedProductPerformance(product.rows, colorKeyForRow, colorLabelForRow, current)
      .filter((item) => (numberOrNull(item.metrics?.receita) || 0) > 0)
      .slice(0, 3)
      .map((item) => ({
        ...item,
        share: ratioOrNull(numberOrNull(item.metrics?.receita), productRevenue)
      }));
  }

  function productStory(data, focus, current, days) {
    if (!focus?.launch) return { selected: null, products: [], colors: [], colorContext: '' };
    const sourceRows = salesRowsForLaunchPeriod(data, focus.launch, days);
    const selectedProduct = productFilterKey(current);
    const selectedColor = colorFilterKey(current);
    const productRows = selectedProduct === 'all'
      ? sourceRows
      : sourceRows.filter((row) => productKeyForRow(row) === selectedProduct);
    const selectedRows = selectedColor === 'all'
      ? productRows
      : productRows.filter((row) => colorKeyForRow(row) === selectedColor);
    const products = groupedProductPerformance(sourceRows, productKeyForRow, productLabelForRow, current)
      .map((product) => ({
        ...product,
        colors: colorMixForProduct(product, current)
      }));
    const colors = groupedProductPerformance(productRows, colorKeyForRow, colorLabelForRow, current);
    const selected = applyChannelToWindow(aggregateSalesRows(selectedRows), channelFilterKey(current));
    return {
      selected,
      products,
      colors,
      topProduct: products[0] || null,
      topColor: colors[0] || null,
      selectedProduct,
      selectedColor,
      colorContext: selectedProduct === 'all'
        ? 'mix geral da linha'
        : products.find((row) => row.key === selectedProduct)?.label || 'produto selecionado'
    };
  }

  function reliableEfficiencyRows(rows) {
    return rows.filter((row) => row.complete && row.acquisition?.roas !== null && !row.requiresValidation);
  }

  function commercialVerdict(rows, periodLabelText) {
    const closed = rows.filter((row) => row.complete && row.revenue !== null);
    const scale = [...closed].sort((a, b) => (b.revenue || 0) - (a.revenue || 0))[0] || null;
    const efficiencies = reliableEfficiencyRows(rows);
    const efficiency = [...efficiencies].sort((a, b) => b.acquisition.roas - a.acquisition.roas)[0] || null;
    const attention = [...efficiencies].sort((a, b) => a.acquisition.roas - b.acquisition.roas)[0] || null;
    const parts = [];
    if (scale) parts.push(`${scale.label} lidera faturamento fechado em ${periodLabelText}`);
    if (efficiency) parts.push(`${efficiency.label} entrega o melhor retorno comparável`);
    if (attention && attention.id !== efficiency?.id) parts.push(`${attention.label} concentra a maior oportunidade de eficiência`);
    return parts.length ? `${parts.join('; ')}.` : 'A janela ainda não tem base fechada suficiente para declarar vencedor comercial.';
  }

  function buildViewModel(current) {
    const data = current?.data || {};
    const key = periodKey(current);
    const label = periodLabel(current);
    const rows = exportableLaunches(current);
    const activeNow = rows.filter((row) => row.status === 'ativo').length;
    const focusId = state.filters.modelId || current?.primaryModelId;
    const focus = rows.find((row) => row.id === focusId) || rows[0] || null;
    const lineOptions = lineOptionsForLaunches(current?.launches || []);
    const focusLaunches = focus?.launch ? [focus.launch] : [];
    const productOptions = productOptionsForLaunches(data, focusLaunches);
    if (state.filters.productId && state.filters.productId !== 'all' && !productOptions.some((item) => item.key === state.filters.productId)) {
      state.filters.productId = '';
      state.filters.color = '';
    }
    const colorOptions = colorOptionsForLaunches(data, focusLaunches, productFilterKey(current));
    if (state.filters.color && !colorOptions.some((item) => item.key === state.filters.color)) state.filters.color = '';
    const rowsWithWindow = rows.filter((row) => row.revenue !== null);
    const closedRows = rowsWithWindow.filter((row) => row.complete);
    const topShareRow = closedRows
      .filter((row) => row.share !== null)
      .sort((a, b) => b.share - a.share)[0] || null;
    const topRevenueRow = [...closedRows]
      .sort((a, b) => b.revenue - a.revenue)[0] || null;
    const efficiencyRows = reliableEfficiencyRows(rows);
    const topEfficiency = [...efficiencyRows].sort((a, b) => b.acquisition.roas - a.acquisition.roas)[0] || null;
    const efficiencyAttention = [...efficiencyRows].sort((a, b) => a.acquisition.roas - b.acquisition.roas)[0] || null;
    const partialRows = rows.filter((row) => row.isPartial);
    const validationRows = rows.filter((row) => row.requiresValidation);
    const products = productStory(data, focus, current, WINDOW_DAYS[key] || 30);

    return {
      data,
      periodKey: key,
      periodLabel: label,
      periodDays: WINDOW_DAYS[key] || 30,
      rows,
      focus,
      filters: { ...state.filters },
      lineOptions,
      productOptions,
      colorOptions,
      products,
      rowsWithWindow,
      closedRows,
      partialRows,
      validationRows,
      topEfficiency,
      efficiencyAttention,
      verdict: commercialVerdict(rows, label),
      stock: stockRows(data, rows),
      kpis: {
        revenue: sumNullable(rowsWithWindow.map((row) => row.revenue)),
        shareAvg: avgNullable(rows.map((row) => row.share), 4),
        activeNow,
        orders: sumNullable(rowsWithWindow.map((row) => row.pedidos)),
        topShare: topShareRow,
        topRevenue: topRevenueRow,
        windowCoverage: `${fmtNum(rowsWithWindow.length)} de ${fmtNum(rows.length)}`
      }
    };
  }

  function kpiCard(label, value, tooltip, modifier = '') {
    return `
      <article class="compact-kpi ${modifier ? `compact-kpi--${modifier}` : ''}">
        <div class="compact-card-head">
          <span>${escapeHtml(label)}</span>
          ${help(tooltip)}
        </div>
        <strong>${escapeHtml(value)}</strong>
      </article>`;
  }

  function panel(title, tooltip, body, extraClass = '') {
    return `
      <section class="compact-panel ${extraClass}">
        <div class="compact-panel-head">
          <h2>${escapeHtml(title)}</h2>
          ${help(tooltip)}
        </div>
        ${body}
      </section>`;
  }

  function metricRankingHtml(rows, field, formatter, emptyText = 'Sem dado') {
    const ranked = rows
      .map((row) => ({ ...row, value: numberOrNull(row[field]) }))
      .sort((a, b) => {
        if (a.value === null && b.value === null) return a.label.localeCompare(b.label);
        if (a.value === null) return 1;
        if (b.value === null) return -1;
        return b.value - a.value;
      });
    const max = Math.max(...ranked.map((row) => row.value || 0), 0);
    if (!ranked.length || !max) return `<div class="compact-empty">${escapeHtml(emptyText)}.</div>`;
    return `
      <div class="compact-share-ranking">
        ${ranked.map((row) => {
          const hasValue = row.value !== null && max > 0;
          const width = hasValue ? round((row.value / max) * 100, 1) : 0;
          const status = hasValue ? formatter(row.value) : row.fallbackWindow ? 'janela pendente' : 'em maturação';
          return `
            <div class="compact-share-row ${hasValue ? '' : 'is-muted'}">
              <div class="compact-share-label">
                <span>${escapeHtml(row.label)}</span>
                <strong>${escapeHtml(status)}</strong>
              </div>
              <div class="compact-share-track">
                <span style="width:${width}%"></span>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function companyRevenueHtml(rows, focusId = null) {
    const ordered = [...rows].sort((a, b) => {
      const av = numberOrNull(a.variation);
      const bv = numberOrNull(b.variation);
      if (av === null && bv === null) return a.label.localeCompare(b.label);
      if (av === null) return 1;
      if (bv === null) return -1;
      return bv - av;
    });
    return `
      <div class="compact-company-list">
        ${ordered.map((row) => {
          const baselineInsuficiente = row.companyPre !== null && row.companyPost !== null && row.companyPre < Math.max(1000, row.companyPost * 0.01);
          const hasComparison = row.companyPre !== null && row.companyPost !== null && row.variation !== null && !baselineInsuficiente;
          const positive = row.variation === null || row.variation >= 0;
          const label = hasComparison ? (positive ? 'empresa acelerando' : 'empresa pressionada') : baselineInsuficiente ? 'sem base comparável' : 'sem contexto';
          return `
            <div class="compact-company-item ${row.id === focusId ? 'is-selected' : ''}">
              <p>${escapeHtml(row.label)}</p>
              ${hasComparison ? `
                <div class="compact-company-values">
                  <span>${escapeHtml(label)}</span>
                  <span class="${positive ? 'is-positive' : 'is-negative'}">${fmtPct(row.variation, 1)}</span>
                </div>
                <p>${fmtBRL(row.companyPre, true)} antes · ${fmtBRL(row.companyPost, true)} depois</p>
              ` : `
                <div class="compact-company-values compact-company-values--missing">${escapeHtml(label)}</div>
                <p>${row.companyPre !== null && row.companyPost !== null ? `${fmtBRL(row.companyPre, true)} antes · ${fmtBRL(row.companyPost, true)} depois` : 'Base incompleta para comparar.'}</p>
              `}
            </div>`;
        }).join('')}
      </div>`;
  }

  function activityHtml(rows, periodLabelText) {
    return `
      <div class="compact-activity-list">
        ${rows.map((row) => `
          <div class="compact-activity-item ${row.revenue === null ? 'is-muted' : ''}">
            <strong>${escapeHtml(row.label)}</strong>
            <span><b>${fmtBRL(row.revenue, true)}</b><small>receita</small></span>
            <span><b>${fmtNum(row.pedidos)}</b><small>pedidos</small></span>
            <span><b>${fmtNum(row.pares)}</b><small>pares</small></span>
            <em>${row.revenue === null ? `sem ${escapeHtml(periodLabelText)}` : 'com dado'}</em>
          </div>
        `).join('')}
      </div>`;
  }

  function seasonalHtml(rows) {
    const ordered = [...rows].sort((a, b) => b.seasonal.score - a.seasonal.score || a.label.localeCompare(b.label));
    return `
      <div class="compact-seasonal-list">
        ${ordered.map((row) => `
          <div class="compact-seasonal-item">
            <div>
              <strong>${escapeHtml(row.label)}</strong>
              <span>${escapeHtml(row.seasonal.strongest?.nome || 'Sem evento forte')}</span>
            </div>
            <em class="${row.seasonal.score > 0 ? 'is-positive' : row.seasonal.score < 0 ? 'is-negative' : ''}">${escapeHtml(row.seasonal.label)}</em>
            <small>+${fmtNum(row.seasonal.promotores)} promotor · -${fmtNum(row.seasonal.ofensores)} ofensor · ${fmtNum(row.seasonal.neutros)} neutro</small>
          </div>
        `).join('')}
      </div>`;
  }

  function channelHtml(view) {
    const focus = view.focus;
    if (!focus?.acquisition) {
      return '<div class="compact-empty">Sem investimento na planilha principal para o destaque visual nesta janela.</div>';
    }
    const avgRoas = avgNullable(view.rows.map((row) => row.acquisition?.roas), 2);
    const focusRoas = focus.acquisition.roas;
    return `
      <div class="compact-channel-grid">
        <div><span>Investimento</span><strong>${fmtBRL(focus.acquisition.investimento, true)}</strong></div>
        <div><span>Receita midia paga</span><strong>${fmtBRL(focus.acquisition.receitaInvestimento, true)}</strong></div>
        <div><span>ROAS midia paga</span><strong>${focusRoas === null ? '—' : `${fmtNum(focusRoas, 2)}x`}</strong></div>
        <div><span>Pedidos organicos</span><strong>${fmtNum(focus.acquisition.pedidosOrganicos)}</strong></div>
      </div>
      <p class="compact-panel-note">Destaque visual: ${escapeHtml(focus.label)}. Investimento vem da planilha principal; ROAS usa a receita classificada como paga pelo SSOT. Media do grupo: retorno ${avgRoas === null ? '—' : `${fmtNum(avgRoas, 2)}x`}.</p>
    `;
  }

  function stockHtml(rows) {
    if (!rows.length) return '<div class="compact-empty">Sem estoque classificado para os modelos em análise.</div>';
    return `
      <table class="compact-table compact-table--stock">
        <thead>
          <tr>
            <th>SKU</th>
            <th>Linha</th>
            <th>Estoque</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.sku)}</td>
              <td>${escapeHtml(row.model)}</td>
              <td class="num">${fmtNum(row.available)}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
  }

  function presentationFiltersHtml(view) {
    const launchOptions = view.rows.map((row) => (
      `<option value="${escapeHtml(row.id)}" ${row.id === view.focus?.id ? 'selected' : ''}>${escapeHtml(row.label)}</option>`
    )).join('');
    const productOptions = view.productOptions.length
      ? view.productOptions.map((row) => (
        `<option value="${escapeHtml(row.key)}" ${row.key === view.filters.productId ? 'selected' : ''}>${escapeHtml(row.label)}</option>`
      )).join('')
      : '<option value="">Sem produto detalhado</option>';
    const colorOptions = view.colorOptions.length
      ? view.colorOptions.map((row) => (
        `<option value="${escapeHtml(row.key)}" ${row.key === view.filters.color ? 'selected' : ''}>${escapeHtml(row.label)}</option>`
      )).join('')
      : '<option value="">Selecione um produto</option>';
    const channelOptions = [
      ['all', 'Todos os canais'],
      ['investment', 'Midia paga'],
      ['organic', 'Organico'],
      ['other', 'Outros']
    ].map(([value, label]) => (
      `<option value="${value}" ${value === view.filters.channel ? 'selected' : ''}>${escapeHtml(label)}</option>`
    )).join('');
    return `
      <div class="compact-presentation-filters" aria-label="Filtros do modo apresentacao">
        <label><span>Linha em foco</span><select data-presentation-filter="model">${launchOptions}</select></label>
        <label><span>Período</span><select data-presentation-filter="period">
          ${WINDOW_KEYS.map((key) => `<option value="${key}" ${key === view.periodKey ? 'selected' : ''}>${escapeHtml(WINDOW_LABELS[key])}</option>`).join('')}
        </select></label>
        <label><span>Produto</span><select data-presentation-filter="product">
          <option value="">Todos da linha</option>
          ${productOptions}
        </select></label>
        <label><span>Cor</span><select data-presentation-filter="color" ${view.filters.productId && view.colorOptions.length ? '' : 'disabled'}>
          <option value="">Todas as cores</option>
          ${colorOptions}
        </select></label>
        <label><span>Canal</span><select data-presentation-filter="channel">${channelOptions}</select></label>
      </div>`;
  }

  function roasText(row) {
    if (row?.isPartial) return 'Parcial';
    if (row?.requiresValidation) return 'Validar';
    return row?.acquisition?.roas === null || row?.acquisition?.roas === undefined
      ? '—'
      : `${fmtNum(row.acquisition.roas, 2)}x`;
  }

  function launchCommercialReading(row, view) {
    if (row.isPartial) return `Janela aberta em D+${fmtNum(row.days)}`;
    if (row.requiresValidation) return 'ROAS fora da curva; validar verba';
    if (row.id === view.kpis.topRevenue?.id) return 'Líder de escala';
    if (row.id === view.topEfficiency?.id) return 'Melhor eficiência comparável';
    if (row.id === view.efficiencyAttention?.id && row.id !== view.topEfficiency?.id) return 'Maior oportunidade de retorno';
    if (!row.investment?.hasMedia) return 'Sem mídia paga na base da janela';
    return 'Desempenho intermediário';
  }

  function commercialFarol(row, view) {
    if (row?.isPartial) {
      return {
        tone: 'warning',
        label: 'Acompanhar',
        reason: `A janela ainda está em D+${fmtNum(row.days)} e não pode definir vencedor ou perdedor em ${view.periodLabel}.`
      };
    }
    if (row?.requiresValidation) {
      return {
        tone: 'warning',
        label: 'Validar base',
        reason: `O ROAS de ${fmtNum(row.acquisition?.roas, 2)}x está fora da curva do grupo. Confirmar a verba declarada antes de decidir.`
      };
    }
    if (!row?.investment?.hasMedia || row?.acquisition?.roas === null || row?.acquisition?.roas === undefined) {
      return {
        tone: 'neutral',
        label: 'Sem base',
        reason: 'Não existe base comparável de mídia paga para classificar a eficiência desta janela.'
      };
    }
    if (row.acquisition.roas < 1) {
      return {
        tone: 'negative',
        label: 'Rever',
        reason: `O retorno atribuído está abaixo de 1x: ${fmtNum(row.acquisition.roas, 2)}x. A receita paga não recompõe o investimento declarado.`
      };
    }
    if (row.acquisition.roas < 2) {
      return {
        tone: 'warning',
        label: 'Otimizar',
        reason: `O retorno atribuído é ${fmtNum(row.acquisition.roas, 2)}x. Há tração, mas a eficiência pede otimização antes de ampliar verba.`
      };
    }
    return {
      tone: 'positive',
      label: 'Favorável',
      reason: `A janela está fechada e o retorno atribuído é ${fmtNum(row.acquisition.roas, 2)}x, com base de mídia paga disponível.`
    };
  }

  function executiveReasons(view) {
    const closedCount = view.closedRows.length;
    const scale = view.kpis.topRevenue;
    const efficiency = view.topEfficiency;
    const attention = view.efficiencyAttention;
    return {
      scale: scale
        ? `${scale.label} foi escolhido porque tem o maior faturamento entre ${fmtNum(closedCount)} lançamentos com ${view.periodLabel} fechados: ${fmtBRL(scale.revenue)} e ${fmtNum(scale.pedidos)} pedidos. Linhas parciais não entram nessa escolha.`
        : `Ainda não há janela fechada suficiente para escolher um líder de escala em ${view.periodLabel}.`,
      efficiency: efficiency
        ? `${efficiency.label} foi escolhido porque possui o maior ROAS comparável entre as janelas fechadas com mídia paga disponível: ${fmtNum(efficiency.acquisition.roas, 2)}x. Valores fora da curva e janelas parciais são excluídos.`
        : 'Nenhuma linha possui, ao mesmo tempo, janela fechada e base de mídia paga comparável para eleger a melhor eficiência.',
      attention: attention
        ? `${attention.label} foi escolhido porque tem o menor ROAS entre as bases fechadas e comparáveis: ${fmtNum(attention.acquisition.roas, 2)}x. É uma prioridade de revisão de oferta, canal e campanha, não uma conclusão de margem financeira.`
        : 'A base atual não permite apontar um lançamento com atenção de eficiência sem misturar janelas parciais ou valores a validar.',
      maturity: view.partialRows.length
        ? `${view.partialRows.map((row) => `${row.label} em D+${fmtNum(row.days)}`).join(', ')} ainda não completou ${view.periodLabel}. O resultado aparece para acompanhamento, mas fica fora dos vencedores e perdedores.`
        : `Todos os ${fmtNum(view.rows.length)} lançamentos completaram ${view.periodLabel} e podem entrar no comparativo fechado.`
    };
  }

  function commercialFarolBadge(farol, tooltip = '') {
    return `<span class="commercial-farol commercial-farol--${farol.tone}"${tooltip ? ` tabindex="0" data-tooltip="${escapeHtml(tooltip)}"` : ''}><i aria-hidden="true"></i>${escapeHtml(farol.label)}</span>`;
  }

  function commercialSignal(label, value, detail, { tone = '', farol = null, reason = '' } = {}) {
    return `
      <article class="commercial-signal ${tone ? `commercial-signal--${tone}` : ''}">
        <div class="commercial-signal-head">
          <span>${escapeHtml(label)}</span>
          ${reason ? help(reason) : ''}
        </div>
        <strong>${escapeHtml(value)}</strong>
        <small>${escapeHtml(detail)}</small>
        ${farol ? commercialFarolBadge(farol, reason || farol.reason) : ''}
      </article>`;
  }

  function orderOriginMetrics(row) {
    const total = numberOrNull(row?.pedidos);
    const paid = numberOrNull(row?.acquisition?.pedidosInvestimento);
    const organic = numberOrNull(row?.acquisition?.pedidosOrganicos);
    const classified = paid !== null || organic !== null ? (paid || 0) + (organic || 0) : null;
    const coverage = ratioOrNull(classified, total);
    const reconciled = coverage !== null && Math.abs(coverage - 1) <= 0.01;
    return {
      total,
      paid,
      organic,
      paidShare: ratioOrNull(paid, total),
      organicShare: ratioOrNull(organic, total),
      coverage,
      reconciled,
      quality: row?.attributionQuality || null
    };
  }

  function orderOriginSummaryHtml(view) {
    const row = view.focus;
    const origin = orderOriginMetrics(row);
    const coverageFarol = origin.coverage === null
      ? { tone: 'neutral', label: 'Sem origem' }
      : origin.reconciled
        ? { tone: 'positive', label: 'Conciliado' }
        : origin.coverage >= .9
          ? { tone: 'warning', label: 'Revisar saldo' }
          : { tone: 'negative', label: 'Origem incompleta' };
    const quality = origin.quality || attributionQualityMeta(null);
    const tooltip = origin.coverage === null
      ? 'A janela não trouxe pedidos classificados por origem.'
      : `Pedidos pagos mais orgânicos representam ${fmtPct(origin.coverage, 1)} dos ${fmtNum(origin.total)} pedidos de ${row?.label || 'linha selecionada'}. Isso valida a soma binária; não significa que 100% tenham origem granular.`;
    return `
      <div class="commercial-origin-summary">
        <div class="commercial-origin-intro">
          <span>Origem dos pedidos · ${escapeHtml(row?.label || 'linha em foco')}</span>
          <strong>Pago versus orgânico</strong>
          <small>Origem/UTM granular quando existe; fallback binário alocado pelo SSOT nas lacunas.</small>
        </div>
        <div class="commercial-origin-metric commercial-origin-metric--paid">
          <span>Pedidos pagos</span>
          <strong>${fmtNum(origin.paid)}</strong>
          <small>${origin.paidShare === null ? 'sem participação' : `${fmtPct(origin.paidShare, 1)} dos pedidos`}</small>
        </div>
        <div class="commercial-origin-metric commercial-origin-metric--organic">
          <span>Pedidos orgânicos</span>
          <strong>${fmtNum(origin.organic)}</strong>
          <small>${origin.organicShare === null ? 'sem participação' : `${fmtPct(origin.organicShare, 1)} dos pedidos`}</small>
        </div>
        <div class="commercial-origin-check">
          <span>Conciliação binária</span>
          ${commercialFarolBadge(coverageFarol, tooltip)}
          <small>${origin.coverage === null ? 'sem cobertura calculável' : `${fmtPct(origin.coverage, 1)} do total classificado`}</small>
        </div>
        <div class="commercial-origin-check">
          <span>Qualidade da origem</span>
          ${commercialFarolBadge(quality, quality.reason)}
          <small>${quality.granularPct === null ? 'sem granular' : `${fmtPct(quality.granularPct, 1)} granular / ${fmtPct(quality.allocatedPct, 1)} alocado`}</small>
        </div>
      </div>`;
  }

  function orderOriginCell(row, type) {
    const origin = orderOriginMetrics(row);
    const value = type === 'paid' ? origin.paid : origin.organic;
    const share = type === 'paid' ? origin.paidShare : origin.organicShare;
    return `<strong>${fmtNum(value)}</strong><small>${share === null ? 'sem participação' : fmtPct(share, 1)}</small>`;
  }

  function launchComparisonHtml(view) {
    const ordered = [...view.rows].sort((a, b) => Number(a.isPartial) - Number(b.isPartial) || (b.revenue || 0) - (a.revenue || 0));
    return `
      <div class="commercial-comparison-table-wrap">
        <table class="commercial-comparison-table">
          <thead><tr>
            <th>Farol</th><th>Lançamento</th><th>Status da janela</th><th>Faturamento</th><th>Pedidos</th><th>Pagos</th><th>Orgânicos</th><th>Investimento</th><th>ROAS</th><th>Leitura comercial</th>
          </tr></thead>
          <tbody>${ordered.map((row) => {
            const farol = commercialFarol(row, view);
            return `<tr class="${row.id === view.focus?.id ? 'is-focus' : ''} ${row.isPartial ? 'is-partial' : ''}">
              <td>${commercialFarolBadge(farol, farol.reason)}</td>
              <td><strong>${escapeHtml(row.label)}</strong><small>${escapeHtml(row.launch?.linha || row.label)}</small></td>
              <td><span class="commercial-status ${row.isPartial ? 'is-warning' : 'is-closed'}">${row.isPartial ? `Parcial D+${fmtNum(row.days)}` : `${escapeHtml(view.periodLabel)} fechados`}</span></td>
              <td class="num"><strong>${fmtBRL(row.revenue, true)}</strong></td>
              <td class="num">${fmtNum(row.pedidos)}</td>
              <td class="num commercial-order-cell commercial-order-cell--paid">${orderOriginCell(row, 'paid')}</td>
              <td class="num commercial-order-cell commercial-order-cell--organic">${orderOriginCell(row, 'organic')}</td>
              <td class="num"><strong>${fmtBRL(row.investment?.value, true)}</strong><small>${escapeHtml(row.investment?.source || 'sem base')}</small></td>
              <td class="num"><strong>${escapeHtml(roasText(row))}</strong></td>
              <td>${escapeHtml(launchCommercialReading(row, view))}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>`;
  }

  function productColorCss(label) {
    const key = normalizeText(label).replace(/\s+/g, '_');
    const colors = {
      branco: '#e8e6dd',
      off_white: '#d9d4c3',
      preto: '#171717',
      all_black: '#111111',
      cinza: '#8b8b85',
      marrom: '#6e4a32',
      whisky: '#9c6a3c',
      azul_marinho: '#26364f',
      oliva: '#62664a',
      caqui: '#91846b'
    };
    return colors[key] || 'var(--txt-muted)';
  }

  function mixRankingHtml(items, { color = false, empty = 'Sem detalhe disponível' } = {}) {
    const visible = items.slice(0, 6);
    const max = Math.max(...visible.map((item) => numberOrNull(item.metrics?.receita) || 0), 0);
    if (!visible.length || !max) return `<div class="compact-empty">${escapeHtml(empty)}.</div>`;
    return `<div class="commercial-mix-list">${visible.map((item, index) => {
      const revenue = numberOrNull(item.metrics?.receita);
      const width = revenue === null || !max ? 0 : Math.max(2, round((revenue / max) * 100, 1));
      const colorSummary = !color && item.colors?.length
        ? `<div class="commercial-submodel-colors" aria-label="Cores de ${escapeHtml(item.label)}">${item.colors.map((colorItem) => `
            <span class="commercial-submodel-color-chip" title="${escapeHtml(colorItem.label)}: ${fmtBRL(colorItem.metrics?.receita, true)}">
              <i style="--product-color:${productColorCss(colorItem.label)}" aria-hidden="true"></i>
              ${escapeHtml(colorItem.label)}
              <small>${fmtPct(colorItem.share, 0)}</small>
            </span>`).join('')}</div>`
        : '';
      return `<div class="commercial-mix-row">
        <div class="commercial-mix-rank">${index + 1}º</div>
        <div class="commercial-mix-copy">
          <strong>${color ? `<i class="commercial-color-dot" style="--product-color:${productColorCss(item.label)}" aria-hidden="true"></i>` : ''}${escapeHtml(item.label)}</strong>
          <span>${fmtNum(item.metrics?.pedidos)} pedidos · ${fmtNum(item.metrics?.pares)} pares</span>
          ${colorSummary}
          <div class="commercial-mix-track"><i style="width:${width}%"></i></div>
        </div>
        <b>${fmtBRL(revenue, true)}</b>
      </div>`;
    }).join('')}</div>`;
  }

  function decisionBriefHtml(view) {
    const facts = [];
    const hypotheses = [];
    const scale = view.kpis.topRevenue;
    const focus = view.focus;
    const topProduct = view.products.topProduct;
    const paidShare = ratioOrNull(focus?.acquisition?.receitaInvestimento, focus?.window?.receita);
    if (scale) facts.push(`${scale.label} lidera a escala fechada com ${fmtBRL(scale.revenue, true)} e ${fmtNum(scale.pedidos)} pedidos.`);
    if (view.topEfficiency) facts.push(`${view.topEfficiency.label} tem o melhor ROAS comparável: ${fmtNum(view.topEfficiency.acquisition.roas, 2)}x.`);
    if (topProduct && focus) facts.push(`${topProduct.label} é o principal submodelo de ${focus.label}, com ${fmtBRL(topProduct.metrics?.receita, true)}.`);
    if (focus && paidShare !== null) facts.push(`${fmtPct(paidShare, 1)} do faturamento de ${focus.label} veio de pedidos classificados como mídia paga.`);
    if (view.efficiencyAttention && view.efficiencyAttention.id !== view.topEfficiency?.id) hypotheses.push(`Revisar oferta, mix e campanha de ${view.efficiencyAttention.label}; é a menor eficiência entre as bases comparáveis.`);
    if (view.validationRows.length) hypotheses.push(`${view.validationRows.map((row) => row.label).join(', ')} exige validação da verba antes de usar o ROAS em decisão.`);
    if (view.partialRows.length) hypotheses.push(`${view.partialRows.map((row) => row.label).join(', ')} permanece fora do ranking definitivo até fechar ${view.periodLabel}.`);
    if (view.products.topProduct && focus) hypotheses.push(`Testar se o submodelo líder de ${focus.label} deve receber mais estoque e pressão comercial.`);
    const list = (items) => items.length ? `<ul>${items.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>Sem sinal suficiente nesta seleção.</p>';
    return `
      <div class="commercial-decision-column"><span>Fatos para apresentar</span>${list(facts)}</div>
      <div class="commercial-decision-column"><span>Hipóteses e próximas decisões</span>${list(hypotheses)}</div>`;
  }

  function overviewHtml(view) {
    const focus = view.focus;
    const topRevenue = view.kpis.topRevenue;
    const reasons = executiveReasons(view);
    const partialText = view.partialRows.length
      ? `${view.partialRows.length} janela${view.partialRows.length > 1 ? 's' : ''} parcial${view.partialRows.length > 1 ? 'is' : ''}`
      : 'todas as janelas fechadas';
    const focusSelection = view.filters.productId
      ? `${view.products.products.find((row) => row.key === view.filters.productId)?.label || 'Produto'}${view.filters.color ? ` · ${view.products.colors.find((row) => row.key === view.filters.color)?.label || 'Cor'}` : ''}`
      : 'linha completa';
    return `
      <section class="compact-overview commercial-presentation" aria-label="Apresentação comercial dos lançamentos">
        <header class="compact-presentation-head commercial-presentation-head">
          <div>
            <span>Resumo comercial · ${escapeHtml(view.periodLabel)}</span>
            <h1>Performance dos lançamentos</h1>
            <p>${escapeHtml(view.verdict)}</p>
          </div>
          <strong>${escapeHtml(view.kpis.windowCoverage)} linhas com venda</strong>
        </header>

        <div class="commercial-filter-bar">
          <div><span>Recorte da apresentação</span><strong>${escapeHtml(focus?.label || '—')} · ${escapeHtml(focusSelection)}</strong></div>
          ${presentationFiltersHtml(view)}
        </div>

        <section class="commercial-section commercial-section--summary">
          <div class="commercial-section-head">
            <div><span>01 · Mensagem executiva</span><h2>Leitura executiva</h2></div>
            <div class="commercial-farol-guide" aria-label="Legenda do farol comercial">
              <span><i class="is-positive"></i>Favorável</span>
              <span><i class="is-warning"></i>Acompanhar</span>
              <span><i class="is-negative"></i>Rever</span>
              <span><i class="is-neutral"></i>Sem base</span>
            </div>
          </div>
          <div class="commercial-signal-grid">
            ${commercialSignal('Líder de escala', topRevenue?.label || '—', topRevenue ? `${fmtBRL(topRevenue.revenue, true)} · ${fmtNum(topRevenue.pedidos)} pedidos` : 'sem janela fechada', {
              tone: 'accent',
              farol: topRevenue ? { tone: 'positive', label: 'Escala validada' } : { tone: 'neutral', label: 'Sem base' },
              reason: reasons.scale
            })}
            ${commercialSignal('Melhor eficiência', view.topEfficiency?.label || '—', view.topEfficiency ? `${fmtNum(view.topEfficiency.acquisition.roas, 2)}x de ROAS comparável` : 'sem base comparável', {
              tone: 'positive',
              farol: view.topEfficiency ? { tone: 'positive', label: 'Eficiência validada' } : { tone: 'neutral', label: 'Sem base' },
              reason: reasons.efficiency
            })}
            ${commercialSignal('Ponto de atenção', view.efficiencyAttention?.label || '—', view.efficiencyAttention ? `${fmtNum(view.efficiencyAttention.acquisition.roas, 2)}x · revisar retorno` : 'sem sinal fechado', {
              tone: 'warning',
              farol: view.efficiencyAttention ? commercialFarol(view.efficiencyAttention, view) : { tone: 'neutral', label: 'Sem base' },
              reason: reasons.attention
            })}
            ${commercialSignal('Maturidade da leitura', partialText, `${fmtNum(view.closedRows.length)} de ${fmtNum(view.rows.length)} linhas comparáveis`, {
              tone: view.partialRows.length ? 'warning' : 'positive',
              farol: view.partialRows.length ? { tone: 'warning', label: 'Aguardar fechamento' } : { tone: 'positive', label: 'Base fechada' },
              reason: reasons.maturity
            })}
          </div>
          ${orderOriginSummaryHtml(view)}
        </section>

        <section class="commercial-section commercial-section--comparison">
          <div class="commercial-section-head"><div><span>02 · Comparativo de lançamentos</span><h2>Quem trouxe escala e quem converteu melhor a verba</h2></div><p>ROAS = receita de pedidos pagos / investimento de mídia paga + CRM da janela.</p></div>
          ${launchComparisonHtml(view)}
        </section>

        <section class="commercial-section commercial-section--products">
          <div class="commercial-section-head"><div><span>03 · Leitura de produto</span><h2>O que explica o resultado de ${escapeHtml(focus?.label || 'linha selecionada')}</h2></div><p>${escapeHtml(focusSelection)} · ${escapeHtml(view.products.colorContext)}</p></div>
          <div class="commercial-product-kpis">
            ${kpiCard('Faturamento do recorte', fmtBRL(view.products.selected?.receita), 'Receita do produto e da cor selecionados, dentro da janela atual.')}
            ${kpiCard('Pedidos do recorte', fmtNum(view.products.selected?.pedidos), 'Pedidos do produto e da cor selecionados, dentro da janela atual.')}
            ${kpiCard('Pares do recorte', fmtNum(view.products.selected?.pares), 'Pares do produto e da cor selecionados, dentro da janela atual.')}
            ${kpiCard('Ticket médio', fmtBRL(view.products.selected?.ticket), 'Faturamento dividido pelos pedidos do recorte atual.')}
          </div>
          <div class="commercial-product-grid">
            <div class="commercial-mix-block"><div class="commercial-block-head"><span>Submodelos</span><strong>Quem puxa a linha e suas cores</strong></div>${mixRankingHtml(view.products.products, { empty: 'Sem submodelo classificado' })}</div>
            <div class="commercial-mix-block"><div class="commercial-block-head"><span>Cores · ${escapeHtml(view.products.colorContext)}</span><strong>Preferência por cor no recorte</strong></div>${mixRankingHtml(view.products.colors, { color: true, empty: 'Selecione um submodelo para detalhar suas cores' })}</div>
          </div>
        </section>

        <section class="commercial-section commercial-section--decisions">
          <div class="commercial-section-head"><div><span>04 · Fechamento</span><h2>Fatos, hipóteses e decisões</h2></div><p>Hipóteses não são tratadas como conclusão.</p></div>
          <div class="commercial-decision-grid">${decisionBriefHtml(view)}</div>
        </section>

        <footer class="commercial-method">
          <strong>Como ler:</strong> vendas, pedidos e pares vêm do pipeline oficial; pago e orgânico preservam a divisão binária do SSOT, com origem granular quando disponível e alocação nas lacunas; investimento soma as linhas de mídia paga e CRM da janela declarada. Rentabilidade financeira não é inferida sem margem e CMV.
        </footer>
      </section>`;
  }

  function destroyChart() {
    if (state.chart) state.chart.destroy();
    state.chart = null;
  }

  function bubbleRadiusFactory(rows) {
    const revenues = rows.map((row) => row.revenue).filter((value) => value !== null);
    const minRevenue = revenues.length ? Math.min(...revenues) : 0;
    const maxRevenue = revenues.length ? Math.max(...revenues) : 0;
    const minRadius = 7;
    const maxRadius = 18;
    return (value) => {
      const revenue = numberOrNull(value);
      if (revenue === null) return minRadius;
      if (maxRevenue === minRevenue) return round((minRadius + maxRadius) / 2, 1);
      return round(minRadius + ((revenue - minRevenue) / (maxRevenue - minRevenue)) * (maxRadius - minRadius), 1);
    };
  }

  function renderBubbleChart(rows) {
    if (!window.Chart) return;
    const canvas = $('presentation-bubble-chart');
    if (!canvas) return;

    const chartRows = rows
      .filter((row) => row.share !== null && row.variation !== null && row.revenue !== null);
    if (!chartRows.length) return;

    const radiusFor = bubbleRadiusFactory(chartRows);
    const xValues = chartRows.map((row) => row.variation);
    const yValues = chartRows.map((row) => row.share);
    const minX = Math.min(0, ...xValues);
    const maxX = Math.max(0, ...xValues);
    const xPadding = Math.max((maxX - minX) * .12, .02);
    const maxY = Math.max(...yValues);

    const labelPlugin = {
      id: 'presentationBubbleLabels',
      afterDatasetsDraw(chart) {
        const { ctx } = chart;
        const meta = chart.getDatasetMeta(0);
        ctx.save();
        ctx.fillStyle = cssVar('--txt-secondary');
        ctx.font = '700 10px Inter, Segoe UI, Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'bottom';
        meta.data.forEach((element, index) => {
          const raw = chart.data.datasets[0].data[index];
          const radius = element.options.radius || 0;
          ctx.fillText(raw.label, element.x, Math.max(12, element.y - radius - 5));
        });
        ctx.restore();
      }
    };

    state.chart = new Chart(canvas, {
      type: 'bubble',
      data: {
        datasets: [{
          label: 'Lançamentos',
          data: chartRows.map((row) => ({
            x: round(row.variation, 4),
            y: round(row.share, 4),
            r: radiusFor(row.revenue),
            label: row.label,
            revenue: row.revenue
          })),
          borderColor: cssVar('--orange'),
          backgroundColor: cssVar('--orange-dim'),
          hoverBackgroundColor: cssVar('--orange-dim'),
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        layout: { padding: { top: 24, right: 8, bottom: 0, left: 0 } },
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const raw = ctx.raw;
                return `${raw.label}: participação ${fmtPct(raw.y, 1)} · variação ${fmtPct(raw.x, 1)} · receita ${fmtBRL(raw.revenue, true)}`;
              }
            }
          }
        },
        scales: {
          x: {
            min: round(minX - xPadding, 4),
            max: round(maxX + xPadding, 4),
            ticks: { callback: (value) => fmtPct(Number(value), 0), maxTicksLimit: 5 },
            grid: {
              color: (ctx) => Math.abs(Number(ctx.tick.value)) < 0.000001 ? cssVar('--border-2') : cssVar('--border'),
              lineWidth: (ctx) => Math.abs(Number(ctx.tick.value)) < 0.000001 ? 2 : 1
            }
          },
          y: {
            min: 0,
            max: round(maxY * 1.18, 4),
            ticks: { callback: (value) => fmtPct(Number(value), 0), maxTicksLimit: 5 },
            grid: { color: cssVar('--border') }
          }
        }
      },
      plugins: [labelPlugin]
    });
  }

  function renderOverview() {
    const view = buildViewModel(snapshot());
    if (!view.rows.length) {
      refs.page.innerHTML = '<section class="compact-overview compact-overview--empty"><div class="compact-empty">Sem lançamentos exportáveis carregados em memória.</div></section>';
      return;
    }
    refs.page.setAttribute('aria-label', 'Visão geral compacta do modo apresentação');
    refs.page.innerHTML = overviewHtml(view);
    bindPresentationFilters();
    renderBubbleChart(view.rows);
    refs.page.focus({ preventScroll: true });
  }

  function bindPresentationFilters() {
    refs.page.querySelectorAll('[data-presentation-filter]').forEach((control) => {
      control.addEventListener('change', () => {
        const key = control.dataset.presentationFilter;
        if (key === 'model') {
          state.filters.modelId = control.value;
          state.filters.productId = '';
          state.filters.color = '';
        } else if (key === 'line') {
          state.filters.line = control.value || 'all';
          state.filters.modelId = '';
          state.filters.productId = '';
          state.filters.color = '';
        } else if (key === 'period') {
          state.filters.periodKey = control.value;
        } else if (key === 'product') {
          state.filters.productId = control.value;
          state.filters.color = '';
        } else if (key === 'color') {
          state.filters.color = control.value;
        } else if (key === 'channel') {
          state.filters.channel = control.value || 'all';
        }
        destroyChart();
        renderOverview();
      });
    });
  }

  function requestFullscreen() {
    const target = document.documentElement;
    if (!target.requestFullscreen) return;
    try {
      const result = target.requestFullscreen();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      // Fullscreen can be denied by the browser; the overlay still works.
    }
  }

  function exitFullscreen() {
    if (!document.fullscreenElement || !document.exitFullscreen) return;
    try {
      const result = document.exitFullscreen();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      // Silent by design.
    }
  }

  function hydrateFiltersFromDashboard() {
    const current = snapshot();
    const product = filterKey(current?.productFilter, 'all');
    const color = filterKey(current?.productColorFilter, 'all');
    state.filters = {
      modelId: current?.primaryModelId || '',
      line: 'all',
      productId: product === 'all' ? '' : product,
      color: color === 'all' ? '' : color,
      periodKey: WINDOW_KEYS.includes(current?.analysisPeriodKey) ? current.analysisPeriodKey : '',
      channel: channelFilterKey(current)
    };
  }

  function openPresentation() {
    state.open = true;
    hydrateFiltersFromDashboard();
    state.returnFocus = document.activeElement;
    state.savedScroll = { x: window.scrollX, y: window.scrollY };
    state.appShellWasInert = Boolean(refs.appShell?.inert);

    refs.mode.hidden = false;
    refs.mode.setAttribute('aria-hidden', 'false');
    refs.mode.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    document.body.classList.add('presentation-open');
    if (refs.appShell) refs.appShell.inert = true;

    destroyChart();
    renderOverview();
    requestFullscreen();
  }

  function closePresentation({ skipFullscreen = false } = {}) {
    if (!state.open) return;
    state.open = false;
    destroyChart();

    refs.mode.hidden = true;
    refs.mode.setAttribute('aria-hidden', 'true');
    refs.page.innerHTML = '';
    document.body.classList.remove('presentation-open');
    if (refs.appShell) refs.appShell.inert = state.appShellWasInert;
    if (!skipFullscreen) exitFullscreen();

    window.scrollTo(state.savedScroll.x, state.savedScroll.y);
    if (state.returnFocus && typeof state.returnFocus.focus === 'function') {
      state.returnFocus.focus({ preventScroll: true });
    }
  }

  function focusables() {
    return Array.from(refs.mode.querySelectorAll(focusableSelector))
      .filter((element) => element.getClientRects().length > 0 || element === document.activeElement);
  }

  function trapFocus(event) {
    const items = focusables();
    if (!items.length) {
      event.preventDefault();
      refs.page.focus({ preventScroll: true });
      return;
    }
    const first = items[0];
    const last = items[items.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function onKeydown(event) {
    if (!state.open) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closePresentation();
    } else if (event.key === 'Tab') {
      trapFocus(event);
    }
  }

  function onFullscreenChange() {
    if (state.open && !document.fullscreenElement) {
      closePresentation({ skipFullscreen: true });
    }
  }

  function configurePresentation() {
    refs.toggle = $('presentation-toggle');
    refs.mode = $('presentation-mode');
    refs.close = $('presentation-close');
    refs.page = $('presentation-page');
    refs.appShell = document.querySelector('.app-shell');
    if (!refs.toggle || !refs.mode || !refs.close || !refs.page) return;

    refs.toggle.addEventListener('click', openPresentation);
    refs.close.addEventListener('click', () => closePresentation());
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  document.addEventListener('DOMContentLoaded', configurePresentation);
})();
