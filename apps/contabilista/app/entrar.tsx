import { useState } from "react";
import { useRouter } from "expo-router";
import { Botao, Campo, Ecra, Erro, LigacaoTermos, Titulo, useSessao } from "@contabia/ui";

export default function Entrar() {
  const { api, entrar } = useSessao();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      await entrar(await api.entrar({ papel: "contabilista", identificador: email, senha }));
      router.replace("/(tabs)");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }
  return (
    <Ecra>
      <Titulo>Entrar</Titulo>
      <Campo rotulo="E-mail" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry />
      <Erro texto={erro} />
      <Botao titulo="Entrar" onPress={enviar} carregando={aEnviar} desativado={!email.includes("@") || senha.length < 8} />
      <Botao titulo="Esqueci-me da senha" variante="secundario" onPress={() => router.push("/recuperar")} />
      <Botao titulo="Ainda não tenho conta — criar conta" variante="secundario" onPress={() => router.replace("/registar")} />
      <LigacaoTermos />
    </Ecra>
  );
}
