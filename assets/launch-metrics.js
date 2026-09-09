/* Shared rules for local exports and both dashboard views. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ReiseLaunchMetrics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = '20260909-launch-review-v1';
  const SOURCES = ['lancamentos_modelos', 'lancamentos_produtos_dia', 'lancamentos_rampa_dia', 'lancamentos_clientes_janelas', 'midia_paga', 'crm_disparos', 'manifest'];
  const number = v => v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v);
  const norm = v => String(v || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  function channelType(row = {}) {
    const type = norm(row.tipo_real || row.tipo || row.tipo_canal || row.channel_type);
    const text = type || norm([row.canal_real, row.canal, row.raw_medium, row.raw_source].join(' '));
    if (!text || /unmatched|nao atribuido|sem match|sem origem|sem atribuicao|unattributed|unknown|not set/.test(text)) return 'unmatched';
    if (/(^| )(paid|pago|midia paga|ads|cpc|ppc|pmax)( |$)/.test(text)) return 'paid';
    if (/(^| )(crm|owned|email|e mail|whatsapp|sms|newsletter)( |$)/.test(text)) return 'crm';
    if (/(^| )(organic|organico|seo)( |$)/.test(text)) return 'organic';
    return 'other';
  }
  function channels(rows) {
    const out = Object.fromEntries(['paid','organic','crm','other','unmatched'].map(k => [k, { receita: 0, pedidos: 0, pares: 0, ids: new Set(), fallback: 0 }]));
    for (const row of rows) {
      const b = out[channelType(row)];
      b.receita += number(row.receita_bruta ?? row.receita) || 0;
      b.pares += number(row.pares) || 0;
      if (row.order_sk) b.ids.add(row.order_sk);
      else b.fallback += number(row.pedidos_validos ?? row.pedidos) || 0;
    }
    for (const b of Object.values(out)) { b.pedidos = b.ids.size + b.fallback; delete b.ids; delete b.fallback; }
    return out;
  }
  function signature(payload) {
    const text = JSON.stringify(payload); let hash = 2166136261;
    for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 16777619); }
    return text.length + ':' + (hash >>> 0).toString(16);
  }
  const sourceSignatures = data => Object.fromEntries(SOURCES.map(k => [k, signature(data[k])]));
  function derivedMatches(data) {
    const derived = data.lancamentos_analise_avancada;
    return Boolean(derived && derived.rules_version === VERSION && SOURCES.every(k => derived.source_signatures?.[k] === signature(data[k])));
  }
  function audit(data) {
    const keys = new Map(), byModel = {};
    for (const row of data.lancamentos_produtos_dia || []) {
      if (!row.order_sk || !row.sku) continue;
      const key = [row.modelo_id, row.data, row.order_sk, row.sku].join('|');
      const count = keys.get(key) || 0;
      if (count === 1) byModel[row.modelo_id] = (byModel[row.modelo_id] || 0) + 1;
      keys.set(key, count + 1);
    }
    return { repeated_keys_by_model: byModel, repeated_keys: Object.values(byModel).reduce((a,b) => a+b,0),
      reference_models: (data.lancamentos_modelos || []).filter(m => m.data_oficial && m.day_zero_base !== m.data_oficial).map(m => m.modelo_id) };
  }
  function investmentForWindow(model, key, mediaRows, crmRows) {
    const days = Number(String(key).replace('d',''));
    const start = model.day_zero_base;
    const end = start && Number.isFinite(days) ? new Date(Date.parse(start) + days * 86400000).toISOString().slice(0,10) : null;
    const sameKey = row => norm(row.janela).replace(/ /g,'') === key || norm(row.janela).replace(/ /g,'') === 'd'+days;
    const allMedia = mediaRows.filter(r => r.modelo_id === model.modelo_id);
    const media = allMedia.filter(r => sameKey(r) || (r.data_inicio && r.data_fim && r.data_inicio <= end && r.data_fim >= start));
    // Window totals are never added to overlapping campaigns or prorated into shorter windows.
    const exact = media.filter(r => r.data_inicio === start && r.data_fim === end && !r.data_suspeita && !r.valor_suspeito && r.escopo_investimento_validado === true);
    const channelKeys = exact.map(r => norm(r.canal));
    const usable = exact.length > 0 && exact.length === media.length && channelKeys.every(Boolean) && new Set(channelKeys).size === channelKeys.length;
    const sum = rows => rows.length && rows.every(r => number(r.investimento) !== null) ? rows.reduce((s,r) => s + number(r.investimento),0) : null;
    const crm = crmRows.filter(r => r.modelo_id === model.modelo_id && r.data_disparo >= start && r.data_disparo <= end);
    const paid = usable ? sum(exact) : null;
    const crmSpend = sum(crm);
    return { midia_paga: paid, crm: crmSpend, total: paid !== null && crmSpend !== null ? paid + crmSpend : null,
      outros: null, linhas_midia_paga: media.length, linhas_crm: crm.length,
      investimento_com_data_e_canal: paid, investimento_sem_data_confiavel: null,
      confiabilidade: usable ? 'escopo_validado' : 'pendente_validacao_janela_e_escopo',
      observacao: 'Janela inclusiva D0 a D+'+days+'. Totais acumulados, campanhas sobrepostas e escopo sem valida??o n?o s?o somados. CRM mostra apenas a??es registradas.',
      valores_declarados: media.filter(sameKey).map(r => ({ campanha: r.campanha, investimento: number(r.investimento), data_inicio: r.data_inicio || null, data_fim: r.data_fim || null })) };
  }
  return { VERSION, SOURCES, number, channelType, channels, signature, sourceSignatures, derivedMatches, audit, investmentForWindow };
});
