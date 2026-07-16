(() => {
  const refs = {};
  const state = {
    open: false,
    index: 0,
    pages: [],
    charts: [],
    returnFocus: null,
    savedScroll: { x: 0, y: 0 },
    appShellWasInert: false
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
  const normalizeStatus = (value) => String(value || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
  const escapeHtml = (value) => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
  const numberOrNull = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const dateValue = (value) => {
    const date = value ? new Date(`${String(value).slice(0, 10)}T00:00:00`) : null;
    return date && !Number.isNaN(date.getTime()) ? date.getTime() : Number.MAX_SAFE_INTEGER;
  };

  function snapshot() {
    return window.ReiseLaunchDashboard?.getSnapshot?.() || null;
  }

  function formatters() {
    return window.ReiseLaunchDashboard?.formatters || {};
  }

  function fmtBRL(value) {
    const formatter = formatters().fmtBRL;
    if (typeof formatter === 'function') return formatter(value);
    const num = numberOrNull(value);
    return num === null ? '—' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 }).format(num);
  }

  function fmtPct(value, digits = 1) {
    const formatter = formatters().fmtPct;
    if (typeof formatter === 'function') return formatter(value, digits);
    const num = numberOrNull(value);
    return num === null ? '—' : `${new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(num * 100)}%`;
  }

  function fmtDate(value) {
    const formatter = formatters().fmtDateSlash || formatters().fmtDate;
    if (typeof formatter === 'function') return formatter(value);
    if (!value) return '—';
    const [year, month, day] = String(value).slice(0, 10).split('-');
    return year && month && day ? `${day}/${month}/${year}` : '—';
  }

  function fmtNum(value, digits = 0) {
    const formatter = formatters().fmtNum;
    if (typeof formatter === 'function') return formatter(value, digits);
    const num = numberOrNull(value);
    return num === null ? '—' : new Intl.NumberFormat('pt-BR', { maximumFractionDigits: digits }).format(num);
  }

  function badge(type, label, text = '') {
    const badgeFactory = window.ReiseLaunchDashboard?.badge;
    if (typeof badgeFactory === 'function') return badgeFactory(type, label, text);
    const tooltip = text ? ` tabindex="0" data-tooltip="${escapeHtml(text)}"` : '';
    return `<span class="badge badge--${escapeHtml(type)}"${tooltip}>${escapeHtml(label)}</span>`;
  }

  function launchDate(launch) {
    return launch?.day_zero_base || launch?.data_lancamento || launch?.d0 || launch?.data_oficial || null;
  }

  function launchSortDate(launch) {
    return launch?.data_lancamento || launch?.day_zero_base || launch?.d0 || launch?.data_oficial || null;
  }

  function isExportableLaunch(launch) {
    const status = normalizeStatus(launch?.status);
    return ['historico', 'ativo'].includes(status) && dateValue(launchDate(launch)) !== Number.MAX_SAFE_INTEGER;
  }

  function shareModelFor(data, launch) {
    return data?.share_trajetoria?.modelos?.[launch.modelo_id] || null;
  }

  function sharePoints(model) {
    return Array.isArray(model?.pontos) ? model.pontos : [];
  }

  function lastPoint(points) {
    return points.length ? points[points.length - 1] : null;
  }

  function launchRevenue(launch, shareModel) {
    return numberOrNull(shareModel?.receita_lancamento_periodo)
      ?? numberOrNull(launch?.acumulado_atual?.receita)
      ?? numberOrNull(launch?.janelas?.['90d']?.receita)
      ?? numberOrNull(launch?.janelas?.['30d']?.receita);
  }

  function launchWindowBadge(launch, shareModel) {
    const days = numberOrNull(shareModel?.dias_disponiveis)
      ?? numberOrNull(shareModel?.dias_pos_disponiveis)
      ?? numberOrNull(launch?.dPlus);
    const complete = shareModel?.janela_completa === true || (days !== null && days >= 90);
    if (complete) {
      return badge('historico', 'Janela completa', 'Janela de D+90 completa para leitura consolidada.');
    }
    const label = days === null ? 'Janela parcial' : `Parcial · D+${fmtNum(days)}`;
    return badge('parcial', label, 'Leitura ainda em curso; compare com cuidado com lancamentos de janela completa.');
  }

  function companyMoment(shareModel) {
    const variation = numberOrNull(shareModel?.variacao_receita_empresa_pct);
    if (variation === null) {
      return { cls: 'neutral', value: '→ —', sub: 'Sem janela pré-D0 comparável' };
    }
    if (variation > 0) {
      return { cls: 'positive', value: `↑ ${fmtPct(variation, 1)}`, sub: 'Receita da empresa acima do pré-D0' };
    }
    if (variation < 0) {
      return { cls: 'negative', value: `↓ ${fmtPct(Math.abs(variation), 1)}`, sub: 'Receita da empresa abaixo do pré-D0' };
    }
    return { cls: 'neutral', value: '→ 0%', sub: 'Receita da empresa estável vs pré-D0' };
  }

  function buildPages(current) {
    const data = current?.data || {};
    const launches = (current?.launches || [])
      .filter(isExportableLaunch)
      .sort((a, b) => dateValue(launchSortDate(a)) - dateValue(launchSortDate(b)) || (a.order || 0) - (b.order || 0));

    if (!launches.length) return [];

    return [
      { type: 'summary', title: 'Resumo geral', launches, data },
      ...launches.map((launch) => ({
        type: 'launch',
        title: launch.modelo || launch.modelo_id,
        launch,
        shareModel: shareModelFor(data, launch)
      }))
    ];
  }

  function summaryHtml(page) {
    const cards = page.launches.map((launch) => {
      const shareModel = shareModelFor(page.data, launch);
      const revenue = launchRevenue(launch, shareModel);
      const share = numberOrNull(shareModel?.share_acumulado_atual);
      const points = sharePoints(shareModel);
      const dadoAte = shareModel?.dado_ate || lastPoint(points)?.data_calendario || null;
      return `
        <article class="presentation-summary-card">
          <h2>${escapeHtml(launch.modelo || launch.modelo_id)}</h2>
          <div class="presentation-summary-metrics">
            <span>D0 <strong>${fmtDate(shareModel?.data_lancamento || launchDate(launch))}</strong></span>
            <span>Receita <strong>${fmtBRL(revenue)}</strong></span>
            <span>Share acumulado <strong>${fmtPct(share, 1)}</strong></span>
            <span>Dado até <strong>${fmtDate(dadoAte)}</strong></span>
          </div>
        </article>`;
    }).join('');

    const totalRevenue = page.launches.reduce((acc, launch) => {
      const revenue = launchRevenue(launch, shareModelFor(page.data, launch));
      return acc + (revenue || 0);
    }, 0);

    return `
      <section class="presentation-slide presentation-summary">
        <div class="presentation-summary-head">
          <div class="presentation-kicker">Launch Analysis v2</div>
          <h1 class="presentation-summary-title">Resumo dos lançamentos</h1>
          <div class="presentation-summary-copy">
            ${fmtNum(page.launches.length)} modelos exportáveis em leitura lado a lado. Receita somada no período observado: <strong>${fmtBRL(totalRevenue)}</strong>.
          </div>
        </div>
        <div class="presentation-summary-grid">
          ${cards}
        </div>
      </section>`;
  }

  function statHtml(label, value, sub, modifier = '') {
    return `
      <div class="presentation-stat ${modifier ? `presentation-stat--${modifier}` : ''}">
        <div class="presentation-stat-label">${escapeHtml(label)}</div>
        <div class="presentation-stat-value">${escapeHtml(value)}</div>
        <div class="presentation-stat-sub">${escapeHtml(sub || '')}</div>
      </div>`;
  }

  function launchHtml(page) {
    const { launch, shareModel } = page;
    const points = sharePoints(shareModel);
    const d0 = shareModel?.data_lancamento || launchDate(launch);
    const dadoAte = shareModel?.dado_ate || lastPoint(points)?.data_calendario || null;
    const revenue = launchRevenue(launch, shareModel);
    const share = numberOrNull(shareModel?.share_acumulado_atual);
    const ticket = numberOrNull(shareModel?.ticket_medio_empresa_periodo);
    const moment = companyMoment(shareModel);
    const dailyCount = points.filter((point) => numberOrNull(point.share_do_dia) !== null).length;

    return `
      <section class="presentation-slide presentation-launch">
        <div>
          <div class="presentation-kicker">Lançamento em foco</div>
          <h1 class="presentation-title">${escapeHtml(launch.modelo || launch.modelo_id)}</h1>
        </div>
        <div class="presentation-subtitle">
          <span>D0 <strong>${fmtDate(d0)}</strong></span>
          <span>Dado até <strong>${fmtDate(dadoAte)}</strong></span>
          ${launchWindowBadge(launch, shareModel)}
        </div>
        <div class="presentation-stat-grid">
          ${statHtml('Receita do lançamento', fmtBRL(revenue), 'Período observado')}
          ${statHtml('Share acumulado', fmtPct(share, 1), 'Representatividade até o dia', 'accent')}
          ${statHtml('Ticket médio empresa', fmtBRL(ticket), 'Empresa no mesmo período')}
          ${statHtml('Momento da empresa', moment.value, moment.sub, moment.cls)}
        </div>
        <div class="presentation-chart-shell" aria-hidden="true">
          ${dailyCount ? '<canvas data-presentation-chart aria-hidden="true" tabindex="-1"></canvas>' : '<div class="presentation-empty">Share diário indisponível para este lançamento.</div>'}
        </div>
      </section>`;
  }

  function renderIndicators() {
    refs.indicators.innerHTML = state.pages.map((page, index) => {
      const label = page.type === 'summary' ? 'Resumo geral' : page.title;
      const active = index === state.index;
      return `<button class="presentation-indicator${active ? ' is-active' : ''}" type="button" data-page-index="${index}" aria-label="Ir para página ${index + 1} de ${state.pages.length} — ${escapeHtml(label)}"${active ? ' aria-current="page"' : ''}></button>`;
    }).join('');
  }

  function destroyCharts() {
    state.charts.forEach((chart) => chart.destroy());
    state.charts = [];
  }

  function renderMiniChart(page) {
    if (page.type !== 'launch' || !window.Chart) return;
    const canvas = refs.page.querySelector('[data-presentation-chart]');
    if (!canvas) return;
    const points = sharePoints(page.shareModel)
      .map((point) => ({
        label: point.data_calendario || point.dias_desde_lancamento,
        value: numberOrNull(point.share_do_dia)
      }))
      .filter((point) => point.value !== null);
    if (!points.length) return;

    const chart = new Chart(canvas, {
      type: 'line',
      data: {
        labels: points.map((point) => point.label),
        datasets: [{
          data: points.map((point) => point.value),
          borderColor: cssVar('--orange'),
          backgroundColor: cssVar('--orange-dim'),
          borderWidth: 2,
          fill: true,
          pointRadius: 0,
          tension: .35
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        },
        interaction: { intersect: false, mode: 'index' },
        scales: {
          x: { display: false },
          y: { display: false, beginAtZero: true }
        }
      }
    });
    state.charts.push(chart);
  }

  function currentPageLabel() {
    const page = state.pages[state.index];
    return page?.type === 'summary' ? 'Resumo geral' : page?.title || 'Página';
  }

  function renderPage() {
    destroyCharts();
    const page = state.pages[state.index];
    if (!page) return;
    refs.page.classList.add('is-entering');
    refs.page.setAttribute('aria-label', `Página ${state.index + 1} de ${state.pages.length} — ${currentPageLabel()}`);
    refs.page.innerHTML = page.type === 'summary' ? summaryHtml(page) : launchHtml(page);
    renderIndicators();
    renderMiniChart(page);
    requestAnimationFrame(() => {
      refs.page.classList.remove('is-entering');
      refs.page.focus({ preventScroll: true });
    });
  }

  function setPage(index) {
    if (!state.open || index < 0 || index >= state.pages.length || index === state.index) return;
    state.index = index;
    renderPage();
  }

  function requestFullscreen() {
    const target = document.documentElement;
    if (!target.requestFullscreen) return;
    try {
      const result = target.requestFullscreen();
      if (result && typeof result.catch === 'function') result.catch(() => {});
    } catch (_) {
      // Fullscreen can be denied by the browser; the presentation still works as an overlay.
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
    const current = snapshot();
    state.pages = buildPages(current);
    if (!state.pages.length) return;

    state.open = true;
    state.index = 0;
    state.returnFocus = document.activeElement;
    state.savedScroll = { x: window.scrollX, y: window.scrollY };
    state.appShellWasInert = Boolean(refs.appShell?.inert);

    refs.mode.hidden = false;
    refs.mode.setAttribute('aria-hidden', 'false');
    document.body.classList.add('presentation-open');
    if (refs.appShell) refs.appShell.inert = true;

    renderPage();
    requestFullscreen();
  }

  function closePresentation({ skipFullscreen = false } = {}) {
    if (!state.open) return;
    state.open = false;
    destroyCharts();

    refs.mode.hidden = true;
    refs.mode.setAttribute('aria-hidden', 'true');
    refs.page.innerHTML = '';
    refs.indicators.innerHTML = '';
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
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPage(Math.min(state.pages.length - 1, state.index + 1));
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPage(Math.max(0, state.index - 1));
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
    refs.indicators = $('presentation-indicators');
    refs.appShell = document.querySelector('.app-shell');
    if (!refs.toggle || !refs.mode || !refs.close || !refs.page || !refs.indicators) return;

    refs.toggle.addEventListener('click', openPresentation);
    refs.close.addEventListener('click', () => closePresentation());
    refs.indicators.addEventListener('click', (event) => {
      const button = event.target.closest('[data-page-index]');
      if (!button) return;
      setPage(Number(button.dataset.pageIndex));
    });
    document.addEventListener('keydown', onKeydown, true);
    document.addEventListener('fullscreenchange', onFullscreenChange);
  }

  document.addEventListener('DOMContentLoaded', configurePresentation);
})();
