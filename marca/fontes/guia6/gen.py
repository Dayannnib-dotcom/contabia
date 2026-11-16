"""Gera as folhas de exemplos da Guia 6 (Aplicações) a partir dos ficheiros aprovados."""
import asyncio, pathlib
from playwright.async_api import async_playwright

AQUI = pathlib.Path(__file__).resolve().parent
OUT = AQUI / "out"; OUT.mkdir(parents=True, exist_ok=True)
REPO = AQUI.parents[2]
G2 = (AQUI.parent / "guia2").as_uri()
SITE = (REPO / "web/site").as_uri()
PAD = f"{G2}/padroes/svg"
LUIS = f"{G2}/luis"
CORPO = f"{G2}/luis/corpo"

INK, OCE, MEN, VER, VESC = "#12232E", "#1F3B4A", "#3CC6A0", "#0B6E5B", "#084F41"
CLARO, SAGE, PAPEL, BORDA, SEC = "#E3F1EC", "#CFE9DF", "#F6F7F5", "#DDE2DF", "#4B5A63"
AMB, AMBT = "#FBEEDC", "#7A3B05"

LOGO = f"{G2}/svg/contabia-horizontal.svg"
LOGO_NEG = f"{G2}/svg/contabia-horizontal-negativo.svg"
LOGO_MONO_T = f"{G2}/svg/contabia-horizontal-mono-tinta.svg"
SIMB = f"{G2}/svg/contabia-simbolo.svg"
SIMB_OCE = f"{G2}/svg/contabia-simbolo-oceano.svg"
VERT = f"{G2}/svg/contabia-vertical.svg"


TAM = {"assinatura": (120, 120), "calendario": (252, 180), "mare": (40, 48), "pontos-atlanticos": (160, 160),
       "razao": (240, 144), "tabua-de-mares": (200, 120), "talao": (16, 24)}
BASE = {"noite": INK, "oceano": OCE, "papel": PAPEL, "salvia": SAGE}


def pad(nome, comb, tam=48):
    w, h = TAM[nome]; k = tam / 48
    return f"background:{BASE[comb]} url({PAD}/padrao-{nome}-{comb}.svg) repeat; background-size:{w*k:.1f}px {h*k:.1f}px;"


ONDA = lambda cor=MEN, w=120: f'<svg width="{w}" height="12" viewBox="0 0 120 12"><path d="M3 8q7.5-7 15 0t15 0t15 0t15 0t15 0t15 0t15 0t15 0" fill="none" stroke="{cor}" stroke-width="3.5" stroke-linecap="round"/></svg>'

CSS = f"""
@font-face{{font-family:SG;src:url({SITE}/fonts/SpaceGrotesk-Bold.woff2);font-weight:700}}
@font-face{{font-family:PS;src:url({SITE}/fonts/IBMPlexSans-Regular.woff2);font-weight:400}}
@font-face{{font-family:PS;src:url({SITE}/fonts/IBMPlexSans-SemiBold.woff2);font-weight:600}}
@font-face{{font-family:PM;src:url({SITE}/fonts/IBMPlexMono-Medium.woff2);font-weight:500}}
*{{box-sizing:border-box;margin:0;padding:0}}
body{{width:1600px;background:#E9ECEA;font-family:PS;color:{INK};padding:56px 64px 64px}}
.cab{{display:flex;justify-content:space-between;align-items:flex-end;margin-bottom:36px}}
.eyebrow{{font:500 13px/16px PM;letter-spacing:.16em;text-transform:uppercase;color:{SEC}}}
.titulo{{font:700 40px/46px SG;letter-spacing:-.02em;margin-top:8px}}
.rot{{font:500 12px/16px PM;letter-spacing:.08em;color:{SEC};margin-top:12px;text-transform:uppercase}}
.sombra{{box-shadow:0 1px 2px rgba(18,35,46,.08),0 18px 40px -12px rgba(18,35,46,.28)}}
.sg{{font-family:SG;font-weight:700;letter-spacing:-.02em}}
.mono{{font-family:PM;font-weight:500}}
.btn{{display:inline-block;font:600 15px/1 PS;padding:14px 20px;border-radius:10px}}
.linha{{display:flex;gap:40px;align-items:flex-start}}
.col{{display:flex;flex-direction:column}}
"""


def pagina(eyebrow, titulo, corpo, nota=""):
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>{CSS}</style></head><body>
<div class="cab"><div><div class="eyebrow">{eyebrow}</div><div class="titulo">{titulo}</div></div>
<img src="{LOGO}" style="height:34px"></div>{corpo}
{f'<div style="margin-top:36px;font:400 15px/22px PS;color:{SEC};max-width:1100px">{nota}</div>' if nota else ''}
</body></html>"""


# ---------- 1. Papelaria ----------
def papelaria():
    cartao_f = f"""<div class="sombra" style="width:425px;height:275px;background:#fff;border-radius:6px;padding:30px 32px;position:relative">
<img src="{LOGO}" style="height:30px">
<div style="position:absolute;left:32px;bottom:30px">
<div class="sg" style="font-size:22px">Dayanni Belandria</div>
<div style="font:400 14px/20px PS;color:{SEC};margin-top:2px">Fundadora</div>
<div class="mono" style="font-size:12.5px;line-height:20px;margin-top:14px;color:{INK}">+351 900 000 000<br>ola@contabia.pt</div></div>
<div style="position:absolute;right:28px;bottom:30px">{ONDA(MEN,70)}</div></div>"""
    cartao_v = f"""<div class="sombra" style="width:425px;height:275px;border-radius:6px;{pad('mare','noite',44)};display:flex;align-items:center;justify-content:center">
<div style="background:{INK};padding:16px 26px;border-radius:4px;text-align:center">
<div class="sg" style="color:#fff;font-size:26px">A maré certa.</div>
<div style="color:{MEN};font:400 14px/20px PS;margin-top:4px">O seu contabilista, à mão.</div></div></div>"""
    a4 = f"""<div class="sombra" style="width:420px;height:594px;background:#fff;padding:42px 42px;position:relative">
<img src="{LOGO}" style="height:26px">
<div style="font:400 10.5px/16px PS;color:{SEC};margin-top:46px">Funchal, 16 de novembro de 2026</div>
<div style="font:600 11px/16px PS;margin-top:18px">Papelaria Atlântico, Lda.<br><span style="font-weight:400;color:{SEC}">Rua do Exemplo, 12 · 9000-000 Funchal</span></div>
<div class="sg" style="font-size:17px;margin-top:30px">Proposta de acompanhamento contabilístico</div>
{''.join(f'<div style="height:6px;background:{BORDA};border-radius:3px;margin-top:{14 if i==0 else 9}px;width:{w}%"></div>' for i,w in enumerate([100,96,99,88,100,93,60]))}
<div style="font:400 10.5px/16px PS;margin-top:26px">Com os melhores cumprimentos,</div>
<div class="sg" style="font-size:13px;margin-top:22px">Dayanni Belandria</div>
<div style="position:absolute;left:42px;right:42px;bottom:28px;border-top:1px solid {BORDA};padding-top:8px;font:400 7.5px/11px PS;color:{SEC}">
Albatross Spring, Lda. · Sede: Funchal · NIPC 000 000 000 · Matriculada na Conservatória do Registo Comercial do Funchal · Capital social 0 000,00 €</div></div>"""
    env = f"""<div class="sombra" style="width:440px;height:220px;background:#fff;position:relative;padding:22px 26px">
<img src="{LOGO}" style="height:20px"><div style="font:400 9px/13px PS;color:{SEC};margin-top:6px">Albatross Spring, Lda. · Funchal</div>
<div style="position:absolute;left:200px;top:96px;width:210px;height:84px;border:1px solid {BORDA};border-radius:4px;background:{PAPEL}"></div></div>"""
    prop = f"""<div class="sombra" style="width:300px;height:424px;background:{INK};position:relative;padding:34px 30px">
<div style="position:absolute;left:0;right:0;top:96px;height:110px;{pad('razao','noite',30)}"></div>
<img src="{LOGO_NEG}" style="height:22px;position:relative">
<div style="position:absolute;left:30px;right:30px;bottom:44px">
<div class="mono" style="color:{MEN};font-size:11px;letter-spacing:.14em">PROPOSTA · 2026</div>
<div class="sg" style="color:#fff;font-size:28px;line-height:32px;margin-top:10px">O seu contabilista, à mão.</div>
<div style="margin-top:12px">{ONDA(MEN,90)}</div>
<div style="color:#C9D0CC;font:400 12px/18px PS;margin-top:10px">Papelaria Atlântico, Lda.</div></div></div>"""
    corpo = f"""<div class="linha">
<div class="col">{cartao_f}<div class="rot">Cartão · frente · 85 × 55 mm</div>
<div style="height:28px"></div>{cartao_v}<div class="rot">Cartão · verso · padrão Maré, Noite</div></div>
<div class="col">{a4}<div class="rot">Papel de carta · A4 · dados legais no rodapé</div></div>
<div class="col">{prop}<div class="rot">Capa de proposta · Noite + Razão</div>
<div style="height:28px"></div>{env}<div class="rot">Envelope DL com janela</div></div></div>"""
    return pagina("Guia 6 · Papelaria e documentos", "Papelaria sossegada: Papel, Razão, sem Luís", corpo,
                  "Nomes, NIPC, morada e contactos são marcadores de posição; os dados reais entram quando houver sede e equipa.")


# ---------- 2. E-mail ----------
def email():
    mail = f"""<div class="sombra" style="width:600px;background:#fff;border-radius:10px;overflow:hidden">
<div style="background:{INK};height:64px;display:flex;align-items:center;padding:0 32px"><img src="{LOGO_NEG}" style="height:26px"></div>
<div style="padding:34px 40px 30px">
<div style="display:flex;gap:16px;align-items:center"><img src="{LUIS}/luis-sorriso.svg" style="width:64px;height:64px">
<div><div style="font:600 15px/20px PS">Luís</div><div style="font:400 13px/18px PS;color:{SEC}">assistente virtual da Contabia</div></div></div>
<div class="sg" style="font-size:28px;line-height:34px;margin-top:24px">Bem-vinda à Contabia.</div>
<div style="font:400 16px/25px PS;margin-top:12px;color:{INK}">Comece por fotografar uma fatura: o resto vem a seguir. Em três passos fica tudo ligado ao seu contabilista.</div>
{''.join(f'<div style="display:flex;gap:14px;align-items:center;margin-top:{16 if i==0 else 10}px"><div class="mono" style="width:30px;height:30px;border-radius:15px;background:{CLARO};color:{VER};display:flex;align-items:center;justify-content:center;font-size:13px">{i+1}</div><div style="font:400 15px/22px PS">{t}</div></div>' for i,t in enumerate(['Fotografar a primeira fatura','Ligar o seu contabilista','Ativar os avisos de prazos']))}
<div style="margin-top:26px"><span class="btn" style="background:{VER};color:#fff">Fotografar fatura</span></div></div>
<div style="background:{PAPEL};padding:20px 40px;font:400 11.5px/17px PS;color:{SEC}">
<div class="sg" style="font-size:13px;color:{INK}">A maré certa. O seu contabilista, à mão.</div>
<div style="margin-top:6px">Albatross Spring, Lda. · Funchal · NIPC 000 000 000</div></div></div>"""
    inbox = f"""<div class="sombra" style="width:520px;background:#fff;border-radius:10px;overflow:hidden">
{''.join(f'<div style="display:flex;gap:14px;padding:16px 20px;border-bottom:1px solid {BORDA}"><img src="{SIMB}" style="width:36px;height:36px"><div style="flex:1"><div style="display:flex;justify-content:space-between"><span style="font:600 14px/20px PS">Contabia</span><span class="mono" style="font-size:11px;color:{SEC}">{h}</span></div><div style="font:600 14px/20px PS">{a}</div><div style="font:400 13px/19px PS;color:{SEC}">{p}</div></div></div>' for a,p,h in [('Bem-vinda à Contabia — 3 passos para começar','Comece por fotografar uma fatura…','9h02'),('IVA de outubro termina a 20/11','Faltam 7 dias. Só falta uma fatura de outubro.','seg.'),('A sua semana na Contabia','Chegaram 12 faturas. Pendentes: 2.','sex.')])}</div>"""
    assin = f"""<div class="sombra" style="width:520px;background:#fff;border-radius:10px;padding:24px 26px;display:flex;gap:18px">
<img src="{SIMB}" style="width:40px;height:40px">
<div style="font:400 13.5px/21px PS"><b style="font-weight:600">Dayanni Belandria</b><br><span style="color:{SEC}">Fundadora · Contabia</span><br>
<span class="mono" style="font-size:12px">+351 900 000 000 · ola@contabia.pt</span><br>contabia.pt<br>
<span class="sg" style="font-size:13px">A maré certa. O seu contabilista, à mão.</span></div></div>"""
    corpo = f"""<div class="linha"><div class="col">{mail}<div class="rot">E-mail de boas-vindas · fala o Luís · 600 px</div></div>
<div class="col">{inbox}<div class="rot">Caixa de entrada · assuntos até 50 caracteres</div>
<div style="height:30px"></div>{assin}<div class="rot">Assinatura da equipa · texto, não imagem</div></div></div>"""
    return pagina("Guia 6 · E-mail", "Um esqueleto para todos os e-mails", corpo)


# ---------- 3. Redes sociais ----------
def tile(html, fundo, s=150):
    return f'<div style="width:{s}px;height:{s}px;{fundo};position:relative;overflow:hidden">{html}</div>'


def redes():
    t = 168
    def txt(t1, cor="#fff", sub="", subcor=MEN, bg=None):
        bg = bg or (INK if cor == "#fff" else PAPEL)
        return f'<div style="position:absolute;left:0;right:0;bottom:0;padding:12px 14px 14px;background:{bg}"><div class="sg" style="color:{cor};font-size:17px;line-height:19px">{t1}</div>{f"<div style=\'font:400 10px/13px PS;color:{subcor};margin-top:4px\'>{sub}</div>" if sub else ""}</div>'
    grelha = [
        tile(txt("O IVA de outubro termina a 20/11.", sub="Ver os meus prazos"), pad('calendario', 'noite', 34), t),
        tile(txt("Fotografe a fatura.", INK, "O seu contabilista recebe-a logo.", VER), pad('talao', 'papel', 34), t),
        tile(f'<img src="{LUIS}/luis-atento.svg" style="position:absolute;right:-8px;top:10px;width:96px">' + txt("O IVA do gasóleo deduz-se?", sub="Dúvida da semana"), f"background:{OCE}", t),
        tile(txt("Fechar o ano com as contas em ordem.", INK, "IRC e IES num só sítio", VER), pad('razao', 'papel', 34), t),
        tile(f'<img src="{CORPO}/luis-corpo-celebrar.svg" style="position:absolute;left:50%;transform:translateX(-50%);top:6px;height:150px">', f"background:{SAGE}", t),
        tile(txt("A maré certa.", sub="Experimentar 30 dias grátis"), pad('mare', 'noite', 34), t),
        tile(txt("Veja a que apoios pode concorrer.", sub="Radar de apoios europeus", bg=OCE), pad('pontos-atlanticos', 'oceano', 34), t),
        tile(txt("Três gestos. Tudo ligado.", INK, "fotografar · confirmar · enviar", VER), f"background:{PAPEL}", t),
        tile(txt("IVA entregue. Nada a fazer até ao próximo prazo."), pad('assinatura', 'noite', 34), t),
    ]
    perfil = f"""<div class="sombra" style="width:540px;background:#fff;border-radius:22px;padding:22px 18px 18px">
<div style="display:flex;gap:22px;align-items:center;padding:0 6px">
<img src="{SIMB}" style="width:92px;height:92px">
<div style="flex:1;display:flex;justify-content:space-around;text-align:center">{''.join(f'<div><div style="font:600 16px/20px PS">{n}</div><div style="font:400 12px/16px PS;color:{SEC}">{l}</div></div>' for n,l in [('48','publicações'),('1 204','seguidores'),('86','a seguir')])}</div></div>
<div style="padding:12px 6px 0;font:400 13px/19px PS"><b style="font-weight:600">Contabia</b><br>Faturas, prazos e IVA numa app ligada ao seu Contabilista Certificado. A maré certa.<br><span style="color:{VER}">contabia.pt</span></div>
<div style="display:flex;gap:14px;padding:16px 6px 14px">{''.join(f'<div style="text-align:center"><div style="width:58px;height:58px;border-radius:29px;background:{INK};border:2px solid {BORDA};display:flex;align-items:center;justify-content:center;color:{MEN};font:500 10px PM">{i}</div><div style="font:400 11px/15px PS;margin-top:4px">{n}</div></div>' for i,n in [('20/11','Prazos'),('▤','Faturas'),('L','Luís'),('≈','Tábua'),('?','Dúvidas')])}</div>
<div style="display:grid;grid-template-columns:repeat(3,{t}px);gap:3px">{''.join(grelha)}</div></div>"""
    capa = f"""<div class="sombra" style="width:792px;height:198px;{pad('mare','noite',40)};position:relative;border-radius:8px;overflow:hidden">
<div style="position:absolute;inset:0;background:linear-gradient(90deg,{INK} 0%,{INK} 46%,rgba(18,35,46,0) 78%)"></div>
<div style="position:absolute;left:40px;top:38px"><img src="{LOGO_NEG}" style="height:30px">
<div class="sg" style="color:#fff;font-size:22px;line-height:28px;margin-top:22px">Com o seu contabilista ou com o nosso.</div>
<div style="color:{MEN};font:400 15px/22px PS">O Luís está sempre consigo.</div></div></div>"""
    story = f"""<div class="sombra" style="width:270px;height:480px;border-radius:18px;overflow:hidden;position:relative;background:{INK}">
<div style="position:absolute;left:0;right:0;top:0;height:62px;border-bottom:1px dashed rgba(255,255,255,.25)"></div>
<div style="position:absolute;left:0;right:0;bottom:0;height:85px;border-top:1px dashed rgba(255,255,255,.25);{pad('mare','noite',30)}"></div>
<div style="position:absolute;left:22px;right:22px;top:92px">
<div class="mono" style="color:{MEN};font-size:10px;letter-spacing:.14em">FALTAM 7 DIAS</div>
<div class="sg" style="color:#fff;font-size:28px;line-height:31px;margin-top:10px">O IVA de outubro termina a 20/11.</div>
<div style="color:#C9D0CC;font:400 13px/19px PS;margin-top:10px">O Luís avisa-o antes, e o seu contabilista trata do resto.</div>
<img src="{LUIS}/luis-alerta.svg" style="width:84px;margin-top:18px">
<div style="margin-top:14px"><span class="btn" style="background:{MEN};color:{INK};font-size:12px;padding:10px 14px">Ver os meus prazos</span></div></div></div>"""
    corpo = f"""<div class="linha"><div class="col">{perfil}<div class="rot">Instagram · grelha a alternar Noite, Papel, Oceano; Sálvia só para celebrar</div></div>
<div class="col">{capa}<div class="rot">Capa de LinkedIn e Facebook · Noite + Maré</div>
<div style="height:30px"></div><div class="linha" style="gap:30px">
<div class="col">{story}<div class="rot">Story · faixas tracejadas = zonas tapadas</div></div>
<div class="col" style="max-width:300px;font:400 15px/23px PS;color:{SEC};padding-top:8px">
<div class="sg" style="font-size:20px;color:{INK};margin-bottom:10px">Legenda-modelo</div>
<div style="background:#fff;border-radius:10px;padding:16px 18px;color:{INK}" class="sombra">O IVA de outubro termina a 20 de novembro. Se ainda faltar alguma fatura, fotografe-a hoje: o seu contabilista recebe-a logo.<br><br><span style="color:{VER}">#Contabilidade #PME #Madeira</span></div>
<div style="margin-top:14px">Primeira linha com a ideia toda; sem emojis em avisos; até 3 hashtags.</div></div></div></div></div>"""
    return pagina("Guia 6 · Redes sociais", "Um perfil, dois públicos, uma grelha calma", corpo,
                  "Números de seguidores e publicações são ilustrativos.")


# ---------- 4. Packs ----------
def packs():
    post = f"""<div class="sombra" style="width:360px;height:360px;{pad('calendario','papel',40)};position:relative">
<div style="position:absolute;left:28px;right:28px;top:28px;background:#fff;border-radius:12px;padding:22px 22px 20px">
<div class="mono" style="color:{AMBT};background:{AMB};display:inline-block;padding:4px 8px;border-radius:6px;font-size:10px;letter-spacing:.12em">NOVEMBRO</div>
<div style="display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px">{''.join(f'<div class="mono" style="font-size:10px;text-align:center;padding:4px 0;border-radius:5px;{"background:"+INK+";color:#fff" if d==20 else "color:"+SEC}">{d}</div>' for d in range(1,29))}</div></div>
<div style="position:absolute;left:0;right:0;bottom:0;height:136px;background:{PAPEL};border-top:1px solid {BORDA}"></div>
<div style="position:absolute;left:28px;right:100px;bottom:58px"><div class="sg" style="font-size:24px;line-height:27px">O prazo do IVA está a chegar.</div></div>
<img src="{SIMB}" style="position:absolute;left:28px;bottom:20px;width:26px">
<img src="{LUIS}/luis-alerta.svg" style="position:absolute;right:20px;bottom:14px;width:62px"></div>"""
    car = []
    cards = [
        (f"background:{INK}", f'<div style="position:absolute;left:0;right:0;top:0;height:46px;{pad("razao","noite",22)}"></div><div style="height:30px"></div><div class="mono" style="color:{MEN};font-size:10px;letter-spacing:.14em">DÚVIDA DA SEMANA · 1/4</div><div class="sg" style="color:#fff;font-size:24px;line-height:27px;margin-top:10px">As refeições de trabalho deduzem IVA?</div><div style="display:flex;align-items:center;gap:8px;margin-top:20px"><img src="{LUIS}/luis-a-pensar.svg" style="width:44px"><div style="color:#C9D0CC;font:400 10.5px/14px PS">Luís · assistente virtual</div></div>'),
        (f"background:{PAPEL}", f'<div class="mono" style="color:{SEC};font-size:10px;letter-spacing:.14em">2/4</div><div class="sg" style="font-size:40px;line-height:44px;margin-top:10px">Em regra, não.</div><div style="font:400 13px/19px PS;margin-top:10px">O IVA das refeições não se deduz, salvo exceções previstas na lei.</div>'),
        (f"background:{PAPEL}", f'<div class="mono" style="color:{SEC};font-size:10px;letter-spacing:.14em">3/4</div><div style="font:400 13px/19px PS;margin-top:10px">Fonte</div><div class="mono" style="font-size:18px;margin-top:4px;color:{VER}">CIVA, art. 21.º</div><div style="font:400 12px/18px PS;color:{SEC};margin-top:14px">Informação geral — o seu Contabilista Certificado confirma o tratamento.</div>'),
        (f"background:{INK}", f'<div style="position:absolute;left:0;right:0;bottom:0;height:40px;{pad("mare","noite",26)}"></div><div class="mono" style="color:{MEN};font-size:10px;letter-spacing:.14em">4/4</div><div class="sg" style="color:#fff;font-size:24px;line-height:27px;margin-top:10px">Tem outra dúvida? Pergunte ao Luís na app.</div><div style="margin-top:18px"><span class="btn" style="background:{MEN};color:{INK};font-size:12px;padding:10px 14px">Experimentar 30 dias grátis</span></div>'),
    ]
    for f, h in cards:
        car.append(f'<div class="sombra" style="width:240px;height:240px;{f};padding:22px;position:relative;flex:none">{h}</div>')
    carrossel = f'<div style="display:flex;gap:14px">{"".join(car)}</div>'
    ficha = f"""<div class="sombra" style="width:360px;background:#fff;border-radius:12px;padding:24px 26px;font:400 13.5px/21px PS">
<div class="mono" style="font-size:10.5px;letter-spacing:.14em;color:{SEC}">FICHA DO PACK</div>
<div class="sg" style="font-size:22px;margin-top:6px">Calendário fiscal</div>
{''.join(f'<div style="display:flex;justify-content:space-between;border-top:1px solid {BORDA};padding:8px 0;margin-top:{10 if i==0 else 0}px"><span style="color:{SEC}">{k}</span><span style="font-weight:600;text-align:right">{v}</span></div>' for i,(k,v) in enumerate([('Objetivo','Lembrar os prazos do mês'),('Padrão','Calendário'),('Combinação','Papel e Noite'),('Luís','Alerta → Celebrar'),('Peças','post, story, e-mail, WhatsApp'),('Validade','até 20/11/2026')]))}
<div class="mono" style="font-size:11px;color:{VER};margin-top:12px">contabia_calendario-fiscal_post_1080_2026-11.png</div></div>"""
    corpo = f"""<div class="linha"><div class="col">{post}<div class="rot">Pack Calendário fiscal · publicação 1080</div></div>
<div class="col">{ficha}<div class="rot">Ficha do pack · uma página</div></div></div>
<div style="height:40px"></div><div class="col">{carrossel}<div class="rot">Pack futuro «Dúvida da semana» · carrossel de 4 cartões · resposta, fonte e nota legal</div></div>"""
    return pagina("Guia 6 · Packs de marketing", "Cada pack: ficha, peças-mestre, textos, exportações", corpo,
                  "As datas fiscais são de exemplo; confirmam-se sempre na fonte oficial e com o contabilista antes de publicar.")


# ---------- 5. Lojas ----------
def lojas():
    def tela(img, t, fundo=f"background:{PAPEL}", cor=INK, desloca=0):
        return f"""<div class="sombra" style="width:236px;height:512px;{fundo};border-radius:14px;padding:22px 18px 0;overflow:hidden;position:relative;flex:none">
<div class="sg" style="font-size:19px;line-height:22px;color:{cor}">{t}</div>
<div style="position:absolute;left:28px;right:28px;top:110px;bottom:-30px;background:{INK};border-radius:26px;padding:8px">
<div style="border-radius:19px;overflow:hidden;height:100%"><img src="{img}" style="width:100%;display:block;margin-top:-{desloca}px"></div></div></div>"""
    telas = [
        tela(f"{SITE}/img/app-documentos.webp", "Fotografe a fatura. O seu contabilista recebe-a logo."),
        tela(f"{SITE}/img/app-painel.webp", "Os prazos fiscais, antes de chegarem."),
        tela(f"{SITE}/img/app-assistente.webp", "O Luís responde a dúvidas simples, com a fonte."),
        tela(f"{SITE}/img/app-painel.webp", "Tudo o que falta, num só painel.", desloca=150),
        f"""<div class="sombra" style="width:236px;height:512px;{pad('mare','noite',40)};border-radius:14px;position:relative;flex:none">
<div style="position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;align-items:center;gap:22px;background:radial-gradient(circle at 50% 50%,{INK} 0 38%,rgba(18,35,46,0) 72%)">
<img src="{SIMB_OCE}" style="width:84px"><div class="sg" style="color:#fff;font-size:22px;line-height:26px;text-align:center">A maré certa.<br><span style="color:{MEN}">O seu contabilista,<br>à mão.</span></div></div></div>""",
    ]
    loja = f"""<div class="sombra" style="width:520px;background:#fff;border-radius:16px;padding:22px">
<div style="display:flex;gap:16px;align-items:center"><img src="{(REPO / "apps/empresa/assets/icon.png").as_uri()}" style="width:86px;height:86px;border-radius:20px">
<div><div style="font:600 19px/24px PS">Contabia</div><div style="font:400 14px/20px PS;color:{SEC}">Faturas e prazos, à mão</div>
<div style="margin-top:8px"><span class="btn" style="background:#0A84FF;color:#fff;font-size:13px;padding:7px 18px;border-radius:14px">Obter</span></div></div></div>
<div style="font:400 13px/20px PS;color:{SEC};margin-top:16px;border-top:1px solid {BORDA};padding-top:12px">O Luís é um assistente virtual com inteligência artificial e não substitui o seu Contabilista Certificado.</div></div>"""
    destaque = f"""<div class="sombra" style="width:520px;height:254px;{pad('mare','oceano',36)};border-radius:10px;position:relative;overflow:hidden">
<img src="{G2}/padroes/svg/composicao-mare-a-baixar-oceano.svg" style="position:absolute;inset:0;width:100%;height:100%;object-fit:cover">
<div style="position:absolute;left:0;top:0;bottom:0;width:62%;background:linear-gradient(90deg,{OCE} 55%,rgba(31,59,74,0))"></div>
<div style="position:absolute;left:34px;top:86px"><img src="{LOGO_NEG}" style="height:34px"><div style="color:{MEN};font:400 15px/22px PS;margin-top:14px">O seu contabilista, à mão.</div></div></div>"""
    corpo = f"""<div style="display:flex;gap:16px">{''.join(telas)}</div><div class="rot">Cinco capturas, por esta ordem · moldura Tinta · dados de uma empresa fictícia</div>
<div style="height:36px"></div><div class="linha"><div class="col">{loja}<div class="rot">Ficha na App Store · ícone aprovado, sem texto</div></div>
<div class="col">{destaque}<div class="rot">Imagem de destaque do Google Play · 1024 × 500 · Oceano + Maré a baixar</div></div></div>"""
    return pagina("Guia 6 · Lojas de apps", "Mostrar o que a app faz hoje, em cinco capturas", corpo)


# ---------- 7. Apresentações ----------
def slides():
    def sl(conteudo, fundo):
        return f'<div class="sombra" style="width:448px;height:252px;{fundo};border-radius:6px;position:relative;overflow:hidden;flex:none">{conteudo}</div>'
    s = [
        (sl(f'<div style="position:absolute;left:0;right:0;bottom:0;top:84px;background:{INK}"></div><div style="position:absolute;left:0;right:0;top:0;height:84px;background:{INK}"></div><div style="position:absolute;left:0;right:0;top:84px;height:40px;{pad("mare","noite",30)}"></div><img src="{LOGO_NEG}" style="position:absolute;left:30px;top:30px;height:22px"><div style="position:absolute;left:30px;bottom:30px"><div class="sg" style="color:#fff;font-size:30px;line-height:33px">Contabia para<br>gabinetes aliados</div><div class="mono" style="color:{MEN};font-size:11px;margin-top:10px;letter-spacing:.12em">FUNCHAL · NOVEMBRO 2026</div></div>', pad('mare', 'noite', 36)), "Capa · Noite + Maré"),
        (sl(f'<div class="mono" style="position:absolute;left:30px;top:30px;color:{MEN};font-size:44px">02</div><div class="sg" style="position:absolute;left:30px;bottom:34px;color:#fff;font-size:30px">Como liga os clientes</div>', f"background:{OCE}"), "Secção · Oceano"),
        (sl(f'<div class="sg" style="position:absolute;left:30px;top:28px;right:30px;font-size:22px;line-height:26px">Os documentos chegam ao gabinete no próprio dia.</div>{"".join(f"<div style=\'position:absolute;left:30px;top:{104+i*34}px;display:flex;gap:12px;align-items:center;font:400 14px/20px PS\'><span style=\'width:8px;height:8px;border-radius:4px;background:{VER}\'></span>{t}</div>" for i,t in enumerate(["Fotografia com leitura do QR","Confirmação pelo cliente","Envio para o gabinete"]))}', f"background:{PAPEL}"), "Ideia · título-frase e 3 pontos"),
        (sl(f'<div class="mono" style="position:absolute;left:30px;top:40px;font-size:76px;line-height:80px;color:{VER}">12 min</div><div style="position:absolute;left:30px;top:132px;font:400 15px/22px PS;width:360px">tempo médio por cliente em pedidos de documentos, num mês</div><div class="mono" style="position:absolute;left:30px;bottom:22px;font-size:10px;color:{SEC}">FONTE: [estudo / medição interna] · [data]</div>', f"background:{PAPEL}"), "Número · com fonte (valor ilustrativo)"),
        (sl(f'<div style="position:absolute;left:30px;top:30px;width:180px"><div class="sg" style="font-size:20px;line-height:24px">O cliente fotografa. O gabinete recebe.</div></div><div style="position:absolute;right:46px;top:22px;width:118px;height:250px;background:{INK};border-radius:20px;padding:6px"><img src="{SITE}/img/app-documentos.webp" style="width:100%;border-radius:15px"></div>', f"background:{PAPEL}"), "Ecrã da app · moldura Tinta"),
        (sl(f'<div style="position:absolute;inset:44px 70px;background:{INK};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px"><div class="sg" style="color:#fff;font-size:30px">A maré certa.</div><div style="color:{MEN};font:400 15px PS">O seu contabilista, à mão.</div><div class="mono" style="color:#C9D0CC;font-size:12px;margin-top:8px">ola@contabia.pt</div></div>', pad('assinatura', 'noite', 36)), "Fecho · assinatura e contacto"),
    ]
    corpo = '<div style="display:grid;grid-template-columns:repeat(3,448px);gap:30px 40px">' + ''.join(f'<div class="col">{a}<div class="rot">{b}</div></div>' for a, b in s) + '</div>'
    return pagina("Guia 6 · Apresentações", "16:9, capa e fecho em Noite, uma ideia por diapositivo", corpo,
                  "Os números e a fonte são marcadores; nenhum valor entra numa apresentação sem fonte e data.")


# ---------- 8. WhatsApp ----------
def whatsapp():
    def bal(t, eu=False, hora="9h00"):
        return f'<div style="display:flex;justify-content:{"flex-end" if eu else "flex-start"};margin:6px 0"><div style="max-width:78%;background:{"#D9FDD3" if eu else "#fff"};border-radius:10px;padding:8px 10px 6px;font:400 13.5px/19px PS;box-shadow:0 1px 1px rgba(0,0,0,.08)">{t}<div class="mono" style="font-size:9.5px;color:#7C8A85;text-align:right;margin-top:2px">{hora}{" ✓✓" if eu else ""}</div></div></div>'
    tel = f"""<div class="sombra" style="width:360px;height:860px;background:{INK};border-radius:44px;padding:12px">
<div style="width:100%;height:100%;border-radius:34px;overflow:hidden;background:#EFEAE2;display:flex;flex-direction:column">
<div style="background:{INK};padding:38px 16px 12px;display:flex;gap:12px;align-items:center"><img src="{SIMB_OCE}" style="width:38px">
<div><div style="font:600 15px/19px PS;color:#fff">Contabia</div><div style="font:400 11.5px/15px PS;color:#C9D0CC">Conta comercial · assistente virtual</div></div></div>
<div style="padding:10px 12px;flex:1">
<div style="text-align:center;margin:4px 0 8px"><span class="mono" style="background:#fff;border-radius:6px;padding:3px 8px;font-size:10px;color:{SEC}">HOJE</span></div>
{bal('Bom dia, Papelaria Atlântico. A declaração periódica do IVA termina a 20/11. Se ainda faltar alguma fatura, pode enviá-la por aqui ou pela app.<br><span style="color:'+SEC+'">— Luís, assistente virtual da Contabia</span>', hora='9h00')}
<div style="display:flex;justify-content:flex-start"><div style="width:78%;background:#fff;border-radius:10px;text-align:center;padding:9px;font:600 13px PS;color:{VER};box-shadow:0 1px 1px rgba(0,0,0,.08)">Abrir a app</div></div>
{bal('<div style="width:200px;height:120px;border-radius:6px;background:'+PAPEL+';border:1px solid '+BORDA+';display:flex;align-items:center;justify-content:center;font:500 11px PM;color:'+SEC+'">FATURA EDP · OUT.</div>', True, '9h14')}
{bal('Fatura recebida e enviada ao seu contabilista.', hora='9h14')}
{bal('E o IVA desta fatura, quanto posso deduzir?', True, '9h15')}
{bal('Isto depende da sua situação. Passei a pergunta ao seu contabilista, que lhe responde na app.', hora='9h15')}
</div>
<div style="background:#F0F2F5;padding:10px 12px;display:flex;gap:8px"><div style="flex:1;background:#fff;border-radius:18px;padding:9px 14px;font:400 13px PS;color:#7C8A85">Mensagem</div></div></div></div>"""
    perfil = f"""<div class="sombra" style="width:420px;background:#fff;border-radius:16px;padding:26px;text-align:center">
<img src="{SIMB}" style="width:96px"><div style="font:600 19px/24px PS;margin-top:10px">Contabia</div><div style="font:400 13px/18px PS;color:{SEC}">Conta comercial</div>
<div style="text-align:left;border-top:1px solid {BORDA};margin-top:16px;padding-top:12px;font:400 13.5px/20px PS">Avisos de prazos e envio de faturas para o seu contabilista. Respostas do Luís, assistente virtual com IA.</div>
<div style="text-align:left;font:400 12.5px/18px PS;color:{SEC};margin-top:10px">Horário da equipa: dias úteis, 9h00–18h00</div></div>"""
    regras = f"""<div style="width:420px;font:400 14.5px/22px PS">{''.join(f'<div style="display:flex;gap:12px;margin-top:12px"><span class="mono" style="color:{VER};font-size:12px;padding-top:2px">{i+1:02d}</span><span>{t}</span></div>' for i,t in enumerate(['Até 3 frases, uma ação.','Assinatura do Luís como assistente virtual.','Só para quem autorizou; PARAR desliga de imediato.','Sem promoções nem emojis em avisos.','Decisões fiscais e preços passam para o contabilista ou para a equipa.']))}</div>"""
    corpo = f"""<div class="linha"><div class="col">{tel}<div class="rot">Conversa-modelo · aviso, fatura recebida, pergunta encaminhada</div></div>
<div class="col">{perfil}<div class="rot">Perfil do WhatsApp Business</div><div style="height:26px"></div>
<div class="sg" style="font-size:20px">Regras do canal</div>{regras}</div></div>"""
    return pagina("Guia 6 · WhatsApp e mensagens", "Serviço, não publicidade: a Guia 3 à letra", corpo,
                  "Os modelos de mensagem só se usam depois de aprovados pela Meta. A ligação técnica ao WhatsApp ainda está por fazer.")


# ---------- 9. Eventos ----------
def eventos():
    rollup = f"""<div style="width:220px;flex:none"><div class="sombra" style="width:220px;height:520px;{pad('mare','noite',30)};position:relative;border-radius:2px">
<div style="position:absolute;inset:0;background:linear-gradient(180deg,{INK} 0 52%,rgba(18,35,46,.0) 100%)"></div>
<img src="{LOGO_NEG}" style="position:absolute;left:22px;top:30px;height:22px">
<div class="sg" style="position:absolute;left:22px;top:84px;color:#fff;font-size:30px;line-height:32px">A maré certa.</div>
<div style="position:absolute;left:22px;top:156px;color:{MEN};font:400 13px/18px PS">O seu contabilista, à mão.</div>
<img src="{CORPO}/luis-corpo-cumprimentar.svg" style="position:absolute;left:28px;top:200px;height:250px">
<div style="position:absolute;right:16px;top:212px;background:#fff;padding:7px;border-radius:6px"><img src="{SITE}/img/qr-app.svg" style="width:64px;display:block"></div>
<div style="position:absolute;right:12px;top:296px;width:76px;color:#fff;font:400 9.5px/12px PS;text-align:center">Experimentar 30 dias grátis</div></div>
<div style="width:180px;height:10px;background:#9AA5A0;margin:0 auto;border-radius:0 0 4px 4px"></div></div>"""
    saco = f"""<div class="sombra" style="width:260px;height:300px;background:#EADFCB;border-radius:4px 4px 10px 10px;position:relative">
<div style="position:absolute;left:60px;top:-60px;width:140px;height:80px;border:10px solid #EADFCB;border-bottom:none;border-radius:70px 70px 0 0"></div>
<div style="position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px">
<img src="{LOGO_MONO_T}" style="height:30px"><div style="font:400 14px PS;color:{INK}">O seu contabilista, à mão.</div></div></div>"""
    cracha = f"""<div class="sombra" style="width:270px;height:165px;background:{PAPEL};border-radius:8px;position:relative;overflow:hidden">
<div style="height:30px;{pad('mare','noite',24)}"></div>
<div style="text-align:center;padding-top:22px"><div class="sg" style="font-size:24px">Dayanni</div><div style="font:400 12.5px/18px PS;color:{SEC}">Fundadora</div></div>
<img src="{SIMB}" style="position:absolute;right:12px;bottom:12px;width:22px"></div>"""
    autoc = f"""<div style="display:flex;gap:22px">
<div class="sombra" style="width:150px;height:150px;border-radius:75px;background:{INK};display:flex;align-items:center;justify-content:center"><img src="{SIMB_OCE}" style="width:96px"></div>
<div class="sombra" style="width:150px;height:150px;border-radius:75px;background:{AMB};display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center">
<img src="{LUIS}/luis-atento.svg" style="width:58px"><div class="sg" style="font-size:14px;line-height:16px;color:{AMBT};margin-top:4px">Peça fatura<br>com NIF</div></div></div>"""
    mesa = f"""<div class="sombra" style="width:420px;height:150px;background:{INK};border-radius:4px;display:flex;align-items:center;justify-content:center"><img src="{LOGO_NEG}" style="height:36px"></div>"""
    corpo = f"""<div class="linha" style="align-items:flex-end;gap:48px">
<div class="col">{rollup}<div class="rot">Roll-up 85 × 200 cm</div></div>
<div class="col" style="gap:0">{mesa}<div class="rot">Toalha de mesa · frente</div><div style="height:34px"></div>
<div class="linha" style="gap:34px;align-items:flex-end"><div class="col">{saco}<div class="rot">Saco de pano · uma tinta</div></div>
<div class="col">{cracha}<div class="rot">Crachá 90 × 55 mm</div><div style="height:30px"></div>{autoc}<div class="rot">Autocolantes 60 mm</div></div></div></div></div>"""
    return pagina("Guia 6 · Eventos e merchandising", "No espaço físico, a marca lê-se de longe", corpo,
                  "O QR é ilustrativo. O Luís impresso usa só poses aprovadas e nunca aparece como mascote em fantasia.")


def site():
    pc = f"""<div class="sombra" style="width:1000px;border-radius:12px;overflow:hidden;background:#fff">
<div style="height:38px;background:#E3E7E4;display:flex;align-items:center;gap:8px;padding:0 14px">{''.join(f'<span style="width:11px;height:11px;border-radius:6px;background:{c}"></span>' for c in ['#C9D0CC']*3)}
<span class="mono" style="margin-left:18px;background:#fff;border-radius:6px;padding:4px 12px;font-size:11px;color:{SEC}">contabia-eu.onrender.com</span></div>
<img src="{(OUT / "site-hero.png").as_uri()}" style="width:1000px;display:block"></div>"""
    movel = f"""<div class="sombra" style="width:300px;background:{INK};border-radius:40px;padding:10px"><div style="border-radius:31px;overflow:hidden;height:600px">
<img src="{(OUT / "site-movel.png").as_uri()}" style="width:280px;display:block"></div></div>"""
    corpo = f"""<div class="linha"><div class="col">{pc}<div class="rot">Site publicado · secção 1, Início · Noite com a chamada principal</div></div>
<div class="col">{movel}<div class="rot">Telemóvel · 390 px</div></div></div>"""
    return pagina("Guia 6 · Site e páginas", "O site real, já com as regras aplicadas", corpo,
                  "Capturas do site atual. As três frases assinaladas na secção «Site e páginas» ainda estão por rever.")


async def main():
    folhas = {"01-papelaria": papelaria(), "02-email": email(), "03-redes": redes(), "04-packs": packs(),
              "05-lojas": lojas(), "07-apresentacoes": slides(), "08-whatsapp": whatsapp(), "09-eventos": eventos()}
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path=__import__("os").environ.get("CHROME") or None, args=["--allow-file-access-from-files"])
        pg = await b.new_page(viewport={"width": 1600, "height": 900}, device_scale_factor=1.5)
        for nome, html in folhas.items():
            f = OUT / f"{nome}.html"; f.write_text(html)
            await pg.goto(f.as_uri()); await pg.wait_for_timeout(500)
            await pg.screenshot(path=str(OUT / f"{nome}.png"), full_page=True)
        sp = await b.new_page(viewport={"width": 1440, "height": 860}, device_scale_factor=1)
        await sp.goto("http://127.0.0.1:8765/site/index.html"); await sp.wait_for_timeout(1500)
        await sp.screenshot(path=str(OUT / "site-hero.png"))
        mp = await b.new_page(viewport={"width": 390, "height": 844}, device_scale_factor=2)
        await mp.goto("http://127.0.0.1:8765/site/index.html"); await mp.wait_for_timeout(1500)
        await mp.screenshot(path=str(OUT / "site-movel.png"))
        f = OUT / "06-site.html"; f.write_text(site())
        await pg.goto(f.as_uri()); await pg.wait_for_timeout(600)
        await pg.screenshot(path=str(OUT / "06-site.png"), full_page=True)
        await b.close()

asyncio.run(main())
