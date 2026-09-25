(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const Rules = globalThis.ReiseLaunchMetrics;
  const money = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });
  const moneyPrecise = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 2 });
  const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 1 });
  const percent = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });
  const date = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' });
  const colors = { gt: '#65a8ff', avant: '#e8ba43', phantom: '#f3f2ef', rs8_monochrome: '#ff5a1f', series_2: '#35cb82' };
  const esc = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#039;');
  const fmtMoney = (value) => Number.isFinite(value) ? money.format(value) : '—';
  const fmtNumber = (value) => Number.isFinite(value) ? number.format(value) : '—';
  const fmtPct = (value) => Number.isFinite(value) ? percent.format(value) : '—';
  const fmtDate = (value) => value ? date.format(new Date(`${value.slice(0, 10)}T12:00:00`)) : '—';
  const fmtSignedNumber = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${number.format(value)}` : '—';
  const fmtSignedPct = (value) => Number.isFinite(value) ? `${value > 0 ? '+' : ''}${percent.format(value)}` : '—';

  const states = {
    sinal_confirmado: ['Confirmado', 'good'], sinal_candidato: ['Candidato', 'warn'], sinal_desfeito: ['Desfeito', 'bad'],
    patamar_interrompido: ['Interrompido', 'bad'], sem_sinal_ate_o_corte: ['Sem sinal', 'info'], historico_curto: ['Historico curto', 'neutral'], fechada: ['Fechada', 'good'],
    parcial: ['Parcial', 'warn'], utilizavel: ['Utilizável', 'good'], requer_validacao: ['Validar', 'warn'], incompleta: ['Incompleta', 'bad'],
    contexto_loja: ['Contexto loja', 'info'], ausente_no_pacote: ['Ausente', 'bad'], exploratory_small_sample: ['Exploratório', 'warn'],
    validado: ['Validado', 'good'], estendida: ['Estendida', 'info'], completo: ['Completo', 'good'],
    gap_historico: ['Gap historico', 'bad'], sem_cobertura: ['Sem cobertura', 'bad']
  };
  const stabilityStateHelp = {
    sinal_confirmado: 'O ritmo ficou regular por tres semanas e permaneceu dentro da faixa esperada nas duas semanas seguintes.',
    sinal_candidato: 'Foi encontrado um ritmo regular por tres semanas, mas ainda faltam duas semanas consistentes para confirmar.',
    sinal_desfeito: 'Um ritmo regular chegou a ser detectado, mas nao permaneceu estavel durante a confirmacao.',
    patamar_interrompido: 'O patamar foi confirmado e depois rompeu a faixa esperada por duas semanas consecutivas.',
    sem_sinal_ate_o_corte: 'Ate a data final dos dados, nenhuma sequencia cumpriu a regra de estabilidade. Isso nao significa ausencia de vendas.',
    historico_curto: 'Ainda nao existem tres semanas completas para procurar um sinal de estabilidade.'
  };
  const badge = (key, explain = false) => {
    const [label, tone] = states[key] || [String(key || '—').replaceAll('_', ' '), 'neutral'];
    const help = explain ? stabilityStateHelp[key] : null;
    const attrs = help ? ` tabindex="0" data-help="${esc(help)}" aria-label="${esc(`${label}. ${help}`)}"` : '';
    return `<span class="badge ${tone}"${attrs}>${esc(label)}</span>`;
  };
  const helpLabel = (label, help) => `<span class="th-help"><span>${esc(label)}</span><button class="help-tip" type="button" data-help="${esc(help)}" aria-label="Ajuda sobre ${esc(label)}: ${esc(help)}">i</button></span>`;
  const phaseFor = (data, launchId, phase) => data.performance_phases.find((item) => item.launch_id === launchId && item.phase === phase);
  const addDays = (iso, days) => {
    const value = new Date(`${iso}T12:00:00Z`);
    value.setUTCDate(value.getUTCDate() + days);
    return value.toISOString().slice(0, 10);
  };

  function observedLaunches(data) {
    const ids = new Set(Object.entries(data.launch_weeks).filter(([, weeks]) => Array.isArray(weeks) && weeks.length > 0).map(([launchId]) => launchId));
    return data.launch_registry.filter((item) => item.commercial_status !== 'planejado' && ids.has(item.launch_id));
  }

  function renderPanorama(data, launches) {
    const phases = launches.map((launch) => phaseFor(data, launch.launch_id, 'd0_d30')).filter((phase) => phase?.metrics);
    const phaseTotals = phases.reduce((sum, phase) => ({
      revenue: sum.revenue + phase.metrics.receita_bruta,
      orders: sum.orders + phase.metrics.pedidos,
      pairs: sum.pairs + phase.metrics.pares
    }), { revenue: 0, orders: 0, pairs: 0 });
    const overview = data.overview_d0_d30 || {};
    const totals = {
      revenue: Number.isFinite(overview.receita_bruta) ? overview.receita_bruta : phaseTotals.revenue,
      orders: Number.isFinite(overview.pedidos_unicos) ? overview.pedidos_unicos : phaseTotals.orders,
      pairs: Number.isFinite(overview.pares) ? overview.pares : phaseTotals.pairs
    };
    $('metric-strip').innerHTML = [
      ['Lançamentos', launches.length, 'histórico observado'],
      ['Receita D0-D30', fmtMoney(totals.revenue), 'soma dos lançamentos'],
      ['Pedidos D0-D30', fmtNumber(totals.orders), 'unicos entre lancamentos'],
      ['Pares D0-D30', fmtNumber(totals.pairs), 'volume vendido']
    ].map(([label, value, note]) => `<div class="metric"><span>${esc(label)}</span><strong>${esc(value)}</strong><small>${esc(note)}</small></div>`).join('');

    $('launch-matrix').innerHTML = `<thead><tr><th>Lançamento</th><th>D0 observado</th><th class="num">Receita bruta</th><th class="num">Após desconto</th><th class="num">Pedidos</th><th class="num">Pares</th><th class="num">Receita/dia</th><th class="num">Pares/dia</th><th class="num">Valor/par</th><th class="num">Desconto</th></tr></thead><tbody>${launches.map((launch) => {
      const phase = phaseFor(data, launch.launch_id, 'd0_d30');
      const metrics = phase?.metrics;
      return `<tr><td><strong>${esc(launch.name)}</strong></td><td class="nowrap">${esc(fmtDate(launch.analytical_d0))}</td><td class="num"><strong>${esc(fmtMoney(metrics?.receita_bruta))}</strong></td><td class="num">${esc(fmtMoney(metrics?.receita_apos_descontos))}</td><td class="num">${esc(fmtNumber(metrics?.pedidos))}</td><td class="num">${esc(fmtNumber(metrics?.pares))}</td><td class="num">${esc(fmtMoney(metrics?.receita_por_dia))}</td><td class="num">${esc(fmtNumber(metrics?.pares_por_dia))}</td><td class="num">${esc(fmtMoney(metrics?.valor_bruto_por_par))}</td><td class="num">${esc(fmtPct(metrics?.desconto_efetivo_pct))}</td></tr>`;
    }).join('')}</tbody>`;
  }

  function renderMilestones(windows, launches) {
    const rows = Array.isArray(windows?.janelas) ? windows.janelas : [];
    const days = [7, 15, 30];
    $('milestone-table').innerHTML = `<thead><tr><th>Lançamento</th>${days.map((day) => `<th>D+${day}</th>`).join('')}</tr></thead><tbody>${launches.map((launch) => `<tr><td><strong>${esc(launch.name)}</strong></td>${days.map((day) => {
      const row = rows.find((item) => item.modelo_id === launch.launch_id && Number(item.window_day) === day);
      if (!row || !Number.isFinite(row.clientes_unicos)) return '<td>—</td>';
      return `<td><strong>${esc(fmtMoney(row.receita))}</strong><small>${esc(fmtNumber(row.pares))} pares · ${esc(fmtNumber(row.clientes_unicos))} clientes · ${badge(row.status)}</small></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  }

  function renderD0Completeness(completeness, launches) {
    const rows = Array.isArray(completeness?.launches) ? completeness.launches : [];
    $('d0-completeness-table').innerHTML = `<thead><tr><th>Lancamento</th><th>D0 oficial</th><th>Coberto desde</th><th>Coberto ate</th><th class="num">Dias cobertos</th><th class="num">Gap</th><th class="num">Cobertura</th><th>Status</th></tr></thead><tbody>${launches.map((launch) => {
      const row = rows.find((item) => item.modelo_id === launch.launch_id);
      return `<tr><td><strong>${esc(launch.name)}</strong></td><td class="nowrap">${esc(fmtDate(row?.data_oficial))}</td><td class="nowrap">${esc(fmtDate(row?.primeiro_dia_coberto))}</td><td class="nowrap">${esc(fmtDate(row?.ultimo_dia_coberto))}</td><td class="num">${esc(fmtNumber(row?.dias_cobertos))}</td><td class="num"><strong>${esc(fmtNumber(row?.dias_em_gap))}</strong></td><td class="num">${esc(fmtPct(row?.cobertura_pct))}</td><td>${badge(row?.status || 'sem_cobertura')}</td></tr>`;
    }).join('')}</tbody>`;
  }

  function chartOptions() {
    return {
      responsive: true, maintainAspectRatio: false, animation: false,
      interaction: { mode: 'nearest', intersect: false },
      plugins: {
        legend: { position: 'bottom', labels: { color: '#989794', usePointStyle: true, boxWidth: 7, padding: 13, font: { size: 9 } } },
        tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${fmtMoney(context.parsed.y)}` } }
      },
      scales: {
        x: { grid: { color: '#242427' }, ticks: { color: '#777673', font: { size: 9 } } },
        y: { beginAtZero: true, grid: { color: '#2a2a2d' }, ticks: { color: '#777673', font: { size: 9 }, callback: (value) => `${Math.round(value / 1000)} mil` } }
      }
    };
  }

  function renderEvolution(data, launches, rampRows) {
    if (typeof Chart === 'undefined') throw new Error('Biblioteca de gráficos indisponível.');
    Chart.defaults.font.family = 'Aalto, Arial, sans-serif';
    const weekCount = 13;
    const labels = Array.from({ length: weekCount }, (_, index) => `S${index + 1}`);
    const series = launches.map((launch) => ({ launch, weeks: (data.launch_weeks[launch.launch_id] || []).filter((week) => week.week <= weekCount) }));
    const ramps = Rules.cumulativeRevenueSeries(launches, rampRows);
    const rampOptions = chartOptions();
    rampOptions.scales.x = {
      type: 'linear', beginAtZero: true,
      grid: { color: '#242427' },
      ticks: { color: '#777673', font: { size: 9 }, callback: (value) => `D+${value}` }
    };
    rampOptions.plugins.tooltip.callbacks.title = (items) => items.length ? `D+${items[0].parsed.x}` : '';

    new Chart($('cumulative-chart'), {
      type: 'line',
      data: { datasets: ramps.map((ramp) => {
        const launch = launches.find((item) => item.launch_id === ramp.launch_id);
        return { label: launch.name, borderColor: colors[ramp.launch_id], backgroundColor: colors[ramp.launch_id], data: ramp.points.map((point) => ({ x: point.day, y: point.value })), borderWidth: 2, pointRadius: 0, pointHitRadius: 8, tension: .12, spanGaps: false };
      }) }, options: rampOptions
    });
    new Chart($('rhythm-chart'), {
      type: 'line',
      data: { labels, datasets: series.map(({ launch, weeks }) => ({ label: launch.name, borderColor: colors[launch.launch_id], backgroundColor: colors[launch.launch_id], data: labels.map((_, index) => weeks.find((item) => item.week === index + 1)?.revenue_per_day ?? null), borderWidth: 2, pointRadius: 1.6, tension: .16, spanGaps: false })) }, options: chartOptions()
    });

    const phaseIds = ['d0_d30', 'd31_d60', 'd61_d90'];
    const phaseNames = { d0_d30: 'D0-D30', d31_d60: 'D31-D60', d61_d90: 'D61-D90' };
    $('phase-table').innerHTML = `<thead><tr><th>Lançamento</th>${phaseIds.map((id) => `<th>${phaseNames[id]}</th>`).join('')}</tr></thead><tbody>${launches.map((launch) => `<tr><td><strong>${esc(launch.name)}</strong></td>${phaseIds.map((id) => {
      const phase = phaseFor(data, launch.launch_id, id);
      if (!phase?.metrics || phase.days_covered === 0) return '<td>—</td>';
      return `<td>${badge(phase.status)}<strong>${esc(fmtMoney(phase.metrics.receita_por_dia))}/dia</strong><small>${esc(fmtNumber(phase.metrics.pares_por_dia))} pares/dia · ${esc(fmtMoney(phase.metrics.valor_bruto_por_par))}/par · ${esc(fmtPct(phase.metrics.desconto_efetivo_pct))} desc.</small></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  }

  function renderMix(submodels, launches) {
    const output = [];
    launches.forEach((launch) => {
      const start = launch.analytical_d0;
      const end = addDays(start, 30);
      const grouped = new Map();
      submodels.filter((row) => row.modelo_id === launch.launch_id && row.data_venda >= start && row.data_venda <= end).forEach((row) => {
        const key = row.sub_modelo_id || 'sem_submodelo';
        const current = grouped.get(key) || { revenue: 0, pairs: 0 };
        current.revenue += Number(row.receita || 0);
        current.pairs += Number(row.pares || 0);
        grouped.set(key, current);
      });
      const total = [...grouped.values()].reduce((sum, item) => sum + item.revenue, 0);
      [...grouped.entries()].sort((a, b) => b[1].revenue - a[1].revenue).slice(0, 3).forEach(([name, values], index) => output.push({ launch: launch.name, name, ...values, share: total ? values.revenue / total : null, rank: index + 1 }));
    });
    $('mix-table').innerHTML = `<thead><tr><th>Lançamento</th><th>Submodelo</th><th class="num">Receita</th><th class="num">Pares</th><th class="num">Mix</th></tr></thead><tbody>${output.map((row) => `<tr><td><strong>${esc(row.launch)}</strong></td><td>${row.rank}. ${esc(row.name)}</td><td class="num">${esc(fmtMoney(row.revenue))}</td><td class="num">${esc(fmtNumber(row.pairs))}</td><td class="num">${esc(fmtPct(row.share))}</td></tr>`).join('')}</tbody>`;
  }

  function renderShare(shareData, launches) {
    $('share-table').innerHTML = `<thead><tr><th>Lançamento</th><th class="num">Receita linha</th><th class="num">Receita loja</th><th class="num">Participação</th><th class="num">Dias</th></tr></thead><tbody>${launches.map((launch) => {
      const points = (shareData?.modelos?.[launch.launch_id]?.pontos || []).filter((point) => Number(point.dias_desde_lancamento) >= 0 && Number(point.dias_desde_lancamento) <= 30);
      const product = points.reduce((sum, point) => sum + Number(point.receita_produto || 0), 0);
      const company = points.reduce((sum, point) => sum + Number(point.receita_empresa || 0), 0);
      return `<tr><td><strong>${esc(launch.name)}</strong></td><td class="num">${esc(fmtMoney(product))}</td><td class="num">${esc(fmtMoney(company))}</td><td class="num"><strong>${esc(fmtPct(company ? product / company : null))}</strong></td><td class="num">${points.length}</td></tr>`;
    }).join('')}</tbody>`;
  }

  function lifecycleBlocks(launch, rampRows) {
    const rows = rampRows.filter((row) => row.modelo_id === launch.launch_id);
    return [
      { id: 'B1', start: 0, end: 27 },
      { id: 'B2', start: 28, end: 55 },
      { id: 'B3', start: 56, end: 83 },
      { id: 'B4', start: 84, end: 111 }
    ].filter((block) => Number(launch.observed_age_days) >= block.end).map((block) => {
      const selected = rows.filter((row) => Number(row.dia_desde_d0) >= block.start && Number(row.dia_desde_d0) <= block.end);
      const pairs = selected.reduce((sum, row) => sum + Number(row.pares || 0), 0);
      const gross = selected.reduce((sum, row) => sum + Number(row.receita_bruta ?? row.receita ?? 0), 0);
      const net = selected.reduce((sum, row) => sum + Number(row.receita_liquida || 0), 0);
      const discount = selected.reduce((sum, row) => sum + Number(row.desconto || 0), 0);
      return { ...block, pairs, gross, net, discount, realizedPrice: pairs ? net / pairs : null, discountPct: gross ? discount / gross : null };
    });
  }

  function renderLifecycle(rampRows, windows, launches) {
    const blockMap = new Map(launches.map((launch) => [launch.launch_id, lifecycleBlocks(launch, rampRows)]));
    new Chart($('lifecycle-chart'), {
      type: 'line',
      data: {
        labels: ['B1', 'B2', 'B3', 'B4'],
        datasets: launches.map((launch) => ({
          label: launch.name,
          borderColor: colors[launch.launch_id], backgroundColor: colors[launch.launch_id],
          data: ['B1', 'B2', 'B3', 'B4'].map((id) => blockMap.get(launch.launch_id).find((block) => block.id === id)?.pairs ?? null),
          borderWidth: 2, pointRadius: 2, tension: .12, spanGaps: false
        }))
      },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { position: 'bottom', labels: { color: '#989794', usePointStyle: true, boxWidth: 7, padding: 13, font: { size: 9 } } },
          tooltip: { callbacks: { label: (context) => `${context.dataset.label}: ${fmtNumber(context.parsed.y)} pares` } }
        },
        scales: {
          x: { grid: { color: '#242427' }, ticks: { color: '#777673', font: { size: 9 } } },
          y: { beginAtZero: true, grid: { color: '#2a2a2d' }, ticks: { color: '#777673', font: { size: 9 }, callback: (value) => fmtNumber(value) } }
        }
      }
    });

    const blockRows = launches.flatMap((launch) => blockMap.get(launch.launch_id).map((block, index, blocks) => {
      const previous = blocks[index - 1];
      const delta = previous ? block.pairs - previous.pairs : null;
      const deltaPct = previous?.pairs ? delta / previous.pairs : null;
      return { launch: launch.name, ...block, delta, deltaPct };
    }));
    $('lifecycle-table').innerHTML = `<thead><tr><th>Lançamento</th><th>Bloco</th><th>Período</th><th class="num">Pares</th><th class="num">Diferença</th><th class="num">Variação</th><th class="num">Receita bruta</th><th class="num">Preço realizado</th><th class="num">Desconto</th></tr></thead><tbody>${blockRows.map((row) => `<tr><td><strong>${esc(row.launch)}</strong></td><td>${row.id}</td><td>D${row.start}-D${row.end}</td><td class="num"><strong>${esc(fmtNumber(row.pairs))}</strong></td><td class="num">${esc(fmtSignedNumber(row.delta))}</td><td class="num">${esc(fmtSignedPct(row.deltaPct))}</td><td class="num">${esc(fmtMoney(row.gross))}</td><td class="num">${esc(fmtMoney(row.realizedPrice))}</td><td class="num">${esc(fmtPct(row.discountPct))}</td></tr>`).join('')}</tbody>`;

    const windowRows = Array.isArray(windows?.janelas) ? windows.janelas : [];
    const milestones = [7, 15, 30, 60, 90];
    $('adoption-table').innerHTML = `<thead><tr><th>Lançamento</th>${milestones.map((day) => `<th>D+${day}</th>`).join('')}</tr></thead><tbody>${launches.map((launch) => `<tr><td><strong>${esc(launch.name)}</strong></td>${milestones.map((day) => {
      const row = windowRows.find((item) => item.modelo_id === launch.launch_id && Number(item.window_day) === day);
      if (!row) return '<td>—</td>';
      return `<td><strong>${esc(fmtNumber(row.clientes_unicos))} compradores</strong><small>${esc(fmtNumber(row.novos_clientes))} novos · ${esc(fmtNumber(row.recorrentes_clientes))} recorrentes</small></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  }

  function renderStability(data, names) {
    const columns = [
      ['Estado', 'Resultado da regra principal, que usa tolerancia de 10% e exige confirmacao nas duas semanas seguintes.'],
      ['Semanas', 'Quantidade de semanas completas entre o D0 analitico e a data de corte.'],
      ['Inicio', 'Primeira semana da sequencia de tres semanas usada para avaliar regularidade.'],
      ['Deteccao', 'Terceira semana da sequencia, quando o sinal passa a ser reconhecido.'],
      ['Confirmacao', 'Semana em que duas semanas adicionais dentro da faixa confirmam o patamar.'],
      ['Patamar R$/dia', 'Mediana da receita diaria nas tres semanas que formaram o sinal.'],
      ['Pares/dia', 'Mediana de pares vendidos por dia nas tres semanas que formaram o sinal.'],
      ['Persistencia', 'Numero de semanas observadas depois da deteccao, incluindo semanas estaveis e posteriores.'],
      ['Quebra', 'Primeira de duas semanas consecutivas fora da faixa esperada do patamar.'],
      ['Legado', 'Resultado do metodo antigo, que usa o pico de toda a serie e pode enxergar o futuro. Serve apenas para comparacao.']
    ];
    $('stability-table').innerHTML = `<thead><tr><th>Lançamento</th>${columns.map(([label, help], index) => `<th${[1, 5, 6, 7].includes(index) ? ' class="num"' : ''}>${helpLabel(label, help)}</th>`).join('')}</tr></thead><tbody>${data.stability_events.map((event) => {
      const signal = event.operational.signal;
      const legacy = event.legacy;
      return `<tr><td><strong>${esc(names[event.launch_id])}</strong></td><td>${badge(event.operational.state, true)}</td><td class="num">${event.complete_weeks}</td><td>${signal ? `S${signal.start_week}` : '—'}</td><td>${signal ? `S${signal.detected_week}` : '—'}</td><td>${signal?.confirmed_week ? `S${signal.confirmed_week}` : '—'}</td><td class="num">${esc(fmtMoney(signal?.level_revenue_per_day))}</td><td class="num">${esc(fmtNumber(signal?.level_pairs_per_day))}</td><td class="num">${signal?.persisted_weeks_observed ?? '—'}</td><td>${signal?.break_week ? `S${signal.break_week}` : '—'}</td><td>${legacy ? `S${legacy.detected_week} · ${esc(fmtMoney(legacy.level_revenue_per_day))}/dia` : '—'}</td></tr>`;
    }).join('')}</tbody>`;
    $('stability-sensitivity-table').innerHTML = `<thead><tr><th>Lançamento</th>${[0.1, 0.15, 0.2].map((value) => `<th>${helpLabel(`Tolerancia ${fmtPct(value)}`, `Limite de oscilacao aceito entre semanas. Quanto maior a tolerancia, mais variacao pode ser chamada de estabilidade.`)}</th>`).join('')}</tr></thead><tbody>${data.stability_events.map((event) => `<tr><td><strong>${esc(names[event.launch_id])}</strong></td>${[0.1, 0.15, 0.2].map((tolerance) => {
      const result = event.sensitivity.find((item) => Number(item.tolerance) === tolerance);
      return `<td>${result ? badge(result.state, true) : '—'}<small>${result?.detected_week ? `detecção S${result.detected_week}` : '—'}${result?.confirmed_week ? ` · confirmação S${result.confirmed_week}` : ''}</small></td>`;
    }).join('')}</tr>`).join('')}</tbody>`;
  }

  function setupHelpPopovers() {
    const popover = document.createElement('div');
    popover.id = 'help-popover';
    popover.className = 'help-popover';
    popover.hidden = true;
    popover.setAttribute('role', 'tooltip');
    document.body.appendChild(popover);
    let active = null;
    let pinned = false;
    const close = () => {
      if (active) active.removeAttribute('aria-describedby');
      active = null;
      pinned = false;
      popover.hidden = true;
    };
    const open = (target) => {
      const help = target?.dataset?.help;
      if (!help) return;
      active = target;
      target.setAttribute('aria-describedby', popover.id);
      popover.textContent = help;
      popover.hidden = false;
      popover.style.left = '0px';
      popover.style.top = '0px';
      const targetRect = target.getBoundingClientRect();
      const popoverRect = popover.getBoundingClientRect();
      const left = Math.max(12, Math.min(window.innerWidth - popoverRect.width - 12, targetRect.left + targetRect.width / 2 - popoverRect.width / 2));
      const below = targetRect.bottom + 8;
      const top = below + popoverRect.height <= window.innerHeight - 12 ? below : Math.max(12, targetRect.top - popoverRect.height - 8);
      popover.style.left = `${left}px`;
      popover.style.top = `${top}px`;
    };
    document.addEventListener('pointerover', (event) => {
      const target = event.target.closest('[data-help]');
      if (target && !pinned) open(target);
    });
    document.addEventListener('pointerout', (event) => {
      const source = event.target.closest('[data-help]');
      const destination = event.relatedTarget?.closest?.('[data-help]');
      if (source && source !== destination && !pinned) close();
    });
    document.addEventListener('focusin', (event) => {
      const target = event.target.closest('[data-help]');
      if (target) open(target);
    });
    document.addEventListener('focusout', (event) => {
      if (event.target.closest('[data-help]') && !pinned) close();
    });
    document.addEventListener('click', (event) => {
      const target = event.target.closest('[data-help]');
      if (!target) return close();
      event.preventDefault();
      if (pinned && active === target && !popover.hidden) return close();
      pinned = true;
      open(target);
    });
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') close();
    });
    window.addEventListener('resize', close);
    window.addEventListener('scroll', close, true);
  }

  const contextLegendHtml = () => `<div class="context-legend" aria-label="Legenda dos gráficos"><span><i class="rps"></i>RPS</span><span><i class="sessions"></i>Sessões</span><span><i class="investment"></i>Investimento</span><span><i class="baseline"></i>Base 100</span></div>`;

  function contextChartConfiguration(series, expanded = false) {
    const makeDataset = (label, color, key, rawKey) => ({
        label,
        borderColor: color,
        backgroundColor: color,
        data: series.points.map((point) => ({ x: point.day, y: point[key] })),
        rawValues: series.points.map((point) => point[rawKey]),
        rawKey,
        borderWidth: expanded ? 2.2 : 1.7,
        pointRadius: 0,
        pointHitRadius: expanded ? 12 : 8,
        tension: .18,
        spanGaps: false
      });
    const lastDay = series.points.at(-1).day;
    return {
      type: 'line',
      data: { datasets: [
        makeDataset('RPS', '#ff5a1f', 'rps_index', 'rps'),
        makeDataset('Sessões', '#65a8ff', 'sessions_index', 'sessions'),
        makeDataset('Investimento', '#e8ba43', 'investment_index', 'investment'),
        { label: 'Base 100', borderColor: '#6f6f75', data: [{ x: 0, y: 100 }, { x: lastDay, y: 100 }], borderWidth: 1, borderDash: [4, 4], pointRadius: 0 }
      ] },
      options: {
        responsive: true, maintainAspectRatio: false, animation: false,
        interaction: { mode: 'nearest', intersect: false },
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: {
            title: (items) => items.length ? `D+${items[0].parsed.x}` : '',
            label: (context) => {
              if (context.dataset.label === 'Base 100') return 'Base D0-D30: 100';
              const raw = context.dataset.rawValues?.[context.dataIndex];
              const actual = context.dataset.rawKey === 'sessions' ? `${fmtNumber(raw)} sessões/dia` : context.dataset.rawKey === 'rps' ? moneyPrecise.format(raw) : `${fmtMoney(raw)}/dia`;
              return `${context.dataset.label}: ${fmtNumber(context.parsed.y)} · ${actual}`;
            }
          } }
        },
        scales: {
          x: { type: 'linear', beginAtZero: true, grid: { color: '#242427' }, ticks: { color: '#777673', maxTicksLimit: expanded ? 10 : 6, font: { size: expanded ? 10 : 8 }, callback: (value) => `D+${value}` } },
          y: { beginAtZero: false, suggestedMin: 60, grid: { color: '#2a2a2d' }, ticks: { color: '#777673', maxTicksLimit: expanded ? 7 : 5, font: { size: expanded ? 10 : 8 } } }
        }
      }
    };
  }

  function openContextChartDialog(launch, series, sourceLabel, trigger) {
    const backdrop = document.createElement('div');
    backdrop.className = 'chart-dialog-backdrop';
    backdrop.innerHTML = `<section class="chart-dialog" role="dialog" aria-modal="true" aria-labelledby="chart-dialog-title" tabindex="-1">
      <header class="chart-dialog-heading">
        <div><h2 id="chart-dialog-title">${esc(launch.name)}</h2><span>${esc(sourceLabel)}</span></div>
        <button class="chart-dialog-close" type="button" aria-label="Fechar gráfico ampliado" title="Fechar">×</button>
      </header>
      ${contextLegendHtml()}
      <div class="chart-dialog-frame"><canvas aria-label="Gráfico ampliado de ${esc(launch.name)}"></canvas></div>
    </section>`;
    document.body.appendChild(backdrop);
    document.body.classList.add('dialog-open');
    const dialog = backdrop.querySelector('.chart-dialog');
    const chart = new Chart(backdrop.querySelector('canvas'), contextChartConfiguration(series, true));
    const close = () => {
      chart.destroy();
      document.removeEventListener('keydown', onKeydown);
      document.body.classList.remove('dialog-open');
      backdrop.remove();
      trigger.focus({ preventScroll: true });
    };
    const onKeydown = (event) => {
      if (event.key === 'Escape') close();
    };
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) close();
    });
    backdrop.querySelector('.chart-dialog-close').addEventListener('click', close);
    document.addEventListener('keydown', onKeydown);
    dialog.focus({ preventScroll: true });
  }

  function renderRpsContext(rpsData, targets, launches) {
    const grid = $('rps-context-grid');
    const sourceLabels = {
      acquisition: 'investimento de aquisição',
      acquisition_with_realized_fallback: 'aquisição + realizado histórico',
      realized: 'investimento realizado',
      missing: 'investimento pendente'
    };
    const prepared = launches.map((launch) => ({
      launch,
      series: Rules.rpsContextSeries(launch, rpsData?.modelos?.[launch.launch_id], targets?.rows || [])
    }));
    grid.innerHTML = `${contextLegendHtml()}${prepared.map(({ launch, series }) => `
      <article class="panel context-chart" role="button" tabindex="0" aria-label="Ampliar gráfico de ${esc(launch.name)}">
        <div class="panel-heading"><h3>${esc(launch.name)}</h3><span>${esc(sourceLabels[series.investment_source])}</span></div>
        <div class="context-chart-frame"><canvas id="rps-context-${esc(launch.launch_id)}"></canvas></div>
      </article>`).join('')}`;

    prepared.forEach(({ launch, series }) => {
      if (!series.points.length) return;
      const canvas = $(`rps-context-${launch.launch_id}`);
      const card = canvas.closest('.context-chart');
      const open = () => openContextChartDialog(launch, series, sourceLabels[series.investment_source], card);
      card.addEventListener('click', open);
      card.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        open();
      });
      new Chart(canvas, contextChartConfiguration(series));
    });
  }

  function renderConditions(data, names, media, crm, stock, launches) {
    $('attribution-list').innerHTML = [...data.quality_report.attribution_coverage].map((item) => `
      <div class="coverage-row"><strong>${esc(names[item.launch_id])}</strong><div class="bar"><i style="width:${Math.max(0, Math.min(100, item.coverage_pct * 100))}%"></i></div><span>${item.orders_with_origin}/${item.orders_total}</span><span>${esc(fmtPct(item.coverage_pct))}</span></div>`).join('');
    const sourceNames = { paid_media: 'Mídia paga', crm: 'CRM', stock: 'Estoque', rps: 'RPS da loja', offers: 'Oferta e preço' };
    $('source-list').innerHTML = Object.entries(data.conditions).map(([key, item]) => `<div class="source-row"><strong>${esc(sourceNames[key] || key)}</strong>${badge(item.status)}</div>`).join('');

    $('media-table').innerHTML = `<thead><tr><th>Lançamento</th><th>Campanha</th><th>Canal</th><th>Janela</th><th>Início</th><th>Fim</th><th class="num">Investimento</th><th>Isolável</th><th>Status</th></tr></thead><tbody>${media.map((row) => `<tr><td><strong>${esc(names[row.modelo_id] || row.modelo_id)}</strong></td><td>${esc(row.campanha)}</td><td>${esc(row.canal)}</td><td>${esc(row.janela)}</td><td class="nowrap">${esc(fmtDate(row.data_inicio))}</td><td class="nowrap">${esc(fmtDate(row.data_fim))}</td><td class="num">${esc(fmtMoney(row.investimento))}</td><td>${row.janela_isolada_confiavel === true ? 'Sim' : row.janela_isolada_confiavel === false ? 'Não' : '—'}</td><td>${badge(row.data_suspeita || row.valor_suspeito ? 'requer_validacao' : row.status)}</td></tr>`).join('')}</tbody>`;

    $('crm-table').innerHTML = `<thead><tr><th>Lançamento</th><th>Data</th><th>Campanha</th><th>Canal</th><th class="num">Investimento</th><th class="num">Receita linha</th><th class="num">Receita dia</th><th>Status</th></tr></thead><tbody>${crm.map((row) => `<tr><td><strong>${esc(names[row.modelo_id] || row.modelo_id)}</strong></td><td class="nowrap">${esc(fmtDate(row.data_disparo))}</td><td>${esc(row.campanha)}</td><td>${esc(row.canal)}</td><td class="num">${esc(fmtMoney(row.investimento))}</td><td class="num">${esc(fmtMoney(row.receita_linha))}</td><td class="num">${esc(fmtMoney(row.receita_dia))}</td><td>${badge(row.status)}</td></tr>`).join('')}</tbody>`;

    $('stock-table').innerHTML = `<thead><tr><th>Lançamento</th><th class="num">Variações</th><th class="num">Estoque atual</th><th class="num">Vendas D30</th><th class="num">Cobertura calculada</th></tr></thead><tbody>${launches.map((launch) => {
      const rows = stock.filter((row) => row.modelo_id === launch.launch_id);
      const units = rows.reduce((sum, row) => sum + Number(row.estoque_atual || 0), 0);
      const sales = rows.reduce((sum, row) => sum + Number(row.vendas_d30 || 0), 0);
      return `<tr><td><strong>${esc(launch.name)}</strong></td><td class="num">${rows.length}</td><td class="num">${esc(fmtNumber(units))}</td><td class="num">${esc(fmtNumber(sales))}</td><td class="num">${sales ? `${esc(fmtNumber((units / sales) * 30))} dias` : '—'}</td></tr>`;
    }).join('')}</tbody>`;
  }

  function renderForecasts(data, names) {
    const open = data.forecasts.runs.filter((item) => item.status === 'forecast_open_horizon');
    $('forecast-open-table').innerHTML = `<thead><tr><th>Lançamento</th><th>Origem</th><th>Horizonte</th><th class="num">Observado</th><th class="num">Ritmo 7 dias</th><th class="num">Multiplicador histórico</th><th class="num">Referências</th></tr></thead><tbody>${open.map((run) => {
      const pace = run.methods.find((item) => item.method === 'recent_7d_pace');
      const historical = run.methods.find((item) => item.method === 'eligible_historical_multiplier_median');
      return `<tr><td><strong>${esc(names[run.target_launch_id])}</strong></td><td>D${run.origin_day}</td><td>D${run.horizon_day}</td><td class="num">${esc(fmtMoney(run.observed_at_origin))}</td><td class="num"><strong>${esc(fmtMoney(pace?.predicted))}</strong></td><td class="num"><strong>${esc(fmtMoney(historical?.predicted))}</strong></td><td class="num">${run.references_count}</td></tr>`;
    }).join('')}</tbody>`;
    $('forecast-method-table').innerHTML = `<thead><tr><th>Método</th><th class="num">WAPE</th><th class="num">MAE</th><th class="num">Viés</th><th class="num">Previsões</th><th class="num">Lançamentos</th></tr></thead><tbody>${data.forecasts.backtest_summary.map((item) => `<tr><td><strong>${esc(item.method === 'recent_7d_pace' ? 'Ritmo 7 dias' : 'Multiplicador histórico')}</strong></td><td class="num">${esc(fmtPct(item.wape))}</td><td class="num">${esc(fmtMoney(item.mae))}</td><td class="num">${esc(fmtMoney(item.bias))}</td><td class="num">${item.predictions}</td><td class="num">${item.distinct_launches}</td></tr>`).join('')}</tbody>`;
    const backtests = data.forecasts.runs.filter((run) => run.status === 'backtest_revised_current_base').flatMap((run) => run.methods.filter((method) => Number.isFinite(method.predicted)).map((method) => ({ run, method })));
    $('forecast-backtest-table').innerHTML = `<thead><tr><th>Lançamento</th><th>Origem</th><th>Horizonte</th><th>Método</th><th class="num">Observado na origem</th><th class="num">Previsto</th><th class="num">Realizado</th><th class="num">Erro absoluto</th><th class="num">APE</th><th class="num">Referências</th></tr></thead><tbody>${backtests.map(({ run, method }) => `<tr><td><strong>${esc(names[run.target_launch_id])}</strong></td><td>D${run.origin_day}</td><td>D${run.horizon_day}</td><td>${esc(method.method === 'recent_7d_pace' ? 'Ritmo 7 dias' : 'Multiplicador histórico')}</td><td class="num">${esc(fmtMoney(run.observed_at_origin))}</td><td class="num">${esc(fmtMoney(method.predicted))}</td><td class="num">${esc(fmtMoney(method.actual))}</td><td class="num">${esc(fmtMoney(method.absolute_error))}</td><td class="num">${esc(fmtPct(method.ape))}</td><td class="num">${run.references_count}</td></tr>`).join('')}</tbody>`;
  }

  async function fetchJson(url) {
    const response = await fetch(`${url}?v=20260925-chart-dialog-v19`, { cache: 'no-store' });
    if (!response.ok) throw new Error(`${url} indisponível (${response.status}).`);
    return response.json();
  }

  async function init() {
    try {
      setupHelpPopovers();
      const [data, windows, submodels, shareData, media, crm, stock, rampRows, completeness, manifest, rpsData, targets] = await Promise.all([
        fetchJson('data/launch_analysis_contract.json'),
        fetchJson('data/lancamentos_clientes_janelas.json'),
        fetchJson('data/sub_modelos_dia.json'),
        fetchJson('data/share_trajetoria.json'),
        fetchJson('data/midia_paga.json'),
        fetchJson('data/crm_disparos.json'),
        fetchJson('data/estoque.json'),
        fetchJson('data/lancamentos_rampa_dia.json'),
        fetchJson('data/lancamentos_completude_d0.json'),
        fetchJson('data/manifest.json'),
        fetchJson('data/lancamentos_rps_dia.json'),
        fetchJson('data/metas_mensais.json')
      ]);
      const launches = observedLaunches(data);
      const names = Object.fromEntries(data.launch_registry.map((item) => [item.launch_id, item.name]));
      const liveCutoff = String(manifest.generated_at || data.snapshot || '').slice(0, 10);
      const stabilityEvents = Rules.stabilityEvents(launches, rampRows, liveCutoff);
      $('header-snapshot').textContent = `Dados até ${fmtDate(liveCutoff)}`;
      $('footer-contract').textContent = data.version;
      renderPanorama(data, launches);
      renderD0Completeness(completeness, launches);
      renderMilestones(windows, launches);
      renderEvolution(data, launches, rampRows);
      renderMix(submodels, launches);
      renderShare(shareData, launches);
      renderLifecycle(rampRows, windows, launches);
      renderStability({ stability_events: stabilityEvents }, names);
      renderRpsContext(rpsData, targets, launches);
      renderConditions(data, names, media, crm, stock, launches);
      renderForecasts(data, names);
    } catch (error) {
      $('load-error').hidden = false;
      $('load-error').textContent = `Falha ao carregar a análise: ${error.message}`;
      console.error(error);
    }
  }

  init();
})();
