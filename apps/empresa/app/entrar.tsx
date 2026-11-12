import { useState } from "react";
import { useRouter } from "expo-router";
import { Botao, Campo, Ecra, Erro, Titulo, useSessao } from "@contabia/ui";

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
      <Titulo sub="O gestor entra com o utilizador da empresa. Os colaboradores entram com o próprio e-mail.">Bem-vindo de volta</Titulo>
      <Campo rotulo="Utilizador da empresa ou e-mail" value={utilizador} onChangeText={setUtilizador} autoCapitalize="none" autoCorrect={false} placeholder="ex.: empresa.a ou marta@empresa.pt" />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry />
      <Erro texto={erro} />
      <Botao titulo="Entrar" onPress={enviar} carregando={aEnviar} desativado={!utilizador || senha.length < 8} />
      <Botao titulo="Ainda não tenho conta — criar conta" variante="secundario" onPress={() => router.replace("/registar")} />
    </Ecra>
  );
}
