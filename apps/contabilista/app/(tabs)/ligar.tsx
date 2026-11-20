import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { ajudaNIF, formatarNIF } from "@contabia/shared";
import { type Ligacao, type LigacaoFamilia } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, MensagemLuis, Texto, Titulo, confirmarBiometria, cor, useDados, useSessao } from "@contabia/ui";

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
  const [aTratar, setATratar] = useState<string | null>(null);
  const lista = dados ?? [];
  const convites = lista.filter((l) => l.estado === "pendente" && l.iniciadaPor === "empresa");
  const resto = lista.filter((l) => !(l.estado === "pendente" && l.iniciadaPor === "empresa"));
  const dataCurta = (iso: string) => iso.slice(0, 10).split("-").reverse().join("/");

  async function acao(l: Ligacao, tipo: "aceitar" | "recusar" | "revogar") {
    setErro(null);
    if (tipo === "aceitar" && !(await confirmarBiometria("Aceitar ligação à empresa"))) return setErro("Confirmação biométrica cancelada.");
    setATratar(l.id + tipo);
    try {
      if (tipo === "aceitar") await api.aceitarLigacao(l.id, l.versao);
      else if (tipo === "recusar") await api.recusarLigacao(l.id, l.versao);
      else await api.revogarLigacao(l.id, l.versao);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setATratar(null);
      await recarregar();
    }
  }

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
      {convites.length ? <Texto forte tamanho={16}>Convites recebidos</Texto> : null}
      {convites.map((l) => (
        <Cartao key={l.id} destaque>
          <Chip texto="Convite de empresa" tipo="aviso" />
          <Texto forte tamanho={16}>{l.empresa?.nome}</Texto>
          <Texto sec tamanho={12}>{l.empresa?.utilizador} · NIF {formatarNIF(l.empresa?.nif ?? "")} · expira a {dataCurta(l.expiraEm)}</Texto>
          <Texto>Esta empresa convidou-o para ser o contabilista dela. Ao aceitar, entra na sua carteira com acesso a documentos, lançamentos, IVA, SAF-T e fecho.</Texto>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Recusar" variante="secundario" onPress={() => acao(l, "recusar")} carregando={aTratar === l.id + "recusar"} estilo={{ flex: 1 }} />
            <Botao titulo="Aceitar convite" onPress={() => acao(l, "aceitar")} carregando={aTratar === l.id + "aceitar"} estilo={{ flex: 2 }} />
          </View>
        </Cartao>
      ))}

      <Titulo sub="Peça à empresa o utilizador e o NIF que ela vê em «Ligação ao contabilista». Os dois têm de coincidir.">Ligar uma empresa</Titulo>
      <Campo rotulo="Utilizador da empresa" value={utilizador} onChangeText={setUtilizador} autoCapitalize="none" autoCorrect={false} placeholder="ex.: atlantico.servicos" />
      <Campo rotulo="NIF da empresa" value={nif} onChangeText={setNif} keyboardType="number-pad"
        ajuda={ajuda.estado === "valido" ? "✓ NIF válido" : ajuda.mensagem} erro={ajuda.estado === "invalido"} />
      <Erro texto={erro} />
      <Botao titulo="Enviar pedido de ligação" onPress={enviar} carregando={aEnviar} desativado={!utilizador.trim() || ajuda.estado !== "valido"} />
      {ultimoEvento?.tipo === "ligacao.aceite" ? <MensagemLuis expressao="celebrar" texto="Uma empresa acabou de aceitar a ligação. Já está na sua carteira." acao={<Botao titulo="Ver carteira" variante="menta" onPress={() => router.push("/(tabs)")} estilo={{ alignSelf: "flex-start", minHeight: 40 }} />} /> : null}

      {resto.length ? <Texto forte tamanho={16}>Pedidos e ligações</Texto> : null}
      {resto.map((l) => (
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
          {l.estado === "ativa" || l.estado === "pendente" ? <Botao titulo={l.estado === "ativa" ? "Terminar ligação" : "Cancelar pedido"} variante={l.estado === "ativa" ? "perigo" : "secundario"} onPress={() => acao(l, "revogar")} carregando={aTratar === l.id + "revogar"} /> : null}
        </Cartao>
      ))}
      <LigarFamilia />
      <Texto sec tamanho={12} cor={cor.textoSec}>A empresa também pode convidá-lo a partir da app dela, com o seu e-mail ou n.º OCC; o convite aparece aqui no topo. Por segurança: máximo de 5 pedidos por hora; os pedidos expiram em 72 horas.</Texto>
    </Ecra>
  );
}

/** Famílias (Plano Família): pedir ligação com o e-mail da conta e o NIF do titular; responder a convites. */
function LigarFamilia() {
  const { api } = useSessao();
  const router = useRouter();
  const { dados, recarregar } = useDados(() => api.familiasLigacoes(), []);
  const [email, setEmail] = useState("");
  const [nif, setNif] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aTratar, setATratar] = useState<string | null>(null);
  const ajuda = ajudaNIF(nif);
  const lista = (dados ?? []).filter((l) => l.estado === "pendente" || l.estado === "ativa");
  async function fazer(chave: string, f: () => Promise<unknown>) {
    setErro(null); setATratar(chave);
    try { await f(); await recarregar(); } catch (e) { setErro((e as Error).message); } finally { setATratar(null); }
  }
  const estado = (l: LigacaoFamilia) => l.estado === "ativa" ? ["Ligada", "bom"] as const : l.iniciadaPor === "familia" ? ["Convite da família", "aviso"] as const : ["À espera da família", "aviso"] as const;
  return (
    <>
      <Titulo sub="Para o IRS de particulares. Peça à família o e-mail da conta Família e o NIF do titular.">Ligar uma família</Titulo>
      {lista.map((l) => (
        <Cartao key={l.id} destaque={l.estado === "pendente" && l.iniciadaPor === "familia"}>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
            <View style={{ flex: 1 }}>
              <Texto forte>{l.familia?.nome}</Texto>
              <Texto sec tamanho={12}>Titular {l.familia?.titular} · NIF {formatarNIF(l.familia?.nif ?? "")}</Texto>
            </View>
            <Chip texto={estado(l)[0]} tipo={estado(l)[1]} />
          </View>
          {l.estado === "pendente" && l.iniciadaPor === "familia" ? (
            <View style={{ flexDirection: "row", gap: 10 }}>
              <Botao titulo="Recusar" variante="secundario" estilo={{ flex: 1 }} carregando={aTratar === l.id + "r"} onPress={() => fazer(l.id + "r", () => api.familiasResponder(l.id, "recusar"))} />
              <Botao titulo="Aceitar convite" estilo={{ flex: 2 }} carregando={aTratar === l.id + "a"} onPress={() => fazer(l.id + "a", () => api.familiasResponder(l.id, "aceitar"))} />
            </View>
          ) : null}
          {l.estado === "ativa" ? <Botao titulo="Abrir família" variante="secundario" onPress={() => router.push({ pathname: "/familia/[id]", params: { id: l.agregadoId } })} /> : null}
          {l.estado === "ativa" || l.iniciadaPor === "contabilista" ? <Botao titulo={l.estado === "ativa" ? "Terminar ligação" : "Cancelar pedido"} variante={l.estado === "ativa" ? "perigo" : "secundario"} carregando={aTratar === l.id + "t"} onPress={() => fazer(l.id + "t", () => api.familiasResponder(l.id, "revogar"))} /> : null}
        </Cartao>
      ))}
      <Campo rotulo="E-mail da conta Família" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" />
      <Campo rotulo="NIF do titular" value={nif} onChangeText={setNif} keyboardType="number-pad" ajuda={ajuda.estado === "valido" ? "✓ NIF válido" : ajuda.mensagem} erro={ajuda.estado === "invalido"} />
      <Erro texto={erro} />
      <Botao titulo="Pedir ligação à família" desativado={!/\S+@\S+\.\S+/.test(email) || ajuda.estado !== "valido"} carregando={aTratar === "novo"}
        onPress={() => fazer("novo", async () => { await api.familiasPedirLigacao(email.trim(), nif.replace(/\s/g, "")); setEmail(""); setNif(""); })} />
      <Texto sec tamanho={12}>A família aceita na app, em «Agregado familiar». As famílias de empresários também o podem convidar com o seu e-mail.</Texto>
    </>
  );
}
