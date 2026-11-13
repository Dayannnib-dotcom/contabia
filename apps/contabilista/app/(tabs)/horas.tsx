import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { euros, horasLegiveis, mudarMes, nomeMes, sugestoesTempo } from "@contabia/shared";
import { Botao, Cartao, Chip, Cronometro, Ecra, Erro, Icone, MensagemLuis, Numero, Texto, Titulo, Vazio, cor, descreverPlano, entregarFicheiro, useDados, useSessao } from "@contabia/ui";

/** Contador de horas da carteira: reuniões feitas vs. previstas e horas por empresa, mês a mês. */
export default function Horas() {
  const { api, sessao } = useSessao();
  const router = useRouter();
  const [mes, setMes] = useState<string | null>(null);
  const { dados, erro } = useDados(() => api.horasCarteira(mes ?? undefined), [sessao!.id, mes]);
  const [msg, setMsg] = useState<string | null>(null);
  const abrir = (id: string) => router.push({ pathname: "/empresa/[id]", params: { id, sec: "servicos" } });
  const m = dados?.mes;
  const atual = !!dados && dados.mes === dados.hoje.slice(0, 7);
  const aDecorrer = dados?.empresas.filter((l) => l.aDecorrer) ?? [];
  const hoje = atual ? dados!.empresas.filter((l) => l.reuniaoDeHojePorRegistar) : [];
  const dicas = dados ? sugestoesTempo(dados.empresas.map((l) => ({
    nome: l.empresa.nome, minutosInvestidos: l.minutosInvestidos, tempoApp: l.tempoApp, valorHoraReal: l.valorHoraReal, honorarios: l.honorarios,
    reunioesEmFalta: atual ? l.resumo.reunioes.previstasAteHoje - l.resumo.reunioes.feitas : 0,
  }))) : [];

  return (
    <Ecra>
      <Titulo sub="Reuniões e serviços prestados a cada empresa, com o tempo gasto.">Horas</Titulo>
      <Erro texto={erro ?? msg} />
      {!dados ? <Texto sec>A carregar…</Texto> : (
        <>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
            <Pressable accessibilityRole="button" accessibilityLabel="Mês anterior" onPress={() => setMes(mudarMes(m!, -1))} style={{ padding: 10 }}><Text style={{ fontSize: 20, color: cor.texto }}>‹</Text></Pressable>
            <Texto forte tamanho={16} estilo={{ flex: 1, textAlign: "center" }}>{nomeMes(m!)}</Texto>
            <Pressable accessibilityRole="button" accessibilityLabel="Mês seguinte" accessibilityState={{ disabled: atual }} onPress={atual ? undefined : () => setMes(mudarMes(m!, 1))} style={{ padding: 10, opacity: atual ? 0.3 : 1 }}><Text style={{ fontSize: 20, color: cor.texto }}>›</Text></Pressable>
          </View>
          {aDecorrer.map((l) => (
            <Cartao key={l.empresa.id} onPress={() => abrir(l.empresa.id)} estilo={{ backgroundColor: cor.tinta, borderColor: cor.tinta }}>
              <Texto cor="#9FE3CF" forte tamanho={13}>A DECORRER · {l.empresa.nome.toUpperCase()}</Texto>
              <Cronometro inicio={l.aDecorrer!.inicio!} />
              <Texto cor="#C9D6DC" tamanho={13}>Toque para terminar e registar ›</Texto>
            </Cartao>
          ))}
          {hoje.length ? (
            <MensagemLuis texto={hoje.length === 1 ? `Hoje há reunião prevista com a ${hoje[0].empresa.nome.replace(/\.$/, "")}.` : `Hoje há ${hoje.length} reuniões previstas: ${hoje.map((l) => l.empresa.nome.replace(/\.$/, "")).join(", ")}.`}
              acao={<Botao titulo="Abrir e registar" variante="menta" estilo={{ alignSelf: "flex-start", minHeight: 40, marginTop: 6 }} onPress={() => abrir(hoje[0].empresa.id)} />} />
          ) : null}
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Cartao estilo={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>Tempo investido</Texto><Numero tamanho={20}>{horasLegiveis(dados.total.investidos)}</Numero><Texto sec tamanho={11}>{horasLegiveis(dados.total.minutosApp)} na app</Texto></Cartao>
            <Cartao estilo={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>Reuniões</Texto><Numero tamanho={20}>{dados.total.previstas ? `${dados.total.reunioes}/${dados.total.previstas}` : dados.total.reunioes}</Numero><Texto sec tamanho={11}>{horasLegiveis(dados.total.minutosReunioes)}</Texto></Cartao>
            {dados.total.valor != null
              ? <Cartao estilo={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>Valor do mês</Texto><Numero tamanho={20}>{euros(dados.total.valor)}</Numero><Texto sec tamanho={11}>empresas com valor definido</Texto></Cartao>
              : <Cartao estilo={{ flex: 1, gap: 2 }}><Texto sec tamanho={12}>Total faturável</Texto><Numero tamanho={20}>{horasLegiveis(dados.total.faturaveis)}</Numero></Cartao>}
          </View>
          {dicas.length ? <MensagemLuis escuro rotulo="Luís · onde vai o seu tempo" texto={dicas.join("\n\n")} /> : null}
          <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
            <Texto forte tamanho={16}>Por empresa</Texto>
            <Botao titulo="Exportar (Excel)" variante="secundario" estilo={{ minHeight: 38 }}
              onPress={async () => { try { const x = await api.exportarHorasCarteira(m!); await entregarFicheiro(x.nome, x.csv, "text/csv"); } catch (e) { setMsg((e as Error).message); } }} />
          </View>
          {dados.empresas.length === 0 ? <Vazio texto="Sem empresas ligadas." /> : null}
          {dados.empresas.map((l) => {
            const r = l.resumo.reunioes;
            const emFalta = atual ? r.previstasAteHoje - r.feitas : r.previstas - r.feitas;
            const pct = dados.total.investidos ? Math.round((l.minutosInvestidos / dados.total.investidos) * 100) : 0;
            return (
              <Cartao key={l.empresa.id} onPress={() => abrir(l.empresa.id)}>
                <View style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Texto forte>{l.empresa.nome}</Texto>
                    <Texto sec tamanho={12}>{descreverPlano(l.plano) ?? "Sem plano fixo de reuniões"}</Texto>
                  </View>
                  <Icone nome="seguir" cor={cor.textoSec} />
                </View>
                <View style={{ flexDirection: "row", gap: 6, flexWrap: "wrap" }}>
                  <Chip texto={`Investido ${horasLegiveis(l.minutosInvestidos)}${pct ? ` · ${pct}%` : ""}`} tipo={l.minutosInvestidos ? "bom" : "neutro"} />
                  {l.tempoApp.segundos >= 60 ? <Chip texto={`Na app · ${horasLegiveis(Math.round(l.tempoApp.segundos / 60))}`} /> : null}
                  {l.valorHoraReal != null ? <Chip texto={`${euros(l.valorHoraReal)}/h real`} tipo="neutro" /> : null}
                  <Chip texto={`${r.previstas ? `${r.feitas}/${r.previstas}` : r.feitas} reuniões · ${horasLegiveis(r.minutos)}`} tipo={r.previstas && emFalta > 0 ? "aviso" : r.feitas ? "bom" : "neutro"} />
                  {l.resumo.minutosTotal > r.minutos ? <Chip texto={`Outros serviços · ${horasLegiveis(l.resumo.minutosTotal - r.minutos)}`} /> : null}
                  {r.previstas && emFalta > 0 ? <Chip texto={`${emFalta} por registar`} tipo="aviso" /> : null}
                </View>
              </Cartao>
            );
          })}
        </>
      )}
    </Ecra>
  );
}
