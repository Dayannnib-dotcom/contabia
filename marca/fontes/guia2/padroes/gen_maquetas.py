"""Maquetas de aplicação dos padrões (exemplos para futuros packs de marketing)."""
import re, subprocess, os
from gen_padroes import TILES, cores_para, onda, INK, OCEAN, MINT, VERDE, SAGE, PAPEL, BRANCO, AMBAR, AMBAR_T

import pathlib
G = str(pathlib.Path(__file__).resolve().parents[1])
OUT = f"{G}/padroes/maquetas"
os.makedirs(OUT, exist_ok=True)

def interior(path, uid):
    s = open(path).read()
    vb = re.search(r'viewBox="([^"]+)"', s).group(1)
    body = re.sub(r'^.*?</title>', '', s, flags=re.S).replace('</svg>', '')
    for i in set(re.findall(r'id="([^"]+)"', body)):
        body = body.replace(f'id="{i}"', f'id="{uid}-{i}"').replace(f'url(#{i})', f'url(#{uid}-{i})')
    return vb, body

def peca(path, x, y, w, h, uid):
    vb, body = interior(path, uid)
    return f'<svg x="{x}" y="{y}" width="{w}" height="{h}" viewBox="{vb}">{body}</svg>'

def padrao(nome, comb, k, uid):
    w, h, fn, _ = TILES[nome]
    bg, a, b = cores_para(nome, comb)
    return (f'<pattern id="{uid}" width="{w*k}" height="{h*k}" patternUnits="userSpaceOnUse">'
            f'<g transform="scale({k})">{fn(bg, a, b)}</g></pattern>')

def texto(x, y, linhas, tam, cor, peso=700, fam="Space Grotesk", esp=1.08, ls="-0.02em"):
    out = ""
    for i, l in enumerate(linhas):
        out += (f'<text x="{x}" y="{y + i * tam * esp}" font-family="{fam}" font-weight="{peso}" '
                f'font-size="{tam}" fill="{cor}" letter-spacing="{ls}">{l}</text>')
    return out

def chip(x, y, mes, dia, rot="IVA trimestral", k=1.0):
    return (f'<g transform="translate({x} {y}) scale({k})"><rect width="300" height="96" rx="18" fill="{AMBAR}"/>'
            f'<rect x="12" y="12" width="72" height="72" rx="12" fill="#FFFFFF"/>'
            f'<text x="48" y="36" text-anchor="middle" font-family="IBM Plex Mono" font-weight="500" font-size="14" fill="#A61B1B" letter-spacing="0.12em">{mes}</text>'
            f'<text x="48" y="72" text-anchor="middle" font-family="IBM Plex Mono" font-weight="500" font-size="34" fill="{INK}">{dia}</text>'
            f'<text x="102" y="58" font-family="IBM Plex Sans" font-weight="600" font-size="24" fill="{AMBAR_T}">{rot}</text></g>')

def botao(x, y, txt, w=520, bg=MINT, cor=INK):
    return (f'<rect x="{x}" y="{y}" width="{w}" height="84" rx="16" fill="{bg}"/>'
            f'<text x="{x+w/2}" y="{y+53}" text-anchor="middle" font-family="IBM Plex Sans" font-weight="600" font-size="30" fill="{cor}">{txt}</text>')

def sublinhado(x, y, w, cor=MINT):
    n = max(2, int(w / 20))
    return f'<path d="{onda(x, y, n, 20, 10)}" fill="none" stroke="{cor}" stroke-width="9" stroke-linecap="round"/>'

LOGO_NEG = f"{G}/svg/contabia-horizontal-negativo.svg"
LOGO = f"{G}/svg/contabia-horizontal.svg"
LUIS = f"{G}/luis"

def salvar(nome, w, h, corpo, titulo):
    s = (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" width="{w}" height="{h}" role="img" '
         f'aria-label="{titulo}"><title>{titulo}</title>{corpo}</svg>')
    p = f"{OUT}/{nome}.svg"
    open(p, "w").write(s)
    subprocess.run(["rsvg-convert", "-w", str(w), p, "-o", f"{OUT}/{nome}.png"], check=True)

# 1. Post 1080 — calendário fiscal (pack Calendário fiscal)
c = (f'<defs>{padrao("calendario","noite",2.4,"pc")}</defs><rect width="1080" height="1080" fill="url(#pc)"/>'
     f'<rect x="60" y="60" width="960" height="960" rx="36" fill="{INK}" opacity=".94"/>'
     + texto(120, 220, ["O prazo do IVA", "está a chegar."], 84, BRANCO)
     + sublinhado(120, 330, 520)
     + texto(120, 420, ["O Luís avisa-o antes, e o seu", "contabilista trata do resto."], 34, "#B9C6CD", 400, "IBM Plex Sans", 1.4, "0")
     + chip(120, 560, "NOV", "20", k=1.4)
     + peca(f"{LUIS}/luis-alerta.svg", 690, 520, 280, 280, "l1")
     + peca(LOGO_NEG, 120, 900, 286, 64, "g1"))
salvar("01-post-calendario-fiscal", 1080, 1080, c, "Exemplo de post: prazo do IVA")

# 2. Story 1080x1920 — maré (pack Lançamento / marca)
c = (f'<defs>{padrao("mare","noite",3,"pm")}<linearGradient id="fd" x1="0" y1="0" x2="0" y2="1">'
     f'<stop offset="0" stop-color="{INK}" stop-opacity="0"/><stop offset=".55" stop-color="{INK}" stop-opacity="1"/></linearGradient></defs>'
     f'<rect width="1080" height="1920" fill="url(#pm)"/><rect width="1080" height="1920" fill="url(#fd)"/>'
     + texto(90, 1180, ["A maré certa."], 120, BRANCO)
     + sublinhado(90, 1215, 560)
     + texto(90, 1340, ["O seu contabilista, à mão."], 56, "#B9C6CD", 400, "IBM Plex Sans", 1.2, "0")
     + botao(90, 1480, "Experimentar 30 dias grátis", 620)
     + peca(LOGO_NEG, 90, 1740, 357, 80, "g2"))
salvar("02-story-mare", 1080, 1920, c, "Exemplo de story: A maré certa")

# 3. Flyer A5 (1240x1748) — talão (pack Fotografe as faturas)
c = (f'<rect width="1240" height="1748" fill="{SAGE}"/>'
     + texto(100, 210, ["Fotografe a fatura.", "O seu contabilista", "recebe-a logo."], 96, INK)
     + sublinhado(100, 545, 560, VERDE)
     + f'<g transform="translate(320 640) scale(1)">'
     f'<path d="M0 0H600V820' + "".join(f"L{600-24*i-12} 796L{600-24*(i+1)} 820" for i in range(25)) + 'Z" fill="#FFFFFF"/>'
     f'<text x="60" y="110" font-family="IBM Plex Sans" font-weight="600" font-size="34" fill="{INK}">Papelaria Atlântico</text>'
     f'<text x="60" y="160" font-family="IBM Plex Mono" font-weight="500" font-size="24" fill="#4B5A63">NIF 5•• ••• •••</text>'
     f'<path d="M60 230H540M60 290H540M60 350H540" stroke="#DDE2DF" stroke-width="12" stroke-linecap="round"/>'
     f'<path d="M60 600H540" stroke="#C9D0CC" stroke-width="3" stroke-dasharray="2 12" stroke-linecap="round"/>'
     f'<text x="60" y="680" font-family="IBM Plex Sans" font-weight="600" font-size="34" fill="{INK}">Total</text>'
     f'<text x="540" y="680" text-anchor="end" font-family="IBM Plex Mono" font-weight="500" font-size="40" fill="{INK}">146,40 €</text>'
     f'<path d="M360 704H540M360 713H540" stroke="{INK}" stroke-width="3"/>'
     f'<rect x="380" y="-30" width="250" height="64" rx="32" fill="{VERDE}"/>'
     f'<text x="505" y="10" text-anchor="middle" font-family="IBM Plex Sans" font-weight="600" font-size="26" fill="#FFFFFF">✓ Enviada</text></g>'
     + peca(LOGO, 100, 1560, 357, 80, "g3"))
salvar("03-flyer-a5-talao", 1240, 1748, c, "Exemplo de flyer A5: fotografe a fatura")

# 4. Banner LinkedIn 1584x396 — razão (pack Gabinetes aliados, B2B)
c = (f'<defs>{padrao("razao","papel",2,"pr")}</defs><rect width="1584" height="396" fill="url(#pr)"/>'
     f'<rect x="0" y="0" width="1584" height="396" fill="{PAPEL}" opacity=".35"/>'
     + texto(100, 150, ["Para gabinetes de contabilidade"], 30, VERDE, 600, "IBM Plex Sans", 1, "0.02em")
     + texto(100, 235, ["Os seus clientes, ligados", "em tempo real."], 64, INK)
     + peca(LOGO, 1150, 166, 286, 64, "g4"))
salvar("04-banner-linkedin-razao", 1584, 396, c, "Exemplo de banner LinkedIn para gabinetes")

# 5. Cabeçalho de e-mail 1200x400 — pontos atlânticos (pack Apoios europeus)
c = (f'<defs>{padrao("pontos-atlanticos","oceano",2.2,"pp")}</defs><rect width="1200" height="400" fill="url(#pp)"/>'
     f'<rect x="60" y="60" width="760" height="280" rx="28" fill="{OCEAN}" opacity=".92"/>'
     + texto(100, 140, ["Radar de apoios europeus"], 26, MINT, 600, "IBM Plex Sans", 1, "0.04em")
     + texto(100, 210, ["Veja pelo CAE a que apoios", "a sua empresa pode concorrer."], 46, BRANCO)
     + peca(f"{G}/svg/contabia-simbolo-oceano.svg", 960, 120, 160, 160, "g5"))
salvar("05-email-apoios-europeus", 1200, 400, c, "Exemplo de cabeçalho de e-mail: apoios europeus")

# 6. Post 1080x1350 — tábua de marés (pack Tábua de Marés)
c = (f'<defs>{padrao("tabua-de-mares","papel",2.4,"pt")}</defs><rect width="1080" height="1350" fill="url(#pt)"/>'
     f'<rect x="60" y="60" width="960" height="760" rx="36" fill="#FFFFFF"/>'
     + texto(120, 200, ["Tábua de Marés"], 34, VERDE, 600, "IBM Plex Sans", 1, "0.02em")
     + texto(120, 300, ["A tesouraria das", "próximas semanas,", "com o IVA já de lado."], 76, INK)
     + sublinhado(120, 560, 360)
     + texto(120, 680, ["Um extra incluído na app Contabia."], 34, "#4B5A63", 400, "IBM Plex Sans", 1, "0")
     + f'<rect x="60" y="1130" width="960" height="180" rx="36" fill="#FFFFFF"/>'
     + peca(LOGO, 120, 1180, 357, 80, "g6"))
salvar("06-post-tabua-de-mares", 1080, 1350, c, "Exemplo de post: Tábua de Marés")

# 7. Merchandising: saco de pano + cartão de visita (pack Eventos e papelaria)
c = (f'<defs>{padrao("mare","noite",2.2,"ps")}{padrao("assinatura","oceano",1.6,"pa")}</defs><rect width="1600" height="1000" fill="{PAPEL}"/>'
     f'<path d="M200 300H700L740 940H160Z" fill="url(#ps)"/>'
     f'<path d="M320 300C320 140 580 140 580 300" fill="none" stroke="{INK}" stroke-width="22"/>'
     f'<rect x="300" y="560" width="300" height="120" rx="18" fill="{INK}"/>'
     + peca(LOGO_NEG, 322, 592, 257, 57, "g7")
     + f'<g transform="translate(900 250) rotate(-6)"><rect width="560" height="320" rx="20" fill="url(#pa)"/></g>'
     f'<g transform="translate(940 560) rotate(4)"><rect width="560" height="320" rx="20" fill="#FFFFFF" stroke="#DDE2DF" stroke-width="2"/>'
     + peca(LOGO, 40, 40, 229, 51, "g8")
     + texto(40, 210, ["Nome Apelido"], 34, INK).replace('letter-spacing="-0.02em"', 'letter-spacing="0"')
     + texto(40, 250, ["Função · Contabia"], 22, "#4B5A63", 400, "IBM Plex Sans", 1, "0")
     + sublinhado(40, 280, 120)
     + '</g>')
salvar("07-merch-saco-e-cartao", 1600, 1000, c, "Exemplo de saco de pano e cartões de visita")
print("ok")
