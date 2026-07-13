-- Auditoria canonica de lancamentos no SSOT.
-- Rode em southamerica-east1.
-- Nao cria views/tabelas. Retorna um payload JSON com resumo por janela,
-- acumulado diario, quebra por SKU, duplicidades e alertas de classificacao.

DECLARE modelo_filtro STRING DEFAULT NULL; -- use 'phantom', 'rs8_monochrome', 'avant', 'gt' ou NULL para todos

WITH catalogo AS (
  SELECT 'rs8_monochrome' AS modelo_id, 'RS8 Avant Monochrome' AS modelo, DATE '2026-06-25' AS d0, 1 AS prioridade
  UNION ALL SELECT 'phantom', 'Phantom', DATE '2026-04-16', 2
  UNION ALL SELECT 'gt', 'GT Collection', DATE '2025-12-17', 3
  UNION ALL SELECT 'avant', 'Avant', DATE '2025-12-14', 4
),
janelas AS (
  SELECT 7 AS janela_dias UNION ALL
  SELECT 15 UNION ALL
  SELECT 30 UNION ALL
  SELECT 60 UNION ALL
  SELECT 90
),
itens_validos AS (
  SELECT
    i.order_partition_date_brt AS data_venda,
    CAST(i.order_sk AS STRING) AS order_sk,
    COALESCE(
      NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), ''),
      TO_JSON_STRING(STRUCT(
        CAST(i.order_sk AS STRING) AS order_sk,
        CAST(i.sku AS STRING) AS sku,
        CAST(i.item_name AS STRING) AS item_name,
        SAFE_CAST(i.quantity AS INT64) AS quantity,
        SAFE_CAST(i.line_gross_amount AS NUMERIC) AS line_gross_amount,
        SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS line_discount_amount
      ))
    ) AS line_item_key,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS quantity,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm
  FROM `reise-ssot.mart_shared.fct_order_item` i
  WHERE i.is_valid_order = TRUE
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
candidatos AS (
  SELECT
    c.modelo_id,
    c.modelo,
    c.d0,
    c.prioridade,
    DATE_DIFF(i.data_venda, c.d0, DAY) AS dia_desde_d0,
    i.*,
    CASE
      WHEN c.modelo_id = 'rs8_monochrome' THEN 'monochrome'
      WHEN c.modelo_id = 'phantom' THEN 'phantom'
      WHEN c.modelo_id = 'gt' THEN 'gt'
      WHEN c.modelo_id = 'avant' THEN 'avant'
    END AS regra_match
  FROM itens_validos i
  JOIN catalogo c
    ON i.data_venda BETWEEN c.d0 AND DATE_ADD(c.d0, INTERVAL 90 DAY)
   AND (modelo_filtro IS NULL OR c.modelo_id = modelo_filtro)
   AND (
    (
      c.modelo_id = 'rs8_monochrome'
      AND (
        STARTS_WITH(i.sku_compact, 'RS8AVANTMC')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTAB')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCT')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCF')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTMONO')
        OR STARTS_WITH(i.sku_compact, 'RS8MONO')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs8 avant monochrome|monochrome|monocrome)( |$)')
      )
    )
    OR (
      c.modelo_id = 'phantom'
      AND (
        STARTS_WITH(i.sku_compact, 'PHTEASY')
        OR STARTS_WITH(i.sku_compact, 'PHTSLIP')
        OR STARTS_WITH(i.sku_compact, 'PHTKNIT')
        OR STARTS_WITH(i.sku_compact, 'PHANTOMEASY')
        OR STARTS_WITH(i.sku_compact, 'PHANTOMSLIP')
        OR STARTS_WITH(i.sku_compact, 'PHANTOMKNIT')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )phantom( |$)')
      )
    )
    OR (
      c.modelo_id = 'gt'
      AND (
        STARTS_WITH(i.sku_compact, 'RS6GT')
        OR STARTS_WITH(i.sku_compact, '911GT')
        OR STARTS_WITH(i.sku_compact, 'KNITGT')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 gt|911 gt|knit gt|gt collection)( |$)')
      )
    )
    OR (
      c.modelo_id = 'avant'
      AND (
        STARTS_WITH(i.sku_compact, 'RS6AVANT')
        OR STARTS_WITH(i.sku_compact, 'RS7AVANT')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANT')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 avant|rs7 avant|rs8 avant)( |$)')
      )
      AND NOT (
        STARTS_WITH(i.sku_compact, 'RS8AVANTMC')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTAB')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCT')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTCF')
        OR STARTS_WITH(i.sku_compact, 'RS8AVANTMONO')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
   )
),
classificados AS (
  SELECT *
  FROM candidatos
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY order_sk, line_item_key
    ORDER BY prioridade, d0 DESC, modelo_id
  ) = 1
),
pedido_modelo AS (
  SELECT
    modelo_id,
    modelo,
    d0,
    order_sk,
    MIN(data_venda) AS data_pedido,
    SUM(quantity) AS pares,
    SUM(receita_bruta) AS receita_bruta,
    SUM(desconto) AS desconto,
    SUM(receita_liquida) AS receita_liquida
  FROM classificados
  GROUP BY modelo_id, modelo, d0, order_sk
),
resumo_janelas AS (
  SELECT
    p.modelo_id,
    p.modelo,
    j.janela_dias,
    p.d0,
    DATE_ADD(p.d0, INTERVAL j.janela_dias DAY) AS data_fim_janela,
    COUNT(DISTINCT p.order_sk) AS pedidos_validos,
    SUM(p.pares) AS pares,
    ROUND(SUM(p.receita_bruta), 2) AS receita_bruta,
    ROUND(SUM(p.desconto), 2) AS desconto,
    ROUND(SUM(p.receita_liquida), 2) AS receita_liquida,
    ROUND(SAFE_DIVIDE(SUM(p.receita_bruta), COUNT(DISTINCT p.order_sk)), 2) AS ticket_bruto,
    ROUND(SAFE_DIVIDE(SUM(p.receita_liquida), COUNT(DISTINCT p.order_sk)), 2) AS ticket_liquido,
    ROUND(SAFE_DIVIDE(SUM(p.receita_bruta), SUM(p.pares)), 2) AS preco_bruto_por_par,
    ROUND(SAFE_DIVIDE(SUM(p.receita_liquida), SUM(p.pares)), 2) AS preco_liquido_por_par,
    MIN(p.data_pedido) AS primeira_venda_na_janela,
    MAX(p.data_pedido) AS ultima_venda_na_janela,
    IF(CURRENT_DATE('America/Sao_Paulo') < DATE_ADD(p.d0, INTERVAL j.janela_dias DAY), 'parcial', 'fechada') AS status_janela
  FROM pedido_modelo p
  CROSS JOIN janelas j
  WHERE p.data_pedido BETWEEN p.d0 AND DATE_ADD(p.d0, INTERVAL j.janela_dias DAY)
  GROUP BY p.modelo_id, p.modelo, j.janela_dias, p.d0
),
diario_base AS (
  SELECT
    modelo_id,
    modelo,
    d0,
    data_pedido AS data,
    DATE_DIFF(data_pedido, d0, DAY) AS dia_desde_d0,
    COUNT(DISTINCT order_sk) AS pedidos_dia,
    SUM(pares) AS pares_dia,
    ROUND(SUM(receita_bruta), 2) AS receita_bruta_dia
  FROM pedido_modelo
  GROUP BY modelo_id, modelo, d0, data_pedido
),
diario AS (
  SELECT
    *,
    SUM(pedidos_dia) OVER (PARTITION BY modelo_id ORDER BY data) AS pedidos_acumulados,
    SUM(pares_dia) OVER (PARTITION BY modelo_id ORDER BY data) AS pares_acumulados,
    ROUND(SUM(receita_bruta_dia) OVER (PARTITION BY modelo_id ORDER BY data), 2) AS receita_bruta_acumulada
  FROM diario_base
),
por_sku AS (
  SELECT
    modelo_id,
    modelo,
    sku,
    item_name,
    COUNT(DISTINCT order_sk) AS pedidos,
    SUM(quantity) AS pares,
    ROUND(SUM(receita_bruta), 2) AS receita_bruta,
    ROUND(SUM(desconto), 2) AS desconto,
    ROUND(SUM(receita_liquida), 2) AS receita_liquida,
    MIN(data_venda) AS primeira_data,
    MAX(data_venda) AS ultima_data
  FROM classificados
  GROUP BY modelo_id, modelo, sku, item_name
),
duplicidades AS (
  SELECT
    order_sk,
    sku,
    COUNT(*) AS quantidade_linhas,
    COUNT(DISTINCT item_name) AS nomes_distintos,
    SUM(quantity) AS soma_quantity,
    ROUND(SUM(receita_bruta), 2) AS soma_receita_bruta,
    ARRAY_AGG(DISTINCT item_name IGNORE NULLS LIMIT 10) AS nomes_agrupados
  FROM classificados
  GROUP BY order_sk, sku
  HAVING COUNT(*) > 1
),
conflitos_classificacao AS (
  SELECT
    order_sk,
    line_item_key,
    sku,
    item_name,
    ARRAY_AGG(modelo_id ORDER BY prioridade) AS modelos_candidatos
  FROM candidatos
  GROUP BY order_sk, line_item_key, sku, item_name
  HAVING COUNT(DISTINCT modelo_id) > 1
),
itens_nao_classificados AS (
  SELECT
    i.sku,
    i.item_name,
    COUNT(DISTINCT i.order_sk) AS pedidos,
    SUM(i.quantity) AS pares,
    ROUND(SUM(i.receita_bruta), 2) AS receita_bruta,
    MIN(i.data_venda) AS primeira_data,
    MAX(i.data_venda) AS ultima_data
  FROM itens_validos i
  WHERE REGEXP_CONTAINS(i.item_name_norm, r'(phantom|monochrome|monocrome|rs6 avant|rs7 avant|rs8 avant|rs6 gt|911 gt|knit gt|gt collection)')
    AND NOT EXISTS (
      SELECT 1
      FROM classificados c
      WHERE c.order_sk = i.order_sk
        AND c.line_item_key = i.line_item_key
    )
  GROUP BY i.sku, i.item_name
)
SELECT TO_JSON_STRING(STRUCT(
  CURRENT_DATE('America/Sao_Paulo') AS data_auditoria,
  modelo_filtro AS modelo_filtro,
  'reise-ssot.mart_shared.fct_order_item' AS fonte,
  'i.is_valid_order = TRUE' AS regra_pedido_valido,
  'COUNT(DISTINCT order_sk)' AS regra_pedido,
  'receita_bruta = line_gross_amount; receita_liquida = line_gross_amount - IFNULL(line_discount_amount, 0)' AS regra_receita,
  ARRAY(SELECT AS STRUCT * FROM resumo_janelas ORDER BY modelo_id, janela_dias) AS resumo_janelas,
  ARRAY(SELECT AS STRUCT * FROM diario ORDER BY modelo_id, data) AS diario_acumulado,
  ARRAY(SELECT AS STRUCT * FROM por_sku ORDER BY modelo_id, receita_bruta DESC, pares DESC LIMIT 1000) AS por_sku,
  ARRAY(SELECT AS STRUCT * FROM duplicidades ORDER BY quantidade_linhas DESC, soma_receita_bruta DESC LIMIT 500) AS duplicidades,
  ARRAY(SELECT AS STRUCT * FROM conflitos_classificacao ORDER BY order_sk LIMIT 500) AS conflitos_classificacao,
  ARRAY(SELECT AS STRUCT * FROM itens_nao_classificados ORDER BY receita_bruta DESC LIMIT 500) AS itens_nao_classificados
)) AS auditoria_payload;
