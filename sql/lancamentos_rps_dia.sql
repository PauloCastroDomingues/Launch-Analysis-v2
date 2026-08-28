-- Reise Launch Analysis v2
-- Query canonica para gerar data/lancamentos_rps_dia.json.
--
-- RPS = Receita total / sessoes.
-- Receita: reise-ssot.mart_growth_us.bridge_orders_customers
--   Campos usados: paid_date_brt, total_amount, order_name.
-- Sessoes: reise-ssot.mart_growth_us.shopify_sessions_daily
--   Campos usados: data, sessoes, ingest_ts.
--
-- Esta leitura nao usa GA4, tabelas de marketing, campanhas ou atribuicao.
-- Job location: US.

DECLARE fuso_horario STRING DEFAULT 'America/Sao_Paulo';

WITH modelos AS (
  SELECT
    'gt' AS modelo_id,
    'GT Collection' AS modelo,
    'GT Collection' AS linha,
    DATE('2025-12-17') AS d0

  UNION ALL

  SELECT
    'avant' AS modelo_id,
    'Avant' AS modelo,
    'Avant' AS linha,
    DATE('2025-12-14') AS d0

  UNION ALL

  SELECT
    'phantom' AS modelo_id,
    'Phantom' AS modelo,
    'Phantom' AS linha,
    DATE('2026-04-16') AS d0

  UNION ALL

  SELECT
    'rs8_monochrome' AS modelo_id,
    'RS8 Avant Monochrome' AS modelo,
    'RS8 Avant Monochrome' AS linha,
    DATE('2026-06-25') AS d0

  UNION ALL

  SELECT
    'series_2' AS modelo_id,
    'Series 2' AS modelo,
    'Series 2' AS linha,
    DATE('2026-07-16') AS d0
),
datas_modelo AS (
  SELECT
    m.modelo_id,
    m.modelo,
    COALESCE(NULLIF(m.linha, ''), m.modelo, m.modelo_id) AS linha,
    m.d0 AS day_zero_base,
    day AS dias_desde_lancamento,
    DATE_ADD(m.d0, INTERVAL day DAY) AS data_calendario
  FROM modelos m,
  UNNEST(GENERATE_ARRAY(0, DATE_DIFF(CURRENT_DATE(fuso_horario), m.d0, DAY))) AS day
),
pedidos_validos AS (
  SELECT
    CAST(paid_date_brt AS DATE) AS data,
    LOWER(TRIM(CAST(order_name AS STRING))) AS order_name,
    MAX(SAFE_CAST(total_amount AS NUMERIC)) AS total_amount
  FROM `reise-ssot.mart_growth_us.bridge_orders_customers`
  WHERE CAST(paid_date_brt AS DATE) BETWEEN (SELECT MIN(d0) FROM modelos) AND CURRENT_DATE(fuso_horario)
    AND NULLIF(TRIM(CAST(order_name AS STRING)), '') IS NOT NULL
  GROUP BY 1, 2
),
receita_dia AS (
  SELECT
    data,
    ROUND(SUM(total_amount), 2) AS receita_total,
    COUNT(DISTINCT order_name) AS pedidos
  FROM pedidos_validos
  GROUP BY 1
),
sessoes_latest AS (
  SELECT
    CAST(data AS DATE) AS data,
    SAFE_CAST(sessoes AS INT64) AS sessoes,
    ingest_ts
  FROM `reise-ssot.mart_growth_us.shopify_sessions_daily`
  WHERE CAST(data AS DATE) BETWEEN (SELECT MIN(d0) FROM modelos) AND CURRENT_DATE(fuso_horario)
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY CAST(data AS DATE)
    ORDER BY ingest_ts DESC
  ) = 1
),
base AS (
  SELECT
    d.modelo_id,
    d.modelo,
    d.linha,
    d.day_zero_base,
    d.dias_desde_lancamento,
    d.data_calendario,
    COALESCE(r.receita_total, 0) AS receita_total,
    COALESCE(r.pedidos, 0) AS pedidos,
    s.sessoes,
    SAFE_DIVIDE(COALESCE(r.receita_total, 0), NULLIF(s.sessoes, 0)) AS rps,
    CAST(s.ingest_ts AS STRING) AS ingest_ts
  FROM datas_modelo d
  JOIN sessoes_latest s
    ON s.data = d.data_calendario
  LEFT JOIN receita_dia r
    ON r.data = d.data_calendario
)
SELECT
  modelo_id,
  ANY_VALUE(modelo) AS modelo,
  ANY_VALUE(linha) AS linha,
  CAST(ANY_VALUE(day_zero_base) AS STRING) AS day_zero_base,
  MAX(dias_desde_lancamento) AS dias_disponiveis,
  90 AS janela_alvo_dias,
  CAST(MAX(data_calendario) AS STRING) AS dado_ate,
  SUM(receita_total) AS receita_total_periodo,
  SUM(sessoes) AS sessoes_periodo,
  SUM(pedidos) AS pedidos_periodo,
  SAFE_DIVIDE(SUM(receita_total), NULLIF(SUM(sessoes), 0)) AS rps_periodo,
  TO_JSON_STRING(ARRAY_AGG(STRUCT(
    dias_desde_lancamento,
    CAST(data_calendario AS STRING) AS data_calendario,
    receita_total,
    sessoes,
    rps,
    pedidos,
    ingest_ts,
    'reise-ssot.mart_growth_us.bridge_orders_customers' AS fonte_receita,
    'reise-ssot.mart_growth_us.shopify_sessions_daily' AS fonte_sessoes,
    'receita_total / sessoes' AS formula
  ) ORDER BY dias_desde_lancamento)) AS pontos_json
FROM base
WHERE sessoes IS NOT NULL
GROUP BY modelo_id
ORDER BY modelo_id;
