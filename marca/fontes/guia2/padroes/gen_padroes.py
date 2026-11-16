"""Biblioteca de padrões da Contabia — gerada a partir da geometria aprovada do símbolo.
Cada padrão: um mosaico repetível (tile) e amostras 1080x1080 nas combinações de cor."""
import os, subprocess

INK, OCEAN, MINT, VERDE = "#12232E", "#1F3B4A", "#3CC6A0", "#0B6E5B"
SAGE, CLARO, PAPEL, BRANCO = "#CFE9DF", "#E3F1EC", "#F6F7F5", "#FFFFFF"
AMBAR, AMBAR_T = "#FBEEDC", "#7A3B05"

OUT = os.path.dirname(os.path.abspath(__file__))
os.makedirs(f"{OUT}/svg", exist_ok=True)
os.makedirs(f"{OUT}/png", exist_ok=True)

# Combinações de cor (fundo, traço principal, traço secundário)
CORES = {
    "noite": (INK, MINT, OCEAN),
    "oceano": (OCEAN, MINT, "#2E5466"),
    "salvia": (SAGE, INK, VERDE),
    "papel": (PAPEL, "#C9D0CC", "#DDE2DF"),
}

def onda(x0, y, n, meia=10, amp=5):
    """Trajeto da onda mestre: meias-ondas de 10, controlo a 5 (= amplitude 2,5)."""
    return f"M{x0} {y}q{meia/2}-{amp} {meia} 0" + f"t{meia} 0" * (n - 1)

SIMB_C = "M43 19a16 16 0 1 0 0 26"
SIMB_W = "M27 32q5-5 10 0t10 0t10 0"

def svg(w, h, body, title):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" '
            f'role="img" aria-label="{title}"><title>{title}</title>{body}</svg>')

# ---------- mosaicos (tiles): (largura, altura, corpo(fundo, a, b)) ----------
def t_mare(bg, a, b):
    # duas linhas por mosaico, a segunda desfasada meia onda: a maré a avançar
    return (f'<rect width="40" height="48" fill="{bg}"/>'
            f'<path d="{onda(-10,12,6)}" fill="none" stroke="{a}" stroke-width="4.5" stroke-linecap="round"/>'
            f'<path d="{onda(-20,36,7)}" fill="none" stroke="{a}" stroke-width="4.5" stroke-linecap="round"/>')

def t_razao(bg, a, b):
    # papel de razão: linhas de 24 em 24, linha dupla a cada 6, colunas de valores
    s = f'<rect width="240" height="144" fill="{bg}"/>'
    for i in range(6):
        y = 24 * i + 23
        if i == 5:
            s += f'<path d="M0 {y-3}H240M0 {y+1}H240" stroke="{a}" stroke-width="1.6"/>'
        else:
            s += f'<path d="M0 {y}H240" stroke="{b}" stroke-width="1"/>'
    s += f'<path d="M40 0V144M44 0V144" stroke="{a}" stroke-width="1"/><path d="M180 0V144" stroke="{b}" stroke-width="1"/>'
    return s

def t_assinatura(bg, a, b):
    # o símbolo sem disco, em meia-gota (half-drop), pequeno e discreto
    def simb(x, y, k):
        return (f'<g transform="translate({x} {y}) scale({k})" fill="none" stroke-linecap="round">'
                f'<path d="{SIMB_C}" stroke="{b}" stroke-width="5.5"/><path d="{SIMB_W}" stroke="{a}" stroke-width="4.5"/></g>')
    return (f'<rect width="120" height="120" fill="{bg}"/>' + simb(-3, -3, .55) + simb(57, 57, .55)
            + simb(117, -3, .55) + simb(-3, 117, .55) + simb(117, 117, .55))

def t_pontos(bg, a, b):
    # carta náutica: grelha de pontos; alguns pontos «acesos» (empresas ligadas)
    s = f'<rect width="160" height="160" fill="{bg}"/>'
    acesos = {(1, 2), (4, 1), (6, 5), (2, 7), (7, 3), (5, 8)}
    for i in range(10):
        for j in range(10):
            x, y = 8 + 16 * i, 8 + 16 * j
            if (i, j) in acesos:
                s += f'<circle cx="{x}" cy="{y}" r="4" fill="{a}"/><circle cx="{x}" cy="{y}" r="8" fill="none" stroke="{a}" stroke-opacity=".35" stroke-width="1.5"/>'
            else:
                s += f'<circle cx="{x}" cy="{y}" r="1.6" fill="{b}"/>'
    return s

def t_calendario(bg, a, b):
    # um mês: 7 colunas × 5 semanas; prazos em destaque e um prazo cumprido
    s = f'<rect width="252" height="180" fill="{bg}"/>'
    prazos, cumprido = {(4, 2), (2, 4)}, (1, 1)
    for c in range(7):
        for r in range(5):
            x, y = 4 + 36 * c, 4 + 36 * r
            if (c, r) == cumprido:
                s += f'<rect x="{x}" y="{y}" width="28" height="28" rx="7" fill="{a}"/><path d="M{x+8} {y+15}l4 4 8-9" fill="none" stroke="{bg}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>'
            elif (c, r) in prazos:
                s += f'<rect x="{x}" y="{y}" width="28" height="28" rx="7" fill="{AMBAR}"/><rect x="{x}" y="{y}" width="28" height="7" rx="3" fill="{AMBAR_T}" opacity=".85"/>'
            else:
                s += f'<rect x="{x+.75}" y="{y+.75}" width="26.5" height="26.5" rx="7" fill="none" stroke="{b}" stroke-width="1.5"/>'
    return s

def t_barras(bg, a, b):
    # tábua de marés: barras semanais e a onda por cima
    s = f'<rect width="200" height="120" fill="{bg}"/>'
    alturas = [38, 52, 30, 64, 46, 56, 34, 60]
    for i, h in enumerate(alturas):
        x = 8 + 24 * i
        s += f'<rect x="{x}" y="{108-h}" width="12" height="{h}" rx="3" fill="{b}"/>'
    s += f'<path d="M0 110H200" stroke="{b}" stroke-width="2"/>'
    s += f'<path d="{onda(-10,26,22)}" fill="none" stroke="{a}" stroke-width="4.5" stroke-linecap="round"/>'
    return s

def t_talao(bg, a, b):
    # borda de talão (fatura rasgada) com picotado
    return (f'<rect width="16" height="24" fill="{bg}"/>'
            f'<path d="M0 0H16V14L8 22L0 14Z" fill="{a}"/>'
            f'<circle cx="8" cy="4" r="1.3" fill="{bg}" opacity=".6"/>')

TILES = {
    "mare": (40, 48, t_mare, "Maré"),
    "razao": (240, 144, t_razao, "Razão"),
    "assinatura": (120, 120, t_assinatura, "Assinatura"),
    "pontos-atlanticos": (160, 160, t_pontos, "Pontos atlânticos"),
    "calendario": (252, 180, t_calendario, "Calendário"),
    "tabua-de-mares": (200, 120, t_barras, "Tábua de Marés"),
    "talao": (16, 24, t_talao, "Talão"),
}

# Cores de cada padrão por combinação (alguns usam cores próprias)
def cores_para(nome, comb):
    bg, a, b = CORES[comb]
    if nome == "assinatura":
        return {"noite": (INK, MINT, "#3E6476"), "oceano": (OCEAN, MINT, "#4E7586"),
                "salvia": (SAGE, VERDE, "#8FBFAE"), "papel": (PAPEL, "#AEB8B2", "#C9D0CC")}[comb]
    if nome == "razao":
        return {"noite": (INK, "#2E5466", "#1F3B4A"), "oceano": (OCEAN, "#3E6476", "#2E5466"),
                "salvia": (SAGE, "#8FBFAE", "#B5DCCD"), "papel": (PAPEL, "#C9D0CC", "#E3E7E4")}[comb]
    if nome == "tabua-de-mares":
        return {"noite": (INK, MINT, OCEAN), "oceano": (OCEAN, MINT, "#2E5466"),
                "salvia": (SAGE, INK, "#B5DCCD"), "papel": (PAPEL, VERDE, "#DDE2DF")}[comb]
    if nome == "talao":
        return {"noite": (INK, BRANCO, BRANCO), "oceano": (OCEAN, BRANCO, BRANCO),
                "salvia": (SAGE, BRANCO, BRANCO), "papel": (PAPEL, BRANCO, BRANCO)}[comb]
    if nome == "calendario" and comb == "salvia":
        return (SAGE, INK, "#A9D4C4")
    if nome == "pontos-atlanticos" and comb == "papel":
        return (PAPEL, VERDE, "#C9D0CC")
    if nome == "mare" and comb == "papel":
        return (PAPEL, "#D6DCD8", None)
    return bg, a, b

def gerar():
    feitos = []
    for nome, (w, h, fn, titulo) in TILES.items():
        for comb in CORES:
            bg, a, b = cores_para(nome, comb)
            tile = svg(w, h, fn(bg, a, b), f"Padrão {titulo} — {comb}")
            p = f"{OUT}/svg/padrao-{nome}-{comb}.svg"
            open(p, "w").write(tile)
            # amostra 1080: o mosaico repetido com <pattern>; escala para ficar legível
            k = {"mare": 3.0, "razao": 2.0, "assinatura": 2.5, "pontos-atlanticos": 2.2, "calendario": 2.4, "tabua-de-mares": 2.4, "talao": 3}[nome]
            body = (f'<defs><pattern id="p" width="{w*k}" height="{h*k}" patternUnits="userSpaceOnUse">'
                    f'<g transform="scale({k})">{fn(bg, a, b)}</g></pattern></defs>'
                    f'<rect width="1080" height="1080" fill="{bg}"/>')
            if nome == "talao":
                z = "".join(f"L{240+24*i+12} 868L{240+24*(i+1)} 892" for i in range(25))
                body += (f'<path d="M240 140H840V892{z.replace("L240","L240")}" fill="none"/>'
                         f'<path d="M240 140H840V892' + "".join(f"L{840-24*i-12} 868L{840-24*(i+1)} 892" for i in range(25)) + 'Z" fill="#FFFFFF"/>'
                         f'<path d="M290 700H790" stroke="#C9D0CC" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>'
                         f'<path d="M290 240H600M290 300H700M290 360H520" stroke="#DDE2DF" stroke-width="14" stroke-linecap="round"/>'
                         f'<path d="M290 770H560" stroke="{INK}" stroke-width="18" stroke-linecap="round"/><path d="M660 770H790" stroke="{INK}" stroke-width="18" stroke-linecap="round"/>'
                         f'<path d="M660 800H790M660 808H790" stroke="{INK}" stroke-width="3"/>')
            else:
                body += '<rect width="1080" height="1080" fill="url(#p)"/>'
            amostra = svg(1080, 1080, body, f"Amostra do padrão {titulo} — {comb}")
            pa = f"{OUT}/svg/amostra-{nome}-{comb}.svg"
            open(pa, "w").write(amostra)
            subprocess.run(["rsvg-convert", "-w", "540", "-h", "540", pa, "-o", f"{OUT}/png/amostra-{nome}-{comb}.png"], check=True)
            feitos.append((nome, comb))
    # composição especial: maré a baixar (desvanece de cima para baixo)
    for comb in ("noite", "oceano"):
        bg, a, _ = CORES[comb]
        s = f'<rect width="1080" height="1080" fill="{bg}"/>'
        for i in range(14):
            op = max(0.08, 1 - i * 0.075)
            s += f'<path d="{onda(-20 - (i % 2) * 10, 60 + i * 72, 112).replace("q5-5 10 0", "q10-10 20 0").replace("t10 0", "t20 0")}" fill="none" stroke="{a}" stroke-width="9" stroke-linecap="round" opacity="{op:.2f}"/>'
        p = f"{OUT}/svg/composicao-mare-a-baixar-{comb}.svg"
        open(p, "w").write(svg(1080, 1080, s, f"Composição Maré a baixar — {comb}"))
        subprocess.run(["rsvg-convert", "-w", "540", "-h", "540", p, "-o", f"{OUT}/png/composicao-mare-a-baixar-{comb}.png"], check=True)
    return feitos

if __name__ == "__main__":
    print(len(gerar()), "amostras")
