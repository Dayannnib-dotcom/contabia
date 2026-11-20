import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { Platform } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { useCallback, useState } from "react";
import { AberturaMare, ProvedorSessao, cor, useFontesContabia, useSessao } from "@contabia/ui";

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
      <Stack.Screen name="registar-casa" options={{ headerShown: true, title: "Plano Família", headerBackTitle: "Voltar" }} />
      <Stack.Screen name="recuperar" options={{ headerShown: true, title: "Recuperar senha", headerBackTitle: "Voltar" }} />
      <Stack.Screen name="redefinir" options={{ headerShown: true, title: "Nova senha", headerBackTitle: "Voltar" }} />
      {/* Ecrãs com sessão: ao sair, desaparecem antes de lerem uma sessão vazia. */}
      <Stack.Protected guard={!!sessao}>
        <Stack.Screen name="(tabs)" />
        <Stack.Screen name="casa" />
        <Stack.Screen name="documento/[id]" options={{ headerShown: true, title: "Documento", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="ligacao" options={{ headerShown: true, title: "Ligação ao contabilista", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="importar" options={{ headerShown: true, title: "Importar do e-Fatura", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="banco" options={{ headerShown: true, title: "Banco", headerBackTitle: "Voltar" }} />
        <Stack.Screen name="servicos" options={{ headerShown: true, title: "Serviços e reuniões", headerBackTitle: "Voltar" }} />
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
        <Abertura />
      </ProvedorSessao>
    </SafeAreaProvider>
  );
}

/** Abertura «A maré a baixar» (Guia 5) cada vez que a app abre; espera que a sessão e as fontes estejam prontas. */
function Abertura() {
  const { pronto } = useSessao();
  const fontes = useFontesContabia();
  const [ativa, setAtiva] = useState(true);
  const terminar = useCallback(() => setAtiva(false), []);
  return ativa ? <AberturaMare pronta={pronto && fontes} aoTerminar={terminar} /> : null;
}
