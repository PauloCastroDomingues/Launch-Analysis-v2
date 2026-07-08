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
    'manifest'
  ];

  const CORES_MODELO = {
    gt: { line: '#F07800', fill: 'rgba(240,120,0,0.12)' },
    avant: { line: '#4C9F6A', fill: 'rgba(76,159,106,0.12)' },
    phantom: { line: '#7B8FE0', fill: 'rgba(123,143,224,0.12)' },
    rs8_monochrome: { line: '#E0B84C', fill: 'rgba(224,184,76,0.12)' },
    pais_2026: { line: '#5BB8D4', fill: 'rgba(91,184,212,0.12)' },
    _fallback: ['#E05252', '#5BB8D4', '#A87FD4', '#8FBD56']
  };

  const state = {
    data: null,
    launches: [],
    primaryModelId: 'phantom',
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
    return new Date(y, m - 1, d, 12, 0, 0);
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

  async function loadData() {
    const out = {};
    for (const name of DATA_FILES) {
      try {
        const res = await fetch(`data/${name}.json`, { cache: 'no-store' });
        if (!res.ok) throw new Error(`${name}: ${res.status}`);
        out[name] = await res.json();
      } catch (err) {
        if (window.REISE_FALLBACK_DATA?.[name] !== undefined) {
          out[name] = window.REISE_FALLBACK_DATA[name];
        } else {
          out[name] = name === 'manifest' ? {} : [];
        }
      }
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
        ticket: (orderIds.size || row.pedidos) ? row.receita / (orderIds.size || row.pedidos) : null
      }));

    const buildAggregate = (filtered, origem, day = null) => {
      if (!filtered.length) return null;
      const receita = sumNullable(filtered, 'receita');
      const pares = sumNullable(filtered, 'pares');
      const pedidosSomados = sumNullable(filtered, 'pedidos') || 0;
      const pedidosDistintos = new Set(filtered.map((row) => row.source_order_id).filter(Boolean));
      const pedidos = pedidosDistintos.size || pedidosSomados;
      const novos = filtered.reduce((acc, row) => acc + Number(row.novos || 0), 0);
      const recorrentes = filtered.reduce((acc, row) => acc + Number(row.recorrentes || 0), 0);
      return {
        receita,
        pares,
        pedidos,
        ticket: pedidos && receita !== null ? receita / pedidos : null,
        novos_pct: novos + recorrentes ? novos / (novos + recorrentes) : null,
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

    const windows = { '15d': 15, '30d': 30, '60d': 60, '90d': 90 };
    const janelas = {};
    Object.entries(windows).forEach(([key, days]) => {
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
    const m30 = hasRevenue('30d') && hasRevenue('15d') && janelas['15d'].receita ? janelas['30d'].receita / janelas['15d'].receita : null;
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
      multiplicadores: { m30_15: m30, m90_15, m90_30 },
      daily,
      acumulado_atual: acumuladoAtual,
      first_sale_date: firstSaleDate,
      first_sale_gap_dias: firstSaleDate ? Math.max(0, daysBetween(model.day_zero_base, toDate(firstSaleDate)) || 0) : null,
      origem: 'pipeline',
      tamanhos: [...tamanhosMap.values()]
    };
  }

  function buildLaunches(data) {
    const histById = new Map(data.lancamentos_historico.map((item) => [item.modelo_id, item]));
    return data.lancamentos_modelos.map((model, idx) => {
      const hist = histById.get(model.modelo_id);
      const pipelineRows = (data.lancamentos_produtos_dia || []).filter((row) => row.modelo_id === model.modelo_id);
      const pipeline = aggregatePipeline(model, data.lancamentos_produtos_dia || []);
      const metrics = pipeline || hist || {
        modelo_id: model.modelo_id,
        modelo: model.modelo,
        day_zero_base: model.day_zero_base,
        data_oficial: model.data_oficial,
        gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(model.day_zero_base)) || 0),
        janelas: { '15d': null, '30d': null, '60d': null, '90d': null },
        multiplicadores: { m30_15: null, m90_15: null, m90_30: null },
        semanas: [],
        cores: [],
        tamanhos: [],
        daily: [],
        acumulado_atual: null,
        first_sale_date: null,
        first_sale_gap_dias: null,
        origem: model.status === 'planejado' ? 'planejado' : 'pipeline'
      };
      const d0 = model.day_zero_base || model.data_lancamento;
      const dPlus = daysBetween(d0, TODAY);
      const isFuture = toDate(d0) > TODAY;
      const isActive = !isFuture && dPlus < 90 && model.status !== 'historico';
      const isHistorical = model.status === 'historico' || (dPlus >= 90 && model.status !== 'planejado');
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
        isHistorical
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
    if (getWindow(launch, '90d')) return { key: '90d', data: getWindow(launch, '90d') };
    return { key: null, data: null };
  }

  function hasPipelineRows(launch) {
    return Number(launch?.pipelineRowCount || 0) > 0;
  }

  function numberOrNull(value) {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isNaN(num) ? null : num;
  }

  function coverageBadge(launch, key) {
    const win = getWindow(launch, key);
    if (!win) return '—';
    if (win.origem === 'historico' || launch.status === 'historico') return badge('historico', 'Histórico');
    const days = { '15d': 15, '30d': 30, '90d': 90 }[key] || 0;
    const dCount = (launch.dPlus ?? 0) + 1;
    if (dCount < days) return badge('parcial', `Parcial D+${Math.max(0, launch.dPlus)}`);
    return badge('pipeline', 'Pipeline');
  }

  function sourceBadge(launch) {
    const hasAnyWindow = ['15d', '30d', '60d', '90d'].some((key) => Boolean(getWindow(launch, key)));
    if (launch.isFuture) return badge('planejado', 'Planejado');
    if (launch.status === 'historico') return badge('historico', 'Histórico');
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
      <details class="compare-dropdown">
        <summary>
          <span>${escapeHtml(label)}</span>
          <span class="compare-dropdown-count">${fmtNum(selectedLaunches.length)} de ${fmtNum(launches.length)}</span>
        </summary>
        <div class="compare-menu">
          ${launches.map((launch) => {
            const active = selected.has(launch.modelo_id);
            return `<label class="compare-option ${active ? 'active' : ''}">
              <input type="checkbox" value="${launch.modelo_id}" ${active ? 'checked' : ''}>
              <span class="dot" style="color:${colorFor(launch.modelo_id, launch.order)}"></span>
              <span>${escapeHtml(launch.modelo)}</span>
            </label>`;
          }).join('')}
        </div>
      </details>`;
    wrap.querySelectorAll('input').forEach((input) => {
      input.addEventListener('change', () => {
        const ids = new Set(state.compareModelIds || []);
        if (input.checked) ids.add(input.value);
        else ids.delete(input.value);
        state.compareModelIds = [...ids];
        renderAll();
      });
    });
    warning.textContent = hasEnoughComparison() ? '' : 'Selecione pelo menos dois modelos para comparar.';
  }

  function renderTopMeta() {
    const manifest = state.data.manifest || {};
    $('last-update').textContent = manifest.generated_at ? fmtDate(manifest.generated_at.slice(0, 10)) : '—';
    $('model-count').textContent = state.launches.length;
    $('active-count').textContent = state.launches.filter((l) => l.isActive).length;
    $('planned-count').textContent = state.launches.filter((l) => l.status === 'planejado').length;
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

    if (selected?.modelo_id === 'gt') {
      rows.push({
        title: 'GT Collection',
        copy: 'Usa day_zero_base 11/02/2025 por gap de 116 dias contra o lançamento oficial. Comparação de abertura exige ressalva.',
        badge: badge('parcial', 'Gap 116d')
      });
    }
    if (selected?.modelo_id === 'avant') {
      rows.push({
        title: 'Avant 90d',
        copy: 'Janela 90d passa por Black Friday, Cyber Monday e Natal. Multiplicador final fica inflado.',
        badge: badge('parcial', 'Sazonalidade')
      });
    }
    if (selected?.modelo_id === 'rs8_monochrome') {
      rows.push({
        title: 'RS8 Monochrome',
        copy: 'Modelo em curso. Se aparecer zerado, a correção deve acontecer no JSON de pipeline, não no front.',
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
      const hist = state.launches.filter((l) => l.status === 'historico');
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
              <div><div class="metric-sub">Ticket médio</div><div class="metric-value">${fmtBRL(avgTicket)}</div></div>
            </div>
            <p class="section-desc" style="margin-top:16px">O dashboard já calcula sazonalidade futura a partir de calendario_br.json. Depois do D0, os dados entram pelo pipeline.</p>
          </div>
        </div>`;
      return;
    }

    const closedWindow = bestWindow(selected);
    const isCurrentAccumulated = !closedWindow.data && Boolean(selected.acumulado_atual);
    const key = isCurrentAccumulated ? `D+${selected.acumulado_atual.day}` : closedWindow.key;
    const data = closedWindow.data || selected.acumulado_atual;
    const windowDays = isCurrentAccumulated ? (selected.acumulado_atual.day + 1) : Number(String(key || '').replace('d', ''));
    const velocity = data?.receita && windowDays ? data.receita / windowDays : null;
    const previous = previousLaunch(selected);
    const prevWin = previous && !isCurrentAccumulated ? getWindow(previous, key || '30d') : null;
    const delta = data?.receita && prevWin?.receita ? (data.receita / prevWin.receita) - 1 : null;
    const dataSub = isCurrentAccumulated ? badge('parcial', `Acumulado atual ${key}`) : coverageBadge(selected, key);

    const cards = [
      { label: isCurrentAccumulated ? 'Faturamento atual' : `Faturamento ${key || ''}`, value: fmtBRL(data?.receita), sub: dataSub },
      { label: 'Pedidos', value: fmtNum(data?.pedidos), sub: data?.pedidos ? `${fmtNum(data.pedidos)} pedidos` : 'Sem pedidos no JSON' },
      { label: 'Ticket médio', value: fmtBRL(data?.ticket), sub: data?.ticket ? (isCurrentAccumulated ? `Acumulado ${key}` : `Janela ${key}`) : '—' },
      { label: '% Clientes novos', value: fmtPct(data?.novos_pct), sub: data?.novos_pct != null ? `${fmtPct(1 - data.novos_pct)} recorrentes` : '—' },
      { label: 'Pares vendidos', value: fmtNum(data?.pares), sub: data?.pares ? `${fmtNum(data.pares)} pares` : 'Sem pares no JSON' }
    ];

    const empty = !data ? `<div class="empty-state"><div><strong>${selected.isActive && !hasPipelineRows(selected) ? 'Sem dados carregados no pipeline.' : 'Sem dados de venda para este lançamento.'}</strong> Verifique BigQuery, termos de busca e exportação do Apps Script. A tela não transforma ausência em zero.</div></div>` : '';

    container.innerHTML = `
      <div class="grid grid-5">
        ${cards.map((card) => `
          <div class="card">
            <div class="metric-label">${escapeHtml(card.label)}</div>
            <div class="metric-value">${card.value}</div>
            <div class="metric-sub">${card.sub}</div>
          </div>`).join('')}
      </div>
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
      .filter((l) => l.modelo_id !== selected.modelo_id && !l.isFuture)
      .sort((a, b) => toDate(a.d0) - toDate(b.d0));
    const idx = hist.findIndex((l) => toDate(l.d0) > toDate(selected.d0));
    if (idx > 0) return hist[idx - 1];
    const before = hist.filter((l) => toDate(l.d0) < toDate(selected.d0));
    return before[before.length - 1] || hist[hist.length - 1] || null;
  }

  function isPlannedLaunch(launch) {
    return launch?.status === 'planejado' || launch?.isFuture;
  }

  function comparableLaunches() {
    return state.launches.filter((launch) => !isPlannedLaunch(launch));
  }

  function selectedCompareLaunches() {
    const allowed = comparableLaunches();
    const selectedIds = new Set(state.compareModelIds || []);
    return allowed.filter((launch) => selectedIds.has(launch.modelo_id));
  }

  function hasEnoughComparison() {
    return selectedCompareLaunches().length >= 2;
  }

  function comparisonEmptyMessage(colspan) {
    return `<tr><td colspan="${colspan}" class="cell-muted">Selecione pelo menos dois modelos para comparar.</td></tr>`;
  }

  function syncSelectionState() {
    const comparable = comparableLaunches();
    if (!comparable.length) return;

    if (!comparable.some((launch) => launch.modelo_id === state.primaryModelId)) {
      state.primaryModelId = comparable.find((launch) => launch.modelo_id === 'phantom')?.modelo_id || comparable[0].modelo_id;
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
    if (launches.length < 2) {
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
      { title: 'Faturamento 15d', get: (l) => getWindow(l, '15d')?.receita, fmt: fmtBRL },
      { title: 'Faturamento 30d', get: (l) => getWindow(l, '30d')?.receita, fmt: fmtBRL },
      { title: 'Ticket 30d', get: (l) => getWindow(l, '30d')?.ticket, fmt: fmtBRL },
      { title: 'Pares 30d', get: (l) => getWindow(l, '30d')?.pares, fmt: fmtNum },
      { title: '% novos 30d', get: (l) => getWindow(l, '30d')?.novos_pct, fmt: fmtPct },
      { title: 'Velocidade R$/dia', get: windowVelocity, fmt: fmtBRL }
    ];
    const launches = selectedCompareLaunches();
    if (launches.length < 2) {
      $('ranking-grid').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione pelo menos dois modelos para comparar.</strong>Rankings usam somente os modelos marcados em Comparar com.</div></div>`;
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
    if (launches.length < 2) {
      $('historical-average').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione pelo menos dois modelos para comparar.</strong>A média histórica usa os modelos marcados em Comparar com.</div></div>`;
      return;
    }

    const day = comparisonDay(selected);
    const dailyRefs = launches.filter((l) => l.status === 'historico' && l.daily?.length);
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
      const refs = launches.filter((l) => l.status === 'historico' && getWindow(l, fallbackKey)?.receita);
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
    if (launches.length < 2) {
      $('comparison-table').innerHTML = comparisonEmptyMessage(8);
      return;
    }

    const rows = launches.map((launch) => {
      const j15 = getWindow(launch, '15d');
      const j30 = getWindow(launch, '30d');
      const j90 = getWindow(launch, '90d');
      const mult = launch.multiplicadores?.m90_30;
      return `
        <tr>
          <td class="model-name">${escapeHtml(launch.modelo)}<div class="metric-sub">D0: ${fmtDate(launch.d0)}</div></td>
          <td>${fmtBRL(j15?.receita)}<div>${coverageBadge(launch, '15d')}</div></td>
          <td>${fmtBRL(j30?.receita)}<div>${coverageBadge(launch, '30d')}</div></td>
          <td>${fmtBRL(j90?.receita)}<div>${coverageBadge(launch, '90d')}</div></td>
          <td class="num">${fmtBRL(j30?.ticket)}</td>
          <td class="num">${fmtPct(j30?.novos_pct, 1)}</td>
          <td class="num">${mult ? `${fmtNum(mult, 2)}×` : '—'}</td>
          <td>${sourceBadge(launch)}</td>
        </tr>`;
    }).join('');
    $('comparison-table').innerHTML = rows || `<tr><td colspan="8" class="cell-muted">Sem lançamentos com dados reais para comparar.</td></tr>`;
  }

  function renderCharts(selected) {
    destroyCharts();
    if (!window.Chart) return;

    const chartLaunches = selectedCompareLaunches();
    const labels = ['15d', '30d', '90d'];
    const windowChartLaunches = chartLaunches.filter((launch) => labels.some((key) => Boolean(getWindow(launch, key))));

    createChart('chart-revenue', {
      type: 'bar',
      data: {
        labels: labels.map((l) => l.replace('d', ' dias')),
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
        labels: labels.map((l) => l.replace('d', ' dias')),
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
        labels: ['30÷15', '90÷15', '90÷30'],
        datasets: windowChartLaunches.map((launch, index) => ({
          label: launch.modelo,
          data: [launch.multiplicadores?.m30_15 ?? null, launch.multiplicadores?.m90_15 ?? null, launch.multiplicadores?.m90_30 ?? null],
          backgroundColor: colorFor(launch.modelo_id, index),
          borderRadius: 4
        }))
      },
      options: chartOptions({ scales: { x: { grid: { display: false } }, y: { ticks: { callback: (v) => `${fmtNum(v, 1)}×` } } } })
    });

    createChart('chart-mix', {
      type: 'bar',
      data: {
        labels: windowChartLaunches.map((l) => l.modelo),
        datasets: [
          {
            label: 'Novos',
            data: windowChartLaunches.map((l) => {
              const pct = getWindow(l, '30d')?.novos_pct;
              return pct == null ? null : pct * 100;
            }),
            backgroundColor: '#F07800',
            borderRadius: 4
          },
          {
            label: 'Recorrentes',
            data: windowChartLaunches.map((l) => {
              const pct = getWindow(l, '30d')?.novos_pct;
              return pct == null ? null : (1 - pct) * 100;
            }),
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

    const weekly = chartLaunches.find((l) => l.modelo_id === selected.modelo_id && l.semanas?.length) || chartLaunches.find((l) => l.semanas?.length);
    $('weekly-title').textContent = weekly ? `${weekly.modelo} — semana a semana` : 'Semana a semana';
    createChart('chart-weekly', {
      type: 'bar',
      data: {
        labels: weekly?.semanas?.map((w) => w.label) || [],
        datasets: [
          { label: 'Faturamento', data: weekly?.semanas?.map((w) => w.receita) || [], backgroundColor: colorFor(weekly?.modelo_id || 'phantom'), yAxisID: 'y', borderRadius: 4 },
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
    createChart('chart-normalized', {
      type: 'line',
      data: {
        labels: normalizedLabels,
        datasets: chartLaunches.map((launch, index) => {
          const data = Array(91).fill(null);
          const hasDaily = Boolean(launch.daily?.length);
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
            const points = [
              { day: 15, value: getWindow(launch, '15d')?.receita },
              { day: 30, value: getWindow(launch, '30d')?.receita },
              { day: 90, value: getWindow(launch, '90d')?.receita }
            ];
            points.forEach((point) => {
              if (point.value !== null && point.value !== undefined) data[point.day] = point.value;
            });
          }
          return {
            label: hasDaily ? launch.modelo : `${launch.modelo} · agregado`,
            data,
            borderColor: colorFor(launch.modelo_id, index),
            backgroundColor: fillFor(launch.modelo_id, index),
            borderDash: hasDaily ? [] : [6, 5],
            pointRadius: hasDaily ? 1.8 : 4,
            pointHoverRadius: 5,
            tension: hasDaily ? 0.25 : 0,
            spanGaps: !hasDaily,
            sourceLabel: hasDaily ? 'diário real' : 'histórico agregado'
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
            ticks: { callback: (_, index) => index === 0 ? 'D0' : index % 15 === 0 ? `D+${index}` : '' }
          },
          y: { ticks: { callback: (v) => fmtBRL(v, true) } }
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
    if (launches.length < 2) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Selecione pelo menos dois modelos para comparar.</strong>O mix usa somente os modelos marcados em Comparar com.</div></div>`;
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
    if (launches.length < 2) {
      container.innerHTML = `<div class="empty-state"><div><strong>Selecione pelo menos dois modelos para comparar.</strong>O ranking de tamanhos usa somente os modelos marcados em Comparar com.</div></div>`;
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
    const windows = [
      { key: '15d', label: '15 dias', end: 14 },
      { key: '30d', label: '30 dias', end: 29 },
      { key: '90d', label: '90 dias', end: 89 }
    ];
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
    if (days <= 15) return '15d';
    if (days <= 30) return '30d';
    if (days <= 90) return '90d';
    return `${days}d`;
  }

  function normalizeMediaRow(row, launch) {
    const investimento = numberOrNull(row.investimento);
    const receita = numberOrNull(row.receita_atribuida);
    const pedidos = numberOrNull(row.pedidos);
    const roas = numberOrNull(row.roas) ?? (investimento && receita !== null ? receita / investimento : null);
    const cpa = numberOrNull(row.cpa) ?? (investimento !== null && pedidos ? investimento / pedidos : null);
    return {
      campanha: row.campanha || 'Campanha sem nome',
      janela: inferMediaWindow(row, launch),
      canal: row.canal || '—',
      investimento,
      receita_atribuida: receita,
      pedidos,
      roas,
      cpa,
      status: row.status || ''
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
        aggregate: true
      };
      current.investimento += row.investimento || 0;
      current.receita_atribuida += row.receita_atribuida || 0;
      current.pedidos += row.pedidos || 0;
      groups.set(key, current);
    });
    return [...groups.values()].map((row) => ({
      ...row,
      roas: row.investimento ? row.receita_atribuida / row.investimento : null,
      cpa: row.pedidos ? row.investimento / row.pedidos : null
    }));
  }

  function mediaValue(value, formatter) {
    return value === null || value === undefined ? '—' : formatter(value);
  }

  function renderActions(selected) {
    if (selected.isFuture || selected.status === 'planejado') {
      $('media-table').innerHTML = `<tr><td colspan="8" class="cell-muted">Lançamento planejado: mídia paga fica fora da análise até D0 e dados reais.</td></tr>`;
      $('crm-table').innerHTML = `<tr><td colspan="6" class="cell-muted">Lançamento planejado: CRM fica fora da análise até D0 e dados reais.</td></tr>`;
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
        <td class="num">${row.roas == null ? '—' : `${fmtNum(row.roas, 2)}×`}</td>
        <td class="num">${mediaValue(row.cpa, fmtBRL)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="8" class="cell-muted">Sem mídia paga cadastrada para este modelo.</td></tr>`;

    const crmRows = (state.data.crm_disparos || []).filter((row) => row.modelo_id === selected.modelo_id);
    $('crm-table').innerHTML = crmRows.length ? crmRows.map((row) => `
      <tr>
        <td>${fmtDate(row.data_disparo)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${fmtBRL(row.receita_linha)}</td>
        <td class="num">${row.receita_dia == null ? '—' : fmtBRL(row.receita_dia)}</td>
        <td class="num">${row.roas_proxy == null ? '—' : `${fmtNum(row.roas_proxy, 2)}×`}</td>
        <td>${roasBadge(row.roas_proxy)}</td>
      </tr>`).join('') : `<tr><td colspan="6" class="cell-muted">Sem disparos de CRM cadastrados para este modelo.</td></tr>`;
  }

  function projectionScenarios(selected) {
    const hist = state.launches.filter((l) => l.status === 'historico' && l.multiplicadores?.m90_30);
    const refAvant = state.launches.find((l) => l.modelo_id === 'avant')?.multiplicadores?.m90_30 ?? 2.58;
    const refGt = state.launches.find((l) => l.modelo_id === 'gt')?.multiplicadores?.m90_30 ?? 4.86;
    const avg = hist.length ? hist.reduce((acc, l) => acc + l.multiplicadores.m90_30, 0) / hist.length : 3.72;
    const baseWindow = getWindow(selected, '30d') || getWindow(selected, '15d');
    if (!baseWindow?.receita) return null;
    const factorBase = getWindow(selected, '30d') ? baseWindow.receita : baseWindow.receita * 2;
    const ticketPar = baseWindow.pares ? baseWindow.receita / baseWindow.pares : null;
    return [
      { name: 'Conservador', label: `Avant ${fmtNum(refAvant, 2)}×`, mult: refAvant, value: factorBase * refAvant },
      { name: 'Base ★', label: `Média ${fmtNum(avg, 2)}×`, mult: avg, value: factorBase * avg, base: true },
      { name: 'Otimista', label: `GT ${fmtNum(refGt, 2)}×`, mult: refGt, value: factorBase * refGt }
    ].map((s) => ({ ...s, pairs: ticketPar ? s.value / ticketPar : null }));
  }

  function renderProjection(selected) {
    const projectionLaunches = selectedCompareLaunches();
    const projectionBase = projectionLaunches.find((launch) => launch.modelo_id === selected.modelo_id)
      || projectionLaunches.find((launch) => getWindow(launch, '30d') || getWindow(launch, '15d'));
    const scenarios = projectionBase ? projectionScenarios(projectionBase) : null;
    if (!scenarios || !projectionBase || projectionBase.isFuture || projectionBase.status === 'planejado') {
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
        <p class="section-desc">Avant 90d foi inflado por Black Friday/Natal. O multiplicador conservador pode estar subestimado para uma curva sem BF/Natal, mas deve continuar sinalizado.</p>
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
    const global = [
      { type: 'pos', title: 'Phantom abre com maior ticket médio das três linhas', copy: 'R$ 961 no 30d, contra R$ 735 no Avant e R$ 912 no GT. O posicionamento premium se sustenta na abertura.' },
      { type: 'warn', title: 'Avant precisa de ressalva na curva 90d', copy: 'Black Friday, Cyber Monday e Natal entram na janela e inflam o resultado. Use como referência, não como verdade limpa.' },
      { type: 'neg', title: 'GT não deve comparar abertura com Phantom/Avant', copy: 'O gap de 116 dias deixa a primeira venda disponível longe do D0 oficial. Serve melhor como curva histórica, não como lançamento limpo.' },
      { type: 'warn', title: 'CRM Phantom precisa revisão', copy: 'O histórico antigo mostra 8 de 10 disparos sem retorno. O dashboard mantém o alerta para orientar timing, segmentação e copy.' },
      { type: 'pos', title: 'Novo lançamento sem código novo', copy: 'RS8 Avant Monochrome e Dia dos Pais entram pela planilha/JSON. O front só lê os dados.' }
    ];
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
    renderActions(selected);
    renderProjection(selected);
    renderInsights(selected);
  }

  async function init() {
    configureChartDefaults();
    state.data = await loadData();
    state.launches = buildLaunches(state.data);
    const comparable = comparableLaunches();
    const preferred = comparable.find((l) => l.modelo_id === 'phantom') || comparable.find((l) => l.isActive) || comparable[0] || state.launches[0];
    state.primaryModelId = preferred?.modelo_id;
    state.compareModelIds = comparable.map((launch) => launch.modelo_id);
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
