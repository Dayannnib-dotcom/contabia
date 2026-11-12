import { useRouter } from "expo-router";
import { EcraRecuperar } from "@contabia/ui";

export default function Recuperar() {
  const router = useRouter();
  return <EcraRecuperar papel="contabilista" aoVoltar={() => router.replace("/entrar")} />;
}
