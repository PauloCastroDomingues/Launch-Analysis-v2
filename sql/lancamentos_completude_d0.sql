-- Reise Launch Analysis v2
-- Diagnostico canonico de completude entre o D0 oficial e CURRENT_DATE.
--
-- Este script e somente leitura. Ele nao altera tabelas no BigQuery.
-- A cobertura mede disponibilidade da fonte, nao existencia de venda.
-- Um dia sem item do lancamento so pode ser zero quando source_covered = TRUE.

CREATE TEMP FUNCTION norm_text(value STRING) AS (
  TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
    NORMALIZE_AND_CASEFOLD(IFNULL(value, ''), NFD),
    r'\p{M}', ''
  ), r'[^a-z0-9]+', ' '))
);

CREATE TEMP FUNCTION compact_text(value STRING) AS (
  REGEXP_REPLACE(norm_text(value), r'[^a-z0-9]+', '')
);

CREATE TEMP FUNCTION parse_money(value STRING) AS (
  CASE
    WHEN value IS NULL OR TRIM(value) = '' THEN NULL
    WHEN REGEXP_CONTAINS(TRIM(value), r'^\d{1,3}(\.\d{3})+,\d{2}$')
      THEN SAFE_CAST(REPLACE(REPLACE(TRIM(value), '.', ''), ',', '.') AS NUMERIC)
    WHEN REGEXP_CONTAINS(TRIM(value), r'^\d+,\d{2}$')
      THEN SAFE_CAST(REPLACE(TRIM(value), ',', '.') AS NUMERIC)
    WHEN REGEXP_CONTAINS(TRIM(value), r'^\d+\.\d{1,3}$')
      THEN SAFE_CAST(TRIM(value) AS NUMERIC)
    WHEN REGEXP_CONTAINS(TRIM(value), r'^\d+$')
      THEN SAFE_CAST(TRIM(value) AS NUMERIC) / 100
    ELSE SAFE_CAST(
      REPLACE(REPLACE(REPLACE(
        REGEXP_REPLACE(TRIM(value), r'[^0-9,.-]', ''),
        ',', '|'
      ), '.', ''), '|', '.') AS NUMERIC
    )
  END
);

WITH modelos AS (
  SELECT 'gt' AS modelo_id, 'GT Collection' AS modelo, DATE '2024-10-18' AS d0_oficial, 4 AS prioridade,
    r'(^| )gt( |$)|rs6 gt|knit gt|911 gt' AS nome_regex,
    r'^(rs6gt|knitgt|911gt)' AS sku_regex
  UNION ALL
  SELECT 'avant', 'Avant', DATE '2025-10-02', 5,
    r'(^| )avant( |$)|rs8 avant|rs7 avant|rs6 avant',
    r'^(rs8avant|rs7avant|rs6avant)'
  UNION ALL
  SELECT 'phantom', 'Phantom', DATE '2026-04-16', 3,
    r'(^| )phantom( |$)|phantom slip|phantom easy|phantom knit',
    r'^(phteasy|phtslip|phtknit|phantom)'
  UNION ALL
  SELECT 'rs8_monochrome', 'RS8 Avant Monochrome', DATE '2026-06-25', 1,
    r'monochrome|monocrome',
    r'^(rs8avantmc|rs8avantab|rs8avantct|rs8avantcf|rs8avantmono|rs8mono)'
  UNION ALL
  SELECT 'series_2', 'Series 2', DATE '2026-07-16', 2,
    r'series 2|series2|serie 2|rs8 avant (whisky|off white|azul marinho)|(whisky|off white|azul marinho) rs8 avant',
    r'^(series2|s2)'
),
shoppub_orders AS (
  SELECT
    CONCAT('shoppub|', COALESCE(source_order_id, order_name)) AS order_key,
    DATE(COALESCE(
      paid_at,
      SAFE.PARSE_TIMESTAMP('%Y-%m-%dT%H:%M:%E*S%Ez', JSON_VALUE(row_json, '$.created_at')),
      SAFE.PARSE_TIMESTAMP('%Y-%m-%d %H:%M:%S', JSON_VALUE(row_json, '$.created_at')),
      SAFE.PARSE_TIMESTAMP('%Y-%m-%d', JSON_VALUE(row_json, '$.created_at')),
      SAFE.PARSE_TIMESTAMP('%d/%m/%Y %H:%M:%S', JSON_VALUE(row_json, '$.data_criacao')),
      SAFE.PARSE_TIMESTAMP('%d/%m/%Y', JSON_VALUE(row_json, '$.data_criacao'))
    ), 'America/Sao_Paulo') AS data_venda,
    row_json
  FROM `reise-ssot.stg.shoppub_orders_tbl`
  WHERE is_valid_order_calc = TRUE
),
shoppub_items_raw AS (
  SELECT
    o.order_key,
    o.data_venda,
    item_offset,
    item_json
  FROM shoppub_orders o,
  UNNEST(ARRAY_CONCAT(
    IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'), []),
    IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.pedidoitem_set')), []),
    IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.itens'), []),
    IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.itens')), []),
    IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.items'), []),
    IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.items')), []),
    IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'), []),
    IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.line_items')), []),
    IFNULL(JSON_EXTRACT_ARRAY(o.row_json, '$.produtos'), []),
    IFNULL(JSON_EXTRACT_ARRAY(JSON_VALUE(o.row_json, '$.produtos')), [])
  )) AS item_json WITH OFFSET AS item_offset
),
shoppub_items_parsed AS (
  SELECT
    'shoppub' AS source,
    order_key,
    CONCAT(order_key, '|', CAST(item_offset AS STRING)) AS line_key,
    data_venda,
    COALESCE(
      JSON_VALUE(item_json, '$.sku'), JSON_VALUE(item_json, '$.codigo'),
      JSON_VALUE(item_json, '$.codigo_produto'), JSON_VALUE(item_json, '$.product_sku'),
      JSON_VALUE(item_json, '$.referencia')
    ) AS sku,
    COALESCE(
      JSON_VALUE(item_json, '$.title'), JSON_VALUE(item_json, '$.descricao'),
      JSON_VALUE(item_json, '$.nome'), JSON_VALUE(item_json, '$.produto'),
      JSON_VALUE(item_json, '$.product_title'), JSON_VALUE(item_json, '$.nome_produto'),
      JSON_VALUE(item_json, '$.descricao_produto')
    ) AS item_name,
    SAFE_CAST(ROUND(SAFE_CAST(REPLACE(COALESCE(
      JSON_VALUE(item_json, '$.quantidade'), JSON_VALUE(item_json, '$.qty'),
      JSON_VALUE(item_json, '$.quantity')
    ), ',', '.') AS NUMERIC), 0) AS INT64) AS quantity,
    parse_money(COALESCE(
      JSON_VALUE(item_json, '$.valor_unitario'), JSON_VALUE(item_json, '$.preco_unitario'),
      JSON_VALUE(item_json, '$.unit_price'), JSON_VALUE(item_json, '$.price'),
      JSON_VALUE(item_json, '$.preco'), JSON_VALUE(item_json, '$.valor')
    )) AS unit_price,
    parse_money(COALESCE(
      JSON_VALUE(item_json, '$.valor_total'), JSON_VALUE(item_json, '$.total'),
      JSON_VALUE(item_json, '$.subtotal'), JSON_VALUE(item_json, '$.total_price'),
      JSON_VALUE(item_json, '$.line_total')
    )) AS line_total
  FROM shoppub_items_raw
),
shoppub_items AS (
  SELECT
    source,
    order_key,
    line_key,
    data_venda,
    sku,
    item_name,
    quantity,
    COALESCE(line_total, unit_price * quantity) AS gross_amount,
    CAST(0 AS NUMERIC) AS discount_amount
  FROM shoppub_items_parsed
),
shopify_items_numbered AS (
  SELECT
    i.*,
    ROW_NUMBER() OVER (
      PARTITION BY CAST(i.order_sk AS STRING)
      ORDER BY CAST(i.sku AS STRING), CAST(i.item_name AS STRING), SAFE_CAST(i.quantity AS INT64), SAFE_CAST(i.line_gross_amount AS NUMERIC)
    ) AS line_number
  FROM `reise-ssot.mart_shared.fct_order_item` i
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= (SELECT MIN(d0_oficial) FROM modelos)
),
shopify_items AS (
  SELECT
    'shopify' AS source,
    CONCAT('shopify|', CAST(order_sk AS STRING)) AS order_key,
    CONCAT('shopify|', CAST(order_sk AS STRING), '|', CAST(line_number AS STRING)) AS line_key,
    order_partition_date_brt AS data_venda,
    CAST(sku AS STRING) AS sku,
    CAST(item_name AS STRING) AS item_name,
    SAFE_CAST(quantity AS INT64) AS quantity,
    SAFE_CAST(line_gross_amount AS NUMERIC) AS gross_amount,
    SAFE_CAST(IFNULL(line_discount_amount, 0) AS NUMERIC) AS discount_amount
  FROM shopify_items_numbered
),
all_items AS (
  SELECT * FROM shoppub_items WHERE quantity > 0
  UNION ALL
  SELECT * FROM shopify_items WHERE quantity > 0
),
source_bounds AS (
  SELECT 'shoppub' AS source, MIN(data_venda) AS start_date, MAX(data_venda) AS end_date
  FROM shoppub_orders
  UNION ALL
  SELECT 'shopify', MIN(order_partition_date_brt), MAX(order_partition_date_brt)
  FROM `reise-ssot.mart_shared.fct_order_item`
  WHERE is_valid_order = TRUE
),
item_candidates AS (
  SELECT
    m.modelo_id,
    m.modelo,
    m.d0_oficial,
    m.prioridade,
    i.*
  FROM all_items i
  JOIN modelos m
    ON i.data_venda >= m.d0_oficial
   AND (
     REGEXP_CONTAINS(norm_text(i.item_name), m.nome_regex)
     OR REGEXP_CONTAINS(compact_text(i.sku), m.sku_regex)
   )
),
classified_items AS (
  SELECT * EXCEPT(prioridade)
  FROM item_candidates
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source, line_key
    ORDER BY prioridade, d0_oficial DESC, modelo_id
  ) = 1
),
calendar AS (
  SELECT
    m.modelo_id,
    m.modelo,
    m.d0_oficial,
    data
  FROM modelos m,
  UNNEST(GENERATE_DATE_ARRAY(m.d0_oficial, CURRENT_DATE('America/Sao_Paulo'))) AS data
),
daily_coverage AS (
  SELECT
    c.*,
    EXISTS (
      SELECT 1
      FROM source_bounds s
      WHERE c.data BETWEEN s.start_date AND s.end_date
    ) AS source_covered,
    ARRAY_TO_STRING(ARRAY(
      SELECT s.source
      FROM source_bounds s
      WHERE c.data BETWEEN s.start_date AND s.end_date
      ORDER BY s.source
    ), ',') AS available_sources
  FROM calendar c
),
missing_dates AS (
  SELECT
    *,
    DATE_SUB(data, INTERVAL ROW_NUMBER() OVER (PARTITION BY modelo_id ORDER BY data) DAY) AS gap_group
  FROM daily_coverage
  WHERE NOT source_covered
),
missing_ranges AS (
  SELECT
    modelo_id,
    MIN(data) AS start_date,
    MAX(data) AS end_date,
    COUNT(*) AS days
  FROM missing_dates
  GROUP BY modelo_id, gap_group
),
sales_summary AS (
  SELECT
    modelo_id,
    MIN(data_venda) AS first_sale_date,
    MAX(data_venda) AS last_sale_date,
    COUNT(DISTINCT order_key) AS orders,
    SUM(quantity) AS pairs,
    ROUND(SUM(gross_amount), 2) AS gross_revenue,
    ROUND(SUM(discount_amount), 2) AS discount_amount
  FROM classified_items
  GROUP BY modelo_id
),
coverage_summary AS (
  SELECT
    modelo_id,
    ANY_VALUE(modelo) AS modelo,
    ANY_VALUE(d0_oficial) AS d0_oficial,
    COUNT(*) AS expected_days,
    COUNTIF(source_covered) AS covered_days,
    COUNTIF(NOT source_covered) AS missing_days,
    MIN(IF(source_covered, data, NULL)) AS first_covered_date,
    MAX(IF(source_covered, data, NULL)) AS last_covered_date,
    STRING_AGG(DISTINCT NULLIF(available_sources, ''), ',' ORDER BY NULLIF(available_sources, '')) AS sources
  FROM daily_coverage
  GROUP BY modelo_id
)
SELECT
  c.modelo_id,
  c.modelo,
  c.d0_oficial,
  c.first_covered_date,
  c.last_covered_date,
  c.expected_days,
  c.covered_days,
  c.missing_days,
  ROUND(SAFE_DIVIDE(c.covered_days, c.expected_days), 6) AS coverage_pct,
  CASE
    WHEN c.covered_days = 0 THEN 'sem_cobertura_fonte'
    WHEN c.covered_days < c.expected_days THEN 'gap_historico_fonte'
    WHEN s.first_sale_date IS NULL THEN 'sem_match_produto'
    WHEN s.first_sale_date > c.d0_oficial THEN 'gap_classificacao_d0'
    ELSE 'completo'
  END AS status,
  CASE
    WHEN c.covered_days = c.expected_days THEN 'completa'
    WHEN c.covered_days > 0 THEN 'parcial'
    ELSE 'ausente'
  END AS source_coverage_status,
  CASE
    WHEN s.first_sale_date IS NULL THEN 'sem_match'
    WHEN s.first_sale_date = c.d0_oficial THEN 'd0_confirmado'
    WHEN s.first_sale_date > c.d0_oficial THEN 'primeira_venda_posterior_ao_d0'
    ELSE 'venda_anterior_ao_d0'
  END AS product_match_status,
  DATE_DIFF(s.first_sale_date, c.d0_oficial, DAY) AS first_sale_gap_days,
  c.sources,
  s.first_sale_date,
  s.last_sale_date,
  s.orders,
  s.pairs,
  s.gross_revenue,
  s.discount_amount,
  COALESCE((
    SELECT TO_JSON_STRING(ARRAY_AGG(STRUCT(start_date, end_date, days) ORDER BY start_date))
    FROM missing_ranges g
    WHERE g.modelo_id = c.modelo_id
  ), '[]') AS missing_ranges_json
FROM coverage_summary c
LEFT JOIN sales_summary s USING (modelo_id)
ORDER BY c.d0_oficial;
