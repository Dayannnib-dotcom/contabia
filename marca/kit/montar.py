"""Monta a pasta CONTABIA_Kit_de_Marca_v1.0 a partir dos ficheiros aprovados."""
import asyncio, json, pathlib, re, shutil
from playwright.async_api import async_playwright

import sys
VERSAO = sys.argv[1] if len(sys.argv) > 1 else "1.0"
M = pathlib.Path(__file__).resolve().parents[1]          # marca/
REPO = M.parent
SAIDA = M / "kit" / "saida"                                # ignorado pelo git
K = SAIDA / f"CONTABIA_Kit_de_Marca_v{VERSAO}"
if K.exists(): shutil.rmtree(K)
F = M / "fontes"
G2, G4, G5, G6 = F / "guia2", F / "guia4", F / "guia5", F / "guia6" / "out"
PDF = M / "kit" / "pdf"                                    # PDFs exportados das guias (ignorados pelo git)
FONTS = REPO / "node_modules/@expo-google-fonts"


def cp(src, dst):
    dst = K / dst; dst.parent.mkdir(parents=True, exist_ok=True); shutil.copy2(src, dst)


# 01 Guias
nomes = ["Guia1_Estrategia_de_marca", "Guia2_Identidade_visual", "Guia3_Voz_e_tom", "Guia4_Direcao_de_arte",
         "Guia5_Produto_digital", "Guia6_Aplicacoes", "Guia7_Governanca"]
for i, n in enumerate(nomes, 1):
    if (PDF / f"guia{i}.pdf").exists():
        cp(PDF / f"guia{i}.pdf", f"01_Guias/0{i}_{n}.pdf")
    else:
        print(f"Aviso: falta {PDF}/guia{i}.pdf")

# 02 Logotipos (SVG)
LOGOS = {"contabia-horizontal": "Horizontal_principal", "contabia-horizontal-negativo": "Horizontal_negativo_fundo_escuro",
         "contabia-vertical": "Vertical", "contabia-simbolo": "Simbolo", "contabia-simbolo-oceano": "Simbolo_oceano_fundo_escuro",
         "contabia-horizontal-mono-tinta": "Horizontal_mono_tinta", "contabia-horizontal-mono-preto": "Horizontal_mono_preto",
         "contabia-horizontal-mono-branco": "Horizontal_mono_branco", "contabia-simbolo-mono-tinta": "Simbolo_mono_tinta",
         "contabia-simbolo-mono-preto": "Simbolo_mono_preto", "contabia-simbolo-mono-branco": "Simbolo_mono_branco"}
for f, n in LOGOS.items():
    cp(G2 / "svg" / f"{f}.svg", f"02_Logotipos/SVG/CONTABIA_{n}.svg")
cp(G2 / "svg/onda-faixa.svg", "02_Logotipos/SVG/CONTABIA_Onda_faixa.svg")
cp(G2 / "svg/onda-faixa-tinta.svg", "02_Logotipos/SVG/CONTABIA_Onda_faixa_tinta.svg")

# 03 Cores
cores = {
    "principais": {"Tinta": "#12232E", "Oceano": "#1F3B4A", "Menta": "#3CC6A0", "Verde": "#0B6E5B", "Verde escuro": "#084F41"},
    "superficies": {"Papel": "#F6F7F5", "Branco": "#FFFFFF", "Verde claro": "#E3F1EC", "Salvia": "#CFE9DF", "Borda": "#DDE2DF"},
    "texto": {"Texto": "#12232E", "Texto secundario": "#4B5A63", "Marcador": "#6B7A75", "Borda forte": "#7C8A85"},
    "avisos": {"Ambar fundo": "#FBEEDC", "Ambar texto": "#7A3B05", "Vermelho": "#A61B1B", "Vermelho claro": "#FBE5E5"},
}
cmyk = {"Tinta": "61, 24, 0, 82", "Oceano": "58, 20, 0, 71", "Menta": "70, 0, 19, 22", "Verde": "90, 0, 17, 57",
        "Ambar texto": "0, 52, 96, 52", "Vermelho": "0, 84, 84, 35"}
(K / "03_Cores").mkdir(parents=True, exist_ok=True)
(K / "03_Cores/CONTABIA_cores.json").write_text(json.dumps(cores, ensure_ascii=False, indent=2))
css = ":root {\n" + "".join(f"  --contabia-{re.sub(r'[^a-z]+', '-', n.lower()).strip('-')}: {v};\n" for g in cores.values() for n, v in g.items()) + "}\n"
(K / "03_Cores/CONTABIA_cores.css").write_text(css)


def hex2rgb(h): return ", ".join(str(int(h[i:i + 2], 16)) for i in (1, 3, 5))


(K / "03_Cores/CONTABIA_cores.txt").write_text(
    "CONTABIA — Cores aprovadas (Guia 2)\n\n" + "".join(
        f"[{g}]\n" + "".join(f"  {n:<18} {v}   RGB {hex2rgb(v):<13}" + (f"   CMYK de partida {cmyk[n]}" if n in cmyk else "") + "\n" for n, v in c.items()) + "\n"
        for g, c in cores.items()) + "Pantone: pendente (Guia 2). Pedir prova de cor à gráfica.\n")

# 04 Tipografia
for pasta, ficheiros in {"space-grotesk": ["500Medium/SpaceGrotesk_500Medium.ttf", "700Bold/SpaceGrotesk_700Bold.ttf"],
                         "ibm-plex-sans": ["400Regular/IBMPlexSans_400Regular.ttf", "500Medium/IBMPlexSans_500Medium.ttf", "600SemiBold/IBMPlexSans_600SemiBold.ttf"],
                         "ibm-plex-mono": ["500Medium/IBMPlexMono_500Medium.ttf"]}.items():
    fam = {"space-grotesk": "Space_Grotesk", "ibm-plex-sans": "IBM_Plex_Sans", "ibm-plex-mono": "IBM_Plex_Mono"}[pasta]
    for f in ficheiros:
        cp(FONTS / pasta / f, f"04_Tipografia/{fam}/{pathlib.Path(f).name}")
    lic = FONTS / pasta / "LICENSE_FONT"
    if lic.exists(): cp(lic, f"04_Tipografia/{fam}/LICENCA_OFL.txt")
(K / "04_Tipografia/LEIA-ME.txt").write_text(
    "Títulos: Space Grotesk Bold (700).\nTexto: IBM Plex Sans 400, 500 e 600.\nNúmeros e códigos: IBM Plex Mono 500.\n\n"
    "As três famílias têm licença SIL Open Font License: podem ser instaladas, usadas em peças comerciais e entregues a gráficas.\n"
    "Instalar: abrir cada .ttf e carregar em «Instalar».\n")

# 05 Padrões
for f in (G2 / "padroes/svg").glob("padrao-*.svg"):
    cp(f, f"05_Padroes/SVG_mosaicos/{f.name}")
for f in (G2 / "padroes/svg").glob("composicao-*.svg"):
    cp(f, f"05_Padroes/Composicoes/{f.name}")
for f in (G2 / "padroes/png").glob("composicao-*.png"):
    cp(f, f"05_Padroes/Composicoes/{f.name}")
for f in (G2 / "padroes/png").glob("amostra-*.png"):
    cp(f, f"05_Padroes/PNG_amostras/{f.name}")
cp(G2 / "padroes/padroes-folha.png", "05_Padroes/CONTABIA_Padroes_folha.png")

# 06 Luís
for f in (G2 / "luis").glob("luis-*"):
    if f.suffix == ".svg" or "-512" in f.name:
        cp(f, f"06_Luis/Expressoes/{f.name}")
    elif "avatar" in f.name:
        cp(f, f"06_Luis/Avatares/{f.name}")
    else:
        cp(f, f"06_Luis/Folhas/{f.name}")
for f in (G2 / "luis/corpo").glob("luis-corpo-*"):
    cp(f, f"06_Luis/{'Folhas' if 'folha' in f.name else 'Corpo_inteiro'}/{f.name}")

# 07 Ícones
src = (REPO / "packages/ui/src/icones.tsx").read_text()
paths = dict(re.findall(r'^\s+(\w+): "([^"]+)"', src, re.M))
extra = {"prazos": '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
         "carteira": '<circle cx="9" cy="8" r="4"/><path d="M2 21c0-4 3-6 7-6s7 2 7 6M16 3.5a4 4 0 0 1 0 8M19 15c2 .8 3 2.6 3 6"/>'}
icones = {k: f'<path d="{v}"/>' for k, v in paths.items()} | extra
for k, v in icones.items():
    d = K / "07_Icones/SVG"; d.mkdir(parents=True, exist_ok=True)
    (d / f"icone-{k}.svg").write_text(f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="#12232E" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">{v}</svg>\n')
cp(G2 / "svg/icone-tabua-mares.svg", "07_Icones/SVG/icone-tabua-de-mares-marca.svg")
cp(G4 / "icones.png", "07_Icones/CONTABIA_Icones_folha.png")

# 08 App
for f in ["app-icon-ios-1024.svg", "app-icon-android-background-432.svg", "app-icon-android-foreground-432.svg", "app-icon-android-monochrome-432.svg"]:
    cp(G2 / "svg" / f, f"08_App/Icone_da_app/{f}")
for f in (G2 / "pack/png").glob("*.png"):
    if "preview" not in f.name:
        cp(f, f"08_App/{'Icone_da_app' if 'app-icon' in f.name else 'Favicons'}/{f.name}")
cp(G5 / "abertura.html", "08_App/Abertura_A_mare_a_baixar.html")
for f in ["app-painel.webp", "app-documentos.webp", "app-assistente.webp", "app-carteira.webp"]:
    cp(REPO / "web/site/img" / f, f"08_App/Capturas/{f}")

# 09 Kit de marketing
for f in (G2 / "padroes/maquetas").iterdir():
    cp(f, f"09_Kit_de_marketing/Maquetas_dos_packs/{f.name}")
for f in G6.glob("0*.png"):
    cp(f, f"09_Kit_de_marketing/Exemplos_de_aplicacao/{f.name}")
cp(G4 / "grelhas.png", "09_Kit_de_marketing/Grelhas_de_composicao/grelhas.png")
cp(G4 / "grelhas.svg", "09_Kit_de_marketing/Grelhas_de_composicao/grelhas.svg")


async def render():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME") or None)
        pg = await b.new_page(device_scale_factor=1, viewport={"width": 2100, "height": 2100})
        # logótipos em PNG transparente (2000 px de largura; símbolos 1024 px)
        for svg in sorted((K / "02_Logotipos/SVG").glob("*.svg")):
            simb = "Simbolo" in svg.name
            w = 1024 if simb else 2000
            t = SAIDA / "_tmp.html"; t.write_text(f'<html><body style="margin:0;background:transparent"><img id="i" src="{svg.as_uri()}" style="width:{w}px;display:block"></body></html>')
            await pg.goto(t.as_uri()); await pg.wait_for_timeout(150)
            el = await pg.query_selector("#i")
            out = K / "02_Logotipos/PNG" / (svg.stem + ".png"); out.parent.mkdir(parents=True, exist_ok=True)
            await el.screenshot(path=str(out), omit_background=True)
        # folha de cores
        sw = "".join(f'<div style="width:220px;margin:0 18px 26px 0"><div style="height:120px;border-radius:10px;background:{v};border:1px solid #DDE2DF"></div>'
                     f'<div style="font:600 15px/20px sans-serif;margin-top:8px">{n}</div><div style="font:13px/18px monospace;color:#4B5A63">{v} · RGB {hex2rgb(v)}</div></div>'
                     for g in cores.values() for n, v in g.items())
        await pg.set_viewport_size({"width": 1240, "height": 900})
        await pg.set_content(f'<html><body style="margin:40px;font-family:sans-serif;color:#12232E"><h1 style="font:700 30px sans-serif;margin:0 0 24px">CONTABIA — Paleta aprovada</h1><div style="display:flex;flex-wrap:wrap">{sw}</div></body></html>')
        await pg.screenshot(path=str(K / "03_Cores/CONTABIA_Paleta.png"), full_page=True)
        # LEIA-ME em PDF
        html = (M / "kit/leia-me.html").read_text().replace("__MARCA__", M.as_uri()).replace("__REPO__", REPO.as_uri()).replace("__VERSAO__", VERSAO)
        t = SAIDA / "_leia-me.html"; t.write_text(html)
        await pg.goto(t.as_uri()); await pg.wait_for_timeout(400)
        await pg.pdf(path=str(K / "00_LEIA-ME.pdf"), format="A4", print_background=True, margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
        await b.close()

SAIDA.mkdir(parents=True, exist_ok=True)
asyncio.run(render())
(SAIDA / "_tmp.html").unlink(missing_ok=True); (SAIDA / "_leia-me.html").unlink(missing_ok=True)
shutil.make_archive(str(K), "zip", SAIDA, K.name)
print(sum(1 for _ in K.rglob("*") if _.is_file()), "ficheiros")
