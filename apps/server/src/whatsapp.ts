/**
 * WhatsApp Business Platform (Cloud API da Meta) — número oficial da Contabia.
 *
 * Porquê um número central: o contabilista não precisa de passar a conta pessoal para Business.
 *  - Lembretes automáticos (modelos aprovados pela Meta) saem do número da Contabia, em nome do gabinete,
 *    e só para quem deu consentimento expresso (pode responder PARAR a qualquer momento).
 *  - O que o cliente responder chega ao contabilista como aviso urgente, com a resposta pronta;
 *    o contabilista responde pelo WhatsApp dele (wa.me) ou pela app.
 * Sem as variáveis WHATSAPP_* nada é enviado e o resto da app funciona igual.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyInstance } from "fastify";
import type { Db } from "./db.ts";
import { telefoneInternacional } from "@contabia/shared";

export interface CfgWhatsApp {
  token?: string;        // WHATSAPP_TOKEN (token permanente do utilizador de sistema)
  numeroId?: string;     // WHATSAPP_NUMERO_ID (Phone number ID)
  segredoApp?: string;   // WHATSAPP_APP_SEGREDO (App secret, para validar os webhooks)
  tokenVerificar?: string; // WHATSAPP_VERIFICAR (inventado por nós, para o Meta validar o webhook)
  enviar?: EnviarWhatsApp;
}
export type MensagemWhatsApp =
  | { para: string; tipo: "modelo"; modelo: string; idioma: string; parametros: string[] }
  | { para: string; tipo: "texto"; texto: string };
export type EnviarWhatsApp = (m: MensagemWhatsApp) => Promise<boolean>;

/** Modelos a submeter para aprovação na Meta (categoria Utilidade, idioma pt_PT). */
export const MODELOS_WHATSAPP = {
  lembrete_prazo: {
    nome: "contabia_lembrete_prazo",
    texto: "Olá, {{1}}. {{2}} termina a {{3}}. Para o seu contabilista submeter a tempo, carregue na app Contabia as faturas que faltam. Responda PARAR para deixar de receber estes lembretes.",
  },
  pedido_documento: {
    nome: "contabia_pedido_documento",
    texto: "Olá, {{1}}. O seu contabilista pede: {{2}}. Pode fotografar o documento na app Contabia. Responda PARAR para deixar de receber estes lembretes.",
  },
} as const;

const PALAVRAS_PARAR = /^\s*(parar|stop|sair|cancelar)\s*[.!]?\s*$/i;

export function criarWhatsApp(db: Db, c: CfgWhatsApp, agora: () => Date) {
  const ativo = !!(c.token && c.numeroId);
  const enviarReal: EnviarWhatsApp = async (m) => {
    const corpo = m.tipo === "modelo"
      ? { messaging_product: "whatsapp", to: m.para, type: "template", template: { name: m.modelo, language: { code: m.idioma }, components: [{ type: "body", parameters: m.parametros.map((t) => ({ type: "text", text: t })) }] } }
      : { messaging_product: "whatsapp", to: m.para, type: "text", text: { body: m.texto } };
    const r = await fetch(`https://graph.facebook.com/v21.0/${c.numeroId}/messages`, {
      method: "POST", headers: { authorization: `Bearer ${c.token}`, "content-type": "application/json" }, body: JSON.stringify(corpo), signal: AbortSignal.timeout(10_000),
    });
    return r.ok;
  };
  const enviar = c.enviar ?? enviarReal;

  /** Envia um modelo a uma empresa com consentimento; não repete a mesma chave. */
  async function lembrete(chave: string, empresaId: string, modelo: keyof typeof MODELOS_WHATSAPP, parametros: string[]) {
    if (!ativo && !c.enviar) return false;
    const [e] = await db.query<{ telefone: string | null; whatsapp_consentimento_em: string | null }>(`SELECT telefone, whatsapp_consentimento_em FROM empresas WHERE id = $1`, [empresaId]);
    const para = telefoneInternacional(e?.telefone);
    if (!para || !e?.whatsapp_consentimento_em) return false;
    const [novo] = await db.query(`INSERT INTO emails_enviados (chave, em) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING chave`, [`wa:${chave}`, agora().toISOString()]);
    if (!novo) return false;
    return enviar({ para, tipo: "modelo", modelo: MODELOS_WHATSAPP[modelo].nome, idioma: "pt_PT", parametros }).catch(() => false);
  }

  /** Rotas do webhook da Meta: verificação (GET) e mensagens recebidas (POST, assinadas). */
  function rotas(app: FastifyInstance, aoRecebido: (empresaId: string, texto: string) => Promise<void>) {
    app.get("/v1/whatsapp/webhook", async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      if (q["hub.mode"] === "subscribe" && c.tokenVerificar && q["hub.verify_token"] === c.tokenVerificar) return reply.type("text/plain").send(q["hub.challenge"] ?? "");
      return reply.code(403).send({ codigo: "sem_permissao", mensagem: "Verificação inválida." });
    });
    // num contexto à parte, para ler o corpo cru e validar a assinatura da Meta
    app.register(async (sub) => {
      sub.removeContentTypeParser("application/json");
      sub.addContentTypeParser("application/json", { parseAs: "string" }, (_req, corpo, feito) => feito(null, corpo));
      sub.post("/v1/whatsapp/webhook", async (req, reply) => {
        const cru = String(req.body ?? "");
        const assin = String(req.headers["x-hub-signature-256"] ?? "");
        if (!c.segredoApp) return reply.code(503).send({ codigo: "whatsapp_inativo", mensagem: "WhatsApp não configurado." });
        const esperado = "sha256=" + createHmac("sha256", c.segredoApp).update(cru).digest("hex");
        if (assin.length !== esperado.length || !timingSafeEqual(Buffer.from(assin), Buffer.from(esperado))) return reply.code(401).send({ codigo: "assinatura_invalida", mensagem: "Assinatura inválida." });
        let j: { entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[] };
        try { j = JSON.parse(cru); } catch { return reply.code(400).send({ codigo: "json_invalido", mensagem: "Corpo inválido." }); }
        for (const ent of j.entry ?? []) for (const ch of ent.changes ?? []) for (const m of ch.value?.messages ?? []) {
          const de = telefoneInternacional("+" + (m.from ?? ""));
          if (!de) continue;
          const texto = m.type === "text" ? (m.text?.body ?? "") : `[${m.type ?? "mensagem"}]`;
          const emps = (await db.query<{ id: string; telefone: string | null }>(`SELECT id, telefone FROM empresas WHERE telefone IS NOT NULL`)).filter((e) => telefoneInternacional(e.telefone) === de);
          if (PARAR(texto)) {
            for (const e of emps) await db.query(`UPDATE empresas SET whatsapp_consentimento_em = NULL WHERE id = $1`, [e.id]);
            await enviar({ para: de, tipo: "texto", texto: "Feito: não voltará a receber lembretes da Contabia por WhatsApp. Pode reativá-los na app, em Conta." }).catch(() => false);
            continue;
          }
          for (const e of emps) await aoRecebido(e.id, texto);
        }
        return reply.code(200).send({ ok: true }); // a Meta só quer saber que recebemos
      });
    });
  }
  const PARAR = (t: string) => PALAVRAS_PARAR.test(t);

  return { ativo: () => ativo || !!c.enviar, lembrete, rotas };
}
