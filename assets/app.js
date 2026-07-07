(() => {
  const TODAY = new Date('2026-07-07T12:00:00-03:00');
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
    selectedId: 'phantom',
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

  function aggregatePipeline(model, rows) {
    const modelRows = rows.filter((row) => row.modelo_id === model.modelo_id);
    if (!modelRows.length) return null;

    const windows = { '15d': 15, '30d': 30, '90d': 90 };
    const janelas = {};
    Object.entries(windows).forEach(([key, days]) => {
      const filtered = modelRows.filter((row) => {
        const idx = dayIndex(model.day_zero_base, row.data);
        return idx !== null && idx >= 0 && idx < days;
      });
      if (!filtered.length) {
        janelas[key] = null;
        return;
      }
      const receita = filtered.reduce((acc, row) => acc + Number(row.receita || 0), 0);
      const pares = filtered.reduce((acc, row) => acc + Number(row.pares || 0), 0);
      const pedidos = filtered.reduce((acc, row) => acc + Number(row.pedidos || 0), 0);
      const novos = filtered.reduce((acc, row) => acc + Number(row.novos || 0), 0);
      const recorrentes = filtered.reduce((acc, row) => acc + Number(row.recorrentes || 0), 0);
      janelas[key] = {
        receita,
        pares,
        pedidos,
        ticket: pedidos ? receita / pedidos : null,
        novos_pct: novos + recorrentes ? novos / (novos + recorrentes) : null,
        origem: 'pipeline'
      };
    });

    const semanasMap = new Map();
    modelRows.forEach((row) => {
      const idx = dayIndex(model.day_zero_base, row.data);
      if (idx === null || idx < 0) return;
      const week = Math.floor(idx / 7) + 1;
      const key = `Sem ${week}`;
      const current = semanasMap.get(key) || { label: key, receita: 0, pedidos: 0 };
      current.receita += Number(row.receita || 0);
      current.pedidos += Number(row.pedidos || 0);
      semanasMap.set(key, current);
    });

    const coresMap = new Map();
    modelRows.forEach((row) => {
      const sub = row.sub_modelo || row.modelo || model.modelo;
      const cor = row.cor || 'Sem cor';
      const key = `${sub}::${cor}`;
      const current = coresMap.get(key) || { sub_modelo: sub, cor, pares: 0 };
      current.pares += Number(row.pares || 0);
      coresMap.set(key, current);
    });

    const m30 = janelas['30d']?.receita && janelas['15d']?.receita ? janelas['30d'].receita / janelas['15d'].receita : null;
    const m90_15 = janelas['90d']?.receita && janelas['15d']?.receita ? janelas['90d'].receita / janelas['15d'].receita : null;
    const m90_30 = janelas['90d']?.receita && janelas['30d']?.receita ? janelas['90d'].receita / janelas['30d'].receita : null;

    return {
      modelo_id: model.modelo_id,
      modelo: model.modelo,
      day_zero_base: model.day_zero_base,
      data_oficial: model.data_oficial,
      gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(model.day_zero_base)) || 0),
      janelas,
      semanas: [...semanasMap.values()],
      cores: [...coresMap.values()],
      multiplicadores: { m30_15: m30, m90_15, m90_30 },
      origem: 'pipeline'
    };
  }

  function buildLaunches(data) {
    const histById = new Map(data.lancamentos_historico.map((item) => [item.modelo_id, item]));
    return data.lancamentos_modelos.map((model, idx) => {
      const hist = histById.get(model.modelo_id);
      const pipeline = aggregatePipeline(model, data.lancamentos_produtos_dia || []);
      const metrics = pipeline || hist || {
        modelo_id: model.modelo_id,
        modelo: model.modelo,
        day_zero_base: model.day_zero_base,
        data_oficial: model.data_oficial,
        gap_dias: Math.max(0, daysBetween(model.data_oficial, toDate(model.day_zero_base)) || 0),
        janelas: { '15d': null, '30d': null, '90d': null },
        multiplicadores: { m30_15: null, m90_15: null, m90_30: null },
        semanas: [],
        cores: [],
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
    const hasAnyWindow = ['15d', '30d', '90d'].some((key) => Boolean(getWindow(launch, key)));
    if (launch.isFuture) return badge('planejado', 'Planejado');
    if (launch.status === 'historico') return badge('historico', 'Histórico');
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
    wrap.innerHTML = state.launches.map((launch) => {
      const cls = ['model-pill'];
      if (launch.modelo_id === state.selectedId) cls.push('active');
      if (launch.isFuture) cls.push('planned');
      const status = launch.isFuture ? '⏱' : launch.isActive ? '●' : '';
      return `<button class="${cls.join(' ')}" data-model="${launch.modelo_id}">
        <span class="dot" style="color:${colorFor(launch.modelo_id, launch.order)}"></span>
        ${escapeHtml(launch.modelo)} ${status}
      </button>`;
    }).join('');
    wrap.querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        state.selectedId = btn.dataset.model;
        renderAll();
      });
    });
  }

  function renderTopMeta() {
    const manifest = state.data.manifest || {};
    $('last-update').textContent = manifest.generated_at ? fmtDate(manifest.generated_at.slice(0, 10)) : '—';
    $('model-count').textContent = state.launches.length;
    $('active-count').textContent = state.launches.filter((l) => l.isActive).length;
    $('planned-count').textContent = state.launches.filter((l) => l.isFuture).length;
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
        copy: 'Vendas e estoque vêm do BigQuery em southamerica-east1. A query usa D0 inclusivo com filtro >=.',
        badge: badge('pipeline', 'BigQuery')
      },
      {
        title: 'Dado ausente',
        copy: 'Tabelas exibem “—” e gráficos usam null. Nunca convertem ausência em zero.',
        badge: badge('parcial', 'Regra fixa')
      }
    ];

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

    const { key, data } = bestWindow(selected);
    const velocity = data?.receita && key ? data.receita / Number(key.replace('d', '')) : null;
    const previous = previousLaunch(selected);
    const prevWin = previous ? getWindow(previous, key || '30d') : null;
    const delta = data?.receita && prevWin?.receita ? (data.receita / prevWin.receita) - 1 : null;

    const cards = [
      { label: `Faturamento ${key || ''}`, value: fmtBRL(data?.receita), sub: coverageBadge(selected, key) },
      { label: 'Pedidos', value: fmtNum(data?.pedidos), sub: data?.pedidos ? `${fmtNum(data.pedidos)} pedidos` : 'Sem pedidos no JSON' },
      { label: 'Ticket médio', value: fmtBRL(data?.ticket), sub: data?.ticket ? `Janela ${key}` : '—' },
      { label: '% Clientes novos', value: fmtPct(data?.novos_pct), sub: data?.novos_pct != null ? `${fmtPct(1 - data.novos_pct)} recorrentes` : '—' },
      { label: 'Pares vendidos', value: fmtNum(data?.pares), sub: data?.pares ? `${fmtNum(data.pares)} pares` : 'Sem pares no JSON' }
    ];

    const empty = !data ? `<div class="empty-state"><div><strong>Sem dados de venda para este lançamento.</strong>Rode o Apps Script para gerar data/lancamentos_produtos_dia.json. A tela não transforma ausência em zero.</div></div>` : '';

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
          <div class="metric-sub">R$/dia na janela ${key || '—'}</div>
        </div>
        <div class="card soft">
          <div class="metric-label">Comparativo anterior</div>
          <div class="metric-value">${delta === null ? '—' : `<span class="delta ${delta >= 0 ? 'delta--pos' : 'delta--neg'}">${delta >= 0 ? '▲' : '▼'} ${fmtPct(Math.abs(delta))}</span>`}</div>
          <div class="metric-sub">vs ${previous ? escapeHtml(previous.modelo) : 'modelo anterior'} na mesma janela</div>
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

  function renderComparison() {
    const rows = state.launches.map((launch) => {
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
    $('comparison-table').innerHTML = rows;
  }

  function renderCharts(selected) {
    destroyCharts();
    if (!window.Chart) return;

    const chartLaunches = state.launches.filter((l) => !l.isFuture);
    const labels = ['15d', '30d', '90d'];

    createChart('chart-revenue', {
      type: 'bar',
      data: {
        labels: labels.map((l) => l.replace('d', ' dias')),
        datasets: chartLaunches.map((launch, index) => ({
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
        datasets: chartLaunches.map((launch, index) => ({
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
        datasets: chartLaunches.map((launch, index) => ({
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
        labels: chartLaunches.map((l) => l.modelo),
        datasets: [
          {
            label: 'Novos',
            data: chartLaunches.map((l) => {
              const pct = getWindow(l, '30d')?.novos_pct;
              return pct == null ? null : pct * 100;
            }),
            backgroundColor: '#F07800',
            borderRadius: 4
          },
          {
            label: 'Recorrentes',
            data: chartLaunches.map((l) => {
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

    const weekly = selected.semanas?.length ? selected : chartLaunches.find((l) => l.semanas?.length);
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

  function renderColorMix(selected) {
    const rows = selected.cores || [];
    if (!rows.length) {
      $('color-mix').innerHTML = `<div class="empty-state" style="grid-column:1/-1"><div><strong>Sem mix de cores.</strong>Dados entram pelo histórico estático ou pelo pipeline de venda por SKU.</div></div>`;
      return;
    }
    const grouped = rows.reduce((acc, row) => {
      (acc[row.sub_modelo] ||= []).push(row);
      return acc;
    }, {});
    $('color-mix').innerHTML = Object.entries(grouped).map(([sub, items]) => {
      const max = Math.max(...items.map((i) => i.pares || 0));
      return `<div class="color-card">
        <div class="color-title">${escapeHtml(sub)}</div>
        ${items.sort((a,b) => b.pares - a.pares).map((item, idx) => {
          const pct = max ? (item.pares / max) * 100 : 0;
          return `<div class="color-row">
            <div class="color-label" title="${escapeHtml(item.cor)}">${escapeHtml(item.cor)}</div>
            <div class="bar-track"><div class="bar-fill ${idx ? 'secondary' : ''}" style="width:${pct}%"></div></div>
            <div class="color-value">${fmtNum(item.pares)}</div>
          </div>`;
        }).join('')}
      </div>`;
    }).join('');
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

  function renderActions(selected) {
    const mediaRows = (state.data.midia_paga || []).filter((row) => row.modelo_id === selected.modelo_id);
    $('media-table').innerHTML = mediaRows.length ? mediaRows.map((row) => `
      <tr>
        <td>${escapeHtml(row.janela)}</td>
        <td>${escapeHtml(row.canal)}</td>
        <td class="num">${fmtBRL(row.investimento)}</td>
        <td class="num">${fmtBRL(row.receita_atribuida)}</td>
        <td class="num">${fmtNum(row.roas, 2)}×</td>
        <td class="num">${fmtBRL(row.cpa)}</td>
        <td>${roasBadge(row.roas)}</td>
      </tr>`).join('') : `<tr><td colspan="7" class="cell-muted">Sem mídia paga cadastrada para este modelo.</td></tr>`;

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
    const scenarios = projectionScenarios(selected);
    if (!scenarios || selected.isFuture) {
      $('projection-content').innerHTML = `<div class="empty-state"><div><strong>Sem dados suficientes para projeção.</strong>A seção aparece quando o modelo tem ao menos 15 dias de venda registrados.</div></div>`;
      return;
    }

    $('projection-content').innerHTML = `
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
    const selected = state.launches.find((l) => l.modelo_id === state.selectedId) || state.launches[0];
    $('selected-title').textContent = selected.modelo;
    $('selected-status').innerHTML = sourceBadge(selected);
    renderModelSelector();
    renderTopMeta();
    renderMethodology(selected);
    renderState(selected);
    renderComparison();
    renderCharts(selected);
    renderStock(selected);
    renderColorMix(selected);
    renderCalendar(selected);
    renderActions(selected);
    renderProjection(selected);
    renderInsights(selected);
  }

  async function init() {
    configureChartDefaults();
    state.data = await loadData();
    state.launches = buildLaunches(state.data);
    const preferred = state.launches.find((l) => l.modelo_id === 'phantom') || state.launches.find((l) => l.isActive) || state.launches[0];
    state.selectedId = preferred?.modelo_id;
    renderAll();
  }

  document.addEventListener('DOMContentLoaded', init);
})();
