import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  DIAS_SEMANA, NOME_MODALIDADE, NOME_SERVICO, NOME_TAREFA, datasPrevistas, euros, horasLegiveis, mudarMes, nomeMes, valorDoMes,
  type EspacoServicos, type RelatorioTempo, type Modalidade, type PlanoServicos, type Servico, type TipoServico,
} from "@contabia/shared";
import { Botao, Campo, Cartao, Chip, Erro, Linha, MensagemLuis, Numero, Texto, Vazio } from "./componentes";
import { entregarFicheiro } from "./partilhar";
import { useDados, useSessao } from "./sessao";
import { cor } from "./tema";

const MODALIDADES = Object.keys(NOME_MODALIDADE) as Modalidade[];
const TIPOS = Object.keys(NOME_SERVICO) as TipoServico[];
const dataPT = (d: string) => d.split("-").reverse().join("/");
const deDataPT = (t: string) => { const m = t.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/); return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null; };
const nomeDias = (d: number[]) => d.map((n) => DIAS_SEMANA.find(([k]) => k === n)?.[1]).join(", ");
const pl = (n: number, um: string, varios: string) => `${n} ${n === 1 ? um : varios}`;

/** Botões de escolha (um ou vários). */
export function Escolhas<T extends string | number>({ opcoes, valor, aoMudar, rotulo }: { opcoes: [T, string][]; valor: T | T[]; aoMudar: (v: T) => void; rotulo?: string }) {
  return (
    <View style={{ gap: 6 }}>
      {rotulo ? <Text style={{ fontSize: 13, fontWeight: "600", color: cor.texto }}>{rotulo}</Text> : null}
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
        {opcoes.map(([k, t]) => {
          const on = Array.isArray(valor) ? valor.includes(k) : valor === k;
          return (
            <Pressable key={String(k)} accessibilityRole={Array.isArray(valor) ? "checkbox" : "radio"} accessibilityState={{ checked: on }} accessibilityLabel={t} onPress={() => aoMudar(k)}
              style={{ minHeight: 38, minWidth: 44, paddingHorizontal: 14, borderRadius: 19, borderWidth: 1, borderColor: on ? cor.verde : cor.bordaForte, backgroundColor: on ? cor.verdeClaro : "#FFF", justifyContent: "center", alignItems: "center" }}>
              <Text style={{ fontWeight: "600", color: on ? cor.verdeEscuro : cor.texto }}>{t}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** Tempo a contar desde `inicio` (atualiza a cada segundo). */
export function Cronometro({ inicio, cor: c = "#FFFFFF", tamanho = 34 }: { inicio: string; cor?: string; tamanho?: number }) {
  const [agora, setAgora] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setAgora(Date.now()), 1000); return () => clearInterval(t); }, []);
  const s = Math.max(0, Math.floor((agora - Date.parse(inicio)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  const dd = (n: number) => String(n).padStart(2, "0");
  return <Text accessibilityLabel={`Tempo decorrido: ${h} horas e ${m} minutos`} style={{ fontSize: tamanho, fontWeight: "700", color: c, fontVariant: ["tabular-nums"] }}>{h ? `${h}:` : ""}{dd(m)}:{dd(x)}</Text>;
}

export function descreverPlano(p: PlanoServicos | null) {
  if (!p || !p.ativo || !p.diasSemana.length) return null;
  const n = p.diasSemana.length;
  return `${n === 1 ? "1 reunião" : `${n} reuniões`} por semana (${nomeDias(p.diasSemana)}${p.hora ? ` às ${p.hora}` : ""}), ${horasLegiveis(p.minutos)}, ${NOME_MODALIDADE[p.modalidade].toLowerCase()}`;
}

/**
 * Espaço de serviços de uma empresa: contador de horas de reunião, plano semanal e todos os serviços do mês.
 * O contabilista regista; a empresa vê (só leitura).
 */
export function EspacoServicosVista({ empresaId, papel }: { empresaId: string; papel: "contabilista" | "empresa" }) {
  const { api } = useSessao();
  const [mes, setMes] = useState<string | null>(null);
  const { dados, erro, recarregar } = useDados(() => api.servicos(empresaId, mes ?? undefined), [empresaId, mes]);
  const [msg, setMsg] = useState<string | null>(null);
  const cc = papel === "contabilista";
  if (erro) return <Erro texto={erro} />;
  if (!dados) return <Texto sec>A carregar…</Texto>;
  const m = dados.mes;
  const atual = m === dados.hoje.slice(0, 7);
  const r = dados.resumo;
  const aDecorrer = dados.servicos.find((s) => s.estado === "a_decorrer") ?? null;
  const plano = descreverPlano(dados.plano);

  return (
    <View style={{ gap: 12 }}>
      <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <Pressable accessibilityRole="button" accessibilityLabel="Mês anterior" onPress={() => setMes(mudarMes(m, -1))} style={{ padding: 10 }}><Text style={{ fontSize: 20, color: cor.texto }}>‹</Text></Pressable>
        <Texto forte tamanho={16} estilo={{ flex: 1, textAlign: "center" }}>{nomeMes(m)}</Texto>
        <Pressable accessibilityRole="button" accessibilityLabel="Mês seguinte" accessibilityState={{ disabled: atual }} onPress={atual ? undefined : () => setMes(mudarMes(m, 1))} style={{ padding: 10, opacity: atual ? 0.3 : 1 }}><Text style={{ fontSize: 20, color: cor.texto }}>›</Text></Pressable>
      </View>

      <View style={{ flexDirection: "row", gap: 10 }}>
        <Cartao estilo={{ flex: 1, gap: 2 }}>
          <Texto sec tamanho={12}>Reuniões</Texto>
          <Numero tamanho={24}>{r.reunioes.previstas ? `${r.reunioes.feitas}/${r.reunioes.previstas}` : r.reunioes.feitas}</Numero>
          <Texto sec tamanho={11}>{r.reunioes.previstas ? (atual ? `${r.reunioes.previstasAteHoje} previstas até hoje` : "feitas / previstas") : "sem plano fixo"}</Texto>
        </Cartao>
        <Cartao estilo={{ flex: 1, gap: 2 }}>
          <Texto sec tamanho={12}>Horas de reunião</Texto>
          <Numero tamanho={20}>{horasLegiveis(r.reunioes.minutos)}</Numero>
        </Cartao>
        <Cartao estilo={{ flex: 1, gap: 2 }}>
          <Texto sec tamanho={12}>Total faturável</Texto>
          <Numero tamanho={20}>{horasLegiveis(r.minutosFaturaveis)}</Numero>
          {r.minutosTotal !== r.minutosFaturaveis ? <Texto sec tamanho={11}>de {horasLegiveis(r.minutosTotal)}</Texto> : null}
        </Cartao>
      </View>
      {cc ? <TempoInvestido dados={dados} /> : null}
      {cc ? <Valores empresaId={empresaId} dados={dados} aoMudar={recarregar} /> : null}
      {cc && atual ? <Contador empresaId={empresaId} dados={dados} aDecorrer={aDecorrer} aoMudar={recarregar} /> : null}
      {!cc && aDecorrer ? (
        <Cartao estilo={{ backgroundColor: cor.tinta, borderColor: cor.tinta }}>
          <Texto cor="#9FE3CF" forte tamanho={13}>{NOME_SERVICO[aDecorrer.tipo].toUpperCase()} A DECORRER</Texto>
          <Cronometro inicio={aDecorrer.inicio!} />
        </Cartao>
      ) : null}
      {cc ? <PlanoReunioes empresaId={empresaId} plano={dados.plano} aoMudar={recarregar} /> : plano ? (
        <Cartao><Texto forte>Plano acordado com o seu contabilista</Texto><Texto>{plano}</Texto></Cartao>
      ) : null}
      {cc && atual ? <NovoServico empresaId={empresaId} hoje={dados.hoje} plano={dados.plano} aoMudar={recarregar} /> : null}

      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
        <Texto forte tamanho={16}>Serviços de {nomeMes(m).split(" de ")[0]}</Texto>
        {dados.servicos.length ? <Botao titulo="Exportar (Excel)" variante="secundario" estilo={{ minHeight: 38 }}
          onPress={async () => { try { const x = await api.exportarServicos(empresaId, m); await entregarFicheiro(x.nome, x.csv, "text/csv"); } catch (e) { setMsg((e as Error).message); } }} /> : null}
      </View>
      <Erro texto={msg} />
      <Cartao estilo={{ paddingVertical: 4 }}>
        {dados.servicos.length === 0 ? <Vazio texto={cc ? "Ainda sem serviços neste mês. Use o cronómetro numa reunião ou registe o tempo depois." : "Ainda sem serviços registados neste mês."} /> : null}
        {dados.servicos.map((s) => <LinhaServico key={s.id} s={s} empresaId={empresaId} cc={cc} aoMudar={recarregar} />)}
      </Cartao>
      {cc ? <PartilharRelatorio empresaId={empresaId} mes={m} jaPartilhado={dados.tempo.relatorios.some((x) => x.mes === m)} aoMudar={recarregar} /> : null}
      <Relatorios lista={dados.tempo.relatorios} cc={cc} />
      <Texto sec tamanho={12}>{cc
        ? "Nada se apaga: um registo errado anula-se com motivo e fica visível. A empresa vê este espaço (só leitura). Os honorários de contabilidade são acordados e faturados à parte."
        : "Registo feito pelo seu contabilista. Nada se apaga: correções e anulações ficam visíveis e no registo de atividade."}</Texto>
    </View>
  );
}

/** Cronómetro e atalho para a reunião de hoje prevista no plano. */
function Contador({ empresaId, dados, aDecorrer, aoMudar }: { empresaId: string; dados: EspacoServicos; aDecorrer: Servico | null; aoMudar: () => void }) {
  const { api } = useSessao();
  const [modalidade, setModalidade] = useState<Modalidade>(dados.plano?.modalidade ?? "presencial");
  const [notas, setNotas] = useState("");
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const fazer = async (k: string, f: () => Promise<unknown>) => { setOcupado(k); setErro(null); try { await f(); setNotas(""); aoMudar(); } catch (e) { setErro((e as Error).message); } finally { setOcupado(null); } };

  if (aDecorrer) {
    return (
      <Cartao estilo={{ backgroundColor: cor.tinta, borderColor: cor.tinta, gap: 10 }}>
        <Texto cor="#9FE3CF" forte tamanho={13}>{aDecorrer.titulo.toUpperCase()} A DECORRER{aDecorrer.modalidade ? ` · ${NOME_MODALIDADE[aDecorrer.modalidade].toUpperCase()}` : ""}</Texto>
        <Cronometro inicio={aDecorrer.inicio!} />
        <Campo rotulo="Notas da reunião (opcional)" value={notas} onChangeText={setNotas} placeholder="ex.: revisão do trimestre, dúvidas sobre IVA" multiline rotuloCor="#FFFFFF" style={{ backgroundColor: "#FFF" }} />
        <Erro texto={erro} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Botao titulo="Anular" variante="contorno" estilo={{ flex: 1 }} carregando={ocupado === "anular"} onPress={() => fazer("anular", () => api.anularServico(empresaId, aDecorrer.id, "Cronómetro iniciado por engano"))} />
          <Botao titulo="Terminar e registar" variante="menta" estilo={{ flex: 2 }} carregando={ocupado === "terminar"} onPress={() => fazer("terminar", () => api.terminarServico(empresaId, aDecorrer.id, notas || undefined))} />
        </View>
      </Cartao>
    );
  }
  const p = dados.plano;
  return (
    <View style={{ gap: 10 }}>
      {dados.reuniaoDeHojePorRegistar && p ? (
        <MensagemLuis texto={`Hoje há reunião prevista no plano${p.hora ? ` às ${p.hora}` : ""} (${horasLegiveis(p.minutos)}, ${NOME_MODALIDADE[p.modalidade].toLowerCase()}). Comece o cronómetro quando começar, ou registe-a já feita.`}
          acao={<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
            <Botao titulo="Iniciar agora" variante="menta" estilo={{ minHeight: 40 }} carregando={ocupado === "plano-ini"} onPress={() => fazer("plano-ini", () => api.iniciarServico(empresaId, { tipo: "reuniao", modalidade: p.modalidade, doPlano: true }))} />
            <Botao titulo={`Já foi: registar ${horasLegiveis(p.minutos)}`} variante="secundario" estilo={{ minHeight: 40 }} carregando={ocupado === "plano-reg"} onPress={() => fazer("plano-reg", () => api.registarServico(empresaId, { tipo: "reuniao", minutos: p.minutos, modalidade: p.modalidade, doPlano: true }))} />
          </View>} />
      ) : null}
      <Cartao>
        <Texto forte tamanho={16}>Contador de horas de reunião</Texto>
        <Escolhas opcoes={MODALIDADES.map((k) => [k, NOME_MODALIDADE[k]] as [Modalidade, string])} valor={modalidade} aoMudar={setModalidade} />
        <Erro texto={erro} />
        <Botao titulo="Iniciar reunião agora" carregando={ocupado === "ini"} onPress={() => fazer("ini", () => api.iniciarServico(empresaId, { tipo: "reuniao", modalidade }))} />
        <Texto sec tamanho={12}>O tempo conta até tocar em «Terminar», mesmo que feche a app.</Texto>
      </Cartao>
    </View>
  );
}

function PlanoReunioes({ empresaId, plano, aoMudar }: { empresaId: string; plano: PlanoServicos | null; aoMudar: () => void }) {
  const { api } = useSessao();
  const [editar, setEditar] = useState(false);
  const [dias, setDias] = useState<number[]>(plano?.diasSemana ?? []);
  const [hora, setHora] = useState(plano?.hora ?? "");
  const [minutos, setMinutos] = useState(String(plano?.minutos ?? 60));
  const [modalidade, setModalidade] = useState<Modalidade>(plano?.modalidade ?? "videochamada");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const descr = descreverPlano(plano);
  const horaOk = !hora || /^([01]\d|2[0-3]):[0-5]\d$/.test(hora);
  const minOk = /^\d+$/.test(minutos) && +minutos >= 5 && +minutos <= 600;
  async function guardar(ativo: boolean) {
    setAGuardar(true); setErro(null);
    try { await api.definirPlanoServicos(empresaId, { diasSemana: ativo ? dias : plano?.diasSemana ?? [], hora: hora || null, minutos: +minutos || 60, modalidade, ativo }); setEditar(false); aoMudar(); }
    catch (e) { setErro((e as Error).message); } finally { setAGuardar(false); }
  }
  if (!editar) {
    return (
      <Cartao>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1 }}>
            <Texto forte>Plano de reuniões</Texto>
            <Texto sec tamanho={13}>{descr ?? "Sem plano fixo. Defina, por exemplo, 2 reuniões por semana para acompanhar previstas vs. feitas."}</Texto>
          </View>
          <Botao titulo={plano ? "Alterar" : "Definir"} variante="secundario" estilo={{ minHeight: 38 }} onPress={() => setEditar(true)} />
        </View>
      </Cartao>
    );
  }
  return (
    <Cartao>
      <Texto forte tamanho={16}>Plano de reuniões</Texto>
      <Escolhas rotulo="Dias da semana" opcoes={DIAS_SEMANA} valor={dias} aoMudar={(d) => setDias((x) => x.includes(d) ? x.filter((y) => y !== d) : [...x, d].sort())} />
      <Texto sec tamanho={12}>{dias.length ? `${pl(dias.length, "reunião", "reuniões")} por semana` : "Escolha os dias."}</Texto>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Campo rotulo="Hora (opcional)" value={hora} onChangeText={setHora} placeholder="10:00" erro={!horaOk} keyboardType="numbers-and-punctuation" /></View>
        <View style={{ flex: 1 }}><Campo rotulo="Duração (min)" value={minutos} onChangeText={setMinutos} keyboardType="number-pad" erro={!minOk} /></View>
      </View>
      <Escolhas rotulo="Modalidade" opcoes={MODALIDADES.map((k) => [k, NOME_MODALIDADE[k]] as [Modalidade, string])} valor={modalidade} aoMudar={setModalidade} />
      <Erro texto={erro} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Botao titulo="Cancelar" variante="secundario" estilo={{ flex: 1 }} onPress={() => setEditar(false)} />
        <Botao titulo="Guardar plano" estilo={{ flex: 2 }} carregando={aGuardar} desativado={!dias.length || !horaOk || !minOk} onPress={() => guardar(true)} />
      </View>
      {plano?.ativo ? <Botao titulo="Suspender plano" variante="perigo" onPress={() => guardar(false)} /> : null}
    </Cartao>
  );
}

function NovoServico({ empresaId, hoje, plano, aoMudar }: { empresaId: string; hoje: string; plano: PlanoServicos | null; aoMudar: () => void }) {
  const { api } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [tipo, setTipo] = useState<TipoServico>("reuniao");
  const [titulo, setTitulo] = useState("");
  const [data, setData] = useState(hoje.split("-").reverse().join("/"));
  const [minutos, setMinutos] = useState("60");
  const [modalidade, setModalidade] = useState<Modalidade>(plano?.modalidade ?? "presencial");
  const [notas, setNotas] = useState("");
  const [faturavel, setFaturavel] = useState<"sim" | "nao">("sim");
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  if (!aberto) return <Botao titulo="Registar serviço ou reunião já feita" variante="secundario" onPress={() => setAberto(true)} />;
  const iso = deDataPT(data);
  const dataOk = !!iso && iso <= hoje;
  const minOk = /^\d+$/.test(minutos) && +minutos >= 1 && +minutos <= 1440;
  async function guardar() {
    setAGuardar(true); setErro(null);
    try {
      const doPlano = tipo === "reuniao" && !!iso && datasPrevistas(plano, iso.slice(0, 7)).includes(iso);
      await api.registarServico(empresaId, { tipo, titulo: titulo || undefined, data: iso!, minutos: +minutos, modalidade: tipo === "reuniao" ? modalidade : null, notas: notas || undefined, faturavel: faturavel === "sim", doPlano });
      setTitulo(""); setNotas(""); setAberto(false); aoMudar();
    } catch (e) { setErro((e as Error).message); } finally { setAGuardar(false); }
  }
  return (
    <Cartao>
      <Texto forte tamanho={16}>Registar serviço</Texto>
      <Escolhas rotulo="Tipo" opcoes={TIPOS.map((k) => [k, NOME_SERVICO[k]] as [TipoServico, string])} valor={tipo} aoMudar={setTipo} />
      <Campo rotulo="Descrição (opcional)" value={titulo} onChangeText={setTitulo} placeholder={NOME_SERVICO[tipo]} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Campo rotulo="Data" value={data} onChangeText={setData} placeholder="DD/MM/AAAA" erro={!dataOk} ajuda={!dataOk ? "Data válida, até hoje." : undefined} /></View>
        <View style={{ flex: 1 }}><Campo rotulo="Minutos" value={minutos} onChangeText={setMinutos} keyboardType="number-pad" erro={!minOk} /></View>
      </View>
      <Escolhas opcoes={[[15, "15"], [30, "30"], [45, "45"], [60, "1 h"], [90, "1 h 30"], [120, "2 h"]]} valor={+minutos} aoMudar={(v) => setMinutos(String(v))} />
      {tipo === "reuniao" ? <Escolhas rotulo="Modalidade" opcoes={MODALIDADES.map((k) => [k, NOME_MODALIDADE[k]] as [Modalidade, string])} valor={modalidade} aoMudar={setModalidade} /> : null}
      <Campo rotulo="Notas (opcional)" value={notas} onChangeText={setNotas} multiline />
      <Escolhas rotulo="Faturável" opcoes={[["sim", "Sim"], ["nao", "Não (incluído na avença)"]]} valor={faturavel} aoMudar={setFaturavel} />
      <Erro texto={erro} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Botao titulo="Cancelar" variante="secundario" estilo={{ flex: 1 }} onPress={() => setAberto(false)} />
        <Botao titulo="Guardar" estilo={{ flex: 2 }} carregando={aGuardar} desativado={!dataOk || !minOk} onPress={guardar} />
      </View>
    </Cartao>
  );
}

function LinhaServico({ s, empresaId, cc, aoMudar }: { s: Servico; empresaId: string; cc: boolean; aoMudar: () => void }) {
  const { api } = useSessao();
  const [modo, setModo] = useState<"ver" | "corrigir" | "anular">("ver");
  const [valor, setValor] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aGuardar, setAGuardar] = useState(false);
  const anulado = s.estado === "anulado";
  const sub = [dataPT(s.data), s.minutos ? horasLegiveis(s.minutos) : "a decorrer", s.modalidade ? NOME_MODALIDADE[s.modalidade] : null, s.doPlano ? "do plano" : null]
    .filter(Boolean).join(" · ") + (s.notas ? `\n${s.notas}` : "") + (anulado && s.motivoAnulacao ? `\nAnulado: ${s.motivoAnulacao}` : "");
  async function guardar() {
    setAGuardar(true); setErro(null);
    try {
      if (modo === "corrigir") await api.corrigirServico(empresaId, s.id, { versao: s.versao, minutos: +valor });
      else await api.anularServico(empresaId, s.id, valor);
      setModo("ver"); aoMudar();
    } catch (e) { setErro((e as Error).message); } finally { setAGuardar(false); }
  }
  return (
    <View>
      <Linha esquerda={<Text style={{ fontWeight: "600", color: anulado ? cor.textoSec : cor.texto, textDecorationLine: anulado ? "line-through" : "none" }}>{s.titulo}</Text>} sub={sub}
        direita={<View style={{ alignItems: "flex-end", gap: 6 }}>
          {anulado ? <Chip texto="Anulado" tipo="erro" /> : s.estado === "a_decorrer" ? <Chip texto="A decorrer" tipo="aviso" /> : !s.faturavel ? <Chip texto="Não faturável" /> : null}
          {cc && s.estado === "registado" && modo === "ver" ? (
            <View style={{ flexDirection: "row", gap: 6 }}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Corrigir minutos de ${s.titulo}`} onPress={() => { setValor(String(s.minutos ?? "")); setModo("corrigir"); }} style={{ padding: 6 }}><Text style={{ color: cor.verde, fontWeight: "600" }}>Corrigir</Text></Pressable>
              <Pressable accessibilityRole="button" accessibilityLabel={`Anular ${s.titulo}`} onPress={() => { setValor(""); setModo("anular"); }} style={{ padding: 6 }}><Text style={{ color: cor.vermelho, fontWeight: "600" }}>Anular</Text></Pressable>
            </View>
          ) : null}
        </View>} />
      {modo !== "ver" ? (
        <View style={{ gap: 8, paddingBottom: 12 }}>
          {modo === "corrigir"
            ? <Campo rotulo="Minutos corretos" value={valor} onChangeText={setValor} keyboardType="number-pad" />
            : <Campo rotulo="Motivo da anulação" value={valor} onChangeText={setValor} placeholder="ex.: registada em duplicado" />}
          <Erro texto={erro} />
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Botao titulo="Cancelar" variante="secundario" estilo={{ flex: 1, minHeight: 40 }} onPress={() => setModo("ver")} />
            <Botao titulo={modo === "corrigir" ? "Guardar correção" : "Anular serviço"} variante={modo === "anular" ? "perigo" : "principal"} estilo={{ flex: 2, minHeight: 40 }} carregando={aGuardar}
              desativado={modo === "corrigir" ? !(/^\d+$/.test(valor) && +valor >= 1 && +valor <= 1440) : valor.trim().length < 3} onPress={guardar} />
          </View>
        </View>
      ) : null}
    </View>
  );
}

const mins = (seg: number) => Math.round(seg / 60);

/** Barra simples de proporção (tarefa ÷ total). */
function Barra({ rotulo, minutos, total, corBarra = cor.verde }: { rotulo: string; minutos: number; total: number; corBarra?: string }) {
  const pct = total > 0 ? Math.max(2, Math.round((minutos / total) * 100)) : 0;
  return (
    <View style={{ gap: 4 }} accessible accessibilityLabel={`${rotulo}: ${horasLegiveis(minutos)}`}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", gap: 8 }}>
        <Texto tamanho={13} estilo={{ flex: 1 }}>{rotulo}</Texto>
        <Texto tamanho={13} forte>{horasLegiveis(minutos)}</Texto>
      </View>
      <View style={{ height: 6, borderRadius: 3, backgroundColor: cor.linha }}>
        <View style={{ width: `${pct}%`, height: 6, borderRadius: 3, backgroundColor: corBarra }} />
      </View>
    </View>
  );
}

/** Todo o tempo investido nesta empresa no mês: reuniões + outros serviços + trabalho medido na app. */
function TempoInvestido({ dados }: { dados: EspacoServicos }) {
  const t = dados.tempo.tempoApp;
  const total = dados.tempo.minutosInvestidos ?? 0;
  const reun = dados.resumo.reunioes.minutos;
  const outros = dados.resumo.minutosTotal - reun;
  const app = mins(t?.segundos ?? 0);
  return (
    <Cartao>
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
        <Texto forte tamanho={16}>Tempo investido nesta empresa</Texto>
        <Numero tamanho={20}>{horasLegiveis(total)}</Numero>
      </View>
      {total === 0 ? <Texto sec tamanho={13}>Ainda sem tempo neste mês. O trabalho que fizer nesta empresa na app é medido sozinho, por tarefa; as reuniões e outros serviços somam-se aqui.</Texto> : (
        <View style={{ gap: 10 }}>
          {reun ? <Barra rotulo="Reuniões" minutos={reun} total={total} corBarra={cor.tinta} /> : null}
          {outros ? <Barra rotulo="Outros serviços registados" minutos={outros} total={total} corBarra={cor.tinta2} /> : null}
          {t?.porCategoria.map((c) => <Barra key={c.categoria} rotulo={`App · ${NOME_TAREFA[c.categoria]}`} minutos={mins(c.segundos)} total={total} />)}
          <Texto sec tamanho={12}>{`Trabalho na app: ${horasLegiveis(app)}, medido só enquanto está ativo neste ecrã (pára ao fim de 3 min sem tocar).`}</Texto>
        </View>
      )}
    </Cartao>
  );
}

/** «150», «37,50», «1.200,00» ou «37.5» → número; vazio → null. */
const lerEuros = (t: string) => { let x = t.trim().replace(/\s|€/g, ""); if (x.includes(",")) x = x.replace(/\./g, "").replace(",", "."); return x === "" ? null : Number(x); };
const mostrarEuros = (n: number | null | undefined) => (n == null ? "" : String(n).replace(".", ","));

/** Valor (opcional): avença e/ou €/hora. Mostra o valor real de cada hora investida. Nunca aparece à empresa. */
function Valores({ empresaId, dados, aoMudar }: { empresaId: string; dados: EspacoServicos; aoMudar: () => void }) {
  const { api } = useSessao();
  const h = dados.tempo.honorarios;
  const [editar, setEditar] = useState(false);
  const [avenca, setAvenca] = useState(mostrarEuros(h?.avencaMensal));
  const [tarifa, setTarifa] = useState(mostrarEuros(h?.tarifaHora));
  const [aGuardar, setAGuardar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const v = valorDoMes(h, dados.resumo, dados.tempo.tempoApp);
  const a = lerEuros(avenca), t = lerEuros(tarifa);
  const ok = (a === null || (Number.isFinite(a) && a >= 0)) && (t === null || (Number.isFinite(t) && t >= 0));
  if (!editar) {
    return (
      <Cartao>
        <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <View style={{ flex: 1, gap: 2 }}>
            <Texto forte>Valor <Texto sec tamanho={12}>(opcional · só você vê)</Texto></Texto>
            {v.valor == null ? <Texto sec tamanho={13}>Sem valor definido. Pode indicar a avença ou o valor por hora quando quiser.</Texto> : (
              <>
                <Texto tamanho={13}>{[h?.avencaMensal != null ? `Avença ${euros(h.avencaMensal)}/mês` : null, h?.tarifaHora != null ? `${euros(h.tarifaHora)}/hora faturável` : null].filter(Boolean).join(" + ")}</Texto>
                <Texto tamanho={13}>Valor do mês: <Texto forte tamanho={13}>{euros(v.valor)}</Texto>{v.valorHoraReal != null ? <> · valor real por hora investida: <Texto forte tamanho={13}>{euros(v.valorHoraReal)}</Texto></> : " · o valor real por hora aparece a partir de 1 h investida no mês"}</Texto>
              </>
            )}
          </View>
          <Botao titulo={h ? "Alterar" : "Definir"} variante="secundario" estilo={{ minHeight: 38 }} onPress={() => setEditar(true)} />
        </View>
      </Cartao>
    );
  }
  return (
    <Cartao>
      <Texto forte tamanho={16}>Valor desta empresa</Texto>
      <Texto sec tamanho={12}>Preencha um, os dois ou nenhum. Deixar vazio = sem valor. A empresa nunca vê estes números.</Texto>
      <View style={{ flexDirection: "row", gap: 10 }}>
        <View style={{ flex: 1 }}><Campo rotulo="Avença mensal (€)" value={avenca} onChangeText={setAvenca} placeholder="ex.: 150" keyboardType="decimal-pad" /></View>
        <View style={{ flex: 1 }}><Campo rotulo="Valor por hora faturável (€)" value={tarifa} onChangeText={setTarifa} placeholder="ex.: 40" keyboardType="decimal-pad" /></View>
      </View>
      <Erro texto={erro ?? (!ok ? "Use só números (ex.: 150 ou 37,50)." : null)} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Botao titulo="Cancelar" variante="secundario" estilo={{ flex: 1 }} onPress={() => setEditar(false)} />
        <Botao titulo="Guardar valor" estilo={{ flex: 2 }} carregando={aGuardar} desativado={!ok}
          onPress={async () => { setAGuardar(true); setErro(null); try { await api.definirHonorarios(empresaId, { avencaMensal: a, tarifaHora: t }); setEditar(false); aoMudar(); } catch (e) { setErro((e as Error).message); } finally { setAGuardar(false); } }} />
      </View>
    </Cartao>
  );
}

function PartilharRelatorio({ empresaId, mes, jaPartilhado, aoMudar }: { empresaId: string; mes: string; jaPartilhado: boolean; aoMudar: () => void }) {
  const { api } = useSessao();
  const [aberto, setAberto] = useState(false);
  const [nota, setNota] = useState("");
  const [aEnviar, setAEnviar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState(false);
  if (feito) return <MensagemLuis texto="Relatório partilhado. A empresa recebeu o aviso na app e por e-mail." />;
  if (!aberto) return <Botao titulo={`${jaPartilhado ? "Partilhar de novo" : "Partilhar"} o relatório de ${nomeMes(mes).split(" de ")[0]} com a empresa`} variante="secundario" onPress={() => setAberto(true)} />;
  return (
    <Cartao>
      <Texto forte tamanho={16}>Partilhar relatório de {nomeMes(mes)}</Texto>
      <Texto sec tamanho={13}>A empresa passa a ver o tempo dedicado a ela: reuniões, serviços e o trabalho por tarefa. Os valores nunca são partilhados. Recebe um aviso na app e um e-mail.</Texto>
      <Campo rotulo="Nota para a empresa (opcional)" value={nota} onChangeText={setNota} placeholder="ex.: mês com fecho do trimestre" multiline />
      <Erro texto={erro} />
      <View style={{ flexDirection: "row", gap: 10 }}>
        <Botao titulo="Cancelar" variante="secundario" estilo={{ flex: 1 }} onPress={() => setAberto(false)} />
        <Botao titulo="Partilhar relatório" estilo={{ flex: 2 }} carregando={aEnviar}
          onPress={async () => { setAEnviar(true); setErro(null); try { await api.partilharRelatorioTempo(empresaId, mes, nota || undefined); setFeito(true); aoMudar(); } catch (e) { setErro((e as Error).message); } finally { setAEnviar(false); } }} />
      </View>
    </Cartao>
  );
}

/** Relatórios de tempo partilhados pelo contabilista (o que a empresa vê). */
function Relatorios({ lista, cc }: { lista: RelatorioTempo[]; cc: boolean }) {
  const [aberto, setAberto] = useState<string | null>(lista[0]?.id ?? null);
  if (!lista.length) return null;
  return (
    <View style={{ gap: 8 }}>
      <Texto forte tamanho={16}>{cc ? "Relatórios partilhados com a empresa" : "Relatórios do seu contabilista"}</Texto>
      {lista.map((r) => {
        const on = aberto === r.id;
        return (
          <Cartao key={r.id} onPress={() => setAberto(on ? null : r.id)}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
              <View style={{ flex: 1 }}>
                <Texto forte>{nomeMes(r.mes).replace(/^./, (c) => c.toUpperCase())}</Texto>
                <Texto sec tamanho={12}>Partilhado a {dataPT(r.partilhadoEm.slice(0, 10))} por {r.partilhadoPor.replace(/ \(contabilista\)$/, "")}</Texto>
              </View>
              <Numero tamanho={18}>{horasLegiveis(r.minutosInvestidos)}</Numero>
            </View>
            {on ? (
              <View style={{ gap: 10 }}>
                {r.nota ? <Texto tamanho={13}>«{r.nota}»</Texto> : null}
                {r.reunioes.minutos ? <Barra rotulo={`Reuniões (${r.reunioes.feitas}${r.reunioes.previstas ? ` de ${r.reunioes.previstas} previstas` : ""})`} minutos={r.reunioes.minutos} total={r.minutosInvestidos} corBarra={cor.tinta} /> : null}
                {r.servicos.filter((x) => x.tipo !== "reuniao").map((x) => <Barra key={x.tipo} rotulo={`${NOME_SERVICO[x.tipo]} (${x.quantidade})`} minutos={x.minutos} total={r.minutosInvestidos} corBarra={cor.tinta2} />)}
                {r.tempoApp.map((c) => <Barra key={c.categoria} rotulo={NOME_TAREFA[c.categoria]} minutos={mins(c.segundos)} total={r.minutosInvestidos} />)}
              </View>
            ) : <Texto sec tamanho={12}>Toque para ver o detalhe por tarefa</Texto>}
          </Cartao>
        );
      })}
    </View>
  );
}
