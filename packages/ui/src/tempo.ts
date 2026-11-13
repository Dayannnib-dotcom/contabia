import { useCallback, useEffect, useRef } from "react";
import { AppState, Platform } from "react-native";
import type { CategoriaTempo } from "@contabia/shared";
import { useSessao } from "./sessao";

const PASSO = 15; // segundos
const PAUSA = 3 * 60_000; // sem tocar durante 3 min = pausa (deixa de contar)

/**
 * Mede o tempo ATIVO do contabilista no ecrã de uma empresa, por tarefa.
 * Conta de 15 em 15 s só com a app à frente e com interação recente; envia a cada minuto
 * e ao mudar de tarefa ou sair. Devolve `marcar`, a ligar a toques e deslocações.
 */
export function useTempoTrabalho(empresaId: string | undefined, categoria: CategoriaTempo) {
  const { api } = useSessao();
  const ultimo = useRef(Date.now());
  const acum = useRef(0);
  const marcar = useCallback(() => { ultimo.current = Date.now(); }, []);
  useEffect(() => {
    if (!empresaId) return;
    ultimo.current = Date.now();
    const enviar = () => {
      const s = acum.current;
      if (s <= 0) return;
      acum.current = 0;
      void api.registarTempo(empresaId, categoria, s).catch(() => undefined);
    };
    const visivel = () => AppState.currentState === "active" && (Platform.OS !== "web" || typeof document === "undefined" || document.visibilityState !== "hidden");
    const t = setInterval(() => {
      if (visivel() && Date.now() - ultimo.current < PAUSA) acum.current += PASSO;
      if (acum.current >= 60) enviar();
    }, PASSO * 1000);
    // na web: rato e teclado também contam como atividade
    const ev = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    if (Platform.OS === "web" && typeof window !== "undefined") ev.forEach((e) => window.addEventListener(e, marcar, { passive: true }));
    const sub = AppState.addEventListener("change", (s) => { if (s !== "active") enviar(); else marcar(); });
    return () => {
      clearInterval(t);
      sub.remove();
      if (Platform.OS === "web" && typeof window !== "undefined") ev.forEach((e) => window.removeEventListener(e, marcar));
      enviar();
    };
  }, [empresaId, categoria, api, marcar]);
  return marcar;
}
