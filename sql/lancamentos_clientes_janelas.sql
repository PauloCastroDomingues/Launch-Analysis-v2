-- Reise Launch Analysis v2
-- Export agregado para clientes, base ativada e rampa estendida.
--
-- Uso:
-- 1) Rodar em southamerica-east1.
-- 2) No Apps Script/exportador, trocar a CTE modelos pelo cadastro de
--    data/lancamentos_modelos.json ou mart_shared.linha_cadastro.
-- 3) Exportar o resultado como data/lancamentos_clientes_janelas.json.
--
-- Privacidade:
-- - customer_key e chaves de pedido existem somente dentro da query.
-- - O JSON publico deve receber apenas agregados por modelo/janela.
--
-- Sem Heat Map neste arquivo.

WITH modelos AS (
  SELECT
    modelo_id,
    ANY_VALUE(linha) AS linha,
    MIN(day_zero_base) AS d0
  FROM `reise-ssot.mart_shared.linha_cadastro`
  WHERE day_zero_base IS NOT NULL
  GROUP BY modelo_id
),
orders_valid AS (
  SELECT
    CAST(order_sk AS STRING) AS order_sk,
    DATE(COALESCE(paid_at, created_at), 'America/Sao_Paulo') AS data_pedido,
    CASE
      WHEN NULLIF(TRIM(CAST(customer_sk AS STRING)), '') IS NOT NULL
        THEN CONCAT('customer_sk:', TRIM(CAST(customer_sk AS STRING)))
      WHEN REGEXP_CONTAINS(NULLIF(LOWER(TRIM(CAST(customer_email AS STRING))), ''), r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
        THEN CONCAT('email:', LOWER(TRIM(CAST(customer_email AS STRING))))
      WHEN LENGTH(NULLIF(REGEXP_REPLACE(COALESCE(
        CAST(customer_phone_digits AS STRING),
        CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone') AS STRING),
        ''
      ), r'\D', ''), '')) BETWEEN 8 AND 15
        THEN CONCAT('phone:', NULLIF(REGEXP_REPLACE(COALESCE(
          CAST(customer_phone_digits AS STRING),
          CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.customer_phone') AS STRING),
          ''
        ), r'\D', ''), ''))
      ELSE NULL
    END AS customer_key,
    SAFE_CAST(total_amount AS NUMERIC) AS order_amount
  FROM `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
  WHERE DATE(COALESCE(paid_at, created_at), 'America/Sao_Paulo') IS NOT NULL
),
customer_first_purchase AS (
  SELECT
    customer_key,
    MIN(data_pedido) AS primeira_compra
  FROM orders_valid
  WHERE customer_key IS NOT NULL
  GROUP BY customer_key
),
base_by_model AS (
  SELECT
    m.modelo_id,
    COUNT(DISTINCT IF(o.data_pedido < m.d0, o.customer_key, NULL)) AS base_total_d0,
    COUNT(DISTINCT o.customer_key) AS base_total_ate_snapshot
  FROM modelos m
  LEFT JOIN orders_valid o
    ON o.customer_key IS NOT NULL
   AND o.data_pedido <= CURRENT_DATE('America/Sao_Paulo')
  GROUP BY m.modelo_id
),
launch_items AS (
  SELECT
    m.modelo_id,
    m.linha,
    m.d0,
    DATE_DIFF(i.order_partition_date_brt, m.d0, DAY) AS dia_desde_d0,
    i.order_partition_date_brt AS data,
    CAST(i.order_sk AS STRING) AS order_sk,
    ov.customer_key,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita
  FROM modelos m
  JOIN `reise-ssot.mart_shared.fct_order_item` i
    ON i.is_valid_order = TRUE
   AND i.order_partition_date_brt >= m.d0
   -- Sem teto D+90: a rampa estendida usa todo dia disponivel no SSOT.
  JOIN `reise-ssot.mart_shared.produto_lancamento_v` pl
    ON UPPER(TRIM(pl.sku)) = UPPER(TRIM(i.sku))
   AND pl.modelo_id = m.modelo_id
  LEFT JOIN orders_valid ov
    ON ov.order_sk = CAST(i.order_sk AS STRING)
  WHERE SAFE_CAST(i.quantity AS INT64) > 0
),
launch_orders AS (
  SELECT
    modelo_id,
    linha,
    d0,
    data,
    dia_desde_d0,
    order_sk,
    customer_key,
    SUM(pares) AS pares,
    SUM(receita) AS receita
  FROM launch_items
  GROUP BY 1, 2, 3, 4, 5, 6, 7
),
max_day AS (
  SELECT
    modelo_id,
    MAX(dia_desde_d0) AS ultimo_dia_disponivel
  FROM launch_orders
  GROUP BY modelo_id
),
window_defs AS (
  SELECT '7d' AS janela, 7 AS end_day UNION ALL
  SELECT '15d', 15 UNION ALL
  SELECT '30d', 30 UNION ALL
  SELECT '60d', 60 UNION ALL
  SELECT '90d', 90
),
model_windows AS (
  SELECT
    m.modelo_id,
    w.janela,
    w.end_day,
    FALSE AS is_extended
  FROM modelos m
  CROSS JOIN window_defs w

  UNION ALL

  SELECT
    m.modelo_id,
    'extended' AS janela,
    md.ultimo_dia_disponivel AS end_day,
    TRUE AS is_extended
  FROM modelos m
  JOIN max_day md USING (modelo_id)
),
windowed AS (
  SELECT
    mw.modelo_id,
    mw.janela,
    mw.end_day,
    mw.is_extended,
    lo.d0,
    lo.order_sk,
    lo.customer_key,
    lo.data,
    lo.dia_desde_d0,
    lo.pares,
    lo.receita,
    fp.primeira_compra
  FROM model_windows mw
  JOIN launch_orders lo
    ON lo.modelo_id = mw.modelo_id
   AND lo.dia_desde_d0 BETWEEN 0 AND mw.end_day
  LEFT JOIN customer_first_purchase fp
    ON fp.customer_key = lo.customer_key
),
daily_extended AS (
  SELECT
    modelo_id,
    data,
    dia_desde_d0,
    SUM(receita) AS receita,
    COUNT(DISTINCT order_sk) AS pedidos,
    SUM(pares) AS pares
  FROM launch_orders
  GROUP BY 1, 2, 3
),
daily_ranked AS (
  SELECT
    *,
    ROW_NUMBER() OVER (PARTITION BY modelo_id ORDER BY receita DESC, dia_desde_d0) AS rn_receita,
    ROW_NUMBER() OVER (PARTITION BY modelo_id ORDER BY pedidos DESC, dia_desde_d0) AS rn_pedidos,
    ROW_NUMBER() OVER (PARTITION BY modelo_id ORDER BY pares DESC, dia_desde_d0) AS rn_pares
  FROM daily_extended
),
life_totals AS (
  SELECT
    modelo_id,
    SUM(receita) AS receita_total_extendida
  FROM daily_extended
  GROUP BY modelo_id
),
life_cumulative AS (
  SELECT
    d.*,
    SUM(d.receita) OVER (
      PARTITION BY d.modelo_id
      ORDER BY d.dia_desde_d0
      ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
    ) AS receita_acumulada,
    t.receita_total_extendida
  FROM daily_extended d
  JOIN life_totals t USING (modelo_id)
),
life_milestones AS (
  SELECT
    modelo_id,
    MIN(IF(receita_acumulada >= receita_total_extendida * 0.50, dia_desde_d0, NULL)) AS dias_ate_50pct_receita,
    MIN(IF(receita_acumulada >= receita_total_extendida * 0.80, dia_desde_d0, NULL)) AS dias_ate_80pct_receita,
    MIN(IF(receita_acumulada >= receita_total_extendida * 0.90, dia_desde_d0, NULL)) AS dias_ate_90pct_receita
  FROM life_cumulative
  GROUP BY modelo_id
),
life_peaks AS (
  SELECT
    modelo_id,
    ARRAY_AGG(IF(rn_receita = 1, STRUCT(dia_desde_d0 AS day, data, receita, pedidos, pares), NULL) IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS pico_receita,
    ARRAY_AGG(IF(rn_pedidos = 1, STRUCT(dia_desde_d0 AS day, data, receita, pedidos, pares), NULL) IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS pico_pedidos,
    ARRAY_AGG(IF(rn_pares = 1, STRUCT(dia_desde_d0 AS day, data, receita, pedidos, pares), NULL) IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS pico_pares
  FROM daily_ranked
  GROUP BY modelo_id
)
SELECT
  w.modelo_id,
  w.janela,
  ANY_VALUE(w.d0) AS day_zero_base,
  ANY_VALUE(w.end_day) AS end_day,
  ANY_VALUE(w.is_extended) AS is_extended,
  COUNT(DISTINCT w.order_sk) AS pedidos,
  SUM(w.pares) AS pares,
  ROUND(SUM(w.receita), 2) AS receita,
  COUNT(DISTINCT w.customer_key) AS clientes_unicos,
  COUNT(DISTINCT IF(w.primeira_compra >= w.d0, w.customer_key, NULL)) AS novos_clientes,
  COUNT(DISTINCT IF(w.primeira_compra < w.d0, w.customer_key, NULL)) AS recorrentes_clientes,
  ROUND(SAFE_DIVIDE(SUM(w.receita), COUNT(DISTINCT w.customer_key)), 2) AS receita_por_cliente,
  ROUND(SAFE_DIVIDE(COUNT(DISTINCT w.order_sk), COUNT(DISTINCT w.customer_key)), 4) AS pedidos_por_cliente,
  ROUND(SAFE_DIVIDE(SUM(w.pares), COUNT(DISTINCT w.customer_key)), 4) AS pares_por_cliente,
  ROUND(SAFE_DIVIDE(COUNT(DISTINCT IF(w.primeira_compra < w.d0, w.customer_key, NULL)), NULLIF(ANY_VALUE(b.base_total_d0), 0)), 6) AS pct_base_ativada,
  COUNT(DISTINCT IF(w.primeira_compra < w.d0, w.customer_key, NULL)) AS clientes_base_compraram,
  ANY_VALUE(b.base_total_d0) AS base_total_d0,
  ANY_VALUE(b.base_total_ate_snapshot) AS base_total_ate_snapshot,
  ANY_VALUE(p.pico_receita) AS pico_receita,
  ANY_VALUE(p.pico_pedidos) AS pico_pedidos,
  ANY_VALUE(p.pico_pares) AS pico_pares,
  ANY_VALUE(ms.dias_ate_50pct_receita) AS dias_ate_50pct_receita,
  ANY_VALUE(ms.dias_ate_80pct_receita) AS dias_ate_80pct_receita,
  ANY_VALUE(ms.dias_ate_90pct_receita) AS dias_ate_90pct_receita,
  'fct_order_item + orders_all_valid_no_migracao + produto_lancamento_v' AS fonte,
  'export_agregado_sem_pii' AS privacidade
FROM windowed w
LEFT JOIN base_by_model b USING (modelo_id)
LEFT JOIN life_peaks p USING (modelo_id)
LEFT JOIN life_milestones ms USING (modelo_id)
GROUP BY w.modelo_id, w.janela
ORDER BY w.modelo_id, CASE w.janela
  WHEN '7d' THEN 1
  WHEN '15d' THEN 2
  WHEN '30d' THEN 3
  WHEN '60d' THEN 4
  WHEN '90d' THEN 5
  ELSE 6
END;
