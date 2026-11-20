import { View } from "react-native";
import { Redirect, useRouter } from "expo-router";
import { ErroApi, dataPT, diasAte, euros, saudacao } from "@contabia/shared";
import { Botao, CALENDARIO_PAPEL, Cartao, Ecra, Erro, Icone, Linha, MensagemLuis, Numero, PlacaPadrao, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

const MESES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

/** Painel do Plano Família: deduções estimadas do ano, próximos prazos e atalhos. */
export default function PainelCasa() {
  const { api, sessao, sair } = useSessao();
  const router = useRouter();
  const daEmpresa = sessao!.papel === "empresa";
  const { dados, erro } = useDados(async () => {
    try { return await api.casa(); } catch (e) { if (e instanceof ErroApi && e.codigo === "sem_familia") return "ativar" as const; throw e; }
  }, []);
  if (dados === "ativar") return <Redirect href="/casa/ativar" />;
  const hoje = new Date().toISOString().slice(0, 10);
  const prox = dados?.prazos.find((p) => p.data >= hoje);
  const primeiroNome = (dados?.agregado.nome ?? sessao!.nome).split(" ")[0];
  const msg = !dados ? "A preparar o seu resumo…"
    : dados.despesasDoAno === 0 ? `${saudacao()}, ${primeiroNome}! Fotografe as faturas da casa e eu digo-lhe quanto já conta para o IRS.`
    : `${saudacao()}, ${primeiroNome}! Já tem ${dados.despesasDoAno} ${dados.despesasDoAno === 1 ? "fatura" : "faturas"} de ${dados.ano}. A estimativa de deduções vai em ${euros(dados.deducoes.total)}.`;

  return (
    <Ecra>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start" }}>
        <Titulo sub={daEmpresa ? "Família · separada da empresa" : "Plano Família · IRS e faturas da casa"}>{dados?.agregado.nome ?? sessao!.nome}</Titulo>
      </View>
      <MensagemLuis texto={msg} escuro expressao={dados && dados.despesasDoAno > 0 ? "celebrar" : "sorriso"} />
      <Erro texto={erro} />

      <Botao titulo="Fotografar uma fatura" onPress={() => router.push("/casa/fatura")} icone={<Icone nome="digitalizar" cor="#FFFFFF" />} />
      <Botao titulo="Importar do e-Fatura" variante="secundario" onPress={() => router.push("/casa/importar")} />

      {dados ? (
        <Cartao>
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}>
            <View style={{ gap: 2 }}>
              <Texto sec tamanho={12}>DEDUÇÕES ESTIMADAS · {dados.ano}</Texto>
              <Numero tamanho={30}>{euros(dados.deducoes.total)}</Numero>
            </View>
            <Texto sec tamanho={12}>{dados.despesasDoAno} faturas</Texto>
          </View>
          {dados.deducoes.linhas.map((l) => (
            <View key={l.categoria} style={{ gap: 4 }} accessible accessibilityLabel={`${l.nome}: ${euros(l.deducao)} de ${euros(l.limite)}`}>
              <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
                <Texto tamanho={14}>{l.nome}</Texto>
                <Texto tamanho={13} sec>{euros(l.deducao)} de {euros(l.limite)}</Texto>
              </View>
              <View style={{ height: 6, borderRadius: 3, backgroundColor: cor.linha, overflow: "hidden" }}>
                <View style={{ width: `${Math.round(l.usado * 100)}%`, height: 6, backgroundColor: l.usado >= 1 ? cor.verde : cor.menta }} />
              </View>
            </View>
          ))}
          <Texto sec tamanho={12}>Estimativa com as faturas registadas aqui. O valor final é calculado pela Autoridade Tributária.</Texto>
        </Cartao>
      ) : null}

      {prox ? (
        <PlacaPadrao mosaico={CALENDARIO_PAPEL} escala={0.6}>
          <Cartao estilo={{ backgroundColor: cor.ambar, borderColor: cor.ambar, flexDirection: "row", alignItems: "center" }}>
            <View style={{ width: 52, alignItems: "center" }}>
              <Texto tamanho={11} forte cor={cor.ambarTexto}>{MESES.at(Number(prox.data.slice(5, 7)) - 1)}</Texto>
              <Numero tamanho={22}>{prox.data.slice(8, 10)}</Numero>
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Texto forte>{prox.titulo}</Texto>
              <Texto tamanho={12} cor={cor.ambarTexto}>{dataPT(prox.data)} · faltam {diasAte(hoje, prox.data)} dias</Texto>
            </View>
          </Cartao>
        </PlacaPadrao>
      ) : null}

      <Cartao>
        <Linha esquerda="Faturas da casa" sub="Ver, mudar a categoria ou anular" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/casa/faturas")} />
        <Linha esquerda="Agregado familiar" sub="Titulares, dependentes e consentimentos" direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/casa/agregado")} />
        <Linha esquerda="Serviço de IRS" sub={dados?.agregado.servicoIRS ? "Pedido enviado: um contabilista vai contactá-lo" : "Um Contabilista Certificado revê e entrega o seu IRS"} direita={<Icone nome="seguir" cor={cor.textoSec} />} onPress={() => router.push("/casa/irs")} />
      </Cartao>

      {dados ? (
        <Cartao>
          <Texto forte tamanho={15}>Calendário do IRS</Texto>
          {dados.prazos.map((p) => (
            <Linha key={p.codigo} esquerda={p.titulo} sub={`${dataPT(p.data)} · ${p.detalhe}`} />
          ))}
        </Cartao>
      ) : null}

      {daEmpresa
        ? <Botao titulo="Voltar à empresa" variante="secundario" onPress={() => router.replace("/(tabs)")} />
        : <Botao titulo="Sair" variante="secundario" onPress={() => { void sair().then(() => router.replace("/")); }} />}
    </Ecra>
  );
}
