import { useState } from "react";
import { useRouter } from "expo-router";
import { ajudaNIF } from "@contabia/shared";
import { Botao, Campo, Ecra, Erro, LigacaoTermos, MensagemLuis, Titulo, useSessao } from "@contabia/ui";

/** Criar conta no Plano Família: para famílias sem empresa. A app é grátis. */
export default function RegistarCasa() {
  const { api, entrar } = useSessao();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [nif, setNif] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const ajuda = ajudaNIF(nif);
  const ok = nome.trim().length >= 2 && /\S+@\S+\.\S+/.test(email) && ajuda.estado === "valido" && senha.length >= 8;

  async function criar() {
    setAEnviar(true); setErro(null);
    try {
      await entrar(await api.registarCasa({ nome: nome.trim(), email: email.trim(), nif: nif.replace(/\s/g, ""), senha }));
      router.replace("/casa");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub="Para famílias sem empresa. A app é grátis.">Plano Família</Titulo>
      <MensagemLuis texto="Guardo as faturas da casa ao longo do ano e digo-lhe quanto já conta para o IRS. Quando chegar a altura, um contabilista pode entregar a declaração por si." />
      <Campo rotulo="O seu nome" value={nome} onChangeText={setNome} autoComplete="name" />
      <Campo rotulo="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" />
      <Campo rotulo="O seu NIF" value={nif} onChangeText={setNif} keyboardType="number-pad" erro={ajuda.estado === "invalido"} ajuda={nif ? ajuda.mensagem : "Para associar as faturas à sua pessoa."} />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry ajuda="Pelo menos 8 caracteres." autoComplete="new-password" />
      <Erro texto={erro} />
      <Botao titulo="Criar conta" onPress={criar} carregando={aEnviar} desativado={!ok} />
      <Botao titulo="Já tenho conta — entrar" variante="secundario" onPress={() => router.replace("/entrar")} />
      <LigacaoTermos />
    </Ecra>
  );
}
