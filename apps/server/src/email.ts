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

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

export function emailRecuperacao(nome: string, ligacao: string): Pick<Email, "assunto" | "texto" | "html"> {
  const texto = `Olá ${nome},\n\nRecebemos um pedido para criar uma nova senha na Contabia.\nAbra esta ligação nos próximos 60 minutos:\n${ligacao}\n\nSe não foi você, ignore este e-mail: a sua senha continua igual.\n\nContabia`;
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:480px;margin:auto;color:#12232E">
<h2 style="color:#0B6E5B;margin:0 0 12px">Nova senha</h2>
<p>Olá ${esc(nome)},</p><p>Recebemos um pedido para criar uma nova senha na Contabia.</p>
<p><a href="${esc(ligacao)}" style="display:inline-block;background:#0B6E5B;color:#fff;padding:12px 20px;border-radius:10px;text-decoration:none;font-weight:600">Criar nova senha</a></p>
<p style="color:#4B5A63;font-size:13px">A ligação é válida durante 60 minutos. Se não foi você, ignore este e-mail: a sua senha continua igual.</p></div>`;
  return { assunto: "Contabia — criar nova senha", texto, html };
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
  const texto = `Novo pedido de estudo de viabilidade económica\n\n${linhas.map(([k, v]) => `${k}: ${v}`).join("\n")}\n\nO cliente autorizou o contacto.`;
  const html = `<div style="font-family:system-ui,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#12232E">
<h2 style="color:#0B6E5B;margin:0 0 12px">Novo pedido de estudo de viabilidade</h2>
<table style="border-collapse:collapse;width:100%;font-size:14px">${linhas.map(([k, v]) => `<tr><td style="padding:6px 10px 6px 0;color:#4B5A63;vertical-align:top;white-space:nowrap">${esc(k)}</td><td style="padding:6px 0">${esc(v).replace(/\n/g, "<br>")}</td></tr>`).join("")}</table>
<p style="color:#4B5A63;font-size:13px">O cliente autorizou o contacto.</p></div>`;
  return { assunto: `Contabia — pedido de estudo: ${empresa.nome}`, texto, html };
}
