/** Cópia FIXA do catálogo de 12/11/2026, só para testes: o catálogo real muda com a revisão bissemanal. */
import type { Catalogo } from "./apoios.ts";

export const CATALOGO_TESTE: Catalogo = {
  "versao": "2026-11-12",
  "verificadoEm": "2026-11-12",
  "linhas": [
    {
      "id": "m2030-2026-38",
      "codigo": "M2030-2026-38",
      "nome": "Funcionamento 2030 — Outros custos de funcionamento",
      "programa": "Madeira 2030 (FEDER) · IDE-RAM",
      "resumo": "Compensa custos de funcionamento acrescidos pela ultraperiferia: Segurança Social, rendas, eletricidade e água, serviços de contabilidade.",
      "regioes": [
        "PT-MA"
      ],
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "inicio": "2026-10-30T15:00",
      "fim": "2026-12-04T17:00",
      "apoio": "Não reembolsável: 30% (+10% no Porto Santo)",
      "ligacao": "https://ide.madeira.gov.pt",
      "nota": "Exige contabilidade organizada. Candidatura no Balcão dos Fundos.",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "m2030-2026-35",
      "codigo": "M2030-2026-35",
      "nome": "Funcionamento 2030 — Transportes",
      "programa": "Madeira 2030 (FEDER) · IDE-RAM",
      "resumo": "Compensa o custo acrescido de transportar mercadorias de e para a Madeira.",
      "regioes": [
        "PT-MA"
      ],
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2026-11-20T17:00",
      "apoio": "Não reembolsável",
      "ligacao": "https://ide.madeira.gov.pt",
      "nota": "Candidatura no Balcão dos Fundos.",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "mpr-2026-6",
      "codigo": "MPR-2026-6",
      "nome": "SICE — Inovação Produtiva",
      "programa": "COMPETE 2030 e programas regionais",
      "resumo": "Investimento produtivo inovador: produtos ou serviços novos, aumento de capacidade, novos processos.",
      "regioes": [
        "PT"
      ],
      "territorio": "o Continente (pelo menos 40% para territórios de baixa densidade)",
      "dimensoes": [
        "micro",
        "pequena",
        "media"
      ],
      "excluiDivisoes": [
        "64",
        "65",
        "66"
      ],
      "estado": "aberto",
      "inicio": "2026-06-15",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "nota": "Candidaturas por fases: confirme no aviso a fase em curso. Exige situação económico-financeira equilibrada e efeito de incentivo.",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "mpr-2026-7",
      "codigo": "MPr-2026-7",
      "nome": "SIID — Demonstradores",
      "programa": "COMPETE 2030",
      "resumo": "Projetos de I&D que demonstram uma tecnologia ou produto novo em ambiente real.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2026-12-29T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "mpr-2026-4",
      "codigo": "MPr-2026-4",
      "nome": "SIID — I&D com parceiros europeus",
      "programa": "COMPETE 2030",
      "resumo": "Internacionalização de I&D: projetos de investigação com parceiros de outros países europeus.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2026-12-29T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "mpr-2026-01",
      "codigo": "MPR-2026-01",
      "nome": "SITCE — Descarbonização",
      "programa": "COMPETE 2030",
      "resumo": "Investimento para reduzir emissões e consumo de energia nos processos da empresa.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2026-12-30T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "mpr-2026-9",
      "codigo": "MPr-2026-9",
      "nome": "STEP — I&D&I em tecnologias digitais e biotecnologia",
      "programa": "COMPETE 2030 (STEP)",
      "resumo": "I&D e inovação em tecnologias digitais, deep tech ou biotecnologia.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2027-01-04T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "nota": "O projeto tem de ser nestas tecnologias, qualquer que seja o setor.",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "mpr-2026-10",
      "codigo": "MPr-2026-10",
      "nome": "STEP — Inovação produtiva em tecnologias digitais e biotecnologia",
      "programa": "COMPETE 2030 (STEP)",
      "resumo": "Investimento produtivo para fabricar ou desenvolver tecnologias digitais, deep tech ou biotecnologia.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2027-01-04T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "compete2030-2026-11",
      "codigo": "COMPETE2030-2026-11",
      "nome": "STEP — I&D&I em tecnologias de energia limpa",
      "programa": "COMPETE 2030 (STEP)",
      "resumo": "I&D e inovação em tecnologias limpas e eficientes do ponto de vista energético.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2027-01-04T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "compete2030-2026-12",
      "codigo": "COMPETE2030-2026-12",
      "nome": "STEP — Inovação produtiva em tecnologias de energia limpa",
      "programa": "COMPETE 2030 (STEP)",
      "resumo": "Investimento produtivo em tecnologias limpas e eficientes do ponto de vista energético.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media",
        "grande"
      ],
      "estado": "aberto",
      "fim": "2027-01-04T17:00",
      "ligacao": "https://www.compete2030.gov.pt/avisos/",
      "verificadoEm": "2026-11-12"
    },
    {
      "id": "sice-qualificacao-2026",
      "codigo": "Plano anual de avisos",
      "nome": "SICE — Qualificação das PME",
      "programa": "Norte 2030, Centro 2030, Alentejo 2030",
      "resumo": "Organização, marketing, digitalização e outros fatores de competitividade da PME.",
      "regioes": [
        "PT"
      ],
      "territorio": "as regiões Norte, Centro e Alentejo",
      "dimensoes": [
        "micro",
        "pequena",
        "media"
      ],
      "estado": "previsto",
      "ligacao": "https://portugal2030.pt/avisos/",
      "nota": "Previsto entre o 3.º quadrimestre de 2026 e o 2.º de 2027. Bom momento para preparar o projeto.",
      "verificadoEm": "2026-11-12"
    }
  ]
};
