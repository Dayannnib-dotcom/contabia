import { useState } from "react";
import { View } from "react-native";
import { useRouter } from "expo-router";
import { NOME_CATEGORIA_CASA, categoriaCasaSugerida, dataPT, euros, lerCSVEfatura, type LeituraEfatura, type ResultadoImportacaoCasa } from "@contabia/shared";
import { Botao, Cartao, Ecra, escolherFicheiroTexto, Erro, Linha, MensagemLuis, Texto, Titulo, cor, useSessao } from "@contabia/ui";

const PASSOS = [
  "Entre no Portal das Finanças e abra o e-Fatura.",
  "Vá a «Consultar faturas» como consumidor (adquirente).",
  "Escolha as datas (por exemplo, o ano todo) e carregue em «Pesquisar».",
  "Carregue em «Exportar» para descarregar o ficheiro.",
  "Volte aqui e escolha esse ficheiro.",
];

/** Importar as faturas da casa do e-Fatura: o Luís sugere a categoria de cada uma. */
export default function ImportarCasa() {
  const { api } = useSessao();
  const router = useRouter();
  const [leitura, setLeitura] = useState<LeituraEfatura | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacaoCasa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aImportar, setAImportar] = useState(false);

  async function escolher() {
    setErro(null); setResultado(null);
    try {
      const f = await escolherFicheiroTexto();
      if (!f) return;
      const l = lerCSVEfatura(f.texto);
      if (!l.linhas.length) setErro(l.ignoradas[0]?.motivo ?? "O ficheiro não tem faturas.");
      setLeitura(l);
    } catch (e) {
      setErro((e as Error).message || "Não consegui ler o ficheiro. Confirme que é o ficheiro exportado do e-Fatura.");
    }
  }
  async function importar() {
    if (!leitura) return;
    setAImportar(true); setErro(null);
    try { setResultado(await api.casaImportarEfatura(leitura.linhas)); setLeitura(null); }
    catch (e) { setErro((e as Error).message); }
    finally { setAImportar(false); }
  }
  const total = leitura?.linhas.reduce((s, l) => s + l.total, 0) ?? 0;

  return (
    <Ecra>
      <Titulo sub="Traga de uma vez as faturas que as lojas comunicaram à AT com o seu NIF.">Importar do e-Fatura</Titulo>
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
          <MensagemLuis texto={`Encontrei ${leitura.linhas.length} faturas, num total de ${euros(total)}. Sugeri a categoria de cada uma; pode corrigi-las depois em «Faturas da casa». As repetidas são saltadas.`} />
          <Cartao estilo={{ paddingVertical: 4 }}>
            {leitura.linhas.slice(0, 15).map((l, i) => (
              <Linha key={i} esquerda={l.nome} sub={`${dataPT(l.data)} · ${NOME_CATEGORIA_CASA[categoriaCasaSugerida(l.nome)]}`} direita={<Texto forte>{euros(l.total)}</Texto>} />
            ))}
            {leitura.linhas.length > 15 ? <Texto sec tamanho={12}>… e mais {leitura.linhas.length - 15}</Texto> : null}
          </Cartao>
          {leitura.ignoradas.length ? <Texto sec tamanho={12}>{leitura.ignoradas.length} linhas não entram (anuladas, notas de crédito ou ilegíveis).</Texto> : null}
          <Botao titulo={`Importar ${leitura.linhas.length} faturas`} onPress={importar} carregando={aImportar} />
          <Botao titulo="Escolher outro ficheiro" variante="secundario" onPress={escolher} />
        </>
      ) : null}
      {resultado ? (
        <>
          <MensagemLuis expressao="celebrar" texto={`Importei ${resultado.importadas} ${resultado.importadas === 1 ? "fatura" : "faturas"}.${resultado.repetidas ? ` ${resultado.repetidas === 1 ? "1 já estava guardada" : `${resultado.repetidas} já estavam guardadas`}.` : ""}${resultado.saudeSemConsentimento ? ` ${resultado.saudeSemConsentimento === 1 ? "1 fatura de saúde ficou" : `${resultado.saudeSemConsentimento} faturas de saúde ficaram`} de fora: dê o consentimento em «Agregado familiar» e importe outra vez.` : ""}`} />
          <Botao titulo="Ver as deduções" onPress={() => router.replace("/casa")} />
        </>
      ) : null}
    </Ecra>
  );
}
