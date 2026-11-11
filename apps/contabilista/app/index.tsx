import { Redirect, useRouter } from "expo-router";
import { EcraEntrada, useSessao } from "@contabia/ui";

export default function Inicio() {
  const { sessao, pronto } = useSessao();
  const router = useRouter();
  if (!pronto) return null;
  if (sessao) return <Redirect href="/(tabs)" />;
  return (
    <EcraEntrada
      papel="Área do Contabilista Certificado"
      saudacao="Bom dia! Preparo os lançamentos, o IVA e o SAF-T das suas empresas para rever e submeter."
      onEntrar={() => router.push("/entrar")}
      onCriarConta={() => router.push("/registar")}
    />
  );
}
