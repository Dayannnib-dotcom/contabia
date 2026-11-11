/**
 * Eventos ordenados por empresa + distribuição em tempo real.
 * Cada alteração é gravada na tabela `eventos` (nada se perde) e enviada
 * aos WebSockets subscritos; quem estava desligado recupera pelo cursor.
 */
import type { Evento, Papel } from "@contabia/shared";
import type { Db } from "./db.ts";
import { agoraISO } from "./comum.ts";

interface Socket {
  send(d: string): void;
  readyState: number;
}

export class Hub {
  private porEmpresa = new Map<string, Set<Socket>>();
  private porContabilista = new Map<string, Set<Socket>>();
  private todos = new Set<Socket>();

  subscrever(s: Socket, empresas: string[], contabilistaId?: string) {
    this.todos.add(s);
    for (const e of empresas) this.addEmpresa(s, e);
    if (contabilistaId) {
      const set = this.porContabilista.get(contabilistaId) ?? new Set();
      set.add(s);
      this.porContabilista.set(contabilistaId, set);
    }
  }

  addEmpresa(s: Socket, empresaId: string) {
    const set = this.porEmpresa.get(empresaId) ?? new Set();
    set.add(s);
    this.porEmpresa.set(empresaId, set);
  }

  remover(s: Socket) {
    this.todos.delete(s);
    for (const set of this.porEmpresa.values()) set.delete(s);
    for (const set of this.porContabilista.values()) set.delete(s);
  }

  /** Quando uma ligação fica ativa, os sockets do contabilista passam a receber essa empresa. */
  ligarContabilista(contabilistaId: string, empresaId: string) {
    for (const s of this.porContabilista.get(contabilistaId) ?? []) this.addEmpresa(s, empresaId);
  }

  emitir(e: Evento, tambemContabilista?: string) {
    const alvo = new Set(this.porEmpresa.get(e.empresaId) ?? []);
    if (tambemContabilista) for (const s of this.porContabilista.get(tambemContabilista) ?? []) alvo.add(s);
    const txt = JSON.stringify(e);
    for (const s of alvo) if (s.readyState === 1) s.send(txt);
  }

  difundir(msg: unknown) {
    const txt = JSON.stringify(msg);
    for (const s of this.todos) if (s.readyState === 1) s.send(txt);
  }
}

export async function publicar(
  db: Db, hub: Hub, empresaId: string, tipo: string, origem: Papel | "sistema", dados: Record<string, unknown>, contabilistaId?: string,
): Promise<Evento> {
  const [r] = await db.query<{ seq: number }>(
    `INSERT INTO eventos (empresa_id, tipo, origem, dados, em) VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING seq`,
    [empresaId, tipo, origem, JSON.stringify(dados), agoraISO()],
  );
  const e: Evento = { seq: Number(r.seq), empresaId, tipo, origem, dados, em: agoraISO() };
  hub.emitir(e, contabilistaId);
  return e;
}

export async function eventosDesde(db: Db, empresaId: string, cursor: number, limite: number) {
  const linhas = await db.query<{ seq: number; empresa_id: string; tipo: string; origem: string; dados: Record<string, unknown>; em: string }>(
    `SELECT seq, empresa_id, tipo, origem, dados, em FROM eventos WHERE empresa_id = $1 AND seq > $2 ORDER BY seq LIMIT $3`,
    [empresaId, cursor, limite + 1],
  );
  const eventos: Evento[] = linhas.slice(0, limite).map((l) => ({
    seq: Number(l.seq), empresaId: l.empresa_id, tipo: l.tipo, origem: l.origem as Evento["origem"], dados: l.dados, em: l.em,
  }));
  return { eventos, cursor: eventos.length ? eventos[eventos.length - 1].seq : cursor, maisDados: linhas.length > limite };
}
