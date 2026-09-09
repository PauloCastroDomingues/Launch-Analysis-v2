# Revisão da leitura de lançamentos — 09/09/2026

A abertura passa a comparar receita acumulada, pedidos únicos e pares na mesma idade. Phantom, Monochrome e Series 2 formam o grupo inicial; GT e Avant seguem selecionáveis como referências provisórias.

## Regras corrigidas

- Pedidos por canal são distintos por `order_sk`, mesmo com vários SKUs.
- Orgânico, pago, CRM, outros e sem atribuição permanecem separados nas duas interfaces e no auditor.
- Investimento acumulado não é somado a campanhas sobrepostas nem atribuído integralmente a uma janela menor. Para liberar mídia e ROAS, cada registro deve cobrir exatamente a janela inclusiva e declarar `escopo_investimento_validado: true`; canais repetidos ou sem identificação bloqueiam a soma. Essa validação exige conferir a fonte; o dashboard não a infere.
- Ausência de mídia/CRM não é zero e não compõe um total completo. CRM representa ações registradas, sem garantia de cobertura integral.
- RPS é contexto da loja. As conclusões de independência do produto não são utilizadas.
- Janelas abertas preservam base ativada pendente, inclusive com base D0 conhecida.
- A análise avançada carrega assinaturas dos sete arquivos de entrada e a versão das regras. O frontend bloqueia fontes divergentes. Execute `node scripts/gerar_lancamentos_analise_avancada.js` após cada atualização de dados; isso recalcula o derivado, não atualiza o snapshot de vendas.
- Falhas de carregamento não recuperam silenciosamente o histórico estático ou os dados embutidos antigos.
- A consulta de RPS não foi transformada em RPS de produto; sua série permanece a da loja.

## Pendências na origem

Foram encontradas 362 chaves repetidas de modelo/data/pedido/SKU: GT 101 e Avant 261. Nenhuma venda foi apagada. Conferir a chave do item e as fontes da migração no SSOT antes de deduplicar.

GT tem D0 analítico 17/12/2025 e lançamento oficial 18/10/2024; Avant tem D0 14/12/2025 e lançamento oficial 02/10/2025. Não equivalem à curva inicial oficial.

Vendas e clientes continuam no snapshot de 21/08/2026; RPS tem corte próprio. Atualizar o Apps Script instalado e executar uma nova extração são etapas externas, distintas do commit deste código.

## Validação local

`node --test scripts/test_launch_review.js` cobre contagem distinta, cinco canais, investimento sobreposto, nulos e consistência das fontes. Os testes de navegador cobrem o placar, as curvas, filtros, janelas abertas e modo apresentação. Capturas e auxiliares de navegador ficam em `%TEMP%`.
