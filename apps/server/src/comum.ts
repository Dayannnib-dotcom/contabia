import { randomUUID, scrypt, randomBytes, timingSafeEqual } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import type { FastifyRequest } from "fastify";
import type { Papel } from "@contabia/shared";
import type { Db } from "./db.ts";

export class ErroApp extends Error {
  constructor(public codigo: string, mensagem: string, public status = 400) {
    super(mensagem);
  }
}

export const novoId = () => randomUUID();
export const agoraISO = () => new Date().toISOString();

// ── Senhas (scrypt) ──
export function hashSenha(senha: string): Promise<string> {
  const sal = randomBytes(16);
  return new Promise((ok, erro) =>
    scrypt(senha, sal, 64, (e, chave) => (e ? erro(e) : ok(`${sal.toString("hex")}:${chave.toString("hex")}`))),
  );
}
export function verificarSenha(senha: string, guardado: string): Promise<boolean> {
  const [salHex, chaveHex] = guardado.split(":");
  return new Promise((ok, erro) =>
    scrypt(senha, Buffer.from(salHex, "hex"), 64, (e, chave) =>
      e ? erro(e) : ok(timingSafeEqual(chave, Buffer.from(chaveHex, "hex"))),
    ),
  );
}

// ── Tokens de sessão (JWT) ──
export interface Ator {
  papel: Papel;
  id: string;
  nome: string;
  /** Pessoa que entrou: o gestor (conta principal da empresa) ou um colaborador. */
  colaboradorId?: string;
  perfil?: "gestor" | "colaborador";
  quem?: string;
}

export function criarTokens(segredo: string) {
  const chave = new TextEncoder().encode(segredo);
  return {
    async emitir(a: Ator): Promise<string> {
      return new SignJWT({ papel: a.papel, nome: a.nome, ...(a.colaboradorId ? { colab: a.colaboradorId, perfil: a.perfil, quem: a.quem } : {}) })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(a.id)
        .setIssuedAt()
        .setExpirationTime("30d")
        .sign(chave);
    },
    async verificar(token: string): Promise<Ator & { emitidoEm: number }> {
      try {
        const { payload } = await jwtVerify(token, chave);
        return {
          papel: payload.papel as Papel, id: String(payload.sub), nome: String(payload.nome), emitidoEm: Number(payload.iat ?? 0),
          ...(payload.colab ? { colaboradorId: String(payload.colab), perfil: payload.perfil as Ator["perfil"], quem: String(payload.quem ?? "") } : {}),
        };
      } catch {
        throw new ErroApp("sessao_invalida", "Sessão inválida ou expirada. Entre novamente.", 401);
      }
    },
  };
}
export type Tokens = ReturnType<typeof criarTokens>;

export function ator(req: FastifyRequest): Ator {
  const a = (req as FastifyRequest & { ator?: Ator }).ator;
  if (!a) throw new ErroApp("sessao_invalida", "Precisa de iniciar sessão.", 401);
  return a;
}

// ── Permissões ──
export type Permissao =
  | "documentos.ler" | "documentos.pedir" | "lancamentos.escrever" | "iva.apurar" | "saft.gerar" | "periodo.fechar";

export const PERMISSOES_PADRAO: Permissao[] = [
  "documentos.ler", "documentos.pedir", "lancamentos.escrever", "iva.apurar", "saft.gerar", "periodo.fechar",
];

/** A empresa acede aos seus dados; o contabilista só com ligação ativa e a permissão certa. */
export async function exigirAcesso(db: Db, a: Ator, empresaId: string, permissao: Permissao = "documentos.ler") {
  if (a.papel === "empresa") {
    if (a.id !== empresaId) throw new ErroApp("sem_permissao", "Sem acesso a esta empresa.", 403);
    return;
  }
  const r = await db.query<{ permissoes: string[] }>(
    `SELECT permissoes FROM ligacoes WHERE empresa_id = $1 AND contabilista_id = $2 AND estado = 'ativa'`,
    [empresaId, a.id],
  );
  if (!r.length || !r[0].permissoes.includes(permissao))
    throw new ErroApp("sem_permissao", "Sem ligação ativa a esta empresa.", 403);
}

export function exigirPapel(a: Ator, papel: Papel) {
  if (a.papel !== papel)
    throw new ErroApp("sem_permissao", papel === "contabilista" ? "Só o Contabilista Certificado pode fazer isto." : "Só a empresa pode fazer isto.", 403);
}

export const num = (v: unknown) => Number(v);

/** Ações que só o gestor da empresa (conta principal) pode fazer, nunca um colaborador. */
export function exigirGestor(a: Ator) {
  if (a.papel === "empresa" && a.perfil === "colaborador")
    throw new ErroApp("so_gestor", "Só o gestor da empresa pode fazer isto. Peça-lhe que o faça na app dele.", 403);
}
