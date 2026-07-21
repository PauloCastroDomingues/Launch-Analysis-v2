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
    { key: 'total', label: 'Total dias' }
  ];
  const STOCK_FILTERS = [
    { key: 'all', label: 'Todos' },
    { key: 'critical', label: 'Com alerta' },
    { key: 'low', label: 'Cobertura baixa' },
    { key: 'zero', label: 'Estoque zerado' },
    { key: 'no-base', label: 'Sem base D-30' }
  ];
  const STOCK_SORTS = [
    { key: 'coverage-asc', label: 'Menor cobertura' },
    { key: 'stock-desc', label: 'Maior estoque' },
    { key: 'sales-desc', label: 'Mais vendas D-30' },
    { key: 'name-asc', label: 'Nome A-Z' }
  ];
  const STOCK_PAGE_SIZES = [
    { key: '10', label: '10 linhas' },
    { key: '25', label: '25 linhas' },
    { key: '50', label: '50 linhas' },
    { key: 'all', label: 'Todas' }
  ];
  const MILESTONE_DAYS = [0, 7, 15, 30, 60, 90];
  const COLLAPSIBLE_LIST_LIMIT = 5;
  const COLLAPSIBLE_LIST_SELECTORS = [
    '.table-wrap tbody',
    '.drill-table-wrap tbody',
    '.method-list',
    '.client-mix-list',
    '.event-list',
    '.drill-ranking',
    '.stock-detail-list'
  ];

  const state = {
    data: null,
    launches: [],
    primaryModelId: null,
    compareModelIds: [],
    analysisPeriodKey: 'total',
    stockFilter: 'all',
    stockSort: 'coverage-asc',
    stockPageSize: '10',
    snapshotClock: null,
    normalizedChartMode: 'linha',
    commercialChartMetric: 'investimento',
    canibalLineFilter: null,
    charts: {},
    shareChart: null
  };

  const $ = (id) => document.getElementById(id);
  let stockDrawerReturnFocus = null;
  let shareDrawerReturnFocus = null;
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
  const tip = (text, label = 'i') => text
    ? `<button class="help-button help-button--mini" type="button" data-tooltip="${tooltipAttr(text)}" aria-label="Ajuda analitica">${escapeHtml(label)}</button>`
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
    const modelRows = rows.filter((row) => row.modelo_id === model.modelo_id);
    if (!modelRows.length) return null;

    const sumNullable = (items, field) => (
      items.some((row) => row[field] !== null && row[field] !== undefined)
        ? items.reduce((acc, row) => acc + Number(row[field] || 0), 0)
        : null
    );
    const pedidoId = (row) => row.order_sk || row.source_order_id || null;
    const receitaBrutaRow = (row) => Number((row.receita_bruta ?? row.receita) || 0);
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

    const todayIdx = daysBetween(model.day_zero_base, snapshotDate());
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
      const receita = filtered.some((row) => row.receita_bruta !== null && row.receita_bruta !== undefined)
        ? filtered.reduce((acc, row) => acc + receitaBrutaRow(row), 0)
        : sumNullable(filtered, 'receita');
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
      const idx = dayIndex(model.day_zero_base, row.data);
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
      day_zero_base: model.day_zero_base,
      data_oficial: model.data_oficial,
      gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(model.day_zero_base)) || 0),
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

  function selectedAnalysisWindow(launch) {
    const period = state.analysisPeriodKey || 'total';
    if (!launch) {
      return { key: null, data: null, isCurrentAccumulated: false, label: '—' };
    }

    if (period === 'total') {
      if (launch.acumulado_atual) {
        const day = Math.max(0, launch.acumulado_atual.day ?? 0);
        return {
          key: `D+${day}`,
          data: launch.acumulado_atual,
          isCurrentAccumulated: true,
          label: `D+${day}`
        };
      }
      const best = bestWindow(launch);
      return {
        ...best,
        isCurrentAccumulated: false,
        label: best.key ? windowLabel(best.key) : '—'
      };
    }

    return {
      key: period,
      data: getWindow(launch, period),
      isCurrentAccumulated: false,
      label: windowLabel(period)
    };
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
      const orderId = row.order_sk || row.source_order_id;
      if (orderId) orderIds.add(orderId);
      else pedidosFallback += Number(row.pedidos_validos ?? row.pedidos ?? 0);
      pares += Number(row.pares || 0);
      receita += Number((row.receita_bruta ?? row.receita) || 0);
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
    if (quality.status === 'divergente') return badge('neg', 'Divergente', 'A auditoria independente nao bate com o JSON exportado. Nao use esta leitura para decisao antes de investigar pedidos, pares e receita.');
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
    if (win.origem === 'historico_backfill') return badge('parcial', 'Hist. estim.', 'Historico agregado foi distribuido entre marcos para permitir curva visual. Nao e dado diario real.');
    if (win.origem === 'historico' || normalizedStatus(launch.status) === 'historico') return badge('historico', 'Histórico', 'Benchmark estatico vindo de data/lancamentos_historico.json. Use para comparacao, nao como pipeline em tempo real.');
    const endDay = windowEndDay(key);
    if (endDay !== null && (launch.dPlus ?? 0) < endDay) return badge('parcial', `Parcial D+${Math.max(0, launch.dPlus)}`, `Janela ${windowLabel(key)} ainda nao fechou no snapshot. O acumulado atual vai ate D+${Math.max(0, launch.dPlus ?? 0)}.`);
    return badge('pipeline', 'Pipeline', `Janela ${windowLabel(key)} fechada com dados reais do pipeline de vendas exportado pelo Apps Script.`);
  }

  function sourceBadge(launch) {
    const auditBadge = auditBadgeForLaunch(launch);
    if (auditBadge) return auditBadge;
    const hasAnyWindow = WINDOW_KEYS.some((key) => Boolean(getWindow(launch, key)));
    if (launch.isFuture) return badge('planejado', 'Planejado', 'Modelo com D0 futuro no snapshot. Fica fora de vendas, midia, CRM e projecao ate entrar dado real.');
    if (normalizedStatus(launch.status) === 'historico') return badge('historico', 'Histórico', 'Modelo usado como benchmark historico, com dados agregados em JSON versionado.');
    if (!hasAnyWindow && hasPipelineRows(launch)) return badge('parcial', `Atual D+${Math.max(0, launch.dPlus)}`, 'Ha linhas reais no pipeline, mas nenhuma janela D+N fechada ainda.');
    if (!hasAnyWindow) return badge('parcial', `Sem dados D+${Math.max(0, launch.dPlus)}`, 'Nao ha janela fechada nem acumulado suficiente no JSON. Ausencia permanece vazia, nao vira zero.');
    if (launch.origem === 'pipeline') return badge('pipeline', `Pipeline D+${Math.max(0, launch.dPlus)}`, 'Dados reais vindos de lancamentos_produtos_dia.json, gerado pelo Apps Script a partir do SSOT.');
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
      checkpoints.forEach((cp) => {
        const idx = chart.data.labels.indexOf(cp.dateLabel);
        if (idx === -1) return;
        const x = xScale.getPixelForValue(idx);
        ctx.strokeStyle = cp.color || 'rgba(255,255,255,0.4)';
        ctx.setLineDash([4, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = cp.color || '#fff';
        ctx.font = '11px Inter, sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(cp.text, x + 4, chartArea.top + 12);
      });
      ctx.restore();
    }
  };

  function configureChartDefaults() {
    if (!window.Chart) return;
    Chart.register(launchCheckpointPlugin);
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
    overlay.hidden = !(document.body.classList.contains('drawer-open') || document.body.classList.contains('share-drawer-open'));
  }

  function setNavDrawerOpen(open) {
    const drawer = $('nav-drawer');
    const overlay = $('drawer-overlay');
    const toggle = $('nav-drawer-toggle');
    const close = $('nav-drawer-close');
    if (!drawer || !overlay || !toggle || !close) return;

    if (open) closeShareDrawer(false);
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
    closeShareDrawer();
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

  function closeShareDrawer(restoreFocus = true) {
    const drawer = $('share-drawer');
    if (!drawer) return;
    document.body.classList.remove('share-drawer-open');
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    updateMainDrawerOverlay();
    state.shareChart?.destroy?.();
    state.shareChart = null;
    if (isAnalysisDrillHash()) {
      history.pushState(null, '', `${location.pathname}${location.search}`);
    }
    if (restoreFocus && shareDrawerReturnFocus?.focus) shareDrawerReturnFocus.focus({ preventScroll: true });
    shareDrawerReturnFocus = null;
  }

  function setShareDrawerOpen(open) {
    const drawer = $('share-drawer');
    if (!drawer) return;
    if (open) setNavDrawerOpen(false);
    document.body.classList.toggle('share-drawer-open', open);
    drawer.setAttribute('aria-hidden', String(!open));
    if (open) drawer.removeAttribute('inert');
    else drawer.setAttribute('inert', '');
    updateMainDrawerOverlay();
    if (open) drawer.focus({ preventScroll: true });
  }

  function configureShareDrawer() {
    const close = $('share-drawer-close');
    const topOpen = $('share-drawer-open-top');
    if (close) close.addEventListener('click', () => closeShareDrawer());
    if (topOpen) {
      topOpen.addEventListener('click', (event) => {
        const selected = state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];
        openShareDrawer(selected, event.currentTarget);
      });
    }
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

  function closeStockDrawer() {
    const drawer = $('stock-detail-drawer');
    const overlay = $('stock-detail-overlay');
    if (!drawer || !overlay) return;
    document.body.classList.remove('stock-detail-open');
    overlay.hidden = true;
    drawer.setAttribute('aria-hidden', 'true');
    drawer.setAttribute('inert', '');
    if (stockDrawerReturnFocus?.focus) stockDrawerReturnFocus.focus({ preventScroll: true });
    stockDrawerReturnFocus = null;
  }

  function configureStockDrawer() {
    const drawer = $('stock-detail-drawer');
    const overlay = $('stock-detail-overlay');
    const close = $('stock-detail-close');
    if (!drawer || !overlay || !close) return;
    close.addEventListener('click', closeStockDrawer);
    overlay.addEventListener('click', closeStockDrawer);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && document.body.classList.contains('stock-detail-open')) {
        closeStockDrawer();
      }
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
      <select class="model-select" aria-label="Modelo em foco">
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
      <select class="period-select" aria-label="Periodo principal da analise">
        ${ANALYSIS_PERIODS.map((period) => (
          `<option value="${period.key}" ${period.key === state.analysisPeriodKey ? 'selected' : ''}>${escapeHtml(period.label)}</option>`
        )).join('')}
      </select>`;
    wrap.querySelector('select')?.addEventListener('change', (event) => {
      state.analysisPeriodKey = event.target.value;
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

  function renderAnalysisContext(selected) {
    const wrap = $('analysis-context');
    if (!wrap || !selected) return;
    const period = ANALYSIS_PERIODS.find((item) => item.key === state.analysisPeriodKey);
    const compareCount = selectedCompareLaunches().length || 1;
    const dLabel = selected.isFuture
      ? `D${selected.dPlus}`
      : `D+${Math.max(0, selected.dPlus ?? 0)}`;
    const items = [
      { label: 'Modelo', value: selected.modelo },
      { label: 'Janela', value: period?.label || state.analysisPeriodKey },
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

  function metaNarrative(meta, context = {}) {
    if (!meta) {
      return {
        label: 'Pendente',
        value: 'Sem meta',
        copy: 'Contrato esperado: mes, meta_receita e realizado_receita; modelo_id opcional.'
      };
    }
    const target = firstKnownCommercialNumber(meta, ['meta_receita', 'meta_faturamento', 'meta']);
    const actual = firstKnownCommercialNumber(meta, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']);
    const pct = roasNumberOrNull(meta.atingimento) ?? ratioOrNull(actual, target);
    const productShare = numberOrNull(context.launchShare);
    const shareCopy = productShare !== null ? ` \u00b7 share produto ${fmtPct(productShare, 1)}` : '';
    const launchMonth = context.launchD0 ? monthKeyFromIso(context.launchD0) : null;
    const metaMonth = meta ? metaMonthKey(meta) : null;
    const monthsAlign = meta && !meta.__meta_status && launchMonth && metaMonth && launchMonth === metaMonth;
    const contribution = monthsAlign && actual ? ratioOrNull(context.launchRevenue, actual) : null;
    const contributionCopy = contribution !== null
      ? ` \u00b7 seu lancamento respondeu por ${fmtPct(contribution, 1)} do realizado desse mes`
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

    return {
      label: metaMonthKey(meta) ? `Meta mensal da empresa \u2014 ${metaMonthKey(meta)}` : 'Meta mensal da empresa',
      value: pct !== null ? fmtPct(pct, 1) : fmtBRL(target),
      copy: `Meta ${fmtBRL(target)} \u00b7 realizado ${fmtBRL(actual)}${shareCopy}${contributionCopy}`
    };
  }

  function evidenceSourceLine(key, context = {}) {
    const specs = {
      momento: { file: 'share_trajetoria.json', row: context.model, fields: ['receita_empresa_pre_periodo', 'receita_empresa_pos_periodo', 'variacao_receita_empresa_pct'] },
      representatividade: { file: 'share_trajetoria.json', row: context.model, fields: ['share_acumulado_atual', 'receita_lancamento_periodo'] },
      meta: { file: 'metas_mensais.json', row: context.metaRow, fields: ['meta_receita', 'realizado_receita', 'atingimento'] },
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

  function companyMomentNarrative(model) {
    const variation = numberOrNull(model?.variacao_receita_empresa_pct);
    const pre = numberOrNull(model?.receita_empresa_pre_periodo);
    const pos = numberOrNull(model?.receita_empresa_pos_periodo);
    const days = numberOrNull(model?.dias_pos_disponiveis);
    if (variation === null && pre === null && pos === null) {
      return { label: 'Momento', value: 'Sem contexto', copy: 'share_trajetoria ainda nao trouxe a leitura antes/depois da empresa.' };
    }
    const baselineInsuficiente = pre !== null && pos !== null && pre < Math.max(1000, pos * 0.01);
    if (baselineInsuficiente) {
      return {
        label: 'Sem base comparável',
        value: fmtBRL(pos),
        copy: `${fmtBRL(pre)} antes · ${fmtBRL(pos)} depois${days !== null ? ` · ${fmtNum(days)} dias` : ''} — período anterior sem receita suficiente pra calcular variação (dado incompleto ou empresa ainda não operava nesse volume).`
      };
    }
    const direction = variation > 0.05 ? 'Empresa acelerando' : variation < -0.05 ? 'Empresa pressionada' : 'Empresa estavel';
    return {
      label: direction,
      value: fmtPct(variation, 1),
      copy: `${fmtBRL(pre)} antes · ${fmtBRL(pos)} depois${days !== null ? ` · ${fmtNum(days)} dias` : ''}`
    };
  }

  function boundedPct(value, fallback = 0) {
    const num = Number(value);
    if (!Number.isFinite(num)) return fallback;
    return Math.max(0, Math.min(100, num));
  }

  function storySignal({ share, companyVariation, metaPending, campaignPending }) {
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
        copy: 'A representatividade já é suficiente para orientar leitura de mix, campanha e estoque.',
        question: 'Como preservar a rampa sem canibalizar a linha?'
      };
    }
    if (metaPending || campaignPending) {
      return {
        state: 'pending',
        title: 'Sinal comercial incompleto',
        copy: 'O dado de venda existe, mas meta ou campanha ainda limitam a leitura de eficiência.',
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

  function storyMetricHtml({ label, value, detail, width, state = 'ok', tooltip = '', extraHtml = '' }) {
    return `
      <div class="story-visual-metric story-visual-metric--${escapeHtml(state)}">
        <div class="story-visual-metric-head">
          ${labelTip(label, tooltip)}
          <strong>${escapeHtml(value)}</strong>
        </div>
        <div class="story-visual-track" aria-hidden="true"><i style="width:${boundedPct(width).toFixed(1)}%"></i></div>
        <p>${escapeHtml(detail)}</p>
        ${extraHtml}
      </div>
    `;
  }

  function renderStoryBrief(selected) {
    const wrap = $('story-brief');
    if (!wrap || !selected) return;

    const model = shareModelForLine(selected.modelo_id);
    const selectedWindow = selectedAnalysisWindow(selected);
    const company = companyMomentNarrative(model);
    const metaRow = metaMensalForLaunch(selected);
    const share = numberOrNull(model?.share_acumulado_atual);
    const launchRevenue = numberOrNull(model?.receita_lancamento_periodo) ?? numberOrNull(selectedWindow.data?.receita);
    const meta = metaNarrative(metaRow, { launchShare: share, launchRevenue, launchD0: selected.d0 });
    const campaign = campaignNarrative(selected);
    const companyVariation = numberOrNull(model?.variacao_receita_empresa_pct);
    const metaTarget = firstKnownCommercialNumber(metaRow, ['meta_receita', 'meta_faturamento', 'meta']);
    const metaActual = firstKnownCommercialNumber(metaRow, ['realizado_receita', 'receita_realizada', 'faturamento_realizado']);
    const metaPct = roasNumberOrNull(metaRow?.atingimento) ?? ratioOrNull(metaActual, metaTarget);
    const campaignRows = campaignRevenueRowsForLaunch(selected);
    const campaignRevenueValues = campaignRows.map(campaignRevenueValue).filter((value) => value !== null);
    const campaignRevenue = campaignRevenueValues.length ? campaignRevenueValues.reduce((acc, value) => acc + value, 0) : null;
    const campaignCount = new Set(campaignRows.map((row) => normalizeText(row.campanha || row.campaign || row.utm_campaign)).filter(Boolean)).size || campaignRows.length;
    const metaPending = meta.label === 'Pendente';
    const metaOpen = metaRow?.__meta_status === 'month_open';
    const campaignPending = campaign.label === 'Pendente';
    const signal = storySignal({ share, companyVariation, metaPending, campaignPending });
    const selectedPeriod = ANALYSIS_PERIODS.find((item) => item.key === state.analysisPeriodKey)?.label || state.analysisPeriodKey;
    const dLabel = selected.isFuture
      ? `D${selected.dPlus}`
      : `D+${Math.max(0, selected.dPlus ?? 0)}`;
    const shareWidth = share === null ? 0 : Math.max(4, Math.min(100, (share / 0.18) * 100));
    const companyWidth = companyVariation === null ? 0 : Math.max(6, Math.min(100, (Math.abs(companyVariation) / 0.22) * 100));
    const metaWidth = metaPct === null ? 0 : Math.max(4, Math.min(100, metaPct * 100));
    const campaignWidth = campaignRevenue === null || !launchRevenue
      ? (campaignRows.length ? 24 : 0)
      : Math.max(6, Math.min(100, (campaignRevenue / launchRevenue) * 100));
    const comparisonRows = selectedCompareLaunches()
      .map((launch) => ({
        launch,
        share: numberOrNull(shareModelForLine(launch.modelo_id)?.share_acumulado_atual)
      }))
      .filter((row) => row.share !== null)
      .sort((a, b) => b.share - a.share);
    const rank = comparisonRows.findIndex((row) => row.launch.modelo_id === selected.modelo_id) + 1;
    const rankCopy = rank > 0 ? `${fmtNum(rank)}º de ${fmtNum(comparisonRows.length)} no universo comparado` : 'Ranking depende de share_trajetoria.';
    const topShareRows = comparisonRows.slice(0, 3);
    const selectedInTopShare = topShareRows.some((row) => row.launch.modelo_id === selected.modelo_id);
    const selectedShareRow = comparisonRows.find((row) => row.launch.modelo_id === selected.modelo_id);
    const pinnedRow = (!selectedInTopShare && selectedShareRow) ? selectedShareRow : null;
    const pinnedIndex = pinnedRow ? comparisonRows.indexOf(pinnedRow) : -1;
    const topShareHtml = topShareRows.length
      ? `
        <div class="story-top-caption">Top 3 produtos por share</div>
        <ol class="story-top-list" aria-label="Top 3 produtos por representatividade">
          ${topShareRows.map((row, index) => `
            <li class="${row.launch.modelo_id === selected.modelo_id ? 'is-selected' : ''}">
              <b>${fmtNum(index + 1)}º</b>
              <span title="${escapeHtml(row.launch.modelo)}">${escapeHtml(row.launch.modelo)}</span>
              <em>${escapeHtml(fmtPct(row.share, 1))}</em>
            </li>
          `).join('')}
          ${pinnedRow ? `
            <li class="is-selected is-pinned">
              <b>${fmtNum(pinnedIndex + 1)}\u00ba</b>
              <span title="${escapeHtml(pinnedRow.launch.modelo)}">${escapeHtml(pinnedRow.launch.modelo)} (seu lancamento)</span>
              <em>${escapeHtml(fmtPct(pinnedRow.share, 1))}</em>
            </li>
          ` : ''}
        </ol>
      `
      : '<div class="story-empty-note">Top 3 depende de share_trajetoria.</div>';
    const thesis = share !== null
      ? `${selected.modelo} representou ${fmtPct(share, 1)} da receita da Reise no período coberto.`
      : `${selected.modelo} ainda não tem leitura de representatividade carregada.`;
    const storyIntroTooltip = 'Esta visão transforma dados do lançamento em narrativa executiva. Ela responde: qual foi o peso do lançamento, em que contexto a empresa estava, se existe meta/campanha para explicar o resultado e qual recorte investigar em seguida.';
    const centralQuestionTooltip = 'Pergunta de decisão que guia a leitura. Ela muda conforme representatividade, variação da empresa, metas mensais e faturamento por campanha disponíveis.';
    const signalTooltip = 'Resumo automático do momento do lançamento. Não é previsão fechada: é uma síntese para orientar a análise antes de entrar nos gráficos e tabelas.';
    const periodTooltip = 'Janela principal escolhida no filtro Período. Muda a leitura de KPIs, curva, comparativos e cards de contexto.';
    const dTooltip = 'Idade analítica do lançamento no snapshot atual. Ativos mostram até onde o dado real já chegou; planejados ou incompletos ficam como leitura parcial.';
    const revenueTooltip = 'Faturamento do lançamento usado como base da leitura executiva, vindo de share_trajetoria ou da janela selecionada quando o share ainda não está disponível.';
    const evidence = [
      storyMetricHtml({
        label: 'Representatividade',
        value: fmtPct(share, 1),
        detail: rankCopy,
        width: shareWidth,
        state: share !== null && share >= 0.12 ? 'focus' : 'ok',
        tooltip: 'Mostra quanto o lançamento pesou no faturamento da empresa no período coberto. A barra é uma escala visual de peso relativo; não é meta nem forecast.',
        extraHtml: topShareHtml
      }),
      storyMetricHtml({
        label: 'Momento da empresa',
        value: company.value,
        detail: company.copy,
        width: companyWidth,
        state: companyVariation !== null && companyVariation < -0.05 ? 'warn' : 'ok',
        tooltip: 'Compara o faturamento da empresa antes e depois do D0. Serve para separar performance do produto de contexto geral da empresa, como aceleração ou pressão.'
      }),
      storyMetricHtml({
        label: 'Meta mensal da empresa',
        value: meta.value,
        detail: meta.copy,
        width: metaWidth,
        state: metaPending ? 'pending' : metaOpen ? 'warn' : 'ok',
        tooltip: 'Cruza o mes do lancamento com metas_mensais. Se o mes ainda esta aberto, mostra o ultimo mes fechado como contexto. Share produto vem de share_trajetoria e mostra o peso do lancamento no periodo coberto.'
      }),
      storyMetricHtml({
        label: 'Campanhas',
        value: campaign.value,
        detail: campaignRows.length ? `${fmtNum(campaignCount)} campanha(s) mapeada(s)` : campaign.copy,
        width: campaignWidth,
        state: campaignPending ? 'pending' : 'ok',
        tooltip: 'Mostra se existe faturamento por campanha associado ao lançamento. Ajuda a separar venda orgânica, CRM, mídia paga e ações comerciais atribuídas.'
      })
    ];
    const decisionNotes = [
      {
        title: 'Onde olhar primeiro',
        tooltip: 'Indica o próximo recorte que mais reduz incerteza: curva, mix por cor/submodelo, estoque ou comparativo histórico.',
        copy: share !== null && share >= 0.08
          ? 'Abrir representatividade, mix por cor/submodelo e estoque para entender o que carregou a receita.'
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
        title: 'Próxima integração',
        tooltip: 'Mostra quais dados ainda faltam para fechar a história com mais segurança, principalmente metas mensais e faturamento por campanha.',
        copy: campaignPending && metaOpen
          ? 'Faturamento por campanha ainda completa a historia; meta do mes corrente entra quando o mes fechar.'
          : metaPending && campaignPending
            ? 'Metas mensais e faturamento por campanha ainda completam a historia de eficiencia.'
            : metaPending
              ? 'Metas mensais ainda completam a historia de eficiencia.'
              : campaignPending
                ? 'Faturamento por campanha ainda completa a historia de eficiencia.'
                : metaOpen
                  ? 'Meta do mes corrente entra quando o mes fechar; por enquanto a tela usa o ultimo fechado como contexto.'
                  : 'Cruzar meta, campanha e estoque para decidir reforco, pausa ou redistribuicao.'
      }
    ];

    const cards = [
      {
        step: '01',
        title: 'Momento da empresa',
        value: company.value,
        label: company.label,
        copy: evidenceSourceLine('momento', { model }),
        state: companyVariation !== null && companyVariation < -0.05 ? 'warn' : 'ok',
        tooltip: 'Evidência técnica do contexto: receita antes vs depois do lançamento e variação percentual da empresa.'
      },
      {
        step: '02',
        title: 'Representatividade',
        value: fmtPct(share, 1),
        label: fmtBRL(launchRevenue),
        copy: evidenceSourceLine('representatividade', { model }),
        state: 'focus',
        tooltip: 'Evidência técnica do peso do lançamento: share acumulado, faturamento do lançamento e posição no universo comparado.'
      },
      {
        step: '03',
        title: 'Meta mensal da empresa',
        value: meta.value,
        label: meta.label,
        copy: evidenceSourceLine('meta', { metaRow }),
        state: metaPending ? 'pending' : metaOpen ? 'warn' : 'ok',
        tooltip: 'Evidencia tecnica de meta: mes do lancamento, meta esperada, realizado e share do produto no periodo coberto. Se o mes ainda esta aberto, usa o ultimo mes fechado como contexto.'
      },
      {
        step: '04',
        title: 'Campanha',
        value: campaign.value,
        label: campaign.label,
        copy: evidenceSourceLine('campanha', { campaignRows }),
        state: campaign.label === 'Pendente' ? 'pending' : 'ok',
        tooltip: 'Evidência técnica de atribuição comercial: campanhas cadastradas, receita atribuída e quantidade de linhas disponíveis.'
      }
    ];

    wrap.innerHTML = `
      <div class="story-brief-panel story-brief-panel--${escapeHtml(signal.state)}">
        <div class="story-brief-head">
          <div>
            <div class="section-kicker story-kicker">${labelTip('Leitura executiva', storyIntroTooltip)}</div>
            <h2>A história do lançamento</h2>
            <p>${escapeHtml(thesis)} A tela deve contar se o lançamento foi relevante para a empresa, se performou contra meta e se a campanha explica o resultado.</p>
          </div>
          <div class="story-brief-verdict">
            ${labelTip('Pergunta central', centralQuestionTooltip)}
            <strong>${escapeHtml(signal.question)}</strong>
          </div>
        </div>
        <div class="story-visual-grid">
          <div class="story-hero-signal">
            ${labelTip('Sinal executivo', signalTooltip)}
            <strong>${escapeHtml(signal.title)}</strong>
            <p>${escapeHtml(signal.copy)}</p>
            <div class="story-signal-meta">
              <i tabindex="0" data-tooltip="${tooltipAttr(periodTooltip)}">${escapeHtml(selectedPeriod)}</i>
              <i tabindex="0" data-tooltip="${tooltipAttr(dTooltip)}">${escapeHtml(dLabel)}</i>
              <i tabindex="0" data-tooltip="${tooltipAttr(revenueTooltip)}">${escapeHtml(fmtBRL(launchRevenue))}</i>
            </div>
          </div>
          <div>
            <div class="story-visual-metrics">
              ${evidence.join('')}
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
          <summary><span>Ver evidências da leitura</span>${tip('Abre os quatro cards técnicos que sustentam o resumo executivo. Ficam recolhidos para poupar espaço e manter a narrativa principal em evidência.')}</summary>
          <div class="story-step-grid">
            ${cards.map((card) => `
              <div class="story-step story-step--${card.state}">
                <div class="story-step-num">${escapeHtml(card.step)}</div>
                <div>
                  ${labelTip(card.title, card.tooltip)}
                  <strong>${escapeHtml(card.value)}</strong>
                  <em>${escapeHtml(card.label)}</em>
                  <p>${card.copy}</p>
                </div>
              </div>
            `).join('')}
          </div>
        </details>
      </div>
    `;
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
    const selectedWindow = selectedAnalysisWindow(selected);

    const items = [
      { label: 'Data oficial', value: fmtDate(selected.data_oficial) },
      { label: 'D0 usado', value: fmtDate(selected.d0) },
      { label: 'Primeira venda', value: firstSaleLabel },
      { label: 'Posição snapshot', value: dLabel },
      { label: 'Janela KPI', value: selectedWindow.isCurrentAccumulated ? `Total até ${selectedWindow.label}` : selectedWindow.label }
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
        title: 'Relógio analítico',
        copy: `D+ e janelas fechadas usam a data do snapshot (${fmtDate(snapshotIso())}), derivada de manifest.generated_at.`,
        badge: badge('pipeline', 'Snapshot')
      },
      {
        title: 'Dado ausente',
        copy: 'Tabelas exibem “—” e gráficos usam null. Nunca convertem ausência em zero.',
        badge: badge('parcial', 'Regra fixa')
      }
    ];

    const shareQuality = state.data.manifest?.data_quality?.share_trajetoria;
    if (shareQuality) {
      rows.unshift({
        title: 'Alerta share_trajetoria',
        copy: String(shareQuality),
        badge: badge('neg', 'Share falhou')
      });
    }

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

  const REQUIRED_SHARE_MODEL_FIELDS = [
    'janela_completa',
    'dias_disponiveis',
    'janela_alvo_dias',
    'd0_coincide_com_sazonalidade'
  ];

  function sharePayloadForLaunch(launch) {
    const payload = state.data?.share_trajetoria;
    if (!payload || typeof payload !== 'object' || !payload.modelos) {
      return { error: 'data/share_trajetoria.json nao foi carregado ou esta fora do contrato esperado.' };
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
      return { error: `share_trajetoria incompleto: campo(s) obrigatorio(s) ausente(s): ${missing.join(', ')}.` };
    }
    return { model, points };
  }

  function shareDrawerError(message, selected) {
    const line = selected?.linha || selected?.modelo || 'Lancamento';
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
    if (!values.length) return 'Share diario do lancamento sem pontos validos.';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const companyValues = points.map((point) => numberOrNull(point.receita_empresa)).filter((value) => value !== null);
    const companyLayer = companyValues.length ? ' com camada de faturamento total da Reise.' : '.';
    return `Share diario do lancamento entre ${fmtPct(min, 1)} e ${fmtPct(max, 1)} ao longo de ${fmtNum(points.length)} dias${companyLayer}`;
  }

  function commercialEventTypeLabel(type) {
    const key = normalizeText(type);
    const labels = {
      promocao: 'Promocao',
      ruptura_estoque: 'Ruptura de estoque',
      midia_paga: 'Midia paga',
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
    const baselineInsuficiente = moment.label === 'Sem base comparável';

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
      <em class="${baselineInsuficiente ? 'share-stat-delta' : shareVariationClass(variation)}">${baselineInsuficiente ? `${escapeHtml(moment.label)} · ${escapeHtml(moment.copy)}` : `Variacao ${fmtPct(variation, 1)} em ${fmtNum(days)} dia(s) comparaveis`}</em>
    `;
  }

  function renderShareChart(points) {
    const canvas = $('share-chart');
    if (!canvas || !window.Chart) return;
    state.shareChart?.destroy?.();
    const styles = getComputedStyle(document.documentElement);
    const orange = styles.getPropertyValue('--orange').trim() || '#F07800';
    const orangeDim = styles.getPropertyValue('--orange-dim').trim() || 'rgba(240,120,0,0.15)';
    const warning = styles.getPropertyValue('--warning').trim() || '#E8A020';
    const commercial = '#5BB8D4';
    const company = 'rgba(255,255,255,0.58)';
    const companyValues = points.map((point) => numberOrNull(point.receita_empresa));
    const hasCompanyRevenueSeries = companyValues.some((value) => value !== null);
    const datasets = [{
      label: 'Share diario',
      data: points.map((point) => Number(point.share_do_dia)),
      yAxisID: 'y',
      borderColor: orange,
      backgroundColor: orangeDim,
      borderWidth: 2,
      fill: true,
      tension: 0.25,
      pointStyle: points.map((point) => hasCommercialEvent(point) ? 'rect' : (hasSeasonalEvent(point) ? 'rectRot' : 'circle')),
      pointRadius: points.map((point) => hasCommercialEvent(point) || hasSeasonalEvent(point) ? 5 : 2),
      pointHoverRadius: points.map((point) => hasCommercialEvent(point) || hasSeasonalEvent(point) ? 7 : 4),
      pointBackgroundColor: points.map((point) => hasCommercialEvent(point) ? commercial : (hasSeasonalEvent(point) ? warning : orange)),
      pointBorderColor: points.map((point) => hasCommercialEvent(point) ? commercial : (hasSeasonalEvent(point) ? warning : orange)),
      pointBorderWidth: points.map((point) => hasCommercialEvent(point) || hasSeasonalEvent(point) ? 2 : 1)
    }];

    if (hasCompanyRevenueSeries) {
      datasets.push({
        label: 'Faturamento total Reise',
        data: companyValues,
        yAxisID: 'y1',
        borderColor: company,
        backgroundColor: 'rgba(255,255,255,0.04)',
        borderWidth: 2,
        borderDash: [5, 5],
        fill: false,
        tension: 0.2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointBackgroundColor: company,
        pointBorderColor: company
      });
    }

    state.shareChart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map((point) => `D+${Number(point.dias_desde_lancamento || 0)}`),
        datasets
      },
      options: chartOptions({
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true } },
          y: {
            beginAtZero: true,
            position: 'left',
            title: { display: true, text: 'Share', color: 'rgba(255,255,255,0.55)' },
            ticks: { callback: (value) => fmtPct(Number(value), 0) }
          },
          ...(hasCompanyRevenueSeries ? {
            y1: {
              beginAtZero: true,
              position: 'right',
              grid: { drawOnChartArea: false },
              title: { display: true, text: 'Empresa', color: 'rgba(255,255,255,0.55)' },
              ticks: { callback: (value) => fmtBRL(Number(value), true) }
            }
          } : {})
        },
        plugins: {
          legend: {
            display: hasCompanyRevenueSeries,
            labels: { padding: 14, color: 'rgba(255,255,255,0.68)' }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => (
                ctx.dataset.yAxisID === 'y1'
                  ? `Faturamento total Reise: ${fmtBRL(ctx.parsed.y)}`
                  : `Share do dia: ${fmtPct(ctx.parsed.y, 1)}`
              ),
              afterLabel: (ctx) => {
                const point = points[ctx.dataIndex];
                const rows = [`Data calendario: ${fmtDateSlash(point.data_calendario)}`];
                if (hasSeasonalEvent(point)) rows.push(`Sazonalidade: ${point.evento_sazonal}`);
                if (hasCommercialEvent(point)) {
                  const label = commercialEventTypeLabel(point.evento_comercial_tipo);
                  const description = point.evento_comercial_descricao ? `: ${point.evento_comercial_descricao}` : '';
                  rows.push(`Evento comercial - ${label}${description}`);
                }
                return rows;
              }
            }
          }
        }
      })
    });
  }

  const DRILL_SUBMODEL_LABELS = {
    rs8avantmc: 'RS8 Avant MC',
    rs8avantab: 'RS8 Avant AB',
    rs8avantct: 'RS8 Avant CT',
    rs8avantcf: 'RS8 Avant CF',
    rs8mono: 'RS8 Mono',
    rs8_monochrome_sem_prefixo: 'Monochrome sem prefixo',
    series2_whisky: 'Whisky',
    series2_off_white: 'Off White',
    series2_azul_marinho: 'Azul Marinho',
    series2_sem_cor: 'Series 2 sem cor',
    phteasy: 'Phantom Easy',
    phtslip: 'Phantom Slip',
    phtknit: 'Phantom Knit',
    phantom_sem_prefixo: 'Phantom sem prefixo',
    rs6gt: 'RS6 GT',
    '911gt': '911 GT',
    knitgt: 'KNIT GT',
    gt_sem_prefixo: 'GT sem prefixo',
    rs6avant: 'RS6 Avant',
    rs7avant: 'RS7 Avant',
    rs8avant: 'RS8 Avant',
    avant_sem_prefixo: 'Avant sem prefixo'
  };

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
    return state.data?.share_trajetoria?.modelos?.[modelId] || null;
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
      return 'rs8_monochrome_sem_prefixo';
    }
    if (id === 'series_2') {
      if (/whisky|whiskey|^(rs8avant|series2|s2)(wh|wk|wky|ws)/.test(compact)) return 'series2_whisky';
      if (/offwhite|^(rs8avant|series2|s2)(ow|offwhite)/.test(compact)) return 'series2_off_white';
      if (/azulmarinho|marinho|^(rs8avant|series2|s2)(mr|am|azulmarinho|marinho)/.test(compact)) return 'series2_azul_marinho';
      return 'series2_sem_cor';
    }
    if (id === 'phantom') {
      if (compact.startsWith('phteasy') || compact.startsWith('phantomeasy')) return 'phteasy';
      if (compact.startsWith('phtslip') || compact.startsWith('phantomslip')) return 'phtslip';
      if (compact.startsWith('phtknit') || compact.startsWith('phantomknit')) return 'phtknit';
      return 'phantom_sem_prefixo';
    }
    if (id === 'gt') {
      if (compact.startsWith('rs6gt')) return 'rs6gt';
      if (compact.startsWith('911gt')) return '911gt';
      if (compact.startsWith('knitgt')) return 'knitgt';
      return 'gt_sem_prefixo';
    }
    if (id === 'avant') {
      if (compact.startsWith('rs6avant')) return 'rs6avant';
      if (compact.startsWith('rs7avant')) return 'rs7avant';
      if (compact.startsWith('rs8avant')) return 'rs8avant';
      return 'avant_sem_prefixo';
    }
    return id || null;
  }

  function rowSubModelId(row, modelId = '') {
    return row?.sub_modelo_id || inferSubModelIdFromSku(row, modelId || row?.modelo_id);
  }

  function subModelLabel(subId) {
    return DRILL_SUBMODEL_LABELS[subId] || String(subId || 'Sub-modelo').replace(/_/g, ' ').toUpperCase();
  }

  function subModelDailyRows(modelId) {
    const exported = state.data?.sub_modelos_dia;
    if (Array.isArray(exported) && exported.length) {
      return exported
        .filter((row) => row.modelo_id === modelId && row.sub_modelo_id)
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
        current.receita += Number((row.receita_bruta ?? row.receita) || 0);
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
          <span>Projecao tracejada: estimativa por regressao simples dos ultimos 10 dias, nao meta.</span>
          <span>Meta nao cadastrada.</span>
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
    const baselineInsuficiente = moment.label === 'Sem base comparável';
    if (pre === null || pos === null || !days) {
      return `
        <section class="drill-section">
          <div class="drill-section-title">Momento da empresa</div>
          <p class="drill-empty">comparativo indisponivel</p>
        </section>
      `;
    }
    const d0 = model.data_lancamento;
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
          <div><span>${baselineInsuficiente ? 'Leitura' : 'Variacao'}</span><strong class="${className}">${baselineInsuficiente ? escapeHtml(moment.label) : `${arrow} ${fmtPct(variation, 1)}`}</strong><small>${baselineInsuficiente ? escapeHtml(moment.copy) : `${fmtNum(days)} dias comparaveis`}</small></div>
        </div>
      </section>
    `;
  }

  function renderMomentoContext(selected) {
    const container = $('momento-context');
    if (!container) return;
    const model = shareModelForLine(selected.modelo_id);
    if (!model) {
      container.innerHTML = `<div class="empty-state"><div><strong>Sem dado de momento.</strong>share_trajetoria ainda nao tem este lancamento classificado.</div></div>`;
      return;
    }
    const seasonalWarning = model.d0_coincide_com_sazonalidade === true
      ? `<div class="share-warning"><span class="share-note-icon ti ti-alert-triangle" aria-hidden="true">!</span><span>Lancamento nasce em cima de data sazonal; nao comparavel 1:1 com os demais.</span></div>`
      : '';
    container.innerHTML = `
      ${seasonalWarning}
      <div class="grid grid-2" style="margin-bottom:14px">
        <div class="share-stat">
          <span>Share do faturamento</span>
          <strong>${fmtPct(model.share_acumulado_atual, 1)}</strong>
          <small>do faturamento total da Reise no periodo coberto</small>
        </div>
        <div class="share-stat">
          <span>Eventos comerciais</span>
          <strong>${fmtNum(model.eventos_comerciais_cadastrados || 0)}</strong>
          <small>cadastrados para este lancamento</small>
        </div>
      </div>
      ${companyMomentBlock(model)}
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
      return `
        <section class="drill-section">
          <div class="drill-section-title">Atribuicao por canal</div>
          <div class="drill-impact-grid">
            <div><span>Receita paga</span><strong>${fmtBRL(paidRevenue)}</strong><small>${fmtPct(total ? paidRevenue / total : null, 1)} do total atribuido</small></div>
            <div><span>Receita organica</span><strong>${fmtBRL(organicRevenue)}</strong><small>${fmtPct(total ? organicRevenue / total : null, 1)} do total atribuido</small></div>
          </div>
        </section>
      `;
    }

    return `
      <section class="drill-section">
        <div class="drill-section-title">Atribuicao comercial</div>
        <div class="drill-impact-grid">
          <div><span>Investimento agregado</span><strong>${fmtBRL(aggregate?.investimento)}</strong><small>${escapeHtml(aggregate?.janela || 'sem janela')}</small></div>
          <div><span>ROAS agregado</span><strong>${roasValue(aggregate?.roas)}</strong><small>sem divisao por canal</small></div>
        </div>
        <div class="drill-visible-warning">
          <strong>Atribuicao real pendente</strong>
          <span>O dashboard nao usa mais correlacao dias-com-investimento vs dias-sem como impacto. Ate a view por pedido entrar no payload, midia fica agregada por janela e ROAS por canal fica bloqueado quando a receita for repetida.</span>
        </div>
      </section>
    `;
  }

  function shareRankingBlock(focusId) {
    const rows = drillLineOptions().map((launch) => {
      const model = shareModelForLine(launch.modelo_id);
      return {
        id: launch.modelo_id,
        label: model?.linha || launch.linha || launch.modelo,
        value: numberOrNull(model?.share_acumulado_atual)
      };
    }).filter((row) => row.value !== null).sort((a, b) => b.value - a.value);
    const max = Math.max(...rows.map((row) => row.value), 0.01);
    return `
      <section class="drill-section">
        <div class="drill-section-title">Ranking por share</div>
        <div class="drill-ranking">
          ${rows.map((row) => `
            <div class="drill-rank-row ${row.id === focusId ? 'is-focus' : ''}">
              <span>${escapeHtml(row.label)}</span>
              <div class="drill-rank-track"><i style="width:${Math.max(2, (row.value / max) * 100).toFixed(1)}%"></i></div>
              <strong>${fmtPct(row.value, 1)}</strong>
            </div>
          `).join('')}
        </div>
      </section>
    `;
  }

  function lineSelectHtml(currentId) {
    return `
      <label class="drill-control">
        <span>Trocar linha</span>
        <select data-drill-line-select>
          ${drillLineOptions().map((launch) => `<option value="${escapeHtml(launch.modelo_id)}"${launch.modelo_id === currentId ? ' selected' : ''}>${escapeHtml(shareModelForLine(launch.modelo_id)?.linha || launch.linha || launch.modelo)}</option>`).join('')}
        </select>
      </label>
    `;
  }

  function subSelectHtml(modelId, currentSubId) {
    const options = subModelTotals(modelId);
    return `
      <label class="drill-control">
        <span>Trocar sub-modelo</span>
        <select data-drill-sub-select>
          ${options.map((row) => `<option value="${escapeHtml(row.sub_modelo_id)}"${row.sub_modelo_id === currentSubId ? ' selected' : ''}>${escapeHtml(subModelLabel(row.sub_modelo_id))}</option>`).join('')}
        </select>
      </label>
    `;
  }

  function breadcrumbHtml(level, launch, subId = '') {
    const lineLabel = shareModelForLine(launch.modelo_id)?.linha || launch.linha || launch.modelo;
    const parts = [
      `<button type="button" data-drill-navigate data-level="linha" data-line="${escapeHtml(launch.modelo_id)}">Linha: ${escapeHtml(lineLabel)}</button>`
    ];
    if (level === 'submodelo' || level === 'sku') {
      if (subId) {
        parts.push(`<button type="button" data-drill-navigate data-level="submodelo" data-line="${escapeHtml(launch.modelo_id)}" data-sub="${escapeHtml(subId)}">Sub-modelo: ${escapeHtml(subModelLabel(subId))}</button>`);
      }
    }
    if (level === 'sku') parts.push('<span>SKU / cor</span>');
    return `<nav class="drill-breadcrumb" aria-label="Caminho da analise">${parts.join('<i>/</i>')}</nav>`;
  }

  function drillLevelMeta(level) {
    const meta = {
      linha: { step: '1 de 3', label: 'Linha', copy: 'Visao macro da representatividade' },
      submodelo: { step: '2 de 3', label: 'Sub-modelo', copy: 'Familias internas da linha' },
      sku: { step: '3 de 3', label: 'Cor / SKU', copy: 'Cobertura e venda por cor' }
    };
    return meta[level] || meta.linha;
  }

  function drillBackButtonHtml(level, launch, subId = '') {
    if (level === 'linha') {
      return '<span class="drill-nav-spacer" aria-hidden="true"></span>';
    }
    const targetLevel = level === 'sku' && subId ? 'submodelo' : 'linha';
    const targetSub = targetLevel === 'submodelo' ? subId : '';
    const label = targetLevel === 'submodelo' ? 'Voltar para sub-modelo' : 'Voltar para linha';
    return `
      <button class="drill-back-button" type="button" data-drill-navigate data-level="${targetLevel}" data-line="${escapeHtml(launch.modelo_id)}" data-sub="${escapeHtml(targetSub)}">
        <span aria-hidden="true">←</span>
        <span>${escapeHtml(label)}</span>
      </button>
    `;
  }

  function drillNavigationHtml(level, launch, subId = '') {
    const meta = drillLevelMeta(level);
    return `
      <div class="drill-nav-strip">
        ${drillBackButtonHtml(level, launch, subId)}
        ${breadcrumbHtml(level, launch, subId)}
        <div class="drill-level-pill">
          <span>${escapeHtml(meta.step)}</span>
          <strong>${escapeHtml(meta.label)}</strong>
          <small>${escapeHtml(meta.copy)}</small>
        </div>
      </div>
    `;
  }

  function drillActionCardHtml({ level, line, sub = '', kicker, title, copy, disabled = false, variant = '' }) {
    return `
      <button class="drill-action-card ${variant ? `drill-action-card--${variant}` : ''}" type="button" data-drill-navigate data-level="${escapeHtml(level)}" data-line="${escapeHtml(line)}" data-sub="${escapeHtml(sub)}"${disabled ? ' disabled' : ''}>
        <span>${escapeHtml(kicker)}</span>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(copy)}</small>
        <em aria-hidden="true">↗</em>
      </button>
    `;
  }

  function renderLineLevel(launch) {
    const model = shareModelForLine(launch.modelo_id);
    const points = sharePointsForLine(launch.modelo_id).filter((point) => numberOrNull(point.share_do_dia) !== null);
    const bestSub = bestSubModelId(launch.modelo_id);
    if (!model || !points.length) return shareDrawerError('share_trajetoria nao tem pontos validos para esta linha.', launch);
    const lineLabel = model.linha || launch.linha || launch.modelo;

    return `
      ${drillNavigationHtml('linha', launch)}
      <div class="share-drawer-head drill-head">
        <div>
          <div class="share-drawer-kicker">Analise por niveis</div>
          <h3>${escapeHtml(lineLabel)}</h3>
          <p>D0 ${fmtDate(model.data_lancamento || launch.d0)} · dado ate ${fmtDateSlash(shareDataUntil(model, points))}</p>
        </div>
        ${lineSelectHtml(launch.modelo_id)}
      </div>
      <div class="share-badges">${drillWindowBadge(model)}</div>
      <section class="drill-section">
        <div class="drill-section-title">Curva de share diario</div>
        ${drillShareSvg(points, model)}
      </section>
      ${companyMomentBlock(model)}
      ${impactInvestmentBlock(launch.modelo_id)}
      ${shareRankingBlock(launch.modelo_id)}
      <div class="drill-action-grid">
        ${drillActionCardHtml({
          level: 'submodelo',
          line: launch.modelo_id,
          sub: bestSub,
          kicker: 'Proximo nivel',
          title: 'Sub-modelos',
          copy: 'Compare familias internas antes de abrir SKU/cor.',
          disabled: !bestSub,
          variant: 'primary'
        })}
        ${drillActionCardHtml({
          level: 'sku',
          line: launch.modelo_id,
          kicker: 'Detalhe operacional',
          title: 'Cores e estoque',
          copy: 'Veja venda, estoque atual e cobertura por cor.'
        })}
      </div>
    `;
  }

  function renderSubModelLevel(launch, subId) {
    const model = shareModelForLine(launch.modelo_id);
    const selectedSub = subId || bestSubModelId(launch.modelo_id);
    const rows = subModelDailyRows(launch.modelo_id)
      .filter((row) => row.sub_modelo_id === selectedSub)
      .map((row) => ({
        ...row,
        day: dayIndex(model?.data_lancamento || launch.d0, row.data)
      }))
      .filter((row) => Number.isFinite(row.day));
    const totals = subModelTotals(launch.modelo_id);
    const max = Math.max(...totals.map((row) => row.receita), 0.01);

    return `
      ${drillNavigationHtml('submodelo', launch, selectedSub)}
      <div class="share-drawer-head drill-head">
        <div>
          <div class="share-drawer-kicker">Sub-modelo</div>
          <h3>${escapeHtml(subModelLabel(selectedSub))}</h3>
          <p>${escapeHtml(model?.linha || launch.linha || launch.modelo)} - D0 ${fmtDate(model?.data_lancamento || launch.d0)}</p>
        </div>
        ${subSelectHtml(launch.modelo_id, selectedSub)}
      </div>
      <div class="share-badges">${drillWindowBadge(model)}</div>
      <section class="drill-section">
        <div class="drill-section-title">Curva de receita/vendas do sub-modelo</div>
        ${rows.length ? drillRevenueSvg(rows.map((row) => ({ day: row.day, receita: row.receita }))) : '<p class="drill-empty">Sem venda diaria para este sub-modelo.</p>'}
      </section>
      <section class="drill-section">
        <div class="drill-section-title">Comparacao entre sub-modelos da linha</div>
        <div class="drill-ranking">
          ${totals.map((row) => `
            <div class="drill-rank-row ${row.sub_modelo_id === selectedSub ? 'is-focus' : ''}">
              <span>${escapeHtml(subModelLabel(row.sub_modelo_id))}</span>
              <div class="drill-rank-track"><i style="width:${Math.max(2, (row.receita / max) * 100).toFixed(1)}%"></i></div>
              <strong>${fmtBRL(row.receita, true)}</strong>
            </div>
          `).join('')}
        </div>
      </section>
      <div class="drill-action-grid">
        ${drillActionCardHtml({
          level: 'linha',
          line: launch.modelo_id,
          kicker: 'Voltar',
          title: 'Linha completa',
          copy: 'Retorne para share, momento da empresa e ranking geral.'
        })}
        ${drillActionCardHtml({
          level: 'sku',
          line: launch.modelo_id,
          sub: selectedSub,
          kicker: 'Proximo nivel',
          title: 'Cores deste sub-modelo',
          copy: 'Abra cobertura e venda por cor dentro do sub-modelo.',
          variant: 'primary'
        })}
      </div>
    `;
  }

  function colorFromStockRow(row, modelId) {
    return normalizeColorValue(row.cor, modelId, true)
      || colorFromSku(row.sub_modelo, modelId)
      || normalizeColorValue(row.sub_modelo, modelId, true)
      || UNKNOWN_COLOR_LABEL;
  }

  function skuColorRows(launch, subId = '') {
    const modelId = launch.modelo_id;
    const model = shareModelForLine(modelId);
    const d0 = model?.data_lancamento || launch.d0;
    const daysObserved = Math.max(1, (numberOrNull(model?.dias_pos_disponiveis) || launch.dPlus || 0) + 1);
    const grouped = new Map();
    const ensure = (color) => {
      const key = color || UNKNOWN_COLOR_LABEL;
      if (!grouped.has(key)) {
        grouped.set(key, { cor: key, pares: 0, receita: 0, estoque_atual: 0, estoque_tem_dado: false });
      }
      return grouped.get(key);
    };

    (state.data?.lancamentos_produtos_dia || [])
      .filter((row) => row.modelo_id === modelId)
      .filter((row) => !subId || rowSubModelId(row, modelId) === subId)
      .forEach((row) => {
        const color = extractColor(row, launch);
        const item = ensure(color);
        item.pares += Number(row.pares || row.quantidade || 0);
        item.receita += Number((row.receita_bruta ?? row.receita) || 0);
      });

    (state.data?.estoque || [])
      .filter((row) => row.modelo_id === modelId)
      .filter((row) => !subId || inferSubModelIdFromSku(row, modelId) === subId)
      .forEach((row) => {
        const color = colorFromStockRow(row, modelId);
        const item = ensure(color);
        item.estoque_atual += Number(row.estoque_atual || 0);
        item.estoque_tem_dado = true;
      });

    return [...grouped.values()].map((row) => {
      const dailyPace = row.pares > 0 ? row.pares / daysObserved : null;
      const coverage = dailyPace ? row.estoque_atual / dailyPace : null;
      return { ...row, cobertura_dias: coverage };
    }).sort((a, b) => {
      const aCov = a.cobertura_dias === null ? Infinity : a.cobertura_dias;
      const bCov = b.cobertura_dias === null ? Infinity : b.cobertura_dias;
      return aCov - bCov || b.pares - a.pares;
    });
  }

  function renderSkuLevel(launch, subId = '') {
    const model = shareModelForLine(launch.modelo_id);
    const rows = skuColorRows(launch, subId);
    const title = subId ? `${subModelLabel(subId)} por cor` : `${model?.linha || launch.linha || launch.modelo} por cor`;
    return `
      ${drillNavigationHtml('sku', launch, subId)}
      <div class="share-drawer-head drill-head">
        <div>
          <div class="share-drawer-kicker">SKU / cor</div>
          <h3>${escapeHtml(title)}</h3>
          <p>${subId ? 'Filtro aplicado ao sub-modelo selecionado.' : 'Visao da linha inteira, sem filtro de sub-modelo.'}</p>
        </div>
      </div>
      <div class="share-badges">${drillWindowBadge(model)}</div>
      <section class="drill-section">
        <div class="drill-section-title">Tabela por cor</div>
        <div class="drill-table-wrap">
          <table class="drill-table">
            <thead>
              <tr>
                <th>Cor</th>
                <th>Vendas no periodo</th>
                <th>Estoque atual</th>
                <th>Cobertura projetada</th>
              </tr>
            </thead>
            <tbody>
              ${rows.map((row) => `
                <tr class="${row.cobertura_dias !== null && row.cobertura_dias < 7 ? 'drill-negative' : ''}">
                  <td>${escapeHtml(row.cor)}</td>
                  <td>${fmtNum(row.pares)} pares</td>
                  <td>${row.estoque_tem_dado ? fmtNum(row.estoque_atual) : '&mdash;'}</td>
                  <td>${stockCoverageLabel(row.cobertura_dias, 0)}</td>
                </tr>
              `).join('') || '<tr><td colspan="4">Sem dados de cor para este recorte.</td></tr>'}
            </tbody>
          </table>
        </div>
      </section>
      <div class="drill-action-grid">
        ${subId ? drillActionCardHtml({
          level: 'submodelo',
          line: launch.modelo_id,
          sub: subId,
          kicker: 'Voltar',
          title: 'Sub-modelo',
          copy: 'Retorne para a curva e comparacao entre sub-modelos.'
        }) : drillActionCardHtml({
          level: 'linha',
          line: launch.modelo_id,
          kicker: 'Voltar',
          title: 'Linha completa',
          copy: 'Retorne para a visao macro da linha.'
        })}
      </div>
    `;
  }

  function attachDrillEvents(content) {
    content.querySelectorAll('[data-drill-navigate]').forEach((button) => {
      button.addEventListener('click', () => {
        navigateAnalysisDrill(button.dataset.level, button.dataset.line, button.dataset.sub || '', button);
      });
    });
    const lineSelect = content.querySelector('[data-drill-line-select]');
    if (lineSelect) {
      lineSelect.addEventListener('change', (event) => {
        navigateAnalysisDrill('linha', event.currentTarget.value, '', event.currentTarget);
      });
    }
    const subSelect = content.querySelector('[data-drill-sub-select]');
    if (subSelect) {
      subSelect.addEventListener('change', (event) => {
        const params = analysisParamsFromHash();
        navigateAnalysisDrill('submodelo', params.linha, event.currentTarget.value, event.currentTarget);
      });
    }
  }

  function renderAnalysisDrillFromHash() {
    if (!state.data) return;
    const params = analysisParamsFromHash();
    if (!params.nivel) {
      if (document.body.classList.contains('share-drawer-open')) closeShareDrawer(false);
      return;
    }

    const content = $('share-drawer-content');
    if (!content) return;
    const fallbackLaunch = drillLineOptions()[0] || comparableLaunches()[0] || state.launches[0];
    const launch = lineLaunchById(params.linha) || fallbackLaunch;
    if (!launch) return;
    const level = ['linha', 'submodelo', 'sku'].includes(params.nivel) ? params.nivel : 'linha';
    const subId = params.sub || (level === 'submodelo' ? bestSubModelId(launch.modelo_id) : '');

    if (level === 'submodelo') content.innerHTML = renderSubModelLevel(launch, subId);
    else if (level === 'sku') content.innerHTML = renderSkuLevel(launch, subId);
    else content.innerHTML = renderLineLevel(launch);

    attachDrillEvents(content);
    applyCollapsibleLists(content);
    setShareDrawerOpen(true);
  }

  function navigateAnalysisDrill(level, modelId, subId = '', returnFocus) {
    const launch = lineLaunchById(modelId) || drillLineOptions()[0] || comparableLaunches()[0] || state.launches[0];
    if (!launch) return;
    shareDrawerReturnFocus = returnFocus || shareDrawerReturnFocus || document.activeElement;
    const nextHash = analysisHash(level || 'linha', launch.modelo_id, subId || '');
    if (location.hash === nextHash) renderAnalysisDrillFromHash();
    else location.hash = nextHash;
  }

  function openShareDrawer(selected, returnFocus) {
    if (selected) {
      navigateAnalysisDrill('linha', selected.modelo_id, '', returnFocus || document.activeElement);
      return;
    }
    const content = $('share-drawer-content');
    if (!content || !selected) return;

    shareDrawerReturnFocus = returnFocus || document.activeElement;
    const result = sharePayloadForLaunch(selected);
    if (result.error) {
      content.innerHTML = shareDrawerError(result.error, selected);
      setShareDrawerOpen(true);
      return;
    }

    const model = result.model;
    const points = result.points
      .filter((point) => Number.isFinite(Number(point.dias_desde_lancamento)) && Number.isFinite(Number(point.share_do_dia)))
      .sort((a, b) => Number(a.dias_desde_lancamento) - Number(b.dias_desde_lancamento));
    if (!points.length) {
      content.innerHTML = shareDrawerError('share_trajetoria nao tem pontos validos para este lancamento.', selected);
      setShareDrawerOpen(true);
      return;
    }

    const hasSeasonal = points.some(hasSeasonalEvent);
    const hasCommercial = points.some(hasCommercialEvent);
    const commercialRegistered = Number(model.eventos_comerciais_cadastrados || 0) > 0;
    const hasAltRevenueRule = points.some((point) => point.regra_receita_empresa === 'paid_at_sem_tag');
    const line = model.linha || selected.linha || selected.modelo;
    const coveredPeriod = shareCoveredPeriod(points);
    const dataUntil = shareDataUntil(model, points);
    const hasCompanyRevenueSeries = points.some((point) => numberOrNull(point.receita_empresa) !== null);
    const partialBadge = model.janela_completa === false
      ? `<span class="badge badge-warning">Parcial — D+${fmtNum(model.dias_disponiveis)} de ${fmtNum(model.janela_alvo_dias)}</span>`
      : '';
    const completeBadge = model.janela_completa === true
      ? `<span class="badge badge-neutral">Janela completa</span>`
      : '';
    const seasonalWarning = model.d0_coincide_com_sazonalidade === true
      ? `<div class="share-warning"><span class="share-note-icon ti ti-alert-triangle" aria-hidden="true">!</span><span>Lançamento nasce em cima de data sazonal — não comparável 1:1 com os demais.</span></div>`
      : '';
    const commercialNote = commercialRegistered
      ? (hasCommercial
        ? ''
        : '<p class="share-note">Ha evento comercial cadastrado para este lancamento, mas nenhum cruza o periodo coberto no grafico.</p>')
      : '<p class="share-note share-note--pending">Nenhum evento comercial registrado para este lancamento - cadastro manual pendente.</p>';
    const markerLegend = (hasSeasonal || hasCommercial)
      ? `<div class="share-legend">
          ${hasSeasonal ? '<span><i class="share-marker share-marker--seasonal"></i>Sazonalidade</span>' : ''}
          ${hasCommercial ? '<span><i class="share-marker share-marker--commercial"></i>Evento comercial</span>' : ''}
        </div>`
      : '';

    content.innerHTML = `
      <div class="share-drawer-head">
        <div>
          <div class="share-drawer-kicker">Share de representatividade</div>
          <h3>${escapeHtml(line)}</h3>
          <p>${escapeHtml(selected.modelo)} · D0 ${fmtDate(model.data_lancamento || selected.d0)}</p>
        </div>
      </div>
      <div class="share-data-note">Dado ate ${fmtDateSlash(dataUntil)} · ${fmtNum(points.length)} dia(s) observado(s)</div>
      <div class="share-badges">${partialBadge || completeBadge}</div>
      ${seasonalWarning}
      <div class="share-stats">
        <div class="share-stat">
          <span>Share acumulado</span>
          <strong>${fmtPct(model.share_acumulado_atual, 1)}</strong>
          <small>do faturamento total da Reise no periodo</small>
        </div>
        <div class="share-stat">
          <span>Receita do lançamento</span>
          <strong>${fmtBRL(model.receita_lancamento_periodo)}</strong>
          <small>itens classificados no periodo coberto</small>
        </div>
        <div class="share-stat">
          <span>Ticket médio empresa</span>
          <strong>${fmtBRL(model.ticket_medio_empresa_periodo)}</strong>
          <small>receita total da Reise / pedidos no periodo</small>
        </div>
        <div class="share-stat share-stat-company">
          <span>Momento da empresa</span>
          ${shareCompanyMomentHtml(model)}
        </div>
      </div>
      <div class="share-chart-card">
        <div class="share-chart-title">
          <span>Share diario + empresa</span>
          <div class="share-chart-meta">
            <small>Periodo coberto: ${escapeHtml(coveredPeriod)}</small>
            <small>Eixo alinhado por D+n do lançamento</small>
          </div>
        </div>
        <div class="share-chart-canvas">
          <canvas id="share-chart" role="img" aria-label="${escapeHtml(shareChartAria(points))}"></canvas>
        </div>
        ${hasCompanyRevenueSeries ? '' : '<p class="share-note share-note--pending">Camada de faturamento total da empresa ausente no JSON atual. Reexecute exportarTudo para ativar a linha comparativa.</p>'}
        ${markerLegend}
        ${hasSeasonal ? '' : '<p class="share-note">Sem data sazonal dentro da janela D0-D90 deste lançamento.</p>'}
        ${commercialNote}
      </div>
      ${hasAltRevenueRule ? '<div class="share-footer-note"><span class="share-note-icon ti ti-info-circle" aria-hidden="true">i</span><span>Parte do período usa regra de receita alternativa por causa de uma falha de tag no Shopify entre ago-nov/2025 — ver documentação.</span></div>' : ''}
    `;

    setShareDrawerOpen(true);
    renderShareChart(points);
  }

  function renderState(selected) {
    const container = $('launch-state');
    if (selected.isFuture) {
      const diff = Math.max(0, daysBetween(snapshotIso(), toDate(selected.d0)) || 0);
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

    const selectedWindow = selectedAnalysisWindow(selected);
    const { key, data, isCurrentAccumulated } = selectedWindow;
    const periodLabel = selectedWindow.label || key || '—';
    const windowDays = isCurrentAccumulated ? ((selected.acumulado_atual?.day ?? 0) + 1) : windowSpanDays(key);
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
      {
        label: isCurrentAccumulated ? 'Faturamento atual' : `Faturamento ${periodLabel}`,
        value: fmtBRL(data?.receita),
        sub: dataSub,
        tooltip: `Soma da receita bruta dos itens do modelo quando receita_bruta existe no JSON; em JSON antigo usa o campo receita. Periodo: ${isCurrentAccumulated ? `D0 ate ${key}` : `janela ${periodLabel}`}. Nao inclui itens fora do modelo no mesmo pedido.`
      },
      {
        label: 'Pedidos',
        value: fmtNum(data?.pedidos),
        sub: data?.pedidos ? `${fmtNum(data.pedidos)} pedidos` : 'Sem pedidos no JSON',
        tooltip: 'Quantidade de pedidos distintos na janela. Quando existe source_order_id, o dashboard conta pedidos unicos; se nao existir, usa o campo pedidos do JSON.'
      },
      {
        label: 'Ticket médio/pedido',
        value: fmtBRL(data?.ticket),
        sub: data?.ticket ? (isCurrentAccumulated ? `Acumulado ${key}` : `Janela ${periodLabel}`) : '—',
        tooltip: 'Formula: faturamento do modelo / pedidos validos com itens do modelo. Usa a mesma base de receita exibida no card de faturamento.'
      },
      {
        label: 'Preço médio/par',
        value: fmtBRL(data?.preco_medio_par),
        sub: data?.preco_medio_par ? `${fmtNum(data?.pares)} pares` : '—',
        tooltip: 'Formula: faturamento do modelo / pares vendidos do modelo. Nao usa total do carrinho e nao substitui preco cheio.'
      },
      {
        label: '% Clientes novos',
        value: fmtPct(data?.novos_pct),
        sub: data?.novos_pct != null ? `${fmtPct(1 - data.novos_pct)} recorrentes` : '—',
        tooltip: 'Formula: novos / (novos + recorrentes). Fica vazio quando a classificacao de cliente nao veio auditada no JSON; ausencia nao vira zero.'
      },
      {
        label: 'Pares vendidos',
        value: fmtNum(data?.pares),
        sub: data?.pares ? `${fmtNum(data.pares)} pares` : 'Sem pares no JSON',
        tooltip: 'Soma das quantidades vendidas dos itens classificados no modelo. Fonte: pipeline ou historico agregado, conforme o badge.'
      }
    ];

    const empty = !data ? `<div class="empty-state"><div><strong>${selected.isActive && !hasPipelineRows(selected) ? 'Sem dados carregados no pipeline.' : `Sem dados de venda para ${periodLabel}.`}</strong> Verifique BigQuery, termos de busca e exportação do Apps Script. A tela não transforma ausência em zero.</div></div>` : '';

    container.innerHTML = `
      <div class="grid grid-6">
        ${cards.map((card) => `
          <div class="card">
            <div class="metric-label">${labelTip(card.label, card.tooltip)}</div>
            <div class="metric-value">${card.value}</div>
            <div class="metric-sub">${card.sub}</div>
          </div>`).join('')}
      </div>
      ${auditWarning}
      ${empty}
      <div class="grid grid-2" style="margin-top:14px">
        <div class="card soft">
          <div class="metric-label">${labelTip('Velocidade diária', 'Formula: receita / numero de dias considerados. Em acumulado atual usa D0 ate D+n; em janela fechada usa D0 ate o marco D+N inclusivo.')}</div>
          <div class="metric-value">${fmtBRL(velocity)}</div>
          <div class="metric-sub">${isCurrentAccumulated ? `R$/dia no acumulado ${key}` : `R$/dia na janela ${periodLabel}`}</div>
        </div>
        <div class="card soft">
          <div class="metric-label">${labelTip('Comparativo anterior', 'Delta percentual contra o modelo anterior elegivel na mesma janela. Fica vazio quando a janela ainda nao fechou ou o comparavel nao tem dado.')}</div>
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
      if (subText) subText.textContent = 'Faturamento acumulado por dia desde o lançamento';
      const chartLaunches = selectedCompareLaunches();
      const normalizedLabels = Array.from({ length: 91 }, (_, day) => day === 0 ? 'D0' : `D+${day}`);
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
      if (subText) subText.textContent = 'Faturamento diário por linha, alinhado por data real (não por D+n)';
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
    return data.receita / windowSpanDays(key);
  }

  function renderDplusComparison(selected) {
    if (!$('dplus-table')) return;
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
    if (!$('ranking-grid')) return;
    const rankingDefs = [
      { title: 'Faturamento D+7', get: (l) => getWindow(l, '7d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 ate D+7. So entra quem tem a janela fechada ou historico cadastrado.' },
      { title: 'Faturamento D+15', get: (l) => getWindow(l, '15d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 ate D+15. Para ativos, depende do snapshot ja ter alcancado D+15.' },
      { title: 'Faturamento D+30', get: (l) => getWindow(l, '30d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 ate D+30. Nulos indicam janela ainda nao fechada ou dado ausente.' },
      { title: 'Faturamento D+60', get: (l) => getWindow(l, '60d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 ate D+60. Use com cuidado se poucos modelos tiverem essa janela.' },
      { title: 'Faturamento D+90', get: (l) => getWindow(l, '90d')?.receita, fmt: fmtBRL, tooltip: 'Ranking por receita acumulada de D0 ate D+90. E o marco mais completo, mas pode excluir modelos em curso.' },
      { title: 'Ticket/pedido D+30', get: (l) => getWindow(l, '30d')?.ticket, fmt: fmtBRL, tooltip: 'Formula: receita D+30 / pedidos D+30. Ajuda a avaliar valor medio por pedido, nao volume total.' },
      { title: 'Pares D+30', get: (l) => getWindow(l, '30d')?.pares, fmt: fmtNum, tooltip: 'Quantidade de pares vendidos de D0 ate D+30. Compara volume fisico, independente de preco.' },
      { title: '% novos D+30', get: (l) => getWindow(l, '30d')?.novos_pct, fmt: fmtPct, tooltip: 'Formula: novos / (novos + recorrentes) no D+30. Fica vazio quando nao ha classificacao auditada.' },
      { title: 'Velocidade R$/dia', get: windowVelocity, fmt: fmtBRL, tooltip: 'Formula: receita da melhor janela fechada / quantidade de dias inclusivos da janela. Serve para comparar ritmo, nao tamanho final.' }
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
        <div class="metric-label">${labelTip('Modelo selecionado', `Receita do modelo em foco no mesmo marco usado para comparar: ${label}. Se houver dado diario, usa acumulado ate D+n; caso contrario usa a melhor janela fechada.`)}</div>
        <div class="metric-value">${fmtBRL(selectedValue)}</div>
        <div class="metric-sub">${escapeHtml(selected.modelo)} · ${escapeHtml(label)}</div>
      </div>
      <div class="card">
        <div class="metric-label">${labelTip('Média histórica', 'Media simples dos modelos historicos elegiveis na mesma janela ou D+n. Historico agregado nao vira curva diaria inventada quando nao ha base segura.')}</div>
        <div class="metric-value">${fmtBRL(avg)}</div>
        <div class="metric-sub">Históricos disponíveis · ${escapeHtml(label)}</div>
      </div>
      <div class="card">
        <div class="metric-label">${labelTip('Diferença vs média', 'Formula: receita do modelo selecionado menos media historica. Percentual = diferenca / media historica.')}</div>
        <div class="metric-value">${diff === null ? '—' : metricDelta(selectedValue, avg, fmtBRL)}</div>
        <div class="metric-sub">${pct === null ? '—' : fmtPct(pct)}</div>
      </div>`;
  }

  function renderComparison(tbodyId = 'comparison-table') {
    const tbody = $(tbodyId);
    if (!tbody) return;
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      tbody.innerHTML = comparisonEmptyMessage(13);
      return;
    }

    const selected = state.launches.find((l) => l.modelo_id === state.primaryModelId) || launches[0];
    const day = comparisonDay(selected);
    const referencePool = launches.some(isHistoricalLaunch)
      ? launches
      : comparableLaunches();
    const historicalRefs = referencePool.filter((l) => isHistoricalLaunch(l));
    let averageLabel = day !== null && day !== undefined ? `D+${day}` : 'D+30';
    let averageValues = day !== null && day !== undefined
      ? historicalRefs.map((launch) => cumulativeAt(launch, day)?.receita).filter((value) => value !== null && value !== undefined)
      : [];

    if (!averageValues.length) {
      averageLabel = 'D+30';
      averageValues = historicalRefs.map((launch) => getWindow(launch, '30d')?.receita).filter((value) => value !== null && value !== undefined);
    }

    const historicalAverage = averageValues.length
      ? averageValues.reduce((acc, value) => acc + value, 0) / averageValues.length
      : null;

    const rows = launches.map((launch) => {
      const j7 = getWindow(launch, '7d');
      const j15 = getWindow(launch, '15d');
      const j30 = getWindow(launch, '30d');
      const j60 = getWindow(launch, '60d');
      const j90 = getWindow(launch, '90d');
      const dplus = day !== null && day !== undefined ? cumulativeAt(launch, day) : null;
      const best = bestWindow(launch);
      const velocity = dplus?.velocidade ?? windowVelocity(launch);
      const deltaBase = averageLabel.startsWith('D+') ? dplus?.receita : j30?.receita;
      return `
        <tr>
          <td class="model-name">${escapeHtml(launch.modelo)}<div class="metric-sub">D0: ${fmtDate(launch.d0)}</div></td>
          <td>${fmtBRL(dplus?.receita)}<div class="metric-sub">${day !== null && day !== undefined ? `D+${day}` : 'sem D+n'}</div></td>
          <td>${fmtBRL(j7?.receita)}<div>${coverageBadge(launch, '7d')}</div></td>
          <td>${fmtBRL(j15?.receita)}<div>${coverageBadge(launch, '15d')}</div></td>
          <td>${fmtBRL(j30?.receita)}<div>${coverageBadge(launch, '30d')}</div></td>
          <td>${fmtBRL(j60?.receita)}<div>${coverageBadge(launch, '60d')}</div></td>
          <td>${fmtBRL(j90?.receita)}<div>${coverageBadge(launch, '90d')}</div></td>
          <td class="num">${fmtBRL(j30?.ticket)}</td>
          <td class="num">${fmtNum(j30?.pares)}</td>
          <td class="num">${fmtPct(j30?.novos_pct, 1)}</td>
          <td class="num">${velocity == null ? '&mdash;' : `${fmtBRL(velocity)}/dia`}<div class="metric-sub">${escapeHtml(best.key ? windowLabel(best.key) : '')}</div></td>
          <td class="num">${historicalAverage === null ? '&mdash;' : metricDelta(deltaBase, historicalAverage, fmtBRL)}<div class="metric-sub">vs media ${escapeHtml(averageLabel)}</div></td>
          <td>${sourceBadge(launch)}</td>
        </tr>`;
    }).join('');
    tbody.innerHTML = rows || `<tr><td colspan="13" class="cell-muted">Sem lancamentos com dados reais para comparar.</td></tr>`;
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
      investimento: { key: 'investimento', label: 'Investimento acumulado', short: 'Invest.', type: 'bar', unit: 'currency', help: 'Soma do investimento de midia paga por janela acumulada.' },
      receita: { key: 'receita', label: 'Receita atribuida/estimada', short: 'Receita', type: 'bar', unit: 'currency', help: 'Receita atribuida na planilha ou estimada pela janela do modelo quando so ha investimento.' },
      roas: { key: 'roas', label: 'ROAS', short: 'ROAS', type: 'line', unit: 'ratio', help: 'Receita / investimento. Usa ROAS informado ou a leitura agregada da janela.' },
      cpa: { key: 'cpa', label: 'CPA', short: 'CPA', type: 'line', unit: 'currency', help: 'Investimento / pedidos da campanha ou da janela agregada.' },
      cpp: { key: 'cpp', label: 'CPP', short: 'CPP', type: 'line', unit: 'currency', help: 'Investimento / pares vendidos na janela (custo por par). Mantem a leitura separada de custo por sessao, que so existe se a planilha de midia ganhar uma coluna de sessoes por campanha.' },
      cpc: { key: 'cpc', label: 'CPC', short: 'CPC', type: 'line', unit: 'currency', help: 'Investimento / cliques. So aparece quando o JSON trouxer cliques ou CPC.' }
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

  function commercialMetricRowsForLaunch(launch) {
    const rawRows = (state.data?.midia_paga || [])
      .filter((row) => row.modelo_id === launch.modelo_id)
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

    return aggregateMediaRows(detailedRows, launch, midiaValidaParaGraficoComercial)
      .map((row) => {
        const key = commercialWindowKey(row);
        const metricWindow = mediaWindowMetric(row, launch);
        const investimento = numberOrNull(row.investimento);
        const receita = numberOrNull(row.receita_atribuida);
        const pedidos = numberOrNull(row.pedidos);
        const pares = firstKnownCommercialNumber(row, ['pares', 'pares_janela_agregados', 'quantidade']) ?? pairsByWindow.get(key) ?? numberOrNull(metricWindow?.pares);
        const cliques = firstKnownCommercialNumber(row, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']) ?? clicksByWindow.get(key) ?? null;
        const roas = rowRoas(row) ?? (investimento && receita !== null ? receita / investimento : null);
        const cpa = numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
        const cpp = firstKnownCommercialNumber(row, ['cpp', 'custo_por_par', 'custo_par']) ?? cppByWindow.get(key) ?? (investimento !== null && pares ? investimento / pares : null);
        const cpc = firstKnownCommercialNumber(row, ['cpc', 'custo_por_click', 'custo_por_clique']) ?? cpcByWindow.get(key) ?? (investimento !== null && cliques ? investimento / cliques : null);
        return {
          launch,
          key,
          label: commercialWindowLabel(key),
          investimento,
          receita,
          pedidos,
          pares,
          cliques,
          roas,
          cpa,
          cpp,
          cpc,
          source: row.receita_source || row.metodologia || ''
        };
      })
      .sort((a, b) => commercialWindowRank(a.key) - commercialWindowRank(b.key));
  }

  function commercialMetricValue(row, metricKey) {
    if (!row) return null;
    return row[metricKey] ?? null;
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
      if (subText) subText.textContent = 'Sem midia paga cadastrada para os modelos selecionados.';
      return;
    }

    const hasAnyMetricValue = allRows.some((row) => commercialMetricValue(row, metric.key) !== null);
    if (subText) {
      subText.textContent = hasAnyMetricValue
        ? `${metric.label} por janela acumulada de midia paga. Tooltip mostra investimento, receita, ROAS, CPA, CPP e CPC quando houver base.`
        : `${metric.label}: ainda sem base suficiente no JSON. ${metric.key === 'cpc' ? 'Inclua cliques ou CPC na exportacao para habilitar esta leitura.' : 'Ausencia fica vazia, nao vira zero.'}`;
    }

    const chartLaunches = launches.filter((launch) => (rowsByLaunch.get(launch.modelo_id) || []).length);
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
                if (!row) return 'Sem midia para esta janela.';
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
              afterLabel: (ctx) => `Janela ${ctx.label}: D0 ate ${ctx.label}. Fonte: JSON de vendas ou historico versionado.`
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
              afterLabel: (ctx) => `Soma de pares vendidos de D0 ate ${ctx.label}. Nulo significa janela ausente, nao zero.`
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
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y, 2)}x`,
              afterLabel: () => 'Formula: janela maior / janela anterior. Ex.: 30÷15 = receita D+30 / receita D+15.'
            }
          }
        },
        scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${fmtNum(v, 1)}×` } } }
      })
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
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtNum(ctx.parsed.x, 1)}%`,
              afterLabel: () => 'Fonte: campos novos/recorrentes do JSON. Quando ausentes, a barra fica vazia.'
            }
          }
        }
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
        plugins: {
          tooltip: {
            callbacks: {
              label: (ctx) => ctx.dataset.label === 'Faturamento' ? `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}` : `${ctx.dataset.label}: ${fmtNum(ctx.parsed.y)}`,
              afterLabel: (ctx) => `Agrupamento semanal desde D0. ${ctx.dataset.label === 'Faturamento' ? 'Receita acumulada na semana.' : 'Pedidos da semana.'}`
            }
          }
        }
      })
    });

    renderNormalizedChart(selected);
    renderCommercialEfficiencyChart(selected);
  }

  function stockNumber(value) {
    if (value === null || value === undefined || value === '') return null;
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function stockCoverage(row) {
    const direct = stockNumber(row.cobertura_dias);
    if (direct !== null) return direct;
    const stock = stockNumber(row.estoque_atual);
    const sales = stockNumber(row.vendas_d30);
    if (stock === null || sales === null || sales <= 0) return null;
    return stock / (sales / 30);
  }

  function stockDailySales(row) {
    const sales = stockNumber(row.vendas_d30);
    return sales !== null && sales > 0 ? sales / 30 : null;
  }

  function stockCoverageLabel(value, digits = 0) {
    return value === null || value === undefined || Number.isNaN(value) ? '—' : `${fmtNum(value, digits)} dias`;
  }

  function stockStatus(row) {
    const stock = stockNumber(row.estoque_atual);
    const coverage = stockCoverage(row);
    if (stock !== null && stock <= 0) return 'zero';
    if (coverage !== null && coverage < 15) return 'low';
    if (coverage === null) return 'no-base';
    return 'ok';
  }

  function stockStatusBadge(status) {
    if (status === 'zero') return badge('neg', 'Zerado', 'Snapshot de estoque veio zerado para esta combinacao. Verifique antes de inferir ruptura real.');
    if (status === 'low') return badge('neg', 'Baixa', 'Cobertura estimada abaixo de 15 dias.');
    if (status === 'no-base') return badge('parcial', 'Sem D-30', 'Sem vendas D-30 para calcular velocidade. A ausencia permanece vazia, nao vira zero.');
    return badge('pipeline', 'Coberto', 'Cobertura calculada igual ou acima de 15 dias.');
  }

  function stockStatusRead(status) {
    if (status === 'zero') return 'Estoque zerado no snapshot.';
    if (status === 'low') return 'Priorizar reposicao ou acompanhamento comercial.';
    if (status === 'no-base') return 'Sem velocidade D-30; use estoque absoluto e auditoria de SKU.';
    return 'Sem alerta de cobertura no criterio atual.';
  }

  function decorateStockRows(rows) {
    return rows.map((row, index) => {
      const coverage = stockCoverage(row);
      return {
        ...row,
        _index: index,
        _stock: stockNumber(row.estoque_atual),
        _sales: stockNumber(row.vendas_d30),
        _dailySales: stockDailySales(row),
        _coverage: coverage,
        _status: stockStatus(row)
      };
    });
  }

  function stockFilterMatch(row) {
    if (state.stockFilter === 'critical') return ['low', 'zero'].includes(row._status);
    if (state.stockFilter === 'low') return row._status === 'low';
    if (state.stockFilter === 'zero') return row._status === 'zero';
    if (state.stockFilter === 'no-base') return row._status === 'no-base';
    return true;
  }

  function compareStockRows(a, b) {
    const textA = normalizeText(`${a.sub_modelo || ''} ${a.cor || ''} ${a.sku || ''}`);
    const textB = normalizeText(`${b.sub_modelo || ''} ${b.cor || ''} ${b.sku || ''}`);
    const coverageValue = (row) => {
      if (row._status === 'zero' && row._coverage === null) return -1;
      return row._coverage === null ? Number.POSITIVE_INFINITY : row._coverage;
    };
    if (state.stockSort === 'stock-desc') {
      return (b._stock ?? -1) - (a._stock ?? -1) || textA.localeCompare(textB, 'pt-BR');
    }
    if (state.stockSort === 'sales-desc') {
      return (b._sales ?? -1) - (a._sales ?? -1) || textA.localeCompare(textB, 'pt-BR');
    }
    if (state.stockSort === 'name-asc') {
      return textA.localeCompare(textB, 'pt-BR');
    }
    return coverageValue(a) - coverageValue(b) || textA.localeCompare(textB, 'pt-BR');
  }

  function stockSum(rows, key) {
    const values = rows.map((row) => row[key]).filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
  }

  function visibleStockRows(rows) {
    if (state.stockPageSize === 'all') return rows;
    const limit = Number(state.stockPageSize || 10);
    return rows.slice(0, Number.isFinite(limit) && limit > 0 ? limit : 10);
  }

  function openStockDrawer(row, selected, returnFocus) {
    const drawer = $('stock-detail-drawer');
    const overlay = $('stock-detail-overlay');
    const content = $('stock-detail-content');
    if (!drawer || !overlay || !content) return;

    stockDrawerReturnFocus = returnFocus || document.activeElement;
    const status = row._status || stockStatus(row);
    const coverage = row._coverage ?? stockCoverage(row);
    const dailySales = row._dailySales ?? stockDailySales(row);
    const updatedAt = row.updated_at ? fmtDate(String(row.updated_at).slice(0, 10)) : '—';
    const itemName = row.sub_modelo || row.nome_produto || row.sku || selected.modelo;
    const sku = row.sku || '—';

    content.innerHTML = `
      <div class="stock-detail-kicker">Cobertura de estoque</div>
      <h3>${escapeHtml(itemName)}</h3>
      <div class="stock-detail-sub">${escapeHtml(selected.modelo)} · ${escapeHtml(row.cor || 'Sem cor')}</div>
      <div class="stock-detail-status">${stockStatusBadge(status)}</div>
      <div class="stock-detail-metrics">
        <div><span>Estoque atual</span><strong>${fmtNum(row._stock)}</strong></div>
        <div><span>Vendas D-30</span><strong>${fmtNum(row._sales)}</strong></div>
        <div><span>Média/dia</span><strong>${dailySales === null ? '—' : fmtNum(dailySales, 1)}</strong></div>
        <div><span>Cobertura</span><strong>${stockCoverageLabel(coverage, 1)}</strong></div>
      </div>
      <div class="stock-detail-section">
        <h4>Leitura</h4>
        <p>${escapeHtml(stockStatusRead(status))}</p>
      </div>
      <div class="stock-detail-section">
        <h4>Fonte e fórmula</h4>
        <p>Fonte: <code>data/estoque.json</code>. Cobertura = estoque atual / (vendas D-30 / 30). Sem vendas D-30, a cobertura fica vazia.</p>
      </div>
      <div class="stock-detail-list">
        <div><span>SKU</span><strong>${escapeHtml(sku)}</strong></div>
        <div><span>Atualizado em</span><strong>${escapeHtml(updatedAt)}</strong></div>
      </div>
    `;
    applyCollapsibleLists(content);

    document.body.classList.add('stock-detail-open');
    overlay.hidden = false;
    drawer.setAttribute('aria-hidden', 'false');
    drawer.removeAttribute('inert');
    drawer.focus({ preventScroll: true });
  }

  function renderStock(selected) {
    const wrap = $('stock-grid');
    const rows = (state.data.estoque || []).filter((row) => row.modelo_id === selected.modelo_id);
    if (!rows.length) {
      wrap.innerHTML = `<div class="empty-state"><div><strong>Sem dados de estoque para ${escapeHtml(selected.modelo)}.</strong>O arquivo data/estoque.json está preparado, mas precisa ser preenchido pelo BigQuery.</div></div>`;
      closeStockDrawer();
      return;
    }

    const decorated = decorateStockRows(rows);
    const filtered = decorated.filter(stockFilterMatch).sort(compareStockRows);
    const visibleRows = visibleStockRows(filtered);
    const totalStock = stockSum(decorated, '_stock');
    const totalSales = stockSum(decorated, '_sales');
    const knownCoverages = decorated.map((row) => row._coverage).filter((value) => value !== null);
    const minCoverage = knownCoverages.length ? Math.min(...knownCoverages) : null;
    const alertCount = decorated.filter((row) => ['low', 'zero'].includes(row._status)).length;
    const noBaseCount = decorated.filter((row) => row._status === 'no-base').length;

    const summary = [
      { label: 'Linhas', value: fmtNum(decorated.length), sub: 'sub-modelo/cor' },
      { label: 'Estoque', value: fmtNum(totalStock), sub: 'pares disponíveis' },
      { label: 'Vendas D-30', value: fmtNum(totalSales), sub: 'pares vendidos' },
      { label: 'Menor cobertura', value: stockCoverageLabel(minCoverage), sub: `${fmtNum(alertCount)} alertas · ${fmtNum(noBaseCount)} sem D-30` }
    ];

    wrap.innerHTML = `
      <div class="stock-workbench">
        <div class="stock-toolbar">
          <div>
            <div class="stock-toolbar-title">Cobertura operacional ${tip('Fonte: data/estoque.json. Cobertura = estoque atual / media diaria de vendas D-30 quando vendas_d30 existir.')}</div>
            <div class="stock-toolbar-sub">Mostrando ${fmtNum(visibleRows.length)} de ${fmtNum(filtered.length)} linhas filtradas · ${fmtNum(decorated.length)} no modelo.</div>
          </div>
          <div class="stock-controls">
            <label>
              <span>Status</span>
              <select id="stock-filter" class="stock-select" aria-label="Filtrar estoque por status">
                ${STOCK_FILTERS.map((filter) => `<option value="${filter.key}" ${filter.key === state.stockFilter ? 'selected' : ''}>${escapeHtml(filter.label)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Ordenar</span>
              <select id="stock-sort" class="stock-select" aria-label="Ordenar estoque">
                ${STOCK_SORTS.map((sort) => `<option value="${sort.key}" ${sort.key === state.stockSort ? 'selected' : ''}>${escapeHtml(sort.label)}</option>`).join('')}
              </select>
            </label>
            <label>
              <span>Linhas</span>
              <select id="stock-page-size" class="stock-select" aria-label="Quantidade de linhas de estoque exibidas">
                ${STOCK_PAGE_SIZES.map((size) => `<option value="${size.key}" ${size.key === state.stockPageSize ? 'selected' : ''}>${escapeHtml(size.label)}</option>`).join('')}
              </select>
            </label>
          </div>
        </div>
        <div class="stock-summary-grid">
          ${summary.map((item) => `
            <div class="stock-summary-item">
              <span>${escapeHtml(item.label)}</span>
              <strong>${escapeHtml(item.value)}</strong>
              <small>${escapeHtml(item.sub)}</small>
            </div>
          `).join('')}
        </div>
        <div class="table-wrap stock-table-wrap">
          <table class="stock-table">
            <thead>
              <tr>
                <th>${labelTip('Item', 'Sub-modelo ou SKU do snapshot de estoque.')}</th>
                <th>${labelTip('Cor', 'Cor ou variante informada no estoque.')}</th>
                <th class="num">${labelTip('Estoque', 'Quantidade disponivel no snapshot de estoque.')}</th>
                <th class="num">${labelTip('Vendas D-30', 'Pares vendidos nos ultimos 30 dias. Quando ausente, cobertura permanece vazia.')}</th>
                <th class="num">${labelTip('Cobertura', 'Formula: estoque atual / (vendas D-30 / 30). Abaixo de 15 dias vira alerta.')}</th>
                <th>${labelTip('Status', 'Leitura operacional da cobertura de estoque.')}</th>
                <th class="num">Detalhe</th>
              </tr>
            </thead>
            <tbody>
              ${visibleRows.length ? visibleRows.map((row) => {
                const itemName = row.sub_modelo || row.nome_produto || row.sku || selected.modelo;
                const critical = ['low', 'zero'].includes(row._status);
                return `<tr class="${critical ? 'stock-row-alert' : ''}">
                  <td class="model-name">${escapeHtml(itemName)}<div class="metric-sub">${escapeHtml(row.sku || selected.modelo_id)}</div></td>
                  <td>${escapeHtml(row.cor || 'Sem cor')}</td>
                  <td class="num">${fmtNum(row._stock)}</td>
                  <td class="num">${fmtNum(row._sales)}</td>
                  <td class="num">${stockCoverageLabel(row._coverage)}</td>
                  <td>${stockStatusBadge(row._status)}</td>
                  <td class="num"><button class="stock-detail-button" type="button" data-stock-index="${row._index}">Detalhes</button></td>
                </tr>`;
              }).join('') : `<tr><td colspan="7" class="stock-empty-cell">Nenhuma linha para este filtro.</td></tr>`}
            </tbody>
          </table>
        </div>
      </div>
    `;

    wrap.querySelector('#stock-filter')?.addEventListener('change', (event) => {
      state.stockFilter = event.target.value;
      renderStock(selected);
    });
    wrap.querySelector('#stock-sort')?.addEventListener('change', (event) => {
      state.stockSort = event.target.value;
      renderStock(selected);
    });
    wrap.querySelector('#stock-page-size')?.addEventListener('change', (event) => {
      state.stockPageSize = event.target.value;
      renderStock(selected);
    });
    wrap.querySelectorAll('[data-stock-index]').forEach((button) => {
      button.addEventListener('click', () => {
        const row = decorated.find((item) => item._index === Number(button.dataset.stockIndex));
        if (row) openStockDrawer(row, selected, button);
      });
    });
  }

  function renderColorMix() {
    const launches = selectedCompareLaunches();
    if (!launches.length) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione ao menos um modelo.</strong>O mix usa os modelos marcados em Comparar com.</div></div>`;
      return;
    }

    const cards = launches.map((launch) => {
      const colorsMap = new Map();
      (launch.cores || []).forEach((row) => {
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
        current.receita_bruta += Number((row.receita_bruta ?? row.receita) || 0);
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
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Sem mix de cores.</strong>Dados entram pelo historico estatico ou pelo pipeline de venda por SKU.</div></div>`;
      return;
    }

    $('color-mix').innerHTML = cards.map((card) => {
      const { launch, total, max, rows } = card;
      return `<div class="color-card">
        <div class="color-title">${escapeHtml(launch.modelo)} ${tip('Top 3 cores por modelo. As cores sao normalizadas por SKU, nome e campo de cor; sem cor so aparece quando nao ha outra cor valida.')}</div>
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
            <thead><tr>${thTip('#', 'Posicao no ranking do conjunto selecionado.')} ${thTip('Tamanho', 'Tamanho extraido de SKU, nome do item ou variant_title quando disponivel.')} ${thTip('Pares vendidos', 'Soma de pares classificados naquele tamanho.', 'num')} ${thTip('% do total', 'Formula: pares do tamanho / pares totais com tamanho no grupo.', 'num')}</tr></thead>
            <tbody>${tableRows(geral)}</tbody>
          </table>
        </div>
        <div class="size-model-grid">
          ${byModel.map((group) => `<div class="table-wrap">
            <table>
              <thead>
                <tr><th colspan="4">${escapeHtml(group.launch.modelo)} ${tip('Top tamanhos dentro deste modelo. Percentuais usam apenas pares classificados para o proprio modelo.')}</th></tr>
                <tr>${thTip('#', 'Posicao no ranking do modelo.')} ${thTip('Tamanho', 'Tamanho detectado no item/SKU.')} ${thTip('Pares vendidos', 'Soma de pares daquele tamanho no modelo.', 'num')} ${thTip('% do total', 'Formula: pares do tamanho / pares totais do modelo com tamanho.', 'num')}</tr>
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

    const coresRows = (selected?.cores || []).map((row) => ({
      ...row,
      cor: extractColor({ ...row, modelo_id: selected.modelo_id }, selected)
    }));
    const tamanhoRows = selected?.tamanhos || [];

    const coresDeviation = computeCutDeviation(coresRows, 'cor');
    const tamanhoDeviation = computeCutDeviation(tamanhoRows, 'tamanho');
    const allCuts = [
      ...coresDeviation.map((row) => ({ ...row, dimensao: 'Cor' })),
      ...tamanhoDeviation.map((row) => ({ ...row, dimensao: 'Tamanho' }))
    ].sort((a, b) => b.deltaPp - a.deltaPp);

    if (!allCuts.length) {
      container.innerHTML = `<div class="empty-state"><div><strong>Sem cortes suficientes.</strong>Precisa de ao menos 2 cores ou tamanhos classificados no lancamento.</div></div>`;
      return;
    }

    const promoters = allCuts.filter((row) => row.deltaPp > 0).slice(0, 3);
    const detractors = allCuts.filter((row) => row.deltaPp < 0).slice(-3).reverse();

    const barRow = (row) => `
      <div class="cut-row">
        <div class="cut-row-label">${escapeHtml(row.dimensao)} &middot; ${escapeHtml(String(row.key))}</div>
        <div class="bar-track"><div class="bar-fill ${row.deltaPp >= 0 ? 'positive' : 'negative'}" style="width:${Math.min(100, row.share * 200).toFixed(1)}%"></div></div>
        <div class="cut-row-value">${fmtPct(row.share, 0)} <span class="${row.deltaPp >= 0 ? 'delta-pos' : 'delta-neg'}">${row.deltaPp >= 0 ? '+' : ''}${fmtNum(row.deltaPp, 1)}pp</span></div>
      </div>`;

    container.innerHTML = `
      <div class="cut-group">
        <div class="cut-group-title">Promotores</div>
        ${promoters.length ? promoters.map(barRow).join('') : '<div class="cut-empty">Sem corte acima da media.</div>'}
      </div>
      <div class="cut-group">
        <div class="cut-group-title">Ofensores</div>
        ${detractors.length ? detractors.map(barRow).join('') : '<div class="cut-empty">Sem corte abaixo da media.</div>'}
      </div>
      <p class="cut-note">Canal (organico vs pago) entra quando a atribuicao real de midia estiver plugada; hoje midia_paga.json nao tem grao por pedido para sustentar esse corte.</p>
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
    if (key === 'medio') return 'medio';
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
    if (score > 0) return `Favoravel +${score}`;
    if (score < 0) return `Risco ${score}`;
    return 'Neutra 0';
  }

  function seasonalRead(events, score, observedScore) {
    if (!events.length) return 'Sem promotor, ofensor ou neutro cadastrado para esta janela.';
    const futureCount = events.filter((event) => !event.observed).length;
    if (score > 0 && observedScore <= 0 && futureCount) return 'Impulso positivo esta dentro da janela, mas ainda nao entrou no acumulado atual.';
    if (score > 0) return 'Promotores superam ofensores; compare esta janela com cautela porque existe vento a favor.';
    if (score < 0) return 'Ofensores pesam mais que promotores; queda relativa pode ser efeito de calendario.';
    return 'Eventos sem direcao clara; use como contexto, nao como explicacao principal.';
  }

  function renderCalendar(selected) {
    const windows = WINDOW_KEYS.map((key) => ({
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
    const ninety = analyses[analyses.length - 1] || { events: [], counts: seasonalCounts([]), score: 0, observedScore: 0, cls: 'clean' };
    const strongest = [...ninety.events].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0];
    const observedEvents = ninety.events.filter((event) => event.observed);
    const futureEvents = ninety.events.filter((event) => !event.observed);
    const summaryRead = ninety.events.length
      ? `${observedEvents.length} evento(s) ja observado(s) e ${futureEvents.length} evento(s) futuro(s) ate D+90.`
      : 'Nenhum evento cadastrado entre D0 e D+90.';

    $('calendar-grid').innerHTML = `
      <div class="calendar-summary calendar-summary--${ninety.cls}">
        <div>
          <div class="metric-label">${labelTip('Saldo sazonal D+90', 'Soma ponderada dos eventos no calendario entre D0 e D+90. Promotor soma, ofensor subtrai e neutro vale 0; peso forte=3, medio=2, baixo=1.')}</div>
          <div class="seasonal-score seasonal-score--${ninety.cls}">${escapeHtml(seasonalScoreLabel(ninety.score, ninety.events))}</div>
          <div class="metric-sub">${escapeHtml(summaryRead)}</div>
        </div>
        <div class="seasonal-stat-grid">
          <div><span>${labelTip('Promotores', 'Eventos esperados como vento a favor de venda ou atencao comercial.')}</span><strong>${fmtNum(ninety.counts.promotores)}</strong></div>
          <div><span>${labelTip('Ofensores', 'Eventos que podem reduzir comparabilidade ou pressionar performance relativa.')}</span><strong>${fmtNum(ninety.counts.ofensores)}</strong></div>
          <div><span>${labelTip('Neutros', 'Eventos cadastrados como contexto sem direcao clara de impacto.')}</span><strong>${fmtNum(ninety.counts.neutros)}</strong></div>
          <div><span>${labelTip('Mais forte', 'Evento com maior peso absoluto dentro de D+90.')}</span><strong>${strongest ? escapeHtml(strongest.nome) : '&mdash;'}</strong></div>
        </div>
      </div>
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
                <span class="event-state" tabindex="0" data-tooltip="${tooltipAttr(event.observed ? 'Evento ja entrou no acumulado observado do snapshot.' : 'Evento esta dentro da janela, mas ainda nao ocorreu no acumulado atual.')}">${event.observed ? 'observado' : 'futuro'}</span>
              </div>
              <div class="event-meta">${fmtDate(event.data)} · D+${fmtNum(event.day)} · impacto ${escapeHtml(impact)} · ${escapeHtml(event.phase)}</div>
              ${event.observacao ? `<div class="event-copy">${escapeHtml(event.observacao)}</div>` : ''}
            </div>
          </div>`;
        }).join('')}</div>` : `<div class="empty-state seasonal-empty"><div><strong>Janela limpa.</strong>Sem evento cadastrado entre D0 e D+${fmtNum(win.end)}.</div></div>`}
      </div>`).join('')}`;
  }

  function roasBadge(value) {
    if (value === null || value === undefined) return badge('parcial', '—', 'Sem ROAS cadastrado na planilha para esta linha.');
    if (value < 1) return badge('neg', 'Crítico', 'ROAS abaixo de 1x: a receita atribuida/informada e menor que o investimento informado.');
    if (value < 3) return badge('parcial', 'Atenção', 'ROAS entre 1x e 3x: leitura intermediaria; confira atribuicao, janela e custo cadastrado.');
    return badge('pipeline', 'Eficiente', 'ROAS acima de 3x: a receita atribuida/informada supera o investimento com folga.');
  }

  function metodologiaComercialBadge(row) {
    const metodologia = String(row?.metodologia || '').trim();
    const aviso = String(row?.aviso || '').trim();
    if (!metodologia && !aviso) return '';
    const label = metodologia === 'correlacao_por_janela_calendario' ? 'correl.' : 'metod.';
    const text = `${aviso || 'Leitura comercial estimada; nao representa atribuicao real de clique/conversao.'} Metodologia: ${metodologia || 'nao informada'}.`;
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
      campanha,
      janela,
      data_inicio: row.data_inicio || null,
      data_fim: row.data_fim || null,
      canal,
      investimento,
      receita_atribuida: receita,
      receita_janela_agregada: numberOrNull(row.receita_janela_agregada),
      receita_source: receitaSource,
      pedidos,
      pedidos_janela_agregados: numberOrNull(row.pedidos_janela_agregados),
      pares: firstKnownCommercialNumber(row, ['pares', 'pares_janela_agregados', 'quantidade']) ?? firstKnownCommercialNumber(campaignRevenue, ['pares', 'quantidade']),
      cliques: firstKnownCommercialNumber(row, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']) ?? firstKnownCommercialNumber(campaignRevenue, ['cliques', 'clique', 'clicks', 'link_clicks', 'link_cliques', 'outbound_clicks']),
      roas,
      cpa,
      cpp: firstKnownCommercialNumber(row, ['cpp', 'custo_por_par', 'custo_par']),
      cpc: firstKnownCommercialNumber(row, ['cpc', 'custo_por_click', 'custo_por_clique']),
      status: row.status || '',
      metodologia: row.metodologia || (receitaSource === 'faturamento_campanha' ? 'faturamento_campanha' : ''),
      aviso: row.aviso || (receitaSource === 'faturamento_campanha' ? 'Receita atribuida por campanha via data/faturamento_campanha.json.' : ''),
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
        out[index].aviso = 'Receita repetida em canais diferentes da mesma janela. ROAS por canal foi bloqueado; use a linha agregada ate existir atribuicao real por pedido.';
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
    const aviso = row.aviso || (metodologia ? 'Leitura comercial estimada; nao representa atribuicao real de clique/conversao.' : '');
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
        hasPedidos: false,
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
      const pedidos = row.pedidos_janela_agregados ?? row.pedidos;
      if (pedidos !== null && pedidos !== undefined) {
        current.pedidos += pedidos || 0;
        current.hasPedidos = true;
      }
      current.metodologia = current.metodologia || row.metodologia || '';
      current.aviso = current.aviso || row.aviso || '';
      current.count += 1;
      groups.set(key, current);
    });
    return [...groups.values()]
      .filter((row) => row.count > 1 || row.receita_janela_agregada !== null || row.investimento > 0)
      .map(({ count, canais, hasReceitaAtribuida, hasPedidos, receita_janela_agregada, ...row }) => {
        const modelLaunch = launch || lineLaunchById(row.modelo_id);
        const metric = mediaWindowMetric(row, modelLaunch);
        const receitaModelo = numberOrNull(metric?.receita);
        const pedidosModelo = numberOrNull(metric?.pedidos);
        const receita = receita_janela_agregada ?? (hasReceitaAtribuida ? row.receita_atribuida : receitaModelo);
        const pedidos = hasPedidos ? row.pedidos : pedidosModelo;
        const source = receita_janela_agregada !== null && receita_janela_agregada !== undefined
          ? 'receita_repetida_agregada'
          : hasReceitaAtribuida ? 'atribuida' : 'modelo_agregado';
        return {
          ...row,
          campanha: count > 1 ? 'Total janela' : row.campanha,
          canal: canais.size > 1 ? `${fmtNum(canais.size)} canais` : ([...canais][0] || row.canal),
          receita_atribuida: receita ?? null,
          receita_source: source,
          pedidos: pedidos ?? null,
          roas: row.investimento && receita !== null && receita !== undefined ? receita / row.investimento : null,
          cpa: row.investimento && pedidos ? row.investimento / pedidos : null,
          metodologia: row.metodologia || (source === 'modelo_agregado' ? 'leitura_agregada_janela' : ''),
          aviso: row.aviso || (source === 'modelo_agregado' ? 'Leitura agregada por janela do modelo. Nao divide receita entre canais; use apenas como referencia ate haver atribuicao real por pedido.' : '')
        };
      });
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
              ${thTip('Janela base', 'Janela usada para contextualizar a receita do modelo: acumulado D+n para ativo ou melhor janela fechada/historica.')}
              ${thTip('Receita modelo', 'Receita do modelo na janela base. Fonte: vendas do pipeline ou historico versionado.', 'num')}
              ${thTip('Invest. midia', 'Soma do investimento informado nas campanhas de midia paga cadastradas na planilha.', 'num')}
              ${thTip('ROAS midia', 'ROAS informado na planilha ou estimado por janela do modelo quando so houver investimento. Quando houver mais de uma linha, o agregado e ponderado pelo investimento.', 'num')}
              ${thTip('CPA midia', 'Formula: investimento de midia / pedidos. Pedidos podem vir da planilha ou do rateio da janela do modelo.', 'num')}
              ${thTip('Invest. CRM', 'Soma do investimento/custo informado nos disparos de CRM.', 'num')}
              ${thTip('Disparos', 'Quantidade de linhas de CRM cadastradas para o modelo no JSON.', 'num')}
              ${thTip('ROAS CRM', 'ROAS informado na planilha de CRM ou calculado por receita base / investimento. Quando houver mais de uma linha, o agregado e ponderado pelo investimento.', 'num')}
              ${thTip('CPA CRM', 'Formula: investimento de CRM / pedidos de CRM quando pedidos existem.', 'num')}
              ${thTip('Invest. total', 'Soma de investimento de midia paga e CRM.', 'num')}
              ${thTip('Receita comercial', 'Soma das receitas informadas ou estimadas em midia e CRM. Leituras estimadas aparecem como apoio, nao atribuicao real por canal.', 'num')}
              ${thTip('ROAS comercial', 'ROAS agregado ponderado pelo investimento das linhas que possuem ROAS informado ou estimado.', 'num')}
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
    const detailedRows = enrichMediaEstimates(mediaRows.map((row) => normalizeMediaRow(row, selected)), selected);
    const displayRows = [...aggregateMediaRows(detailedRows, selected), ...detailedRows];
    $('media-table').innerHTML = displayRows.length ? displayRows.map((row) => `
      <tr>
        <td>${row.aggregate ? `<strong>${escapeHtml(row.campanha)}</strong>` : escapeHtml(row.campanha)}${suspeitaComercialBadge(row)}</td>
        <td>${escapeHtml(row.janela)}${row.receita_source && row.receita_source !== 'atribuida' ? ` <span class="cell-muted">(${escapeHtml(row.receita_source)})</span>` : ''}${metodologiaComercialBadge(row)}${suspeitaComercialBadge(row)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${mediaValue(row.receita_atribuida, fmtBRL)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${roasValue(row.roas)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${mediaValue(row.cpa, fmtBRL)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="cell-muted">Sem mídia paga cadastrada para este modelo.</td></tr>`;

    const crmRows = (state.data.crm_disparos || [])
      .filter((row) => row.modelo_id === selected.modelo_id)
      .map(normalizeCrmRow);
    $('crm-table').innerHTML = crmRows.length ? crmRows.map((row) => `
      <tr>
        <td>${fmtDate(row.data_disparo)}</td>
        <td title="${escapeHtml(row.campanha || 'Disparo sem nome')}">${escapeHtml(row.campanha || 'Disparo sem nome')}${metodologiaComercialBadge(row)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${fmtBRL(row.receita_linha)}</td>
        <td class="num">${mediaValue(row.receita_dia, fmtBRL)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${roasValue(row.roas)}${metodologiaComercialBadge(row)}</td>
        <td>${roasBadge(row.roas)}</td>
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
      const rowsRaw = (state.data.midia_paga || [])
        .filter((row) => row.modelo_id === launch.modelo_id)
        .map((row) => normalizeMediaRow(row, launch));
      const rows = enrichMediaEstimates(rowsRaw, launch);
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

    const displayRows = [...aggregateMediaRows(detailedRows), ...detailedRows]
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.janela).localeCompare(String(b.janela)) || a.campanha.localeCompare(b.campanha));
    $('media-table').innerHTML = displayRows.length ? displayRows.map((row) => `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${escapeHtml(row.campanha)}${suspeitaComercialBadge(row)}</td>
        <td>${escapeHtml(row.janela)}${row.receita_source && row.receita_source !== 'atribuida' ? ` <span class="cell-muted">(${escapeHtml(row.receita_source)})</span>` : ''}${metodologiaComercialBadge(row)}${suspeitaComercialBadge(row)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${mediaValue(row.receita_atribuida, fmtBRL)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${roasValue(row.roas)}${metodologiaComercialBadge(row)}</td>
        <td class="num">${mediaValue(row.cpa, fmtBRL)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="9" class="cell-muted">Sem midia paga cadastrada para os modelos selecionados.</td></tr>`;

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
          <div class="scenario-label">${escapeHtml(s.label)} ${tip(`Formula: base 30d estimada x multiplicador ${fmtNum(s.mult, 2)}. Se o modelo so tem D+15, a base 30d e aproximada dobrando D+15, conforme decisao documentada.`)}</div>
          <div class="scenario-name">${escapeHtml(s.name)}</div>
          <div class="scenario-value">${fmtBRL(s.value)}</div>
          <div class="scenario-pairs" tabindex="0" data-tooltip="${tooltipAttr('Pares estimados = faturamento do cenario / preco medio por par da janela base. E aproximacao, nao forecast operacional.')}">≈ ${fmtNum(s.pairs)} pares</div>
        </div>`).join('')}
      </div>
      <div class="card warning" style="margin-top:14px">
        <div class="metric-label">${labelTip('Aviso fixo', 'A projecao nao usa modelo estatistico externo. Ela aplica multiplicadores historicos para dar amplitude conservadora/base/otimista.')}</div>
        <p class="section-desc">Cenários usam multiplicadores 90÷30 dos modelos históricos elegíveis. Leia como referência de amplitude, não como previsão automática.</p>
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
        copy: `${activeLaunches.map((launch) => launch.modelo).join(', ')} deve ser lido por D+n e janelas fechadas, sem transformar ausencia em zero.`
      } : null,
      backfilled.length ? {
        type: 'warn',
        title: 'Backfill diario aplicado',
        copy: `${backfilled.length} modelo(s) historico(s) sem diario real receberam backfill a partir das janelas acumuladas para curva e semana a semana.`
      } : null,
      mediaBlocked.length ? {
        type: 'warn',
        title: 'Midia sem atribuicao por canal',
        copy: `${mediaBlocked.length} linha(s) de midia tiveram ROAS por canal bloqueado ou agregado porque a receita nao representa last-click por pedido.`
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
    $('selected-title').textContent = selected.modelo;
    $('selected-status').innerHTML = sourceBadge(selected);
    renderSelectedHeader(selected);
    renderModelSelector();
    renderPeriodSelector();
    renderCompareSelector();
    renderTopMeta();
    renderAnalysisContext(selected);
    renderStoryBrief(selected);
    renderMethodology(selected);
    renderState(selected);
    renderMomentoContext(selected);
    renderComparison();
    renderComparison('comparison-table-media');
    renderCharts(selected);
    renderStock(selected);
    renderColorMix();
    renderSizeRanking();
    renderCutPromotersDetractors(selected);
    renderCalendar(selected);
    renderActionsComparative();
    renderProjection(selected);
    renderInsights(selected);
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
    configureShareDrawer();
    configureStockDrawer();
    configureNormalizedChartModeToggle();
    configureCommercialChartMetricToggle();
    configureTopicTabs();
    configureTooltips();
    configureChartDefaults();
    state.data = await loadData();
    state.snapshotClock = deriveSnapshotClock(state.data);
    state.launches = buildLaunches(state.data);
    const comparable = comparableLaunches();
    const preferred = defaultComparableLaunch(comparable);
    state.primaryModelId = preferred?.modelo_id;
    state.compareModelIds = comparable.map((launch) => launch.modelo_id);
    renderAll();
    window.addEventListener('hashchange', renderAnalysisDrillFromHash);
    window.addEventListener('popstate', renderAnalysisDrillFromHash);
    renderAnalysisDrillFromHash();
    window.dispatchEvent(new CustomEvent('reise-dashboard-ready', { detail: getDashboardSnapshot() }));
  }

  document.addEventListener('DOMContentLoaded', init);
})();
