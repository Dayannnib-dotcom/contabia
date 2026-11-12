import { porNaFila, semRede } from "../../lib/fila";
import { useState } from "react";
import { Platform, Pressable, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import { arred, dataPT, euros, lerQR, qrConsistente, validarNIF, type DadosQR } from "@contabia/shared";
import { Botao, Campo, Cartao, Ecra, Erro, Linha, Texto, Titulo, cor, useSessao } from "@contabia/ui";

export default function Digitalizar() {
  const { api, sessao } = useSessao();
  const router = useRouter();
  const [perm, pedirPerm] = useCameraPermissions();
  const [modo, setModo] = useState<"camara" | "manual">(Platform.OS === "web" ? "manual" : "camara");
  const [lido, setLido] = useState<{ texto: string; dados: DadosQR } | null>(null);
  const [nome, setNome] = useState("");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);

  function aoLer(texto: string) {
    if (lido) return;
    try {
      const d = lerQR(texto);
      if (!qrConsistente(d)) throw new Error("Os valores do código QR não batem certo.");
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => undefined);
      setLido({ texto, dados: d });
      setErro(null);
    } catch (e) {
      setErro((e as Error).message);
    }
  }

  async function guardar() {
    if (!lido) return;
    setAEnviar(true);
    try {
      const corpo = { qr: lido.texto, tipo: "compra", terceiroNome: nome || undefined };
      try {
        const d = await api.pedido<{ id: string }>("POST", `/v1/empresas/${sessao!.id}/documentos`, corpo);
        router.push({ pathname: "/documento/[id]", params: { id: d.id, novo: "1" } });
      } catch (e) {
        if (!semRede(e)) throw e;
        await porNaFila(sessao!.id, corpo, `${lido.dados.identificacao} · ${nome || `NIF ${lido.dados.nifEmitente}`}`);
        router.push("/(tabs)/documentos");
      }
      setLido(null);
      setNome("");
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  if (lido) {
    const d = lido.dados;
    return (
      <Ecra>
        <Titulo sub="Código QR lido e conferido">Dados extraídos</Titulo>
        <Cartao estilo={{ paddingVertical: 4 }}>
          <Linha esquerda="NIF do fornecedor" direita={<Texto>{d.nifEmitente}</Texto>} />
          <Linha esquerda="Documento · ATCUD" direita={<Texto>{d.identificacao} · {d.atcud}</Texto>} />
          <Linha esquerda="Data" direita={<Texto>{dataPT(d.data)}</Texto>} />
          <Linha esquerda="IVA" direita={<Texto>{euros(d.totalImpostos)}</Texto>} />
          <Linha esquerda="Total" direita={<Texto forte>{euros(d.total)}</Texto>} />
        </Cartao>
        <Campo rotulo="Nome do fornecedor (opcional)" value={nome} onChangeText={setNome} placeholder="Ajuda a IA a classificar" />
        <Erro texto={erro} />
        <View style={{ flexDirection: "row", gap: 10 }}>
          <Botao titulo="Ler outra" variante="secundario" onPress={() => setLido(null)} estilo={{ flex: 1 }} />
          <Botao titulo="Guardar documento" onPress={guardar} carregando={aEnviar} estilo={{ flex: 2 }} />
        </View>
      </Ecra>
    );
  }

  if (modo === "manual") return <Manual voltar={Platform.OS === "web" ? undefined : () => setModo("camara")} />;

  if (!perm) return null;
  if (!perm.granted) {
    return (
      <Ecra>
        <Titulo>Digitalizar fatura</Titulo>
        <Texto>Para ler o código QR das faturas, a Contabia precisa de acesso à câmara.</Texto>
        <Botao titulo="Permitir câmara" onPress={pedirPerm} />
        <Botao titulo="Introduzir manualmente" variante="secundario" onPress={() => setModo("manual")} />
      </Ecra>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: "#0C1A22" }}>
      <CameraView style={StyleSheet.absoluteFill} barcodeScannerSettings={{ barcodeTypes: ["qr"] }} onBarcodeScanned={(r) => aoLer(r.data)} />
      <View style={s.moldura} pointerEvents="none" />
      <View style={s.barra}>
        <Text style={s.instr}>Aponte para o código QR da fatura</Text>
        {erro ? <Text style={[s.instr, { color: "#FFB4B4" }]}>{erro}</Text> : null}
        <Pressable accessibilityRole="button" onPress={() => setModo("manual")} style={s.manual}>
          <Text style={{ color: "#FFF", fontWeight: "600" }}>Fatura sem QR? Introduzir manualmente</Text>
        </Pressable>
      </View>
    </View>
  );
}

function Manual({ voltar }: { voltar?: () => void }) {
  const { api, sessao } = useSessao();
  const router = useRouter();
  const [tipo, setTipo] = useState<"compra" | "venda">("compra");
  const [nif, setNif] = useState("");
  const [nome, setNome] = useState("");
  const [numero, setNumero] = useState("");
  const [data, setData] = useState(new Date().toISOString().slice(0, 10));
  const [base, setBase] = useState("");
  const [taxa, setTaxa] = useState("22");
  const [erro, setErro] = useState<string | null>(null);
  const [aEnviar, setAEnviar] = useState(false);
  const b = Number(base.replace(",", ".")) || 0;
  const t = Number(taxa) || 0;
  const iva = arred((b * t) / 100);
  const ok = validarNIF(nif) && nome && numero && /^\d{4}-\d{2}-\d{2}$/.test(data) && b > 0;

  async function guardar() {
    setAEnviar(true);
    try {
      const corpo = { tipo, terceiroNif: nif.replace(/\s/g, ""), terceiroNome: nome, numero, data, base: b, iva, taxa: t };
      try {
        const d = await api.criarDocumento(sessao!.id, corpo);
        router.push({ pathname: "/documento/[id]", params: { id: d.id, novo: "1" } });
      } catch (e) {
        if (!semRede(e)) throw e;
        await porNaFila(sessao!.id, corpo, `${numero} · ${nome}`);
        router.push("/(tabs)/documentos");
      }
    } catch (e) {
      setErro((e as Error).message);
    } finally {
      setAEnviar(false);
    }
  }

  return (
    <Ecra>
      <Titulo sub="Para faturas sem código QR">Introduzir documento</Titulo>
      <View style={{ flexDirection: "row", gap: 8 }}>
        {(["compra", "venda"] as const).map((x) => (
          <Botao key={x} titulo={x === "compra" ? "Compra" : "Venda"} variante={tipo === x ? "principal" : "secundario"} onPress={() => setTipo(x)} estilo={{ flex: 1 }} />
        ))}
      </View>
      <Campo rotulo={tipo === "compra" ? "NIF do fornecedor" : "NIF do cliente"} value={nif} onChangeText={setNif} keyboardType="number-pad" erro={nif.length >= 9 && !validarNIF(nif)} ajuda={nif.length >= 9 ? (validarNIF(nif) ? "✓ NIF válido" : "NIF inválido") : undefined} />
      <Campo rotulo="Nome" value={nome} onChangeText={setNome} />
      <Campo rotulo="N.º do documento" value={numero} onChangeText={setNumero} placeholder="ex.: FT 2026/418" />
      <Campo rotulo="Data (AAAA-MM-DD)" value={data} onChangeText={setData} />
      <Campo rotulo="Valor sem IVA (€)" value={base} onChangeText={setBase} keyboardType="decimal-pad" />
      <Campo rotulo="Taxa de IVA (%)" value={taxa} onChangeText={setTaxa} keyboardType="number-pad" ajuda={b ? `IVA ${euros(iva)} · Total ${euros(b + iva)}` : undefined} />
      <Erro texto={erro} />
      <Botao titulo="Guardar documento" onPress={guardar} carregando={aEnviar} desativado={!ok} />
      {voltar ? <Botao titulo="Voltar à câmara" variante="secundario" onPress={voltar} /> : null}
    </Ecra>
  );
}

const s = StyleSheet.create({
  moldura: { position: "absolute", top: "22%", left: "12%", right: "12%", aspectRatio: 1, borderWidth: 3, borderColor: cor.menta, borderRadius: 20 },
  barra: { position: "absolute", bottom: 40, left: 20, right: 20, gap: 12, alignItems: "center" },
  instr: { color: "#FFF", fontSize: 15, fontWeight: "600", textAlign: "center" },
  manual: { minHeight: 48, paddingHorizontal: 18, borderRadius: 14, backgroundColor: "rgba(31,59,74,0.95)", justifyContent: "center" },
});
