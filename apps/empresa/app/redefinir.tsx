import { useLocalSearchParams, useRouter } from "expo-router";
import { EcraRedefinir } from "@contabia/ui";

export default function Redefinir() {
  const { token } = useLocalSearchParams<{ token?: string }>();
  const router = useRouter();
  return <EcraRedefinir token={token} aoTerminar={() => router.replace("/entrar")} />;
}
