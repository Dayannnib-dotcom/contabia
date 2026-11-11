import { useState } from "react";
import { useRouter } from "expo-router";
import { Botao, Campo, Ecra, Erro, Texto, Titulo, useSessao } from "@contabia/ui";

export default function Entrar() {
  const { api, entrar } = useSessao();
  const router = useRouter();
  const [utilizador, setUtilizador] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      await entrar(await api.entrar({ papel: "empresa", identificador: utilizador, senha }));
      router.replace("/(tabs)");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub="Use o utilizador da empresa que escolheu ao criar a conta.">Bem-vindo de volta</Titulo>
      <Campo rotulo="Utilizador da empresa" value={utilizador} onChangeText={setUtilizador} autoCapitalize="none" autoCorrect={false} placeholder="ex.: empresa.a" />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry />
      <Erro texto={erro} />
      <Botao titulo="Entrar" onPress={enviar} carregando={aEnviar} desativado={!utilizador || senha.length < 8} />
      <Texto sec tamanho={13}>Ainda não tem conta? Volte atrás e escolha «Criar conta».</Texto>
    </Ecra>
  );
}
