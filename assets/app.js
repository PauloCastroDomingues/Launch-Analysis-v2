(() => {
  const DATA_FILES = [
    'lancamentos_modelos',
    'lancamentos_historico',
    'lancamentos_rampa_dia',
    'lancamentos_clientes_janelas',
    'lancamentos_produtos_dia',
    'midia_paga',
    'metas_mensais',
    'faturamento_campanha',
    'crm_disparos',
    'sub_modelos_dia',
    'estoque',
    'calendario_br',
    'share_trajetoria',
    'lancamentos_rps_dia',
    'auditoria_monochrome',
    'lancamentos_analise_avancada'
  ];
  const NO_EMBEDDED_FALLBACK = new Set(['lancamentos_rampa_dia', 'lancamentos_clientes_janelas', 'lancamentos_produtos_dia', 'share_trajetoria', 'lancamentos_rps_dia', 'auditoria_monochrome']);

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
  const MODELS_WITHOUT_SUBMODELS = new Set(['rs8_monochrome']);
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
  const CHANNEL_FILTERS = [
    { key: 'all', label: 'Todos os canais' },
    { key: 'investment', label: 'Midia paga' },
    { key: 'organic', label: 'Organico' }
  ];
  const RAMP_METRIC_KEYS = [
    'rps_diario',
    'receita_acumulada',
    'receita_mensal',
    'pedidos_mensal',
    'share_semanal',
    'share_mensal',
    'saude_rampa'
  ];
  const RAMP_MONTH_DAYS = 30;
  const MILESTONE_DAYS = [0, 7, 15, 30, 60, 90];
  const RAMP_RHYTHM_WINDOW_DAYS = 7;
  const RPS_SMOOTHING_WINDOW_DAYS = 7;
  const RAMP_RHYTHM_TREND_LIMIT = 0.10;
  const RAMP_STABILITY_STRONG_RATIO = 0.50;
  const RAMP_STABILITY_MIN_RATIO = 0.35;
  const RAMP_STABILITY_LOW_RATIO = 0.25;
  const RAMP_TIME_LENSES = [
    { key: 'all', label: 'Tudo', shortLabel: 'Tudo', start: 0, end: null },
    { key: 'launch', label: 'D0-D30', shortLabel: 'Lancamento', start: 0, end: 30 },
    { key: 'sustain', label: 'D31-D90', shortLabel: 'Sustentacao', start: 31, end: 90 },
    { key: 'maturity', label: 'D91-D180', shortLabel: 'Maturidade', start: 91, end: 180 },
    { key: 'tail', label: 'D181+', shortLabel: 'Cauda', start: 181, end: null }
  ];
  const RAMP_HEALTH_TOOLTIP = `Ritmo de venda:
1. Agrupa as vendas em semanas fechadas desde o D0: S1 = D0 a D+6, S2 = D+7 a D+13 e assim por diante.
2. O melhor ritmo semanal da propria linha vira 100%.
3. Cada ponto mostra quanto do pico a linha ainda vende em uma semana completa.
4. O lancamento estabiliza quando duas comparacoes semanais seguidas variam no maximo 10%, depois do pico.
Acima de 50% = forte; 35% a 50% = sustentacao; 25% a 35% = baixo; abaixo de 25% = cauda.
Dias sem venda entram como zero apenas quando o manifesto confirma cobertura ate a data atual; dado ausente fica pendente.`;
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
    lineFilter: 'all',
    productFilter: 'all',
    productColorFilter: 'all',
    channelFilter: 'all',
    snapshotClock: null,
    normalizedChartMode: 'linha',
    normalizedRampMetric: 'rps_diario',
    rampTimeLens: 'all',
    launchChartView: 'normalized',
    commercialChartMetric: 'investimento',
    canibalLineFilter: null,
    storyAnalysisByModel: {},
    storySubModelByModel: {},
    charts: {},
    zoomChart: null
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

  const fmtSignedPct = (value, digits = 0) => {
    if (value === null || value === undefined || Number.isNaN(value)) return 'â€”';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${fmtPct(value, digits)}`;
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

  function rampExportCoverage() {
    const ramp = state.data?.manifest?.data_quality?.rampa_produtos_dia || {};
    const status = normalizeText(ramp.status);
    const explicitEnd = String(ramp.data_fim_exportada || '').slice(0, 10);
    const snapshotEnd = snapshotIso();
    const endIso = toDate(explicitEnd) ? explicitEnd : snapshotEnd;
    return {
      coversCurrentDate: status === 'd0 ate data atual',
      endIso
    };
  }

  function rampExportEndDay(launch) {
    if (!isEligibleStatus(launch?.status)) return null;
    const coverage = rampExportCoverage();
    if (!coverage.coversCurrentDate || !coverage.endIso) return null;
    return dayIndex(analysisDayZero(launch), coverage.endIso);
  }

  function rampCanFillMissingDays(launch, maxDay) {
    const endDay = rampExportEndDay(launch);
    return endDay !== null && endDay >= maxDay;
  }

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

  function isDailyAllocatedAttribution(row = {}) {
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
    if (/(^| )(organic|organico)( |$)/.test(explicitType)) return 'organic';
    if (/(^| )(crm|email|e mail|newsletter)( |$)/.test(explicitType)) return 'crm';
    if (/(^| )(unmatched|nao atribuido|sem match|sem atribuicao)( |$)/.test(explicitType)) return 'unmatched';
    if (/(^| )(other|outro|direto|direct|whatsapp)( |$)/.test(explicitType)) return 'other';

    const channelText = normalizeText([
      row.canal_real,
      row.canal,
      row.channel,
      row.chanel,
      row.grupo_canal,
      row.raw_channel,
      row.raw_medium,
      row.raw_source,
      row.raw_source_type,
      row.utm_medium,
      row.utm_source,
      row.utm_campaign
    ].filter(Boolean).join(' '));
    if (!channelText && isDailyAllocatedAttribution(row)) return null;
    return detailedAttributionType(detailedAttributionChannel(row));
  }

  function attributionQualityMeta(granularPct, allocatedPct = null) {
    const granular = numberOrNull(granularPct);
    if (granular === null) {
      return {
        tone: 'neutral',
        label: 'Sem origem',
        reason: 'Nao ha base suficiente para medir cobertura granular de origem/UTM.'
      };
    }
    const detail = `Cobertura granular ${fmtPct(granular, 1)}${allocatedPct === null ? '' : `; alocacao SSOT ${fmtPct(allocatedPct, 1)}`}.`;
    if (granular >= .8) {
      return {
        tone: 'positive',
        label: 'Granular',
        reason: `${detail} Leitura mais forte para apresentar como origem por pedido.`
      };
    }
    if (granular >= .5) {
      return {
        tone: 'warning',
        label: 'Mista',
        reason: `${detail} Use como leitura comercial e valide as linhas sem origem granular.`
      };
    }
    return {
      tone: 'warning',
      label: 'Alocada',
      reason: `${detail} A divisao pago/organico fecha o total, mas depende de fallback para linhas sem UTM granular.`
    };
  }

  function attributionQualityFromRows(rows = [], totalOrders = null) {
    const orderIds = new Set(rows.map((row) => row.order_sk || row.order_id || row.pedido_id).filter(Boolean));
    const total = numberOrNull(totalOrders) ?? orderIds.size;
    if (!total) return { total: null, granularOrders: null, allocatedOrders: null, granularPct: null, allocatedPct: null, ...attributionQualityMeta(null) };
    const granularOrderIds = new Set(
      rows
        .filter((row) => !isDailyAllocatedAttribution(row) && ['paid', 'organic'].includes(orderChannelType(row)))
        .map((row) => row.order_sk || row.order_id || row.pedido_id)
        .filter(Boolean)
    );
    const allocatedOrderIds = new Set(
      rows
        .filter((row) => isDailyAllocatedAttribution(row))
        .map((row) => row.order_sk || row.order_id || row.pedido_id)
        .filter(Boolean)
    );
    const granularPct = granularOrderIds.size / total;
    const allocatedPct = allocatedOrderIds.size / total;
    return {
      total,
      granularOrders: granularOrderIds.size,
      allocatedOrders: allocatedOrderIds.size,
      granularPct,
      allocatedPct,
      ...attributionQualityMeta(granularPct, allocatedPct)
    };
  }

  function isUnattributedChannelRow(row = {}) {
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

  function attributionKey(value) {
    return normalizeText(value).replace(/[^a-z0-9]+/g, '');
  }

  function firstAttributionValue(values) {
    return values.find((value) => String(value ?? '').trim()) || '';
  }

  function detailedAttributionChannel(row = {}) {
    const rawChannel = firstAttributionValue([
      row.raw_channel,
      row.referring_channel,
      row.canal_indicacao,
      row.last_source_description,
      row.last_source,
      row.canal_real,
      row.canal,
      row.channel,
      row.chanel,
      row.grupo_canal
    ]);
    const utmSource = firstAttributionValue([
      row.utm_source,
      row.raw_utm_source,
      row.last_utm_source,
      row.raw_source,
      row.source
    ]);
    const utmMedium = firstAttributionValue([
      row.utm_medium,
      row.raw_medium,
      row.last_utm_medium,
      row.medium
    ]);
    const utmCampaign = firstAttributionValue([
      row.utm_campaign,
      row.raw_campaign,
      row.last_utm_campaign,
      row.campaign
    ]);
    const sourceType = firstAttributionValue([
      row.source_type,
      row.raw_source_type,
      row.last_source_type,
      row.channel_type
    ]);
    const channelText = normalizeText(rawChannel);
    const sourceText = normalizeText(utmSource);
    const mediumText = normalizeText(utmMedium);
    const campaignText = normalizeText(utmCampaign);
    const sourceTypeText = normalizeText(sourceType);
    const sourceResolved = [channelText, sourceText].filter(Boolean).join(' ');
    const signalText = [sourceResolved, mediumText, campaignText, sourceTypeText].filter(Boolean).join(' ');
    const channelKey = attributionKey(rawChannel);
    const sourceTypeKey = attributionKey(sourceType);

    if (!signalText) return 'Nao atribuido';
    if (
      /(^| )(cpc|ppc|pmax|paid|paid social|paid search|paidsearch|paidsocial|display|cpm|cpv|shopping|performance|max performance|performance max|demand gen|demandgen|remarketing|retargeting|affiliate|affiliates|programmatic|sponsored|ad|ads)( |$)/.test(mediumText)
      || ['paid', 'advertising', 'ad', 'ads', 'paidsearch', 'paidsocial', 'paidshopping', 'paidmedia', 'paidother', 'paidvideo', 'paidreferral'].includes(sourceTypeKey)
      || /(^| )(cpc|ppc|pmax|paid|paid social|paid search|paidsearch|paidsocial|display|cpm|cpv|shopping|performance|max performance|performance max|demand gen|demandgen|remarketing|retargeting|affiliate|affiliates|programmatic|sponsored|google ads|facebook ads|meta ads|instagram ads|tiktok ads|bing ads|microsoft ads|adwords|gads|googleadservices|gclid|fbclid)( |$)/.test(signalText)
    ) return 'Midia paga';
    if (sourceTypeKey === 'direct' || channelKey === 'direct' || (['nenhum', 'none'].includes(channelKey) && !sourceText)) return 'Direto';
    if (
      sourceTypeKey === 'email'
      || /(^| )(email|e mail|newsletter|crm)( |$)/.test(mediumText)
      || /(^| )(klaviyo|rd station|rdstation|shopify email|mailchimp)( |$)/.test(signalText)
    ) return 'E-mail/CRM';
    if (/(^| )(whatsapp|whats app|whtasapp|whats|wpp|wa|wa me|api whatsapp|wl co)( |$)/.test(signalText)) return 'WhatsApp';
    if (
      /(^| )(organic|organic search|organic social|seo|bio)( |$)/.test(mediumText)
      || ['seo', 'search', 'social', 'organic'].includes(sourceTypeKey)
      || /(^| )(google|bing|yahoo|duckduckgo|ecosia|instagram|facebook|tiktok|youtube|pinterest|linkedin)( |$)/.test(signalText)
    ) return 'Organico';
    return 'Outro atribuido';
  }

  function detailedAttributionType(channel) {
    if (channel === 'Midia paga') return 'paid';
    if (channel === 'Organico') return 'organic';
    if (channel === 'E-mail/CRM') return 'crm';
    if (channel === 'Nao atribuido') return 'unmatched';
    return 'other';
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
      if (idx === null || idx < 0) return;
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
      const roundMoney = (value) => Math.round(Number(value || 0) * 100) / 100;
      const receitaPagaCampo = sumNullable(filtered, 'receita_paga');
      const receitaOrganicaCampo = sumNullable(filtered, 'receita_organica');
      const receitaCrmCampo = sumNullable(filtered, 'receita_crm');
      const receitaOutrosCampo = sumNullable(filtered, 'receita_outros_canais');
      const receitaSemMatchCampo = sumNullable(filtered, 'receita_sem_match_atribuicao');
      const pedidosPagosCampo = sumNullable(filtered, 'pedidos_pagos');
      const pedidosOrganicosCampo = sumNullable(filtered, 'pedidos_organicos');
      const pedidosCrmCampo = sumNullable(filtered, 'pedidos_crm');
      const pedidosOutrosCampo = sumNullable(filtered, 'pedidos_outros_canais');
      const pedidosSemMatchCampo = sumNullable(filtered, 'pedidos_sem_match_atribuicao');
      const paresPagosCampo = sumNullable(filtered, 'pares_pagos');
      const paresOrganicosCampo = sumNullable(filtered, 'pares_organicos');
      const paresCrmCampo = sumNullable(filtered, 'pares_crm');
      const paresOutrosCampo = sumNullable(filtered, 'pares_outros_canais');
      const paresSemMatchCampo = sumNullable(filtered, 'pares_sem_match_atribuicao');
      const dailyAllocatedAttribution = filtered.some((row) => isDailyAllocatedAttribution(row));
      const typedAttributionSignal = !dailyAllocatedAttribution && filtered.some((row) => orderChannelType(row));
      const attributionSignal = filtered.some((row) => (
        row.tipo_real !== null && row.tipo_real !== undefined
        || row.canal_real !== null && row.canal_real !== undefined
        || row.regra_atribuicao_real !== null && row.regra_atribuicao_real !== undefined
        || row.receita_paga !== null && row.receita_paga !== undefined
        || row.receita_organica !== null && row.receita_organica !== undefined
        || row.receita_crm !== null && row.receita_crm !== undefined
        || row.pedidos_crm !== null && row.pedidos_crm !== undefined
        || row.receita_outros_canais !== null && row.receita_outros_canais !== undefined
        || row.pedidos_outros_canais !== null && row.pedidos_outros_canais !== undefined
        || row.receita_sem_match_atribuicao !== null && row.receita_sem_match_atribuicao !== undefined
        || row.pedidos_sem_match_atribuicao !== null && row.pedidos_sem_match_atribuicao !== undefined
      ));
      const channelBuckets = {
        paid: { receita: 0, pares: 0, pedidos: new Set(), pedidosFallback: 0 },
        organic: { receita: 0, pares: 0, pedidos: new Set(), pedidosFallback: 0 },
        crm: { receita: 0, pares: 0, pedidos: new Set(), pedidosFallback: 0 },
        other: { receita: 0, pares: 0, pedidos: new Set(), pedidosFallback: 0 },
        unmatched: { receita: 0, pares: 0, pedidos: new Set(), pedidosFallback: 0 }
      };
      const addChannelRow = (bucket, row) => {
        bucket.receita += receitaBrutaRow(row);
        bucket.pares += Number(row.pares || 0);
        const orderId = pedidoId(row);
        if (orderId) bucket.pedidos.add(orderId);
        else bucket.pedidosFallback += Number(row.pedidos_validos ?? row.pedidos ?? 0);
      };
      const bucketOrderCount = (bucket) => {
        if (bucket.pedidos.size) return bucket.pedidos.size;
        return bucket.pedidosFallback || (typedAttributionSignal ? 0 : null);
      };
      filtered.forEach((row) => {
        const tipo = orderChannelType(row);
        const hasAttributionMatch = Boolean(
          tipo
          || row.canal_real
          || (row.regra_atribuicao_real && row.regra_atribuicao_real !== 'sem_atribuicao_real')
        );
        if (tipo === 'paid') {
          addChannelRow(channelBuckets.paid, row);
          return;
        }
        if (tipo === 'organic') {
          addChannelRow(channelBuckets.organic, row);
          return;
        }
        if (tipo === 'crm' || tipo === 'owned') {
          addChannelRow(channelBuckets.crm, row);
          return;
        }
        if (tipo === 'unmatched') {
          addChannelRow(channelBuckets.unmatched, row);
          return;
        }
        if (tipo) {
          addChannelRow(channelBuckets.other, row);
          return;
        }
        if (!hasAttributionMatch) {
          addChannelRow(channelBuckets.unmatched, row);
        }
      });
      const receitaPaga = typedAttributionSignal ? roundMoney(channelBuckets.paid.receita) : receitaPagaCampo;
      const receitaCrm = typedAttributionSignal ? roundMoney(channelBuckets.crm.receita) : receitaCrmCampo;
      const receitaOutrosCanais = typedAttributionSignal ? roundMoney(channelBuckets.other.receita) : receitaOutrosCampo;
      const receitaSemMatch = typedAttributionSignal ? roundMoney(channelBuckets.unmatched.receita) : receitaSemMatchCampo;
      const pedidosPagos = typedAttributionSignal ? bucketOrderCount(channelBuckets.paid) : pedidosPagosCampo;
      const pedidosCrm = typedAttributionSignal ? bucketOrderCount(channelBuckets.crm) : pedidosCrmCampo;
      const pedidosOutrosCanais = typedAttributionSignal ? bucketOrderCount(channelBuckets.other) : pedidosOutrosCampo;
      const pedidosSemMatch = typedAttributionSignal ? bucketOrderCount(channelBuckets.unmatched) : pedidosSemMatchCampo;
      const paresPagos = typedAttributionSignal ? channelBuckets.paid.pares : paresPagosCampo;
      const paresCrm = typedAttributionSignal ? channelBuckets.crm.pares : paresCrmCampo;
      const paresOutrosCanais = typedAttributionSignal ? channelBuckets.other.pares : paresOutrosCampo;
      const paresSemMatch = typedAttributionSignal ? channelBuckets.unmatched.pares : paresSemMatchCampo;
      const receitaOrganicaBase = typedAttributionSignal
        ? roundMoney(channelBuckets.organic.receita)
        : receitaOrganicaCampo;
      const pedidosOrganicosBase = typedAttributionSignal
        ? bucketOrderCount(channelBuckets.organic)
        : pedidosOrganicosCampo;
      const paresOrganicos = typedAttributionSignal ? channelBuckets.organic.pares : paresOrganicosCampo;
      const receitaOrganica = nonInvestmentRevenueForData(
        { receita, receita_bruta: receita, receita_organica: receitaOrganicaBase },
        receitaPaga
      );
      const pedidosOrganicos = nonInvestmentOrdersForData(
        { pedidos, pedidos_validos: pedidos, pedidos_organicos: pedidosOrganicosBase },
        pedidosPagos
      );
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
        receita_crm: receitaCrm,
        pares_pagos: paresPagos,
        pares_organicos: paresOrganicos,
        pares_crm: paresCrm,
        pares_outros_canais: attributionSignal ? paresOutrosCanais : null,
        pares_sem_match_atribuicao: attributionSignal ? paresSemMatch : null,
        pedidos_pagos: pedidosPagos,
        pedidos_organicos: pedidosOrganicos,
        pedidos_crm: pedidosCrm,
        receita_outros_canais: attributionSignal ? receitaOutrosCanais : null,
        pedidos_outros_canais: attributionSignal ? pedidosOutrosCanais : null,
        receita_sem_match_atribuicao: attributionSignal ? receitaSemMatch : null,
        pedidos_sem_match_atribuicao: attributionSignal ? pedidosSemMatch : null,
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
      receita_crm: acumuladoLancamento?.receita_crm ?? acumuladoAtual?.receita_crm ?? null,
      pedidos_pagos: acumuladoLancamento?.pedidos_pagos ?? acumuladoAtual?.pedidos_pagos ?? null,
      pedidos_organicos: acumuladoLancamento?.pedidos_organicos ?? acumuladoAtual?.pedidos_organicos ?? null,
      pedidos_crm: acumuladoLancamento?.pedidos_crm ?? acumuladoAtual?.pedidos_crm ?? null,
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

  function selectedRampMetricKey() {
    return RAMP_METRIC_KEYS.includes(state.normalizedRampMetric || '')
      ? state.normalizedRampMetric
      : 'receita_acumulada';
  }

  function selectedRampTimeLensKey() {
    return RAMP_TIME_LENSES.some((item) => item.key === state.rampTimeLens)
      ? state.rampTimeLens
      : 'all';
  }

  function rampTimeLensConfig(key = selectedRampTimeLensKey()) {
    return RAMP_TIME_LENSES.find((item) => item.key === key) || RAMP_TIME_LENSES[0];
  }

  function rampTimeLensBounds(maxDay, metric = rampMetricConfig()) {
    const allBounds = { key: 'all', start: 0, end: Math.max(0, Number(maxDay) || 0), label: 'Tudo' };
    if (metric?.cadence === 'mes') return allBounds;
    const lens = rampTimeLensConfig();
    if (lens.key === 'all') return allBounds;
    const endMax = Math.max(0, Number(maxDay) || 0);
    if (lens.start > endMax) return { ...allBounds, unavailable: true };
    return {
      key: lens.key,
      start: Math.max(0, lens.start),
      end: Math.min(endMax, lens.end ?? endMax),
      label: lens.label
    };
  }

  function rampTimeLensLabel(bounds) {
    if (!bounds || bounds.key === 'all') return 'toda a curva';
    return `${bounds.start === 0 ? 'D0' : `D+${bounds.start}`} a D+${bounds.end}`;
  }

  function rampMetricConfig(key = selectedRampMetricKey()) {
    const configs = {
      rps_diario: {
        key: 'rps_diario',
        label: 'RPS - Índice de sustentação',
        shortLabel: 'RPS',
        field: 'rps',
        format: 'brl',
        cadence: 'dia',
        cumulative: false,
        rps: true,
        tooltip: 'Diagnóstico principal: índice de sustentação = RPS fixo da fase / referência fixa da própria linha/produto. A curva MM7 suaviza a tendência visual; a decisão usa RPS fixo por fase. Não usa GA4, marketing, campanhas ou atribuição.'
      },
      receita_acumulada: {
        key: 'receita_acumulada',
        label: 'Rampa de faturamento',
        shortLabel: 'Faturamento',
        field: 'receita',
        format: 'brl',
        cadence: 'dia',
        cumulative: true,
        tooltip: 'Receita acumulada dia a dia desde o D0. Ausencia depois do ultimo dado fica vazia, nunca zero.'
      },
      receita_mensal: {
        key: 'receita_mensal',
        label: 'Faturamento por mes',
        shortLabel: 'Fat. mes',
        field: 'receita',
        format: 'brl',
        cadence: 'mes',
        cumulative: false,
        tooltip: 'Soma a receita em blocos comerciais de 30 dias desde o D0: M1, M2, M3 e seguintes.'
      },
      pedidos_mensal: {
        key: 'pedidos_mensal',
        label: 'Pedidos por mes',
        shortLabel: 'Pedidos mes',
        field: 'pedidos',
        format: 'num',
        cadence: 'mes',
        cumulative: false,
        tooltip: 'Soma pedidos em blocos comerciais de 30 dias desde o D0: M1, M2, M3 e seguintes.'
      },
      share_semanal: {
        key: 'share_semanal',
        label: 'Share de vendas semanal',
        shortLabel: 'Share de vendas',
        field: 'receita',
        format: 'pct',
        cadence: 'semana',
        cumulative: false,
        share: true,
        periodDays: RAMP_RHYTHM_WINDOW_DAYS,
        tooltip: 'Share de vendas por semana: vendas do lancamento divididas pelas vendas totais da empresa em cada semana desde o D0. A ultima semana pode ser parcial ate o snapshot.'
      },
      share_mensal: {
        key: 'share_mensal',
        label: 'Share de vendas mensal',
        shortLabel: 'Share mes',
        field: 'receita',
        format: 'pct',
        cadence: 'mes',
        cumulative: false,
        share: true,
        periodDays: RAMP_MONTH_DAYS,
        tooltip: 'Vendas do lancamento divididas pelas vendas totais da empresa em cada bloco mensal de 30 dias desde o D0. O mes corrente pode ser parcial ate o snapshot.'
      },
      saude_rampa: {
        key: 'saude_rampa',
        label: 'Ritmo de venda',
        shortLabel: 'Ritmo',
        field: null,
        format: 'pct',
        cadence: 'semana',
        cumulative: false,
        health: true,
        tooltip: RAMP_HEALTH_TOOLTIP
      }
    };
    return configs[key] || configs.receita_acumulada;
  }

  function formatRampValue(value, metric, compact = false) {
    if (metric?.format === 'pct_signed') return fmtSignedPct(value, compact ? 0 : 0);
    if (metric?.format === 'pct') return fmtPct(value, compact ? 0 : 0);
    if (metric?.format === 'num') return fmtNum(value);
    return fmtBRL(value, compact);
  }

  function launchCurrentRampDay(launch) {
    const values = [
      numberOrNull(launch?.dPlus),
      rampExportEndDay(launch),
      latestLaunchDataDay(launch)
    ].filter((value) => value !== null && value >= 0);
    if (!values.length) return selectedPeriodEndDay(launch, { capToAvailable: true }) ?? 0;
    return Math.max(0, ...values);
  }

  function normalizedRampMaxDay(launches) {
    const days = (launches || [])
      .map(launchCurrentRampDay)
      .filter((value) => value !== null && value >= 0);
    return days.length ? Math.max(0, ...days) : 90;
  }

  function rampMonthIndex(day) {
    return Math.floor(Math.max(0, Number(day) || 0) / RAMP_MONTH_DAYS);
  }

  function rampMonthLabel(index) {
    return `M${index + 1}`;
  }

  function rampMonthRangeLabel(index) {
    const start = index * RAMP_MONTH_DAYS;
    const end = ((index + 1) * RAMP_MONTH_DAYS) - 1;
    return start === 0 ? `D0 a D+${end}` : `D+${start} a D+${end}`;
  }

  function rampPeriodIndex(day, periodDays) {
    const size = Math.max(1, Number(periodDays) || 1);
    return Math.floor(Math.max(0, Number(day) || 0) / size);
  }

  function rampPeriodLensBounds(lensBounds, maxDay, periodDays) {
    const size = Math.max(1, Number(periodDays) || 1);
    const startDay = Math.max(0, Number(lensBounds?.start) || 0);
    const endDay = Math.min(
      Math.max(0, Number(lensBounds?.end ?? maxDay) || 0),
      Math.max(0, Number(maxDay) || 0)
    );
    const firstPeriod = Math.floor(startDay / size);
    const lastPeriod = Math.floor(endDay / size);
    return {
      startWeek: Math.max(0, firstPeriod),
      endWeek: Math.max(-1, lastPeriod),
      unavailable: lastPeriod < firstPeriod
    };
  }

  function rampPeriodRangeLabel(index, metric, observedEndDay = null) {
    const periodDays = metric?.periodDays || (metric?.cadence === 'mes' ? RAMP_MONTH_DAYS : RAMP_RHYTHM_WINDOW_DAYS);
    const start = index * periodDays;
    const fullEnd = ((index + 1) * periodDays) - 1;
    const end = observedEndDay === null || observedEndDay === undefined
      ? fullEnd
      : Math.min(fullEnd, Math.max(start, Number(observedEndDay) || start));
    const startLabel = start === 0 ? 'D0' : `D+${start}`;
    const suffix = end < fullEnd ? ' (parcial)' : '';
    return `${startLabel} a D+${end}${suffix}`;
  }

  function rampDailyRowsForLaunch(launch, maxDay, metric = null) {
    if (!launch?.modelo_id) return [];
    const endDay = Math.max(0, Number(maxDay) || 0);
    const useProductRows = Boolean(metric?.requiresProductRows) || isProductFilterActive() || isChannelFilterActive();
    if (useProductRows) {
      const rows = salesRowsForLaunchDayRange(launch, 0, endDay);
      const d0 = analysisDayZero(launch);
      const byDay = new Map();
      rows.forEach((row) => {
        const idx = dayIndex(d0, row.data);
        if (idx === null || idx < 0 || idx > endDay) return;
        const bucket = byDay.get(idx) || [];
        bucket.push(row);
        byDay.set(idx, bucket);
      });
      return [...byDay.entries()]
        .map(([day, dayRows]) => {
          const aggregate = applyChannelFilterToSalesData(aggregateLaunchSalesRows(dayRows, { day }));
          return {
            day,
            data: toIsoDate(addDays(d0, day)),
            receita: numberOrNull(aggregate?.receita),
            pedidos: numberOrNull(aggregate?.pedidos),
            pares: numberOrNull(aggregate?.pares),
            receita_paga: numberOrNull(aggregate?.receita_paga),
            receita_organica: numberOrNull(aggregate?.receita_organica),
            receita_controles: numberOrNull(aggregate?.receita_controles),
            pedidos_pagos: numberOrNull(aggregate?.pedidos_pagos),
            pedidos_organicos: numberOrNull(aggregate?.pedidos_organicos),
            pedidos_controles: numberOrNull(aggregate?.pedidos_controles)
          };
        })
        .filter((row) => Object.entries(row).some(([key, value]) => key !== 'day' && key !== 'data' && value !== null))
        .sort((a, b) => a.day - b.day);
    }
    const rampRows = rampSourceRows()
      .filter((row) => row.modelo_id === launch.modelo_id)
      .map((row) => ({
        ...row,
        day: numberOrNull(row.day) ?? numberOrNull(row.dia_desde_d0) ?? dayIndex(analysisDayZero(launch), row.data)
      }));
    const sourceRows = rampRows.length ? rampRows : (launch.daily || []);
    return sourceRows
      .map((row) => ({
        ...row,
        day: numberOrNull(row.day) ?? numberOrNull(row.dia_desde_d0),
        receita: numberOrNull(row.receita),
        pedidos: numberOrNull(row.pedidos),
        pares: numberOrNull(row.pares)
      }))
      .filter((row) => row.day !== null && row.day >= 0 && row.day <= endDay)
      .sort((a, b) => a.day - b.day);
  }

  function rampSeriesValue(row, metric) {
    return numberOrNull(row?.[metric?.field || 'receita']);
  }

  function cumulativeRampDatasetData(launch, metric, maxDay) {
    const data = Array(maxDay + 1).fill(null);
    const rows = rampDailyRowsForLaunch(launch, maxDay, metric);
    const byDay = new Map();
    rows.forEach((row) => {
      const value = rampSeriesValue(row, metric);
      if (value === null) return;
      byDay.set(row.day, (byDay.get(row.day) || 0) + value);
    });
    const validDays = rows
      .map((row) => row.day)
      .filter((day) => day !== null && day >= 0 && day <= maxDay);
    const lastDataDay = validDays.length ? Math.min(maxDay, Math.max(...validDays)) : null;
    const fillThroughDay = rampCanFillMissingDays(launch, maxDay) ? maxDay : lastDataDay;
    let running = 0;
    if (fillThroughDay !== null) {
      for (let day = 0; day <= fillThroughDay; day += 1) {
        running += byDay.get(day) || 0;
        data[day] = running;
      }
    }
    return { data, lastDataDay, sourceRows: rows };
  }

  function monthlyRampDatasetData(launch, metric, maxDay) {
    const maxMonth = rampMonthIndex(maxDay);
    const data = Array(maxMonth + 1).fill(null);
    const rows = rampDailyRowsForLaunch(launch, maxDay, metric);
    const totals = new Map();
    rows.forEach((row) => {
      const value = rampSeriesValue(row, metric);
      if (value === null) return;
      const monthIndex = rampMonthIndex(row.day);
      if (monthIndex > maxMonth) return;
      totals.set(monthIndex, (totals.get(monthIndex) || 0) + value);
    });
    const validMonths = rows
      .map((row) => rampMonthIndex(row.day))
      .filter((index) => index >= 0 && index <= maxMonth);
    const lastDataMonth = validMonths.length ? Math.max(...validMonths) : null;
    const fillThroughMonth = rampCanFillMissingDays(launch, maxDay) ? maxMonth : lastDataMonth;
    if (fillThroughMonth !== null) {
      for (let month = 0; month <= fillThroughMonth; month += 1) {
        data[month] = totals.get(month) || 0;
      }
    }
    return { data, lastDataDay: rows.length ? Math.max(...rows.map((row) => row.day)) : null, sourceRows: rows };
  }

  function rampPeriodAnalysisWrap() {
    return $('rps-period-analysis') || $('share-period-analysis');
  }

  function rpsModelForLaunch(launch) {
    return state.data?.lancamentos_rps_dia?.modelos?.[launch?.modelo_id] || null;
  }

  function rpsPointsForLaunch(launch, maxDay) {
    const model = rpsModelForLaunch(launch);
    const points = Array.isArray(model?.pontos) ? model.pontos : [];
    const endDay = Math.max(0, Number(maxDay) || 0);
    return points
      .map((point) => {
        const day = numberOrNull(point.dias_desde_lancamento)
          ?? numberOrNull(point.dia_desde_d0)
          ?? dayIndex(analysisDayZero(launch), point.data_calendario || point.data);
        const receitaTotal = numberOrNull(point.receita_total ?? point.receita);
        const sessoes = numberOrNull(point.sessoes);
        return {
          ...point,
          day,
          data_calendario: point.data_calendario || point.data || null,
          receita_total: receitaTotal,
          pedidos: numberOrNull(point.pedidos),
          sessoes,
          rps: numberOrNull(point.rps) ?? ratioOrNull(receitaTotal, sessoes),
          ingest_ts: point.ingest_ts || null
        };
      })
      .filter((point) => point.day !== null && point.day >= 0 && point.day <= endDay)
      .sort((a, b) => a.day - b.day);
  }

  function rpsAggregatePointsByDay(points = []) {
    const byDay = new Map();
    points.forEach((point) => {
      if (point?.day === null || point?.day === undefined) return;
      const day = Number(point.day);
      const current = byDay.get(day) || {
        ...point,
        day,
        receita_total: 0,
        sessoes: 0,
        pedidos: null,
        rps: null,
        rows: []
      };
      current.receita_total += Number(point.receita_total || 0);
      current.sessoes += Number(point.sessoes || 0);
      current.pedidos = point.pedidos === null && current.pedidos === null
        ? null
        : Number(current.pedidos || 0) + Number(point.pedidos || 0);
      current.data_calendario = current.data_calendario || point.data_calendario || null;
      current.ingest_ts = current.ingest_ts || point.ingest_ts || null;
      current.rows.push(point);
      byDay.set(day, current);
    });
    byDay.forEach((point) => {
      point.rps = ratioOrNull(point.receita_total, point.sessoes);
    });
    return byDay;
  }

  function rpsWindowSummaryFromMap(byDay, startDay, endDay) {
    const points = [];
    for (let day = Math.max(0, Number(startDay) || 0); day <= endDay; day += 1) {
      const point = byDay.get(day);
      if (point && point.sessoes !== null) points.push(point);
    }
    if (!points.length) return null;
    const receita = points.reduce((acc, point) => acc + Number(point.receita_total || 0), 0);
    const sessoes = points.reduce((acc, point) => acc + Number(point.sessoes || 0), 0);
    const pedidos = points.some((point) => point.pedidos !== null)
      ? points.reduce((acc, point) => acc + Number(point.pedidos || 0), 0)
      : null;
    return {
      startDay,
      endDay,
      observedStartDay: points[0]?.day ?? startDay,
      observedEndDay: points[points.length - 1]?.day ?? endDay,
      startIso: points[0]?.data_calendario || null,
      endIso: points[points.length - 1]?.data_calendario || null,
      daysCovered: points.length,
      receita,
      sessoes,
      pedidos,
      rps: ratioOrNull(receita, sessoes)
    };
  }

  function rpsQuantile(values, quantile, digits = 4) {
    const valid = values
      .map((value) => numberOrNull(value))
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    if (!valid.length) return null;
    const pos = (valid.length - 1) * Math.min(1, Math.max(0, Number(quantile) || 0));
    const base = Math.floor(pos);
    const rest = pos - base;
    const next = valid[base + 1];
    const value = next === undefined ? valid[base] : valid[base] + rest * (next - valid[base]);
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function rpsRampDatasetData(launch, metric, maxDay) {
    const data = Array(maxDay + 1).fill(null);
    const rpsMeta = Array(maxDay + 1).fill(null);
    const points = rpsPointsForLaunch(launch, maxDay);
    const byDay = rpsAggregatePointsByDay(points);
    for (let day = 0; day <= maxDay; day += 1) {
      const daily = byDay.get(day);
      if (!daily || daily.sessoes === null) continue;
      const startDay = Math.max(0, day - RPS_SMOOTHING_WINDOW_DAYS + 1);
      const summary = rpsWindowSummaryFromMap(byDay, startDay, day);
      if (!summary || summary.rps === null) continue;
      data[day] = summary.rps;
      rpsMeta[day] = {
        ...summary,
        day,
        windowDays: RPS_SMOOTHING_WINDOW_DAYS,
        daily_rps: daily.rps,
        daily_receita_total: daily.receita_total,
        daily_sessoes: daily.sessoes,
        daily_pedidos: daily.pedidos,
        data_calendario: daily.data_calendario || summary.endIso || null,
        formula: 'receita_7d / sessoes_7d'
      };
    }
    const validDays = rpsMeta
      .map((meta, day) => meta ? day : null)
      .filter((day) => day !== null);
    return {
      data,
      rpsMeta,
      lastDataDay: validDays.length ? Math.max(...validDays) : null,
      sourceRows: points,
      sourceLabel: 'RPS MM7 a partir de lancamentos_rps_dia.json'
    };
  }

  function rpsLatestDataDay(launch) {
    const model = rpsModelForLaunch(launch);
    const points = Array.isArray(model?.pontos) ? model.pontos : [];
    const dayZero = analysisDayZero(launch);
    const days = points
      .map((point) => numberOrNull(point.dias_desde_lancamento)
        ?? numberOrNull(point.dia_desde_d0)
        ?? dayIndex(dayZero, point.data_calendario || point.data))
      .filter((day) => day !== null && day >= 0);
    return days.length ? Math.max(...days) : launchCurrentRampDay(launch);
  }

  function rpsLineKey(launch) {
    const model = rpsModelForLaunch(launch);
    return normalizeText(model?.linha || launch?.linha || launch?.modelo || launch?.modelo_id || '');
  }

  function rpsLineLabel(launch) {
    const model = rpsModelForLaunch(launch);
    return model?.linha || launch?.linha || launch?.modelo || 'linha selecionada';
  }

  function rpsRulerPeerLaunches(selected, chartLaunches = selectedCompareLaunches()) {
    const selectedKey = rpsLineKey(selected);
    const peers = (chartLaunches || []).filter((launch) => rpsLineKey(launch) === selectedKey);
    return peers.some((launch) => launch.modelo_id === selected?.modelo_id)
      ? peers
      : [selected, ...peers].filter(Boolean);
  }

  function rpsPhaseConfig(day) {
    const value = numberOrNull(day);
    if (value === null || value <= 30) return { key: 'd0_30', label: 'D0-D30', start: 0, end: 30 };
    if (value <= 90) return { key: 'd31_90', label: 'D31-D90', start: 31, end: 90 };
    if (value <= 180) return { key: 'd91_180', label: 'D91-D180', start: 91, end: 180 };
    return { key: 'd181_plus', label: 'D181+', start: 181, end: null };
  }

  function rpsPhaseConfigs(maxDay) {
    return [
      { key: 'd0_30', label: 'D0-D30', start: 0, end: 30, minPoints: 1 },
      { key: 'd31_90', label: 'D31-D90', start: 31, end: 90, minPoints: 7 },
      { key: 'd91_180', label: 'D91-D180', start: 91, end: 180, minPoints: 7 },
      { key: 'd181_plus', label: 'D181+', start: 181, end: maxDay, minPoints: 7 }
    ];
  }

  function rpsPhaseBandsForLens(maxDay, lensStart, lensEnd) {
    const start = Math.max(0, Number(lensStart) || 0);
    const end = Math.max(start, Number(lensEnd) || 0);
    return rpsPhaseConfigs(maxDay)
      .map((phase) => {
        const phaseEnd = Math.min(phase.end ?? maxDay, maxDay);
        const visibleStart = Math.max(phase.start, start);
        const visibleEnd = Math.min(phaseEnd, end);
        if (visibleStart > visibleEnd) return null;
        return {
          label: phase.label,
          startIndex: visibleStart - start,
          endIndex: visibleEnd - start
        };
      })
      .filter(Boolean);
  }

  function rpsPhaseForDay(day, maxDay) {
    const phaseKey = rpsPhaseConfig(day).key;
    const phase = rpsPhaseConfigs(maxDay).find((item) => item.key === phaseKey) || rpsPhaseConfig(day);
    const phaseEnd = Math.min(phase.end ?? maxDay, Math.max(0, Number(maxDay) || 0));
    return {
      ...phase,
      end: phaseEnd,
      targetEnd: phase.end ?? phaseEnd,
      partial: phaseEnd < (phase.end ?? phaseEnd)
    };
  }

  function rpsPreviousPhase(phase, maxDay) {
    const phases = rpsPhaseConfigs(maxDay);
    const index = phases.findIndex((item) => item.key === phase?.key);
    return index > 0 ? phases[index - 1] : null;
  }

  function rpsFixedPhaseSummaryForLaunch(launch, phase, maxDay) {
    if (!launch || !phase) return null;
    const latestDay = Math.min(rpsLatestDataDay(launch), Math.max(0, Number(maxDay) || 0));
    const observedEnd = Math.min(phase.end ?? latestDay, latestDay);
    if (phase.start > observedEnd) return null;
    const summary = rpsSummaryForRange(launch, phase.start, observedEnd);
    if (!summary || summary.rps === null || summary.daysCovered < (phase.minPoints || 1)) return null;
    return {
      ...summary,
      phaseKey: phase.key,
      phaseLabel: phase.label,
      targetStartDay: phase.start,
      targetEndDay: phase.end ?? observedEnd,
      partial: observedEnd < (phase.end ?? observedEnd),
      formula: 'receita_fase / sessoes_fase'
    };
  }

  function rpsRulerMetaFromValue(value, extras = {}) {
    const rulerValue = numberOrNull(value);
    if (rulerValue === null) return null;
    return {
      value: rulerValue,
      lower: rulerValue * 0.90,
      upper: rulerValue * 1.10,
      median: rulerValue,
      p75: rulerValue * 1.10,
      ...extras
    };
  }

  function rpsSelfFixedRulerForPhase(selected, phase, maxDay) {
    const previousPhase = rpsPreviousPhase(phase, maxDay);
    const previousSummary = previousPhase ? rpsFixedPhaseSummaryForLaunch(selected, previousPhase, maxDay) : null;
    const currentSummary = rpsFixedPhaseSummaryForLaunch(selected, phase, maxDay);
    const basisSummary = previousSummary || currentSummary;
    if (!basisSummary || basisSummary.rps === null) return null;
    const isInitialBasis = !previousSummary;
    return rpsRulerMetaFromValue(basisSummary.rps, {
      count: basisSummary.daysCovered,
      phaseLabel: phase.label,
      basisLabel: isInitialBasis ? `base fixa ${basisSummary.phaseLabel}` : `referência própria ${basisSummary.phaseLabel}`,
      mode: 'self',
      lineLabel: rpsLineLabel(selected),
      sourceLabel: isInitialBasis
        ? `${selected.modelo}: RPS fixo da fase inicial`
        : `${selected.modelo}: RPS fixo da fase anterior`,
      basisSummary,
      currentSummary,
      isInitialBasis
    });
  }

  function rpsFillFixedRulerArrays(target, phase, summary, maxDay) {
    if (!summary || summary.value === null) return;
    const start = Math.max(0, phase.start);
    const end = Math.min(phase.end ?? maxDay, Math.max(0, Number(maxDay) || 0));
    for (let day = start; day <= end; day += 1) {
      target.median[day] = summary.value;
      target.lower[day] = summary.lower;
      target.p75[day] = summary.upper;
      if (target.good) target.good[day] = summary.value * 0.90;
      if (target.attention) target.attention[day] = summary.value * 0.75;
      target.meta[day] = {
        ...summary,
        day,
        lower: summary.lower,
        median: summary.value,
        p75: summary.upper,
        goodThreshold: summary.value * 0.90,
        attentionThreshold: summary.value * 0.75
      };
    }
  }

  function rpsSelfRulerDatasetData(selected, maxDay) {
    const lower = Array(maxDay + 1).fill(null);
    const median = Array(maxDay + 1).fill(null);
    const p75 = Array(maxDay + 1).fill(null);
    const good = Array(maxDay + 1).fill(null);
    const attention = Array(maxDay + 1).fill(null);
    const meta = Array(maxDay + 1).fill(null);
    const target = { lower, median, p75, good, attention, meta };
    rpsPhaseConfigs(maxDay).forEach((phase) => {
      const summary = rpsSelfFixedRulerForPhase(selected, phase, maxDay);
      rpsFillFixedRulerArrays(target, phase, summary, maxDay);
    });
    return { lower, median, p75, good, attention, meta, mode: 'self', peerCount: 1, lineLabel: rpsLineLabel(selected) };
  }

  function rpsPeerFixedRulerForPhase(selected, peerLaunches, phase, maxDay) {
    const rows = (peerLaunches || [])
      .map((launch) => {
        const summary = rpsFixedPhaseSummaryForLaunch(launch, phase, maxDay);
        const value = numberOrNull(summary?.rps);
        return value === null ? null : { launch, value, summary };
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    const values = rows.map((row) => row.value);
    if (values.length < 2) return null;
    const lower = rpsQuantile(values, 0.25, 4);
    const median = rpsQuantile(values, 0.5, 4);
    const upper = rpsQuantile(values, 0.75, 4);
    return {
      value: median,
      lower,
      upper,
      median,
      p75: upper,
      count: rows.length,
      rows,
      lineLabel: rpsLineLabel(selected),
      phaseLabel: phase.label,
      basisLabel: `mesma linha (${rpsLineLabel(selected)})`,
      mode: 'peer',
      sourceLabel: `RPS fixo de ${rows.length} lancamentos da mesma linha`,
      currentSummary: rows.find((row) => row.launch.modelo_id === selected?.modelo_id)?.summary || null
    };
  }

  function rpsPeerRulerDatasetData(selected, peerLaunches, maxDay) {
    const lower = Array(maxDay + 1).fill(null);
    const median = Array(maxDay + 1).fill(null);
    const p75 = Array(maxDay + 1).fill(null);
    const good = Array(maxDay + 1).fill(null);
    const attention = Array(maxDay + 1).fill(null);
    const meta = Array(maxDay + 1).fill(null);
    const target = { lower, median, p75, good, attention, meta };
    rpsPhaseConfigs(maxDay).forEach((phase) => {
      const summary = rpsPeerFixedRulerForPhase(selected, peerLaunches, phase, maxDay);
      rpsFillFixedRulerArrays(target, phase, summary, maxDay);
    });
    return { lower, median, p75, good, attention, meta, mode: 'peer', peerCount: peerLaunches.length, lineLabel: rpsLineLabel(selected) };
  }

  function rpsRulerDatasetData(selected, chartLaunches, maxDay) {
    const peers = rpsRulerPeerLaunches(selected, chartLaunches);
    if (peers.length >= 2) {
      const peerRuler = rpsPeerRulerDatasetData(selected, peers, maxDay);
      if (peerRuler.meta.some(Boolean)) return peerRuler;
    }
    return rpsSelfRulerDatasetData(selected, maxDay);
  }

  function rpsRulerChartDatasets(selected, chartLaunches, maxDay, lensStart, lensEnd) {
    const ruler = rpsRulerDatasetData(selected, chartLaunches, maxDay);
    const slice = (values) => values.slice(lensStart, lensEnd + 1);
    const bandLabel = 'Faixa da referência';
    const rulerLabel = ruler.mode === 'peer' ? `Referência 100% - ${ruler.lineLabel}` : 'Referência 100%';
    return [
      {
        label: bandLabel,
        data: slice(ruler.p75),
        borderColor: 'rgba(76, 175, 125, 0)',
        backgroundColor: 'rgba(76, 175, 125, 0.12)',
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.32,
        spanGaps: true,
        fill: false,
        isRpsReferenceBand: true,
        isRpsBandAnchor: true,
        rpsRulerMeta: ruler.meta
      },
      {
        label: bandLabel,
        data: slice(ruler.lower),
        borderColor: 'rgba(76, 175, 125, 0)',
        backgroundColor: 'rgba(76, 175, 125, 0.12)',
        pointRadius: 0,
        pointHoverRadius: 0,
        tension: 0.32,
        spanGaps: true,
        fill: '-1',
        isRpsReferenceBand: true,
        rpsRulerMeta: ruler.meta
      },
      {
        label: rulerLabel,
        data: slice(ruler.median),
        borderColor: 'rgba(255, 255, 255, 0.62)',
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
        borderDash: [6, 4],
        borderWidth: 2,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        tension: 0.32,
        spanGaps: true,
        fill: false,
        isRpsRulerMedian: true,
        rpsRulerMeta: ruler.meta
      },
      {
        label: 'Guia visual 90%',
        data: slice(ruler.good),
        borderColor: 'rgba(76, 175, 125, 0.72)',
        backgroundColor: 'rgba(76, 175, 125, 0.08)',
        borderDash: [3, 4],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        tension: 0.32,
        spanGaps: true,
        fill: false,
        isRpsGuideLine: true,
        rpsGuideRatio: 0.90,
        rpsRulerMeta: ruler.meta
      },
      {
        label: 'Guia visual 75%',
        data: slice(ruler.attention),
        borderColor: 'rgba(245, 184, 76, 0.72)',
        backgroundColor: 'rgba(245, 184, 76, 0.08)',
        borderDash: [2, 6],
        borderWidth: 1.5,
        pointRadius: 0,
        pointHoverRadius: 4,
        pointHitRadius: 10,
        tension: 0.32,
        spanGaps: true,
        fill: false,
        isRpsGuideLine: true,
        rpsGuideRatio: 0.75,
        rpsRulerMeta: ruler.meta
      }
    ];
  }

  function rpsSummaryForRange(launch, startDay, endDay) {
    const points = rpsPointsForLaunch(launch, Math.max(0, Number(endDay) || 0))
      .filter((point) => point.day >= startDay && point.day <= endDay && point.sessoes !== null);
    if (!points.length) return null;
    const receita = points.reduce((acc, point) => acc + Number(point.receita_total || 0), 0);
    const sessoes = points.reduce((acc, point) => acc + Number(point.sessoes || 0), 0);
    const pedidos = points.some((point) => point.pedidos !== null)
      ? points.reduce((acc, point) => acc + Number(point.pedidos || 0), 0)
      : null;
    return {
      startDay,
      endDay,
      startIso: points[0]?.data_calendario || null,
      endIso: points[points.length - 1]?.data_calendario || null,
      daysCovered: points.length,
      receita,
      sessoes,
      pedidos,
      rps: ratioOrNull(receita, sessoes)
    };
  }

  function rpsSelectedWindowSummaryForLaunch(launch) {
    const targetEnd = selectedPeriodEndDay(launch, { capToAvailable: false });
    if (targetEnd === null) return null;
    const points = rpsPointsForLaunch(launch, targetEnd);
    const validDays = points.filter((point) => point.rps !== null).map((point) => point.day);
    if (!validDays.length) return null;
    const endDay = Math.min(targetEnd, Math.max(...validDays));
    const summary = rpsSummaryForRange(launch, 0, endDay);
    return summary ? { ...summary, targetEndDay: targetEnd, partial: endDay < targetEnd } : null;
  }

  function rpsRecentWindowSummaryForLaunch(launch, windowDays = 7) {
    const maxDay = launchCurrentRampDay(launch);
    const points = rpsPointsForLaunch(launch, maxDay).filter((point) => point.rps !== null);
    if (!points.length) return null;
    const lastDay = points[points.length - 1].day;
    const size = Math.max(1, Number(windowDays) || 7);
    const currentStart = Math.max(0, lastDay - size + 1);
    const current = rpsSummaryForRange(launch, currentStart, lastDay);
    const previousEnd = currentStart - 1;
    const previousStart = Math.max(0, previousEnd - size + 1);
    const previous = previousEnd >= 0 ? rpsSummaryForRange(launch, previousStart, previousEnd) : null;
    return {
      current,
      previous,
      delta: current?.rps !== null && previous?.rps ? (current.rps / previous.rps) - 1 : null
    };
  }

  function rpsRankForWindow(chartLaunches, selectedId) {
    const rows = (chartLaunches || [])
      .map((launch) => {
        const summary = rpsSelectedWindowSummaryForLaunch(launch);
        return summary && summary.rps !== null ? { launch, summary, value: summary.rps } : null;
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    const selectedRank = rows.findIndex((row) => row.launch.modelo_id === selectedId);
    return {
      rows,
      rank: selectedRank >= 0 ? selectedRank + 1 : null,
      total: rows.length,
      leader: rows[0] || null
    };
  }

  function rpsPeriodLabel(summary) {
    if (!summary) return 'período pendente';
    const start = summary.startDay === 0 ? 'D0' : `D+${summary.startDay}`;
    const suffix = summary.partial ? ' parcial' : '';
    return `${start} a D+${summary.endDay}${suffix}`;
  }

  function rpsPhaseLabel(day) {
    const value = numberOrNull(day);
    if (value === null) return 'fase pendente';
    if (value <= 30) return 'D0-D30';
    if (value <= 90) return 'D31-D90';
    if (value <= 180) return 'D91-D180';
    return 'D181+';
  }

  function rpsRulerForDay(selected, chartLaunches, day) {
    const endDay = Math.max(0, Number(day) || 0);
    const comparison = [...(chartLaunches || [])];
    if (selected && !comparison.some((launch) => launch.modelo_id === selected.modelo_id)) comparison.push(selected);
    const ruler = rpsRulerDatasetData(selected, comparison, endDay);
    const meta = ruler.meta?.[endDay] || null;
    if (!meta) return null;
    return {
      ...meta,
      count: meta.count || ruler.peerCount || 1,
      lower: meta.lower ?? null,
      median: meta.median ?? null,
      p75: meta.p75 ?? null,
      mode: ruler.mode,
      lineLabel: ruler.lineLabel,
      basisLabel: meta.basisLabel || (ruler.mode === 'peer' ? `mesma linha (${ruler.lineLabel})` : 'referência própria')
    };
  }

  function rpsHealthStatus(index, ruler = null) {
    if (ruler?.isInitialBasis) {
      return { label: 'Base inicial', tone: 'neutral', helper: 'sem fase anterior comparavel' };
    }
    if (index === null || index === undefined || Number.isNaN(index)) {
      return { label: 'Pendente', tone: 'neutral', helper: 'referência indisponível' };
    }
    if (index >= 1) return { label: 'Acima da referência', tone: 'positive', helper: 'RPS fixo acima da referência da fase' };
    if (index >= 0.90) return { label: 'Próximo da referência', tone: 'neutral', helper: 'entre 90% e 100% da referência' };
    if (index >= 0.75) return { label: 'Abaixo da referência', tone: 'neutral', helper: 'entre 75% e 90% da referência' };
    return { label: 'Distante da referência', tone: 'neutral', helper: 'abaixo do guia visual de 75%' };
  }

  function rpsHealthSnapshotForLaunch(selected, chartLaunches = selectedCompareLaunches()) {
    if (!selected) return null;
    const maxDay = rpsLatestDataDay(selected);
    const series = rpsRampDatasetData(selected, rampMetricConfig('rps_diario'), maxDay);
    const days = series.rpsMeta
      .map((meta, day) => meta ? day : null)
      .filter((day) => day !== null);
    if (!days.length) return null;
    const day = Math.max(...days);
    const mm7Current = series.rpsMeta[day];
    const phase = rpsPhaseForDay(day, maxDay);
    const current = rpsFixedPhaseSummaryForLaunch(selected, phase, maxDay);
    const previousPhase = rpsPreviousPhase(phase, maxDay);
    const previous = previousPhase ? rpsFixedPhaseSummaryForLaunch(selected, previousPhase, maxDay) : null;
    const trend = current?.rps !== null && previous?.rps ? (current.rps / previous.rps) - 1 : null;
    const comparison = [...(chartLaunches || [])];
    if (!comparison.some((launch) => launch.modelo_id === selected.modelo_id)) comparison.push(selected);
    const ruler = rpsRulerForDay(selected, comparison, day);
    const index = current?.rps !== null && ruler?.median ? current.rps / ruler.median : null;
    return {
      day,
      current,
      mm7Current,
      previous,
      trend,
      ruler,
      index,
      status: rpsHealthStatus(index, ruler)
    };
  }

  function renderRpsPeriodAnalysis(selected, chartLaunches = selectedCompareLaunches()) {
    const wrap = rampPeriodAnalysisWrap();
    if (!wrap) return;
    if (!selected) {
      wrap.innerHTML = '';
      return;
    }

    const model = rpsModelForLaunch(selected);
    const health = rpsHealthSnapshotForLaunch(selected, chartLaunches);

    if (!model || !health?.current) {
      wrap.innerHTML = `
        <div class="share-period-copy">
          <div class="share-period-kicker">${labelTip('RPS', 'RPS = receita total / sessões. Receita vem de bridge_orders_customers e sessões de shopify_sessions_daily.')}</div>
          <strong>RPS pendente</strong>
          <span>Falta data/lancamentos_rps_dia.json ou sessoes validas para este lançamento. Rode exportarTudo para gerar o JSON oficial a partir do SSOT e do ShopifyQL.</span>
        </div>
      `;
      return;
    }

    wrap.innerHTML = '';
  }

  function renderRampPeriodAnalysis(selected, chartLaunches = selectedCompareLaunches()) {
    const wrap = rampPeriodAnalysisWrap();
    if (!wrap) return;
    const metric = rampMetricConfig();
    if ((state.normalizedChartMode || 'linha') !== 'linha') {
      wrap.innerHTML = '';
      return;
    }
    if (metric.rps) {
      renderRpsPeriodAnalysis(selected, chartLaunches);
      return;
    }
    if (metric.share) {
      renderSharePeriodAnalysis(selected, chartLaunches);
      return;
    }
    wrap.innerHTML = '';
  }

  function shareTrajectoryPointsForLaunch(launch, maxDay) {
    const model = state.data?.share_trajetoria?.modelos?.[launch?.modelo_id];
    const points = Array.isArray(model?.pontos) ? model.pontos : [];
    const endDay = Math.max(0, Number(maxDay) || 0);
    return points
      .map((point) => {
        const day = numberOrNull(point.dias_desde_lancamento)
          ?? dayIndex(analysisDayZero(launch), point.data_calendario);
        return {
          ...point,
          day,
          receita_produto: numberOrNull(point.receita_produto),
          receita_empresa: numberOrNull(point.receita_empresa),
          pedidos_empresa: numberOrNull(point.pedidos_empresa)
        };
      })
      .filter((point) => point.day !== null && point.day >= 0 && point.day <= endDay)
      .sort((a, b) => a.day - b.day);
  }

  function shareNumeratorByDayForLaunch(launch, maxDay) {
    const rows = rampDailyRowsForLaunch(launch, maxDay, { requiresProductRows: true, field: 'receita' });
    const byDay = new Map();
    rows.forEach((row) => {
      const day = numberOrNull(row.day);
      const receita = numberOrNull(row.receita);
      if (day === null || receita === null) return;
      byDay.set(day, (byDay.get(day) || 0) + receita);
    });
    return byDay;
  }

  function shareRampDatasetData(launch, metric, maxDay) {
    const periodDays = metric?.periodDays || (metric?.cadence === 'mes' ? RAMP_MONTH_DAYS : RAMP_RHYTHM_WINDOW_DAYS);
    const maxPeriod = rampPeriodIndex(maxDay, periodDays);
    const data = Array(maxPeriod + 1).fill(null);
    const shareMeta = Array(maxPeriod + 1).fill(null);
    const points = shareTrajectoryPointsForLaunch(launch, maxDay);
    const filteredNumerator = isProductFilterActive() || isChannelFilterActive();
    const numeratorByDay = filteredNumerator ? shareNumeratorByDayForLaunch(launch, maxDay) : null;
    const buckets = Array.from({ length: maxPeriod + 1 }, (_, periodIndex) => ({
      periodIndex,
      startDay: periodIndex * periodDays,
      endDay: ((periodIndex + 1) * periodDays) - 1,
      productRevenue: 0,
      companyRevenue: 0,
      companyOrders: 0,
      daysCovered: 0,
      lastDay: null,
      startIso: null,
      endIso: null
    }));

    points.forEach((point) => {
      const periodIndex = rampPeriodIndex(point.day, periodDays);
      const bucket = buckets[periodIndex];
      const companyRevenue = numberOrNull(point.receita_empresa);
      if (!bucket || companyRevenue === null) return;
      const productRevenue = filteredNumerator
        ? (numeratorByDay.get(point.day) || 0)
        : (numberOrNull(point.receita_produto) || 0);
      bucket.productRevenue += productRevenue;
      bucket.companyRevenue += companyRevenue;
      bucket.companyOrders += numberOrNull(point.pedidos_empresa) || 0;
      bucket.daysCovered += 1;
      bucket.lastDay = bucket.lastDay === null ? point.day : Math.max(bucket.lastDay, point.day);
      if (!bucket.startIso && point.data_calendario) bucket.startIso = point.data_calendario;
      if (point.data_calendario) bucket.endIso = point.data_calendario;
    });

    buckets.forEach((bucket) => {
      if (!bucket.daysCovered || !bucket.companyRevenue) return;
      const share = bucket.productRevenue / bucket.companyRevenue;
      data[bucket.periodIndex] = share;
      shareMeta[bucket.periodIndex] = {
        ...bucket,
        share,
        partial: bucket.lastDay !== null && bucket.lastDay < bucket.endDay,
        filteredNumerator
      };
    });

    const validIndexes = shareMeta
      .map((meta, index) => meta ? index : null)
      .filter((index) => index !== null);
    return {
      data,
      shareMeta,
      lastDataIndex: validIndexes.length ? Math.max(...validIndexes) : null,
      sourceRows: points,
      sourceLabel: filteredNumerator
        ? 'share_trajetoria.json com numerador filtrado do SSOT'
        : 'share_trajetoria.json'
    };
  }

  function rampHealthSourceRowsForLaunch(launch, maxDay) {
    if (!launch?.modelo_id) return [];
    const d0 = analysisDayZero(launch);
    const endDay = Math.max(0, Number(maxDay) || 0);
    if (isProductFilterActive() || isChannelFilterActive()) {
      return rampDailyRowsForLaunch(launch, endDay, { requiresProductRows: true, field: 'receita' })
        .map((row) => ({
          ...row,
          day: numberOrNull(row.day),
          receita: numberOrNull(row.receita),
          pedidos: numberOrNull(row.pedidos)
        }))
        .filter((row) => row.day !== null && row.day >= 0 && row.day <= endDay)
        .sort((a, b) => a.day - b.day);
    }
    const rampRows = rampSourceRows()
      .filter((row) => row.modelo_id === launch.modelo_id)
      .map((row) => ({
        ...row,
        day: numberOrNull(row.day) ?? numberOrNull(row.dia_desde_d0) ?? dayIndex(d0, row.data)
      }));
    const sourceRows = rampRows.length ? rampRows : (launch.daily || []);
    return sourceRows
      .map((row) => ({
        ...row,
        day: numberOrNull(row.day) ?? numberOrNull(row.dia_desde_d0),
        receita: numberOrNull(row.receita),
        pedidos: numberOrNull(row.pedidos)
      }))
      .filter((row) => row.day !== null && row.day >= 0 && row.day <= endDay)
      .sort((a, b) => a.day - b.day);
  }

  function rampRhythmLevel({ currentRatio, endDay }) {
    if (endDay < (RAMP_RHYTHM_WINDOW_DAYS * 2) - 1) {
      return {
        key: 'early',
        label: 'Ainda cedo',
        badge: 'parcial',
        summary: 'Ja existe um ritmo semanal, mas a comparacao com a semana anterior ainda esta pendente.'
      };
    }
    if (currentRatio >= RAMP_STABILITY_STRONG_RATIO) {
      return {
        key: 'strong',
        label: 'Forte',
        badge: 'pipeline',
        summary: 'A linha ainda sustenta pelo menos metade do melhor ritmo semanal.'
      };
    }
    if (currentRatio >= RAMP_STABILITY_MIN_RATIO) {
      return {
        key: 'sustain',
        label: 'Sustentacao',
        badge: 'pipeline',
        summary: 'A linha ainda preserva uma parte relevante do melhor ritmo semanal.'
      };
    }
    if (currentRatio >= RAMP_STABILITY_LOW_RATIO) {
      return {
        key: 'low',
        label: 'Patamar baixo',
        badge: 'orange',
        summary: 'A linha ainda vende, mas ja opera perto da cauda do lancamento.'
      };
    }
    return {
      key: 'tail',
      label: 'Cauda',
      badge: 'orange',
        summary: 'A linha esta abaixo de um quarto do melhor ritmo semanal.'
    };
  }

  function rampRhythmDirection(changePct) {
    if (changePct === null || changePct === undefined) return 'Pendente';
    if (changePct >= RAMP_RHYTHM_TREND_LIMIT) return 'Crescendo';
    if (changePct <= -RAMP_RHYTHM_TREND_LIMIT) return 'Caindo';
    return 'Estavel';
  }

  function rampWeekStartDay(weekIndex) {
    return weekIndex * RAMP_RHYTHM_WINDOW_DAYS;
  }

  function rampWeekEndDay(weekIndex) {
    return rampWeekStartDay(weekIndex) + RAMP_RHYTHM_WINDOW_DAYS - 1;
  }

  function rampWeekLabel(weekIndex) {
    return `S${weekIndex + 1}`;
  }

  function rampWeekRangeLabel(weekIndex) {
    const startDay = rampWeekStartDay(weekIndex);
    const endDay = rampWeekEndDay(weekIndex);
    return `${startDay === 0 ? 'D0' : `D+${startDay}`} a D+${endDay}`;
  }

  function rampWeeklyLensBounds(lensBounds, maxDay) {
    const firstWeek = Math.ceil(Math.max(0, Number(lensBounds?.start) || 0) / RAMP_RHYTHM_WINDOW_DAYS);
    const lastDay = Math.min(Math.max(0, Number(lensBounds?.end ?? maxDay) || 0), Math.max(0, Number(maxDay) || 0));
    const lastWeek = Math.floor((lastDay - (RAMP_RHYTHM_WINDOW_DAYS - 1)) / RAMP_RHYTHM_WINDOW_DAYS);
    return {
      startWeek: Math.max(0, firstWeek),
      endWeek: Math.max(-1, lastWeek),
      unavailable: lastWeek < firstWeek
    };
  }

  function rampWeeklyPoint(weeklyRevenue, weeklyOrders, peak, weekIndex) {
    if (!peak?.value || weekIndex === null || weekIndex === undefined || weekIndex < 0) return null;
    const currentMm7 = weeklyRevenue?.[weekIndex] ?? null;
    if (currentMm7 === null || currentMm7 === undefined || !Number.isFinite(currentMm7)) return null;
    const ratio = currentMm7 / peak.value;
    const previousWeekIndex = weekIndex - 1;
    const previousMm7 = previousWeekIndex >= 0 ? weeklyRevenue?.[previousWeekIndex] ?? null : null;
    const changePct = previousMm7 ? (currentMm7 / previousMm7) - 1 : null;
    return {
      weekIndex,
      startDay: rampWeekStartDay(weekIndex),
      endDay: rampWeekEndDay(weekIndex),
      previousStartDay: previousMm7 !== null ? rampWeekStartDay(previousWeekIndex) : null,
      previousEndDay: previousMm7 !== null ? rampWeekEndDay(previousWeekIndex) : null,
      ratio,
      currentMm7,
      currentOrdersMm7: weeklyOrders?.[weekIndex] ?? null,
      peakMm7: peak.value,
      peakDay: rampWeekEndDay(peak.weekIndex),
      peakWeekIndex: peak.weekIndex,
      changePct,
      direction: rampRhythmDirection(changePct)
    };
  }

  function rampWeeklyStabilization(weeklyRevenue, weeklyOrders, peak) {
    if (!peak?.value) return null;
    const firstCandidateWeek = Math.max(2, peak.weekIndex + 2);
    for (let weekIndex = firstCandidateWeek; weekIndex < weeklyRevenue.length; weekIndex += 1) {
      const current = rampWeeklyPoint(weeklyRevenue, weeklyOrders, peak, weekIndex);
      const prior = rampWeeklyPoint(weeklyRevenue, weeklyOrders, peak, weekIndex - 1);
      if (!current || !prior || current.changePct === null || prior.changePct === null) continue;
      if (Math.abs(current.changePct) > RAMP_RHYTHM_TREND_LIMIT || Math.abs(prior.changePct) > RAMP_RHYTHM_TREND_LIMIT) continue;
      return {
        ...current,
        startDay: prior.startDay,
        endDay: current.endDay,
        confirmedDay: current.endDay,
        confirmedWeekIndex: weekIndex,
        level: rampRhythmLevel({ currentRatio: current.ratio, endDay: current.endDay }).label
      };
    }
    return null;
  }

  function rampWeeklyRhythmSeries(rows, endDay) {
    const weekCount = Math.floor((endDay + 1) / RAMP_RHYTHM_WINDOW_DAYS);
    if (weekCount < 1) return { data: [], healthMeta: [], lastDataIndex: null, peak: null, stabilization: null };

    const receitaByDay = new Map();
    const pedidosByDay = new Map();
    rows.forEach((row) => {
      receitaByDay.set(row.day, (receitaByDay.get(row.day) || 0) + Number(row.receita || 0));
      pedidosByDay.set(row.day, (pedidosByDay.get(row.day) || 0) + Number(row.pedidos || 0));
    });
    const weeklyRevenue = Array.from({ length: weekCount }, (_, weekIndex) => {
      const startDay = rampWeekStartDay(weekIndex);
      const endOfWeek = rampWeekEndDay(weekIndex);
      let total = 0;
      for (let day = startDay; day <= endOfWeek; day += 1) total += receitaByDay.get(day) || 0;
      return total / RAMP_RHYTHM_WINDOW_DAYS;
    });
    const weeklyOrders = Array.from({ length: weekCount }, (_, weekIndex) => {
      const startDay = rampWeekStartDay(weekIndex);
      const endOfWeek = rampWeekEndDay(weekIndex);
      let total = 0;
      for (let day = startDay; day <= endOfWeek; day += 1) total += pedidosByDay.get(day) || 0;
      return total / RAMP_RHYTHM_WINDOW_DAYS;
    });
    const peak = weeklyRevenue
      .map((value, weekIndex) => ({ value, weekIndex }))
      .filter((point) => numberOrNull(point.value) !== null)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0) || a.weekIndex - b.weekIndex)[0] || null;
    if (!peak || !peak.value) return { data: [], healthMeta: [], lastDataIndex: weekCount - 1, peak: null, stabilization: null };

    const stabilization = rampWeeklyStabilization(weeklyRevenue, weeklyOrders, peak);
    const healthMeta = weeklyRevenue.map((_, weekIndex) => {
      const point = rampWeeklyPoint(weeklyRevenue, weeklyOrders, peak, weekIndex);
      return point
        ? {
          ...point,
          isPeak: weekIndex === peak.weekIndex,
          isStabilization: stabilization?.confirmedWeekIndex === weekIndex,
          stabilization: stabilization?.confirmedWeekIndex === weekIndex ? stabilization : null
        }
        : null;
    });
    return {
      data: healthMeta.map((point) => point?.ratio ?? null),
      healthMeta,
      lastDataIndex: weekCount - 1,
      peak,
      stabilization
    };
  }

  function rampHealthInsightForLaunch(launch) {
    if (!launch || launch.isFuture || !isEligibleStatus(launch.status)) {
      return {
        pending: true,
        label: 'Sem rampa real',
        summary: 'Lancamento planejado ou sem dados reais carregados.',
        tooltip: 'O indicador de saude aparece apenas para lancamentos ativos ou historicos com serie diaria real.'
      };
    }
    const maxDay = launchCurrentRampDay(launch);
    const rows = rampHealthSourceRowsForLaunch(launch, maxDay);
    const validDays = rows.map((row) => row.day).filter((day) => day !== null && day >= 0);
    const lastDataDay = validDays.length ? Math.min(maxDay, Math.max(...validDays)) : null;
    const endDay = rampCanFillMissingDays(launch, maxDay) ? maxDay : lastDataDay;
    if (endDay === null || endDay < 6 || !rows.length) {
      return {
        pending: true,
        label: 'Serie insuficiente',
        summary: 'Ainda falta uma semana completa de vendas para calcular o ritmo.',
        tooltip: 'A leitura exige uma semana completa, de sete dias, observada desde o D0. Dado ausente permanece pendente.'
      };
    }

    const series = rampWeeklyRhythmSeries(rows, endDay);
    const point = series.lastDataIndex === null ? null : series.healthMeta[series.lastDataIndex];
    if (!series.peak || !point) {
      return {
        pending: true,
        label: 'Sem ritmo',
        summary: 'Nao ha faturamento suficiente para calcular pico e estabilizacao.',
        tooltip: 'Sem faturamento positivo em uma semana completa, o indicador fica pendente.'
      };
    }

    const status = rampRhythmLevel({ currentRatio: point.ratio, endDay: point.endDay });

    return {
      ...status,
      pending: false,
      ...point,
      currentRatio: point.ratio,
      endDay: point.endDay,
      stabilization: series.stabilization,
      completeLaunch: true,
      tooltip: RAMP_HEALTH_TOOLTIP
    };
  }

  function rampHealthChartDatasetData(launch, maxDay) {
    if (!launch || launch.isFuture || !isEligibleStatus(launch.status)) {
      return { data: [], healthMeta: [], lastDataIndex: null, sourceRows: [], sourceLabel: 'sem serie diaria real' };
    }
    const rows = rampHealthSourceRowsForLaunch(launch, maxDay);
    const validDays = rows.map((row) => row.day).filter((day) => day !== null && day >= 0);
    const lastObservedDay = validDays.length ? Math.min(maxDay, Math.max(...validDays)) : null;
    const endDay = rampCanFillMissingDays(launch, maxDay) ? maxDay : lastObservedDay;
    if (endDay === null || endDay < 6 || !rows.length) {
      return { data: [], healthMeta: [], lastDataIndex: null, sourceRows: rows, sourceLabel: 'serie insuficiente para uma semana completa' };
    }
    const series = rampWeeklyRhythmSeries(rows, endDay);
    if (!series.peak) {
      return { data: [], healthMeta: [], lastDataIndex: series.lastDataIndex, sourceRows: rows, sourceLabel: 'sem melhor ritmo semanal positivo' };
    }
    return {
      ...series,
      sourceRows: rows,
      sourceLabel: 'ritmo semanal fechado como percentual do melhor ritmo da linha'
    };
  }

  function rampHealthReferenceDatasets(maxDay, lensBounds = null) {
    const start = Math.max(0, Number(lensBounds?.start) || 0);
    const end = Math.max(start, Number(lensBounds?.end ?? maxDay) || 0);
    const days = end - start;
    return [
      { label: 'Forte 50%', value: RAMP_STABILITY_STRONG_RATIO, color: 'rgba(76,159,106,0.40)' },
      { label: 'Sustenta 35%', value: RAMP_STABILITY_MIN_RATIO, color: 'rgba(255,255,255,0.36)' },
      { label: 'Cauda 25%', value: RAMP_STABILITY_LOW_RATIO, color: 'rgba(224,82,82,0.34)' }
    ].map((item) => ({
      label: item.label,
      data: Array(days + 1).fill(item.value),
      borderColor: item.color,
      backgroundColor: 'transparent',
      borderWidth: 1,
      borderDash: [5, 5],
      pointRadius: 0,
      pointHoverRadius: 0,
      pointHitRadius: 0,
      tension: 0,
      fill: false,
      isHealthReference: true,
      sourceLabel: 'linha de referencia do ritmo de venda'
    }));
  }

  function rampScopeLabel(selected) {
    const parts = [];
    const line = state.lineFilter && state.lineFilter !== 'all'
      ? lineFilterOptions().find((item) => item.key === state.lineFilter)?.label || 'linha filtrada'
      : 'todas as linhas';
    parts.push(line);
    if (selected?.modelo) parts.push(`destaque ${selected.modelo}`);
    if (state.productFilter && state.productFilter !== 'all') {
      parts.push(productFilterOptions().find((item) => item.key === state.productFilter)?.label || 'produto filtrado');
    }
    if (state.productColorFilter && state.productColorFilter !== 'all') {
      parts.push(productColorFilterOptions().find((item) => item.key === state.productColorFilter)?.label || 'cor filtrada');
    }
    if (state.channelFilter && state.channelFilter !== 'all') {
      parts.push(channelFieldMap()?.label || 'canal filtrado');
    }
    return `Recorte: ${parts.filter(Boolean).join(' · ')}`;
  }

  function renderRampHealthInsight(selected) {
    const wrap = $('ramp-health-insight');
    if (!wrap) return;
    const mode = state.normalizedChartMode || 'linha';
    const isStabilityView = rampMetricConfig().health === true;
    wrap.hidden = mode !== 'linha' || !isStabilityView;
    if (wrap.hidden) {
      wrap.innerHTML = '';
      return;
    }
    const insight = rampHealthInsightForLaunch(selected);
    if (insight.pending) {
      wrap.innerHTML = `
        <div class="ramp-health-head">
          <div>
            <div class="ramp-health-label">${labelTip('Ritmo de venda', insight.tooltip)}</div>
            <strong>${escapeHtml(insight.label)}</strong>
            <span class="ramp-health-summary">${escapeHtml(insight.summary)}</span>
          </div>
        </div>
      `;
      return;
    }
    const scopeNote = `<small>${escapeHtml(rampScopeLabel(selected))}</small>`;
    const stabilization = insight.stabilization;
    const stabilizationValue = stabilization ? `D+${fmtNum(stabilization.confirmedDay)}` : 'Em observacao';
    const stabilizationDetail = stabilization
      ? `periodo D+${fmtNum(stabilization.startDay)} a D+${fmtNum(stabilization.endDay)} · ${escapeHtml(stabilization.level)}`
      : 'ainda nao completou duas semanas estaveis apos o pico';
    const stabilityWidth = Math.max(0, Math.min(100, Number(insight.currentRatio || 0) * 100));
    wrap.innerHTML = `
      <div class="ramp-health-head">
        <div>
          <div class="ramp-health-label">${labelTip('Leitura da linha', insight.tooltip)}</div>
          <strong>${escapeHtml(insight.label)}</strong>
          <span class="ramp-health-summary">${escapeHtml(insight.summary)}</span>
          ${scopeNote}
        </div>
        <div class="ramp-health-score">
          <span>Do pico</span>
          <strong>${fmtPct(insight.currentRatio, 0)}</strong>
          <small>pico em D+${fmtNum(insight.peakDay)} = 100%</small>
        </div>
      </div>
      <div class="ramp-health-meter">
        <div class="ramp-health-track" aria-hidden="true">
          <span class="ramp-health-band ramp-health-band--tail"></span>
          <span class="ramp-health-band ramp-health-band--low"></span>
          <span class="ramp-health-band ramp-health-band--sustain"></span>
          <span class="ramp-health-band ramp-health-band--strong"></span>
          <i style="left:${stabilityWidth.toFixed(1)}%"></i>
        </div>
        <div class="ramp-health-guide" aria-label="Faixas de ritmo">
          <span>Cauda <b>&lt;25%</b></span>
          <span>Baixa <b>25-35%</b></span>
          <span>Sustenta <b>35-50%</b></span>
          <span>Forte <b>50%+</b></span>
        </div>
      </div>
      <div class="ramp-health-kpis">
        <div><span>Ritmo atual</span><strong>${fmtBRL(insight.currentMm7)}/dia</strong><small>ultima semana fechada</small></div>
        <div><span>Vs. semana anterior</span><strong>${fmtSignedPct(insight.changePct, 0)}</strong><small>${escapeHtml(insight.direction)}</small></div>
        <div><span>Estabilizou em</span><strong>${escapeHtml(stabilizationValue)}</strong><small>${stabilizationDetail}</small></div>
      </div>
    `;
  }

  function fmtSignedPp(value, digits = 1) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const prefix = value > 0 ? '+' : '';
    return `${prefix}${fmtNum(value * 100, digits)} p.p.`;
  }

  function sharePeriodSummaryForLaunch(launch, metricKey) {
    if (!launch) return null;
    const metric = rampMetricConfig(metricKey);
    const series = shareRampDatasetData(launch, metric, launchCurrentRampDay(launch));
    const metas = series.shareMeta || [];
    const lastIndex = numberOrNull(series.lastDataIndex);
    const current = lastIndex !== null ? metas[lastIndex] : null;
    const previousIndex = lastIndex === null ? null : (() => {
      for (let index = lastIndex - 1; index >= 0; index -= 1) {
        if (metas[index]) return index;
      }
      return null;
    })();
    const previous = previousIndex !== null ? metas[previousIndex] : null;
    const peak = metas
      .map((meta, index) => meta ? { meta, index } : null)
      .filter(Boolean)
      .sort((a, b) => Number(b.meta.share || 0) - Number(a.meta.share || 0) || a.index - b.index)[0] || null;
    return {
      metric,
      series,
      current,
      currentIndex: lastIndex,
      previous,
      previousIndex,
      peak
    };
  }

  function sharePeriodRankAt(chartLaunches, metricKey, periodIndex, selectedId) {
    if (periodIndex === null || periodIndex === undefined || periodIndex < 0) return null;
    const metric = rampMetricConfig(metricKey);
    const rows = (chartLaunches || [])
      .map((launch) => {
        const series = shareRampDatasetData(launch, metric, launchCurrentRampDay(launch));
        const meta = series.shareMeta?.[periodIndex] || null;
        return meta ? { launch, meta, value: meta.share } : null;
      })
      .filter(Boolean)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    const selectedRank = rows.findIndex((row) => row.launch.modelo_id === selectedId);
    return {
      rows,
      rank: selectedRank >= 0 ? selectedRank + 1 : null,
      total: rows.length,
      leader: rows[0] || null
    };
  }

  function shareTrendTone(delta) {
    if (delta === null || delta === undefined) return 'neutral';
    if (delta >= 0.005) return 'positive';
    if (delta <= -0.005) return 'negative';
    return 'neutral';
  }

  function shareTrendText(delta) {
    const tone = shareTrendTone(delta);
    if (tone === 'positive') return 'ganhando share';
    if (tone === 'negative') return 'perdendo share';
    if (delta === null || delta === undefined) return 'sem base anterior';
    return 'estavel';
  }

  function sharePeriodKpiHtml({ label, summary, periodLabel, delta, detail }) {
    const tone = shareTrendTone(delta);
    const current = summary?.current || null;
    return `
      <div class="share-period-kpi share-period-kpi--${tone}">
        <span>${escapeHtml(label)}</span>
        <strong>${current ? fmtPct(current.share, 1) : '—'}</strong>
        <small>${escapeHtml(periodLabel || 'periodo pendente')}</small>
        <em>${delta === null || delta === undefined ? 'sem comparativo' : fmtSignedPp(delta)}${detail ? ` · ${escapeHtml(detail)}` : ''}</em>
      </div>
    `;
  }

  function renderSharePeriodAnalysisVerbose(selected, chartLaunches = selectedCompareLaunches()) {
    const wrap = rampPeriodAnalysisWrap();
    if (!wrap) return;
    if (!selected) {
      wrap.innerHTML = '';
      return;
    }

    const weekly = sharePeriodSummaryForLaunch(selected, 'share_semanal');
    const monthly = sharePeriodSummaryForLaunch(selected, 'share_mensal');
    const weeklyDelta = weekly?.current && weekly.previous ? weekly.current.share - weekly.previous.share : null;
    const monthlyDelta = monthly?.current && monthly.previous ? monthly.current.share - monthly.previous.share : null;
    const weeklyRank = sharePeriodRankAt(chartLaunches, 'share_semanal', weekly?.currentIndex, selected.modelo_id);
    const weeklyPeriod = weekly?.currentIndex !== null && weekly?.currentIndex !== undefined
      ? `${rampWeekLabel(weekly.currentIndex)} · ${rampPeriodRangeLabel(weekly.currentIndex, weekly.metric, weekly.current?.lastDay)}`
      : null;
    const monthlyPeriod = monthly?.currentIndex !== null && monthly?.currentIndex !== undefined
      ? `${rampMonthLabel(monthly.currentIndex)} · ${rampPeriodRangeLabel(monthly.currentIndex, monthly.metric, monthly.current?.lastDay)}`
      : null;
    const peakPeriod = weekly?.peak
      ? `${rampWeekLabel(weekly.peak.index)} · ${rampPeriodRangeLabel(weekly.peak.index, weekly.metric, weekly.peak.meta.lastDay)}`
      : null;

    if (!weekly?.current && !monthly?.current) {
      wrap.innerHTML = `
        <div class="share-period-head">
          <div>
            <div class="share-period-kicker">${labelTip('Share de performance', 'Receita do lancamento dividida pela receita total da empresa no mesmo periodo desde o D0.')}</div>
            <strong>${escapeHtml(selected.modelo || 'Lancamento')}</strong>
          </div>
        </div>
        <div class="empty-state"><div><strong>Share indisponivel.</strong>Falta share_trajetoria para este lancamento no periodo atual.</div></div>
      `;
      return;
    }

    const rankText = weeklyRank?.rank
      ? `${fmtNum(weeklyRank.rank)}º de ${fmtNum(weeklyRank.total)} no grupo em ${rampWeekLabel(weekly.currentIndex)}`
      : 'sem ranking no grupo';
    const leaderText = weeklyRank?.leader && weeklyRank.leader.launch.modelo_id !== selected.modelo_id
      ? `lider: ${weeklyRank.leader.launch.modelo} (${fmtPct(weeklyRank.leader.value, 1)})`
      : 'lider ou empatado no recorte';
    const trendCopy = shareTrendText(weeklyDelta);
    const narrative = `${selected.modelo}: ${trendCopy} no share semanal (${weeklyDelta === null ? 'sem comparativo anterior' : fmtSignedPp(weeklyDelta)}). No mensal, ${monthlyDelta === null ? 'a base anterior ainda esta pendente' : `variou ${fmtSignedPp(monthlyDelta)}`}. ${rankText}.`;

    wrap.innerHTML = `
      <div class="share-period-head">
        <div>
          <div class="share-period-kicker">${labelTip('Share de performance', 'Receita do lancamento dividida pela receita total da empresa no mesmo periodo desde o D0. O denominador atual e empresa, nao linha.')}</div>
          <strong>${escapeHtml(selected.modelo || 'Lancamento')}</strong>
          <span>${escapeHtml(narrative)}</span>
        </div>
        <div class="share-period-source">
          <span>Fonte</span>
          <strong>share_trajetoria</strong>
          <small>${escapeHtml(shareDataUntil(state.data?.share_trajetoria?.modelos?.[selected.modelo_id], []) || snapshotIso())}</small>
        </div>
      </div>
      <div class="share-period-grid">
        ${sharePeriodKpiHtml({
          label: 'Share semanal atual',
          summary: weekly,
          periodLabel: weeklyPeriod,
          delta: weeklyDelta,
          detail: weekly?.current ? `${fmtBRL(weekly.current.productRevenue)} / ${fmtBRL(weekly.current.companyRevenue)}` : ''
        })}
        ${sharePeriodKpiHtml({
          label: 'Share mensal atual',
          summary: monthly,
          periodLabel: monthlyPeriod,
          delta: monthlyDelta,
          detail: monthly?.current ? `${fmtBRL(monthly.current.productRevenue)} / ${fmtBRL(monthly.current.companyRevenue)}` : ''
        })}
        <div class="share-period-kpi">
          <span>Pico semanal</span>
          <strong>${weekly?.peak ? fmtPct(weekly.peak.meta.share, 1) : '—'}</strong>
          <small>${escapeHtml(peakPeriod || 'periodo pendente')}</small>
          <em>${weekly?.peak ? `${fmtBRL(weekly.peak.meta.productRevenue)} / ${fmtBRL(weekly.peak.meta.companyRevenue)}` : 'sem pico calculado'}</em>
        </div>
        <div class="share-period-kpi">
          <span>Vs grupo no mesmo D+</span>
          <strong>${weeklyRank?.rank ? `${fmtNum(weeklyRank.rank)}º` : '—'}</strong>
          <small>${escapeHtml(weeklyRank?.total ? `${fmtNum(weeklyRank.total)} lancamentos comparaveis` : 'ranking pendente')}</small>
          <em>${escapeHtml(leaderText)}</em>
        </div>
      </div>
    `;
  }

  function sharePeriodCompactMetricHtml({ label, value, helper, tone = 'neutral' }) {
    return `
      <div class="share-period-metric share-period-metric--${tone}">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value || '-')}</strong>
        <small>${escapeHtml(helper || '')}</small>
      </div>
    `;
  }

  function renderSharePeriodAnalysis(selected, chartLaunches = selectedCompareLaunches()) {
    const wrap = rampPeriodAnalysisWrap();
    if (!wrap) return;
    if (!selected) {
      wrap.innerHTML = '';
      return;
    }

    const weekly = sharePeriodSummaryForLaunch(selected, 'share_semanal');
    const monthly = sharePeriodSummaryForLaunch(selected, 'share_mensal');
    const weeklyDelta = weekly?.current && weekly.previous ? weekly.current.share - weekly.previous.share : null;
    const monthlyDelta = monthly?.current && monthly.previous ? monthly.current.share - monthly.previous.share : null;
    const weeklyRank = sharePeriodRankAt(chartLaunches, 'share_semanal', weekly?.currentIndex, selected.modelo_id);

    if (!weekly?.current && !monthly?.current) {
      wrap.innerHTML = `
        <div class="share-period-copy">
          <div class="share-period-kicker">${labelTip('Share de vendas', 'Vendas do lancamento divididas pelas vendas totais da empresa no mesmo periodo desde o D0.')}</div>
          <strong>Share pendente</strong>
          <span>Falta share_trajetoria para este lancamento no periodo atual.</span>
        </div>
      `;
      return;
    }

    const deltaLabel = (delta) => delta === null || delta === undefined ? 'sem anterior' : fmtSignedPp(delta);
    const weeklyPeriod = weekly?.currentIndex !== null && weekly?.currentIndex !== undefined
      ? `${rampWeekLabel(weekly.currentIndex)} - ${rampPeriodRangeLabel(weekly.currentIndex, weekly.metric, weekly.current?.lastDay)}`
      : null;
    const monthlyPeriod = monthly?.currentIndex !== null && monthly?.currentIndex !== undefined
      ? `${rampMonthLabel(monthly.currentIndex)} - ${rampPeriodRangeLabel(monthly.currentIndex, monthly.metric, monthly.current?.lastDay)}`
      : null;
    const weeklyShort = weekly?.currentIndex !== null && weekly?.currentIndex !== undefined
      ? `${rampWeekLabel(weekly.currentIndex)}${weekly.current?.partial ? ' parcial' : ''}`
      : 'periodo pendente';
    const monthlyShort = monthly?.currentIndex !== null && monthly?.currentIndex !== undefined
      ? `${rampMonthLabel(monthly.currentIndex)}${monthly.current?.partial ? ' parcial' : ''}`
      : 'periodo pendente';
    const rankValue = weeklyRank?.rank ? `${fmtNum(weeklyRank.rank)}/${fmtNum(weeklyRank.total)}` : '-';
    const leaderText = weeklyRank?.leader && weeklyRank.leader.launch.modelo_id !== selected.modelo_id
      ? `lider: ${weeklyRank.leader.launch.modelo} (${fmtPct(weeklyRank.leader.value, 1)})`
      : 'lider ou empatado';
    const sourceUntil = shareDataUntil(state.data?.share_trajetoria?.modelos?.[selected.modelo_id], []) || snapshotIso();
    const methodItems = [
      `Fonte: share_trajetoria (${sourceUntil})`,
      'Denominador: vendas totais da empresa',
      weeklyPeriod ? `Sem.: ${weeklyPeriod}` : null,
      monthlyPeriod ? `Mes: ${monthlyPeriod}` : null,
      weekly?.peak ? `Pico: ${fmtPct(weekly.peak.meta.share, 1)} em ${rampWeekLabel(weekly.peak.index)}` : null
    ].filter(Boolean);
    const narrative = `${selected.modelo}: ${shareTrendText(weeklyDelta)}. Semana mostra tracao atual; Mes confirma sustentacao.`;

    wrap.innerHTML = `
      <div class="share-period-copy">
        <div class="share-period-kicker">${labelTip('Share de vendas', 'Vendas do lancamento divididas pelas vendas totais da empresa no mesmo periodo desde o D0. O denominador atual e empresa, nao linha.')}</div>
        <strong>Leitura rapida</strong>
        <span>${escapeHtml(narrative)}</span>
      </div>
      <div class="share-period-metrics">
        ${sharePeriodCompactMetricHtml({
          label: 'Semana',
          value: weekly?.current ? fmtPct(weekly.current.share, 1) : '-',
          helper: `${weeklyShort} | ${deltaLabel(weeklyDelta)}`,
          tone: shareTrendTone(weeklyDelta)
        })}
        ${sharePeriodCompactMetricHtml({
          label: 'Mes',
          value: monthly?.current ? fmtPct(monthly.current.share, 1) : '-',
          helper: `${monthlyShort} | ${deltaLabel(monthlyDelta)}`,
          tone: shareTrendTone(monthlyDelta)
        })}
        ${sharePeriodCompactMetricHtml({
          label: 'Grupo',
          value: rankValue,
          helper: leaderText,
          tone: weeklyRank?.rank === 1 ? 'positive' : 'neutral'
        })}
      </div>
      <details class="share-period-method">
        <summary>Base</summary>
        <span>${escapeHtml(methodItems.join(' | '))}</span>
      </details>
    `;
  }

  function rampDailyTickLabel(index, maxDay) {
    if (index === 0) return 'D0';
    if (MILESTONE_DAYS.includes(index) || index % 30 === 0 || index === maxDay) return `D+${index}`;
    return '';
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

  const rankingValueLabelsPlugin = {
    id: 'rankingValueLabels',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts?.enabled) return;
      const datasetIndex = opts.datasetIndex || 0;
      const dataset = chart.data.datasets?.[datasetIndex];
      const meta = chart.getDatasetMeta(datasetIndex);
      if (!dataset || !meta || meta.hidden) return;
      const { ctx, chartArea } = chart;
      ctx.save();
      ctx.font = '800 11px Inter, "Segoe UI", Arial, sans-serif';
      ctx.textBaseline = 'middle';
      meta.data.forEach((bar, index) => {
        const rawValue = dataset.data?.[index];
        const value = numberOrNull(rawValue);
        if (value === null || !bar) return;
        const text = typeof opts.formatter === 'function'
          ? opts.formatter(value, index, chart)
          : fmtNum(value);
        if (!text) return;
        const props = bar.getProps(['x', 'y', 'base'], true);
        const x = Number(props.x);
        const base = Number(props.base);
        const width = Math.abs(x - base);
        const textWidth = ctx.measureText(text).width;
        const outsideX = Math.min(chartArea.right - textWidth - 2, x + 8);
        const insideX = Math.max(chartArea.left + 4, x - textWidth - 8);
        ctx.textAlign = width > textWidth + 18 ? 'left' : 'left';
        ctx.fillStyle = width > textWidth + 18 ? '#FFFFFF' : 'rgba(255,255,255,0.82)';
        ctx.fillText(text, width > textWidth + 18 ? insideX : outsideX, props.y);
      });
      ctx.restore();
    }
  };

  const commercialMissingBarsPlugin = {
    id: 'commercialMissingBars',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts?.enabled) return;
      const { ctx, chartArea } = chart;
      const slotsByIndex = new Map();
      chart.data.datasets.forEach((dataset, datasetIndex) => {
        const missing = Array.isArray(dataset.missingDataIndexes) ? dataset.missingDataIndexes : [];
        if (!missing.length) return;
        const meta = chart.getDatasetMeta(datasetIndex);
        if (!meta || meta.hidden) return;
        missing.forEach((dataIndex) => {
          const bar = meta.data?.[dataIndex];
          if (!bar) return;
          const props = bar.getProps(['x', 'y', 'base'], true);
          const slot = slotsByIndex.get(dataIndex) || 0;
          slotsByIndex.set(dataIndex, slot + 1);
          const y = Math.max(chartArea.top + 12, chartArea.bottom - 16 - (slot * 12));
          ctx.save();
          ctx.strokeStyle = dataset.borderColor || 'rgba(255,255,255,0.55)';
          ctx.fillStyle = 'rgba(255,255,255,0.62)';
          ctx.lineWidth = 1;
          ctx.setLineDash([3, 3]);
          ctx.beginPath();
          ctx.moveTo(props.x, Math.min(props.base, chartArea.bottom));
          ctx.lineTo(props.x, y + 4);
          ctx.stroke();
          ctx.setLineDash([]);
          ctx.font = '700 9px Inter, "Segoe UI", Arial, sans-serif';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'bottom';
          ctx.fillText('sem dado', props.x, y);
          ctx.restore();
        });
      });
    }
  };

  const rampStabilizationPlugin = {
    id: 'rampStabilizationMarkers',
    afterDatasetsDraw(chart, args, opts) {
      if (!opts?.enabled) return;
      const markers = Array.isArray(opts.markers) ? opts.markers : [];
      if (!markers.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales?.x;
      if (!xScale || !chartArea) return;
      ctx.save();
      markers.forEach((marker, index) => {
        const day = numberOrNull(marker?.day);
        if (day === null) return;
        const plotDay = numberOrNull(marker?.plotDay) ?? day;
        const x = xScale.getPixelForValue(plotDay);
        if (!Number.isFinite(x) || x < chartArea.left || x > chartArea.right) return;
        ctx.strokeStyle = marker.selected ? 'rgba(255,255,255,0.42)' : 'rgba(255,255,255,0.16)';
        ctx.lineWidth = marker.selected ? 1.2 : 0.8;
        ctx.setLineDash(marker.selected ? [4, 3] : [2, 5]);
        ctx.beginPath();
        ctx.moveTo(x, chartArea.top);
        ctx.lineTo(x, chartArea.bottom);
        ctx.stroke();
        if (!marker.selected) return;
        ctx.setLineDash([]);
        ctx.fillStyle = marker.color || '#FFFFFF';
        ctx.font = '800 10px Inter, "Segoe UI", Arial, sans-serif';
        ctx.textBaseline = 'top';
        const label = `Estabiliza D+${fmtNum(day)}`;
        const textWidth = ctx.measureText(label).width;
        const labelX = Math.min(Math.max(x + 6, chartArea.left + 2), chartArea.right - textWidth - 2);
        const labelY = chartArea.top + 12 + ((index % 2) * 13);
        ctx.fillText(label, labelX, labelY);
      });
      ctx.restore();
    }
  };

  const rpsPhaseBandsPlugin = {
    id: 'rpsPhaseBands',
    beforeDatasetsDraw(chart, args, opts) {
      if (!opts?.enabled) return;
      const bands = Array.isArray(opts.bands) ? opts.bands : [];
      if (!bands.length) return;
      const { ctx, chartArea, scales } = chart;
      const xScale = scales?.x;
      if (!ctx || !chartArea || !xScale) return;
      const labelsCount = chart.data?.labels?.length || 0;
      if (!labelsCount) return;
      const firstX = xScale.getPixelForValue(0);
      const secondX = labelsCount > 1 ? xScale.getPixelForValue(1) : chartArea.right;
      const step = Number.isFinite(secondX - firstX) && Math.abs(secondX - firstX) > 0
        ? Math.abs(secondX - firstX)
        : chartArea.width / Math.max(1, labelsCount);
      ctx.save();
      bands.forEach((band, index) => {
        const startIndex = numberOrNull(band.startIndex);
        const endIndex = numberOrNull(band.endIndex);
        if (startIndex === null || endIndex === null || endIndex < startIndex) return;
        const startX = xScale.getPixelForValue(startIndex);
        const endX = xScale.getPixelForValue(endIndex);
        if (!Number.isFinite(startX) || !Number.isFinite(endX)) return;
        const left = Math.max(chartArea.left, Math.min(startX, endX) - step / 2);
        const right = Math.min(chartArea.right, Math.max(startX, endX) + step / 2);
        if (right <= left) return;
        ctx.fillStyle = index % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'rgba(255,143,0,0.032)';
        ctx.fillRect(left, chartArea.top, right - left, chartArea.bottom - chartArea.top);
        ctx.strokeStyle = 'rgba(255,255,255,0.08)';
        ctx.lineWidth = 1;
        ctx.setLineDash([3, 5]);
        ctx.beginPath();
        ctx.moveTo(left, chartArea.top);
        ctx.lineTo(left, chartArea.bottom);
        ctx.stroke();
        const label = String(band.label || '').trim();
        if (!label || right - left < 46) return;
        ctx.setLineDash([]);
        ctx.font = '800 9px Inter, "Segoe UI", Arial, sans-serif';
        ctx.fillStyle = 'rgba(255,255,255,0.46)';
        ctx.textBaseline = 'top';
        ctx.textAlign = 'left';
        ctx.fillText(label, left + 8, chartArea.top + 8);
      });
      ctx.restore();
    }
  };

  function configureChartDefaults() {
    if (!window.Chart) return;
    Chart.register(launchCheckpointPlugin);
    Chart.register(clientMixLabelsPlugin);
    Chart.register(rankingValueLabelsPlugin);
    Chart.register(commercialMissingBarsPlugin);
    Chart.register(rampStabilizationPlugin);
    Chart.register(rpsPhaseBandsPlugin);
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

  function cloneChartValue(value) {
    if (Array.isArray(value)) return value.map(cloneChartValue);
    if (isPlainObject(value)) {
      return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, cloneChartValue(item)]));
    }
    return value;
  }

  function activeLaunchChart() {
    const panel = document.querySelector('.launch-chart-panel.is-active:not([hidden])');
    const canvas = panel?.querySelector?.('canvas');
    if (!canvas || !window.Chart) return null;
    const chart = Chart.getChart(canvas);
    return chart ? { panel, canvas, chart } : null;
  }

  function closeChartZoom() {
    const modal = $('chart-zoom-modal');
    if (!modal) return;
    state.zoomChart?.destroy?.();
    state.zoomChart = null;
    modal.hidden = true;
    modal.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('chart-zoom-open');
  }

  function openChartZoom() {
    const active = activeLaunchChart();
    const modal = $('chart-zoom-modal');
    const canvas = $('chart-zoom-canvas');
    if (!active || !modal || !canvas || !window.Chart) return;

    const title = active.panel.querySelector('.chart-title span, .chart-title')?.textContent?.trim() || 'Grafico ampliado';
    const subtitle = active.panel.querySelector('.chart-sub')?.textContent?.trim() || '';
    const titleEl = $('chart-zoom-title');
    const subtitleEl = $('chart-zoom-subtitle');
    if (titleEl) titleEl.textContent = title;
    if (subtitleEl) subtitleEl.textContent = subtitle;

    state.zoomChart?.destroy?.();
    state.zoomChart = null;
    modal.hidden = false;
    modal.setAttribute('aria-hidden', 'false');
    document.body.classList.add('chart-zoom-open');

    const sourceConfig = active.chart.config?._config || active.chart.config || {};
    const data = cloneChartValue(sourceConfig.data || active.chart.data || {});
    const options = mergePlainObjects(cloneChartValue(sourceConfig.options || active.chart.options || {}), {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      layout: { padding: { top: 14, right: 18, bottom: 8, left: 8 } },
      plugins: {
        legend: {
          display: true,
          position: 'bottom',
          align: 'center'
        }
      }
    });

    state.zoomChart = new Chart(canvas, {
      type: sourceConfig.type || active.chart.config?.type || 'line',
      data,
      options
    });

    requestAnimationFrame(() => {
      state.zoomChart?.resize?.();
      $('chart-zoom-close')?.focus?.({ preventScroll: true });
    });
  }

  function configureLaunchChartZoom() {
    document.querySelectorAll('.launch-chart-panel .chart-head').forEach((head) => {
      if (head.querySelector('[data-chart-zoom-open]')) return;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'chart-zoom-button';
      button.dataset.chartZoomOpen = '';
      button.dataset.tooltip = 'Ampliar grafico';
      button.setAttribute('aria-label', 'Ampliar grafico');
      button.innerHTML = '<i class="ti ti-search" aria-hidden="true"></i>';
      head.appendChild(button);
    });

    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-chart-zoom-open]')) openChartZoom();
      if (event.target?.closest?.('[data-chart-zoom-close]')) closeChartZoom();
    });

    $('chart-zoom-close')?.addEventListener('click', closeChartZoom);
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && !$('chart-zoom-modal')?.hidden) closeChartZoom();
    });
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

  function configureNormalizedRampMetricToggle() {
    const buttons = [...document.querySelectorAll('[data-ramp-metric]')];
    if (!buttons.length) return;

    const currentSelected = () => state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];

    buttons.forEach((btn) => {
      btn.addEventListener('click', () => {
        buttons.forEach((button) => button.classList.toggle('is-active', button === btn));
        state.normalizedRampMetric = RAMP_METRIC_KEYS.includes(btn.dataset.rampMetric || '')
          ? btn.dataset.rampMetric
          : 'receita_acumulada';
        renderNormalizedChart(currentSelected());
      });
    });
  }

  function renderRampQuickControls(maxDay, metric, mode = state.normalizedChartMode || 'linha') {
    const wrap = $('ramp-quick-controls');
    if (!wrap) return;
    if (mode !== 'linha') {
      wrap.hidden = true;
      wrap.innerHTML = '';
      return;
    }
    wrap.hidden = false;
    const isDaily = metric?.cadence !== 'mes';
    const endMax = Math.max(0, Number(maxDay) || 0);
    if (isDaily && rampTimeLensBounds(endMax, metric).unavailable) {
      state.rampTimeLens = 'all';
    }
    const lensButtons = isDaily ? `
      <div class="ramp-quick-row">
        <span class="ramp-quick-label">Lupa temporal</span>
        <div class="chart-mode-toggle ramp-lens-toggle" role="group" aria-label="Lupa temporal da curva">
          ${RAMP_TIME_LENSES.map((lens) => {
            const disabled = lens.start > endMax;
            const active = selectedRampTimeLensKey() === lens.key && !disabled;
            return `<button type="button" class="chart-mode-btn ${active ? 'is-active' : ''}" data-ramp-time-lens="${escapeHtml(lens.key)}" ${disabled ? 'disabled' : ''}>${escapeHtml(lens.label)}</button>`;
          }).join('')}
        </div>
      </div>
    ` : '';
    const lineOptions = lineFilterOptions();
    const modelOptions = availableComparisonLaunches();
    const productOptions = productFilterOptions();
    const colorOptions = productColorFilterOptions();
    const isRps = Boolean(metric?.rps);
    const productScopeControls = isRps
      ? '<span class="ramp-rps-scope">100% é a referência fixa. 90% e 75% são guias visuais provisórios.</span>'
      : `
        <label class="ramp-filter-field"><span>Produto</span>
          <select class="ramp-quick-select" data-ramp-quick-filter="product" aria-label="Filtrar produto na curva" ${productOptions.length ? '' : 'disabled'}>
            <option value="all" ${state.productFilter === 'all' ? 'selected' : ''}>Todos produtos</option>
            ${productOptions.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.productFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
        <label class="ramp-filter-field"><span>Cor</span>
          <select class="ramp-quick-select" data-ramp-quick-filter="color" aria-label="Filtrar cor na curva" ${colorOptions.length ? '' : 'disabled'}>
            <option value="all" ${state.productColorFilter === 'all' ? 'selected' : ''}>Todas cores</option>
            ${colorOptions.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.productColorFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
      `;
    wrap.innerHTML = `
      ${lensButtons}
      <div class="ramp-quick-row ramp-filter-row">
        <span class="ramp-quick-label">Recorte</span>
        <label class="ramp-filter-field"><span>Linha</span>
          <select class="ramp-quick-select" data-ramp-quick-filter="line" aria-label="Filtrar linha na curva">
            <option value="all" ${state.lineFilter === 'all' ? 'selected' : ''}>Todas as linhas</option>
            ${lineOptions.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.lineFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
          </select>
        </label>
        <label class="ramp-filter-field"><span>Destaque</span>
          <select class="ramp-quick-select ramp-quick-select--model" data-ramp-quick-filter="model" aria-label="Destacar modelo na curva">
            ${modelOptions.map((launch) => `<option value="${escapeHtml(launch.modelo_id)}" ${launch.modelo_id === state.primaryModelId ? 'selected' : ''}>${escapeHtml(launch.modelo)}</option>`).join('')}
          </select>
        </label>
        ${productScopeControls}
        <button type="button" class="ramp-quick-clear" data-ramp-quick-clear>Limpar</button>
      </div>
    `;

    wrap.querySelectorAll('[data-ramp-time-lens]').forEach((button) => {
      button.addEventListener('click', () => {
        state.rampTimeLens = button.dataset.rampTimeLens || 'all';
        renderNormalizedChart(state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0]);
      });
    });
    wrap.querySelectorAll('[data-ramp-quick-filter]').forEach((select) => {
      select.addEventListener('change', () => {
        const key = select.dataset.rampQuickFilter;
        if (key === 'line') {
          state.lineFilter = select.value || 'all';
          state.productFilter = 'all';
          state.productColorFilter = 'all';
        } else if (key === 'model') {
          state.primaryModelId = select.value || state.primaryModelId;
          if (state.primaryModelId && !(state.compareModelIds || []).includes(state.primaryModelId)) {
            state.compareModelIds = [...(state.compareModelIds || []), state.primaryModelId];
          }
        } else if (key === 'product') {
          state.productFilter = select.value || 'all';
          state.productColorFilter = 'all';
        } else if (key === 'color') {
          state.productColorFilter = select.value || 'all';
        }
        renderAll();
      });
    });
    wrap.querySelector('[data-ramp-quick-clear]')?.addEventListener('click', () => {
      state.rampTimeLens = 'all';
      state.lineFilter = 'all';
      state.productFilter = 'all';
      state.productColorFilter = 'all';
      renderAll();
    });
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

  function applyLaunchChartView(view = state.launchChartView || 'normalized') {
    state.launchChartView = view;
    document.querySelectorAll('[data-chart-view]').forEach((button) => {
      button.classList.toggle('is-active', button.dataset.chartView === view);
    });
    document.querySelectorAll('[data-chart-panel]').forEach((panel) => {
      const active = panel.dataset.chartPanel === view;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    const normalizedControls = document.querySelector('.normalized-chart-controls');
    if (normalizedControls) normalizedControls.hidden = view !== 'normalized';
    window.requestAnimationFrame(() => {
      Object.values(state.charts).forEach((chart) => chart?.resize?.());
    });
  }

  function configureLaunchChartViewToggle() {
    const buttons = [...document.querySelectorAll('[data-chart-view]')];
    if (!buttons.length) return;
    buttons.forEach((button) => {
      button.addEventListener('click', () => {
        applyLaunchChartView(button.dataset.chartView || 'normalized');
      });
    });
    applyLaunchChartView();
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

  function configureStoryDrawerAccordion() {
    const renderPanel = (grid) => {
      const panel = grid?.querySelector?.('.story-drawer-panel');
      if (!panel) return;
      const active = grid.querySelector('details[open]');
      if (!active) {
        panel.hidden = true;
        panel.innerHTML = '';
        return;
      }
      const body = [...active.children]
        .filter((child) => child.tagName?.toLowerCase() !== 'summary')
        .map((child) => child.outerHTML)
        .join('');
      panel.innerHTML = body;
      panel.hidden = !body.trim();
    };

    document.addEventListener('toggle', (event) => {
      const details = event.target;
      if (!(details instanceof HTMLDetailsElement)) return;
      const grid = details.closest('.story-drawer-grid');
      if (!grid) return;
      if (details.open) {
        grid.querySelectorAll('details[open]').forEach((item) => {
          if (item !== details) item.open = false;
        });
      }
      renderPanel(grid);
    }, true);
  }

  function configureLaunchTableInsights() {
    const rowFromEvent = (event) => event.target?.closest?.('.launch-main-table tbody tr[data-launch-insight]');
    const openFromRow = (row) => {
      if (!row) return;
      openLaunchRowInsightDrawer(row.dataset.launchInsight);
    };

    document.addEventListener('click', (event) => {
      if (event.target?.closest?.('[data-launch-insight-close]')) {
        closeLaunchRowInsightDrawer();
        return;
      }
      openFromRow(rowFromEvent(event));
    });

    document.addEventListener('keydown', (event) => {
      const row = rowFromEvent(event);
      if (!row || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      openFromRow(row);
    });
  }

  function configureTooltips() {
    const tooltip = document.createElement('div');
    tooltip.id = 'app-tooltip';
    tooltip.className = 'app-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    document.body.appendChild(tooltip);
    let activeTarget = null;
    let activeMode = '';
    let hoverTimer = null;

    const targetFrom = (node) => node?.closest?.('[data-tooltip]');
    const isHelpButton = (target) => target?.matches?.('.help-button');
    const isActionControl = (target) => target?.matches?.('button, a, input, select, textarea, [role="button"]');
    const canHover = (target) => Boolean(target) && !isActionControl(target);
    const clearHoverTimer = () => {
      if (hoverTimer !== null) window.clearTimeout(hoverTimer);
      hoverTimer = null;
    };
    const setExpanded = (target, expanded) => {
      if (!target) return;
      target.classList.toggle('is-tooltip-open', expanded);
      if (isHelpButton(target)) target.setAttribute('aria-expanded', String(expanded));
    };
    const positionTooltip = (target) => {
      if (!target || tooltip.hidden) return;
      const gap = 10;
      const margin = 12;
      const rect = target.getBoundingClientRect();
      const tip = tooltip.getBoundingClientRect();
      const roomRight = window.innerWidth - rect.right - margin - gap;
      const roomLeft = rect.left - margin - gap;
      let left = roomRight >= tip.width || roomRight >= roomLeft
        ? rect.right + gap
        : rect.left - tip.width - gap;
      let top = rect.top + (rect.height / 2) - (tip.height / 2);

      if (top < margin || top + tip.height > window.innerHeight - margin) {
        top = rect.bottom + gap;
        if (top + tip.height > window.innerHeight - margin) top = rect.top - tip.height - gap;
      }
      left = Math.max(margin, Math.min(left, window.innerWidth - tip.width - margin));
      top = Math.max(margin, Math.min(top, window.innerHeight - tip.height - margin));
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    };

    const show = (target, mode) => {
      const text = target?.dataset?.tooltip;
      if (!text) return;
      if (activeTarget && activeTarget !== target) setExpanded(activeTarget, false);
      activeTarget = target;
      activeMode = mode;
      tooltip.textContent = text;
      tooltip.hidden = false;
      setExpanded(target, true);
      requestAnimationFrame(() => positionTooltip(target));
    };

    const hide = () => {
      clearHoverTimer();
      setExpanded(activeTarget, false);
      activeTarget = null;
      activeMode = '';
      tooltip.hidden = true;
    };

    document.addEventListener('pointerover', (event) => {
      const target = targetFrom(event.target);
      if (activeMode === 'manual' || !canHover(target) || activeTarget === target) return;
      clearHoverTimer();
      hoverTimer = window.setTimeout(() => show(target, 'hover'), 500);
    });
    document.addEventListener('pointerout', (event) => {
      const target = targetFrom(event.target);
      const next = event.relatedTarget;
      if (!target || (next instanceof Node && target.contains(next))) return;
      clearHoverTimer();
      if (activeTarget === target && activeMode === 'hover') hide();
    });
    document.addEventListener('click', (event) => {
      const target = targetFrom(event.target);
      if (!target) {
        hide();
        return;
      }
      if (isActionControl(target) && !isHelpButton(target)) {
        hide();
        return;
      }
      if (activeTarget === target && activeMode === 'manual') {
        hide();
        return;
      }
      show(target, 'manual');
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        hide();
        return;
      }
      const target = targetFrom(event.target);
      if (!target || isActionControl(target) || !['Enter', ' '].includes(event.key)) return;
      event.preventDefault();
      if (activeTarget === target && activeMode === 'manual') hide();
      else show(target, 'manual');
    });
    window.addEventListener('resize', () => positionTooltip(activeTarget));
    window.addEventListener('scroll', () => positionTooltip(activeTarget), true);
    document.querySelectorAll('.help-button[data-tooltip]').forEach((button) => {
      button.setAttribute('aria-controls', tooltip.id);
      button.setAttribute('aria-expanded', 'false');
    });
  }

  function renderModelSelector() {
    const wrap = $('model-selector');
    const launches = availableComparisonLaunches();
    wrap.innerHTML = `
      <select class="model-select" aria-label="Destaque visual">
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
            <div class="compare-summary">Este grupo entra em rankings, curvas, comerciais e projeção. O destaque visual só realça uma linha.</div>
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
      warning.textContent = 'Nenhum lançamento no grupo; marque ao menos dois para comparar.';
    } else if (selectedLaunches.length === 1) {
      warning.textContent = 'Com 1 lançamento, a tela vira leitura isolada. Inclua mais um para comparar.';
    } else {
      warning.textContent = '';
    }
  }

  function lineFilterOptions() {
    const rows = new Map();
    comparableLaunches().forEach((launch) => {
      const label = launch.linha || launch.modelo;
      const key = normalizeText(label || '');
      if (!key) return;
      if (!rows.has(key)) rows.set(key, { key, label });
    });
    return [...rows.values()].sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'));
  }

  function renderLineSelector() {
    const wrap = $('line-selector');
    if (!wrap) return;
    const options = lineFilterOptions();
    if (state.lineFilter !== 'all' && !options.some((item) => item.key === state.lineFilter)) {
      state.lineFilter = 'all';
    }
    wrap.innerHTML = `
      <select class="line-select" aria-label="Linha da analise">
        <option value="all" ${state.lineFilter === 'all' ? 'selected' : ''}>Todas as linhas</option>
        ${options.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.lineFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>`;
    wrap.querySelector('select')?.addEventListener('change', (event) => {
      state.lineFilter = event.target.value || 'all';
      state.productFilter = 'all';
      state.productColorFilter = 'all';
      renderAll();
    });
  }

  function productFilterOptions() {
    const launches = selectedCompareLaunches().length ? selectedCompareLaunches() : comparableLaunches();
    const options = new Map();
    launches.forEach((launch) => {
      subModelOptionsForStory(launch).forEach((item) => {
        const key = normalizeText(item.label || item.id || '');
        if (!key) return;
        const current = options.get(key) || { key, label: item.label, models: new Set() };
        current.models.add(launch.modelo_id);
        options.set(key, current);
      });
    });
    return [...options.values()]
      .map((item) => ({ ...item, count: item.models.size }))
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'pt-BR'));
  }

  function productColorFilterOptions() {
    const launches = selectedCompareLaunches().length ? selectedCompareLaunches() : availableComparisonLaunches();
    const options = new Map();
    launches.forEach((launch) => {
      storySalesRowsForWindow(launch)
        .filter((row) => {
          if (state.productFilter === 'all') return true;
          return productKeyForSalesRow(row, launch) === state.productFilter;
        })
        .forEach((row) => {
          const label = extractColor(row, launch);
          if (!validComparativeCutKey(label, 'Cor')) return;
          const key = normalizeText(label);
          const current = options.get(key) || { key, label, models: new Set(), pares: 0, receita: 0 };
          current.models.add(launch.modelo_id);
          current.pares += Number(row.pares || row.quantidade || 0);
          current.receita += dashboardRevenueNumber(row);
          options.set(key, current);
        });
    });
    return [...options.values()]
      .map((item) => ({ ...item, count: item.models.size }))
      .sort((a, b) => b.receita - a.receita || b.pares - a.pares || String(a.label).localeCompare(String(b.label), 'pt-BR'));
  }

  function renderProductSelector() {
    const wrap = $('product-selector');
    if (!wrap) return;
    const options = productFilterOptions();
    if (state.productFilter !== 'all' && !options.some((item) => item.key === state.productFilter)) {
      state.productFilter = 'all';
      state.productColorFilter = 'all';
    }
    const colorOptions = productColorFilterOptions();
    if (state.productColorFilter !== 'all' && !colorOptions.some((item) => item.key === state.productColorFilter)) {
      state.productColorFilter = 'all';
    }
    const disabled = !options.length;
    wrap.innerHTML = `
      <div class="product-filter-stack">
        <select class="product-select" aria-label="Produto da analise" ${disabled ? 'disabled' : ''}>
          <option value="all" ${state.productFilter === 'all' ? 'selected' : ''}>Todos os produtos</option>
          ${options.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.productFilter ? 'selected' : ''}>${escapeHtml(item.label)}${item.count > 1 ? ` (${fmtNum(item.count)})` : ''}</option>`).join('')}
        </select>
        ${colorOptions.length ? `
          <select class="product-color-select" aria-label="Cor do produto">
            <option value="all" ${state.productColorFilter === 'all' ? 'selected' : ''}>Todas as cores</option>
            ${colorOptions.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.productColorFilter ? 'selected' : ''}>${escapeHtml(item.label)}${item.count > 1 ? ` (${fmtNum(item.count)})` : ''}</option>`).join('')}
          </select>
        ` : ''}
      </div>`;
    wrap.querySelector('.product-select')?.addEventListener('change', (event) => {
      state.productFilter = event.target.value || 'all';
      state.productColorFilter = 'all';
      renderAll();
    });
    wrap.querySelector('.product-color-select')?.addEventListener('change', (event) => {
      state.productColorFilter = event.target.value || 'all';
      renderAll();
    });
  }

  function renderChannelSelector() {
    const wrap = $('channel-selector');
    if (!wrap) return;
    if (state.channelFilter === 'paid') state.channelFilter = 'investment';
    if (state.channelFilter === 'crm') state.channelFilter = 'organic';
    if (!CHANNEL_FILTERS.some((item) => item.key === state.channelFilter)) state.channelFilter = 'all';
    wrap.innerHTML = `
      <select class="channel-select" aria-label="Canal de venda">
        ${CHANNEL_FILTERS.map((item) => `<option value="${escapeHtml(item.key)}" ${item.key === state.channelFilter ? 'selected' : ''}>${escapeHtml(item.label)}</option>`).join('')}
      </select>`;
    wrap.querySelector('select')?.addEventListener('change', (event) => {
      state.channelFilter = event.target.value || 'all';
      renderAll();
    });
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
    const lineLabel = state.lineFilter === 'all'
      ? 'Todas'
      : lineFilterOptions().find((item) => item.key === state.lineFilter)?.label || 'Linha filtrada';
    const productLabel = state.productFilter === 'all'
      ? 'Todos'
      : productFilterOptions().find((item) => item.key === state.productFilter)?.label || 'Produto filtrado';
    const colorLabel = state.productColorFilter === 'all'
      ? null
      : productColorFilterOptions().find((item) => item.key === state.productColorFilter)?.label || 'cor filtrada';
    const recorteLabel = colorLabel ? `${productLabel} / ${colorLabel}` : productLabel;
    const channelLabel = CHANNEL_FILTERS.find((item) => item.key === state.channelFilter)?.label || 'Todos';
    const dLabel = selected.isFuture
      ? `D${selected.dPlus}`
      : `D+${Math.max(0, selected.dPlus ?? 0)}`;
    const items = [
      { label: 'Grupo comparado', value: `${fmtNum(compareCount)} modelos` },
      { label: 'Período', value: period?.label || selectedPeriodLabel() },
      { label: 'Destaque visual', value: selected.modelo },
      { label: 'Linha de produto', value: lineLabel },
      { label: 'Recorte', value: recorteLabel },
      { label: 'Canal de venda', value: channelLabel },
      { label: 'Atualização', value: `${fmtDate(snapshotIso())} · ${dLabel}` }
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
        copy: `${fmtNum(mediaBlocked.length)} linha(s) de investimento seguem sem atribuição real por pedido; ROAS fica vazio onde a receita não for confiável.`
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
            <span>Apoio à decisão</span>
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
    const days = rampSourceRows()
      .filter((row) => row.modelo_id === launch?.modelo_id)
      .map((row) => dayIndex(analysisDayZero(launch), row.data))
      .filter((idx) => idx !== null && idx >= 0);
    return days.length ? Math.max(...days) : null;
  }

  function rampSourceRows() {
    const rampRows = optionalRows('lancamentos_rampa_dia');
    return rampRows.length ? rampRows : optionalRows('lancamentos_produtos_dia');
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
    const sumField = (field) => {
      const values = rows
        .map((row) => numberOrNull(row[field]))
        .filter((value) => value !== null);
      return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
    };
    const dailyAllocatedAttribution = rows.some((row) => isDailyAllocatedAttribution(row));
    const hasChannelSignal = !dailyAllocatedAttribution && rows.some((row) => orderChannelType(row));
    const rowsForTypes = (types) => rows.filter((row) => types.includes(orderChannelType(row)));
    const receitaForTypes = (types) => {
      const typedRows = rowsForTypes(types);
      return typedRows.length ? typedRows.reduce((acc, row) => acc + dashboardRevenueNumber(row), 0) : 0;
    };
    const pedidosForTypes = (types) => {
      const typedRows = rowsForTypes(types);
      const ids = new Set(typedRows.map((row) => row.order_sk).filter(Boolean));
      if (ids.size) return ids.size;
      const fallback = typedRows.reduce((acc, row) => acc + Number(row.pedidos_validos ?? row.pedidos ?? 0), 0);
      return fallback || 0;
    };
    const receitaPaga = hasChannelSignal ? receitaForTypes(['paid']) : sumField('receita_paga');
    const receitaSemMatch = hasChannelSignal ? receitaForTypes(['unmatched']) : sumField('receita_sem_match_atribuicao');
    const receitaCrmCampo = sumField('receita_crm');
    const pedidosCrmCampo = sumField('pedidos_crm');
    const receitaCrm = hasChannelSignal ? receitaForTypes(['crm', 'owned']) : receitaCrmCampo;
    const receitaOutros = hasChannelSignal ? receitaForTypes(['other']) : sumField('receita_outros_canais');
    const pedidosPagos = hasChannelSignal ? pedidosForTypes(['paid']) : sumField('pedidos_pagos');
    const pedidosSemMatch = hasChannelSignal ? pedidosForTypes(['unmatched']) : sumField('pedidos_sem_match_atribuicao');
    const pedidosCrm = hasChannelSignal ? pedidosForTypes(['crm', 'owned']) : pedidosCrmCampo;
    const pedidosOutros = hasChannelSignal ? pedidosForTypes(['other']) : sumField('pedidos_outros_canais');
    const receitaControles = sumValues(receitaCrm, receitaOutros, receitaSemMatch);
    const pedidosControles = sumValues(pedidosCrm, pedidosOutros, pedidosSemMatch);
    const receitaInvestimento = receitaPaga;
    const pedidosInvestimento = pedidosPagos;
    const receitaOrganicaBase = hasChannelSignal
      ? receitaForTypes(['organic'])
      : sumField('receita_organica');
    const pedidosOrganicosBase = hasChannelSignal
      ? pedidosForTypes(['organic'])
      : sumField('pedidos_organicos');
    return {
      receita,
      pedidos,
      pares,
      receita_paga: receitaPaga,
      receita_organica: nonInvestmentRevenueForData(
        { receita, receita_bruta: receita, receita_organica: receitaOrganicaBase },
        receitaInvestimento
      ),
      receita_controles: receitaControles,
      receita_crm: receitaCrm,
      receita_outros_canais: receitaOutros,
      receita_sem_match_atribuicao: receitaSemMatch,
      pedidos_pagos: pedidosPagos,
      pedidos_organicos: nonInvestmentOrdersForData(
        { pedidos, pedidos_validos: pedidos, pedidos_organicos: pedidosOrganicosBase },
        pedidosInvestimento
      ),
      pedidos_controles: pedidosControles,
      pedidos_crm: pedidosCrm,
      pedidos_outros_canais: pedidosOutros,
      pedidos_sem_match_atribuicao: pedidosSemMatch,
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

  function isProductFilterActive() {
    return Boolean(
      (state.productFilter && state.productFilter !== 'all')
      || (state.productColorFilter && state.productColorFilter !== 'all')
    );
  }

  function isProductOnlyFilterActive() {
    return Boolean(state.productFilter && state.productFilter !== 'all');
  }

  function isProductColorFilterActive() {
    return Boolean(state.productColorFilter && state.productColorFilter !== 'all');
  }

  function isChannelFilterActive() {
    return Boolean(state.channelFilter && state.channelFilter !== 'all');
  }

  function productKeyForSalesRow(row, launch) {
    const subId = rowSubModelId(row, launch?.modelo_id || row?.modelo_id);
    const label = subId ? subModelLabel(subId) : (row?.sub_modelo || row?.produto || row?.nome_produto || row?.product_title || '');
    return normalizeText(label || '');
  }

  function rowMatchesProductFilter(row, launch) {
    if (isProductOnlyFilterActive() && productKeyForSalesRow(row, launch) !== state.productFilter) return false;
    if (isProductColorFilterActive()) {
      const color = extractColor(row, launch);
      if (normalizeText(color) !== state.productColorFilter) return false;
    }
    return true;
  }

  function salesRowsForLaunchDayRange(launch, startDay, endDay) {
    const d0 = analysisDayZero(launch);
    return optionalRows('lancamentos_produtos_dia').filter((row) => {
      if (row.modelo_id !== launch?.modelo_id) return false;
      if (!rowMatchesProductFilter(row, launch)) return false;
      const idx = dayIndex(d0, row.data);
      return idx !== null && idx >= startDay && idx <= endDay;
    });
  }

  function channelFieldMap(channelKey = state.channelFilter) {
    const map = {
      investment: { receita: ['receita_paga'], pedidos: ['pedidos_pagos'], label: 'Midia paga' },
      paid: { receita: ['receita_paga'], pedidos: ['pedidos_pagos'], label: 'Midia paga' },
      crm: { receita: ['receita_organica'], pedidos: ['pedidos_organicos'], label: 'Organico' },
      organic: { receita: 'receita_organica', pedidos: 'pedidos_organicos', label: 'Organico' },
      other: { receita: 'receita_outros_canais', pedidos: 'pedidos_outros_canais', label: 'Outros' }
    };
    return map[channelKey] || null;
  }

  function applyChannelFilterToSalesData(data) {
    if (!data || !isChannelFilterActive()) return data;
    const fields = channelFieldMap();
    if (!fields) return data;
    const totalReceita = numberOrNull(data.receita);
    const totalPedidos = numberOrNull(data.pedidos);
    const fieldValue = (field) => (
      Array.isArray(field)
        ? sumValues(...field.map((item) => data[item]))
        : numberOrNull(data[field])
    );
    const receita = fieldValue(fields.receita);
    const pedidos = fieldValue(fields.pedidos);
    return {
      ...data,
      receita,
      pedidos,
      receita_total_original: totalReceita,
      pedidos_total_original: totalPedidos,
      pares: null,
      ticket: ratioOrNull(receita, pedidos),
      preco_medio_par: null,
      channelFiltered: fields.label
    };
  }

  function filteredWindowDataForLaunch(launch, key = selectedPeriodKey()) {
    const endDay = WINDOW_DAYS[key];
    if (endDay === null || endDay === undefined) return null;
    if (!isProductFilterActive()) {
      return applyChannelFilterToSalesData(getWindow(launch, key));
    }
    const rows = salesRowsForLaunchDayRange(launch, 0, endDay);
    const aggregated = aggregateLaunchSalesRows(rows, {
      start_day: 0,
      end_day: endDay,
      produto: state.productFilter,
      cor: state.productColorFilter
    });
    if (aggregated.receita === null && aggregated.pedidos === null && aggregated.pares === null) return null;
    const data = {
      ...aggregated,
      ticket: ratioOrNull(aggregated.receita, aggregated.pedidos),
      preco_medio_par: ratioOrNull(aggregated.receita, aggregated.pares)
    };
    return applyChannelFilterToSalesData(data);
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

  function availableLaunchDay(launch) {
    const latestDay = latestLaunchDataDay(launch);
    const dPlus = numberOrNull(launch?.dPlus);
    return [latestDay, dPlus].filter((value) => value !== null).reduce((acc, value) => (
      acc === null ? value : Math.min(acc, value)
    ), null);
  }

  function selectedPartialShareForLaunch(launch, activityRow = null) {
    if (getWindow(launch, selectedPeriodKey())) return null;
    const requestedEndDay = selectedPeriodEndDay(launch);
    const activityEndDay = numberOrNull(activityRow?.data_day)
      ?? numberOrNull(activityRow?.activity_day)
      ?? numberOrNull(activityRow?.day)
      ?? availableLaunchDay(launch);
    if (requestedEndDay === null || activityEndDay === null || activityEndDay < 0) return null;
    const endDay = Math.min(requestedEndDay, activityEndDay);
    const row = goalRowForWindow(launch, { index: 1, startDay: 0, endDay: requestedEndDay }, endDay);
    const receita = numberOrNull(activityRow?.receita) ?? numberOrNull(row?.receita);
    const actual = numberOrNull(row?.actual);
    if (receita === null || actual === null) return null;
    return ratioOrNull(receita, actual);
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

  function storyCutDrawerHtml(selected) {
    if (!selected) return '';
    const launches = comparisonLaunchesWithFocus(selected);
    const allCuts = comparativeCutDeviationRows(launches);
    const title = 'O que puxou e o que pesou';
    const intro = `Cores e tamanhos acima ou abaixo da média em ${selectedPeriodLabel()}. Cada lançamento é lido desde o próprio D0.`;
    if (!allCuts.length) {
      return `
        <details class="story-cut-details">
          <summary><span>${escapeHtml(title)}</span><small>Sem leitura comparável</small></summary>
          <p>Ainda não há cor ou tamanho repetido em pelo menos duas linhas para comparar com segurança nesta janela.</p>
        </details>
      `;
    }

    const promoters = [...allCuts].filter((row) => row.deltaPp > 0).sort((a, b) => b.deltaPp - a.deltaPp).slice(0, 4);
    const detractors = [...allCuts].filter((row) => row.deltaPp < 0).sort((a, b) => a.deltaPp - b.deltaPp).slice(0, 4);
    const focusRows = allCuts.filter((row) => row.modelo_id === selected.modelo_id);
    const focusTop = [...focusRows].sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp)).slice(0, 3);
    const focusBest = focusTop[0] || null;
    const deltaText = (row) => {
      if (!row) return '';
      const direction = row.deltaPp >= 0 ? 'acima' : 'abaixo';
      return `${fmtNum(Math.abs(row.deltaPp), 1)} pts ${direction} da média`;
    };
    const summary = focusBest
      ? `${focusBest.dimensao} ${focusBest.key}: ${deltaText(focusBest)}`
      : `${fmtNum(allCuts.length)} sinais comparáveis`;
    const maxAbs = Math.max(...[...promoters, ...detractors].map((row) => Math.abs(row.deltaPp)), 1);
    const rowHtml = (row) => `
      <div class="story-cut-row ${row.modelo_id === selected.modelo_id ? 'is-selected' : ''}">
        <span>
          <strong>${escapeHtml(row.modelo)} - ${escapeHtml(row.dimensao)}: ${escapeHtml(String(row.key))}</strong>
          <small>${escapeHtml(row.range)} · ${fmtPct(row.share, 0)} do mix · média ${fmtPct(row.cohortAvgShare, 0)}</small>
        </span>
        <i><b class="${row.deltaPp >= 0 ? 'positive' : 'negative'}" style="width:${Math.max(6, Math.min(100, (Math.abs(row.deltaPp) / maxAbs) * 100)).toFixed(1)}%"></b></i>
        <em class="${row.deltaPp >= 0 ? 'delta-pos' : 'delta-neg'}">${escapeHtml(deltaText(row))}</em>
      </div>
    `;
    const focusHtml = focusTop.length ? `
      <div class="story-cut-focus">
        <strong>Na linha selecionada</strong>
        ${focusTop.map((row) => `
          <div class="story-cut-focus-row">
            <span>${escapeHtml(row.dimensao)}: ${escapeHtml(String(row.key))}</span>
            <em class="${row.deltaPp >= 0 ? 'delta-pos' : 'delta-neg'}">${escapeHtml(deltaText(row))}</em>
          </div>
        `).join('')}
      </div>
    ` : '';

    return `
      <details class="story-cut-details">
        <summary><span>${escapeHtml(title)}</span><small>${escapeHtml(summary)}</small></summary>
        <p>${escapeHtml(intro)}</p>
        ${focusHtml}
        <div class="story-cut-columns">
          <div>
            <strong>Puxou para cima</strong>
            ${promoters.length ? promoters.map(rowHtml).join('') : '<p>Sem destaque acima da média.</p>'}
          </div>
          <div>
            <strong>Pesou contra</strong>
            ${detractors.length ? detractors.map(rowHtml).join('') : '<p>Sem ponto abaixo da média.</p>'}
          </div>
        </div>
      </details>
    `;
  }

  function storySeasonalDrawerHtml(selected) {
    if (!selected) return '';
    const endDay = selectedPeriodEndDay(selected) ?? 90;
    const label = selectedPeriodLabel();
    const analysis = seasonalAnalysisForLaunch(selected, endDay, label);
    const strongest = [...analysis.events].sort((a, b) => Math.abs(b.score) - Math.abs(a.score))[0] || null;
    const eventTooltip = (events = []) => {
      if (!events.length) return 'Sem promotor, ofensor ou neutro cadastrado nesta janela.';
      const groupText = (title, rows) => rows.length
        ? `${title}: ${rows.map((event) => `${event.nome} (${fmtDate(event.data)} - D+${fmtNum(event.day)})`).join('; ')}`
        : '';
      return [
        groupText('Promotores', events.filter((event) => event.score > 0)),
        groupText('Ofensores', events.filter((event) => event.score < 0)),
        groupText('Neutros', events.filter((event) => event.score === 0))
      ].filter(Boolean).join('\n') || 'Sem promotor, ofensor ou neutro cadastrado nesta janela.';
    };
    const summary = analysis.events.length
      ? `${analysis.scoreLabel} · ${fmtNum(analysis.counts.promotores)} promotores · ${fmtNum(analysis.counts.ofensores)} ofensores`
      : `Janela limpa em ${label}`;
    const rows = comparisonLaunchesWithFocus(selected)
      .map((launch) => seasonalAnalysisForLaunch(launch, endDay, label))
      .sort((a, b) => b.score - a.score || a.launch.modelo.localeCompare(b.launch.modelo));
    const eventHtml = analysis.events.length
      ? analysis.events.slice(0, 5).map((event) => {
        const meta = seasonalMeta(event.tipo);
        const impact = event.score > 0 ? `+${event.score}` : String(event.score);
        return `
          <div class="story-seasonal-event story-seasonal-event--${meta.cls}">
            <strong>${escapeHtml(event.nome)}</strong>
            <span>${fmtDate(event.data)} · D+${fmtNum(event.day)} · ${escapeHtml(meta.label)} ${escapeHtml(seasonalWeightLabel(event.peso))} · impacto ${escapeHtml(impact)}</span>
            ${event.observacao ? `<small>${escapeHtml(event.observacao)}</small>` : ''}
          </div>
        `;
      }).join('')
      : '<p class="story-seasonal-empty">Sem evento cadastrado nesta janela.</p>';

    return `
      <details class="story-seasonal-details story-step-details">
        <summary><span>Calendário comercial</span><small>${escapeHtml(summary)}</small></summary>
        <div class="story-seasonal-body">
          <div class="story-seasonal-overview story-seasonal-overview--${analysis.cls}">
            <div>
              <strong>${escapeHtml(analysis.scoreLabel)}</strong>
              <span>${escapeHtml(analysis.read)}</span>
            </div>
            <div class="story-seasonal-mini-grid">
              <i tabindex="0" data-tooltip="${tooltipMultilineAttr(eventTooltip(analysis.events.filter((event) => event.score > 0)))}"><span>Promotores</span><b>${fmtNum(analysis.counts.promotores)}</b></i>
              <i tabindex="0" data-tooltip="${tooltipMultilineAttr(eventTooltip(analysis.events.filter((event) => event.score < 0)))}"><span>Ofensores</span><b>${fmtNum(analysis.counts.ofensores)}</b></i>
              <i tabindex="0" data-tooltip="${tooltipMultilineAttr(eventTooltip(analysis.events.filter((event) => event.score === 0)))}"><span>Neutros</span><b>${fmtNum(analysis.counts.neutros)}</b></i>
              <i tabindex="0" data-tooltip="${tooltipMultilineAttr(strongest ? eventTooltip([strongest]) : eventTooltip([]))}"><span>Mais forte</span><b>${strongest ? escapeHtml(strongest.nome) : '&mdash;'}</b></i>
            </div>
          </div>
          <div class="story-seasonal-section">
            <strong>Comparativo entre lançamentos</strong>
            <div class="story-seasonal-cohort">
              ${rows.map((row) => `
                <div class="${row.launch.modelo_id === selected.modelo_id ? 'is-selected' : ''}" tabindex="0" data-tooltip="${tooltipMultilineAttr(eventTooltip(row.events))}">
                  <span>${escapeHtml(row.launch.modelo)}</span>
                  <em class="seasonal-score--${row.cls}">${escapeHtml(row.scoreLabel)}</em>
                  <small>+${fmtNum(row.counts.promotores)} promotor · -${fmtNum(row.counts.ofensores)} ofensor · ${fmtNum(row.counts.neutros)} neutro</small>
                </div>
              `).join('')}
            </div>
          </div>
          <div class="story-seasonal-section">
            <strong>Eventos da linha selecionada</strong>
            ${eventHtml}
          </div>
        </div>
      </details>
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
    const shareCopy = productShare !== null ? ` \u00b7 participação do produto ${fmtPct(productShare, 1)}` : '';
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
      ? (current && displayedEndDay !== null ? Math.max(1, displayedEndDay) : null)
      : activityDay !== null ? Math.max(1, activityDay) : null;
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
          { label: 'Participação do produto', value: fmtPct(productActualPct, 1) },
          { label: 'Receita produto', value: fmtBRL(revenue) }
        ],
        extraHtml: monthBreakdown
      };
    }

    if (target !== null && actual === null) {
      return {
        label: 'Faturamento empresa pendente',
        value: 'Sem realizado',
        copy: `${range}: a meta total de ${monthlyLabel} é ${fmtBRL(target)}, mas o faturamento realizado da empresa ainda não está carregado. Sem realizado da empresa, a participação do produto ainda não pode ser calculada.${monthModeNote}${comparableNote}${selectedPartialNote}`,
        evidence: `${source} mes_base=${monthlyLabel} meta_mes=${fmtBRL(target)} meses=[${monthBreakdownEvidence}]. ${base.evidence || ''}`,
        source,
        state: 'pending',
        facts: [
          { label: 'Mês base', value: monthlyLabel },
          { label: 'Fat. empresa mês', value: 'sem dado' },
          { label: 'Meta mês', value: fmtBRL(target) },
          { label: 'Receita produto', value: fmtBRL(revenue) },
          { label: 'Participação do produto', value: 'sem realizado' }
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
        { label: 'Participação do produto', value: fmtPct(productActualPct, 1) },
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
          : 'participação pendente';
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

  function filteredComparisonLaunches() {
    return selectedCompareLaunches()
      .filter((launch) => launch && !launch.isFuture && !isPlannedStatus(launch.status));
  }

  function compactSalesWindowForLaunch(launch) {
    const key = selectedPeriodKey();
    const targetDay = selectedPeriodEndDay(launch);
    const observedForExact = selectedPeriodEndDay(launch, { capToAvailable: true });
    const exact = !isProductFilterActive()
      ? filteredWindowDataForLaunch(launch, key)
      : observedForExact !== null && targetDay !== null && observedForExact >= targetDay
        ? filteredWindowDataForLaunch(launch, key)
        : null;
    const d0 = analysisDayZero(launch);
    if (exact) {
      return {
        launch,
        key,
        data: exact,
        status: 'fechada',
        statusLabel: selectedPeriodLabel(),
        range: launchWindowRangeLabel(launch, key),
        observedDay: targetDay,
        targetDay,
        isPartial: false,
        source: 'vendas do pipeline'
      };
    }

    if (!d0 || targetDay === null) {
      return {
        launch,
        key,
        data: null,
        status: 'sem_d0',
        statusLabel: 'sem D0',
        range: 'sem data de lancamento',
        observedDay: null,
        targetDay,
        isPartial: false,
        source: 'sem janela'
      };
    }

    const observedDay = selectedPeriodEndDay(launch, { capToAvailable: true });
    if (observedDay !== null && observedDay >= 0) {
      const cappedDay = Math.max(0, Math.min(targetDay, observedDay));
      const partial = isProductFilterActive()
        ? aggregateLaunchSalesRows(salesRowsForLaunchDayRange(launch, 0, cappedDay), {
          start_day: 0,
          end_day: cappedDay,
          produto: state.productFilter,
          cor: state.productColorFilter
        })
        : launchRevenueForDayRange(launch, 0, cappedDay);
      const partialData = applyChannelFilterToSalesData(partial);
      if ([partialData.receita, partialData.pedidos, partialData.pares].some((value) => numberOrNull(value) !== null)) {
        return {
          launch,
          key,
          data: {
            ...partialData,
            ticket: ratioOrNull(partialData.receita, partialData.pedidos),
            preco_medio_par: ratioOrNull(partialData.receita, partialData.pares)
          },
          status: cappedDay >= targetDay ? 'calculada' : 'parcial',
          statusLabel: cappedDay >= targetDay ? selectedPeriodLabel() : `D+${fmtNum(cappedDay)} parcial`,
          range: `${fmtDateSlash(d0)} a ${fmtDateSlash(toIsoDate(addDays(d0, cappedDay)))}`,
          observedDay: cappedDay,
          targetDay,
          isPartial: cappedDay < targetDay,
          source: 'vendas parciais do pipeline'
        };
      }
    }

    return {
      launch,
      key,
      data: null,
      status: 'em_maturacao',
      statusLabel: 'em maturacao',
      range: launchWindowRangeLabel(launch, key),
      observedDay,
      targetDay,
      isPartial: true,
      source: 'janela ainda sem venda'
    };
  }

  function acquisitionChannelKey(label) {
    const text = normalizeText(label);
    if (/(paid media|meta ads|google ads|facebook ads|instagram ads|ads|paid|pago)/.test(text)) return 'paid';
    if (/(organico|organic|seo)/.test(text)) return 'organic';
    if (/(crm|email|whatsapp|sms|owned|direto|direct|outro|other|nao atribuido|sem match)/.test(text)) return 'other';
    return 'other';
  }

  function acquisitionChannelRows(acquisition, { applyFilter = true } = {}) {
    const rows = Array.isArray(acquisition?.canais) ? acquisition.canais : [];
    if (!rows.length) return [];
    const mapped = rows.map((row) => ({
      key: acquisitionChannelKey(row.canal),
      label: row.canal || 'Canal',
      receita: numberOrNull(row.receita),
      pedidos: numberOrNull(row.pedidos),
      investimento: numberOrNull(row.investimento),
      source: 'janela_empresa',
      hasData: true
    })).filter((row) => row.receita !== null || row.pedidos !== null || row.investimento !== null);
    return applyFilter && isChannelFilterActive()
      ? mapped.filter((row) => row.key === state.channelFilter)
      : mapped;
  }

  function legacyChannelSummary(acquisition, targetKey) {
    const keys = targetKey === 'investment' ? ['paid'] : [targetKey];
    const rows = acquisitionChannelRows(acquisition, { applyFilter: false })
      .filter((row) => keys.includes(row.key));
    const receita = sumValues(...rows.map((row) => row.receita));
    const pedidos = sumValues(...rows.map((row) => row.pedidos));
    if (receita === null && pedidos === null) return null;
    return {
      key: targetKey,
      label: targetKey === 'investment' ? 'Midia paga' : 'Organico',
      receita,
      pedidos,
      source: 'base_antiga',
      sourceLabel: 'base antiga',
      hasData: true
    };
  }

  function legacyChannelSummariesForSales(acquisition, data = {}) {
    const investment = legacyChannelSummary(acquisition, 'investment');
    const organic = legacyChannelSummary(acquisition, 'organic');
    const total = numberOrNull(data?.receita_total_original)
      ?? numberOrNull(data?.receita_bruta)
      ?? numberOrNull(data?.receita);
    const combined = sumValues(investment?.receita, organic?.receita);
    const tolerance = total !== null ? Math.max(1, Math.abs(total) * 0.02) : null;
    const exceeds = (value) => (
      total !== null
      && numberOrNull(value) !== null
      && Number(value) - total > tolerance
    );
    const impossible = total !== null && (
      exceeds(investment?.receita)
      || exceeds(organic?.receita)
      || (combined !== null && combined - total > tolerance)
    );
    if (impossible) return new Map();
    return new Map([investment, organic].filter(Boolean).map((row) => [row.key, row]));
  }

  function manualChannelSummary(launch, key, targetKey, data = {}) {
    if (!launch || !key) return null;
    const attribution = manualAttributionFallbackForLaunch(launch, key, data);
    if (targetKey === 'investment') {
      if (attribution.receitaInvestimento === null && attribution.pedidosInvestimento === null) return null;
      return {
        key: 'investment',
        label: 'Midia paga',
        receita: attribution.receitaInvestimento,
        pedidos: attribution.pedidosInvestimento,
        source: 'base_manual',
        sourceLabel: 'base manual',
        hasData: true
      };
    }
    if (targetKey === 'organic') {
      if (attribution.receitaOrganica === null && attribution.pedidosOrganicos === null) return null;
      return {
        key: 'organic',
        label: 'Organico',
        receita: attribution.receitaOrganica,
        pedidos: attribution.pedidosOrganicos,
        source: 'base_manual',
        sourceLabel: 'base manual',
        hasData: true
      };
    }
    return null;
  }

  function nonNegativeRoundedRemainder(total, known, precision = 2) {
    const totalValue = numberOrNull(total);
    const knownValue = numberOrNull(known);
    if (totalValue === null || knownValue === null) return null;
    const factor = 10 ** precision;
    const value = Math.round((totalValue - knownValue) * factor) / factor;
    return value < 0 ? 0 : value;
  }

  function nonInvestmentRevenueForData(data, investmentRevenue = null, { assumeAllWhenNoInvestment = false } = {}) {
    const explicit = numberOrNull(data?.receita_organica);
    if (explicit !== null) return explicit;
    const total = numberOrNull(data?.receita_total_original)
      ?? numberOrNull(data?.receita_bruta)
      ?? numberOrNull(data?.receita);
    const remainder = nonNegativeRoundedRemainder(total, investmentRevenue, 2);
    if (remainder !== null) return remainder;
    if (assumeAllWhenNoInvestment && total !== null) return total;
    return numberOrNull(data?.receita_organica);
  }

  function nonInvestmentOrdersForData(data, investmentOrders = null, { assumeAllWhenNoInvestment = false } = {}) {
    const explicit = numberOrNull(data?.pedidos_organicos);
    if (explicit !== null) return explicit;
    const total = numberOrNull(data?.pedidos) ?? numberOrNull(data?.pedidos_validos);
    const remainder = nonNegativeRoundedRemainder(total, investmentOrders, 0);
    if (remainder !== null) return remainder;
    if (assumeAllWhenNoInvestment && total !== null) return total;
    return numberOrNull(data?.pedidos_organicos);
  }

  function hasExplicitOrderAttribution(data = {}) {
    return [
      data.receita_paga,
      data.pedidos_pagos,
      data.receita_organica,
      data.pedidos_organicos,
      data.receita_crm,
      data.pedidos_crm,
      data.receita_sem_match_atribuicao,
      data.pedidos_sem_match_atribuicao,
      data.receita_outros_canais,
      data.pedidos_outros_canais
    ].some((value) => numberOrNull(value) !== null);
  }

  function channelRowsForSalesData(data, acquisition = null, options = {}) {
    const hasOrderAttribution = hasExplicitOrderAttribution(data);
    const receitaInvestimento = numberOrNull(data?.receita_paga);
    const pedidosInvestimento = numberOrNull(data?.pedidos_pagos);
    const paresInvestimento = numberOrNull(data?.pares_pagos);
    const receitaOrganicaBase = hasOrderAttribution ? (numberOrNull(data?.receita_organica) ?? 0) : null;
    const pedidosOrganicosBase = hasOrderAttribution ? (numberOrNull(data?.pedidos_organicos) ?? 0) : null;
    const paresOrganicosBase = hasOrderAttribution ? (numberOrNull(data?.pares_organicos) ?? 0) : null;
    const receitaControles = sumValues(data?.receita_crm, data?.receita_outros_canais, data?.receita_sem_match_atribuicao);
    const pedidosControles = sumValues(data?.pedidos_crm, data?.pedidos_outros_canais, data?.pedidos_sem_match_atribuicao);
    const paresControles = sumValues(data?.pares_crm, data?.pares_outros_canais, data?.pares_sem_match_atribuicao);
    const dataComCrmOrganico = { ...data, receita_organica: receitaOrganicaBase, pedidos_organicos: pedidosOrganicosBase };
    const hasDeclaredInvestment = numberOrNull(options.investmentValue) !== null;
    const assumeAllWhenNoInvestment = options.assumeAllWhenNoInvestment === true && !hasDeclaredInvestment;
    const allowAttributionFallbacks = options.allowAttributionFallbacks === true;
    const legacyRows = allowAttributionFallbacks ? legacyChannelSummariesForSales(acquisition, data) : new Map();
    const rows = [
      { key: 'investment', label: 'Midia paga', receita: receitaInvestimento, pedidos: pedidosInvestimento, pares: paresInvestimento },
      {
        key: 'organic',
        label: 'Organico',
        receita: nonInvestmentRevenueForData(dataComCrmOrganico, receitaInvestimento, { assumeAllWhenNoInvestment }),
        pedidos: nonInvestmentOrdersForData(dataComCrmOrganico, pedidosInvestimento, { assumeAllWhenNoInvestment }),
        pares: paresOrganicosBase
      },
      {
        key: 'other',
        label: 'Controles',
        receita: receitaControles,
        pedidos: pedidosControles,
        pares: paresControles
      }
    ];
    const productRows = rows.map((row) => ({
      ...row,
      hasData: hasOrderAttribution && (row.receita !== null || row.pedidos !== null),
      source: 'produto',
      sourceLabel: assumeAllWhenNoInvestment && row.key === 'organic'
          ? 'sem investimento'
          : 'atrib. pedido'
    }));
    const fallbackRows = productRows.map((row) => {
      if (row.hasData) return row;
      if (row.key === 'investment' && !hasDeclaredInvestment) return row;
      if (!allowAttributionFallbacks) return row;
      return legacyRows.get(row.key)
        || manualChannelSummary(options.launch, options.windowKey || selectedPeriodKey(), row.key, data)
        || row;
    });
    const visibleRows = !options.ignoreFilter && isChannelFilterActive()
      ? fallbackRows.filter((row) => row.key === state.channelFilter || (state.channelFilter === 'paid' && row.key === 'investment'))
      : fallbackRows;
    return visibleRows;
  }

  function channelCoverageForSalesData(data, acquisition = null, options = {}) {
    const rows = channelRowsForSalesData(data, acquisition, options);
    const source = rows.some((row) => row.hasData) ? 'produto' : 'sem_dado';
    const totalReceita = numberOrNull(data?.receita_total_original) ?? numberOrNull(data?.receita);
    const classifiedReceita = rows.reduce((acc, row) => acc + (row.receita || 0), 0);
    const hasAny = rows.some((row) => row.hasData);
    return {
      rows,
      totalReceita,
      classifiedReceita: hasAny ? classifiedReceita : null,
      hasAny,
      source
    };
  }

  function compactChannelBadges(data, acquisition = null) {
    const coverage = channelCoverageForSalesData(data, acquisition);
    if (!coverage.hasAny) return '<span class="channel-pill channel-pill--muted">Canal ainda não exportado</span>';
    return coverage.rows.filter((row) => row.hasData).map((row) => (
      `<span class="channel-pill channel-pill--${row.key}">${escapeHtml(row.label)}</span>`
    )).join('');
  }

  function compactChannelSales(data, acquisition = null) {
    const coverage = channelCoverageForSalesData(data, acquisition);
    if (!coverage.hasAny) return '<span class="cell-muted">Canal ainda não exportado</span>';
    return `
      <div class="compact-channel-stack">
        ${coverage.rows.filter((row) => row.hasData).map((row) => `
          <span><b>${escapeHtml(row.label)}</b> ${fmtBRL(row.receita)}${row.pedidos !== null ? ` · ${fmtNum(row.pedidos)} pedidos` : ''}</span>
        `).join('')}
      </div>
    `;
  }

  function compactChannelParticipation(data, acquisition = null) {
    const coverage = channelCoverageForSalesData(data, acquisition);
    if (!coverage.hasAny || !coverage.totalReceita) return '<span class="cell-muted">Participação ainda não exportada</span>';
    return `
      <div class="compact-channel-stack compact-channel-stack--share">
        ${coverage.rows.filter((row) => row.hasData && row.receita !== null).map((row) => `
          <span><b>${escapeHtml(row.label)}</b> ${fmtPct(row.receita / coverage.totalReceita, 1)}</span>
        `).join('') || '<span class="cell-muted">Sem receita classificada</span>'}
      </div>
    `;
  }

  function compactPaidOrganicCell(data, acquisition = null, channelKey = 'paid', options = {}) {
    const coverage = channelCoverageForSalesData(data, acquisition, options);
    const row = coverage.rows.find((item) => item.key === channelKey && item.hasData);
    if (!row) {
      if (channelKey === 'unmatched') {
        return '<span class="channel-empty">&mdash;</span>';
      }
      const hasDeclaredInvestment = numberOrNull(options.investmentValue) !== null;
      if (channelKey === 'investment' && !hasDeclaredInvestment) {
        return '<span class="channel-empty">—</span>';
      }
      const label = hasDeclaredInvestment ? 'Aguard. origem' : 'Sem dado';
      const tooltip = hasDeclaredInvestment
        ? 'Existe investimento declarado, mas o payload ainda nao trouxe origem real por pedido.'
        : 'Sem venda ou classificacao de canal para esta janela.';
      return `<span class="channel-empty" data-tooltip="${tooltipAttr(tooltip)}">${label}</span>`;
    }
    const pedidos = numberOrNull(row.pedidos);
    const pares = numberOrNull(row.pares);
    const pedidosCopy = pedidos !== null ? `${fmtNum(pedidos)} ${pedidos === 1 ? 'pedido' : 'pedidos'}` : 'sem pedido real';
    const paresCopy = pares !== null && pares !== pedidos
      ? ` &middot; ${fmtNum(pares)} ${pares === 1 ? 'par' : 'pares'}`
      : '';
    return `
      <div class="paid-organic-simple">
        <strong>${fmtBRL(row.receita, true)}</strong>
        <span>${pedidosCopy}${paresCopy}</span>
        ${row.sourceLabel ? `<small>${escapeHtml(row.sourceLabel)}</small>` : ''}
      </div>
    `;
  }

  function comparativeChannelMetricHtml(rows, row, channelKey) {
    const options = {
      launch: row.launch,
      windowKey: selectedPeriodKey(),
      investmentValue: row.investment?.value,
      assumeAllWhenNoInvestment: channelKey === 'organic'
    };
    return `
      <span class="channel-with-signal">
        ${compactPaidOrganicCell(row.sales?.data, row.acquisition, channelKey, options)}
        ${comparisonSignal(rows, row, (item) => compactPaidOrganicValue(
          item.sales?.data,
          item.acquisition,
          channelKey,
          {
            launch: item.launch,
            windowKey: selectedPeriodKey(),
            investmentValue: item.investment?.value,
            assumeAllWhenNoInvestment: channelKey === 'organic'
          }
        ), fmtBRL)}
      </span>
    `;
  }

  function compactPaidOrganicValue(data, acquisition = null, channelKey = 'paid', options = {}) {
    const coverage = channelCoverageForSalesData(data, acquisition, options);
    const row = coverage.rows.find((item) => item.key === channelKey && item.hasData);
    return numberOrNull(row?.receita);
  }

  function closedComparisonRows(rows = []) {
    return rows.filter((row) => !row.sales?.isPartial);
  }

  function comparisonSignal(rows, targetRow, getter, formatter = fmtNum) {
    if (targetRow?.sales?.isPartial) return '';
    const value = numberOrNull(getter(targetRow));
    const values = closedComparisonRows(rows)
      .filter((row) => row !== targetRow)
      .map(getter)
      .map(numberOrNull)
      .filter((item) => item !== null);
    if (value === null || !values.length) return '';
    const average = values.reduce((acc, item) => acc + item, 0) / values.length;
    const diff = average === 0 ? (value === 0 ? 0 : 1) : (value - average) / Math.abs(average);
    const band = Math.abs(diff) <= 0.1 ? 'medium' : diff > 0 ? 'top' : 'bottom';
    const arrow = band === 'top' ? '&uarr;' : band === 'bottom' ? '&darr;' : '&rarr;';
    const label = band === 'top'
      ? 'acima da média'
      : band === 'bottom'
        ? 'abaixo da média'
        : 'próximo da média';
    const tip = `${label}: ${formatter(value)} vs média ${formatter(average)} no grupo filtrado.`;
    return `<span class="metric-signal metric-signal--${band}" data-tooltip="${tooltipAttr(tip)}" aria-label="${escapeHtml(tip)}">${arrow}</span>`;
  }

  function comparativeMetricHtml(rows, row, getter, formatter = fmtNum) {
    const value = numberOrNull(getter(row));
    return `
      <span class="metric-with-signal">
        <span>${formatter(value)}</span>
        ${comparisonSignal(rows, row, getter, formatter)}
      </span>
    `;
  }

  function revenueVsAverageHtml(rows, row) {
    const value = numberOrNull(row.receita);
    if (row.sales?.isPartial) {
      return '<span class="metric-with-signal metric-with-signal--stack"><span class="cell-muted">parcial</span><small>fora da média fechada</small></span>';
    }
    const values = closedComparisonRows(rows)
      .filter((item) => item !== row)
      .map((item) => numberOrNull(item.receita))
      .filter((item) => item !== null);
    if (value === null || !values.length) return '<span class="cell-muted">sem media</span>';
    const average = values.reduce((acc, item) => acc + item, 0) / values.length;
    const delta = average === 0 ? (value === 0 ? 0 : 1) : (value / average) - 1;
    return `
      <span class="metric-with-signal metric-with-signal--stack">
        <span>${fmtPct(delta, 1)}</span>
        ${comparisonSignal(rows, row, (item) => item.receita, fmtBRL)}
        <small>media ${fmtBRL(average, true)}</small>
      </span>
    `;
  }

  function compactInvestmentForLaunch(launch) {
    const rawRows = manualInvestmentRowsForLaunch(launch, selectedPeriodKey(), { capToAvailable: true });
    const value = sumKnown(rawRows, 'investimento');
    const mediaRows = rawRows.filter((row) => row.investment_source === 'midia_paga');
    const crmRows = rawRows.filter((row) => row.investment_source === 'crm_disparos');
    const mediaValue = sumKnown(mediaRows, 'investimento');
    const crmValue = sumKnown(crmRows, 'investimento');
    const source = value === null
      ? 'sem base na planilha'
      : mediaRows.length && crmRows.length
        ? 'midia paga + CRM'
        : mediaRows.length
          ? 'midia paga'
          : 'so CRM; midia sem base';
    return {
      value,
      mediaValue,
      crmValue,
      hasMediaInvestment: mediaValue !== null,
      hasCrmInvestment: crmValue !== null,
      source,
      detail: value !== null ? `${fmtNum(mediaRows.length)} mídia · ${fmtNum(crmRows.length)} CRM` : `sem linha ${selectedPeriodLabel()} em midia_paga/crm_disparos`
    };
  }

  function selectedSalesWindowIsPartial(launch) {
    const targetDay = selectedPeriodEndDay(launch);
    const observedDay = selectedPeriodEndDay(launch, { capToAvailable: true });
    return targetDay !== null && observedDay !== null && observedDay < targetDay;
  }

  function compactHistoricalRows(selected) {
    const launches = filteredComparisonLaunches();
    const rows = launches.map((launch) => {
      const sales = compactSalesWindowForLaunch(launch);
      const data = sales.data || {};
      const acquisition = acquisitionWindowForLaunch(launch, selectedPeriodKey(), { requireClosed: false });
      const investment = compactInvestmentForLaunch(launch);
      const attribution = investmentAttributionForWindow(launch, selectedPeriodKey());
      const channelRows = channelRowsForSalesData(data, acquisition, {
        launch,
        windowKey: selectedPeriodKey(),
        investmentValue: investment.value,
        assumeAllWhenNoInvestment: true,
        ignoreFilter: true
      });
      const investmentChannel = channelRows.find((row) => row.key === 'investment' && row.hasData);
      const organicChannel = channelRows.find((row) => row.key === 'organic' && row.hasData);
      const receitaInvestimento = numberOrNull(investmentChannel?.receita) ?? attribution.receitaInvestimento;
      const pedidosInvestimento = numberOrNull(investmentChannel?.pedidos) ?? attribution.pedidosInvestimento;
      const receitaOrganica = numberOrNull(organicChannel?.receita) ?? attribution.receitaOrganica;
      const pedidosOrganicos = numberOrNull(organicChannel?.pedidos) ?? attribution.pedidosOrganicos;
      const receita = numberOrNull(data.receita);
      const pedidos = numberOrNull(data.pedidos);
      const pares = numberOrNull(data.pares);
      const ticket = ratioOrNull(receita, pedidos);
      const qualityEndDay = sales.observedDay ?? selectedPeriodEndDay(launch, { capToAvailable: true });
      const attributionQuality = qualityEndDay === null || qualityEndDay === undefined
        ? attributionQualityFromRows([], pedidos)
        : attributionQualityFromRows(salesRowsForLaunchDayRange(launch, 0, qualityEndDay), pedidos);
      const canComputeRoas = investment.hasMediaInvestment && !sales.isPartial;
      return {
        launch,
        sales,
        acquisition,
        investment,
        receita,
        pedidos,
        pares,
        ticket,
        roas: canComputeRoas ? ratioOrNull(receitaInvestimento, investment.value) : null,
        receitaInvestimento,
        pedidosInvestimento,
        receitaOrganica,
        pedidosOrganicos,
        attributionQuality,
        isFocus: launch?.modelo_id === selected?.modelo_id
      };
    });
    return rows.sort((a, b) => {
      if (a.isFocus !== b.isFocus) return a.isFocus ? -1 : 1;
      if (a.receita !== null && b.receita !== null) return b.receita - a.receita;
      if (a.receita !== null) return -1;
      if (b.receita !== null) return 1;
      return (a.launch?.order ?? 0) - (b.launch?.order ?? 0);
    });
  }

  function compactLineProductLabel() {
    const colorLabel = state.productColorFilter && state.productColorFilter !== 'all'
      ? productColorFilterOptions().find((item) => item.key === state.productColorFilter)?.label || 'Cor filtrada'
      : '';
    if (isProductFilterActive()) {
      const productLabel = state.productFilter && state.productFilter !== 'all'
        ? productFilterOptions().find((item) => item.key === state.productFilter)?.label || 'Produto filtrado'
        : 'Todos os produtos';
      return colorLabel ? `${productLabel} / ${colorLabel}` : productLabel;
    }
    if (state.lineFilter && state.lineFilter !== 'all') {
      return lineFilterOptions().find((item) => item.key === state.lineFilter)?.label || 'Linha filtrada';
    }
    return null;
  }

  const COMPACT_ROAS_VALIDATION_LIMIT = 20;

  function compactRoasRequiresValidation(row) {
    const roas = numberOrNull(row?.roas);
    return roas !== null && roas > COMPACT_ROAS_VALIDATION_LIMIT;
  }

  function compactOrderOriginMetrics(row) {
    const total = numberOrNull(row?.pedidos);
    const paid = numberOrNull(row?.pedidosInvestimento);
    const organic = numberOrNull(row?.pedidosOrganicos);
    const classified = paid !== null || organic !== null ? Number(paid || 0) + Number(organic || 0) : null;
    const coverage = ratioOrNull(classified, total);
    return {
      total,
      paid,
      organic,
      classified,
      paidShare: ratioOrNull(paid, total),
      organicShare: ratioOrNull(organic, total),
      coverage,
      reconciled: coverage !== null && Math.abs(coverage - 1) <= 0.01,
      quality: row?.attributionQuality || null
    };
  }

  function compactCommercialFarol(row) {
    if (row?.sales?.isPartial) {
      return {
        tone: 'warning',
        label: 'Acompanhar',
        reason: `A janela ainda está parcial em ${row.sales?.statusLabel || selectedPeriodLabel()}. O resultado fica visível, mas fora da decisão de vencedor ou perdedor.`
      };
    }
    if (compactRoasRequiresValidation(row)) {
      return {
        tone: 'warning',
        label: 'Validar base',
        reason: `O ROAS de ${fmtNum(row.roas, 2)}x está acima do limite de controle de ${fmtNum(COMPACT_ROAS_VALIDATION_LIMIT)}x. Confirmar investimento e cobertura de atribuição antes de usar o valor em uma decisão.`
      };
    }
    if (numberOrNull(row?.roas) === null) {
      return {
        tone: 'neutral',
        label: 'Sem base',
        reason: 'Não existe uma base fechada e comparável de mídia paga para classificar o retorno desta janela.'
      };
    }
    if (row.roas < 1) {
      return {
        tone: 'negative',
        label: 'Rever',
        reason: `O retorno atribuído é ${fmtNum(row.roas, 2)}x. A receita paga ainda não recompõe o investimento declarado na janela.`
      };
    }
    if (row.roas < 2) {
      return {
        tone: 'warning',
        label: 'Otimizar',
        reason: `O retorno atribuído é ${fmtNum(row.roas, 2)}x. Há tração, mas a eficiência pede otimização antes de ampliar verba.`
      };
    }
    return {
      tone: 'positive',
      label: 'Favorável',
      reason: `A janela está fechada e o retorno atribuído é ${fmtNum(row.roas, 2)}x, com base de mídia paga disponível.`
    };
  }

  function compactFarolBadge(farol, reason = farol?.reason || '') {
    if (!farol) return '';
    const tooltip = reason
      ? ` tabindex="0" data-tooltip="${tooltipAttr(reason)}" aria-label="${escapeHtml(reason)}"`
      : '';
    return `<span class="commercial-farol commercial-farol--${escapeHtml(farol.tone || 'neutral')}"${tooltip}><i aria-hidden="true"></i>${escapeHtml(farol.label || 'Sem base')}</span>`;
  }

  function compactRoasCellHtml(rows, row) {
    const value = numberOrNull(row?.roas);
    if (value === null) return '<span class="cell-muted">—</span>';
    if (compactRoasRequiresValidation(row)) {
      return `<span class="metric-with-signal metric-with-signal--stack"><span>${fmtNum(value, 2)}x</span><small>validar base</small></span>`;
    }
    const validRows = rows.filter((item) => !compactRoasRequiresValidation(item));
    return comparativeMetricHtml(validRows, row, (item) => item.roas, (item) => item === null ? '—' : `${fmtNum(item, 2)}x`);
  }

  function launchInsightRank(rows, targetRow, field) {
    if (targetRow?.sales?.isPartial) {
      return { rank: null, total: closedComparisonRows(rows).length, status: 'partial' };
    }
    if (field === 'roas' && compactRoasRequiresValidation(targetRow)) {
      return { rank: null, total: closedComparisonRows(rows).filter((row) => !compactRoasRequiresValidation(row) && numberOrNull(row.roas) !== null).length, status: 'validation' };
    }
    const ranked = closedComparisonRows(rows)
      .filter((row) => field !== 'roas' || !compactRoasRequiresValidation(row))
      .filter((row) => numberOrNull(row[field]) !== null)
      .sort((a, b) => Number(b[field] || 0) - Number(a[field] || 0));
    if (ranked.length < 2) {
      return { rank: null, total: ranked.length, status: 'insufficient' };
    }
    const index = ranked.findIndex((row) => row.launch?.modelo_id === targetRow.launch?.modelo_id);
    return index >= 0 ? { rank: index + 1, total: ranked.length, status: 'ranked' } : null;
  }

  function launchInsightRankLabel(rank) {
    if (rank?.status === 'partial') return 'janela parcial, fora do ranking';
    if (rank?.status === 'validation') return 'fora do ranking; validar base';
    if (rank?.status === 'insufficient') return 'sem base fechada suficiente';
    return rank ? `${fmtNum(rank.rank)}º de ${fmtNum(rank.total)}` : 'sem ranking';
  }

  function launchInsightAverage(rows, targetRow, field) {
    if (targetRow?.sales?.isPartial) return null;
    const values = closedComparisonRows(rows)
      .filter((row) => row.launch?.modelo_id !== targetRow.launch?.modelo_id)
      .map((row) => numberOrNull(row[field]))
      .filter((value) => value !== null);
    return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
  }

  function launchInsightDeltaCopy(value, average, formatter = fmtBRL) {
    if (value === null || average === null || average === 0) return 'sem média comparável';
    const delta = (value / average) - 1;
    if (Math.abs(delta) < 0.01) return 'em linha com a média do grupo';
    return `${fmtPct(Math.abs(delta), 1)} ${delta > 0 ? 'acima' : 'abaixo'} da média do grupo (${formatter(average)})`;
  }

  function launchInsightKpi(label, value, detail = '') {
    return `
      <div class="launch-insight-kpi">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    `;
  }

  function launchInsightChannelRows(data, acquisition = null) {
    const channels = [
      { key: 'investment', label: 'Midia paga', receita: ['receita_paga'], pedidos: ['pedidos_pagos'] },
      { key: 'organic', label: 'Organico', receita: ['receita_organica'], pedidos: ['pedidos_organicos'] },
      { key: 'other', label: 'Outros', receita: 'receita_outros_canais', pedidos: 'pedidos_outros_canais' }
    ];
    const rows = channels
      .map((channel) => ({
        ...channel,
        receitaValue: Array.isArray(channel.receita) ? sumValues(...channel.receita.map((field) => data?.[field])) : numberOrNull(data?.[channel.receita]),
        pedidosValue: Array.isArray(channel.pedidos) ? sumValues(...channel.pedidos.map((field) => data?.[field])) : numberOrNull(data?.[channel.pedidos])
      }))
      .filter((channel) => channel.receitaValue !== null || channel.pedidosValue !== null);
    const totalReceita = rows
      .map((channel) => channel.receitaValue)
      .filter((value) => value !== null)
      .reduce((acc, value) => acc + value, 0);
    if (!rows.length) return [];
    return rows.map((channel) => ({
      ...channel,
      source: 'produto',
      share: channel.receitaValue !== null && totalReceita > 0 ? channel.receitaValue / totalReceita : null
    })).sort((a, b) => Number(b.receitaValue || 0) - Number(a.receitaValue || 0));
  }

  function launchInsightProductGroup(launch) {
    const groups = storyAnalysisGroups(launch);
    const group = groups.find((item) => item.key === 'submodelos')
      || groups.find((item) => item.key === 'cores')
      || groups.find((item) => item.key === 'tamanhos')
      || groups[0]
      || null;
    if (!group) return null;
    const rows = group.options
      .map((item) => {
        const metricValue = numberOrNull(item.metricValue) ?? numberOrNull(item.receita) ?? numberOrNull(item.pares);
        return {
          ...item,
          metricValue
        };
      })
      .filter((item) => item.metricValue !== null)
      .sort((a, b) => b.metricValue - a.metricValue);
    const total = rows.reduce((acc, item) => acc + Number(item.metricValue || 0), 0);
    return {
      label: group.label,
      rows: rows.slice(0, 5),
      total
    };
  }

  function launchInsightMetricText(item) {
    const value = numberOrNull(item?.metricValue);
    if (value === null) return '—';
    if (item?.metricType === 'num') return `${fmtNum(value)} pares`;
    return storyFormatMetric(value, item?.metricType || 'brl');
  }

  function launchComparisonScopeHtml(rows, activeRow) {
    const closedRows = closedComparisonRows(rows).filter((row) => row.receita !== null);
    const partialRows = rows.filter((row) => row.sales?.isPartial && row.receita !== null);
    const activeState = activeRow?.sales?.isPartial
      ? 'A linha selecionada está parcial e não entra no ranking conclusivo.'
      : 'A linha selecionada participa do ranking de janelas fechadas.';
    return `
      <div class="launch-comparison-method">
        <div>
          <span>Janela comum</span>
          <strong>${escapeHtml(selectedPeriodLabel())}</strong>
          <small>Cada lançamento parte do próprio D0.</small>
        </div>
        <div>
          <span>Base ranqueada</span>
          <strong>${fmtNum(closedRows.length)} de ${fmtNum(rows.length)}</strong>
          <small>${partialRows.length ? `${fmtNum(partialRows.length)} parcial${partialRows.length === 1 ? '' : 'is'} fora do ranking.` : 'Todas as janelas estão fechadas.'}</small>
        </div>
        <div>
          <span>Critério de escala</span>
          <strong>Faturamento bruto</strong>
          <small>Pedidos, pares e ticket explicam a posição.</small>
        </div>
        <div>
          <span>Critério de eficiência</span>
          <strong>ROAS atribuído</strong>
          <small>Receita paga ÷ investimento da mesma janela.</small>
        </div>
      </div>
      <p class="launch-comparison-method-note">${escapeHtml(activeState)} Ranking não prova causalidade entre campanha e venda.</p>
    `;
  }

  function launchInsightEvidenceHtml(row, rows) {
    const revenueRank = launchInsightRank(rows, row, 'receita');
    const paidShare = ratioOrNull(row.receitaInvestimento, row.receita);
    const organicShare = ratioOrNull(row.receitaOrganica, row.receita);
    const peerPaidShares = closedComparisonRows(rows)
      .filter((item) => item !== row)
      .map((item) => ratioOrNull(item.receitaInvestimento, item.receita))
      .filter((value) => value !== null);
    const peerPaidAverage = peerPaidShares.length
      ? peerPaidShares.reduce((acc, value) => acc + value, 0) / peerPaidShares.length
      : null;
    const bestProductGroup = launchInsightProductGroup(row.launch);
    const bestProduct = bestProductGroup?.rows?.[0] || null;
    const bestProductShare = bestProduct && bestProductGroup?.total
      ? bestProduct.metricValue / bestProductGroup.total
      : null;
    const facts = [
      `${fmtBRL(row.receita)} de faturamento; ${launchInsightRankLabel(revenueRank)} entre janelas fechadas.`,
      `${fmtNum(row.pedidos)} pedidos, ${fmtNum(row.pares)} pares e ticket médio de ${fmtBRL(row.ticket)}.`,
      paidShare !== null || organicShare !== null
        ? `Mix atribuído: ${paidShare === null ? 'mídia sem dado' : `${fmtPct(paidShare, 1)} mídia paga`} e ${organicShare === null ? 'orgânico sem dado' : `${fmtPct(organicShare, 1)} orgânico`}.`
        : 'O pedido não trouxe composição de mídia paga e orgânico para esta janela.',
      numberOrNull(row.investment?.value) === null
        ? 'Não existe investimento cadastrado para esta linha na janela selecionada.'
        : `${fmtBRL(row.investment.value)} de investimento (${row.investment.source}); ${row.roas === null ? 'ROAS ainda não comparável' : `ROAS de ${fmtNum(row.roas, 2)}x`}.`,
      bestProduct
        ? `${bestProduct.label} lidera o recorte interno${bestProductShare === null ? '' : ` com ${fmtPct(bestProductShare, 1)} do total analisado`}.`
        : 'Sem recorte interno suficiente para apontar um produto líder.'
    ];
    const hypotheses = [];
    if (row.sales?.isPartial) {
      hypotheses.push(`A posição atual pode mudar até o fechamento de ${selectedPeriodLabel()}; não tratar o parcial como vencedor ou perdedor.`);
    }
    if (paidShare !== null && peerPaidAverage !== null && Math.abs(paidShare - peerPaidAverage) >= 0.08) {
      hypotheses.push(
        paidShare > peerPaidAverage
          ? `A escala pode estar mais dependente de mídia paga: ${fmtPct(paidShare, 1)} da receita vs ${fmtPct(peerPaidAverage, 1)} nos pares. Validar por origem e campanha.`
          : `A força relativa pode estar mais ligada ao orgânico: mídia paga representa ${fmtPct(paidShare, 1)} vs ${fmtPct(peerPaidAverage, 1)} nos pares. Validar direto, busca e CRM.`
      );
    }
    if (bestProduct && bestProductShare !== null) {
      hypotheses.push(
        bestProductShare >= 0.55
          ? `O desempenho pode estar concentrado em ${bestProduct.label}; verificar se as demais cores e submodelos sustentam a curva.`
          : `O mix parece mais distribuído; verificar se essa diversidade melhora a sustentação após o pico inicial.`
      );
    }
    if (row.roas !== null) {
      const peerRoas = closedComparisonRows(rows)
        .filter((item) => item !== row)
        .map((item) => numberOrNull(item.roas))
        .filter((value) => value !== null);
      const averageRoas = peerRoas.length ? peerRoas.reduce((acc, value) => acc + value, 0) / peerRoas.length : null;
      if (averageRoas !== null && Math.abs((row.roas / averageRoas) - 1) >= 0.15) {
        hypotheses.push(
          row.roas > averageRoas
            ? `A eficiência de mídia pode explicar parte da posição: ${fmtNum(row.roas, 2)}x vs ${fmtNum(averageRoas, 2)}x no grupo. Confirmar com margem e CMV.`
            : `A eficiência de mídia pode estar pressionando o resultado: ${fmtNum(row.roas, 2)}x vs ${fmtNum(averageRoas, 2)}x no grupo. Revisar mix, criativo e canal.`
        );
      }
    }
    if (!hypotheses.length) {
      hypotheses.push('A base atual não mostra uma diferença forte o bastante para sustentar uma hipótese; aprofundar produto, canal e campanha antes de concluir.');
    }
    const list = (items) => `<ul>${items.slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
    return `
      <div class="launch-evidence-board">
        <div class="launch-evidence-column launch-evidence-column--fact">
          <div class="launch-evidence-head"><span>Fato</span><strong>O que os dados mostram</strong></div>
          ${list(facts)}
        </div>
        <div class="launch-evidence-column launch-evidence-column--hypothesis">
          <div class="launch-evidence-head"><span>Hipótese</span><strong>O que precisa ser validado</strong></div>
          ${list(hypotheses)}
        </div>
      </div>
    `;
  }

  function launchInsightLineRankingHtml(rows, activeRow) {
    const ranked = closedComparisonRows(rows)
      .filter((row) => row.receita !== null)
      .sort((a, b) => Number(b.receita || 0) - Number(a.receita || 0))
      .slice(0, 6);
    const partialRows = rows
      .filter((row) => row.sales?.isPartial && row.receita !== null)
      .sort((a, b) => Number(b.receita || 0) - Number(a.receita || 0));
    if (!ranked.length && !partialRows.length) {
      return '<p class="launch-muted">Sem faturamento suficiente para comparar as linhas.</p>';
    }
    const max = Math.max(...ranked.map((row) => Number(row.receita || 0)), 1);
    const rankedHtml = ranked.length >= 2 ? ranked.map((row, index) => {
      const active = row.launch?.modelo_id === activeRow.launch?.modelo_id;
      const width = Math.max(4, Math.min(100, (Number(row.receita || 0) / max) * 100));
      const investment = numberOrNull(row.investment?.value);
      const peers = ranked.filter((item) => item !== row);
      const peerAverage = peers.length
        ? peers.reduce((acc, item) => acc + Number(item.receita || 0), 0) / peers.length
        : null;
      const delta = peerAverage && row.receita !== null ? (row.receita / peerAverage) - 1 : null;
      const detail = [
        `${fmtNum(row.pedidos)} pedidos`,
        `${fmtNum(row.pares)} pares`,
        investment === null ? 'sem investimento' : `invest. ${fmtBRL(investment, true)}`,
        row.roas === null ? 'sem retorno' : `retorno ${fmtNum(row.roas, 2)}x`,
        delta === null ? '' : `${delta >= 0 ? '+' : ''}${fmtPct(delta, 1)} vs média`
      ].filter(Boolean).join(' · ');
      return `
        <div class="launch-insight-rank-row ${active ? 'is-active' : ''}">
          <div>
            <strong>${fmtNum(index + 1)}º ${escapeHtml(row.launch?.modelo || '—')}</strong>
            <span>${escapeHtml(`${row.sales?.statusLabel || selectedPeriodLabel()} · ${detail}`)}</span>
          </div>
          <b>${fmtBRL(row.receita, true)}</b>
          <div class="launch-insight-bar"><span style="width:${width.toFixed(1)}%"></span></div>
        </div>
      `;
    }).join('') : '<p class="launch-muted">Menos de duas janelas fechadas; ainda não há ranking conclusivo.</p>';
    const partialHtml = partialRows.length ? `
      <div class="launch-insight-partial-group">
        <div class="launch-insight-subtitle">Em acompanhamento, fora do ranking</div>
        ${partialRows.map((row) => `
          <div class="launch-insight-partial-row ${row.launch?.modelo_id === activeRow.launch?.modelo_id ? 'is-active' : ''}">
            <span><strong>${escapeHtml(row.launch?.modelo || '—')}</strong><small>${escapeHtml(row.sales?.statusLabel || 'janela parcial')}</small></span>
            <b>${fmtBRL(row.receita, true)}</b>
          </div>
        `).join('')}
      </div>
    ` : '';
    return `
      <div class="launch-insight-subtitle">Ranking por faturamento · janelas fechadas</div>
      ${rankedHtml}
      ${partialHtml}
    `;
  }

  function launchInsightProductHtml(row) {
    const group = launchInsightProductGroup(row.launch);
    if (!group || !group.rows.length) {
      return '<p class="launch-muted">Sem recorte interno confiável para esta linha na janela atual.</p>';
    }
    const max = Math.max(...group.rows.map((item) => Number(item.metricValue || 0)), 1);
    return `
      <div class="launch-insight-subtitle">${escapeHtml(group.label)} que mais puxaram a janela</div>
      ${group.rows.map((item, index) => {
        const share = group.total > 0 ? item.metricValue / group.total : null;
        const width = Math.max(4, Math.min(100, (Number(item.metricValue || 0) / max) * 100));
        const value = launchInsightMetricText(item);
        const detail = item.receita !== null && item.metricType !== 'brl'
          ? `${fmtBRL(item.receita, true)} em receita`
          : item.pares !== null
            ? `${fmtNum(item.pares)} pares`
            : '';
        return `
          <div class="launch-insight-rank-row">
            <div>
              <strong>${fmtNum(index + 1)}º ${escapeHtml(item.label)}</strong>
              <span>${share === null ? 'sem participação' : `${fmtPct(share, 1)} do recorte`}${detail ? ` · ${escapeHtml(detail)}` : ''}</span>
            </div>
            <b>${escapeHtml(value)}</b>
            <div class="launch-insight-bar"><span style="width:${width.toFixed(1)}%"></span></div>
          </div>
        `;
      }).join('')}
    `;
  }

  function launchInsightChannelsHtml(row) {
    const channels = launchInsightChannelRows(row.sales?.data, row.acquisition);
    if (!channels.length) {
      return `
        <div class="launch-insight-empty">
          <strong>Atribuição por pedido ainda não chegou</strong>
          <span>Investimento e orgânico só aparecem quando a mirror casar cada pedido com o canal real. Até lá, o dashboard não usa canal agregado da empresa como substituto.</span>
        </div>
      `;
    }
    return `
      ${channels.map((channel) => `
        <div class="launch-insight-channel-row">
          <strong>${escapeHtml(channel.label)}</strong>
          <span>${fmtBRL(channel.receitaValue)} · ${fmtNum(channel.pedidosValue)} pedidos</span>
          <b>${channel.share === null ? '—' : fmtPct(channel.share, 1)}</b>
        </div>
      `).join('')}
    `;
  }

  function launchInsightCommercialRows(launch) {
    const mediaRowsRaw = mediaRowsForInvestmentWindow(launch, selectedPeriodKey())
      .map((item) => normalizeMediaRow(item, launch));
    const mediaRows = enrichMediaEstimates(mediaRowsRaw, launch)
      .sort((a, b) => commercialWindowRank(commercialWindowKey(a)) - commercialWindowRank(commercialWindowKey(b)));
    const crmRows = optionalRows('crm_disparos')
      .filter((item) => item.modelo_id === launch?.modelo_id)
      .filter((item) => crmRowMatchesSelectedPeriod(item, launch))
      .map((item) => ({ ...normalizeCrmRow(item), modelo_id: launch.modelo_id, modelo: launch.modelo }))
      .sort((a, b) => String(a.data_disparo || a.data || '').localeCompare(String(b.data_disparo || b.data || '')));
    return { mediaRows, crmRows };
  }

  function launchInsightCommercialLine(type, title, value, detail = '', badgeText = '') {
    return `
      <div class="launch-insight-commercial-row">
        <span>${escapeHtml(type)}</span>
        <strong>${escapeHtml(title)}</strong>
        <b>${escapeHtml(value)}</b>
        ${badgeText ? `<em>${escapeHtml(badgeText)}</em>` : ''}
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    `;
  }

  function launchCampaignComparisonHtml(rows, activeRow) {
    const campaignRows = rows.map((row) => {
      const { mediaRows, crmRows } = launchInsightCommercialRows(row.launch);
      const mediaCampaigns = new Set(mediaRows
        .map((item) => `${normalizeText(item.campanha)}|${normalizeText(item.canal)}`)
        .filter((key) => key !== '|'));
      return {
        row,
        mediaCount: mediaCampaigns.size || mediaRows.length,
        crmCount: crmRows.length,
        mediaValue: numberOrNull(row.investment?.mediaValue),
        crmValue: numberOrNull(row.investment?.crmValue),
        totalValue: numberOrNull(row.investment?.value)
      };
    }).filter((item) => item.totalValue !== null || item.mediaCount || item.crmCount);
    if (!campaignRows.length) {
      return '<p class="launch-muted">Nenhum lançamento do grupo possui campanha ou investimento cadastrado nesta janela.</p>';
    }
    const maxInvestment = Math.max(...campaignRows.map((item) => Number(item.totalValue || 0)), 1);
    return `
      <div class="launch-campaign-comparison">
        <div class="launch-campaign-comparison-head">
          <strong>Composição das campanhas no grupo</strong>
          <span>A verba é somada na mesma janela D+ de cada lançamento. Linhas parciais usam somente o período disponível. Receita e ROAS permanecem consolidados no lançamento, não em cada campanha individual.</span>
        </div>
        <div class="launch-campaign-comparison-list">
          ${campaignRows.map((item) => {
            const active = item.row.launch?.modelo_id === activeRow.launch?.modelo_id;
            const width = item.totalValue === null ? 0 : Math.max(4, Math.min(100, (item.totalValue / maxInvestment) * 100));
            const countDetail = [
              item.mediaCount ? `${fmtNum(item.mediaCount)} linha${item.mediaCount === 1 ? '' : 's'} de mídia` : '',
              item.crmCount ? `${fmtNum(item.crmCount)} disparo${item.crmCount === 1 ? '' : 's'} CRM` : '',
              item.row.sales?.isPartial ? item.row.sales.statusLabel : ''
            ].filter(Boolean).join(' · ') || 'sem ações detalhadas';
            return `
              <div class="launch-campaign-comparison-row ${active ? 'is-active' : ''}">
                <div class="launch-campaign-model">
                  <strong>${escapeHtml(item.row.launch?.modelo || '—')}</strong>
                  <small>${escapeHtml(countDetail)}</small>
                </div>
                <div class="launch-campaign-mix">
                  <span>Mídia <b>${fmtBRL(item.mediaValue, true)}</b></span>
                  <span>CRM <b>${fmtBRL(item.crmValue, true)}</b></span>
                  <i><b style="width:${width.toFixed(1)}%"></b></i>
                </div>
                <div class="launch-campaign-result">
                  <strong>${fmtBRL(item.totalValue, true)}</strong>
                  <small>${item.row.roas === null ? (item.row.sales?.isPartial ? 'ROAS aguarda fechamento' : 'ROAS sem base') : `${fmtNum(item.row.roas, 2)}x ROAS`}</small>
                </div>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
  }

  function launchInsightCommercialHtml(row, rows = []) {
    const { mediaRows, crmRows } = launchInsightCommercialRows(row.launch);
    const comparisonHtml = launchCampaignComparisonHtml(rows.length ? rows : [row], row);
    const mediaHtml = mediaRows.slice(0, 5).map((item) => {
      const trusted = hasTrustedMediaPerformance(item);
      const revenue = trusted ? numberOrNull(item.receita_atribuida) : null;
      const roas = trusted ? rowRoas(item) : null;
      const detail = [
        `janela ${commercialWindowLabel(commercialWindowKey(item))}`,
        `canal ${item.canal || 'sem canal'}`,
        revenue !== null ? `receita ${fmtBRL(revenue)}` : 'sem receita atribuída',
        roas !== null ? `retorno ${fmtNum(roas, 2)}x` : ''
      ].filter(Boolean).join(' · ');
      return launchInsightCommercialLine('Investimento', item.campanha || 'Campanha sem nome', fmtBRL(item.investimento), detail, trusted ? 'com atribuição' : 'declarado');
    }).join('');
    const crmHtml = crmRows.slice(0, 5).map((item) => {
      const trusted = hasTrustedCrmPerformance(item);
      const revenue = trusted ? numberOrNull(item.receita_base) : null;
      const roas = trusted ? rowRoas(item) : null;
      const date = fmtDate(item.data_disparo || item.data || item.date);
      const detail = [
        date !== '—' ? date : '',
        item.canal || 'CRM',
        revenue !== null ? `receita ${fmtBRL(revenue)}` : 'sem atribuição real',
        roas !== null ? `retorno ${fmtNum(roas, 2)}x` : ''
      ].filter(Boolean).join(' · ');
      return launchInsightCommercialLine('CRM', item.campanha || item.disparo || 'Disparo sem nome', fmtBRL(item.investimento), detail, trusted ? 'com atribuição' : 'contexto');
    }).join('');
    const declaredInvestment = numberOrNull(row.investment?.value);
    const investmentHtml = declaredInvestment !== null ? `
      <div class="launch-insight-acquisition-summary">
        <span>Investimento total declarado</span>
        <strong>${fmtBRL(declaredInvestment)}</strong>
        <small>${escapeHtml(`${selectedPeriodLabel()} · midia_paga.json + crm_disparos.json`)}</small>
      </div>
    ` : '';

    if (!mediaRows.length && !crmRows.length && !investmentHtml) {
      return `${comparisonHtml}<p class="launch-muted">Sem investimento declarado para a linha selecionada nesta janela.</p>`;
    }
    return `
      ${comparisonHtml}
      <div class="launch-selected-campaign-detail">
        <div class="launch-insight-subtitle">Detalhe de ${escapeHtml(row.launch?.modelo || 'linha selecionada')}</div>
        ${investmentHtml}
        ${mediaHtml || '<p class="launch-muted">Sem investimento de campanha declarado para esta linha.</p>'}
        ${crmHtml || '<p class="launch-muted">Sem disparo declarado para esta linha.</p>'}
      </div>
    `;
  }

  function launchRowInsightDrawerHtml(row, rows) {
    const revenueRank = launchInsightRank(rows, row, 'receita');
    const ordersRank = launchInsightRank(rows, row, 'pedidos');
    const pairsRank = launchInsightRank(rows, row, 'pares');
    const roasRank = launchInsightRank(rows, row, 'roas');
    const avgRevenue = launchInsightAverage(rows, row, 'receita');
    const avgOrders = launchInsightAverage(rows, row, 'pedidos');
    const origin = compactOrderOriginMetrics(row);
    const farol = compactCommercialFarol(row);
    const shareRows = row.sales?.isPartial ? rows : closedComparisonRows(rows);
    const shareTotal = ratioOrNull(row.receita, shareRows.reduce((acc, item) => acc + Number(item.receita || 0), 0));
    const statusCopy = row.sales?.isPartial
      ? `Janela ainda parcial: leitura disponível até ${escapeHtml(row.sales.statusLabel)}.`
      : `Janela fechada em ${escapeHtml(row.sales.statusLabel)}.`;

    return `
      <div class="launch-row-drawer-head">
        <div>
          <div class="launch-row-drawer-eyebrow">
            <span class="launch-card-kicker">Leitura da linha selecionada</span>
            ${compactFarolBadge(farol)}
          </div>
          <h4>${escapeHtml(row.launch?.modelo || 'Linha selecionada')}</h4>
          <p>${escapeHtml(statusCopy)} Faturamento ${launchInsightRankLabel(revenueRank)} e pedidos ${launchInsightRankLabel(ordersRank)} no grupo comparado.</p>
        </div>
        <button type="button" class="launch-row-drawer-close" data-launch-insight-close aria-label="Fechar leitura da linha">&times;</button>
      </div>

      <div class="launch-row-kpis">
        ${launchInsightKpi('Faturamento', fmtBRL(row.receita), `${launchInsightDeltaCopy(row.receita, avgRevenue, fmtBRL)}`)}
        ${launchInsightKpi('Pedidos', fmtNum(row.pedidos), `${launchInsightDeltaCopy(row.pedidos, avgOrders, fmtNum)}`)}
        ${launchInsightKpi('Pedidos pagos', fmtNum(origin.paid), origin.paidShare === null ? 'origem não disponível' : `${fmtPct(origin.paidShare, 1)} do total`)}
        ${launchInsightKpi('Pedidos orgânicos', fmtNum(origin.organic), origin.organicShare === null ? 'origem não disponível' : `${fmtPct(origin.organicShare, 1)} do total`)}
        ${launchInsightKpi('Pares', fmtNum(row.pares), `posição ${launchInsightRankLabel(pairsRank)}`)}
        ${launchInsightKpi('Investimento', fmtBRL(row.investment?.value), row.investment?.source || 'sem investimento')}
        ${launchInsightKpi('ROAS', row.roas === null ? '—' : `${fmtNum(row.roas, 2)}x`, launchInsightRankLabel(roasRank))}
        ${launchInsightKpi('Peso no grupo', shareTotal === null ? '—' : fmtPct(shareTotal, 1), row.sales?.isPartial ? 'parcial; fora do ranking' : 'janelas fechadas')}
      </div>

      <div class="launch-row-insight-grid">
        <div class="launch-row-insight-section launch-row-insight-section--method">
          <h5>Como o comparativo foi feito</h5>
          ${launchComparisonScopeHtml(rows, row)}
        </div>
        <div class="launch-row-insight-section launch-row-insight-section--evidence">
          <h5>Fatos e hipóteses</h5>
          ${launchInsightEvidenceHtml(row, rows)}
        </div>
        <div class="launch-row-insight-section launch-row-insight-section--comparison">
          <h5>Comparação entre lançamentos</h5>
          ${launchInsightLineRankingHtml(rows, row)}
        </div>
        <div class="launch-row-insight-section launch-row-insight-section--product">
          <h5>Produtos dentro da linha</h5>
          ${launchInsightProductHtml(row)}
        </div>
        <div class="launch-row-insight-section launch-row-insight-section--channel">
          <h5>Vendas por canal</h5>
          ${launchInsightChannelsHtml(row)}
        </div>
        <div class="launch-row-insight-section launch-row-insight-section--wide">
          <h5>Comparativo de campanhas, investimento e CRM</h5>
          ${launchInsightCommercialHtml(row, rows)}
        </div>
      </div>
    `;
  }

  function closeLaunchRowInsightDrawer() {
    document.querySelectorAll('.launch-row-drawer-row').forEach((row) => {
      row.hidden = true;
      row.querySelector('.launch-row-drawer')?.replaceChildren();
    });
    document.querySelectorAll('.launch-main-table tbody tr[data-launch-insight]').forEach((row) => {
      row.classList.remove('is-selected');
      row.setAttribute('aria-expanded', 'false');
    });
  }

  function openLaunchRowInsightDrawer(modelId) {
    if (!modelId) return;
    const selected = state.launches.find((launch) => launch.modelo_id === state.primaryModelId) || comparableLaunches()[0] || state.launches[0];
    const rows = compactHistoricalRows(selected);
    const row = rows.find((item) => item.launch?.modelo_id === modelId);
    if (!row) return;
    const drawerRow = [...document.querySelectorAll('.launch-row-drawer-row')]
      .find((item) => item.dataset.launchInsightPanel === modelId);
    const drawer = drawerRow?.querySelector('.launch-row-drawer');
    if (!drawerRow || !drawer) return;

    if (!drawerRow.hidden) {
      closeLaunchRowInsightDrawer();
      return;
    }

    closeLaunchRowInsightDrawer();
    drawer.innerHTML = launchRowInsightDrawerHtml(row, rows);
    drawerRow.hidden = false;
    document.querySelectorAll('.launch-main-table tbody tr[data-launch-insight]').forEach((tableRow) => {
      const active = tableRow.dataset.launchInsight === modelId;
      tableRow.classList.toggle('is-selected', active);
      tableRow.setAttribute('aria-expanded', String(active));
    });
    drawerRow.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function compactHistoricalTable(rows) {
    if (!rows.length) {
      return `<div class="empty-state"><div><strong>Nenhum lançamento selecionado.</strong>Marque ao menos uma linha no grupo de comparação.</div></div>`;
    }
    const periodCell = (row) => {
      const label = selectedPeriodLabel();
      const detail = row.sales?.isPartial && row.sales?.observedDay !== null && row.sales?.observedDay !== undefined
        ? `parcial até D+${fmtNum(row.sales.observedDay)}`
        : row.sales?.status === 'em_maturacao'
          ? 'em maturação'
          : 'janela analisada';
      const range = row.sales?.range ? ` data real: ${row.sales.range}` : '';
      return `
        <td class="period-cell" data-tooltip="${tooltipAttr(`${label}; ${detail}.${range}`)}">
          <strong>${escapeHtml(label)}</strong>
          <small>${escapeHtml(detail)}</small>
        </td>
      `;
    };
    return `
      <div class="launch-table-wrap">
        <table class="launch-main-table">
          <thead>
            <tr>
              ${thTip('Lançamento', 'Linha comparada. O destaque visual só aparece se ela estiver dentro do filtro comparativo.')}
              ${thTip('Farol', 'Leitura comercial da janela: favorável, otimizar, rever, acompanhar janela parcial, validar valor fora da curva ou sem base.')}
              ${thTip('Linha ou recorte', 'Nome da linha/produto usada no cadastro do lançamento.')}
              ${thTip('Período', 'Janela usada para este lançamento. Cada linha usa seu próprio D0; se estiver em maturação, aparece parcial.')}
              ${thTip('Pedidos', 'Pedidos aprovados do produto na janela selecionada. Fonte: pipeline de vendas; a base de investimento não altera pedidos.', 'num')}
              ${thTip('Pares', 'Pares vendidos do produto na mesma janela desde o D0.', 'num')}
              ${thTip('Faturamento', 'Receita do produto na janela selecionada. Linhas em maturacao mostram o parcial disponivel.', 'num')}
              ${thTip('Ticket medio', 'Faturamento dividido por pedidos na janela filtrada.', 'num')}
              ${thTip('Investimento', 'Investimento vem da planilha principal: midia_paga + crm_disparos. A planilha diaria nao preenche mais este numero.', 'num')}
              ${thTip('Mídia paga', 'Receita e pedidos com sinais de anuncio, como cpc, pmax, paid, demand-gen, performance, ads, display ou source_type pago.')}
              ${thTip('Orgânico', 'Receita e pedidos classificados como WhatsApp Organico, E-mail, Direto, Social, Organico ou Outros.')}
              ${thTip('ROAS', 'Receita dos pedidos de midia paga dividida pelo investimento declarado na janela. So calcula quando existe midia paga cadastrada na mesma janela; CRM sozinho nao vira denominador de ROAS.', 'num')}
              ${thTip('Fat. vs média', 'Quanto o faturamento ficou acima ou abaixo da média dos outros lançamentos no grupo filtrado. A célula mostra a média usada na comparação.', 'num')}
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr class="${row.isFocus ? 'is-focus' : ''} ${row.sales.isPartial ? 'is-partial' : ''}" data-launch-insight="${escapeHtml(row.launch.modelo_id)}" tabindex="0" role="button" aria-controls="launch-row-drawer-${escapeHtml(row.launch.modelo_id)}" aria-expanded="false">
                <td class="model-name">
                  ${escapeHtml(row.launch.modelo)}
                  <small>${escapeHtml(row.sales.statusLabel)}</small>
                </td>
                <td class="launch-farol-cell">${compactFarolBadge(compactCommercialFarol(row))}</td>
                <td>${escapeHtml(compactLineProductLabel() || row.launch.linha || row.launch.modelo || '-')}</td>
                ${periodCell(row)}
                <td class="num">${comparativeMetricHtml(rows, row, (item) => item.pedidos, fmtNum)}</td>
                <td class="num">${comparativeMetricHtml(rows, row, (item) => item.pares, fmtNum)}</td>
                <td class="num">${comparativeMetricHtml(rows, row, (item) => item.receita, fmtBRL)}</td>
                <td class="num">${comparativeMetricHtml(rows, row, (item) => item.ticket, fmtBRL)}</td>
                <td class="num">
                  ${comparativeMetricHtml(rows, row, (item) => item.investment?.value, fmtBRL)}
                  <small>${escapeHtml(row.investment.source)}</small>
                </td>
                <td>${comparativeChannelMetricHtml(rows, row, 'investment')}</td>
                <td>${comparativeChannelMetricHtml(rows, row, 'organic')}</td>
                <td class="num">${compactRoasCellHtml(rows, row)}</td>
                <td class="num">${revenueVsAverageHtml(rows, row)}</td>
              </tr>
              <tr class="launch-row-drawer-row" data-launch-insight-panel="${escapeHtml(row.launch.modelo_id)}" hidden>
                <td colspan="13">
                  <div class="launch-row-drawer" id="launch-row-drawer-${escapeHtml(row.launch.modelo_id)}"></div>
                </td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function compactKpi(label, value, detail = '') {
    return `
      <div class="launch-kpi">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(value)}</strong>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    `;
  }

  function compactOrderOriginSummary(rows) {
    const sumKnown = (values) => {
      const known = values.filter((value) => value !== null && value !== undefined);
      return known.length ? known.reduce((acc, value) => acc + Number(value || 0), 0) : null;
    };
    const metrics = rows.map(compactOrderOriginMetrics);
    const total = sumKnown(metrics.map((item) => item.total));
    const paid = sumKnown(metrics.map((item) => item.paid));
    const organic = sumKnown(metrics.map((item) => item.organic));
    const classified = paid !== null || organic !== null ? Number(paid || 0) + Number(organic || 0) : null;
    const coverage = ratioOrNull(classified, total);
    const granularOrders = sumKnown(metrics.map((item) => item.quality?.granularOrders));
    const allocatedOrders = sumKnown(metrics.map((item) => item.quality?.allocatedOrders));
    const granularPct = ratioOrNull(granularOrders, total);
    const allocatedPct = ratioOrNull(allocatedOrders, total);
    const qualityFarol = attributionQualityMeta(granularPct, allocatedPct);
    const reconciled = coverage !== null && Math.abs(coverage - 1) <= 0.01;
    const farol = coverage === null
      ? { tone: 'neutral', label: 'Sem origem' }
      : reconciled
        ? { tone: 'positive', label: 'Conciliado' }
        : coverage >= .9 && coverage <= 1.1
          ? { tone: 'warning', label: 'Revisar saldo' }
          : { tone: 'negative', label: 'Origem divergente' };
    const reason = coverage === null
      ? 'A janela selecionada não trouxe pedidos classificados por origem.'
      : `Pedidos pagos mais orgânicos representam ${fmtPct(coverage, 1)} dos ${fmtNum(total)} pedidos exibidos. O farol fica verde quando a diferença é de até 1%; isso valida a soma binária, não a cobertura de origem granular.`;
    return `
      <div class="launch-origin-summary">
        <div class="launch-origin-summary-intro">
          <span>Origem dos pedidos</span>
          <strong>Pago versus orgânico</strong>
          <small>Midia paga = sinais de anuncio como cpc, pmax, paid, demand-gen e performance. Organico = busca/social/SEO organico; controles ficam separados.</small>
        </div>
        <div class="launch-origin-metric launch-origin-metric--paid">
          <span>Pedidos pagos</span>
          <strong>${fmtNum(paid)}</strong>
          <small>${ratioOrNull(paid, total) === null ? 'sem participação' : `${fmtPct(ratioOrNull(paid, total), 1)} do total`}</small>
        </div>
        <div class="launch-origin-metric launch-origin-metric--organic">
          <span>Pedidos orgânicos</span>
          <strong>${fmtNum(organic)}</strong>
          <small>${ratioOrNull(organic, total) === null ? 'sem participação' : `${fmtPct(ratioOrNull(organic, total), 1)} do total`}</small>
        </div>
        <div class="launch-origin-check">
          <span>Conciliação binária</span>
          ${compactFarolBadge(farol, reason)}
          <small>${coverage === null ? 'sem cobertura calculável' : `${fmtNum(classified)} de ${fmtNum(total)} pedidos classificados`}</small>
        </div>
        <div class="launch-origin-check">
          <span>Qualidade da origem</span>
          ${compactFarolBadge(qualityFarol, qualityFarol.reason)}
          <small>${granularPct === null ? 'sem leitura granular' : `${fmtPct(granularPct, 1)} granular / ${fmtPct(allocatedPct, 1)} alocado`}</small>
        </div>
      </div>
    `;
  }

  function pickMetricRow(rows, getter, direction = 'desc') {
    const candidates = rows
      .map((row) => ({ row, value: numberOrNull(getter(row)) }))
      .filter((item) => item.value !== null);
    if (!candidates.length) return null;
    candidates.sort((a, b) => direction === 'asc' ? a.value - b.value : b.value - a.value);
    return candidates[0];
  }

  function productPerformanceCandidates(rows) {
    const candidates = [];
    rows.forEach(({ launch }) => {
      const grouped = new Map();
      storySalesRowsForWindow(launch)
        .filter((row) => rowMatchesProductFilter(row, launch))
        .forEach((row) => {
          const subId = rowSubModelId(row, launch.modelo_id);
          const product = subId ? subModelLabel(subId) : (row.sub_modelo || row.nome_produto || launch.modelo);
          const color = extractColor(row, launch);
          const label = isProductOnlyFilterActive() || isProductColorFilterActive()
            ? [product, validComparativeCutKey(color, 'Cor') ? color : null].filter(Boolean).join(' / ')
            : product;
          const key = `${launch.modelo_id}|${normalizeText(label)}`;
          const current = grouped.get(key) || {
            launch,
            label,
            receita: 0,
            pares: 0,
            pedidos: 0,
            orders: new Set()
          };
          current.receita += dashboardRevenueNumber(row);
          current.pares += Number(row.pares || row.quantidade || 0);
          const orderId = row.order_sk || row.order_id || row.pedido_id || row.name || null;
          if (orderId) current.orders.add(orderId);
          else current.pedidos += Number(row.pedidos_validos ?? row.pedidos ?? 0);
          grouped.set(key, current);
        });
      grouped.forEach((item) => {
        candidates.push({
          ...item,
          pedidos: item.orders.size || item.pedidos,
          ticket: ratioOrNull(item.receita, item.orders.size || item.pedidos)
        });
      });
    });
    return candidates
      .filter((item) => numberOrNull(item.receita) !== null && item.receita > 0)
      .sort((a, b) => b.receita - a.receita || b.pares - a.pares);
  }

  function compactPresentationSummary(rows) {
    const comparableRows = closedComparisonRows(rows).filter((row) => row.receita !== null);
    const partialRows = rows.filter((row) => row.sales?.isPartial && row.receita !== null);
    const validationRows = comparableRows.filter((row) => compactRoasRequiresValidation(row));
    const validRoasRows = comparableRows.filter((row) => numberOrNull(row.roas) !== null && !compactRoasRequiresValidation(row));
    const hasRanking = comparableRows.length >= 2;
    const revenueLeader = hasRanking ? pickMetricRow(comparableRows, (row) => row.receita, 'desc') : null;
    const roasLeader = hasRanking ? pickMetricRow(validRoasRows, (row) => row.roas, 'desc') : null;
    const roasAttention = hasRanking ? pickMetricRow(validRoasRows, (row) => row.roas, 'asc') : null;
    const qualityIssues = partialRows.length + validationRows.length;
    const qualityParts = [
      partialRows.length ? `${fmtNum(partialRows.length)} parcial${partialRows.length === 1 ? '' : 'is'}` : '',
      validationRows.length ? `${fmtNum(validationRows.length)} a validar` : ''
    ].filter(Boolean);
    const qualityTitle = qualityParts.length ? qualityParts.join(' · ') : 'Base comparável';
    const cell = (label, title, detail, { tone = '', farol = null, reason = '' } = {}) => `
      <div class="presentation-signal ${tone ? `presentation-signal--${tone}` : ''}">
        <div class="presentation-signal-head">
          <span>${escapeHtml(label)}</span>
          ${reason ? tip(reason) : ''}
        </div>
        <strong>${escapeHtml(title)}</strong>
        <small>${escapeHtml(detail)}</small>
        ${farol ? compactFarolBadge(farol, reason || farol.reason) : ''}
      </div>
    `;
    return `
      <div class="presentation-summary-head">
        <div>
          <span>Fatos do grupo</span>
          <strong>Comparação em janela equivalente</strong>
        </div>
        <p>${hasRanking ? `${fmtNum(comparableRows.length)} lançamentos com ${selectedPeriodLabel()} fechado entram no ranking de escala.` : 'Ainda não há duas janelas fechadas para formar um ranking conclusivo.'} ${partialRows.length ? `${fmtNum(partialRows.length)} linha${partialRows.length === 1 ? '' : 's'} parcial${partialRows.length === 1 ? '' : 'is'} fica${partialRows.length === 1 ? '' : 'm'} fora dos vencedores.` : ''} ${validationRows.length ? `${fmtNum(validationRows.length)} ROAS fora da curva permanece visível, mas fora do ranking de eficiência.` : ''}</p>
      </div>
      <div class="presentation-summary-grid">
        ${cell(
          'Maior escala',
          revenueLeader ? revenueLeader.row.launch.modelo : 'Sem ranking',
          revenueLeader ? `${fmtBRL(revenueLeader.value)} de faturamento` : 'aguardando duas janelas fechadas',
          {
            tone: 'pos',
            farol: revenueLeader ? { tone: 'positive', label: 'Escala validada' } : { tone: 'neutral', label: 'Sem base' },
            reason: revenueLeader
              ? `${revenueLeader.row.launch.modelo} foi escolhido porque tem o maior faturamento entre as janelas fechadas: ${fmtBRL(revenueLeader.value)}. Linhas parciais não entram nessa escolha.`
              : `Ainda não existem duas janelas fechadas em ${selectedPeriodLabel()} para eleger um líder de escala.`
          }
        )}
        ${cell(
          'Melhor eficiência',
          roasLeader ? roasLeader.row.launch.modelo : 'Sem ROAS',
          roasLeader ? `${fmtNum(roasLeader.value, 2)}x com base comparável` : 'janela parcial ou sem mídia paga',
          {
            tone: roasLeader ? 'pos' : 'warn',
            farol: roasLeader ? compactCommercialFarol(roasLeader.row) : { tone: 'neutral', label: 'Sem base' },
            reason: roasLeader
              ? `${roasLeader.row.launch.modelo} foi escolhido porque possui o maior ROAS entre as janelas fechadas com base de mídia paga comparável: ${fmtNum(roasLeader.value, 2)}x. Valores acima de ${fmtNum(COMPACT_ROAS_VALIDATION_LIMIT)}x ficam fora até validação.`
              : 'Nenhuma linha possui, ao mesmo tempo, janela fechada e base de mídia paga comparável.'
          }
        )}
        ${cell(
          'Ponto de atenção',
          roasAttention ? roasAttention.row.launch.modelo : 'Sem sinal fechado',
          roasAttention ? `${fmtNum(roasAttention.value, 2)}x · menor retorno comparável` : 'sem base para priorizar revisão',
          {
            tone: roasAttention && roasAttention.value < 1 ? 'neg' : 'warn',
            farol: roasAttention ? compactCommercialFarol(roasAttention.row) : { tone: 'neutral', label: 'Sem base' },
            reason: roasAttention
              ? `${roasAttention.row.launch.modelo} foi escolhido porque tem o menor ROAS entre as bases fechadas e comparáveis: ${fmtNum(roasAttention.value, 2)}x. Isso prioriza a revisão de oferta, canal e campanha; não representa margem líquida.`
              : 'A base atual não permite escolher um ponto de atenção sem misturar janela parcial ou valor a validar.'
          }
        )}
        ${cell(
          'Qualidade da leitura',
          qualityTitle,
          qualityIssues ? 'acompanhar antes da decisão final' : 'todas as janelas e bases aptas',
          {
            tone: qualityIssues ? 'warn' : 'pos',
            farol: qualityIssues ? { tone: 'warning', label: 'Com ressalvas' } : { tone: 'positive', label: 'Base fechada' },
            reason: qualityIssues
              ? `${partialRows.length ? `${partialRows.map((row) => row.launch.modelo).join(', ')} ainda não fechou a janela. ` : ''}${validationRows.length ? `${validationRows.map((row) => row.launch.modelo).join(', ')} possui ROAS fora da curva e exige conferência da verba.` : ''}`
              : `Todas as linhas comparadas completaram ${selectedPeriodLabel()} e nenhuma possui ROAS acima do limite de controle.`
          }
        )}
      </div>
    `;
  }

  function compactFocusDetail(selected, rows) {
    const focusRow = rows.find((row) => row.launch?.modelo_id === selected?.modelo_id);
    const focusInComparison = Boolean(focusRow);
    const focusCopy = focusInComparison
      ? `${selected.modelo} esta destacado dentro do grupo comparado.`
      : `${selected.modelo} esta destacado, mas nao entra no grupo comparado. Ajuste o grupo se quiser inclui-lo nos calculos.`;
    const row = focusRow || (() => {
      const sales = compactSalesWindowForLaunch(selected);
      const data = sales.data || {};
      const investment = compactInvestmentForLaunch(selected);
      const attribution = investmentAttributionForWindow(selected, selectedPeriodKey());
      const receita = numberOrNull(data.receita);
      const pedidos = numberOrNull(data.pedidos);
      const pares = numberOrNull(data.pares);
      const canComputeRoas = investment.hasMediaInvestment && !sales.isPartial;
      return {
        launch: selected,
        sales,
        investment,
        receita,
        pedidos,
        pares,
        roas: canComputeRoas ? ratioOrNull(attribution.receitaInvestimento, investment.value) : null
      };
    })();
    return `
      <div class="launch-focus-card ${focusInComparison ? '' : 'is-outside-filter'}">
        <div>
          <span class="launch-card-kicker">Destaque visual</span>
          <h3>${escapeHtml(selected.modelo)}</h3>
          <p>${escapeHtml(focusCopy)}</p>
        </div>
        <div class="launch-focus-facts">
          ${compactKpi('Faturamento', fmtBRL(row?.receita), row?.sales?.statusLabel || selectedPeriodLabel())}
          ${compactKpi('Pedidos', fmtNum(row?.pedidos), 'vendas do produto')}
          ${compactKpi('Investimento', fmtBRL(row?.investment?.value), row?.investment?.source || 'sem investimento')}
          ${compactKpi('ROAS', row?.roas === null || row?.roas === undefined ? '—' : `${fmtNum(row.roas, 2)}x`, 'período selecionado')}
        </div>
      </div>
    `;
  }

  function storyProductDetailDrawerHtml(selected) {
    const productHtml = storySubModelHtml(selected);
    return `
      <details class="story-step-details story-product-detail-details">
        <summary><span>Detalhe do produto</span><small>${productHtml ? 'submodelos, cores e tamanhos' : 'sem recorte interno'}</small>${tip('Abre a leitura interna da linha destacada sem repetir a tabela principal.')}</summary>
        ${productHtml || '<p class="launch-muted">Esta linha nao tem submodelo, cor ou tamanho suficiente para abrir uma leitura interna confiavel.</p>'}
      </details>
    `;
  }

  function storyCommercialDetailDrawerHtml(selected) {
    const launches = filteredComparisonLaunches().filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
    const mediaRows = launches.flatMap((launch) => mediaRowsForInvestmentWindow(launch, selectedPeriodKey())
      .map((row) => normalizeMediaRow(row, launch)));
    const crmRows = launches.flatMap((launch) => (state.data.crm_disparos || [])
      .filter((row) => row.modelo_id === launch.modelo_id)
      .filter((row) => crmRowMatchesSelectedPeriod(row, launch))
      .map((row) => ({ ...normalizeCrmRow(row), modelo_id: launch.modelo_id, modelo: launch.modelo })));
    const visibleMedia = mediaRows.slice(0, 6);
    const visibleCrm = crmRows.slice(0, 6);
    const lineRows = (state.data.midia_paga || [])
      .filter(isLineInvestmentMediaRow)
      .map(normalizeLineInvestmentMediaRow)
      .slice(0, 6);
    const rowHtml = (label, model, title, value, detail = '') => `
      <div class="launch-commercial-row">
        <span>${escapeHtml(label)}</span>
        <strong>${escapeHtml(model)}</strong>
        <em>${escapeHtml(title)}</em>
        <b>${escapeHtml(value)}</b>
        ${detail ? `<small>${escapeHtml(detail)}</small>` : ''}
      </div>
    `;
    const mediaHtml = visibleMedia.length
      ? visibleMedia.map((row) => rowHtml('Investimento', row.modelo, `${row.campanha} - ${row.janela}`, mediaValue(row.investimento, fmtBRL), 'investimento declarado; venda fica na tabela principal')).join('')
      : '<p class="launch-muted">Sem investimento de campanha declarado para o grupo filtrado.</p>';
    const crmHtml = visibleCrm.length
      ? visibleCrm.map((row) => rowHtml('Disparo', row.modelo, `${fmtDate(row.data_disparo)} - ${row.campanha || 'Disparo sem nome'}`, mediaValue(row.investimento, fmtBRL), hasTrustedCrmPerformance(row) ? `receita ${fmtBRL(row.receita_base)}` : 'contexto, sem atribuicao real')).join('')
      : '<p class="launch-muted">Sem disparos declarados para o grupo filtrado.</p>';
    const lineHtml = lineRows.length
      ? lineRows.map((row) => rowHtml('Linha', row.linha || 'linha', row.campanha, mediaValue(row.investimento, fmtBRL), 'investimento sem rateio entre lançamentos')).join('')
      : '<p class="launch-muted">Sem investimento de linha cadastrado.</p>';
    const totalRows = mediaRows.length + crmRows.length + lineRows.length;
    return `
      <details class="story-step-details story-commercial-detail-details">
        <summary><span>Ações declaradas</span><small>${fmtNum(totalRows)} linhas operacionais</small>${tip('Mostra apenas as linhas manuais declaradas. Os resultados reais continuam consolidados na tabela principal para evitar dupla leitura.')}</summary>
        <div class="launch-commercial-detail">
          <div>
            <strong>Campanhas declaradas</strong>
            ${mediaHtml}
          </div>
          <div>
            <strong>Disparos declarados</strong>
            ${crmHtml}
          </div>
          <div class="is-wide">
            <strong>Investimento de linha</strong>
            ${lineHtml}
          </div>
        </div>
      </details>
    `;
  }

  function renderCompactLaunchAnalysis(wrap, selected) {
    const rows = compactHistoricalRows(selected);
    const sumOrNull = (values) => {
      const known = values.filter((value) => value !== null && value !== undefined);
      return known.length ? known.reduce((acc, value) => acc + value, 0) : null;
    };
    const totals = {
      totalReceita: sumOrNull(rows.map((row) => row.receita)),
      totalPedidos: sumOrNull(rows.map((row) => row.pedidos)),
      totalPares: sumOrNull(rows.map((row) => row.pares)),
      totalInvestimento: sumOrNull(rows.map((row) => numberOrNull(row.investment.value))),
      totalReceitaInvestimento: sumOrNull(rows.map((row) => row.receitaInvestimento))
    };
    const rowsWithRevenue = rows.filter((row) => row.receita !== null);
    const rowsWithInvestment = rows.filter((row) => numberOrNull(row.investment.value) !== null);
    const rowsWithRoasBase = rows.filter((row) => row.roas !== null && row.roas !== undefined && !compactRoasRequiresValidation(row));
    const rowsWithRoasToValidate = rows.filter((row) => compactRoasRequiresValidation(row));
    const roasTotal = ratioOrNull(
      sumOrNull(rowsWithRoasBase.map((row) => row.receitaInvestimento)),
      sumOrNull(rowsWithRoasBase.map((row) => numberOrNull(row.investment.value)))
    );
    const selectedCount = selectedCompareLaunches().length;
    const selectedInFilter = rows.some((row) => row.launch?.modelo_id === selected?.modelo_id);
    wrap.innerHTML = `
      <section class="launch-analysis-panel">
        <div class="launch-analysis-head">
          <div>
            <div class="section-kicker story-kicker">Resumo executivo</div>
            <h2>Comparativo executivo de lançamentos</h2>
            <p>Cada lançamento é comparado na mesma janela D+ a partir do próprio D0. Vendas vêm do pipeline de pedidos; investimento soma mídia paga e CRM cadastrados na janela.</p>
          </div>
          <div class="launch-analysis-status">
            <span>${escapeHtml(selectedPeriodLabel())}</span>
            <strong>${fmtNum(selectedCount)} lançamento${selectedCount === 1 ? '' : 's'}</strong>
            <small>${selectedInFilter ? 'destaque dentro do grupo' : 'destaque fora do grupo'}</small>
          </div>
        </div>

        <div class="launch-kpi-grid">
          ${compactKpi('Faturamento total', fmtBRL(totals.totalReceita), `${fmtNum(rowsWithRevenue.length)} linhas com venda`)}
          ${compactKpi('Pedidos', fmtNum(totals.totalPedidos), 'pedidos aprovados')}
          ${compactKpi('Pares', fmtNum(totals.totalPares), 'volume fisico')}
          ${compactKpi('Investimento', fmtBRL(totals.totalInvestimento), `${fmtNum(rowsWithInvestment.length)} linhas · mídia paga + CRM`)}
          ${compactKpi('ROAS', roasTotal === null ? '—' : `${fmtNum(roasTotal, 2)}x`, rowsWithRoasBase.length ? `${fmtNum(rowsWithRoasBase.length)} bases comparáveis${rowsWithRoasToValidate.length ? ` · ${fmtNum(rowsWithRoasToValidate.length)} a validar` : ''}` : rowsWithRoasToValidate.length ? `${fmtNum(rowsWithRoasToValidate.length)} valor a validar` : 'sem base comparável')}
        </div>

        ${compactOrderOriginSummary(rows)}

        ${compactPresentationSummary(rows)}

        <div class="launch-main-block">
          <div class="launch-block-head">
            <div>
              <span class="launch-card-kicker">Base comparativa</span>
              <h3>Desempenho por lançamento</h3>
            </div>
            ${tip('Cada linha usa a própria data de lançamento. D+30 de Avant compara com D+30 de Phantom, mesmo que tenham acontecido em meses diferentes.')}
          </div>
          ${compactHistoricalTable(rows)}
        </div>

        <div class="story-drawer-grid launch-support-drawers">
          ${storyProductDetailDrawerHtml(selected)}
          ${storyCutDrawerHtml(selected)}
          ${storyCommercialDetailDrawerHtml(selected)}
          ${storySeasonalDrawerHtml(selected)}
          ${storyProjectionDrawerHtml(selected)}
          <details class="story-step-details">
            <summary><span>Origem dos dados</span><small>De onde vem cada número</small>${tip('Mostra as fontes usadas na leitura principal sem misturar vendas com a base de investimento.')}</summary>
            <div class="launch-source-grid">
              <div><strong>Vendas e faturamento</strong><span>lancamentos_produtos_dia.json, gerado pelo pipeline de pedidos.</span></div>
              <div><strong>Investimento</strong><span>midia_paga.json e crm_disparos.json somados como base unica de investimento. A planilha diaria nao entra no calculo de investimento.</span></div>
              <div><strong>Canais</strong><span>O SSOT usa a classificação por pedido: midia paga e organico puro ficam separados de direto, e-mail/CRM, WhatsApp, outros e nao atribuidos.</span></div>
              <div><strong>Rentabilidade</strong><span>Leitura de retorno comercial: ROAS quando ha base valida de midia paga. Margem liquida/CMV nao estao no JSON.</span></div>
              <div><strong>Projeção</strong><span>Único bloco estimado; todo o restante preserva dado real ou vazio.</span></div>
            </div>
          </details>
          <div id="story-drawer-panel" class="story-drawer-panel" hidden></div>
        </div>
      </section>
    `;
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
    return attributionFromWindowData(data);
  }

  function attributionFromWindowData(data = {}) {
    const hasOrderAttribution = hasExplicitOrderAttribution(data);
    const receitaPaga = numberOrNull(data.receita_paga);
    const receitaCrm = numberOrNull(data.receita_crm);
    const pedidosPagos = numberOrNull(data.pedidos_pagos);
    const pedidosCrm = numberOrNull(data.pedidos_crm);
    const paresPagos = numberOrNull(data.pares_pagos);
    const paresOrganicos = numberOrNull(data.pares_organicos);
    const paresCrm = numberOrNull(data.pares_crm);
    const receitaInvestimento = receitaPaga;
    const pedidosInvestimento = pedidosPagos;
    const receitaOrganicaBase = hasOrderAttribution ? (numberOrNull(data.receita_organica) ?? 0) : null;
    const pedidosOrganicosBase = hasOrderAttribution ? (numberOrNull(data.pedidos_organicos) ?? 0) : null;
    return {
      receita: numberOrNull(data.receita),
      receita_total_original: numberOrNull(data.receita_total_original),
      pedidos: numberOrNull(data.pedidos) ?? numberOrNull(data.pedidos_validos),
      receita_organica: hasOrderAttribution ? nonInvestmentRevenueForData({ ...data, receita_organica: receitaOrganicaBase }, receitaInvestimento) : null,
      receita_paga: hasOrderAttribution ? receitaPaga : null,
      receita_crm: hasOrderAttribution ? receitaCrm : null,
      receita_outros_canais: hasOrderAttribution ? numberOrNull(data.receita_outros_canais) : null,
      receita_sem_match_atribuicao: hasOrderAttribution ? numberOrNull(data.receita_sem_match_atribuicao) : null,
      pedidos_organicos: hasOrderAttribution ? nonInvestmentOrdersForData({ ...data, pedidos_organicos: pedidosOrganicosBase }, pedidosInvestimento) : null,
      pedidos_pagos: hasOrderAttribution ? pedidosPagos : null,
      pedidos_crm: hasOrderAttribution ? pedidosCrm : null,
      pares_organicos: hasOrderAttribution ? paresOrganicos : null,
      pares_pagos: hasOrderAttribution ? paresPagos : null,
      pares_crm: hasOrderAttribution ? paresCrm : null,
      pares_outros_canais: hasOrderAttribution ? numberOrNull(data.pares_outros_canais) : null,
      pares_sem_match_atribuicao: hasOrderAttribution ? numberOrNull(data.pares_sem_match_atribuicao) : null,
      pedidos_outros_canais: hasOrderAttribution ? numberOrNull(data.pedidos_outros_canais) : null,
      pedidos_sem_match_atribuicao: hasOrderAttribution ? numberOrNull(data.pedidos_sem_match_atribuicao) : null
    };
  }

  function attributionForWindowKey(launch, key) {
    return attributionFromWindowData(getWindow(launch, key) || {});
  }

  function investmentAttributionForWindow(launch, key = selectedPeriodKey()) {
    const attribution = attributionForWindowKey(launch, key);
    const receitaInvestimento = numberOrNull(attribution.receita_paga);
    const pedidosInvestimento = numberOrNull(attribution.pedidos_pagos);
    return {
      ...attribution,
      receitaInvestimento,
      pedidosInvestimento,
      receitaOrganica: attribution.receita_organica,
      pedidosOrganicos: attribution.pedidos_organicos
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
    renderCompactLaunchAnalysis(wrap, selected);
    return;

    const model = shareModelForLine(selected.modelo_id);
    const selectedWindow = selectedAnalysisWindow(selected);
    const activity = launchActivityNarrative(selected, selectedWindow);
    const metaRow = metaMensalForLaunch(selected);
    const selectedShareContext = selectedPeriodShareContext(selected);
    const selectedShare = selectedShareContext.share;
    const partialShare = selectedShare === null ? selectedPartialShareForLaunch(selected, activity.row) : null;
    const share = selectedShare ?? partialShare;
    const launchRevenue = numberOrNull(selectedWindow.data?.receita);
    const meta = metaNarrative(metaRow, { launchShare: share, launchRevenue, launchD0: selected.d0 });
    const periodLimitDay = isSpecificAnalysisPeriod() ? selectedPeriodEndDay(selected) : null;
    const goalRows = representationGoalRows(selected, periodLimitDay);
    const companyGoal = selectedGoalRow(selected);
    const company = companyGoalMomentNarrative(selected, model, companyGoal ? [companyGoal] : goalRows);
    const firstGoal = companyGoal || goalRows[0];
    const firstGoalPct = firstGoal ? numberOrNull(goalDisplayPctMeta(firstGoal, selected)) : null;
    const firstGoalMonthText = firstGoal ? goalMonthBreakdownText(firstGoal, selected) : '';
    const shareLabel = selectedShare === null && partialShare !== null ? 'Participação até o momento' : 'Participação na janela';
    const representationValue = firstGoalPct !== null
      ? fmtPct(firstGoalPct, 1)
      : firstGoalMonthText
        ? 'Mês a mês'
        : firstGoal
          ? 'Sem meta'
          : fmtPct(share, 1);
    const representationDetail = firstGoal
      ? `${selectedPeriodLabel()}: ${firstGoalPct !== null ? `${fmtPct(firstGoalPct, 1)} da meta do mês` : firstGoalMonthText ? 'meta lida mês a mês' : 'sem meta cadastrada'}. ${shareLabel}: ${fmtPct(share, 1)}.`
      : `${representationGoalSummary(goalRows, selected)} ${shareLabel}: ${fmtPct(share, 1)}.`;
    const companyVariation = numberOrNull(model?.variacao_receita_empresa_pct);
    const metaPending = meta.label === 'Pendente';
    const metaOpen = metaRow?.__meta_status === 'month_open'
      || (Array.isArray(metaRow?.daily) && metaRow.daily.length && metaRow.realizado_ate && monthEndIso(metaMonthKey(metaRow)) && String(metaRow.realizado_ate).slice(0, 10) < monthEndIso(metaMonthKey(metaRow)));
    const signal = storySignal({ share, companyVariation, metaPending });
    const companyWidth = companyVariation === null ? 0 : Math.max(6, Math.min(100, (Math.abs(companyVariation) / 0.22) * 100));
    const shareWidth = share === null ? 0 : Math.max(4, Math.min(100, share * 100));
    const historicalUniverse = historicalShareUniverse(selected);
    const rankWindowLabel = `cada modelo na própria data de lançamento -> ${selectedPeriodLabel()}`;
    const comparisonRows = sortShareContexts(historicalUniverse.launches.map(selectedPeriodShareContext));
    const rankableRows = comparisonRows.filter((row) => row.share !== null);
    const rank = rankableRows.findIndex((row) => row.launch.modelo_id === selected.modelo_id) + 1;
    const rankCopy = rank > 0
      ? `${fmtNum(rank)}º de ${fmtNum(rankableRows.length)} com participação calculável no grupo comparativo (${rankWindowLabel})`
      : 'A linha aparece no grupo comparativo, mas ainda não tem participação calculável nessa janela.';
    let visibleRank = 0;
    const allShareHtml = comparisonRows.length
      ? `
        <div class="story-top-caption">Todas as linhas · participação por janela própria · ${escapeHtml(rankWindowLabel)}</div>
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
      ? `${selected.modelo}: ${fmtPct(share, 1)} da receita da Reise em ${selectedPeriodLabel()} e ${rank > 0 ? `${fmtNum(rank)}º de ${fmtNum(rankableRows.length)}` : 'sem posição'} no comparativo.`
      : `${selected.modelo}: ainda sem participação confiável em ${selectedPeriodLabel()}.`;
    const storyIntroTooltip = 'Resumo para decisão: peso do lançamento, meta, momento da empresa e próximo recorte de análise.';
    const centralQuestionTooltip = 'Pergunta principal para orientar a decisão executiva.';
    const activityTooltip = 'Mostra dias, faturamento, pedidos e pares da linha na janela escolhida.';
    const representationGoalHtml = storyGoalContributionHtml(goalRows, selected);
    const evidence = [
      storyMetricHtml({
        label: 'Participação vs meta',
        value: representationValue,
        detail: representationDetail,
        width: firstGoalPct !== null ? firstGoalPct * 100 : shareWidth,
        state: firstGoalPct === null ? 'pending' : firstGoalPct >= 0.12 ? 'focus' : 'ok',
        tooltip: 'Mostra quanto o produto pesou frente à meta do mês. Se a janela pega mais de um mês, cada mês aparece separado.',
        extraHtml: representationGoalHtml
      }),
      storyMetricHtml({
        label: 'Contexto da empresa vs meta',
        value: company.value,
        detail: `${company.label}: ${company.copy}`,
        width: companyWidth,
        state: company.state || (companyVariation !== null && companyVariation < -0.05 ? 'warn' : 'ok'),
        tooltip: 'Compara faturamento da empresa, meta do mês e participação do produto.',
        extraHtml: `${storyFactChips(company.facts)}${company.extraHtml || ''}${storySourceNote('Meta da empresa e venda do produto no mesmo período.')}`,
        showTrack: false
      })
    ];
    const decisionNotes = [
      {
        title: 'Onde olhar primeiro',
        tooltip: 'Mostra onde olhar primeiro para entender o resultado.',
        copy: share !== null && share >= 0.08
          ? 'Ver peso na receita, composição interna e canal.'
          : 'Comparar a curva antes de concluir que o sinal é forte.'
      },
      {
        title: 'Risco executivo',
        tooltip: 'Principal cuidado antes de tomar decisão.',
        copy: companyVariation !== null && companyVariation < -0.05
          ? 'Separar ganho real de possível troca de receita entre linhas.'
          : 'Ver se o produto puxou crescimento ou apenas acompanhou o mercado.'
      },
      {
        title: 'Próximo passo',
        tooltip: 'Próxima ação recomendada.',
        copy: metaOpen
          ? 'Acompanhar curva, composição e canal até o mês fechar.'
          : metaPending
            ? 'Conectar meta mensal para fechar a leitura de eficiência.'
            : 'Decidir reforço, pausa ou redistribuição.'
      }
    ];

    const cards = [
      {
        step: '01',
        title: 'Contexto da empresa vs meta',
        value: company.value,
        label: company.label,
        copy: `${storyEvidenceCopy(company.copy)}${executiveEvidenceSourceLine('momento', { company })}`,
        state: company.state || (companyVariation !== null && companyVariation < -0.05 ? 'warn' : 'ok'),
        tooltip: 'Evidência técnica: realizado da empresa vs meta no período do produto selecionado; produto entra como participação no realizado.'
      },
      {
        step: '02',
        title: 'Participação vs meta',
        value: representationValue,
        label: representationGoalSummary(goalRows, selected),
        copy: `${storyEvidenceCopy(representationGoalSummary(goalRows, selected))}${representationGoalExecutiveEvidence(goalRows, selected)}${executiveEvidenceSourceLine('representatividade', { goalRow: firstGoal })}`,
        state: 'focus',
        tooltip: 'Evidência do peso do lançamento: produto contra meta mensal por janelas de 30 dias, participação da janela e posição no universo comparado.'
      },
      {
        step: '03',
        title: 'Volume comparativo',
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
            <div class="section-kicker story-kicker">${labelTip('Resumo executivo', storyIntroTooltip)}</div>
            <h2>História comparativa</h2>
            <p>${escapeHtml(thesis)} Compare receita, meta e ritmo frente ao grupo.</p>
          </div>
          <div class="story-brief-verdict">
            ${labelTip('Pergunta central', centralQuestionTooltip)}
            <strong>${escapeHtml(signal.question)}</strong>
          </div>
        </div>
        <div class="story-visual-grid">
          <div class="story-left-column">
            <div class="story-hero-signal story-hero-signal--activity">
                ${labelTip('Volume comparativo', activityTooltip)}
              <strong>${escapeHtml(activity.value)}</strong>
              <p>${escapeHtml(activity.copy)}</p>
              ${storyFactChips(activity.facts)}
            </div>
            ${storySubModelHtml(selected)}
          </div>
          <div>
            <div class="story-visual-metrics">
              ${evidence.join('')}
            </div>
            <div class="story-visual-metric story-visual-metric--wide">
              <div class="story-visual-metric-head">
                ${labelTip('Ranking por participação', 'Cada lançamento usa sua própria linha temporal: receita do produto na janela selecionada dividida pelo faturamento da empresa no mesmo intervalo daquele lançamento. Phantom usa datas de Phantom; Avant usa datas de Avant; as datas de calendário não se cruzam.')}
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
        <div class="story-drawer-grid">
          ${storyCutDrawerHtml(selected)}
          ${storySeasonalDrawerHtml(selected)}
          ${storyProjectionDrawerHtml(selected)}
          <details class="story-step-details">
            <summary><span>Ver resumo das fontes</span><small>Origem dos numeros</small>${tip('Abre os quatro blocos que sustentam a leitura executiva, em linguagem de decisão: momento da empresa, meta, representatividade e atividade comparativa.')}</summary>
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
          <div id="story-drawer-panel" class="story-drawer-panel" hidden></div>
        </div>
      </div>
    `;
  }

  function renderSelectedHeader(selected) {
    const cohort = comparisonLaunchesWithFocus(selected);
    const periodKey = selectedPeriodKey();
    const withWindow = cohort.filter((launch) => Boolean(getWindow(launch, periodKey))).length;
    const withoutWindow = Math.max(0, cohort.length - withWindow);

    const items = [
      { label: 'Destaque visual', value: selected?.modelo || '—' },
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
          <div class="share-drawer-kicker">Participação na receita</div>
          <h3>${escapeHtml(line)}</h3>
        </div>
      </div>
      <div class="share-error">
        <strong>Participação indisponível</strong>
        <p>${escapeHtml(message)}</p>
      </div>
    `;
  }

  function shareChartAria(points) {
    const values = points.map((point) => Number(point.share_do_dia)).filter((value) => Number.isFinite(value));
    if (!values.length) return 'Participação diária do lançamento sem pontos válidos.';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const companyValues = points.map((point) => numberOrNull(point.receita_empresa)).filter((value) => value !== null);
    const companyLayer = companyValues.length ? ' com camada de faturamento total da Reise.' : '.';
    return `Participação diária do lançamento entre ${fmtPct(min, 1)} e ${fmtPct(max, 1)} ao longo de ${fmtNum(points.length)} dias${companyLayer}`;
  }

  function commercialEventTypeLabel(type) {
    const key = normalizeText(type);
    const labels = {
      promocao: 'Promocao',
      ruptura_estoque: 'Ruptura operacional',
      midia_paga: 'Investimento',
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
    if (!model) return badge('parcial', 'Participação indisponível');
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

  function subModelDailyRows(modelId, metric = null) {
    if (MODELS_WITHOUT_SUBMODELS.has(modelId)) return [];
    const exported = state.data?.sub_modelos_dia;
    if (!metric?.requiresProductRows && Array.isArray(exported) && exported.length) {
      return exported
        .filter((row) => row.modelo_id === modelId && row.sub_modelo_id && !isSyntheticSubModelId(row.sub_modelo_id))
        .map((row) => ({
          modelo_id: row.modelo_id,
          sub_modelo_id: row.sub_modelo_id,
          data: row.data_venda || row.data,
          pares: Number(row.pares || 0),
          receita: Number(row.receita || 0),
          receita_paga: numberOrNull(row.receita_paga),
          receita_organica: numberOrNull(row.receita_organica),
          receita_controles: numberOrNull(row.receita_controles),
          pedidos_pagos: numberOrNull(row.pedidos_pagos),
          pedidos_organicos: numberOrNull(row.pedidos_organicos),
          pedidos_controles: numberOrNull(row.pedidos_controles)
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
          receita: 0,
          receita_paga: 0,
          receita_organica: 0,
          receita_controles: 0,
          pedidos_pagos: 0,
          pedidos_organicos: 0,
          pedidos_controles: 0
        };
        current.pares += Number(row.pares || row.quantidade || 0);
        current.receita += dashboardRevenueNumber(row);
        const rowType = orderChannelType(row);
        if (rowType === 'paid') {
          current.receita_paga += dashboardRevenueNumber(row);
          current.pedidos_pagos += Number(row.pedidos_pagos ?? row.pedidos_validos ?? row.pedidos ?? 0);
        } else if (rowType === 'organic') {
          current.receita_organica += dashboardRevenueNumber(row);
          current.pedidos_organicos += Number(row.pedidos_organicos ?? row.pedidos_validos ?? row.pedidos ?? 0);
        } else if (rowType) {
          current.receita_controles += dashboardRevenueNumber(row);
          const explicitControlsOrders = sumValues(row.pedidos_crm, row.pedidos_outros_canais, row.pedidos_sem_match_atribuicao);
          current.pedidos_controles += Number(explicitControlsOrders ?? row.pedidos_validos ?? row.pedidos ?? 0);
        }
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
      parts.push(`${selected.label}: ${fmtPct(share, 1)} ${selected.shareBasis}`);
    } else {
      parts.push(`${selected.label}: sem dado classificado nesta janela`);
    }
    if (summary.rank) parts.push(`${fmtNum(summary.rank)}º de ${fmtNum(summary.peers.length)}`);
    if (deltaAvg !== null) parts.push(`${deltaAvg >= 0 ? '+' : '-'}${fmtPct(Math.abs(deltaAvg), 1)} vs média`);
    if (gapLeader !== null) parts.push(`${storyFormatMetric(gapLeader, selected.metricType)} atrás do líder`);
    else if (summary.leader?.id === selected.id) parts.push('líder no recorte');
    if (selected.metricType !== 'brl' && numberOrNull(selected.receita) !== null) parts.push(`receita ${fmtBRL(selected.receita)}`);
    if (summary.dailyValue !== null) parts.push(`ritmo de ${storyFormatMetric(summary.dailyValue, 'brlPerDay')}`);
    return parts.join(' · ') + '.';
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
      { label: 'Participação', value: fmtPct(summary.share, 1) },
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
      <div class="drill-chart" role="img" aria-label="Curva de participação diária da linha">
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
          <span>Sem participação por sub-modelo.</span>
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
          <div class="drill-section-title">Contexto da empresa</div>
          <p class="drill-empty">comparativo indisponível</p>
        </section>
      `;
    }
    const d0 = analysisDayZero(model);
    if (!d0) {
      return `
        <section class="drill-section">
          <div class="drill-section-title">Contexto da empresa</div>
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
        <div class="drill-section-title">Contexto da empresa</div>
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
    const otherRevenue = numberOrNull(launch?.receita_outros_canais);
    const investmentRevenue = paidRevenue;

    if (paidRevenue !== null || organicRevenue !== null || otherRevenue !== null) {
      const total = Number(investmentRevenue || 0) + Number(organicRevenue || 0) + Number(otherRevenue || 0);
      const channelMeta = (revenue) => {
        const parts = [];
        parts.push(total && revenue !== null ? `${fmtPct(revenue / total, 1)} do total atribuido` : 'venda aguardando');
        return parts.join(' · ');
      };
      return `
        <section class="drill-section">
          <div class="drill-section-title">Vendas por canal</div>
          <div class="drill-impact-grid">
            <div><span>Venda midia paga</span><strong>${investmentRevenue !== null ? fmtBRL(investmentRevenue) : 'Aguardando'}</strong><small>${channelMeta(investmentRevenue)}</small></div>
            <div><span>Venda organica</span><strong>${organicRevenue !== null ? fmtBRL(organicRevenue) : 'Aguardando'}</strong><small>${channelMeta(organicRevenue)}</small></div>
            <div><span>Outros canais</span><strong>${otherRevenue !== null ? fmtBRL(otherRevenue) : 'Aguardando'}</strong><small>${channelMeta(otherRevenue)}</small></div>
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
          <span>O dashboard não usa mais correlação dias-com-investimento vs dias-sem como impacto. Até a view por pedido entrar no payload, investimento fica agregado por janela e ROAS permanece vazio quando não houver atribuição real.</span>
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
        <div class="drill-section-title">Ranking por participação - todas as linhas</div>
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
    const launches = selectedCompareLaunches()
      .filter((launch) => launch && !launch.isFuture && !isPlannedStatus(launch.status));
    if (launches.length) return launches;
    return selected && !selected.isFuture && !isPlannedStatus(selected.status) ? [selected] : [];
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
        label: 'Pares',
        tooltip: 'Ranking de volume físico vendido na janela selecionada de cada lançamento.',
        rows: cohortMetricRows(cohort, (launch) => windowFor(launch)?.pares),
        formatter: fmtNum,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Ritmo diário',
        tooltip: 'Ranking de receita média por dia na janela selecionada.',
        rows: cohortMetricRows(cohort, (launch) => {
          const data = windowFor(launch);
          return data?.receita && days ? data.receita / days : null;
        }),
        formatter: (value) => `${fmtBRL(value)}/dia`,
        selectedId: selected.modelo_id
      }),
      cohortMetricCard({
        label: 'Contexto comercial',
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

  function launchMatchesLineFilter(launch) {
    if (!state.lineFilter || state.lineFilter === 'all') return true;
    return normalizeText(launch?.linha || launch?.modelo || '') === state.lineFilter;
  }

  function availableComparisonLaunches() {
    return comparableLaunches().filter(launchMatchesLineFilter);
  }

  function defaultComparableLaunch(launches = comparableLaunches()) {
    return [...launches].sort((a, b) => {
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (toDate(b.d0)?.getTime() || 0) - (toDate(a.d0)?.getTime() || 0);
    })[0] || state.launches[0] || null;
  }

  function selectedCompareLaunches() {
    const allowed = availableComparisonLaunches();
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
    const metric = rampMetricConfig('receita_acumulada');
    const eligible = launches
      .map((launch) => {
        const points = rampDailyRowsForLaunch(launch, launchCurrentRampDay(launch))
          .map((row) => ({ ...row, data_calendario: dailyCalendarDate(launch, row) }))
          .filter((row) => row.data_calendario && rampSeriesValue(row, metric) !== null);
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
      const byDate = new Map(points.map((row) => [row.data_calendario, rampSeriesValue(row, metric)]));
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
    const metric = rampMetricConfig('receita_acumulada');
    const rows = subModelDailyRows(modelId)
      .filter((row) => rampSeriesValue(row, metric) !== null);
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
      const byDate = new Map(subRows.map((row) => [row.data, rampSeriesValue(row, metric)]));
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
    let rampMetric = rampMetricConfig();
    if (mode !== 'linha') {
      state.normalizedRampMetric = 'receita_acumulada';
      document.querySelectorAll('[data-ramp-metric]').forEach((button) => {
        button.classList.toggle('is-active', button.dataset.rampMetric === state.normalizedRampMetric);
      });
      rampMetric = rampMetricConfig();
    }
    if (canvasId === 'chart-normalized') {
      const lineSelect = $('cannibal-line-select');
      if (lineSelect) {
        lineSelect.hidden = mode !== 'canibal-submodelos';
        if (mode === 'canibal-submodelos') populateCannibalLineSelect();
      }
      const metricControls = document.querySelector('.normalized-ramp-metric-controls');
      if (metricControls) metricControls.hidden = mode !== 'linha';
      const healthButton = document.querySelector('[data-ramp-metric="saude_rampa"]');
      if (healthButton) healthButton.hidden = mode !== 'linha';
      const quickControls = $('ramp-quick-controls');
      if (quickControls && mode !== 'linha') {
        quickControls.hidden = true;
        quickControls.innerHTML = '';
      }
    }

    if (mode === 'linha') {
      const chartLaunches = selectedCompareLaunches();
      const normalizedLaunches = [...chartLaunches].sort((a, b) => {
        if (a.modelo_id === selected.modelo_id) return -1;
        if (b.modelo_id === selected.modelo_id) return 1;
        return a.order - b.order;
      });
      const isMonthly = rampMetric.cadence === 'mes';
      const isHealth = Boolean(rampMetric.health);
      const isShare = Boolean(rampMetric.share);
      const isRps = Boolean(rampMetric.rps);
      const isWeekly = isHealth || rampMetric.cadence === 'semana';
      const comparisonMaxDay = normalizedRampMaxDay(normalizedLaunches.length ? normalizedLaunches : [selected]);
      const maxDay = isRps ? rpsLatestDataDay(selected) : comparisonMaxDay;
      renderRampQuickControls(maxDay, rampMetric, mode);
      let lensBounds = rampTimeLensBounds(maxDay, rampMetric);
      let weeklyLens = isWeekly
        ? (isHealth
          ? rampWeeklyLensBounds(lensBounds, maxDay)
          : rampPeriodLensBounds(lensBounds, maxDay, rampMetric.periodDays || RAMP_RHYTHM_WINDOW_DAYS))
        : null;
      if (isWeekly && weeklyLens.unavailable) {
        state.rampTimeLens = 'all';
        lensBounds = rampTimeLensBounds(maxDay, rampMetric);
        weeklyLens = isHealth
          ? rampWeeklyLensBounds(lensBounds, maxDay)
          : rampPeriodLensBounds(lensBounds, maxDay, rampMetric.periodDays || RAMP_RHYTHM_WINDOW_DAYS);
      }
      const lensStart = isMonthly ? 0 : lensBounds.start;
      const lensEnd = isMonthly ? maxDay : lensBounds.end;
      const normalizedLabels = isMonthly
        ? Array.from({ length: rampMonthIndex(maxDay) + 1 }, (_, month) => rampMonthLabel(month))
        : isWeekly
          ? Array.from({ length: (weeklyLens.endWeek - weeklyLens.startWeek) + 1 }, (_, offset) => rampWeekLabel(weeklyLens.startWeek + offset))
        : Array.from({ length: (lensEnd - lensStart) + 1 }, (_, offset) => {
          const day = lensStart + offset;
          return day === 0 ? 'D0' : `D+${day}`;
        });
      const title = $('chart-normalized-title');
      if (title) {
        title.textContent = isHealth
          ? 'Ritmo de venda'
          : rampMetric.label;
      }
      const titleHelp = $('chart-normalized-help');
      if (titleHelp) {
        titleHelp.dataset.tooltip = rampMetric.tooltip || 'Alinha todos os modelos pelo D0 ate a data atual disponivel no snapshot. Fat. mes e Pedidos mes usam blocos comerciais de 30 dias desde o D0. Ausencia depois do ultimo dado fica vazia, nunca zero.';
      }
      if (subText) {
        const weeklyEndDay = weeklyLens ? Math.min(maxDay, rampWeekEndDay(weeklyLens.endWeek)) : maxDay;
        const coverage = isWeekly
          ? `${rampWeekLabel(weeklyLens.startWeek)} a ${rampWeekLabel(weeklyLens.endWeek)} · ${rampWeekStartDay(weeklyLens.startWeek) === 0 ? 'D0' : `D+${fmtNum(rampWeekStartDay(weeklyLens.startWeek))}`} a D+${fmtNum(weeklyEndDay)}${weeklyEndDay < rampWeekEndDay(weeklyLens.endWeek) ? ' parcial' : ''}`
          : isMonthly || lensBounds.key === 'all'
          ? `D0 a D+${fmtNum(maxDay)} (${fmtDateSlash(snapshotIso())})`
          : `${rampTimeLensLabel(lensBounds)} · curva total ate D+${fmtNum(maxDay)} (${fmtDateSlash(snapshotIso())})`;
        if (isRps) {
          subText.textContent = `Curva MM7 com referência fixa e guias 90/75 - ${coverage}`;
        } else if (isShare) {
          const periodWord = isMonthly ? 'mes' : 'semana';
          subText.textContent = `Share de vendas por ${periodWord} de vida comercial - ${coverage}`;
        } else {
        subText.textContent = isMonthly
          ? isShare
            ? `${rampMetric.shortLabel} da receita da empresa por mes de vida comercial · ${coverage}`
            : `${rampMetric.shortLabel} por mes de vida comercial · ${coverage}`
          : isShare
            ? `${rampMetric.shortLabel} da receita da empresa por semana de vida comercial · ${coverage}`
          : isHealth
            ? `Semanas fechadas desde o D0; o losango marca a primeira estabilizacao confirmada · ${coverage}`
            : `${rampMetric.shortLabel} acumulado por dia desde o lancamento · ${coverage}`;
      }
        }
      const selectedLineLaunches = normalizedLaunches.filter((launch) => launch.modelo_id === selected.modelo_id);
      const visibleLineLaunches = isRps
        ? (selectedLineLaunches.length ? selectedLineLaunches : [selected])
        : normalizedLaunches;
      createChart(canvasId, {
        type: 'line',
        data: {
          labels: normalizedLabels,
          datasets: [
            ...(isRps ? rpsRulerChartDatasets(selected, normalizedLaunches, maxDay, lensStart, lensEnd) : []),
            ...visibleLineLaunches.map((launch, index) => {
              const filteredSeries = isProductFilterActive() || isChannelFilterActive();
              const series = isRps
                ? rpsRampDatasetData(launch, rampMetric, maxDay)
                : isShare
                ? shareRampDatasetData(launch, rampMetric, maxDay)
                : isHealth
                ? rampHealthChartDatasetData(launch, maxDay)
                : rampMetric.cumulative
                  ? cumulativeRampDatasetData(launch, rampMetric, maxDay)
                  : monthlyRampDatasetData(launch, rampMetric, maxDay);
              const sourceData = series.data;
              const data = isMonthly
                ? sourceData
                : isWeekly
                  ? Array.from(
                    { length: (weeklyLens.endWeek - weeklyLens.startWeek) + 1 },
                    (_, offset) => sourceData[weeklyLens.startWeek + offset] ?? null
                  )
                  : sourceData.slice(lensStart, lensEnd + 1);
              const hasDaily = Boolean(series.sourceRows?.length);
              const isBackfilled = launch.daily_source === 'historico_backfill';
              const validDataDays = data
                .map((value, day) => value !== null && value !== undefined ? day : null)
                .filter((day) => day !== null);
              const lastDataIndex = isWeekly
                ? numberOrNull(series.lastDataIndex)
                : numberOrNull(series.lastDataDay) ?? (validDataDays.length ? Math.max(...validDataDays) : null);
              const isSelected = launch.modelo_id === selected.modelo_id;
              const lineColor = colorFor(launch.modelo_id, index);
              const fillColor = fillFor(launch.modelo_id, index);
              const sourceLabel = isRps
                ? 'lancamentos_rps_dia.json'
                : isShare
                ? series.sourceLabel
                : isHealth
                ? series.sourceLabel
                : filteredSeries
                  ? 'diario filtrado do export SSOT'
                  : isBackfilled
                    ? 'backfill diario a partir das janelas acumuladas'
                    : hasDaily
                      ? 'diario real'
                      : 'sem serie diaria';
              return {
                label: isRps && isSelected
                  ? `${launch.modelo} (RPS MM7)`
                  : isBackfilled && !filteredSeries ? `${launch.modelo} - backfill` : launch.modelo,
                data,
                borderColor: lineColor,
                backgroundColor: fillColor,
                borderWidth: isRps ? (isSelected ? 3 : 1.5) : isSelected ? 3 : 2,
                borderDash: isRps && !isSelected
                  ? [2, 4]
                  : !isMonthly && !isHealth && !isShare && isBackfilled && !filteredSeries ? [4, 4] : [],
                fill: isRps ? false : !isMonthly && !isHealth && !isShare && isSelected ? 'origin' : false,
                hidden: isRps && !isSelected,
                pointRadius: (ctx) => {
                  const periodIndex = isMonthly ? ctx.dataIndex : isWeekly ? weeklyLens.startWeek + ctx.dataIndex : lensStart + ctx.dataIndex;
                  if (data[ctx.dataIndex] === null || data[ctx.dataIndex] === undefined) return 0;
                  if (isHealth) {
                    const meta = series.healthMeta?.[periodIndex];
                    if (!meta) return 0;
                    if (meta.isStabilization) return isSelected ? 7 : 6;
                    if (periodIndex === lastDataIndex) return isSelected ? 4 : 3;
                    return (periodIndex === 0 || (periodIndex + 1) % 4 === 0) ? (isSelected ? 3 : 2) : 0;
                  }
                  if (isRps) {
                    if (periodIndex === lastDataIndex) return isSelected ? 4 : 3;
                    return (MILESTONE_DAYS.includes(periodIndex) || periodIndex % 30 === 0) ? (isSelected ? 2 : 0) : 0;
                  }
                  if (isMonthly) return isSelected ? 4 : 3;
                  if (periodIndex === lastDataIndex) return isSelected ? 4 : 3;
                  return (MILESTONE_DAYS.includes(periodIndex) || periodIndex % 30 === 0) ? (isSelected ? 3 : 2) : 0;
                },
                pointStyle: (ctx) => {
                  const periodIndex = isMonthly ? ctx.dataIndex : isWeekly ? weeklyLens.startWeek + ctx.dataIndex : lensStart + ctx.dataIndex;
                  return isHealth && series.healthMeta?.[periodIndex]?.isStabilization ? 'rectRot' : 'circle';
                },
                pointHoverRadius: (ctx) => {
                  const periodIndex = isMonthly ? ctx.dataIndex : isWeekly ? weeklyLens.startWeek + ctx.dataIndex : lensStart + ctx.dataIndex;
                  return isHealth && series.healthMeta?.[periodIndex]?.isStabilization ? 8 : 6;
                },
                pointHitRadius: 10,
                pointBackgroundColor: colorFor(launch.modelo_id, index),
                pointBorderColor: (ctx) => {
                  const periodIndex = isMonthly ? ctx.dataIndex : isWeekly ? weeklyLens.startWeek + ctx.dataIndex : lensStart + ctx.dataIndex;
                  return isHealth && series.healthMeta?.[periodIndex]?.isStabilization ? '#FFFFFF' : '#1A1A1A';
                },
                pointBorderWidth: (ctx) => {
                  const periodIndex = isMonthly ? ctx.dataIndex : isWeekly ? weeklyLens.startWeek + ctx.dataIndex : lensStart + ctx.dataIndex;
                  return isHealth && series.healthMeta?.[periodIndex]?.isStabilization ? 2 : 1;
                },
                tension: isRps ? 0.28 : isMonthly ? 0.26 : 0.32,
                spanGaps: isRps,
                sourceLabel,
                healthMeta: series.healthMeta || null,
                shareMeta: series.shareMeta || null,
                rpsMeta: series.rpsMeta || null,
                metricKey: rampMetric.key
              };
            }),
            ...(isHealth ? rampHealthReferenceDatasets(weeklyLens.endWeek, { start: weeklyLens.startWeek, end: weeklyLens.endWeek }) : [])
          ]
        },
        options: chartOptions({
          layout: { padding: { top: isRps ? 22 : 8, right: 12, bottom: 2, left: 2 } },
          interaction: isHealth || isRps
            ? { mode: 'nearest', intersect: false, axis: 'xy' }
            : { mode: 'index', intersect: false },
          plugins: {
            rpsPhaseBands: {
              enabled: isRps,
              bands: isRps ? rpsPhaseBandsForLens(maxDay, lensStart, lensEnd) : []
            },
            legend: isHealth || isRps
              ? {
                position: 'bottom',
                labels: {
                  filter: (item, data) => {
                    const dataset = data.datasets[item.datasetIndex];
                    if (isHealth && dataset?.isHealthReference) return false;
                    if (isRps && dataset?.isRpsBandAnchor) return false;
                    if (isRps && dataset?.hidden) return false;
                    return true;
                  },
                  usePointStyle: true,
                  boxWidth: 8,
                  boxHeight: 8,
                  padding: 16
                }
              }
              : { position: 'bottom' },
            tooltip: {
              position: isHealth || isRps ? 'nearest' : 'average',
              filter: (item) => !item.dataset.isHealthReference && !item.dataset.isRpsReferenceBand,
              callbacks: {
                title: (items) => {
                  const index = items[0]?.dataIndex ?? 0;
                  const day = lensStart + index;
                  const weekIndex = weeklyLens ? weeklyLens.startWeek + index : null;
                  return isMonthly
                    ? `${items[0]?.label || ''} · ${rampPeriodRangeLabel(index, rampMetric)}`
                    : isWeekly
                      ? `${rampWeekLabel(weekIndex)} · ${rampPeriodRangeLabel(weekIndex, rampMetric, isShare ? Math.min(maxDay, rampWeekEndDay(weekIndex)) : null)}`
                      : (day === 0 ? 'D0' : `D+${day}`);
                },
                label: (ctx) => isHealth
                  ? `${ctx.dataset.label}: ${formatRampValue(ctx.parsed.y, rampMetric)} do pico`
                  : `${ctx.dataset.label}: ${formatRampValue(ctx.parsed.y, rampMetric)}`,
                afterLabel: (ctx) => {
                  if (isShare) {
                    const periodIndex = isMonthly ? ctx.dataIndex : weeklyLens.startWeek + ctx.dataIndex;
                    const meta = ctx.dataset.shareMeta?.[periodIndex];
                    if (!meta) return 'Share pendente: sem denominador de vendas da empresa no periodo.';
                    const period = rampPeriodRangeLabel(periodIndex, rampMetric, meta.lastDay);
                    const filterNote = meta.filteredNumerator
                      ? 'Numerador respeita produto/cor/canal filtrado; denominador permanece vendas totais da empresa.'
                      : 'Numerador e denominador vindos do share_trajetoria.';
                    return [
                      `Periodo: ${period}`,
                      `Vendas produto: ${fmtBRL(meta.productRevenue)} · Vendas empresa: ${fmtBRL(meta.companyRevenue)}`,
                      `${filterNote} Fonte: ${ctx.dataset.sourceLabel}.`
                    ];
                  }
                  if (isRps) {
                    const day = lensStart + ctx.dataIndex;
                    if (ctx.dataset.isRpsRulerMedian) {
                      const bench = ctx.dataset.rpsRulerMeta?.[day];
                      if (!bench) return 'Referência pendente para este D+.';
                      const source = bench.basisLabel || bench.sourceLabel || 'referência própria';
                      return [
                        `Referência 100%: ${fmtBRL(bench.median)} | ${source}`,
                        `Faixa: ${fmtBRL(bench.lower)} a ${fmtBRL(bench.p75)}`,
                        'Metodo: soma(receita) / soma(sessoes) na janela da fase.',
                        'Leitura: referência operacional da fase, não meta estatística calibrada.'
                      ];
                    }
                    if (ctx.dataset.isRpsGuideLine) {
                      const bench = ctx.dataset.rpsRulerMeta?.[day];
                      if (!bench) return 'Guia pendente para este D+.';
                      const ratio = numberOrNull(ctx.dataset.rpsGuideRatio);
                      const threshold = ratio === null ? ctx.parsed.y : bench.median * ratio;
                      return [
                        `${ctx.dataset.label}: ${fmtBRL(threshold)} (${fmtPct(ratio, 0)} da referência)`,
                        `Referência 100%: ${fmtBRL(bench.median)}.`,
                        'Guia visual provisório; ainda não é corte calibrado pelo histórico.'
                      ];
                    }
                    const meta = ctx.dataset.rpsMeta?.[day];
                    if (!meta) return 'RPS pendente: sem sessões ShopifyQL para esta data.';
                    return [
                      `Janela MM7: ${rpsPeriodLabel(meta)} | Receita ${fmtBRL(meta.receita)} | Sessoes ${fmtNum(meta.sessoes)}`,
                      `Dia bruto: ${fmtBRL(meta.daily_rps)} | Receita ${fmtBRL(meta.daily_receita_total)} | Sessoes ${fmtNum(meta.daily_sessoes)}`,
                      `Pedidos validos na janela: ${meta.pedidos === null ? 'pendente' : fmtNum(meta.pedidos)}`,
                      'Fonte: bridge_orders_customers + shopify_sessions_daily.'
                    ];
                  }
                  if (isHealth) {
                    const meta = ctx.dataset.healthMeta?.[weeklyLens.startWeek + ctx.dataIndex];
                    if (!meta) return 'Ainda nao ha uma semana completa neste ponto.';
                    const weeklyChange = meta.changePct === null
                      ? 'Vs. semana anterior: pendente'
                      : `Vs. semana anterior: ${fmtSignedPct(meta.changePct, 0)} (${meta.direction})`;
                    const stabilization = meta.isStabilization && meta.stabilization
                      ? `Estabilizou nesta semana (D+${fmtNum(meta.stabilization.confirmedDay)})`
                      : null;
                    return [
                      weeklyChange,
                      `Ritmo: ${fmtBRL(meta.currentMm7)}/dia · ${fmtNum(meta.currentOrdersMm7, 1)} pedidos/dia`,
                      ...(stabilization ? [stabilization] : [])
                    ];
                  }
                  const modeCopy = isMonthly
                    ? 'Blocos mensais de 30 dias desde D0; vazio apos o ultimo dado carregado.'
                    : 'Curva acumulada desde D0; vazio apos o ultimo dado carregado.';
                  return `Fonte: ${ctx.dataset.sourceLabel}. ${modeCopy}`;
                }
              }
            }
          },
          scales: {
            x: {
              grid: { display: false },
              ticks: {
                autoSkip: isMonthly,
                maxRotation: 0,
                callback: (_, index) => {
                  if (isMonthly) return rampMonthLabel(index);
                  if (isWeekly) return rampWeekLabel(weeklyLens.startWeek + index);
                  const day = lensStart + index;
                  if (index === 0 || day === lensEnd) return day === 0 ? 'D0' : `D+${day}`;
                  return rampDailyTickLabel(day, lensEnd);
                }
              }
            },
            y: {
              ...(isHealth ? { beginAtZero: true, min: 0, max: 1 } : {}),
              ...(isShare ? { beginAtZero: true, min: 0, suggestedMax: 0.3 } : {}),
              ...(isRps ? { beginAtZero: true } : {}),
              ticks: { callback: (v) => formatRampValue(v, rampMetric, true) },
              grid: { color: 'rgba(255,255,255,0.045)' }
            }
          }
        })
      });
      if (canvasId === 'chart-normalized') {
        renderRampPeriodAnalysis(selected, normalizedLaunches);
        renderRampHealthInsight(selected);
      }
      return;
    }

    if (canvasId === 'chart-normalized') {
      renderRampPeriodAnalysis(selected);
      renderRampHealthInsight(selected);
    }

    const comparisonMetric = rampMetricConfig('receita_acumulada');
    const sharedOptions = (dates, checkpoints) => chartOptions({
      layout: { padding: { top: 34, right: 18, bottom: 6, left: 4 } },
      plugins: {
        legend: { position: 'bottom' },
        launchCheckpoints: { checkpoints },
        tooltip: {
          callbacks: {
            title: (items) => fmtDateSlash(items[0]?.label),
            label: (ctx) => `${ctx.dataset.label}: ${formatRampValue(ctx.parsed.y, comparisonMetric)}`
          }
        }
      },
      scales: {
        x: { grid: { display: false }, ticks: { autoSkip: true, maxRotation: 0, callback: (_, idx) => fmtDateSlash(dates[idx]) } },
        y: { ticks: { callback: (v) => formatRampValue(v, comparisonMetric, true) }, grid: { color: 'rgba(255,255,255,0.045)' } }
      }
    });

    if (mode === 'canibal-linhas') {
      const title = $('chart-normalized-title');
      const titleHelp = $('chart-normalized-help');
      if (title) title.textContent = 'Faturamento entre linhas';
      if (titleHelp) titleHelp.dataset.tooltip = 'Compara faturamento diario por data real para enxergar sobreposicao entre lancamentos e linhas.';
      if (subText) subText.textContent = 'Faturamento diario por linha, alinhado por data real';
      const { dates, datasets, checkpoints } = buildCannibalTimelineData(comparableLaunches());
      if (!dates.length || !datasets.length) return;
      createChart(canvasId, { type: 'line', data: { labels: dates, datasets }, options: sharedOptions(dates, checkpoints) });
      return;
    }

    if (mode === 'canibal-submodelos') {
      const lineId = state.canibalLineFilter || selected.modelo_id;
      const lineLaunch = state.launches.find((launch) => launch.modelo_id === lineId);
      const title = $('chart-normalized-title');
      const titleHelp = $('chart-normalized-help');
      if (title) title.textContent = 'Faturamento dentro da linha';
      if (titleHelp) titleHelp.dataset.tooltip = 'Compara subprodutos da linha por data real para mostrar concentracao ou dispersao de venda.';
      if (subText) subText.textContent = `Sub-produtos dentro de ${lineLaunch?.linha || lineLaunch?.modelo || lineId} · ${rampMetric.shortLabel} diario`;
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

    const available = availableComparisonLaunches();
    const primaryPool = available.length ? available : comparable;
    if (!primaryPool.some((launch) => launch.modelo_id === state.primaryModelId)) {
      state.primaryModelId = defaultComparableLaunch(primaryPool)?.modelo_id || primaryPool[0].modelo_id;
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
        <div class="metric-label">${labelTip('Destaque visual', `Receita do lançamento destacado na janela fechada ${label}. Cada modelo usa sua própria data de lançamento como início da contagem.`)}</div>
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
          <td class="num">${comparisonAttributionCell(attribution.receita_organica, attribution.pedidos_organicos, attribution.pares_organicos)}</td>
          <td class="num">${comparisonAttributionCell(attribution.receita_paga, attribution.pedidos_pagos, attribution.pares_pagos)}</td>
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

  function comparisonAttributionCell(revenue, orders, pairs = null) {
    const revenueValue = numberOrNull(revenue);
    if (revenueValue === null) {
      return '<span class="cell-muted">Aguardando vendas</span><div class="metric-sub">canal ainda não exportado</div>';
    }
    const orderValue = numberOrNull(orders);
    const pairValue = numberOrNull(pairs);
    const orderCopy = orderValue === null
      ? 'pedidos aguardando'
      : `${fmtNum(orderValue)} ${orderValue === 1 ? 'pedido' : 'pedidos'} atribuidos`;
    const pairCopy = pairValue !== null && pairValue !== orderValue
      ? ` &middot; ${fmtNum(pairValue)} ${pairValue === 1 ? 'par' : 'pares'}`
      : '';
    return `${organicPaidValue(revenueValue)}<div class="metric-sub">${orderCopy}${pairCopy}</div>`;
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
      investimento: { key: 'investimento', label: 'Investimento acumulado', short: 'Invest.', type: 'bar', unit: 'currency', help: 'Investimento vem da planilha principal, somando midia_paga.json e crm_disparos.json na janela do lancamento. A planilha diaria nao entra neste calculo.' },
      receita: { key: 'receita', label: 'Receita midia paga', short: 'Receita', type: 'bar', unit: 'currency', help: 'Receita com sinais de anuncio, como cpc, pmax, paid, demand-gen, performance, ads, display ou source_type pago.' },
      roas: { key: 'roas', label: 'ROAS midia paga', short: 'ROAS', type: 'line', unit: 'ratio', help: 'Receita dos pedidos de midia paga dividida pelo investimento declarado na janela. So calcula quando existe midia paga cadastrada na mesma janela.' },
      cpa: { key: 'cpa', label: 'CPA midia paga', short: 'CPA', type: 'line', unit: 'currency', help: 'Investimento total dividido pelos pedidos classificados como pagos pelo SSOT.' },
      cpp: { key: 'cpp', label: 'CPP', short: 'CPP', type: 'line', unit: 'currency', help: 'Investimento total dividido pelos pares vendidos do lançamento na janela.' },
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

  function medianNumber(values, digits = 4) {
    const valid = values
      .map((value) => numberOrNull(value))
      .filter((value) => value !== null)
      .sort((a, b) => a - b);
    if (!valid.length) return null;
    const mid = Math.floor(valid.length / 2);
    const value = valid.length % 2 ? valid[mid] : (valid[mid - 1] + valid[mid]) / 2;
    const factor = 10 ** digits;
    return Math.round(value * factor) / factor;
  }

  function directClientPayload() {
    const payload = state.data?.lancamentos_clientes_janelas;
    if (Array.isArray(payload)) return { janelas: payload, base_atual: null };
    return payload && Array.isArray(payload.janelas) ? payload : null;
  }

  function directClientRows() {
    return directClientPayload()?.janelas || [];
  }

  function directClientWindow(modelId, key) {
    return directClientRows().find((row) => row.modelo_id === modelId && row.janela === key) || null;
  }

  function directCurrentBase() {
    const payload = directClientPayload();
    return numberOrNull(payload?.base_atual?.base_atual_clientes)
      ?? medianNumber(directClientRows().map((row) => row.base_atual_clientes), 0);
  }

  function mergeDirectClientSales(sales, clientRow) {
    if (!clientRow) return sales;
    const merged = sales ? { ...sales } : {};
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
      const baseD0 = numberOrNull(merged.base_total_d0);
      const clientesBase = numberOrNull(merged.clientes_base_compraram);
      merged.pct_base_ativada = baseD0 ? clientesBase / baseD0 : null;
    }
    merged.clientes_status = clientRow.status || null;
    merged.clientes_qualidade = clientRow.qualidade || 'pendente';
    merged.clientes_fonte = clientRow.fonte || 'lancamentos_clientes_janelas';
    return merged;
  }

  function directClientForecast(key) {
    const baseAtual = directCurrentBase();
    if (baseAtual === null) return null;
    const rows = directClientRows().filter((row) => (
      row.janela === key
      && normalizeText(row.status) === 'fechada'
      && numberOrNull(row.clientes_unicos) !== null
      && numberOrNull(row.base_total_d0) !== null
      && numberOrNull(row.base_total_d0) > 0
    ));
    if (!rows.length) return null;

    const taxaClientes = medianNumber(rows.map((row) => {
      const baseD0 = numberOrNull(row.base_total_d0);
      return baseD0 ? numberOrNull(row.clientes_unicos) / baseD0 : null;
    }), 6);
    const pedidosPorCliente = medianNumber(rows.map((row) => row.pedidos_por_cliente), 4);
    const paresPorCliente = medianNumber(rows.map((row) => row.pares_por_cliente ?? row.unidades_por_cliente), 4);
    const receitaPorCliente = medianNumber(rows.map((row) => row.receita_por_cliente), 2);
    const clientesEsperados = taxaClientes === null ? null : Math.round(baseAtual * taxaClientes);
    return {
      clientes_esperados: clientesEsperados,
      pedidos_esperados: clientesEsperados !== null && pedidosPorCliente !== null ? Math.round(clientesEsperados * pedidosPorCliente) : null,
      pares_esperados: clientesEsperados !== null && paresPorCliente !== null ? Math.round(clientesEsperados * paresPorCliente) : null,
      receita_esperada: clientesEsperados !== null && receitaPorCliente !== null ? Math.round(clientesEsperados * receitaPorCliente * 100) / 100 : null,
      metodo: 'front_overlay_base_atual_x_mediana_historica',
      observacao: 'Estimativa direta do JSON agregado de clientes; nao e forecast causal.'
    };
  }

  function advancedPayload() {
    const payload = state.data?.lancamentos_analise_avancada;
    return payload && !Array.isArray(payload) ? payload : null;
  }

  function advancedModelFor(launch) {
    return advancedPayload()?.modelos?.[launch?.modelo_id] || null;
  }

  function advancedWindowFor(launch, key) {
    const base = advancedModelFor(launch)?.janelas?.[key] || null;
    const clientRow = directClientWindow(launch?.modelo_id, key);
    if (!clientRow) return base;
    return {
      ...(base || {}),
      label: base?.label || windowLabel(key),
      start_day: base?.start_day ?? 0,
      end_day: base?.end_day ?? numberOrNull(clientRow.window_day),
      start_date: base?.start_date || clientRow.start_date || null,
      end_date: base?.end_date || clientRow.end_date || null,
      status: clientRow.status || base?.status || null,
      vendas: mergeDirectClientSales(base?.vendas || null, clientRow),
      investimento: base?.investimento || null,
      roas: base?.roas || null
    };
  }

  function advancedCell(value, formatter = fmtNum, pending = 'Pendente') {
    const numeric = numberOrNull(value);
    if (numeric === null) return `<span class="cell-muted">${escapeHtml(pending)}</span>`;
    return formatter(numeric);
  }

  function advancedRatioCell(value, digits = 1) {
    const numeric = numberOrNull(value);
    return numeric === null ? '<span class="cell-muted">Pendente</span>' : fmtPct(numeric, digits);
  }

  function advancedStatusBadge(status) {
    const normalized = normalizeText(status);
    if (normalized === 'fechada') return badge('pipeline', 'fechada', 'Janela comparavel fechada no JSON atual.');
    if (normalized === 'janela aberta') return badge('parcial', 'aberta', 'Janela ainda nao completou todos os dias; ausencia nao vira zero.');
    if (normalized === 'sem dados') return badge('parcial', 'sem dado', 'Ainda nao existe venda carregada para esta janela.');
    return badge('parcial', status || 'pendente');
  }

  function advancedQualityBadge(quality) {
    const normalized = normalizeText(quality);
    if (normalized === 'real') return badge('pipeline', 'real', 'Classificacao por pedido/origem granular disponivel.');
    if (normalized === 'alocado ssot') return badge('parcial', 'alocado', 'Valor alocado pelo SSOT; leitura de mix, nao causalidade absoluta.');
    if (normalized === 'inferido') return badge('parcial', 'inferido', 'Classificacao por campos de origem do pedido.');
    if (normalized === 'misto') return badge('parcial', 'misto', 'Combina origem real, inferida ou alocada.');
    return badge('parcial', 'pendente', 'Canal ainda nao disponivel.');
  }

  function advancedRoasCell(roas) {
    const value = numberOrNull(roas?.midia_paga);
    if (value !== null) {
      return `${fmtNum(value, 2)}x<div class="metric-sub">${escapeHtml(roas.status || '')}</div>`;
    }
    const status = normalizeText(roas?.status);
    const label = status.includes('investimento declarado') ? 'ROAS pendente' : 'sem ROAS';
    return `<span class="cell-muted">${escapeHtml(label)}</span><div class="metric-sub">${escapeHtml(roas?.observacao || 'sem base confiavel')}</div>`;
  }

  function advancedSelectedLaunches() {
    return selectedCompareLaunches().filter((launch) => !launch.isFuture || advancedModelFor(launch));
  }

  function renderAdvancedClients() {
    const wrap = $('advanced-clients');
    if (!wrap) return;
    const payload = advancedPayload();
    const launches = advancedSelectedLaunches();
    if (!payload || !launches.length) {
      wrap.innerHTML = `<div class="empty-state"><div><strong>Sem dados avancados.</strong>Gere data/lancamentos_analise_avancada.json e selecione ao menos um lancamento comparavel.</div></div>`;
      return;
    }

    const rows = launches.flatMap((launch) => WINDOW_KEYS.map((key) => {
      const win = advancedWindowFor(launch, key);
      return { launch, key, win, vendas: win?.vendas || null };
    }));
    const baseAtualClientes = directCurrentBase() ?? numberOrNull(payload.proximos_lancamentos?.base_atual_clientes);
    const directPayload = directClientPayload();
    const directForecast = directClientForecast(selectedPeriodKey());
    const advancedForecast = payload.proximos_lancamentos?.janelas?.[selectedPeriodKey()] || null;
    const forecast = directForecast?.receita_esperada !== null && directForecast?.receita_esperada !== undefined
      ? directForecast
      : advancedForecast || directForecast;
    const missingClients = rows.filter((row) => row.vendas?.clientes_unicos === null || row.vendas?.clientes_unicos === undefined).length;

    wrap.innerHTML = `
      <div class="advanced-summary-grid">
        <div class="advanced-summary-card">
          <span>Base atual</span>
          <strong>${advancedCell(baseAtualClientes, fmtNum)}</strong>
          <small>${escapeHtml(directPayload?.base_atual?.fonte || payload.proximos_lancamentos?.base_atual_fonte || 'pendente no SSOT')}</small>
        </div>
        <div class="advanced-summary-card">
          <span>Proximo lancamento</span>
          <strong>${forecast?.receita_esperada === null || forecast?.receita_esperada === undefined ? '&mdash;' : fmtBRL(forecast.receita_esperada)}</strong>
          <small>${forecast ? `${selectedPeriodLabel()} &middot; ${advancedCell(forecast.clientes_esperados, fmtNum, 'clientes pend.')} clientes &middot; ${advancedCell(forecast.pedidos_esperados, fmtNum, 'pedidos pend.')} pedidos &middot; ${advancedCell(forecast.pares_esperados, fmtNum, 'pares pend.')} pares` : 'sem referencia'}</small>
        </div>
        <div class="advanced-summary-card">
          <span>Clientes unicos</span>
          <strong>${missingClients ? 'Pendente' : 'Carregado'}</strong>
          <small>Export agregado do SSOT; nao inferir por pedido</small>
        </div>
      </div>
      <div class="table-wrap advanced-table-wrap">
        <table style="min-width:1320px">
          <thead>
            <tr>
              ${thTip('Lancamento', 'Modelo e D0 analitico.')}
              ${thTip('Janela', 'D+7, D+15, D+30, D+60 e D+90, sempre desde D0.')}
              ${thTip('Clientes unicos', 'Exige export agregado do SSOT sem PII.', 'num')}
              ${thTip('Novos', 'Clientes cuja primeira compra valida ocorreu no periodo do lancamento.', 'num')}
              ${thTip('Recorrentes', 'Clientes ja existentes antes do D0 que compraram no lancamento.', 'num')}
              ${thTip('Receita/cliente', 'Receita da janela dividida por clientes unicos.', 'num')}
              ${thTip('Pedidos/cliente', 'Pedidos distintos da janela divididos por clientes unicos.', 'num')}
              ${thTip('Pares/cliente', 'Pares vendidos divididos por clientes unicos.', 'num')}
              ${thTip('% base ativada', 'Clientes recorrentes compradores / base total antes do D0.', 'num')}
              ${thTip('Proxy atual', 'Classificacao atual de novos/recorrentes por pedido; nao substitui cliente unico.', 'num')}
              ${thTip('Status', 'Fechada, aberta, sem dados ou pendente.')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ launch, key, win, vendas }) => `
              <tr class="${key === selectedPeriodKey() ? 'is-selected-window' : ''}">
                <td class="model-name">${escapeHtml(launch.modelo)}<div class="metric-sub">D0: ${fmtDate(launch.d0)}</div></td>
                <td>${escapeHtml(windowLabel(key))}<div class="metric-sub">${escapeHtml(win?.start_date || 'sem data')} a ${escapeHtml(win?.end_date || 'sem data')}</div></td>
                <td class="num">${advancedCell(vendas?.clientes_unicos, fmtNum)}</td>
                <td class="num">${advancedCell(vendas?.novos_clientes, fmtNum)}</td>
                <td class="num">${advancedCell(vendas?.recorrentes_clientes, fmtNum)}</td>
                <td class="num">${advancedCell(vendas?.receita_por_cliente, fmtBRL)}</td>
                <td class="num">${advancedCell(vendas?.pedidos_por_cliente, (value) => fmtNum(value, 2))}</td>
                <td class="num">${advancedCell(vendas?.pares_por_cliente, (value) => fmtNum(value, 2))}</td>
                <td class="num">${advancedRatioCell(vendas?.pct_base_ativada, 2)}</td>
                <td class="num">${advancedCell(vendas?.pedidos_classificados_novos, fmtNum)}<div class="metric-sub">${advancedCell(vendas?.pedidos_classificados_recorrentes, fmtNum)} recorr.</div></td>
                <td>${advancedStatusBadge(win?.status)}${vendas?.clientes_unicos == null ? '<div class="metric-sub">aguarda data/lancamentos_clientes_janelas.json</div>' : ''}</td>
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function lifePeakLine(peak) {
    if (!peak) return '<span class="cell-muted">Pendente</span>';
    return `D+${fmtNum(peak.day)}<div class="metric-sub">${fmtDate(peak.data)} &middot; ${fmtBRL(peak.receita)}</div>`;
  }

  function renderAdvancedLifecycle() {
    const wrap = $('advanced-lifecycle');
    if (!wrap) return;
    const launches = advancedSelectedLaunches().filter((launch) => advancedModelFor(launch));
    if (!advancedPayload() || !launches.length) {
      wrap.innerHTML = `<div class="empty-state"><div><strong>Sem rampa avancada.</strong>Gere o JSON avancado para ver vida util e marcos acumulados.</div></div>`;
      return;
    }

    wrap.innerHTML = `
      <div class="advanced-card-grid">
        ${launches.map((launch) => {
          const model = advancedModelFor(launch);
          const ramp = model?.rampa_estendida || {};
          const life = ramp.vida_util || {};
          const isLimited = model?.disponibilidade?.export_atual_limitado_a_d90;
          const soldDay = numberOrNull(model?.disponibilidade?.ultimo_dia_com_venda) ?? numberOrNull(model?.disponibilidade?.ultimo_dia_disponivel);
          const exportedDay = numberOrNull(model?.disponibilidade?.ultimo_dia_exportado) ?? soldDay;
          const coverageTip = soldDay !== null && exportedDay !== null && exportedDay > soldDay
            ? `Export cobre ate D+${fmtNum(exportedDay)}; ultimo dia com venda registrada D+${fmtNum(soldDay)}.`
            : 'Ultimo dia coberto ou observado no JSON.';
          return `
            <div class="card advanced-life-card">
              <div class="advanced-card-head">
                <div>
                  <span class="launch-card-kicker">${escapeHtml(launch.linha || launch.modelo)}</span>
                  <h3>${escapeHtml(launch.modelo)}</h3>
                </div>
                ${isLimited ? badge('parcial', 'ate D+90', 'O export atual ainda nao traz pos-D90 para historicos.') : badge('pipeline', `D+${fmtNum(exportedDay)}`, coverageTip)}
              </div>
              <div class="advanced-kpi-grid">
                <div><span>Receita estendida</span><strong>${advancedCell(ramp.vendas?.receita, fmtBRL)}</strong><small>${escapeHtml(ramp.start_date || 'sem data')} a ${escapeHtml(ramp.end_date || 'sem data')}</small></div>
                <div><span>Pico receita</span><strong>${lifePeakLine(life.peak_revenue_day)}</strong><small>maior dia de faturamento</small></div>
                <div><span>50 / 80 / 90%</span><strong>${advancedCell(life.days_to_50pct_revenue, (v) => `D+${fmtNum(v)}`)} &middot; ${advancedCell(life.days_to_80pct_revenue, (v) => `D+${fmtNum(v)}`)} &middot; ${advancedCell(life.days_to_90pct_revenue, (v) => `D+${fmtNum(v)}`)}</strong><small>tempo ate receita acumulada</small></div>
                <div><span>Queda pos-pico</span><strong>${advancedRatioCell(life.post_peak_decay_pct, 1)}</strong><small>7 dias depois do pico vs semana do pico</small></div>
                <div><span>Vida comercial</span><strong>${advancedCell(life.commercial_life_days, (v) => `D+${fmtNum(v)}`)}</strong><small>${escapeHtml(life.leitura || 'pendente')}</small></div>
                <div><span>Hype / sustentacao</span><strong>${advancedRatioCell(life.hype_initial_revenue_pct, 1)} &middot; ${advancedRatioCell(life.sustain_revenue_pct, 1)}</strong><small>D+7 da receita &middot; pos D+15</small></div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  }

  function renderAdvancedChannelsRoas() {
    const wrap = $('advanced-channels-roas');
    if (!wrap) return;
    const launches = advancedSelectedLaunches().filter((launch) => advancedModelFor(launch));
    if (!advancedPayload() || !launches.length) {
      wrap.innerHTML = '';
      return;
    }

    const rows = launches.flatMap((launch) => WINDOW_KEYS.map((key) => ({
      launch,
      key,
      win: advancedWindowFor(launch, key)
    })));

    wrap.innerHTML = `
      <p class="actions-module-label">Canais e ROAS ajustado</p>
      <div class="table-wrap advanced-table-wrap">
        <table style="min-width:1500px">
          <thead>
            <tr>
              ${thTip('Lancamento', 'Modelo comparado.')}
              ${thTip('Janela', 'Janela relativa ao D0 do lancamento.')}
              ${thTip('Midia paga', 'Receita e pedidos classificados como paid pelo SSOT.', 'num')}
              ${thTip('Organico', 'Pedidos classificados como WhatsApp Organico, E-mail, Direto, Social, Organico ou Outros.', 'num')}
              ${thTip('CRM', 'Investimento CRM separado; receita de CRM so aparece com atribuicao real.', 'num')}
              ${thTip('Invest. midia', 'Somente midia_paga.json; CRM nao entra como midia paga.', 'num')}
              ${thTip('Invest. CRM', 'crm_disparos.json na janela do lancamento.', 'num')}
              ${thTip('Invest. total', 'Midia paga + CRM + outros, quando existirem.', 'num')}
              ${thTip('ROAS midia', 'Receita de midia paga / investimento de midia paga, apenas com ressalva de qualidade.', 'num')}
              ${thTip('Qualidade', 'Real, alocado, inferido ou pendente.')}
            </tr>
          </thead>
          <tbody>
            ${rows.map(({ launch, key, win }) => {
              const vendas = win?.vendas || {};
              const paid = vendas.canais?.paid || {};
              const organic = vendas.canais?.organic || {};
              const crm = vendas.canais?.crm || {};
              const investment = win?.investimento || {};
              return `
                <tr class="${key === selectedPeriodKey() ? 'is-selected-window' : ''}">
                  <td class="model-name">${escapeHtml(launch.modelo)}</td>
                  <td>${escapeHtml(windowLabel(key))}<div class="metric-sub">${advancedStatusBadge(win?.status)}</div></td>
                  <td class="num">${advancedCell(paid.receita, fmtBRL)}<div class="metric-sub">${advancedCell(paid.pedidos, fmtNum)} pedidos &middot; ${advancedQualityBadge(paid.qualidade)}</div></td>
                  <td class="num">${advancedCell(organic.receita, fmtBRL)}<div class="metric-sub">${advancedCell(organic.pedidos, fmtNum)} pedidos &middot; ${advancedQualityBadge(organic.qualidade)}</div></td>
                  <td class="num">${advancedCell(crm.receita, fmtBRL)}<div class="metric-sub">receita real CRM; investimento separado</div></td>
                  <td class="num">${advancedCell(investment.midia_paga, fmtBRL)}</td>
                  <td class="num">${advancedCell(investment.crm, fmtBRL)}</td>
                  <td class="num">${advancedCell(investment.total, fmtBRL)}<div class="metric-sub">${escapeHtml(investment.confiabilidade || 'pendente')}</div></td>
                  <td class="num">${advancedRoasCell(win?.roas)}</td>
                  <td>${advancedQualityBadge(vendas.canal_qualidade)}<div class="metric-sub">${escapeHtml(win?.roas?.observacao || '')}</div></td>
                </tr>
              `;
            }).join('')}
          </tbody>
        </table>
      </div>
    `;
  }

  function renderAdvancedAlerts() {
    const wrap = $('advanced-alerts');
    if (!wrap) return;
    const payload = advancedPayload();
    if (!payload) {
      wrap.innerHTML = '';
      return;
    }
    const selected = advancedSelectedLaunches();
    const alerts = [
      ...(payload.data_quality?.alertas || []),
      ...selected.flatMap((launch) => (advancedModelFor(launch)?.alertas || []).map((alerta) => `${launch.modelo}: ${alerta}`))
    ].filter(Boolean);
    const uniqueAlerts = [...new Set(alerts)].slice(0, 10);
    wrap.innerHTML = uniqueAlerts.length ? `
      <p class="actions-module-label">Alertas de dados</p>
      <div class="advanced-alert-list">
        ${uniqueAlerts.map((alerta, index) => `
          <div class="insight warn">
            <div class="insight-num">${String(index + 1).padStart(2, '0')}</div>
            <div><div class="insight-title">Dado em acompanhamento</div><div class="insight-copy">${escapeHtml(alerta)}</div></div>
            <div>${badge('parcial', 'Atencao')}</div>
          </div>
        `).join('')}
      </div>
    ` : '';
  }

  function metasMensaisRows() {
    const payload = state.data?.metas_mensais;
    if (Array.isArray(payload?.rows)) return payload.rows;
    return Array.isArray(payload) ? payload : [];
  }

  function acquisitionDailyRows() {
    return metasMensaisRows().flatMap((month) => (
      (Array.isArray(month.daily) ? month.daily : []).map((row) => ({
        ...row,
        mes: month.mes,
        month_label: month.month_label,
        source: 'metas_mensais.daily'
      }))
    ));
  }

  function sumKnownField(rows, field) {
    const values = rows
      .map((row) => numberOrNull(row[field]))
      .filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((acc, value) => acc + value, 0) : null;
  }

  function acquisitionChannelsFromDailyRows(rows) {
    const groups = new Map();
    const hasSalesChannels = rows.some((day) => Array.isArray(day.canais_venda) && day.canais_venda.length);
    rows.forEach((day) => {
      const channels = hasSalesChannels
        ? (Array.isArray(day.canais_venda) ? day.canais_venda : [])
        : (Array.isArray(day.canais_aquisicao) ? day.canais_aquisicao : []);
      channels.forEach((channel) => {
        const label = String(channel?.canal || 'Canal').trim() || 'Canal';
        const key = normalizeText(label);
        const current = groups.get(key) || {
          canal: label,
          tipo: channel?.tipo || null,
          investimento: null,
          sessoes: null,
          pedidos: null,
          receita: null,
          novos_clientes: null,
          source: hasSalesChannels ? 'vendas_atribuidas_bigquery' : 'aquisicao_bigquery'
        };
        ['investimento', 'sessoes', 'pedidos', 'receita', 'novos_clientes'].forEach((field) => {
          const value = numberOrNull(channel?.[field]);
          if (value !== null) current[field] = (current[field] || 0) + value;
        });
        groups.set(key, current);
      });
    });
    return [...groups.values()].map((channel) => ({
      ...channel,
      cps: channel.investimento !== null && channel.sessoes ? channel.investimento / channel.sessoes : null,
      roas: channel.investimento !== null && channel.investimento > 0 && channel.receita !== null ? channel.receita / channel.investimento : null
    })).sort((a, b) => Number(b.receita || b.investimento || 0) - Number(a.receita || a.investimento || 0));
  }

  function acquisitionWindowForLaunch(launch, key = selectedPeriodKey(), { requireClosed = false } = {}) {
    const d0 = analysisDayZero(launch);
    const targetDay = windowEndDay(key);
    if (!d0 || targetDay === null) return null;
    const available = selectedPeriodEndDay(launch, { capToAvailable: true });
    if (requireClosed && available < targetDay) return null;

    const observedDay = Math.max(0, Math.min(targetDay, available));
    const startIso = d0;
    const endIso = toIsoDate(addDays(d0, observedDay));
    const rows = acquisitionDailyRows()
      .filter((row) => row.data && row.data >= startIso && row.data <= endIso);
    const investimento = sumKnownField(rows, 'investimento_aquisicao') ?? sumKnownField(rows, 'investimento_realizado');
    const receita = sumKnownField(rows, 'receita_aquisicao') ?? sumKnownField(rows, 'realizado_receita');
    const pedidos = sumKnownField(rows, 'pedidos_aquisicao') ?? sumKnownField(rows, 'realizado_pedidos');
    const metaInvestimento = sumKnownField(rows, 'meta_investimento');
    const sessoes = sumKnownField(rows, 'sessoes') ?? sumKnownField(rows, 'sessoes_aquisicao');
    const novosClientes = sumKnownField(rows, 'clientes_novos') ?? sumKnownField(rows, 'novos_clientes') ?? sumKnownField(rows, 'novos_clientes_aquisicao');
    const canais = acquisitionChannelsFromDailyRows(rows);
    if (investimento === null && receita === null && pedidos === null) return null;

    const complete = observedDay >= targetDay;
    return {
      key,
      label: complete ? windowLabel(key) : `${windowLabel(key)} parcial`,
      range: `${fmtDateSlash(startIso)} a ${fmtDateSlash(endIso)}`,
      observedDay,
      targetDay,
      complete,
      investimento,
      metaInvestimento,
      receita,
      pedidos,
      sessoes,
      novosClientes,
      canais,
      roas: investimento && receita !== null ? receita / investimento : null,
      cpa: investimento !== null && pedidos ? investimento / pedidos : null,
      cps: investimento !== null && sessoes ? investimento / sessoes : null,
      cac: investimento !== null && novosClientes ? investimento / novosClientes : null,
      conversao: sessoes && pedidos !== null ? pedidos / sessoes : null,
      source: 'Aquisição SSOT'
    };
  }

  function acquisitionMetricRowsForLaunch(launch) {
    const selectedEnd = selectedPeriodEndDay(launch);
    return WINDOW_KEYS
      .filter((key) => windowEndDay(key) <= selectedEnd)
      .map((key) => acquisitionWindowForLaunch(launch, key, { requireClosed: true }))
      .filter(Boolean)
      .map((row) => ({
        launch,
        key: row.key,
        label: row.label,
        investimento: row.investimento,
        receita: row.receita,
        pedidos: row.pedidos,
        pares: null,
        cliques: null,
        roas: row.roas,
        cpa: row.cpa,
        cpp: null,
        cpc: null,
        source: row.source
      }));
  }

  function mediaRowMatchesSelectedPeriod(row, launch) {
    if (!isSpecificAnalysisPeriod()) return true;
    return mediaRowMatchesExactWindow(row, launch, selectedPeriodKey());
  }

  function periodEndDayForKey(launch, key = selectedPeriodKey(), { capToAvailable = false } = {}) {
    const day = WINDOW_DAYS[key] ?? janelaEmDias(key);
    if (day === null || day === undefined) return null;
    if (!capToAvailable) return Math.max(0, Math.min(90, day));
    const available = [
      latestLaunchDataDay(launch),
      numberOrNull(launch?.dPlus)
    ].filter((value) => value !== null);
    const maxAvailable = available.length ? Math.max(...available) : day;
    return Math.max(0, Math.min(90, day, maxAvailable));
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
      const date = new Date(year, month - 1, day, 12, 0, 0);
      if (Number.isNaN(date.getTime()) || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
      return toIsoDate(date);
    }).filter(Boolean);
  }

  function manualCommercialReferenceDate(launch) {
    const rows = optionalRows('midia_paga').filter((row) => row.modelo_id === launch?.modelo_id);
    const candidates = rows.flatMap((row) => parseManualLaunchDateCandidates(row.observacao));
    if (!candidates.length) return analysisDayZero(launch);

    const crmRows = optionalRows('crm_disparos').filter((row) => row.modelo_id === launch?.modelo_id);
    const score = (candidate) => crmRows.reduce((acc, row) => {
      const idx = dayIndex(candidate, row.data_disparo || row.data || row.date);
      if (idx === null || idx < 0 || idx > 90) return acc;
      return acc + 1 + (numberOrNull(row.receita_linha) || 0) / 100000 + (numberOrNull(row.investimento) || 0) / 1000000;
    }, 0);

    return candidates
      .map((candidate, index) => ({ candidate, index, score: score(candidate) }))
      .sort((a, b) => b.score - a.score || a.index - b.index)[0]?.candidate
      || analysisDayZero(launch);
  }

  function mediaRowMatchesPeriodEnd(row, launch, selectedEnd) {
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

  function mediaRowMatchesExactWindow(row, launch, key = selectedPeriodKey()) {
    if (!key || !WINDOW_KEYS.includes(key)) return true;
    const rowKey = commercialWindowKey(row);
    if (WINDOW_KEYS.includes(rowKey)) return rowKey === key;
    const inferredKey = commercialWindowKey({ janela: inferMediaWindow(row, launch) });
    return inferredKey === key;
  }

  function isTotalMediaInvestmentRow(row) {
    return String(row?.canal || row?.channel || '').trim().toLowerCase() === 'total';
  }

  function mediaRowsForInvestmentWindow(launch, key = selectedPeriodKey()) {
    const rows = optionalRows('midia_paga')
      .filter((row) => row.modelo_id === launch?.modelo_id)
      .filter((row) => mediaRowMatchesExactWindow(row, launch, key))
      .filter((row) => midiaValidaParaGraficoComercial(row));
    const channelRows = rows.filter((row) => !isTotalMediaInvestmentRow(row));
    return channelRows.length ? channelRows : rows;
  }

  function legacyMediaRowsForLaunch(launch, key = selectedPeriodKey(), { capToAvailable = false } = {}) {
    return mediaRowsForInvestmentWindow(launch, key, { capToAvailable });
  }

  function crmRowMatchesSelectedPeriod(row, launch) {
    if (!isSpecificAnalysisPeriod()) return true;
    const endDay = selectedPeriodEndDay(launch);
    return crmRowMatchesPeriodEnd(row, launch, endDay);
  }

  function crmRowMatchesPeriodEnd(row, launch, selectedEnd, referenceDate = analysisDayZero(launch)) {
    if (selectedEnd === null) return true;
    if (row.janela) {
      const key = commercialWindowKey({ janela: row.janela });
      const days = janelaEmDias(key) ?? WINDOW_DAYS[key] ?? null;
      if (days !== null) return days <= selectedEnd;
    }
    const data = row.data_disparo || row.data || row.date;
    const idx = dayIndex(referenceDate, data);
    return idx !== null && idx >= 0 && idx <= selectedEnd;
  }

  function manualInvestmentRowsForLaunch(launch, key = selectedPeriodKey(), { capToAvailable = false } = {}) {
    const endDay = periodEndDayForKey(launch, key, { capToAvailable });
    const mediaRows = mediaRowsForInvestmentWindow(launch, key)
      .map((row) => ({ ...row, investment_source: 'midia_paga' }))
    const crmReferenceDate = manualCommercialReferenceDate(launch);
    const crmRows = optionalRows('crm_disparos')
      .filter((row) => row.modelo_id === launch?.modelo_id)
      .filter((row) => crmRowMatchesPeriodEnd(row, launch, endDay, crmReferenceDate))
      .map((row) => ({ ...normalizeCrmRow(row), investment_source: 'crm_disparos' }))
      .filter((row) => numberOrNull(row.investimento) !== null);
    return [...mediaRows, ...crmRows];
  }

  function manualPerformanceRowsForLaunch(launch, key = selectedPeriodKey(), { capToAvailable = false } = {}) {
    const endDay = periodEndDayForKey(launch, key, { capToAvailable });
    const crmReferenceDate = manualCommercialReferenceDate(launch);
    const mediaRows = mediaRowsForInvestmentWindow(launch, key)
      .map((row) => ({
        source: 'midia_paga',
        receita: numberOrNull(row.receita_atribuida),
        pedidos: numberOrNull(row.pedidos),
        investimento: numberOrNull(row.investimento)
      }));
    const crmRows = optionalRows('crm_disparos')
      .filter((row) => row.modelo_id === launch?.modelo_id)
      .filter((row) => crmRowMatchesPeriodEnd(row, launch, endDay, crmReferenceDate))
      .map((row) => ({
        source: 'crm_disparos',
        receita: numberOrNull(row.receita_linha),
        pedidos: numberOrNull(row.pedidos),
        investimento: numberOrNull(row.investimento)
      }));
    return [...mediaRows, ...crmRows].filter((row) => row.receita !== null || row.pedidos !== null);
  }

  function manualAttributionFallbackForLaunch(launch, key = selectedPeriodKey(), data = {}) {
    const rows = manualPerformanceRowsForLaunch(launch, key, { capToAvailable: true })
      .filter((row) => row.source === 'midia_paga');
    const receitaInvestimento = sumValues(...rows.map((row) => row.receita));
    const pedidosInvestimento = sumValues(...rows.map((row) => row.pedidos));
    const totalReceita = numberOrNull(data?.receita_total_original)
      ?? numberOrNull(data?.receita_bruta)
      ?? numberOrNull(data?.receita);
    const totalPedidos = numberOrNull(data?.pedidos) ?? numberOrNull(data?.pedidos_validos);
    return {
      receitaInvestimento,
      pedidosInvestimento,
      receitaOrganica: nonInvestmentRevenueForData(data, receitaInvestimento),
      pedidosOrganicos: pedidosInvestimento !== null
        ? nonNegativeRoundedRemainder(totalPedidos, pedidosInvestimento, 0)
        : null,
      totalReceita,
      totalPedidos
    };
  }

  function manualCommercialMetricRowsForLaunch(launch) {
    const mediaRowsRaw = mediaRowsForInvestmentWindow(launch, selectedPeriodKey())
      .map((row) => normalizeMediaRow(row, launch));
    const mediaRows = enrichMediaEstimates(mediaRowsRaw, launch)
      .filter((row) => midiaValidaParaGraficoComercial(row));
    const mediaAggregates = aggregateMediaRows(mediaRows, launch, midiaValidaParaGraficoComercial);
    const mediaChartRows = (mediaAggregates.length ? mediaAggregates : mediaRows).map((row) => {
      const trusted = hasTrustedMediaPerformance(row);
      const receita = trusted ? numberOrNull(row.receita_atribuida) : null;
      const pedidos = trusted ? numberOrNull(row.pedidos) : null;
      const investimento = numberOrNull(row.investimento);
      const key = commercialWindowKey(row);
      return {
        launch,
        key,
        label: commercialWindowLabel(key),
        investimento,
        receita,
        pedidos,
        pares: numberOrNull(row.pares),
        cliques: numberOrNull(row.cliques),
        roas: trusted ? rowRoas(row) ?? (investimento && receita !== null ? receita / investimento : null) : null,
        cpa: trusted ? numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null) : null,
        cpp: numberOrNull(row.cpp),
        cpc: numberOrNull(row.cpc),
        source: 'midia_paga manual'
      };
    });

    const crmChartRows = (state.data?.crm_disparos || [])
      .filter((row) => row.modelo_id === launch.modelo_id)
      .filter((row) => crmRowMatchesSelectedPeriod(row, launch))
      .map((row) => ({ ...normalizeCrmRow(row), modelo_id: launch.modelo_id, modelo: launch.modelo }))
      .map((row) => {
        const trusted = hasTrustedCrmPerformance(row);
        const investimento = numberOrNull(row.investimento);
        const receita = trusted ? numberOrNull(row.receita_base) : null;
        const pedidos = trusted ? numberOrNull(row.pedidos) : null;
        const key = commercialWindowKey({ janela: inferCrmWindow(row, launch) });
        return {
          launch,
          key,
          label: commercialWindowLabel(key),
          investimento,
          receita,
          pedidos,
          pares: null,
          cliques: null,
          roas: trusted ? rowRoas(row) ?? (investimento && receita !== null ? receita / investimento : null) : null,
          cpa: trusted ? numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null) : null,
          cpp: null,
          cpc: null,
          source: 'crm_disparos manual'
        };
      });

    return aggregateCommercialChartRows([...mediaChartRows, ...crmChartRows]);
  }

  function commercialMetricRowsForLaunch(launch) {
    return WINDOW_KEYS.map((key) => {
      const data = filteredWindowDataForLaunch(launch, key) || {};
      const investmentRows = manualInvestmentRowsForLaunch(launch, key, { capToAvailable: false });
      const attribution = investmentAttributionForWindow(launch, key);
      const investimento = sumKnown(investmentRows, 'investimento');
      const receita = attribution.receitaInvestimento;
      const pedidos = attribution.pedidosInvestimento;
      const pares = numberOrNull(data.pares);
      const cliques = sumKnown(investmentRows, 'cliques');
      if ([investimento, receita, pedidos, pares, cliques].every((value) => value === null || value === undefined)) return null;
      return {
        launch,
        key,
        label: commercialWindowLabel(key),
        investimento,
        receita,
        pedidos,
        pares,
        cliques,
        roas: ratioOrNull(receita, investimento),
        cpa: ratioOrNull(investimento, pedidos),
        cpp: ratioOrNull(investimento, pares),
        cpc: ratioOrNull(investimento, cliques),
        receita_organica: attribution.receitaOrganica,
        pedidos_organicos: attribution.pedidosOrganicos,
        source: investimento !== null ? 'planilha investimento + atribuicao pedido' : 'atribuicao pedido'
      };
    }).filter(Boolean);
  }

  function commercialMetricValue(row, metricKey) {
    if (!row) return null;
    return row[metricKey] ?? null;
  }

  function commercialMetricHasValue(rows, metricKey) {
    return rows.some((row) => commercialMetricValue(row, metricKey) !== null);
  }

  function syncCommercialChartMetricButtons(rows, metric) {
    const buttons = [...document.querySelectorAll('[data-commercial-chart-metric]')];
    if (!buttons.length) return metric;

    const visibleKeys = buttons
      .map((button) => button.dataset.commercialChartMetric || 'investimento')
      .filter((key) => commercialMetricHasValue(rows, key));
    const nextMetric = visibleKeys.includes(metric.key)
      ? metric
      : commercialMetricConfig(visibleKeys[0] || 'investimento');

    if (nextMetric.key !== metric.key) state.commercialChartMetric = nextMetric.key;

    buttons.forEach((button) => {
      const key = button.dataset.commercialChartMetric || 'investimento';
      const available = visibleKeys.includes(key);
      button.hidden = !available;
      button.disabled = !available;
      button.classList.toggle('is-active', available && key === nextMetric.key);
      button.title = available
        ? ''
        : 'Sem base real nesta janela. O dashboard nao transforma ausencia em zero.';
    });

    return nextMetric;
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

  function commercialTooltipLines(row) {
    const lines = [];
    const baseParts = [];
    const efficiencyParts = [];
    const volumeParts = [];

    if (numberOrNull(row?.investimento) !== null) baseParts.push(`Invest. ${formatCommercialMetric(row.investimento, commercialMetricConfig('investimento'))}`);
    if (numberOrNull(row?.receita) !== null) baseParts.push(`Receita ${formatCommercialMetric(row.receita, commercialMetricConfig('receita'))}`);
    if (roasNumberOrNull(row?.roas) !== null) efficiencyParts.push(`ROAS ${formatCommercialMetric(row.roas, commercialMetricConfig('roas'))}`);
    if (numberOrNull(row?.cpa) !== null) efficiencyParts.push(`CPA ${formatCommercialMetric(row.cpa, commercialMetricConfig('cpa'))}`);
    if (numberOrNull(row?.cpp) !== null) efficiencyParts.push(`CPP ${formatCommercialMetric(row.cpp, commercialMetricConfig('cpp'))}`);
    if (numberOrNull(row?.cpc) !== null) efficiencyParts.push(`CPC ${formatCommercialMetric(row.cpc, commercialMetricConfig('cpc'))}`);
    if (numberOrNull(row?.pedidos) !== null) volumeParts.push(`${fmtNum(row.pedidos)} ped.`);
    if (numberOrNull(row?.pares) !== null) volumeParts.push(`${fmtNum(row.pares)} pares`);
    if (numberOrNull(row?.cliques) !== null) volumeParts.push(`${fmtNum(row.cliques)} cliques`);

    if (baseParts.length) lines.push(baseParts.join(' · '));
    if (efficiencyParts.length) lines.push(efficiencyParts.join(' · '));
    if (volumeParts.length) lines.push(`Base ${volumeParts.join(' · ')}`);
    lines.push(row?.source ? `Fonte ${row.source}` : 'Fonte manual');
    return lines;
  }

  function renderCommercialEfficiencyChart(selected) {
    const canvasId = 'chart-normalized-media';
    const canvas = $(canvasId);
    if (!canvas || !window.Chart) return;

    state.charts[canvasId]?.destroy?.();
    delete state.charts[canvasId];

    const subText = $('chart-normalized-media-sub');
    let metric = commercialMetricConfig();
    const launches = comparableLaunches()
      .filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
    const rowsByLaunch = new Map(launches.map((launch) => [launch.modelo_id, commercialMetricRowsForLaunch(launch)]));
    const allRows = [...rowsByLaunch.values()].flat();
    const windowKeys = [...new Set(allRows.map((row) => row.key))]
      .sort((a, b) => commercialWindowRank(a) - commercialWindowRank(b));

    if (!allRows.length || !windowKeys.length) {
      if (subText) subText.textContent = 'Sem investimento cadastrado na planilha principal para as linhas nesta janela. Ausencia fica vazia, nao vira zero.';
      return;
    }

    metric = syncCommercialChartMetricButtons(allRows, metric);
    const hasAnyMetricValue = allRows.some((row) => commercialMetricValue(row, metric.key) !== null);
    if (subText) {
      subText.textContent = hasAnyMetricValue
        ? `${metric.label} por janela do lançamento. Etiqueta "sem dado" indica valor ainda não cadastrado no JSON, não investimento zero.`
        : `${metric.label}: ainda sem base suficiente no JSON. ${metric.key === 'cpc' ? 'Inclua cliques ou CPC na exportação para habilitar esta leitura.' : 'Ausência fica vazia, não vira zero.'}`;
    }

    const selectedCommercialKey = selectedPeriodKey();
    const chartRows = launches
      .map((launch, index) => {
        const rows = rowsByLaunch.get(launch.modelo_id) || [];
        const fallback = rows.find((row) => row.key === selectedCommercialKey)
          || rows.filter((row) => commercialWindowRank(row.key) <= commercialWindowRank(selectedCommercialKey)).at(-1)
          || null;
        const row = fallback;
        return {
          launch,
          index,
          row,
          value: commercialMetricValue(row, metric.key)
        };
      })
      .filter((row) => row.value !== null)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    if (subText) {
      subText.textContent = chartRows.length
        ? `${metric.label} na janela ${selectedPeriodLabel()}, comparando cada lançamento desde o próprio D0.`
        : `${metric.label}: sem dado real para a janela ${selectedPeriodLabel()}.`;
    }

    createChart(canvasId, {
      type: 'bar',
      data: {
        labels: chartRows.map((row) => row.launch.modelo),
        datasets: [{
          label: metric.label,
          data: chartRows.map((row) => row.value),
          rankRows: chartRows,
          backgroundColor: chartRows.map((row) => colorFor(row.launch.modelo_id, row.index)),
          borderColor: chartRows.map((row) => colorFor(row.launch.modelo_id, row.index)),
          borderWidth: 1,
          borderRadius: 7,
          barThickness: 20,
          maxBarThickness: 22
        }]
      },
      options: chartOptions({
        indexAxis: 'y',
        interaction: { mode: 'nearest', intersect: false, axis: 'y' },
        layout: { padding: { top: 8, right: 76, bottom: 0, left: 4 } },
        plugins: {
          legend: { display: false },
          rankingValueLabels: {
            enabled: true,
            formatter: (value) => formatCommercialMetric(value, metric)
          },
          tooltip: {
            callbacks: {
              title: (items) => items[0]?.label || '',
              label: (ctx) => `${metric.short}: ${formatCommercialMetric(ctx.parsed.x, metric)}`,
              afterLabel: (ctx) => {
                const row = ctx.dataset.rankRows?.[ctx.dataIndex]?.row;
                if (!row) return 'Sem dado real para esta janela.';
                return commercialTooltipLines(row);
              }
            }
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            grace: metric.unit === 'ratio' ? '18%' : '14%',
            ticks: {
              maxTicksLimit: 4,
              callback: (value) => metric.unit === 'ratio' ? `${fmtNum(Number(value), 1)}x` : fmtBRL(Number(value), true)
            },
            grid: { color: 'rgba(255,255,255,0.04)' }
          },
          y: {
            grid: { display: false },
            ticks: { color: 'rgba(255,255,255,0.76)', font: { weight: 700 } }
          }
        }
      })
    });
  }

  function renderCharts(selected) {
    destroyCharts();
    const chartLaunches = selectedCompareLaunches();
    renderRampPeriodAnalysis(selected, chartLaunches);
    if (!window.Chart) return;

    const labels = WINDOW_KEYS;
    const windowData = (launch, key) => filteredWindowDataForLaunch(launch, key);
    const windowChartLaunches = chartLaunches.filter((launch) => labels.some((key) => Boolean(windowData(launch, key))));

    const compactChartRows = chartLaunches.map((launch, index) => ({
      launch,
      index,
      sales: compactSalesWindowForLaunch(launch)
    }));
    const rankingRowsFor = (field) => compactChartRows
      .map((row) => ({
        ...row,
        value: numberOrNull(row.sales?.data?.[field])
      }))
      .filter((row) => row.value !== null)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    const createRankingChart = (canvasId, rows, config) => {
      createChart(canvasId, {
        type: 'bar',
        data: {
          labels: rows.map((row) => row.launch.modelo),
          datasets: [{
            label: config.label,
            data: rows.map((row) => row.value),
            rankRows: rows,
            backgroundColor: rows.map((row) => colorFor(row.launch.modelo_id, row.index)),
            borderColor: rows.map((row) => colorFor(row.launch.modelo_id, row.index)),
            borderWidth: 1,
            borderRadius: 7,
            barThickness: 20,
            maxBarThickness: 22
          }]
        },
        options: chartOptions({
          indexAxis: 'y',
          interaction: { mode: 'nearest', intersect: false, axis: 'y' },
          layout: { padding: { top: 8, right: 72, bottom: 0, left: 4 } },
          plugins: {
            legend: { display: false },
            rankingValueLabels: {
              enabled: true,
              formatter: (value) => config.format(value)
            },
            tooltip: {
              callbacks: {
                title: (items) => items[0]?.label || '',
                label: (ctx) => `${config.label}: ${config.format(ctx.parsed.x)}`,
                afterLabel: (ctx) => {
                  const row = ctx.dataset.rankRows?.[ctx.dataIndex];
                  if (!row) return '';
                  return [
                    `Janela: ${row.sales?.statusLabel || selectedPeriodLabel()}`,
                    `Período: ${row.sales?.range || 'sem data'}`,
                    `Fonte: ${row.sales?.source || 'pipeline'}`
                  ];
                }
              }
            }
          },
          scales: {
            x: {
              beginAtZero: true,
              grace: '18%',
              grid: { color: 'rgba(255,255,255,0.04)' },
              ticks: { maxTicksLimit: 4, callback: (value) => config.axis(value) }
            },
            y: {
              grid: { display: false },
              ticks: { color: 'rgba(255,255,255,0.76)', font: { weight: 700 } }
            }
          }
        })
      });
    };

    createRankingChart('chart-revenue', rankingRowsFor('receita'), {
      label: 'Faturamento',
      format: (value) => fmtBRL(value, true),
      axis: (value) => fmtBRL(Number(value), true)
    });

    createRankingChart('chart-pairs', rankingRowsFor('pares'), {
      label: 'Pares vendidos',
      format: (value) => `${fmtNum(value)} pares`,
      axis: (value) => fmtNum(Number(value))
    });

    const growthPairs = {
      '15d': ['15d', '7d'],
      '30d': ['30d', '15d'],
      '60d': ['60d', '30d'],
      '90d': ['90d', '30d']
    };
    const currentGrowthKey = selectedPeriodKey();
    const growthPair = growthPairs[currentGrowthKey] || null;
    const growthPanel = document.querySelector('[data-chart-panel="multipliers"]');
    const growthTitle = growthPanel?.querySelector('.chart-title span');
    const growthSub = growthPanel?.querySelector('.chart-sub');
    if (growthTitle) growthTitle.textContent = growthPair ? 'Crescimento da janela' : 'Ritmo inicial';
    if (growthSub) {
      growthSub.textContent = growthPair
        ? `${windowLabel(growthPair[0])} dividido por ${windowLabel(growthPair[1])}, cada lançamento no próprio D0`
        : `Faturamento médio por dia em ${selectedPeriodLabel()}`;
    }
    const growthRows = compactChartRows
      .map((row) => {
        if (growthPair) {
          const currentValue = numberOrNull(row.sales?.data?.receita);
          const previousValue = numberOrNull(windowData(row.launch, growthPair[1])?.receita);
          return {
            ...row,
            value: ratioOrNull(currentValue, previousValue),
            detail: `${windowLabel(growthPair[0])} / ${windowLabel(growthPair[1])}`,
            unit: 'ratio'
          };
        }
        const currentValue = numberOrNull(row.sales?.data?.receita);
        const days = numberOrNull(row.sales?.observedDay) !== null ? Number(row.sales.observedDay) + 1 : windowSpanDays(currentGrowthKey);
        return {
          ...row,
          value: days ? ratioOrNull(currentValue, days) : null,
          detail: `média diária em ${row.sales?.statusLabel || selectedPeriodLabel()}`,
          unit: 'currency'
        };
      })
      .filter((row) => row.value !== null)
      .sort((a, b) => Number(b.value || 0) - Number(a.value || 0));
    createRankingChart('chart-multipliers', growthRows, {
      label: growthPair ? 'Crescimento' : 'Ritmo diário',
      format: (value) => growthPair ? `${fmtNum(value, 2)}x` : `${fmtBRL(value, true)}/dia`,
      axis: (value) => growthPair ? `${fmtNum(Number(value), 1)}x` : fmtBRL(Number(value), true)
    });

    const mixWindowFor = (launch) => {
      const key = selectedPeriodKey();
      return {
        key,
        data: windowData(launch, key)
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
            borderRadius: 6,
            barThickness: 20,
            maxBarThickness: 22
          },
          {
            label: 'Recorrentes',
            data: clientMixRows.map((row) => row.pct == null ? null : (1 - row.pct) * 100),
            backgroundColor: '#4C9F6A',
            borderRadius: 6,
            barThickness: 20,
            maxBarThickness: 22
          }
        ].concat(clientMixRows.some((row) => row.pct == null) ? [{
          label: 'Sem classificação',
          data: clientMixRows.map((row) => row.pct == null ? 100 : null),
          backgroundColor: 'rgba(255,255,255,0.12)',
          borderRadius: 6,
          barThickness: 20,
          maxBarThickness: 22
        }] : [])
      },
      options: chartOptions({
        indexAxis: 'y',
        layout: { padding: { top: 8, right: 18, bottom: 0, left: 2 } },
        scales: {
          x: { stacked: true, display: false, max: 100, grid: { display: false } },
          y: { stacked: true, grid: { display: false }, ticks: { color: 'rgba(255,255,255,0.76)', font: { weight: 700 } } }
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
    $('weekly-title').textContent = weeklyLaunches.length ? 'Receita por semana' : 'Semana a semana';
    createChart('chart-weekly', {
      type: 'bar',
      data: {
        labels: weeklyLabels,
        datasets: weeklyLaunches.map((launch, index) => ({
          label: launch.modelo,
          data: weeklyLabels.map((label) => launch.semanas.find((week) => week.label === label)?.receita ?? null),
          borderColor: colorFor(launch.modelo_id, index),
          backgroundColor: colorFor(launch.modelo_id, index),
          borderWidth: launch.modelo_id === selected.modelo_id ? 2 : 1,
          borderRadius: 5,
          maxBarThickness: 18,
          categoryPercentage: 0.72,
          barPercentage: 0.78
        }))
      },
      options: chartOptions({
        interaction: { mode: 'nearest', intersect: false, axis: 'xy' },
        layout: { padding: { top: 8, right: 14, bottom: 0, left: 2 } },
        scales: {
          x: { grid: { display: false }, ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: {
            position: 'left',
            ticks: { maxTicksLimit: 4, callback: (v) => fmtBRL(v, true) },
            grid: { color: 'rgba(255,255,255,0.04)' }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { padding: 12 }
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${fmtBRL(ctx.parsed.y)}`,
              afterLabel: () => 'Semana relativa ao D0 de cada lançamento; compara o ritmo semanal entre modelos.'
            }
          }
        }
      })
    });

    renderNormalizedChart(selected);
    renderCommercialEfficiencyChart(selected);
    applyLaunchChartView();
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
      <p class="cut-note">Comparação por ${escapeHtml(selectedPeriodLabel())}: cada modelo usa a própria data de lançamento; desvio = participação do corte no lançamento menos a média do mesmo corte no grupo comparativo.</p>
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

  function seasonalAnalysisForLaunch(launch, endDay, label = selectedPeriodLabel()) {
    const events = seasonalEventsFor(launch, endDay);
    const counts = seasonalCounts(events);
    const score = events.reduce((acc, event) => acc + event.score, 0);
    const observedScore = events.filter((event) => event.observed).reduce((acc, event) => acc + event.score, 0);
    return {
      launch,
      label,
      end: endDay,
      events,
      counts,
      score,
      observedScore,
      cls: seasonalClass(score, events),
      scoreLabel: seasonalScoreLabel(score, events),
      read: seasonalRead(events, score, observedScore)
    };
  }

  function renderCalendar(selected) {
    const grid = $('calendar-grid');
    if (!grid) return;
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
            <div class="calendar-title"><span>${escapeHtml(row.launch.modelo)}<small>${escapeHtml(selectedAnalysis.label)}</small></span>${row.launch.modelo_id === selected.modelo_id ? badge('focus', 'Destaque') : ''}</div>
            <div class="seasonal-score seasonal-score--${row.cls}">${escapeHtml(row.scoreLabel)}</div>
            <div class="metric-sub">${fmtNum(row.counts.promotores)} promotores · ${fmtNum(row.counts.ofensores)} ofensores · ${fmtNum(row.counts.neutros)} neutros</div>
          </div>`).join('')}
        </div>`
      : '';

    grid.innerHTML = `
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
    const meta = normalizeText(metodologia);
    const label = meta.includes('correl')
      ? 'correl.'
      : meta.includes('janela isolada') ? 'isolada'
        : meta.includes('contexto') ? 'contexto'
          : meta.includes('estim') ? 'estim.'
            : 'metod.';
    const text = `${aviso || 'Leitura comercial contextual; não representa atribuição real de clique/conversão.'} Metodologia: ${metodologia || 'não informada'}.`;
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
    const hasDeclaredWindow = janelaEmDias(row.janela) !== null;
    const hasInvestment = numberOrNull(row.investimento) !== null;
    if (!row || !hasInvestment) return false;
    if (hasDeclaredWindow) return true;
    return !row.data_suspeita && !row.valor_suspeito;
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

  function commercialMethodText(row) {
    return normalizeText([
      row?.metodologia,
      row?.receita_source,
      row?.source,
      row?.fonte,
      row?.aviso,
      row?.status
    ].filter(Boolean).join(' '));
  }

  function commercialMethodIsEstimated(row) {
    const text = commercialMethodText(row);
    return [
      'correl',
      'estim',
      'modelo agregado',
      'janela isolada',
      'receita janela agregada',
      'receita repetida agregada',
      'bloqueada',
      'rateio'
    ].some((term) => text.includes(term));
  }

  function hasTrustedMediaPerformance(row) {
    if (!row || row.atribuicao_bloqueada || !midiaValidaParaImpacto(row) || commercialMethodIsEstimated(row)) return false;
    return numberOrNull(row.receita_atribuida) !== null || rowRoas(row) !== null;
  }

  function hasTrustedCrmPerformance(row) {
    if (!row || commercialMethodIsEstimated(row)) return false;
    const meta = commercialMethodText(row);
    if (row.atribuicao_real === true || meta.includes('atribuicao real') || meta.includes('last click')) return true;
    return !row.metodologia && rowRoas(row) !== null;
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
        out[index].aviso = 'Receita repetida em canais diferentes da mesma janela. ROAS de investimento foi bloqueado; use a linha agregada até existir atribuição real por pedido.';
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
    const rawRoas = rowRoas(row);
    const rawCpa = numberOrNull(row.cpa);
    const metodologia = row.metodologia || ((receitaBase !== null || rawRoas !== null) ? 'contexto_declarado' : '');
    const candidate = { ...row, metodologia };
    const trusted = hasTrustedCrmPerformance(candidate);
    const roas = trusted ? rawRoas : null;
    const cpa = trusted ? rawCpa : null;
    const aviso = row.aviso || (metodologia ? 'Disparo mantido como contexto declarado; ROAS e CPA ficam ocultos até existir atribuição real por pedido.' : '');
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
      aviso,
      confiavel_comercial: trusted
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

  function channelAttributionTotals(summaries) {
    const empty = () => ({ receita: 0, pedidos: 0, hasReceita: false, hasPedidos: false });
    const totals = {
      paid: empty(),
      organic: empty(),
      crm: empty(),
      other: empty(),
      unmatched: empty()
    };
    const add = (bucket, receita, pedidos) => {
      const revenueValue = numberOrNull(receita);
      const orderValue = numberOrNull(pedidos);
      if (revenueValue !== null) {
        bucket.receita += revenueValue;
        bucket.hasReceita = true;
      }
      if (orderValue !== null) {
        bucket.pedidos += orderValue;
        bucket.hasPedidos = true;
      }
    };
    (summaries || []).forEach((row) => {
      const attribution = attributionForSelectedPeriod(row.launch);
      add(totals.paid, attribution.receita_paga, attribution.pedidos_pagos);
      add(totals.organic, attribution.receita_organica, attribution.pedidos_organicos);
      add(totals.crm, attribution.receita_crm, attribution.pedidos_crm);
      add(totals.other, attribution.receita_outros_canais, attribution.pedidos_outros_canais);
      add(totals.unmatched, attribution.receita_sem_match_atribuicao, attribution.pedidos_sem_match_atribuicao);
    });
    totals.hasAnyAttributed = ['paid', 'organic', 'crm', 'other', 'unmatched'].some((key) => totals[key].hasReceita || totals[key].hasPedidos);
    totals.receitaClassificada = ['paid', 'organic', 'crm', 'other', 'unmatched']
      .reduce((acc, key) => acc + (totals[key].hasReceita ? totals[key].receita : 0), 0);
    totals.pedidosClassificados = ['paid', 'organic', 'crm', 'other', 'unmatched']
      .reduce((acc, key) => acc + (totals[key].hasPedidos ? totals[key].pedidos : 0), 0);
    return totals;
  }

  function channelAttributionCard(title, bucket, className, totalRevenue) {
    const revenue = bucket.hasReceita ? fmtBRL(bucket.receita) : 'Aguardando';
    const orders = bucket.hasPedidos ? `${fmtNum(bucket.pedidos)} pedidos` : 'pedidos aguardando';
    const share = bucket.hasReceita && totalRevenue
      ? ` · ${fmtPct(bucket.receita / totalRevenue, 1)} das vendas atribu&iacute;das`
      : '';
    return `
      <div class="channel-attribution-card ${className}">
        <div class="metric-label">${escapeHtml(title)}</div>
        <strong>${revenue}</strong>
        <span>${orders}${share}</span>
      </div>
    `;
  }

  function combinedAttributionBucket(...buckets) {
    return buckets.reduce((acc, bucket) => ({
      receita: acc.receita + (bucket?.hasReceita ? Number(bucket.receita || 0) : 0),
      pedidos: acc.pedidos + (bucket?.hasPedidos ? Number(bucket.pedidos || 0) : 0),
      hasReceita: acc.hasReceita || Boolean(bucket?.hasReceita),
      hasPedidos: acc.hasPedidos || Boolean(bucket?.hasPedidos)
    }), { receita: 0, pedidos: 0, hasReceita: false, hasPedidos: false });
  }

  function renderChannelAttributionSummary(summaries) {
    const wrap = $('channel-attribution-summary');
    if (!wrap) return;
    if (!summaries.length) {
      wrap.innerHTML = `<div class="empty-state"><div><strong>Selecione ao menos um modelo.</strong>O resumo por canal acompanha os modelos comparados.</div></div>`;
      return;
    }
    const totals = channelAttributionTotals(summaries);
    const audit = state.data?.manifest?.data_quality?.atribuicao_canal || {};
    const coverage = numberOrNull(audit.cobertura_pedidos_pct);
    const status = String(audit.status || '').trim();
    const period = selectedPeriodLabel();
    const modelCount = summaries.length;
    const coverageCopy = coverage !== null ? ` Cobertura atual do export: ${fmtPct(coverage, 1)} dos pedidos.` : '';
    const statusCopy = totals.hasAnyAttributed
      ? `Vendas classificadas por canal real dentro da janela ${escapeHtml(period)} dos ${fmtNum(modelCount)} lan&ccedil;amentos comparados.${coverageCopy}`
      : status === 'sem_atribuicao_real'
        ? 'Aguardando a exporta&ccedil;&atilde;o por pedido casar os canais com os produtos. A tabela principal fica sem pago/org&acirc;nico enquanto essa atribui&ccedil;&atilde;o n&atilde;o existir.'
        : 'Ainda sem receita_paga ou receita_organica no payload do produto para a janela selecionada.';
    const controls = combinedAttributionBucket(totals.crm, totals.other, totals.unmatched);
    wrap.innerHTML = `
      ${channelAttributionCard('Pedidos de midia paga', totals.paid, 'channel-attribution-card--paid', totals.receitaClassificada)}
      ${channelAttributionCard('Pedidos organicos', totals.organic, 'channel-attribution-card--organic', totals.receitaClassificada)}
      ${channelAttributionCard('Controles', controls, 'channel-attribution-card--other', totals.receitaClassificada)}
      <div class="channel-attribution-note">
        Resultado por canal do lan&ccedil;amento, n&atilde;o por campanha individual. Midia paga = sinais de anuncio como cpc, pmax, paid, demand-gen e performance; organico = busca/social/SEO organico; controles = direto, e-mail/CRM, WhatsApp, outros e nao atribuidos. ${statusCopy}
      </div>
    `;
  }

  function dailySourceValue(value, formatter = fmtBRL) {
    return value === null || value === undefined ? 'Sem diário' : formatter(value);
  }

  function dailySourceCard(title, value, formatter, detail, className = '') {
    return `
      <div class="daily-source-card ${className}">
        <div class="metric-label">${escapeHtml(title)}</div>
        <strong>${dailySourceValue(value, formatter)}</strong>
        <span>${escapeHtml(detail || '')}</span>
      </div>
    `;
  }

  function dailySourceLine(row) {
    const hasDaily = [row.aquisicaoInvestimento, row.aquisicaoReceita, row.aquisicaoPedidos].some((value) => value !== null && value !== undefined);
    const metrics = hasDaily
      ? `${fmtBRL(row.aquisicaoInvestimento)} invest. · ${fmtBRL(row.aquisicaoReceita)} fat. · ${fmtNum(row.aquisicaoPedidos)} pedidos`
      : 'Sem diário na janela selecionada';
    const roas = row.aquisicaoRoas !== null && row.aquisicaoRoas !== undefined ? ` · ROAS ${fmtNum(row.aquisicaoRoas, 2)}x` : '';
    return `
      <div class="daily-source-line">
        <strong>${escapeHtml(row.launch.modelo)}</strong>
        <span>${escapeHtml(row.aquisicaoLabel || selectedPeriodLabel())}</span>
        <span>${escapeHtml(metrics)}${escapeHtml(roas)}</span>
      </div>
    `;
  }

  function renderDailySourceSummary(summaries) {
    const wrap = $('daily-source-summary');
    if (!wrap) return;
    if (!summaries.length) {
      wrap.innerHTML = `<div class="empty-state"><div><strong>Selecione ao menos um modelo.</strong>O contexto agregado da empresa acompanha os modelos comparados apenas como leitura auxiliar.</div></div>`;
      return;
    }

    const primary = summaries.find((row) => row.launch?.modelo_id === state.primaryModelId) || summaries[0];
    const hasPrimaryDaily = [primary.aquisicaoInvestimento, primary.aquisicaoReceita, primary.aquisicaoPedidos].some((value) => value !== null && value !== undefined);
    const dailyMonths = new Set(acquisitionDailyRows().map((row) => row.mes).filter(Boolean)).size;
    const sourceCopy = hasPrimaryDaily
      ? `Fonte: metas_mensais.daily quando existir. Soma os dias da janela ${escapeHtml(primary.aquisicaoLabel || selectedPeriodLabel())} de cada lançamento como contexto legado; não entra no cálculo de investimento.`
      : `Sem contexto diário para ${escapeHtml(primary.launch.modelo)} na janela ${escapeHtml(selectedPeriodLabel())}. O mês pode existir no resumo mensal, mas esse bloco não alimenta investimento, ROAS ou CPA.`;

    wrap.innerHTML = `
      ${dailySourceCard('Invest. empresa', primary.aquisicaoInvestimento, fmtBRL, 'Contexto de aquisição', 'daily-source-card--main')}
      ${dailySourceCard('Faturamento empresa', primary.aquisicaoReceita, fmtBRL, 'Mesmo período do lançamento', 'daily-source-card--revenue')}
      ${dailySourceCard('Pedidos empresa', primary.aquisicaoPedidos, fmtNum, 'Pedidos aprovados no período', 'daily-source-card--orders')}
      ${dailySourceCard('ROAS empresa', primary.aquisicaoRoas, (value) => `${fmtNum(value, 2)}x`, 'Faturamento / investimento', 'daily-source-card--efficiency')}
      ${dailySourceCard('CPA empresa', primary.aquisicaoCpa, fmtBRL, 'Investimento / pedidos', 'daily-source-card--efficiency')}
      <div class="daily-source-note">
        ${sourceCopy} A planilha principal de investimento alimenta o total declarado; vendas por canal vêm do payload de pedidos. Meses com contexto diário carregado: ${fmtNum(dailyMonths)}.
      </div>
      <div class="daily-source-lines">
        ${summaries.map(dailySourceLine).join('')}
      </div>
    `;
  }

  function meanKnown(rows, field) {
    const values = rows
      .map((row) => numberOrNull(row[field]))
      .filter((value) => value !== null && value !== undefined);
    return values.length ? values.reduce((acc, value) => acc + value, 0) / values.length : null;
  }

  function paidMediaKpiCard(label, value, formatter, detail, className = '') {
    return `
      <div class="paid-media-kpi ${className}">
        <span>${escapeHtml(label)}</span>
        <strong>${mediaValue(value, formatter)}</strong>
        <small>${escapeHtml(detail || '')}</small>
      </div>
    `;
  }

  function renderPaidMediaKpis(summaries) {
    const wrap = $('paid-media-kpis');
    if (!wrap) return;
    if (!summaries.length) {
      wrap.innerHTML = `<div class="empty-state empty-state--compact"><div><strong>Sem modelos comparados.</strong> Selecione ao menos uma linha para ver investimento.</div></div>`;
      return;
    }

    const primary = summaries.find((row) => row.launch?.modelo_id === state.primaryModelId) || summaries[0];
    const comparable = summaries.filter((row) => row.investimentoTotal !== null && row.investimentoTotal !== undefined);
    const hasPrimaryInvestment = primary.investimentoTotal !== null && primary.investimentoTotal !== undefined;
    const hasPrimaryMediaInvestment = primary.hasMediaInvestment === true;
    const hasPrimaryCompleteWindow = primary.isPartialCommercialWindow !== true;
    const primaryRoas = primary.roasComercial;
    const primaryCpa = primary.cpaComercial;
    const comparableWithEstimates = comparable.map((row) => ({
      ...row,
      estimatedRoas: row.roasComercial,
      estimatedCpa: row.cpaComercial
    }));
    const avgRoas = meanKnown(comparableWithEstimates, 'estimatedRoas');
    const avgCpa = meanKnown(comparableWithEstimates, 'estimatedCpa');
    const roasDelta = primaryRoas !== null && avgRoas !== null ? primaryRoas - avgRoas : null;
    const cpaDelta = primaryCpa !== null && avgCpa !== null ? primaryCpa - avgCpa : null;
    const comparisonText = hasPrimaryInvestment
      ? `Destaque visual: ${primary.launch.modelo} · ${selectedPeriodLabel()}. Investimento vem da planilha principal; ROAS e CPA usam a parcela paga preservada pelo SSOT. Media do grupo: ROAS ${avgRoas === null ? 'sem dado' : `${fmtNum(avgRoas, 2)}x`}${avgCpa === null ? '' : ` · CPA ${fmtBRL(avgCpa)}`}.`
      : `${primary.launch.modelo} ainda nao tem investimento cadastrado na planilha principal para ${selectedPeriodLabel()}. O dashboard deixa vazio ate a base ser atualizada.`;
    const kpiNoteText = hasPrimaryInvestment && !hasPrimaryMediaInvestment
      ? `Destaque visual: ${primary.launch.modelo} - ${selectedPeriodLabel()}. Existe investimento declarado, mas nao existe linha de midia paga para esta janela; ROAS e CPA ficam sem base para nao dividir venda paga por CRM.`
      : hasPrimaryInvestment && !hasPrimaryCompleteWindow
        ? `Destaque visual: ${primary.launch.modelo} - ${selectedPeriodLabel()}. A janela ainda esta parcial; vendas aparecem ate o D+ disponivel, mas ROAS e CPA ficam sem base comparavel.`
        : comparisonText;
    const kpis = [
      { label: 'Investimento', value: primary.investimentoTotal, formatter: fmtBRL, detail: 'planilha principal', className: 'paid-media-kpi--main' },
      { label: 'Receita midia paga', value: primary.receitaComercial, formatter: fmtBRL, detail: 'classificacao SSOT' },
      { label: 'Pedidos midia paga', value: primary.pedidosComercial, formatter: fmtNum, detail: 'classificacao SSOT' },
      { label: 'ROAS midia paga', value: primaryRoas, formatter: (value) => `${fmtNum(value, 2)}x`, detail: !hasPrimaryMediaInvestment ? 'sem midia paga na janela' : !hasPrimaryCompleteWindow ? 'janela parcial' : (roasDelta === null ? 'receita midia paga / investimento' : `${roasDelta >= 0 ? '+' : ''}${fmtNum(roasDelta, 2)}x vs media`), className: 'paid-media-kpi--ratio' },
      { label: 'Pedidos organicos', value: primary.pedidosOrganicos, formatter: fmtNum, detail: 'atribuicao real' }
    ].filter((item) => !item.optional || (item.value !== null && item.value !== undefined));

    wrap.innerHTML = `
      <div class="paid-media-kpi-grid">
        ${kpis.map((item) => paidMediaKpiCard(item.label, item.value, item.formatter, item.detail, item.className || '')).join('')}
      </div>
      <p class="paid-media-kpi-note">${escapeHtml(kpiNoteText)} A planilha diaria foi retirada da analise de investimento.</p>
    `;
  }

  function mediaRevenueCell(row) {
    const value = numberOrNull(row?.receita_atribuida);
    if (value !== null) return `${fmtBRL(value)}${metodologiaComercialBadge(row)}`;
    if (row?.janela_isolada_confiavel && numberOrNull(row?.receita_janela_isolada) !== null) {
      return `${fmtBRL(row.receita_janela_isolada)} ${badge('parcial', 'isolada', row.janela_isolada_motivo || 'Estimativa isolada por janela unica de campanha.')}`;
    }
    return `<span class="cell-muted">Não atribuída à campanha</span><div class="metric-sub">venda fica no consolidado</div>${row?.janela_isolada_motivo ? ` ${badge('neg', 'revisar', row.janela_isolada_motivo)}` : ''}`;
  }

  function mediaManualReadingCell(row) {
    const receita = numberOrNull(row?.receita_atribuida);
    if (receita !== null) {
      return `${badge('pipeline', 'com receita', 'A planilha trouxe receita atribuida para esta linha manual de midia.')}<div class="metric-sub">${fmtBRL(receita)}</div>`;
    }
    if (row?.valor_suspeito) return `${suspeitaComercialBadge(row)}<div class="metric-sub">verificar valor declarado</div>`;
    const motivo = row?.janela_isolada_motivo || 'Investimento declarado manualmente. O resultado de faturamento, pedidos, ROAS e CPA fica no resumo consolidado acima.';
    return `${badge('parcial', 'manual', motivo)}<div class="metric-sub">sem venda por campanha</div>`;
  }

  function crmRevenueCell(row) {
    if (hasTrustedCrmPerformance(row) && numberOrNull(row?.receita_base) !== null) {
      return fmtBRL(row.receita_base);
    }
    if (numberOrNull(row?.receita_base) !== null) {
      return `<span class="cell-muted">Contexto declarado</span><div class="metric-sub">sem atribuição real</div>`;
    }
    return '&mdash;';
  }

  function crmStatusCell(row) {
    if (hasTrustedCrmPerformance(row)) return roasBadge(row.roas);
    return badge('parcial', 'contexto', row?.aviso || 'Disparo declarado sem atribuição real por pedido. Mantido como contexto, sem ROAS/CPA.');
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

  function explicitOrganicOrLegacyCrm(organicValue, crmValue) {
    const organic = numberOrNull(organicValue);
    return organic !== null ? organic : numberOrNull(crmValue);
  }

  function ratioOrNull(numerator, denominator) {
    const n = numberOrNull(numerator);
    const d = numberOrNull(denominator);
    if (n === null || d === null || d === 0) return null;
    return n / d;
  }

  function commercialSummaryFor(launch, mediaRows, crmRows) {
    const selectedWindow = selectedAnalysisWindow(launch);
    const receitaModelo = selectedWindow.data?.receita ?? null;
    const janelaModelo = selectedWindow.label || '&mdash;';
    const aquisicao = null;
    const attribution = investmentAttributionForWindow(launch, selectedPeriodKey());

    const mediaRowsImpacto = mediaRows.filter((row) => midiaValidaParaImpacto(row));
    const mediaRowsInvestimento = mediaRows.filter((row) => midiaValidaParaGraficoComercial(row));
    const mediaAggregateRows = aggregateMediaRows(mediaRowsImpacto, launch);
    const mediaMetricRows = mediaAggregateRows.length ? mediaAggregateRows : mediaRowsImpacto;
    const trustedMediaMetricRows = mediaMetricRows.filter((row) => hasTrustedMediaPerformance(row));
    const trustedCrmRows = crmRows.filter((row) => hasTrustedCrmPerformance(row));
    const mediaInvestimento = sumKnown(mediaRowsInvestimento, 'investimento');
    const mediaInvestimentoAtribuido = sumKnown(trustedMediaMetricRows, 'investimento');
    const mediaReceita = sumKnown(trustedMediaMetricRows, 'receita_atribuida');
    const mediaPedidos = sumKnown(trustedMediaMetricRows, 'pedidos');
    const crmInvestimento = sumKnown(crmRows, 'investimento');
    const crmInvestimentoAtribuido = sumKnown(trustedCrmRows, 'investimento');
    const crmReceita = sumKnown(trustedCrmRows, 'receita_base');
    const crmPedidos = sumKnown(trustedCrmRows, 'pedidos');
    const crmDisparos = crmRows.length;
    const investimentoTotal = sumValues(mediaInvestimento, crmInvestimento);
    const receitaComercial = attribution.receitaInvestimento;
    const pedidosComercial = attribution.pedidosInvestimento;
    const receitaOrganica = attribution.receitaOrganica;
    const pedidosOrganicos = attribution.pedidosOrganicos;
    const isPartialCommercialWindow = selectedSalesWindowIsPartial(launch);
    const canComputeRoas = mediaInvestimento !== null && !isPartialCommercialWindow;
    const roasInvestimento = canComputeRoas ? ratioOrNull(receitaComercial, investimentoTotal) : null;
    const cpaInvestimento = canComputeRoas ? ratioOrNull(investimentoTotal, pedidosComercial) : null;
    const metodologiaRow = [...mediaRows, ...crmRows].find((row) => row.metodologia || row.aviso) || {};

    return {
      launch,
      janelaModelo,
      receitaModelo,
      aquisicaoInvestimento: aquisicao?.investimento ?? null,
      aquisicaoReceita: aquisicao?.receita ?? null,
      aquisicaoPedidos: aquisicao?.pedidos ?? null,
      aquisicaoSessoes: aquisicao?.sessoes ?? null,
      aquisicaoNovosClientes: aquisicao?.novosClientes ?? null,
      aquisicaoRoas: aquisicao?.roas ?? null,
      aquisicaoCpa: aquisicao?.cpa ?? null,
      aquisicaoCps: aquisicao?.cps ?? null,
      aquisicaoCac: aquisicao?.cac ?? null,
      aquisicaoConversao: aquisicao?.conversao ?? null,
      aquisicaoLabel: aquisicao ? `${aquisicao.label} · ${aquisicao.range}${aquisicao.complete ? '' : ` · até D+${fmtNum(aquisicao.observedDay)}`}` : '',
      mediaInvestimento,
      mediaReceita: receitaComercial,
      mediaPedidos: pedidosComercial,
      mediaRoas: roasInvestimento,
      mediaCpa: cpaInvestimento,
      crmInvestimento,
      crmReceita,
      crmPedidos,
      crmDisparos,
      crmRoas: weightedRoas(trustedCrmRows),
      crmCpa: ratioOrNull(crmInvestimentoAtribuido, crmPedidos),
      investimentoTotal,
      hasMediaInvestment: mediaInvestimento !== null,
      hasCrmInvestment: crmInvestimento !== null,
      isPartialCommercialWindow,
      receitaComercial,
      pedidosComercial,
      roasComercial: roasInvestimento,
      cpaComercial: cpaInvestimento,
      receitaOrganica,
      pedidosOrganicos,
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
              ${thTip('Invest. total', 'Soma do investimento declarado na planilha principal: midia_paga + crm_disparos. A planilha diaria foi retirada desta leitura.', 'num')}
              ${thTip('Receita midia paga', 'Receita com sinais de anuncio, como cpc, pmax, paid, demand-gen, performance, ads, display ou source_type pago.', 'num')}
              ${thTip('Pedidos midia paga', 'Pedidos com sinais de anuncio, como cpc, pmax, paid, demand-gen, performance, ads, display ou source_type pago.', 'num')}
              ${thTip('ROAS midia paga', 'Receita dos pedidos de midia paga / investimento total declarado.', 'num')}
              ${thTip('CPA midia paga', 'Investimento total declarado / pedidos de midia paga.', 'num')}
              ${thTip('Receita organica', 'Receita classificada como organica por atribuicao real de pedido.', 'num')}
              ${thTip('Pedidos organicos', 'Pedidos classificados como organicos por atribuicao real de pedido.', 'num')}
            </tr>
          </thead>
          <tbody>
            ${summaries.map((row) => {
              return `
              <tr>
                <td class="model-name">${escapeHtml(row.launch.modelo)}</td>
                <td>${escapeHtml(row.janelaModelo)}</td>
                <td class="num">${mediaValue(row.receitaModelo, fmtBRL)}</td>
                <td class="num">${mediaValue(row.investimentoTotal, fmtBRL)}</td>
                <td class="num">${mediaValue(row.receitaComercial, fmtBRL)}</td>
                <td class="num">${fmtNum(row.pedidosComercial)}</td>
                <td class="num">${roasValue(row.roasComercial)}</td>
                <td class="num">${mediaValue(row.cpaComercial, fmtBRL)}</td>
                <td class="num">${mediaValue(row.receitaOrganica, fmtBRL)}</td>
                <td class="num">${fmtNum(row.pedidosOrganicos)}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : `<div class="empty-state"><div><strong>Selecione ao menos um modelo.</strong>A frente comercial usa os modelos marcados em Comparar com.</div></div>`;
  }

  function renderActionsComparative() {
    renderLineInvestmentTable();
    const launches = selectedCompareLaunches().filter((launch) => !launch.isFuture && !isPlannedStatus(launch.status));
    if (!launches.length) {
      renderActionsComparison([]);
      renderPaidMediaKpis([]);
      $('media-table').innerHTML = `<tr><td colspan="6" class="cell-muted">Selecione ao menos um modelo com D0 e dados reais para comparar investimento.</td></tr>`;
      $('crm-table').innerHTML = `<tr><td colspan="8" class="cell-muted">Selecione ao menos um modelo com D0 e dados reais para ver disparos declarados.</td></tr>`;
      return;
    }
    const mediaByModel = new Map();
    const crmByModel = new Map();
    const detailedRows = launches.flatMap((launch) => {
      const rowsRaw = mediaRowsForInvestmentWindow(launch, selectedPeriodKey())
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

    const commercialSummaries = launches.map((launch) => commercialSummaryFor(
      launch,
      mediaByModel.get(launch.modelo_id) || [],
      crmByModel.get(launch.modelo_id) || []
    ));
    renderActionsComparison(commercialSummaries);
    renderPaidMediaKpis(commercialSummaries);

    const displayRows = [...aggregateMediaRows(detailedRows), ...detailedRows]
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.janela).localeCompare(String(b.janela)) || a.campanha.localeCompare(b.campanha));
    $('media-table').innerHTML = displayRows.length ? displayRows.map((inputRow) => {
      const row = prepareMediaDisplayRow(inputRow);
      return `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${escapeHtml(row.campanha)}</td>
        <td>${escapeHtml(row.janela)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td>${mediaManualReadingCell(row)}</td>
      </tr>`;
    }).join('') : `<tr><td colspan="6" class="cell-muted">Sem investimento de campanha cadastrado para os modelos selecionados.</td></tr>`;

    const crmRows = crmRowsAll
      .sort((a, b) => a.modelo.localeCompare(b.modelo) || String(a.data_disparo || '').localeCompare(String(b.data_disparo || '')));
    $('crm-table').innerHTML = crmRows.length ? crmRows.map((row) => `
      <tr>
        <td class="model-name">${escapeHtml(row.modelo)}</td>
        <td>${fmtDate(row.data_disparo)}</td>
        <td title="${escapeHtml(row.campanha || 'Disparo sem nome')}">${escapeHtml(row.campanha || 'Disparo sem nome')}${metodologiaComercialBadge(row)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${mediaValue(row.investimento, fmtBRL)}</td>
        <td class="num">${crmRevenueCell(row)}</td>
        <td class="num">${hasTrustedCrmPerformance(row) ? roasValue(row.roas) : '&mdash;'}${metodologiaComercialBadge(row)}</td>
        <td>${crmStatusCell(row)}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="cell-muted">Sem disparos declarados para os modelos selecionados.</td></tr>`;
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

  function projectionRealizedHtml(launch, finalWindow) {
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

  function projectionReachedWithoutD90Html(launch) {
    return `
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

  function projectionBaseForSelected(selected) {
    const projectionLaunches = selectedCompareLaunches();
    const projectionWindowKey = selectedPeriodKey();
    return projectionLaunches.find((launch) => launch.modelo_id === selected.modelo_id)
      || projectionLaunches.find((launch) => getWindow(launch, projectionWindowKey));
  }

  function projectionSummaryLabel(projectionBase) {
    if (!projectionBase || projectionBase.isFuture || isPlannedStatus(projectionBase.status)) return 'sem base suficiente';
    const realizedD90 = d90RealizedWindow(projectionBase);
    if (realizedD90) return 'D+90 realizado';
    if (launchReachedD90(projectionBase)) return 'aguardando D+90 no JSON';
    const scenarios = projectionScenariosByMaturity(projectionBase);
    if (!scenarios) return 'sem referência D+90';
    const meta = scenarios[0];
    return meta?.isFallbackBase
      ? `${meta.baseLabel} observado · ${meta.requestedLabel} aberto`
      : `${meta?.baseLabel || selectedPeriodLabel()} observado`;
  }

  function projectionContentHtml(selected) {
    const projectionBase = projectionBaseForSelected(selected);
    if (!projectionBase || projectionBase.isFuture || isPlannedStatus(projectionBase.status)) {
      return `<div class="empty-state"><div><strong>Sem dados suficientes para projeção.</strong>A seção aparece quando o modelo tem uma janela real de venda e existe ao menos uma referência com D+90.</div></div>`;
    }

    const realizedD90 = d90RealizedWindow(projectionBase);
    if (realizedD90) {
      return projectionRealizedHtml(projectionBase, realizedD90);
    }

    if (launchReachedD90(projectionBase)) {
      return projectionReachedWithoutD90Html(projectionBase);
    }

    const scenarios = projectionScenariosByMaturity(projectionBase);
    const scenarioMeta = scenarios?.[0] || null;
    if (!scenarios) {
      return `<div class="empty-state"><div><strong>Sem dados suficientes para projeção.</strong>A seção aparece quando o modelo ainda não chegou a D+90, tem uma janela real de venda e existe ao menos uma referência com D+90.</div></div>`;
    }

    return `
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

  function storyProjectionDrawerHtml(selected) {
    const projectionBase = projectionBaseForSelected(selected);
    const summary = projectionSummaryLabel(projectionBase);
    return `
      <details class="story-projection-details story-step-details">
        <summary><span>Cenário D+90</span><small>${escapeHtml(summary)}</small></summary>
        <div class="story-projection-body">
          ${projectionContentHtml(selected)}
        </div>
      </details>
    `;
  }

  function renderProjection(selected) {
    const wrap = $('projection-content');
    if (wrap) wrap.innerHTML = projectionContentHtml(selected);
  }

  function renderInsights(selected) {
    const eligible = comparableLaunches();
    const activeLaunches = eligible.filter((launch) => launch.isActive);
    const backfilled = eligible.filter((launch) => launch.daily_source === 'historico_backfill');
    const noPipelineRows = eligible.filter((launch) => launch.isActive && !hasPipelineRows(launch));
    const audit = auditQualityForLaunch(selected);
    const manifestWarnings = Array.isArray(state.data?.manifest?.warnings) ? state.data.manifest.warnings : [];
    const mediaBlocked = (state.data?.midia_paga || []).filter((row) => row.atribuicao_bloqueada || normalizeText(row.metodologia) === 'receita janela agregada');
    const attributionAudit = state.data?.manifest?.data_quality?.atribuicao_canal || {};
    const attributionStatus = normalizeText(attributionAudit.status);
    const mediaWithoutAttribution = (state.data?.midia_paga || []).filter((row) => numberOrNull(row.investimento) !== null && numberOrNull(row.receita_atribuida) === null);
    const crmContextOnly = (state.data?.crm_disparos || []).filter((row) => commercialMethodIsEstimated(row) || normalizeText(row.metodologia).includes('correl'));

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
        title: 'Investimento sem atribuição por pedido',
        copy: `${mediaBlocked.length} linha(s) de investimento ficaram sem ROAS porque a receita ainda não representa last-click por pedido.`
      } : null,
      attributionStatus && attributionStatus !== 'ok' ? {
        type: 'warn',
        title: 'Investimento/orgânico aguardando atribuição',
        copy: 'O painel não mostra vendas de investimento/orgânicas como reais enquanto a tabela mirror de atribuição por pedido não estiver preenchida.'
      } : null,
      mediaWithoutAttribution.length ? {
        type: 'warn',
        title: 'Campanhas manuais sem receita real',
        copy: `${mediaWithoutAttribution.length} linha(s) de mídia mostram investimento declarado, mas não entram em ROAS/CPA por falta de receita atribuída real.`
      } : null,
      crmContextOnly.length ? {
        type: 'warn',
        title: 'CRM como contexto',
        copy: `${crmContextOnly.length} disparo(s) de CRM têm correlação/estimativa e ficam fora das métricas reais de performance.`
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
    $('selected-title').textContent = 'Desempenho comparativo';
    const selectedStatus = $('selected-status');
    if (selectedStatus) selectedStatus.innerHTML = badge('pipeline', `${fmtNum(comparisonLaunchesWithFocus(selected).length)} linhas`);
    renderSelectedHeader(selected);
    renderModelSelector();
    renderPeriodSelector();
    renderLineSelector();
    renderCompareSelector();
    renderProductSelector();
    renderChannelSelector();
    renderTopMeta();
    renderAnalysisContext(selected);
    renderReadingSupport(selected);
    renderStoryBrief(selected);
    renderCharts(selected);
    renderAdvancedClients();
    renderAdvancedLifecycle();
    renderAdvancedChannelsRoas();
    renderAdvancedAlerts();
    applyCollapsibleLists(document);
  }

  function getDashboardSnapshot() {
    return {
      data: state.data,
      launches: state.launches,
      primaryModelId: state.primaryModelId,
      compareModelIds: [...(state.compareModelIds || [])],
      lineFilter: state.lineFilter || 'all',
      productFilter: state.productFilter || 'all',
      productColorFilter: state.productColorFilter || 'all',
      channelFilter: state.channelFilter || 'all',
      analysisPeriodKey: selectedPeriodKey(),
      analysisPeriodLabel: selectedPeriodLabel(),
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
    configureNormalizedRampMetricToggle();
    configureCommercialChartMetricToggle();
    configureLaunchChartViewToggle();
    configureLaunchChartZoom();
    configureTopicTabs();
    configureStorySubModelControls();
    configureStoryDrawerAccordion();
    configureLaunchTableInsights();
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
