import { useState } from "react";
import { Pressable, View } from "react-native";
import { euros, lerCSVExtrato, type MovimentoBancario } from "@contabia/shared";
import { Botao, Cartao, Chip, Erro, MensagemLuis, Texto } from "./componentes";
import { escolherFicheiroTexto } from "./ficheiros";
import { useDados, useSessao } from "./sessao";
import { cor } from "./tema";

const dataCurta = (d: string) => d.split("-").reverse().join("/");
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/**
 * Banco e conciliação. O contabilista confirma, concilia em lote, pede faturas em falta
 * e ignora movimentos; a empresa importa o extrato e confirma as sugestões.
 */
export function Banco({ empresaId, papel }: { empresaId: string; papel: "empresa" | "contabilista" }) {
  const { api } = useSessao();
  const { dados, recarregar } = useDados(() => api.movimentos(empresaId), [empresaId]);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [verConciliados, setVerConciliados] = useState(false);
  const cc = papel === "contabilista";

  async function acao(chave: string, f: () => Promise<unknown>) {
    setErro(null);
    setOcupado(chave);
    try {
      await f();
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  async function importar() {
    setErro(null);
    setAviso(null);
    try {
      const f = await escolherFicheiroTexto();
      if (!f) return;
      const l = lerCSVExtrato(f.texto);
      if (!l.movimentos.length) return setErro(l.ignoradas[0]?.motivo ?? "O ficheiro não tem movimentos.");
      setOcupado("importar");
      const r = await api.importarExtrato(empresaId, l.movimentos);
      setAviso(`Importei ${r.novos} ${r.novos === 1 ? "movimento" : "movimentos"}${r.repetidos ? ` (${r.repetidos} já estavam importados)` : ""}. Encontrei a fatura provável de ${r.comSugestao}.`);
      await recarregar();
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setOcupado(null);
    }
  }

  const ms = dados ?? [];
  const porConciliar = ms.filter((m) => m.estado === "por_conciliar");
  const altas = porConciliar.filter((m) => m.sugestao?.confianca === "alta").length;
  const faltaDoc = ms.filter((m) => m.estado === "falta_documento");
  const conciliados = ms.filter((m) => m.estado === "conciliado");

  const cabecalho = (m: MovimentoBancario) => (
    <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
      <View style={{ flex: 1 }}>
        <Texto forte>{m.descricao}</Texto>
        <Texto sec tamanho={12}>{dataCurta(m.data)} · {m.valor < 0 ? "Pagamento" : "Recebimento"}</Texto>
      </View>
      <Texto forte cor={m.valor < 0 ? cor.texto : cor.verde}>{m.valor < 0 ? "−" : "+"}{euros(Math.abs(m.valor))}</Texto>
    </View>
  );

  return (
    <View style={{ gap: 12 }}>
      <Texto sec>Importe o extrato do banco em CSV (homebanking → movimentos → exportar). A Contabia liga cada movimento à fatura certa e explica porquê.</Texto>
      <Botao titulo="Importar extrato do banco" variante={ms.length ? "secundario" : "principal"} onPress={importar} carregando={ocupado === "importar"} />
      {aviso ? <MensagemLuis texto={aviso} /> : null}
      <Erro texto={erro} />

      {ms.length ? (
        <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
          <Chip texto={pl(porConciliar.length, "por conciliar", "por conciliar")} tipo={porConciliar.length ? "aviso" : "bom"} />
          <Chip texto={pl(conciliados.length, "conciliado", "conciliados")} tipo="bom" />
          {faltaDoc.length ? <Chip texto={pl(faltaDoc.length, "sem fatura", "sem fatura")} tipo="erro" /> : null}
        </View>
      ) : null}

      {cc && altas ? (
        <Botao titulo={altas === 1 ? "Conciliar a de confiança alta" : `Conciliar as ${altas} de confiança alta`} onPress={() => acao("auto", () => api.conciliarAutomatico(empresaId))} carregando={ocupado === "auto"} />
      ) : null}

      {porConciliar.map((m) => (
        <Cartao key={m.id} destaque={!!m.sugestao}>
          {cabecalho(m)}
          {m.sugestao ? (
            <>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <Chip texto={m.sugestao.confianca === "alta" ? "Confiança alta" : "Confirme"} tipo={m.sugestao.confianca === "alta" ? "bom" : "aviso"} />
                <Texto forte tamanho={13}>{m.sugestao.numero} · {m.sugestao.terceiroNome}</Texto>
              </View>
              <Texto sec tamanho={12}>{m.sugestao.motivo}</Texto>
            </>
          ) : (
            <Texto sec tamanho={12}>{m.valor < 0 ? "Não encontrei a fatura deste pagamento." : "Não encontrei a fatura de venda deste recebimento."}</Texto>
          )}
          <View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
            {m.sugestao ? <Botao titulo="Confirmar" onPress={() => acao(m.id, () => api.conciliar(empresaId, m.id, m.sugestao!.documentoId))} carregando={ocupado === m.id} estilo={{ flexGrow: 1 }} /> : null}
            {cc ? <Botao titulo="Pedir fatura à empresa" variante="secundario" onPress={() => acao(m.id + "p", () => api.pedirFaturaEmFalta(empresaId, m.id))} carregando={ocupado === m.id + "p"} estilo={{ flexGrow: 1 }} /> : null}
            {cc ? <Botao titulo="Ignorar" variante="secundario" onPress={() => acao(m.id + "i", () => api.ignorarMovimento(empresaId, m.id))} carregando={ocupado === m.id + "i"} estilo={{ flexGrow: 1 }} /> : null}
          </View>
        </Cartao>
      ))}

      {faltaDoc.length ? <Texto forte tamanho={15}>Faturas pedidas à empresa</Texto> : null}
      {faltaDoc.map((m) => (
        <Cartao key={m.id}>
          {cabecalho(m)}
          <Texto sec tamanho={12}>{cc ? "Pedido enviado à empresa. Quando ela registar a fatura, a sugestão aparece aqui." : "O seu contabilista precisa da fatura deste pagamento. Registe-a em Digitalizar."}</Texto>
          {m.sugestao ? <Botao titulo={`Confirmar ${m.sugestao.numero}`} onPress={() => acao(m.id, () => api.conciliar(empresaId, m.id, m.sugestao!.documentoId))} carregando={ocupado === m.id} /> : null}
        </Cartao>
      ))}

      {conciliados.length ? (
        <Pressable accessibilityRole="button" onPress={() => setVerConciliados((v) => !v)}>
          <Texto forte cor={cor.verde}>{verConciliados ? "Esconder" : "Ver"} {conciliados.length === 1 ? "o conciliado" : `os ${conciliados.length} conciliados`} ›</Texto>
        </Pressable>
      ) : null}
      {verConciliados ? conciliados.map((m) => (
        <Cartao key={m.id}>
          {cabecalho(m)}
          <Texto sec tamanho={12}>✓ {m.documento?.numero} · {m.documento?.terceiroNome}</Texto>
          <Botao titulo="Desfazer" variante="secundario" onPress={() => acao(m.id + "d", () => api.desfazerConciliacao(empresaId, m.id))} carregando={ocupado === m.id + "d"} />
        </Cartao>
      )) : null}
    </View>
  );
}
