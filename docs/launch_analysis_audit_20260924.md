# Auditoria de dados, metodos e visoes de lancamentos

- Contrato: `20260925-analysis-contract-v2`
- Snapshot analisado: `2026-09-25T13:37:33-03:00`
- Gerado em: `2026-09-25T16:50:40.835Z`
- Escopo: dados e dashboard local; sem publicacao e sem alterar fontes canonicas.

## Matriz principal

| Pergunta | Dado disponivel | Regra existente | Problema | Correcao aplicada | Dado faltante | Visao |
|---|---|---|---|---|---|---|
| Desempenho por idade | itens, rampa e submodelos | acumulados D+ | mistura tamanho e ritmo; fases sobrepostas | fases nao sobrepostas, dias cobertos e pares/receita por dia | historico anterior ao D0 de GT/Avant | Desempenho |
| Estabilidade | rampa por dia | pico global + duas variacoes de 10% | usa pico futuro, zeros implicitos e nao testa persistencia | detector operacional sem futuro, volume minimo, holdout e sensibilidade | disponibilidade e apoio historicos | Estabilidade |
| Expectativa | vendas e datas D0 | multiplicador ate D90 | referencias truncadas e sem backtest temporal | referencias elegiveis por calendario, execucoes salvas e erro | brief pre-D0 e mais lancamentos independentes | Expectativa |
| Condicoes | midia, CRM, estoque atual e RPS loja | leitura conjunta | cobertura desigual e risco causal | fontes separadas, status e bloqueios explicitos | gasto diario, acoes, oferta e estoque historico | Condicoes |

## Cadastro e comparabilidade

| Lancamento | D0 oficial | D0 analitico | Primeiro pedido | Status D0 | Uso |
|---|---:|---:|---:|---|---|
| GT Collection | 2024-10-18 | 2025-12-17 | 2025-12-17 | provisorio_historico_truncado | descritivo_apenas |
| Avant | 2025-10-02 | 2025-12-14 | 2025-12-14 | provisorio_historico_truncado | descritivo_apenas |
| Phantom | 2026-04-16 | 2026-04-16 | 2026-04-16 | confirmado_no_pacote | comparavel |
| RS8 Avant Monochrome | 2026-06-25 | 2026-06-25 | 2026-06-25 | confirmado_no_pacote | comparavel |
| Series 2 | 2026-07-16 | 2026-07-16 | 2026-07-16 | confirmado_no_pacote | comparavel |
| Lançamento Dia dos Pais | 2026-08-10 | 2026-08-10 | - | planejado_vencido_sem_realizado | nao_realizado |

## Qualidade que muda a leitura

- Chaves repetidas modelo+data+pedido+SKU: **371**. Nao foram removidas.
- GT: 101; Avant: 270.
- Atribuicao: sem divergencia de rotulo identificada.
- Ausencia de linha diaria vira zero somente dentro da cobertura confirmada pelo manifesto.

## Fontes

| Arquivo | Grao | Linhas | Periodo observado | Status |
|---|---|---:|---|---|
| data/manifest.json | objeto | - | 2026-09-25 a 2026-09-25 | utilizavel |
| data/lancamentos_modelos.json | lancamento | 6 | 2024-10-18 a 2026-08-10 | requer_validacao |
| data/lancamentos_produtos_dia.json | item de pedido | 9055 | 2025-12-14 a 2026-09-25 | requer_validacao |
| data/lancamentos_rampa_dia.json | lancamento-dia com movimento | 897 | 2025-12-14 a 2026-09-25 | utilizavel |
| data/sub_modelos_dia.json | submodelo-dia | 2554 | 2025-12-14 a 2026-09-25 | utilizavel |
| data/lancamentos_analise_avancada.json | lancamento-janela | 6 | 2026-09-25 a 2026-09-25 | requer_validacao |
| data/lancamentos_clientes_janelas.json | lancamento-janela | 30 | 2026-09-25 a 2026-09-25 | utilizavel |
| data/lancamentos_completude_d0.json | lancamento | 5 | 2026-09-25 a 2026-09-25 | requer_validacao |
| data/share_trajetoria.json | lancamento-dia | 892 | 2026-09-25 a 2026-09-25 | requer_validacao |
| data/calendario_br.json | evento de calendario | 13 | 2025-03-03 a 2026-12-25 | incompleta |
| data/midia_paga.json | campanha ou total declarado | 22 | 2026-04-16 a 2027-04-30 | requer_validacao |
| data/crm_disparos.json | acao declarada | 25 | 2025-06-23 a 2026-07-22 | incompleta |
| data/estoque.json | SKU/variacao atual | 443 | - a - | incompleta |
| data/lancamentos_rps_dia.json | loja-dia repetido por lancamento | 897 | 2026-09-25 a 2026-09-25 | requer_validacao |
| data/metas_mensais.json | mes/dia/canal | 21 | 2026-09-25 a 2026-09-25 | requer_validacao |

## Matriz de campos

| Necessidade | Fonte | Campo | Transformacao | Validacao | Visao |
|---|---|---|---|---|---|
| Identidade estavel do lancamento | data/lancamentos_modelos.json | modelo_id | preservar chave; nao inferir pelo nome no frontend | unicidade e vinculo SKU | todas |
| D0 analitico | data/lancamentos_modelos.json | day_zero_base | data local; sem fallback para data oficial | comparar com primeira venda e cobertura | desempenho, estabilidade, expectativa |
| Data oficial | data/lancamentos_modelos.json | data_oficial | contexto separado do D0 | evidencia de cadastro | qualidade e comparabilidade |
| Pedido distinto | data/lancamentos_produtos_dia.json | order_sk | COUNT DISTINCT no recorte | pedido multi-item e multi-lancamento | desempenho |
| Pares comerciais | data/lancamentos_produtos_dia.json | pares | soma na mesma base temporal | separar brindes e ofertas por quantidade | desempenho |
| Receita bruta | data/lancamentos_produtos_dia.json | receita_bruta | soma por fase/semana | reconciliar com SSOT | desempenho e expectativa |
| Receita apos descontos | data/lancamentos_produtos_dia.json | receita_liquida | renomear na exibicao; nao chamar lucro | reconciliar desconto alocado | detalhe de desempenho |
| Cobertura diaria | data/manifest.json + lancamentos_rampa_dia.json | generated_at + data | zero apenas entre D0 e corte confirmado | dias esperados, cobertos e faltantes | todas |
| Origem do pedido | data/lancamentos_produtos_dia.json | tipo_real/canal_real | manter unmatched separado | match rate por lancamento e periodo | condicoes |
| Gasto executado | data/midia_paga.json | investimento/data_inicio/data_fim/canal | nao ratear nem somar sobreposicoes | escopo, moeda e datas | condicoes |
| Acao executada | data/crm_disparos.json | data_disparo/campanha/canal | evento contextual separado da venda | evidencia e completude do calendario | condicoes |
| Disponibilidade | data/estoque.json | estoque_atual | somente posicao atual | historico por SKU/tamanho/publicacao | condicoes |
| RPS | data/lancamentos_rps_dia.json | receita_total/sessoes | contexto da loja alinhado ao calendario | nao atribuir ao produto | condicoes |

## Estabilidade

- Regra legada reproduzida: pico de todo o historico seguido da primeira sequencia de duas variacoes semanais dentro de 10%.
- Regra operacional v1: tres semanas completas, variacoes e deriva dentro da tolerancia, nivel material, confirmacao por duas semanas futuras observadas e quebra registrada.
- O metodo permanece heuristico; regularidade nao significa sucesso, independencia de midia ou demanda irrestrita.

| Lancamento | Semanas | Legado detectado | Operacional | Detectado | Confirmado |
|---|---:|---:|---|---:|---:|
| gt | 40 | 29 | sinal_desfeito | 30 | - |
| avant | 40 | - | patamar_interrompido | 29 | 31 |
| phantom | 23 | - | sinal_desfeito | 8 | - |
| rs8_monochrome | 13 | - | sem_sinal_ate_o_corte | - | - |
| series_2 | 10 | 6 | sinal_confirmado | 6 | 8 |

## Previsao e teste temporal

- recent_7d_pace: 21 previsoes avaliadas, 3 lancamentos, MAE 94564.11, WAPE 0.127243, status exploratory_small_sample.
- eligible_historical_multiplier_median: 11 previsoes avaliadas, 2 lancamentos, MAE 83559.24, WAPE 0.145796, status exploratory_small_sample.
- Minimo/maximo de analogos nao e intervalo de confianca. Com a amostra atual, previsoes permanecem exploratorias.

## Artefatos

- `data/launch_analysis_contract.json`: contrato consumido pelas visoes.
- `data/lancamentos_completude_d0.json`: cobertura entre D0 oficial e o corte.
- `docs/data_requests_20260924.csv`: solicitacoes priorizadas de dados.
- `scripts/test_launch_analysis_contract.js`: testes de tempo, cobertura, estabilidade e previsao.
