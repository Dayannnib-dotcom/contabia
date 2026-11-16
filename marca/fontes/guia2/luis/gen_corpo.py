"""Luís de corpo inteiro: a cabeça é a do retrato aprovado (sem alterações);
o corpo prolonga a mesma roupa (camisa branca, blazer bege, gravata azul) no mesmo traço."""
import re, subprocess

import pathlib
D = str(pathlib.Path(__file__).resolve().parent)
INK, BLAZER, BLAZER_S, PELE, CAMISA, GRAVATA = "#12232E", "#D8C3A0", "#C7AF89", "#F0C9A6", "#FFFFFF", "#1F4E8C"
CALCA, SAPATO = "#1F3B4A", "#6B4A32"
MINT, AMBAR, AMBAR_T = "#3CC6A0", "#FBEEDC", "#7A3B05"
L = f'stroke="{INK}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"'

def cabeca(expr):
    s = open(f"{D}/{expr}.svg").read()
    g = s[s.index("<g clip-path"):s.rindex("</g>")]
    return g[g.index('<path d="M106 150'):]

def tubo(d, cor, w=26):
    """Manga ou perna: tubo com contorno (traço tinta por baixo, cor por cima)."""
    return (f'<path d="{d}" fill="none" stroke="{INK}" stroke-width="{w+6}" stroke-linecap="round" stroke-linejoin="round"/>'
            f'<path d="{d}" fill="none" stroke="{cor}" stroke-width="{w}" stroke-linecap="round" stroke-linejoin="round"/>')

def mao(x, y, r=11):
    return f'<circle cx="{x}" cy="{y}" r="{r}" fill="{PELE}" {L}/>'

def punho(x, y):
    return f'<circle cx="{x}" cy="{y}" r="13" fill="{CAMISA}" {L}/>'

PERNAS = (tubo("M102 352 L100 556", CALCA, 38) + tubo("M138 352 L140 556", CALCA, 38)
          + f'<path d="M120 352 L120 420" {L} fill="none"/>'
          + f'<path d="M76 566 C76 552 92 548 106 552 L110 568 Z" fill="{SAPATO}" {L}/>'
          + f'<path d="M164 566 C164 552 148 548 134 552 L130 568 Z" fill="{SAPATO}" {L}/>')

TRONCO = (f'<path d="M92 180 C72 184 60 192 58 212 L62 362 L178 362 L182 212 C180 192 168 184 148 180 L120 176 Z" fill="{BLAZER}" {L}/>'
          f'<path d="M150 182 C166 188 178 196 180 214 L176 360 L158 360 C164 300 162 230 150 192 Z" fill="{BLAZER_S}"/>'
          f'<path d="M98 180 L120 272 L142 180 Z" fill="{CAMISA}" {L}/>'
          f'<path d="M102 176 L94 186 L112 204 L120 214 L128 204 L146 186 L138 176" fill="{CAMISA}" {L}/>'
          f'<path d="M114 194 L126 194 L131 252 L120 264 L109 252 Z" fill="{GRAVATA}" {L}/>'
          f'<path d="M114 194 L120 188 L126 194" fill="{GRAVATA}" {L}/>'
          f'<path d="M94 186 L120 274 L146 186" fill="none" {L}/>'
          f'<path d="M120 274 L120 360" fill="none" {L}/>'
          f'<circle cx="120" cy="290" r="3.5" fill="{INK}"/>'
          f'<path d="M80 300 L100 300" fill="none" {L}/>')

def braco_baixo_esq():
    return tubo("M70 206 C60 250 56 300 58 340", BLAZER, 26) + punho(58, 352) + mao(58, 364)

def braco_baixo_dir():
    return tubo("M170 206 C180 250 184 300 182 340", BLAZER, 26) + punho(182, 352) + mao(182, 364)

def telefone(x, y, rot=0):
    return (f'<g transform="translate({x} {y}) rotate({rot})"><rect x="-17" y="-30" width="34" height="60" rx="7" fill="{INK}"/>'
            f'<rect x="-13" y="-25" width="26" height="46" rx="3" fill="{CAMISA}"/>'
            f'<path d="M-8 -12 h16 M-8 -4 h12 M-8 4 h16" stroke="#DDE2DF" stroke-width="3" stroke-linecap="round"/>'
            f'<circle cx="7" cy="14" r="4" fill="{MINT}"/></g>')

def prancheta(x, y):
    s = (f'<g transform="translate({x} {y})"><rect x="-44" y="-56" width="88" height="112" rx="8" fill="{AMBAR}" {L}/>'
         f'<rect x="-18" y="-64" width="36" height="14" rx="4" fill="{INK}"/>')
    for c in range(4):
        for r in range(4):
            cx, cy = -33 + c * 18, -36 + r * 20
            if (c, r) == (2, 1):
                s += f'<rect x="{cx}" y="{cy}" width="12" height="12" rx="3" fill="{AMBAR_T}"/>'
            elif (c, r) == (0, 0):
                s += f'<rect x="{cx}" y="{cy}" width="12" height="12" rx="3" fill="{MINT}"/>'
            else:
                s += f'<rect x="{cx}" y="{cy}" width="12" height="12" rx="3" fill="none" stroke="{AMBAR_T}" stroke-opacity=".45" stroke-width="1.5"/>'
    return s + "</g>"

POSES = {
    # nome: (expressão, braços+adereços desenhados por cima, braços por baixo do tronco)
    "apresentar": ("luis-sorriso", braco_baixo_esq() + braco_baixo_dir(), ""),
    "cumprimentar": ("luis-sorriso", braco_baixo_esq()
                     + tubo("M170 206 C196 228 206 248 204 262 C214 230 214 200 210 174", BLAZER, 26)
                     + punho(210, 168) + f'<path d="M199 160 C196 138 202 128 210 128 C218 128 224 138 221 160 Z" fill="{PELE}" {L}/>'
                     + f'<path d="M206 136 L206 150 M214 136 L214 150" fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round"/>', ""),
    "explicar": ("luis-atento", braco_baixo_esq()
                 + tubo("M170 206 C188 226 200 236 214 232 C228 228 238 218 244 208", BLAZER, 26)
                 + f'<path d="M256 194 L270 180" stroke="{INK}" stroke-width="10" stroke-linecap="round"/><path d="M256 194 L270 180" stroke="{PELE}" stroke-width="5" stroke-linecap="round"/>'
                 + punho(244, 206) + mao(254, 197, 10), ""),
    "fotografar": ("luis-atento", braco_baixo_esq()
                   + tubo("M170 206 C186 250 180 280 160 288", BLAZER, 26)
                   + telefone(146, 272, -8) + mao(156, 296), ""),
    "prazos": ("luis-alerta", tubo("M70 206 C56 250 66 290 90 304", BLAZER, 26)
               + tubo("M170 206 C184 250 174 290 150 304", BLAZER, 26)
               + prancheta(120, 292) + mao(88, 312) + mao(152, 312), ""),
    "pensar": ("luis-a-pensar", braco_baixo_esq()
               + tubo("M170 206 L172 292 L136 182", BLAZER, 26)
               + mao(130, 166, 10), ""),
    "celebrar": ("luis-celebrar", braco_baixo_esq()
                 + tubo("M170 206 C196 226 204 236 204 250 C210 222 210 196 206 176", BLAZER, 26)
                 + punho(206, 170)
                 + f'<path d="M194 164 C194 150 198 146 206 146 L218 146 C224 146 224 156 218 158 L216 166 L196 168 Z" fill="{PELE}" {L}/>'
                 + f'<path d="M200 146 C198 134 204 124 210 128 L210 146" fill="{PELE}" {L}/>', ""),
}

TITULOS = {
    "apresentar": "Luís a apresentar-se", "cumprimentar": "Luís a cumprimentar", "explicar": "Luís a explicar",
    "fotografar": "Luís com o telemóvel", "prazos": "Luís com o calendário de prazos",
    "pensar": "Luís a pensar", "celebrar": "Luís a celebrar",
}

def gerar(nome, expr, frente, tras, fundo=None):
    w, h = 320, 600
    corpo = f'<g transform="translate(40 0)">{tras}{PERNAS}{TRONCO}{cabeca(expr)}{frente}</g>'
    sombra = f'<ellipse cx="160" cy="572" rx="70" ry="8" fill="{INK}" opacity=".08"/>'
    bg = f'<rect width="{w}" height="{h}" fill="{fundo}"/>' if fundo else ""
    t = TITULOS[nome] + " — assistente virtual da Contabia"
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
         f'aria-label="{t}"><title>{t}</title>{bg}{sombra}{corpo}</svg>')
    p = f"{D}/corpo/luis-corpo-{nome}.svg"
    open(p, "w").write(s)
    subprocess.run(["rsvg-convert", "-w", "640", p, "-o", f"{D}/corpo/luis-corpo-{nome}.png"], check=True)

if __name__ == "__main__":
    import os
    os.makedirs(f"{D}/corpo", exist_ok=True)
    for n, (e, f, t) in POSES.items():
        gerar(n, e, f, t)
    print("ok")
