import { useLocalSearchParams, useRouter } from "expo-router";
import { EcraRecuperar } from "@contabia/ui";

export default function Recuperar() {
  const router = useRouter();
  const { tipo } = useLocalSearchParams<{ tipo?: string }>();
  return <EcraRecuperar papel={tipo === "casa" ? "casa" : "empresa"} aoVoltar={() => router.replace("/entrar")} />;
}
