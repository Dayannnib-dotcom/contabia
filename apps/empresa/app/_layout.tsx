import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ProvedorSessao, cor, useSessao } from "@contabia/ui";

const URL_API = process.env.EXPO_PUBLIC_API_URL || (Platform.OS === "web" && typeof window !== "undefined" ? window.location.origin : "http://localhost:3000");

function Navegacao() {
  const { sessao, pronto } = useSessao();
  // Esperar pela sessão guardada: senão, ao recarregar a página, os ecrãs protegidos
  // pareciam não existir e a app voltava sempre ao início.
  if (!pronto) return null;
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
        <Stack.Screen name="documento/[id]" options={{ headerShown: true, title: "Documento", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="ligacao" options={{ headerShown: true, title: "Ligação ao contabilista", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="importar" options={{ headerShown: true, title: "Importar do e-Fatura", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="banco" options={{ headerShown: true, title: "Banco", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="apoios" options={{ headerShown: true, title: "Apoios europeus", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="utilizadores" options={{ headerShown: true, title: "Utilizadores", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="conta" options={{ headerShown: true, title: "Conta e segurança", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="atualizacoes" options={{ headerShown: true, title: "Atualizações fiscais", headerBackTitle: "Voltar" }} />
      </Stack.Protected>
    </Stack>
  );
}

export default function Raiz() {
  return (
    <SafeAreaProvider>
      <ProvedorSessao urlApi={URL_API} chave="contabia.empresa">
        <StatusBar style="dark" />
        <Navegacao />
      </ProvedorSessao>
    </SafeAreaProvider>
  );
}
