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
