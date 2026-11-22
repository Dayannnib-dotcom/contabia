import { Text, View } from "react-native";
import { dataPT, diasAte, nomePeriodo } from "@contabia/shared";
import { AtivarAvisos, Cartao, Chip, Ecra, Erro, Linha, MensagemLuis, Texto, Titulo, cor, useDados, useSessao } from "@contabia/ui";

const MES = ["JAN", "FEV", "MAR", "ABR", "MAI", "JUN", "JUL", "AGO", "SET", "OUT", "NOV", "DEZ"];

export default function Prazos() {
  const { api, sessao } = useSessao();
  const { dados, erro } = useDados(() => api.prazos(sessao!.id), [sessao!.id]);
  const hoje = new Date().toISOString().slice(0, 10);
  const pendentes = (dados ?? []).filter((p) => !p.submetida && p.codigo !== "efatura" && diasAte(hoje, p.prazo) >= 0).sort((a, b) => a.prazo.localeCompare(b.prazo));
  const proximo = pendentes[0];
  const dProx = proximo ? diasAte(hoje, proximo.prazo) : null;
  const emAtraso = (dados ?? []).filter((p) => p.atrasada && !p.submetida);
  return (
    <Ecra>
      <Titulo sub="Calculado para o seu regime e região; atualizado automaticamente quando a lei muda.">Prazos fiscais</Titulo>
      <AtivarAvisos avisos={dados ? dados.filter((p) => !p.submetida).map((p) => ({ chave: `${p.codigo}:${p.periodo}`, prazo: p.prazo, titulo: p.descricao, corpo: `Luís: termina a ${p.prazo.split("-").reverse().join("/")} (${nomePeriodo(p.periodo)}). Envie já os documentos que faltam.` })) : null} />
      <Erro texto={erro} />
      {emAtraso.length ? <MensagemLuis expressao="alerta" texto={`Em atraso: ${emAtraso.map((p) => `${p.descricao} (${nomePeriodo(p.periodo)})`).join("; ")}. Fale já com o seu contabilista.`} /> : null}
      {dados ? (proximo && dProx !== null ? (
        dProx <= 7
          ? <MensagemLuis expressao="alerta" texto={`${dProx === 0 ? "É hoje" : `Faltam ${dProx} ${dProx === 1 ? "dia" : "dias"}`}: ${proximo.descricao} (${nomePeriodo(proximo.periodo)}). Confirme que o seu contabilista já tem todos os documentos.`} />
          : <MensagemLuis expressao="atento" texto={`O próximo prazo é ${proximo.descricao}, até ${dataPT(proximo.prazo)}. Eu aviso-o 7 e 2 dias antes.`} />
      ) : emAtraso.length ? null : <MensagemLuis expressao="celebrar" texto="Está tudo em dia: não há prazos por cumprir." />) : null}
      <Cartao estilo={{ paddingVertical: 4 }}>
        {(dados ?? []).map((p, i) => {
          const d = diasAte(hoje, p.prazo);
          return (
            <Linha key={i}
              esquerda={
                <View style={{ flexDirection: "row", gap: 12, alignItems: "center" }}>
                  <View style={{ width: 40, alignItems: "center" }}>
                    <Text style={{ fontSize: 10, fontWeight: "700", color: d <= 7 ? cor.ambarTexto : cor.textoSec }}>{MES.at(Number(p.prazo.slice(5, 7)) - 1)}</Text>
                    <Text style={{ fontSize: 18, fontWeight: "700", color: cor.texto }}>{Number(p.prazo.slice(8, 10))}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <Texto forte>{p.descricao}</Texto>
                    <Texto sec tamanho={12}>{nomePeriodo(p.periodo)} · até {dataPT(p.prazo)}</Texto>
                  </View>
                </View>
              }
              direita={p.submetida ? <Chip texto="Submetida" tipo="bom" /> : p.codigo === "efatura" ? <Chip texto="Automático" tipo="bom" /> : <Chip texto={d < 0 ? "Em atraso" : d === 0 ? "Hoje" : `${d} dias`} tipo={d < 0 ? "erro" : d <= 7 ? "aviso" : "neutro"} />}
            />
          );
        })}
      </Cartao>
      <Texto sec tamanho={12}>As declarações são submetidas pelo seu Contabilista Certificado. O Luís avisa 7 e 2 dias antes.</Texto>
    </Ecra>
  );
}
