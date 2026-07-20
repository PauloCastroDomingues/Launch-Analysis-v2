-- Reise Launch Analysis v2
-- Query canonica para gerar data/lancamentos_produtos_dia.json.
--
-- Regras fixas:
-- 1) fonte preferencial: reise-ssot.mart_shared.fct_order_item;
-- 2) pedido valido: i.is_valid_order = TRUE;
-- 3) pedido/distintos: COUNT(DISTINCT order_sk);
-- 4) faturamento do dashboard: receita_bruta = line_gross_amount;
-- 5) receita_liquida fica disponivel como line_gross_amount - desconto;
-- 6) metricas do modelo usam apenas itens classificados naquele modelo;
-- 7) D0 vem do cadastro de lancamentos;
-- 8) janelas D+N sao inclusivas: BETWEEN d0 AND DATE_ADD(d0, INTERVAL N DAY);
-- 9) classificacao prioriza Monochrome > Phantom > GT > Avant > genericos;
-- 10) ausencia permanece null, nao vira zero.

WITH modelos AS (
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
    'PHTEASY|PHTSLIP|PHTKNIT|PHANTOM-SLIP|PHANTOM-EASY|PHANTOM-KNIT' AS sku_prefixos

  UNION ALL

  SELECT
    'rs8_monochrome' AS modelo_id,
    'RS8 Avant Monochrome' AS modelo,
    DATE('2026-06-25') AS d0,
    'RS8 Avant Monochrome|Monochrome|Monocrome' AS termos_busca,
    'RS8AVANT-MC|RS8AVANT-AB|RS8AVANT-CT|RS8AVANT-CF|RS8-AVANT-MONO|RS8-MONO|RS8AVANTMONO' AS sku_prefixos
),
modelos_norm AS (
  SELECT
    *,
    CASE modelo_id
      WHEN 'rs8_monochrome' THEN 1
      WHEN 'phantom' THEN 2
      WHEN 'gt' THEN 3
      WHEN 'avant' THEN 4
      ELSE 99
    END AS prioridade_modelo,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(NULLIF(termos_busca, ''), modelo), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', ' ')) AS termos_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(REPLACE(IFNULL(sku_prefixos, ''), ',', '|'), NFD),
      r'\p{M}', ''
    ), r'[^a-z0-9|]+', '') AS sku_prefixos_compact
  FROM modelos
),
itens_validos AS (
  SELECT
    i.order_partition_date_brt AS data,
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
    CASE
      WHEN NULLIF(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_sk')), '') IS NOT NULL
        THEN CONCAT('customer_sk:', TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_sk')))
      WHEN REGEXP_CONTAINS(NULLIF(LOWER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_email'))), ''), r'^[^@\s]+@[^@\s]+\.[^@\s]+$')
        THEN CONCAT('email:', LOWER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_email'))))
      WHEN LENGTH(NULLIF(REGEXP_REPLACE(COALESCE(
        JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone'),
        JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone_digits'),
        ''
      ), r'\D', ''), '')) BETWEEN 8 AND 15
        THEN CONCAT('phone:', NULLIF(REGEXP_REPLACE(COALESCE(
          JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone'),
          JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone_digits'),
          ''
        ), r'\D', ''), ''))
      ELSE NULL
    END AS customer_key,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM `reise-ssot.mart_shared.fct_order_item` i
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt >= (SELECT MIN(d0) FROM modelos_norm)
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
cliente_pedidos_source AS (
  SELECT
    CAST(i.order_sk AS STRING) AS order_sk,
    i.order_partition_date_brt AS data_pedido,
    NULLIF(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_sk')), '') AS customer_sk_norm,
    NULLIF(LOWER(TRIM(JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_email'))), '') AS email_norm,
    NULLIF(REGEXP_REPLACE(COALESCE(
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(i), '$.customer_phone_digits'),
      ''
    ), r'\D', ''), '') AS phone_norm
  FROM `reise-ssot.mart_shared.fct_order_item` i
  WHERE i.is_valid_order = TRUE
    AND i.order_partition_date_brt <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND SAFE_CAST(i.quantity AS INT64) > 0
),
cliente_pedidos_com_key AS (
  SELECT
    order_sk,
    data_pedido,
    CASE
      WHEN customer_sk_norm IS NOT NULL THEN CONCAT('customer_sk:', customer_sk_norm)
      WHEN REGEXP_CONTAINS(email_norm, r'^[^@\s]+@[^@\s]+\.[^@\s]+$') THEN CONCAT('email:', email_norm)
      WHEN LENGTH(phone_norm) BETWEEN 8 AND 15 THEN CONCAT('phone:', phone_norm)
      ELSE NULL
    END AS customer_key
  FROM cliente_pedidos_source
),
cliente_pedidos AS (
  SELECT
    order_sk,
    customer_key,
    MIN(data_pedido) AS data_pedido
  FROM cliente_pedidos_com_key
  WHERE customer_key IS NOT NULL
  GROUP BY order_sk, customer_key
),
cliente_primeira_compra AS (
  SELECT
    customer_key,
    MIN(data_pedido) AS primeira_compra
  FROM cliente_pedidos
  GROUP BY customer_key
),
itens_candidatos AS (
  SELECT
    m.modelo_id,
    m.modelo,
    m.d0,
    m.prioridade_modelo,
    i.*,
    CASE
      WHEN m.modelo_id = 'rs8_monochrome' THEN 'regra_monochrome'
      WHEN m.modelo_id = 'phantom' THEN 'regra_phantom'
      WHEN m.modelo_id = 'gt' THEN 'regra_gt'
      WHEN m.modelo_id = 'avant' THEN 'regra_avant'
      ELSE 'regra_cadastro'
    END AS regra_classificacao
  FROM itens_validos i
  JOIN modelos_norm m
    ON i.data BETWEEN m.d0 AND DATE_ADD(m.d0, INTERVAL 90 DAY)
  WHERE (
    (
      m.modelo_id = 'rs8_monochrome'
      AND (
        STARTS_WITH(i.sku_compact, 'rs8avantmc')
        OR STARTS_WITH(i.sku_compact, 'rs8avantab')
        OR STARTS_WITH(i.sku_compact, 'rs8avantct')
        OR STARTS_WITH(i.sku_compact, 'rs8avantcf')
        OR STARTS_WITH(i.sku_compact, 'rs8avantmono')
        OR STARTS_WITH(i.sku_compact, 'rs8mono')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )rs8 avant monochrome( |$)')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
    OR (
      m.modelo_id = 'phantom'
      AND (
        STARTS_WITH(i.sku_compact, 'phteasy')
        OR STARTS_WITH(i.sku_compact, 'phtslip')
        OR STARTS_WITH(i.sku_compact, 'phtknit')
        OR STARTS_WITH(i.sku_compact, 'phantomeasy')
        OR STARTS_WITH(i.sku_compact, 'phantomslip')
        OR STARTS_WITH(i.sku_compact, 'phantomknit')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )phantom( |$)')
      )
    )
    OR (
      m.modelo_id = 'gt'
      AND (
        STARTS_WITH(i.sku_compact, 'rs6gt')
        OR STARTS_WITH(i.sku_compact, '911gt')
        OR STARTS_WITH(i.sku_compact, 'knitgt')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 gt|911 gt|knit gt|gt collection)( |$)')
      )
    )
    OR (
      m.modelo_id = 'avant'
      AND (
        STARTS_WITH(i.sku_compact, 'rs6avant')
        OR STARTS_WITH(i.sku_compact, 'rs7avant')
        OR STARTS_WITH(i.sku_compact, 'rs8avant')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(rs6 avant|rs7 avant|rs8 avant)( |$)')
      )
      AND NOT (
        STARTS_WITH(i.sku_compact, 'rs8avantmc')
        OR STARTS_WITH(i.sku_compact, 'rs8avantab')
        OR STARTS_WITH(i.sku_compact, 'rs8avantct')
        OR STARTS_WITH(i.sku_compact, 'rs8avantcf')
        OR STARTS_WITH(i.sku_compact, 'rs8avantmono')
        OR REGEXP_CONTAINS(i.item_name_norm, r'(^| )(monochrome|monocrome)( |$)')
      )
    )
    OR (
      m.modelo_id NOT IN ('rs8_monochrome', 'phantom', 'gt', 'avant')
      AND (
        EXISTS (
          SELECT 1
          FROM UNNEST(SPLIT(IFNULL(m.sku_prefixos_compact, ''), '|')) AS prefixo
          WHERE TRIM(prefixo) != ''
            AND STARTS_WITH(i.sku_compact, TRIM(prefixo))
        )
        OR EXISTS (
          SELECT 1
          FROM UNNEST(SPLIT(IFNULL(m.termos_norm, ''), '|')) AS termo
          WHERE TRIM(termo) != ''
            AND REGEXP_CONTAINS(
              i.match_text_norm,
              CONCAT(r'(^|[^a-z0-9])', REGEXP_REPLACE(TRIM(termo), r'\s+', r'\\s+'), r'([^a-z0-9]|$)')
            )
        )
      )
    )
   )
),
itens_classificados AS (
  SELECT
    c.*,
    p.primeira_compra,
    CASE
      WHEN c.customer_key IS NULL THEN NULL
      WHEN p.primeira_compra < c.data THEN 'recorrente'
      ELSE 'novo'
    END AS cliente_tipo
  FROM itens_candidatos c
  LEFT JOIN cliente_primeira_compra p
    ON p.customer_key = c.customer_key
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY c.order_sk, c.line_item_key
    ORDER BY c.prioridade_modelo, c.d0 DESC, c.modelo_id
  ) = 1
),
itens_com_flags AS (
  SELECT
    ic.*,
    ic.variant_title AS variant_title_catalogo,
    ROW_NUMBER() OVER (
      PARTITION BY ic.modelo_id, ic.order_sk
      ORDER BY ic.data, ic.line_item_key
    ) AS cliente_row_num,
    DATE_DIFF(ic.data, ic.d0, DAY) AS dia_desde_d0,
    COALESCE(
      NULLIF(TRIM(pl.cor), ''),
      NULLIF(REGEXP_EXTRACT(ic.item_name_norm, r'(?:^| )(all black|off white|azul marinho|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), ''),
      'sem_cor'
    ) AS cor_detectada,
    COALESCE(
      NULLIF(TRIM(CAST(pl.tamanho AS STRING)), ''),
      NULLIF(REGEXP_EXTRACT(ic.sku, r'-(3[3-9]|4[0-8])$'), ''),
      NULLIF(REGEXP_EXTRACT(ic.item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '')
    ) AS tamanho_detectado
  FROM itens_classificados ic
  LEFT JOIN `reise-ssot.mart_shared.produto_lancamento_v` pl
    ON UPPER(TRIM(pl.sku)) = UPPER(TRIM(ic.sku))
)
SELECT
  modelo_id,
  data,
  order_sk AS source_order_id,
  order_sk,
  'ssot_fct_order_item' AS origem,
  sku,
  item_name AS nome_produto,
  ANY_VALUE(variant_title_catalogo) AS variant_title,
  item_name AS sub_modelo,
  cor_detectada AS cor,
  tamanho_detectado AS tamanho,
  COUNT(DISTINCT order_sk) AS pedidos,
  COUNT(DISTINCT order_sk) AS pedidos_validos,
  SUM(pares) AS pares,
  ROUND(SUM(receita_bruta), 2) AS receita,
  ROUND(SUM(receita_bruta), 2) AS receita_bruta,
  ROUND(SUM(desconto), 2) AS desconto,
  ROUND(SUM(receita_liquida), 2) AS receita_liquida,
  CASE
    WHEN COUNTIF(cliente_row_num = 1 AND cliente_tipo IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNTIF(cliente_row_num = 1 AND cliente_tipo = 'novo')
  END AS novos,
  CASE
    WHEN COUNTIF(cliente_row_num = 1 AND cliente_tipo IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNTIF(cliente_row_num = 1 AND cliente_tipo = 'recorrente')
  END AS recorrentes,
  ANY_VALUE(match_text_norm) AS match_text_norm,
  modelo_id AS modelo_id_detectado,
  ANY_VALUE(d0) AS d0,
  ANY_VALUE(dia_desde_d0) AS dia_desde_d0,
  COUNT(DISTINCT sku) AS skus_distintos,
  TO_JSON_STRING(STRUCT(
    'fct_order_item' AS fonte_base,
    'is_valid_order = TRUE' AS regra_pedido_valido,
    'receita = receita_bruta' AS regra_receita_dashboard,
    ANY_VALUE(regra_classificacao) AS regra_classificacao
  )) AS flags_qualidade,
  'reise-ssot.mart_shared.fct_order_item' AS fonte
FROM itens_com_flags
GROUP BY
  modelo_id,
  data,
  order_sk,
  sku,
  item_name,
  cor_detectada,
  tamanho_detectado
ORDER BY modelo_id, data, order_sk, sku;
