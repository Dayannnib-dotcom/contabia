/**
 * Sessão partilhada pelas duas apps: guarda o token no cofre do telemóvel,
 * cria o cliente da API e mantém o tempo real ligado.
 */
import { cancelarAvisos } from "./avisos";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { ApiContabia, TempoReal, type Evento, type Sessao } from "@contabia/shared";

const cofre = (CHAVE: string) => ({
  async ler(): Promise<string | null> {
    try {
      return Platform.OS === "web" ? globalThis.localStorage?.getItem(CHAVE) ?? null : await SecureStore.getItemAsync(CHAVE);
    } catch {
      return null;
    }
  },
  async escrever(v: string | null) {
    try {
      if (Platform.OS === "web") {
        if (v) globalThis.localStorage?.setItem(CHAVE, v); else globalThis.localStorage?.removeItem(CHAVE);
        return;
      }
      if (v) await SecureStore.setItemAsync(CHAVE, v); else await SecureStore.deleteItemAsync(CHAVE);
    } catch {
      /* armazenamento indisponível: a sessão dura só enquanto a app estiver aberta */
    }
  },
});

interface Ctx {
  api: ApiContabia;
  sessao: Sessao | null;
  pronto: boolean;
  online: boolean;
  /** Muda sempre que chega um evento em tempo real: os ecrãs usam-no para recarregar. */
  versao: number;
  ultimoEvento: Evento | null;
  entrar(s: Sessao): Promise<void>;
  sair(): Promise<void>;
  definirEmpresas(ids: string[]): void;
}

const Contexto = createContext<Ctx | null>(null);

export function ProvedorSessao({ children, urlApi, chave = "contabia.sessao" }: { children: ReactNode; urlApi: string; chave?: string }) {
  const api = useMemo(() => new ApiContabia(urlApi), [urlApi]);
  const guardar = useMemo(() => cofre(chave), [chave]);
  const [sessao, setSessao] = useState<Sessao | null>(null);
  const [pronto, setPronto] = useState(false);
  const [online, setOnline] = useState(false);
  const [versao, setVersao] = useState(0);
  const [ultimoEvento, setUltimo] = useState<Evento | null>(null);
  const empresas = useRef<string[]>([]);
  const tr = useRef<TempoReal | null>(null);

  useEffect(() => {
    guardar.ler().then((v) => {
      if (v) {
        const s = JSON.parse(v) as Sessao;
        api.token = s.token;
        setSessao(s);
        if (s.papel === "empresa") empresas.current = [s.id];
      }
      setPronto(true);
    });
  }, [api, guardar]);

  useEffect(() => {
    if (!sessao) return;
    const t = new TempoReal(api, () => empresas.current, (e) => { setUltimo(e); setVersao((n) => n + 1); }, setOnline);
    t.ligar();
    tr.current = t;
    return () => t.parar();
  }, [api, sessao]);

  const entrar = useCallback(async (s: Sessao) => {
    api.token = s.token;
    empresas.current = s.papel === "empresa" ? [s.id] : [];
    await guardar.escrever(JSON.stringify(s));
    setSessao(s);
  }, [api, guardar]);

  const sair = useCallback(async () => {
    tr.current?.parar();
    await cancelarAvisos().catch(() => undefined);
    api.token = null;
    await guardar.escrever(null);
    setSessao(null);
  }, [api, guardar]);

  // Conta inexistente ou sessão expirada: volta ao ecrã de entrada em vez de mostrar erros.
  useEffect(() => {
    api.aoSessaoInvalida = () => { void sair(); };
    return () => { api.aoSessaoInvalida = null; };
  }, [api, sair]);

  // Sessão renovada pelo servidor: guarda o novo token para a sessão não expirar.
  useEffect(() => {
    api.aoTokenNovo = (token) => {
      guardar.ler().then((v) => { if (v) void guardar.escrever(JSON.stringify({ ...(JSON.parse(v) as Sessao), token })); });
    };
    return () => { api.aoTokenNovo = null; };
  }, [api, guardar]);

  const definirEmpresas = useCallback((ids: string[]) => {
    const novas = ids.filter((i) => !empresas.current.includes(i));
    empresas.current = ids;
    for (const id of novas) tr.current?.recuperar(id).catch(() => undefined);
  }, []);

  return <Contexto.Provider value={{ api, sessao, pronto, online, versao, ultimoEvento, entrar, sair, definirEmpresas }}>{children}</Contexto.Provider>;
}

export function useSessao(): Ctx {
  const c = useContext(Contexto);
  if (!c) throw new Error("useSessao fora do ProvedorSessao");
  return c;
}

/** Carrega dados e volta a carregar quando chega um evento em tempo real. */
export function useDados<T>(carregar: () => Promise<T>, deps: unknown[] = []) {
  const { versao } = useSessao();
  const [dados, setDados] = useState<T | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aCarregar, setACarregar] = useState(true);
  const recarregar = useCallback(async () => {
    setACarregar(true);
    try {
      setDados(await carregar());
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setACarregar(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  useEffect(() => { recarregar(); }, [recarregar, versao]);
  return { dados, erro, aCarregar, recarregar };
}
