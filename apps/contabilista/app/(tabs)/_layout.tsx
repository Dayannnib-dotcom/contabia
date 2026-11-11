import { Redirect, Tabs } from "expo-router";
import { Icone, cor, useSessao } from "@contabia/ui";

export default function Separadores() {
  const { sessao, pronto } = useSessao();
  if (!pronto) return null;
  if (!sessao) return <Redirect href="/" />;
  return (
    <Tabs screenOptions={{ headerShown: false, tabBarActiveTintColor: cor.verde, tabBarInactiveTintColor: cor.textoSec, tabBarLabelStyle: { fontSize: 12, fontWeight: "600" } }}>
      <Tabs.Screen name="index" options={{ title: "Carteira", tabBarIcon: ({ color }) => <Icone nome="carteira" cor={String(color)} /> }} />
      <Tabs.Screen name="ligar" options={{ title: "Ligar empresa", tabBarIcon: ({ color }) => <Icone nome="ligar" cor={String(color)} /> }} />
    </Tabs>
  );
}
