-- Reise Launch Analysis v2
-- Consulta base para gerar data/lancamentos_produtos_dia.json.
-- Regras fixas:
-- 1) usar >= no filtro de data para incluir D0;
-- 2) rodar em southamerica-east1;
-- 3) nao criar views/tabelas;
-- 4) nao transformar dado ausente em zero;
-- 5) unificar vendas Shopify + Shoppub, respeitando o corte de migracao.
-- 6) rs8_monochrome usa fonte canonica core.order_item + core.order e match estrito.
-- 7) clientes novos/recorrentes usam customer_key segura; ausencia fica null.
-- 8) toda venda de modelo precisa vir de pedido valido no SSOT.

WITH params AS (
  SELECT TIMESTAMP('2025-07-10 05:00:00', 'America/Sao_Paulo') AS cutoff_brt
),
modelos AS (
  -- O Apps Script preenche este CTE dinamicamente a partir de data/lancamentos_modelos.json.
  -- Para diagnostico direto no BigQuery, mantemos aqui os modelos exportaveis do snapshot atual.
  SELECT
    'gt' AS modelo_id,
    'GT Collection' AS modelo,
    DATE('2025-12-17') AS d0,
    'GT Collection|RS6 GT|KNIT GT|911 GT' AS termos_busca,
    'RS6-GT|KNIT-GT|911-GT' AS sku_prefixos

  UNION ALL

  SELECT
    'avant' AS modelo_id,
    'Avant' AS modelo,
    DATE('2025-12-14') AS d0,
    'Avant|RS8 Avant|RS6 Avant|RS7 Avant' AS termos_busca,
    'RS8-AVANT|RS6-AVANT|RS7-AVANT' AS sku_prefixos

  UNION ALL

  SELECT
    'phantom' AS modelo_id,
    'Phantom' AS modelo,
    DATE('2026-04-16') AS d0,
    'Phantom|Phantom Slip|Phantom Easy|Phantom Knit' AS termos_busca,
    'PHANTOM-SLIP|PHANTOM-EASY|PHANTOM-KNIT' AS sku_prefixos

  UNION ALL

  SELECT
    'rs8_monochrome' AS modelo_id,
    'RS8 Avant Monochrome' AS modelo,
    DATE('2026-06-25') AS d0,
    'Monochrome|RS8 Monochrome|RS8 Avant Monochrome' AS termos_busca,
    'RS8-AVANT-MONO|RS8-MONO|RS8AVANTMONO' AS sku_prefixos
),
modelos_norm AS (
  SELECT
    *,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(NULLIF(termos_busca, ''), modelo), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS termos_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(REPLACE(IFNULL(sku_prefixos, ''), ',', '|'), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS sku_prefixos_norm
  FROM modelos
),
pedidos_validos AS (
  SELECT
    CAST(o.source_order_id AS STRING) AS source_order_id,
    UPPER(o.source_system) AS source_system,
    o.paid_at,
    DATE(o.paid_at, 'America/Sao_Paulo') AS data
  FROM `reise-ssot.mart_shared.orders_all_valid_no_migracao` o
  CROSS JOIN params p
  WHERE DATE(o.paid_at, 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos_norm)
    AND (
      (UPPER(o.source_system) = 'SHOPPUB' AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt)
      OR (UPPER(o.source_system) = 'SHOPIFY' AND o.paid_at >= p.cutoff_brt)
    )
),
customer_orders_source AS (
  SELECT
    'SHOPPUB' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    CAST(o.order_name AS STRING) AS order_name,
    COALESCE(o.paid_at, o.created_at) AS order_ts,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data,
    NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '') AS email_norm,
    NULLIF(REGEXP_REPLACE(COALESCE(CAST(o.customer_phone_digits AS STRING), ''), r'\D', ''), '') AS phone_norm
  FROM `reise-ssot.stg.shoppub_orders_tbl` o
  CROSS JOIN params p
  WHERE o.is_valid_order_calc = TRUE
    AND COALESCE(o.created_at, o.paid_at) <= p.cutoff_brt

  UNION ALL

  SELECT
    'SHOPIFY' AS source_system,
    CAST(o.source_order_id AS STRING) AS source_order_id,
    CAST(o.order_name AS STRING) AS order_name,
    COALESCE(o.paid_at, o.created_at) AS order_ts,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data,
    NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '') AS email_norm,
    NULLIF(REGEXP_REPLACE(COALESCE(CAST(o.customer_phone AS STRING), ''), r'\D', ''), '') AS phone_norm
  FROM `reise-ssot.core.order` o
  CROSS JOIN params p
  WHERE o.is_valid_order = TRUE
    AND o.paid_at >= p.cutoff_brt
),
customer_orders AS (
  SELECT
    source_system,
    source_order_id,
    order_name,
    order_ts,
    data,
    CASE
      WHEN REGEXP_CONTAINS(email_norm, r'^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN CONCAT('email:', email_norm)
      WHEN LENGTH(phone_norm) BETWEEN 8 AND 15 THEN CONCAT('phone:', phone_norm)
      ELSE NULL
    END AS customer_key
  FROM customer_orders_source
  WHERE order_ts IS NOT NULL
),
customer_orders_com_primeira AS (
  SELECT
    *,
    MIN(order_ts) OVER (PARTITION BY customer_key) AS primeira_compra_ts
  FROM customer_orders
  WHERE customer_key IS NOT NULL
),
customer_orders_classificados AS (
  SELECT
    *,
    CASE
      WHEN primeira_compra_ts < order_ts THEN 'recorrente'
      ELSE 'novo'
    END AS cliente_tipo
  FROM customer_orders_com_primeira
),
customer_orders_by_order_ref AS (
  SELECT
    source_system,
    LOWER(TRIM(order_ref)) AS order_ref,
    source_order_id,
    order_name,
    order_ts,
    customer_key,
    cliente_tipo
  FROM customer_orders_classificados,
  UNNEST([
    source_order_id,
    order_name,
    REGEXP_REPLACE(order_name, r'^#', ''),
    IF(source_order_id IS NULL, NULL, CONCAT('#', source_order_id))
  ]) AS order_ref
  WHERE order_ref IS NOT NULL
    AND TRIM(order_ref) != ''
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY source_system, LOWER(TRIM(order_ref))
    ORDER BY order_ts, source_order_id, order_name
  ) = 1
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
    co.customer_key,
    co.cliente_tipo,
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
  LEFT JOIN customer_orders_by_order_ref co
    ON co.source_system = p.source_system
   AND co.order_ref = LOWER(TRIM(CAST(p.source_order_id AS STRING)))
  WHERE i.pares IS NOT NULL
    AND i.pares > 0
),
candidatos AS (
  SELECT
    v.*,
    m.modelo_id,
    m.d0,
    GREATEST(
      IFNULL((
        SELECT MAX(LENGTH(TRIM(term)))
        FROM UNNEST(SPLIT(IFNULL(m.termos_norm, ''), '|')) AS term
        WHERE TRIM(term) != ''
          AND REGEXP_CONTAINS(
            v.match_text_norm,
            CONCAT(r'(^|[^a-z0-9])', REGEXP_REPLACE(TRIM(term), r'\s+', r'\\s+'), r'([^a-z0-9]|$)')
          )
      ), 0),
      IFNULL((
        SELECT MAX(1000 + LENGTH(TRIM(prefixo)))
        FROM UNNEST(SPLIT(IFNULL(m.sku_prefixos_norm, ''), '|')) AS prefixo
        WHERE TRIM(prefixo) != ''
          AND STARTS_WITH(v.sku_norm, TRIM(prefixo))
      ), 0)
    ) AS match_score
  FROM vendas v
  JOIN modelos_norm m
    ON m.modelo_id != 'rs8_monochrome'
   AND v.data >= m.d0 -- inclui D0
),
match AS (
  SELECT
    c.modelo_id,
    c.data,
    c.origem,
    c.source_order_id,
    c.customer_key,
    c.cliente_tipo,
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
    NULLIF(REGEXP_EXTRACT(c.match_text_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho,
    c.pares,
    c.receita,
    c.match_text_norm,
    c.modelo_id AS modelo_id_detectado
  FROM candidatos c
  WHERE c.match_score > 0
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY c.source_system, c.source_order_id, c.sku, c.nome_produto, c.variant_title
    ORDER BY c.match_score DESC, c.d0 DESC, c.modelo_id
  ) = 1
),
monochrome_item_source AS (
  SELECT
    'rs8_monochrome' AS modelo_id,
    DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') AS data,
    'SSOT_CORE' AS source_system,
    'ssot_core' AS origem,
    CAST(o.order_name AS STRING) AS source_order_id,
    CAST(o.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(o.customer_email AS STRING)), '') AS customer_email,
    NULLIF(TRIM(CAST(o.customer_phone AS STRING)), '') AS customer_phone,
    co.customer_key,
    co.cliente_tipo,
    NULLIF(TRIM(CAST(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.line_item_id') AS STRING)), '') AS line_item_id,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS nome_produto,
    CAST(NULL AS STRING) AS variant_title,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(COALESCE(i.line_net_amount, i.line_gross_amount - IFNULL(i.line_discount_amount, 0)) AS NUMERIC) AS receita,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS sku_norm,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.item_name, ''), ' ', COALESCE(i.sku, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM `reise-ssot.core.order_item` i
  JOIN `reise-ssot.core.order` o
    ON o.order_sk = i.order_sk
  JOIN modelos_norm m
    ON m.modelo_id = 'rs8_monochrome'
   AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') >= m.d0
  LEFT JOIN customer_orders_by_order_ref co
    ON co.source_system = 'SHOPIFY'
   AND co.order_ref = LOWER(TRIM(CAST(o.order_name AS STRING)))
  WHERE o.is_valid_order = TRUE
    AND i.item_name IS NOT NULL
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
monochrome_flags AS (
  SELECT
    *,
    REGEXP_CONTAINS(item_name_norm, r'(^|[^a-z0-9])monochrome([^a-z0-9]|$)') AS has_title_match,
    (
      STARTS_WITH(sku_norm, 'rs8 avant mono')
      OR STARTS_WITH(sku_norm, 'rs8 mono')
      OR STARTS_WITH(sku_norm, 'rs8avantmono')
    ) AS has_sku_match
  FROM monochrome_item_source
),
monochrome_filtrado AS (
  SELECT
    *,
    COALESCE(
      NULLIF(line_item_id, ''),
      TO_JSON_STRING(STRUCT(order_sk, sku, nome_produto, pares, receita))
    ) AS dedupe_key
  FROM monochrome_flags
  WHERE has_title_match OR has_sku_match
),
monochrome_match AS (
  SELECT
    modelo_id,
    data,
    origem,
    source_order_id,
    customer_key,
    cliente_tipo,
    COALESCE(sku, '') AS sku,
    COALESCE(nome_produto, '') AS nome_produto,
    variant_title,
    'RS8 Avant Monochrome' AS sub_modelo,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), '') AS cor,
    NULLIF(REGEXP_EXTRACT(item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '') AS tamanho,
    pares,
    receita,
    match_text_norm,
    'rs8_monochrome' AS modelo_id_detectado
  FROM monochrome_filtrado
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY dedupe_key
    ORDER BY source_order_id, sku, nome_produto, pares, receita
  ) = 1
),
match_unificado AS (
  SELECT * FROM match
  UNION ALL
  SELECT * FROM monochrome_match
),
match_unificado_classificado AS (
  SELECT
    *,
    ROW_NUMBER() OVER (
      PARTITION BY
        modelo_id,
        COALESCE(
          source_order_id,
          CONCAT('__sem_pedido__', origem, '|', CAST(data AS STRING), '|', sku, '|', nome_produto, '|', IFNULL(variant_title, ''))
        )
      ORDER BY data, sku, nome_produto, IFNULL(variant_title, ''), match_text_norm
    ) AS cliente_row_num
  FROM match_unificado
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
  NULLIF(tamanho, '') AS tamanho,
  COUNT(DISTINCT source_order_id) AS pedidos,
  SUM(pares) AS pares,
  SUM(receita) AS receita,
  CASE
    WHEN COUNTIF(cliente_row_num = 1 AND cliente_tipo IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNTIF(cliente_row_num = 1 AND cliente_tipo = 'novo')
  END AS novos,
  CASE
    WHEN COUNTIF(cliente_row_num = 1 AND cliente_tipo IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNTIF(cliente_row_num = 1 AND cliente_tipo = 'recorrente')
  END AS recorrentes,
  match_text_norm,
  modelo_id_detectado
FROM match_unificado_classificado
GROUP BY 1,2,3,4,5,6,7,8,9,10,16,17
ORDER BY modelo_id, data, source_order_id, sku;
