import { useState } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { Botao, Campo, Ecra, Erro, LigacaoTermos, Titulo, useSessao } from "@contabia/ui";

export default function Entrar() {
  const { api, entrar } = useSessao();
  const router = useRouter();
  const [tipo, setTipo] = useState<"empresa" | "casa">("empresa");
  const [utilizador, setUtilizador] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      await entrar(await api.entrar({ papel: tipo, identificador: utilizador, senha }));
      router.replace(tipo === "casa" ? "/casa" : "/(tabs)");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub={tipo === "empresa" ? "O gestor entra com o utilizador da empresa. Os colaboradores entram com o próprio e-mail." : "Entre com o e-mail da conta do Plano Casa."}>Bem-vindo de volta</Titulo>
      <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
        <Botao titulo="Empresa" variante={tipo === "empresa" ? "principal" : "secundario"} onPress={() => setTipo("empresa")} estilo={{ flex: 1 }} />
        <Botao titulo="Plano Casa" variante={tipo === "casa" ? "principal" : "secundario"} onPress={() => setTipo("casa")} estilo={{ flex: 1 }} />
      </View>
      <Campo rotulo={tipo === "empresa" ? "Utilizador da empresa ou e-mail" : "E-mail"} value={utilizador} onChangeText={setUtilizador} autoCapitalize="none" autoCorrect={false} keyboardType={tipo === "casa" ? "email-address" : "default"} placeholder={tipo === "empresa" ? "ex.: empresa.a ou marta@empresa.pt" : "ex.: rita@exemplo.pt"} />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry />
      <Erro texto={erro} />
      <Botao titulo="Entrar" onPress={enviar} carregando={aEnviar} desativado={!utilizador || senha.length < 8} />
      <Botao titulo="Esqueci-me da senha" variante="secundario" onPress={() => router.push("/recuperar")} />
      <Botao titulo="Ainda não tenho conta — criar conta" variante="secundario" onPress={() => router.replace(tipo === "casa" ? "/registar-casa" : "/registar")} />
      <LigacaoTermos />
    </Ecra>
  );
}
