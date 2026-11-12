import { useState } from "react";
import { Platform, View } from "react-native";
import { useRouter } from "expo-router";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import { dataPT, euros, lerCSVEfatura, type LeituraEfatura } from "@contabia/shared";
import { Botao, Cartao, Chip, Ecra, Erro, Linha, MensagemLuis, Texto, Titulo, cor, useSessao } from "@contabia/ui";

/** O e-Fatura exporta às vezes em Latin-1; se não for UTF-8 válido, lê como Latin-1. */
function decodificar(bytes: Uint8Array): string {
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return s;
  }
}

async function lerFicheiro(uri: string): Promise<string> {
  if (Platform.OS === "web") return decodificar(new Uint8Array(await (await fetch(uri)).arrayBuffer()));
  const b64 = await FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.Base64 });
  const bin = globalThis.atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return decodificar(bytes);
}

const PASSOS = [
  "Entre no Portal das Finanças e abra o e-Fatura.",
  "Vá a «Consultar faturas» (ou «Verificar faturas»), como adquirente.",
  "Escolha as datas (por exemplo, o mês passado) e carregue em «Pesquisar».",
  "Carregue em «Exportar» para descarregar o ficheiro.",
  "Volte aqui e escolha esse ficheiro.",
];

export default function Importar() {
  const { api, sessao } = useSessao();
  const router = useRouter();
  const [leitura, setLeitura] = useState<LeituraEfatura | null>(null);
  const [tipo, setTipo] = useState<"compra" | "venda">("compra");
  const [erro, setErro] = useState<string | null>(null);
  const [aImportar, setAImportar] = useState(false);
  const [resultado, setResultado] = useState<{ importados: number; repetidos: number; erros: number; resultados: { numero: string; estado: string; mensagem?: string }[] } | null>(null);

  async function escolher() {
    setErro(null);
    setResultado(null);
    const r = await DocumentPicker.getDocumentAsync({ type: ["text/csv", "text/comma-separated-values", "application/vnd.ms-excel", "text/plain", "*/*"], copyToCacheDirectory: true });
    if (r.canceled || !r.assets[0]) return;
    try {
      const l = lerCSVEfatura(await lerFicheiro(r.assets[0].uri));
      if (!l.linhas.length) setErro(l.ignoradas[0]?.motivo ?? "O ficheiro não tem faturas.");
      setLeitura(l);
    } catch {
      setErro("Não consegui ler o ficheiro. Confirme que é o ficheiro exportado do e-Fatura.");
    }
  }

  async function importar() {
    if (!leitura) return;
    setAImportar(true);
    setErro(null);
    try {
      setResultado(await api.importarEfatura(sessao!.id, leitura.linhas, tipo));
      setLeitura(null);
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAImportar(false);
    }
  }

  const total = leitura?.linhas.reduce((s, l) => s + l.total, 0) ?? 0;

  return (
    <Ecra>
      <Titulo sub="Traga de uma vez todas as faturas que os fornecedores comunicaram à AT com o seu NIF.">Importar do e-Fatura</Titulo>

      {!leitura && !resultado ? (
        <Cartao>
          <Texto forte tamanho={15}>Como obter o ficheiro</Texto>
          {PASSOS.map((p, i) => (
            <View key={i} style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: cor.verdeClaro, alignItems: "center", justifyContent: "center" }}><Texto forte tamanho={12} cor={cor.verde}>{String(i + 1)}</Texto></View>
              <Texto estilo={{ flex: 1 }}>{p}</Texto>
            </View>
          ))}
          <Botao titulo="Escolher ficheiro do e-Fatura" onPress={escolher} />
        </Cartao>
      ) : null}
      <Erro texto={erro} />

      {leitura && leitura.linhas.length ? (
        <>
          <MensagemLuis texto={`Encontrei ${leitura.linhas.length} faturas, num total de ${euros(total)}. As que já estiverem registadas são saltadas, por isso pode importar o mesmo ficheiro sem medo.`} />
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Botao titulo="São compras" variante={tipo === "compra" ? "principal" : "secundario"} onPress={() => setTipo("compra")} estilo={{ flex: 1 }} />
            <Botao titulo="São vendas" variante={tipo === "venda" ? "principal" : "secundario"} onPress={() => setTipo("venda")} estilo={{ flex: 1 }} />
          </View>
          <Cartao estilo={{ paddingVertical: 4 }}>
            {leitura.linhas.slice(0, 15).map((l, i) => (
              <Linha key={i} esquerda={l.nome} sub={`${dataPT(l.data)} · ${l.numero}`} direita={<Texto forte>{euros(l.total)}</Texto>} />
            ))}
            {leitura.linhas.length > 15 ? <Texto sec tamanho={12}>… e mais {leitura.linhas.length - 15}</Texto> : null}
          </Cartao>
          {leitura.ignoradas.length ? (
            <Cartao>
              <Texto forte>Linhas que não vou importar ({leitura.ignoradas.length})</Texto>
              {leitura.ignoradas.slice(0, 8).map((x) => <Texto key={x.linha} sec tamanho={12}>Linha {x.linha}: {x.motivo}</Texto>)}
            </Cartao>
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Outro ficheiro" variante="secundario" onPress={escolher} estilo={{ flex: 1 }} />
            <Botao titulo={`Importar ${leitura.linhas.length} faturas`} onPress={importar} carregando={aImportar} estilo={{ flex: 2 }} />
          </View>
        </>
      ) : null}

      {resultado ? (
        <>
          <MensagemLuis texto={`Pronto! Importei ${resultado.importados} ${resultado.importados === 1 ? "fatura" : "faturas"}${resultado.repetidos ? `; ${resultado.repetidos} já estavam registadas` : ""}${resultado.erros ? `; ${resultado.erros} precisam da sua atenção` : ""}. Agora valide-as em Documentos e junte o original quando o tiver.`} />
          {resultado.resultados.filter((r) => r.estado === "erro").map((r, i) => (
            <Cartao key={i}><View style={{ flexDirection: "row", justifyContent: "space-between" }}><Texto forte>{r.numero}</Texto><Chip texto="Não importada" tipo="erro" /></View><Texto sec tamanho={12}>{r.mensagem}</Texto></Cartao>
          ))}
          <Botao titulo="Ver documentos" onPress={() => router.dismissTo("/(tabs)/documentos")} />
        </>
      ) : null}
    </Ecra>
  );
}
