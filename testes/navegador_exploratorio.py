"""
Uso exploratório da Contabia no navegador, à procura de falhas:
- Plano Família de ponta a ponta (conta, agregado, faturas, importação, IRS, contabilista);
- toques repetidos nos botões (não pode criar contas/faturas em duplicado);
- dados errados e textos enormes nos formulários;
- sem internet a meio do uso;
- sessão guardada estragada (a app tem de abrir na entrada, não ficar presa).
Corre contra um servidor local: CONTABIA_URL (por defeito http://localhost:3000).
"""
import os, json, time, urllib.request
from playwright.sync_api import sync_playwright

BASE = os.environ.get("CONTABIA_URL", "http://localhost:3000")
SHOTS = os.environ.get("PASTA_CAPTURAS", "capturas_exploratorio")
os.makedirs(SHOTS, exist_ok=True)
falhas, erros = [], []

def api(metodo, caminho, corpo=None, tk=None):
    r = urllib.request.Request(BASE + caminho, method=metodo, data=None if corpo is None else json.dumps(corpo).encode(),
                               headers={"content-type": "application/json", **({"authorization": "Bearer " + tk} if tk else {})})
    try:
        return json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        return json.load(e)

def verificar(cond, msg, pg=None):
    if not cond:
        falhas.append(msg)
        if pg: pg.screenshot(path=f"{SHOTS}/FALHA_{len(falhas)}.png")
        print("✗", msg)
    else:
        print("✓", msg)

with sync_playwright() as p:
    b = p.chromium.launch(args=["--no-sandbox"])
    ctx = b.new_context(viewport={"width": 390, "height": 844})
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: erros.append(f"pageerror: {e}"))
    pg.on("console", lambda m: erros.append(f"console.error: {m.text[:200]}") if m.type == "error" and "favicon" not in m.text else None)

    # ── 1. Conta Família, com o botão «Criar conta» carregado 3 vezes seguidas ──
    pg.goto(BASE + "/empresa/registar-casa")
    pg.get_by_label("O seu nome").wait_for(timeout=20000)
    pg.get_by_label("O seu nome").fill("Rita Gomes")
    pg.get_by_label("E-mail").fill("rita@familia.pt")
    pg.get_by_label("O seu NIF").fill("123456789")
    pg.get_by_label("Senha").fill("segredo123")
    botao = pg.get_by_role("button", name="Criar conta")
    for _ in range(3):
        try: botao.click(timeout=1500, no_wait_after=True)
        except Exception: pass
    pg.get_by_text("Fotografar uma fatura").first.wait_for(timeout=20000)
    s = api("POST", "/v1/auth/sessoes", {"papel": "casa", "identificador": "rita@familia.pt", "senha": "segredo123"})
    verificar("token" in s, "conta Família criada e entra com a senha", pg)
    tk = s.get("token")
    pg.screenshot(path=f"{SHOTS}/01_casa_painel.png")

    # ── 2. Agregado: NIF errado não deixa acrescentar; dependente válido entra ──
    pg.get_by_text("Agregado familiar").click()
    pg.get_by_label("Nome").fill("Tiago")
    pg.get_by_label("NIF").fill("123456780")
    pg.get_by_role("button", name="Acrescentar").click(force=True)
    time.sleep(1)
    verificar(len(api("GET", "/v1/casa", tk=tk)["membros"]) == 1, "NIF inválido não deixa acrescentar pessoa", pg)
    verificar(pg.get_by_text("NIF", exact=False).filter(has_text="inválido").count() > 0 or pg.get_by_text("inválido", exact=False).count() > 0, "NIF inválido explica o problema por escrito", pg)
    pg.get_by_role("button", name="Dependente").click()
    pg.get_by_label("NIF").fill("509999999")
    pg.get_by_role("button", name="Acrescentar").click()
    pg.get_by_text("Tiago", exact=True).first.wait_for(timeout=10000)
    verificar(len([m for m in api("GET", "/v1/casa", tk=tk)["membros"] if m["nome"] == "Tiago"]) == 1, "dependente acrescentado uma só vez", pg)
    pg.go_back()

    # ── 3. Fatura à mão: dados errados dão mensagem; «Guardar» 3 vezes guarda uma só ──
    pg.get_by_text("Fotografar uma fatura").first.click()
    # no navegador abre logo a introdução à mão (não há câmara)
    pg.get_by_label("NIF de quem emitiu a fatura").fill("500000000")
    pg.get_by_label("Data (AAAA-MM-DD)").fill("2026-02-30")
    pg.get_by_label("Total com IVA (€)").fill("abc")
    pg.get_by_label("Nome de quem emitiu").fill("Z" * 500)
    try:
        pg.get_by_role("button", name="Guardar fatura").click(timeout=3000)
    except Exception:
        pass
    time.sleep(1.5)
    verificar(len(api("GET", "/v1/casa/despesas", tk=tk)) == 0, "fatura com data e total inválidos não é guardada", pg)
    pg.get_by_label("Data (AAAA-MM-DD)").fill("2026-11-10")
    pg.get_by_label("Total com IVA (€)").fill("45,90")
    pg.get_by_label("IVA (€, opcional)").fill("8,58")
    pg.get_by_label("Nome de quem emitiu").fill("Restaurante O Mar")
    g = pg.get_by_role("button", name="Guardar fatura")
    for _ in range(3):
        try: g.click(timeout=1500, no_wait_after=True)
        except Exception: pass
    time.sleep(2.5)
    ds = api("GET", "/v1/casa/despesas", tk=tk)
    verificar(len(ds) == 1, f"três toques em «Guardar fatura» guardam uma só fatura (guardadas: {len(ds)})", pg)
    verificar(bool(ds) and abs(ds[0]["total"] - 45.9) < 0.001, "o total com vírgula (45,90) é lido como 45,90 €", pg)
    pg.goto(BASE + "/empresa/casa")
    pg.get_by_text("Fotografar uma fatura").first.wait_for(timeout=20000)
    pg.screenshot(path=f"{SHOTS}/02_casa_com_fatura.png")

    # ── 4. Páginas da Família abrem sem erros ──
    for rota, texto in [("/empresa/casa/faturas", "Restaurante O Mar"), ("/empresa/casa/irs", "IRS"), ("/empresa/casa/importar", "e-Fatura"), ("/empresa/casa/agregado", "Tiago")]:
        pg.goto(BASE + rota)
        try:
            pg.get_by_text(texto, exact=False).first.wait_for(timeout=15000)
            verificar(True, f"{rota} abre")
        except Exception:
            verificar(False, f"{rota} não mostrou «{texto}»", pg)

    # ── 5. Sem internet: a app avisa e não parte; quando volta, continua ──
    pg.goto(BASE + "/empresa/casa")
    pg.get_by_text("Fotografar uma fatura").first.wait_for(timeout=20000)
    ctx.set_offline(True)
    pg.get_by_text("Faturas da casa", exact=True).click()
    time.sleep(6)
    verificar(pg.locator("body").inner_text().strip() != "", "sem internet a app continua a mostrar conteúdo", pg)
    verificar("Sem ligação" in pg.locator("body").inner_text(), "sem internet a app diz que não há ligação (não mostra «0 faturas»)", pg)
    pg.screenshot(path=f"{SHOTS}/03_sem_internet.png")
    ctx.set_offline(False)
    pg.goto(BASE + "/empresa/casa/faturas")
    pg.get_by_text("Restaurante O Mar").first.wait_for(timeout=20000)
    verificar(True, "com a internet de volta, as faturas voltam a aparecer")

    # ── 6. Contabilista liga-se à família ──
    cc = api("POST", "/v1/auth/contabilistas", {"email": "joao@gabinete.pt", "nome": "João CC", "numeroOCC": "22222", "senha": "segredo123"})
    pcc = ctx.new_page()
    pcc.on("pageerror", lambda e: erros.append(f"cc pageerror: {e}"))
    pcc.goto(BASE + "/contabilista/")
    pcc.evaluate("s => localStorage.setItem('contabia.contabilista', s)", json.dumps(cc))
    pcc.goto(BASE + "/contabilista/ligar")
    pcc.get_by_text("Ligar cliente", exact=False).first.wait_for(timeout=20000)
    pcc.screenshot(path=f"{SHOTS}/04_cc_ligar.png")
    corpo = pcc.locator("body").inner_text()
    verificar("Família" in corpo or "família" in corpo, "o contabilista vê a opção de ligar uma família", pcc)
    pcc.get_by_label("E-mail da conta Família").fill("rita@familia.pt")
    pcc.get_by_label("NIF do titular").fill("123456789")
    pedir = pcc.get_by_role("button", name="Pedir ligação à família")
    for _ in range(3):
        try: pedir.click(timeout=1500, no_wait_after=True)
        except Exception: pass
    time.sleep(2)
    pend = [l for l in api("GET", "/v1/casa/ligacoes", tk=tk) if l["estado"] == "pendente"]
    verificar(len(pend) == 1, f"três toques em «Pedir ligação» criam um só pedido (criados: {len(pend)})", pcc)
    # a família aceita na app
    pg.bring_to_front()
    pg.goto(BASE + "/empresa/casa/agregado")
    pg.get_by_role("button", name="Aceitar").first.click(timeout=20000)
    time.sleep(1.5)
    verificar(any(l["estado"] == "ativa" for l in api("GET", "/v1/casa/ligacoes", tk=tk)), "a família aceita o contabilista", pg)
    # o contabilista abre a família e vê a fatura
    pcc.bring_to_front()
    pcc.goto(BASE + "/contabilista/")
    pcc.get_by_text("Rita Gomes", exact=False).first.click(timeout=20000)
    try:
        pcc.get_by_text("Restaurante O Mar", exact=False).first.wait_for(timeout=15000)
        verificar(True, "o contabilista vê as faturas da família")
    except Exception:
        verificar(False, "o contabilista não vê as faturas da família", pcc)
    pcc.screenshot(path=f"{SHOTS}/05_cc_familia.png")

    # ── 7. Sessão guardada estragada: a app abre na entrada ──
    p2 = ctx.new_page()
    p2.on("pageerror", lambda e: erros.append(f"p2 pageerror: {e}"))
    p2.goto(BASE + "/empresa/")
    p2.evaluate("() => localStorage.setItem('contabia.empresa', '{isto não é json')")
    p2.goto(BASE + "/empresa/")
    try:
        p2.get_by_text("Criar conta").first.wait_for(timeout=15000)
        verificar(True, "com a sessão guardada estragada a app abre na entrada")
    except Exception:
        verificar(False, "com a sessão guardada estragada a app ficou presa", p2)

    # ── 8. Entrar com senha errada várias vezes: mensagem clara, sem partir ──
    p2.goto(BASE + "/empresa/entrar")
    p2.get_by_label("Utilizador da empresa ou e-mail").wait_for(timeout=15000)
    p2.get_by_label("Utilizador da empresa ou e-mail").fill("ninguem.lda")
    p2.get_by_label("Senha").fill("errada123")
    for _ in range(4):
        p2.get_by_role("button", name="Entrar").last.click()
        time.sleep(0.4)
    time.sleep(1.5)
    txt = p2.locator("body").inner_text()
    verificar(any(k in txt.lower() for k in ["senha", "não", "incorret", "tentativas"]), "senha errada mostra mensagem ao utilizador", p2)

    b.close()

print("\nERROS JS:", erros)
print(f"\n{len(falhas)} falhas")
for f in falhas: print(" -", f)
