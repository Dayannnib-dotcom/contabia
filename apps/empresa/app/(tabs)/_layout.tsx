import { Redirect, Tabs } from "expo-router";
import { View } from "react-native";
import { Icone, cor, useSessao } from "@contabia/ui";
import { useEnvioAutomatico } from "../../lib/fila";

function EnvioAutomatico() {
  const { api } = useSessao();
  useEnvioAutomatico(api);
  return null;
}

export default function Separadores() {
  const { sessao, pronto } = useSessao();
  if (!pronto) return null;
  if (!sessao) return <Redirect href="/" />;
  return (
    <>
    <EnvioAutomatico />
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: cor.verde,
        tabBarInactiveTintColor: cor.textoSec,
        tabBarStyle: { height: 84, paddingTop: 6 },
        tabBarLabelStyle: { fontSize: 11, fontWeight: "600" },
      }}
    >
      <Tabs.Screen name="index" options={{ title: "Painel", tabBarIcon: ({ color }) => <Icone nome="painel" cor={String(color)} /> }} />
      <Tabs.Screen name="documentos" options={{ title: "Documentos", tabBarIcon: ({ color }) => <Icone nome="documentos" cor={String(color)} /> }} />
      <Tabs.Screen
        name="digitalizar"
        options={{
          title: "Digitalizar",
          tabBarAccessibilityLabel: "Digitalizar documento",
          tabBarIcon: () => (
            <View style={{ width: 54, height: 54, borderRadius: 27, backgroundColor: cor.verde, alignItems: "center", justifyContent: "center", marginTop: -18 }}>
              <Icone nome="digitalizar" cor="#FFFFFF" tamanho={26} />
            </View>
          ),
        }}
      />
      <Tabs.Screen name="assistente" options={{ title: "Assistente", tabBarIcon: ({ color }) => <Icone nome="assistente" cor={String(color)} /> }} />
      <Tabs.Screen name="prazos" options={{ title: "Prazos", tabBarIcon: ({ color }) => <Icone nome="prazos" cor={String(color)} /> }} />
    </Tabs>
    </>
  );
}
