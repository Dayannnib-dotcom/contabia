import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  DIAS_SEMANA, NOME_MODALIDADE, NOME_SERVICO, datasPrevistas, horasLegiveis, mudarMes, nomeMes,
  type EspacoServicos, type Modalidade, type PlanoServicos, type Servico, type TipoServico,
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
