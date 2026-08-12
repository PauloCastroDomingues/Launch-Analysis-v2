# Auditoria de Amostragem de Lancamentos

Gerado em: 2026-08-12T13:25:50.190Z
Snapshot base: 2026-08-11

## Leitura executiva

- Modelos auditados: 5
- Janelas auditadas: 25
- Janelas que precisam revisar algum ponto: 0
- Janelas sem canal de pedido no BigQuery local: 0
- Janelas em que atribuido + organico fecha com faturamento: 25
- Janelas em que pedidos atribuidos + organicos fecham com pedidos totais: 25

## Amostra por janela

| Modelo | Janela | Status | Pedidos | Pares | Faturamento | Investimento | Midia paga | Ped. midia | Organico | Ped. org. | ROAS | Origem canal | Checks |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |
| GT Collection | 7d | fechada | 115 | 133 | R$ 103.341 | R$ 1.049 | R$ 96.507 | 107 | R$ 6.834 | 8 | - | canal_pedido | ok |
| GT Collection | 15d | fechada | 167 | 190 | R$ 147.574 | R$ 3.847 | R$ 135.056 | 152 | R$ 12.518 | 15 | 35,11x | canal_pedido | ok |
| GT Collection | 30d | fechada | 272 | 339 | R$ 263.347 | R$ 5.609 | R$ 238.986 | 245 | R$ 24.361 | 27 | 42,61x | canal_pedido | ok |
| GT Collection | 60d | fechada | 525 | 678 | R$ 522.830 | R$ 14.417 | R$ 463.472 | 460 | R$ 59.358 | 65 | 32,15x | canal_pedido | ok |
| GT Collection | 90d | fechada | 903 | 1.151 | R$ 888.175 | R$ 40.237 | R$ 665.586 | 671 | R$ 222.589 | 232 | 16,54x | canal_pedido | ok |
| Avant | 7d | fechada | 172 | 209 | R$ 110.618 | R$ 1.277 | R$ 102.601 | 159 | R$ 8.017 | 13 | - | canal_pedido | ok |
| Avant | 15d | fechada | 315 | 375 | R$ 199.224 | R$ 22.187 | R$ 184.217 | 290 | R$ 15.007 | 25 | 8,3x | canal_pedido | ok |
| Avant | 30d | fechada | 536 | 720 | R$ 383.922 | R$ 50.739 | R$ 351.890 | 495 | R$ 32.032 | 41 | 6,94x | canal_pedido | ok |
| Avant | 60d | fechada | 1.460 | 1.894 | R$ 1.023.250 | R$ 106.725 | R$ 928.463 | 1.327 | R$ 94.787 | 133 | 8,7x | canal_pedido | ok |
| Avant | 90d | fechada | 2.790 | 3.692 | R$ 2.072.894 | R$ 230.711 | R$ 1.593.519 | 2.159 | R$ 479.375 | 631 | 6,91x | canal_pedido | ok |
| Phantom | 7d | fechada | 144 | 182 | R$ 130.858 | R$ 4.440 | R$ 48.801 | 46 | R$ 82.057 | 98 | 10,99x | canal_pedido | ok |
| Phantom | 15d | fechada | 244 | 316 | R$ 227.204 | R$ 14.192 | R$ 86.908 | 83 | R$ 140.296 | 161 | 6,12x | canal_pedido | ok |
| Phantom | 30d | fechada | 434 | 580 | R$ 417.020 | R$ 204.803 | R$ 128.251 | 122 | R$ 288.769 | 312 | 0,63x | canal_pedido | ok |
| Phantom | 60d | fechada | 932 | 1.223 | R$ 879.337 | R$ 36.803 | R$ 229.853 | 237 | R$ 649.485 | 695 | 6,25x | canal_pedido | ok |
| Phantom | 90d | fechada | 1.294 | 1.697 | R$ 1.220.143 | R$ 51.362 | R$ 331.590 | 347 | R$ 888.553 | 947 | 6,46x | canal_pedido | ok |
| RS8 Avant Monochrome | 7d | fechada | 167 | 212 | R$ 152.428 | R$ 2.111 | R$ 46.427 | 49 | R$ 106.001 | 118 | - | canal_pedido | ok |
| RS8 Avant Monochrome | 15d | fechada | 289 | 371 | R$ 266.749 | R$ 22.366 | R$ 81.486 | 91 | R$ 185.263 | 198 | 3,64x | canal_pedido | ok |
| RS8 Avant Monochrome | 30d | fechada | 485 | 644 | R$ 463.036 | R$ 43.933 | R$ 143.242 | 151 | R$ 319.794 | 334 | 3,26x | canal_pedido | ok |
| RS8 Avant Monochrome | 60d | parcial D+47 | 595 | 794 | R$ 570.886 | R$ 2.111 | R$ 184.454 | 183 | R$ 386.432 | 412 | - | canal_pedido | ok |
| RS8 Avant Monochrome | 90d | parcial D+47 | 595 | 794 | R$ 570.886 | R$ 2.111 | R$ 184.454 | 183 | R$ 386.432 | 412 | - | canal_pedido | ok |
| Series 2 | 7d | fechada | 102 | 115 | R$ 70.150 | R$ 7.401 | R$ 17.154 | 25 | R$ 52.996 | 77 | 2,32x | canal_pedido | ok |
| Series 2 | 15d | fechada | 133 | 149 | R$ 90.890 | R$ 16.918 | R$ 21.846 | 37 | R$ 69.044 | 96 | 1,29x | canal_pedido | ok |
| Series 2 | 30d | parcial D+26 | 186 | 207 | R$ 126.270 | R$ 469 | R$ 42.850 | 54 | R$ 83.420 | 132 | - | canal_pedido | ok |
| Series 2 | 60d | parcial D+26 | 186 | 207 | R$ 126.270 | R$ 469 | R$ 42.850 | 54 | R$ 83.420 | 132 | - | canal_pedido | ok |
| Series 2 | 90d | parcial D+26 | 186 | 207 | R$ 126.270 | R$ 469 | R$ 42.850 | 54 | R$ 83.420 | 132 | - | canal_pedido | ok |

## Regras usadas

- Faturamento, pedidos e pares: soma do `lancamentos_produtos_dia.json`, com pedidos distintos por `order_sk`.
- Investimento: soma das linhas por canal de `midia_paga.json` na janela exata selecionada, mais os disparos de `crm_disparos.json` ocorridos dentro da janela observada. Quando existe total e abertura por canal na mesma janela, prevalece a abertura por canal para evitar duplicidade.
- Atribuicao paga/organica: linhas granulares usam `canal_real`/`tipo_real`; linhas com regra `*_allocated` preservam os campos pagos e organicos calculados pelo SSOT, sem reclassificacao no frontend.
- Base antiga e base manual nao preenchem pedidos pagos/organicos nesta auditoria; elas ficam apenas como contexto de investimento/campanha.
- Pedidos pagos/organicos so aparecem quando a origem real do pedido vem do BigQuery. O relatorio nao estima pedidos por ticket medio nem por resto do faturamento.

## Pontos que ainda dependem de validacao externa

- Todas as janelas auditadas possuem classificacao paga/organica e conciliam o faturamento.
- A conciliacao valida o payload exportado; a cobertura historica de UTM/last-click ainda deve ser conferida na tabela de jornada Shopify.
