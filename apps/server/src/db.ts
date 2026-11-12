/**
 * Acesso a PostgreSQL. Em produção usa `pg` (DATABASE_URL); em desenvolvimento
 * e nos testes usa PGlite — o mesmo PostgreSQL, a correr dentro do processo.
 */
import pg from "pg";
import { PGlite } from "@electric-sql/pglite";

export interface Db {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  transacao<T>(fn: (db: Db) => Promise<T>): Promise<T>;
  fechar(): Promise<void>;
}

export async function abrirDb(url?: string, pastaLocal?: string): Promise<Db> {
  const db = url ? dbPg(url) : await dbLite(pastaLocal);
  await migrar(db);
  return db;
}

function dbPg(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  const criar = (exec: (s: string, p?: unknown[]) => Promise<pg.QueryResult>): Db => ({
    async query<T>(sql: string, params: unknown[] = []) {
      return (await exec(sql, params)).rows as T[];
    },
    async transacao<T>(fn: (db: Db) => Promise<T>) {
      const c = await pool.connect();
      try {
        await c.query("BEGIN");
        const r = await fn(criar((s, p) => c.query(s, p)));
        await c.query("COMMIT");
        return r;
      } catch (e) {
        await c.query("ROLLBACK");
        throw e;
      } finally {
        c.release();
      }
    },
    fechar: () => pool.end(),
  });
  return criar((s, p) => pool.query(s, p));
}

async function dbLite(pasta?: string): Promise<Db> {
  const lite = new PGlite(pasta);
  let fila: Promise<unknown> = Promise.resolve();
  // PGlite tem uma só ligação: as transações são postas em fila.
  const db: Db = {
    async query<T>(sql: string, params: unknown[] = []) {
      return (await lite.query(sql, params)).rows as T[];
    },
    async transacao<T>(fn: (db: Db) => Promise<T>) {
      const corre = fila.then(() =>
        lite.transaction(async (tx) => fn({
          query: async <U>(s: string, p: unknown[] = []) => (await tx.query(s, p)).rows as U[],
          transacao: (f) => f(db),
          fechar: async () => {},
        })),
      );
      fila = corre.catch(() => undefined);
      return corre as Promise<T>;
    },
    fechar: () => lite.close(),
  };
  return db;
}

const MIGRACOES: string[] = [
  `CREATE TABLE IF NOT EXISTS empresas (
     id text PRIMARY KEY,
     utilizador text UNIQUE NOT NULL,
     nif text NOT NULL,
     nome text NOT NULL,
     regiao text NOT NULL,
     regime_iva text NOT NULL,
     senha_hash text NOT NULL,
     criada_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS contabilistas (
     id text PRIMARY KEY,
     email text UNIQUE NOT NULL,
     nome text NOT NULL,
     numero_occ text NOT NULL,
     senha_hash text NOT NULL,
     criado_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS ligacoes (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     contabilista_id text NOT NULL REFERENCES contabilistas(id),
     estado text NOT NULL,
     permissoes jsonb NOT NULL,
     criada_em text NOT NULL,
     expira_em text NOT NULL,
     atualizada_em text NOT NULL,
     versao integer NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS eventos (
     seq serial PRIMARY KEY,
     empresa_id text NOT NULL,
     tipo text NOT NULL,
     origem text NOT NULL,
     dados jsonb NOT NULL,
     em text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS eventos_empresa ON eventos(empresa_id, seq)`,
  `CREATE TABLE IF NOT EXISTS idempotencia (
     chave text PRIMARY KEY,
     estado integer NOT NULL,
     corpo text NOT NULL,
     criada_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS documentos (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     tipo text NOT NULL,
     terceiro_nif text NOT NULL,
     terceiro_nome text NOT NULL,
     numero text NOT NULL,
     atcud text NOT NULL,
     data text NOT NULL,
     base numeric(14,2) NOT NULL,
     iva numeric(14,2) NOT NULL,
     total numeric(14,2) NOT NULL,
     taxa numeric(5,2) NOT NULL,
     espaco_fiscal text NOT NULL,
     estado text NOT NULL,
     conta_sugerida text NOT NULL,
     categoria text NOT NULL,
     iva_dedutivel boolean NOT NULL,
     origem text NOT NULL,
     criado_em text NOT NULL
   )`,
  `DROP INDEX IF EXISTS documentos_unicos`,
  // Um documento anulado não impede registar de novo o correto; espaços e maiúsculas no n.º não enganam.
  `CREATE UNIQUE INDEX IF NOT EXISTS documentos_unicos_ativos ON documentos(empresa_id, terceiro_nif, upper(replace(numero, ' ', '')), tipo) WHERE estado <> 'anulado'`,
  `CREATE TABLE IF NOT EXISTS lancamentos (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     documento_id text,
     diario text NOT NULL,
     data text NOT NULL,
     periodo text NOT NULL,
     descricao text NOT NULL,
     linhas jsonb NOT NULL,
     estado text NOT NULL,
     confianca text NOT NULL,
     versao integer NOT NULL,
     criado_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS pedidos (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     contabilista_id text NOT NULL,
     tipo text NOT NULL,
     detalhe text NOT NULL,
     estado text NOT NULL,
     criado_em text NOT NULL,
     recebido_em text
   )`,
  `CREATE TABLE IF NOT EXISTS submissoes (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     obrigacao text NOT NULL,
     periodo text NOT NULL,
     comprovativo text NOT NULL,
     submetida_em text NOT NULL,
     UNIQUE (empresa_id, obrigacao, periodo)
   )`,
  `CREATE TABLE IF NOT EXISTS periodos (
     empresa_id text NOT NULL,
     periodo text NOT NULL,
     fechado_em text NOT NULL,
     PRIMARY KEY (empresa_id, periodo)
   )`,
  `CREATE TABLE IF NOT EXISTS fornecedor_contas (
     empresa_id text NOT NULL,
     nif text NOT NULL,
     conta text NOT NULL,
     usos integer NOT NULL DEFAULT 1,
     PRIMARY KEY (empresa_id, nif)
   )`,
  `ALTER TABLE ligacoes ADD COLUMN IF NOT EXISTS iniciada_por text NOT NULL DEFAULT 'contabilista'`,
  `ALTER TABLE documentos ADD COLUMN IF NOT EXISTS estado_anterior text`,
  `ALTER TABLE documentos ADD COLUMN IF NOT EXISTS anulacao_motivo text`,
  `ALTER TABLE documentos ADD COLUMN IF NOT EXISTS anulacao_pedida_por text`,
  `ALTER TABLE documentos ADD COLUMN IF NOT EXISTS anulacao_em text`,
  // Arquivo digital: a imagem/PDF original de cada documento, guardada na base de dados (nunca apagada).
  `CREATE TABLE IF NOT EXISTS anexos (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     documento_id text NOT NULL REFERENCES documentos(id),
     tipo text NOT NULL,
     nome text NOT NULL,
     tamanho integer NOT NULL,
     sha256 text NOT NULL,
     dados bytea NOT NULL,
     enviado_por text NOT NULL,
     criado_em text NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS anexos_unicos ON anexos(documento_id, sha256)`,
  // Conciliação bancária: movimentos do extrato e a fatura a que correspondem.
  `CREATE TABLE IF NOT EXISTS movimentos (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     data text NOT NULL,
     descricao text NOT NULL,
     valor numeric(14,2) NOT NULL,
     impressao text NOT NULL,
     estado text NOT NULL,
     documento_id text REFERENCES documentos(id),
     sugestao_documento_id text REFERENCES documentos(id),
     sugestao_motivo text,
     sugestao_confianca text,
     criado_em text NOT NULL
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS movimentos_unicos ON movimentos(empresa_id, impressao)`,
  // Vários utilizadores por empresa (nunca apagados: desativados, para o registo de atividade fazer sentido).
  `CREATE TABLE IF NOT EXISTS colaboradores (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     nome text NOT NULL,
     email text NOT NULL UNIQUE,
     senha_hash text NOT NULL,
     ativo boolean NOT NULL DEFAULT true,
     criado_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS atividade (
     seq serial PRIMARY KEY,
     empresa_id text NOT NULL,
     quem text NOT NULL,
     papel text NOT NULL,
     acao text NOT NULL,
     em text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS atividade_empresa ON atividade(empresa_id, seq)`,
  // E-mail da empresa (recuperar senha) e invalidação de sessões quando a senha muda.
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS email text`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS senha_mudada_em text`,
  `ALTER TABLE contabilistas ADD COLUMN IF NOT EXISTS senha_mudada_em text`,
  `ALTER TABLE colaboradores ADD COLUMN IF NOT EXISTS senha_mudada_em text`,
  `CREATE TABLE IF NOT EXISTS recuperacoes (
     hash text PRIMARY KEY,
     papel text NOT NULL,
     conta_id text NOT NULL,
     colaborador_id text,
     expira_em text NOT NULL,
     usada boolean NOT NULL DEFAULT false
   )`,
  // Telemóveis que recebem avisos push (Expo). Um token por aparelho.
  `CREATE TABLE IF NOT EXISTS dispositivos (
     token text PRIMARY KEY,
     papel text NOT NULL,
     conta_id text NOT NULL,
     colaborador_id text,
     plataforma text NOT NULL,
     atualizado_em text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS dispositivos_conta ON dispositivos(papel, conta_id)`,
  `CREATE TABLE IF NOT EXISTS avisos_enviados (chave text PRIMARY KEY, em text NOT NULL)`,
  // Regras do contabilista por fornecedor: conta, IVA e se lança sozinho.
  `CREATE TABLE IF NOT EXISTS regras_fornecedor (
     empresa_id text NOT NULL REFERENCES empresas(id),
     nif text NOT NULL,
     nome text NOT NULL,
     conta text NOT NULL,
     iva_dedutivel boolean NOT NULL,
     auto_lancar boolean NOT NULL DEFAULT false,
     criada_em text NOT NULL,
     PRIMARY KEY (empresa_id, nif)
   )`,
  `CREATE TABLE IF NOT EXISTS regras_versoes (
     versao text PRIMARY KEY,
     regras jsonb NOT NULL,
     publicada_em text NOT NULL
   )`,
  // Apoios europeus: CAE (Rev. 4) e dimensão da empresa, catálogo de avisos e pedidos de estudo.
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS cae text`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS caes_secundarios jsonb NOT NULL DEFAULT '[]'::jsonb`,
  `ALTER TABLE empresas ADD COLUMN IF NOT EXISTS dimensao text`,
  `CREATE TABLE IF NOT EXISTS apoios_versoes (
     versao text PRIMARY KEY,
     catalogo jsonb NOT NULL,
     publicada_em text NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS pedidos_estudo (
     id text PRIMARY KEY,
     empresa_id text NOT NULL REFERENCES empresas(id),
     apoio_id text,
     apoio_nome text,
     nome text NOT NULL,
     email text NOT NULL,
     telefone text,
     mensagem text,
     estado text NOT NULL DEFAULT 'recebido',
     criado_em text NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS pedidos_estudo_empresa ON pedidos_estudo(empresa_id, criado_em)`,
  // Pedidos de estudo feitos no site (ainda sem conta): empresa_id fica vazio.
  `ALTER TABLE pedidos_estudo ALTER COLUMN empresa_id DROP NOT NULL`,
  `ALTER TABLE pedidos_estudo ADD COLUMN IF NOT EXISTS origem text NOT NULL DEFAULT 'app'`,
  `ALTER TABLE pedidos_estudo ADD COLUMN IF NOT EXISTS empresa_nome text`,
  `ALTER TABLE pedidos_estudo ADD COLUMN IF NOT EXISTS empresa_nif text`,
  `ALTER TABLE pedidos_estudo ADD COLUMN IF NOT EXISTS cae text`,
  `ALTER TABLE pedidos_estudo ADD COLUMN IF NOT EXISTS regiao text`,
];

async function migrar(db: Db) {
  for (const sql of MIGRACOES) await db.query(sql);
}
