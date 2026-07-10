(() => {
  const TODAY = new Date('2026-07-08T12:00:00-03:00');
  const DATA_FILES = [
    'lancamentos_modelos',
    'lancamentos_historico',
    'lancamentos_produtos_dia',
    'midia_paga',
    'crm_disparos',
    'estoque',
    'calendario_br',
    'auditoria_monochrome'
  ];
  const NO_EMBEDDED_FALLBACK = new Set(['lancamentos_produtos_dia', 'auditoria_monochrome']);

  const CORES_MODELO = {
    gt: { line: '#F07800', fill: 'rgba(240,120,0,0.12)' },
    avant: { line: '#4C9F6A', fill: 'rgba(76,159,106,0.12)' },
    phantom: { line: '#7B8FE0', fill: 'rgba(123,143,224,0.12)' },
    rs8_monochrome: { line: '#E0B84C', fill: 'rgba(224,184,76,0.12)' },
    pais_2026: { line: '#5BB8D4', fill: 'rgba(91,184,212,0.12)' },
    _fallback: ['#E05252', '#5BB8D4', '#A87FD4', '#8FBD56']
  };

  const WINDOW_DAYS = { '7d': 7, '15d': 15, '30d': 30, '60d': 60, '90d': 90 };
  const WINDOW_KEYS = Object.keys(WINDOW_DAYS);
  const WINDOW_LABELS = {
    '7d': '7 dias',
    '15d': '15 dias',
    '30d': '30 dias',
    '60d': '60 dias',
    '90d': '90 dias'
  };
  const MILESTONE_DAYS = [0, 7, 15, 30, 60, 90];

  const state = {
    data: null,
    launches: [],
    primaryModelId: null,
    compareModelIds: [],
    charts: {}
  };

  const $ = (id) => document.getElementById(id);

  const fmtBRL = (value, compact = false) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency',
      currency: 'BRL',
      maximumFractionDigits: compact ? 1 : 0,
      notation: compact ? 'compact' : 'standard'
    }).format(value);
  };

  const fmtNum = (value, digits = 0) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(value);
  };

  const fmtPct = (value, digits = 1) => {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    return new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: digits }).format(value);
  };

  const fmtDate = (iso) => {
    if (!iso) return '—';
    const [y, m, d] = iso.split('-').map(Number);
    return new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(y, m - 1, d));
  };

  const toDate = (iso) => {
    if (!iso) return null;
    const [y, m, d] = iso.split('-').map(Number);
    if ([y, m, d].some(Number.isNaN)) return null;
    const date = new Date(y, m - 1, d, 12, 0, 0);
    return Number.isNaN(date.getTime()) ? null : date;
  };

  const toIsoDate = (date) => {
    if (!date) return null;
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  const daysBetween = (startIso, endDate) => {
    const start = toDate(startIso);
    if (!start || !endDate) return null;
    return Math.floor((endDate - start) / 86400000);
  };

  const dayIndex = (startIso, dateIso) => daysBetween(startIso, toDate(dateIso));

  const addDays = (iso, days) => {
    const d = toDate(iso);
    d.setDate(d.getDate() + days);
    return d;
  };

  const escapeHtml = (str) => String(str ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const badge = (type, label) => `<span class="badge badge--${type}">${escapeHtml(label)}</span>`;

  const colorFor = (id, index = 0) => CORES_MODELO[id]?.line || CORES_MODELO._fallback[index % CORES_MODELO._fallback.length];
  const fillFor = (id, index = 0) => CORES_MODELO[id]?.fill || `${CORES_MODELO._fallback[index % CORES_MODELO._fallback.length]}33`;
  const windowLabel = (key) => WINDOW_LABELS[key] || key;
  const normalizedStatus = (value) => String(value || '').trim().toLowerCase();
  const hasValidDayZero = (model) => Boolean(toDate(model?.day_zero_base || model?.d0));
  const isEligibleStatus = (status) => ['historico', 'ativo'].includes(normalizedStatus(status));
  const isHistoricalLaunch = (launch) => launch?.isEligible && normalizedStatus(launch.status) === 'historico';
  const isPlannedStatus = (status) => normalizedStatus(status) === 'planejado';
  const emptyWindows = () => WINDOW_KEYS.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {});

  const emptyDataFor = (name) => {
    if (name === 'manifest') return {};
    if (name === 'auditoria_monochrome') return null;
    return [];
  };

  async function fetchDataFile(name, version, allowFallback = true) {
    try {
      const suffix = encodeURIComponent(version || String(Date.now()));
      const res = await fetch(`data/${name}.json?v=${suffix}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(`${name}: ${res.status}`);
      return await res.json();
    } catch (err) {
      if (allowFallback && window.REISE_FALLBACK_DATA?.[name] !== undefined) {
        return window.REISE_FALLBACK_DATA[name];
      }
      return emptyDataFor(name);
    }
  }

  async function loadData() {
    const out = {};
    const manifest = await fetchDataFile('manifest', String(Date.now()), true);
    const version = manifest?.generated_at || String(Date.now());
    out.manifest = manifest || {};

    for (const name of DATA_FILES) {
      out[name] = await fetchDataFile(name, version, !NO_EMBEDDED_FALLBACK.has(name));
    }
    return out;
  }

  function isSizeToken(value) {
    return /^(3[3-9]|4[0-8])$/.test(String(value || '').trim());
  }

  function tidyPart(value) {
    return String(value || '')
      .replace(/\s+/g, ' ')
      .replace(/^[\s\-_/|,]+|[\s\-_/|,]+$/g, '')
      .trim();
  }

  function normalizeText(value) {
    return String(value || '')
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[-_]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  const COLOR_DEFS = [
    { label: 'All Black', norm: 'all black', end: /\s+all\s+black$/i },
    { label: 'Off White', norm: 'off white', end: /\s+off\s+white$/i },
    { label: 'Azul-marinho', norm: 'azul marinho', end: /\s+azul[-\s]+marinho$/i },
    { label: 'Caqui', norm: 'caqui', end: /\s+caqui$/i },
    { label: 'Cinza', norm: 'cinza', end: /\s+cinza$/i },
    { label: 'Marrom', norm: 'marrom', end: /\s+marrom$/i },
    { label: 'Preto', norm: 'preto', end: /\s+preto$/i },
    { label: 'Branco', norm: 'branco', end: /\s+branco$/i },
    { label: 'Camurca', norm: 'camurca', end: /\s+camur[cç]a$/i }
  ];

  const SKU_COLOR_CODES = {
    AB: 'All Black',
    CT: 'Caqui',
    MC: 'Cinza',
    CF: 'Marrom',
    PT: 'Preto',
    BC: 'Branco',
    OW: 'Off White'
  };

  function stripTrailingSize(value) {
    return tidyPart(value).replace(/\s*(?:-|\/|\|)?\s*(3[3-9]|4[0-8])\s*$/i, '').trim();
  }

  function colorFromSku(value) {
    const parts = String(value || '').toUpperCase().split(/[-_]/).map(tidyPart).filter(Boolean);
    for (const part of parts) {
      if (SKU_COLOR_CODES[part]) return SKU_COLOR_CODES[part];
    }
    return null;
  }

  function colorFromText(value) {
    const clean = stripTrailingSize(value);
    const norm = normalizeText(clean);
    const match = COLOR_DEFS.find((color) => norm === color.norm || norm.endsWith(` ${color.norm}`));
    return match?.label || null;
  }

  function stripTrailingColor(value) {
    let clean = stripTrailingSize(value);
    COLOR_DEFS.forEach((color) => {
      clean = clean.replace(color.end, '').trim();
    });
    return tidyPart(clean);
  }

  function extractSize(row) {
    if (row.tamanho && isSizeToken(row.tamanho)) return String(row.tamanho).trim();
    const fields = [row.variant_title, row.nome_produto, row.sku];
    for (const field of fields) {
      const text = String(field || '');
      const match = text.match(/(?:^|[^0-9])(3[3-9]|4[0-8])(?:[^0-9]|$)/);
      if (match) return match[1];
    }
    return 'Sem tamanho';
  }

  function looksLikeProductName(part) {
    return /\b(rs[0-9]|avant|phantom|gt|knit|slip|easy|collection|monochrome|mono)\b/i.test(part);
  }

  function looksLikeSku(part) {
    return /[A-Z]{2,}[-_][A-Z0-9]/i.test(part) || /^[A-Z0-9_-]{8,}$/i.test(part);
  }

  function extractColor(row) {
    if (row.cor && !isSizeToken(row.cor)) return tidyPart(row.cor);

    const explicitFields = [row.variant_title, row.nome_produto];
    for (const field of explicitFields) {
      const explicit = String(field || '').match(/(?:cor|color)\s*[:\-]\s*([^|/,\-]+)/i);
      if (explicit) {
        const color = tidyPart(explicit[1]);
        if (color && !isSizeToken(color)) return color;
      }
    }

    const parsedColor = [row.variant_title, row.nome_produto, row.sub_modelo]
      .map(colorFromText)
      .find(Boolean);
    if (parsedColor) return parsedColor;

    const skuColor = colorFromSku(row.sku);
    if (skuColor) return skuColor;

    const fields = [row.variant_title, row.nome_produto, row.sub_modelo, row.sku];
    for (const field of fields) {
      const parts = String(field || '')
        .split(/\s+(?:-|\/|\|)\s+|[|/]/)
        .map(tidyPart)
        .filter(Boolean)
        .filter((part) => !isSizeToken(part))
        .filter((part) => !looksLikeProductName(part))
        .filter((part) => !looksLikeSku(part));
      if (parts.length) return parts[parts.length - 1];
    }

    return 'Sem cor';
  }

  function extractSubModel(row, model) {
    const source = row.sub_modelo || row.product_title || row.nome_produto || model.modelo;
    const clean = stripTrailingColor(source);
    return clean || model.modelo;
  }

  function aggregatePipeline(model, rows) {
    const modelRows = rows.filter((row) => row.modelo_id === model.modelo_id);
    if (!modelRows.length) return null;

    const sumNullable = (items, field) => (
      items.some((row) => row[field] !== null && row[field] !== undefined)
        ? items.reduce((acc, row) => acc + Number(row[field] || 0), 0)
        : null
    );

    const todayIdx = daysBetween(model.day_zero_base, TODAY);
    const firstSaleDate = modelRows
      .map((row) => row.data)
      .filter(Boolean)
      .sort()[0] || null;

    const dailyMap = new Map();
    modelRows.forEach((row) => {
      const idx = dayIndex(model.day_zero_base, row.data);
      if (idx === null || idx < 0 || idx > 90) return;
      if (todayIdx !== null && idx > todayIdx) return;
      const current = dailyMap.get(row.data) || {
        data: row.data,
        day: idx,
        receita: 0,
        pares: 0,
        pedidos: 0,
        orderIds: new Set()
      };
      current.receita += Number(row.receita || 0);
      current.pares += Number(row.pares || 0);
      if (row.source_order_id) current.orderIds.add(row.source_order_id);
      else current.pedidos += Number(row.pedidos || 0);
      dailyMap.set(row.data, current);
    });

    const daily = [...dailyMap.values()]
      .sort((a, b) => a.day - b.day)
      .map(({ orderIds, ...row }) => ({
        ...row,
        pedidos: orderIds.size || row.pedidos,
        ticket: (orderIds.size || row.pedidos) ? row.receita / (orderIds.size || row.pedidos) : null,
        preco_medio_par: row.pares ? row.receita / row.pares : null
      }));

    const buildAggregate = (filtered, origem, day = null) => {
      if (!filtered.length) return null;
      const receita = sumNullable(filtered, 'receita');
      const pares = sumNullable(filtered, 'pares');
      const pedidosSomados = sumNullable(filtered, 'pedidos') || 0;
      const pedidosDistintos = new Set(filtered.map((row) => row.source_order_id).filter(Boolean));
      const pedidos = pedidosDistintos.size || pedidosSomados;
      const novos = sumNullable(filtered, 'novos');
      const recorrentes = sumNullable(filtered, 'recorrentes');
      const clientesClassificados = novos !== null && recorrentes !== null ? novos + recorrentes : null;
      return {
        receita,
        pares,
        pedidos,
        ticket: pedidos && receita !== null ? receita / pedidos : null,
        preco_medio_par: pares && receita !== null ? receita / pares : null,
        novos,
        recorrentes,
        novos_pct: clientesClassificados ? novos / clientesClassificados : null,
        origem,
        day
      };
    };

    const closedRows = (maxIdx) => modelRows.filter((row) => {
      const idx = dayIndex(model.day_zero_base, row.data);
      return idx !== null && idx >= 0 && idx <= maxIdx;
    });

    const currentMaxIdx = Math.min(90, Math.max(0, todayIdx ?? 0));
    const acumuladoAtual = buildAggregate(closedRows(currentMaxIdx), 'pipeline_atual', currentMaxIdx);

    const janelas = {};
    Object.entries(WINDOW_DAYS).forEach(([key, days]) => {
      if (todayIdx === null || todayIdx < days - 1) {
        janelas[key] = null;
        return;
      }
      janelas[key] = buildAggregate(closedRows(days - 1), 'pipeline');
    });

    const semanasMap = new Map();
    modelRows.forEach((row) => {
      const idx = dayIndex(model.day_zero_base, row.data);
      if (idx === null || idx < 0) return;
      const week = Math.floor(idx / 7) + 1;
      const key = `Sem ${week}`;
      const current = semanasMap.get(key) || { label: key, receita: 0, pedidos: 0, orderIds: new Set() };
      current.receita += Number(row.receita || 0);
      if (row.source_order_id) current.orderIds.add(row.source_order_id);
      else current.pedidos += Number(row.pedidos || 0);
      semanasMap.set(key, current);
    });

    const coresMap = new Map();
    const tamanhosMap = new Map();
    modelRows.forEach((row) => {
      const sub = extractSubModel(row, model);
      const cor = extractColor(row);
      const key = `${sub}::${cor}`;
      const current = coresMap.get(key) || { sub_modelo: sub, cor, pares: 0 };
      current.pares += Number(row.pares || 0);
      coresMap.set(key, current);

      const tamanho = extractSize(row);
      const sizeKey = `${model.modelo_id}::${tamanho}`;
      const currentSize = tamanhosMap.get(sizeKey) || { tamanho, pares: 0 };
      currentSize.pares += Number(row.pares || 0);
      tamanhosMap.set(sizeKey, currentSize);
    });

    const hasRevenue = (key) => janelas[key]?.receita !== null && janelas[key]?.receita !== undefined;
    const m15_7 = hasRevenue('15d') && hasRevenue('7d') && janelas['7d'].receita ? janelas['15d'].receita / janelas['7d'].receita : null;
    const m30 = hasRevenue('30d') && hasRevenue('15d') && janelas['15d'].receita ? janelas['30d'].receita / janelas['15d'].receita : null;
    const m60_30 = hasRevenue('60d') && hasRevenue('30d') && janelas['30d'].receita ? janelas['60d'].receita / janelas['30d'].receita : null;
    const m90_15 = hasRevenue('90d') && hasRevenue('15d') && janelas['15d'].receita ? janelas['90d'].receita / janelas['15d'].receita : null;
    const m90_30 = hasRevenue('90d') && hasRevenue('30d') && janelas['30d'].receita ? janelas['90d'].receita / janelas['30d'].receita : null;

    return {
      modelo_id: model.modelo_id,
      modelo: model.modelo,
      day_zero_base: model.day_zero_base,
      data_oficial: model.data_oficial,
      gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(model.day_zero_base)) || 0),
      janelas,
      semanas: [...semanasMap.values()].map(({ orderIds, ...week }) => ({
        ...week,
        pedidos: orderIds.size || week.pedidos
      })),
      cores: [...coresMap.values()],
      multiplicadores: { m15_7, m30_15: m30, m60_30, m90_15, m90_30 },
      daily,
      acumulado_atual: acumuladoAtual,
      first_sale_date: firstSaleDate,
      first_sale_gap_dias: firstSaleDate ? Math.max(0, daysBetween(model.day_zero_base, toDate(firstSaleDate)) || 0) : null,
      origem: 'pipeline',
      tamanhos: [...tamanhosMap.values()]
    };
  }

  function sumNullableRows(rows, field) {
    return rows.some((row) => row[field] !== null && row[field] !== undefined)
      ? rows.reduce((acc, row) => acc + Number(row[field] || 0), 0)
      : null;
  }

  function hasWindowValue(win, field = 'receita') {
    return win?.[field] !== null && win?.[field] !== undefined;
  }

  function cumulativePointsFromWindows(metrics) {
    return WINDOW_KEYS
      .map((key) => {
        const win = metrics.janelas?.[key];
        if (!win || !hasWindowValue(win, 'receita')) return null;
        return {
          key,
          day: WINDOW_DAYS[key] - 1,
          receita: numberOrNull(win.receita),
          pares: numberOrNull(win.pares),
          pedidos: numberOrNull(win.pedidos),
          novos: numberOrNull(win.novos),
          recorrentes: numberOrNull(win.recorrentes)
        };
      })
      .filter(Boolean)
      .sort((a, b) => a.day - b.day);
  }

  function spreadDelta(startValue, endValue, steps) {
    if (startValue === null || startValue === undefined || endValue === null || endValue === undefined || !steps) return null;
    return (Number(endValue) - Number(startValue)) / steps;
  }

  function backfillDailyFromWindows(metrics) {
    const points = cumulativePointsFromWindows(metrics);
    if (!points.length) return [];

    const daily = [];
    let previous = {
      day: -1,
      receita: 0,
      pares: 0,
      pedidos: 0,
      novos: null,
      recorrentes: null
    };

    points.forEach((point) => {
      const steps = point.day - previous.day;
      if (steps <= 0) {
        previous = point;
        return;
      }

      const increments = {
        receita: spreadDelta(previous.receita, point.receita, steps),
        pares: spreadDelta(previous.pares, point.pares, steps),
        pedidos: spreadDelta(previous.pedidos, point.pedidos, steps),
        novos: spreadDelta(previous.novos, point.novos, steps),
        recorrentes: spreadDelta(previous.recorrentes, point.recorrentes, steps)
      };

      for (let day = previous.day + 1; day <= point.day; day += 1) {
        daily.push({
          day,
          receita: increments.receita,
          pares: increments.pares,
          pedidos: increments.pedidos,
          novos: increments.novos,
          recorrentes: increments.recorrentes,
          estimated: true
        });
      }
      previous = point;
    });

    return daily.filter((row) => row.day >= 0 && row.day <= 90);
  }

  function aggregateDailyWindow(daily, day, origem) {
    const rows = daily.filter((row) => row.day >= 0 && row.day <= day);
    if (!rows.length) return null;

    const receita = sumNullableRows(rows, 'receita');
    const pares = sumNullableRows(rows, 'pares');
    const pedidos = sumNullableRows(rows, 'pedidos');
    const novos = sumNullableRows(rows, 'novos');
    const recorrentes = sumNullableRows(rows, 'recorrentes');
    const clientesClassificados = novos !== null && recorrentes !== null ? novos + recorrentes : null;

    return {
      receita,
      pares,
      pedidos,
      ticket: pedidos && receita !== null ? receita / pedidos : null,
      preco_medio_par: pares && receita !== null ? receita / pares : null,
      novos,
      recorrentes,
      novos_pct: clientesClassificados ? novos / clientesClassificados : null,
      origem,
      day
    };
  }

  function weeklyFromDaily(daily) {
    const weeks = new Map();
    daily.forEach((row) => {
      if (row.day < 0 || row.day > 90) return;
      const week = Math.floor(row.day / 7) + 1;
      const key = `Sem ${week}`;
      const current = weeks.get(key) || { label: key, receita: 0, pedidos: 0 };
      current.receita += Number(row.receita || 0);
      current.pedidos += Number(row.pedidos || 0);
      weeks.set(key, current);
    });
    return [...weeks.values()];
  }

  function calculateMultipliers(janelas, previous = {}) {
    const ratio = (later, earlier) => {
      const laterValue = janelas?.[later]?.receita;
      const earlierValue = janelas?.[earlier]?.receita;
      return laterValue !== null && laterValue !== undefined && earlierValue ? laterValue / earlierValue : null;
    };
    return {
      ...previous,
      m15_7: ratio('15d', '7d') ?? previous.m15_7 ?? null,
      m30_15: ratio('30d', '15d') ?? previous.m30_15 ?? null,
      m60_30: ratio('60d', '30d') ?? previous.m60_30 ?? null,
      m90_15: ratio('90d', '15d') ?? previous.m90_15 ?? null,
      m90_30: ratio('90d', '30d') ?? previous.m90_30 ?? null
    };
  }

  function completeEligibleMetrics(model, metrics, eligible) {
    const completed = {
      ...metrics,
      janelas: { ...emptyWindows(), ...(metrics.janelas || {}) },
      multiplicadores: { m15_7: null, m30_15: null, m60_30: null, m90_15: null, m90_30: null, ...(metrics.multiplicadores || {}) },
      semanas: metrics.semanas || [],
      daily: metrics.daily || [],
      daily_source: metrics.daily_source || null
    };

    if (!eligible) return completed;

    if (!completed.daily.length) {
      const backfilled = backfillDailyFromWindows(completed);
      if (backfilled.length) {
        completed.daily = backfilled;
        completed.daily_source = 'historico_backfill';
      }
    }

    if (completed.daily.length) {
      const maxDailyDay = Math.max(...completed.daily.map((row) => row.day).filter((day) => day >= 0 && day <= 90));
      WINDOW_KEYS.forEach((key) => {
        const windowDay = WINDOW_DAYS[key] - 1;
        if (!hasWindowValue(completed.janelas[key], 'receita') && maxDailyDay >= windowDay) {
          const origem = completed.daily_source === 'historico_backfill' ? 'historico_backfill' : completed.origem;
          completed.janelas[key] = aggregateDailyWindow(completed.daily, windowDay, origem || 'pipeline');
        }
      });

      if (!completed.semanas.length) {
        completed.semanas = weeklyFromDaily(completed.daily);
      }
    }

    completed.multiplicadores = calculateMultipliers(completed.janelas, completed.multiplicadores);
    return completed;
  }

  function buildLaunches(data) {
    const histById = new Map(data.lancamentos_historico.map((item) => [item.modelo_id, item]));
    return data.lancamentos_modelos.map((model, idx) => {
      const hist = histById.get(model.modelo_id);
      const pipelineRows = (data.lancamentos_produtos_dia || []).filter((row) => row.modelo_id === model.modelo_id);
      const pipeline = aggregatePipeline(model, data.lancamentos_produtos_dia || []);
      const rawMetrics = pipeline || hist || {
        modelo_id: model.modelo_id,
        modelo: model.modelo,
        day_zero_base: model.day_zero_base,
        data_oficial: model.data_oficial,
        gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(model.day_zero_base)) || 0),
        janelas: emptyWindows(),
        multiplicadores: { m15_7: null, m30_15: null, m60_30: null, m90_15: null, m90_30: null },
        semanas: [],
        cores: [],
        tamanhos: [],
        daily: [],
        acumulado_atual: null,
        first_sale_date: null,
        first_sale_gap_dias: null,
        origem: isPlannedStatus(model.status) ? 'planejado' : 'pipeline'
      };
      const d0 = model.day_zero_base || model.data_lancamento;
      const d0Date = toDate(d0);
      const dPlus = d0Date ? daysBetween(d0, TODAY) : null;
      const isFuture = d0Date ? d0Date > TODAY : true;
      const status = normalizedStatus(model.status);
      const isEligible = isEligibleStatus(status) && hasValidDayZero(model) && !isFuture;
      const metrics = completeEligibleMetrics(model, rawMetrics, isEligible);
      const isActive = status === 'ativo' && !isFuture;
      const isHistorical = status === 'historico';
      return {
        ...model,
        ...metrics,
        order: idx,
        d0,
        dPlus,
        pipelineRowCount: pipelineRows.length,
        daily: metrics.daily || [],
        tamanhos: metrics.tamanhos || [],
        acumulado_atual: metrics.acumulado_atual || null,
        first_sale_date: metrics.first_sale_date || (metrics.origem === 'historico' ? metrics.day_zero_base : null),
        first_sale_gap_dias: metrics.first_sale_gap_dias ?? (metrics.origem === 'historico' ? Math.max(0, daysBetween(metrics.data_oficial, toDate(metrics.day_zero_base)) || 0) : null),
        isFuture,
        isActive,
        isHistorical,
        isEligible
      };
    });
  }

  function getWindow(launch, key) {
    return launch?.janelas?.[key] ?? null;
  }

  function bestWindow(launch) {
    if (!launch) return { key: null, data: null };
    if (getWindow(launch, '30d')) return { key: '30d', data: getWindow(launch, '30d') };
    if (getWindow(launch, '15d')) return { key: '15d', data: getWindow(launch, '15d') };
    if (getWindow(launch, '7d')) return { key: '7d', data: getWindow(launch, '7d') };
    if (getWindow(launch, '60d')) return { key: '60d', data: getWindow(launch, '60d') };
    if (getWindow(launch, '90d')) return { key: '90d', data: getWindow(launch, '90d') };
    return { key: null, data: null };
  }

  function hasPipelineRows(launch) {
    return Number(launch?.pipelineRowCount || 0) > 0;
  }

  function exportTotalsForModel(modelId) {
    const rows = (state.data?.lancamentos_produtos_dia || []).filter((row) => row.modelo_id === modelId);
    const orderIds = new Set();
    let pedidosFallback = 0;
    let pares = 0;
    let receita = 0;

    rows.forEach((row) => {
      if (row.source_order_id) orderIds.add(row.source_order_id);
      else pedidosFallback += Number(row.pedidos || 0);
      pares += Number(row.pares || 0);
      receita += Number(row.receita || 0);
    });

    return {
      pedidos: orderIds.size || pedidosFallback,
      pares,
      receita
    };
  }

  function pctDiff(value, reference) {
    const ref = Number(reference || 0);
    const val = Number(value || 0);
    if (!ref && !val) return 0;
    if (!ref) return 1;
    return Math.abs(val - ref) / Math.abs(ref);
  }

  function localMonochromeAuditQuality() {
    const audit = state.data?.auditoria_monochrome;
    const resumo = audit?.resumo;
    if (!resumo) return null;

    const exported = exportTotalsForModel('rs8_monochrome');
    const pedidosAuditoria = Number(resumo.pedidos || 0);
    const paresAuditoria = Number(resumo.pares_vendidos || 0);
    const receitaAuditoria = Number(resumo.receita_liquida_itens || 0);
    const diferencaPedidosPct = pctDiff(exported.pedidos, pedidosAuditoria);
    const diferencaParesPct = pctDiff(exported.pares, paresAuditoria);
    const diferencaReceitaPct = pctDiff(exported.receita, receitaAuditoria);
    const status = Math.max(diferencaPedidosPct, diferencaParesPct, diferencaReceitaPct) > 0.01 ? 'divergente' : 'ok';

    return {
      status,
      auditado: status === 'ok',
      pedidos_auditoria: pedidosAuditoria,
      pares_auditoria: paresAuditoria,
      receita_auditoria: receitaAuditoria,
      pedidos_exportados: exported.pedidos,
      pares_exportados: exported.pares,
      receita_exportada: exported.receita,
      diferenca_pedidos_pct: diferencaPedidosPct,
      diferenca_pares_pct: diferencaParesPct,
      diferenca_receita_pct: diferencaReceitaPct,
      linhas_suspeitas: (audit.linhas_suspeitas || []).length,
      duplicidades: (audit.duplicidades || []).length
    };
  }

  function auditQualityForLaunch(launch) {
    if (launch?.modelo_id !== 'rs8_monochrome') return null;
    return localMonochromeAuditQuality()
      || state.data?.manifest?.data_quality?.rs8_monochrome
      || null;
  }

  function auditBadgeForLaunch(launch) {
    const quality = auditQualityForLaunch(launch);
    if (!quality) return null;
    if (quality.status === 'ok' && quality.auditado !== false) return badge('pipeline', 'Auditado');
    if (quality.status === 'divergente') return badge('neg', 'Divergente');
    return null;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value === 'number') return Number.isNaN(value) ? null : value;
    const text = String(value).trim();
    if (!text) return null;
    const cleaned = text.replace(/\s/g, '').replace(/[^\d,.-]/g, '');
    if (!cleaned || !/[0-9]/.test(cleaned)) return null;
    const usesDecimalComma = cleaned.includes(',') && (!cleaned.includes('.') || cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.'));
    const normalized = usesDecimalComma
      ? cleaned.replace(/\./g, '').replace(',', '.')
      : cleaned.replace(/,/g, '');
    const num = Number(normalized);
    return Number.isNaN(num) ? null : num;
  }

  function coverageBadge(launch, key) {
    const win = getWindow(launch, key);
    if (!win) return '—';
    if (win.origem === 'historico_backfill') return badge('parcial', 'Hist. estim.');
    if (win.origem === 'historico' || normalizedStatus(launch.status) === 'historico') return badge('historico', 'Histórico');
    const days = WINDOW_DAYS[key] || 0;
    const dCount = (launch.dPlus ?? 0) + 1;
    if (dCount < days) return badge('parcial', `Parcial D+${Math.max(0, launch.dPlus)}`);
    return badge('pipeline', 'Pipeline');
  }

  function sourceBadge(launch) {
    const auditBadge = auditBadgeForLaunch(launch);
    if (auditBadge) return auditBadge;
    const hasAnyWindow = WINDOW_KEYS.some((key) => Boolean(getWindow(launch, key)));
    if (launch.isFuture) return badge('planejado', 'Planejado');
    if (normalizedStatus(launch.status) === 'historico') return badge('historico', 'Histórico');
    if (!hasAnyWindow && hasPipelineRows(launch)) return badge('parcial', `Atual D+${Math.max(0, launch.dPlus)}`);
    if (!hasAnyWindow) return badge('parcial', `Sem dados D+${Math.max(0, launch.dPlus)}`);
    if (launch.origem === 'pipeline') return badge('pipeline', `Pipeline D+${Math.max(0, launch.dPlus)}`);
    return badge('parcial', 'Sem dados');
  }

  function configureChartDefaults() {
    if (!window.Chart) return;
    Chart.defaults.font.family = 'Inter, "Segoe UI", Arial, sans-serif';
    Chart.defaults.font.size = 11;
    Chart.defaults.color = 'rgba(255,255,255,0.55)';
    Chart.defaults.scale.grid.color = 'rgba(255,255,255,0.05)';
    Chart.defaults.scale.border.display = false;
    Chart.defaults.scale.ticks.padding = 8;
    Chart.defaults.plugins.legend.labels.usePointStyle = true;
    Chart.defaults.plugins.legend.labels.boxWidth = 8;
    Chart.defaults.plugins.tooltip.backgroundColor = '#2C2C2C';
    Chart.defaults.plugins.tooltip.borderColor = 'rgba(255,255,255,0.12)';
    Chart.defaults.plugins.tooltip.borderWidth = 1;
    Chart.defaults.plugins.tooltip.titleColor = '#FFFFFF';
    Chart.defaults.plugins.tooltip.bodyColor = 'rgba(255,255,255,0.70)';
    Chart.defaults.plugins.tooltip.cornerRadius = 6;
    Chart.defaults.plugins.tooltip.padding = 10;
  }

  function destroyCharts() {
    Object.values(state.charts).forEach((chart) => chart?.destroy?.());
    state.charts = {};
  }

  function chartOptions(extra = {}) {
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { padding: 16 } },
        tooltip: { enabled: true }
      },
      scales: {
        x: { grid: { display: false } },
        y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.05)' } }
      },
      ...extra
    };
  }

  function createChart(id, cfg) {
    const canvas = $(id);
    if (!canvas || !window.Chart) return null;
    state.charts[id] = new Chart(canvas, cfg);
    return state.charts[id];
  }

  function configureDrawer() {
    const drawer = $('nav-drawer');
    const overlay = $('drawer-overlay');
    const toggle = $('nav-drawer-toggle');
    const close = $('nav-drawer-close');
    if (!drawer || !overlay || !toggle || !close) return;

    const setOpen = (open) => {
      document.body.classList.toggle('drawer-open', open);
      overlay.hidden = !open;
      toggle.setAttribute('aria-expanded', String(open));
      drawer.setAttribute('aria-hidden', String(!open));
      if (open) drawer.removeAttribute('inert');
      else drawer.setAttribute('inert', '');
      if (open) drawer.focus({ preventScroll: true });
    };

    toggle.addEventListener('click', () => setOpen(!document.body.classList.contains('drawer-open')));
    close.addEventListener('click', () => setOpen(false));
    overlay.addEventListener('click', () => setOpen(false));
    drawer.querySelectorAll('.nav-list a').forEach((link) => {
      link.addEventListener('click', () => setOpen(false));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') setOpen(false);
    });
  }

  function configureTooltips() {
    const tooltip = document.createElement('div');
    tooltip.className = 'app-tooltip';
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    let activeTarget = null;

    const targetFrom = (node) => node?.closest?.('[data-tooltip]');
    const positionTooltip = (target) => {
      if (!target || tooltip.hidden) return;
      const gap = 10;
      const margin = 12;
      const rect = target.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      let left = rect.left + (rect.width / 2) - (tip.width / 2);
      let top = rect.bottom + gap;

      if (top + tip.height > window.innerHeight - margin) {
        top = rect.top - tip.height - gap;
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - tip.height - margin));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    const show = (target) => {
      const text = target?.dataset?.tooltip;
      if (!text) return;
      activeTarget = target;
      tooltip.textContent = text;
      tooltip.hidden = false;
      requestAnimationFrame(() => positionTooltip(target));
    };

    const hide = () => {
      activeTarget = null;
      tooltip.hidden = true;
    };

    document.addEventListener('pointerover', (event) => {
      const target = targetFrom(event.target);
      if (target) show(target);
    });
    document.addEventListener('pointerout', (event) => {
      const target = targetFrom(event.target);
      const next = event.relatedTarget;
      if (target && !(next instanceof Node && target.contains(next))) hide();
    });
    document.addEventListener('focusin', (event) => {
      const target = targetFrom(event.target);
      if (target) show(target);
    });
    document.addEventListener('focusout', (event) => {
      if (targetFrom(event.target)) hide();
    });
    document.addEventListener('click', (event) => {
      const target = targetFrom(event.target);
      if (!target) {
        hide();
        return;
      }
      event.preventDefault();
      show(target);
    });
    window.addEventListener('resize', () => positionTooltip(activeTarget));
    window.addEventListener('scroll', () => positionTooltip(activeTarget), true);
  }

  function renderModelSelector() {
    const wrap = $('model-selector');
    wrap.innerHTML = comparableLaunches().map((launch) => {
      const cls = ['model-pill'];
      if (launch.modelo_id === state.primaryModelId) cls.push('active');
      const status = launch.isActive ? '●' : '';
      return `<button class="${cls.join(' ')}" data-model="${launch.modelo_id}">
        <span class="dot" style="color:${colorFor(launch.modelo_id, launch.order)}"></span>
        ${escapeHtml(launch.modelo)} ${status}
      </button>`;
    }).join('');
    wrap.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.primaryModelId = btn.dataset.model;
        renderAll();
      });
    });
  }

  function renderCompareSelector() {
    const wrap = $('compare-selector');
    const warning = $('compare-warning');
    const selected = new Set(state.compareModelIds || []);
    const launches = comparableLaunches();
    const selectedLaunches = launches.filter((launch) => selected.has(launch.modelo_id));
    const label = selectedLaunches.length === launches.length
      ? 'Todos os modelos'
      : selectedLaunches.length
        ? `${selectedLaunches.length} modelos selecionados`
        : 'Nenhum modelo selecionado';
    wrap.innerHTML = `
      <div class="compare-toolbar">
        <div class="compare-summary">${escapeHtml(label)} - ${fmtNum(selectedLaunches.length)} de ${fmtNum(launches.length)}</div>
        <div class="compare-actions">
          <button class="compare-action" type="button" data-compare-action="all">Todos</button>
          <button class="compare-action" type="button" data-compare-action="none">Limpar</button>
        </div>
      </div>
      <div class="compare-chip-grid">
        ${launches.map((launch) => {
          const active = selected.has(launch.modelo_id);
          return `<label class="compare-chip ${active ? 'active' : ''}" title="${escapeHtml(launch.modelo)}">
            <input type="checkbox" value="${launch.modelo_id}" ${active ? 'checked' : ''}>
            <span class="dot" style="color:${colorFor(launch.modelo_id, launch.order)}"></span>
            <span>${escapeHtml(launch.modelo)}</span>
          </label>`;
        }).join('')}
      </div>`;
    wrap.querySelectorAll('[data-compare-action]').forEach((button) => {
      button.addEventListener('click', () => {
        state.compareModelIds = button.dataset.compareAction === 'all'
          ? launches.map((launch) => launch.modelo_id)
          : [];
        renderAll();
      });
    });
    wrap.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        const ids = new Set(state.compareModelIds || []);
        if (input.checked) ids.add(input.value);
        else ids.delete(input.value);
        state.compareModelIds = [...ids];
        renderAll();
      });
    });
    if (!selectedLaunches.length) {
      warning.textContent = 'Nenhum modelo marcado; as análises usam o modelo principal.';
    } else if (selectedLaunches.length === 1) {
      warning.textContent = 'Com 1 modelo, as análises aparecem sem delta comparativo.';
    } else {
      warning.textContent = '';
    }
  }

  function renderTopMeta() {
    const manifest = state.data.manifest || {};
    $('last-update').textContent = manifest.generated_at ? fmtDate(manifest.generated_at.slice(0, 10)) : '—';
    $('model-count').textContent = state.launches.length;
    $('active-count').textContent = state.launches.filter((l) => l.isActive).length;
    $('planned-count').textContent = state.launches.filter((l) => isPlannedStatus(l.status)).length;
  }

  function renderSelectedHeader(selected) {
    const firstSaleGap = selected?.first_sale_date
      ? daysBetween(selected.d0, toDate(selected.first_sale_date))
      : null;
    const dLabel = selected.isFuture
      ? `D${selected.dPlus}`
      : `D+${Math.max(0, selected.dPlus ?? 0)}`;
    const firstSaleLabel = selected.first_sale_date
      ? `${fmtDate(selected.first_sale_date)}${firstSaleGap !== null ? ` · D+${Math.max(0, firstSaleGap)}` : ''}`
      : '—';

    const items = [
      { label: 'Data oficial', value: fmtDate(selected.data_oficial) },
      { label: 'D0 usado', value: fmtDate(selected.d0) },
      { label: 'Primeira venda', value: firstSaleLabel },
      { label: 'Posição hoje', value: dLabel }
    ];

    $('selected-dates').innerHTML = items.map((item) => `
      <span class="selected-date-chip">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </span>
    `).join('');
  }

  function renderMethodology(selected) {
    const rows = [
      {
        title: 'Arquitetura',
        copy: 'Dashboard estático em HTML + Chart.js, lendo JSONs via fetch. Sem servidor próprio em runtime.',
        badge: badge('pipeline', 'Vercel-ready')
      },
      {
        title: 'Cadastro',
        copy: 'Novos lançamentos entram pela aba lancamentos_modelos. O front não precisa receber código novo.',
        badge: badge('orange', 'Sheet')
      },
      {
        title: 'SSOT',
        copy: 'Vendas vêm do BigQuery/SSOT unificando Shopify + Shoppub em southamerica-east1. A query usa D0 inclusivo com filtro >=.',
        badge: badge('pipeline', 'BigQuery')
      },
      {
        title: 'Dado ausente',
        copy: 'Tabelas exibem “—” e gráficos usam null. Nunca convertem ausência em zero.',
        badge: badge('parcial', 'Regra fixa')
      }
    ];

    if (!(state.data.lancamentos_produtos_dia || []).length) {
      rows.unshift({
        title: 'Alerta técnico',
        copy: 'lancamentos_produtos_dia.json está vazio. Sem dados carregados no pipeline. Verifique BigQuery, termos de busca e exportação do Apps Script.',
        badge: badge('neg', 'Pipeline vazio')
      });
    }

    const firstSaleGap = selected?.first_sale_date
      ? daysBetween(selected.d0, toDate(selected.first_sale_date))
      : null;
    rows.push({
      title: 'Datas do modelo',
      copy: `Data oficial: ${fmtDate(selected.data_oficial)} · Day zero usado: ${fmtDate(selected.d0)} · Primeira venda encontrada: ${fmtDate(selected.first_sale_date)} · Gap base: ${fmtNum(selected.gap_dias ?? 0)} dias`,
      badge: selected.first_sale_date
        ? badge(firstSaleGap > 0 && selected.isActive ? 'neg' : 'pipeline', firstSaleGap > 0 ? `1ª venda D+${firstSaleGap}` : 'D0')
        : badge('parcial', 'Sem venda')
    });

    if (selected.isActive && firstSaleGap > 0) {
      rows.push({
        title: 'Alerta de match',
        copy: 'Primeira venda encontrada após o D0. Verifique termos de busca, SKU e exportação do BigQuery.',
        badge: badge('neg', 'Verificar')
      });
    }

    if (selected?.gap_dias > 0) {
      rows.push({
        title: 'Gap entre datas',
        copy: 'Este modelo tem diferença entre data oficial e day_zero_base. A leitura de abertura deve usar o D0 base informado no cadastro.',
        badge: badge('parcial', `Gap ${fmtNum(selected.gap_dias)}d`)
      });
    }

    if (selected?.observacao) {
      rows.push({
        title: 'Observação do cadastro',
        copy: selected.observacao,
        badge: badge('parcial', 'Modelo')
      });
    }

    if (selected?.isActive) {
      rows.push({
        title: 'Modelo ativo',
        copy: 'Modelo em curso. Se aparecer sem vendas, a correção deve acontecer no pipeline/JSON, não no front.',
        badge: badge('parcial', `D+${Math.max(0, selected.dPlus)}`)
      });
    }

    $('methodology-list').innerHTML = rows.map((row) => `
      <div class="method-item">
        <div class="method-title">${escapeHtml(row.title)}</div>
        <div class="method-copy">${escapeHtml(row.copy)}</div>
        <div>${row.badge}</div>
      </div>
    `).join('');
  }

  function renderState(selected) {
    const container = $('launch-state');
    if (selected.isFuture) {
      const diff = Math.max(0, daysBetween(new Date(TODAY.getFullYear(), TODAY.getMonth(), TODAY.getDate(), 12).toISOString().slice(0,10), toDate(selected.d0)) || 0);
      const hist = state.launches.filter(isHistoricalLaunch);
      const avg15 = hist.reduce((a, l) => a + (getWindow(l, '15d')?.receita || 0), 0) / hist.length;
      const avg30 = hist.reduce((a, l) => a + (getWindow(l, '30d')?.receita || 0), 0) / hist.length;
      const avgTicket = hist.reduce((a, l) => a + (getWindow(l, '30d')?.ticket || 0), 0) / hist.length;
      container.innerHTML = `
        <div class="future-box">
          <div class="countdown">
            <div class="countdown-number">${fmtNum(diff)}</div>
            <div class="countdown-label">dias para o lançamento</div>
            <div class="metric-sub" style="color:rgba(255,255,255,.75);margin-top:10px">Previsão: ${fmtDate(selected.d0)}</div>
          </div>
          <div class="card">
            <div class="metric-label">Benchmark histórico</div>
            <div class="grid grid-3" style="margin-top:14px">
              <div><div class="metric-sub">Fat. 15d média</div><div class="metric-value">${fmtBRL(avg15)}</div></div>
              <div><div class="metric-sub">Fat. 30d média</div><div class="metric-value">${fmtBRL(avg30)}</div></div>
              <div><div class="metric-sub">Ticket médio/pedido</div><div class="metric-value">${fmtBRL(avgTicket)}</div></div>
            </div>
            <p class="section-desc" style="margin-top:16px">O dashboard já calcula sazonalidade futura a partir de calendario_br.json. Depois do D0, os dados entram pelo pipeline.</p>
          </div>
        </div>`;
      return;
    }

    const closedWindow = selected.isActive && selected.acumulado_atual
      ? { key: null, data: null }
      : bestWindow(selected);
    const isCurrentAccumulated = !closedWindow.data && Boolean(selected.acumulado_atual);
    const key = isCurrentAccumulated ? `D+${selected.acumulado_atual.day}` : closedWindow.key;
    const data = closedWindow.data || selected.acumulado_atual;
    const windowDays = isCurrentAccumulated ? (selected.acumulado_atual.day + 1) : Number(String(key || '').replace('d', ''));
    const velocity = data?.receita && windowDays ? data.receita / windowDays : null;
    const previous = previousLaunch(selected);
    const prevWin = previous && !isCurrentAccumulated ? getWindow(previous, key || '30d') : null;
    const delta = data?.receita && prevWin?.receita ? (data.receita / prevWin.receita) - 1 : null;
    const dataSub = isCurrentAccumulated ? badge('parcial', `Acumulado atual ${key}`) : coverageBadge(selected, key);
    const auditQuality = auditQualityForLaunch(selected);
    const auditWarning = auditQuality?.status === 'divergente'
      ? `<div class="empty-state empty-state--danger"><div><strong>Os totais do dashboard não batem com a auditoria SSOT.</strong> Não usar este dado para decisão.</div></div>`
      : '';

    const cards = [
      { label: isCurrentAccumulated ? 'Faturamento atual' : `Faturamento ${key || ''}`, value: fmtBRL(data?.receita), sub: dataSub },
      { label: 'Pedidos', value: fmtNum(data?.pedidos), sub: data?.pedidos ? `${fmtNum(data.pedidos)} pedidos` : 'Sem pedidos no JSON' },
      { label: 'Ticket médio/pedido', value: fmtBRL(data?.ticket), sub: data?.ticket ? (isCurrentAccumulated ? `Acumulado ${key}` : `Janela ${key}`) : '—' },
      { label: 'Preço médio/par', value: fmtBRL(data?.preco_medio_par), sub: data?.preco_medio_par ? `${fmtNum(data?.pares)} pares` : '—' },
      { label: '% Clientes novos', value: fmtPct(data?.novos_pct), sub: data?.novos_pct != null ? `${fmtPct(1 - data.novos_pct)} recorrentes` : '—' },
      { label: 'Pares vendidos', value: fmtNum(data?.pares), sub: data?.pares ? `${fmtNum(data.pares)} pares` : 'Sem pares no JSON' }
    ];

    const empty = !data ? `<div class="empty-state"><div><strong>${selected.isActive && !hasPipelineRows(selected) ? 'Sem dados carregados no pipeline.' : 'Sem dados de venda para este lançamento.'}</strong> Verifique BigQuery, termos de busca e exportação do Apps Script. A tela não transforma ausência em zero.</div></div>` : '';

    container.innerHTML = `
      <div class="grid grid-6">
        ${cards.map((card) => `
          <div class="card">
            <div class="metric-label">${escapeHtml(card.label)}</div>
            <div class="metric-value">${card.value}</div>
            <div class="metric-sub">${card.sub}</div>
          </div>`).join('')}
      </div>
      ${auditWarning}
      ${empty}
      <div class="grid grid-2" style="margin-top:14px">
        <div class="card soft">
          <div class="metric-label">Velocidade diária</div>
          <div class="metric-value">${fmtBRL(velocity)}</div>
          <div class="metric-sub">${isCurrentAccumulated ? `R$/dia no acumulado ${key}` : `R$/dia na janela ${key || '—'}`}</div>
        </div>
        <div class="card soft">
          <div class="metric-label">Comparativo anterior</div>
          <div class="metric-value">${delta === null ? '—' : `<span class="delta ${delta >= 0 ? 'delta--pos' : 'delta--neg'}">${delta >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(delta))}</span>`}</div>
          <div class="metric-sub">${isCurrentAccumulated ? 'Disponível quando uma janela fechar.' : `vs ${previous ? escapeHtml(previous.modelo) : 'modelo anterior'} na mesma janela`}</div>
        </div>
      </div>`;
  }

  function previousLaunch(selected) {
    const hist = state.launches
      .filter((l) => l.modelo_id !== selected.modelo_id && isEligibleLaunch(l))
      .sort((a, b) => toDate(a.d0) - toDate(b.d0));
    const idx = hist.findIndex((l) => toDate(l.d0) > toDate(selected.d0));
    if (idx > 0) return hist[idx - 1];
    const before = hist.filter((l) => toDate(l.d0) < toDate(selected.d0));
    return before[before.length - 1] || hist[hist.length - 1] || null;
  }

  function isEligibleLaunch(launch) {
    return Boolean(launch?.isEligible);
  }

  function comparableLaunches() {
    return state.launches.filter(isEligibleLaunch);
  }

  function defaultComparableLaunch(launches = comparableLaunches()) {
    return [...launches].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (toDate(b.d0)?.getTime() || 0) - (toDate(a.d0)?.getTime() || 0);
    })[0] || state.launches[0] || null;
  }

  function selectedCompareLaunches() {
    const allowed = comparableLaunches();
    const selectedIds = new Set(state.compareModelIds || []);
    const selected = allowed.filter((launch) => selectedIds.has(launch.modelo_id));
    if (selected.length) return selected;
    const primary = allowed.find((launch) => launch.modelo_id === state.primaryModelId);
    return primary ? [primary] : [];
  }

  function hasEnoughComparison() {
    return selectedCompareLaunches().length >= 1;
  }

  function comparisonEmptyMessage(colspan) {
    return `<tr><td colspan="${colspan}" class="cell-muted">Selecione ao menos um modelo para analisar.</td></tr>`;
  }

  function syncSelectionState() {
    const comparable = comparableLaunches();
    if (!comparable.length) return;

    if (!comparable.some((launch) => launch.modelo_id === state.primaryModelId)) {
      state.primaryModelId = defaultComparableLaunch(comparable)?.modelo_id || comparable[0].modelo_id;
    }

    const allowedIds = new Set(comparable.map((launch) => launch.modelo_id));
    state.compareModelIds = (state.compareModelIds || []).filter((id) => allowedIds.has(id));
  }

  function comparisonDay(selected) {
    if (!selected || selected.isFuture) return null;
    if (selected.daily?.length) return Math.min(90, Math.max(...selected.daily.map((row) => row.day)));
    if (selected.isActive && selected.dPlus !== null) return Math.min(90, Math.max(0, selected.dPlus));
    return Math.min(90, Math.max(0, selected.dPlus ?? 90));
  }

  function cumulativeAt(launch, day) {
    if (!launch.daily?.length || day === null || day === undefined) return null;
    const rows = launch.daily.filter((row) => row.day <= day);
    if (!rows.length) return null;
    const receita = rows.reduce((acc, row) => acc + Number(row.receita || 0), 0);
    const pedidos = rows.reduce((acc, row) => acc + Number(row.pedidos || 0), 0);
    const pares = rows.reduce((acc, row) => acc + Number(row.pares || 0), 0);
    return {
      receita,
      pedidos,
      pares,
      ticket: pedidos ? receita / pedidos : null,
      preco_medio_par: pares ? receita / pares : null,
      velocidade: receita / (day + 1)
    };
  }

  function windowVelocity(launch) {
    const { key, data } = bestWindow(launch);
    if (!key || !data?.receita) return null;
    return data.receita / Number(key.replace('d', ''));
  }

  function renderDplusComparison(selected) {
    const day = comparisonDay(selected);
    if (day === null || day === undefined || selected.isFuture) {
      $('dplus-table').innerHTML = `<tr><td colspan="6" class="cell-muted">Lançamento planejado: comparativo D+n fica fora da análise até D0 e dados reais.</td></tr>`;
      return;
    }
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('dplus-table').innerHTML = comparisonEmptyMessage(6);
      return;
    }

    const rows = launches.map((launch) => {
      const data = cumulativeAt(launch, day);
      return `
        <tr>
          <td class="model-name">${escapeHtml(launch.modelo)}<div class="metric-sub">D+${day}${launch.daily?.length ? '' : ' · sem curva diária'}</div></td>
          <td class="num">${fmtBRL(data?.receita)}</td>
          <td class="num">${fmtNum(data?.pedidos)}</td>
          <td class="num">${fmtNum(data?.pares)}</td>
          <td class="num">${fmtBRL(data?.ticket)}</td>
          <td class="num">${data?.velocidade == null ? '—' : `${fmtBRL(data.velocidade)}/dia`}</td>
        </tr>`;
    }).join('');

    $('dplus-table').innerHTML = rows || `<tr><td colspan="6" class="cell-muted">Sem lançamentos com dados reais para comparar.</td></tr>`;
  }

  function metricDelta(value, selectedValue, formatter = fmtBRL) {
    if (value === null || value === undefined || selectedValue === null || selectedValue === undefined) return '—';
    const delta = value - selectedValue;
    const cls = delta >= 0 ? 'delta--pos' : 'delta--neg';
    return `<span class="delta ${cls}">${delta >= 0 ? '▲' : '▼'} ${formatter(Math.abs(delta))}</span>`;
  }

  function renderRankings(selected) {
    const rankingDefs = [
      { title: 'Faturamento 7d', get: (l) => getWindow(l, '7d')?.receita, fmt: fmtBRL },
      { title: 'Faturamento 15d', get: (l) => getWindow(l, '15d')?.receita, fmt: fmtBRL },
      { title: 'Faturamento 30d', get: (l) => getWindow(l, '30d')?.receita, fmt: fmtBRL },
      { title: 'Faturamento 60d', get: (l) => getWindow(l, '60d')?.receita, fmt: fmtBRL },
      { title: 'Faturamento 90d', get: (l) => getWindow(l, '90d')?.receita, fmt: fmtBRL },
      { title: 'Ticket/pedido 30d', get: (l) => getWindow(l, '30d')?.ticket, fmt: fmtBRL },
      { title: 'Pares 30d', get: (l) => getWindow(l, '30d')?.pares, fmt: fmtNum },
      { title: '% novos 30d', get: (l) => getWindow(l, '30d')?.novos_pct, fmt: fmtPct },
      { title: 'Velocidade R$/dia', get: windowVelocity, fmt: fmtBRL }
    ];
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('ranking-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione ao menos um modelo.</strong>Rankings usam os modelos marcados em Comparar com.</div></div>`;
      return;
    }
    const selectedIncluded = launches.some((launch) => launch.modelo_id === selected.modelo_id);

    $('ranking-grid').innerHTML = rankingDefs.map((def) => {
      const selectedValue = def.get(selected);
      const rows = launches
        .map((launch) => ({ launch, value: def.get(launch) }))
        .filter((row) => row.value !== null && row.value !== undefined)
        .sort((a, b) => b.value - a.value);

      return `<div class="card">
        <div class="chart-title" style="margin-bottom:10px">${escapeHtml(def.title)}</div>
        ${selectedIncluded ? '' : `<div class="metric-sub" style="margin-bottom:8px">Delta contra ${escapeHtml(selected.modelo)}, que não está na seleção.</div>`}
        <div class="table-wrap">
          <table style="min-width:420px">
            <tbody>
              ${rows.length ? rows.map((row, index) => `
                <tr>
                  <td>${index + 1}</td>
                  <td>${escapeHtml(row.launch.modelo)}</td>
                  <td class="num">${def.fmt(row.value)}</td>
                  <td class="num">${metricDelta(row.value, selectedValue, def.fmt)}</td>
                </tr>`).join('') : `<tr><td class="cell-muted">Sem dados</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>`;
    }).join('');
  }

  function renderHistoricalAverage(selected) {
    if (selected.isFuture) {
      $('historical-average').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Lançamento planejado.</strong>Comparativo contra média histórica fica fora da análise até D0 e dados reais.</div></div>`;
      return;
    }
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('historical-average').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione ao menos um modelo.</strong>A média histórica usa os modelos marcados em Comparar com.</div></div>`;
      return;
    }
    const referencePool = launches.some(isHistoricalLaunch)
      ? launches
      : comparableLaunches();

    const day = comparisonDay(selected);
    const dailyRefs = referencePool.filter((l) => isHistoricalLaunch(l) && l.daily?.length);
    const selectedDaily = cumulativeAt(selected, day);
    let label = day !== null ? `D+${day}` : '—';
    let selectedValue = selectedDaily?.receita ?? null;
    const dailyValues = day !== null
      ? dailyRefs.map((launch) => cumulativeAt(launch, day)?.receita).filter((value) => value !== null && value !== undefined)
      : [];
    let avg = dailyValues.length
      ? dailyValues.reduce((acc, value) => acc + value, 0) / dailyValues.length
      : null;

    if (avg === null || selectedValue === null) {
      const { key, data } = bestWindow(selected);
      const fallbackKey = key || '15d';
      const refs = referencePool.filter((l) => isHistoricalLaunch(l) && getWindow(l, fallbackKey)?.receita);
      label = fallbackKey;
      selectedValue = data?.receita ?? null;
      avg = refs.length ? refs.reduce((acc, launch) => acc + getWindow(launch, fallbackKey)?.receita, 0) / refs.length : null;
    }

    const diff = selectedValue !== null && avg !== null ? selectedValue - avg : null;
    const pct = diff !== null && avg ? diff / avg : null;

    $('historical-average').innerHTML = `
      <div class="card">
        <div class="metric-label">Modelo selecionado</div>
        <div class="metric-value">${fmtBRL(selectedValue)}</div>
        <div class="metric-sub">${escapeHtml(selected.modelo)} · ${escapeHtml(label)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Média histórica</div>
        <div class="metric-value">${fmtBRL(avg)}</div>
        <div class="metric-sub">Históricos disponíveis · ${escapeHtml(label)}</div>
      </div>
      <div class="card">
        <div class="metric-label">Diferença vs média</div>
        <div class="metric-value">${diff === null ? '—' : metricDelta(selectedValue, avg, fmtBRL)}</div>
        <div class="metric-sub">${pct === null ? '—' : fmtPct(pct)}</div>
      </div>`;
  }

  function renderComparison() {
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('comparison-table').innerHTML = comparisonEmptyMessage(10);
      return;
    }

    const rows = launches.map((launch) => {
      const j7 = getWindow(launch, '7d');
      const j15 = getWindow(launch, '15d');
      const j30 = getWindow(launch, '30d');
      const j60 = getWindow(launch, '60d');
      const j90 = getWindow(launch, '90d');
      const mult = launch.multiplicadores?.m90_30;
      return `
        <tr>
          <td class="model-name">${escapeHtml(launch.modelo)}<div class="metric-sub">D0: ${fmtDate(launch.d0)}</div></td>
          <td>${fmtBRL(j7?.receita)}<div>${coverageBadge(launch, '7d')}</div></td>
          <td>${fmtBRL(j15?.receita)}<div>${coverageBadge(launch, '15d')}</div></td>
          <td>${fmtBRL(j30?.receita)}<div>${coverageBadge(launch, '30d')}</div></td>
          <td>${fmtBRL(j60?.receita)}<div>${coverageBadge(launch, '60d')}</div></td>
          <td>${fmtBRL(j90?.receita)}<div>${coverageBadge(launch, '90d')}</div></td>
          <td class="num">${fmtBRL(j30?.ticket)}</td>
          <td class="num">${fmtPct(j30?.novos_pct, 1)}</td>
          <td class="num">${mult ? `${fmtNum(mult, 2)}×` : '—'}</td>
          <td>${sourceBadge(launch)}</td>
        </tr>`;
    }).join('');
    $('comparison-table').innerHTML = rows || `<tr><td colspan="10" class="cell-muted">Sem lançamentos com dados reais para comparar.</td></tr>`;
  }

  function renderCharts(selected) {
    destroyCharts();
    if (!window.Chart) return;

    const chartLaunches = selectedCompareLaunches();
    const labels = WINDOW_KEYS;
    const windowChartLaunches = chartLaunches.filter((launch) => labels.some((key) => Boolean(getWindow(launch, key))));

    createChart('chart-revenue', {
      type: 'bar',
      data: {
        labels: labels.map(windowLabel),
        datasets: windowChartLaunches.map((launch, index) => ({
          label: launch.modelo,
          data: labels.map((key) => getWindow(launch, key)?.receita ?? null),
          backgroundColor: colorFor(launch.modelo_id, index),
          borderColor: colorFor(launch.modelo_id, index),
          borderWidth: 1,
          borderRadius: 4
        }))
      },
      options: chartOptions({
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}` } } },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => fmtBRL(v, true) } } }
      })
    });

    createChart('chart-pairs', {
      type: 'bar',
      data: {
        labels: labels.map(windowLabel),
        datasets: windowChartLaunches.map((launch, index) => ({
          label: launch.modelo,
          data: labels.map((key) => getWindow(launch, key)?.pares ?? null),
          backgroundColor: fillFor(launch.modelo_id, index),
          borderColor: colorFor(launch.modelo_id, index),
          borderWidth: 1,
          borderRadius: 4
        }))
      },
      options: chartOptions({ scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => fmtNum(v) } } } })
    });

    createChart('chart-multipliers', {
      type: 'bar',
      data: {
        labels: ['15÷7', '30÷15', '60÷30', '90÷30'],
        datasets: windowChartLaunches.map((launch, index) => ({
          label: launch.modelo,
          data: [
            launch.multiplicadores?.m15_7 ?? null,
            launch.multiplicadores?.m30_15 ?? null,
            launch.multiplicadores?.m60_30 ?? null,
            launch.multiplicadores?.m90_30 ?? null
          ],
          backgroundColor: colorFor(launch.modelo_id, index),
          borderRadius: 4
        }))
      },
      options: chartOptions({ scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${fmtNum(v, 1)}×` } } } })
    });

    const mixWindowFor = (launch) => {
      const keys = ['30d', '15d', '7d', '60d', '90d'];
      const key = keys.find((windowKey) => getWindow(launch, windowKey));
      if (key) return { key, data: getWindow(launch, key) };
      if (launch.acumulado_atual) return { key: `D+${launch.acumulado_atual.day}`, data: launch.acumulado_atual };
      return { key: '—', data: null };
    };
    const clientMixRows = chartLaunches.map((launch) => {
      const { key, data } = mixWindowFor(launch);
      return {
        launch,
        key,
        data,
        pct: data?.novos_pct ?? null,
        novos: data?.novos ?? null,
        recorrentes: data?.recorrentes ?? null
      };
    });

    createChart('chart-mix', {
      type: 'bar',
      data: {
        labels: clientMixRows.map((row) => row.launch.modelo),
        datasets: [
          {
            label: 'Novos',
            data: clientMixRows.map((row) => row.pct == null ? null : row.pct * 100),
            backgroundColor: '#F07800',
            borderRadius: 4
          },
          {
            label: 'Recorrentes',
            data: clientMixRows.map((row) => row.pct == null ? null : (1 - row.pct) * 100),
            backgroundColor: '#4C9F6A',
            borderRadius: 4
          }
        ]
      },
      options: chartOptions({
        indexAxis: 'y',
        scales: { x: { stacked: true, ticks: { callback: (v) => `${v}%` }, max: 100 }, y: { stacked: true, grid: { display: false } } },
        plugins: { tooltip: { callbacks: { label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.x, 1)}%` } } }
      })
    });
    $('client-mix-detail').innerHTML = clientMixRows.length ? `
      <div class="client-mix-list">
        ${clientMixRows.map((row) => {
          const hasMix = row.pct !== null;
          return `<div class="client-mix-row">
            <span>${escapeHtml(row.launch.modelo)} · ${escapeHtml(row.key)}</span>
            <strong>${hasMix ? `${fmtPct(row.pct, 1)} novos · ${fmtPct(1 - row.pct, 1)} recorrentes` : 'Novos/recorrentes —'}</strong>
            <small>${hasMix ? `${fmtNum(row.novos)} novos · ${fmtNum(row.recorrentes)} recorrentes` : 'Classificação ainda não veio no JSON de vendas.'}</small>
          </div>`;
        }).join('')}
      </div>
    ` : '';

    const weekly = chartLaunches.find((l) => l.modelo_id === selected.modelo_id && l.semanas?.length) || chartLaunches.find((l) => l.semanas?.length);
    $('weekly-title').textContent = weekly ? `${weekly.modelo} — semana a semana` : 'Semana a semana';
    createChart('chart-weekly', {
      type: 'bar',
      data: {
        labels: weekly?.semanas?.map((w) => w.label) || [],
        datasets: [
          { label: 'Faturamento', data: weekly?.semanas?.map((w) => w.receita) || [], backgroundColor: colorFor(weekly?.modelo_id || selected.modelo_id), yAxisID: 'y', borderRadius: 4 },
          { label: 'Pedidos', type: 'line', data: weekly?.semanas?.map((w) => w.pedidos) || [], borderColor: '#E0B84C', backgroundColor: '#E0B84C', yAxisID: 'y1', tension: 0.35, pointRadius: 4 }
        ]
      },
      options: chartOptions({
        scales: {
          x: { grid: { display: false } },
          y: { position: 'left', ticks: { callback: (v) => fmtBRL(v, true) } },
          y1: { position: 'right', grid: { drawOnChartArea: false }, ticks: { callback: (v) => fmtNum(v) } }
        },
        plugins: { tooltip: { callbacks: { label: (ctx) => ctx.dataset.label === 'Faturamento' ? `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}` : `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}` } } }
      })
    });

    const normalizedLabels = Array.from({ length: 91 }, (_, day) => day === 0 ? 'D0' : `D+${day}`);
    const normalizedLaunches = [...chartLaunches].sort((a, b) => {
      if (a.modelo_id === selected.modelo_id) return -1;
      if (b.modelo_id === selected.modelo_id) return 1;
      return a.order - b.order;
    });
    createChart('chart-normalized', {
      type: 'line',
      data: {
        labels: normalizedLabels,
        datasets: normalizedLaunches.map((launch, index) => {
          const data = Array(91).fill(null);
          const hasDaily = Boolean(launch.daily?.length);
          const isBackfilled = launch.daily_source === 'historico_backfill';
          if (hasDaily) {
            const byDay = new Map();
            launch.daily.forEach((row) => {
              if (row.day < 0 || row.day > 90) return;
              byDay.set(row.day, (byDay.get(row.day) || 0) + Number(row.receita || 0));
            });
            let running = 0;
            const validDays = launch.daily.map((row) => row.day).filter((day) => day >= 0 && day <= 90);
            const maxDailyDay = validDays.length ? Math.min(90, Math.max(...validDays)) : 0;
            for (let day = 0; day <= maxDailyDay; day += 1) {
              running += byDay.get(day) || 0;
              data[day] = running;
            }
          } else {
            data[0] = 0;
            const points = WINDOW_KEYS.map((key) => ({
              day: WINDOW_DAYS[key],
              value: getWindow(launch, key)?.receita
            }));
            points.forEach((point) => {
              if (point.value !== null && point.value !== undefined) data[point.day] = point.value;
            });
          }
          const validDataDays = data
            .map((value, day) => value !== null && value !== undefined ? day : null)
            .filter((day) => day !== null);
          const lastDataDay = validDataDays.length ? Math.max(...validDataDays) : null;
          const isSelected = launch.modelo_id === selected.modelo_id;
          return {
            label: isBackfilled ? `${launch.modelo} · backfill` : hasDaily ? launch.modelo : `${launch.modelo} · agregado`,
            data,
            borderColor: colorFor(launch.modelo_id, index),
            backgroundColor: fillFor(launch.modelo_id, index),
            borderWidth: isSelected ? 3 : 2,
            borderDash: isBackfilled ? [4, 4] : hasDaily ? [] : [6, 5],
            fill: isSelected ? 'origin' : false,
            pointRadius: (ctx) => {
              const day = ctx.dataIndex;
              if (data[day] === null || data[day] === undefined) return 0;
              if (day === lastDataDay) return isSelected ? 4 : 3;
              return MILESTONE_DAYS.includes(day) ? (isSelected ? 3 : 2) : 0;
            },
            pointHoverRadius: 6,
            pointHitRadius: 10,
            pointBackgroundColor: colorFor(launch.modelo_id, index),
            pointBorderColor: '#1A1A1A',
            pointBorderWidth: 1,
            tension: hasDaily ? 0.32 : 0.12,
            spanGaps: !hasDaily,
            sourceLabel: isBackfilled ? 'backfill diário a partir das janelas acumuladas' : hasDaily ? 'diário real' : 'histórico agregado'
          };
        })
      },
      options: chartOptions({
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              title: (items) => `${items[0].dataset.label} · ${items[0].label}`,
              label: (ctx) => `Receita acumulada: ${fmtBRL(ctx.parsed.y)}`,
              afterLabel: (ctx) => `Fonte: ${ctx.dataset.sourceLabel}`
            }
          }
        },
        scales: {
          x: {
            grid: { display: false },
            ticks: {
              autoSkip: false,
              maxRotation: 0,
              callback: (_, index) => MILESTONE_DAYS.includes(index) ? (index === 0 ? 'D0' : `D+${index}`) : ''
            }
          },
          y: {
            ticks: { callback: (v) => fmtBRL(v, true) },
            grid: { color: 'rgba(255,255,255,0.045)' }
          }
        }
      })
    });
  }

  function renderStock(selected) {
    const rows = (state.data.estoque || []).filter((row) => row.modelo_id === selected.modelo_id);
    if (!rows.length) {
      $('stock-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Sem dados de estoque para ${escapeHtml(selected.modelo)}.</strong>O arquivo data/estoque.json está preparado, mas precisa ser preenchido pelo BigQuery.</div></div>`;
      return;
    }
    $('stock-grid').innerHTML = rows.map((row) => {
      const coverage = row.cobertura_dias ?? (row.vendas_d30 ? row.estoque_atual / (row.vendas_d30 / 30) : null);
      const low = coverage !== null && coverage < 15;
      return `<div class="stock-card ${low ? 'low' : ''}">
        <div class="stock-title">${escapeHtml(row.sub_modelo || selected.modelo)}</div>
        <div class="stock-sub">${escapeHtml(row.cor || 'Sem cor')}</div>
        <div class="stock-row"><span>Estoque atual</span><span>${fmtNum(row.estoque_atual)}</span></div>
        <div class="stock-row"><span>Vendas D-30</span><span>${fmtNum(row.vendas_d30)}</span></div>
        <div class="stock-row"><span>Cobertura</span><span>${coverage === null ? '—' : `${fmtNum(coverage, 0)} dias`}</span></div>
        ${low ? `<div style="margin-top:10px">${badge('neg', 'Cobertura baixa')}</div>` : ''}
      </div>`;
    }).join('');
  }

  function renderColorMix() {
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione ao menos um modelo.</strong>O mix usa os modelos marcados em Comparar com.</div></div>`;
      return;
    }

    const rows = launches.flatMap((launch) => (launch.cores || []).map((row) => ({
      ...row,
      modelo_id: launch.modelo_id,
      modelo: launch.modelo,
      sub_modelo: row.sub_modelo || launch.modelo,
      cor: row.cor || 'Sem cor'
    })));

    if (!rows.length) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Sem mix de cores.</strong>Dados entram pelo histórico estático ou pelo pipeline de venda por SKU.</div></div>`;
      return;
    }

    const grouped = rows.reduce((acc, row) => {
      const key = `${row.modelo}::${row.sub_modelo}`;
      (acc[key] ||= { modelo: row.modelo, sub_modelo: row.sub_modelo, rows: [] }).rows.push(row);
      return acc;
    }, {});

    $('color-mix').innerHTML = Object.values(grouped).map((group) => {
      const total = group.rows.reduce((acc, item) => acc + Number(item.pares || 0), 0);
      const max = Math.max(...group.rows.map((i) => i.pares || 0));
      return `<div class="color-card">
        <div class="color-title">${escapeHtml(group.modelo)} · ${escapeHtml(group.sub_modelo)}</div>
        ${group.rows.sort((a,b) => b.pares - a.pares).map((item, idx) => {
          const pctMax = max ? (item.pares / max) * 100 : 0;
          const pctTotal = total ? item.pares / total : null;
          return `<div class="color-row">
            <div class="color-label" title="${escapeHtml(item.cor)}">${escapeHtml(item.cor)}</div>
            <div class="bar-track"><div class="bar-fill ${idx ? 'secondary' : ''}" style="width:${pctMax}%"></div></div>
            <div class="color-value">${fmtNum(item.pares)} · ${fmtPct(pctTotal, 0)}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
  }

  function renderSizeRanking() {
    const container = $('size-ranking');
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      container.innerHTML = `<div class="empty-state"><div><strong>Selecione ao menos um modelo.</strong>O ranking de tamanhos usa os modelos marcados em Comparar com.</div></div>`;
      return;
    }

    const rows = launches.flatMap((launch) => (launch.tamanhos || []).map((row) => ({
      modelo: launch.modelo,
      tamanho: row.tamanho || 'Sem tamanho',
      pares: Number(row.pares || 0)
    })));

    if (!rows.length) {
      container.innerHTML = `<div class="empty-state"><div><strong>Sem tamanhos disponíveis.</strong>Quando o pipeline trouxer tamanho, variant_title ou SKU compatível, o ranking aparece aqui.</div></div>`;
      return;
    }

    const groupSizes = (items) => {
      const map = new Map();
      items.forEach((row) => {
        const key = row.tamanho || 'Sem tamanho';
        map.set(key, (map.get(key) || 0) + Number(row.pares || 0));
      });
      const total = [...map.values()].reduce((acc, value) => acc + value, 0);
      return [...map.entries()]
        .map(([tamanho, pares]) => ({ tamanho, pares, pct: total ? pares / total : null }))
        .sort((a, b) => b.pares - a.pares);
    };

    const tableRows = (items) => items.map((row, index) => `
      <tr>
        <td>${index + 1}</td>
        <td>${escapeHtml(row.tamanho)}</td>
        <td class="num">${fmtNum(row.pares)}</td>
        <td class="num">${fmtPct(row.pct, 1)}</td>
      </tr>`).join('');

    const geral = groupSizes(rows);
    const byModel = launches.map((launch) => {
      const modelRows = rows.filter((row) => row.modelo === launch.modelo);
      return { launch, rows: groupSizes(modelRows).slice(0, 8) };
    }).filter((group) => group.rows.length);

    container.innerHTML = `
      <div class="size-ranking-grid">
        <div class="table-wrap">
          <table>
            <thead><tr><th>#</th><th>Tamanho</th><th class="num">Pares vendidos</th><th class="num">% do total</th></tr></thead>
            <tbody>${tableRows(geral)}</tbody>
          </table>
        </div>
        <div class="size-model-grid">
          ${byModel.map((group) => `<div class="table-wrap">
            <table>
              <thead><tr><th colspan="4">${escapeHtml(group.launch.modelo)}</th></tr></thead>
              <tbody>${tableRows(group.rows)}</tbody>
            </table>
          </div>`).join('')}
        </div>
      </div>`;
  }

  function renderCalendar(selected) {
    const windows = WINDOW_KEYS.map((key) => ({
      key,
      label: windowLabel(key),
      end: (WINDOW_DAYS[key] || 0) - 1
    }));
    $('calendar-grid').innerHTML = windows.map((win) => {
      const start = toDate(selected.d0);
      const end = addDays(selected.d0, win.end);
      const events = (state.data.calendario_br || []).filter((event) => {
        const date = toDate(event.data);
        return date >= start && date <= end;
      });
      return `<div class="calendar-card">
        <div class="calendar-title"><span>${win.label}</span>${coverageBadge(selected, win.key)}</div>
        ${events.length ? events.map((event) => {
          const cls = event.tipo === 'promotor' ? 'pos' : event.tipo === 'ofensor' ? 'neg' : 'neu';
          const icon = event.tipo === 'promotor' ? '▲' : event.tipo === 'ofensor' ? '▼' : '○';
          const d = dayIndex(selected.d0, event.data);
          return `<div class="event">
            <div class="event-icon ${cls}">${icon}</div>
            <div><div class="event-name">${escapeHtml(event.nome)}</div><div class="event-meta">${fmtDate(event.data)} · D+${d} · ${escapeHtml(event.observacao || '')}</div></div>
          </div>`;
        }).join('') : `<div class="empty-state" style="min-height:120px"><div><strong>Sem evento relevante.</strong>Janela limpa no calendário.</div></div>`}
      </div>`;
    }).join('');
  }

  function roasBadge(value) {
    if (value === null || value === undefined) return badge('parcial', '—');
    if (value < 1) return badge('neg', 'Crítico');
    if (value < 3) return badge('parcial', 'Atenção');
    return badge('pipeline', 'Eficiente');
  }

  function inferMediaWindow(row, launch) {
    if (row.janela) return row.janela;
    const end = toDate(row.data_fim || row.data_inicio);
    const d0 = toDate(launch.d0);
    if (!end || !d0) return '—';
    if (end < d0) return 'pre-d0';
    const days = Math.floor((end - d0) / 86400000) + 1;
    if (days <= 7) return '7d';
    if (days <= 15) return '15d';
    if (days <= 30) return '30d';
    if (days <= 60) return '60d';
    if (days <= 90) return '90d';
    return `${days}d`;
  }

  function normalizeWindowKey(value) {
    const key = String(value || '').trim().toLowerCase();
    return WINDOW_KEYS.includes(key) ? key : null;
  }

  function mediaRevenueBase(row, launch) {
    const attributed = numberOrNull(row.receita_atribuida);
    if (attributed !== null) return { value: attributed, source: 'atribuida' };

    const key = normalizeWindowKey(row.janela);
    const win = key ? getWindow(launch, key) : null;
    if (win?.receita !== null && win?.receita !== undefined) {
      return { value: Number(win.receita), source: key };
    }

    if (launch.acumulado_atual?.receita !== null && launch.acumulado_atual?.receita !== undefined) {
      return { value: Number(launch.acumulado_atual.receita), source: 'D+n' };
    }

    return { value: null, source: null };
  }

  function normalizeMediaRow(row, launch) {
    const investimento = numberOrNull(row.investimento);
    const receitaBase = mediaRevenueBase(row, launch);
    const pedidos = numberOrNull(row.pedidos);
    const roas = numberOrNull(row.roas) ?? (investimento && receitaBase.value !== null ? receitaBase.value / investimento : null);
    const cpa = numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
    return {
      modelo_id: launch.modelo_id,
      modelo: launch.modelo,
      campanha: row.campanha || 'Campanha sem nome',
      janela: inferMediaWindow(row, launch),
      canal: row.canal || '—',
      investimento,
      receita_atribuida: receitaBase.value,
      receita_source: receitaBase.source,
      pedidos,
      roas,
      cpa,
      status: row.status || ''
    };
  }

  function normalizeCrmRow(row) {
    const investimento = numberOrNull(row.investimento);
    const receitaLinha = numberOrNull(row.receita_linha);
    const receitaDia = numberOrNull(row.receita_dia);
    const receitaBase = receitaDia ?? receitaLinha;
    const pedidos = numberOrNull(row.pedidos);
    const roas = numberOrNull(row.roas_proxy) ?? (investimento && receitaBase !== null ? receitaBase / investimento : null);
    const cpa = numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
    return {
      ...row,
      investimento,
      receita_linha: receitaLinha,
      receita_dia: receitaDia,
      receita_base: receitaBase,
      pedidos,
      roas_proxy: roas,
      cpa
    };
  }

  function aggregateMediaRows(rows) {
    const groups = new Map();
    rows.forEach((row) => {
      const key = `${row.janela}::${row.canal}`;
      const current = groups.get(key) || {
        campanha: 'Total janela/canal',
        janela: row.janela,
        canal: row.canal,
        investimento: 0,
        receita_atribuida: 0,
        pedidos: 0,
        count: 0,
        aggregate: true
      };
      current.investimento += row.investimento || 0;
      current.receita_atribuida += row.receita_atribuida || 0;
      current.pedidos += row.pedidos || 0;
      current.count += 1;
      groups.set(key, current);
    });
    return [...groups.values()]
      .filter((row) => row.count > 1)
      .map(({ count, ...row }) => ({
        ...row,
        roas: row.investimento ? row.receita_atribuida / row.investimento : null,
        cpa: row.pedidos ? row.investimento / row.pedidos : null
      }));
  }

  function mediaValue(value, formatter) {
    return value === null || value === undefined ? '—' : formatter(value);
  }

  function roasValue(value) {
    return value === null || value === undefined ? '&mdash;' : `${fmtNum(value, 2)}&times;`;
  }

  function sumKnown(rows, field) {
    const values = rows
      .map((row) => numberOrNull(row[field]))
      .filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
  }

  function sumValues(...values) {
    const known = values.filter((value) => value !== null && value !== undefined);
    return known.length ? known.reduce((acc, value) => acc + Number(value || 0), 0) : null;
  }

  function ratioOrNull(numerator, denominator) {
    return denominator ? Number(numerator || 0) / denominator : null;
  }

  function commercialSummaryFor(launch, mediaRows, crmRows) {
    const best = bestWindow(launch);
    const receitaModelo = launch.acumulado_atual?.receita ?? best.data?.receita ?? null;
    const janelaModelo = launch.acumulado_atual?.receita !== null && launch.acumulado_atual?.receita !== undefined
      ? `D+${Math.max(0, launch.dPlus ?? 0)}`
      : best.key ? windowLabel(best.key) : '&mdash;';

    const mediaInvestimento = sumKnown(mediaRows, 'investimento');
    const mediaReceita = sumKnown(mediaRows, 'receita_atribuida');
    const mediaPedidos = sumKnown(mediaRows, 'pedidos');
    const crmInvestimento = sumKnown(crmRows, 'investimento');
    const crmReceita = sumKnown(crmRows, 'receita_base');
    const crmPedidos = sumKnown(crmRows, 'pedidos');
    const crmDisparos = crmRows.length;
    const investimentoTotal = sumValues(mediaInvestimento, crmInvestimento);
    const receitaComercial = sumValues(mediaReceita, crmReceita);

    return {
      launch,
      janelaModelo,
      receitaModelo,
      mediaInvestimento,
      mediaReceita,
      mediaPedidos,
      mediaRoas: ratioOrNull(mediaReceita, mediaInvestimento),
      mediaCpa: ratioOrNull(mediaInvestimento, mediaPedidos),
      crmInvestimento,
      crmReceita,
      crmPedidos,
      crmDisparos,
      crmRoas: ratioOrNull(crmReceita, crmInvestimento),
      crmCpa: ratioOrNull(crmInvestimento, crmPedidos),
      investimentoTotal,
      receitaComercial,
      roasComercial: ratioOrNull(receitaComercial, investimentoTotal)
    };
  }

  function renderActionsComparison(summaries) {
    $('actions-comparison').innerHTML = summaries.length ? `
      <div class="table-wrap commercial-table">
        <table>
          <thead>
            <tr>
              <th>Modelo</th>
              <th>Janela base</th>
              <th class="num">Receita modelo</th>
              <th class="num">Invest. midia</th>
              <th class="num">ROAS midia</th>
              <th class="num">CPA midia</th>
              <th class="num">Invest. CRM</th>
              <th class="num">Disparos</th>
              <th class="num">ROAS CRM</th>
              <th class="num">CPA CRM</th>
              <th class="num">Invest. total</th>
              <th class="num">Receita comercial</th>
              <th class="num">ROAS comercial</th>
            </tr>
          </thead>
          <tbody>
            ${summaries.map((row) => `
              <tr>
                <td class="model-name">${escapeHtml(row.launch.modelo)}</td>
                <td>${escapeHtml(row.janelaModelo)}</td>
                <td class="num">${mediaValue(row.receitaModelo, fmtBRL)}</td>
                <td class="num">${mediaValue(row.mediaInvestimento, fmtBRL)}</td>
                <td class="num">${roasValue(row.mediaRoas)}</td>
                <td class="num">${mediaValue(row.mediaCpa, fmtBRL)}</td>
                <td class="num">${mediaValue(row.crmInvestimento, fmtBRL)}</td>
                <td class="num">${fmtNum(row.crmDisparos)}</td>
                <td class="num">${roasValue(row.crmRoas)}</td>
                <td class="num">${mediaValue(row.crmCpa, fmtBRL)}</td>
                <td class="num">${mediaValue(row.investimentoTotal, fmtBRL)}</td>
                <td class="num">${mediaValue(row.receitaComercial, fmtBRL)}</td>
                <td class="num">${roasValue(row.roasComercial)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state"><div><strong>Selecione ao menos um modelo.</strong>A frente comercial usa os modelos marcados em Comparar com.</div></div>`;
  }

  function renderActions(selected) {
    if (selected.isFuture || isPlannedStatus(selected.status)) {
      $('media-table').innerHTML = `<tr><td colspan="8" class="cell-muted">Lançamento planejado: mídia paga fica fora da análise até D0 e dados reais.</td></tr>`;
      $('crm-table').innerHTML = `<tr><td colspan="7" class="cell-muted">Lançamento planejado: CRM fica fora da análise até D0 e dados reais.</td></tr>`;
      return;
    }

    const mediaRows = (state.data.midia_paga || []).filter((row) => row.modelo_id === selected.modelo_id);
    const detailedRows = mediaRows.map((row) => normalizeMediaRow(row, selected));
    const displayRows = [...aggregateMediaRows(detailedRows), ...detailedRows];
    $('media-table').innerHTML = displayRows.length ? displayRows.map((row) => `
      <tr>
        <td>${row.aggregate ? `<strong>${escapeHtml(row.campanha)}</strong>` : escapeHtml(row.campanha)}</td>
        <td>${escapeHtml(row.janela)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${mediaValue(row.receita_atribuida, fmtBRL)}</td>
        <td class="num">${roasValue(row.roas)}</td>
        <td class="num">${mediaValue(row.cpa, fmtBRL)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="cell-muted">Sem mídia paga cadastrada para este modelo.</td></tr>`;

    const crmRows = (state.data.crm_disparos || [])
      .filter((row) => row.modelo_id === selected.modelo_id)
      .map(normalizeCrmRow);
    $('crm-table').innerHTML = crmRows.length ? crmRows.map((row) => `
      <tr>
        <td>${fmtDate(row.data_disparo)}</td>
        <td title="${escapeHtml(row.campanha || 'Disparo sem nome')}">${escapeHtml(row.campanha || 'Disparo sem nome')}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${fmtBRL(row.receita_linha)}</td>
        <td class="num">${mediaValue(row.receita_dia, fmtBRL)}</td>
        <td class="num">${roasValue(row.roas_proxy)}</td>
        <td>${roasBadge(row.roas_proxy)}</td>
      </tr>`).join('') : `<tr><td colspan="7" class="cell-muted">Sem disparos de CRM cadastrados para este modelo.</td></tr>`;
  }

  function renderActionsComparative() {
    const launches = selectedCompareLaunches().filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
    if (!launches.length) {
      renderActionsComparison([]);
      $('media-table').innerHTML = `<tr><td colspan="9" class="cell-muted">Selecione ao menos um modelo com D0 e dados reais para comparar midia paga.</td></tr>`;
      $('crm-table').innerHTML = `<tr><td colspan="9" class="cell-muted">Selecione ao menos um modelo com D0 e dados reais para comparar CRM.</td></tr>`;
      return;
    }

    const mediaByModel = new Map();
    const crmByModel = new Map();
    const detailedRows = launches.flatMap((launch) => {
      const rows = (state.data.midia_paga || [])
        .filter((row) => row.modelo_id === launch.modelo_id)
        .map((row) => normalizeMediaRow(row, launch));
      mediaByModel.set(launch.modelo_id, rows);
      return rows;
    });
    const crmRowsAll = launches.flatMap((launch) => {
      const rows = (state.data.crm_disparos || [])
        .filter((row) => row.modelo_id === launch.modelo_id)
        .map((row) => ({ ...normalizeCrmRow(row), modelo_id: launch.modelo_id, modelo: launch.modelo }));
      crmByModel.set(launch.modelo_id, rows);
      return rows;
    });

    renderActionsComparison(launches.map((launch) => commercialSummaryFor(
      launch,
      mediaByModel.get(launch.modelo_id) || [],
      crmByModel.get(launch.modelo_id) || []
    )));

    const displayRows = detailedRows
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.janela).localeCompare(String(b.janela)) || a.campanha.localeCompare(b.campanha));
    $('media-table').innerHTML = displayRows.length ? displayRows.map((row) => `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${escapeHtml(row.campanha)}</td>
        <td>${escapeHtml(row.janela)}${row.receita_source && row.receita_source !== 'atribuida' ? ` <span class="cell-muted">(${escapeHtml(row.receita_source)})</span>` : ''}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${mediaValue(row.receita_atribuida, fmtBRL)}</td>
        <td class="num">${roasValue(row.roas)}</td>
        <td class="num">${mediaValue(row.cpa, fmtBRL)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="9" class="cell-muted">Sem midia paga cadastrada para os modelos selecionados.</td></tr>`;

    const crmRows = crmRowsAll
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.data_disparo || '').localeCompare(String(b.data_disparo || '')));
    $('crm-table').innerHTML = crmRows.length ? crmRows.map((row) => `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${fmtDate(row.data_disparo)}</td>
        <td title="${escapeHtml(row.campanha || 'Disparo sem nome')}">${escapeHtml(row.campanha || 'Disparo sem nome')}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${fmtBRL(row.receita_linha)}</td>
        <td class="num">${mediaValue(row.receita_dia, fmtBRL)}</td>
        <td class="num">${roasValue(row.roas_proxy)}</td>
        <td>${roasBadge(row.roas_proxy)}</td>
      </tr>`).join('') : `<tr><td colspan="9" class="cell-muted">Sem disparos de CRM cadastrados para os modelos selecionados.</td></tr>`;
  }

  function projectionScenarios(selected) {
    const hist = comparableLaunches()
      .filter((l) => isHistoricalLaunch(l) && l.multiplicadores?.m90_30)
      .filter((l) => l.modelo_id !== selected.modelo_id);
    const fallbackHist = comparableLaunches().filter((l) => isHistoricalLaunch(l) && l.multiplicadores?.m90_30);
    const refs = hist.length ? hist : fallbackHist;
    if (!refs.length) return null;

    const multipliers = refs
      .map((l) => l.multiplicadores.m90_30)
      .filter((value) => value !== null && value !== undefined)
      .sort((a, b) => a - b);
    if (!multipliers.length) return null;

    const conservative = multipliers[0];
    const optimistic = multipliers[multipliers.length - 1];
    const avg = multipliers.reduce((acc, value) => acc + value, 0) / multipliers.length;
    const baseWindow = getWindow(selected, '30d') || getWindow(selected, '15d');
    if (!baseWindow?.receita) return null;
    const factorBase = getWindow(selected, '30d') ? baseWindow.receita : baseWindow.receita * 2;
    const ticketPar = baseWindow.pares ? baseWindow.receita / baseWindow.pares : null;
    return [
      { name: 'Conservador', label: `Menor histórico ${fmtNum(conservative, 2)}×`, mult: conservative, value: factorBase * conservative },
      { name: 'Base ★', label: `Média ${fmtNum(avg, 2)}×`, mult: avg, value: factorBase * avg, base: true },
      { name: 'Otimista', label: `Maior histórico ${fmtNum(optimistic, 2)}×`, mult: optimistic, value: factorBase * optimistic }
    ].map((s) => ({ ...s, pairs: ticketPar ? s.value / ticketPar : null }));
  }

  function renderProjection(selected) {
    const projectionLaunches = selectedCompareLaunches();
    const projectionBase = projectionLaunches.find((launch) => launch.modelo_id === selected.modelo_id)
      || projectionLaunches.find((launch) => getWindow(launch, '30d') || getWindow(launch, '15d'));
    const scenarios = projectionBase ? projectionScenarios(projectionBase) : null;
    if (!scenarios || !projectionBase || projectionBase.isFuture || isPlannedStatus(projectionBase.status)) {
      $('projection-content').innerHTML = `<div class="empty-state"><div><strong>Sem dados suficientes para projeção.</strong>A seção aparece quando o modelo tem ao menos 15 dias de venda registrados.</div></div>`;
      return;
    }

    $('projection-content').innerHTML = `
      <div class="metric-sub" style="margin-bottom:10px">Base da projeção: <strong>${escapeHtml(projectionBase.modelo)}</strong></div>
      <div class="scenario-grid">
        ${scenarios.map((s) => `<div class="scenario ${s.base ? 'base' : ''}">
          <div class="scenario-label">${escapeHtml(s.label)}</div>
          <div class="scenario-name">${escapeHtml(s.name)}</div>
          <div class="scenario-value">${fmtBRL(s.value)}</div>
          <div class="scenario-pairs">≈ ${fmtNum(s.pairs)} pares</div>
        </div>`).join('')}
      </div>
      <div class="card warning" style="margin-top:14px">
        <div class="metric-label">Aviso fixo</div>
        <p class="section-desc">Cenários usam multiplicadores 90÷30 dos modelos históricos elegíveis. Leia como referência de amplitude, não como previsão automática.</p>
      </div>`;

    createChart('chart-projection', {
      type: 'bar',
      data: {
        labels: scenarios.map((s) => s.name),
        datasets: [{
          label: 'Faturamento estimado',
          data: scenarios.map((s) => s.value),
          backgroundColor: scenarios.map((s) => s.base ? '#F07800' : 'rgba(240,120,0,.32)'),
          borderColor: '#F07800',
          borderWidth: 1,
          borderRadius: 4
        }]
      },
      options: chartOptions({
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: (ctx) => fmtBRL(ctx.parsed.y) } } },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => fmtBRL(v, true) } } }
      })
    });
  }

  function renderInsights(selected) {
    const eligible = comparableLaunches();
    const bestTicket = eligible
      .map((launch) => ({ launch, value: getWindow(launch, '30d')?.ticket }))
      .filter((row) => row.value !== null && row.value !== undefined)
      .sort((a, b) => b.value - a.value)[0];
    const activeLaunches = eligible.filter((launch) => launch.isActive);
    const backfilled = eligible.filter((launch) => launch.daily_source === 'historico_backfill');
    const noPipelineRows = eligible.filter((launch) => launch.isActive && !hasPipelineRows(launch));

    const global = [
      bestTicket ? {
        type: 'pos',
        title: 'Maior ticket/pedido 30d',
        copy: `${bestTicket.launch.modelo} lidera o ticket médio por pedido 30d entre modelos elegíveis, com ${fmtBRL(bestTicket.value)}.`
      } : null,
      activeLaunches.length ? {
        type: 'warn',
        title: 'Modelo ativo em curso',
        copy: `${activeLaunches.map((launch) => launch.modelo).join(', ')} ainda deve ser lido por D+n e janelas fechadas, sem transformar ausência em zero.`
      } : null,
      backfilled.length ? {
        type: 'warn',
        title: 'Backfill diário aplicado',
        copy: `${backfilled.length} modelo(s) histórico(s) sem diário real receberam backfill a partir das janelas acumuladas para curva e semana a semana.`
      } : null,
      noPipelineRows.length ? {
        type: 'neg',
        title: 'Pipeline sem linha para ativo',
        copy: `${noPipelineRows.map((launch) => launch.modelo).join(', ')} está ativo, mas sem linhas no JSON de vendas. Verifique BigQuery, match e exportação.`
      } : null,
      {
        type: 'pos',
        title: 'Cadastro sem código novo',
        copy: 'Qualquer modelo com status historico ou ativo e day_zero_base válido entra automaticamente nas janelas, curvas e rankings.'
      }
    ].filter(Boolean);
    const modelInsights = (selected.insights || []).map((copy) => ({ type: 'warn', title: selected.modelo, copy }));
    const list = [...global, ...modelInsights].slice(0, 8);
    $('insights-list').innerHTML = list.map((item, idx) => `
      <div class="insight ${item.type}">
        <div class="insight-num">${String(idx + 1).padStart(2, '0')}</div>
        <div><div class="insight-title">${escapeHtml(item.title)}</div><div class="insight-copy">${escapeHtml(item.copy)}</div></div>
        <div>${item.type === 'pos' ? badge('pipeline', 'Positivo') : item.type === 'neg' ? badge('neg', 'Alerta') : badge('parcial', 'Atenção')}</div>
      </div>`).join('');
  }

  function renderAll() {
    syncSelectionState();
    const selected = state.launches.find((l) => l.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];
    $('selected-title').textContent = selected.modelo;
    $('selected-status').innerHTML = sourceBadge(selected);
    renderSelectedHeader(selected);
    renderModelSelector();
    renderCompareSelector();
    renderTopMeta();
    renderMethodology(selected);
    renderState(selected);
    renderComparison();
    renderHistoricalAverage(selected);
    renderDplusComparison(selected);
    renderRankings(selected);
    renderCharts(selected);
    renderStock(selected);
    renderColorMix();
    renderSizeRanking();
    renderCalendar(selected);
    renderActionsComparative();
    renderProjection(selected);
    renderInsights(selected);
  }

  async function init() {
    configureDrawer();
    configureTooltips();
    configureChartDefaults();
    state.data = await loadData();
    state.launches = buildLaunches(state.data);
    const comparable = comparableLaunches();
    const preferred = defaultComparableLaunch(comparable);
    state.primaryModelId = preferred?.modelo_id;
    state.compareModelIds = comparable.map((launch) => launch.modelo_id);
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
