/**
 * Fila sem internet. Se o telemóvel estiver sem rede quando a empresa regista uma
 * fatura, o documento (e a foto) ficam guardados NO TELEMÓVEL e são enviados
 * sozinhos assim que a rede voltar. Cada envio usa sempre a mesma chave de
 * idempotência, por isso um reenvio nunca cria duplicados na nuvem.
 */
import { useEffect, useSyncExternalStore } from "react";
import { AppState, Platform } from "react-native";
import * as FileSystem from "expo-file-system/legacy";
import * as Network from "expo-network";
import { ErroApi, type ApiContabia, type Documento } from "@contabia/shared";
import { enviarAnexo, type Ficheiro } from "./anexar";

export interface ItemFila {
  id: string; // também é a chave de idempotência
  empresaId: string;
  corpo: Record<string, unknown>; // o mesmo corpo de POST /documentos (qr ou manual)
  resumo: string; // ex.: "FT 2026/418 · Papelaria"
  anexo?: Ficheiro; // cópia local da foto/PDF
  documentoId?: string; // preenchido quando o documento já chegou à nuvem
  criadoEm: string;
  erro?: string; // a nuvem recusou (ex.: fatura repetida): precisa de atenção
}

const CHAVE = "contabia.fila";
const PASTA = Platform.OS === "web" ? "" : `${FileSystem.documentDirectory}fila/`;
let itens: ItemFila[] = [];
let carregado = false;
let aProcessar = false;
const ouvintes = new Set<() => void>();
const avisar = () => { itens = [...itens]; ouvintes.forEach((f) => f()); };

async function ler(): Promise<ItemFila[]> {
  try {
    if (Platform.OS === "web") return JSON.parse(globalThis.localStorage?.getItem(CHAVE) ?? "[]");
    const info = await FileSystem.getInfoAsync(`${PASTA}fila.json`);
    return info.exists ? JSON.parse(await FileSystem.readAsStringAsync(`${PASTA}fila.json`)) : [];
  } catch {
    return [];
  }
}
async function gravar() {
  const texto = JSON.stringify(itens);
  if (Platform.OS === "web") {
    try { globalThis.localStorage?.setItem(CHAVE, texto); } catch { /* armazenamento cheio */ }
    return;
  }
  await FileSystem.makeDirectoryAsync(PASTA, { intermediates: true }).catch(() => undefined);
  await FileSystem.writeAsStringAsync(`${PASTA}fila.json`, texto);
}
async function garantirCarregado() {
  if (carregado) return;
  itens = await ler();
  carregado = true;
  avisar();
}

/** Copia a foto para um sítio que o sistema não apaga (no navegador, guarda-a em texto). */
async function guardarCopia(f: Ficheiro, id: string): Promise<Ficheiro> {
  if (Platform.OS === "web") {
    const blob = await (await fetch(f.uri)).blob();
    const dataUrl = await new Promise<string>((ok, falha) => {
      const r = new FileReader();
      r.onload = () => ok(String(r.result));
      r.onerror = falha;
      r.readAsDataURL(blob);
    });
    return { uri: dataUrl, tipo: f.tipo };
  }
  await FileSystem.makeDirectoryAsync(PASTA, { intermediates: true }).catch(() => undefined);
  const destino = `${PASTA}${id}.${f.tipo === "application/pdf" ? "pdf" : "jpg"}`;
  await FileSystem.copyAsync({ from: f.uri, to: destino });
  return { uri: destino, tipo: f.tipo };
}

export const semRede = (e: unknown) => e instanceof ErroApi && (e.codigo === "sem_ligacao" || e.codigo === "indisponivel");

/** Guarda no telemóvel um documento que não pôde ser enviado. */
export async function porNaFila(empresaId: string, corpo: Record<string, unknown>, resumo: string, anexo?: Ficheiro) {
  await garantirCarregado();
  const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const item: ItemFila = { id, empresaId, corpo, resumo, criadoEm: new Date().toISOString(), ...(anexo ? { anexo: await guardarCopia(anexo, id) } : {}) };
  itens.push(item);
  await gravar();
  avisar();
  return item;
}

/** Junta uma foto a um documento que ainda está na fila. */
export async function anexarNaFila(id: string, anexo: Ficheiro) {
  await garantirCarregado();
  const i = itens.find((x) => x.id === id);
  if (!i) return;
  i.anexo = await guardarCopia(anexo, id);
  await gravar();
  avisar();
}

async function apagarCopia(i: ItemFila) {
  if (Platform.OS !== "web" && i.anexo) await FileSystem.deleteAsync(i.anexo.uri, { idempotent: true }).catch(() => undefined);
}

/** Retira da fila um documento que a nuvem recusou (só existe no telemóvel). */
export async function descartar(id: string) {
  const i = itens.find((x) => x.id === id);
  if (i) await apagarCopia(i);
  itens = itens.filter((x) => x.id !== id);
  await gravar();
  avisar();
}

/** Envia tudo o que está na fila. Para no primeiro erro de rede. */
export async function processarFila(api: ApiContabia): Promise<number> {
  await garantirCarregado();
  if (aProcessar || !itens.some((i) => !i.erro) || !api.token) return 0;
  aProcessar = true;
  let enviados = 0;
  try {
    for (const i of [...itens]) {
      if (i.erro) continue;
      try {
        if (!i.documentoId) {
          const d = await api.pedido<Documento>("POST", `/v1/empresas/${i.empresaId}/documentos`, i.corpo, 2, i.id);
          i.documentoId = d.id;
          await gravar();
        }
        if (i.anexo) await enviarAnexo(api, i.empresaId, i.documentoId, i.anexo);
        await apagarCopia(i);
        itens = itens.filter((x) => x.id !== i.id);
        enviados++;
      } catch (e) {
        if (semRede(e) || (e instanceof Error && /enviar o ficheiro/.test(e.message))) break; // sem rede: tenta mais tarde
        i.erro = (e as Error).message; // recusado pela nuvem: a empresa decide
      }
      await gravar();
      avisar();
    }
  } finally {
    aProcessar = false;
    avisar();
  }
  return enviados;
}

export function useFila(): ItemFila[] {
  return useSyncExternalStore((f) => { ouvintes.add(f); void garantirCarregado(); return () => ouvintes.delete(f); }, () => itens, () => itens);
}

/** Liga o envio automático: ao abrir a app, quando a rede volta e a cada minuto. */
export function useEnvioAutomatico(api: ApiContabia, aoEnviar?: () => void) {
  useEffect(() => {
    const correr = () => void processarFila(api).then((n) => { if (n) aoEnviar?.(); });
    correr();
    const t = setInterval(correr, 60_000);
    const app = AppState.addEventListener("change", (s) => { if (s === "active") correr(); });
    const rede = Platform.OS === "web"
      ? (() => { globalThis.addEventListener?.("online", correr); return { remove: () => globalThis.removeEventListener?.("online", correr) }; })()
      : Network.addNetworkStateListener((s) => { if (s.isConnected) correr(); });
    return () => { clearInterval(t); app.remove(); rede.remove(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api]);
}
