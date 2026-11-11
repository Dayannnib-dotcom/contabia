import { Redirect, useRouter } from "expo-router";
import { EcraEntrada, useSessao } from "@contabia/ui";

export default function Inicio() {
  const { sessao, pronto } = useSessao();
  const router = useRouter();
  if (!pronto) return null;
  if (sessao) return <Redirect href="/(tabs)" />;
  return (
    <EcraEntrada
      papel="A contabilidade da sua empresa, em dia."
      saudacao="Olá! Sou o Luís. Ajudo-o a ter tudo organizado para o seu contabilista."
      onEntrar={() => router.push("/entrar")}
      onCriarConta={() => router.push("/registar")}
    />
  );
}
