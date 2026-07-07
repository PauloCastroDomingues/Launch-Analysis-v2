-- Reise Launch Analysis v2
-- Consulta base para gerar data/lancamentos_produtos_dia.json.
-- Regras fixas:
-- 1) usar >= no filtro de data para incluir D0;
-- 2) rodar em southamerica-east1;
-- 3) nao criar views/tabelas;
-- 4) nao transformar dado ausente em zero;
-- 5) unificar vendas Shopify + Shoppub, respeitando o corte de migracao.

WITH params AS (
  SELECT TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
),
modelos AS (
  -- Preenchido pelo Apps Script a partir de data/lancamentos_modelos.json no GitHub.
  -- Exemplo para diagnostico local:
  SELECT
    'rs8_monochrome' AS modelo_id,
    'RS8 Avant Monochrome' AS modelo,
    DATE('2026-06-25') AS d0
),
pedidos_validos AS (
  SELECT
    o.source_order_id,
    UPPER(o.source_system) AS source_system,
    o.paid_at,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos)
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
),
shopify_items AS (
  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS product_title,
    CAST(NULL AS STRING) AS variant_title,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS title_text,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS name_text,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount) AS NUMERIC) AS receita
  FROM `reise-ssot.mart_shared.fct_order_item` i
  JOIN `reise-ssot.mart_shared.fct_order` o
    ON o.order_sk = i.order_sk
  WHERE o.is_valid_order
),
shoppub_item_json AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    item_json
  FROM `reise-ssot.stg.shoppub_orders_tbl` o
  CROSS JOIN params p,
  UNNEST(IFNULL(COALESCE(
    JSON_EXTRACT_ARRAY(o.row_json, '$.pedidoitem_set'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.itens'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.line_items'),
    JSON_EXTRACT_ARRAY(o.row_json, '$.order_items')
  ), ARRAY<STRING>[])) AS item_json
  WHERE o.is_valid_order_calc
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt
),
shoppub_items AS (
  SELECT
    source_system,
    source_order_id,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.codigo_produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_sku'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.codigo'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.sku')
    )), '') AS sku,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.descricao'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome')
    )), '') AS nome_produto,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.product_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS product_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.variant_title'),
      JSON_EXTRACT_SCALAR(item_json, '$.variant'),
      JSON_EXTRACT_SCALAR(item_json, '$.variacao'),
      JSON_EXTRACT_SCALAR(item_json, '$.grade'),
      JSON_EXTRACT_SCALAR(item_json, '$.cor'),
      JSON_EXTRACT_SCALAR(item_json, '$.color')
    )), '') AS variant_title,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.title'),
      JSON_EXTRACT_SCALAR(item_json, '$.product_title')
    )), '') AS title_text,
    NULLIF(TRIM(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.name'),
      JSON_EXTRACT_SCALAR(item_json, '$.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto.nome'),
      JSON_EXTRACT_SCALAR(item_json, '$.produto')
    )), '') AS name_text,
    SAFE_CAST(COALESCE(
      JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
      JSON_EXTRACT_SCALAR(item_json, '$.qty'),
      JSON_EXTRACT_SCALAR(item_json, '$.quantity')
    ) AS INT64) AS pares,
    COALESCE(
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_total'),
        JSON_EXTRACT_SCALAR(item_json, '$.total'),
        JSON_EXTRACT_SCALAR(item_json, '$.subtotal'),
        JSON_EXTRACT_SCALAR(item_json, '$.total_price'),
        JSON_EXTRACT_SCALAR(item_json, '$.line_total')
      ) AS NUMERIC),
      SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.valor_unitario'),
        JSON_EXTRACT_SCALAR(item_json, '$.valor'),
        JSON_EXTRACT_SCALAR(item_json, '$.preco'),
        JSON_EXTRACT_SCALAR(item_json, '$.price'),
        JSON_EXTRACT_SCALAR(item_json, '$.unit_price')
      ) AS NUMERIC)
      * SAFE_CAST(COALESCE(
        JSON_EXTRACT_SCALAR(item_json, '$.quantidade'),
        JSON_EXTRACT_SCALAR(item_json, '$.qty'),
        JSON_EXTRACT_SCALAR(item_json, '$.quantity')
      ) AS INT64)
    ) AS receita
  FROM shoppub_item_json
),
itens_unificados AS (
  SELECT * FROM shopify_items
  UNION ALL
  SELECT * FROM shoppub_items
),
vendas AS (
  SELECT
    p.data,
    p.source_system,
    LOWER(p.source_system) AS origem,
    p.source_order_id,
    COALESCE(i.sku, '') AS sku,
    COALESCE(i.nome_produto, i.product_title, '') AS nome_produto,
    COALESCE(i.product_title, i.nome_produto, '') AS product_title,
    COALESCE(i.variant_title, '') AS variant_title,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(
      COALESCE(i.sku, ''), ' ',
      COALESCE(i.nome_produto, ''), ' ',
      COALESCE(i.product_title, ''), ' ',
      COALESCE(i.variant_title, ''), ' ',
      COALESCE(i.title_text, ''), ' ',
      COALESCE(i.name_text, '')
    ), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm,
    i.pares,
    i.receita
  FROM pedidos_validos p
  JOIN itens_unificados i
    ON i.source_order_id = p.source_order_id
   AND i.source_system = p.source_system
  WHERE i.pares IS NOT NULL
    AND i.pares > 0
),
classificado AS (
  SELECT
    v.*,
    CASE
      WHEN
        REGEXP_CONTAINS(v.match_text_norm, r'(^|[^a-z0-9])(monochrome)([^a-z0-9]|$)')
        OR (
          REGEXP_CONTAINS(v.match_text_norm, r'(^|[^a-z0-9])mono([^a-z0-9]|$)')
          AND REGEXP_CONTAINS(v.match_text_norm, r'(^|[^a-z0-9])(rs8|avant)([^a-z0-9]|$)')
        )
        OR REGEXP_CONTAINS(v.sku_norm, r'(mono|monochrome)')
      THEN 'rs8_monochrome'

      WHEN REGEXP_CONTAINS(v.match_text_norm, r'(^|[^a-z0-9])phantom([^a-z0-9]|$)')
        OR REGEXP_CONTAINS(v.sku_norm, r'phantom')
      THEN 'phantom'

      WHEN REGEXP_CONTAINS(v.match_text_norm, r'(^|[^a-z0-9])gt([^a-z0-9]|$)')
        OR REGEXP_CONTAINS(v.sku_norm, r'(^|[^a-z0-9])gt([^a-z0-9]|$)')
      THEN 'gt'

      WHEN REGEXP_CONTAINS(v.match_text_norm, r'(^|[^a-z0-9])avant([^a-z0-9]|$)')
        OR REGEXP_CONTAINS(v.sku_norm, r'avant')
      THEN 'avant'

      ELSE NULL
    END AS modelo_id_detectado
  FROM vendas v
),
match AS (
  SELECT
    m.modelo_id,
    c.data,
    c.origem,
    c.source_order_id,
    c.sku,
    c.nome_produto,
    c.variant_title,
    COALESCE(
      NULLIF(c.product_title, ''),
      NULLIF(REGEXP_EXTRACT(c.nome_produto, r'^(.*?)(?: - | / |\|)'), ''),
      NULLIF(c.nome_produto, '')
    ) AS sub_modelo,
    COALESCE(
      NULLIF(c.variant_title, ''),
      NULLIF(REGEXP_EXTRACT(c.nome_produto, r'(?i)(?:cor|color)[: -]+([^|/,-]+)'), '')
    ) AS cor,
    c.pares,
    c.receita
  FROM classificado c
  JOIN modelos m
    ON c.data >= m.d0 -- inclui D0
   AND c.modelo_id_detectado = m.modelo_id
)
SELECT
  modelo_id,
  data,
  source_order_id,
  origem,
  sku,
  nome_produto,
  variant_title,
  COALESCE(NULLIF(sub_modelo, ''), nome_produto) AS sub_modelo,
  NULLIF(cor, '') AS cor,
  COUNT(DISTINCT source_order_id) AS pedidos,
  SUM(pares) AS pares,
  SUM(receita) AS receita,
  CAST(NULL AS INT64) AS novos,
  CAST(NULL AS INT64) AS recorrentes
FROM match
GROUP BY 1,2,3,4,5,6,7,8,9
ORDER BY modelo_id, data, source_order_id, sku;
