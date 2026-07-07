window.REISE_FALLBACK_DATA = {
  "lancamentos_modelos": [
    {
      "modelo_id": "gt",
      "modelo": "GT Collection",
      "linha": "GT Collection",
      "data_lancamento": "2024-10-18",
      "data_oficial": "2024-10-18",
      "day_zero_base": "2025-02-11",
      "termos_busca": "GT Collection|RS6 GT|KNIT GT|911 GT",
      "sku_prefixos": "RS6-GT,KNIT-GT,911-GT",
      "status": "historico",
      "observacao": "Histórico com gap de 116 dias entre D0 oficial e primeira venda disponível na base. Usar day_zero_base para análises."
    },
    {
      "modelo_id": "avant",
      "modelo": "Avant",
      "linha": "Avant",
      "data_lancamento": "2025-10-02",
      "data_oficial": "2025-10-02",
      "day_zero_base": "2025-10-02",
      "termos_busca": "Avant|RS8 Avant|RS6 Avant|RS7 Avant",
      "sku_prefixos": "RS8-AVANT,RS6-AVANT,RS7-AVANT",
      "status": "historico",
      "observacao": "Histórico completo. Janela 90d inflada por Black Friday, Cyber Monday e Natal."
    },
    {
      "modelo_id": "phantom",
      "modelo": "Phantom",
      "linha": "Phantom",
      "data_lancamento": "2026-04-16",
      "data_oficial": "2026-04-16",
      "day_zero_base": "2026-04-16",
      "termos_busca": "Phantom|Phantom Slip|Phantom Easy|Phantom Knit",
      "sku_prefixos": "PHANTOM-SLIP,PHANTOM-EASY,PHANTOM-KNIT",
      "status": "historico",
      "observacao": "30d real. Janela 90d ainda não consolidada no histórico estático."
    },
    {
      "modelo_id": "rs8_monochrome",
      "modelo": "RS8 Avant Monochrome",
      "linha": "RS8 Avant",
      "data_lancamento": "2026-06-25",
      "data_oficial": "2026-06-25",
      "day_zero_base": "2026-06-25",
      "termos_busca": "RS8 Avant Monochrome|RS8 Monochrome|Monochrome",
      "sku_prefixos": "RS8-AVANT-MONO,RS8-MONO",
      "status": "ativo",
      "observacao": "Em curso. Dados devem entrar via lancamentos_produtos_dia.json gerado pelo Apps Script/BigQuery."
    },
    {
      "modelo_id": "pais_2026",
      "modelo": "Lançamento Dia dos Pais",
      "linha": "Dia dos Pais 2026",
      "data_lancamento": "2026-08-10",
      "data_oficial": "2026-08-10",
      "day_zero_base": "2026-08-10",
      "termos_busca": "Dia dos Pais|Pais 2026",
      "sku_prefixos": "",
      "status": "planejado",
      "observacao": "Modelo planejado. Entra no dashboard antes do D0 para leitura de benchmark e sazonalidade."
    }
  ],
  "lancamentos_historico": [
    {
      "modelo_id": "gt",
      "modelo": "GT Collection",
      "day_zero_base": "2025-02-11",
      "data_oficial": "2024-10-18",
      "gap_dias": 116,
      "janelas": {
        "15d": {
          "receita": 122401,
          "pares": 186,
          "pedidos": 120,
          "ticket": 1020,
          "novos_pct": 0.47,
          "origem": "historico"
        },
        "30d": {
          "receita": 183232,
          "pares": 272,
          "pedidos": 201,
          "ticket": 912,
          "novos_pct": 0.51,
          "origem": "historico"
        },
        "90d": {
          "receita": 889939,
          "pares": 1300,
          "pedidos": 1011,
          "ticket": 880,
          "novos_pct": 0.6,
          "origem": "historico"
        }
      },
      "multiplicadores": {
        "m30_15": 1.5,
        "m90_15": 7.27,
        "m90_30": 4.86
      },
      "cores": [
        {
          "sub_modelo": "RS6 GT",
          "cor": "Off White",
          "pares": 229
        },
        {
          "sub_modelo": "RS6 GT",
          "cor": "Branco",
          "pares": 127
        },
        {
          "sub_modelo": "RS6 GT",
          "cor": "All Black",
          "pares": 84
        },
        {
          "sub_modelo": "KNIT GT",
          "cor": "Preto",
          "pares": 74
        },
        {
          "sub_modelo": "KNIT GT",
          "cor": "Cinza",
          "pares": 66
        },
        {
          "sub_modelo": "KNIT GT",
          "cor": "All Black",
          "pares": 35
        },
        {
          "sub_modelo": "911 GT",
          "cor": "Branco",
          "pares": 40
        },
        {
          "sub_modelo": "911 GT",
          "cor": "Camurça",
          "pares": 27
        },
        {
          "sub_modelo": "911 GT",
          "cor": "Preto",
          "pares": 21
        }
      ],
      "insights": [
        "Usar GT apenas como referência de curva; abertura real está incompleta pelo gap de 116 dias.",
        "Multiplicador 90÷30 de 4,86× é útil como cenário otimista, mas precisa de ressalva."
      ]
    },
    {
      "modelo_id": "avant",
      "modelo": "Avant",
      "day_zero_base": "2025-10-02",
      "data_oficial": "2025-10-02",
      "gap_dias": 0,
      "janelas": {
        "15d": {
          "receita": 168020,
          "pares": 282,
          "pedidos": 234,
          "ticket": 718,
          "novos_pct": 0.58,
          "origem": "historico"
        },
        "30d": {
          "receita": 418050,
          "pares": 705,
          "pedidos": 569,
          "ticket": 735,
          "novos_pct": 0.61,
          "origem": "historico"
        },
        "90d": {
          "receita": 1077654,
          "pares": 1930,
          "pedidos": 1551,
          "ticket": 695,
          "novos_pct": 0.71,
          "origem": "historico"
        }
      },
      "multiplicadores": {
        "m30_15": 2.49,
        "m90_15": 6.41,
        "m90_30": 2.58
      },
      "cores": [
        {
          "sub_modelo": "RS8 Avant",
          "cor": "Cinza",
          "pares": 452
        },
        {
          "sub_modelo": "RS8 Avant",
          "cor": "Branco",
          "pares": 261
        },
        {
          "sub_modelo": "RS8 Avant",
          "cor": "Preto",
          "pares": 187
        },
        {
          "sub_modelo": "RS6 Avant",
          "cor": "Branco",
          "pares": 231
        },
        {
          "sub_modelo": "RS6 Avant",
          "cor": "Off White",
          "pares": 194
        },
        {
          "sub_modelo": "RS6 Avant",
          "cor": "Azul-marinho",
          "pares": 123
        },
        {
          "sub_modelo": "RS7 Avant",
          "cor": "Preto",
          "pares": 142
        },
        {
          "sub_modelo": "RS7 Avant",
          "cor": "Off White",
          "pares": 120
        },
        {
          "sub_modelo": "RS7 Avant",
          "cor": "Marrom",
          "pares": 42
        }
      ],
      "insights": [
        "Janela 90d foi favorecida por Black Friday, Cyber Monday e Natal.",
        "Usar multiplicador 90÷30 como referência conservadora, não como verdade absoluta."
      ]
    },
    {
      "modelo_id": "phantom",
      "modelo": "Phantom",
      "day_zero_base": "2026-04-16",
      "data_oficial": "2026-04-16",
      "gap_dias": 0,
      "janelas": {
        "15d": {
          "receita": 212824,
          "pares": 296,
          "pedidos": 225,
          "ticket": 946,
          "novos_pct": 0.54,
          "origem": "historico"
        },
        "30d": {
          "receita": 396888,
          "pares": 552,
          "pedidos": 413,
          "ticket": 961,
          "novos_pct": 0.569,
          "origem": "historico"
        },
        "90d": null
      },
      "multiplicadores": {
        "m30_15": 1.86,
        "m90_15": null,
        "m90_30": null
      },
      "semanas": [
        {
          "label": "Sem 1 · 16–22/abr",
          "receita": 110726,
          "pedidos": 119
        },
        {
          "label": "Sem 2 · 23–29/abr",
          "receita": 91313,
          "pedidos": 95
        },
        {
          "label": "Sem 3 · 30/abr–6/mai",
          "receita": 81966,
          "pedidos": 84
        },
        {
          "label": "Sem 4 · 7–13/mai",
          "receita": 88437,
          "pedidos": 92
        },
        {
          "label": "Sem 5 · 14–16/mai",
          "receita": 38826,
          "pedidos": 34
        }
      ],
      "cores": [
        {
          "sub_modelo": "Phantom Slip",
          "cor": "Marrom",
          "pares": 93
        },
        {
          "sub_modelo": "Phantom Slip",
          "cor": "Preto",
          "pares": 59
        },
        {
          "sub_modelo": "Phantom Slip",
          "cor": "Off White",
          "pares": 41
        },
        {
          "sub_modelo": "Phantom Easy",
          "cor": "Marrom",
          "pares": 92
        },
        {
          "sub_modelo": "Phantom Easy",
          "cor": "Off White",
          "pares": 87
        },
        {
          "sub_modelo": "Phantom Easy",
          "cor": "Preto",
          "pares": 81
        },
        {
          "sub_modelo": "Phantom Knit",
          "cor": "Off White",
          "pares": 9
        },
        {
          "sub_modelo": "Phantom Knit",
          "cor": "Preto",
          "pares": 5
        },
        {
          "sub_modelo": "Phantom Knit",
          "cor": "Cinza",
          "pares": 4
        }
      ],
      "insights": [
        "Maior ticket médio entre as linhas históricas: R$ 961 no 30d.",
        "Curva 30÷15 de 1,86× fica entre GT e Avant."
      ]
    }
  ],
  "lancamentos_produtos_dia": [],
  "midia_paga": [
    {
      "modelo_id": "gt",
      "janela": "15d",
      "canal": "Paid total",
      "investimento": 2798,
      "receita_atribuida": 122401,
      "pedidos": 120,
      "roas": 43.75,
      "cpa": 23,
      "observacao": "Receita da linha na janela; atribuição por canal ainda não disponível.",
      "status": "historico"
    },
    {
      "modelo_id": "gt",
      "janela": "30d",
      "canal": "Paid total",
      "investimento": 4560,
      "receita_atribuida": 183232,
      "pedidos": 201,
      "roas": 40.19,
      "cpa": 23,
      "observacao": "Receita da linha na janela; atribuição por canal ainda não disponível.",
      "status": "historico"
    },
    {
      "modelo_id": "gt",
      "janela": "90d",
      "canal": "Paid total",
      "investimento": 39187,
      "receita_atribuida": 889939,
      "pedidos": 1011,
      "roas": 22.71,
      "cpa": 39,
      "observacao": "Receita da linha na janela; atribuição por canal ainda não disponível.",
      "status": "historico"
    },
    {
      "modelo_id": "avant",
      "janela": "15d",
      "canal": "Paid total",
      "investimento": 20910,
      "receita_atribuida": 168020,
      "pedidos": 234,
      "roas": 8.04,
      "cpa": 89,
      "observacao": "Receita da linha na janela; atribuição por canal ainda não disponível.",
      "status": "historico"
    },
    {
      "modelo_id": "avant",
      "janela": "30d",
      "canal": "Paid total",
      "investimento": 49230,
      "receita_atribuida": 418050,
      "pedidos": 569,
      "roas": 8.49,
      "cpa": 87,
      "observacao": "Receita da linha na janela; atribuição por canal ainda não disponível.",
      "status": "historico"
    },
    {
      "modelo_id": "avant",
      "janela": "90d",
      "canal": "Paid total",
      "investimento": 229136,
      "receita_atribuida": 1077654,
      "pedidos": 1551,
      "roas": 4.7,
      "cpa": 148,
      "observacao": "Receita da linha na janela; 90d favorecido por BF/Natal.",
      "status": "historico"
    },
    {
      "modelo_id": "phantom",
      "janela": "15d",
      "canal": "Paid total",
      "investimento": 14003,
      "receita_atribuida": 212824,
      "pedidos": 225,
      "roas": 15.2,
      "cpa": 62,
      "observacao": "Investimento disponível apenas para 15d nesta fonte.",
      "status": "historico"
    }
  ],
  "crm_disparos": [
    {
      "modelo_id": "gt",
      "data_disparo": "2025-06-23",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 661.86,
      "roas_proxy": 0,
      "observacao": "Sem retorno atribuído."
    },
    {
      "modelo_id": "gt",
      "data_disparo": "2025-10-29",
      "canal": "CRM",
      "receita_linha": 9785,
      "receita_dia": null,
      "investimento": 712.89,
      "roas_proxy": 13.7,
      "observacao": "Disparo eficiente."
    },
    {
      "modelo_id": "gt",
      "data_disparo": "2025-11-11",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 241.1,
      "roas_proxy": 0,
      "observacao": "Sem retorno atribuído."
    },
    {
      "modelo_id": "gt",
      "data_disparo": "2026-02-12",
      "canal": "CRM",
      "receita_linha": 7162,
      "receita_dia": null,
      "investimento": 1049.28,
      "roas_proxy": 6.8,
      "observacao": "Disparo eficiente."
    },
    {
      "modelo_id": "avant",
      "data_disparo": "2025-10-02",
      "canal": "CRM",
      "receita_linha": 1060,
      "receita_dia": null,
      "investimento": 1276.5,
      "roas_proxy": 0.83,
      "observacao": "Abaixo de 1x."
    },
    {
      "modelo_id": "avant",
      "data_disparo": "2025-10-27",
      "canal": "CRM",
      "receita_linha": 7830,
      "receita_dia": null,
      "investimento": 232.14,
      "roas_proxy": 33.7,
      "observacao": "Disparo mais eficiente da linha."
    },
    {
      "modelo_id": "avant",
      "data_disparo": "2025-11-18",
      "canal": "CRM",
      "receita_linha": 328.5,
      "receita_dia": null,
      "investimento": 66.37,
      "roas_proxy": 4.95,
      "observacao": "Eficiente."
    },
    {
      "modelo_id": "avant",
      "data_disparo": "2026-01-24",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 126.0,
      "roas_proxy": 0,
      "observacao": "Sem retorno atribuído."
    },
    {
      "modelo_id": "avant",
      "data_disparo": "2026-05-06",
      "canal": "CRM",
      "receita_linha": 1903,
      "receita_dia": null,
      "investimento": 40.68,
      "roas_proxy": 46.8,
      "observacao": "Disparo eficiente."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-15",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 156.78,
      "roas_proxy": 0,
      "observacao": "Pré-lançamento sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-15",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 121.8,
      "roas_proxy": 0,
      "observacao": "Pré-lançamento sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-15",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 319.85,
      "roas_proxy": 0,
      "observacao": "Pré-lançamento sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-17",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 42.69,
      "roas_proxy": 0,
      "observacao": "Pré-lançamento sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-17",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 357.96,
      "roas_proxy": 0,
      "observacao": "Pré-lançamento sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-23",
      "canal": "CRM",
      "receita_linha": 503,
      "receita_dia": null,
      "investimento": 505.49,
      "roas_proxy": 1.0,
      "observacao": "Break-even."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-04-25",
      "canal": "CRM",
      "receita_linha": 1161,
      "receita_dia": null,
      "investimento": 102.0,
      "roas_proxy": 11.4,
      "observacao": "Único disparo forte de Phantom."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-05-11",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 54.42,
      "roas_proxy": 0,
      "observacao": "Remarketing sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-05-11",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 69.38,
      "roas_proxy": 0,
      "observacao": "Remarketing sem retorno."
    },
    {
      "modelo_id": "phantom",
      "data_disparo": "2026-05-11",
      "canal": "CRM",
      "receita_linha": 0,
      "receita_dia": null,
      "investimento": 61.51,
      "roas_proxy": 0,
      "observacao": "Remarketing sem retorno."
    }
  ],
  "estoque": [],
  "calendario_br": [
    {
      "data": "2025-03-03",
      "nome": "Carnaval",
      "tipo": "ofensor",
      "peso": "forte",
      "observacao": "Ofensor de consumo dentro dos 30d do GT."
    },
    {
      "data": "2025-03-15",
      "nome": "Dia do Consumidor",
      "tipo": "promotor",
      "peso": "medio",
      "observacao": "Promotor dentro dos 90d do GT."
    },
    {
      "data": "2025-04-20",
      "nome": "Páscoa",
      "tipo": "neutro",
      "peso": "baixo",
      "observacao": "Neutro no contexto de calçados masculinos."
    },
    {
      "data": "2025-05-11",
      "nome": "Dia das Mães",
      "tipo": "promotor",
      "peso": "medio",
      "observacao": "Último dia da janela 90d do GT."
    },
    {
      "data": "2025-11-28",
      "nome": "Black Friday",
      "tipo": "promotor",
      "peso": "forte",
      "observacao": "Infla a janela 90d do Avant."
    },
    {
      "data": "2025-12-01",
      "nome": "Cyber Monday",
      "tipo": "promotor",
      "peso": "medio",
      "observacao": "Infla a janela 90d do Avant."
    },
    {
      "data": "2025-12-25",
      "nome": "Natal",
      "tipo": "promotor",
      "peso": "forte",
      "observacao": "Infla a janela 90d do Avant."
    },
    {
      "data": "2026-04-05",
      "nome": "Páscoa",
      "tipo": "neutro",
      "peso": "baixo",
      "observacao": "Antes do D0 de Phantom."
    },
    {
      "data": "2026-05-10",
      "nome": "Dia das Mães",
      "tipo": "promotor",
      "peso": "medio",
      "observacao": "Dentro dos 30d de Phantom."
    },
    {
      "data": "2026-06-12",
      "nome": "Dia dos Namorados",
      "tipo": "promotor",
      "peso": "medio",
      "observacao": "Dentro dos 90d de Phantom."
    },
    {
      "data": "2026-08-09",
      "nome": "Dia dos Pais",
      "tipo": "promotor",
      "peso": "forte",
      "observacao": "Data principal para o lançamento planejado de agosto."
    },
    {
      "data": "2026-11-27",
      "nome": "Black Friday",
      "tipo": "promotor",
      "peso": "forte",
      "observacao": "Maior data comercial do segundo semestre."
    },
    {
      "data": "2026-12-25",
      "nome": "Natal",
      "tipo": "promotor",
      "peso": "forte",
      "observacao": "Forte período de presentes."
    }
  ],
  "manifest": {
    "generated_at": "2026-07-07T14:00:00-03:00",
    "project": "Reise Launch Analysis v2",
    "source_note": "Base inicial criada a partir das fontes fornecidas. Dados ativos devem vir do Apps Script + BigQuery.",
    "files": [
      "lancamentos_modelos.json",
      "lancamentos_historico.json",
      "lancamentos_produtos_dia.json",
      "midia_paga.json",
      "crm_disparos.json",
      "estoque.json",
      "calendario_br.json"
    ],
    "warnings": [
      "GT deve usar day_zero_base 2025-02-11 por gap de 116 dias.",
      "Avant 90d deve exibir aviso de inflação por Black Friday/Natal.",
      "Dados ausentes devem ser null/—, nunca zero."
    ]
  }
};
