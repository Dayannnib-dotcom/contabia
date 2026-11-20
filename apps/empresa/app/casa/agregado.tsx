import { useState } from "react";
import { useRouter } from "expo-router";
import { View } from "react-native";
import { dataPT, validarNIF } from "@contabia/shared";
import { type LigacaoFamilia } from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Ecra, Erro, Linha, Texto, Titulo, useDados, useSessao } from "@contabia/ui";

/** Agregado familiar: titulares (até dois) e dependentes; consentimento para faturas de saúde. */
export default function AgregadoCasa() {
  const { api } = useSessao();
  const { dados, erro, recarregar } = useDados(() => api.casa(), []);
  const [nome, setNome] = useState("");
  const [nif, setNif] = useState("");
  const [tipo, setTipo] = useState<"titular" | "dependente">("dependente");
  const [falha, setFalha] = useState<string | null>(null);
  const [retirar, setRetirar] = useState<string | null>(null);
  const ativos = dados?.membros.filter((m) => m.ativo) ?? [];
  const consentimento = dados?.agregado.consentimentoSaudeEm;
  async function fazer(f: () => Promise<unknown>) { setFalha(null); try { await f(); recarregar(); } catch (e) { setFalha((e as Error).message); } }

  return (
    <Ecra>
      <Titulo sub="Quem entra na sua declaração de IRS">Agregado familiar</Titulo>
      <Erro texto={erro ?? falha} />
      <Cartao estilo={{ paddingVertical: 4 }}>
        {ativos.map((m) => (
          <Linha key={m.id} esquerda={m.nome} sub={`NIF ${m.nif}`} direita={<Chip texto={m.tipo === "titular" ? "Titular" : "Dependente"} tipo={m.tipo === "titular" ? "bom" : "neutro"} />}
            onPress={ativos.length > 1 ? () => setRetirar(retirar === m.id ? null : m.id) : undefined} />
        ))}
      </Cartao>
      {retirar ? (
        <Botao titulo={`Retirar ${ativos.find((m) => m.id === retirar)?.nome.split(" ")[0] ?? ""} do agregado`} variante="perigo"
          onPress={() => fazer(async () => { await api.casaDesativarMembro(retirar); setRetirar(null); })} />
      ) : ativos.length > 1 ? <Texto sec tamanho={12}>Para retirar alguém do agregado, toque no nome. Fica no histórico.</Texto> : null}

      <Cartao>
        <Texto forte tamanho={15}>Acrescentar pessoa</Texto>
        <View style={{ flexDirection: "row", gap: 8 }}>
          {(["dependente", "titular"] as const).map((x) => (
            <Botao key={x} titulo={x === "titular" ? "Titular" : "Dependente"} variante={tipo === x ? "principal" : "secundario"} onPress={() => setTipo(x)} estilo={{ flex: 1 }} />
          ))}
        </View>
        <Campo rotulo="Nome" value={nome} onChangeText={setNome} />
        <Campo rotulo="NIF" value={nif} onChangeText={setNif} keyboardType="number-pad" erro={nif.length >= 9 && !validarNIF(nif)} ajuda={tipo === "titular" ? "Cônjuge ou unido de facto, se entregam o IRS em conjunto." : "Filhos ou outros dependentes a seu cargo."} />
        <Botao titulo="Acrescentar" desativado={nome.trim().length < 2 || !validarNIF(nif)} onPress={() => fazer(async () => { await api.casaNovoMembro({ nome, nif: nif.replace(/\s/g, ""), tipo }); setNome(""); setNif(""); })} />
      </Cartao>

      <ContabilistaDaFamilia />

      <Cartao>
        <Texto forte tamanho={15}>Faturas de saúde</Texto>
        <Texto tamanho={13}>{consentimento
          ? `Deu o seu consentimento a ${dataPT(consentimento.slice(0, 10))} para guardarmos faturas de saúde. Usamo-las só para calcular a dedução.`
          : "Faturas de farmácias, consultas e exames são dados de saúde. Só as guardamos com o seu consentimento expresso."}</Texto>
        <Botao titulo={consentimento ? "Retirar consentimento" : "Dou o meu consentimento"} variante={consentimento ? "secundario" : "principal"} onPress={() => fazer(() => api.casaConsentirSaude(!consentimento))} />
        {consentimento ? <Texto sec tamanho={12}>Se retirar, as faturas de saúde já guardadas ficam até pedir para as anular.</Texto> : null}
      </Cartao>
      <ApagarConta />
    </Ecra>
  );
}

const ESTADO: Record<LigacaoFamilia["estado"], [string, "bom" | "aviso" | "erro" | "neutro"]> = {
  pendente: ["Pendente", "aviso"], ativa: ["Ligado", "bom"], recusada: ["Recusada", "erro"], revogada: ["Terminada", "neutro"],
};

/** Contabilista da família: convidar pelo e-mail, aceitar o pedido dele ou terminar a ligação. */
function ContabilistaDaFamilia() {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(() => api.casaLigacoes(), []);
  const [email, setEmail] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aTratar, setATratar] = useState<string | null>(null);
  const vivas = (dados ?? []).filter((l) => l.estado === "pendente" || l.estado === "ativa");
  async function fazer(chave: string, f: () => Promise<unknown>) {
    setErro(null); setATratar(chave);
    try { await f(); await recarregar(); } catch (e) { setErro((e as Error).message); } finally { setATratar(null); }
  }
  return (
    <Cartao>
      <Texto forte tamanho={15}>Contabilista da família</Texto>
      <Texto tamanho={13}>Um Contabilista Certificado ligado à família vê as faturas, as deduções e o agregado, e pode corrigir categorias. Pode terminar a ligação quando quiser.</Texto>
      {vivas.map((l) => (
        <View key={l.id} style={{ gap: 8 }}>
          <Linha esquerda={l.contabilista?.nome ?? "Contabilista"} sub={`OCC n.º ${l.contabilista?.numeroOCC ?? ""} · ${l.contabilista?.email ?? ""}`} direita={<Chip texto={l.estado === "pendente" && l.iniciadaPor === "familia" ? "À espera dele" : ESTADO[l.estado][0]} tipo={ESTADO[l.estado][1]} />} />
          {l.estado === "pendente" && l.iniciadaPor === "contabilista" ? (
            <View style={{ flexDirection: "row", gap: 8 }}>
              <Botao titulo="Recusar" variante="secundario" estilo={{ flex: 1 }} carregando={aTratar === l.id + "r"} onPress={() => fazer(l.id + "r", () => api.casaResponderLigacao(l.id, "recusar"))} />
              <Botao titulo="Aceitar" estilo={{ flex: 2 }} carregando={aTratar === l.id + "a"} onPress={() => fazer(l.id + "a", () => api.casaResponderLigacao(l.id, "aceitar"))} />
            </View>
          ) : (
            <Botao titulo={l.estado === "ativa" ? "Terminar ligação" : "Cancelar convite"} variante="perigo" carregando={aTratar === l.id + "t"} onPress={() => fazer(l.id + "t", () => api.casaResponderLigacao(l.id, "revogar"))} />
          )}
        </View>
      ))}
      {!vivas.length ? (
        <>
          <Campo rotulo="E-mail do contabilista" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" ajuda="O e-mail com que ele entra na Contabia." />
          <Botao titulo="Convidar contabilista" desativado={!/\S+@\S+\.\S+/.test(email)} carregando={aTratar === "convite"} onPress={() => fazer("convite", async () => { await api.casaConvidarContabilista(email.trim()); setEmail(""); })} />
        </>
      ) : null}
      <Erro texto={erro} />
    </Cartao>
  );
}

/** Apagar a conta Família e todos os dados (direito ao apagamento). Na empresa, apaga só a área Família. */
function ApagarConta() {
  const { api, sessao, sair } = useSessao();
  const router = useRouter();
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const daEmpresa = sessao!.papel === "empresa";
  async function apagar() {
    setAEnviar(true); setErro(null);
    try {
      await api.casaApagar(texto);
      if (daEmpresa) router.replace("/(tabs)");
      else { await sair(); router.replace("/"); }
    } catch (e) { setErro((e as Error).message); } finally { setAEnviar(false); }
  }
  return (
    <Cartao>
      <Texto forte tamanho={15}>{daEmpresa ? "Apagar a área Família" : "Apagar a conta"}</Texto>
      <Texto tamanho={13}>{daEmpresa
        ? "Apaga o agregado, as faturas da casa e as ligações a contabilistas da família. A empresa não é afetada."
        : "Apaga a conta, o agregado, as faturas e as ligações a contabilistas. Não dá para desfazer."}</Texto>
      {!aberto ? <Botao titulo={daEmpresa ? "Apagar a área Família" : "Apagar a conta"} variante="perigo" onPress={() => setAberto(true)} /> : (
        <>
          <Campo rotulo="Escreva APAGAR para confirmar" value={texto} onChangeText={setTexto} autoCapitalize="characters" autoCorrect={false} />
          <Erro texto={erro} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao titulo="Cancelar" variante="secundario" estilo={{ flex: 1 }} onPress={() => { setAberto(false); setTexto(""); }} />
            <Botao titulo="Apagar de vez" variante="perigo" estilo={{ flex: 1 }} carregando={aEnviar} desativado={texto.trim().toUpperCase() !== "APAGAR"} onPress={apagar} />
          </View>
        </>
      )}
      <Texto sec tamanho={12}>As cópias de segurança cifradas desaparecem no prazo de 30 dias.</Texto>
    </Cartao>
  );
}
