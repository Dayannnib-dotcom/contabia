import { Redirect, Stack } from "expo-router";
import { cor, useSessao } from "@contabia/ui";

/** Plano Família: área das famílias sem empresa, dentro da mesma app. */
export default function LayoutCasa() {
  const { sessao, pronto } = useSessao();
  if (!pronto) return null;
  if (!sessao) return <Redirect href="/" />;
  // Conta Família, ou o gestor de uma empresa a gerir a casa (separada da empresa)
  if (sessao.papel !== "casa" && !(sessao.papel === "empresa" && sessao.perfil !== "colaborador")) return <Redirect href="/(tabs)" />;
  return (
    <Stack screenOptions={{ headerShown: true, headerBackTitle: "Voltar", contentStyle: { backgroundColor: cor.fundo } }}>
      <Stack.Screen name="index" options={{ headerShown: false }} />
      <Stack.Screen name="fatura" options={{ title: "Nova fatura" }} />
      <Stack.Screen name="faturas" options={{ title: "Faturas da casa" }} />
      <Stack.Screen name="agregado" options={{ title: "Agregado familiar" }} />
      <Stack.Screen name="irs" options={{ title: "Serviço de IRS" }} />
      <Stack.Screen name="ativar" options={{ title: "Área Família" }} />
      <Stack.Screen name="importar" options={{ title: "Importar do e-Fatura" }} />
    </Stack>
  );
}
