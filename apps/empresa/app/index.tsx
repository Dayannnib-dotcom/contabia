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
      papel="A contabilidade da sua empresa, em dia."
      saudacao={`${saudacao()}! Sou o Luís. Estou atento a todas as suas faturas e obrigações — trato de as organizar para o seu contabilista.`}
      rotulo="o seu gestor virtual"
      onEntrar={() => router.push("/entrar")}
      onCriarConta={() => router.push("/registar")}
    />
  );
}
