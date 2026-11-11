import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ajudaNIF, formatarNIF } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, MensagemLuis, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

const ESTADO: Record<string, [string, "bom" | "aviso" | "erro" | "neutro"]> = {
  pendente: ["À espera da empresa", "aviso"], ativa: ["Ligada", "bom"], recusada: ["Recusada", "erro"], revogada: ["Revogada", "neutro"], expirada: ["Expirada", "neutro"],
};

export default function Ligar() {
  const { api, sessao, ultimoEvento } = useSessao();
  const router = useRouter();
  const [utilizador, setUtilizador] = useState("");
  const [nif, setNif] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const { dados, recarregar } = useDados(() => api.ligacoes(), [sessao!.id]);
  const ajuda = ajudaNIF(nif);

  async function enviar() {
    setAEnviar(true);
    setErro(null);
    try {
      await api.pedirLigacao(utilizador, nif);
      setUtilizador("");
      setNif("");
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub="Peça à empresa o utilizador e o NIF que ela vê em «Ligação ao contabilista». Os dois têm de coincidir.">Ligar uma empresa</Titulo>
      <Campo rotulo="Utilizador da empresa" value={utilizador} onChangeText={setUtilizador} autoCapitalize="none" autoCorrect={false} placeholder="ex.: atlantico.servicos" />
      <Campo rotulo="NIF da empresa" value={nif} onChangeText={setNif} keyboardType="number-pad"
        ajuda={ajuda.estado === "valido" ? "✓ NIF válido" : ajuda.mensagem} erro={ajuda.estado === "invalido"} />
      <Erro texto={erro} />
      <Botao titulo="Enviar pedido de ligação" onPress={enviar} carregando={aEnviar} desativado={!utilizador.trim() || ajuda.estado !== "valido"} />
      {ultimoEvento?.tipo === "ligacao.aceite" ? <MensagemLuis texto="Uma empresa acabou de aceitar a ligação. Já está na sua carteira." acao={<Botao titulo="Ver carteira" variante="menta" onPress={() => router.push("/(tabs)")} estilo={{ alignSelf: "flex-start", minHeight: 40 }} />} /> : null}

      <Texto forte tamanho={16}>Pedidos e ligações</Texto>
      {(dados ?? []).map((l) => (
        <Cartao key={l.id}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>{l.empresa?.nome}</Texto>
              <Texto sec tamanho={12}>{l.empresa?.utilizador} · NIF {formatarNIF(l.empresa?.nif ?? "")}</Texto>
            </View>
            <Chip texto={ESTADO[l.estado][0]} tipo={ESTADO[l.estado][1]} />
          </View>
          {l.estado === "pendente" ? <Texto sec tamanho={12}>A empresa recebeu o pedido na app e confirma com biometria. Expira a {l.expiraEm.slice(0, 10).split("-").reverse().join("/")}.</Texto> : null}
          {l.estado === "ativa" ? <Botao titulo="Abrir empresa" variante="secundario" onPress={() => router.push({ pathname: "/empresa/[id]", params: { id: l.empresaId } })} /> : null}
          {l.estado === "ativa" || l.estado === "pendente" ? <Botao titulo={l.estado === "ativa" ? "Terminar ligação" : "Cancelar pedido"} variante="perigo" onPress={async () => { await api.revogarLigacao(l.id, l.versao); recarregar(); }} /> : null}
        </Cartao>
      ))}
      <Texto sec tamanho={12} cor={cor.textoSec}>Por segurança: máximo de 5 pedidos por hora; os pedidos expiram em 72 horas.</Texto>
    </Ecra>
  );
}
