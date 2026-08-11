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
-- 9) classificacao prioriza Monochrome > Series 2 > Phantom > GT > Avant > genericos;
-- 10) ausencia permanece null, nao vira zero.
-- 11) atribuicao paga/organica real prefere a tabela mirror regional
--     mart_shared.canal_atribuicao_pedido_mirror, ligada por source_order_id
--     quando disponivel, por order_name como segunda chave e por email + data + valor como fallback,
--     e cai para campos de origem do pedido quando a mirror nao encontra match.

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

  UNION ALL

  SELECT
    'series_2' AS modelo_id,
    'Series 2' AS modelo,
    DATE('2026-07-16') AS d0,
    'Series 2|Series2|Serie 2|RS8 Avant Whisky|RS8 Avant Off White|RS8 Avant Azul Marinho|Whisky|Off White|Azul Marinho' AS termos_busca,
    'RS8-AVANT|SERIES-2|SERIES2|S2' AS sku_prefixos
),
modelos_norm AS (
  SELECT
    *,
    CASE modelo_id
      WHEN 'rs8_monochrome' THEN 1
      WHEN 'series_2' THEN 2
      WHEN 'phantom' THEN 3
      WHEN 'gt' THEN 4
      WHEN 'avant' THEN 5
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
pedido_atribuicao_raw AS (
  SELECT
    CAST(o.order_sk AS STRING) AS order_sk,
    canal_real.canal AS canal_mirror,
    CASE
      WHEN canal_real.tipo IS NULL THEN CAST(NULL AS STRING)
      WHEN canal_real.tipo = 'paid' THEN 'paid'
      ELSE 'organic'
    END AS tipo_mirror,
    canal_real.regra_atribuicao_real AS regra_mirror,
    CASE
      WHEN canal_real.source_order_id IS NOT NULL THEN CONCAT('source_order_id:', canal_real.source_order_id)
      WHEN canal_real.order_name IS NOT NULL THEN CONCAT('order_name:', canal_real.order_name)
      WHEN canal_real.email_norm IS NULL THEN CAST(NULL AS STRING)
      ELSE CONCAT(canal_real.email_norm, '|', CAST(canal_real.paid_date_brt AS STRING), '|', CAST(canal_real.total_amount AS STRING))
    END AS match_key_mirror,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_source_description'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.marketing_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.marketingChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.order_channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.orderChannel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.Channel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.chanel'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.canal'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.origem'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_name'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceName'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_channel,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_utm_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utm_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utmSource'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.ga_session_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.gaSessionSource'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.session_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.traffic_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.acquisition_source'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_source(?:=|%3d)([^&#% ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_utm_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utm_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utmMedium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.ga_session_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.gaSessionMedium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.session_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.traffic_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.acquisition_medium'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.medium'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_medium(?:=|%3d)([^&#% ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_medium,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_utm_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utm_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.utmCampaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.ga_session_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.gaSessionCampaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.session_campaign'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.campaign_name'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.campaignName'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.campaign'),
      REGEXP_EXTRACT(LOWER(CONCAT(
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landingSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.landing_site_ref'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referring_site'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.referringSite'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_url'), ''), ' ',
        COALESCE(JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceUrl'), '')
      )), r'(?:[?&]|%26)utm_campaign(?:=|%3d)([^&#% ]+)')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_campaign,
    (SELECT LOWER(TRIM(value)) FROM UNNEST([
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.last_source_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.source_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.sourceType'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.channel_type'),
      JSON_EXTRACT_SCALAR(TO_JSON_STRING(o), '$.channelType')
    ]) AS value WHERE NULLIF(TRIM(value), '') IS NOT NULL LIMIT 1) AS raw_source_type
  FROM `reise-ssot.core.order` o
  LEFT JOIN `reise-ssot.mart_shared.canal_atribuicao_pedido_mirror` canal_real
    ON (
      canal_real.source_order_id IS NOT NULL
      AND canal_real.source_order_id = NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '')
    )
    OR (
      canal_real.order_name IS NOT NULL
      AND canal_real.order_name = NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '')
    )
    OR (
      canal_real.email_norm = NULLIF(LOWER(TRIM(CAST(o.customer_email AS STRING))), '')
      AND canal_real.paid_date_brt = DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo')
      AND canal_real.total_amount = ROUND(SAFE_CAST(o.total_amount AS NUMERIC), 2)
    )
  WHERE DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') >= (SELECT MIN(d0) FROM modelos_norm)
    AND DATE(COALESCE(o.paid_at, o.created_at), 'America/Sao_Paulo') <= DATE_ADD((SELECT MAX(d0) FROM modelos_norm), INTERVAL 90 DAY)
    AND o.is_valid_order = TRUE
),
pedido_atribuicao_norm AS (
  SELECT
    *,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_channel, ''), NFD), r'\p{M}', '') AS raw_channel_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source, ''), NFD), r'\p{M}', '') AS raw_source_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_medium, ''), NFD), r'\p{M}', '') AS raw_medium_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_campaign, ''), NFD), r'\p{M}', '') AS raw_campaign_match,
    REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(raw_source_type, ''), NFD), r'\p{M}', '') AS raw_source_type_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(raw_channel, ''), ' ',
        COALESCE(raw_source, ''), ' ',
        COALESCE(raw_medium, ''), ' ',
        COALESCE(raw_campaign, ''), ' ',
        COALESCE(raw_source_type, '')
      ), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS origem_match
  FROM pedido_atribuicao_raw
),
pedido_atribuicao_classificada AS (
  SELECT
    *,
    CASE
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads)( |$)') THEN 'Meta'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)') THEN 'Google Ads'
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)') THEN 'Midia paga'
      WHEN origem_match = ''
        OR REGEXP_CONTAINS(origem_match, r'(^| )(unattributed|unknown|an unknown source|not set)( |$)')
        OR NOT REGEXP_CONTAINS(origem_match, r'(meta|facebook|instagram|google|bing|yahoo|duckduckgo|brave|tiktok|youtube|cpc|ppc|cpm|pmax|paid|ads|adwords|gads|email|newsletter|crm|sms|whatsapp|rdstation|rd station|klaviyo|organic|seo|direct|unattributed|unknown|referral|linktr|ga4)')
        THEN 'Organico'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )(crm|email|newsletter|klaviyo|rdstation|rd station|sms|whatsapp|disparo)( |$)') THEN 'CRM / Organico'
      WHEN REGEXP_CONTAINS(raw_channel_match, r'(instagram|facebook)') THEN 'Organic Social'
      WHEN REGEXP_CONTAINS(raw_channel_match, r'(google|bing|yahoo|duckduckgo|brave)') THEN 'Organic Search'
      WHEN REGEXP_CONTAINS(origem_match, r'(^| )ga4( |$)') THEN 'GA4'
      WHEN raw_channel IS NOT NULL THEN INITCAP(raw_channel)
      WHEN raw_source IS NOT NULL THEN INITCAP(raw_source)
      ELSE 'Origem BigQuery'
    END AS canal_origem_pedido,
    CASE
      WHEN REGEXP_CONTAINS(raw_medium_match, r'(cpcp|cpc|ppc|cpm|pmax|paid|paidsocial|paid[ _-]?social|paidsearch|paid[ _-]?search|display|affiliate|affiliates|demand[ _-]?gen|ads?|adwords|gads|anuncio|anuncios|patrocinad)')
        OR REGEXP_CONTAINS(origem_match, r'(^| )(meta|facebook ads|instagram ads|fb ads|ig ads|google ads|googleads|adwords|gads|pmax|performance max|demand gen)( |$)')
        THEN 'paid'
      WHEN origem_match = ''
        OR REGEXP_CONTAINS(origem_match, r'(^| )(unattributed|unknown|an unknown source|not set)( |$)')
        OR NOT REGEXP_CONTAINS(origem_match, r'(meta|facebook|instagram|google|bing|yahoo|duckduckgo|brave|tiktok|youtube|cpc|ppc|cpm|pmax|paid|ads|adwords|gads|email|newsletter|crm|sms|whatsapp|rdstation|rd station|klaviyo|organic|seo|direct|referral|linktr|ga4)')
        THEN 'organic'
      ELSE 'organic'
    END AS tipo_origem_pedido
  FROM pedido_atribuicao_norm
),
pedido_atribuicao AS (
  SELECT
    order_sk,
    CASE
      WHEN tipo_mirror = 'paid' THEN canal_mirror
      WHEN tipo_origem_pedido = 'paid' THEN canal_origem_pedido
      ELSE COALESCE(canal_mirror, canal_origem_pedido)
    END AS canal_real,
    CASE
      WHEN tipo_mirror = 'paid' OR tipo_origem_pedido = 'paid' THEN 'paid'
      ELSE 'organic'
    END AS tipo_real,
    CASE
      WHEN tipo_mirror = 'paid' THEN COALESCE(regra_mirror, 'email_data_valor_last_click_mirror')
      WHEN tipo_origem_pedido = 'paid' THEN 'core_order_origin_fields'
      WHEN tipo_mirror IS NOT NULL THEN COALESCE(regra_mirror, 'email_data_valor_last_click_mirror')
      WHEN tipo_origem_pedido IS NOT NULL THEN 'core_order_origin_fields'
      ELSE CAST(NULL AS STRING)
    END AS regra_atribuicao_real,
    CASE
      WHEN tipo_mirror = 'paid' AND match_key_mirror IS NOT NULL THEN match_key_mirror
      WHEN tipo_origem_pedido = 'paid' THEN CONCAT('order_origin:', order_sk)
      WHEN match_key_mirror IS NOT NULL THEN match_key_mirror
      WHEN tipo_origem_pedido IS NOT NULL THEN CONCAT('order_origin:', order_sk)
      ELSE CAST(NULL AS STRING)
    END AS atribuicao_match_key
  FROM pedido_atribuicao_classificada
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY order_sk
    ORDER BY
      CASE WHEN tipo_mirror IS NOT NULL THEN 0 ELSE 1 END,
      CASE WHEN tipo_mirror = 'paid' OR tipo_origem_pedido = 'paid' THEN 1 ELSE 2 END,
      COALESCE(canal_mirror, canal_origem_pedido)
  ) = 1
),
itens_validos AS (
  SELECT
    i.order_partition_date_brt AS data,
    CAST(i.order_sk AS STRING) AS order_sk,
    NULLIF(TRIM(CAST(o.source_order_id AS STRING)), '') AS source_order_id_real,
    NULLIF(LOWER(TRIM(CAST(o.order_name AS STRING))), '') AS order_name_norm,
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
    pa.canal_real AS canal_real,
    pa.tipo_real AS tipo_real,
    pa.regra_atribuicao_real AS regra_atribuicao_real,
    pa.atribuicao_match_key AS atribuicao_match_key,
    NULLIF(TRIM(CAST(i.sku AS STRING)), '') AS sku,
    NULLIF(TRIM(CAST(i.item_name AS STRING)), '') AS item_name,
    SAFE_CAST(i.quantity AS INT64) AS pares,
    SAFE_CAST(i.line_gross_amount AS NUMERIC) AS receita_bruta,
    SAFE_CAST(IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS desconto,
    SAFE_CAST(i.line_gross_amount - IFNULL(i.line_discount_amount, 0) AS NUMERIC) AS receita_liquida,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.item_name, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS item_name_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(i.sku, ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS sku_compact,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(CONCAT(COALESCE(i.sku, ''), ' ', COALESCE(i.item_name, ''), ' ', COALESCE(pl_match.cor, '')), NFD), r'\p{M}', ''), r'[^a-z0-9]+', ' ')) AS match_text_norm
  FROM `reise-ssot.mart_shared.fct_order_item` i
  LEFT JOIN `reise-ssot.core.order` o
    ON CAST(o.order_sk AS STRING) = CAST(i.order_sk AS STRING)
  LEFT JOIN pedido_atribuicao pa
    ON pa.order_sk = CAST(i.order_sk AS STRING)
  LEFT JOIN (
    SELECT
      UPPER(TRIM(sku)) AS sku_key,
      ARRAY_AGG(NULLIF(TRIM(cor), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS cor
    FROM `reise-ssot.mart_shared.produto_lancamento_v`
    WHERE NULLIF(TRIM(sku), '') IS NOT NULL
    GROUP BY 1
  ) pl_match
    ON pl_match.sku_key = UPPER(TRIM(i.sku))
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
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantmc') THEN 'rs8avantmc'
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantab') THEN 'rs8avantab'
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantct') THEN 'rs8avantct'
      WHEN m.modelo_id = 'rs8_monochrome' AND STARTS_WITH(i.sku_compact, 'rs8avantcf') THEN 'rs8avantcf'
      WHEN m.modelo_id = 'rs8_monochrome' AND (STARTS_WITH(i.sku_compact, 'rs8avantmono') OR STARTS_WITH(i.sku_compact, 'rs8mono')) THEN 'rs8mono'
      WHEN m.modelo_id = 'rs8_monochrome' THEN 'rs8_monochrome_sem_prefixo'
      WHEN m.modelo_id = 'series_2' AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(whisky|whiskey)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(whisky|whiskey|wh|wk|wky|ws)')
      ) THEN 'series2_whisky'
      WHEN m.modelo_id = 'series_2' AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(off white|offwhite)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(ow|offwhite)')
      ) THEN 'series2_off_white'
      WHEN m.modelo_id = 'series_2' AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(azul marinho|marinho)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(azulmarinho|marinho|mr|am)')
      ) THEN 'series2_azul_marinho'
      WHEN m.modelo_id = 'series_2' THEN 'series2_sem_cor'
      WHEN m.modelo_id = 'phantom' AND STARTS_WITH(i.sku_compact, 'phteasy') THEN 'phteasy'
      WHEN m.modelo_id = 'phantom' AND STARTS_WITH(i.sku_compact, 'phtslip') THEN 'phtslip'
      WHEN m.modelo_id = 'phantom' AND STARTS_WITH(i.sku_compact, 'phtknit') THEN 'phtknit'
      WHEN m.modelo_id = 'phantom' THEN 'phantom_sem_prefixo'
      WHEN m.modelo_id = 'gt' AND STARTS_WITH(i.sku_compact, 'rs6gt') THEN 'rs6gt'
      WHEN m.modelo_id = 'gt' AND STARTS_WITH(i.sku_compact, '911gt') THEN '911gt'
      WHEN m.modelo_id = 'gt' AND STARTS_WITH(i.sku_compact, 'knitgt') THEN 'knitgt'
      WHEN m.modelo_id = 'gt' THEN 'gt_sem_prefixo'
      WHEN m.modelo_id = 'avant' AND STARTS_WITH(i.sku_compact, 'rs6avant') THEN 'rs6avant'
      WHEN m.modelo_id = 'avant' AND STARTS_WITH(i.sku_compact, 'rs7avant') THEN 'rs7avant'
      WHEN m.modelo_id = 'avant' AND STARTS_WITH(i.sku_compact, 'rs8avant') THEN 'rs8avant'
      WHEN m.modelo_id = 'avant' THEN 'avant_sem_prefixo'
      WHEN m.modelo_id IS NOT NULL THEN m.modelo_id
      ELSE NULL
    END AS sub_modelo_id,
    CASE
      WHEN m.modelo_id = 'rs8_monochrome' THEN 'regra_monochrome'
      WHEN m.modelo_id = 'series_2' THEN 'regra_series_2_cores'
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
      m.modelo_id = 'series_2'
      AND (
        STARTS_WITH(i.sku_compact, 'rs8avant')
        OR STARTS_WITH(i.sku_compact, 'series2')
        OR STARTS_WITH(i.sku_compact, 'series')
        OR STARTS_WITH(i.sku_compact, 's2')
        OR REGEXP_CONTAINS(i.match_text_norm, r'(^| )(rs8 avant|series 2|series2|serie 2)( |$)')
      )
      AND (
        REGEXP_CONTAINS(i.match_text_norm, r'(^| )(whisky|whiskey|off white|offwhite|azul marinho|marinho)( |$)')
        OR REGEXP_CONTAINS(i.sku_compact, r'^(rs8avant|series2|s2)(whisky|whiskey|wh|wk|wky|ws|ow|offwhite|azulmarinho|marinho|mr|am)')
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
      m.modelo_id NOT IN ('rs8_monochrome', 'series_2', 'phantom', 'gt', 'avant')
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
    CAST(NULL AS STRING) AS variant_title_catalogo,
    ROW_NUMBER() OVER (
      PARTITION BY ic.modelo_id, ic.order_sk
      ORDER BY ic.data, ic.line_item_key
    ) AS cliente_row_num,
    DATE_DIFF(ic.data, ic.d0, DAY) AS dia_desde_d0,
    COALESCE(
      NULLIF(REGEXP_REPLACE(TRIM(pl.cor), r'^\d+$', ''), ''),
      NULLIF(REGEXP_EXTRACT(ic.match_text_norm, r'(?:^| )(all black|off white|azul marinho|whisky|whiskey|caqui|cinza|marrom|preto|branco|camurca)(?: |$)'), ''),
      'sem_cor'
    ) AS cor_detectada,
    COALESCE(
      NULLIF(TRIM(CAST(pl.tamanho AS STRING)), ''),
      NULLIF(REGEXP_EXTRACT(ic.sku, r'-(3[3-9]|4[0-8])$'), ''),
      NULLIF(REGEXP_EXTRACT(ic.item_name_norm, r'(?:^| )(3[3-9]|4[0-8])(?: |$)'), '')
    ) AS tamanho_detectado
  FROM itens_classificados ic
  LEFT JOIN (
    SELECT
      UPPER(TRIM(sku)) AS sku_key,
      ARRAY_AGG(NULLIF(TRIM(cor), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS cor,
      ARRAY_AGG(NULLIF(TRIM(CAST(tamanho AS STRING)), '') IGNORE NULLS LIMIT 1)[SAFE_OFFSET(0)] AS tamanho
    FROM `reise-ssot.mart_shared.produto_lancamento_v`
    WHERE NULLIF(TRIM(sku), '') IS NOT NULL
    GROUP BY 1
  ) pl
    ON pl.sku_key = UPPER(TRIM(ic.sku))
)
SELECT
  modelo_id,
  sub_modelo_id,
  data,
  ANY_VALUE(source_order_id_real) AS source_order_id,
  order_sk,
  ANY_VALUE(order_name_norm) AS order_name,
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
  ANY_VALUE(canal_real) AS canal_real,
  ANY_VALUE(tipo_real) AS tipo_real,
  ANY_VALUE(atribuicao_match_key) AS atribuicao_match_key,
  ANY_VALUE(regra_atribuicao_real) AS regra_atribuicao_real,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE ROUND(SUM(IF(tipo_real = 'paid', receita_bruta, 0)), 2)
  END AS receita_paga,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE ROUND(SUM(IF(tipo_real IS NOT NULL AND tipo_real != 'paid', receita_bruta, 0)), 2)
  END AS receita_organica,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE CAST(0 AS NUMERIC)
  END AS receita_crm,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE CAST(0 AS NUMERIC)
  END AS receita_outros_canais,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS NUMERIC)
    ELSE CAST(0 AS NUMERIC)
  END AS receita_sem_match_atribuicao,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNT(DISTINCT IF(tipo_real = 'paid', order_sk, NULL))
  END AS pedidos_pagos,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE COUNT(DISTINCT IF(tipo_real IS NOT NULL AND tipo_real != 'paid', order_sk, NULL))
  END AS pedidos_organicos,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE 0
  END AS pedidos_crm,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE 0
  END AS pedidos_outros_canais,
  CASE
    WHEN COUNTIF(tipo_real IS NOT NULL) = 0 THEN CAST(NULL AS INT64)
    ELSE 0
  END AS pedidos_sem_match_atribuicao,
  COUNT(DISTINCT sku) AS skus_distintos,
  TO_JSON_STRING(STRUCT(
    'fct_order_item' AS fonte_base,
    'is_valid_order = TRUE' AS regra_pedido_valido,
    'receita = receita_bruta' AS regra_receita_dashboard,
    COALESCE(ANY_VALUE(regra_atribuicao_real), IF(COUNTIF(tipo_real IS NOT NULL) > 0, 'email_data_valor_last_click', 'sem_atribuicao_real')) AS regra_atribuicao_real,
    COALESCE(ANY_VALUE(regra_atribuicao_real), IF(COUNTIF(tipo_real IS NOT NULL) > 0, 'atribuicao_real_pedido', 'origem_pedido_binaria')) AS regra_join_atribuicao,
    ANY_VALUE(regra_classificacao) AS regra_classificacao
  )) AS flags_qualidade,
  'reise-ssot.mart_shared.fct_order_item' AS fonte
FROM itens_com_flags
GROUP BY
  modelo_id,
  sub_modelo_id,
  data,
  order_sk,
  sku,
  item_name,
  cor_detectada,
  tamanho_detectado
ORDER BY modelo_id, data, order_sk, sku;
