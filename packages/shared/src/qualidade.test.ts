import assert from "node:assert/strict";
import { test } from "node:test";
import { auditarDocumento, type ContextoQualidade } from "./qualidade.ts";

const base: ContextoQualidade = { hoje: "2026-11-16", semelhantes: [], documentosDoTerceiro: 3, mediaCompras: 120, periodoDeclarado: null };
const doc = { tipo: "compra", numero: "FT 2026/88", data: "2026-11-10", total: 146.4, terceiroNome: "Papelaria Atlântico" };

test("documento normal: sem alertas", () => {
  assert.deepEqual(auditarDocumento(doc, base), []);
});

test("mesmo fornecedor e valor com outro número: possível despesa repetida", () => {
  const a = auditarDocumento(doc, { ...base, semelhantes: [{ numero: "FR 2026/12", data: "2026-11-09" }] });
  assert.equal(a[0].tipo, "possivel_duplicado");
  assert.match(a[0].detalhe, /FR 2026\/12 de 09\/11\/2026/);
});

test("período de IVA já declarado: alerta urgente", () => {
  const a = auditarDocumento(doc, { ...base, periodoDeclarado: "2026T3" });
  assert.equal(a[0].tipo, "periodo_ja_declarado");
  assert.equal(a[0].urgencia, "alta");
});

test("fornecedor novo com valor alto, mas não abaixo de 1000 € nem para vendas", () => {
  const novo = { ...base, documentosDoTerceiro: 0 };
  assert.equal(auditarDocumento({ ...doc, total: 2500 }, novo)[0].tipo, "fornecedor_novo_valor_alto");
  assert.deepEqual(auditarDocumento({ ...doc, total: 900 }, novo), []);
  assert.deepEqual(auditarDocumento({ ...doc, tipo: "venda", total: 2500 }, novo), []);
});

test("documento com mais de um ano", () => {
  assert.equal(auditarDocumento({ ...doc, data: "2025-10-01" }, base)[0].tipo, "documento_antigo");
});
