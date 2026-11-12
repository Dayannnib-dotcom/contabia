/**
 * Núcleo contabilístico: plano de contas SNC, classificação de documentos,
 * proposta de lançamentos, apuramento de IVA e ficheiro SAF-T (PT) 1.04_01.
 */
import {
  arred, REGRAS_BASE, taxasEm,
  type ApuramentoIVA, type Documento, type Empresa, type Lancamento, type LinhaLancamento, type Regiao, type Regras,
} from "@contabia/shared";
import type { Db } from "./db.ts";

export const PLANO_SNC: Record<string, string> = {
  "11": "Caixa",
  "12": "Depósitos à ordem",
  "211": "Clientes c/c",
  "2211": "Fornecedores c/c",
  "2432": "IVA dedutível",
  "2433": "IVA liquidado",
  "2711": "Fornecedores de investimentos",
  "311": "Compras de mercadorias",
  "312": "Compras de matérias-primas",
  "435": "Equipamento administrativo",
  "6221": "Trabalhos especializados",
  "6222": "Publicidade e propaganda",
  "6233": "Material de escritório",
  "6241": "Eletricidade",
  "6242": "Combustíveis",
  "6243": "Água",
  "6251": "Deslocações e estadas",
  "6253": "Transportes de mercadorias",
  "6261": "Rendas e alugueres",
  "6262": "Comunicação",
  "6263": "Seguros",
  "6266": "Despesas de representação",
  "6268": "Outros serviços",
  "71": "Vendas",
  "72": "Prestações de serviços",
};

/** Códigos de taxonomia SNC (Portaria n.º 302/2016) — preencher/validar com o Contabilista Certificado. */
export const TAXONOMIAS: Record<string, string> = {};

interface Regra { palavras: string[]; conta: string; categoria: string; dedutivel: boolean; confianca: "alta" | "media" }

const REGRAS_CLASSIFICACAO: Regra[] = [
  { palavras: ["combust", "gasoleo", "gasóleo", "gasolina", "galp", "repsol", "bp "], conta: "6242", categoria: "Combustíveis", dedutivel: true, confianca: "media" },
  { palavras: ["eletric", "elétric", "edp", "energia"], conta: "6241", categoria: "Eletricidade", dedutivel: true, confianca: "alta" },
  { palavras: ["agua", "água", "aguas", "águas"], conta: "6243", categoria: "Água", dedutivel: true, confianca: "alta" },
  { palavras: ["telecom", "comunica", "meo", "nos ", "vodafone", "internet"], conta: "6262", categoria: "Comunicação", dedutivel: true, confianca: "alta" },
  { palavras: ["renda", "arrend", "aluguer"], conta: "6261", categoria: "Rendas e alugueres", dedutivel: true, confianca: "alta" },
  { palavras: ["seguro", "seguradora"], conta: "6263", categoria: "Seguros", dedutivel: false, confianca: "alta" },
  { palavras: ["restaura", "refei", "almoço", "almoco", "jantar", "café", "cafe"], conta: "6266", categoria: "Despesas de representação", dedutivel: false, confianca: "media" },
  { palavras: ["papel", "escrit", "staples", "toner"], conta: "6233", categoria: "Material de escritório", dedutivel: true, confianca: "alta" },
  { palavras: ["publicid", "anúnc", "anunc", "marketing"], conta: "6222", categoria: "Publicidade", dedutivel: true, confianca: "alta" },
  { palavras: ["consult", "honor", "advog", "software", "licen"], conta: "6221", categoria: "Trabalhos especializados", dedutivel: true, confianca: "media" },
  { palavras: ["hotel", "viagem", "voo", "tap "], conta: "6251", categoria: "Deslocações e estadas", dedutivel: false, confianca: "media" },
  { palavras: ["transport", "ctt", "dhl", "envio"], conta: "6253", categoria: "Transportes de mercadorias", dedutivel: true, confianca: "media" },
];

export interface Classificacao { conta: string; categoria: string; ivaDedutivel: boolean; confianca: "alta" | "media"; regra?: { autoLancar: boolean } }

/** Sugere a conta: primeiro a regra do contabilista, depois o histórico do fornecedor, depois palavras-chave. */
export async function classificar(db: Db, empresaId: string, tipo: Documento["tipo"], nif: string, texto: string): Promise<Classificacao> {
  if (tipo === "venda") return { conta: "72", categoria: "Prestações de serviços", ivaDedutivel: false, confianca: "alta" };
  // 1.º a regra do contabilista para este fornecedor (manda sempre)
  const [regra] = await db.query<{ conta: string; iva_dedutivel: boolean; auto_lancar: boolean }>(
    `SELECT conta, iva_dedutivel, auto_lancar FROM regras_fornecedor WHERE empresa_id = $1 AND nif = $2`, [empresaId, nif]);
  if (regra) return { conta: regra.conta, categoria: PLANO_SNC[regra.conta] ?? "Regra do contabilista", ivaDedutivel: regra.iva_dedutivel, confianca: "alta", regra: { autoLancar: regra.auto_lancar } };
  const [hist] = await db.query<{ conta: string; usos: number }>(
    `SELECT conta, usos FROM fornecedor_contas WHERE empresa_id = $1 AND nif = $2`, [empresaId, nif],
  );
  if (hist) {
    const r = REGRAS_CLASSIFICACAO.find((x) => x.conta === hist.conta);
    return { conta: hist.conta, categoria: PLANO_SNC[hist.conta] ?? "Outros", ivaDedutivel: r?.dedutivel ?? true, confianca: hist.usos >= 2 ? "alta" : "media" };
  }
  const t = ` ${texto.toLowerCase()} `;
  const r = REGRAS_CLASSIFICACAO.find((x) => x.palavras.some((p) => t.includes(p)));
  if (r) return { conta: r.conta, categoria: r.categoria, ivaDedutivel: r.dedutivel, confianca: r.confianca };
  return { conta: "6268", categoria: "Outros serviços", ivaDedutivel: true, confianca: "media" };
}

/** Aprende com a validação: o próximo documento deste fornecedor vem com a conta certa. */
export async function aprender(db: Db, empresaId: string, nif: string, conta: string) {
  await db.query(
    `INSERT INTO fornecedor_contas (empresa_id, nif, conta, usos) VALUES ($1, $2, $3, 1)
     ON CONFLICT (empresa_id, nif) DO UPDATE SET usos = CASE WHEN fornecedor_contas.conta = $3 THEN fornecedor_contas.usos + 1 ELSE 1 END, conta = $3`,
    [empresaId, nif, conta],
  );
}

/** Proposta de lançamento a partir de um documento validado (partidas dobradas). */
export function proporLinhas(d: Documento): LinhaLancamento[] {
  const desc = `${d.numero} · ${d.terceiroNome}`;
  if (d.tipo === "venda") {
    return [
      { conta: "211", descricao: desc, debito: d.total, credito: 0 },
      { conta: d.contaSugerida || "72", descricao: desc, debito: 0, credito: d.base },
      ...(d.iva ? [{ conta: "2433", descricao: `IVA liquidado ${d.taxa}%`, debito: 0, credito: d.iva }] : []),
    ];
  }
  const fornecedor = d.contaSugerida.startsWith("43") ? "2711" : "2211";
  if (d.ivaDedutivel && d.iva) {
    return [
      { conta: d.contaSugerida, descricao: desc, debito: d.base, credito: 0 },
      { conta: "2432", descricao: `IVA dedutível ${d.taxa}%`, debito: d.iva, credito: 0 },
      { conta: fornecedor, descricao: desc, debito: 0, credito: d.total },
    ];
  }
  return [
    { conta: d.contaSugerida, descricao: `${desc} (IVA não dedutível)`, debito: d.total, credito: 0 },
    { conta: fornecedor, descricao: desc, debito: 0, credito: d.total },
  ];
}

export function equilibrado(linhas: LinhaLancamento[]): boolean {
  const deb = linhas.reduce((s, l) => s + l.debito, 0);
  const cre = linhas.reduce((s, l) => s + l.credito, 0);
  return Math.abs(deb - cre) < 0.005 && deb > 0;
}

export function diarioDe(tipo: Documento["tipo"]): string {
  return tipo === "venda" ? "11 · Vendas" : tipo === "banco" ? "31 · Bancos" : "21 · Compras";
}

// ───────────── Períodos de IVA ─────────────

/** "2026-10" → ["2026-10"]; "2026T3" → ["2026-07","2026-08","2026-09"] */
export function mesesDoPeriodo(p: string): string[] {
  const t = /^(\d{4})T([1-4])$/.exec(p);
  if (t) {
    const ini = (Number(t[2]) - 1) * 3 + 1;
    return [0, 1, 2].map((k) => `${t[1]}-${String(ini + k).padStart(2, "0")}`);
  }
  if (/^\d{4}-\d{2}$/.test(p)) return [p];
  throw new Error("Período inválido");
}

export function periodoIVADoMes(mes: string, regime: Empresa["regimeIVA"]): string {
  if (regime === "mensal") return mes;
  const [a, m] = mes.split("-").map(Number);
  return `${a}T${Math.ceil(m / 3)}`;
}

function tipoTaxa(regras: Regras, regiao: Regiao, taxa: number, data: string): "reduzida" | "intermedia" | "normal" | "isenta" {
  if (!taxa) return "isenta";
  const t = taxasEm(regras, regiao, data);
  if (taxa === t.reduzida) return "reduzida";
  if (taxa === t.intermedia) return "intermedia";
  return "normal";
}

/** Apuramento por campos da declaração periódica, a partir dos lançamentos lançados. */
export async function apurarIVA(db: Db, empresa: Empresa, periodo: string, regras: Regras = REGRAS_BASE): Promise<ApuramentoIVA> {
  const meses = mesesDoPeriodo(periodo);
  const docs = await db.query<{ tipo: string; base: string; iva: string; taxa: string; data: string; conta_sugerida: string; iva_dedutivel: boolean; espaco_fiscal: string }>(
    `SELECT d.tipo, d.base, d.iva, d.taxa, d.data, d.conta_sugerida, d.iva_dedutivel, d.espaco_fiscal
       FROM lancamentos l JOIN documentos d ON d.id = l.documento_id
      WHERE l.empresa_id = $1 AND l.estado = 'lancado' AND l.periodo = ANY($2::text[])`,
    [empresa.id, meses],
  );
  const [{ n }] = await db.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM lancamentos WHERE empresa_id = $1 AND estado = 'proposto' AND periodo = ANY($2::text[])`,
    [empresa.id, meses],
  );
  const c: Record<string, number> = {};
  const add = (k: string, v: number) => (c[k] = arred((c[k] ?? 0) + v));
  for (const d of docs) {
    const base = Number(d.base), iva = Number(d.iva), taxa = Number(d.taxa);
    const regiao = (["PT", "PT-MA", "PT-AC"].includes(d.espaco_fiscal) ? d.espaco_fiscal : empresa.regiao) as Regiao;
    const tt = tipoTaxa(regras, regiao, taxa, d.data);
    if (d.tipo === "venda") {
      if (tt === "reduzida") { add("1", base); add("2", iva); }
      else if (tt === "intermedia") { add("5", base); add("6", iva); }
      else if (tt === "normal") { add("3", base); add("4", iva); }
    } else if (d.iva_dedutivel && iva) {
      const conta = d.conta_sugerida;
      if (conta.startsWith("43") || conta.startsWith("44")) add("20", iva);
      else if (conta.startsWith("31") || conta.startsWith("32")) add(tt === "reduzida" ? "21" : tt === "intermedia" ? "22" : "23", iva);
      else add("24", iva);
    }
  }
  const DESC: Record<string, string> = {
    "1": "Base tributável · taxa reduzida", "2": "IVA liquidado · taxa reduzida",
    "5": "Base tributável · taxa intermédia", "6": "IVA liquidado · taxa intermédia",
    "3": "Base tributável · taxa normal", "4": "IVA liquidado · taxa normal",
    "20": "IVA dedutível · ativos fixos tangíveis e intangíveis",
    "21": "IVA dedutível · existências à taxa reduzida", "22": "IVA dedutível · existências à taxa intermédia",
    "23": "IVA dedutível · existências à taxa normal", "24": "IVA dedutível · outros bens e serviços",
  };
  const ordem = ["1", "2", "5", "6", "3", "4", "20", "21", "22", "23", "24"];
  const campos = ordem.filter((k) => c[k]).map((k) => ({ campo: k, descricao: DESC[k], valor: c[k] }));
  const liquidado = (c["2"] ?? 0) + (c["6"] ?? 0) + (c["4"] ?? 0);
  const dedutivel = (c["20"] ?? 0) + (c["21"] ?? 0) + (c["22"] ?? 0) + (c["23"] ?? 0) + (c["24"] ?? 0);
  const saldo = arred(liquidado - dedutivel);
  const resultado = saldo >= 0
    ? { campo: "93", descricao: "Imposto a favor do Estado", valor: saldo }
    : { campo: "94", descricao: "Imposto a favor do sujeito passivo", valor: -saldo };
  return { periodo, campos, resultado, lancamentosPendentes: n };
}

// ───────────── Ficheiros ─────────────

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const v2 = (n: number) => n.toFixed(2);

/**
 * Ficheiro de apoio à declaração periódica (estrutura interna Contabia).
 * Antes de produção: mapear para o formato oficial de importação do Portal das Finanças.
 */
export function xmlDP(empresa: Empresa, a: ApuramentoIVA): string {
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<DeclaracaoPeriodicaIVA nif="${empresa.nif}" periodo="${a.periodo}" regime="${empresa.regimeIVA}" gerado="${new Date().toISOString()}">`,
    ...a.campos.map((c) => `  <Campo numero="${c.campo}">${v2(c.valor)}</Campo>`),
    `  <Campo numero="${a.resultado.campo}">${v2(a.resultado.valor)}</Campo>`,
    `</DeclaracaoPeriodicaIVA>`,
  ].join("\n");
}

/** SAF-T (PT) 1.04_01 da contabilidade para um exercício. */
export async function gerarSAFT(db: Db, empresa: Empresa, ano: number): Promise<{ xml: string; avisos: string[] }> {
  const lancs = await db.query<{ id: string; diario: string; data: string; periodo: string; descricao: string; linhas: LinhaLancamento[]; criado_em: string }>(
    `SELECT id, diario, data, periodo, descricao, linhas, criado_em FROM lancamentos
      WHERE empresa_id = $1 AND estado IN ('lancado','estornado') AND periodo LIKE $2 ORDER BY data, criado_em`,
    [empresa.id, `${ano}-%`],
  );
  const terceiros = await db.query<{ tipo: string; terceiro_nif: string; terceiro_nome: string }>(
    `SELECT DISTINCT tipo, terceiro_nif, terceiro_nome FROM documentos WHERE empresa_id = $1 AND data LIKE $2 AND estado <> 'anulado'`,
    [empresa.id, `${ano}-%`],
  );
  const avisos: string[] = [];
  const saldos = new Map<string, { d: number; c: number }>();
  let totD = 0, totC = 0;
  for (const l of lancs) for (const x of l.linhas) {
    const s = saldos.get(x.conta) ?? { d: 0, c: 0 };
    s.d += x.debito; s.c += x.credito; saldos.set(x.conta, s);
    totD += x.debito; totC += x.credito;
  }
  const contas = [...saldos.keys()].sort();
  for (const c of contas) if (!TAXONOMIAS[c]) avisos.push(`Conta ${c} sem código de taxonomia`);
  for (const t of terceiros) if (!t.terceiro_nif || t.terceiro_nif === "999999990") avisos.push(`Terceiro sem NIF: ${t.terceiro_nome}`);

  const diarios = new Map<string, typeof lancs>();
  for (const l of lancs) diarios.set(l.diario, [...(diarios.get(l.diario) ?? []), l]);

  const conta = (c: string) => {
    const s = saldos.get(c)!;
    const saldo = s.d - s.c;
    return `      <Account><AccountID>${c}</AccountID><AccountDescription>${esc(PLANO_SNC[c] ?? c)}</AccountDescription><OpeningDebitBalance>0.00</OpeningDebitBalance><OpeningCreditBalance>0.00</OpeningCreditBalance><ClosingDebitBalance>${v2(Math.max(saldo, 0))}</ClosingDebitBalance><ClosingCreditBalance>${v2(Math.max(-saldo, 0))}</ClosingCreditBalance><GroupingCategory>GM</GroupingCategory><GroupingCode>${c.slice(0, Math.max(1, c.length - 1))}</GroupingCode>${TAXONOMIAS[c] ? `<TaxonomyCode>${TAXONOMIAS[c]}</TaxonomyCode>` : ""}</Account>`;
  };
  const terceiro = (t: { tipo: string; terceiro_nif: string; terceiro_nome: string }) => {
    const ehCliente = t.tipo === "venda";
    const tag = ehCliente ? "Customer" : "Supplier";
    const idTag = ehCliente ? "CustomerID" : "SupplierID";
    return `    <${tag}><${idTag}>${t.terceiro_nif}</${idTag}><AccountID>${ehCliente ? "211" : "2211"}</AccountID><${ehCliente ? "CustomerTaxID" : "SupplierTaxID"}>${t.terceiro_nif}</${ehCliente ? "CustomerTaxID" : "SupplierTaxID"}><CompanyName>${esc(t.terceiro_nome)}</CompanyName><BillingAddress><AddressDetail>Desconhecido</AddressDetail><City>Desconhecido</City><PostalCode>Desconhecido</PostalCode><Country>PT</Country></BillingAddress><SelfBillingIndicator>0</SelfBillingIndicator></${tag}>`;
  };
  let rec = 0;
  const journals = [...diarios.entries()].map(([nome, ls]) => {
    const [jid, ...resto] = nome.split(" · ");
    const txs = ls.map((l, i) => {
      const linhasD = l.linhas.filter((x) => x.debito).map((x) => `            <DebitLine><RecordID>${++rec}</RecordID><AccountID>${x.conta}</AccountID><SystemEntryDate>${l.criado_em.slice(0, 19)}</SystemEntryDate><Description>${esc(x.descricao)}</Description><DebitAmount>${v2(x.debito)}</DebitAmount></DebitLine>`);
      const linhasC = l.linhas.filter((x) => x.credito).map((x) => `            <CreditLine><RecordID>${++rec}</RecordID><AccountID>${x.conta}</AccountID><SystemEntryDate>${l.criado_em.slice(0, 19)}</SystemEntryDate><Description>${esc(x.descricao)}</Description><CreditAmount>${v2(x.credito)}</CreditAmount></CreditLine>`);
      return `        <Transaction><TransactionID>${l.data} ${jid} ${i + 1}</TransactionID><Period>${Number(l.periodo.slice(5, 7))}</Period><TransactionDate>${l.data}</TransactionDate><SourceID>Contabia</SourceID><Description>${esc(l.descricao)}</Description><DocArchivalNumber>${i + 1}</DocArchivalNumber><TransactionType>N</TransactionType><GLPostingDate>${l.criado_em.slice(0, 10)}</GLPostingDate><Lines>
${[...linhasD, ...linhasC].join("\n")}
          </Lines></Transaction>`;
    });
    return `      <Journal><JournalID>${jid}</JournalID><Description>${esc(resto.join(" ") || nome)}</Description>
${txs.join("\n")}
      </Journal>`;
  });
  const hoje = new Date().toISOString().slice(0, 10);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<AuditFile xmlns="urn:OECD:StandardAuditFile-Tax:PT_1.04_01">
  <Header>
    <AuditFileVersion>1.04_01</AuditFileVersion>
    <CompanyID>${empresa.nif}</CompanyID>
    <TaxRegistrationNumber>${empresa.nif}</TaxRegistrationNumber>
    <TaxAccountingBasis>C</TaxAccountingBasis>
    <CompanyName>${esc(empresa.nome)}</CompanyName>
    <CompanyAddress><AddressDetail>Desconhecido</AddressDetail><City>Desconhecido</City><PostalCode>Desconhecido</PostalCode><Country>PT</Country></CompanyAddress>
    <FiscalYear>${ano}</FiscalYear>
    <StartDate>${ano}-01-01</StartDate>
    <EndDate>${ano}-12-31</EndDate>
    <CurrencyCode>EUR</CurrencyCode>
    <DateCreated>${hoje}</DateCreated>
    <TaxEntity>Global</TaxEntity>
    <ProductCompanyTaxID>${empresa.nif}</ProductCompanyTaxID>
    <SoftwareCertificateNumber>0</SoftwareCertificateNumber>
    <ProductID>Contabia/Contabia</ProductID>
    <ProductVersion>0.1.0</ProductVersion>
  </Header>
  <MasterFiles>
    <GeneralLedgerAccounts>
      <TaxonomyReference>S</TaxonomyReference>
${contas.map(conta).join("\n")}
    </GeneralLedgerAccounts>
${terceiros.map(terceiro).join("\n")}
  </MasterFiles>
  <GeneralLedgerEntries>
    <NumberOfEntries>${lancs.length}</NumberOfEntries>
    <TotalDebit>${v2(totD)}</TotalDebit>
    <TotalCredit>${v2(totC)}</TotalCredit>
${journals.join("\n")}
  </GeneralLedgerEntries>
</AuditFile>
`;
  if (Math.abs(totD - totC) > 0.005) avisos.push("Total a débito diferente do total a crédito");
  return { xml, avisos };
}

export function lancamentoDeLinha(l: {
  id: string; empresa_id: string; documento_id: string | null; diario: string; data: string; periodo: string; descricao: string;
  linhas: LinhaLancamento[]; estado: string; confianca: string; versao: number;
}): Lancamento {
  return {
    id: l.id, empresaId: l.empresa_id, documentoId: l.documento_id, diario: l.diario, data: l.data, periodo: l.periodo,
    descricao: l.descricao, linhas: l.linhas, estado: l.estado as Lancamento["estado"], confianca: l.confianca as Lancamento["confianca"], versao: Number(l.versao),
  };
}
