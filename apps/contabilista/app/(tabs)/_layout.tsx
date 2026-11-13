import { useEffect, useState } from "react";
import { Redirect, Tabs } from "expo-router";
import { Icone, cor, useSessao } from "@contabia/ui";

export default function Separadores() {
  const { sessao, pronto, api } = useSessao();
  // contagem de avisos por ler no separador (atualiza a cada minuto)
  const [porLer, setPorLer] = useState(0);
  useEffect(() => {
    if (!sessao) return;
    let ativo = true;
    const ler = () => api.contagemAvisos().then((c) => { if (ativo) setPorLer(c.total); }).catch(() => undefined);
    void ler();
    const t = setInterval(ler, 60_000);
    return () => { ativo = false; clearInterval(t); };
  }, [sessao, api]);
  if (!pronto) return null;
  if (!sessao) return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: cor.verde, tabBarInactiveTintColor: cor.textoSec, tabBarLabelStyle: { fontSize: 12, fontWeight: "600" } }}>
      <Tabs.Screen name="index" options={{ title: "Carteira", tabBarIcon: ({ color }) => <Icone nome="carteira" cor={String(color)} /> }} />
      <Tabs.Screen name="avisos" options={{ title: "Avisos", tabBarBadge: porLer ? (porLer > 99 ? "99+" : porLer) : undefined, tabBarBadgeStyle: { backgroundColor: cor.menta, color: "#0C1A22", fontWeight: "700" }, tabBarIcon: ({ color }) => <Icone nome="sino" cor={String(color)} /> }} />
      <Tabs.Screen name="horas" options={{ title: "Horas", tabBarIcon: ({ color }) => <Icone nome="relogio" cor={String(color)} /> }} />
      <Tabs.Screen name="ligar" options={{ title: "Ligar empresa", tabBarIcon: ({ color }) => <Icone nome="ligar" cor={String(color)} /> }} />
    </Tabs>
  );
}
