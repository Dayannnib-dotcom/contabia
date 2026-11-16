import re, json
WORD_D = open('word.d').read().strip()
C = 'M43 19a16 16 0 1 0 0 26'
W = 'M27 32q5-5 10 0t10 0t10 0'  # versao B aprovada a 15/11/2026: onda a meia altura do C
INK, OCEAN, MINT, WHITE, BLACK = '#12232E', '#1F3B4A', '#3CC6A0', '#FFFFFF', '#000000'

def symbol_mono(color, mid):
    # disco numa cor; C e onda vazados (mostram o papel)
    return (f'<defs><mask id="{mid}"><rect width="64" height="64" fill="#fff"/>'
            f'<path d="{C}" fill="none" stroke="#000" stroke-width="5.5" stroke-linecap="round"/>'
            f'<path d="{W}" fill="none" stroke="#000" stroke-width="4.5" stroke-linecap="round"/></mask></defs>'
            f'<circle cx="32" cy="32" r="32" fill="{color}" mask="url(#{mid})"/>')

def svg(vb_w, vb_h, body, label='Contabia'):
    return (f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {vb_w} {vb_h}" width="{vb_w}" height="{vb_h}" role="img" aria-label="{label}"><title>{label}</title>{body}</svg>\n')

files = {}
for name, col in [('tinta', INK), ('preto', BLACK), ('branco', WHITE)]:
    files[f'contabia-simbolo-mono-{name}.svg'] = svg(64, 64, symbol_mono(col, 'k'))
    files[f'contabia-horizontal-mono-{name}.svg'] = svg(286, 64, symbol_mono(col, 'k') +
        f'<path transform="translate(77.73 49.31) scale(0.04945)" fill="{col}" d="{WORD_D}"/>')

# onda mestre: mesma curva do simbolo (meio periodo 10 un., amplitude 2,5 un., traco 4,5), repetivel
segs = 'q5-5 10 0' + 't10 0' * 11
files['onda-faixa.svg'] = svg(124.5, 12, f'<path d="M2.25 7.5{segs}" fill="none" stroke="{MINT}" stroke-width="4.5" stroke-linecap="round"/>', 'Onda Contabia')
files['onda-faixa-tinta.svg'] = svg(124.5, 12, f'<path d="M2.25 7.5{segs}" fill="none" stroke="{INK}" stroke-width="4.5" stroke-linecap="round"/>', 'Onda Contabia')

# icone Tabua de Mares (linha 24 px, traco 2, pontas redondas)
files['icone-tabua-mares.svg'] = svg(24, 24,
  f'<g fill="none" stroke="{INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">'
  '<path d="M3 8q2.25-2.25 4.5 0t4.5 0t4.5 0t4.5 0"/><path d="M3 20h18"/><path d="M8 20v-6"/><path d="M12 20v-3"/><path d="M16 20v-8"/></g>', 'Tábua de Marés')

def strokes(sx, cx=37.1, cy=32, center=512, ink_c=WHITE, wave_c=MINT):
    # centro otico do C + onda (caixa 14,9-59,25 x 13,25-50,75); geometria inalterada
    tx = center - cx*sx; ty = center - cy*sx
    return (f'<g transform="translate({tx:.2f} {ty:.2f}) scale({sx})">'
            f'<path d="{C}" fill="none" stroke="{ink_c}" stroke-width="5.5" stroke-linecap="round"/>'
            f'<path d="{W}" fill="none" stroke="{wave_c}" stroke-width="4.5" stroke-linecap="round"/></g>')
files['app-icon-ios-1024.svg'] = svg(1024, 1024, f'<rect width="1024" height="1024" fill="{INK}"/>' + strokes(13.5), 'Contabia')
files['app-icon-android-foreground-432.svg'] = svg(432, 432, strokes(4.5, center=216), 'Contabia')
files['app-icon-android-background-432.svg'] = svg(432, 432, f'<rect width="432" height="432" fill="{INK}"/>', 'Contabia')
files['app-icon-android-monochrome-432.svg'] = svg(432, 432, strokes(4.5, center=216, ink_c=BLACK, wave_c=BLACK), 'Contabia')

full = f'<circle cx="32" cy="32" r="32" fill="{{D}}"/><path d="{C}" fill="none" stroke="#FFFFFF" stroke-width="5.5" stroke-linecap="round"/><path d="{W}" fill="none" stroke="{MINT}" stroke-width="4.5" stroke-linecap="round"/>'
files['contabia-simbolo.svg'] = svg(64,64, full.replace('{D}',INK))
files['contabia-simbolo-oceano.svg'] = svg(64,64, full.replace('{D}',OCEAN))
files['contabia-horizontal.svg'] = svg(286,64, full.replace('{D}',INK) + f'<path transform="translate(77.73 49.31) scale(0.04945)" fill="{INK}" d="{WORD_D}"/>')
files['contabia-horizontal-negativo.svg'] = svg(286,64, full.replace('{D}',OCEAN) + f'<path transform="translate(77.73 49.31) scale(0.04945)" fill="{WHITE}" d="{WORD_D}"/>')
files['contabia-vertical.svg'] = svg(178,142, f'<g transform="translate(40.931318681318686 0) scale(1.5)">' + full.replace('{D}',INK) + '</g>' + f'<path transform="translate(2.10 139.42) scale(0.04121)" fill="{INK}" d="{WORD_D}"/>')
for n, s in files.items():
    open('svg/'+n, 'w').write(s)
print(len(files), 'svg')
