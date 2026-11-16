import { test } from "node:test";
import assert from "node:assert/strict";
import { perguntar, type ChamarModelo, type ContextoAssistente } from "../src/assistente.ts";

const ctx = { empresa: { nome: "Papelaria Atlântico" }, pedidosPendentes: [], documentosPorValidar: 0 } as unknown as ContextoAssistente;
const resposta = (confianca: "alta" | "baixa", texto = "ok") => ({ resposta: texto, fontes: ["CIVA, art. 21.º"], encaminharParaContabilista: false, confianca, entrada: 1000, saida: 100 });

test("perguntas frequentes ficam nas regras, sem gastar IA", async () => {
  let chamadas = 0;
  const chamar: ChamarModelo = async () => { chamadas++; return resposta("alta"); };
  const r = await perguntar("Posso deduzir o IVA de um almoço?", ctx, { chaveApi: "k", chamar });
  assert.equal(chamadas, 0);
  assert.match(r.resposta, /Em regra, não/);
});

test("o modelo rápido responde quando tem confiança; o forte não é chamado", async () => {
  const modelos: string[] = [];
  const chamar: ChamarModelo = async (m) => { modelos.push(m); return resposta("alta", "rápido"); };
  const r = await perguntar("Como se amortiza uma carrinha usada?", ctx, { chaveApi: "k", chamar });
  assert.deepEqual(modelos, ["claude-haiku-5-5"]);
  assert.equal(r.resposta, "rápido");
});

test("com pouca confiança sobe ao modelo forte e regista o uso dos dois", async () => {
  const usos: string[] = [];
  const chamar: ChamarModelo = async (m) => (m.includes("haiku") ? resposta("baixa", "rápido") : resposta("alta", "forte"));
  const r = await perguntar("Como se amortiza uma carrinha usada?", ctx, { chaveApi: "k", chamar, registarUso: async (m) => { usos.push(m); } });
  assert.equal(r.resposta, "forte");
  assert.deepEqual(usos, ["claude-haiku-5-5", "claude-sonnet-5-5"]);
});

test("sem orçamento no mês ou com erro, volta às regras e encaminha ao contabilista", async () => {
  const semOrcamento = await perguntar("Como se amortiza uma carrinha usada?", ctx, { chaveApi: "k", podeUsar: async () => false, chamar: async () => resposta("alta") });
  assert.equal(semOrcamento.encaminharParaContabilista, true);
  const comErro = await perguntar("Como se amortiza uma carrinha usada?", ctx, { chaveApi: "k", chamar: async () => { throw new Error("tempo esgotado"); } });
  assert.equal(comErro.encaminharParaContabilista, true);
});
