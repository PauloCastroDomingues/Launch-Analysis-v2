-- Classificacao diaria de vendas/pedidos por canal atribuido.
-- Fonte: reise-ssot.mart_growth_us.sales_attributed_to_marketing_v
-- Regra atual: SSOT 9 canais. Meta ADS, Google ADS e WhatsApp Oficial sao
-- pagos; WhatsApp Nao Oficial, E-mail, Direto, Social, Organico e Outros sao
-- organicos.
-- Rode em BigQuery com JOB LOCATION = US.
-- Query somente leitura: nao cria tabela nem view.

WITH base AS (
  SELECT
    report_date,
    LOWER(TRIM(COALESCE(CAST(referring_channel AS STRING), ''))) AS referring_channel_norm,
    LOWER(TRIM(COALESCE(CAST(utm_source AS STRING), ''))) AS utm_source_norm,
    LOWER(TRIM(COALESCE(CAST(utm_medium AS STRING), ''))) AS utm_medium_norm,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(CAST(referring_channel AS STRING), ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS referring_channel_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(CAST(utm_source AS STRING), ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS utm_source_key,
    REGEXP_REPLACE(REGEXP_REPLACE(NORMALIZE_AND_CASEFOLD(COALESCE(CAST(utm_medium AS STRING), ''), NFD), r'\p{M}', ''), r'[^a-z0-9]+', '') AS utm_medium_key,
    LOWER(TRIM(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(COALESCE(CAST(utm_medium AS STRING), ''), NFD),
      r'\p{M}',
      ''
    ))) AS utm_medium_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(CAST(referring_channel AS STRING), ''), ' ',
        COALESCE(CAST(utm_source AS STRING), ''), ' ',
        COALESCE(CAST(utm_medium AS STRING), '')
      ), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS origem_match,
    TRIM(REGEXP_REPLACE(REGEXP_REPLACE(
      NORMALIZE_AND_CASEFOLD(CONCAT(
        COALESCE(CAST(referring_channel AS STRING), ''), ' ',
        COALESCE(CAST(utm_source AS STRING), '')
      ), NFD),
      r'\p{M}',
      ''
    ), r'[^a-z0-9]+', ' ')) AS source_resolved_match,
    SAFE_CAST(orders__last_click AS NUMERIC) AS pedidos,
    SAFE_CAST(net_sales__last_click AS NUMERIC) AS vendas
  FROM `reise-ssot.mart_growth_us.sales_attributed_to_marketing_v`
),
classificado AS (
  SELECT
    report_date,
    CASE
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(instagram|facebook|meta)') AND REGEXP_CONTAINS(origem_match, r'(^| )(cpc|pmax|paid|performance)( |$)') THEN 'Meta ADS'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|doubleclick|adwords|youtube|(^| )yt( |$))') AND REGEXP_CONTAINS(origem_match, r'(^| )(cpc|pmax|paid|pago|shopping|display|performance|ads)( |$)') THEN 'Google ADS'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') AND REGEXP_CONTAINS(utm_medium_match, r'grupo.*vip') THEN 'WhatsApp Nao Oficial'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(^| )(whatsapp|whtasapp|whats|wpp|wa)( |$)') THEN 'WhatsApp Oficial'
      WHEN REGEXP_CONTAINS(origem_match, r'(email|e mail|mail)') THEN 'E-mail'
      WHEN referring_channel_key IN ('', 'nenhum', 'none', 'direct') THEN 'Direto'
      WHEN utm_medium_key = 'bio' THEN 'Social'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(facebook|instagram|tiktok|youtube|linktr|shareable)') THEN 'Social'
      WHEN REGEXP_CONTAINS(source_resolved_match, r'(google|bing|duckduckgo|yahoo|brave|ecosia)') THEN 'Organico'
      ELSE 'Outros'
    END AS channel_group,
    pedidos,
    vendas
  FROM base
)
SELECT
  report_date,
  channel_group,
  SUM(COALESCE(pedidos, 0)) AS pedidos,
  SUM(COALESCE(vendas, 0)) AS vendas
FROM classificado
GROUP BY report_date, channel_group
ORDER BY report_date, channel_group;
