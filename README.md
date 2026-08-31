# Reise Launch Analysis v2

Dashboard estático para análise de lançamentos da Reise.

Produção: https://launch-analysis-v2.vercel.app

O app roda na Vercel, lê JSONs versionados em `/data` via `fetch` e não depende de backend em runtime. A atualização operacional vem do BigQuery/SSOT pelo Apps Script, que grava os JSONs no GitHub. A planilha principal de investimento é opcional e alimenta `midia_paga` + `crm_disparos` como base única de investimento.

## Estado Atual

O estado operacional não fica duplicado no README. Use `data/manifest.json` como fonte canônica do snapshot publicado:

- `generated_at`: data e hora da exportação.
- `active_models` e `exported_models`: linhas ativas/exportadas.
- `row_counts`: volume por JSON.
- `data_quality`: auditorias disponíveis, como `rs8_monochrome`.

Checagem rápida depois de `exportarTudo()`:

```powershell
node scripts\auditar_pacote_publico.js
node scripts\auditar_atribuicao_exportado.js data\lancamentos_produtos_dia.json
```

## Regras Operacionais Locais

- Prints, screenshots e artefatos de validacao visual (`layout-*.png`, `layout-*.html`, capturas desktop/mobile) nao devem ficar dentro do projeto. Gere fora da pasta do repositorio ou apague ao terminar a validacao.
- Nao ha requisito de versao mobile para este dashboard. Ajustes mobile/responsivos so entram quando houver pedido explicito.
- Estas regras podem ficar como anotacao local no README e nao precisam ser commitadas.

## Modelos

Os modelos ficam em `data/lancamentos_modelos.json`.

| modelo_id | Modelo | Status | D0 analítico | Observação |
| --- | --- | --- | --- | --- |
| `gt` | GT Collection | `historico` | `2025-12-17` | Histórico recalculado pelo SSOT com pedidos válidos. |
| `avant` | Avant | `historico` | `2025-12-14` | Histórico recalculado pelo SSOT com pedidos válidos. |
| `phantom` | Phantom | `historico` | `2026-04-16` | Histórico estático; 90d ainda não consolidado. |
| `rs8_monochrome` | RS8 Avant Monochrome | `ativo` | `2026-06-25` | Exportado pelo Apps Script/BigQuery. |
| `series_2` | Series 2 | `ativo` | `2026-07-16` | Relançamento RS8 Avant por cores: Whisky, Off White e Azul Marinho. |
| `pais_2026` | Lançamento Dia dos Pais | `planejado` | `2026-08-10` | Benchmark e planejamento antes do D0. |

## Benchmarks Auditados

GT e Avant foram recalculados a partir da query canônica `sql/auditoria_historico_gt_avant.sql`, usando pedidos válidos de Shopify + Shoppub e abertura por origem.

Regra central:

- Toda venda usada no dashboard precisa vir de pedido válido no SSOT; pedido inválido, cancelado ou fora da regra de validade não entra em vendas de modelo.
- Shopify: `reise-ssot.core.order_item` + `reise-ssot.core.order` com `o.is_valid_order = TRUE`.
- Shoppub: `reise-ssot.stg.shoppub_orders_tbl` com `is_valid_order_calc = TRUE`.
- Pedido distinto: `CONCAT(origem, '|', pedido_id)`.
- Match de produto normalizado por palavra: `gt` e `avant`.
- Janela inclusiva: `BETWEEN data_primeira_venda AND DATE_ADD(data_primeira_venda, INTERVAL dias DAY)`.

### GT Collection

D0 analítico: `2025-12-17`.

| Janela | Pedidos | Pares | Receita | Ticket | Preço/par | Shopify pedidos | Shoppub pedidos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D7 | 105 | 125 | 97125 | 925 | 777 | 105 | 0 |
| D15 | 142 | 169 | 131257 | 924.35 | 776.67 | 142 | 0 |
| D30 | 247 | 391 | 302197 | 1223.47 | 772.88 | 247 | 0 |
| D60 | 500 | 749 | 574639 | 1149.28 | 767.21 | 500 | 0 |
| D90 | 878 | 1222 | 938191.5 | 1068.56 | 767.75 | 878 | 0 |

### Avant

D0 analítico: `2025-12-14`.

| Janela | Pedidos | Pares | Receita | Ticket | Preço/par | Shopify pedidos | Shoppub pedidos |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| D7 | 172 | 212 | 112226 | 652.48 | 529.37 | 172 | 0 |
| D15 | 269 | 336 | 179208 | 666.2 | 533.36 | 269 | 0 |
| D30 | 481 | 805 | 430225 | 894.44 | 534.44 | 481 | 0 |
| D60 | 1405 | 2113 | 1141861 | 812.71 | 540.4 | 1405 | 0 |
| D90 | 2735 | 3911 | 2189551.37 | 800.57 | 559.84 | 2735 | 0 |

Campos gravados nas janelas de `data/lancamentos_historico.json`:

```txt
receita | pares | pedidos | ticket | preco_medio_par | novos_pct | origem
pedidos_shoppub | pedidos_shopify
pares_shoppub | pares_shopify
receita_shoppub | receita_shopify
```

`novos_pct` fica `null` nos benchmarks recalculados enquanto novos/recorrentes não tiverem auditoria própria.

## Estrutura

```txt
reise-launch-dashboard-v2/
├── index.html
├── assets/
│   ├── app.js
│   ├── embedded-data.js
│   └── styles.css
├── apps_script/
│   └── ExportLaunchAnalysis.gs
├── data/
│   ├── auditoria_monochrome.json
│   ├── calendario_br.json
│   ├── crm_disparos.json
│   ├── estoque.json
│   ├── lancamentos_historico.json
│   ├── lancamentos_modelos.json
│   ├── lancamentos_produtos_dia.json
│   ├── manifest.json
│   └── midia_paga.json
├── docs/
│   └── decisions.md
├── sql/
│   ├── auditoria_historico_gt_avant.sql
│   ├── auditoria_lancamentos_ssot.sql
│   ├── canal_atribuicao_pedido_mirror.sql
│   ├── diagnostico_monochrome.sql
│   ├── diagnostico_monochrome_amplo.sql
│   ├── diagnostico_rs8_monochrome.sql
│   └── lancamentos_produtos_dia.sql
└── vercel.json
```

## Arquivos Principais

| Arquivo | Papel |
| --- | --- |
| `index.html` | Shell estático do dashboard. |
| `assets/app.js` | Carrega JSONs, monta KPIs, comparativos, ranking, curvas, estoque, calendário, ações e projeção. |
| `assets/styles.css` | Design system visual. |
| `assets/embedded-data.js` | Fallback para abrir o HTML direto; deve ser sincronizado quando os JSONs mudam manualmente. |
| `apps_script/ExportLaunchAnalysis.gs` | Exportador BigQuery/GitHub e auditorias. |
| `data/lancamentos_modelos.json` | Cadastro e D0 dos modelos. |
| `data/lancamentos_historico.json` | Benchmarks históricos agregados. |
| `data/lancamentos_produtos_dia.json` | Vendas reais por item/dia dos modelos exportáveis. |
| `data/auditoria_monochrome.json` | Auditoria independente do Monochrome. |
| `data/manifest.json` | Snapshot da última exportação e `data_quality`. |
| `sql/auditoria_historico_gt_avant.sql` | Auditoria correta para GT e Avant. |
| `sql/auditoria_lancamentos_ssot.sql` | Auditoria canônica para todos os modelos usando `fct_order_item`, `order_sk`, pedidos válidos e receita bruta/líquida. |
| `sql/canal_atribuicao_pedido_mirror.sql` | SQL operacional da replica cross-region de atribuicao last-click por source_order_id/order_id ou order_name. |
| `sql/lancamentos_produtos_dia.sql` | Query-base do pipeline de vendas por lançamento. |
| `sql/diagnostico_monochrome*.sql` | Diagnóstico de cadastro/match do Monochrome. |

## Apps Script

Script Properties obrigatórias:

```txt
BQ_PROJECT_ID = reise-ssot
GITHUB_TOKEN
GITHUB_REPO = PauloCastroDomingues/Launch-Analysis-v2
GITHUB_BRANCH = main
DATA_PATH = data
```

Script Property opcional:

```txt
INVESTMENT_SPREADSHEET_ID = 1dlCRxvViAL1gG4Y4pBfhnH_EK-HQdcyGBAwd0vTfV68
MIDIA_SPREADSHEET_ID = compatibilidade_legada
ATRIBUICAO_REAL_CANAL_ENABLED = true|false
```

Serviço avançado necessário:

```txt
BigQuery API
```

Funções principais:

| Função | Uso |
| --- | --- |
| `exportarTudo()` | Lê modelos do GitHub, consulta BigQuery, exporta vendas, auditoria Monochrome, estoque, manifest e fontes opcionais. |
| `instalarTrigger()` | Instala trigger diário às 07:15 no fuso `America/Sao_Paulo`. |
| `auditarVendasMonochrome()` | Regera apenas `auditoria_monochrome.json`. |
| `diagnosticarMonochrome()` | Lista linhas filtradas por termos RS8/Avant/Mono desde o D0. |
| `diagnosticarMonochromeAmplo()` | Lista produtos mais vendidos sem filtro para investigar cadastro real. |

`exportarTudo()` não depende de planilha ativa. Sem `INVESTMENT_SPREADSHEET_ID`/`MIDIA_SPREADSHEET_ID`, ele usa a planilha principal padrão de investimento e continua exportando vendas/estoque/manifest.

## Regras de Dados

- Dado ausente permanece `null` no JSON e aparece como `—` na interface.
- Nunca transformar ausência em `0`.
- Filtros de data usam inclusão do D0.
- O relógio analítico do front usa `manifest.generated_at`; se o manifest estiver ausente, usa a maior data de `lancamentos_produtos_dia.json` antes de cair na data do navegador.
- O front carrega `data/manifest.json` primeiro e usa `manifest.generated_at` como chave de cache para os demais JSONs.
- Depois do manifest, os arquivos em `DATA_FILES` são carregados em paralelo para reduzir o tempo de abertura do painel.
- A Vercel serve `/data/(.*)` com `Cache-Control: no-store`; os assets versionados ficam com query string em `index.html` e `dashboard.html`.
- Janelas `7d`, `15d`, `30d`, `60d` e `90d` significam D+N inclusivo: D0 até D+N.
- `day_zero_base` é o D0 canônico usado pelo dashboard para toda janela comparativa.
- `data_lancamento` e `data_oficial` são contexto de calendário/oficial; não substituem `day_zero_base` em cálculo.
- `mart_shared.linha_cadastro` mantém `data_lancamento` como data de cadastro/oficial e `day_zero_base` como D0 analítico; o exportador não faz fallback silencioso entre esses campos.
- Modelos exportáveis pelo Apps Script precisam estar com `status = historico` ou `status = ativo` e `day_zero_base` válido.
- Histórico (`status = historico`) também entra como benchmark estático em `lancamentos_historico.json`, mas pode ser reexportado no pipeline diário quando precisa de granularidade por pedido/item.
- Quando existe `lancamentos_produtos_dia.json` para um modelo, o front prioriza o pipeline diário. `lancamentos_historico.json` fica como fallback/benchmark estático e passa pela mesma normalização de contrato das janelas do pipeline.
- Lançamento futuro entra como `status = planejado` em `lancamentos_modelos.json`.
- Rodar queries do dashboard em `southamerica-east1`.
- Excecao operacional: atribuicao real depende da tabela espelho `mart_shared.canal_atribuicao_pedido_mirror`, criada a partir de `mart_growth_us.shopify__orders_journey_latest_v` por rotina agendada/carga cross-region ou pela sincronizacao automatica de `exportarTudo()`. O join usa apenas chave estavel (`source_order_id`/`order_id` ou `order_name`); nao usa email normalizado + data paga + valor como fallback. A classificacao vigente separa aquisicao pura: `Midia paga` exige sinal de anuncio (`cpc`, `pmax`, `paid`, `demand-gen`, `performance`, `ads`, `display`, `source_type` pago etc.); `Organico` exige sinal organico de busca/social/SEO; `Direto`, `E-mail/CRM`, `WhatsApp`, `Outro atribuido` e `Nao atribuido` ficam como controles separados. Se a mirror ainda nao existir, `exportarTudo()` continua sem quebrar e mantem `receita_paga`/`receita_organica`/`receita_crm` como `null`.

## Pipeline de Vendas por Modelo

Para modelos com `status = historico` ou `status = ativo`, o Apps Script usa `consultarProdutosDia_()` e grava `data/lancamentos_produtos_dia.json`.

Saída esperada por linha:

```txt
modelo_id | data | order_sk | origem | sku | nome_produto
variant_title | sub_modelo | cor | tamanho | pedidos | pedidos_validos | pares
receita | receita_bruta | desconto | receita_liquida | novos | recorrentes
match_text_norm | modelo_id_detectado | d0 | dia_desde_d0 | canal_real | tipo_real
receita_paga | receita_organica | receita_crm | receita_outros_canais
receita_sem_match_atribuicao | pedidos_pagos | pedidos_organicos
pedidos_crm | pedidos_outros_canais | pedidos_sem_match_atribuicao
flags_qualidade | fonte
```

### Regra canônica de venda SSOT

A camada nova de vendas por lançamento usa `reise-ssot.mart_shared.fct_order_item` como fonte preferencial. O filtro de pedido válido é `i.is_valid_order = TRUE` e a contagem de pedidos é sempre `COUNT(DISTINCT order_sk)`.

O pacote público não deve carregar identificadores brutos de pedido. `source_order_id`, `order_name` e `atribuicao_match_key` podem existir apenas como campos operacionais temporários durante a query/exportação e são removidos antes de gravar `lancamentos_produtos_dia.json`. A atribuição real de canal vem da mirror `mart_shared.canal_atribuicao_pedido_mirror`, que pode usar `source_order_id` internamente sem expor esse identificador no JSON público.

O campo `receita` permanece no JSON por compatibilidade com o frontend, mas representa `receita_bruta`. No dashboard, ranking, curvas, composição por cor/tamanho e comparativos executivos devem usar `receita_bruta`/`receita`. `receita_liquida` é campo auxiliar para auditoria e análise financeira, não a base visual principal.

```txt
receita_bruta = line_gross_amount
desconto = IFNULL(line_discount_amount, 0)
receita_liquida = line_gross_amount - desconto
ticket = receita_bruta / pedidos_validos
preco_medio_par = receita_bruta / pares
```

Receita de mídia/CRM não substitui receita SSOT do lançamento. Planilhas externas entram como contexto comercial e investimento declarado; ROAS/CPA só aparecem como performance quando a linha traz atribuição real ou métrica informada de forma confiável.

No launch dashboard, o rótulo técnico é sempre `CPA` (`investimento / pedidos`). Não use `CPS` no código ou no JSON deste dashboard, porque no roadmap do SSOT geral `CPS` significa custo por sessão.

### Regra canônica de RPS

A análise de ritmo/share semanal foi substituída por **RPS (Receita por Sessão)** no gráfico principal de evolução. O cálculo usa apenas:

- Receita: `reise-ssot.mart_growth_us.bridge_orders_customers`
- Sessões: `reise-ssot.mart_growth_us.shopify_sessions_daily`

```txt
RPS = receita_total / sessoes
receita_total = soma de total_amount por paid_date_brt, deduplicada por order_name
sessoes = ultima versao diaria de shopify_sessions_daily por data, usando ingest_ts
```

Essa leitura não usa GA4, tabelas de marketing, campanhas ou atribuição. O JSON público esperado é `data/lancamentos_rps_dia.json`; ausência de sessões fica pendente e não vira zero. Quando há sessões e não há pedido válido no dia, a receita do dia pode ser 0.

Para reduzir ruído sem perder fidelidade, o gráfico separa tendência visual de diagnóstico:

```txt
RPS MM7 = receita_total dos ultimos 7 dias / sessoes dos ultimos 7 dias
RPS fixo da fase = soma(receita da fase) / soma(sessoes da fase)
Referencia RPS = RPS fixo da propria linha/produto na janela comparavel
Retencao de RPS = RPS fixo da fase atual / RPS D0-D30
Indice de esforco = esforco diario da fase / esforco diario D0-D30
Desacoplamento = indice RPS - indice de esforco
```

O RPS diário continua disponível como detalhe de auditoria no tooltip e a curva MM7 permanece no gráfico para mostrar tendência. A leitura de retenção usa RPS fixo ponderado por sessões, sempre calculado por `soma(receita) / soma(sessoes)`. A mediana geral do grupo não é usada como referência padrão porque cada linha tem ticket próprio.

Quando houver 2 ou mais lançamentos da mesma linha, a referência usa mediana e faixa P25-P75 do RPS fixo dessa mesma linha na janela comparável. Quando não houver par real da mesma linha, a referência usa a fase anterior do próprio produto; na fase inicial, o status fica como base inicial até existir uma fase anterior comparável.

Os percentuais de `90%` e `75%` no gráfico são guias visuais provisórios, derivados como aproximação inicial do guia de RPS. Eles ajudam a enxergar distância proporcional da referência, mas ainda não são cortes estatísticos validados pela Reise; antes de virarem classificação oficial, devem ser recalibrados com histórico de lançamentos.

No gráfico, a referência é desenhada em degraus e o fundo marca as fases comerciais (`D0-D30`, `D31-D90`, `D91-D180`, `D181+`). A leitura principal fica no próprio gráfico: a curva vermelha mostra RPS MM7, a linha de 100% mostra a referência fixa da fase, e as linhas de 90% e 75% funcionam apenas como guias visuais auxiliares. Assim, a referência fica visualmente clara como fixa dentro de cada fase, não como média móvel.

O bloco de autosustentação fica separado da retenção de RPS. Ele compara `Indice RPS` e `Indice de esforco` em base 100, usando D0-D30 como base. O esforço inicial é calculado com investimento declarado em `midia_paga.json` e `crm_disparos.json`, normalizado por dia de fase. A regra inicial usa `RPS_RETENCAO_FORTE = 0,90`, `QUEDA_ESFORCO_MINIMA = 0,30` e `PERIODO_MINIMO_SUSTENTACAO = 1`; esses parâmetros são ajustáveis e não representam calibração estatística universal.

Autosustentação só é classificada quando existe RPS e esforço comparáveis depois da fase base. Se faltar esforço posterior, o painel fica como `Em formação` em vez de assumir investimento zero. A decomposição `Receita = Sessões x RPS` permanece visível para separar queda de exposição de queda de performance, e a observação sobre mix de tráfego foi mantida porque variações no RPS total podem vir de mudança de origem de tráfego.

### Regra canônica de classificação de SKU/produto

A classificação usada por vendas, auditoria Monochrome e estoque fica centralizada na CTE `itens_classificados_v1` em `apps_script/ExportLaunchAnalysis.gs`.

Para `modelo_id IN ('rs8_monochrome', 'series_2', 'phantom', 'gt', 'avant')`, o match é uma regra fixa de SKU/nome/cor com prioridade:

```txt
rs8_monochrome > series_2 > phantom > gt > avant > cadastro_generico
```

Nesses modelos, os campos `sku_prefixos` e `termos_busca` de `data/lancamentos_modelos.json` são cadastro descritivo e apoio operacional; eles não controlam sozinhos o match efetivo. Alterar a regra de match de `rs8_monochrome`, `series_2`, `phantom`, `gt` ou `avant` exige editar a CTE `itens_classificados_v1`, e portar a mesma regra para `reise-ssot.mart_shared.produto_lancamento_v` quando a regra tiver impacto no catálogo canônico.

`series_2` é um recorte do RS8 Avant relançado em cores específicas. O exportador classifica como Series 2 apenas itens RS8 Avant/Series 2 com cor Whisky, Off White ou Azul Marinho; esses itens entram antes do Avant comum e abrem sub-modelos `series2_whisky`, `series2_off_white` e `series2_azul_marinho`.

Para modelos fora dessa lista fixa, o match genérico continua usando `sku_prefixos` e `termos_busca` do JSON.

### Regra de clientes novos/recorrentes

No pipeline de vendas (`lancamentos_produtos_dia.json`), `novos` e `recorrentes` são classificados no BigQuery a partir de uma `customer_key` segura:

- usa `customer_sk` quando existir no item válido do SSOT;
- senão usa `customer_email` normalizado quando existir e parecer válido;
- senão usa telefone normalizado apenas quando tiver entre 8 e 15 dígitos;
- se nenhuma chave for confiável, mantém `novos` e `recorrentes` como `null`.

A primeira compra válida daquela `customer_key` no histórico completo de `fct_order_item`, até o fim da janela exportada, define a classificação:

- `novo`: não existe compra válida anterior ao pedido;
- `recorrente`: existe compra válida anterior ao pedido;
- `null`: pedido sem `customer_key` confiável.

Para evitar dupla contagem em pedidos com mais de uma linha/SKU, a contagem de cliente é gravada em apenas uma linha por `modelo_id + order_sk`. As demais linhas do mesmo pedido permanecem `null` em `novos` e `recorrentes`; ausência não vira zero.

Como a camada canônica usa `fct_order_item` já filtrada por `i.is_valid_order = TRUE`, a regra de validade de pedido fica concentrada no SSOT e não depende de joins auxiliares no frontend.

O Monochrome usa a mesma CTE canônica `itens_classificados_v1` na auditoria baseada em `reise-ssot.core.order_item + core.order`. A auditoria também respeita a mesma janela do export principal: D0 até D+90.

O manifest compara `lancamentos_produtos_dia.json` contra `auditoria_monochrome.json`. Se a diferença de pedidos, pares ou receita passar de 1%, o status vira `divergente` e o manifest recebe alerta.

## RS8 Avant Monochrome

Cadastro atual:

| Campo | Valor |
| --- | --- |
| `modelo_id` | `rs8_monochrome` |
| Modelo | RS8 Avant Monochrome |
| Linha | RS8 Avant Monochrome |
| Status | `ativo` |
| D0 | `2026-06-25` |
| Termos | `Monochrome|RS8 Monochrome|RS8 Avant Monochrome` |
| Prefixos SKU | `RS8-AVANT-MONO,RS8-MONO,RS8AVANTMONO` |

O dashboard deve puxar vendas desde `2026-06-25`. Se aparecer sem dados, revisar BigQuery, termos, prefixos de SKU e exportação do Apps Script antes de culpar o front.

## Investimento e Canais

A planilha diaria foi descontinuada da analise de investimento. A fonte manual volta a ser a planilha `Reise Launch Analysis v2` (`1dlCRxvViAL1gG4Y4pBfhnH_EK-HQdcyGBAwd0vTfV68`), com as abas `midia_paga` e `crm_disparos`.

O investimento usado no dashboard é a soma de `midia_paga.json` + `crm_disparos.json`. A analise executiva não separa mídia paga e CRM; as abas seguem apenas como rastreio operacional da planilha.

`metas_mensais.json` ainda pode carregar metas e faturamento da empresa como contexto, mas esse dado não substitui a planilha principal de investimento e não é rateado por produto.

No export BigQuery, `metas_mensais.json` gera um calendário de apoio cobrindo os D0 exportáveis até D+90. Isso mantém Avant e GT dentro do recorte diário de canais mesmo sem meta diária cadastrada em dez/2025-jan/2026; a atribuição executiva do produto continua vindo dos pedidos classificados em `lancamentos_produtos_dia.json`.

ROAS de investimento = `receita_paga / investimento total`. CPA de investimento = `investimento total / pedidos_pagos`. Receita e pedidos pagos representam pedidos com sinal de anuncio (`cpc`, `pmax`, `paid`, `demand-gen`, `performance`, `ads`, `display`, `source_type` pago etc.). `receita_organica`/`pedidos_organicos` representam apenas busca/social/SEO organico. Direto, E-mail/CRM, WhatsApp, outros atribuidos e nao atribuidos ficam nas colunas de controle, nao dentro de organico. Se a atribuicao real por pedido nao vier no payload, ROAS/CPA ficam vazios.

Para exportar essas abas, configure:

```txt
INVESTMENT_SPREADSHEET_ID
```

Colunas aceitas para `midia_paga`:

```txt
modelo_id | campanha | canal | data_inicio | data_fim | janela | investimento
receita_atribuida | pedidos | roas | cpa | observacao | status
```

Colunas aceitas para `crm_disparos`:

```txt
modelo_id | modelo | data_disparo | campanha | canal | investimento
receita_linha | receita_dia | pedidos | roas | cpa | observacao | status
```

Regras:

- `campanha` é obrigatório.
- `investimento` deve ser o valor real declarado na planilha principal por campanha/janela.
- `roas` deve vir informado na planilha em escala de multiplicador (`6,48` = `6,48x`) sempre que houver atribuição real.
- Se `roas` vier como percentual/texto (`647,8%`) ou como número acima de `100`, o exportador/front normalizam por `/100` para evitar confusão de escala percentual vs. multiplicador.
- `receita_atribuida`, `receita_linha` e `receita_dia` são contexto operacional e não substituem a atribuição real por pedido.
- Quando `midia_paga` repetir a mesma `receita_atribuida` em canais diferentes do mesmo modelo/janela, o dashboard bloqueia ROAS/CPA por canal e mostra apenas uma leitura agregada da janela.
- Quando houver investimento sem atribuição real por pedido, ROAS/CPA de investimento permanecem vazios. O comparativo não usa faturamento total do pipeline como substituto.
- Para CRM, correlação, `receita_dia` e `receita_linha` ficam como contexto operacional. No resumo executivo, CRM entra apenas no investimento total; performance vem de `receita_crm`/`pedidos_crm` quando houver atribuição real por pedido.
- `janela` pode ser preenchida manualmente.
- Se `janela` vier vazia, o Apps Script calcula pela relação entre `data_inicio`/`data_fim` e o D0 do modelo.
- Se a planilha não estiver configurada, o exportador não apaga os arquivos atuais.

Auditoria local:

```bash
node scripts/auditar_investimento.js
```

Esse script resume cobertura de `metas_mensais`, investimento de aquisição, planilhas manuais e pendências como campanhas sem receita atribuída.

### Atribuição paga versus orgânica

O fluxo operacional atual publica uma leitura de aquisicao pura: **midia paga** e **organico** como colunas principais, com controles separados para Direto, E-mail/CRM, WhatsApp, outros atribuidos e nao atribuidos. `exportarTudo()` sincroniza a origem/UTM existente no BigQuery (`mart_growth_us.shopify__orders_journey_latest_v`) para `mart_shared.canal_atribuicao_pedido_mirror`, classifica cada pedido e preserva o tipo no payload de vendas.

Essa camada separa **venda atribuida por pedido** de **investimento**:

O export nao exige backfill manual. Ele consulta a origem ja existente no job `US`, grava a mirror em `southamerica-east1` e cruza pedidos apenas por `source_order_id`/`order_id` ou `order_name`. A classificacao vem de `shopify__orders_journey_latest_v`: sinais de anuncio (`cpc`, `pmax`, `paid`, `demand-gen`, `performance` etc.) entram em midia paga; sinais organicos de busca/social/SEO entram em organico; direto, e-mail/CRM, WhatsApp, outros e nao atribuidos ficam fora dessas duas colunas principais.

- O export de produtos nao deve usar alocacao diaria/de janela (`shopify_*_allocated`) nem cruzamento por email+data+valor para preencher pedidos pagos ou organicos. Pedido pago/organico precisa ser inteiro e vir da classificacao por pedido.
- A conciliacao exibida no dashboard nao deve mais forcar `pago + organico = total`; a diferenca esperada fica nas colunas de controle. A auditoria `scripts/auditar_atribuicao_exportado.js` mostra separadamente o metodo usado e a cobertura de origem granular.
- Quando a mirror tiver match, ela vence qualquer fallback de origem do pedido. A ordem da regra importa: sinais pagos sao testados antes de sinais organicos; depois entram Direto, E-mail/CRM, WhatsApp, Organico, Outro atribuido ou Nao atribuido.
- Investimento continua vindo de `metas_mensais.json` ou dos cadastros manuais de mídia/CRM. Ele nao e deduzido a partir dos pedidos.
- ROAS de investimento so deve ser tratado como atribuicao quando existir custo declarado e pedidos/receita classificados como vindos de investimento no payload de vendas. Caso contrario, investimento e contexto, nao prova de causalidade.
- As abas manuais de midia paga e CRM nao recebem campanhas extras. Elas alimentam investimento total; vendas nao declaradas aparecem apenas no resumo agregado por canal do lancamento.

Rollback operacional:

```txt
ATRIBUICAO_REAL_CANAL_ENABLED=false
```

Com essa Script Property, `exportarTudo()` volta ao comportamento sem atribuicao real, mantendo `receita_paga`/`receita_organica`/`receita_crm` como `null`.

Auditoria local depois de exportar:

```bash
node scripts/auditar_atribuicao_canal.js
```

Auditoria BigQuery para investigar origem dos pedidos antes/depois da exportacao:

```sql
sql/diagnostico_origem_pedidos_bigquery.sql
```

### Backfill historico do last click

O backfill de `CustomerJourneySummary.gs` e opcional e nao e necessario para a leitura simples de pedidos pagos vs organicos com a base ja disponivel. Use apenas se a decisao futura for reconstruir historico antigo de jornada Shopify que ainda nao esteja carregado no BigQuery.

```txt
CJ_startLaunchHistoryBackfill
```

O helper percorre `2025-12-14` a `2026-03-17` em blocos de sete dias, agenda a continuacao a cada dez minutos e remove o proprio trigger ao concluir. Consulte o andamento com `CJ_launchHistoryBackfillStatus`. Depois da conclusao, execute `exportarTudo()` novamente no projeto do dashboard.

Para comparar contra um arquivo anterior:

```bash
node scripts/auditar_atribuicao_canal.js --baseline data/lancamentos_produtos_dia.before.json
```

## Como Rodar Localmente

Como o dashboard lê JSON via `fetch`, use um servidor local:

```bash
cd reise-launch-dashboard-v2
python3 -m http.server 8000
```

Acesse:

```txt
http://localhost:8000
```

No Windows, também funciona:

```powershell
python -m http.server 8000
```

## Como Atualizar Dados

Fluxo normal:

1. Ajustar `data/lancamentos_modelos.json` quando houver novo lançamento, D0 ou termos.
2. Rodar `exportarTudo()` no Apps Script.
3. Conferir `data/manifest.json` e `data_quality` quando houver auditoria.
4. Se os dados foram editados localmente ou vieram de exportador antigo, rodar `node scripts\sanitizar_public_data.js`.
5. Rodar `node scripts\auditar_pacote_publico.js`.
6. Rodar `node scripts\auditar_atribuicao_exportado.js data\lancamentos_produtos_dia.json`.
7. Subir o commit gerado no GitHub.
8. Publicar ou aguardar deploy da Vercel e validar a URL de produção com cache-buster.

Para recalcular GT/Avant:

1. Rodar `sql/auditoria_lancamentos_ssot.sql` no BigQuery com `modelo_filtro = 'gt'` ou `modelo_filtro = 'avant'`.
2. Comparar D0, pedidos, pares, receita, ticket e origem por janela.
3. Atualizar `data/lancamentos_historico.json`.
4. Sincronizar `assets/embedded-data.js`.
5. Documentar alterações no README quando a regra mudar.

Para auditar todos os modelos exportáveis:

1. Rodar `sql/auditoria_lancamentos_ssot.sql` em `southamerica-east1`.
2. Conferir `resumo_janelas`, `diario_acumulado`, `por_sku`, `duplicidades`, `conflitos_classificacao` e `itens_nao_classificados`.
3. Comparar o JSON retornado com `data/lancamentos_produtos_dia.json` depois de `exportarTudo()`.

Para auditar Monochrome:

1. Rodar `auditarVendasMonochrome()` ou `exportarTudo()`.
2. Conferir `auditoria_monochrome.json`.
3. Conferir `manifest.data_quality.rs8_monochrome`.
4. Investigar qualquer status `divergente`.

## Deploy

O projeto é estático.

Configuração Vercel:

```txt
Framework preset: Other
Build command: vazio
Output directory: . ou vazio
```

Deploy manual:

```bash
npx vercel deploy --prod --yes
```

Alias de produção:

```txt
https://launch-analysis-v2.vercel.app
```

## Comparativos no Front

O dashboard mostra:

- estado do lançamento selecionado;
- comparativo por janelas fixas;
- comparativo D+n real;
- ranking de lançamentos;
- curva normalizada D0 até D+90;
- mix de cores;
- estoque;
- sazonalidade e calendário;
- ações sugeridas;
- projeção de 90 dias.

O painel recolhivel **Apoio de leitura** mostra metodologia executiva, alertas de leitura e estoque de apoio sem duplicar a leitura executiva. Ele reforca que toda comparacao usa `day_zero_base`, janelas fixas por idade de venda, receita bruta do SSOT, meta total mensal e ausencia preservada como vazio.

## Pendências Conhecidas

- `novos` e `recorrentes` do pipeline exportável ficam `null` somente quando não houver `customer_key` confiável.
- `novos_pct` de GT/Avant está `null` nos benchmarks recalculados.
- Mix por cor de GT/Avant ainda precisa de auditoria SSOT própria antes de uso decisório.
- `estoque.json` é classificado pela CTE canônica de SKU/produto; se voltar vazio, investigar primeiro a ingestão de `mart_shared.inventory_sku_current` e o mapa `stg.shopify_inventory_item_map_latest`.
- `midia_paga.json` e `crm_disparos.json` são atualizados pela planilha principal quando `INVESTMENT_SPREADSHEET_ID` ou o fallback `MIDIA_SPREADSHEET_ID` estiver disponível.

## Regras Preservadas

- D0 é inclusivo.
- Ausência de dado não vira zero.
- Dados manuais opcionais não são apagados quando a fonte opcional não está configurada.
- Novos lançamentos entram via `data/lancamentos_modelos.json`, sem alteração no front.
- Cores dos modelos são fixas no mapa `CORES_MODELO`; Chart.js não escolhe cores automaticamente.
