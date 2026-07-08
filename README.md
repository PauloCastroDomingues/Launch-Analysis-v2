# Reise Launch Analysis v2

Dashboard estático para análise de lançamentos da Reise.

Produção: https://launch-analysis-v2.vercel.app

O app roda na Vercel, lê JSONs versionados em `/data` via `fetch` e não depende de backend em runtime. A atualização operacional vem do BigQuery/SSOT pelo Apps Script, que grava os JSONs no GitHub. A planilha é opcional e serve apenas para mídia paga e CRM manual.

## Estado Atual

Snapshot versionado em `data/manifest.json`:

| Item | Status |
| --- | --- |
| Última geração | `2026-07-08T15:42:10-03:00` |
| Modelo ativo | `rs8_monochrome` |
| Linhas em `lancamentos_produtos_dia.json` | `324` |
| Auditoria Monochrome | `ok` |
| Estoque | exportado, `0` linhas |
| Mídia paga | `skipped` sem `MIDIA_SPREADSHEET_ID` |
| CRM | `skipped` sem `MIDIA_SPREADSHEET_ID` |

Auditoria atual do RS8 Avant Monochrome:

| Métrica | Valor |
| --- | ---: |
| Pedidos auditados | 253 |
| Pares auditados | 324 |
| Receita auditada | 232956 |
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
| `data/lancamentos_produtos_dia.json` | Vendas reais por item/dia do lançamento ativo. |
| `data/auditoria_monochrome.json` | Auditoria independente do Monochrome. |
| `data/manifest.json` | Snapshot da última exportação e `data_quality`. |
| `sql/auditoria_historico_gt_avant.sql` | Auditoria correta para GT e Avant. |
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
- `day_zero_base` é o D0 analítico usado pelo dashboard.
- Modelos exportáveis pelo Apps Script precisam estar com `status = ativo` e `day_zero_base` válido.
- Histórico (`status = historico`) entra como benchmark estático em `lancamentos_historico.json`.
- Lançamento futuro entra como `status = planejado` em `lancamentos_modelos.json`.
- Rodar queries em `southamerica-east1`.
- Não criar views ou tabelas no BigQuery para este dashboard.

## Pipeline de Vendas Ativo

Para o lançamento ativo, o Apps Script usa `consultarProdutosDia_()` e grava `data/lancamentos_produtos_dia.json`.

Saída esperada por linha:

```txt
modelo_id | data | source_order_id | origem | sku | nome_produto | variant_title
sub_modelo | cor | tamanho | pedidos | pares | receita | novos | recorrentes
match_text_norm | modelo_id_detectado
```

O Monochrome usa uma regra especial de auditoria baseada em `reise-ssot.core.order_item + core.order`, com match por:

- `item_name` normalizado contendo `monochrome`;
- ou SKU iniciado por `rs8 avant mono`, `rs8 mono` ou `rs8avantmono`.

O manifest compara `lancamentos_produtos_dia.json` contra `auditoria_monochrome.json`. Se a diferença de pedidos, pares ou receita passar de 1%, o status vira `divergente` e o manifest recebe alerta.

## RS8 Avant Monochrome

Cadastro atual:

| Campo | Valor |
| --- | --- |
| `modelo_id` | `rs8_monochrome` |
| Modelo | RS8 Avant Monochrome |
| Status | `ativo` |
| D0 | `2026-06-25` |
| Termos | `Monochrome|RS8 Monochrome|RS8 Avant Monochrome` |
| Prefixos SKU | `RS8-AVANT-MONO,RS8-MONO,RS8AVANTMONO` |

O dashboard deve puxar vendas desde `2026-06-25`. Se aparecer sem dados, revisar BigQuery, termos, prefixos de SKU e exportação do Apps Script antes de culpar o front.

## Mídia Paga e CRM

A mídia paga é preenchida manualmente na aba `midia_paga` de uma planilha opcional. CRM manual usa a aba `crm_disparos`.

Para exportar essas abas, configure:

```txt
MIDIA_SPREADSHEET_ID
```

Colunas aceitas para `midia_paga`:

```txt
modelo_id | campanha | canal | data_inicio | data_fim | janela | investimento
receita_atribuida | pedidos | roas | cpa | observacao | status
```

Regras:

- `campanha` é obrigatório.
- `investimento` deve ser o valor real informado por campanha.
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

1. Rodar `sql/auditoria_historico_gt_avant.sql` no BigQuery.
2. Comparar D0, pedidos, pares, receita, ticket e origem por janela.
3. Atualizar `data/lancamentos_historico.json`.
4. Sincronizar `assets/embedded-data.js`.
5. Documentar alterações no README quando a regra mudar.

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

- `novos` e `recorrentes` ainda ficam `null` quando não houver auditoria segura.
- `novos_pct` de GT/Avant está `null` nos benchmarks recalculados.
- Mix por cor de GT/Avant ainda precisa de auditoria SSOT própria antes de uso decisório.
- `estoque.json` está exportado, mas o snapshot atual tem `0` linhas.
- `midia_paga.json` e `crm_disparos.json` só são atualizados quando `MIDIA_SPREADSHEET_ID` estiver configurado.

## Regras Preservadas

- D0 é inclusivo.
- Ausência de dado não vira zero.
- Dados manuais opcionais não são apagados quando a fonte opcional não está configurada.
- Novos lançamentos entram via `data/lancamentos_modelos.json`, sem alteração no front.
- Cores dos modelos são fixas no mapa `CORES_MODELO`; Chart.js não escolhe cores automaticamente.
