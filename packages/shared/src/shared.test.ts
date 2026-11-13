import assert from "node:assert/strict";
import { test } from "node:test";
import { validarNIF, ajudaNIF, normalizarUtilizador, utilizadorValido } from "./nif.ts";
import { lerQR, qrConsistente } from "./qr.ts";
import { REGRAS_BASE, taxa, obrigacoesDoMes, proximasObrigacoes, diaUtil } from "./regras.ts";
import { euros, nomePeriodo } from "./formato.ts";

test("NIF", () => {
  assert.equal(validarNIF("509 999 999"), true);
  assert.equal(validarNIF("500000000"), true);
  assert.equal(validarNIF("509999998"), false);
  assert.equal(validarNIF("409999999"), false);
  assert.equal(ajudaNIF("5099").estado, "incompleto");
  assert.equal(ajudaNIF("509999998").estado, "invalido");
  assert.equal(normalizarUtilizador(" Empresa Á "), "empresa.a");
  assert.equal(utilizadorValido("empresa.a"), true);
  assert.equal(utilizadorValido("a"), false);
});

test("QR da fatura (Portaria 195/2020)", () => {
  const qr = "A:509999999*B:500000000*C:PT*D:FT*E:N*F:20261110*G:FT 2026/418*H:ABCD1234-418*I1:PT-MA*I7:120.00*I8:26.40*N:26.40*O:146.40*Q:Ab1C*R:9999";
  const d = lerQR(qr);
  assert.equal(d.data, "2026-11-10");
  assert.equal(d.espacoFiscal, "PT-MA");
  assert.equal(d.bases.normal, 120);
  assert.equal(d.total, 146.4);
  assert.equal(qrConsistente(d), true);
  assert.throws(() => lerQR("A:1*B:2"));
});

test("Taxas de IVA por região e data", () => {
  assert.equal(taxa(REGRAS_BASE, "PT", "normal", "2026-11-11"), 23);
  assert.equal(taxa(REGRAS_BASE, "PT-MA", "normal", "2026-11-11"), 22);
  assert.equal(taxa(REGRAS_BASE, "PT-MA", "reduzida", "2024-09-30"), 5);
  assert.equal(taxa(REGRAS_BASE, "PT-MA", "reduzida", "2024-10-01"), 4);
  assert.equal(taxa(REGRAS_BASE, "PT-AC", "intermedia", "2026-01-01"), 9);
});

test("Calendário fiscal", () => {
  assert.equal(diaUtil(2026, 12, 5), "2026-12-07"); // sábado → segunda
  const set = obrigacoesDoMes(2026, 9, "trimestral");
  const dp = set.find((o) => o.codigo === "dp_iva");
  assert.equal(dp?.periodo, "2026T3");
  assert.equal(dp?.prazo, "2026-11-20");
  assert.equal(obrigacoesDoMes(2026, 8, "trimestral").some((o) => o.codigo === "dp_iva"), false);
  const prox = proximasObrigacoes("2026-11-11", "trimestral");
  assert.equal(prox.at(0)?.codigo, "dp_iva");
  const prorrogada = obrigacoesDoMes(2026, 4, "mensal", { ...REGRAS_BASE, prorrogacoes: [{ obrigacao: "efatura", periodo: "2026-04", novoPrazo: "2026-05-08", fonte: "Despacho" }] });
  assert.equal(prorrogada.find((o) => o.codigo === "efatura")?.prazo, "2026-05-08");
});

test("Formatação", () => {
  assert.equal(euros(1967.4), "1 967,40 €");
  assert.equal(euros(-370.5), "−370,50 €");
  assert.equal(nomePeriodo("2026T3"), "3.º trimestre de 2026");
  assert.equal(nomePeriodo("2026-10"), "outubro de 2026");
});

test("leitura do CSV exportado do e-Fatura", async () => {
  const { lerCSVEfatura } = await import("./efatura.ts");
  const csv = [
    "Setor;Emitente;Nº Fatura / ATCUD;Tipo;Data Emissão;Total;IVA;Base Tributável;Situação",
    "Outros;500000000 - Papelaria Atlântico, Lda.;FT 2026/418 / JFG3-418;Fatura;15/09/2026;146,40 €;26,40 €;120,00 €;Registado",
    "Outros;509999999 - Combustíveis SA;FS A/77 / ABCD-77;Fatura simplificada;2026-10-02;1.230,00;230,00;1.000,00;Registado",
    "Outros;123456788 - NIF errado;FT 1;Fatura;01/10/2026;10;0;10;Registado",
    "Outros;500000000 - Papelaria;NC 2026/5;Nota de crédito;03/10/2026;12,30;2,30;10,00;Registado",
    "Outros;500000000 - Papelaria;FT 2026/9;Fatura;03/10/2026;12,30;2,30;10,00;Anulado",
  ].join("\r\n");
  const r = lerCSVEfatura(csv);
  assert.equal(r.linhas.length, 2);
  assert.deepEqual(r.linhas[0], { nif: "500000000", nome: "Papelaria Atlântico, Lda.", numero: "FT 2026/418", atcud: "JFG3-418", data: "2026-09-15", base: 120, iva: 26.4, total: 146.4, tipoDoc: "Fatura", situacao: "Registado" });
  assert.equal(r.linhas[1].base, 1000);
  assert.equal(r.ignoradas.length, 3);
  assert.match(lerCSVEfatura("a;b\n1;2").ignoradas[0].motivo, /Não reconheço/);
});

test("leitura do extrato bancário (montante único ou débito/crédito, com linhas antes do cabeçalho)", async () => {
  const { lerCSVExtrato } = await import("./extrato.ts");
  const a = lerCSVExtrato(["Conta;0035 0001 000123456789", "Titular;ATLANTICO SERVICOS LDA", "", "Data Mov.;Data Valor;Descrição;Montante;Saldo", "02-11-2026;02-11-2026;COMPRA PAPELARIA ATLANTICO;-61,00;1.000,00", "05/11/2026;05/11/2026;TRF RECEBIDA CLIENTE X;1.230,00;2.230,00", "Saldo final;;;;2.230,00"].join("\n"));
  assert.deepEqual(a.movimentos, [{ data: "2026-11-02", descricao: "COMPRA PAPELARIA ATLANTICO", valor: -61 }, { data: "2026-11-05", descricao: "TRF RECEBIDA CLIENTE X", valor: 1230 }]);
  const b = lerCSVExtrato("Data;Descritivo;Débito;Crédito\n2026-10-01;DD EDP;45,30;\n2026-10-03;TRF;;100,00\n");
  assert.deepEqual(b.movimentos.map((m) => m.valor), [-45.3, 100]);
});

test("CAE Rev. 4 e apoios compatíveis", async () => {
  const { erroCAE, apoiosCompativeis, SECCOES_CAE } = await import("./apoios.ts");
  const { CATALOGO_TESTE: CATALOGO_BASE } = await import("./catalogo-teste.ts");
  assert.equal(SECCOES_CAE.flatMap((s) => s.divisoes).length, 87, "a NACE Rev. 2.1 tem 87 divisões");
  assert.equal(erroCAE("56111"), null);
  assert.equal(erroCAE("56.111"), null);
  assert.match(erroCAE("45200")!, /Rev\. 4/);
  assert.match(erroCAE("04000")!, /não existe/);
  assert.match(erroCAE("5611")!, /5 algarismos/);
  const madeira = apoiosCompativeis({ cae: "56111", caesSecundarios: [], dimensao: "micro", regiao: "PT-MA" }, CATALOGO_BASE, "2026-11-11T10:00:00Z");
  assert.ok(madeira.every((a) => a.apoio.regioes.includes("PT-MA")));
  // prazo passado: desaparece
  const tarde = apoiosCompativeis({ cae: "56111", caesSecundarios: [], dimensao: "micro", regiao: "PT-MA" }, CATALOGO_BASE, "2026-11-21T10:00:00Z");
  assert.ok(!tarde.some((a) => a.apoio.id === "m2030-2026-35"));
  // grande empresa não vê avisos só para PME
  const grande = apoiosCompativeis({ cae: "25110", caesSecundarios: [], dimensao: "grande", regiao: "PT" }, CATALOGO_BASE, "2026-11-11T10:00:00Z");
  assert.ok(!grande.some((a) => a.apoio.id === "mpr-2026-6"));
  // um CAE secundário elegível chega
  const sec = apoiosCompativeis({ cae: "64190", caesSecundarios: ["62010"], dimensao: "pequena", regiao: "PT" }, CATALOGO_BASE, "2026-11-11T10:00:00Z");
  assert.ok(sec.some((a) => a.apoio.id === "mpr-2026-6"));
});

test("o catálogo real de apoios está bem formado (protege a revisão automática)", async () => {
  const { CATALOGO_BASE, validarCatalogo, erroCAE } = await import("./apoios.ts");
  assert.ok(validarCatalogo(CATALOGO_BASE));
  assert.match(CATALOGO_BASE.versao, /^\d{4}-\d{2}-\d{2}/);
  assert.match(CATALOGO_BASE.verificadoEm, /^\d{4}-\d{2}-\d{2}$/);
  const ids = CATALOGO_BASE.linhas.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length, "ids repetidos");
  for (const l of CATALOGO_BASE.linhas) {
    if (l.fim) assert.match(l.fim, /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, l.id);
    if (l.inicio) assert.match(l.inicio, /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/, l.id);
    assert.ok(l.regioes.every((r) => ["PT", "PT-MA", "PT-AC"].includes(r)), l.id);
    assert.ok(l.dimensoes.length && l.dimensoes.every((d) => ["micro", "pequena", "media", "grande"].includes(d)), l.id);
    for (const d of [...(l.divisoes ?? []), ...(l.excluiDivisoes ?? [])]) assert.equal(erroCAE(d + "000"), null, `${l.id}: divisão ${d}`);
    assert.ok(l.resumo.length > 10 && l.programa.length > 2, l.id);
  }
});

test("respostas rápidas: modelos, WhatsApp e e-mail prontos", async () => {
  const { gerarResposta, ligacaoWhatsApp, ligacaoEmail, telefoneInternacional, MODELOS_RESPOSTA } = await import("./respostas.ts");
  const r = gerarResposta("lembrete_prazo", { empresa: "Atlântico, Lda.", contacto: "Rita Gomes", contabilista: "Ana Sousa", obrigacao: "Declaração periódica de IVA", prazo: "2026-11-20" });
  assert.match(r.texto, /^Olá, Rita\./);
  assert.match(r.texto, /termina a 20\/11\/2026/);
  assert.match(r.texto, /Ana Sousa$/);
  assert.equal(r.assunto, "Atlântico, Lda. — Declaração periódica de IVA até 20/11/2026");
  assert.ok(MODELOS_RESPOSTA.every((m) => m.texto({ empresa: "X" }).length > 10), "todos os modelos funcionam sem dados opcionais");
  assert.match(gerarResposta("iva_a_pagar", { empresa: "X", valor: 1234.5 }).texto, /1234,50\s€|1\s?234,50\s€/);
  assert.equal(telefoneInternacional("912 345 678"), "351912345678");
  assert.equal(telefoneInternacional("+351 291 000 000"), "351291000000");
  assert.equal(telefoneInternacional("0034 600 111 222"), "34600111222");
  assert.equal(telefoneInternacional("123"), null);
  assert.equal(ligacaoWhatsApp("912345678", "Olá & até já"), "https://wa.me/351912345678?text=Ol%C3%A1%20%26%20at%C3%A9%20j%C3%A1");
  assert.equal(ligacaoWhatsApp(null, "x"), null);
  assert.match(ligacaoEmail("rita@x.pt", "Assunto", "Linha 1\nLinha 2")!, /^mailto:rita@x\.pt\?subject=Assunto&body=Linha%201%0ALinha%202$/);
  assert.equal(ligacaoEmail("sem-arroba", "a", "b"), null);
});
