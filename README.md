# Reise Launch Analysis v2

Dashboard estático para análise de lançamentos da Reise.

Produção: https://launch-analysis-v2.vercel.app

O app roda na Vercel, lê JSONs versionados em `/data` via `fetch` e não depende de backend em runtime. A atualização operacional vem do BigQuery/SSOT pelo Apps Script, que grava os JSONs no GitHub. A planilha é opcional e serve apenas para mídia paga e CRM manual.

## Estado Atual

Snapshot versionado em `data/manifest.json`:

| Item | Status |
| --- | --- |
| Última geração | `2026-07-10T09:22:05-03:00` |
| Modelo ativo | `rs8_monochrome` |
| Linhas em `lancamentos_produtos_dia.json` | `359` |
| Auditoria Monochrome | `ok` |
| Estoque | exportado, `0` linhas |
| Mídia paga | exportado, `11` linhas |
| CRM | exportado, `23` linhas |

Auditoria atual do RS8 Avant Monochrome:

| Métrica | Valor |
| --- | ---: |
| Pedidos auditados | 281 |
| Pares auditados | 359 |
| Receita auditada | 258121 |
| Diferença pedidos/exportado | 0 |
| Diferença pares/exportado | 0 |
| Diferença receita/exportado | 0 |
| Linhas suspeitas | 0 |
| Duplicidades | 0 |

## Modelos

Os modelos ficam em `data/lancamentos_modelos.json`.

| modelo_id | Modelo | Status | D0 analítico | Observação |
| --- | --- | --- | --- | --- |
| `gt` | GT Collection | `historico` | `2025-12-17` | Histórico recalculado pelo SSOT com pedidos válidos. |
| `avant` | Avant | `historico` | `2025-12-14` | Histórico recalculado pelo SSOT com pedidos válidos. |
| `phantom` | Phantom | `historico` | `2026-04-16` | Histórico estático; 90d ainda não consolidado. |
| `rs8_monochrome` | RS8 Avant Monochrome | `ativo` | `2026-06-25` | Exportado pelo Apps Script/BigQuery. |
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
MIDIA_SPREADSHEET_ID
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

`exportarTudo()` não depende de planilha ativa. Sem `MIDIA_SPREADSHEET_ID`, ele mantém `midia_paga.json` e `crm_disparos.json` atuais e continua exportando vendas/estoque/manifest.

## Regras de Dados

- Dado ausente permanece `null` no JSON e aparece como `—` na interface.
- Nunca transformar ausência em `0`.
- Filtros de data usam inclusão do D0.
- O relógio analítico do front usa `manifest.generated_at`; se o manifest estiver ausente, usa a maior data de `lancamentos_produtos_dia.json` antes de cair na data do navegador.
- Janelas `7d`, `15d`, `30d`, `60d` e `90d` significam D+N inclusivo: D0 até D+N.
- `day_zero_base` é o D0 analítico usado pelo dashboard.
- Modelos exportáveis pelo Apps Script precisam estar com `status = historico` ou `status = ativo` e `day_zero_base` válido.
- Histórico (`status = historico`) também entra como benchmark estático em `lancamentos_historico.json`, mas pode ser reexportado no pipeline diário quando precisa de granularidade por pedido/item.
- Lançamento futuro entra como `status = planejado` em `lancamentos_modelos.json`.
- Rodar queries em `southamerica-east1`.
- Não criar views ou tabelas no BigQuery para este dashboard.

## Pipeline de Vendas por Modelo

Para modelos com `status = historico` ou `status = ativo`, o Apps Script usa `consultarProdutosDia_()` e grava `data/lancamentos_produtos_dia.json`.

Saída esperada por linha:

```txt
modelo_id | data | source_order_id | order_sk | origem | sku | nome_produto
variant_title | sub_modelo | cor | tamanho | pedidos | pedidos_validos | pares
receita | receita_bruta | desconto | receita_liquida | novos | recorrentes
match_text_norm | modelo_id_detectado | d0 | dia_desde_d0 | flags_qualidade | fonte
```

### Regra canônica de venda SSOT

A camada nova de vendas por lançamento usa `reise-ssot.mart_shared.fct_order_item` como fonte preferencial. O filtro de pedido válido é `i.is_valid_order = TRUE` e a contagem de pedidos é sempre `COUNT(DISTINCT order_sk)`.

O campo `receita` permanece no JSON por compatibilidade com o frontend, mas representa `receita_bruta`.

```txt
receita_bruta = line_gross_amount
desconto = IFNULL(line_discount_amount, 0)
receita_liquida = line_gross_amount - desconto
ticket = receita_bruta / pedidos_validos
preco_medio_par = receita_bruta / pares
```

Receita de mídia/CRM não substitui receita SSOT do lançamento. Planilhas externas entram apenas como contexto comercial, investimento, ROAS informado e CPA.

### Regra canônica de classificação de SKU/produto

A classificação usada por vendas, auditoria Monochrome e estoque fica centralizada na CTE `itens_classificados_v1` em `apps_script/ExportLaunchAnalysis.gs`.

Para `modelo_id IN ('rs8_monochrome', 'phantom', 'gt', 'avant')`, o match é uma regra fixa de SKU/nome com prioridade:

```txt
rs8_monochrome > phantom > gt > avant > cadastro_generico
```

Nesses quatro modelos, os campos `sku_prefixos` e `termos_busca` de `data/lancamentos_modelos.json` são cadastro descritivo e apoio operacional; eles não controlam sozinhos o match efetivo. Alterar a regra de match de `rs8_monochrome`, `phantom`, `gt` ou `avant` exige editar a CTE `itens_classificados_v1`, e portar a mesma regra para `reise-ssot.mart_shared.produto_lancamento_v` quando a regra tiver impacto no catálogo canônico.

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

## Mídia Paga e CRM

A mídia paga é preenchida manualmente na aba `midia_paga` de uma planilha opcional. CRM manual usa a aba `crm_disparos`.

Os campos de `investimento` vêm exclusivamente dessas abas da planilha configurada em `MIDIA_SPREADSHEET_ID`. O dashboard não busca gasto em Meta Ads, Google Ads ou BigQuery e não recalcula investimento automaticamente.

Para exportar essas abas, configure:

```txt
MIDIA_SPREADSHEET_ID
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
- `investimento` deve ser o valor real informado por campanha.
- `roas` deve vir informado na planilha em escala de multiplicador (`6,48` = `6,48x`) sempre que houver atribuição real.
- Se `roas` vier como percentual/texto (`647,8%`) ou como número acima de `100`, o exportador/front normalizam por `/100` para evitar confusão de escala percentual vs. multiplicador.
- `receita_atribuida`, `receita_linha` e `receita_dia` são contexto/atribuição cadastrada e não substituem o campo `roas`.
- Quando `midia_paga` trouxer investimento, mas não trouxer `receita_atribuida`, `pedidos`, `roas` ou `cpa`, o dashboard calcula uma leitura estimada da janela do modelo e marca a origem como `modelo_rateado`. Isso não é atribuição real por canal.
- Para CRM, se `roas` estiver vazio, o dashboard calcula `receita_base / investimento` usando `receita_dia` ou `receita_linha`.
- `janela` pode ser preenchida manualmente.
- Se `janela` vier vazia, o Apps Script calcula pela relação entre `data_inicio`/`data_fim` e o D0 do modelo.
- Se a planilha não estiver configurada, o exportador não apaga os arquivos atuais.

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
3. Conferir `data/manifest.json`.
4. Verificar `data_quality` quando houver auditoria.
5. Subir o commit gerado no GitHub.
6. Publicar ou aguardar deploy da Vercel.

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

O bloco de metodologia mostra `Data oficial`, `Day zero usado`, `Primeira venda encontrada` e `Gap base`.

## Pendências Conhecidas

- `novos` e `recorrentes` do pipeline exportável ficam `null` somente quando não houver `customer_key` confiável.
- `novos_pct` de GT/Avant está `null` nos benchmarks recalculados.
- Mix por cor de GT/Avant ainda precisa de auditoria SSOT própria antes de uso decisório.
- `estoque.json` é classificado pela CTE canônica de SKU/produto; se voltar vazio, investigar primeiro a ingestão de `mart_shared.inventory_sku_current` e o mapa `stg.shopify_inventory_item_map_latest`.
- `midia_paga.json` e `crm_disparos.json` só são atualizados quando `MIDIA_SPREADSHEET_ID` estiver configurado.

## Regras Preservadas

- D0 é inclusivo.
- Ausência de dado não vira zero.
- Dados manuais opcionais não são apagados quando a fonte opcional não está configurada.
- Novos lançamentos entram via `data/lancamentos_modelos.json`, sem alteração no front.
- Cores dos modelos são fixas no mapa `CORES_MODELO`; Chart.js não escolhe cores automaticamente.
