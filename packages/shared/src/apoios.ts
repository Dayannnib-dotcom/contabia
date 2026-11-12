/**
 * Apoios europeus (Portugal 2030 / PRR) por CAE.
 *
 * O CAE em vigor desde 1/1/2025 é a Rev. 4 (Decreto-Lei 9/2025), alinhada com a
 * NACE Rev. 2.1: 5 dígitos, os dois primeiros são a divisão. Não existe uma API
 * pública e gratuita da AT/INE que dê o CAE a partir do NIF, por isso a empresa
 * (ou o contabilista) indica-o e a app valida-o; o SICAE confirma-o.
 *
 * O catálogo é INDICATIVO: a elegibilidade real depende sempre do aviso.
 */
import type { Regiao } from "./regras.ts";

export type Dimensao = "micro" | "pequena" | "media" | "grande";
export const DIMENSOES: { id: Dimensao; nome: string; ajuda: string }[] = [
  { id: "micro", nome: "Micro", ajuda: "Menos de 10 pessoas e até 2 M€ de volume de negócios" },
  { id: "pequena", nome: "Pequena", ajuda: "Menos de 50 pessoas e até 10 M€" },
  { id: "media", nome: "Média", ajuda: "Menos de 250 pessoas e até 50 M€" },
  { id: "grande", nome: "Grande", ajuda: "250 pessoas ou mais" },
];

/** Secções da CAE Rev. 4 (NACE Rev. 2.1) e as suas divisões. */
export const SECCOES_CAE: { letra: string; nome: string; divisoes: string[] }[] = [
  { letra: "A", nome: "Agricultura, produção animal, floresta e pesca", divisoes: ["01", "02", "03"] },
  { letra: "B", nome: "Indústrias extrativas", divisoes: ["05", "06", "07", "08", "09"] },
  { letra: "C", nome: "Indústrias transformadoras", divisoes: Array.from({ length: 24 }, (_, i) => String(10 + i)) },
  { letra: "D", nome: "Eletricidade, gás, vapor e ar condicionado", divisoes: ["35"] },
  { letra: "E", nome: "Água, saneamento e gestão de resíduos", divisoes: ["36", "37", "38", "39"] },
  { letra: "F", nome: "Construção", divisoes: ["41", "42", "43"] },
  { letra: "G", nome: "Comércio por grosso e a retalho", divisoes: ["46", "47"] },
  { letra: "H", nome: "Transportes e armazenagem", divisoes: ["49", "50", "51", "52", "53"] },
  { letra: "I", nome: "Alojamento e restauração", divisoes: ["55", "56"] },
  { letra: "J", nome: "Edição, difusão e produção de conteúdos", divisoes: ["58", "59", "60"] },
  { letra: "K", nome: "Telecomunicações, informática e serviços de informação", divisoes: ["61", "62", "63"] },
  { letra: "L", nome: "Atividades financeiras e de seguros", divisoes: ["64", "65", "66"] },
  { letra: "M", nome: "Atividades imobiliárias", divisoes: ["68"] },
  { letra: "N", nome: "Consultoria, atividades científicas e técnicas", divisoes: ["69", "70", "71", "72", "73", "74", "75"] },
  { letra: "O", nome: "Atividades administrativas e serviços de apoio", divisoes: ["77", "78", "79", "80", "81", "82"] },
  { letra: "P", nome: "Administração pública e defesa", divisoes: ["84"] },
  { letra: "Q", nome: "Educação", divisoes: ["85"] },
  { letra: "R", nome: "Saúde humana e apoio social", divisoes: ["86", "87", "88"] },
  { letra: "S", nome: "Atividades artísticas, desportivas e recreativas", divisoes: ["90", "91", "92", "93"] },
  { letra: "T", nome: "Outras atividades de serviços", divisoes: ["94", "95", "96"] },
  { letra: "U", nome: "Famílias empregadoras", divisoes: ["97", "98"] },
  { letra: "V", nome: "Organismos internacionais", divisoes: ["99"] },
];

export const URL_SICAE = "https://www.sicae.pt";

export function seccaoDoCAE(cae: string) {
  return SECCOES_CAE.find((s) => s.divisoes.includes(cae.slice(0, 2)));
}

/** Valida um CAE Rev. 4. Devolve null se estiver bem, ou a mensagem para mostrar. */
export function erroCAE(entrada: string): string | null {
  const cae = entrada.replace(/[\s.\-]/g, "");
  if (!/^\d{5}$/.test(cae)) return "O CAE tem 5 algarismos (ex.: 56111).";
  if (cae.startsWith("45")) return "A divisão 45 deixou de existir na CAE Rev. 4 (2025). Confirme o seu CAE atual no SICAE.";
  if (!seccaoDoCAE(cae)) return "Este CAE não existe na CAE Rev. 4. Confirme-o no SICAE.";
  return null;
}
export const normalizarCAE = (s: string) => s.replace(/[\s.\-]/g, "");

export type EstadoApoio = "aberto" | "previsto" | "fechado";

export interface LinhaApoio {
  id: string;
  /** Código oficial do aviso (ex.: M2030-2026-38). */
  codigo: string;
  nome: string;
  programa: string;
  resumo: string;
  /** Regiões fiscais abrangidas. "PT" = Continente. */
  regioes: Regiao[];
  /** Pormenor territorial que a região fiscal não distingue (ex.: "Norte, Centro e Alentejo"). */
  territorio?: string;
  dimensoes: Dimensao[];
  /** Só estas divisões CAE (se vazio ou ausente: todas, salvo exclusões). */
  divisoes?: string[];
  excluiDivisoes?: string[];
  estado: EstadoApoio;
  inicio?: string;
  /** Data e hora-limite em Lisboa, ISO "AAAA-MM-DDTHH:MM". */
  fim?: string;
  apoio?: string;
  ligacao: string;
  nota?: string;
  verificadoEm: string;
}

export interface Catalogo { versao: string; verificadoEm: string; linhas: LinhaApoio[] }

export interface PerfilApoios { cae: string | null; caesSecundarios: string[]; dimensao: Dimensao | null; regiao: Regiao }

export interface ApoioCompativel {
  apoio: LinhaApoio;
  /** "provavel": cumpre tudo o que a app consegue verificar; "verificar": falta um dado da empresa. */
  compatibilidade: "provavel" | "verificar";
  motivos: string[];
  diasParaFim: number | null;
}

const NOME_REGIAO: Record<Regiao, string> = { PT: "Continente", "PT-MA": "Madeira", "PT-AC": "Açores" };
const NOME_DIM: Record<Dimensao, string> = { micro: "micro", pequena: "pequenas", media: "médias", grande: "grandes" };
const listaDim = (ds: Dimensao[]) => {
  const n = ds.map((d) => NOME_DIM[d]);
  return n.length > 1 ? `${n.slice(0, -1).join(", ")} e ${n.at(-1)}` : n[0];
};

function dias(deISO: string, ateISO: string) {
  return Math.ceil((Date.parse(ateISO.slice(0, 10)) - Date.parse(deISO.slice(0, 10))) / 86_400_000);
}

/**
 * Cruza o perfil da empresa com o catálogo. Exclui o que de certeza não serve
 * (região, dimensão, CAE excluído, aviso fechado ou com prazo passado) e explica
 * porque é que cada um dos restantes aparece.
 */
export function apoiosCompativeis(p: PerfilApoios, cat: Catalogo, agoraISO: string): ApoioCompativel[] {
  const caes = [p.cae, ...p.caesSecundarios].filter((c): c is string => !!c);
  const divs = [...new Set(caes.map((c) => c.slice(0, 2)))];
  const hoje = agoraISO.slice(0, 16);
  const r: ApoioCompativel[] = [];
  for (const a of cat.linhas) {
    if (a.estado === "fechado") continue;
    if (a.estado === "aberto" && a.fim && a.fim < hoje) continue;
    if (!a.regioes.includes(p.regiao)) continue;
    if (p.dimensao && !a.dimensoes.includes(p.dimensao)) continue;
    const motivos: string[] = [];
    let verificar = false;

    motivos.push(`A empresa está na região ${NOME_REGIAO[p.regiao]}${a.territorio ? ` — o aviso abrange ${a.territorio}; confirme a localização do investimento` : ""}.`);
    if (a.territorio) verificar = true;

    if (p.dimensao) motivos.push(`Aceita empresas ${listaDim(a.dimensoes)}.`);
    else { verificar = true; motivos.push(`Indique a dimensão da empresa: este aviso é para empresas ${listaDim(a.dimensoes)}.`); }

    if (!divs.length) {
      verificar = true;
      motivos.push("Indique o CAE para eu confirmar se a atividade é elegível.");
    } else {
      const ok = divs.filter((d) => (!a.divisoes?.length || a.divisoes.includes(d)) && !a.excluiDivisoes?.includes(d));
      if (!ok.length) continue;
      const s = seccaoDoCAE(ok[0] + "000");
      motivos.push(a.divisoes?.length
        ? `A atividade (CAE ${caes.find((c) => ok.includes(c.slice(0, 2)))}) está entre as divisões abrangidas.`
        : a.excluiDivisoes?.length
          ? `A atividade (${s?.nome.toLowerCase() ?? "CAE " + ok[0]}) não está entre as excluídas (divisões ${a.excluiDivisoes.join(", ")}).`
          : `Sem exclusões de setor conhecidas para esta atividade (${s?.nome.toLowerCase() ?? "CAE " + ok[0]}).`);
    }
    r.push({ apoio: a, compatibilidade: verificar ? "verificar" : "provavel", motivos, diasParaFim: a.fim ? dias(agoraISO, a.fim) : null });
  }
  const ordem = (x: ApoioCompativel) => (x.apoio.estado === "aberto" ? 0 : 1);
  return r.sort((x, y) => ordem(x) - ordem(y) || (x.diasParaFim ?? 9999) - (y.diasParaFim ?? 9999));
}

const TODAS: Dimensao[] = ["micro", "pequena", "media", "grande"];
const PME: Dimensao[] = ["micro", "pequena", "media"];
const IDE = "https://ide.madeira.gov.pt";
const COMPETE = "https://www.compete2030.gov.pt/avisos/";

/**
 * Catálogo de partida, verificado em fontes oficiais e de consultoras a 12/11/2026.
 * O administrador publica versões novas em POST /v1/admin/apoios.
 */
export const CATALOGO_BASE: Catalogo = {
  versao: "2026-11-12",
  verificadoEm: "2026-11-12",
  linhas: [
    {
      id: "m2030-2026-38", codigo: "M2030-2026-38", nome: "Funcionamento 2030 — Outros custos de funcionamento", programa: "Madeira 2030 (FEDER) · IDE-RAM",
      resumo: "Compensa custos de funcionamento acrescidos pela ultraperiferia: Segurança Social, rendas, eletricidade e água, serviços de contabilidade.",
      regioes: ["PT-MA"], dimensoes: TODAS, estado: "aberto", inicio: "2026-10-30T15:00", fim: "2026-12-04T17:00",
      apoio: "Não reembolsável: 30% (+10% no Porto Santo)", ligacao: IDE, nota: "Exige contabilidade organizada. Candidatura no Balcão dos Fundos.", verificadoEm: "2026-11-12",
    },
    {
      id: "m2030-2026-35", codigo: "M2030-2026-35", nome: "Funcionamento 2030 — Transportes", programa: "Madeira 2030 (FEDER) · IDE-RAM",
      resumo: "Compensa o custo acrescido de transportar mercadorias de e para a Madeira.",
      regioes: ["PT-MA"], dimensoes: TODAS, estado: "aberto", fim: "2026-11-20T17:00",
      apoio: "Não reembolsável", ligacao: IDE, nota: "Candidatura no Balcão dos Fundos.", verificadoEm: "2026-11-12",
    },
    {
      id: "mpr-2026-6", codigo: "MPR-2026-6", nome: "SICE — Inovação Produtiva", programa: "COMPETE 2030 e programas regionais",
      resumo: "Investimento produtivo inovador: produtos ou serviços novos, aumento de capacidade, novos processos.",
      regioes: ["PT"], territorio: "o Continente (pelo menos 40% para territórios de baixa densidade)", dimensoes: PME, excluiDivisoes: ["64", "65", "66"],
      estado: "aberto", inicio: "2026-06-15", ligacao: COMPETE,
      nota: "Candidaturas por fases: confirme no aviso a fase em curso. Exige situação económico-financeira equilibrada e efeito de incentivo.", verificadoEm: "2026-11-12",
    },
    {
      id: "mpr-2026-7", codigo: "MPr-2026-7", nome: "SIID — Demonstradores", programa: "COMPETE 2030",
      resumo: "Projetos de I&D que demonstram uma tecnologia ou produto novo em ambiente real.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2026-12-29T17:00", ligacao: COMPETE, verificadoEm: "2026-11-12",
    },
    {
      id: "mpr-2026-4", codigo: "MPr-2026-4", nome: "SIID — I&D com parceiros europeus", programa: "COMPETE 2030",
      resumo: "Internacionalização de I&D: projetos de investigação com parceiros de outros países europeus.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2026-12-29T17:00", ligacao: COMPETE, verificadoEm: "2026-11-12",
    },
    {
      id: "mpr-2026-01", codigo: "MPR-2026-01", nome: "SITCE — Descarbonização", programa: "COMPETE 2030",
      resumo: "Investimento para reduzir emissões e consumo de energia nos processos da empresa.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2026-12-30T17:00", ligacao: COMPETE, verificadoEm: "2026-11-12",
    },
    {
      id: "mpr-2026-9", codigo: "MPr-2026-9", nome: "STEP — I&D&I em tecnologias digitais e biotecnologia", programa: "COMPETE 2030 (STEP)",
      resumo: "I&D e inovação em tecnologias digitais, deep tech ou biotecnologia.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2027-01-04T17:00", ligacao: COMPETE,
      nota: "O projeto tem de ser nestas tecnologias, qualquer que seja o setor.", verificadoEm: "2026-11-12",
    },
    {
      id: "mpr-2026-10", codigo: "MPr-2026-10", nome: "STEP — Inovação produtiva em tecnologias digitais e biotecnologia", programa: "COMPETE 2030 (STEP)",
      resumo: "Investimento produtivo para fabricar ou desenvolver tecnologias digitais, deep tech ou biotecnologia.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2027-01-04T17:00", ligacao: COMPETE, verificadoEm: "2026-11-12",
    },
    {
      id: "compete2030-2026-11", codigo: "COMPETE2030-2026-11", nome: "STEP — I&D&I em tecnologias de energia limpa", programa: "COMPETE 2030 (STEP)",
      resumo: "I&D e inovação em tecnologias limpas e eficientes do ponto de vista energético.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2027-01-04T17:00", ligacao: COMPETE, verificadoEm: "2026-11-12",
    },
    {
      id: "compete2030-2026-12", codigo: "COMPETE2030-2026-12", nome: "STEP — Inovação produtiva em tecnologias de energia limpa", programa: "COMPETE 2030 (STEP)",
      resumo: "Investimento produtivo em tecnologias limpas e eficientes do ponto de vista energético.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: TODAS, estado: "aberto", fim: "2027-01-04T17:00", ligacao: COMPETE, verificadoEm: "2026-11-12",
    },
    {
      id: "sice-qualificacao-2026", codigo: "Plano anual de avisos", nome: "SICE — Qualificação das PME", programa: "Norte 2030, Centro 2030, Alentejo 2030",
      resumo: "Organização, marketing, digitalização e outros fatores de competitividade da PME.",
      regioes: ["PT"], territorio: "as regiões Norte, Centro e Alentejo", dimensoes: PME, estado: "previsto", ligacao: "https://portugal2030.pt/avisos/",
      nota: "Previsto entre o 3.º quadrimestre de 2026 e o 2.º de 2027. Bom momento para preparar o projeto.", verificadoEm: "2026-11-12",
    },
  ],
};

export function validarCatalogo(c: unknown): c is Catalogo {
  const x = c as Catalogo;
  return !!x && typeof x.versao === "string" && typeof x.verificadoEm === "string" && Array.isArray(x.linhas) &&
    x.linhas.every((l) => l && typeof l.id === "string" && typeof l.nome === "string" && Array.isArray(l.regioes) && Array.isArray(l.dimensoes) &&
      ["aberto", "previsto", "fechado"].includes(l.estado) && /^https:\/\//.test(l.ligacao));
}

export interface PedidoEstudo {
  id: string;
  apoioId: string | null;
  apoioNome: string | null;
  nome: string;
  email: string;
  telefone: string | null;
  mensagem: string | null;
  estado: "recebido" | "em_contacto" | "concluido";
  criadoEm: string;
}
