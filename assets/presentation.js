(() => {
  const refs = {};
  const state = {
    open: false,
    chart: null,
    returnFocus: null,
    savedScroll: { x: 0, y: 0 },
    appShellWasInert: false
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
    channel: 'Resumo da base diária de aquisição na janela do lançamento em foco. Não rateia venda por campanha manual.',
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
    const key = current?.analysisPeriodKey;
    return WINDOW_KEYS.includes(key) ? key : '30d';
  }

  function periodLabel(current) {
    const key = periodKey(current);
    return current?.analysisPeriodLabel || WINDOW_LABELS[key] || '30 dias';
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

  function exportableLaunches(current) {
    const data = current?.data || {};
    const key = periodKey(current);
    const days = WINDOW_DAYS[key] || 30;
    const exportedIds = new Set((data.manifest?.exported_models || []).map(String));
    const launches = current?.launches || [];
    return launches
      .filter((launch) => (
        exportedIds.size
          ? exportedIds.has(String(launch.modelo_id))
          : ['historico', 'ativo'].includes(normalizeStatus(launch.status)) && Boolean(launchDate(launch))
      ))
      .map((launch) => {
        const model = shareModel(data, launch);
        const win = getWindow(launch, key);
        const fallback = previousWindow(launch, key);
        const revenue = launchWindowRevenue(launch, key);
        const pedidos = round(numberOrNull(win?.pedidos), 0);
        const pares = round(numberOrNull(win?.pares), 0);
        const seasonal = seasonalScore(data, launch, days);
        const acquisition = acquisitionForLaunch(data, launch, days);
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
          share: win ? launchWindowShare(model, key) : null,
          ticket: ratioOrNull(revenue, pedidos),
          variation: round(model?.variacao_receita_empresa_pct, 4),
          companyPre: round(model?.receita_empresa_pre_periodo, 0),
          companyPost: round(model?.receita_empresa_pos_periodo, 0),
          days: round(model?.dias_pos_disponiveis, 0),
          complete: model?.janela_completa === true,
          eventsRegistered: round(model?.eventos_comerciais_cadastrados, 0),
          seasonal,
          acquisition,
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

  function buildViewModel(current) {
    const data = current?.data || {};
    const key = periodKey(current);
    const label = periodLabel(current);
    const rows = exportableLaunches(current);
    const activeNow = rows.filter((row) => row.status === 'ativo').length;
    const focus = rows.find((row) => row.id === current?.primaryModelId) || rows[0] || null;
    const rowsWithWindow = rows.filter((row) => row.revenue !== null);
    const topShareRow = rows
      .filter((row) => row.share !== null)
      .sort((a, b) => b.share - a.share)[0] || null;
    const topRevenueRow = rowsWithWindow
      .sort((a, b) => b.revenue - a.revenue)[0] || null;

    return {
      data,
      periodKey: key,
      periodLabel: label,
      periodDays: WINDOW_DAYS[key] || 30,
      rows,
      focus,
      rowsWithWindow,
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
      return '<div class="compact-empty">Sem base diária de aquisição para a linha em foco nesta janela.</div>';
    }
    const comparable = view.rows.map((row) => row.acquisition).filter(Boolean);
    const avgRoas = avgNullable(comparable.map((row) => row.roas), 2);
    const avgCpa = avgNullable(comparable.map((row) => row.cpa), 0);
    return `
      <div class="compact-channel-grid">
        <div><span>Investimento</span><strong>${fmtBRL(focus.acquisition.investimento, true)}</strong></div>
        <div><span>Receita</span><strong>${fmtBRL(focus.acquisition.receita, true)}</strong></div>
        <div><span>ROAS</span><strong>${focus.acquisition.roas === null ? '—' : `${fmtNum(focus.acquisition.roas, 2)}x`}</strong></div>
        <div><span>CPA</span><strong>${fmtBRL(focus.acquisition.cpa)}</strong></div>
      </div>
      <p class="compact-panel-note">Linha em foco: ${escapeHtml(focus.label)}. Média do grupo: ROAS ${avgRoas === null ? '—' : `${fmtNum(avgRoas, 2)}x`} · CPA ${fmtBRL(avgCpa)}.</p>
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

  function overviewHtml(view) {
    const topShare = view.kpis.topShare;
    const topRevenue = view.kpis.topRevenue;
    const focus = view.focus;
    return `
      <section class="compact-overview compact-overview--executive" aria-label="Visão executiva do modo apresentação">
        <div class="compact-presentation-head">
          <div>
            <span>Modo apresentação</span>
            <h1>Análise comparativa dos lançamentos</h1>
            <p>Janela: ${escapeHtml(view.periodLabel)} · linha em foco: ${escapeHtml(focus?.label || '—')} · cada lançamento contado desde o próprio D0.</p>
          </div>
          <strong>${escapeHtml(view.kpis.windowCoverage)} com dado</strong>
        </div>
        <div class="compact-row compact-row--kpis">
          ${kpiCard('Receita da janela', fmtBRL(view.kpis.revenue), TOOLTIPS.revenue)}
          ${kpiCard('Pedidos', fmtNum(view.kpis.orders), TOOLTIPS.orders)}
          ${kpiCard('Share médio', fmtPct(view.kpis.shareAvg, 1), TOOLTIPS.shareAvg, 'accent')}
          ${kpiCard('Ativos agora', `${fmtNum(view.kpis.activeNow)} de ${fmtNum(view.rows.length)}`, TOOLTIPS.activeNow)}
          ${kpiCard('Maior receita', topRevenue ? topRevenue.label : '—', TOOLTIPS.ranking)}
        </div>
        <div class="compact-row compact-row--middle">
          ${panel('Ranking de faturamento', TOOLTIPS.ranking, metricRankingHtml(view.rows, 'revenue', (value) => fmtBRL(value, true), 'Sem faturamento fechado na janela'), 'compact-panel--ranking')}
          ${panel('Share da janela', TOOLTIPS.topShare, metricRankingHtml(view.rows, 'share', (value) => fmtPct(value, 1), 'Sem share calculado na janela'), 'compact-panel--ranking')}
          ${panel('Atividade por lançamento', TOOLTIPS.orders, activityHtml(view.rows, view.periodLabel), 'compact-panel--activity')}
        </div>
        <div class="compact-row compact-row--bottom">
          ${panel('Momento da empresa', TOOLTIPS.companyRevenue, companyRevenueHtml(view.rows, focus?.id), 'compact-panel--company')}
          ${panel('Canal e investimento', TOOLTIPS.channel, channelHtml(view), 'compact-panel--channel')}
          ${panel('Contexto sazonal', TOOLTIPS.seasonal, seasonalHtml(view.rows), 'compact-panel--events')}
        </div>
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
                return `${raw.label}: share ${fmtPct(raw.y, 1)} · variação ${fmtPct(raw.x, 1)} · receita ${fmtBRL(raw.revenue, true)}`;
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
    renderBubbleChart(view.rows);
    refs.page.focus({ preventScroll: true });
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

  function openPresentation() {
    state.open = true;
    state.returnFocus = document.activeElement;
    state.savedScroll = { x: window.scrollX, y: window.scrollY };
    state.appShellWasInert = Boolean(refs.appShell?.inert);

    refs.mode.hidden = false;
    refs.mode.setAttribute('aria-hidden', 'false');
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
