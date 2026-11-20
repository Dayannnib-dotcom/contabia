import { useState } from "react";
import { useRouter } from "expo-router";
import { Linking, Platform, View } from "react-native";
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
      <Titulo sub="O Contabilista Certificado entra com o e-mail da conta.">Bem-vindo de volta</Titulo>
      <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
        {(["Empresa", "Família"] as const).map((t) => (
          <Botao key={t} titulo={t} variante="secundario" estilo={{ flex: 1 }}
            onPress={() => { if (Platform.OS === "web") window.location.href = "/empresa/entrar"; else void Linking.openURL("https://contabia-eu.onrender.com/empresa/entrar"); }} />
        ))}
        <Botao titulo="Contabilista" variante="principal" estilo={{ flex: 1.25 }} />
      </View>
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
