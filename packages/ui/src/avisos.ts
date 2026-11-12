import { useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import type { ApiContabia } from "@contabia/shared";

/** Um prazo a avisar: chave única, data-limite (AAAA-MM-DD) e textos. */
export interface AvisoPrazo {
  chave: string;
  prazo: string;
  titulo: string;
  corpo: string;
}

const PREFIXO = "contabia-prazo:";
/** Avisa 7 dias antes, 2 dias antes e no próprio dia, às 9h00. */
const ANTECEDENCIAS: [number, string][] = [[7, "Faltam 7 dias"], [2, "Faltam 2 dias"], [0, "Termina hoje"]];

if (Platform.OS !== "web") {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
}

function dataAviso(prazo: string, diasAntes: number): Date {
  const [a, m, d] = prazo.split("-").map(Number);
  return new Date(a, m - 1, d - diasAntes, 9, 0, 0);
}

export async function permissaoAvisos(pedir: boolean): Promise<boolean> {
  if (Platform.OS === "web") {
    const N = (globalThis as { Notification?: typeof Notification }).Notification;
    if (!N) return false;
    if (N.permission === "granted") return true;
    if (!pedir || N.permission === "denied") return false;
    return (await N.requestPermission()) === "granted";
  }
  const atual = await Notifications.getPermissionsAsync();
  if (atual.granted) return true;
  if (!pedir || !atual.canAskAgain) return false;
  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("prazos", { name: "Prazos fiscais", importance: Notifications.AndroidImportance.HIGH });
  }
  return (await Notifications.requestPermissionsAsync()).granted;
}

/**
 * Agenda no telemóvel os avisos dos prazos (funcionam com a app fechada e sem internet).
 * Substitui sempre os avisos anteriores, para que um prazo já submetido deixe de avisar.
 * No navegador não é possível agendar com a página fechada: mostra o aviso ao abrir,
 * uma vez por dia, para prazos a 2 dias ou menos.
 */
export async function agendarAvisos(avisos: AvisoPrazo[], pedir = Platform.OS !== "web"): Promise<number> {
  // No navegador a autorização só pode ser pedida com um toque (botão «Ativar avisos»).
  if (!(await permissaoAvisos(pedir).catch(() => false))) return 0;
  const agora = new Date();

  if (Platform.OS === "web") {
    const hoje = agora.toISOString().slice(0, 10);
    const chaveDia = `contabia.avisos.${hoje}`;
    try { if (globalThis.localStorage?.getItem(chaveDia)) return 0; } catch { /* sem armazenamento */ }
    const urgentes = avisos.filter((a) => {
      const dias = Math.round((dataAviso(a.prazo, 0).getTime() - agora.getTime()) / 86400000);
      return dias >= -1 && dias <= 2;
    });
    for (const a of urgentes) new Notification(a.titulo, { body: a.corpo, tag: a.chave });
    try { globalThis.localStorage?.setItem(chaveDia, "1"); } catch { /* sem armazenamento */ }
    return urgentes.length;
  }

  const existentes = await Notifications.getAllScheduledNotificationsAsync();
  await Promise.all(existentes.filter((n) => n.identifier.startsWith(PREFIXO)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
  let n = 0;
  for (const a of avisos) {
    for (const [dias, quando] of ANTECEDENCIAS) {
      const data = dataAviso(a.prazo, dias);
      if (data <= agora) continue;
      await Notifications.scheduleNotificationAsync({
        identifier: `${PREFIXO}${a.chave}:${dias}`,
        content: { title: `${quando} · ${a.titulo}`, body: a.corpo, data: { prazo: a.prazo } },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: data, channelId: "prazos" },
      });
      n++;
    }
  }
  return n;
}

/** Volta a agendar os avisos sempre que os dados mudam (ex.: uma declaração foi submetida). */
export function useAvisosPrazos(avisos: AvisoPrazo[] | null) {
  const assinatura = avisos?.map((a) => a.chave).sort().join("|") ?? "";
  useEffect(() => {
    if (avisos) void agendarAvisos(avisos).catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assinatura]);
}

export async function cancelarAvisos() {
  if (Platform.OS === "web") return;
  const existentes = await Notifications.getAllScheduledNotificationsAsync().catch(() => []);
  await Promise.all(existentes.filter((n) => n.identifier.startsWith(PREFIXO)).map((n) => Notifications.cancelScheduledNotificationAsync(n.identifier)));
}

let tokenPush: string | null = null;

/**
 * Regista este telemóvel para receber avisos enviados pelo servidor (pedidos do
 * contabilista, convites, prazos). Precisa do ID do projeto EAS (app publicada com
 * EAS Build); sem ele, ou no navegador, ficam só os avisos locais de prazos.
 */
export async function registarAvisosPush(api: ApiContabia): Promise<boolean> {
  if (Platform.OS === "web") return false;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
  if (!projectId) return false;
  try {
    if (!(await permissaoAvisos(true))) return false;
    const { data } = await Notifications.getExpoPushTokenAsync({ projectId });
    tokenPush = data;
    await api.registarDispositivo(data, Platform.OS === "ios" ? "ios" : "android");
    return true;
  } catch {
    return false; // ex.: Expo Go no Android não recebe push remoto
  }
}

/** Ao sair: este telemóvel deixa de receber avisos desta conta. */
export async function removerAvisosPush(api: ApiContabia) {
  if (!tokenPush) return;
  await api.removerDispositivo(tokenPush).catch(() => undefined);
  tokenPush = null;
}
