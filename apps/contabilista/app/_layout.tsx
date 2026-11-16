import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProvedorSessao, cor, useFontesContabia, useSessao } from "@contabia/ui";

// Endereço da API: 1) EXPO_PUBLIC_API_URL (definido no eas.json para cada compilação);
// 2) na web, o próprio servidor que serve a app; 3) no telemóvel, «localhost» só em
// desenvolvimento — numa compilação para as lojas usa sempre o servidor de produção.
const URL_PRODUCAO = "https://contabia-eu.onrender.com";
const URL_API =
  process.env.EXPO_PUBLIC_API_URL ||
  (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : __DEV__ ? "http://localhost:3000" : URL_PRODUCAO);

function Navegacao() {
  const { sessao, pronto } = useSessao();
  const fontes = useFontesContabia();
  // Esperar pela sessão guardada: senão, ao recarregar a página, os ecrãs protegidos
  // pareciam não existir e a app voltava sempre ao início.
  if (!pronto || !fontes) return null;
  return (
    <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: cor.fundo } }}>
      <Stack.Screen name="index" />
      <Stack.Screen name="entrar" options={{ headerShown: true, title: "Entrar", headerBackTitle: "Voltar" }} />
      <Stack.Screen name="registar" options={{ headerShown: true, title: "Criar conta", headerBackTitle: "Voltar" }} />
      <Stack.Screen name="recuperar" options={{ headerShown: true, title: "Recuperar senha", headerBackTitle: "Voltar" }} />
      <Stack.Screen name="redefinir" options={{ headerShown: true, title: "Nova senha", headerBackTitle: "Voltar" }} />
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
