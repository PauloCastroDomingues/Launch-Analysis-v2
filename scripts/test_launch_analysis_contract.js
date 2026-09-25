const test = require('node:test');
const assert = require('node:assert/strict');
const {
  build,
  daysBetween,
  aggregate,
  currentStability,
  operationalStability,
  eligibleReferences
} = require('./build_launch_analysis_contract');
const { build: buildD0Completeness } = require('./build_launch_d0_completeness');

function week(weekNumber, revenuePerDay, pairsPerDay = 2) {
  const start = (weekNumber - 1) * 7;
  return {
    week: weekNumber,
    start_day: start,
    end_day: start + 6,
    revenue_per_day: revenuePerDay,
    pairs_per_day: pairsPerDay
  };
}

test('D0-D30 is inclusive and has 31 calendar days', () => {
  assert.equal(daysBetween('2026-01-01', '2026-01-31'), 30);
  const contract = build();
  const phase = contract.performance_phases.find((row) => row.phase === 'd0_d30' && row.launch_id === 'phantom');
  assert.equal(phase.days_expected, 31);
  assert.equal(phase.start_day, 0);
  assert.equal(phase.end_day, 30);
});

test('two item rows in one order remain one order', () => {
  const result = aggregate([
    { order_sk: 'one', receita_bruta: 100, receita_liquida: 90, desconto: 10, pares: 1 },
    { order_sk: 'one', receita_bruta: 200, receita_liquida: 180, desconto: 20, pares: 2 }
  ], 1);
  assert.equal(result.pedidos, 1);
  assert.equal(result.receita_bruta, 300);
  assert.equal(result.pares, 3);
});

test('legacy detector uses the full-series peak while operational detector does not', () => {
  const weeks = [1000, 800, 805, 810, 3000, 2900, 2850].map((value, index) => week(index + 1, value));
  const legacy = currentStability(weeks);
  const operational = operationalStability(weeks);
  assert.equal(legacy?.future_peak_leakage, true);
  assert.equal(operational.signal?.future_peak_leakage, false);
  assert.equal(operational.signal?.detected_week, 4);
});

test('operational detector rejects residual near-zero series', () => {
  const weeks = [10, 10, 10, 10, 10].map((value, index) => week(index + 1, value, 0.01));
  assert.equal(operationalStability(weeks).state, 'sem_sinal_ate_o_corte');
});

test('operational detector distinguishes candidate and confirmed signal', () => {
  const candidate = [1000, 950, 980].map((value, index) => week(index + 1, value));
  const confirmed = [1000, 950, 980, 960, 970].map((value, index) => week(index + 1, value));
  assert.equal(operationalStability(candidate).state, 'sinal_candidato');
  assert.equal(operationalStability(confirmed).state, 'sinal_confirmado');
  assert.equal(operationalStability(confirmed).signal.confirmed_week, 5);
});

test('candidate that leaves the band twice is reported as undone', () => {
  const weeks = [1000, 950, 980, 600, 500].map((value, index) => week(index + 1, value));
  assert.equal(operationalStability(weeks).state, 'sinal_desfeito');
});

test('forecast references exclude target, future launches and horizons unknown at origin', () => {
  const target = { launch_id: 'target', analytical_d0: '2026-07-01' };
  const launches = [
    { launch_id: 'target', analytical_d0: '2026-07-01', comparability: 'comparavel', observed_age_days: 90 },
    { launch_id: 'past-known', analytical_d0: '2026-01-01', comparability: 'comparavel', observed_age_days: 180 },
    { launch_id: 'past-too-late', analytical_d0: '2026-06-15', comparability: 'comparavel', observed_age_days: 90 },
    { launch_id: 'future', analytical_d0: '2026-08-01', comparability: 'comparavel', observed_age_days: 90 },
    { launch_id: 'truncated', analytical_d0: '2025-01-01', comparability: 'descritivo_apenas', observed_age_days: 500 }
  ];
  assert.deepEqual(eligibleReferences(target, 7, 90, launches).map((row) => row.launch_id), ['past-known']);
});

test('contract keeps GT and Avant out of comparable forecasting references', () => {
  const contract = build();
  const statuses = Object.fromEntries(contract.launch_registry.map((row) => [row.launch_id, row.comparability]));
  assert.equal(statuses.gt, 'descritivo_apenas');
  assert.equal(statuses.avant, 'descritivo_apenas');
  assert.equal(statuses.phantom, 'comparavel');
  contract.forecasts.runs.forEach((run) => {
    assert.equal(run.reference_launch_ids.includes('gt'), false);
    assert.equal(run.reference_launch_ids.includes('avant'), false);
    assert.equal(run.reference_launch_ids.includes(run.target_launch_id), false);
  });
});

test('contract records source signatures, field lineage and recoverable evidence', () => {
  const contract = build();
  assert.ok(Object.keys(contract.source_signatures).length >= 14);
  assert.ok(Object.values(contract.source_signatures).every((value) => /^sha256:[a-f0-9]{64}$/.test(value)));
  assert.ok(contract.field_matrix.some((row) => row.need === 'D0 analitico' && row.field === 'day_zero_base'));
  assert.ok(contract.evidence_log.some((row) => row.id === 'd0-gt-avant' && row.data_needed));
});

test('open phases remain open instead of receiving a closed label', () => {
  const contract = build();
  const seriesD61D90 = contract.performance_phases.find((row) => row.launch_id === 'series_2' && row.phase === 'd61_d90');
  assert.notEqual(seriesD61D90.status, 'fechada');
  assert.ok(['parcial', 'janela_nao_iniciada'].includes(seriesD61D90.status));
  assert.ok(seriesD61D90.days_missing > 0);
});

test('planned launch without realized sales remains missing instead of zero', () => {
  const contract = build();
  const planned = contract.performance_phases.filter((row) => row.launch_id === 'pais_2026');
  assert.ok(planned.every((row) => row.status === 'sem_realizado_validado'));
  assert.ok(planned.every((row) => row.metrics === null));
});

test('D0 completeness keeps historical gaps separate from covered zero-sales days', () => {
  const result = buildD0Completeness();
  const byId = Object.fromEntries(result.launches.map((row) => [row.modelo_id, row]));

  assert.equal(byId.gt.status, 'gap_historico');
  assert.equal(byId.gt.dias_em_gap, 425);
  assert.deepEqual(byId.gt.intervalos_sem_cobertura, [{ start: '2024-10-18', end: '2025-12-16', days: 425 }]);
  assert.equal(byId.avant.status, 'gap_historico');
  assert.equal(byId.avant.dias_em_gap, 73);
  assert.equal(byId.phantom.status, 'completo');
  assert.equal(byId.rs8_monochrome.status, 'completo');
  assert.equal(byId.series_2.status, 'completo');
  assert.ok(result.launches.every((row) => row.regra_zero.includes('fonte confirmada')));
});

test('analysis contract inventories the D0 completeness artifact', () => {
  const contract = build();
  const source = contract.source_inventory.find((row) => row.file === 'data/lancamentos_completude_d0.json');
  assert.ok(source);
  assert.equal(source.grain, 'lancamento');
  assert.equal(source.rows, 5);
});

test('overview counts unique orders across launches instead of summing model order counts', () => {
  const contract = build();
  const overview = contract.overview_d0_d30;
  assert.ok(overview.pedidos_unicos <= overview.pedidos_modelo_soma);
  assert.equal(overview.pedidos_multimodelo, overview.pedidos_modelo_soma - overview.pedidos_unicos);
  assert.equal(overview.pedidos_unicos, 2071);
  assert.equal(overview.pedidos_multimodelo, 39);
});
