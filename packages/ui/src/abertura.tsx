import React, { useEffect, useRef, useState } from "react";
import { AccessibilityInfo, Pressable, StyleSheet, useWindowDimensions } from "react-native";
import Svg, { Defs, G, Mask, Path, Rect } from "react-native-svg";

/**
 * Abertura «A maré a baixar» (Guia 5): o ecrã em tinta com o símbolo; a onda desenha-se,
 * o símbolo fica transparente e deixa ver a app; depois encolhe enquanto a tinta recua
 * como a maré. 2,3 s; um toque salta-a; com «reduzir movimento» só desvanece.
 */
const TINTA = "#12232E";
const MENTA = "#3CC6A0";
const C = "M43 19a16 16 0 1 0 0 26";
const ONDA = "M27 32q5-5 10 0t10 0t10 0";
const FIM = 2300;
const ESPERA = 1500; // se a app ainda não estiver pronta, a animação espera aqui, com o símbolo transparente
const LIMITE = 8000; // nunca fica mais do que isto na abertura, aconteça o que acontecer

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const seg = (t: number, a: number, b: number) => clamp((t - a) / (b - a));
const saida = (x: number) => 1 - (1 - x) ** 3;
const suave = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

function borda(y: number, fase: number, w: number, h: number) {
  let d = `M-80 ${y}`;
  for (let x = -80 + fase; x < w + 80; x += 60) d += " q15 -12 30 0 q15 12 30 0";
  return `${d} V${h + 40} H-80 Z`;
}

export function AberturaMare({ pronta, aoTerminar }: { pronta: boolean; aoTerminar: () => void }) {
  const { width: w, height: h } = useWindowDimensions();
  const [t, setT] = useState(0);
  const [reduzir, setReduzir] = useState<boolean | null>(null);
  const prontaRef = useRef(pronta);
  const saltarRef = useRef(false);
  prontaRef.current = pronta;

  useEffect(() => {
    let vivo = true;
    (AccessibilityInfo.isReduceMotionEnabled?.() ?? Promise.resolve(false)).then((r) => vivo && setReduzir(!!r)).catch(() => vivo && setReduzir(false));
    return () => { vivo = false; };
  }, []);

  useEffect(() => {
    if (reduzir === null) return;
    const fim = reduzir ? 900 : FIM;
    let raf = 0;
    let base = Date.now();
    const inicio = Date.now();
    let feito = false;
    const terminar = () => { if (!feito) { feito = true; aoTerminar(); } };
    const passo = () => {
      if (feito) return;
      let agora = Date.now() - base;
      const pronta = prontaRef.current || Date.now() - inicio > LIMITE;
      if (saltarRef.current && pronta) agora = fim;
      if (!pronta && agora > ESPERA) { base = Date.now() - ESPERA; agora = ESPERA; }
      setT(agora);
      if (agora >= fim) { terminar(); return; }
      raf = requestAnimationFrame(passo);
    };
    raf = requestAnimationFrame(passo);
    // Segurança: num separador escondido o navegador pausa as animações; o relógio não pára.
    const seguro = setTimeout(terminar, LIMITE + fim);
    return () => { feito = true; cancelAnimationFrame(raf); clearTimeout(seguro); };
  }, [reduzir, aoTerminar]);

  const cx = w / 2, cy = h / 2;
  const escala = Math.min(w, h) / 120; // o símbolo ocupa cerca de 1/3 da largura
  const sym = (k: number) => `translate(${cx - 37.1 * k} ${cy - 32 * k}) scale(${k})`;

  if (reduzir === null) {
    return <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: TINTA }]} accessibilityLabel="Contabia" />;
  }

  if (reduzir) {
    const op = 1 - seg(t, 600, 900);
    return (
      <Pressable style={StyleSheet.absoluteFill} onPress={() => { saltarRef.current = true; }} accessibilityLabel="Contabia — tocar para continuar">
        <Svg width={w} height={h}>
          <Rect width={w} height={h} fill={TINTA} opacity={op} />
          <G transform={sym(escala)} opacity={op} fill="none" strokeLinecap="round">
            <Path d={C} stroke="#FFFFFF" strokeWidth={5.5} />
            <Path d={ONDA} stroke={MENTA} strokeWidth={4.5} />
          </G>
        </Svg>
      </Pressable>
    );
  }

  const k = t < 1400 ? escala * (0.92 + 0.08 * saida(seg(t, 0, 400))) : escala * (1 - (2 / 3) * suave(seg(t, 1400, FIM)));
  const desenho = saida(seg(t, 300, 1000));
  const solido = (t < 400 ? saida(seg(t, 0, 400)) : 1) * (1 - seg(t, 1100, 1400));
  const mare = suave(seg(t, 1550, FIM));
  const y = -40 + mare * (h + 120);
  const fase = ((t / 18) % 60) - 60;

  return (
    <Pressable style={StyleSheet.absoluteFill} onPress={() => { saltarRef.current = true; }} accessibilityLabel="Contabia — tocar para continuar">
      <Svg width={w} height={h}>
        <Defs>
          <Mask id="abertura-janela" maskUnits="userSpaceOnUse" x={-100} y={-100} width={w + 200} height={h + 200}>
            <Rect x={-100} y={-100} width={w + 200} height={h + 200} fill="#FFFFFF" />
            {t >= 1100 ? (
              <G transform={sym(k)} fill="none" stroke="#000000" strokeLinecap="round">
                <Path d={C} strokeWidth={5.5} />
                <Path d={ONDA} strokeWidth={4.5} />
              </G>
            ) : null}
          </Mask>
        </Defs>
        {t < 1550
          ? <Rect x={-10} y={-10} width={w + 20} height={h + 20} fill={TINTA} mask="url(#abertura-janela)" />
          : <Path d={borda(y, fase, w, h)} fill={TINTA} mask="url(#abertura-janela)" />}
        <G transform={sym(k)} opacity={solido} fill="none" strokeLinecap="round">
          <Path d={C} stroke="#FFFFFF" strokeWidth={5.5} />
          <Path d={ONDA} stroke={MENTA} strokeWidth={4.5} strokeDasharray={[40, 40]} strokeDashoffset={40 * (1 - desenho)} />
        </G>
      </Svg>
    </Pressable>
  );
}
