import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProvedorSessao, cor, useSessao } from "@contabia/ui";

const URL_API = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

function Navegacao() {
  const { sessao } = useSessao();
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: cor.fundo } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="entrar" options={{ headerShown: true, title: "Entrar", headerBackTitle: "Voltar" }} />
      <Stack.Screen name="registar" options={{ headerShown: true, title: "Criar conta", headerBackTitle: "Voltar" }} />
      {/* Ecrãs com sessão: ao sair, desaparecem antes de lerem uma sessão vazia. */}
      <Stack.Protected guard={!!sessao}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="empresa/[id]" options={{ headerShown: true, title: "Empresa", headerBackTitle: "Carteira" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function Raiz() {
  return (
    <SafeAreaProvider>
      <ProvedorSessao urlApi={URL_API} chave="contabia.contabilista">
        <StatusBar style="dark" />
        <Navegacao />
      </ProvedorSessao>
    </SafeAreaProvider>
  );
}
