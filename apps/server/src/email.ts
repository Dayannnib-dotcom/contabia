/**
 * Envio de e-mails transacionais pelo Brevo (empresa francesa, dados na UE).
 * Sem BREVO_API_KEY o e-mail não sai (só fica registado no log), o que serve
 * para desenvolvimento e testes.
 */
export interface Email { para: string; nome?: string; assunto: string; texto: string; html: string }
export type EnviarEmail = (e: Email) => Promise<boolean>;

export function criarEnvioEmail(chave = process.env.BREVO_API_KEY, remetente = process.env.EMAIL_REMETENTE): EnviarEmail {
  return async (e) => {
    if (!chave || !remetente) {
      console.warn(`[email] BREVO_API_KEY/EMAIL_REMETENTE em falta — não enviado: «${e.assunto}» para ${e.para}`);
      return false;
    }
    const r = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: { "api-key": chave, "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        sender: { name: "Contabia", email: remetente },
        to: [{ email: e.para, ...(e.nome ? { name: e.nome } : {}) }],
        subject: e.assunto, textContent: e.texto, htmlContent: e.html,
      }),
    }).catch(() => null);
    if (!r?.ok) console.error(`[email] falhou (${r?.status ?? "rede"}): «${e.assunto}» para ${e.para}`);
    return !!r?.ok;
  };
}

export const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

/**
 * Esqueleto comum de todos os e-mails (Guia 6 · E-mail): 600 px, cabeçalho Tinta de 64 px com o logótipo,
 * corpo branco com um título e um botão Verde, rodapé Papel com a assinatura e a entidade legal.
 * Letras com alternativa Arial/Helvetica, porque os programas de e-mail não garantem fontes da web.
 */
export function moldura(titulo: string, paragrafos: string[], botao?: { texto: string; url: string }, rodape?: string) {
  const letra = "'IBM Plex Sans',Arial,Helvetica,sans-serif", titulos = "'Space Grotesk',Arial,Helvetica,sans-serif";
  const html = `<div style="background:#F6F7F5;padding:24px 12px;font-family:${letra};color:#12232E">
<div style="max-width:600px;margin:auto;background:#fff;border-radius:10px;overflow:hidden">
<div style="background:#12232E;height:64px;padding:0 32px;display:flex;align-items:center"><span style="color:#fff;font:700 22px/64px ${titulos};letter-spacing:-.02em">contabia</span></div>
<div style="padding:34px 40px 30px"><h1 style="font:700 26px/32px ${titulos};letter-spacing:-.02em;margin:0 0 14px;color:#12232E">${esc(titulo)}</h1>
${paragrafos.map((p) => `<p style="font-size:16px;line-height:25px;margin:0 0 12px">${p}</p>`).join("")}
${botao ? `<p style="margin:24px 0 4px"><a href="${esc(botao.url)}" style="background:#0B6E5B;color:#fff;text-decoration:none;font-weight:600;font-size:15px;line-height:44px;padding:0 20px;border-radius:10px;display:inline-block">${esc(botao.texto)}</a></p>` : ""}
</div>
<div style="background:#F6F7F5;padding:20px 40px;font-size:12px;line-height:18px;color:#4B5A63">
<div style="font:700 13px ${titulos};color:#12232E">A maré certa. O seu contabilista, à mão.</div>
<div style="margin-top:6px">Contabia é uma marca de Albatross Spring, Lda. · Funchal, Madeira</div>${rodape ? `<div style="margin-top:6px">${rodape}</div>` : ""}</div>
</div></div>`;
  const texto = `${titulo}\n\n${paragrafos.map((p) => p.replace(/<[^>]+>/g, "")).join("\n\n")}${botao ? `\n\n${botao.texto}: ${botao.url}` : ""}\n\n—\nA maré certa. O seu contabilista, à mão.\nContabia é uma marca de Albatross Spring, Lda. · Funchal, Madeira${rodape ? `\n${rodape.replace(/<[^>]+>/g, "")}` : ""}`;
  return { html, texto };
}

export function emailRecuperacao(nome: string, ligacao: string): Pick<Email, "assunto" | "texto" | "html"> {
  const m = moldura("Criar uma nova senha", [
    `Olá ${esc(nome)},`,
    "Recebemos um pedido para criar uma nova senha na Contabia. A ligação é válida durante 60 minutos.",
    "Se o pedido não foi seu, pode ignorar este e-mail: a senha continua igual.",
  ], { texto: "Criar nova senha", url: ligacao });
  return { assunto: "Contabia — criar nova senha", ...m };
}

/** Aviso à equipa: uma empresa pediu um estudo de viabilidade económica. */
export function emailPedidoEstudo(
  empresa: { nome: string; nif: string; regiao: string; cae?: string | null; dimensao?: string | null },
  p: { id: string; apoioNome: string | null; nome: string; email: string; telefone: string | null; mensagem: string | null },
): Pick<Email, "assunto" | "texto" | "html"> {
  const linhas: [string, string][] = [
    ["Empresa", `${empresa.nome} (NIF ${empresa.nif})`],
    ["Região", empresa.regiao],
    ["CAE", empresa.cae ?? "não indicado"],
    ["Dimensão", empresa.dimensao ?? "não indicada"],
    ["Aviso", p.apoioNome ?? "Estudo geral (sem aviso escolhido)"],
    ["Contacto", p.nome],
    ["E-mail", p.email],
    ["Telefone", p.telefone ?? "—"],
    ["Mensagem", p.mensagem ?? "—"],
    ["Pedido", p.id],
  ];
  const tabela = `<table style="border-collapse:collapse;width:100%;font-size:14px">${linhas.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#4B5A63;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>`;
  const m = moldura("Novo pedido de estudo de viabilidade", [tabela, "O cliente autorizou o contacto."]);
  const texto = `Novo pedido de estudo de viabilidade económica\n\n${linhas.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nO cliente autorizou o contacto.`;
  const html = m.html;
  return { assunto: `Contabia — pedido de estudo: ${empresa.nome}`, texto, html };
}
