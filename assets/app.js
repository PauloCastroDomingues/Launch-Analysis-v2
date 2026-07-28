(() => {
  const DATA_FILES = [
    'lancamentos_modelos',
    'lancamentos_historico',
    'lancamentos_produtos_dia',
    'midia_paga',
    'metas_mensais',
    'faturamento_campanha',
    'crm_disparos',
    'sub_modelos_dia',
    'estoque',
    'calendario_br',
    'share_trajetoria',
    'auditoria_monochrome'
  ];
  const NO_EMBEDDED_FALLBACK = new Set(['lancamentos_produtos_dia', 'share_trajetoria', 'auditoria_monochrome']);

  const CORES_MODELO = {
    gt: { line: '#F07800', fill: 'rgba(240,120,0,0.12)' },
    avant: { line: '#4C9F6A', fill: 'rgba(76,159,106,0.12)' },
    phantom: { line: '#7B8FE0', fill: 'rgba(123,143,224,0.12)' },
    rs8_monochrome: { line: '#E0B84C', fill: 'rgba(224,184,76,0.12)' },
    series_2: { line: '#E05252', fill: 'rgba(224,82,82,0.12)' },
    pais_2026: { line: '#5BB8D4', fill: 'rgba(91,184,212,0.12)' },
    _fallback: ['#E05252', '#5BB8D4', '#A87FD4', '#8FBD56']
  };

  const WINDOW_DAYS = { '7d': 7, '15d': 15, '30d': 30, '60d': 60, '90d': 90 };
  const WINDOW_KEYS = Object.keys(WINDOW_DAYS);
  const WINDOW_LABELS = {
    '7d': 'D+7',
    '15d': 'D+15',
    '30d': 'D+30',
    '60d': 'D+60',
    '90d': 'D+90'
  };
  const ANALYSIS_PERIODS = [
    { key: '7d', label: '7 dias' },
    { key: '15d', label: '15 dias' },
    { key: '30d', label: '30 dias' },
    { key: '60d', label: '60 dias' },
    { key: '90d', label: '90 dias' }
  ];
  const MILESTONE_DAYS = [0, 7, 15, 30, 60, 90];
  const COLLAPSIBLE_LIST_LIMIT = 5;
  const COLLAPSIBLE_LIST_SELECTORS = [
    '.table-wrap tbody',
    '.drill-table-wrap tbody',
    '.method-list',
    '.client-mix-list',
    '.event-list',
    '.drill-ranking'
  ];

  const state = {
    data: null,
    launches: [],
    primaryModelId: null,
    compareModelIds: [],
    analysisPeriodKey: '30d',
    snapshotClock: null,
    normalizedChartMode: 'linha',
    commercialChartMetric: 'investimento',
    canibalLineFilter: null,
    storyAnalysisByModel: {},
    storySubModelByModel: {},
    charts: {}
  };

  const $ = (id) => document.getElementById(id);
  let collapsibleListSequence = 0;

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

  const fmtDateSlash = (iso) => {
    if (!iso) return '-';
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    if ([y, m, d].some(Number.isNaN)) return '-';
    return `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${y}`;
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

  const dateOnlyFromDate = (date) => {
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return null;
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0);
  };

  const snapshotClockFallback = () => {
    const date = dateOnlyFromDate(new Date());
    return { date, iso: toIsoDate(date), source: 'browser' };
  };

  const snapshotClockFromManifest = (manifest) => {
    const iso = String(manifest?.generated_at || '').slice(0, 10);
    const date = toDate(iso);
    return date ? { date, iso: toIsoDate(date), source: 'manifest' } : null;
  };

  const snapshotClockFromRows = (rows) => {
    const dates = (rows || [])
      .map((row) => String(row.data || '').slice(0, 10))
      .filter(Boolean)
      .sort();
    const iso = dates.length ? dates[dates.length - 1] : null;
    const date = toDate(iso);
    return date ? { date, iso: toIsoDate(date), source: 'lancamentos_produtos_dia' } : null;
  };

  const deriveSnapshotClock = (data) => (
    snapshotClockFromManifest(data?.manifest)
    || snapshotClockFromRows(data?.lancamentos_produtos_dia)
    || snapshotClockFallback()
  );

  const snapshotDate = () => state.snapshotClock?.date || snapshotClockFallback().date;
  const snapshotIso = () => state.snapshotClock?.iso || toIsoDate(snapshotDate());

  const daysBetween = (startIso, endDate) => {
    const start = toDate(startIso);
    if (!start || !endDate) return null;
    return Math.floor((endDate - start) / 86400000);
  };

  const dayIndex = (startIso, dateIso) => daysBetween(startIso, toDate(dateIso));
  const windowEndDay = (key) => WINDOW_DAYS[key] ?? null;
  const windowSpanDays = (key) => {
    const endDay = windowEndDay(key);
    return endDay === null ? null : endDay + 1;
  };

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

  const tooltipAttr = (text) => escapeHtml(String(text || '').replace(/\s+/g, ' ').trim());
  const tooltipMultilineAttr = (text) => escapeHtml(String(text || '').trim()).replaceAll('\n', '&#10;');
  const tip = (text, label = 'i') => text
    ? `<button class="help-button help-button--mini" type="button" data-tooltip="${tooltipAttr(text)}" aria-label="Ajuda analitica">${escapeHtml(label)}</button>`
    : '';
  const tipMultiline = (text, label = 'i') => text
    ? `<button class="help-button help-button--mini" type="button" data-tooltip="${tooltipMultilineAttr(text)}" aria-label="Ajuda analitica">${escapeHtml(label)}</button>`
    : '';
  const labelTip = (label, text) => `<span class="label-with-tip"><span>${escapeHtml(label)}</span>${tip(text)}</span>`;
  const thTip = (label, text, cls = '') => `<th${cls ? ` class="${cls}"` : ''}>${labelTip(label, text)}</th>`;
  const badge = (type, label, text = '') => `<span class="badge badge--${type}"${text ? ` tabindex="0" data-tooltip="${tooltipAttr(text)}"` : ''}>${escapeHtml(label)}</span>`;
  const isPlainObject = (value) => Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value);
  const mergePlainObjects = (base, extra) => {
    if (!isPlainObject(extra)) return base;
    return Object.entries(extra).reduce((acc, [key, value]) => {
      acc[key] = isPlainObject(value) && isPlainObject(acc[key])
        ? mergePlainObjects(acc[key], value)
        : value;
      return acc;
    }, { ...base });
  };

  const colorFor = (id, index = 0) => CORES_MODELO[id]?.line || CORES_MODELO._fallback[index % CORES_MODELO._fallback.length];
  const fillFor = (id, index = 0) => CORES_MODELO[id]?.fill || `${CORES_MODELO._fallback[index % CORES_MODELO._fallback.length]}33`;
  const windowLabel = (key) => WINDOW_LABELS[key] || key;
  const windowPlainLabel = (key) => {
    const days = windowEndDay(key);
    return days === null || days === undefined ? windowLabel(key) : `${days} dias`;
  };
  const normalizedStatus = (value) => String(value || '').trim().toLowerCase();
  function canonicalDayZero(model) {
    return model?.day_zero_base || null;
  }

  function analysisDayZero(launch) {
    return launch?.d0 || canonicalDayZero(launch);
  }

  function dashboardRevenueValue(row) {
    return numberOrNull(row?.receita_bruta) ?? numberOrNull(row?.receita);
  }

  function dashboardRevenueNumber(row) {
    return Number(dashboardRevenueValue(row) ?? 0);
  }

  const hasValidDayZero = (model) => Boolean(toDate(canonicalDayZero(model)));
  const isEligibleStatus = (status) => ['historico', 'ativo'].includes(normalizedStatus(status));
  const isHistoricalLaunch = (launch) => launch?.isEligible && normalizedStatus(launch.status) === 'historico';
  const isPlannedStatus = (status) => normalizedStatus(status) === 'planejado';
  const emptyWindows = () => WINDOW_KEYS.reduce((acc, key) => {
    acc[key] = null;
    return acc;
  }, {});

  const emptyDataFor = (name) => {
    if (name === 'manifest') return {};
    if (name === 'share_trajetoria') return null;
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

    const entries = await Promise.all(DATA_FILES.map(async (name) => [
      name,
      await fetchDataFile(name, version, !NO_EMBEDDED_FALLBACK.has(name))
    ]));
    entries.forEach(([name, payload]) => {
      out[name] = payload;
    });
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
    { label: 'Azul Marinho', norm: 'azul marinho', end: /\s+azul[-\s]+marinho$/i },
    { label: 'Whisky', norm: 'whisky', end: /\s+whisk(?:y|ey)$/i },
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

  const UNKNOWN_COLOR_LABEL = 'Cor n\u00e3o identificada';
  const UNKNOWN_COLOR_NORMS = new Set([
    '',
    'sem cor',
    'sem cor definida',
    'sem identificacao',
    'cor nao identificada',
    'nao identificado',
    'nao identificada'
  ]);

  const NORMALIZED_COLOR_DEFS = [
    { label: 'All Black', norm: 'all black', aliases: ['all black'] },
    { label: 'Off White', norm: 'off white', aliases: ['off white', 'offwhite'] },
    { label: 'Azul Marinho', norm: 'azul marinho', aliases: ['azul marinho', 'marinho'] },
    { label: 'Whisky', norm: 'whisky', aliases: ['whisky', 'whiskey'] },
    { label: 'Caqui', norm: 'caqui', aliases: ['caqui'] },
    { label: 'Cinza', norm: 'cinza', aliases: ['cinza'] },
    { label: 'Marrom', norm: 'marrom', aliases: ['marrom'] },
    { label: 'Preto', norm: 'preto', aliases: ['preto', 'preta'] },
    { label: 'Branco', norm: 'branco', aliases: ['branco', 'branca'] },
    { label: 'Oliva', norm: 'oliva', aliases: ['oliva'] },
    { label: 'Camur\u00e7a', norm: 'camurca', aliases: ['camurca'] }
  ];

  const NORMALIZED_COLOR_ALIASES = new Map();
  NORMALIZED_COLOR_DEFS.forEach((color) => {
    [color.norm, ...(color.aliases || [])].forEach((alias) => NORMALIZED_COLOR_ALIASES.set(alias, color.label));
  });

  const NORMALIZED_SKU_COLOR_CODES = {
    OW: 'Off White',
    B: 'Branco',
    BC: 'Branco',
    P: 'Preto',
    PT: 'Preto',
    AB: 'All Black',
    M: 'Marrom',
    MR: 'Azul Marinho',
    AM: 'Azul Marinho',
    WH: 'Whisky',
    WK: 'Whisky',
    WS: 'Whisky',
    C: 'Cinza',
    O: 'Oliva'
  };

  const MONOCHROME_SKU_COLOR_CODES = {
    AB: 'All Black',
    MC: 'Cinza',
    CT: 'Caqui',
    CF: 'Marrom'
  };

  function stripTrailingSize(value) {
    return tidyPart(value).replace(/\s*(?:-|\/|\|)?\s*(3[3-9]|4[0-8])\s*$/i, '').trim();
  }

  function isUnknownColor(value) {
    return UNKNOWN_COLOR_NORMS.has(normalizeText(value));
  }

  function colorFromCode(value, modelId = '') {
    const code = normalizeText(value).replace(/\s+/g, '').toUpperCase();
    if (!code || isSizeToken(code)) return null;
    if (String(modelId || '') === 'rs8_monochrome' && MONOCHROME_SKU_COLOR_CODES[code]) {
      return MONOCHROME_SKU_COLOR_CODES[code];
    }
    return NORMALIZED_SKU_COLOR_CODES[code] || null;
  }

  function colorFromSku(value, modelId = '') {
    const raw = String(value || '').toUpperCase();
    if (!raw) return null;

    const compact = raw.replace(/[^A-Z0-9]/g, '');
    const monoCompact = compact.match(/RS8AVANT(AB|MC|CT|CF)(?:\d{2}|$)/);
    if (monoCompact) return MONOCHROME_SKU_COLOR_CODES[monoCompact[1]];

    const tokens = raw.split(/[^A-Z0-9]+/).map(tidyPart).filter(Boolean);
    for (const token of tokens) {
      const monoColor = String(modelId || '') === 'rs8_monochrome' ? MONOCHROME_SKU_COLOR_CODES[token] : null;
      if (monoColor) return monoColor;
      const color = colorFromCode(token, modelId);
      if (color) return color;
    }

    return null;
  }

  function colorFromText(value) {
    const clean = stripTrailingSize(value);
    const norm = normalizeText(clean);
    if (!norm || isUnknownColor(norm)) return null;

    const exact = NORMALIZED_COLOR_ALIASES.get(norm);
    if (exact) return exact;

    const padded = ` ${norm} `;
    const match = NORMALIZED_COLOR_DEFS.find((color) => (
      [color.norm, ...(color.aliases || [])].some((alias) => padded.includes(` ${alias} `))
    ));
    return match?.label || null;
  }

  function normalizeColorValue(value, modelId = '', allowCode = false) {
    const clean = tidyPart(value);
    if (!clean || isSizeToken(clean) || isUnknownColor(clean)) return null;
    if (allowCode) {
      const coded = colorFromCode(clean, modelId);
      if (coded) return coded;
    }
    return colorFromText(clean);
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

  function extractColor(row, model = {}) {
    const modelId = row.modelo_id || model.modelo_id || '';

    const storedColor = normalizeColorValue(row.cor, modelId, true);
    if (storedColor) return storedColor;

    const skuColor = colorFromSku(row.sku, modelId);
    if (skuColor) return skuColor;

    const explicitFields = [row.variant_title, row.nome_produto];
    for (const field of explicitFields) {
      const explicit = String(field || '').match(/(?:cor|color)\s*[:\-]\s*([^|/,\-]+)/i);
      if (explicit) {
        const color = normalizeColorValue(explicit[1], modelId, true);
        if (color) return color;
      }
    }

    const parsedColor = [row.variant_title, row.nome_produto, row.sub_modelo]
      .map(colorFromText)
      .find(Boolean);
    if (parsedColor) return parsedColor;

    const fields = [row.variant_title, row.nome_produto, row.sub_modelo, row.sku];
    for (const field of fields) {
      const parts = String(field || '')
        .split(/\s+(?:-|\/|\|)\s+|[|/]/)
        .map(tidyPart)
        .filter(Boolean)
        .filter((part) => !isSizeToken(part))
        .filter((part) => !looksLikeProductName(part))
        .filter((part) => !looksLikeSku(part));
      const fallbackColor = parts.map((part) => normalizeColorValue(part, modelId, true)).find(Boolean);
      if (fallbackColor) return fallbackColor;
    }

    return UNKNOWN_COLOR_LABEL;
  }

  function extractSubModel(row, model) {
    const source = row.sub_modelo || row.product_title || row.nome_produto || model.modelo;
    const clean = stripTrailingColor(source);
    return clean || model.modelo;
  }

  function aggregatePipeline(model, rows) {
    const d0 = canonicalDayZero(model);
    if (!d0) return null;
    const modelRows = rows.filter((row) => row.modelo_id === model.modelo_id);
    if (!modelRows.length) return null;

    const sumNullable = (items, field) => (
      items.some((row) => row[field] !== null && row[field] !== undefined)
        ? items.reduce((acc, row) => acc + Number(row[field] || 0), 0)
        : null
    );
    const pedidoId = (row) => row.order_sk || null;
    const receitaBrutaRow = (row) => dashboardRevenueNumber(row);
    const receitaLiquidaRow = (row) => (
      row.receita_liquida !== null && row.receita_liquida !== undefined
        ? Number(row.receita_liquida || 0)
        : null
    );
    const descontoRow = (row) => (
      row.desconto !== null && row.desconto !== undefined
        ? Number(row.desconto || 0)
        : null
    );

    const todayIdx = daysBetween(d0, snapshotDate());
    const firstSaleDate = modelRows
      .map((row) => row.data)
      .filter(Boolean)
      .sort()[0] || null;

    const dailyMap = new Map();
    modelRows.forEach((row) => {
      const idx = dayIndex(d0, row.data);
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
      current.receita += receitaBrutaRow(row);
      current.pares += Number(row.pares || 0);
      const orderId = pedidoId(row);
      if (orderId) current.orderIds.add(orderId);
      else current.pedidos += Number(row.pedidos_validos ?? row.pedidos ?? 0);
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
      const receita = filtered.some((row) => dashboardRevenueValue(row) !== null)
        ? filtered.reduce((acc, row) => acc + receitaBrutaRow(row), 0)
        : null;
      const receitaLiquida = filtered.some((row) => row.receita_liquida !== null && row.receita_liquida !== undefined)
        ? filtered.reduce((acc, row) => acc + (receitaLiquidaRow(row) ?? 0), 0)
        : null;
      const desconto = filtered.some((row) => row.desconto !== null && row.desconto !== undefined)
        ? filtered.reduce((acc, row) => acc + (descontoRow(row) ?? 0), 0)
        : null;
      const pares = sumNullable(filtered, 'pares');
      const pedidosSomados = sumNullable(filtered, 'pedidos_validos') ?? sumNullable(filtered, 'pedidos') ?? 0;
      const pedidosDistintos = new Set(filtered.map(pedidoId).filter(Boolean));
      const pedidos = pedidosDistintos.size || pedidosSomados;
      const novos = sumNullable(filtered, 'novos');
      const recorrentes = sumNullable(filtered, 'recorrentes');
      const clientesClassificados = novos !== null && recorrentes !== null ? novos + recorrentes : null;
      const receitaPaga = sumNullable(filtered, 'receita_paga');
      const receitaOrganica = sumNullable(filtered, 'receita_organica');
      const pedidosPagos = sumNullable(filtered, 'pedidos_pagos');
      const pedidosOrganicos = sumNullable(filtered, 'pedidos_organicos');
      const attributionSignal = filtered.some((row) => (
        row.tipo_real !== null && row.tipo_real !== undefined
        || row.canal_real !== null && row.canal_real !== undefined
        || row.regra_atribuicao_real !== null && row.regra_atribuicao_real !== undefined
        || row.receita_paga !== null && row.receita_paga !== undefined
        || row.receita_organica !== null && row.receita_organica !== undefined
      ));
      let receitaOutrosCanais = 0;
      let receitaSemMatchAtribuicao = 0;
      let outrosPedidosSomados = 0;
      let semMatchPedidosSomados = 0;
      const pedidosOutrosCanais = new Set();
      const pedidosSemMatchAtribuicao = new Set();
      filtered.forEach((row) => {
        const tipo = String(row.tipo_real || '').trim().toLowerCase();
        const orderId = pedidoId(row);
        const hasAttributionMatch = Boolean(
          tipo
          || row.canal_real
          || (row.regra_atribuicao_real && row.regra_atribuicao_real !== 'sem_atribuicao_real')
        );
        if (tipo && tipo !== 'paid' && tipo !== 'organic') {
          receitaOutrosCanais += receitaBrutaRow(row);
          if (orderId) pedidosOutrosCanais.add(orderId);
          else outrosPedidosSomados += Number(row.pedidos_validos ?? row.pedidos ?? 0);
          return;
        }
        if (!hasAttributionMatch) {
          receitaSemMatchAtribuicao += receitaBrutaRow(row);
          if (orderId) pedidosSemMatchAtribuicao.add(orderId);
          else semMatchPedidosSomados += Number(row.pedidos_validos ?? row.pedidos ?? 0);
        }
      });
      return {
        receita,
        receita_bruta: receita,
        receita_liquida: receitaLiquida,
        desconto,
        pares,
        pedidos,
        ticket: pedidos && receita !== null ? receita / pedidos : null,
        preco_medio_par: pares && receita !== null ? receita / pares : null,
        novos,
        recorrentes,
        novos_pct: clientesClassificados ? novos / clientesClassificados : null,
        receita_paga: receitaPaga,
        receita_organica: receitaOrganica,
        pedidos_pagos: pedidosPagos,
        pedidos_organicos: pedidosOrganicos,
        receita_outros_canais: attributionSignal ? Math.round(receitaOutrosCanais * 100) / 100 : null,
        pedidos_outros_canais: attributionSignal ? (pedidosOutrosCanais.size || outrosPedidosSomados) : null,
        receita_sem_match_atribuicao: attributionSignal ? Math.round(receitaSemMatchAtribuicao * 100) / 100 : null,
        pedidos_sem_match_atribuicao: attributionSignal ? (pedidosSemMatchAtribuicao.size || semMatchPedidosSomados) : null,
        origem,
        day
      };
    };

    const closedRows = (maxIdx) => modelRows.filter((row) => {
      const idx = dayIndex(d0, row.data);
      return idx !== null && idx >= 0 && idx <= maxIdx;
    });

    const currentMaxIdx = Math.min(90, Math.max(0, todayIdx ?? 0));
    const acumuladoAtual = buildAggregate(closedRows(currentMaxIdx), 'pipeline_atual', currentMaxIdx);

    const availableIndexes = modelRows
      .map((row) => dayIndex(d0, row.data))
      .filter((idx) => idx !== null && idx >= 0 && (todayIdx === null || idx <= todayIdx));
    const latestAvailableIdx = availableIndexes.length ? Math.max(...availableIndexes) : null;
    const launchActivityIdx = Math.max(0, todayIdx ?? latestAvailableIdx ?? 0);
    const acumuladoLancamento = buildAggregate(closedRows(launchActivityIdx), 'pipeline_lancamento', latestAvailableIdx);
    if (acumuladoLancamento) {
      acumuladoLancamento.activity_day = launchActivityIdx;
      acumuladoLancamento.data_day = latestAvailableIdx;
      acumuladoLancamento.is_partial_data = latestAvailableIdx !== null && latestAvailableIdx < launchActivityIdx;
    }

    const janelas = {};
    WINDOW_KEYS.forEach((key) => {
      const endDay = windowEndDay(key);
      if (todayIdx === null || endDay === null || todayIdx < endDay) {
        janelas[key] = null;
        return;
      }
      janelas[key] = buildAggregate(closedRows(endDay), 'pipeline');
    });

    const semanasMap = new Map();
    modelRows.forEach((row) => {
      const idx = dayIndex(d0, row.data);
      if (idx === null || idx < 0) return;
      const week = Math.floor(idx / 7) + 1;
      const key = `Sem ${week}`;
      const current = semanasMap.get(key) || { label: key, receita: 0, pedidos: 0, orderIds: new Set() };
      current.receita += receitaBrutaRow(row);
      const orderId = pedidoId(row);
      if (orderId) current.orderIds.add(orderId);
      else current.pedidos += Number(row.pedidos_validos ?? row.pedidos ?? 0);
      semanasMap.set(key, current);
    });

    const coresMap = new Map();
    const tamanhosMap = new Map();
    modelRows.forEach((row) => {
      const cor = extractColor(row, model);
      const key = `${model.modelo_id}::${cor}`;
      const current = coresMap.get(key) || {
        modelo_id: model.modelo_id,
        modelo: model.modelo,
        cor,
        pares: 0,
        receita_bruta: 0,
        receita_liquida: 0,
        hasReceitaLiquida: false,
        pedidos: 0,
        orderIds: new Set()
      };
      current.pares += Number(row.pares || 0);
      current.receita_bruta += receitaBrutaRow(row);
      const receitaLiquida = receitaLiquidaRow(row);
      if (receitaLiquida !== null) {
        current.receita_liquida += receitaLiquida;
        current.hasReceitaLiquida = true;
      }
      const orderId = pedidoId(row);
      if (orderId) current.orderIds.add(orderId);
      else current.pedidos += Number(row.pedidos_validos ?? row.pedidos ?? 0);
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
      day_zero_base: d0,
      data_oficial: model.data_oficial,
      gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(d0)) || 0),
      janelas,
      semanas: [...semanasMap.values()].map(({ orderIds, ...week }) => ({
        ...week,
        pedidos: orderIds.size || week.pedidos
      })),
      cores: [...coresMap.values()].map(({ orderIds, hasReceitaLiquida, ...color }) => ({
        ...color,
        pedidos: orderIds.size || color.pedidos,
        receita_bruta: Math.round(color.receita_bruta * 100) / 100,
        receita_liquida: hasReceitaLiquida ? Math.round(color.receita_liquida * 100) / 100 : null
      })),
      multiplicadores: { m15_7, m30_15: m30, m60_30, m90_15, m90_30 },
      daily,
      acumulado_atual: acumuladoAtual,
      acumulado_lancamento: acumuladoLancamento,
      receita_paga: acumuladoLancamento?.receita_paga ?? acumuladoAtual?.receita_paga ?? null,
      receita_organica: acumuladoLancamento?.receita_organica ?? acumuladoAtual?.receita_organica ?? null,
      pedidos_pagos: acumuladoLancamento?.pedidos_pagos ?? acumuladoAtual?.pedidos_pagos ?? null,
      pedidos_organicos: acumuladoLancamento?.pedidos_organicos ?? acumuladoAtual?.pedidos_organicos ?? null,
      receita_outros_canais: acumuladoLancamento?.receita_outros_canais ?? acumuladoAtual?.receita_outros_canais ?? null,
      pedidos_outros_canais: acumuladoLancamento?.pedidos_outros_canais ?? acumuladoAtual?.pedidos_outros_canais ?? null,
      receita_sem_match_atribuicao: acumuladoLancamento?.receita_sem_match_atribuicao ?? acumuladoAtual?.receita_sem_match_atribuicao ?? null,
      pedidos_sem_match_atribuicao: acumuladoLancamento?.pedidos_sem_match_atribuicao ?? acumuladoAtual?.pedidos_sem_match_atribuicao ?? null,
      first_sale_date: firstSaleDate,
      first_sale_gap_dias: firstSaleDate ? Math.max(0, daysBetween(d0, toDate(firstSaleDate)) || 0) : null,
      origem: 'pipeline',
      tamanhos: [...tamanhosMap.values()]
    };
  }

  function sumNullableRows(rows, field) {
    return rows.some((row) => row[field] !== null && row[field] !== undefined)
      ? rows.reduce((acc, row) => acc + Number(row[field] || 0), 0)
      : null;
  }

  function normalizedMetricOrigin(win, source) {
    if (source === 'pipeline') return win?.origem || 'pipeline';
    if (win?.origem === 'historico_backfill') return 'historico_backfill';
    return source || win?.origem || 'historico';
  }

  function normalizeWindowMetric(win, source) {
    if (!win) return null;
    const receita = dashboardRevenueValue(win);
    const receitaBruta = numberOrNull(win.receita_bruta) ?? receita;
    const pares = numberOrNull(win.pares);
    const pedidos = numberOrNull(win.pedidos) ?? numberOrNull(win.pedidos_validos);
    const novos = numberOrNull(win.novos);
    const recorrentes = numberOrNull(win.recorrentes);
    const clientesClassificados = novos !== null && recorrentes !== null ? novos + recorrentes : null;
    const ticket = numberOrNull(win.ticket) ?? (pedidos && receita !== null ? receita / pedidos : null);
    const precoMedioPar = numberOrNull(win.preco_medio_par) ?? (pares && receita !== null ? receita / pares : null);
    return {
      ...win,
      receita,
      receita_bruta: receitaBruta,
      receita_liquida: numberOrNull(win.receita_liquida),
      desconto: numberOrNull(win.desconto),
      pares,
      pedidos,
      pedidos_validos: pedidos,
      ticket,
      preco_medio_par: precoMedioPar,
      novos,
      recorrentes,
      novos_pct: numberOrNull(win.novos_pct) ?? (clientesClassificados ? novos / clientesClassificados : null),
      origem_original: win.origem || null,
      origem: normalizedMetricOrigin(win, source),
      fonte_dados: source || win.fonte_dados || win.origem || null
    };
  }

  function normalizeDailyMetric(row, source) {
    const receita = dashboardRevenueValue(row);
    return {
      ...row,
      day: numberOrNull(row.day),
      receita,
      receita_bruta: numberOrNull(row.receita_bruta) ?? receita,
      receita_liquida: numberOrNull(row.receita_liquida),
      pares: numberOrNull(row.pares),
      pedidos: numberOrNull(row.pedidos) ?? numberOrNull(row.pedidos_validos),
      novos: numberOrNull(row.novos),
      recorrentes: numberOrNull(row.recorrentes),
      origem: normalizedMetricOrigin(row, source),
      fonte_dados: source || row.fonte_dados || row.origem || null
    };
  }

  function normalizeColorMetric(row, source) {
    const receita = dashboardRevenueValue(row);
    return {
      ...row,
      receita: receita,
      receita_bruta: numberOrNull(row.receita_bruta) ?? receita,
      receita_liquida: numberOrNull(row.receita_liquida),
      pares: numberOrNull(row.pares),
      pedidos: numberOrNull(row.pedidos) ?? numberOrNull(row.pedidos_validos),
      origem: normalizedMetricOrigin(row, source),
      fonte_dados: source || row.fonte_dados || row.origem || null
    };
  }

  function normalizeLaunchMetrics(model, metrics, source) {
    if (!metrics) return null;
    const janelas = emptyWindows();
    WINDOW_KEYS.forEach((key) => {
      janelas[key] = normalizeWindowMetric(metrics.janelas?.[key], source);
    });
    return {
      ...metrics,
      modelo_id: metrics.modelo_id || model.modelo_id,
      modelo: metrics.modelo || model.modelo,
      day_zero_base: canonicalDayZero(model),
      data_oficial: model.data_oficial,
      origem: source || metrics.origem || null,
      fonte_dados: source || metrics.fonte_dados || metrics.origem || null,
      janelas,
      daily: (metrics.daily || []).map((row) => normalizeDailyMetric(row, source)).filter((row) => row.day !== null),
      semanas: metrics.semanas || [],
      cores: (metrics.cores || []).map((row) => normalizeColorMetric(row, source)),
      tamanhos: metrics.tamanhos || []
    };
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
          day: windowEndDay(key),
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
      receita_bruta: receita,
      pares,
      pedidos,
      pedidos_validos: pedidos,
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
        const windowDay = windowEndDay(key);
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
      const hist = normalizeLaunchMetrics(model, histById.get(model.modelo_id), 'historico');
      const pipelineRows = (data.lancamentos_produtos_dia || []).filter((row) => row.modelo_id === model.modelo_id);
      const pipeline = normalizeLaunchMetrics(model, aggregatePipeline(model, data.lancamentos_produtos_dia || []), 'pipeline');
      const rawMetrics = pipeline || hist || {
        modelo_id: model.modelo_id,
        modelo: model.modelo,
        day_zero_base: canonicalDayZero(model),
        data_oficial: model.data_oficial,
        gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(canonicalDayZero(model))) || 0),
        janelas: emptyWindows(),
        multiplicadores: { m15_7: null, m30_15: null, m60_30: null, m90_15: null, m90_30: null },
        semanas: [],
        cores: [],
        tamanhos: [],
        daily: [],
        acumulado_atual: null,
        acumulado_lancamento: null,
        first_sale_date: null,
        first_sale_gap_dias: null,
        origem: isPlannedStatus(model.status) ? 'planejado' : 'pipeline'
      };
      const d0 = canonicalDayZero(model);
      const d0Date = toDate(d0);
      const dPlus = d0Date ? daysBetween(d0, snapshotDate()) : null;
      const isFuture = d0Date ? d0Date > snapshotDate() : true;
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
        acumulado_lancamento: metrics.acumulado_lancamento || null,
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

  function launchWindowRangeLabel(launch, key) {
    const d0 = analysisDayZero(launch);
    const endDay = windowEndDay(key);
    if (!d0 || endDay === null) return 'janela sem D0';
    return `${fmtDateSlash(d0)} a ${fmtDateSlash(toIsoDate(addDays(d0, endDay)))}`;
  }

  function selectedPeriodKey() {
    return WINDOW_KEYS.includes(state.analysisPeriodKey || '') ? state.analysisPeriodKey : '30d';
  }

  function selectedAnalysisWindow(launch) {
    const period = selectedPeriodKey();
    if (!launch) {
      return { key: null, data: null, isCurrentAccumulated: false, label: '—' };
    }

    return {
      key: period,
      data: getWindow(launch, period),
      isCurrentAccumulated: false,
      label: windowLabel(period)
    };
  }

  function isSpecificAnalysisPeriod() {
    return WINDOW_KEYS.includes(state.analysisPeriodKey || '');
  }

  function selectedPeriodEndDay(launch, { capToAvailable = false } = {}) {
    const period = selectedPeriodKey();
    const day = WINDOW_DAYS[period] ?? WINDOW_DAYS['30d'];
    if (day === null) return null;
    if (!capToAvailable) return Math.max(0, Math.min(90, day));
    const available = [
      latestLaunchDataDay(launch),
      numberOrNull(launch?.dPlus)
    ].filter((value) => value !== null);
    const maxAvailable = available.length ? Math.max(...available) : day;
    return Math.max(0, Math.min(90, day, maxAvailable));
  }

  function selectedPeriodWindowKeys(launch) {
    const endDay = selectedPeriodEndDay(launch);
    return WINDOW_KEYS.filter((key) => windowEndDay(key) <= endDay);
  }

  function selectedPeriodLabel() {
    const key = selectedPeriodKey();
    const period = ANALYSIS_PERIODS.find((item) => item.key === key);
    return period?.label || '30 dias';
  }

  function validAnalysisPeriodKey(key) {
    return ANALYSIS_PERIODS.some((period) => period.key === key);
  }

  function syncAnalysisPeriodUrl() {
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('period', selectedPeriodKey());
      window.history.replaceState(null, '', url);
    } catch (error) {
      // URL sync is only a convenience for sharing/debugging; rendering must not depend on it.
    }
  }

  function applyInitialAnalysisPeriodFromUrl() {
    const params = new URLSearchParams(window.location.search || '');
    const period = params.get('period');
    if (validAnalysisPeriodKey(period)) state.analysisPeriodKey = period;
  }

  function launchSalesRowsForSelectedPeriod(launch) {
    const periodKey = selectedPeriodKey();
    if (!getWindow(launch, periodKey)) return [];
    const endDay = selectedPeriodEndDay(launch);
    return optionalRows('lancamentos_produtos_dia').filter((row) => {
      if (row.modelo_id !== launch?.modelo_id) return false;
      const idx = dayIndex(analysisDayZero(launch), row.data);
      return idx !== null && idx >= 0 && (endDay === null || idx <= endDay);
    });
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
      const orderId = row.order_sk;
      if (orderId) orderIds.add(orderId);
      else pedidosFallback += Number(row.pedidos_validos ?? row.pedidos ?? 0);
      pares += Number(row.pares || 0);
      receita += dashboardRevenueNumber(row);
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
    const receitaAuditoria = Number((resumo.receita_bruta_itens ?? resumo.receita_liquida_itens) || 0);
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
    if (quality.status === 'ok' && quality.auditado !== false) return badge('pipeline', 'Auditado', 'Auditoria independente do SSOT bateu com o export do dashboard em pedidos, pares e receita. Use como dado real auditado.');
    if (quality.status === 'divergente') return badge('neg', 'Divergente', 'A auditoria independente não bate com o JSON exportado. Não use esta leitura para decisão antes de investigar pedidos, pares e receita.');
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

  function roasNumberOrNull(value) {
    const parsed = numberOrNull(value);
    if (parsed === null) return null;
    const text = String(value || '').trim().toLowerCase();
    const explicitlyPercent = text.includes('%');
    if (explicitlyPercent || parsed > 100) {
      return Number((parsed / 100).toFixed(6));
    }
    return parsed;
  }

  function coverageBadge(launch, key) {
    const win = getWindow(launch, key);
    if (!win) return '—';
    if (win.origem === 'historico_backfill') return badge('parcial', 'Hist. estim.', 'Histórico agregado foi distribuído entre marcos para permitir curva visual. Não é dado diário real.');
    if (win.origem === 'historico') return badge('historico', 'Histórico', 'Benchmark estático vindo de data/lancamentos_historico.json, normalizado no mesmo contrato do pipeline.');
    const endDay = windowEndDay(key);
    if (endDay !== null && (launch.dPlus ?? 0) < endDay) return badge('parcial', `Parcial D+${Math.max(0, launch.dPlus)}`, `Janela ${windowLabel(key)} ainda não fechou no snapshot. O acumulado atual vai até D+${Math.max(0, launch.dPlus ?? 0)}.`);
    return badge('pipeline', 'Pipeline SSOT', `Janela ${windowLabel(key)} fechada com dados reais do pipeline exportado pelo Apps Script e normalizado no mesmo contrato do histórico.`);
  }

  function sourceBadge(launch) {
    const auditBadge = auditBadgeForLaunch(launch);
    if (auditBadge) return auditBadge;
    const hasAnyWindow = WINDOW_KEYS.some((key) => Boolean(getWindow(launch, key)));
    if (launch.isFuture) return badge('planejado', 'Planejado', 'Modelo com D0 futuro no snapshot. Fica fora de vendas, mídia, CRM e projeção até entrar dado real.');
    if (!hasAnyWindow && hasPipelineRows(launch)) return badge('parcial', `Atual D+${Math.max(0, launch.dPlus)}`, 'Há linhas reais no pipeline, mas nenhuma janela fixa fechada ainda.');
    if (!hasAnyWindow) return badge('parcial', `Sem dados D+${Math.max(0, launch.dPlus)}`, 'Não há janela fechada nem acumulado suficiente no JSON. Ausência permanece vazia, não vira zero.');
    if (launch.origem === 'pipeline') return badge('pipeline', `Pipeline SSOT D+${Math.max(0, launch.dPlus)}`, 'Dados reais vindos de lancamentos_produtos_dia.json, normalizados no mesmo contrato do histórico.');
    if (launch.origem === 'historico') return badge('historico', 'Histórico normalizado', 'Benchmark estático vindo de data/lancamentos_historico.json e convertido para o mesmo contrato de janelas do pipeline.');
    return badge('parcial', 'Sem dados', 'Fonte insuficiente para classificar a leitura.');
  }

  const launchCheckpointPlugin = {
    id: 'launchCheckpoints',
    afterDraw(chart, args, opts) {
      const checkpoints = opts?.checkpoints || [];
      if (!checkpoints.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales.x;
      ctx.save();
      const slotsByBucket = new Map();
      checkpoints.forEach((cp) => {
        const idx = chart.data.labels.indexOf(cp.dateLabel);
        if (idx === -1) return;
        const x = xScale.getPixelForValue(idx);
        const bucket = Math.round(x / 34);
        const slot = slotsByBucket.get(bucket) || 0;
        slotsByBucket.set(bucket, slot + 1);
        ctx.strokeStyle = cp.color || 'rgba(255,255,255,0.4)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        if (slot > 3) return;
        ctx.fillStyle = cp.color || '#fff';
        ctx.font = '10px Inter, sans-serif';
        ctx.textAlign = 'left';
        const text = String(cp.text || '').slice(0, 22);
        const textWidth = ctx.measureText(text).width;
        const labelX = Math.min(x + 4, Math.max(chartArea.left + 2, chartArea.right - textWidth - 2));
        ctx.fillText(text, labelX, chartArea.top + 11 + (slot * 12));
      });
      ctx.restore();
    }
  };

  const clientMixLabelsPlugin = {
    id: 'clientMixLabels',
    afterDatasetsDraw(chart, args, opts) {
      const rows = opts?.rows || [];
      if (!rows.length) return;
      const { ctx, chartArea } = chart;
      const drawInside = (bar, text, shortText = text, color = '#FFFFFF') => {
        if (!bar || !text) return;
        const props = bar.getProps(['x', 'y', 'base', 'height'], true);
        const left = Math.min(props.base, props.x);
        const right = Math.max(props.base, props.x);
        const width = right - left;
        if (width < 28) return;
        const label = width < 86 ? shortText : text;
        ctx.save();
        ctx.fillStyle = color;
        ctx.font = '700 10px Inter, "Segoe UI", Arial, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, left + width / 2, props.y);
        ctx.restore();
      };

      rows.forEach((row, index) => {
        const pct = numberOrNull(row?.pct);
        if (pct === null) {
          const missingBar = chart.getDatasetMeta(2)?.data?.[index];
          if (!missingBar) return;
          const props = missingBar.getProps(['x', 'y', 'base'], true);
          const left = Math.min(props.base, props.x);
          const right = Math.max(props.base, props.x);
          ctx.save();
          ctx.fillStyle = 'rgba(255,255,255,0.56)';
          ctx.font = '700 10px Inter, "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillText('sem classificação', Math.min(chartArea.right - 56, left + (right - left) / 2), props.y);
          ctx.restore();
          return;
        }
        const novos = numberOrNull(row?.novos);
        const recorrentes = numberOrNull(row?.recorrentes);
        drawInside(
          chart.getDatasetMeta(0)?.data?.[index],
          `${fmtNum(novos)} · ${fmtPct(pct, 1)}`,
          `${fmtNum(novos)} · ${fmtPct(pct, 0)}`
        );
        drawInside(
          chart.getDatasetMeta(1)?.data?.[index],
          `${fmtNum(recorrentes)} · ${fmtPct(1 - pct, 1)}`,
          `${fmtNum(recorrentes)} · ${fmtPct(1 - pct, 0)}`
        );
      });
    }
  };

  function configureChartDefaults() {
    if (!window.Chart) return;
    Chart.register(launchCheckpointPlugin);
    Chart.register(clientMixLabelsPlugin);
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
    Chart.defaults.plugins.tooltip.bodySpacing = 3;
    Chart.defaults.plugins.tooltip.titleMarginBottom = 6;
    Chart.defaults.plugins.tooltip.caretPadding = 8;
  }

  function destroyCharts() {
    Object.values(state.charts).forEach((chart) => chart?.destroy?.());
    state.charts = {};
  }

  function chartOptions(extra = {}) {
    const base = {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 8, right: 12, bottom: 2, left: 2 } },
      plugins: {
        legend: {
          position: 'bottom',
          align: 'center',
          labels: {
            padding: 14,
            boxWidth: 8,
            boxHeight: 8,
            usePointStyle: true
          }
        },
        tooltip: {
          enabled: true,
          filter: (item) => {
            const parsedValue = isPlainObject(item.parsed)
              ? item.chart?.options?.indexAxis === 'y'
                ? item.parsed.x
                : (item.parsed.y ?? item.parsed.x)
              : item.parsed;
            const value = parsedValue ?? item.raw;
            return value !== null
              && value !== undefined
              && !(typeof value === 'number' && Number.isNaN(value));
          }
        }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { maxRotation: 0, padding: 8 }
        },
        y: {
          beginAtZero: true,
          grace: '8%',
          grid: { color: 'rgba(255,255,255,0.05)' },
          ticks: { maxTicksLimit: 5 }
        }
      }
    };
    return mergePlainObjects(base, extra);
  }

  function createChart(id, cfg) {
    const canvas = $(id);
    if (!canvas || !window.Chart) return null;
    state.charts[id] = new Chart(canvas, cfg);
    return state.charts[id];
  }

  function collapsibleListItems(container) {
    return [...(container?.children || [])].filter((child) => {
      if (child.hidden || child.matches('[data-collapsible-control], .empty-state')) return false;
      if (container.tagName === 'TBODY') return child.tagName === 'TR';
      return true;
    });
  }

  function collapsibleListLabel(container) {
    return container.tagName === 'TBODY' ? 'linhas' : 'itens';
  }

  function setCollapsibleListState(container, button, expanded, total) {
    const label = collapsibleListLabel(container);
    const hiddenCount = Math.max(0, total - COLLAPSIBLE_LIST_LIMIT);
    const hiddenLabel = hiddenCount === 1
      ? (label === 'linhas' ? 'linha' : 'item')
      : label;
    container.classList.toggle('is-collapsed', !expanded);
    button.setAttribute('aria-expanded', String(expanded));
    button.textContent = expanded
      ? `Recolher para ${COLLAPSIBLE_LIST_LIMIT} ${label}`
      : `Mostrar mais ${hiddenCount} ${hiddenLabel}`;
  }

  function applyCollapsibleLists(root = document) {
    root.querySelectorAll('[data-collapsible-control]').forEach((control) => control.remove());
    root.querySelectorAll('.collapsible-list').forEach((container) => {
      container.classList.remove('collapsible-list', 'is-collapsed');
      container.removeAttribute('data-collapsible-total');
    });

    COLLAPSIBLE_LIST_SELECTORS.forEach((selector) => {
      root.querySelectorAll(selector).forEach((container) => {
        if (container.closest('.nav-list, .compare-menu, .topic-tabs, .selector-panel')) return;
        const items = collapsibleListItems(container);
        if (items.length <= COLLAPSIBLE_LIST_LIMIT) return;

        if (!container.id) {
          collapsibleListSequence += 1;
          container.id = `collapsible-list-${collapsibleListSequence}`;
        }

        container.classList.add('collapsible-list', 'is-collapsed');
        container.dataset.collapsibleTotal = String(items.length);

        const control = document.createElement('div');
        control.className = 'collapsible-list-control';
        control.dataset.collapsibleControl = '';

        const button = document.createElement('button');
        button.className = 'collapsible-list-toggle';
        button.type = 'button';
        button.setAttribute('aria-controls', container.id);

        setCollapsibleListState(container, button, false, items.length);
        button.addEventListener('click', () => {
          setCollapsibleListState(container, button, container.classList.contains('is-collapsed'), items.length);
        });

        control.appendChild(button);
        const tableWrap = container.tagName === 'TBODY' ? container.closest('.table-wrap, .drill-table-wrap') : null;
        if (tableWrap) tableWrap.appendChild(control);
        else container.insertAdjacentElement('afterend', control);
      });
    });
  }

  function updateMainDrawerOverlay() {
    const overlay = $('drawer-overlay');
    if (!overlay) return;
    overlay.hidden = !document.body.classList.contains('drawer-open');
  }

  function setNavDrawerOpen(open) {
    const drawer = $('nav-drawer');
    const overlay = $('drawer-overlay');
    const toggle = $('nav-drawer-toggle');
    const close = $('nav-drawer-close');
    if (!drawer || !overlay || !toggle || !close) return;

    document.body.classList.toggle('drawer-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    drawer.setAttribute('aria-hidden', String(!open));
    if (open) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');
    updateMainDrawerOverlay();
    if (open) drawer.focus({ preventScroll: true });
  }

  function closeMainDrawers() {
    setNavDrawerOpen(false);
  }

  function configureDrawer() {
    const drawer = $('nav-drawer');
    const overlay = $('drawer-overlay');
    const toggle = $('nav-drawer-toggle');
    const close = $('nav-drawer-close');
    if (!drawer || !overlay || !toggle || !close) return;

    toggle.addEventListener('click', () => setNavDrawerOpen(!document.body.classList.contains('drawer-open')));
    close.addEventListener('click', () => setNavDrawerOpen(false));
    overlay.addEventListener('click', closeMainDrawers);
    drawer.querySelectorAll('.nav-list a').forEach((link) => {
      link.addEventListener('click', () => setNavDrawerOpen(false));
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeMainDrawers();
    });
  }

  function populateCannibalLineSelect() {
    const lineSelect = $('cannibal-line-select');
    if (!lineSelect) return;
    const lines = [...new Set((state.launches || []).map((launch) => launch.modelo_id))]
      .filter((modelId) => familiesForModel(modelId).length > 1);
    lineSelect.innerHTML = lines.map((modelId) => {
      const launch = state.launches.find((item) => item.modelo_id === modelId);
      return `<option value="${escapeHtml(modelId)}">${escapeHtml(launch?.linha || launch?.modelo || modelId)}</option>`;
    }).join('');
    if (!state.canibalLineFilter || !lines.includes(state.canibalLineFilter)) {
      state.canibalLineFilter = lines[0] || null;
    }
    lineSelect.value = state.canibalLineFilter || '';
  }

  function configureNormalizedChartModeToggle() {
    const buttons = [...document.querySelectorAll('[data-chart-mode]')];
    const lineSelect = $('cannibal-line-select');
    if (!buttons.length) return;

    const currentSelected = () => state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((button) => button.classList.toggle('is-active', button === btn));
        state.normalizedChartMode = btn.dataset.chartMode || 'linha';
        if (lineSelect) {
          const showSelect = state.normalizedChartMode === 'canibal-submodelos';
          lineSelect.hidden = !showSelect;
          if (showSelect) populateCannibalLineSelect();
        }
        const selected = currentSelected();
        renderNormalizedChart(selected);
      });
    });

    if (lineSelect) {
      lineSelect.addEventListener('change', () => {
        state.canibalLineFilter = lineSelect.value;
        const selected = currentSelected();
        renderNormalizedChart(selected);
      });
    }
  }

  function configureCommercialChartMetricToggle() {
    const buttons = [...document.querySelectorAll('[data-commercial-chart-metric]')];
    if (!buttons.length) return;

    const currentSelected = () => state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((button) => button.classList.toggle('is-active', button === btn));
        state.commercialChartMetric = btn.dataset.commercialChartMetric || 'investimento';
        renderCommercialEfficiencyChart(currentSelected());
      });
    });
  }

  function configureTopicTabs() {
    document.querySelectorAll('.topic-tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        $(`topic-${tab.dataset.topic}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
  }

  function configureStorySubModelControls() {
    document.addEventListener('change', (event) => {
      const select = event.target?.closest?.('#story-analysis-front-select, #story-analysis-item-select, #story-analysis-select, #story-submodel-select');
      if (!select) return;
      const selected = state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];
      if (!selected?.modelo_id) return;
      if (select.id === 'story-analysis-front-select') {
        const group = storyAnalysisGroups(selected).find((item) => item.key === select.value);
        state.storyAnalysisByModel[selected.modelo_id] = group?.options?.[0]?.id || '';
      } else {
        state.storyAnalysisByModel[selected.modelo_id] = select.value;
        state.storySubModelByModel[selected.modelo_id] = select.value;
      }
      renderStoryBrief(selected);
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
    const launches = comparableLaunches();
    wrap.innerHTML = `
      <select class="model-select" aria-label="Linha destacada">
        ${launches.map((launch) => {
          const status = launch.isActive ? ' · ativo' : isPlannedStatus(launch.status) ? ' · planejado' : '';
          return `<option value="${launch.modelo_id}" ${launch.modelo_id === state.primaryModelId ? 'selected' : ''}>${escapeHtml(launch.modelo)}${escapeHtml(status)}</option>`;
        }).join('')}
      </select>`;
    wrap.querySelector('select')?.addEventListener('change', (event) => {
      state.primaryModelId = event.target.value;
      renderAll();
    });
  }

  function renderPeriodSelector() {
    const wrap = $('period-selector');
    wrap.innerHTML = `
      <select class="period-select" aria-label="Período principal da análise">
        ${ANALYSIS_PERIODS.map((period) => (
          `<option value="${period.key}" ${period.key === state.analysisPeriodKey ? 'selected' : ''}>${escapeHtml(period.label)}</option>`
        )).join('')}
      </select>`;
    wrap.querySelector('select')?.addEventListener('change', (event) => {
      state.analysisPeriodKey = event.target.value;
      syncAnalysisPeriodUrl();
      renderAll();
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
      <details class="compare-dropdown">
        <summary>
          <span>${escapeHtml(label)}</span>
          <span class="compare-dropdown-count">${fmtNum(selectedLaunches.length)} de ${fmtNum(launches.length)}</span>
        </summary>
        <div class="compare-menu">
          <div class="compare-toolbar">
            <div class="compare-summary">Modelos usados em rankings, curvas, comerciais e projeção.</div>
            <div class="compare-actions">
              <button class="compare-action" type="button" data-compare-action="all">Todos</button>
              <button class="compare-action" type="button" data-compare-action="none">Limpar</button>
            </div>
          </div>
          ${launches.map((launch) => {
            const active = selected.has(launch.modelo_id);
            return `<label class="compare-option ${active ? 'active' : ''}" title="${escapeHtml(launch.modelo)}">
              <input type="checkbox" value="${launch.modelo_id}" ${active ? 'checked' : ''}>
              <span class="dot" style="color:${colorFor(launch.modelo_id, launch.order)}"></span>
              <span>${escapeHtml(launch.modelo)}</span>
            </label>`;
          }).join('')}
        </div>
      </details>`;
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
      warning.textContent = 'Nenhum modelo marcado; marque linhas para manter a análise comparativa.';
    } else if (selectedLaunches.length === 1) {
      warning.textContent = 'Com 1 linha, o painel perde leitura comparativa.';
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

  function renderAnalysisContext(selected) {
    const wrap = $('analysis-context');
    if (!wrap || !selected) return;
    const periodKey = selectedPeriodKey();
    const period = ANALYSIS_PERIODS.find((item) => item.key === periodKey);
    const compareCount = selectedCompareLaunches().length || 1;
    const dLabel = selected.isFuture
      ? `D${selected.dPlus}`
      : `D+${Math.max(0, selected.dPlus ?? 0)}`;
    const items = [
      { label: 'Modelo', value: selected.modelo },
      { label: 'Janela', value: period?.label || selectedPeriodLabel() },
      { label: 'Comparativo', value: `${fmtNum(compareCount)} modelos` },
      { label: 'Snapshot', value: `${fmtDate(snapshotIso())} · ${dLabel}` }
    ];
    wrap.innerHTML = `
      <div class="analysis-context-main">
        ${items.map((item) => `
          <div class="analysis-context-item">
            <span>${escapeHtml(item.label)}</span>
            <strong>${escapeHtml(item.value)}</strong>
          </div>
        `).join('')}
      </div>
      <div class="analysis-context-status">${sourceBadge(selected)}</div>
    `;
  }

  function optionalRows(name) {
    const payload = state.data?.[name];
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.rows)) return payload.rows;
    return [];
  }

  function stockRowsForLaunch(launch) {
    const id = String(launch?.modelo_id || '').trim();
    if (!id) return [];
    return optionalRows('estoque').filter((row) => String(row.modelo_id || '').trim() === id);
  }

  function stockStatsForLaunch(launch) {
    const rows = stockRowsForLaunch(launch).map((row) => {
      const stock = numberOrNull(row.estoque_atual ?? row.estoque ?? row.saldo);
      const coverage = numberOrNull(row.cobertura_dias ?? row.cobertura);
      return {
        row,
        stock,
        coverage,
        label: String(row.sub_modelo || row.sku || row.nome_produto || row.cor || 'SKU sem nome'),
        detail: [row.cor, row.tamanho].filter(Boolean).join(' · ')
      };
    });
    const totalRows = rows.length;
    const availableUnits = rows.reduce((acc, item) => acc + Math.max(0, numberOrNull(item.stock) ?? 0), 0);
    const zeroOrNegative = rows.filter((item) => item.stock !== null && item.stock <= 0);
    const lowCoverage = rows.filter((item) => item.coverage !== null && item.coverage < 15 && (item.stock ?? 0) > 0);
    const criticalRows = rows
      .filter((item) => (item.stock !== null && item.stock <= 0) || (item.coverage !== null && item.coverage < 15))
      .sort((a, b) => {
        const stockRiskA = a.stock !== null && a.stock <= 0 ? 0 : 1;
        const stockRiskB = b.stock !== null && b.stock <= 0 ? 0 : 1;
        if (stockRiskA !== stockRiskB) return stockRiskA - stockRiskB;
        return (a.coverage ?? 9999) - (b.coverage ?? 9999) || (a.stock ?? 9999) - (b.stock ?? 9999);
      });
    return {
      rows,
      totalRows,
      availableUnits,
      zeroOrNegativeCount: zeroOrNegative.length,
      lowCoverageCount: lowCoverage.length,
      criticalRows
    };
  }

  function readingAlertBadgeType(alerts) {
    if (alerts.some((alert) => alert.type === 'neg')) return 'neg';
    if (alerts.some((alert) => alert.type === 'warn')) return 'parcial';
    return 'pipeline';
  }

  function stockBadgeType(stockStats) {
    if (!stockStats.totalRows) return 'parcial';
    if (stockStats.zeroOrNegativeCount) return 'neg';
    if (stockStats.lowCoverageCount) return 'parcial';
    return 'pipeline';
  }

  function buildReadingAlerts(selected, stockStats) {
    if (!selected) return [];
    const periodKey = selectedPeriodKey();
    const periodLabel = selectedPeriodLabel();
    const comparison = comparisonLaunchesWithFocus(selected);
    const selectedWindow = getWindow(selected, periodKey);
    const missingWindow = comparison.filter((launch) => !getWindow(launch, periodKey));
    const audit = auditQualityForLaunch(selected);
    const mediaBlocked = optionalRows('midia_paga').filter((row) => row.atribuicao_bloqueada || normalizeText(row.metodologia) === 'receita janela agregada');
    const manifestWarnings = Array.isArray(state.data?.manifest?.warnings) ? state.data.manifest.warnings : [];

    const alerts = [];
    if (!selectedWindow) {
      alerts.push({
        type: 'warn',
        title: 'Janela ainda em maturação',
        copy: `${selected.modelo} ainda não tem ${periodLabel} fechado. A leitura mantém a janela vazia e evita transformar ausência em zero.`
      });
    }
    if (missingWindow.length) {
      alerts.push({
        type: 'warn',
        title: 'Comparativo com linhas em curso',
        copy: `${fmtNum(missingWindow.length)} de ${fmtNum(comparison.length)} linhas ainda não fecharam ${periodLabel}; elas continuam visíveis como pendentes.`
      });
    }
    if (audit?.status === 'divergente') {
      alerts.push({
        type: 'neg',
        title: 'Auditoria divergente',
        copy: `${selected.modelo} diverge da auditoria independente em pedidos, pares ou receita. Priorize investigação antes de decisão.`
      });
    }
    if (stockStats.totalRows && stockStats.zeroOrNegativeCount) {
      alerts.push({
        type: 'warn',
        title: 'Estoque pode limitar a curva',
        copy: `${fmtNum(stockStats.zeroOrNegativeCount)} SKU(s) da linha destacada estão sem saldo ou negativos. Leia estoque como contexto operacional, não como venda.`
      });
    } else if (!stockStats.totalRows) {
      alerts.push({
        type: 'warn',
        title: 'Estoque pendente',
        copy: `O pacote atual não trouxe itens de estoque para ${selected.modelo}. A curva comercial segue válida, mas sem leitura operacional de cobertura.`
      });
    }
    if (mediaBlocked.length) {
      alerts.push({
        type: 'warn',
        title: 'Canal ainda incompleto',
        copy: `${fmtNum(mediaBlocked.length)} linha(s) de mídia seguem sem atribuição real por pedido; ROAS por canal fica bloqueado onde a receita não for confiável.`
      });
    }
    const technicalWarning = manifestWarnings.find((warning) => /ALERTA|falhou/i.test(String(warning)));
    if (technicalWarning) {
      alerts.push({
        type: /ALERTA|falhou/i.test(String(technicalWarning)) ? 'neg' : 'warn',
        title: 'Aviso do pacote de dados',
        copy: String(technicalWarning)
      });
    }
    if (!alerts.length) {
      alerts.push({
        type: 'pos',
        title: 'Sem alerta bloqueante',
        copy: 'Janela comparativa, pacote público e leitura executiva estão prontos para análise visual.'
      });
    }
    return alerts.slice(0, 4);
  }

  function renderReadingSupport(selected) {
    const wrap = $('reading-support');
    if (!wrap || !selected) return;
    const stockStats = stockStatsForLaunch(selected);
    const alerts = buildReadingAlerts(selected, stockStats);
    const alertCount = alerts.filter((alert) => alert.type !== 'pos').length;
    const alertBadgeLabel = alertCount === 1 ? '1 alerta' : alertCount ? `${fmtNum(alertCount)} alertas` : 'Sem alerta';
    const d0 = analysisDayZero(selected);
    const periodLabel = selectedPeriodLabel();
    const alertType = readingAlertBadgeType(alerts);
    const stockType = stockBadgeType(stockStats);
    const stockRiskCount = stockStats.zeroOrNegativeCount || stockStats.lowCoverageCount;
    const stockLabel = stockStats.totalRows
      ? stockRiskCount
        ? `${fmtNum(stockStats.totalRows)} itens · ${fmtNum(stockRiskCount)} riscos`
        : `${fmtNum(stockStats.totalRows)} itens · ${fmtNum(stockStats.availableUnits)} un.`
      : 'Estoque pendente';
    const methodRows = [
      {
        title: 'Linha do tempo',
        copy: `${periodLabel} sempre começa no D0 canônico de cada lançamento. A linha destacada usa ${d0 ? fmtDateSlash(d0) : 'D0 não carregado'}.`
      },
      {
        title: 'Comparação',
        copy: 'Cada lançamento é comparado na própria idade de venda. As datas de calendário não são misturadas entre modelos.'
      },
      {
        title: 'Faturamento',
        copy: 'A leitura visual usa receita bruta do SSOT. Receita líquida fica como apoio financeiro, não como base do placar.'
      },
      {
        title: 'Meta',
        copy: 'A meta é a meta total do mês em metas_mensais.json. Quando a janela cruza meses, a leitura mostra mês a mês, sem acumular meta artificial.'
      },
      {
        title: 'Ausência',
        copy: 'Janela aberta ou dado não carregado aparece vazio. O dashboard não transforma falta de dado em zero.'
      }
    ];
    const stockRows = stockStats.criticalRows.slice(0, 4);
    const stockRowsHtml = stockRows.length
      ? `<div class="stock-risk-list">
          ${stockRows.map((item) => `
            <div class="stock-risk-row">
              <div>
                <strong title="${escapeHtml(item.label)}">${escapeHtml(item.label)}</strong>
                <small>${escapeHtml(item.detail || 'sem detalhe')} · cobertura ${item.coverage === null ? 'sem dado' : `${fmtNum(item.coverage)} dias`}</small>
              </div>
              <em>${item.stock === null ? 'sem saldo' : `${fmtNum(item.stock)} un.`}</em>
            </div>
          `).join('')}
        </div>`
      : '<div class="reading-support-empty">Sem ruptura crítica nos SKUs vinculados à linha destacada.</div>';

    wrap.innerHTML = `
      <details class="reading-support-panel"${alerts.some((alert) => alert.type === 'neg') ? ' open' : ''}>
        <summary>
          <span class="reading-support-title">
            <span>Apoio de leitura</span>
            <strong>Metodologia, alertas e estoque</strong>
          </span>
          <span class="reading-support-badges">
            ${badge(alertType, alertBadgeLabel, 'Mostra ressalvas que mudam a forma de ler a análise, sem esconder o dado.')}
            ${badge('orange', d0 ? `D0 ${fmtDateSlash(d0)}` : 'D0 pendente', 'D0 canônico usado para alinhar as janelas comparativas.')}
            ${badge(stockType, stockLabel, 'Resumo do estoque atual da linha destacada; não substitui a venda realizada.')}
          </span>
        </summary>
        <div class="reading-support-grid">
          <div class="reading-support-card">
            <h3>Como ler</h3>
            <div class="reading-support-list">
              ${methodRows.map((item) => `
                <div class="reading-support-row">
                  <b>${escapeHtml(item.title)}</b>
                  <span>${escapeHtml(item.copy)}</span>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="reading-support-card reading-support-card--${alertType === 'neg' ? 'negative' : alertType === 'parcial' ? 'warning' : 'positive'}">
            <h3>Alertas de leitura</h3>
            ${alerts.map((alert) => `
              <div class="reading-support-alert reading-support-alert--${escapeHtml(alert.type)}">
                <strong>${escapeHtml(alert.title)}</strong>
                <p>${escapeHtml(alert.copy)}</p>
              </div>
            `).join('')}
          </div>
          <div class="reading-support-card reading-support-card--${stockType === 'neg' ? 'negative' : stockType === 'parcial' ? 'warning' : 'positive'}">
            <h3>Estoque de apoio</h3>
            <p>${stockStats.totalRows
              ? `${fmtNum(stockStats.totalRows)} SKUs ligados a ${escapeHtml(selected.modelo)}; ${fmtNum(stockStats.zeroOrNegativeCount)} sem saldo e ${fmtNum(stockStats.lowCoverageCount)} com cobertura menor que 15 dias.`
              : `Estoque ainda não disponível para ${escapeHtml(selected.modelo)} no pacote atual.`}</p>
            ${stockRowsHtml}
          </div>
        </div>
      </details>
    `;
  }

  function monthKeyFromIso(value) {
    const text = String(value || '').trim();
    return /^\d{4}-\d{2}/.test(text) ? text.slice(0, 7) : '';
  }

  function fmtMonthKey(value) {
    const month = monthKeyFromIso(value);
    if (!month) return '-';
    const [year, monthNum] = month.split('-').map(Number);
    if (!year || !monthNum) return month;
    return new Intl.DateTimeFormat('pt-BR', { month: 'short', year: 'numeric' })
      .format(new Date(year, monthNum - 1, 1));
  }

  function metaMonthKey(row) {
    return monthKeyFromIso(row.mes || row.competencia || row.month || row.data || row.data_inicio);
  }

  function metaMensalForLaunch(launch) {
    const rows = optionalRows('metas_mensais');
    const month = monthKeyFromIso(launch?.d0 || snapshotIso());
    if (!rows.length || !month) return null;

    const scored = rows
      .map((row) => {
        const rowMonth = metaMonthKey(row);
        const rowModel = String(row.modelo_id || '').trim();
        const modelScore = rowModel && rowModel === launch.modelo_id ? 2 : rowModel ? -1 : 1;
        if (modelScore < 0) return null;
        return rowMonth ? { row, rowMonth, score: modelScore } : null;
      })
      .filter(Boolean);

    const exact = scored
      .filter((item) => item.rowMonth === month)
      .sort((a, b) => b.score - a.score)[0];
    if (exact) return exact.row;

    const fallback = scored
      .filter((item) => item.rowMonth < month)
      .sort((a, b) => b.rowMonth.localeCompare(a.rowMonth) || b.score - a.score)[0];

    if (!fallback) return null;
    return {
      ...fallback.row,
      __meta_status: 'month_open',
      __requested_month: month,
      __fallback_month: fallback.rowMonth
    };
  }

  function metaMensalForMonth(month, launch) {
    const rows = optionalRows('metas_mensais');
    const targetMonth = monthKeyFromIso(month);
    if (!rows.length || !targetMonth) return null;

    return rows
      .map((row) => {
        const rowMonth = metaMonthKey(row);
        const rowModel = String(row.modelo_id || '').trim();
        const modelScore = rowModel && rowModel === launch?.modelo_id ? 2 : rowModel ? -1 : 1;
        if (modelScore < 0 || rowMonth !== targetMonth) return null;
        return { row, score: modelScore };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)[0]?.row || null;
  }

  function daysInMonthKey(month) {
    const targetMonth = monthKeyFromIso(month);
    if (!targetMonth) return null;
    const [year, monthNum] = targetMonth.split('-').map(Number);
    if (!year || !monthNum) return null;
    return new Date(year, monthNum, 0).getDate();
  }

  function monthEndIso(month) {
    const targetMonth = monthKeyFromIso(month);
    const days = daysInMonthKey(targetMonth);
    return targetMonth && days ? `${targetMonth}-${String(days).padStart(2, '0')}` : null;
  }

  function inclusiveDays(startDate, endDate) {
    if (!startDate || !endDate) return 0;
    return Math.max(0, Math.floor((endDate - startDate) / 86400000) + 1);
  }

  function dateRangeIso(startIso, endIso) {
    const start = toDate(startIso);
    const end = toDate(endIso);
    if (!start || !end || end < start) return [];
    const dates = [];
    const cursor = new Date(start);
    while (cursor <= end) {
      dates.push(toIsoDate(cursor));
      cursor.setDate(cursor.getDate() + 1);
    }
    return dates;
  }

  function metaDailyRowsForRange(metaRow, startIso, endIso) {
    const daily = Array.isArray(metaRow?.daily) ? metaRow.daily : [];
    if (!daily.length) return [];
    return daily
      .map((row) => ({ ...row, data: String(row.data || '').slice(0, 10) }))
      .filter((row) => row.data && row.data >= startIso && row.data <= endIso);
  }

  function goalMetaForRange(startIso, endIso, launch) {
    const start = toDate(startIso);
    const end = toDate(endIso);
    if (!start || !end || end < start) {
      return { target: null, actual: null, totalDays: 0, targetDays: 0, actualDays: 0, complete: false };
    }

    let cursor = start;
    let target = 0;
    let actual = 0;
    let targetDays = 0;
    let actualDays = 0;
    let totalDays = 0;
    const parts = [];

    while (cursor <= end) {
      const month = toIsoDate(cursor).slice(0, 7);
      const [year, monthNum] = month.split('-').map(Number);
      const monthEnd = new Date(year, monthNum, 0, 12, 0, 0);
      const segmentEnd = monthEnd < end ? monthEnd : end;
      const days = inclusiveDays(cursor, segmentEnd);
      const monthDays = daysInMonthKey(month) || days;
      const metaRow = metaMensalForMonth(month, launch);
      const segmentStartIso = toIsoDate(cursor);
      const segmentEndIso = toIsoDate(segmentEnd);
      const dailyRows = metaDailyRowsForRange(metaRow, segmentStartIso, segmentEndIso);
      const targetRows = dailyRows.filter((row) => numberOrNull(row.meta_receita ?? row.revenue_target) !== null);
      const actualRows = dailyRows.filter((row) => numberOrNull(row.realizado_receita ?? row.revenue_actual) !== null);
      const targetDates = dailyRows.length
        ? targetRows.map((row) => row.data)
        : dateRangeIso(segmentStartIso, segmentEndIso);
      const actualDates = dailyRows.length
        ? actualRows.map((row) => row.data)
        : dateRangeIso(segmentStartIso, segmentEndIso);
      let targetPart = null;
      let actualPart = null;
      let targetPartDays = 0;
      let actualPartDays = 0;
      if (dailyRows.length) {
        targetPart = sumNullableRows(targetRows, 'meta_receita');
        actualPart = sumNullableRows(actualRows, 'realizado_receita');
        targetPartDays = targetPart !== null ? targetRows.length : 0;
        actualPartDays = actualPart !== null ? actualRows.length : 0;
      } else {
        const monthTarget = firstKnownCommercialNumber(metaRow, ['meta_receita', 'meta_faturamento', 'meta']);
        const monthActual = firstKnownCommercialNumber(metaRow, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']);
        targetPart = monthTarget !== null ? (monthTarget / monthDays) * days : null;
        actualPart = monthActual !== null ? (monthActual / monthDays) * days : null;
        targetPartDays = targetPart !== null ? days : 0;
        actualPartDays = actualPart !== null ? days : 0;
      }

      totalDays += days;
      if (targetPart !== null) {
        target += targetPart;
        targetDays += targetPartDays;
      }
      if (actualPart !== null) {
        actual += actualPart;
        actualDays += actualPartDays;
      }
      parts.push({
        month,
        startIso: segmentStartIso,
        endIso: segmentEndIso,
        days,
        targetDays: targetPartDays,
        actualDays: actualPartDays,
        targetDates,
        actualDates,
        source: dailyRows.length ? 'daily' : 'monthly_prorated',
        target: targetPart,
        actual: actualPart
      });

      cursor = new Date(segmentEnd);
      cursor.setDate(cursor.getDate() + 1);
    }

    return {
      target: targetDays ? target : null,
      actual: actualDays ? actual : null,
      totalDays,
      targetDays,
      actualDays,
      complete: targetDays === totalDays,
      parts
    };
  }

  function latestLaunchDataDay(launch) {
    const days = optionalRows('lancamentos_produtos_dia')
      .filter((row) => row.modelo_id === launch?.modelo_id)
      .map((row) => dayIndex(analysisDayZero(launch), row.data))
      .filter((idx) => idx !== null && idx >= 0);
    return days.length ? Math.max(...days) : null;
  }

  function aggregateLaunchSalesRows(rows, source = {}) {
    if (!rows.length) {
      return { receita: null, pedidos: null, pares: null, row: null };
    }
    const orderIds = new Set(rows.map((row) => row.order_sk).filter(Boolean));
    const pedidosSomados = rows.some((row) => row.pedidos_validos !== null && row.pedidos_validos !== undefined)
      ? rows.reduce((acc, row) => acc + Number(row.pedidos_validos || 0), 0)
      : rows.reduce((acc, row) => acc + Number(row.pedidos || 0), 0);
    const receita = rows.reduce((acc, row) => acc + dashboardRevenueNumber(row), 0);
    const pares = rows.some((row) => row.pares !== null && row.pares !== undefined)
      ? rows.reduce((acc, row) => acc + Number(row.pares || 0), 0)
      : null;
    const pedidos = orderIds.size || pedidosSomados;
    return {
      receita,
      pedidos,
      pares,
      row: { ...source, receita, pedidos, pares, linhas: rows.length }
    };
  }

  function launchRevenueForDayRange(launch, startDay, endDay) {
    const d0 = analysisDayZero(launch);
    const rows = optionalRows('lancamentos_produtos_dia').filter((row) => {
      if (row.modelo_id !== launch?.modelo_id) return false;
      const idx = dayIndex(d0, row.data);
      return idx !== null && idx >= startDay && idx <= endDay;
    });
    return aggregateLaunchSalesRows(rows, { start_day: startDay, end_day: endDay });
  }

  function launchRevenueForIsoRange(launch, startIso, endIso) {
    const d0 = analysisDayZero(launch);
    if (!d0 || !startIso || !endIso) {
      return { receita: null, pedidos: null, pares: null, row: null };
    }
    const startDay = dayIndex(d0, startIso);
    const endDay = dayIndex(d0, endIso);
    if (startDay === null || endDay === null) {
      return { receita: null, pedidos: null, pares: null, row: null };
    }
    return launchRevenueForDayRange(launch, startDay, endDay);
  }

  function goalMonthBreakdown(row, launch) {
    const parts = Array.isArray(row?.metaParts) && row.metaParts.length
      ? row.metaParts
      : row?.startIso && row?.endIso
        ? [{ month: monthKeyFromIso(row.startIso), startIso: row.startIso, endIso: row.endIso }]
        : [];
    return parts
      .map((part) => {
        const month = monthKeyFromIso(part.month || part.startIso);
        if (!month || !part.startIso || !part.endIso) return null;
        const metaRow = metaMensalForMonth(month, launch);
        const monthlyTarget = firstKnownCommercialNumber(metaRow, ['meta_receita', 'meta_faturamento', 'meta']);
        const monthlyActual = firstKnownCommercialNumber(metaRow, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']);
        const sales = launchRevenueForIsoRange(launch, part.startIso, part.endIso);
        return {
          month,
          startIso: part.startIso,
          endIso: part.endIso,
          target: monthlyTarget,
          actual: monthlyActual,
          receita: sales.receita,
          pedidos: sales.pedidos,
          pares: sales.pares,
          pctMeta: ratioOrNull(sales.receita, monthlyTarget),
          pctRealizado: ratioOrNull(sales.receita, monthlyActual)
        };
      })
      .filter(Boolean);
  }

  function meaningfulGoalMonths(row, launch) {
    return goalMonthBreakdown(row, launch).filter((part) => (
      part.target !== null || part.actual !== null || part.receita !== null
    ));
  }

  function goalDisplayPctMeta(row, launch) {
    const months = meaningfulGoalMonths(row, launch);
    if (months.length === 1) return months[0].pctMeta;
    if (months.length > 1) return null;
    return row?.pctMeta ?? null;
  }

  function goalDisplayTarget(row, launch) {
    const months = meaningfulGoalMonths(row, launch);
    if (months.length === 1) return months[0].target;
    return null;
  }

  function goalMonthBreakdownText(row, launch) {
    const months = meaningfulGoalMonths(row, launch);
    if (!months.length) return '';
    return months.map((part) => {
      const pct = part.pctMeta !== null ? ` (${fmtPct(part.pctMeta, 1)} da meta)` : '';
      return `${fmtMonthKey(part.month)}: ${fmtBRL(part.receita)} / meta do mês ${fmtBRL(part.target)}${pct}`;
    }).join(' | ');
  }

  function goalMonthBreakdownHtml(row, launch) {
    const months = meaningfulGoalMonths(row, launch);
    if (months.length <= 1) return '';
    return `
      <div class="story-goal-caption">Meta acompanhando o faturamento por mês</div>
      <div class="story-goal-list story-goal-list--compact">
        ${months.map((part) => {
          const pct = part.pctMeta !== null ? fmtPct(part.pctMeta, 1) : 'sem meta';
          const visualPct = part.pctMeta ?? part.pctRealizado;
          const width = visualPct !== null ? Math.min(100, Math.max(3, visualPct * 100)) : 0;
          const state = part.pctMeta === null && visualPct !== null ? 'pending' : 'ok';
          return `
            <div class="story-goal-row story-goal-row--${escapeHtml(state)}">
              <div class="story-goal-row-head">
                <span>${escapeHtml(fmtMonthKey(part.month))} <small>${escapeHtml(fmtDateSlash(part.startIso))} a ${escapeHtml(fmtDateSlash(part.endIso))}</small></span>
                <strong>${escapeHtml(pct)}</strong>
              </div>
              <div class="story-goal-track" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></div>
              <em>${escapeHtml(`${fmtBRL(part.receita)} produto / meta do mês ${fmtBRL(part.target)}`)}</em>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function launchRevenueForMetaParts(launch, metaParts = [], field = 'actual') {
    const dateKey = `${field}Dates`;
    const validParts = (metaParts || []).filter((part) => (
      part
      && part[field] !== null
      && part[field] !== undefined
      && part.startIso
      && part.endIso
    ));
    if (!validParts.length) {
      return { receita: null, pedidos: null, pares: null, row: null };
    }
    const d0 = analysisDayZero(launch);
    const coverageDates = new Set();
    validParts.forEach((part) => {
      const dates = Array.isArray(part[dateKey]) && part[dateKey].length
        ? part[dateKey]
        : dateRangeIso(part.startIso, part.endIso);
      dates.forEach((date) => coverageDates.add(date));
    });
    const sortedDates = [...coverageDates].sort();
    const coverageStart = sortedDates[0] || validParts[0]?.startIso || null;
    const coverageEnd = sortedDates[sortedDates.length - 1] || validParts[validParts.length - 1]?.endIso || null;
    const coverageDays = sortedDates.length || validParts.reduce((acc, part) => acc + Number(part.days || 0), 0);
    const rows = optionalRows('lancamentos_produtos_dia').filter((row) => {
      if (row.modelo_id !== launch?.modelo_id || !row.data) return false;
      if (coverageDates.size) return coverageDates.has(row.data);
      return validParts.some((part) => row.data >= part.startIso && row.data <= part.endIso);
    });
    return aggregateLaunchSalesRows(rows, {
      start_day: coverageStart && d0 ? dayIndex(d0, coverageStart) : null,
      end_day: coverageEnd && d0 ? dayIndex(d0, coverageEnd) : null,
      coverage_start: coverageStart,
      coverage_end: coverageEnd,
      coverage_days: coverageDays,
      coverage_field: field
    });
  }

  function goalRowForWindow(launch, window, availableDay = null) {
    const d0 = analysisDayZero(launch);
    if (!d0) return null;
    const dataEndDay = availableDay === null ? window.endDay : Math.min(window.endDay, availableDay);
    const notStarted = dataEndDay < window.startDay;
    const observedStartDay = window.startDay;
    const observedEndDay = notStarted ? null : dataEndDay;
    const startIso = toIsoDate(addDays(d0, window.startDay));
    const plannedEndIso = toIsoDate(addDays(d0, window.endDay));
    const observedEndIso = observedEndDay !== null ? toIsoDate(addDays(d0, observedEndDay)) : null;
    const metaInfo = observedEndIso ? goalMetaForRange(startIso, observedEndIso, launch) : null;
    const target = metaInfo?.target ?? null;
    const actual = metaInfo?.actual ?? null;
    const fullSales = observedEndDay !== null
      ? launchRevenueForDayRange(launch, observedStartDay, observedEndDay)
      : { receita: null, pedidos: null, pares: null, row: null };
    const targetSales = metaInfo
      ? launchRevenueForMetaParts(launch, metaInfo.parts, 'target')
      : fullSales;
    const actualSales = metaInfo
      ? launchRevenueForMetaParts(launch, metaInfo.parts, 'actual')
      : fullSales;
    const comparableSales = actualSales.receita !== null
      ? actualSales
      : targetSales.receita !== null
        ? targetSales
        : fullSales;
    return {
      index: window.index,
      startDay: window.startDay,
      endDay: window.endDay,
      observedEndDay,
      startIso,
      endIso: observedEndIso || plannedEndIso,
      plannedEndIso,
      notStarted,
      complete: observedEndDay !== null && observedEndDay >= window.endDay,
      metaComplete: Boolean(metaInfo?.complete),
      metaDays: metaInfo?.targetDays ?? 0,
      totalDays: metaInfo?.totalDays ?? 0,
      metaParts: metaInfo?.parts || [],
      target,
      actual,
      receita: comparableSales.receita,
      pedidos: comparableSales.pedidos,
      pares: comparableSales.pares,
      receitaTotalObservada: fullSales.receita,
      pedidosTotalObservado: fullSales.pedidos,
      paresTotalObservado: fullSales.pares,
      pctMeta: ratioOrNull(targetSales.receita, target),
      pctRealizado: ratioOrNull(actualSales.receita, actual),
      sourceRow: comparableSales.row,
      observedSourceRow: fullSales.row
    };
  }

  function representationGoalRows(launch, limitDay = null) {
    const d0 = analysisDayZero(launch);
    if (!d0) return [];
    if (limitDay !== null && !getWindow(launch, selectedPeriodKey())) return [];
    const latestDay = latestLaunchDataDay(launch);
    const dPlus = numberOrNull(launch?.dPlus);
    const availableDay = [latestDay, dPlus].filter((value) => value !== null).reduce((acc, value) => (
      acc === null ? value : Math.min(acc, value)
    ), null);
    const cappedAvailableDay = limitDay === null
      ? availableDay
      : availableDay === null
        ? limitDay
        : Math.min(availableDay, limitDay);
    const windows = [
      { index: 1, startDay: 0, endDay: 30 },
      { index: 2, startDay: 31, endDay: 60 },
      { index: 3, startDay: 61, endDay: 90 }
    ];

    return windows
      .filter((window) => limitDay === null || window.startDay <= limitDay)
      .map((window) => goalRowForWindow(launch, window, cappedAvailableDay))
      .filter(Boolean);
  }

  function selectedGoalRow(launch) {
    if (!getWindow(launch, selectedPeriodKey())) return null;
    const requestedEndDay = selectedPeriodEndDay(launch);
    const endDay = selectedPeriodEndDay(launch);
    if (endDay === null) return null;
    const row = goalRowForWindow(launch, { index: 1, startDay: 0, endDay }, endDay);
    return row ? {
      ...row,
      requestedEndDay,
      selectedPeriodPartial: false
    } : null;
  }

  function goalDayLabel(day) {
    return day === 0 ? 'D0' : `D+${fmtNum(day)}`;
  }

  function goalRangeLabel(row) {
    if (!row) return '';
    const endDay = row.observedEndDay ?? row.endDay;
    const suffix = row.notStarted ? ' · não iniciado' : row.complete ? '' : ' · em curso';
    return `${goalDayLabel(row.startDay)}-${goalDayLabel(endDay)}${suffix}`;
  }

  function goalDateRangeLabel(row) {
    if (!row) return '';
    return `${fmtDateSlash(row.startIso)} a ${fmtDateSlash(row.endIso)}`;
  }

  function goalMetaLabel(row) {
    if (!row || row.target === null) return 'meta não carregada';
    const coverage = !row.metaComplete && row.metaDays && row.totalDays
      ? ` (${fmtNum(row.metaDays)}/${fmtNum(row.totalDays)} dias)`
      : '';
    return `${row.metaComplete ? 'meta' : 'meta parcial'}${coverage} ${fmtBRL(row.target)}`;
  }

  function goalCoverageNote(row) {
    if (!row || row.metaComplete || !row.metaDays || !row.totalDays) return '';
    const end = row.sourceRow?.coverage_end ? ` até ${fmtDateSlash(row.sourceRow.coverage_end)}` : '';
    return ` · comparável em ${fmtNum(row.metaDays)}/${fmtNum(row.totalDays)} dias${end}`;
  }

  function representationGoalSummary(rows, launch = null) {
    const first = rows[0];
    if (!first) return 'Meta mensal ainda não conectada para este lançamento.';
    const displayPct = goalDisplayPctMeta(first, launch);
    const monthBreakdown = goalMonthBreakdownText(first, launch);
    if (monthBreakdown && displayPct === null) {
      return `M1 ${goalRangeLabel(first)}: meta lida mês a mês, sem acumulado. ${monthBreakdown}.`;
    }
    if (displayPct !== null) {
      return `M1 ${goalRangeLabel(first)}: ${fmtPct(displayPct, 1)} da meta mensal${goalCoverageNote(first)}.`;
    }
    if (first.target === null) {
      return `M1 ${goalRangeLabel(first)}: meta ainda não carregada.`;
    }
    return `M1 ${goalRangeLabel(first)}: sem venda carregada contra a meta.`;
  }

  function storyGoalContributionHtml(rows = [], launch = null) {
    if (!rows.length) return '';
    return `
      <div class="story-goal-caption">Produto vs meta mensal desde D0</div>
      <div class="story-goal-list">
        ${rows.map((row) => {
          const hasMeta = row.target !== null;
          const hasSales = row.receita !== null;
          const displayPct = goalDisplayPctMeta(row, launch);
          const displayTarget = goalDisplayTarget(row, launch);
          const monthBreakdown = goalMonthBreakdownText(row, launch);
          const pctText = monthBreakdown && displayPct === null
            ? 'mês a mês'
            : displayPct !== null
            ? `${fmtPct(displayPct, 1)} da meta mensal`
            : row.notStarted
              ? 'não iniciado'
              : hasMeta
              ? 'sem venda'
              : 'sem meta';
          const rangeText = `${goalRangeLabel(row)} · ${goalDateRangeLabel(row)}`;
          const detail = monthBreakdown
            ? monthBreakdown
            : hasMeta
            ? `${fmtBRL(row.receita)} comparável / meta mensal ${fmtBRL(displayTarget ?? row.target)}${goalCoverageNote(row)}`
            : hasSales
              ? `${fmtBRL(row.receita)} vendido · meta não carregada`
              : row.notStarted
                ? `Janela prevista: ${goalDateRangeLabel(row)}`
                : 'meta não carregada';
          const visualPct = displayPct ?? row.pctRealizado;
          const width = visualPct !== null ? Math.min(100, Math.max(3, visualPct * 100)) : 0;
          const state = displayPct === null ? 'pending' : displayPct >= 0.12 ? 'focus' : 'ok';
          return `
            <div class="story-goal-row story-goal-row--${escapeHtml(state)}">
              <div class="story-goal-row-head">
                <span>M${fmtNum(row.index)} <small>${escapeHtml(rangeText)}</small></span>
                <strong>${escapeHtml(pctText)}</strong>
              </div>
              <div class="story-goal-track" aria-hidden="true"><i style="width:${width.toFixed(1)}%"></i></div>
              <em>${escapeHtml(detail)}</em>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function representationGoalEvidence(rows = [], launch = null) {
    if (!rows.length) return '';
    const summary = rows.map((row) => {
      const displayPct = goalDisplayPctMeta(row, launch);
      const pct = displayPct !== null ? fmtPct(displayPct, 1) : row.notStarted ? 'não iniciado' : 'mes_a_mes';
      const metaStatus = row.target === null ? 'sem meta' : row.metaComplete ? 'meta completa' : `meta parcial ${fmtNum(row.metaDays)}/${fmtNum(row.totalDays)} dias`;
      const observed = row.receitaTotalObservada !== null && row.receitaTotalObservada !== row.receita
        ? ` receita_total_observada=${fmtBRL(row.receitaTotalObservada)}`
        : '';
      const months = goalMonthBreakdownText(row, launch);
      return `M${row.index} ${goalRangeLabel(row)} ${goalDateRangeLabel(row)}: receita_comparavel=${fmtBRL(row.receita)}${observed} meta=${fmtBRL(row.target)} pct=${pct} (${metaStatus})${months ? ` meses=[${months}]` : ''}`;
    }).join(' | ');
    return `<code class="story-step-source">metas_mensais.json + lancamentos_produtos_dia.json → ${escapeHtml(summary)}</code>`;
  }

  function metaNarrative(meta, context = {}) {
    if (!meta) {
      return {
        label: 'Pendente',
        value: 'Sem meta',
        copy: 'Contrato esperado: mês, meta_receita e realizado_receita; modelo_id opcional.'
      };
    }
    const target = firstKnownCommercialNumber(meta, ['meta_receita', 'meta_faturamento', 'meta']);
    const actual = firstKnownCommercialNumber(meta, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']);
    const pct = roasNumberOrNull(meta.atingimento) ?? ratioOrNull(actual, target);
    const productShare = numberOrNull(context.launchShare);
    const shareCopy = productShare !== null ? ` \u00b7 share produto ${fmtPct(productShare, 1)}` : '';
    const launchMonth = context.launchD0 ? monthKeyFromIso(context.launchD0) : null;
    const metaMonth = meta ? metaMonthKey(meta) : null;
    const monthEnd = monthEndIso(metaMonth);
    const realizedUntil = String(meta?.realizado_ate || '').slice(0, 10);
    const dailyOpen = Array.isArray(meta?.daily) && meta.daily.length && realizedUntil && monthEnd && realizedUntil < monthEnd;
    const monthsAlign = meta && !meta.__meta_status && launchMonth && metaMonth && launchMonth === metaMonth;
    const launchRevenueValue = numberOrNull(context.launchRevenue);
    const contribution = monthsAlign && actual && launchRevenueValue !== null ? ratioOrNull(launchRevenueValue, actual) : null;
    const contributionCopy = contribution !== null
      ? ` \u00b7 seu lançamento respondeu por ${fmtPct(contribution, 1)} do realizado desse mês`
      : '';

    if (meta.__meta_status === 'month_open') {
      const requestedLabel = fmtMonthKey(meta.__requested_month);
      const fallbackLabel = fmtMonthKey(meta.__fallback_month || metaMonthKey(meta));
      const summary = pct !== null ? fmtPct(pct, 1) : fmtBRL(target);
      return {
        label: `${requestedLabel} em aberto`,
        value: 'M\u00eas em aberto',
        copy: `\u00daltimo fechado: ${fallbackLabel} \u00b7 ${summary} \u00b7 meta ${fmtBRL(target)} \u00b7 realizado ${fmtBRL(actual)}${shareCopy}${contributionCopy}`
      };
    }

    if (dailyOpen) {
      return {
        label: `${fmtMonthKey(metaMonth)} em andamento`,
        value: pct !== null ? fmtPct(pct, 1) : 'Mês em andamento',
        copy: `Até ${fmtDateSlash(realizedUntil)}: realizado ${fmtBRL(actual)} contra meta mensal ${fmtBRL(target)}${shareCopy}${contributionCopy}`
      };
    }

    return {
      label: metaMonthKey(meta) ? `Meta mensal da empresa \u2014 ${metaMonthKey(meta)}` : 'Meta mensal da empresa',
      value: pct !== null ? fmtPct(pct, 1) : fmtBRL(target),
      copy: `Meta ${fmtBRL(target)} \u00b7 realizado ${fmtBRL(actual)}${shareCopy}${contributionCopy}`
    };
  }

  function evidenceSourceLine(key, context = {}) {
    const specs = {
      momento: { file: 'share_trajetoria.json', row: context.model, fields: ['receita_empresa_pre_periodo', 'receita_empresa_pos_periodo', 'variacao_receita_empresa_pct'] },
      representatividade: { file: 'metas_mensais.json + lancamentos_produtos_dia.json', row: context.goalRow, fields: ['startIso', 'endIso', 'receita', 'actual', 'target'] },
      meta: { file: 'metas_mensais.json', row: context.metaRow, fields: ['meta_receita', 'realizado_receita', 'atingimento'] },
      atividade: { file: 'lancamentos_produtos_dia.json', row: context.activityRow, fields: ['activity_day', 'data_day', 'receita', 'pedidos', 'pares'] },
      campanha: { file: 'faturamento_campanha.json', row: (context.campaignRows || [])[0] || null, fields: ['receita_atribuida', 'investimento', 'pedidos'] }
    };
    const spec = specs[key];
    if (!spec) return '';
    if (!spec.row) return `<code class="story-step-source">${escapeHtml(spec.file)} \u2192 sem linha carregada</code>`;
    const raw = spec.fields
      .map((field) => `${field}=${spec.row[field] === undefined || spec.row[field] === null ? 'null' : spec.row[field]}`)
      .join(' \u00b7 ');
    const extra = key === 'campanha' && context.campaignRows && context.campaignRows.length > 1
      ? ` (+${context.campaignRows.length - 1} linha(s))`
      : '';
    return `<code class="story-step-source">${escapeHtml(spec.file)} \u2192 ${escapeHtml(raw)}${escapeHtml(extra)}</code>`;
  }

  function storyEvidenceCopy(text) {
    return `<span class="story-evidence-copy">${escapeHtml(text || 'Leitura ainda em construcao para esta janela.')}</span>`;
  }

  function executiveEvidenceSourceLine(key, context = {}) {
    const specs = {
      momento: { file: 'metas_mensais.json + lancamentos_produtos_dia.json', row: context.company || context.model, copy: 'cruza faturamento/meta da empresa com a receita do produto no mesmo período.' },
      representatividade: { file: 'metas_mensais.json + lancamentos_produtos_dia.json', row: context.goalRow, copy: 'calcula produto vs meta mensal por M1, M2 e M3 desde o lançamento.' },
      meta: { file: 'metas_mensais.json', row: context.metaRow, copy: 'traz meta total do mes, realizado da empresa e atingimento.' },
      atividade: { file: 'lancamentos_produtos_dia.json', row: context.activityRow, copy: 'traz faturamento, pedidos e pares do produto na janela selecionada.' }
    };
    const spec = specs[key];
    if (!spec) return '';
    const status = spec.row ? spec.copy : 'recorte ainda não carregado para esta janela.';
    return `<div class="story-source-note story-source-note--compact"><span>Fonte usada</span><p>${escapeHtml(spec.file)}: ${escapeHtml(status)}</p></div>`;
  }

  function representationGoalExecutiveEvidence(rows = [], launch = null) {
    if (!rows.length) {
      return '<div class="story-source-note story-source-note--compact"><span>Leitura</span><p>Meta mensal ainda não conectada para esta janela; mantenha a decisão pela curva, atividade e ranking do grupo comparativo.</p></div>';
    }
    const summary = rows.map((row) => {
      const displayPct = goalDisplayPctMeta(row, launch);
      const pct = displayPct !== null ? fmtPct(displayPct, 1) : row.notStarted ? 'não iniciado' : 'mês a mês';
      const metaStatus = row.target === null ? 'sem meta' : row.metaComplete ? 'meta completa' : `meta parcial (${fmtNum(row.metaDays)}/${fmtNum(row.totalDays)} dias)`;
      return `M${row.index}: ${pct}, ${fmtBRL(row.receita)} do produto, ${metaStatus}`;
    }).join(' | ');
    return `<div class="story-source-note story-source-note--compact"><span>Leitura</span><p>${escapeHtml(summary)}</p></div>`;
  }

  function campaignRevenueRowsForLaunch(launch) {
    return optionalRows('faturamento_campanha').filter((row) => {
      const rowModel = String(row.modelo_id || '').trim();
      return !rowModel || rowModel === launch?.modelo_id;
    });
  }

  function campaignRevenueValue(row) {
    return firstKnownCommercialNumber(row, [
      'receita_atribuida',
      'receita',
      'faturamento',
      'faturamento_campanha',
      'receita_campanha'
    ]);
  }

  function campaignRevenueForMedia(row, launch) {
    const campaign = normalizeText(row?.campanha);
    if (!campaign) return null;
    const channel = normalizeText(row?.canal);
    const windowKey = commercialWindowKey(row);
    const month = monthKeyFromIso(row?.data_inicio || row?.data_fim || launch?.d0);

    return campaignRevenueRowsForLaunch(launch)
      .map((candidate) => {
        const candidateCampaign = normalizeText(candidate.campanha || candidate.campaign || candidate.utm_campaign);
        if (!candidateCampaign || candidateCampaign !== campaign) return null;
        let score = 10;
        const candidateChannel = normalizeText(candidate.canal || candidate.channel || candidate.source_medium);
        const candidateWindow = commercialWindowKey(candidate);
        const candidateMonth = monthKeyFromIso(candidate.data_inicio || candidate.data_fim || candidate.data || candidate.mes);
        if (channel && candidateChannel && candidateChannel === channel) score += 2;
        if (windowKey && candidateWindow && candidateWindow === windowKey) score += 2;
        if (month && candidateMonth && candidateMonth === month) score += 1;
        return { candidate, score };
      })
      .filter(Boolean)
      .sort((a, b) => b.score - a.score)[0]?.candidate || null;
  }

  function campaignNarrative(launch) {
    const rows = campaignRevenueRowsForLaunch(launch);
    if (!rows.length) {
      return {
        label: 'Pendente',
        value: 'Sem campanha',
        copy: 'Contrato esperado: modelo_id, campanha, canal, receita_atribuida, pedidos e janela.'
      };
    }
    const revenue = rows
      .map(campaignRevenueValue)
      .filter((value) => value !== null)
      .reduce((acc, value) => acc + value, 0);
    const campaigns = new Set(rows.map((row) => normalizeText(row.campanha || row.campaign || row.utm_campaign)).filter(Boolean));
    return {
      label: `${fmtNum(rows.length)} linha(s)`,
      value: fmtBRL(revenue),
      copy: `${fmtNum(campaigns.size || rows.length)} campanha(s) com faturamento atribuido`
    };
  }

  function launchActivityNarrative(launch, selectedWindow = {}) {
    const specificPeriod = isSpecificAnalysisPeriod();
    const requestedEndDay = specificPeriod ? selectedPeriodEndDay(launch) : null;
    const partialCurrent = specificPeriod && !selectedWindow.data
      ? (launch?.acumulado_lancamento || launch?.acumulado_atual || null)
      : null;
    const current = selectedWindow.data || partialCurrent || (!specificPeriod ? (launch?.acumulado_lancamento || launch?.acumulado_atual) : null);
    const activityDay = numberOrNull(current?.activity_day) ?? numberOrNull(launch?.dPlus) ?? numberOrNull(current?.day);
    const dataDay = numberOrNull(current?.data_day) ?? numberOrNull(current?.day);
    const fixedEndDay = requestedEndDay;
    const displayedEndDay = selectedWindow.data ? fixedEndDay : dataDay;
    const daysActive = specificPeriod
      ? (current && displayedEndDay !== null ? Math.max(1, displayedEndDay + 1) : null)
      : activityDay !== null ? Math.max(1, activityDay + 1) : null;
    const receita = numberOrNull(current?.receita);
    const pedidos = numberOrNull(current?.pedidos);
    const pares = numberOrNull(current?.pares);
    const sourceLabel = specificPeriod
      ? selectedWindow.data
        ? `D0 a ${selectedWindow.label || selectedPeriodLabel()}`
        : displayedEndDay !== null
          ? `Parcial D0 a D+${fmtNum(Math.max(0, displayedEndDay))}`
          : `D0 a ${selectedWindow.label || selectedPeriodLabel()}`
      : activityDay !== null ? `D0 a D+${Math.max(0, activityDay)}` : (selectedWindow.label || 'janela disponível');
    const partialData = dataDay !== null && activityDay !== null && dataDay < activityDay;
    const maturingWindow = specificPeriod && !selectedWindow.data;
    const dataCoverageCopy = partialData ? ` Dados de venda disponíveis até D+${fmtNum(Math.max(0, dataDay))}.` : '';
    const maturingCopy = maturingWindow && (receita !== null || pedidos !== null)
      ? `A janela de ${selectedPeriodLabel()} ainda não fechou para esta linha. Mostrando o acumulado parcial de D0 até D+${fmtNum(Math.max(0, displayedEndDay ?? dataDay ?? 0))}: ${fmtBRL(receita)} de faturamento e ${fmtNum(pedidos)} pedidos.${dataCoverageCopy}`
      : null;
    const facts = [
      { label: 'Dias ativo', value: daysActive !== null ? fmtNum(daysActive) : (maturingWindow ? 'em maturação' : 'sem dado') },
      { label: 'Faturamento', value: fmtBRL(receita) },
      { label: 'Pedidos', value: fmtNum(pedidos) }
    ];
    if (pares !== null) facts.push({ label: 'Pares', value: fmtNum(pares) });
    if (maturingWindow && displayedEndDay !== null) facts.push({ label: 'Parcial até', value: `D+${fmtNum(Math.max(0, displayedEndDay))}` });
    else if (partialData) facts.push({ label: 'Dados até', value: `D+${fmtNum(Math.max(0, dataDay))}` });
    return {
      label: sourceLabel,
      value: daysActive !== null && maturingWindow
        ? `${fmtNum(daysActive)} dia${daysActive === 1 ? '' : 's'} parciais`
        : daysActive !== null ? `${fmtNum(daysActive)} dia${daysActive === 1 ? '' : 's'}` : (maturingWindow ? 'Em maturação' : 'Sem atividade'),
      copy: receita !== null || pedidos !== null
        ? (maturingCopy || `${specificPeriod ? 'Na janela selecionada' : 'Desde o lançamento'}: ${fmtBRL(receita)} de faturamento e ${fmtNum(pedidos)} pedidos.${dataCoverageCopy}`)
        : maturingWindow
          ? `A janela de ${selectedPeriodLabel()} ainda não fechou para esta linha. Isso é esperado em lançamento novo; acompanhe a janela menor disponível e volte quando o produto completar o marco.`
          : 'Ainda sem acumulado de atividade para esta janela.',
      facts,
      row: current ? { ...current, activity_day: activityDay, data_day: dataDay } : null,
      state: receita !== null || pedidos !== null ? 'ok' : 'pending'
    };
  }

  function companyMomentNarrative(model) {
    const variation = numberOrNull(model?.variacao_receita_empresa_pct);
    const pre = numberOrNull(model?.receita_empresa_pre_periodo);
    const pos = numberOrNull(model?.receita_empresa_pos_periodo);
    const days = numberOrNull(model?.dias_pos_disponiveis);
    if (variation === null && pre === null && pos === null) {
      return {
        label: 'Sem contexto',
        value: 'Sem contexto',
        copy: 'Ainda não há leitura antes/depois da empresa para separar efeito do lançamento do contexto geral.',
        evidence: 'share_trajetoria ainda não trouxe a leitura antes/depois da empresa.',
        state: 'pending',
        facts: []
      };
    }
    const baselineInsuficiente = pre !== null && pos !== null && pre < Math.max(1000, pos * 0.01);
    if (baselineInsuficiente) {
      return {
        label: 'Sem base comparável',
        value: fmtBRL(pos),
        copy: 'Não conclua aceleração da empresa por esse percentual. A essência aqui é qualidade/contexto: o período anterior está baixo demais para sustentar comparação, então o lançamento deve ser lido por representatividade, mix e curva.',
        evidence: `${fmtBRL(pre)} antes · ${fmtBRL(pos)} depois${days !== null ? ` · ${fmtNum(days)} dias` : ''} - período anterior sem receita suficiente para calcular variação.`,
        state: 'warn',
        baselineInsuficiente: true,
        facts: [
          { label: 'Empresa antes', value: fmtBRL(pre) },
          { label: 'Empresa depois', value: fmtBRL(pos) },
          { label: 'Janela comp.', value: days !== null ? `${fmtNum(days)} dias` : 'sem janela' }
        ]
      };
    }
    const direction = variation > 0.05 ? 'Empresa acelerando' : variation < -0.05 ? 'Empresa pressionada' : 'Empresa estável';
    const essence = variation > 0.05
      ? 'Contexto favorável: a empresa cresceu no entorno do lançamento, então parte da rampa pode vir do momento geral e não só do produto.'
      : variation < -0.05
        ? 'Contexto pressionado: se o lançamento performou bem, ele pode ter compensado queda geral ou deslocado receita interna.'
        : 'Contexto neutro: a empresa ficou relativamente estável, então a leitura do lançamento tende a depender mais de curva, mix e canal.';
    return {
      label: direction,
      value: fmtPct(variation, 1),
      copy: essence,
      evidence: `${fmtBRL(pre)} antes · ${fmtBRL(pos)} depois${days !== null ? ` · ${fmtNum(days)} dias` : ''}`,
      state: variation < -0.05 ? 'warn' : variation > 0.05 ? 'focus' : 'ok',
      baselineInsuficiente: false,
      facts: [
        { label: 'Empresa antes', value: fmtBRL(pre) },
        { label: 'Empresa depois', value: fmtBRL(pos) },
        { label: 'Var. empresa', value: fmtPct(variation, 1) }
      ]
    };
  }

  function companyGoalMomentNarrative(launch, model, goalRows = []) {
    const base = companyMomentNarrative(model);
    const firstGoal = goalRows[0];
    const range = firstGoal ? `${goalRangeLabel(firstGoal)} (${goalDateRangeLabel(firstGoal)})` : 'M1 desde D0';
    const months = firstGoal ? meaningfulGoalMonths(firstGoal, launch) : [];
    const focusMonth = [...months].reverse().find((part) => (
      part.target !== null || part.actual !== null || part.receita !== null
    ));
    const multiMonth = months.length > 1;
    const goalMonth = monthKeyFromIso(focusMonth?.month || firstGoal?.startIso || launch?.d0 || snapshotIso());
    const monthlyLabel = fmtMonthKey(goalMonth);
    const target = numberOrNull(focusMonth ? focusMonth.target : firstGoal?.target);
    const actual = numberOrNull(focusMonth ? focusMonth.actual : firstGoal?.actual);
    const revenue = numberOrNull(focusMonth ? focusMonth.receita : firstGoal?.receita);
    const companyPct = ratioOrNull(actual, target);
    const productMetaPct = ratioOrNull(revenue, target);
    const productActualPct = ratioOrNull(revenue, actual);
    const comparableNote = firstGoal && !firstGoal.metaComplete && firstGoal.metaDays && firstGoal.totalDays
      ? ` Como a meta/realizado só existem para ${fmtNum(firstGoal.metaDays)}/${fmtNum(firstGoal.totalDays)} dias dessa janela, o produto também foi somado apenas na mesma cobertura comparável.`
      : '';
    const selectedPartialNote = firstGoal?.selectedPeriodPartial
      ? ` ${selectedPeriodLabel()} foi selecionado, mas o snapshot do produto só tem dados até ${goalDayLabel(firstGoal.observedEndDay)}; a leitura usa essa cobertura disponível.`
      : '';
    const monthModeNote = multiMonth
      ? ` A janela cruza ${fmtNum(months.length)} meses; por isso a meta não é acumulada. O número principal usa ${monthlyLabel}, o mês mais recente com dado na janela, e a quebra abaixo mostra cada mês separado.`
      : ` A leitura usa ${monthlyLabel}: faturamento da empresa contra a meta total do mês, com o produto como participação.`;
    const monthBreakdown = firstGoal ? goalMonthBreakdownHtml(firstGoal, launch) : '';
    const monthBreakdownEvidence = firstGoal ? goalMonthBreakdownText(firstGoal, launch) : '';
    const source = 'Origem: metas_mensais.json informa a meta total e o faturamento realizado da empresa por mês; quando existe detalhe diário, ele vem de dashboard_targets_daily_raw no SSOT. lancamentos_produtos_dia.json calcula a receita do produto no mesmo recorte.';

    if (!firstGoal || (target === null && actual === null)) {
      return {
        label: 'Meta do mês não carregada',
        value: 'Sem meta',
        copy: `${range}: este card compara faturamento realizado da empresa contra a meta mensal que acompanha o faturamento do produto. Como a meta/faturamento do mês ainda não está carregada, só dá para mostrar a receita do produto: ${fmtBRL(revenue)}.${monthModeNote}${selectedPartialNote}`,
        label: revenue !== null ? 'Lançamento em acompanhamento' : 'Janela em maturação',
        value: revenue !== null ? 'Acompanhar' : 'Em maturação',
        copy: revenue !== null
          ? `${range}: a venda do produto já entrou no painel (${fmtBRL(revenue)}), mas a meta/faturamento da empresa para este recorte ainda não fechou. Use como acompanhamento, não como conclusão de eficiência.`
          : `${range}: a janela ainda está amadurecendo. Assim que houver venda e meta do período, este card mostra faturamento da empresa vs meta e a participação do produto.`,
        evidence: `${source} meses=[${monthBreakdownEvidence}] ${base.evidence || ''}`,
        source,
        state: revenue !== null ? 'pending' : 'warn',
        facts: [
          { label: 'Período', value: range },
          { label: 'Receita produto', value: fmtBRL(revenue) },
          { label: 'Mês base', value: monthlyLabel },
          { label: 'Fat. empresa mês', value: 'sem dado' },
          { label: 'Meta mês', value: 'sem meta' }
        ],
        extraHtml: monthBreakdown
      };
    }

    if (target === null && actual !== null) {
      return {
        label: 'Meta do mês não carregada',
        value: 'Sem meta',
        copy: `${range}: em ${monthlyLabel}, a empresa faturou ${fmtBRL(actual)}, mas a meta mensal ainda não está carregada. O produto entra como participação no realizado: fez ${fmtBRL(revenue)} e representou ${fmtPct(productActualPct, 1)} do faturamento da empresa.${monthModeNote}${comparableNote}${selectedPartialNote}`,
        evidence: `${source} mes_base=${monthlyLabel} empresa_realizado=${fmtBRL(actual)} meta=sem_meta produto=${fmtBRL(revenue)} share_produto=${fmtPct(productActualPct, 1)} meses=[${monthBreakdownEvidence}]. ${base.evidence || ''}`,
        source,
        state: 'pending',
        facts: [
          { label: 'Mês base', value: monthlyLabel },
          { label: 'Fat. empresa mês', value: fmtBRL(actual) },
          { label: 'Meta mês', value: 'sem meta' },
          { label: 'Share produto', value: fmtPct(productActualPct, 1) },
          { label: 'Receita produto', value: fmtBRL(revenue) }
        ],
        extraHtml: monthBreakdown
      };
    }

    if (target !== null && actual === null) {
      return {
        label: 'Faturamento empresa pendente',
        value: 'Sem realizado',
        copy: `${range}: a meta total de ${monthlyLabel} é ${fmtBRL(target)}, mas o faturamento realizado da empresa ainda não está carregado. Sem realizado da empresa, o share de participação do produto ainda não pode ser calculado.${monthModeNote}${comparableNote}${selectedPartialNote}`,
        evidence: `${source} mes_base=${monthlyLabel} meta_mes=${fmtBRL(target)} meses=[${monthBreakdownEvidence}]. ${base.evidence || ''}`,
        source,
        state: 'pending',
        facts: [
          { label: 'Mês base', value: monthlyLabel },
          { label: 'Fat. empresa mês', value: 'sem dado' },
          { label: 'Meta mês', value: fmtBRL(target) },
          { label: 'Receita produto', value: fmtBRL(revenue) },
          { label: 'Share produto', value: 'sem realizado' }
        ],
        extraHtml: monthBreakdown
      };
    }

    const companyLabel = companyPct >= 1
      ? 'Empresa acima da meta'
      : companyPct >= 0.9
        ? 'Empresa perto da meta'
        : 'Empresa abaixo da meta';
    const companyState = companyPct < 0.9 ? 'warn' : companyPct >= 1 ? 'focus' : 'ok';
    const metaGap = actual !== null && target !== null ? actual - target : null;
    const productSentence = revenue !== null
      ? `O produto selecionado entra como participação: fez ${fmtBRL(revenue)} em ${monthlyLabel}, representou ${fmtPct(productActualPct, 1)} do faturamento realizado e equivaleu a ${fmtPct(productMetaPct, 1)} da meta do mês.`
      : 'Ainda não há receita do produto carregada nessa janela.';

    return {
      label: companyLabel,
      value: fmtPct(companyPct, 1),
      copy: `${range}: momento da empresa = faturamento realizado contra a meta total do mês em que o faturamento do produto está sendo lido.${monthModeNote} Em ${monthlyLabel}, a empresa realizou ${fmtBRL(actual)} de ${fmtBRL(target)} (${fmtPct(companyPct, 1)}), com gap de ${fmtBRL(metaGap)}. ${productSentence}${comparableNote}${selectedPartialNote}`,
      evidence: `${source} mes_base=${monthlyLabel} empresa_realizado_mes=${fmtBRL(actual)} meta_mes=${fmtBRL(target)} atingimento_mes=${fmtPct(companyPct, 1)} gap_mes=${fmtBRL(metaGap)} produto_mes=${fmtBRL(revenue)} share_produto_mes=${fmtPct(productActualPct, 1)} meses=[${monthBreakdownEvidence}]. ${base.evidence || ''}`,
      source,
      state: companyState,
      facts: [
        { label: 'Mês base', value: monthlyLabel },
        { label: 'Fat. empresa mês', value: fmtBRL(actual) },
        { label: 'Meta mês', value: fmtBRL(target) },
        { label: 'Gap mês', value: fmtBRL(metaGap) },
        { label: 'Share produto', value: fmtPct(productActualPct, 1) },
        { label: 'Receita produto', value: fmtBRL(revenue) }
      ],
      extraHtml: monthBreakdown
    };
  }

  function boundedPct(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, num));
  }

  function storySignal({ share, companyVariation, metaPending }) {
    if (share === null) {
      return {
        state: 'pending',
        title: 'Leitura em construção',
        copy: 'Falta share_trajetoria para transformar a leitura em decisão executiva.',
        question: 'Qual é o peso real no faturamento?'
      };
    }
    if (companyVariation !== null && companyVariation < -0.05 && share >= 0.08) {
      return {
        state: 'warn',
        title: 'Peso relevante em empresa pressionada',
        copy: 'O lançamento aparece material, mas precisa ser lido contra a queda ou pressão do faturamento total.',
        question: 'Compensou o contexto ou deslocou receita interna?'
      };
    }
    if (share >= 0.12) {
      return {
        state: 'focus',
        title: 'Lançamento com peso executivo',
        copy: 'A representatividade já é suficiente para orientar leitura de curva, mix e canal.',
        question: 'Como preservar a rampa sem canibalizar a linha?'
      };
    }
    if (metaPending) {
      return {
        state: 'pending',
        title: 'Sinal comercial incompleto',
        copy: 'O dado de venda existe, mas a meta ainda limita a leitura de eficiência.',
        question: 'O desempenho está acima da expectativa planejada?'
      };
    }
    return {
      state: 'ok',
      title: 'Sinal em acompanhamento',
      copy: 'A leitura está suficiente para acompanhamento, mas ainda pede comparação por janela e mix.',
      question: 'O ritmo sustenta as próximas janelas?'
    };
  }

  function storyFactChips(items = []) {
    const validItems = items.filter((item) => item && item.value !== undefined && item.value !== null);
    if (!validItems.length) return '';
    return `
      <div class="story-visual-facts">
        ${validItems.map((item) => `
          <i>
            <span>${escapeHtml(item.label)}</span>
            <b>${escapeHtml(item.value)}</b>
          </i>
        `).join('')}
      </div>
    `;
  }

  function storySourceNote(text) {
    if (!text) return '';
    return `<div class="story-source-note"><span>Origem</span><p>${escapeHtml(text)}</p></div>`;
  }

  function storyMetricHtml({ label, value, detail, width, state = 'ok', tooltip = '', extraHtml = '', showTrack = true }) {
    const rawWidth = boundedPct(width);
    const visualWidth = rawWidth > 0 ? rawWidth : state === 'pending' ? 8 : 0;
    return `
      <div class="story-visual-metric story-visual-metric--${escapeHtml(state)}">
        <div class="story-visual-metric-head">
          ${labelTip(label, tooltip)}
          <strong>${escapeHtml(value)}</strong>
        </div>
        ${showTrack ? `<div class="story-visual-track" aria-hidden="true"><i style="width:${visualWidth.toFixed(1)}%"></i></div>` : ''}
        <p>${escapeHtml(detail)}</p>
        ${extraHtml}
      </div>
    `;
  }

  function selectedPeriodShareForLaunch(launch) {
    return selectedPeriodShareContext(launch).share;
  }

  function selectedPeriodShareContext(launch) {
    const range = launchWindowRangeLabel(launch, selectedPeriodKey());
    const window = getWindow(launch, selectedPeriodKey());
    if (!window) {
      return {
        launch,
        share: null,
        range,
        status: `sem ${selectedPeriodLabel()} fechado`,
        detail: 'janela ainda não fechada'
      };
    }
    const goalRow = selectedGoalRow(launch);
    const productRevenue = numberOrNull(goalRow?.receita);
    const companyRevenue = numberOrNull(goalRow?.actual);
    const share = ratioOrNull(productRevenue, companyRevenue);
    const status = share !== null
      ? range
      : productRevenue === null
        ? 'sem receita do produto na janela'
        : companyRevenue === null
          ? 'sem faturamento da empresa na janela'
          : 'share não calculável';
    return {
      launch,
      share,
      range,
      status,
      detail: share !== null
        ? `${fmtBRL(productRevenue)} produto / ${fmtBRL(companyRevenue)} empresa`
        : status,
      goalRow
    };
  }

  function sortShareContexts(rows) {
    return rows.slice().sort((a, b) => {
      if (a.share !== null && b.share !== null) return b.share - a.share;
      if (a.share !== null) return -1;
      if (b.share !== null) return 1;
      return (a.launch?.order ?? 0) - (b.launch?.order ?? 0);
    });
  }

  function attributionForSelectedPeriod(launch) {
    const data = selectedAnalysisWindow(launch).data || {};
    return {
      receita_organica: numberOrNull(data.receita_organica),
      receita_paga: numberOrNull(data.receita_paga),
      pedidos_organicos: numberOrNull(data.pedidos_organicos),
      pedidos_pagos: numberOrNull(data.pedidos_pagos)
    };
  }

  function historicalShareUniverse(selected) {
    const byId = new Map();
    [selected, ...selectedCompareLaunches()].filter(Boolean).forEach((launch) => {
      if (!isEligibleLaunch(launch) || isPlannedStatus(launch.status)) return;
      byId.set(launch.modelo_id, launch);
    });
    return { launches: [...byId.values()] };
  }

  function renderStoryBrief(selected) {
    const wrap = $('story-brief');
    if (!wrap || !selected) return;

    const model = shareModelForLine(selected.modelo_id);
    const selectedWindow = selectedAnalysisWindow(selected);
    const metaRow = metaMensalForLaunch(selected);
    const selectedShare = selectedPeriodShareForLaunch(selected);
    const share = selectedShare;
    const launchRevenue = numberOrNull(selectedWindow.data?.receita);
    const meta = metaNarrative(metaRow, { launchShare: share, launchRevenue, launchD0: selected.d0 });
    const periodLimitDay = isSpecificAnalysisPeriod() ? selectedPeriodEndDay(selected) : null;
    const goalRows = representationGoalRows(selected, periodLimitDay);
    const companyGoal = selectedGoalRow(selected);
    const company = companyGoalMomentNarrative(selected, model, companyGoal ? [companyGoal] : goalRows);
    const firstGoal = companyGoal || goalRows[0];
    const firstGoalPct = firstGoal ? numberOrNull(goalDisplayPctMeta(firstGoal, selected)) : null;
    const firstGoalMonthText = firstGoal ? goalMonthBreakdownText(firstGoal, selected) : '';
    const representationPartialNote = firstGoal?.selectedPeriodPartial ? `; dados até ${goalDayLabel(firstGoal.observedEndDay)}` : '';
    const representationValue = firstGoalPct !== null ? fmtPct(firstGoalPct, 1) : firstGoalMonthText ? 'Mês a mês' : firstGoal ? 'Sem meta' : fmtPct(share, 1);
    const representationDetail = firstGoal
      ? `${selectedPeriodLabel()} ${goalRangeLabel(firstGoal)}${representationPartialNote}: ${firstGoalPct !== null ? `${fmtPct(firstGoalPct, 1)} da meta mensal` : firstGoalMonthText ? 'meta aberta mês a mês, sem acumulado' : 'sem meta'}. Share da própria janela: ${fmtPct(share, 1)}.`
      : `${representationGoalSummary(goalRows, selected)} Share da própria janela: ${fmtPct(share, 1)}.`;
    const activity = launchActivityNarrative(selected, selectedWindow);
    const companyVariation = numberOrNull(model?.variacao_receita_empresa_pct);
    const metaTarget = firstKnownCommercialNumber(metaRow, ['meta_receita', 'meta_faturamento', 'meta']);
    const metaActual = firstKnownCommercialNumber(metaRow, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']);
    const metaPct = roasNumberOrNull(metaRow?.atingimento) ?? ratioOrNull(metaActual, metaTarget);
    const metaPending = meta.label === 'Pendente';
    const metaOpen = metaRow?.__meta_status === 'month_open'
      || (Array.isArray(metaRow?.daily) && metaRow.daily.length && metaRow.realizado_ate && monthEndIso(metaMonthKey(metaRow)) && String(metaRow.realizado_ate).slice(0, 10) < monthEndIso(metaMonthKey(metaRow)));
    const signal = storySignal({ share, companyVariation, metaPending });
    const companyWidth = companyVariation === null ? 0 : Math.max(6, Math.min(100, (Math.abs(companyVariation) / 0.22) * 100));
    const shareWidth = share === null ? 0 : Math.max(4, Math.min(100, share * 100));
    const metaWidth = metaPct === null ? shareWidth : Math.max(4, Math.min(100, metaPct * 100));
    const historicalUniverse = historicalShareUniverse(selected);
    const rankWindowLabel = `cada modelo na própria data de lançamento -> ${selectedPeriodLabel()}`;
    const comparisonRows = sortShareContexts(historicalUniverse.launches.map(selectedPeriodShareContext));
    const rankableRows = comparisonRows.filter((row) => row.share !== null);
    const rank = rankableRows.findIndex((row) => row.launch.modelo_id === selected.modelo_id) + 1;
    const rankCopy = rank > 0
      ? `${fmtNum(rank)}º de ${fmtNum(rankableRows.length)} com share calculável no grupo comparativo (${rankWindowLabel})`
      : 'A linha aparece no grupo comparativo, mas ainda não tem share calculável nessa janela.';
    let visibleRank = 0;
    const allShareHtml = comparisonRows.length
      ? `
        <div class="story-top-caption">Todas as linhas · share por janela própria · ${escapeHtml(rankWindowLabel)}</div>
        <ol class="story-top-list" aria-label="Todas as linhas comparadas por representatividade isolada">
          ${comparisonRows.map((row) => {
            const hasShare = row.share !== null;
            const rankLabel = hasShare ? `${fmtNum(++visibleRank)}º` : '—';
            return `
              <li class="${row.launch.modelo_id === selected.modelo_id ? 'is-selected' : ''} ${hasShare ? '' : 'is-missing'}">
                <b>${escapeHtml(rankLabel)}</b>
                <span class="story-top-name" title="${escapeHtml(`${row.launch.modelo} · ${row.range} · ${row.detail}`)}">${escapeHtml(row.launch.modelo)}<small>${escapeHtml(row.range)} · ${escapeHtml(row.detail)}</small></span>
                <em>${hasShare ? escapeHtml(fmtPct(row.share, 1)) : escapeHtml(row.status)}</em>
              </li>
            `;
          }).join('')}
        </ol>
      `
      : '<div class="story-empty-note">Ranking comparativo depende de receita do produto e faturamento da empresa na janela própria de cada lançamento.</div>';
    const thesis = share !== null
      ? `${selected.modelo} representou ${fmtPct(share, 1)} da receita da Reise na sua janela ${selectedPeriodLabel()} e aparece ${rank > 0 ? `${fmtNum(rank)}º de ${fmtNum(rankableRows.length)}` : 'sem ranking'} entre as linhas com share calculavel.`
      : `${selected.modelo} ainda não tem leitura de representatividade carregada para ${selectedPeriodLabel()} no grupo comparativo.`;
    const storyIntroTooltip = 'Esta visão transforma dados dos lançamentos em narrativa executiva comparativa. Ela responde como a linha destacada performou contra o grupo comparativo na mesma idade de venda, qual contexto de empresa/calendário existia no nascimento e qual recorte investigar em seguida.';
    const centralQuestionTooltip = 'Pergunta de decisão que guia a leitura. Ela muda conforme representatividade, variação da empresa, meta mensal e atividade acumulada desde D0.';
    const activityTooltip = 'Resumo operacional da janela selecionada. Mostra se a linha destacada já tem dado suficiente para comparar faturamento, pedidos e pares contra as demais.';
    const representationGoalHtml = storyGoalContributionHtml(goalRows, selected);
    const evidence = [
      storyMetricHtml({
        label: 'Representatividade vs meta',
        value: representationValue,
        detail: representationDetail,
        width: firstGoalPct !== null ? firstGoalPct * 100 : shareWidth,
        state: firstGoalPct === null ? 'pending' : firstGoalPct >= 0.12 ? 'focus' : 'ok',
        tooltip: 'Mostra quanto o produto cobriu da meta mensal nas janelas M1 D0-D+30, M2 D+31-D+60 e M3 D+61-D+90. Quando a janela cruza meses, a meta aparece mês a mês, sem acumulado.',
        extraHtml: representationGoalHtml
      }),
      storyMetricHtml({
        label: 'Momento da empresa vs meta',
        value: company.value,
        detail: `${company.label}: ${company.copy}`,
        width: companyWidth,
        state: company.state || (companyVariation !== null && companyVariation < -0.05 ? 'warn' : 'ok'),
        tooltip: 'Mostra como a empresa está contra a meta no período do produto selecionado. O produto entra como participação no faturamento realizado.',
        extraHtml: `${storyFactChips(company.facts)}${company.extraHtml || ''}${storySourceNote('Meta mensal da empresa + vendas do produto no mesmo recorte. A comparação usa o mês/período do lançamento, não uma meta acumulada artificial.')}`,
        showTrack: false
      }),
      storyMetricHtml({
        label: 'Meta mensal da empresa',
        value: meta.value,
        detail: meta.copy,
        width: metaWidth,
        state: metaPending ? 'pending' : metaOpen ? 'warn' : 'ok',
        tooltip: 'Cruza o mês do lançamento com metas_mensais. Quando o BigQuery exporta detalhe diário de targets, mês aberto usa a meta publicada dia a dia; sem esse dado, mostra o último mês fechado como contexto.'
      })
    ];
    const decisionNotes = [
      {
        title: 'Onde olhar primeiro',
        tooltip: 'Indica o próximo recorte que mais reduz incerteza: curva, mix por cor/submodelo, canal ou comparativo histórico.',
        copy: share !== null && share >= 0.08
          ? 'Abrir representatividade, mix por cor/submodelo e canal para entender o que carregou a receita.'
          : 'Comparar a curva com os lançamentos históricos antes de tratar o sinal como material.'
      },
      {
        title: 'Risco executivo',
        tooltip: 'Aponta a principal armadilha de interpretação. Exemplo: achar que o lançamento cresceu a empresa quando ele pode só ter deslocado receita interna.',
        copy: companyVariation !== null && companyVariation < -0.05
          ? 'Separar crescimento real de possível deslocamento interno em uma empresa pressionada.'
          : 'Confirmar se o lançamento está acelerando a empresa ou apenas seguindo o contexto.'
      },
      {
        title: 'Próximo passo',
        tooltip: 'Mostra o melhor próximo recorte depois de entender atividade desde D0, representatividade e contexto da empresa.',
        copy: metaOpen
          ? 'Meta do mês corrente entra quando o mês fechar; por enquanto acompanhe atividade desde D0, curva, mix e canal.'
          : metaPending
            ? 'Meta mensal ainda completa a história de eficiência; até lá, use atividade desde D0, curva, mix e canal.'
            : 'Cruzar atividade desde D0, meta, mix e canal para decidir reforço, pausa ou redistribuição.'
      }
    ];

    const cards = [
      {
        step: '01',
        title: 'Momento da empresa vs meta',
        value: company.value,
        label: company.label,
        copy: `${storyEvidenceCopy(company.copy)}${executiveEvidenceSourceLine('momento', { company })}`,
        state: company.state || (companyVariation !== null && companyVariation < -0.05 ? 'warn' : 'ok'),
        tooltip: 'Evidência técnica: realizado da empresa vs meta no período do produto selecionado; produto entra como participação no realizado.'
      },
      {
        step: '02',
        title: 'Representatividade vs meta',
        value: representationValue,
        label: representationGoalSummary(goalRows, selected),
        copy: `${storyEvidenceCopy(representationGoalSummary(goalRows, selected))}${representationGoalExecutiveEvidence(goalRows, selected)}${executiveEvidenceSourceLine('representatividade', { goalRow: firstGoal })}`,
        state: 'focus',
        tooltip: 'Evidência do peso do lançamento: produto contra meta mensal por janelas de 30 dias, share da janela e posição no universo comparado.'
      },
      {
        step: '03',
        title: 'Meta mensal da empresa',
        value: meta.value,
        label: meta.label,
        copy: `${storyEvidenceCopy(meta.copy)}${executiveEvidenceSourceLine('meta', { metaRow })}`,
        state: metaPending ? 'pending' : metaOpen ? 'warn' : 'ok',
        tooltip: 'Evidência técnica de meta: mês do lançamento, meta esperada, realizado e share do produto no período coberto. Se o mês ainda está aberto, usa o último mês fechado como contexto.'
      },
      {
        step: '04',
        title: 'Atividade comparativa',
        value: activity.value,
        label: activity.label,
        copy: `${storyEvidenceCopy(activity.copy)}${executiveEvidenceSourceLine('atividade', { activityRow: activity.row || selected.acumulado_lancamento || selected.acumulado_atual || selectedWindow.data })}`,
        state: activity.state,
        tooltip: 'Evidência técnica da atividade acumulada desde o lançamento: dias ativos, cobertura dos dados, faturamento, pedidos e pares.'
      }
    ];

    wrap.innerHTML = `
      <div class="story-brief-panel story-brief-panel--${escapeHtml(signal.state)}">
        <div class="story-brief-head">
          <div>
            <div class="section-kicker story-kicker">${labelTip('Leitura executiva', storyIntroTooltip)}</div>
            <h2>A história comparativa dos lançamentos</h2>
            <p>${escapeHtml(thesis)} A tela deve contar se o lançamento foi relevante frente ao grupo comparativo, se performou contra meta e se o contexto de nascimento ajuda ou atrapalha a curva.</p>
          </div>
          <div class="story-brief-verdict">
            ${labelTip('Pergunta central', centralQuestionTooltip)}
            <strong>${escapeHtml(signal.question)}</strong>
          </div>
        </div>
        <div class="story-visual-grid">
          <div class="story-left-column">
            <div class="story-hero-signal story-hero-signal--activity">
              ${labelTip('Atividade comparativa', activityTooltip)}
              <strong>${escapeHtml(activity.value)}</strong>
              <p>${escapeHtml(activity.copy)}</p>
              ${storyFactChips(activity.facts)}
            </div>
            ${storySubModelHtml(selected)}
          </div>
          <div>
            <div class="story-visual-metrics story-visual-metrics--three">
              ${evidence.join('')}
            </div>
            <div class="story-visual-metric story-visual-metric--wide">
              <div class="story-visual-metric-head">
                ${labelTip('Ranking por share comparativo', 'Cada lançamento usa sua própria linha temporal: receita do produto na janela selecionada dividida pelo faturamento da empresa no mesmo intervalo daquele lançamento. Phantom usa datas de Phantom; Avant usa datas de Avant; as datas de calendário não se cruzam.')}
              </div>
              ${allShareHtml}
            </div>
            <div class="story-decision-grid">
              ${decisionNotes.map((item) => `
                <div class="story-decision-card">
                  ${labelTip(item.title, item.tooltip)}
                  <p>${escapeHtml(item.copy)}</p>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        <details class="story-step-details">
          <summary><span>Ver resumo das fontes</span>${tip('Abre os quatro blocos que sustentam a leitura executiva, em linguagem de decisão: momento da empresa, meta, representatividade e atividade comparativa.')}</summary>
          <div class="story-step-grid">
            ${cards.map((card) => `
              <div class="story-step story-step--${card.state}">
                <div class="story-step-num">${escapeHtml(card.step)}</div>
                <div>
                  ${labelTip(card.title, card.tooltip)}
                  <strong>${escapeHtml(card.value)}</strong>
                  <em>${escapeHtml(card.label)}</em>
                  <div class="story-step-copy">${card.copy}</div>
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;
  }

  function renderSelectedHeader(selected) {
    const cohort = comparisonLaunchesWithFocus(selected);
    const periodKey = selectedPeriodKey();
    const withWindow = cohort.filter((launch) => Boolean(getWindow(launch, periodKey))).length;
    const withoutWindow = Math.max(0, cohort.length - withWindow);

    const items = [
      { label: 'Linha destacada', value: selected?.modelo || '—' },
      { label: 'Janela comparativa', value: selectedPeriodLabel() },
      { label: 'Linhas comparadas', value: fmtNum(cohort.length) },
      { label: 'Com dado na janela', value: fmtNum(withWindow) },
      { label: 'Em maturação', value: fmtNum(withoutWindow) }
    ];

    $('selected-dates').innerHTML = items.map((item) => `
      <span class="selected-date-chip">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(item.value)}</strong>
      </span>
    `).join('');
  }

  const REQUIRED_SHARE_MODEL_FIELDS = [
    'janela_completa',
    'dias_disponiveis',
    'janela_alvo_dias',
    'd0_coincide_com_sazonalidade'
  ];

  function sharePayloadForLaunch(launch) {
    const payload = state.data?.share_trajetoria;
    if (!payload || typeof payload !== 'object' || !payload.modelos) {
      return { error: 'data/share_trajetoria.json não foi carregado ou está fora do contrato esperado.' };
    }
    const model = payload.modelos?.[launch.modelo_id];
    if (!model) {
      return { error: `Sem share_trajetoria para ${launch.modelo}. Rode exportarTudo para gerar data/share_trajetoria.json atualizado.` };
    }

    const missing = REQUIRED_SHARE_MODEL_FIELDS.filter((field) => !Object.prototype.hasOwnProperty.call(model, field));
    const points = Array.isArray(model.pontos) ? model.pontos : [];
    if (!Array.isArray(model.pontos)) missing.push('pontos');
    points.forEach((point, index) => {
      if (!Object.prototype.hasOwnProperty.call(point, 'regra_receita_empresa')) {
        missing.push(`pontos[${index}].regra_receita_empresa`);
      }
    });
    if (missing.length) {
      return { error: `share_trajetoria incompleto: campo(s) obrigatório(s) ausente(s): ${missing.join(', ')}.` };
    }
    return { model, points };
  }

  function shareDrawerError(message, selected) {
    const line = selected?.linha || selected?.modelo || 'Lançamento';
    return `
      <div class="share-drawer-head">
        <div>
          <div class="share-drawer-kicker">Share de representatividade</div>
          <h3>${escapeHtml(line)}</h3>
        </div>
      </div>
      <div class="share-error">
        <strong>Share indisponivel</strong>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function shareChartAria(points) {
    const values = points.map((point) => Number(point.share_do_dia)).filter((value) => Number.isFinite(value));
    if (!values.length) return 'Share diário do lançamento sem pontos válidos.';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const companyValues = points.map((point) => numberOrNull(point.receita_empresa)).filter((value) => value !== null);
    const companyLayer = companyValues.length ? ' com camada de faturamento total da Reise.' : '.';
    return `Share diário do lançamento entre ${fmtPct(min, 1)} e ${fmtPct(max, 1)} ao longo de ${fmtNum(points.length)} dias${companyLayer}`;
  }

  function commercialEventTypeLabel(type) {
    const key = normalizeText(type);
    const labels = {
      promocao: 'Promocao',
      ruptura_estoque: 'Ruptura operacional',
      midia_paga: 'Mídia paga',
      concorrente: 'Concorrente',
      outro: 'Outro'
    };
    return labels[key] || String(type || 'Evento comercial');
  }

  const hasCommercialEvent = (point) => Boolean(point?.evento_comercial_tipo || point?.evento_comercial_descricao);
  const hasSeasonalEvent = (point) => Boolean(point?.evento_sazonal);

  function shareCoveredPeriod(points) {
    const first = points[0]?.data_calendario;
    const last = points[points.length - 1]?.data_calendario;
    return first && last ? `${fmtDateSlash(first)} a ${fmtDateSlash(last)}` : '-';
  }

  function shareDataUntil(model, points) {
    return model?.dado_ate || points[points.length - 1]?.data_calendario || null;
  }

  function shareVariationClass(value) {
    const num = numberOrNull(value);
    if (num === null || num === 0) return 'share-stat-delta';
    return `share-stat-delta ${num > 0 ? 'share-stat-delta--positive' : 'share-stat-delta--negative'}`;
  }

  function shareCompanyMomentHtml(model) {
    const preRevenue = numberOrNull(model.receita_empresa_pre_periodo);
    const posRevenue = numberOrNull(model.receita_empresa_pos_periodo);
    const variation = numberOrNull(model.variacao_receita_empresa_pct);
    const days = numberOrNull(model.dias_pos_disponiveis);
    const moment = companyMomentNarrative(model);
    const baselineInsuficiente = Boolean(moment.baselineInsuficiente);

    if (preRevenue === null || posRevenue === null) {
      return `
        <small>comparativo contra a janela pre-D0</small>
        <em>Campos ausentes no JSON. Rode exportarTudo atualizado.</em>
      `;
    }

    return `
      <div class="share-company-values">
        <div>
          <span>Antes D0</span>
          <strong>${fmtBRL(preRevenue)}</strong>
        </div>
        <div>
          <span>Depois D0</span>
          <strong>${fmtBRL(posRevenue)}</strong>
        </div>
      </div>
      <em class="${baselineInsuficiente ? 'share-stat-delta' : shareVariationClass(variation)}">${baselineInsuficiente ? `${escapeHtml(moment.label)} · ${escapeHtml(moment.copy)}` : `Variação ${fmtPct(variation, 1)} em ${fmtNum(days)} dia(s) comparáveis`}</em>
    `;
  }

  const DRILL_SUBMODEL_LABELS = {
    rs8avantmc: 'RS8 Avant MC',
    rs8avantab: 'RS8 Avant AB',
    rs8avantct: 'RS8 Avant CT',
    rs8avantcf: 'RS8 Avant CF',
    rs8mono: 'RS8 Mono',
    series2_whisky: 'Whisky',
    series2_off_white: 'Off White',
    series2_azul_marinho: 'Azul Marinho',
    phteasy: 'Phantom Easy',
    phtslip: 'Phantom Slip',
    phtknit: 'Phantom Knit',
    rs6gt: 'RS6 GT',
    '911gt': '911 GT',
    knitgt: 'KNIT GT',
    rs6avant: 'RS6 Avant',
    rs7avant: 'RS7 Avant',
    rs8avant: 'RS8 Avant'
  };

  function isSyntheticSubModelId(subId) {
    return /_(sem_prefixo|sem_cor)$/i.test(String(subId || '').trim());
  }

  function analysisParamsFromHash() {
    const raw = String(location.hash || '').replace(/^#/, '');
    if (!raw) return {};
    const params = new URLSearchParams(raw);
    const nivel = params.get('nivel');
    if (!nivel) return {};
    return {
      nivel,
      linha: params.get('linha') || '',
      sub: params.get('sub') || ''
    };
  }

  function isAnalysisDrillHash() {
    return Boolean(analysisParamsFromHash().nivel);
  }

  function analysisHash(nivel, linha, sub = '') {
    const params = new URLSearchParams();
    params.set('nivel', nivel);
    if (linha) params.set('linha', linha);
    if (sub) params.set('sub', sub);
    return `#${params.toString()}`;
  }

  function lineLaunchById(modelId) {
    return state.launches.find((launch) => launch.modelo_id === modelId) || null;
  }

  function drillLineOptions() {
    const modelos = state.data?.share_trajetoria?.modelos || {};
    const ids = Object.keys(modelos);
    return state.launches
      .filter((launch) => ids.includes(launch.modelo_id))
      .sort((a, b) => a.order - b.order);
  }

  function shareModelForLine(modelId) {
    const model = state.data?.share_trajetoria?.modelos?.[modelId] || null;
    if (!model) return null;
    const launch = lineLaunchById(modelId);
    return {
      ...model,
      day_zero_base: model.day_zero_base || analysisDayZero(launch)
    };
  }

  function sharePointsForLine(modelId) {
    const points = shareModelForLine(modelId)?.pontos;
    return Array.isArray(points)
      ? points.slice().sort((a, b) => Number(a.dias_desde_lancamento || 0) - Number(b.dias_desde_lancamento || 0))
      : [];
  }

  function drillWindowBadge(model) {
    if (!model) return badge('parcial', 'Share indisponivel');
    if (model.janela_completa === true) return badge('pipeline', 'Janela completa');
    if (model.janela_completa === false) {
      const done = numberOrNull(model.dias_disponiveis);
      const target = numberOrNull(model.janela_alvo_dias) || 90;
      return badge('parcial', `Parcial - D+${fmtNum(done)} de ${fmtNum(target)}`);
    }
    return badge('parcial', 'Janela indefinida');
  }

  function compactSkuText(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '');
  }

  function inferSubModelIdFromSku(row, modelId) {
    const compact = compactSkuText([
      row?.sku,
      row?.sub_modelo,
      row?.nome_produto,
      row?.item_name,
      row?.product_title
    ].filter(Boolean).join(' '));
    const id = String(modelId || row?.modelo_id || '').trim();

    if (id === 'rs8_monochrome') {
      if (compact.startsWith('rs8avantmc')) return 'rs8avantmc';
      if (compact.startsWith('rs8avantab')) return 'rs8avantab';
      if (compact.startsWith('rs8avantct')) return 'rs8avantct';
      if (compact.startsWith('rs8avantcf')) return 'rs8avantcf';
      if (compact.startsWith('rs8avantmono') || compact.startsWith('rs8mono')) return 'rs8mono';
      return null;
    }
    if (id === 'series_2') {
      if (/whisky|whiskey|^(rs8avant|series2|s2)(wh|wk|wky|ws)/.test(compact)) return 'series2_whisky';
      if (/offwhite|^(rs8avant|series2|s2)(ow|offwhite)/.test(compact)) return 'series2_off_white';
      if (/azulmarinho|marinho|^(rs8avant|series2|s2)(mr|am|azulmarinho|marinho)/.test(compact)) return 'series2_azul_marinho';
      return null;
    }
    if (id === 'phantom') {
      if (compact.startsWith('phteasy') || compact.startsWith('phantomeasy')) return 'phteasy';
      if (compact.startsWith('phtslip') || compact.startsWith('phantomslip')) return 'phtslip';
      if (compact.startsWith('phtknit') || compact.startsWith('phantomknit')) return 'phtknit';
      return null;
    }
    if (id === 'gt') {
      if (compact.startsWith('rs6gt')) return 'rs6gt';
      if (compact.startsWith('911gt')) return '911gt';
      if (compact.startsWith('knitgt')) return 'knitgt';
      return null;
    }
    if (id === 'avant') {
      if (compact.startsWith('rs6avant')) return 'rs6avant';
      if (compact.startsWith('rs7avant')) return 'rs7avant';
      if (compact.startsWith('rs8avant')) return 'rs8avant';
      return null;
    }
    return id || null;
  }

  function rowSubModelId(row, modelId = '') {
    const explicit = row?.sub_modelo_id;
    if (explicit && !isSyntheticSubModelId(explicit)) return explicit;
    return inferSubModelIdFromSku(row, modelId || row?.modelo_id);
  }

  function subModelLabel(subId) {
    return DRILL_SUBMODEL_LABELS[subId] || String(subId || 'Sub-modelo').replace(/_/g, ' ').toUpperCase();
  }

  function subModelDailyRows(modelId) {
    const exported = state.data?.sub_modelos_dia;
    if (Array.isArray(exported) && exported.length) {
      return exported
        .filter((row) => row.modelo_id === modelId && row.sub_modelo_id && !isSyntheticSubModelId(row.sub_modelo_id))
        .map((row) => ({
          modelo_id: row.modelo_id,
          sub_modelo_id: row.sub_modelo_id,
          data: row.data_venda || row.data,
          pares: Number(row.pares || 0),
          receita: Number(row.receita || 0)
        }))
        .sort((a, b) => String(a.data).localeCompare(String(b.data)));
    }

    const grouped = new Map();
    (state.data?.lancamentos_produtos_dia || [])
      .filter((row) => row.modelo_id === modelId)
      .forEach((row) => {
        const subId = rowSubModelId(row, modelId);
        const data = row.data || row.data_venda;
        if (!subId || !data) return;
        const key = `${subId}|${data}`;
        const current = grouped.get(key) || {
          modelo_id: modelId,
          sub_modelo_id: subId,
          data,
          pares: 0,
          receita: 0
        };
        current.pares += Number(row.pares || row.quantidade || 0);
        current.receita += dashboardRevenueNumber(row);
        grouped.set(key, current);
      });

    return [...grouped.values()].sort((a, b) => (
      a.sub_modelo_id.localeCompare(b.sub_modelo_id) || String(a.data).localeCompare(String(b.data))
    ));
  }

  function subModelTotals(modelId) {
    const grouped = new Map();
    subModelDailyRows(modelId).forEach((row) => {
      const current = grouped.get(row.sub_modelo_id) || {
        sub_modelo_id: row.sub_modelo_id,
        pares: 0,
        receita: 0,
        dias: 0
      };
      current.pares += Number(row.pares || 0);
      current.receita += Number(row.receita || 0);
      current.dias += 1;
      grouped.set(row.sub_modelo_id, current);
    });
    return [...grouped.values()].sort((a, b) => b.receita - a.receita);
  }

  function bestSubModelId(modelId) {
    return subModelTotals(modelId)[0]?.sub_modelo_id || '';
  }

  function subModelRowsForWindow(launch, subId = '') {
    if (!launch?.modelo_id) return [];
    const endDay = selectedPeriodEndDay(launch);
    const d0 = analysisDayZero(launch);
    return subModelDailyRows(launch.modelo_id).filter((row) => {
      if (subId && row.sub_modelo_id !== subId) return false;
      if (!d0 || !row.data || endDay === null) return true;
      const idx = dayIndex(d0, row.data);
      return Number.isFinite(idx) && idx >= 0 && idx <= endDay;
    });
  }

  function subModelOptionsForStory(launch) {
    if (!launch?.modelo_id) return [];
    const allTotals = new Map();
    subModelTotals(launch.modelo_id).forEach((row) => {
      allTotals.set(row.sub_modelo_id, {
        id: row.sub_modelo_id,
        label: subModelLabel(row.sub_modelo_id),
        totalReceita: Number(row.receita || 0),
        totalPares: Number(row.pares || 0)
      });
    });
    const windowTotals = new Map();
    subModelRowsForWindow(launch).forEach((row) => {
      const id = row.sub_modelo_id;
      if (!id) return;
      const current = windowTotals.get(id) || { id, label: subModelLabel(id), receita: 0, pares: 0, dias: new Set() };
      current.receita += Number(row.receita || 0);
      current.pares += Number(row.pares || 0);
      if (row.data) current.dias.add(row.data);
      windowTotals.set(id, current);
    });
    windowTotals.forEach((row, id) => {
      if (!allTotals.has(id)) allTotals.set(id, { id, label: subModelLabel(id), totalReceita: 0, totalPares: 0 });
    });
    return [...allTotals.values()]
      .map((base) => {
        const windowRow = windowTotals.get(base.id);
        return {
          ...base,
          receita: windowRow ? windowRow.receita : null,
          pares: windowRow ? windowRow.pares : null,
          diasCount: windowRow ? windowRow.dias.size : 0
        };
      })
      .sort((a, b) => {
        const aRevenue = numberOrNull(a.receita);
        const bRevenue = numberOrNull(b.receita);
        if (aRevenue !== null && bRevenue !== null && aRevenue !== bRevenue) return bRevenue - aRevenue;
        if (aRevenue !== null) return -1;
        if (bRevenue !== null) return 1;
        return b.totalReceita - a.totalReceita || String(a.label).localeCompare(String(b.label));
      });
  }

  function selectedStorySubModelId(launch) {
    const options = subModelOptionsForStory(launch);
    if (!options.length) return '';
    const saved = state.storySubModelByModel?.[launch.modelo_id];
    return options.some((item) => item.id === saved) ? saved : options[0].id;
  }

  function storySubModelSummary(launch, subId) {
    const options = subModelOptionsForStory(launch);
    const selected = options.find((item) => item.id === subId) || options[0] || null;
    if (!selected) return { options, selected: null, totalReceita: null, totalPares: null, share: null, rank: null };
    const totalReceita = options
      .map((item) => numberOrNull(item.receita))
      .filter((value) => value !== null)
      .reduce((acc, value) => acc + value, 0);
    const totalPares = options
      .map((item) => numberOrNull(item.pares))
      .filter((value) => value !== null)
      .reduce((acc, value) => acc + value, 0);
    const selectedReceita = numberOrNull(selected.receita);
    const rank = options.findIndex((item) => item.id === selected.id) + 1;
    const rankedWithRevenue = options.filter((item) => numberOrNull(item.receita) !== null);
    const leader = rankedWithRevenue[0] || null;
    const avgReceita = rankedWithRevenue.length
      ? rankedWithRevenue.reduce((acc, item) => acc + Number(item.receita || 0), 0) / rankedWithRevenue.length
      : null;
    const selectedPares = numberOrNull(selected.pares);
    const selectedDays = numberOrNull(selected.diasCount);
    return {
      options,
      selected,
      totalReceita,
      totalPares,
      share: totalReceita && selectedReceita !== null ? selectedReceita / totalReceita : null,
      rank,
      leader,
      avgReceita,
      deltaAvg: selectedReceita !== null && avgReceita ? (selectedReceita / avgReceita) - 1 : null,
      gapLeader: selectedReceita !== null && leader && leader.id !== selected.id ? Number(leader.receita || 0) - selectedReceita : null,
      ticketPar: selectedReceita !== null && selectedPares ? selectedReceita / selectedPares : null,
      dailyRevenue: selectedReceita !== null && selectedDays ? selectedReceita / selectedDays : null
    };
  }

  function storySubModelDiagnosis(summary) {
    const selected = summary?.selected;
    if (!selected) return 'Sem submodelo selecionado.';
    const share = numberOrNull(summary.share);
    const deltaAvg = numberOrNull(summary.deltaAvg);
    const gapLeader = numberOrNull(summary.gapLeader);
    const dailyRevenue = numberOrNull(summary.dailyRevenue);
    const parts = [];
    if (share !== null) {
      parts.push(share >= 0.5
        ? `${selected.label} concentra ${fmtPct(share, 1)} da receita da linha nesta janela`
        : `${selected.label} responde por ${fmtPct(share, 1)} da receita da linha nesta janela`);
    } else {
      parts.push(`${selected.label} ainda não tem receita classificada nessa janela`);
    }
    if (summary.rank) parts.push(`${fmtNum(summary.rank)}º de ${fmtNum(summary.options.length)} submodelos`);
    if (deltaAvg !== null) {
      parts.push(`${deltaAvg >= 0 ? '+' : '-'}${fmtPct(Math.abs(deltaAvg), 1)} vs média dos submodelos`);
    }
    if (gapLeader !== null) {
      parts.push(`${fmtBRL(gapLeader)} atras do lider ${summary.leader?.label || ''}`.trim());
    } else if (summary.leader?.id === selected.id) {
      parts.push('lider da linha no recorte');
    }
    if (dailyRevenue !== null) {
      parts.push(`ritmo de ${fmtBRL(dailyRevenue)}/dia`);
    }
    return `${parts.join(' · ')}.`;
  }

  function storySalesRowsForWindow(launch) {
    if (!launch?.modelo_id) return [];
    const d0 = analysisDayZero(launch);
    const endDay = selectedPeriodEndDay(launch);
    return optionalRows('lancamentos_produtos_dia').filter((row) => {
      if (row.modelo_id !== launch.modelo_id) return false;
      if (!d0 || !row.data || endDay === null) return true;
      const idx = dayIndex(d0, row.data);
      return Number.isFinite(idx) && idx >= 0 && idx <= endDay;
    });
  }

  function storyFormatMetric(value, type = 'brl') {
    if (type === 'num') return fmtNum(value);
    if (type === 'brlPerDay') return value === null || value === undefined ? fmtBRL(value) : `${fmtBRL(value)}/dia`;
    return fmtBRL(value);
  }

  function storySubModelFrontOptions(launch) {
    return subModelOptionsForStory(launch).map((row) => ({
      id: `submodelo:${row.id}`,
      sourceId: row.id,
      groupKey: 'submodelos',
      groupLabel: 'Submodelos',
      frontName: 'submodelo',
      label: row.label,
      metricLabel: 'Receita',
      metricType: 'brl',
      shareBasis: 'da receita dos submodelos',
      metricValue: numberOrNull(row.receita),
      sortValue: numberOrNull(row.receita) ?? numberOrNull(row.totalReceita) ?? 0,
      receita: numberOrNull(row.receita),
      pares: numberOrNull(row.pares),
      pedidos: null,
      diasCount: numberOrNull(row.diasCount)
    }));
  }

  function storyColorFrontOptions(launch) {
    const rawRows = storySalesRowsForWindow(launch);
    const rows = rawRows.length
      ? rawRows.map((row) => ({
        cor: extractColor({ ...row, modelo_id: launch.modelo_id }, launch),
        pares: Number(row.pares || row.quantidade || 0),
        receita_bruta: dashboardRevenueNumber(row),
        receita_liquida: numberOrNull(row.receita_liquida),
        pedidos: Number(row.pedidos_validos ?? row.pedidos ?? 0),
        data: row.data || row.data_venda
      }))
      : colorRowsForLaunchPeriod(launch);
    const grouped = new Map();
    rows.forEach((row) => {
      const label = row.cor || '';
      if (!validComparativeCutKey(label, 'Cor')) return;
      const key = normalizeText(label);
      const current = grouped.get(key) || {
        id: `cor:${key}`,
        groupKey: 'cores',
        groupLabel: 'Cores',
        frontName: 'cor',
        label,
        metricLabel: 'Pares',
        metricType: 'num',
        shareBasis: 'dos pares por cor',
        metricValue: 0,
        sortValue: 0,
        receita: 0,
        pares: 0,
        pedidos: 0,
        dias: new Set()
      };
      const pares = Number(row.pares || 0);
      const receita = dashboardRevenueValue(row);
      current.metricValue += pares;
      current.sortValue += pares;
      current.pares += pares;
      if (receita !== null) current.receita += receita;
      current.pedidos += Number(row.pedidos || 0);
      if (row.data || row.data_venda) current.dias.add(row.data || row.data_venda);
      grouped.set(key, current);
    });
    return [...grouped.values()]
      .map(({ dias, ...row }) => ({ ...row, diasCount: dias.size || null }))
      .sort((a, b) => b.sortValue - a.sortValue || String(a.label).localeCompare(String(b.label), 'pt-BR'));
  }

  function storySizeFrontOptions(launch) {
    const rawRows = storySalesRowsForWindow(launch);
    const rows = rawRows.length
      ? rawRows.map((row) => ({
        tamanho: extractSize(row),
        pares: Number(row.pares || row.quantidade || 0),
        data: row.data || row.data_venda
      }))
      : sizeRowsForLaunchPeriod(launch);
    const grouped = new Map();
    rows.forEach((row) => {
      const label = row.tamanho || '';
      if (!validComparativeCutKey(label, 'Tamanho')) return;
      const key = normalizeText(label);
      const current = grouped.get(key) || {
        id: `tamanho:${key}`,
        groupKey: 'tamanhos',
        groupLabel: 'Tamanhos',
        frontName: 'tamanho',
        label: String(label),
        metricLabel: 'Pares',
        metricType: 'num',
        shareBasis: 'dos pares por tamanho',
        metricValue: 0,
        sortValue: 0,
        receita: null,
        pares: 0,
        pedidos: null,
        dias: new Set()
      };
      const pares = Number(row.pares || 0);
      current.metricValue += pares;
      current.sortValue += pares;
      current.pares += pares;
      if (row.data || row.data_venda) current.dias.add(row.data || row.data_venda);
      grouped.set(key, current);
    });
    return [...grouped.values()]
      .map(({ dias, ...row }) => ({ ...row, diasCount: dias.size || null }))
      .sort((a, b) => b.sortValue - a.sortValue || String(a.label).localeCompare(String(b.label), 'pt-BR'));
  }

  function storyAnalysisGroups(launch) {
    const submodels = storySubModelFrontOptions(launch);
    const colors = storyColorFrontOptions(launch);
    const sizes = storySizeFrontOptions(launch);
    const colorLabels = new Set(colors.map((item) => normalizeText(item.label)));
    const submodelsOnlyRepeatColors = submodels.length > 0
      && colors.length > 0
      && submodels.every((item) => colorLabels.has(normalizeText(item.label)));
    return [
      { key: 'submodelos', label: 'Submodelos', options: submodelsOnlyRepeatColors ? [] : submodels },
      { key: 'cores', label: 'Cores', options: colors },
      { key: 'tamanhos', label: 'Tamanhos', options: sizes }
    ].filter((group) => group.options.length);
  }

  function selectedStoryAnalysisId(launch) {
    const options = storyAnalysisGroups(launch).flatMap((group) => group.options);
    if (!options.length) return '';
    const saved = state.storyAnalysisByModel?.[launch.modelo_id];
    if (options.some((item) => item.id === saved)) return saved;
    const legacy = state.storySubModelByModel?.[launch.modelo_id];
    if (options.some((item) => item.id === legacy)) return legacy;
    const legacySubmodel = legacy ? `submodelo:${legacy}` : '';
    if (options.some((item) => item.id === legacySubmodel)) return legacySubmodel;
    return options[0].id;
  }

  function storyAnalysisSummary(launch, selectedId) {
    const groups = storyAnalysisGroups(launch);
    const options = groups.flatMap((group) => group.options);
    const selected = options.find((item) => item.id === selectedId) || options[0] || null;
    if (!selected) return { groups, options, selected: null };
    const peers = groups.find((group) => group.key === selected.groupKey)?.options || [];
    const ranked = peers.slice().sort((a, b) => {
      const aValue = numberOrNull(a.metricValue);
      const bValue = numberOrNull(b.metricValue);
      if (aValue !== null && bValue !== null && aValue !== bValue) return bValue - aValue;
      if (aValue !== null) return -1;
      if (bValue !== null) return 1;
      return b.sortValue - a.sortValue || String(a.label).localeCompare(String(b.label), 'pt-BR');
    });
    const values = ranked.map((item) => numberOrNull(item.metricValue)).filter((value) => value !== null);
    const totalValue = values.reduce((acc, value) => acc + value, 0);
    const selectedValue = numberOrNull(selected.metricValue);
    const avgValue = values.length ? totalValue / values.length : null;
    const leader = ranked.find((item) => numberOrNull(item.metricValue) !== null) || null;
    const rank = ranked.findIndex((item) => item.id === selected.id) + 1;
    return {
      groups,
      options,
      peers: ranked,
      selected,
      totalValue,
      selectedValue,
      share: totalValue && selectedValue !== null ? selectedValue / totalValue : null,
      rank: rank > 0 ? rank : null,
      avgValue,
      deltaAvg: selectedValue !== null && avgValue ? (selectedValue / avgValue) - 1 : null,
      leader,
      gapLeader: selectedValue !== null && leader && leader.id !== selected.id ? Number(leader.metricValue || 0) - selectedValue : null,
      dailyValue: selected.metricType === 'brl' && selectedValue !== null && selected.diasCount ? selectedValue / selected.diasCount : null
    };
  }

  function storyAnalysisDiagnosis(summary) {
    const selected = summary?.selected;
    if (!selected) return 'Sem frente carregada para esta linha.';
    const share = numberOrNull(summary.share);
    const deltaAvg = numberOrNull(summary.deltaAvg);
    const gapLeader = numberOrNull(summary.gapLeader);
    const parts = [];
    if (share !== null) {
      parts.push(`${selected.label} ${share >= 0.5 ? 'concentra' : 'responde por'} ${fmtPct(share, 1)} ${selected.shareBasis} nesta janela`);
    } else {
      parts.push(`${selected.label} ainda não tem dado classificado nesta janela`);
    }
    if (summary.rank) parts.push(`${fmtNum(summary.rank)}º de ${fmtNum(summary.peers.length)} em ${selected.groupLabel.toLowerCase()}`);
    if (deltaAvg !== null) parts.push(`${deltaAvg >= 0 ? '+' : '-'}${fmtPct(Math.abs(deltaAvg), 1)} vs média da frente`);
    if (gapLeader !== null) parts.push(`${storyFormatMetric(gapLeader, selected.metricType)} atras do lider ${summary.leader?.label || ''}`.trim());
    else if (summary.leader?.id === selected.id) parts.push('lider desta frente no recorte');
    if (selected.metricType !== 'brl' && numberOrNull(selected.receita) !== null) parts.push(`receita ${fmtBRL(selected.receita)}`);
    if (summary.dailyValue !== null) parts.push(`ritmo de ${storyFormatMetric(summary.dailyValue, 'brlPerDay')}`);
    return `${parts.join(' · ')}.`;
  }

  function storyAnalysisFactRows(summary) {
    const selected = summary.selected;
    const deltaAvgText = summary.deltaAvg === null
      ? '—'
      : `${summary.deltaAvg >= 0 ? '+' : '-'}${fmtPct(Math.abs(summary.deltaAvg), 1)}`;
    const extra = selected.metricType === 'brl'
      ? { label: 'Ritmo/dia', value: storyFormatMetric(summary.dailyValue, 'brlPerDay') }
      : numberOrNull(selected.receita) !== null
        ? { label: 'Receita', value: fmtBRL(selected.receita) }
        : { label: 'Dias', value: fmtNum(selected.diasCount) };
    return [
      { label: selected.metricLabel, value: storyFormatMetric(selected.metricValue, selected.metricType) },
      { label: 'Share', value: fmtPct(summary.share, 1) },
      { label: 'Vs média', value: deltaAvgText },
      extra
    ];
  }

  function storyAnalysisRankingDetail(item) {
    const pieces = [];
    if (item.metricType !== 'brl' && numberOrNull(item.receita) !== null) pieces.push(fmtBRL(item.receita));
    if (numberOrNull(item.pares) !== null) pieces.push(`${fmtNum(item.pares)} pares`);
    if (numberOrNull(item.pedidos) !== null && item.pedidos > 0) pieces.push(`${fmtNum(item.pedidos)} pedidos`);
    return pieces.join(' · ');
  }

  function storySubModelHtml(launch) {
    const selectedAnalysisId = selectedStoryAnalysisId(launch);
    const summary = storyAnalysisSummary(launch, selectedAnalysisId);
    if (!summary.options?.length || !summary.selected) {
      return '';
    }
    const selected = summary.selected;
    const maxValue = Math.max(...summary.peers.map((item) => numberOrNull(item.metricValue) || 0), 1);
    const facts = storyAnalysisFactRows(summary);
    const activeGroup = summary.groups.find((group) => group.key === selected.groupKey) || summary.groups[0];
    return `
      <div class="story-submodel-card">
        <div class="story-submodel-head">
          ${labelTip('Frente de análise', 'Escolha submodelo, cor ou tamanho para ler a composição interna da linha destacada na mesma janela do dashboard.')}
          <div class="story-analysis-controls">
            <label>
              <span>Frente</span>
              <select id="story-analysis-front-select" class="story-submodel-select" aria-label="Frente de análise">
                ${summary.groups.map((group) => `<option value="${escapeHtml(group.key)}" ${group.key === selected.groupKey ? 'selected' : ''}>${escapeHtml(group.label)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Recorte</span>
              <select id="story-analysis-item-select" class="story-submodel-select" aria-label="Recorte da frente ${escapeHtml(activeGroup?.label || '')}">
                ${(activeGroup?.options || []).map((item) => `<option value="${escapeHtml(item.id)}" ${item.id === selected.id ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="story-submodel-main">
          <strong>${escapeHtml(selected.label)}</strong>
          <span>${escapeHtml(selectedPeriodLabel())} · ${escapeHtml(selected.groupLabel)} · ${fmtNum(summary.rank)}º de ${fmtNum(summary.peers.length)}</span>
          <p>${escapeHtml(storyAnalysisDiagnosis(summary))}</p>
        </div>
        <div class="story-submodel-facts">
          ${facts.map((fact) => `<i><span>${escapeHtml(fact.label)}</span><b>${escapeHtml(fact.value)}</b></i>`).join('')}
        </div>
        <div class="story-submodel-ranking" aria-label="Ranking da frente selecionada">
          ${summary.peers.map((item) => `
            <div class="${item.id === selected.id ? 'is-selected' : ''}">
              <span>${escapeHtml(item.label)}</span>
              <i><b style="width:${numberOrNull(item.metricValue) !== null ? Math.max(3, (Number(item.metricValue || 0) / maxValue) * 100).toFixed(1) : 0}%"></b></i>
              <strong>${fmtPct(summary.totalValue && numberOrNull(item.metricValue) !== null ? item.metricValue / summary.totalValue : null, 1)}<small>${escapeHtml(storyAnalysisRankingDetail(item))}</small></strong>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }

  function svgPath(points) {
    return points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ');
  }

  function linearProjection(points, valueField, targetDay = 90) {
    const valid = points
      .map((point) => ({
        day: Number(point.dias_desde_lancamento ?? point.day),
        value: numberOrNull(point[valueField])
      }))
      .filter((point) => Number.isFinite(point.day) && point.value !== null)
      .slice(-10);

    if (valid.length < 2) return [];
    const n = valid.length;
    const sumX = valid.reduce((acc, point) => acc + point.day, 0);
    const sumY = valid.reduce((acc, point) => acc + point.value, 0);
    const sumXY = valid.reduce((acc, point) => acc + point.day * point.value, 0);
    const sumXX = valid.reduce((acc, point) => acc + point.day * point.day, 0);
    const denominator = n * sumXX - sumX * sumX;
    if (!denominator) return [];

    const slope = (n * sumXY - sumX * sumY) / denominator;
    const intercept = (sumY - slope * sumX) / n;
    const lastDay = valid[valid.length - 1].day;
    const endDay = Math.max(lastDay, Number(targetDay || 90));
    const projected = [];
    for (let day = lastDay; day <= endDay; day += Math.max(1, Math.ceil((endDay - lastDay) / 12))) {
      projected.push({ day, value: Math.max(0, intercept + slope * day) });
    }
    if (projected[projected.length - 1]?.day !== endDay) {
      projected.push({ day: endDay, value: Math.max(0, intercept + slope * endDay) });
    }
    return projected;
  }

  function chartPointPositions(rows, valueField, width, height, maxDayOverride = null, maxValueOverride = null) {
    const valid = rows
      .map((row) => ({
        row,
        day: Number(row.dias_desde_lancamento ?? row.day),
        value: numberOrNull(row[valueField])
      }))
      .filter((point) => Number.isFinite(point.day) && point.value !== null);
    const maxDay = Math.max(1, maxDayOverride ?? Math.max(...valid.map((point) => point.day), 1));
    const maxValue = maxValueOverride || Math.max(...valid.map((point) => point.value), 0.01);
    return valid.map((point) => ({
      ...point,
      x: 28 + (point.day / maxDay) * (width - 48),
      y: 16 + (1 - (point.value / maxValue)) * (height - 34)
    }));
  }

  function drillShareSvg(points, model) {
    const width = 560;
    const height = 190;
    const targetDay = numberOrNull(model?.janela_alvo_dias) || 90;
    const projectionRaw = linearProjection(points, 'share_do_dia', targetDay);
    const maxValue = Math.max(
      ...points.map((point) => numberOrNull(point.share_do_dia)).filter((value) => value !== null),
      ...projectionRaw.map((point) => point.value),
      0.01
    );
    const real = chartPointPositions(points, 'share_do_dia', width, height, targetDay, maxValue);
    const projection = chartPointPositions(
      projectionRaw.map((point) => ({ day: point.day, share_do_dia: point.value })),
      'share_do_dia',
      width,
      height,
      targetDay,
      maxValue
    );
    const hasEvents = points.some((point) => hasSeasonalEvent(point) || hasCommercialEvent(point));
    const markers = real.map((point) => {
      if (hasCommercialEvent(point.row)) {
        return `<rect class="drill-marker drill-marker--commercial" x="${(point.x - 4).toFixed(1)}" y="${(point.y - 4).toFixed(1)}" width="8" height="8" />`;
      }
      if (hasSeasonalEvent(point.row)) {
        return `<rect class="drill-marker drill-marker--seasonal" x="${(point.x - 4).toFixed(1)}" y="${(point.y - 4).toFixed(1)}" width="8" height="8" transform="rotate(45 ${point.x.toFixed(1)} ${point.y.toFixed(1)})" />`;
      }
      return '';
    }).join('');

    return `
      <div class="drill-chart" role="img" aria-label="Curva de share diario da linha">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="drill-grid-line" x1="28" y1="${height - 18}" x2="${width - 20}" y2="${height - 18}" />
          <path class="drill-line" d="${svgPath(real)}" />
          ${projection.length > 1 ? `<path class="drill-line drill-line--projection" d="${svgPath(projection)}" />` : ''}
          ${markers}
        </svg>
        <div class="drill-chart-foot">
          <span>Projeção tracejada: estimativa por regressão simples dos últimos 10 dias, não meta.</span>
          <span>Meta não cadastrada.</span>
        </div>
        <div class="drill-event-note">${hasEvents ? 'Marcadores: losango para sazonalidade, quadrado para evento comercial.' : 'sem data sazonal/comercial registrada'}</div>
      </div>
    `;
  }

  function drillRevenueSvg(rows) {
    const normalized = rows.map((row) => ({
      day: Number(row.dia_desde_d0 ?? row.day),
      receita: Number(row.receita || 0)
    }));
    const width = 560;
    const height = 170;
    const maxDay = Math.max(1, ...normalized.map((row) => row.day));
    const positions = chartPointPositions(normalized, 'receita', width, height, maxDay);
    return `
      <div class="drill-chart" role="img" aria-label="Curva de receita diaria do sub-modelo">
        <svg viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" aria-hidden="true">
          <line class="drill-grid-line" x1="28" y1="${height - 18}" x2="${width - 20}" y2="${height - 18}" />
          <path class="drill-line" d="${svgPath(positions)}" />
        </svg>
        <div class="drill-chart-foot">
          <span>Receita e pares absolutos desde o D0 da linha.</span>
          <span>Sem share por sub-modelo.</span>
        </div>
      </div>
    `;
  }

  function companyMomentBlock(model) {
    const pre = numberOrNull(model?.receita_empresa_pre_periodo);
    const pos = numberOrNull(model?.receita_empresa_pos_periodo);
    const days = numberOrNull(model?.dias_pos_disponiveis);
    const variation = numberOrNull(model?.variacao_receita_empresa_pct);
    const moment = companyMomentNarrative(model);
    const baselineInsuficiente = Boolean(moment.baselineInsuficiente);
    if (pre === null || pos === null || !days) {
      return `
        <section class="drill-section">
          <div class="drill-section-title">Momento da empresa</div>
          <p class="drill-empty">comparativo indisponível</p>
        </section>
      `;
    }
    const d0 = analysisDayZero(model);
    if (!d0) {
      return `
        <section class="drill-section">
          <div class="drill-section-title">Momento da empresa</div>
          <p class="drill-empty">D0 analitico indisponivel</p>
        </section>
      `;
    }
    const preStart = toIsoDate(addDays(d0, -days));
    const preEnd = toIsoDate(addDays(d0, -1));
    const posEnd = toIsoDate(addDays(d0, days - 1));
    const className = baselineInsuficiente ? '' : (variation > 0 ? 'drill-positive' : (variation < 0 ? 'drill-negative-text' : ''));
    const arrow = baselineInsuficiente ? '' : (variation > 0 ? '+' : (variation < 0 ? '-' : ''));
    return `
      <section class="drill-section">
        <div class="drill-section-title">Momento da empresa</div>
        <div class="drill-company">
          <div><span>Antes</span><strong>${fmtBRL(pre)}</strong><small>${fmtDateSlash(preStart)} a ${fmtDateSlash(preEnd)}</small></div>
          <div><span>Depois</span><strong>${fmtBRL(pos)}</strong><small>${fmtDateSlash(d0)} a ${fmtDateSlash(posEnd)}</small></div>
          <div><span>${baselineInsuficiente ? 'Leitura' : 'Variação'}</span><strong class="${className}">${baselineInsuficiente ? escapeHtml(moment.label) : `${arrow} ${fmtPct(variation, 1)}`}</strong><small>${baselineInsuficiente ? escapeHtml(moment.copy) : `${fmtNum(days)} dias comparáveis`}</small></div>
        </div>
      </section>
    `;
  }

  function impactInvestmentBlock(modelId) {
    const launch = lineLaunchById(modelId);
    const mediaRows = launch
      ? enrichMediaEstimates((state.data?.midia_paga || [])
        .filter((row) => row.modelo_id === modelId)
        .map((row) => normalizeMediaRow(row, launch)), launch)
      : [];
    const aggregate = aggregateMediaRows(mediaRows, launch)[0] || null;
    const paidRevenue = numberOrNull(launch?.receita_paga);
    const organicRevenue = numberOrNull(launch?.receita_organica);

    if (paidRevenue !== null || organicRevenue !== null) {
      const total = Number(paidRevenue || 0) + Number(organicRevenue || 0);
      const channelMeta = (revenue) => {
        const parts = [];
        parts.push(total && revenue !== null ? `${fmtPct(revenue / total, 1)} do total atribuido` : 'venda aguardando');
        return parts.join(' · ');
      };
      return `
        <section class="drill-section">
          <div class="drill-section-title">Vendas por canal</div>
          <div class="drill-impact-grid">
            <div><span>Venda paga</span><strong>${paidRevenue !== null ? fmtBRL(paidRevenue) : 'Aguardando'}</strong><small>${channelMeta(paidRevenue)}</small></div>
            <div><span>Venda organica</span><strong>${organicRevenue !== null ? fmtBRL(organicRevenue) : 'Aguardando'}</strong><small>${channelMeta(organicRevenue)}</small></div>
          </div>
        </section>
      `;
    }

    return `
      <section class="drill-section">
        <div class="drill-section-title">Atribuição comercial</div>
        <div class="drill-impact-grid">
          <div><span>Investimento agregado</span><strong>${fmtBRL(aggregate?.investimento)}</strong><small>${escapeHtml(aggregate?.janela || 'sem janela')}</small></div>
          <div><span>ROAS agregado</span><strong>${roasValue(aggregate?.roas)}</strong><small>sem divisao por canal</small></div>
        </div>
        <div class="drill-visible-warning">
          <strong>Atribuição real pendente</strong>
          <span>O dashboard não usa mais correlação dias-com-investimento vs dias-sem como impacto. Até a view por pedido entrar no payload, mídia fica agregada por janela e ROAS por canal fica bloqueado quando a receita for repetida.</span>
        </div>
      </section>
    `;
  }

  function shareRankingBlock(focusId) {
    const rows = sortShareContexts(drillLineOptions().map((launch) => ({
      ...selectedPeriodShareContext(launch),
      id: launch.modelo_id,
      label: shareModelForLine(launch.modelo_id)?.linha || launch.linha || launch.modelo
    })));
    const max = Math.max(...rows.map((row) => row.share).filter((value) => value !== null), 0.01);
    return `
      <section class="drill-section">
        <div class="drill-section-title">Ranking por share comparativo - todas as linhas</div>
        <div class="drill-ranking">
          ${rows.map((row) => {
            const hasShare = row.share !== null;
            return `
            <div class="drill-rank-row ${row.id === focusId ? 'is-focus' : ''} ${hasShare ? '' : 'is-missing'}">
              <span>${escapeHtml(row.label)}<small>${escapeHtml(row.range)} · ${escapeHtml(row.detail)}</small></span>
              <div class="drill-rank-track"><i style="width:${hasShare ? Math.max(2, (row.share / max) * 100).toFixed(1) : 0}%"></i></div>
              <strong>${hasShare ? fmtPct(row.share, 1) : escapeHtml(row.status)}</strong>
            </div>
          `;
          }).join('')}
        </div>
      </section>
    `;
  }

  function comparisonLaunchesWithFocus(selected) {
    const byId = new Map();
    selectedCompareLaunches().forEach((launch) => {
      if (launch?.modelo_id) byId.set(launch.modelo_id, launch);
    });
    if (selected?.modelo_id) byId.set(selected.modelo_id, selected);
    return [...byId.values()].filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
  }

  function cohortMetricSummary(selected, launches, getter, { higherIsBetter = true } = {}) {
    const rows = launches
      .map((launch) => ({ launch, value: numberOrNull(getter(launch)) }))
      .filter((row) => row.value !== null && row.value !== undefined);
    const selectedRow = rows.find((row) => row.launch.modelo_id === selected?.modelo_id);
    const selectedValue = selectedRow?.value ?? null;
    const avg = rows.length ? rows.reduce((acc, row) => acc + row.value, 0) / rows.length : null;
    const sorted = [...rows].sort((a, b) => higherIsBetter ? b.value - a.value : a.value - b.value);
    const rank = selectedRow ? sorted.findIndex((row) => row.launch.modelo_id === selected.modelo_id) + 1 : null;
    const deltaAvg = selectedValue !== null && avg ? (selectedValue / avg) - 1 : null;
    return { selectedValue, avg, rank, count: rows.length, deltaAvg };
  }

  function cohortMetricSub(summary, formatter, periodLabel) {
    if (!summary || summary.selectedValue === null) {
      return `Sem ${periodLabel}; ${fmtNum(summary?.count || 0)} linhas com dado`;
    }
    const rankText = summary.rank ? `${fmtNum(summary.rank)} de ${fmtNum(summary.count)}` : `${fmtNum(summary.count)} linhas comparadas`;
    const avgText = summary.avg !== null ? `média ${formatter(summary.avg)}` : 'média sem dado';
    const deltaText = summary.deltaAvg === null
      ? ''
      : ` · ${summary.deltaAvg >= 0 ? '+' : '-'}${fmtPct(Math.abs(summary.deltaAvg), 1)} vs média`;
    return `${rankText} no grupo · ${avgText}${deltaText}`;
  }

  function seasonalScoreForLaunchWindow(launch, endDay) {
    const events = seasonalEventsFor(launch, endDay || 0);
    return events.reduce((acc, event) => acc + event.score, 0);
  }

  function seasonalContextNarrative(score, events) {
    if (!events.length) return 'Nenhuma data sazonal ou comercial cadastrada atravessou esta janela.';
    if (score > 0) return 'A janela teve mais eventos favoráveis do que pressões. Use esse contexto antes de comparar a curva com os outros lançamentos.';
    if (score < 0) return 'A janela teve mais pressões de calendário do que eventos favoráveis. A performance pode ter sido afetada pelo momento.';
    return 'A janela teve eventos cadastrados, mas o saldo ficou neutro. O calendário ajuda a contextualizar, sem explicar sozinho o resultado.';
  }

  function seasonalContextTooltip(row) {
    const launch = row.launch || {};
    const endDay = selectedPeriodEndDay(launch) || 0;
    const events = seasonalEventsFor(launch, endDay);
    const score = events.reduce((acc, event) => acc + event.score, 0);
    const counts = seasonalCounts(events);
    const scoreLabel = seasonalScoreLabel(score, events);
    const eventLines = events.length
      ? events.map((event) => {
        const meta = seasonalMeta(event.tipo);
        const impact = event.score > 0 ? `+${event.score}` : String(event.score);
        const note = event.observacao ? `\n  ${event.observacao}` : '';
        return `- ${fmtDateSlash(event.data)} (D+${fmtNum(event.day)}): ${event.nome} | ${meta.label} ${seasonalWeightLabel(event.peso)} | ${event.observed ? 'já passou' : 'previsto'} | impacto ${impact}${note}`;
      }).join('\n')
      : '- Sem data sazonal ou comercial cadastrada nesse período.';
    return [
      `${launch.modelo || 'Linha'}: ${scoreLabel}`,
      `Janela analisada: ${row.range}`,
      seasonalContextNarrative(score, events),
      `Resumo: ${fmtNum(counts.promotores)} promotores, ${fmtNum(counts.ofensores)} ofensores e ${fmtNum(counts.neutros)} neutros.`,
      'Datas na janela:',
      eventLines
    ].join('\n');
  }

  function cohortMetricRows(launches, getter, { higherIsBetter = true } = {}) {
    const rows = launches.map((launch) => {
      const value = numberOrNull(getter(launch));
      const hasWindow = Boolean(getWindow(launch, selectedPeriodKey()));
      return {
        launch,
        value,
        range: launchWindowRangeLabel(launch, selectedPeriodKey()),
        missing: value === null,
        reason: hasWindow ? 'dado pendente' : `em maturação: ${selectedPeriodLabel()} ainda não fechou`
      };
    }).sort((a, b) => {
      if (a.value !== null && b.value !== null) return higherIsBetter ? b.value - a.value : a.value - b.value;
      if (a.value !== null) return -1;
      if (b.value !== null) return 1;
      return (a.launch?.order ?? 0) - (b.launch?.order ?? 0);
    });
    let rank = 0;
    return rows.map((row) => ({
      ...row,
      rank: row.value !== null ? ++rank : null
    }));
  }

  function cohortMetricCard({ label, tooltip, rows, formatter, selectedId = null, tooltipRenderer = null }) {
    const validRows = rows.filter((row) => row.value !== null);
    const avg = validRows.length
      ? validRows.reduce((acc, row) => acc + row.value, 0) / validRows.length
      : null;
    const avgText = avg !== null ? `Média do grupo ${formatter(avg)}` : `Sem média em ${selectedPeriodLabel()}`;
    const coverageText = validRows.length
      ? `${fmtNum(validRows.length)}/${fmtNum(rows.length)} linhas com janela`
      : `sem janela ${selectedPeriodLabel()}`;
    return `
      <div class="card state-comparison-card">
        <div class="state-card-head">
          <div class="metric-label">${labelTip(label, tooltip)}</div>
          <span>${escapeHtml(selectedPeriodLabel())}</span>
        </div>
        <div class="state-card-meta">
          <span>${escapeHtml(avgText)}</span>
          <span>${escapeHtml(coverageText)}</span>
        </div>
        <div class="state-rank-list">
          ${rows.map((row) => {
            const isTooltipRow = Boolean(tooltipRenderer);
            const rowClass = `state-rank-row ${row.launch.modelo_id === selectedId ? 'is-highlighted' : ''} ${row.missing ? 'is-missing' : ''} ${isTooltipRow ? 'is-tooltip-row' : ''}`;
            const tooltipAttrs = isTooltipRow
              ? ` tabindex="0" data-tooltip="${tooltipMultilineAttr(tooltipRenderer(row))}" aria-label="Ver contexto de ${tooltipAttr(row.launch.modelo)}"`
              : '';
            const rowContent = `
              <b>${row.rank ? `${fmtNum(row.rank)}º` : '—'}</b>
              <span>${escapeHtml(row.launch.modelo)}<small>${escapeHtml(row.range)}${isTooltipRow ? ' · clique para ver contexto' : ''}</small></span>
              <strong>${row.value !== null ? formatter(row.value) : escapeHtml(row.reason)}</strong>
            `;
            return `<div class="${rowClass}"${tooltipAttrs}>${rowContent}</div>`;
          }).join('')}
        </div>
      </div>
    `;
  }

  function renderState(selected) {
    const container = $('launch-state');
    const cohort = comparisonLaunchesWithFocus(selected);
    const periodKey = selectedPeriodKey();
    const periodLabel = selectedPeriodLabel();
    const windowFor = (launch) => getWindow(launch, periodKey);
    const days = windowSpanDays(periodKey);
    const auditQuality = auditQualityForLaunch(selected);
    const auditWarning = auditQuality?.status === 'divergente'
      ? `<div class="empty-state empty-state--danger"><div><strong>Os totais do dashboard não batem com a auditoria SSOT.</strong> Não usar este dado para decisão.</div></div>`
      : '';
    const metricCards = [
      cohortMetricCard({
        label: `Faturamento ${periodLabel}`,
        tooltip: 'Ranking de receita acumulada na janela selecionada. Cada linha usa sua própria data de lançamento; janela ausente aparece como pendente.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.receita),
        formatter: fmtBRL,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Pedidos',
        tooltip: 'Ranking de pedidos distintos na janela selecionada para cada lançamento.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.pedidos),
        formatter: fmtNum,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Ticket médio/pedido',
        tooltip: 'Ranking de ticket médio por pedido dentro da janela selecionada de cada lançamento.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.ticket),
        formatter: fmtBRL,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Preço médio/par',
        tooltip: 'Ranking de preço médio por par na janela selecionada. Compara valor de produto, não faturamento absoluto.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.preco_medio_par),
        formatter: fmtBRL,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: '% Clientes novos',
        tooltip: 'Ranking de participação de novos clientes na janela selecionada. Ausência de classificação fica pendente.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.novos_pct),
        formatter: (value) => fmtPct(value, 1),
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Pares vendidos',
        tooltip: 'Ranking de volume físico vendido na janela selecionada de cada lançamento.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.pares),
        formatter: fmtNum,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Velocidade diária',
        tooltip: 'Ranking de receita média por dia na janela selecionada.',
        rows: cohortMetricRows(cohort, (launch) => {
          const data = windowFor(launch);
          return data?.receita && days ? data.receita / days : null;
        }),
        formatter: (value) => `${fmtBRL(value)}/dia`,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Contexto de nascimento',
        tooltip: 'Ranking do saldo sazonal dentro da janela selecionada de cada lançamento. Valores positivos indicam vento a favor; negativos indicam pressão de calendário.',
        rows: cohortMetricRows(cohort, (launch) => seasonalScoreForLaunchWindow(launch, selectedPeriodEndDay(launch))),
        formatter: (value) => seasonalScoreLabel(value, value === 0 ? [] : [{ score: value }]),
        selectedId: selected.modelo_id,
        tooltipRenderer: seasonalContextTooltip
      })
    ];

    container.innerHTML = `
      <div class="state-comparison-grid">
        ${metricCards.join('')}
      </div>
      ${auditWarning}`;
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

  function dailyCalendarDate(launch, row) {
    if (row?.data) return row.data;
    if (row?.day === null || row?.day === undefined || !launch?.d0) return null;
    return toIsoDate(addDays(launch.d0, Number(row.day || 0)));
  }

  function buildCannibalTimelineData(launches) {
    const eligible = launches
      .map((launch) => {
        const points = (launch.daily || [])
          .map((row) => ({ ...row, data_calendario: dailyCalendarDate(launch, row) }))
          .filter((row) => row.data_calendario);
        return { launch, points };
      })
      .filter((item) => item.points.length);
    const dateSet = new Set();
    eligible.forEach((item) => {
      item.points.forEach((row) => dateSet.add(row.data_calendario));
    });
    const dates = [...dateSet].sort();

    const checkpoints = eligible
      .map(({ launch }, index) => ({
        dateLabel: launch.d0,
        text: launch.modelo,
        color: colorFor(launch.modelo_id, index)
      }))
      .filter((cp) => cp.dateLabel && dates.includes(cp.dateLabel));

    const datasets = eligible.map(({ launch, points }, index) => {
      const byDate = new Map(points.map((row) => [row.data_calendario, numberOrNull(row.receita)]));
      return {
        label: launch.modelo,
        data: dates.map((date) => (byDate.has(date) ? byDate.get(date) : null)),
        borderColor: colorFor(launch.modelo_id, index),
        backgroundColor: fillFor(launch.modelo_id, index),
        spanGaps: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4
      };
    });

    return { dates, datasets, checkpoints };
  }

  function familiesForModel(modelId) {
    return [...new Set(subModelDailyRows(modelId).map((row) => row.sub_modelo_id).filter(Boolean))];
  }

  function buildCannibalSubmodelData(modelId) {
    const rows = subModelDailyRows(modelId);
    const bySub = new Map();
    rows.forEach((row) => {
      if (!row.sub_modelo_id || !row.data) return;
      if (!bySub.has(row.sub_modelo_id)) bySub.set(row.sub_modelo_id, []);
      bySub.get(row.sub_modelo_id).push(row);
    });

    const dateSet = new Set();
    rows.forEach((row) => {
      if (row.data) dateSet.add(row.data);
    });
    const dates = [...dateSet].sort();

    const entries = [...bySub.entries()];
    const checkpoints = entries
      .map(([subId, subRows], index) => {
        const firstDate = subRows.map((row) => row.data).sort()[0];
        return { dateLabel: firstDate, text: subModelLabel(subId), color: colorFor(subId, index) };
      })
      .filter((cp) => cp.dateLabel && dates.includes(cp.dateLabel));

    const datasets = entries.map(([subId, subRows], index) => {
      const byDate = new Map(subRows.map((row) => [row.data, numberOrNull(row.receita)]));
      return {
        label: subModelLabel(subId),
        data: dates.map((date) => (byDate.has(date) ? byDate.get(date) : null)),
        borderColor: colorFor(subId, index),
        backgroundColor: fillFor(subId, index),
        spanGaps: true,
        tension: 0.25,
        pointRadius: 0,
        pointHoverRadius: 4
      };
    });

    return { dates, datasets, checkpoints };
  }

  function renderNormalizedChart(selected, canvasId = 'chart-normalized', subTextId = 'chart-normalized-sub') {
    const canvas = $(canvasId);
    if (!canvas || !selected) return;
    state.charts[canvasId]?.destroy?.();
    delete state.charts[canvasId];

    const subText = $(subTextId);
    const mode = state.normalizedChartMode || 'linha';
    if (canvasId === 'chart-normalized') {
      const lineSelect = $('cannibal-line-select');
      if (lineSelect) {
        lineSelect.hidden = mode !== 'canibal-submodelos';
        if (mode === 'canibal-submodelos') populateCannibalLineSelect();
      }
    }

    if (mode === 'linha') {
      if (subText) subText.textContent = `Faturamento acumulado por dia desde o lançamento · ${selectedPeriodLabel()}`;
      const chartLaunches = selectedCompareLaunches();
      const maxDay = selectedPeriodEndDay(selected) ?? 90;
      const normalizedLabels = Array.from({ length: maxDay + 1 }, (_, day) => day === 0 ? 'D0' : `D+${day}`);
      const normalizedLaunches = [...chartLaunches].sort((a, b) => {
        if (a.modelo_id === selected.modelo_id) return -1;
        if (b.modelo_id === selected.modelo_id) return 1;
        return a.order - b.order;
      });
      createChart(canvasId, {
        type: 'line',
        data: {
          labels: normalizedLabels,
          datasets: normalizedLaunches.map((launch, index) => {
            const data = Array(maxDay + 1).fill(null);
            const hasDaily = Boolean(launch.daily?.length);
            const isBackfilled = launch.daily_source === 'historico_backfill';
            if (hasDaily) {
              const byDay = new Map();
              launch.daily.forEach((row) => {
                if (row.day < 0 || row.day > maxDay) return;
                byDay.set(row.day, (byDay.get(row.day) || 0) + Number(row.receita || 0));
              });
              let running = 0;
              const validDays = launch.daily.map((row) => row.day).filter((day) => day >= 0 && day <= maxDay);
              const maxDailyDay = validDays.length ? Math.min(maxDay, Math.max(...validDays)) : 0;
              for (let day = 0; day <= maxDailyDay; day += 1) {
                running += byDay.get(day) || 0;
                data[day] = running;
              }
            } else {
              data[0] = 0;
              const points = selectedPeriodWindowKeys(selected).map((key) => ({
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
                title: (items) => items[0]?.label || '',
                label: (ctx) => `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}`,
                afterLabel: (ctx) => `Fonte: ${ctx.dataset.sourceLabel}. A curva e acumulada desde D0; linhas tracejadas indicam agregado/backfill.`
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
      return;
    }

    const sharedOptions = (dates, checkpoints) => chartOptions({
      layout: { padding: { top: 34, right: 18, bottom: 6, left: 4 } },
      plugins: {
        legend: { position: 'bottom' },
        launchCheckpoints: { checkpoints },
        tooltip: {
          callbacks: {
            title: (items) => fmtDateSlash(items[0]?.label),
            label: (ctx) => `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, callback: (_, idx) => fmtDateSlash(dates[idx]) } },
        y: { ticks: { callback: (v) => fmtBRL(v, true) }, grid: { color: 'rgba(255,255,255,0.045)' } }
      }
    });

    if (mode === 'canibal-linhas') {
      if (subText) subText.textContent = 'Faturamento diário por linha, alinhado por data real (não pela idade do lançamento)';
      const { dates, datasets, checkpoints } = buildCannibalTimelineData(comparableLaunches());
      if (!dates.length || !datasets.length) return;
      createChart(canvasId, { type: 'line', data: { labels: dates, datasets }, options: sharedOptions(dates, checkpoints) });
      return;
    }

    if (mode === 'canibal-submodelos') {
      const lineId = state.canibalLineFilter || selected.modelo_id;
      const lineLaunch = state.launches.find((launch) => launch.modelo_id === lineId);
      if (subText) subText.textContent = `Sub-produtos dentro de ${lineLaunch?.linha || lineLaunch?.modelo || lineId} · faturamento diário real`;
      const { dates, datasets, checkpoints } = buildCannibalSubmodelData(lineId);
      if (!dates.length || !datasets.length) return;
      createChart(canvasId, { type: 'line', data: { labels: dates, datasets }, options: sharedOptions(dates, checkpoints) });
    }
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

  function renderDplusComparison(selected) {
    if (!$('dplus-table')) return;
    const day = selectedPeriodEndDay(selected);
    if (day === null || day === undefined || selected.isFuture) {
      $('dplus-table').innerHTML = `<tr><td colspan="6" class="cell-muted">Lançamento planejado: o comparativo por idade de venda fica fora da análise até o início das vendas e dados reais.</td></tr>`;
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
    if (!$('ranking-grid')) return;
    const rankingWindowKey = selectedPeriodKey();
    const rankingWindowLabel = windowLabel(rankingWindowKey);
    const selectedWindowVelocity = (launch) => {
      const data = getWindow(launch, rankingWindowKey);
      const days = windowSpanDays(rankingWindowKey);
      return data?.receita && days ? data.receita / days : null;
    };
    const rankingDefs = [
      { title: 'Faturamento D+7', get: (l) => getWindow(l, '7d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 até D+7. Só entra quem tem a janela fechada ou histórico cadastrado.' },
      { title: 'Faturamento D+15', get: (l) => getWindow(l, '15d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 até D+15. Para ativos, depende do snapshot já ter alcançado D+15.' },
      { title: 'Faturamento D+30', get: (l) => getWindow(l, '30d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 até D+30. Nulos indicam janela ainda não fechada ou dado ausente.' },
      { title: 'Faturamento D+60', get: (l) => getWindow(l, '60d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 até D+60. Use com cuidado se poucos modelos tiverem essa janela.' },
      { title: 'Faturamento D+90', get: (l) => getWindow(l, '90d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 até D+90. É o marco mais completo, mas pode excluir modelos em curso.' },
      { title: 'Ticket/pedido D+30', get: (l) => getWindow(l, '30d')?.ticket, fmt: fmtBRL, tooltip: 'Fórmula: receita D+30 / pedidos D+30. Ajuda a avaliar valor médio por pedido, não volume total.' },
      { title: 'Pares D+30', get: (l) => getWindow(l, '30d')?.pares, fmt: fmtNum, tooltip: 'Quantidade de pares vendidos de D0 até D+30. Compara volume físico, independente de preço.' },
      { title: '% novos D+30', get: (l) => getWindow(l, '30d')?.novos_pct, fmt: fmtPct, tooltip: 'Fórmula: novos / (novos + recorrentes) no D+30. Fica vazio quando não há classificação auditada.' },
      { title: `Velocidade ${rankingWindowLabel}`, get: selectedWindowVelocity, fmt: fmtBRL, tooltip: `Fórmula: receita ${rankingWindowLabel} / quantidade de dias da janela. Compara ritmo no mesmo tempo de vida do lançamento.` }
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
        <div class="chart-title chart-title--with-tip" style="margin-bottom:10px">${labelTip(def.title, def.tooltip)}</div>
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
    if (!$('historical-average')) return;
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

    const metricWindowKey = selectedPeriodKey();
    const label = windowLabel(metricWindowKey);
    const selectedValue = getWindow(selected, metricWindowKey)?.receita ?? null;
    const refs = referencePool.filter((l) => isHistoricalLaunch(l) && getWindow(l, metricWindowKey)?.receita);
    const avg = refs.length ? refs.reduce((acc, launch) => acc + getWindow(launch, metricWindowKey).receita, 0) / refs.length : null;

    const diff = selectedValue !== null && avg !== null ? selectedValue - avg : null;
    const pct = diff !== null && avg ? diff / avg : null;

    $('historical-average').innerHTML = `
      <div class="card">
        <div class="metric-label">${labelTip('Linha destacada', `Receita da linha destacada na janela fechada ${label}. Cada modelo usa sua própria data de lançamento como início da contagem.`)}</div>
        <div class="metric-value">${fmtBRL(selectedValue)}</div>
        <div class="metric-sub">${escapeHtml(selected.modelo)} · ${escapeHtml(label)}</div>
      </div>
      <div class="card">
        <div class="metric-label">${labelTip('Média histórica', 'Média simples dos modelos históricos elegíveis na mesma janela de venda. Janela ausente fica fora da média, sem substituição por outro período.')}</div>
        <div class="metric-value">${fmtBRL(avg)}</div>
        <div class="metric-sub">Históricos disponíveis · ${escapeHtml(label)}</div>
      </div>
      <div class="card">
        <div class="metric-label">${labelTip('Diferença vs média', 'Fórmula: receita da linha destacada menos média histórica do grupo comparativo. Percentual = diferença / média histórica.')}</div>
        <div class="metric-value">${diff === null ? '—' : metricDelta(selectedValue, avg, fmtBRL)}</div>
        <div class="metric-sub">${pct === null ? '—' : fmtPct(pct)}</div>
      </div>`;
  }

  function renderComparison(tbodyId = 'comparison-table') {
    const tbody = $(tbodyId);
    if (!tbody) return;
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      tbody.innerHTML = comparisonEmptyMessage(15);
      return;
    }

    const selected = state.launches.find((l) => l.modelo_id === state.primaryModelId) || launches[0];
    const day = selectedPeriodEndDay(selected);
    const metricWindowKey = selectedPeriodKey();
    const metricWindowLabel = windowLabel(metricWindowKey);
    const referencePool = launches.some(isHistoricalLaunch)
      ? launches
      : comparableLaunches();
    const historicalRefs = referencePool.filter((l) => isHistoricalLaunch(l));
    const averageLabel = metricWindowLabel;
    const averageValues = historicalRefs
      .map((launch) => getWindow(launch, metricWindowKey)?.receita)
      .filter((value) => value !== null && value !== undefined);

    const historicalAverage = averageValues.length
      ? averageValues.reduce((acc, value) => acc + value, 0) / averageValues.length
      : null;

    const rows = launches.map((launch) => {
      const attribution = attributionForSelectedPeriod(launch);
      const j7 = getWindow(launch, '7d');
      const j15 = getWindow(launch, '15d');
      const j30 = getWindow(launch, '30d');
      const j60 = getWindow(launch, '60d');
      const j90 = getWindow(launch, '90d');
      const metricWindow = getWindow(launch, metricWindowKey);
      const metricRange = launchWindowRangeLabel(launch, metricWindowKey);
      const metricDays = windowSpanDays(metricWindowKey);
      const velocity = metricWindow?.receita && metricDays ? metricWindow.receita / metricDays : null;
      const deltaBase = metricWindow?.receita;
      return `
        <tr>
          <td class="model-name">${escapeHtml(launch.modelo)}<div class="metric-sub">D0: ${fmtDate(launch.d0)}</div></td>
          <td>${fmtBRL(metricWindow?.receita)}<div class="metric-sub">${day !== null && day !== undefined ? `D+${day}` : 'sem janela'} · ${escapeHtml(metricRange)}</div></td>
          <td class="num">${comparisonAttributionCell(attribution.receita_organica)}</td>
          <td class="num">${comparisonAttributionCell(attribution.receita_paga)}</td>
          <td>${fmtBRL(j7?.receita)}<div>${coverageBadge(launch, '7d')}</div></td>
          <td>${fmtBRL(j15?.receita)}<div>${coverageBadge(launch, '15d')}</div></td>
          <td>${fmtBRL(j30?.receita)}<div>${coverageBadge(launch, '30d')}</div></td>
          <td>${fmtBRL(j60?.receita)}<div>${coverageBadge(launch, '60d')}</div></td>
          <td>${fmtBRL(j90?.receita)}<div>${coverageBadge(launch, '90d')}</div></td>
          <td class="num">${fmtBRL(metricWindow?.ticket)}<div class="metric-sub">${escapeHtml(metricWindowLabel)}</div></td>
          <td class="num">${fmtNum(metricWindow?.pares)}<div class="metric-sub">${escapeHtml(metricWindowLabel)}</div></td>
          <td class="num">${fmtPct(metricWindow?.novos_pct, 1)}<div class="metric-sub">${escapeHtml(metricWindowLabel)}</div></td>
          <td class="num">${velocity == null ? '&mdash;' : `${fmtBRL(velocity)}/dia`}<div class="metric-sub">${escapeHtml(metricWindowLabel)}</div></td>
          <td class="num">${historicalAverage === null ? '&mdash;' : metricDelta(deltaBase, historicalAverage, fmtBRL)}<div class="metric-sub">vs média ${escapeHtml(averageLabel)}</div></td>
          <td>${sourceBadge(launch)}</td>
        </tr>`;
    }).join('');
    tbody.innerHTML = rows || `<tr><td colspan="15" class="cell-muted">Sem lançamentos com dados reais para comparar.</td></tr>`;
  }

  function comparisonAttributionCell(revenue) {
    const revenueValue = numberOrNull(revenue);
    if (revenueValue === null) {
      return '<span class="cell-muted">Aguardando vendas</span><div class="metric-sub">sem receita no JSON</div>';
    }
    return `${organicPaidValue(revenueValue)}<div class="metric-sub">venda atribuida</div>`;
  }

  function firstKnownCommercialNumber(row, keys) {
    for (const key of keys) {
      if (!row || !(key in row)) continue;
      const value = key === 'roas' ? roasNumberOrNull(row[key]) : numberOrNull(row[key]);
      if (value !== null && value !== undefined) return value;
    }
    return null;
  }

  function commercialMetricConfig(key = state.commercialChartMetric) {
    const configs = {
      investimento: { key: 'investimento', label: 'Investimento acumulado', short: 'Invest.', type: 'bar', unit: 'currency', help: 'Soma do investimento de mídia paga por janela acumulada.' },
      receita: { key: 'receita', label: 'Receita atribuída', short: 'Receita', type: 'bar', unit: 'currency', help: 'Receita atribuída na planilha ou em faturamento_campanha. Sem receita atribuída, a linha permanece vazia.' },
      roas: { key: 'roas', label: 'ROAS', short: 'ROAS', type: 'line', unit: 'ratio', help: 'Receita atribuída / investimento. Usa ROAS informado ou receita atribuída real; não usa faturamento total da janela do modelo.' },
      cpa: { key: 'cpa', label: 'CPA', short: 'CPA', type: 'line', unit: 'currency', help: 'Investimento / pedidos informados ou atribuídos na própria linha de mídia.' },
      cpp: { key: 'cpp', label: 'CPP', short: 'CPP', type: 'line', unit: 'currency', help: 'Investimento / pares informados na linha de mídia. Mantém a leitura separada de custo por sessão, que só existe se a planilha de mídia ganhar uma coluna de sessões por campanha.' },
      cpc: { key: 'cpc', label: 'CPC', short: 'CPC', type: 'line', unit: 'currency', help: 'Investimento / cliques. Só aparece quando o JSON trouxer cliques ou CPC.' }
    };
    return configs[key] || configs.investimento;
  }

  function commercialWindowKey(row) {
    const raw = String(row?.janela || '').trim().toLowerCase();
    if (WINDOW_KEYS.includes(raw)) return raw;
    return raw || 'sem_janela';
  }

  function commercialWindowLabel(key) {
    if (WINDOW_LABELS[key]) return WINDOW_LABELS[key];
    if (key === 'pre-d0') return 'Pre-D0';
    if (key === 'sem_janela') return 'Sem janela';
    const days = janelaEmDias(key);
    return days !== null ? `D+${days}` : String(key || 'Sem janela');
  }

  function commercialWindowRank(key) {
    if (WINDOW_KEYS.includes(key)) return WINDOW_KEYS.indexOf(key);
    const days = janelaEmDias(key);
    if (key === 'pre-d0') return -1;
    return days === null ? 999 : days;
  }

  function mediaRowMatchesSelectedPeriod(row, launch) {
    if (!isSpecificAnalysisPeriod()) return true;
    const selectedEnd = selectedPeriodEndDay(launch);
    if (selectedEnd === null) return true;
    const key = commercialWindowKey(row);
    if (key === 'pre-d0') return true;
    const days = janelaEmDias(key) ?? WINDOW_DAYS[key] ?? null;
    if (days !== null) return days <= selectedEnd;
    if (row.data_inicio || row.data_fim) {
      const d0 = analysisDayZero(launch);
      const startIdx = row.data_inicio ? dayIndex(d0, row.data_inicio) : null;
      const endIdx = row.data_fim ? dayIndex(d0, row.data_fim) : startIdx;
      if (startIdx === null && endIdx === null) return true;
      return (startIdx ?? endIdx) <= selectedEnd && (endIdx ?? startIdx) >= 0;
    }
    return true;
  }

  function crmRowMatchesSelectedPeriod(row, launch) {
    if (!isSpecificAnalysisPeriod()) return true;
    const endDay = selectedPeriodEndDay(launch);
    if (endDay === null) return true;
    const data = row.data_disparo || row.data || row.date;
    const idx = dayIndex(analysisDayZero(launch), data);
    return idx !== null && idx >= 0 && idx <= endDay;
  }

  function commercialMetricRowsForLaunch(launch) {
    const rawRows = (state.data?.midia_paga || [])
      .filter((row) => row.modelo_id === launch.modelo_id)
      .filter((row) => mediaRowMatchesSelectedPeriod(row, launch))
      .map((row) => normalizeMediaRow(row, launch));
    const detailedRows = enrichMediaEstimates(rawRows, launch).filter((row) => midiaValidaParaGraficoComercial(row));
    const pairsByWindow = new Map();
    const clicksByWindow = new Map();
    const cppByWindow = new Map();
    const cpcByWindow = new Map();

    detailedRows.forEach((row) => {
      const key = commercialWindowKey(row);
      const pares = firstKnownCommercialNumber(row, ['pares', 'pares_janela_agregados', 'quantidade']);
      const clicks = firstKnownCommercialNumber(row, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']);
      const cpp = firstKnownCommercialNumber(row, ['cpp', 'custo_por_par', 'custo_par']);
      const cpc = firstKnownCommercialNumber(row, ['cpc', 'custo_por_click', 'custo_por_clique']);
      if (pares !== null) pairsByWindow.set(key, (pairsByWindow.get(key) || 0) + pares);
      if (clicks !== null) clicksByWindow.set(key, (clicksByWindow.get(key) || 0) + clicks);
      if (cpp !== null) cppByWindow.set(key, cpp);
      if (cpc !== null) cpcByWindow.set(key, cpc);
    });

    const mediaMetricRows = aggregateMediaRows(detailedRows, launch, midiaValidaParaGraficoComercial)
      .map((row) => {
        const key = commercialWindowKey(row);
        const investimento = numberOrNull(row.investimento);
        const receita = numberOrNull(row.receita_atribuida);
        const receitaIsolada = row.janela_isolada_confiavel ? numberOrNull(row.receita_janela_isolada) : null;
        const pedidos = numberOrNull(row.pedidos);
        const pedidosIsolados = row.janela_isolada_confiavel ? numberOrNull(row.pedidos_janela_isolados) : null;
        const pares = firstKnownCommercialNumber(row, ['pares', 'pares_janela_agregados', 'quantidade']) ?? pairsByWindow.get(key) ?? null;
        const cliques = firstKnownCommercialNumber(row, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']) ?? clicksByWindow.get(key) ?? null;
        const roas = rowRoas(row) ?? (row.janela_isolada_confiavel ? roasNumberOrNull(row.roas_janela_isolada) : null) ?? (investimento && receita !== null ? receita / investimento : null);
        const cpa = numberOrNull(row.cpa) ?? (row.janela_isolada_confiavel ? numberOrNull(row.cpa_janela_isolada) : null) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
        const cpp = firstKnownCommercialNumber(row, ['cpp', 'custo_por_par', 'custo_par']) ?? cppByWindow.get(key) ?? (investimento !== null && pares ? investimento / pares : null);
        const cpc = firstKnownCommercialNumber(row, ['cpc', 'custo_por_click', 'custo_por_clique']) ?? cpcByWindow.get(key) ?? (investimento !== null && cliques ? investimento / cliques : null);
        return {
          launch,
          key,
          label: commercialWindowLabel(key),
          investimento,
          receita: receita ?? receitaIsolada,
          pedidos: pedidos ?? pedidosIsolados,
          pares,
          cliques,
          roas,
          cpa,
          cpp,
          cpc,
          source: row.receita_source || row.metodologia || (receitaIsolada !== null ? 'janela_isolada' : '')
        };
      })
      .sort((a, b) => commercialWindowRank(a.key) - commercialWindowRank(b.key));

    return aggregateCommercialChartRows([
      ...mediaMetricRows,
      ...crmMetricRowsForLaunch(launch)
    ]);
  }

  function commercialMetricValue(row, metricKey) {
    if (!row) return null;
    return row[metricKey] ?? null;
  }

  function normalizeChartMetricRow(row) {
    return {
      ...row,
      investimento: numberOrNull(row.investimento),
      receita: numberOrNull(row.receita),
      pedidos: numberOrNull(row.pedidos),
      pares: numberOrNull(row.pares),
      cliques: numberOrNull(row.cliques),
      roas: roasNumberOrNull(row.roas),
      cpa: numberOrNull(row.cpa),
      cpp: numberOrNull(row.cpp),
      cpc: numberOrNull(row.cpc)
    };
  }

  function sumMetricRows(rows, field) {
    const values = rows
      .map((row) => numberOrNull(row[field]))
      .filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
  }

  function weightedMetric(rows, field) {
    const weighted = rows
      .map((row) => ({
        value: field === 'roas' ? roasNumberOrNull(row[field]) : numberOrNull(row[field]),
        investimento: numberOrNull(row.investimento)
      }))
      .filter((row) => row.value !== null && row.investimento !== null && row.investimento > 0);
    if (!weighted.length) return null;
    const investimento = weighted.reduce((acc, row) => acc + row.investimento, 0);
    return investimento ? weighted.reduce((acc, row) => acc + row.value * row.investimento, 0) / investimento : null;
  }

  function aggregateCommercialChartRows(rows) {
    const groups = new Map();
    rows.map(normalizeChartMetricRow).forEach((row) => {
      const key = `${row.launch?.modelo_id || row.modelo_id || 'sem_modelo'}::${row.key || 'sem_janela'}`;
      const current = groups.get(key) || [];
      current.push(row);
      groups.set(key, current);
    });

    return [...groups.values()].map((items) => {
      const first = items[0];
      const investimento = sumMetricRows(items, 'investimento');
      const receita = sumMetricRows(items, 'receita');
      const pedidos = sumMetricRows(items, 'pedidos');
      const pares = sumMetricRows(items, 'pares');
      const cliques = sumMetricRows(items, 'cliques');
      const source = [...new Set(items.map((row) => row.source).filter(Boolean))].join(' + ');
      return {
        launch: first.launch,
        key: first.key,
        label: first.label,
        investimento,
        receita,
        pedidos,
        pares,
        cliques,
        roas: weightedMetric(items, 'roas') ?? (investimento && receita !== null ? receita / investimento : null),
        cpa: weightedMetric(items, 'cpa') ?? (investimento !== null && pedidos ? investimento / pedidos : null),
        cpp: weightedMetric(items, 'cpp') ?? (investimento !== null && pares ? investimento / pares : null),
        cpc: weightedMetric(items, 'cpc') ?? (investimento !== null && cliques ? investimento / cliques : null),
        source: source || 'midia_paga + crm_disparos'
      };
    }).sort((a, b) => commercialWindowRank(a.key) - commercialWindowRank(b.key));
  }

  function crmMetricRowsForLaunch(launch) {
    return (state.data?.crm_disparos || [])
      .filter((row) => row.modelo_id === launch.modelo_id)
      .filter((row) => crmRowMatchesSelectedPeriod(row, launch))
      .map((row) => {
        const normalized = normalizeCrmRow(row);
        const key = commercialWindowKey({ janela: inferCrmWindow(normalized, launch) });
        const investimento = numberOrNull(normalized.investimento);
        const receita = numberOrNull(normalized.receita_base);
        const pedidos = numberOrNull(normalized.pedidos);
        return {
          launch,
          key,
          label: commercialWindowLabel(key),
          investimento,
          receita,
          pedidos,
          pares: null,
          cliques: null,
          roas: rowRoas(normalized) ?? (investimento && receita !== null ? receita / investimento : null),
          cpa: numberOrNull(normalized.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null),
          cpp: null,
          cpc: null,
          source: 'crm_disparos'
        };
      });
  }

  function formatCommercialMetric(value, metric) {
    if (value === null || value === undefined || Number.isNaN(value)) return 'sem dado';
    if (metric.unit === 'ratio') return `${fmtNum(value, 2)}x`;
    return fmtBRL(value);
  }

  function renderCommercialEfficiencyChart(selected) {
    const canvasId = 'chart-normalized-media';
    const canvas = $(canvasId);
    if (!canvas || !window.Chart) return;

    state.charts[canvasId]?.destroy?.();
    delete state.charts[canvasId];

    const subText = $('chart-normalized-media-sub');
    const metric = commercialMetricConfig();
    const launches = selectedCompareLaunches()
      .filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
    const rowsByLaunch = new Map(launches.map((launch) => [launch.modelo_id, commercialMetricRowsForLaunch(launch)]));
    const allRows = [...rowsByLaunch.values()].flat();
    const windowKeys = [...new Set(allRows.map((row) => row.key))]
      .sort((a, b) => commercialWindowRank(a) - commercialWindowRank(b));

    if (!allRows.length || !windowKeys.length) {
      if (subText) subText.textContent = 'Sem mídia paga ou CRM cadastrados para os modelos selecionados.';
      return;
    }

    const hasAnyMetricValue = allRows.some((row) => commercialMetricValue(row, metric.key) !== null);
    if (subText) {
      subText.textContent = hasAnyMetricValue
        ? `${metric.label} por janela acumulada de mídia paga e CRM. Tooltip mostra investimento, receita, ROAS, CPA, CPP e CPC quando houver base.`
        : `${metric.label}: ainda sem base suficiente no JSON. ${metric.key === 'cpc' ? 'Inclua cliques ou CPC na exportação para habilitar esta leitura.' : 'Ausência fica vazia, não vira zero.'}`;
    }

    const chartLaunches = launches;
    createChart(canvasId, {
      type: metric.type,
      data: {
        labels: windowKeys.map(commercialWindowLabel),
        datasets: chartLaunches.map((launch, index) => {
          const rows = rowsByLaunch.get(launch.modelo_id) || [];
          const rowByWindow = new Map(rows.map((row) => [row.key, row]));
          const data = windowKeys.map((key) => commercialMetricValue(rowByWindow.get(key), metric.key));
          const isSelected = launch.modelo_id === selected?.modelo_id;
          return {
            label: launch.modelo,
            data,
            metricRows: rowByWindow,
            backgroundColor: metric.type === 'bar' ? colorFor(launch.modelo_id, index) : fillFor(launch.modelo_id, index),
            borderColor: colorFor(launch.modelo_id, index),
            borderWidth: isSelected ? 3 : 2,
            borderRadius: metric.type === 'bar' ? 4 : 0,
            fill: false,
            tension: metric.type === 'line' ? 0.18 : 0,
            pointRadius: metric.type === 'line' ? (isSelected ? 3.5 : 3) : 0,
            pointHoverRadius: 6,
            pointHitRadius: 12,
            spanGaps: true
          };
        })
      },
      options: chartOptions({
        interaction: { mode: 'nearest', intersect: false, axis: 'xy' },
        layout: { padding: { top: 10, right: 16, bottom: 6, left: 4 } },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              padding: 16,
              pointStyle: metric.type === 'line' ? 'circle' : 'rectRounded'
            }
          },
          tooltip: {
            callbacks: {
              title: (items) => {
                const item = items[0];
                return item ? `${item.dataset.label} · ${item.label}` : '';
              },
              label: (ctx) => `${metric.short}: ${formatCommercialMetric(ctx.parsed.y, metric)}`,
              afterLabel: (ctx) => {
                const key = windowKeys[ctx.dataIndex];
                const row = ctx.dataset.metricRows?.get(key);
                if (!row) return 'Sem mídia/CRM para esta janela.';
                return [
                  `Invest. ${formatCommercialMetric(row.investimento, commercialMetricConfig('investimento'))} · Receita ${formatCommercialMetric(row.receita, commercialMetricConfig('receita'))}`,
                  `ROAS ${formatCommercialMetric(row.roas, commercialMetricConfig('roas'))} · CPA ${formatCommercialMetric(row.cpa, commercialMetricConfig('cpa'))} · CPP ${formatCommercialMetric(row.cpp, commercialMetricConfig('cpp'))}`,
                  `Base ${fmtNum(row.pedidos)} ped. · ${fmtNum(row.pares)} pares · CPC ${formatCommercialMetric(row.cpc, commercialMetricConfig('cpc'))}`,
                  row.source ? `Fonte ${row.source}` : 'Fonte midia_paga + janela'
                ];
              }
            }
          }
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grace: metric.unit === 'ratio' ? '14%' : '10%',
            ticks: {
              maxTicksLimit: 5,
              callback: (value) => metric.unit === 'ratio' ? `${fmtNum(Number(value), 1)}x` : fmtBRL(Number(value), true)
            },
            grid: { color: 'rgba(255,255,255,0.045)' }
          }
        }
      })
    });
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
          windowKeys: labels,
          windowRanges: labels.map((key) => launchWindowRangeLabel(launch, key)),
          backgroundColor: colorFor(launch.modelo_id, index),
          borderColor: colorFor(launch.modelo_id, index),
          borderWidth: 1,
          borderRadius: 4
        }))
      },
      options: chartOptions({
        plugins: {
          legend: { position: 'bottom' },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}`,
              afterLabel: (ctx) => {
                const range = ctx.dataset.windowRanges?.[ctx.dataIndex] || 'janela sem data';
                return `Janela fixa ${ctx.label}: ${range}. Cada modelo usa o próprio D0; fonte: JSON de vendas ou histórico versionado.`;
              }
            }
          }
        },
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
          windowKeys: labels,
          windowRanges: labels.map((key) => launchWindowRangeLabel(launch, key)),
          backgroundColor: fillFor(launch.modelo_id, index),
          borderColor: colorFor(launch.modelo_id, index),
          borderWidth: 1,
          borderRadius: 4
        }))
      },
      options: chartOptions({
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)} pares`,
              afterLabel: (ctx) => {
                const range = ctx.dataset.windowRanges?.[ctx.dataIndex] || 'janela sem data';
                return `Janela fixa ${ctx.label}: ${range}. Nulo significa janela ausente, não zero.`;
              }
            }
          }
        },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => fmtNum(v) } } }
      })
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
      options: chartOptions({
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 2)}x`
            }
          }
        },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${fmtNum(v, 1)}×` } } }
      })
    });

    const mixWindowFor = (launch) => {
      const key = selectedPeriodKey();
      return {
        key,
        data: getWindow(launch, key)
      };
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
        ].concat(clientMixRows.some((row) => row.pct == null) ? [{
          label: 'Sem classificação',
          data: clientMixRows.map((row) => row.pct == null ? 100 : null),
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderRadius: 4
        }] : [])
      },
      options: chartOptions({
        indexAxis: 'y',
        layout: { padding: { top: 8, right: 12, bottom: 0, left: 2 } },
        scales: {
          x: { stacked: true, display: false, max: 100, grid: { display: false } },
          y: { stacked: true, grid: { display: false } }
        },
        plugins: {
          clientMixLabels: { rows: clientMixRows },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.label === 'Sem classificação') return 'Sem classificação: aguardando JSON de vendas';
                const row = clientMixRows[ctx.dataIndex];
                const value = ctx.dataset.label === 'Novos' ? row?.novos : row?.recorrentes;
                return `${ctx.dataset.label}: ${fmtNum(value)} clientes · ${fmtNum(ctx.parsed.x, 1)}%`;
              }
            }
          }
        }
      })
    });
    const mixMissing = clientMixRows.filter((row) => row.pct === null);
    $('client-mix-detail').innerHTML = clientMixRows.length ? `
      <div class="client-mix-summary">
        <span>${fmtNum(clientMixRows.length)} linhas exibidas</span>
        <span>${escapeHtml(selectedPeriodLabel())}</span>
        <span>${mixMissing.length ? `${fmtNum(mixMissing.length)} sem classificação de novos/recorrentes` : 'Todos com mix classificado'}</span>
      </div>
    ` : '';

    const weeklyLaunches = chartLaunches.filter((launch) => launch.semanas?.length);
    const weeklyLabels = [...new Set(weeklyLaunches.flatMap((launch) => launch.semanas.map((week) => week.label)))];
    $('weekly-title').textContent = weeklyLaunches.length ? 'Rampa semanal comparada' : 'Semana a semana';
    createChart('chart-weekly', {
      type: 'line',
      data: {
        labels: weeklyLabels,
        datasets: weeklyLaunches.map((launch, index) => ({
          label: launch.modelo,
          data: weeklyLabels.map((label) => launch.semanas.find((week) => week.label === label)?.receita ?? null),
          borderColor: colorFor(launch.modelo_id, index),
          backgroundColor: fillFor(launch.modelo_id, index),
          tension: 0.35,
          pointRadius: launch.modelo_id === selected.modelo_id ? 4 : 3,
          borderWidth: launch.modelo_id === selected.modelo_id ? 3 : 2
        }))
      },
      options: chartOptions({
        scales: {
          x: { grid: { display: false } },
          y: { position: 'left', ticks: { callback: (v) => fmtBRL(v, true) } }
        },
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}`,
              afterLabel: () => 'Semana relativa ao D0 de cada lançamento; compara a rampa semanal entre modelos.'
            }
          }
        }
      })
    });

    renderNormalizedChart(selected);
    renderCommercialEfficiencyChart(selected);
  }

  function colorRowsForLaunchPeriod(launch) {
    const rows = launchSalesRowsForSelectedPeriod(launch);
    if (rows.length) {
      return rows.map((row) => ({
        cor: extractColor({ ...row, modelo_id: launch.modelo_id }, launch),
        pares: Number(row.pares || row.quantidade || 0),
        receita_bruta: dashboardRevenueNumber(row),
        receita_liquida: Number(row.receita_liquida || 0),
        hasReceitaLiquida: row.receita_liquida !== null && row.receita_liquida !== undefined,
        pedidos: Number(row.pedidos_validos ?? row.pedidos ?? 0)
      }));
    }
    return isSpecificAnalysisPeriod() ? [] : (launch.cores || []);
  }

  function sizeRowsForLaunchPeriod(launch) {
    const rows = launchSalesRowsForSelectedPeriod(launch);
    if (rows.length) {
      return rows.map((row) => ({
        tamanho: row.tamanho || row.size || 'Sem tamanho',
        pares: Number(row.pares || row.quantidade || 0)
      }));
    }
    return isSpecificAnalysisPeriod() ? [] : (launch.tamanhos || []);
  }

  function renderColorMix() {
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione ao menos um modelo.</strong>O mix usa os modelos marcados em Comparar com.</div></div>`;
      return;
    }

    const cards = launches.map((launch) => {
      const colorsMap = new Map();
      colorRowsForLaunchPeriod(launch).forEach((row) => {
        const cor = extractColor({ ...row, modelo_id: launch.modelo_id }, launch);
        const current = colorsMap.get(cor) || {
          modelo_id: launch.modelo_id,
          modelo: launch.modelo,
          cor,
          pares: 0,
          receita_bruta: 0,
          receita_liquida: 0,
          hasReceitaLiquida: false,
          pedidos: 0
        };
        current.pares += Number(row.pares || 0);
        current.receita_bruta += dashboardRevenueNumber(row);
        if (row.receita_liquida !== null && row.receita_liquida !== undefined) {
          current.receita_liquida += Number(row.receita_liquida || 0);
          current.hasReceitaLiquida = true;
        }
        current.pedidos += Number(row.pedidos || 0);
        colorsMap.set(cor, current);
      });

      const allColors = [...colorsMap.values()];
      const validColors = allColors.filter((row) => !isUnknownColor(row.cor));
      const rankedSource = validColors.length ? validColors : allColors;
      const ranked = rankedSource
        .sort((a, b) => {
          const unknownDelta = Number(isUnknownColor(a.cor)) - Number(isUnknownColor(b.cor));
          if (unknownDelta) return unknownDelta;
          return Number(b.pares || 0) - Number(a.pares || 0) || String(a.cor).localeCompare(String(b.cor), 'pt-BR');
        });
      const total = rankedSource.reduce((acc, item) => acc + Number(item.pares || 0), 0);
      const max = ranked[0]?.pares || 0;
      return {
        launch,
        total,
        max,
        rows: ranked.slice(0, 3)
      };
    });

    if (!cards.some((card) => card.rows.length)) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Sem mix de cores.</strong>Dados entram pelo histórico estático ou pelo pipeline de venda por SKU.</div></div>`;
      return;
    }

    $('color-mix').innerHTML = cards.map((card) => {
      const { launch, total, max, rows } = card;
      return `<div class="color-card">
        <div class="color-title">${escapeHtml(launch.modelo)} ${tip('Top 3 cores por modelo. As cores são normalizadas por SKU, nome e campo de cor; sem cor só aparece quando não há outra cor válida.')}</div>
        ${rows.length ? rows.map((item, idx) => {
          const pctMax = max ? (item.pares / max) * 100 : 0;
          const pctTotal = total ? item.pares / total : null;
          const colorLabel = isUnknownColor(item.cor) ? UNKNOWN_COLOR_LABEL : item.cor;
          return `<div class="color-row">
            <div class="color-label" title="${escapeHtml(colorLabel)}">${escapeHtml(colorLabel)}</div>
            <div class="bar-track"><div class="bar-fill ${idx ? 'secondary' : ''}" style="width:${pctMax}%"></div></div>
            <div class="color-value" tabindex="0" data-tooltip="${tooltipAttr('Percentual = pares da cor / pares totais com cor valida no modelo. Barra visual normalizada pela maior cor do modelo.')}">${fmtNum(item.pares)} pares &middot; ${fmtPct(pctTotal, 0)}</div>
          </div>`;
        }).join('') : '<div class="color-empty">Sem cores classificadas.</div>'}
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

    const rows = launches.flatMap((launch) => sizeRowsForLaunchPeriod(launch).map((row) => ({
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
            <thead><tr>${thTip('#', 'Posição no ranking do conjunto selecionado.')} ${thTip('Tamanho', 'Tamanho extraído de SKU, nome do item ou variant_title quando disponível.')} ${thTip('Pares vendidos', 'Soma de pares classificados naquele tamanho.', 'num')} ${thTip('% do total', 'Fórmula: pares do tamanho / pares totais com tamanho no grupo.', 'num')}</tr></thead>
            <tbody>${tableRows(geral)}</tbody>
          </table>
        </div>
        <div class="size-model-grid">
          ${byModel.map((group) => `<div class="table-wrap">
            <table>
              <thead>
                <tr><th colspan="4">${escapeHtml(group.launch.modelo)} ${tip('Top tamanhos dentro deste modelo. Percentuais usam apenas pares classificados para o próprio modelo.')}</th></tr>
                <tr>${thTip('#', 'Posição no ranking do modelo.')} ${thTip('Tamanho', 'Tamanho detectado no item/SKU.')} ${thTip('Pares vendidos', 'Soma de pares daquele tamanho no modelo.', 'num')} ${thTip('% do total', 'Fórmula: pares do tamanho / pares totais do modelo com tamanho.', 'num')}</tr>
              </thead>
              <tbody>${tableRows(group.rows)}</tbody>
            </table>
          </div>`).join('')}
        </div>
      </div>`;
  }

  function computeCutDeviation(rows, keyField) {
    const map = new Map();
    rows.forEach((row) => {
      const key = row[keyField] || 'sem_dado';
      map.set(key, (map.get(key) || 0) + Number(row.pares || 0));
    });
    const entries = [...map.entries()].filter(([key]) => {
      const normalized = normalizeText(key);
      return key !== 'sem_dado'
        && key !== 'sem_cor'
        && normalized !== 'sem dado'
        && normalized !== 'sem cor'
        && normalized !== 'sem tamanho'
        && !isUnknownColor(key);
    });
    const total = entries.reduce((acc, [, pares]) => acc + pares, 0);
    if (entries.length < 2 || !total) return [];
    const avgShare = 1 / entries.length;
    return entries
      .map(([key, pares]) => {
        const share = pares / total;
        return { key, pares, share, deltaPp: (share - avgShare) * 100 };
      })
      .sort((a, b) => b.deltaPp - a.deltaPp);
  }

  function renderCutPromotersDetractors(selected) {
    const container = $('cut-promoters-detractors');
    if (!container) return;

    const launches = comparisonLaunchesWithFocus(selected);
    const allCuts = launches.flatMap((launch) => {
      const coresRows = colorRowsForLaunchPeriod(launch).map((row) => ({
        ...row,
        cor: extractColor({ ...row, modelo_id: launch.modelo_id }, launch)
      }));
      const tamanhoRows = sizeRowsForLaunchPeriod(launch);
      const coresDeviation = computeCutDeviation(coresRows, 'cor');
      const tamanhoDeviation = computeCutDeviation(tamanhoRows, 'tamanho');
      return [
        ...coresDeviation.map((row) => ({ ...row, dimensao: 'Cor', modelo: launch.modelo })),
        ...tamanhoDeviation.map((row) => ({ ...row, dimensao: 'Tamanho', modelo: launch.modelo }))
      ];
    }).sort((a, b) => b.deltaPp - a.deltaPp);

    if (!allCuts.length) {
      container.innerHTML = `<div class="empty-state"><div><strong>Sem cortes suficientes no grupo comparativo.</strong>Precisa de ao menos 2 cores ou tamanhos classificados por lançamento.</div></div>`;
      return;
    }

    const promoters = allCuts.filter((row) => row.deltaPp > 0).slice(0, 3);
    const detractors = allCuts.filter((row) => row.deltaPp < 0).slice(-3).reverse();

    const barRow = (row) => `
      <div class="cut-row">
        <div class="cut-row-label">${escapeHtml(row.modelo || '')} &middot; ${escapeHtml(row.dimensao)} &middot; ${escapeHtml(String(row.key))}</div>
        <div class="bar-track"><div class="bar-fill ${row.deltaPp >= 0 ? 'positive' : 'negative'}" style="width:${Math.min(100, row.share * 200).toFixed(1)}%"></div></div>
        <div class="cut-row-value">${fmtPct(row.share, 0)} <span class="${row.deltaPp >= 0 ? 'delta-pos' : 'delta-neg'}">${row.deltaPp >= 0 ? '+' : ''}${fmtNum(row.deltaPp, 1)}pp</span></div>
      </div>`;

    container.innerHTML = `
      <div class="cut-group">
        <div class="cut-group-title">Promotores</div>
        ${promoters.length ? promoters.map(barRow).join('') : '<div class="cut-empty">Sem corte acima da média.</div>'}
      </div>
      <div class="cut-group">
        <div class="cut-group-title">Ofensores</div>
        ${detractors.length ? detractors.map(barRow).join('') : '<div class="cut-empty">Sem corte abaixo da média.</div>'}
      </div>
      <p class="cut-note">Cada corte compara sua participação contra a média interna do respectivo lançamento; o ranking coloca os desvios de todos os modelos lado a lado.</p>
    `;
  }

  function validComparativeCutKey(key, dimension) {
    const normalized = normalizeText(key);
    if (!key
      || key === 'sem_dado'
      || key === 'sem_cor'
      || normalized === 'sem dado'
      || normalized === 'sem cor'
      || normalized === 'sem tamanho') {
      return false;
    }
    return dimension !== 'Cor' || !isUnknownColor(key);
  }

  function cutShareRowsForLaunch(launch, dimension, rows, keyField) {
    const map = new Map();
    rows.forEach((row) => {
      const key = row[keyField] || '';
      if (!validComparativeCutKey(key, dimension)) return;
      const pares = Number(row.pares || 0);
      if (!Number.isFinite(pares) || pares <= 0) return;
      const normalizedKey = normalizeText(key);
      const current = map.get(normalizedKey) || { key: String(key), normalizedKey, pares: 0 };
      current.pares += pares;
      map.set(normalizedKey, current);
    });

    const entries = [...map.values()];
    const total = entries.reduce((acc, item) => acc + item.pares, 0);
    if (!total) return [];

    return entries.map((item) => ({
      modelo_id: launch.modelo_id,
      modelo: launch.modelo,
      dimensao: dimension,
      key: item.key,
      normalizedKey: item.normalizedKey,
      pares: item.pares,
      share: item.pares / total,
      range: launchWindowRangeLabel(launch, selectedPeriodKey())
    }));
  }

  function comparativeCutDeviationRows(launches) {
    const rows = launches.flatMap((launch) => {
      const colorRows = colorRowsForLaunchPeriod(launch).map((row) => ({
        ...row,
        cor: extractColor({ ...row, modelo_id: launch.modelo_id }, launch)
      }));
      const sizeRows = sizeRowsForLaunchPeriod(launch);
      return [
        ...cutShareRowsForLaunch(launch, 'Cor', colorRows, 'cor'),
        ...cutShareRowsForLaunch(launch, 'Tamanho', sizeRows, 'tamanho')
      ];
    });

    const byCut = new Map();
    rows.forEach((row) => {
      const key = `${row.dimensao}::${row.normalizedKey}`;
      const list = byCut.get(key) || [];
      list.push(row);
      byCut.set(key, list);
    });

    return rows.map((row) => {
      const comparable = byCut.get(`${row.dimensao}::${row.normalizedKey}`) || [];
      const cohortAvgShare = comparable.length
        ? comparable.reduce((acc, item) => acc + item.share, 0) / comparable.length
        : null;
      return {
        ...row,
        comparableCount: comparable.length,
        cohortAvgShare,
        deltaPp: cohortAvgShare === null ? 0 : (row.share - cohortAvgShare) * 100
      };
    }).filter((row) => row.comparableCount >= 2 && Number.isFinite(row.deltaPp));
  }

  function renderCutPromotersDetractorsComparative(selected) {
    const container = $('cut-promoters-detractors');
    if (!container) return;

    const launches = comparisonLaunchesWithFocus(selected);
    const allCuts = comparativeCutDeviationRows(launches);

    if (!allCuts.length) {
      container.innerHTML = `<div class="empty-state"><div><strong>Sem cortes comparáveis no grupo comparativo.</strong>Precisa do mesmo corte em pelo menos 2 lançamentos na janela ${escapeHtml(selectedPeriodLabel())}.</div></div>`;
      return;
    }

    const promoters = [...allCuts].filter((row) => row.deltaPp > 0).sort((a, b) => b.deltaPp - a.deltaPp).slice(0, 5);
    const detractors = [...allCuts].filter((row) => row.deltaPp < 0).sort((a, b) => a.deltaPp - b.deltaPp).slice(0, 5);
    const maxAbs = Math.max(...[...promoters, ...detractors].map((row) => Math.abs(row.deltaPp)), 1);

    const barRow = (row) => `
      <div class="cut-row">
        <div class="cut-row-label">
          <strong>${escapeHtml(row.modelo || '')} &middot; ${escapeHtml(row.dimensao)} &middot; ${escapeHtml(String(row.key))}</strong>
          <small>${escapeHtml(row.range)} &middot; ${fmtNum(row.comparableCount)} no grupo</small>
        </div>
        <div class="bar-track"><div class="bar-fill ${row.deltaPp >= 0 ? 'positive' : 'negative'}" style="width:${Math.max(6, Math.min(100, (Math.abs(row.deltaPp) / maxAbs) * 100)).toFixed(1)}%"></div></div>
        <div class="cut-row-value">
          <strong class="${row.deltaPp >= 0 ? 'delta-pos' : 'delta-neg'}">${row.deltaPp >= 0 ? '+' : ''}${fmtNum(row.deltaPp, 1)}pp</strong>
          <small>${fmtPct(row.share, 0)} vs média ${fmtPct(row.cohortAvgShare, 0)}</small>
        </div>
      </div>`;

    container.innerHTML = `
      <div class="cut-group">
        <div class="cut-group-title">Destaques positivos</div>
        ${promoters.length ? promoters.map(barRow).join('') : '<div class="cut-empty">Sem corte acima da média do grupo.</div>'}
      </div>
      <div class="cut-group">
        <div class="cut-group-title">Pontos de atenção</div>
        ${detractors.length ? detractors.map(barRow).join('') : '<div class="cut-empty">Sem corte abaixo da média do grupo.</div>'}
      </div>
      <p class="cut-note">Comparação por ${escapeHtml(selectedPeriodLabel())}: cada modelo usa a própria data de lançamento; desvio = share do corte no lançamento menos a média do mesmo corte no grupo comparativo.</p>
    `;
  }

  function seasonalWeight(peso) {
    const key = normalizeText(peso);
    if (key === 'forte') return 3;
    if (key === 'medio') return 2;
    if (key === 'baixo') return 1;
    return 1;
  }

  function seasonalMeta(tipo) {
    const key = normalizeText(tipo);
    if (key === 'promotor') return { cls: 'pos', icon: '+', label: 'Promotor', sign: 1 };
    if (key === 'ofensor') return { cls: 'neg', icon: '-', label: 'Ofensor', sign: -1 };
    return { cls: 'neu', icon: '0', label: 'Neutro', sign: 0 };
  }

  function seasonalImpact(event) {
    const meta = seasonalMeta(event.tipo);
    return meta.sign * seasonalWeight(event.peso);
  }

  function seasonalWeightLabel(peso) {
    const key = normalizeText(peso);
    if (key === 'forte') return 'forte';
    if (key === 'medio') return 'médio';
    if (key === 'baixo') return 'baixo';
    return 'baixo';
  }

  function seasonalPhase(day, end) {
    if (end <= 0) return 'D0';
    const pct = day / end;
    if (pct < 0.34) return 'inicio da janela';
    if (pct < 0.67) return 'meio da janela';
    return 'fim da janela';
  }

  function seasonalEventsFor(selected, endDay) {
    const start = toDate(selected.d0);
    const end = addDays(selected.d0, endDay);
    const observedCutoff = selected.isFuture
      ? -1
      : Math.max(0, Math.min(90, selected.dPlus ?? endDay));

    return (state.data.calendario_br || [])
      .map((event) => {
        const date = toDate(event.data);
        const day = dayIndex(selected.d0, event.data);
        return {
          ...event,
          date,
          day,
          score: seasonalImpact(event),
          observed: day !== null && day <= observedCutoff,
          phase: day === null ? 'fora da janela' : seasonalPhase(day, endDay)
        };
      })
      .filter((event) => event.date && event.date >= start && event.date <= end)
      .sort((a, b) => a.day - b.day || String(a.nome).localeCompare(String(b.nome)));
  }

  function seasonalCounts(events) {
    return events.reduce((acc, event) => {
      const key = normalizeText(event.tipo);
      if (key === 'promotor') acc.promotores += 1;
      else if (key === 'ofensor') acc.ofensores += 1;
      else acc.neutros += 1;
      return acc;
    }, { promotores: 0, ofensores: 0, neutros: 0 });
  }

  function seasonalClass(score, events) {
    if (!events.length) return 'clean';
    if (score > 0) return 'pos';
    if (score < 0) return 'neg';
    return 'neu';
  }

  function seasonalScoreLabel(score, events) {
    if (!events.length) return 'Limpa';
    if (score > 0) return `Favorável +${score}`;
    if (score < 0) return `Risco ${score}`;
    return 'Neutra 0';
  }

  function seasonalRead(events, score, observedScore) {
    if (!events.length) return 'Sem promotor, ofensor ou neutro cadastrado para esta janela.';
    const futureCount = events.filter((event) => !event.observed).length;
    if (score > 0 && observedScore <= 0 && futureCount) return 'Impulso positivo está dentro da janela, mas ainda não entrou no acumulado atual.';
    if (score > 0) return 'Promotores superam ofensores; compare esta janela com cautela porque existe vento a favor.';
    if (score < 0) return 'Ofensores pesam mais que promotores; queda relativa pode ser efeito de calendário.';
    return 'Eventos sem direção clara; use como contexto, não como explicação principal.';
  }

  function renderCalendar(selected) {
    const windows = selectedPeriodWindowKeys(selected).map((key) => ({
      key,
      label: windowLabel(key),
      end: windowEndDay(key) || 0
    }));
    const analyses = windows.map((win) => {
      const events = seasonalEventsFor(selected, win.end);
      const counts = seasonalCounts(events);
      const score = events.reduce((acc, event) => acc + event.score, 0);
      const observedScore = events.filter((event) => event.observed).reduce((acc, event) => acc + event.score, 0);
      return {
        ...win,
        events,
        counts,
        score,
        observedScore,
        cls: seasonalClass(score, events),
        scoreLabel: seasonalScoreLabel(score, events),
        read: seasonalRead(events, score, observedScore)
      };
    });
    const selectedAnalysis = analyses[analyses.length - 1] || { label: selectedPeriodLabel(), end: selectedPeriodEndDay(selected) ?? 90, events: [], counts: seasonalCounts([]), score: 0, observedScore: 0, cls: 'clean' };
    const strongest = [...selectedAnalysis.events].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
    const observedEvents = selectedAnalysis.events.filter((event) => event.observed);
    const futureEvents = selectedAnalysis.events.filter((event) => !event.observed);
    const summaryRead = selectedAnalysis.events.length
      ? `${observedEvents.length} evento(s) já observado(s) e ${futureEvents.length} evento(s) futuro(s) até ${selectedAnalysis.label}.`
      : `Nenhum evento cadastrado entre D0 e ${selectedAnalysis.label}.`;
    const cohortCalendarRows = comparisonLaunchesWithFocus(selected)
      .map((launch) => {
        const events = seasonalEventsFor(launch, selectedAnalysis.end);
        const counts = seasonalCounts(events);
        const score = events.reduce((acc, event) => acc + event.score, 0);
        return {
          launch,
          events,
          counts,
          score,
          cls: seasonalClass(score, events),
          scoreLabel: seasonalScoreLabel(score, events)
        };
      })
      .sort((a, b) => b.score - a.score);
    const cohortCalendarHtml = cohortCalendarRows.length
      ? `<div class="calendar-cohort-row">
          ${cohortCalendarRows.map((row) => `<div class="calendar-card calendar-card--${row.cls}">
            <div class="calendar-title"><span>${escapeHtml(row.launch.modelo)}<small>${escapeHtml(selectedAnalysis.label)}</small></span>${row.launch.modelo_id === selected.modelo_id ? badge('focus', 'Foco') : ''}</div>
            <div class="seasonal-score seasonal-score--${row.cls}">${escapeHtml(row.scoreLabel)}</div>
            <div class="metric-sub">${fmtNum(row.counts.promotores)} promotores · ${fmtNum(row.counts.ofensores)} ofensores · ${fmtNum(row.counts.neutros)} neutros</div>
          </div>`).join('')}
        </div>`
      : '';

    $('calendar-grid').innerHTML = `
      <div class="calendar-summary calendar-summary--${selectedAnalysis.cls}">
        <div>
          <div class="metric-label">${labelTip(`Saldo sazonal ${selectedAnalysis.label}`, 'Soma ponderada dos eventos no calendário dentro do período selecionado. Promotor soma, ofensor subtrai e neutro vale 0; peso forte=3, médio=2, baixo=1.')}</div>
          <div class="seasonal-score seasonal-score--${selectedAnalysis.cls}">${escapeHtml(seasonalScoreLabel(selectedAnalysis.score, selectedAnalysis.events))}</div>
          <div class="metric-sub">${escapeHtml(summaryRead)}</div>
        </div>
        <div class="seasonal-stat-grid">
          <div><span>${labelTip('Promotores', 'Eventos esperados como vento a favor de venda ou atenção comercial.')}</span><strong>${fmtNum(selectedAnalysis.counts.promotores)}</strong></div>
          <div><span>${labelTip('Ofensores', 'Eventos que podem reduzir comparabilidade ou pressionar performance relativa.')}</span><strong>${fmtNum(selectedAnalysis.counts.ofensores)}</strong></div>
          <div><span>${labelTip('Neutros', 'Eventos cadastrados como contexto sem direção clara de impacto.')}</span><strong>${fmtNum(selectedAnalysis.counts.neutros)}</strong></div>
          <div><span>${labelTip('Mais forte', 'Evento com maior peso absoluto dentro do período selecionado.')}</span><strong>${strongest ? escapeHtml(strongest.nome) : '&mdash;'}</strong></div>
        </div>
      </div>
      ${cohortCalendarHtml}
      ${analyses.map((win) => `<div class="calendar-card calendar-card--${win.cls}">
        <div class="calendar-title">
          <span>${win.label}<small>${escapeHtml(win.scoreLabel)}</small></span>
          ${coverageBadge(selected, win.key)}
        </div>
        <div class="seasonal-window-status">
          <div class="seasonal-counts">
            <span>+${fmtNum(win.counts.promotores)} promotor</span>
            <span>-${fmtNum(win.counts.ofensores)} ofensor</span>
            <span>${fmtNum(win.counts.neutros)} neutro</span>
          </div>
          <p>${escapeHtml(win.read)}</p>
        </div>
        ${win.events.length ? `<div class="event-list">${win.events.map((event) => {
          const meta = seasonalMeta(event.tipo);
          const impact = event.score > 0 ? `+${event.score}` : String(event.score);
          return `<div class="event event--${meta.cls}">
            <div class="event-icon ${meta.cls}">${meta.icon}</div>
            <div>
              <div class="event-name">
                ${escapeHtml(event.nome)}
                <span class="event-pill event-pill--${meta.cls}" tabindex="0" data-tooltip="${tooltipAttr(`Tipo ${meta.label}; peso ${seasonalWeightLabel(event.peso)}. Impacto no saldo: ${impact}.`)}">${escapeHtml(meta.label)} ${escapeHtml(seasonalWeightLabel(event.peso))}</span>
                <span class="event-state" tabindex="0" data-tooltip="${tooltipAttr(event.observed ? 'Evento já entrou no acumulado observado do snapshot.' : 'Evento está dentro da janela, mas ainda não ocorreu no acumulado atual.')}">${event.observed ? 'observado' : 'futuro'}</span>
              </div>
              <div class="event-meta">${fmtDate(event.data)} · D+${fmtNum(event.day)} · impacto ${escapeHtml(impact)} · ${escapeHtml(event.phase)}</div>
              ${event.observacao ? `<div class="event-copy">${escapeHtml(event.observacao)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}</div>` : `<div class="empty-state seasonal-empty"><div><strong>Janela limpa.</strong> Sem evento cadastrado entre D0 e D+${fmtNum(win.end)}.</div></div>`}
      </div>`).join('')}`;
  }

  function roasBadge(value) {
    if (value === null || value === undefined) return badge('parcial', '—', 'Sem ROAS cadastrado na planilha para esta linha.');
    if (value < 1) return badge('neg', 'Crítico', 'ROAS abaixo de 1x: a receita atribuída/informada é menor que o investimento informado.');
    if (value < 3) return badge('parcial', 'Atenção', 'ROAS entre 1x e 3x: leitura intermediária; confira atribuição, janela e custo cadastrado.');
    return badge('pipeline', 'Eficiente', 'ROAS acima de 3x: a receita atribuída/informada supera o investimento com folga.');
  }

  function metodologiaComercialBadge(row) {
    const metodologia = String(row?.metodologia || '').trim();
    const aviso = String(row?.aviso || '').trim();
    if (!metodologia && !aviso) return '';
    const label = metodologia === 'correlacao_por_janela_calendario'
      ? 'correl.'
      : metodologia === 'janela_isolada' ? 'isolada' : 'metod.';
    const text = `${aviso || 'Leitura comercial estimada; não representa atribuição real de clique/conversão.'} Metodologia: ${metodologia || 'não informada'}.`;
    return ` ${badge('parcial', label, text)}`;
  }

  function suspeitaComercialBadge(row) {
    const parts = [];
    if (row?.data_suspeita) parts.push(`Data suspeita: ${row.data_suspeita_motivo || 'sem motivo informado'}.`);
    if (row?.valor_suspeito) parts.push(`Valor suspeito: ${row.valor_suspeito_motivo || 'sem motivo informado'}.`);
    return parts.length ? ` ${badge('neg', 'revisar', parts.join(' '))}` : '';
  }

  function janelaEmDias(janelaStr) {
    const match = String(janelaStr || '').match(/(\d+)d/);
    return match ? parseInt(match[1], 10) : null;
  }

  function validarJanelaMidia(row) {
    if (!row.data_inicio || !row.data_fim) return { valida: false, motivo: 'data_inicio_ou_fim_ausente' };
    const inicio = toDate(row.data_inicio);
    const fim = toDate(row.data_fim);
    if (!inicio || !fim) return { valida: false, motivo: 'data_inicio_ou_fim_invalida' };
    const diasReais = Math.round((fim - inicio) / 86400000);
    const diasDeclarados = janelaEmDias(row.janela);
    if (diasReais < 0) return { valida: false, motivo: 'data_fim_anterior_a_data_inicio' };
    if (diasDeclarados !== null && Math.abs(diasReais - diasDeclarados) > 5) {
      return { valida: false, motivo: `janela_declarada_${diasDeclarados}d_mas_intervalo_real_${diasReais}d` };
    }
    return { valida: true };
  }

  function marcarQualidadeValorMidia(rows) {
    const out = rows.map((row) => ({ ...row }));
    const byModel = new Map();
    out.forEach((row, index) => {
      const dias = janelaEmDias(row.janela);
      if (!row.modelo_id || dias === null || row.investimento === null || row.investimento === undefined) return;
      const current = byModel.get(row.modelo_id) || [];
      current.push({ index, dias, investimento: Number(row.investimento || 0) });
      byModel.set(row.modelo_id, current);
    });

    byModel.forEach((items) => {
      const ordered = items.sort((a, b) => a.dias - b.dias || a.index - b.index);
      ordered.forEach((item) => {
        const lowerDays = [...new Set(ordered.filter((other) => other.dias < item.dias).map((other) => other.dias))].sort((a, b) => b - a)[0];
        const higherDays = [...new Set(ordered.filter((other) => other.dias > item.dias).map((other) => other.dias))].sort((a, b) => a - b)[0];
        const lowerMax = lowerDays === undefined ? null : Math.max(...ordered.filter((other) => other.dias === lowerDays).map((other) => other.investimento));
        const higherMax = higherDays === undefined ? null : Math.max(...ordered.filter((other) => other.dias === higherDays).map((other) => other.investimento));
        if (higherMax !== null && item.investimento > higherMax) {
          out[item.index].valor_suspeito = true;
          out[item.index].valor_suspeito_motivo = out[item.index].valor_suspeito_motivo || 'investimento_maior_que_janela_mais_longa';
        } else if (lowerMax !== null && lowerMax > 0 && item.investimento > lowerMax * 5) {
          out[item.index].valor_suspeito = true;
          out[item.index].valor_suspeito_motivo = out[item.index].valor_suspeito_motivo || 'investimento_desproporcional_a_janela_adjacente';
        }
      });
    });

    return out;
  }

  function midiaValidaParaImpacto(row) {
    return !row?.data_suspeita && !row?.valor_suspeito;
  }

  function midiaValidaParaGraficoComercial(row) {
    if (!row || row.valor_suspeito) return false;
    if (!row.data_suspeita) return true;
    const hasDeclaredWindow = janelaEmDias(row.janela) !== null;
    const hasInvestment = numberOrNull(row.investimento) !== null;
    return hasDeclaredWindow
      && hasInvestment
      && String(row.data_suspeita_motivo || '') === 'data_inicio_ou_fim_ausente';
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

  function inferCrmWindow(row, launch) {
    if (row.janela) return row.janela;
    const data = row.data_disparo || row.data || row.date;
    return inferMediaWindow({ data_inicio: data, data_fim: data }, launch);
  }

  function rowRoas(row) {
    return roasNumberOrNull(row.roas);
  }

  function mediaRevenueBase(row) {
    const attributed = numberOrNull(row.receita_atribuida);
    if (attributed !== null) return { value: attributed, source: 'atribuida' };
    return { value: null, source: null };
  }

  function normalizeMediaRow(row, launch) {
    const campanha = row.campanha || 'Campanha sem nome';
    const canal = row.canal || '—';
    const janela = inferMediaWindow(row, launch);
    const campaignRevenue = campaignRevenueForMedia({ ...row, campanha, canal, janela }, launch);
    const investimento = numberOrNull(row.investimento);
    const receitaBase = mediaRevenueBase(row);
    const receitaCampanha = campaignRevenueValue(campaignRevenue);
    const receita = receitaBase.value ?? receitaCampanha;
    const receitaSource = receitaBase.source || (receitaCampanha !== null ? 'faturamento_campanha' : null);
    const pedidos = numberOrNull(row.pedidos) ?? firstKnownCommercialNumber(campaignRevenue, ['pedidos', 'orders']);
    const roas = rowRoas(row) ?? roasNumberOrNull(campaignRevenue?.roas) ?? (investimento && receita !== null ? receita / investimento : null);
    const cpa = numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
    const validacaoData = validarJanelaMidia({ ...row, janela });
    return {
      modelo_id: launch.modelo_id,
      modelo: launch.modelo,
      linha: row.linha || launch.linha || null,
      campanha,
      janela,
      data_inicio: row.data_inicio || null,
      data_fim: row.data_fim || null,
      canal,
      investimento,
      receita_atribuida: receita,
      receita_janela_agregada: numberOrNull(row.receita_janela_agregada),
      receita_janela_isolada: numberOrNull(row.receita_janela_isolada),
      receita_source: receitaSource,
      pedidos,
      pedidos_janela_agregados: numberOrNull(row.pedidos_janela_agregados),
      pedidos_janela_isolados: numberOrNull(row.pedidos_janela_isolados),
      pares: firstKnownCommercialNumber(row, ['pares', 'pares_janela_agregados', 'quantidade']) ?? firstKnownCommercialNumber(campaignRevenue, ['pares', 'quantidade']),
      cliques: firstKnownCommercialNumber(row, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']) ?? firstKnownCommercialNumber(campaignRevenue, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']),
      roas,
      cpa,
      roas_janela_isolada: roasNumberOrNull(row.roas_janela_isolada),
      cpa_janela_isolada: numberOrNull(row.cpa_janela_isolada),
      cpp: firstKnownCommercialNumber(row, ['cpp', 'custo_por_par', 'custo_par']),
      cpc: firstKnownCommercialNumber(row, ['cpc', 'custo_por_click', 'custo_por_clique']),
      status: row.status || '',
      metodologia: row.metodologia || (receitaSource === 'faturamento_campanha' ? 'faturamento_campanha' : ''),
      aviso: row.aviso || (receitaSource === 'faturamento_campanha' ? 'Receita atribuida por campanha via data/faturamento_campanha.json.' : ''),
      janela_isolada_confiavel: Boolean(row.janela_isolada_confiavel),
      janela_isolada_motivo: row.janela_isolada_motivo || null,
      data_suspeita: row.data_suspeita !== undefined ? Boolean(row.data_suspeita) : !validacaoData.valida,
      data_suspeita_motivo: row.data_suspeita_motivo || (validacaoData.valida ? null : validacaoData.motivo),
      valor_suspeito: Boolean(row.valor_suspeito),
      valor_suspeito_motivo: row.valor_suspeito_motivo || null,
      atribuicao_bloqueada: Boolean(row.atribuicao_bloqueada)
    };
  }

  function mediaWindowMetric(row, launch) {
    const janela = String(row.janela || '').trim().toLowerCase();
    if (WINDOW_KEYS.includes(janela)) return getWindow(launch, janela);
    return null;
  }

  function markDuplicatedMediaAttribution(rows) {
    const out = rows.map((row) => ({ ...row }));
    const groups = new Map();
    out.forEach((row, index) => {
      const key = `${row.modelo_id || 'sem_modelo'}::${row.janela || 'sem_janela'}`;
      const current = groups.get(key) || [];
      current.push({ row, index });
      groups.set(key, current);
    });

    groups.forEach((items) => {
      const withRevenue = items.filter(({ row }) => (
        midiaValidaParaImpacto(row)
        && row.receita_atribuida !== null
        && row.receita_atribuida !== undefined
      ));
      const channels = new Set(withRevenue.map(({ row }) => normalizeText(row.canal || row.campanha)).filter(Boolean));
      const revenueValues = [...new Set(withRevenue.map(({ row }) => Math.round(Number(row.receita_atribuida || 0) * 100) / 100))];
      if (withRevenue.length < 2 || channels.size < 2 || revenueValues.length !== 1) return;

      const janelaRevenue = revenueValues[0];
      withRevenue.forEach(({ index }) => {
        out[index].receita_janela_agregada = janelaRevenue;
        out[index].pedidos_janela_agregados = out[index].pedidos ?? null;
        out[index].receita_atribuida = null;
        out[index].pedidos = null;
        out[index].roas = null;
        out[index].cpa = null;
        out[index].receita_source = 'bloqueada_por_duplicidade';
        out[index].pedidos_source = 'bloqueada_por_duplicidade';
        out[index].atribuicao_bloqueada = true;
        out[index].metodologia = 'receita_janela_agregada';
        out[index].aviso = 'Receita repetida em canais diferentes da mesma janela. ROAS por canal foi bloqueado; use a linha agregada até existir atribuição real por pedido.';
      });
    });

    return out;
  }

  function enrichMediaEstimates(rows, launch) {
    return markDuplicatedMediaAttribution(marcarQualidadeValorMidia(rows), launch);
  }

  function normalizeCrmRow(row) {
    const investimento = numberOrNull(row.investimento);
    const receitaLinha = numberOrNull(row.receita_linha);
    const receitaDia = numberOrNull(row.receita_dia);
    const receitaBase = receitaDia ?? receitaLinha;
    const pedidos = numberOrNull(row.pedidos);
    const roas = rowRoas(row) ?? (investimento && receitaBase !== null ? receitaBase / investimento : null);
    const cpa = numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
    const metodologia = row.metodologia || ((receitaBase !== null || roas !== null) ? 'estimativa_dashboard' : '');
    const aviso = row.aviso || (metodologia ? 'Leitura comercial estimada; não representa atribuição real de clique/conversão.' : '');
    return {
      ...row,
      investimento,
      receita_linha: receitaLinha,
      receita_dia: receitaDia,
      receita_base: receitaBase,
      pedidos,
      roas,
      cpa,
      metodologia,
      aviso
    };
  }

  function weightedRoas(rows) {
    const weighted = rows
      .filter((row) => midiaValidaParaImpacto(row))
      .map((row) => ({
        roas: rowRoas(row),
        investimento: numberOrNull(row.investimento)
      }))
      .filter((row) => row.roas !== null && row.investimento !== null && row.investimento > 0);

    if (weighted.length) {
      const investimento = weighted.reduce((acc, row) => acc + row.investimento, 0);
      return investimento ? weighted.reduce((acc, row) => acc + row.roas * row.investimento, 0) / investimento : null;
    }

    const values = rows
      .filter((row) => midiaValidaParaImpacto(row))
      .map((row) => rowRoas(row))
      .filter((value) => value !== null && value !== undefined);

    return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
  }

  function aggregateMediaRows(rows, launch = null, isValidRow = midiaValidaParaImpacto) {
    const groups = new Map();
    rows.forEach((row) => {
      if (!isValidRow(row)) return;
      const key = `${row.modelo_id || launch?.modelo_id || 'sem_modelo'}::${row.janela || 'sem_janela'}`;
      const current = groups.get(key) || {
        modelo_id: row.modelo_id || launch?.modelo_id || null,
        modelo: row.modelo || launch?.modelo || '',
        campanha: 'Total janela',
        janela: row.janela,
        canal: 'agregado',
        canais: new Set(),
        investimento: 0,
        receita_atribuida: 0,
        pedidos: 0,
        hasReceitaAtribuida: false,
        receita_janela_agregada: null,
        receita_janela_isolada: 0,
        pedidos_janela_isolados: 0,
        hasReceitaJanelaIsolada: false,
        hasPedidos: false,
        hasPedidosJanelaIsolados: false,
        janela_isolada_confiavel: false,
        janela_isolada_motivo: '',
        metodologia: '',
        aviso: '',
        count: 0,
        aggregate: true
      };
      if (row.canal) current.canais.add(row.canal);
      current.investimento += row.investimento || 0;
      if (row.receita_janela_agregada !== null && row.receita_janela_agregada !== undefined) {
        current.receita_janela_agregada = row.receita_janela_agregada;
      }
      if (row.receita_atribuida !== null && row.receita_atribuida !== undefined) {
        current.receita_atribuida += row.receita_atribuida || 0;
        current.hasReceitaAtribuida = true;
      }
      if (row.janela_isolada_confiavel && row.receita_janela_isolada !== null && row.receita_janela_isolada !== undefined) {
        current.receita_janela_isolada += row.receita_janela_isolada || 0;
        current.hasReceitaJanelaIsolada = true;
        current.janela_isolada_confiavel = true;
        current.janela_isolada_motivo = current.janela_isolada_motivo || row.janela_isolada_motivo || '';
      } else if (row.janela_isolada_confiavel === false && row.janela_isolada_motivo) {
        current.janela_isolada_motivo = current.janela_isolada_motivo || row.janela_isolada_motivo;
      }
      const pedidos = row.pedidos_janela_agregados ?? row.pedidos;
      if (pedidos !== null && pedidos !== undefined) {
        current.pedidos += pedidos || 0;
        current.hasPedidos = true;
      }
      if (row.janela_isolada_confiavel && row.pedidos_janela_isolados !== null && row.pedidos_janela_isolados !== undefined) {
        current.pedidos_janela_isolados += row.pedidos_janela_isolados || 0;
        current.hasPedidosJanelaIsolados = true;
      }
      current.metodologia = current.metodologia || row.metodologia || '';
      current.aviso = current.aviso || row.aviso || '';
      current.count += 1;
      groups.set(key, current);
    });
    return [...groups.values()]
      .filter((row) => row.count > 1 || row.receita_janela_agregada !== null || row.investimento > 0)
      .map(({
        count,
        canais,
        hasReceitaAtribuida,
        hasReceitaJanelaIsolada,
        hasPedidos,
        hasPedidosJanelaIsolados,
        receita_janela_agregada,
        ...row
      }) => {
        const receita = receita_janela_agregada ?? (hasReceitaAtribuida ? row.receita_atribuida : null);
        const receitaIsolada = receita === null && hasReceitaJanelaIsolada ? row.receita_janela_isolada : null;
        const pedidos = hasPedidos ? row.pedidos : null;
        const pedidosIsolados = hasPedidosJanelaIsolados ? row.pedidos_janela_isolados : null;
        const source = receita_janela_agregada !== null && receita_janela_agregada !== undefined
          ? 'receita_repetida_agregada'
          : hasReceitaAtribuida ? 'atribuida' : receitaIsolada !== null ? 'janela_isolada' : null;
        const metodologia = row.metodologia || (receitaIsolada !== null ? 'janela_isolada' : '');
        const aviso = row.aviso || (receitaIsolada !== null ? row.janela_isolada_motivo : '');
        return {
          ...row,
          campanha: count > 1 ? 'Total janela' : row.campanha,
          canal: canais.size > 1 ? `${fmtNum(canais.size)} canais` : ([...canais][0] || row.canal),
          receita_atribuida: receita ?? null,
          receita_janela_isolada: receitaIsolada ?? null,
          receita_source: source,
          pedidos: pedidos ?? null,
          pedidos_janela_isolados: pedidosIsolados ?? null,
          roas: row.investimento && receita !== null && receita !== undefined ? receita / row.investimento : null,
          cpa: row.investimento && pedidos ? row.investimento / pedidos : null,
          roas_janela_isolada: row.investimento && receitaIsolada !== null && receitaIsolada !== undefined ? receitaIsolada / row.investimento : null,
          cpa_janela_isolada: row.investimento && pedidosIsolados ? row.investimento / pedidosIsolados : null,
          metodologia,
          aviso
        };
      });
  }

  function mediaValue(value, formatter) {
    return value === null || value === undefined ? '—' : formatter(value);
  }

  function roasValue(value) {
    return value === null || value === undefined ? '&mdash;' : `${fmtNum(value, 2)}&times;`;
  }

  function organicPaidValue(value) {
    if (value === null || value === undefined) {
      return '<span class="cell-muted">Aguardando vendas</span>';
    }
    return fmtBRL(value);
  }

  function mediaRevenueCell(row) {
    const value = numberOrNull(row?.receita_atribuida);
    if (value !== null) return `${fmtBRL(value)}${metodologiaComercialBadge(row)}`;
    if (row?.janela_isolada_confiavel && numberOrNull(row?.receita_janela_isolada) !== null) {
      return `${fmtBRL(row.receita_janela_isolada)} ${badge('parcial', 'isolada', row.janela_isolada_motivo || 'Estimativa isolada por janela unica de campanha.')}`;
    }
    return `<span class="cell-muted">Sem receita atribuída</span>${row?.janela_isolada_motivo ? ` ${badge('neg', 'revisar', row.janela_isolada_motivo)}` : ''}`;
  }

  function prepareMediaDisplayRow(row) {
    if (!row.metodologia && row.janela_isolada_confiavel) {
      row.metodologia = 'janela_isolada';
      row.aviso = row.janela_isolada_motivo;
    }
    return row;
  }

  function mediaRoasForDisplay(row) {
    return row?.roas !== null && row?.roas !== undefined ? row.roas : row?.roas_janela_isolada;
  }

  function mediaCpaForDisplay(row) {
    return row?.cpa !== null && row?.cpa !== undefined ? row.cpa : row?.cpa_janela_isolada;
  }

  function mediaRoasBadgeForDisplay(row) {
    return roasBadge(mediaRoasForDisplay(row));
  }

  function isLineInvestmentMediaRow(row) {
    return !String(row?.modelo_id || '').trim() && Boolean(String(row?.linha || '').trim());
  }

  function normalizeLineInvestmentMediaRow(row) {
    return {
      campanha: row.campanha || 'Campanha sem nome',
      linha: row.linha || '',
      canal: row.canal || '',
      investimento: numberOrNull(row.investimento),
      data_inicio: row.data_inicio || null,
      data_fim: row.data_fim || null,
      observacao: row.observacao || row.status || ''
    };
  }

  function renderLineInvestmentTable() {
    const tbody = $('line-investment-table');
    if (!tbody) return;
    const card = $('line-investment-card');
    const label = $('line-investment-label');
    const rows = (state.data.midia_paga || [])
      .filter(isLineInvestmentMediaRow)
      .map(normalizeLineInvestmentMediaRow)
      .sort((a, b) => String(a.linha).localeCompare(String(b.linha)) || String(a.campanha).localeCompare(String(b.campanha)));
    if (card) card.hidden = !rows.length;
    if (label) label.hidden = !rows.length;
    tbody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td>${escapeHtml(row.campanha)}</td>
        <td>${escapeHtml(row.linha)}</td>
        <td>${escapeHtml(row.canal || '—')}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td>${fmtDate(row.data_inicio)}</td>
        <td>${fmtDate(row.data_fim)}</td>
        <td>${escapeHtml(row.observacao || '—')}</td>
      </tr>
    `).join('') : '';
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
    const selectedWindow = selectedAnalysisWindow(launch);
    const receitaModelo = selectedWindow.data?.receita ?? null;
    const janelaModelo = selectedWindow.label || '&mdash;';

    const mediaRowsImpacto = mediaRows.filter((row) => midiaValidaParaImpacto(row));
    const mediaAggregateRows = aggregateMediaRows(mediaRowsImpacto, launch);
    const mediaMetricRows = mediaAggregateRows.length ? mediaAggregateRows : mediaRowsImpacto;
    const mediaInvestimento = sumKnown(mediaRowsImpacto, 'investimento');
    const mediaReceita = sumKnown(mediaMetricRows, 'receita_atribuida');
    const mediaPedidos = sumKnown(mediaMetricRows, 'pedidos');
    const crmInvestimento = sumKnown(crmRows, 'investimento');
    const crmReceita = sumKnown(crmRows, 'receita_base');
    const crmPedidos = sumKnown(crmRows, 'pedidos');
    const crmDisparos = crmRows.length;
    const investimentoTotal = sumValues(mediaInvestimento, crmInvestimento);
    const receitaComercial = sumValues(mediaReceita, crmReceita);
    const metodologiaRow = [...mediaRows, ...crmRows].find((row) => row.metodologia || row.aviso) || {};

    return {
      launch,
      janelaModelo,
      receitaModelo,
      mediaInvestimento,
      mediaReceita,
      mediaPedidos,
      mediaRoas: weightedRoas(mediaMetricRows),
      mediaCpa: ratioOrNull(mediaInvestimento, mediaPedidos),
      crmInvestimento,
      crmReceita,
      crmPedidos,
      crmDisparos,
      crmRoas: weightedRoas(crmRows),
      crmCpa: ratioOrNull(crmInvestimento, crmPedidos),
      investimentoTotal,
      receitaComercial,
      roasComercial: weightedRoas([...mediaRows, ...crmRows]),
      metodologia: metodologiaRow.metodologia || '',
      aviso: metodologiaRow.aviso || ''
    };
  }

  function renderActionsComparison(summaries) {
    $('actions-comparison').innerHTML = summaries.length ? `
      <div class="table-wrap commercial-table">
        <table>
          <thead>
            <tr>
              ${thTip('Modelo', 'Modelo comparado na frente comercial.')}
              ${thTip('Janela base', 'Janela fixa usada para contextualizar a receita do modelo, sempre a partir do D0 do lançamento.')}
              ${thTip('Receita modelo', 'Receita do modelo na janela base. Fonte: vendas do pipeline ou histórico versionado.', 'num')}
              ${thTip('Invest. mídia', 'Soma do investimento informado nas campanhas de mídia paga cadastradas na planilha.', 'num')}
              ${thTip('ROAS mídia', 'ROAS informado na planilha ou calculado apenas quando existe receita atribuída real para a linha. Não usa faturamento total da janela do modelo.', 'num')}
              ${thTip('CPA mídia', 'Fórmula: investimento de mídia / pedidos informados ou atribuídos na própria linha. Sem rateio pela janela do modelo.', 'num')}
              ${thTip('Invest. CRM', 'Soma do investimento/custo informado nos disparos de CRM.', 'num')}
              ${thTip('Disparos', 'Quantidade de linhas de CRM cadastradas para o modelo no JSON.', 'num')}
              ${thTip('ROAS CRM', 'ROAS informado na planilha de CRM ou calculado por receita base / investimento. Quando houver mais de uma linha, o agregado e ponderado pelo investimento.', 'num')}
              ${thTip('CPA CRM', 'Fórmula: investimento de CRM / pedidos de CRM quando pedidos existem.', 'num')}
              ${thTip('Invest. total', 'Soma de investimento de mídia paga e CRM.', 'num')}
              ${thTip('Receita comercial', 'Soma das receitas informadas em mídia e CRM. Mídia sem receita atribuída fica fora da receita comercial.', 'num')}
              ${thTip('ROAS comercial', 'ROAS agregado ponderado pelo investimento das linhas que possuem ROAS informado ou calculável por receita atribuída real.', 'num')}
              ${thTip('Vendas orgânicas', 'Receita orgânica do lançamento atribuída por last-click. Fica pendente até receita_organica estar no lancamentos_produtos_dia.json.', 'num')}
              ${thTip('Vendas pagas', 'Receita paga do lançamento atribuída por last-click. Fica pendente até receita_paga estar no lancamentos_produtos_dia.json.', 'num')}
            </tr>
          </thead>
          <tbody>
            ${summaries.map((row) => `
              <tr>
                <td class="model-name">${escapeHtml(row.launch.modelo)}</td>
                <td>${escapeHtml(row.janelaModelo)}</td>
                <td class="num">${mediaValue(row.receitaModelo, fmtBRL)}</td>
                <td class="num">${mediaValue(row.mediaInvestimento, fmtBRL)}</td>
                <td class="num">${roasValue(row.mediaRoas)}${metodologiaComercialBadge(row)}</td>
                <td class="num">${mediaValue(row.mediaCpa, fmtBRL)}</td>
                <td class="num">${mediaValue(row.crmInvestimento, fmtBRL)}</td>
                <td class="num">${fmtNum(row.crmDisparos)}</td>
                <td class="num">${roasValue(row.crmRoas)}${metodologiaComercialBadge(row)}</td>
                <td class="num">${mediaValue(row.crmCpa, fmtBRL)}</td>
                <td class="num">${mediaValue(row.investimentoTotal, fmtBRL)}</td>
                <td class="num">${mediaValue(row.receitaComercial, fmtBRL)}${metodologiaComercialBadge(row)}</td>
                <td class="num">${roasValue(row.roasComercial)}${metodologiaComercialBadge(row)}</td>
                <td class="num">${organicPaidValue(attributionForSelectedPeriod(row.launch).receita_organica)}</td>
                <td class="num">${organicPaidValue(attributionForSelectedPeriod(row.launch).receita_paga)}</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state"><div><strong>Selecione ao menos um modelo.</strong>A frente comercial usa os modelos marcados em Comparar com.</div></div>`;
  }

  function renderActionsComparative() {
    renderLineInvestmentTable();
    const launches = selectedCompareLaunches().filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
    if (!launches.length) {
      renderActionsComparison([]);
      $('media-table').innerHTML = `<tr><td colspan="9" class="cell-muted">Selecione ao menos um modelo com D0 e dados reais para comparar mídia paga.</td></tr>`;
      $('crm-table').innerHTML = `<tr><td colspan="9" class="cell-muted">Selecione ao menos um modelo com D0 e dados reais para comparar CRM.</td></tr>`;
      return;
    }
    const mediaByModel = new Map();
    const crmByModel = new Map();
    const detailedRows = launches.flatMap((launch) => {
      const rowsRaw = (state.data.midia_paga || [])
        .filter((row) => row.modelo_id === launch.modelo_id)
        .filter((row) => mediaRowMatchesSelectedPeriod(row, launch))
        .map((row) => normalizeMediaRow(row, launch));
      const rows = enrichMediaEstimates(rowsRaw, launch);
      mediaByModel.set(launch.modelo_id, rows);
      return rows;
    });
    const crmRowsAll = launches.flatMap((launch) => {
      const rows = (state.data.crm_disparos || [])
        .filter((row) => row.modelo_id === launch.modelo_id)
        .filter((row) => crmRowMatchesSelectedPeriod(row, launch))
        .map((row) => ({ ...normalizeCrmRow(row), modelo_id: launch.modelo_id, modelo: launch.modelo }));
      crmByModel.set(launch.modelo_id, rows);
      return rows;
    });

    renderActionsComparison(launches.map((launch) => commercialSummaryFor(
      launch,
      mediaByModel.get(launch.modelo_id) || [],
      crmByModel.get(launch.modelo_id) || []
    )));

    const displayRows = [...aggregateMediaRows(detailedRows), ...detailedRows]
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.janela).localeCompare(String(b.janela)) || a.campanha.localeCompare(b.campanha));
    $('media-table').innerHTML = displayRows.length ? displayRows.map((inputRow) => {
      const row = prepareMediaDisplayRow(inputRow);
      const roas = mediaRoasForDisplay(row);
      return `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${escapeHtml(row.campanha)}${suspeitaComercialBadge(row)}</td>
        <td>${escapeHtml(row.janela)}${row.receita_source && row.receita_source !== 'atribuida' ? ` <span class="cell-muted">(${escapeHtml(row.receita_source)})</span>` : ''}${metodologiaComercialBadge(row)}${suspeitaComercialBadge(row)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${mediaRevenueCell(row)}</td>
        <td class="num">${roasValue(roas)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${mediaValue(mediaCpaForDisplay(row), fmtBRL)}</td>
        <td>${mediaRoasBadgeForDisplay(row)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="9" class="cell-muted">Sem mídia paga cadastrada para os modelos selecionados.</td></tr>`;

    const crmRows = crmRowsAll
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.data_disparo || '').localeCompare(String(b.data_disparo || '')));
    $('crm-table').innerHTML = crmRows.length ? crmRows.map((row) => `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${fmtDate(row.data_disparo)}</td>
        <td title="${escapeHtml(row.campanha || 'Disparo sem nome')}">${escapeHtml(row.campanha || 'Disparo sem nome')}${metodologiaComercialBadge(row)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${fmtBRL(row.receita_linha)}</td>
        <td class="num">${mediaValue(row.receita_dia, fmtBRL)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${roasValue(row.roas)}${metodologiaComercialBadge(row)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="9" class="cell-muted">Sem disparos de CRM cadastrados para os modelos selecionados.</td></tr>`;
  }

  function projectionBaseKeyForLaunch(launch, preferredKey = selectedPeriodKey()) {
    if (preferredKey && WINDOW_KEYS.includes(preferredKey) && getWindow(launch, preferredKey)?.receita) {
      return preferredKey;
    }
    const preferredRank = WINDOW_KEYS.includes(preferredKey) ? WINDOW_KEYS.indexOf(preferredKey) : WINDOW_KEYS.length - 1;
    return [...WINDOW_KEYS]
      .slice(0, preferredRank + 1)
      .reverse()
      .find((key) => key !== '90d' && getWindow(launch, key)?.receita)
      || [...WINDOW_KEYS].reverse().find((key) => getWindow(launch, key)?.receita)
      || null;
  }

  function projectionReferenceRows(selected, baseKey) {
    const rowFor = (launch) => {
      const baseWindow = getWindow(launch, baseKey);
      const finalWindow = getWindow(launch, '90d');
      if (!baseWindow?.receita || !finalWindow?.receita) return null;
      const multiplier = finalWindow.receita / baseWindow.receita;
      if (!Number.isFinite(multiplier) || multiplier <= 0) return null;
      return { launch, baseWindow, finalWindow, multiplier };
    };
    const eligible = (launch) => launch?.modelo_id
      && launch.modelo_id !== selected?.modelo_id
      && !launch.isFuture
      && !isPlannedStatus(launch.status);
    const selectedRefs = selectedCompareLaunches().filter(eligible).map(rowFor).filter(Boolean);
    const fallbackRefs = comparableLaunches().filter(eligible).map(rowFor).filter(Boolean);
    return selectedRefs.length ? selectedRefs : fallbackRefs;
  }

  function projectionScenariosByMaturity(selected) {
    const requestedKey = selectedPeriodKey();
    const baseKey = projectionBaseKeyForLaunch(selected, requestedKey);
    if (!baseKey) return null;

    const baseWindow = getWindow(selected, baseKey);
    if (!baseWindow?.receita) return null;

    const refs = projectionReferenceRows(selected, baseKey)
      .sort((a, b) => a.multiplier - b.multiplier);
    if (!refs.length) return null;

    const multipliers = refs.map((row) => row.multiplier);
    const conservative = multipliers[0];
    const optimistic = multipliers[multipliers.length - 1];
    const avg = multipliers.reduce((acc, value) => acc + value, 0) / multipliers.length;
    const ticketPar = baseWindow.pares ? baseWindow.receita / baseWindow.pares : null;
    const baseLabel = windowLabel(baseKey);
    const requestedLabel = windowLabel(requestedKey);
    const isFallbackBase = baseKey !== requestedKey;
    const referenceLabel = `${fmtNum(refs.length)} lançamento${refs.length === 1 ? '' : 's'} já chegaram a 90 dias`;

    return [
      {
        name: 'Conservador',
        label: `Cenário cauteloso: ${fmtNum(conservative, 2)} vezes`,
        mult: conservative,
        value: baseWindow.receita * conservative,
        methodLabel: 'o menor crescimento visto no grupo',
        sourceRefs: [refs[0]]
      },
      {
        name: 'Base',
        label: `Cenário médio: ${fmtNum(avg, 2)} vezes`,
        mult: avg,
        value: baseWindow.receita * avg,
        base: true,
        methodLabel: 'a média de crescimento do grupo',
        sourceRefs: refs
      },
      {
        name: 'Otimista',
        label: `Cenário forte: ${fmtNum(optimistic, 2)} vezes`,
        mult: optimistic,
        value: baseWindow.receita * optimistic,
        methodLabel: 'o maior crescimento visto no grupo',
        sourceRefs: [refs[refs.length - 1]]
      }
    ].map((s) => ({
      ...s,
      pairs: ticketPar ? s.value / ticketPar : null,
      baseKey,
      baseLabel,
      requestedLabel,
      isFallbackBase,
      referenceLabel,
      refs
    }));
  }

  function d90RealizedWindow(launch) {
    const finalWindow = getWindow(launch, '90d');
    return numberOrNull(finalWindow?.receita) !== null ? finalWindow : null;
  }

  function launchReachedD90(launch) {
    if (d90RealizedWindow(launch)) return true;
    const dPlus = numberOrNull(launch?.dPlus);
    const latestDay = latestLaunchDataDay(launch);
    return [dPlus, latestDay].some((value) => value !== null && value >= 90);
  }

  function projectionD90CohortRows(selected) {
    const rowFor = (launch) => {
      const finalWindow = d90RealizedWindow(launch);
      if (!finalWindow) return null;
      return { launch, finalWindow, receita: numberOrNull(finalWindow.receita) };
    };
    const eligible = (launch) => launch?.modelo_id
      && !launch.isFuture
      && !isPlannedStatus(launch.status);
    const selectedRows = selectedCompareLaunches().filter(eligible).map(rowFor).filter(Boolean);
    const fallbackRows = comparableLaunches().filter(eligible).map(rowFor).filter(Boolean);
    const rows = selectedRows.length ? selectedRows : fallbackRows;
    return rows.sort((a, b) => b.receita - a.receita);
  }

  function renderProjectionRealized(launch, finalWindow) {
    const receita = numberOrNull(finalWindow?.receita);
    const pares = numberOrNull(finalWindow?.pares);
    const pedidos = numberOrNull(finalWindow?.pedidos);
    const rows = projectionD90CohortRows(launch);
    const rank = rows.findIndex((row) => row.launch.modelo_id === launch.modelo_id) + 1;
    const avg = rows.length ? rows.reduce((acc, row) => acc + row.receita, 0) / rows.length : null;
    const deltaPct = avg ? (receita / avg) - 1 : null;
    const deltaText = deltaPct !== null ? `${deltaPct >= 0 ? '+' : ''}${fmtPct(deltaPct, 1)}` : '—';
    const range = launchWindowRangeLabel(launch, '90d');

    $('projection-content').innerHTML = `
      <div class="metric-sub" style="margin-bottom:10px">D+90 já fechado para <strong>${escapeHtml(launch.modelo)}</strong>. Projeção desativada; abaixo está o resultado realizado.</div>
      <div class="scenario-grid">
        <div class="scenario base">
          <div class="scenario-label">Realizado D+90 ${tip('Produto já chegou ao marco de 90 dias; por isso esta seção mostra o realizado, não cenário.')}</div>
          <div class="scenario-name">${escapeHtml(range)}</div>
          <div class="scenario-value">${fmtBRL(receita)}</div>
          <div class="scenario-pairs">${fmtNum(pares)} pares · ${fmtNum(pedidos)} pedidos</div>
        </div>
        <div class="scenario">
          <div class="scenario-label">Posição no grupo ${tip('Ranking considera apenas modelos comparados com D+90 realizado no JSON.')}</div>
          <div class="scenario-name">D+90 comparável</div>
          <div class="scenario-value">${rank > 0 ? `${fmtNum(rank)}º de ${fmtNum(rows.length)}` : '—'}</div>
          <div class="scenario-pairs">${rows.length ? `${fmtNum(rows.length)} modelos com D+90 real` : 'Sem grupo D+90'}</div>
        </div>
        <div class="scenario">
          <div class="scenario-label">Vs média D+90 ${tip('Compara o D+90 realizado do produto contra a média dos modelos com D+90 real.')}</div>
          <div class="scenario-name">Média do grupo ${fmtBRL(avg)}</div>
          <div class="scenario-value">${escapeHtml(deltaText)}</div>
          <div class="scenario-pairs">Diferença absoluta ${fmtBRL(avg !== null ? receita - avg : null)}</div>
        </div>
      </div>
      <div class="card warning" style="margin-top:14px">
        <div class="metric-label">${labelTip('Como ler', 'A projeção só aparece para lançamentos que ainda não chegaram ao D+90.')}</div>
        <p class="section-desc">Quando o lançamento já completou 90 dias e existe D+90 no JSON, a pergunta muda de “quanto pode fechar?” para “quanto fechou e como ficou contra o grupo comparativo?”.</p>
      </div>`;
  }

  function renderProjectionReachedWithoutD90(launch) {
    $('projection-content').innerHTML = `
      <div class="empty-state">
        <div>
          <strong>D+90 já deveria estar realizado, mas não veio no JSON.</strong>
          ${escapeHtml(launch.modelo)} já passou do marco de 90 dias, então a tela não calcula projeção. Atualize a janela 90d na origem para mostrar o realizado.
        </div>
      </div>`;
  }

  function projectionEstimateTooltip(launch, scenario) {
    const baseWindow = getWindow(launch, scenario?.baseKey);
    const baseRevenue = numberOrNull(baseWindow?.receita);
    const growthTimes = numberOrNull(scenario?.mult);
    const result = numberOrNull(scenario?.value);
    const currentMark = windowPlainLabel(scenario?.baseKey);
    const nextMark = windowPlainLabel(selectedPeriodKey());
    const referenceRows = (scenario?.refs || []).filter(Boolean);
    const refCount = referenceRows.length;
    const referenceText = refCount
      ? `${fmtNum(refCount)} lançamento${refCount === 1 ? '' : 's'} que já complet${refCount === 1 ? 'ou' : 'aram'} 90 dias`
      : 'lançamentos parecidos que já completaram 90 dias';
    const grewText = refCount === 1 ? 'cresceu' : 'cresceram';
    const referenceLines = referenceRows.length
      ? referenceRows.map((row) => (
        `- ${row.launch?.modelo || 'Lançamento'}: ${fmtBRL(row.finalWindow?.receita)} em 90 dias ÷ ${fmtBRL(row.baseWindow?.receita)} em ${currentMark} = ${fmtNum(row.multiplier, 2)} vezes`
      )).join('\n')
      : '- sem referências abertas no JSON';
    const referenceSumText = referenceRows.map((row) => fmtNum(row.multiplier, 2)).join(' + ');
    const scenarioChoice = scenario?.base
      ? `média dos valores acima: (${referenceSumText}) ÷ ${fmtNum(refCount)} = ${fmtNum(growthTimes, 2)} vezes`
      : scenario?.name === 'Conservador'
        ? `menor valor observado no grupo: ${fmtNum(growthTimes, 2)} vezes`
        : `maior valor observado no grupo: ${fmtNum(growthTimes, 2)} vezes`;
    const pendingText = scenario?.isFallbackBase
      ? `\n\nPor que usamos esse ponto: a próxima marca (${nextMark}) ainda não fechou para este lançamento.`
      : '';
    return `Leitura: estimativa de faturamento em 90 dias baseada em lançamentos comparáveis que já completaram esse ciclo. O valor orienta a decisão, mas não substitui meta ou previsão oficial.

Origem do cálculo: ${referenceText} ${grewText}, em média, ${fmtNum(growthTimes, 2)} vezes entre o início e o fechamento de 90 dias.

Como encontramos o valor "vezes": para cada lançamento de referência, dividimos o faturamento em 90 dias pelo faturamento na mesma marca usada neste lançamento (${currentMark}).
${referenceLines}

Valor usado neste cenário: ${scenarioChoice}.

Aplicação no lançamento atual: ${launch?.modelo || 'este lançamento'} acumulou ${fmtBRL(baseRevenue)} até agora (${currentMark}).
${fmtBRL(baseRevenue)} × ${fmtNum(growthTimes, 2)} = ${fmtBRL(result)}${pendingText}`;
  }

  function projectionPairsTooltip(launch, scenario) {
    const baseWindow = getWindow(launch, scenario?.baseKey);
    const ticketPar = baseWindow?.pares ? baseWindow.receita / baseWindow.pares : null;
    return `De onde vêm os pares: depois de estimar o faturamento (${fmtBRL(scenario?.value)}), o painel divide pelo preço médio por par visto até agora (${fmtBRL(ticketPar)}). Resultado aproximado: ${fmtNum(scenario?.pairs)} pares.`;
  }

  function renderProjection(selected) {
    const projectionLaunches = selectedCompareLaunches();
    const projectionWindowKey = selectedPeriodKey();
    const projectionBase = projectionLaunches.find((launch) => launch.modelo_id === selected.modelo_id)
      || projectionLaunches.find((launch) => getWindow(launch, projectionWindowKey));
    if (!projectionBase || projectionBase.isFuture || isPlannedStatus(projectionBase.status)) {
      $('projection-content').innerHTML = `<div class="empty-state"><div><strong>Sem dados suficientes para projeção.</strong>A seção aparece quando o modelo tem uma janela real de venda e existe ao menos uma referência com D+90.</div></div>`;
      return;
    }

    const realizedD90 = d90RealizedWindow(projectionBase);
    if (realizedD90) {
      renderProjectionRealized(projectionBase, realizedD90);
      return;
    }

    if (launchReachedD90(projectionBase)) {
      renderProjectionReachedWithoutD90(projectionBase);
      return;
    }

    const scenarios = projectionScenariosByMaturity(projectionBase);
    const scenarioMeta = scenarios?.[0] || null;
    if (!scenarios) {
      $('projection-content').innerHTML = `<div class="empty-state"><div><strong>Sem dados suficientes para projeção.</strong>A seção aparece quando o modelo ainda não chegou a D+90, tem uma janela real de venda e existe ao menos uma referência com D+90.</div></div>`;
      return;
    }

    $('projection-content').innerHTML = `
      <div class="metric-sub" style="margin-bottom:10px">Ponto de partida: <strong>${escapeHtml(projectionBase.modelo)}</strong></div>
      <div class="metric-sub" style="margin-bottom:10px">${scenarioMeta ? `Venda real até ${escapeHtml(scenarioMeta.baseLabel)}${scenarioMeta.isFallbackBase ? `, usada porque ${escapeHtml(scenarioMeta.requestedLabel)} ainda não fechou` : ''} · ${escapeHtml(scenarioMeta.referenceLabel)}` : ''}</div>
      <div class="scenario-grid">
        ${scenarios.map((s) => `<div class="scenario ${s.base ? 'base' : ''}">
          <div class="scenario-label">${escapeHtml(s.label)} ${tipMultiline(projectionEstimateTooltip(projectionBase, s))}</div>
          <div class="scenario-name">${escapeHtml(s.name)}</div>
          <div class="scenario-value">${fmtBRL(s.value)}</div>
          <div class="scenario-pairs" tabindex="0" data-tooltip="${tooltipAttr(projectionPairsTooltip(projectionBase, s))}">≈ ${fmtNum(s.pairs)} pares</div>
        </div>`).join('')}
      </div>
      <div class="card warning" style="margin-top:14px">
        <div class="metric-label">${labelTip('Como ler', 'A seção responde: se este lançamento seguir um comportamento próximo aos anteriores, qual faturamento pode alcançar em 90 dias?')}</div>
        <p class="section-desc">A projeção parte da venda real já observada e usa o comportamento de lançamentos que completaram 90 dias. Use como apoio à decisão, não como meta garantida.</p>
      </div>`;

  }

  function renderInsights(selected) {
    const eligible = comparableLaunches();
    const activeLaunches = eligible.filter((launch) => launch.isActive);
    const backfilled = eligible.filter((launch) => launch.daily_source === 'historico_backfill');
    const noPipelineRows = eligible.filter((launch) => launch.isActive && !hasPipelineRows(launch));
    const audit = auditQualityForLaunch(selected);
    const manifestWarnings = Array.isArray(state.data?.manifest?.warnings) ? state.data.manifest.warnings : [];
    const mediaBlocked = (state.data?.midia_paga || []).filter((row) => row.atribuicao_bloqueada || normalizeText(row.metodologia) === 'receita janela agregada');

    const list = [
      audit?.status === 'divergente' ? {
        type: 'neg',
        title: 'Auditoria divergente',
        copy: `${selected.modelo} diverge da auditoria independente em pedidos, pares ou receita. Investigue antes de usar a leitura.`
      } : audit?.status === 'ok' ? {
        type: 'pos',
        title: 'Auditoria OK',
        copy: `${selected.modelo} bate com a auditoria independente do SSOT em pedidos, pares e receita.`
      } : null,
      noPipelineRows.length ? {
        type: 'neg',
        title: 'Pipeline sem linha para ativo',
        copy: `${noPipelineRows.map((launch) => launch.modelo).join(', ')} esta ativo, mas sem linhas no JSON de vendas. Verifique BigQuery, match e exportacao.`
      } : null,
      activeLaunches.length ? {
        type: 'warn',
        title: 'Modelo ativo em curso',
        copy: `${activeLaunches.map((launch) => launch.modelo).join(', ')} deve ser lido por janelas fechadas, sem transformar ausência em zero.`
      } : null,
      backfilled.length ? {
        type: 'warn',
        title: 'Backfill diario aplicado',
        copy: `${backfilled.length} modelo(s) histórico(s) sem diário real receberam backfill a partir das janelas acumuladas para curva e semana a semana.`
      } : null,
      mediaBlocked.length ? {
        type: 'warn',
        title: 'Mídia sem atribuição por canal',
        copy: `${mediaBlocked.length} linha(s) de mídia tiveram ROAS por canal bloqueado ou agregado porque a receita não representa last-click por pedido.`
      } : null,
      {
        type: 'pos',
        title: 'Cor e tamanho canonicos',
        copy: 'O export principal passa a priorizar mart_shared.produto_lancamento_v; regex e SKU ficam apenas como fallback para dado antigo.'
      },
      ...manifestWarnings.slice(0, 3).map((copy) => ({
        type: String(copy).includes('ALERTA') || String(copy).includes('falhou') ? 'neg' : 'warn',
        title: 'Manifest',
        copy: String(copy)
      }))
    ].filter(Boolean).slice(0, 8);

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
    $('selected-title').textContent = 'Placar comparativo';
    const selectedStatus = $('selected-status');
    if (selectedStatus) selectedStatus.innerHTML = badge('pipeline', `${fmtNum(comparisonLaunchesWithFocus(selected).length)} linhas`);
    renderSelectedHeader(selected);
    renderModelSelector();
    renderPeriodSelector();
    renderCompareSelector();
    renderTopMeta();
    renderAnalysisContext(selected);
    renderReadingSupport(selected);
    renderStoryBrief(selected);
    renderState(selected);
    renderComparison();
    renderCharts(selected);
    renderColorMix();
    renderSizeRanking();
    renderCutPromotersDetractorsComparative(selected);
    renderCalendar(selected);
    renderActionsComparative();
    renderProjection(selected);
    const insightsSection = $('insights');
    if (insightsSection && !insightsSection.hidden) renderInsights(selected);
    applyCollapsibleLists(document);
  }

  function getDashboardSnapshot() {
    return {
      data: state.data,
      launches: state.launches,
      primaryModelId: state.primaryModelId,
      snapshotClock: state.snapshotClock
    };
  }

  window.ReiseLaunchDashboard = {
    getSnapshot: getDashboardSnapshot,
    badge,
    formatters: {
      fmtBRL,
      fmtDate,
      fmtDateSlash,
      fmtNum,
      fmtPct
    },
    helpers: {
      hasValidDayZero,
      isEligibleStatus,
      normalizedStatus
    }
  };

  async function init() {
    configureDrawer();
    configureNormalizedChartModeToggle();
    configureCommercialChartMetricToggle();
    configureTopicTabs();
    configureStorySubModelControls();
    configureTooltips();
    configureChartDefaults();
    state.data = await loadData();
    state.snapshotClock = deriveSnapshotClock(state.data);
    state.launches = buildLaunches(state.data);
    applyInitialAnalysisPeriodFromUrl();
    const comparable = comparableLaunches();
    const preferred = defaultComparableLaunch(comparable);
    state.primaryModelId = preferred?.modelo_id;
    state.compareModelIds = comparable.map((launch) => launch.modelo_id);
    renderAll();
    window.dispatchEvent(new CustomEvent('reise-dashboard-ready', { detail: getDashboardSnapshot() }));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
