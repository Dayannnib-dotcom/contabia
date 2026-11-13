import { useState } from "react";
import { useRouter } from "expo-router";
import { Botao, Campo, Ecra, Erro, LigacaoTermos, Texto, Titulo, useSessao } from "@contabia/ui";

export default function Registar() {
  const { api, entrar } = useSessao();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [email, setEmail] = useState("");
  const [occ, setOcc] = useState("");
  const [senha, setSenha] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      await entrar(await api.registarContabilista({ nome, email, numeroOCC: occ, senha }));
      router.replace("/(tabs)");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }
  return (
    <Ecra>
      <Titulo sub="Conta profissional para gerir as suas empresas na Contabia.">Criar conta de contabilista</Titulo>
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} />
      <Campo rotulo="E-mail profissional" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Campo rotulo="N.º de Contabilista Certificado (OCC)" value={occ} onChangeText={setOcc} keyboardType="number-pad" />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry ajuda="Mínimo de 8 caracteres." />
      <Texto sec tamanho={12}>As empresas veem o seu nome e n.º OCC antes de aceitarem a ligação.</Texto>
      <Erro texto={erro} />
      <LigacaoTermos prefixo="Ao criar a conta, aceita os " />
      <Botao titulo="Criar conta" onPress={enviar} carregando={aEnviar} desativado={nome.length < 2 || !email.includes("@") || !occ || senha.length < 8} />
    </Ecra>
  );
}
