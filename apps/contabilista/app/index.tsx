import { Redirect, useRouter } from "expo-router";
import { saudacao } from "@contabia/shared";
import { EcraEntrada, useSessao } from "@contabia/ui";

export default function Inicio() {
  const { sessao, pronto } = useSessao();
  const router = useRouter();
  if (!pronto) return null;
  if (sessao) return <Redirect href="/(tabs)" />;
  return (
    <EcraEntrada
      papel="Área do Contabilista Certificado"
      saudacao={`${saudacao()}, colega. Hoje temos trabalho para ver e submeter — já deixei os lançamentos, o IVA e o SAF-T das suas empresas preparados.`}
      rotulo="assistente do seu gabinete"
      onEntrar={() => router.push("/entrar")}
      onCriarConta={() => router.push("/registar")}
    />
  );
}
