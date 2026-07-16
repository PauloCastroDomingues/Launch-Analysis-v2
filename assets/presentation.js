(() => {
  const refs = {};
  const state = {
    open: false,
    chart: null,
    returnFocus: null,
    savedScroll: { x: 0, y: 0 },
    appShellWasInert: false
  };

  const TOOLTIPS = {
    revenue: 'Soma da receita de cada lançamento dentro da sua própria janela de análise (D0 até D0+90, ou até hoje se ainda não completou). Não é o faturamento total da Reise — é só a soma do que essas linhas específicas venderam.',
    shareAvg: 'Média simples do share de cada lançamento (receita do lançamento dividida pela receita total da Reise no mesmo período). Não é ponderada por receita — um lançamento pequeno pesa igual a um grande nessa média.',
    activeNow: "Quantidade de lançamentos com status 'ativo' no cadastro, sobre o total de lançamentos elegíveis para esta análise.",
    ticketAvg: 'Média do ticket médio da empresa (receita total / pedidos totais) calculado na janela de cada lançamento, não o ticket médio do produto em si.',
    topShare: 'Lançamento com maior percentual de share entre os quatro. Atenção: comparar um lançamento com janela parcial (menos dias de dado) com um de janela completa não é comparação justa — ver o badge de cada um antes de tirar conclusão.',
    quadrant: 'Eixo horizontal: quanto a receita da Reise variou nos mesmos N dias antes e depois do D0 desse lançamento. Eixo vertical: share acumulado do lançamento até hoje. Tamanho da bolha: receita do lançamento no período. Este gráfico mostra posição relativa, não causa — um lançamento à esquerda do zero não necessariamente causou a queda da empresa, só aconteceu num período em que ela caiu.',
    ranking: 'Share acumulado de cada lançamento, do maior para o menor. A barra é proporcional ao maior valor do grupo, não a uma escala fixa de 0 a 100%.',
    companyRevenue: 'Receita total da Reise (todos os produtos, não só este lançamento) nos N dias imediatamente antes do D0 comparada aos N dias imediatamente depois — mesmo número de dias nos dois lados. N é o número de dias que esse lançamento já tem de dado hoje, não fixo em 90. Este número descreve o momento do negócio como um todo, não é atribuído a este lançamento como efeito dele.',
    events: "Sazonalidade: datas de calendário de varejo (Black Friday, Natal, Dia dos Pais etc.) que caem dentro da janela de 90 dias do lançamento. Comercial: promoções, rupturas de estoque ou campanhas específicas daquele produto, cadastradas manualmente. 'Pendente' significa que ainda não há nenhum cadastro para esse lançamento — não significa que nada aconteceu.",
    stock: 'Estoque disponível mais recente por SKU, das linhas em análise. É uma fotografia do momento, não um histórico — reflete o snapshot mais atual da tabela de estoque, não a variação ao longo do tempo.'
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

  function launchRevenue(launch, model) {
    return round(
      numberOrNull(model?.receita_lancamento_periodo)
      ?? numberOrNull(launch?.acumulado_atual?.receita)
      ?? numberOrNull(launch?.janelas?.['90d']?.receita)
      ?? numberOrNull(launch?.janelas?.['30d']?.receita),
      0
    );
  }

  function launchLabel(launch) {
    return launch?.modelo || launch?.linha || launch?.modelo_id || '—';
  }

  function exportableLaunches(current) {
    const data = current?.data || {};
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
        return {
          launch,
          model,
          id: launch.modelo_id,
          label: launchLabel(launch),
          status: normalizeStatus(launch.status),
          revenue: launchRevenue(launch, model),
          share: round(model?.share_acumulado_atual, 4),
          ticket: round(model?.ticket_medio_empresa_periodo, 0),
          variation: round(model?.variacao_receita_empresa_pct, 4),
          companyPre: round(model?.receita_empresa_pre_periodo, 0),
          companyPost: round(model?.receita_empresa_pos_periodo, 0),
          days: round(model?.dias_pos_disponiveis, 0),
          complete: model?.janela_completa === true,
          eventsRegistered: round(model?.eventos_comerciais_cadastrados, 0),
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
    const rows = exportableLaunches(current);
    const activeNow = rows.filter((row) => row.status === 'ativo').length;
    const topShareRow = rows
      .filter((row) => row.share !== null)
      .sort((a, b) => b.share - a.share)[0] || null;

    return {
      data,
      rows,
      stock: stockRows(data, rows),
      kpis: {
        revenue: sumNullable(rows.map((row) => row.revenue)),
        shareAvg: avgNullable(rows.map((row) => row.share), 4),
        activeNow,
        ticketAvg: avgNullable(rows.map((row) => row.ticket), 0),
        topShare: topShareRow
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

  function rankingHtml(rows) {
    const ranked = rows
      .filter((row) => row.share !== null)
      .sort((a, b) => b.share - a.share);
    const max = ranked.length ? Math.max(...ranked.map((row) => row.share || 0)) : 0;
    if (!ranked.length || !max) return '<div class="compact-empty">Sem share acumulado disponível.</div>';
    return `
      <div class="compact-share-ranking">
        ${ranked.map((row) => {
          const width = round((row.share / max) * 100, 1);
          return `
            <div class="compact-share-row">
              <div class="compact-share-label">
                <span>${escapeHtml(row.label)}</span>
                <strong>${fmtPct(row.share, 1)}</strong>
              </div>
              <div class="compact-share-track">
                <span style="width:${width}%"></span>
              </div>
            </div>`;
        }).join('')}
      </div>`;
  }

  function companyRevenueHtml(rows) {
    return `
      <div class="compact-company-list">
        ${rows.map((row) => {
          const hasComparison = row.companyPre !== null && row.companyPost !== null && row.variation !== null;
          const positive = row.variation === null || row.variation >= 0;
          return `
            <div class="compact-company-item">
              <p>${escapeHtml(row.label)}</p>
              ${hasComparison ? `
                <div class="compact-company-values">
                  <span>${fmtBRL(row.companyPre, true)} → ${fmtBRL(row.companyPost, true)}</span>
                  <span class="${positive ? 'is-positive' : 'is-negative'}">${positive ? '↑' : '↓'} ${fmtPct(Math.abs(row.variation), 1)}</span>
                </div>
                <p>${fmtNum(row.days)} dias antes vs. ${fmtNum(row.days)} dias depois do D0</p>
              ` : `
                <div class="compact-company-values compact-company-values--missing">comparativo indisponível</div>
                <p>${row.days === null ? 'Janela pré-D0 insuficiente' : `${fmtNum(row.days)} dias disponíveis no pós-D0`}</p>
              `}
            </div>`;
        }).join('')}
      </div>`;
  }

  function eventsHtml(rows) {
    return `
      <table class="compact-table">
        <thead>
          <tr>
            <th>Lançamento</th>
            <th>Sazonalidade</th>
            <th>Comercial</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map((row) => `
            <tr>
              <td>${escapeHtml(row.label)}</td>
              <td>${escapeHtml(seasonalText(row))}</td>
              <td>${escapeHtml(commercialText(row))}</td>
            </tr>`).join('')}
        </tbody>
      </table>`;
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
    return `
      <section class="compact-overview" aria-label="Visão geral compacta do modo apresentação">
        <div class="compact-row compact-row--kpis">
          ${kpiCard(`Receita total dos ${view.rows.length}`, fmtBRL(view.kpis.revenue), TOOLTIPS.revenue)}
          ${kpiCard('Share médio', fmtPct(view.kpis.shareAvg, 1), TOOLTIPS.shareAvg, 'accent')}
          ${kpiCard('Ativos agora', `${fmtNum(view.kpis.activeNow)} de ${fmtNum(view.rows.length)}`, TOOLTIPS.activeNow)}
          ${kpiCard('Ticket médio', fmtBRL(view.kpis.ticketAvg), TOOLTIPS.ticketAvg)}
          ${kpiCard('Maior share', topShare ? topShare.label : '—', TOOLTIPS.topShare)}
        </div>
        <div class="compact-row compact-row--middle">
          ${panel('Quadrante share × variação da empresa', TOOLTIPS.quadrant, '<div class="compact-chart"><canvas id="presentation-bubble-chart" aria-label="Quadrante de share acumulado por variação da receita da empresa"></canvas></div>', 'compact-panel--quadrant')}
          ${panel('Ranking por share', TOOLTIPS.ranking, rankingHtml(view.rows), 'compact-panel--ranking')}
          ${panel('Receita da empresa, antes → depois do D0', TOOLTIPS.companyRevenue, companyRevenueHtml(view.rows), 'compact-panel--company')}
        </div>
        <div class="compact-row compact-row--bottom">
          ${panel('Eventos no período', TOOLTIPS.events, eventsHtml(view.rows), 'compact-panel--events')}
          ${panel('Estoque atual · top SKUs', TOOLTIPS.stock, stockHtml(view.stock), 'compact-panel--stock')}
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
