import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { ajudaNIF, normalizarUtilizador, utilizadorValido, type Regiao, type RegimeIVA } from "@contabia/shared";
import { Botao, Campo, Ecra, Erro, Texto, Titulo, cor, useSessao } from "@contabia/ui";

function Opcoes<T extends string>({ rotulo, valor, opcoes, mudar }: { rotulo: string; valor: T; opcoes: [T, string][]; mudar: (v: T) => void }) {
  return (
    <View style={{ gap: 8 }}>
      <Text style={{ fontSize: 13, fontWeight: "600", color: cor.texto }}>{rotulo}</Text>
      <View style={{ flexDirection: "row", gap: 8 }} accessibilityRole="radiogroup">
        {opcoes.map(([v, t]) => {
          const on = v === valor;
          return (
            <Pressable key={v} accessibilityRole="radio" accessibilityState={{ checked: on }} onPress={() => mudar(v)}
              style={{ flex: 1, minHeight: 46, borderRadius: 14, borderWidth: on ? 2 : 1, borderColor: on ? cor.verde : cor.bordaForte, backgroundColor: on ? cor.verdeClaro : "#FFF", alignItems: "center", justifyContent: "center" }}>
              <Text style={{ fontWeight: on ? "600" : "400", color: cor.texto }}>{t}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function Registar() {
  const { api, entrar } = useSessao();
  const router = useRouter();
  const [nome, setNome] = useState("");
  const [utilizador, setUtilizador] = useState("");
  const [nif, setNif] = useState("");
  const [senha, setSenha] = useState("");
  const [regiao, setRegiao] = useState<Regiao>("PT-MA");
  const [regime, setRegime] = useState<RegimeIVA>("trimestral");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const ajuda = ajudaNIF(nif);
  const userOk = utilizadorValido(utilizador);
  const valido = nome.length >= 2 && userOk && ajuda.estado === "valido" && senha.length >= 8;

  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      await entrar(await api.registarEmpresa({ nome, utilizador, nif, senha, regiao, regimeIVA: regime }));
      router.replace("/(tabs)");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub="Com isto, a Contabia ajusta prazos, taxas de IVA e o que pedir em cada mês.">Configurar a empresa</Titulo>
      <Campo rotulo="Nome da empresa" value={nome} onChangeText={setNome} placeholder="ex.: Atlântico Serviços, Lda." />
      <Campo rotulo="Utilizador da empresa" value={utilizador} onChangeText={setUtilizador} autoCapitalize="none" autoCorrect={false}
        placeholder="ex.: atlantico.servicos" erro={!!utilizador && !userOk}
        ajuda={utilizador ? (userOk ? `Ficará: ${normalizarUtilizador(utilizador)}` : "3 a 40 letras, números, pontos ou hífenes.") : "O seu contabilista usa-o, com o NIF, para pedir a ligação."} />
      <Campo rotulo="NIF da empresa" value={nif} onChangeText={setNif} keyboardType="number-pad" maxLength={11}
        ajuda={ajuda.estado === "valido" ? "✓ NIF válido" : ajuda.mensagem} erro={ajuda.estado === "invalido"} />
      <Opcoes rotulo="Região fiscal" valor={regiao} mudar={setRegiao} opcoes={[["PT", "Continente"], ["PT-MA", "Madeira"], ["PT-AC", "Açores"]]} />
      <Opcoes rotulo="Regime de IVA" valor={regime} mudar={setRegime} opcoes={[["mensal", "Mensal"], ["trimestral", "Trimestral"]]} />
      <Campo rotulo="Senha" value={senha} onChangeText={setSenha} secureTextEntry ajuda="Mínimo de 8 caracteres." />
      <Texto sec tamanho={12}>A Contabia nunca pede a senha do Portal das Finanças. As submissões são feitas pelo seu contabilista.</Texto>
      <Erro texto={erro} />
      <Botao titulo="Criar conta" onPress={enviar} carregando={aEnviar} desativado={!valido} />
    </Ecra>
  );
}
