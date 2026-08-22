import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export interface SentMail {
  /** URL de visualização (Ethereal) quando não há SMTP real configurado. */
  previewUrl?: string;
}

/**
 * Envio de e-mails via Nodemailer.
 * Com SMTP_HOST configurado usa o servidor real; sem ele, cria uma conta de
 * teste Ethereal automaticamente e loga a URL de preview do e-mail.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private transporterPromise: Promise<Transporter> | null = null;
  private usingEthereal = false;

  constructor(private readonly config: ConfigService) {}

  private getTransporter(): Promise<Transporter> {
    if (!this.transporterPromise) {
      const host = this.config.get<string>('SMTP_HOST');
      if (host) {
        this.transporterPromise = Promise.resolve(
          nodemailer.createTransport({
            host,
            port: Number(this.config.get('SMTP_PORT', 587)),
            secure: this.config.get('SMTP_SECURE') === 'true',
            auth: this.config.get('SMTP_USER')
              ? {
                  user: this.config.get<string>('SMTP_USER'),
                  pass: this.config.get<string>('SMTP_PASS'),
                }
              : undefined,
          }),
        );
      } else {
        this.usingEthereal = true;
        this.transporterPromise = nodemailer
          .createTestAccount()
          .then((account) => {
            this.logger.warn(
              `SMTP não configurado — usando conta de teste Ethereal (${account.user}). Os e-mails NÃO chegam em caixas reais; a URL de preview aparece no log.`,
            );
            return nodemailer.createTransport({
              host: account.smtp.host,
              port: account.smtp.port,
              secure: account.smtp.secure,
              auth: { user: account.user, pass: account.pass },
            });
          });
      }
    }
    return this.transporterPromise;
  }

  /**
   * Envio genérico. `body` já vem como HTML do conteúdo — o cabeçalho da marca
   * e o rodapé são aplicados aqui para todo e-mail sair igual.
   */
  async send(message: {
    to: string;
    subject: string;
    text: string;
    body: string;
    /** Rodapé opcional (ex.: como desativar o aviso). */
    footer?: string;
    /** HTML completo — pula o cabeçalho/rodapé padrão (e-mails de marca). */
    html?: string;
  }): Promise<SentMail> {
    const transporter = await this.getTransporter();
    const from = this.config.get(
      'MAIL_FROM',
      '"PikPok" <nao-responda@pikpok.app>',
    );

    const info = await transporter.sendMail({
      from,
      to: message.to,
      subject: message.subject,
      text: message.text,
      html:
        message.html ??
        `
        <div style="font-family:Inter,Arial,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;color:#161823">
          <h1 style="font-size:22px;margin:0 0 4px">Pik<span style="color:#fe2c55">Pok</span></h1>
          <p style="color:#73747b;margin:0 0 24px">Inteligência de produtos para o TikTok Shop</p>
          ${message.body}
          ${
            message.footer
              ? `<p style="color:#73747b;font-size:13px;margin:24px 0 0">${message.footer}</p>`
              : ''
          }
        </div>`,
    });

    const result: SentMail = {};
    if (this.usingEthereal) {
      const preview = nodemailer.getTestMessageUrl(info);
      if (preview) {
        result.previewUrl = String(preview);
        this.logger.log(`E-mail "${message.subject}" (preview): ${result.previewUrl}`);
      }
    }
    return result;
  }

  private appUrl(): string {
    return this.config
      .get<string>('APP_URL', 'http://localhost:5173')
      .replace(/\/+$/, '');
  }

  /** Botão rosa com sombra ciano — o "clique" dos e-mails da marca. */
  private botao(href: string, label: string): string {
    return `
      <table role="presentation" cellspacing="0" cellpadding="0" border="0" style="margin:0 auto">
        <tr><td style="border-radius:12px;background:#fe2c55;box-shadow:4px 4px 0 #25f4ee">
          <a href="${href}" style="display:inline-block;padding:14px 32px;color:#ffffff;font-weight:700;font-size:16px;text-decoration:none;border-radius:12px">${label}</a>
        </td></tr>
      </table>`;
  }

  /**
   * Layout escuro da marca: preto, ciano #25f4ee e rosa #fe2c55 do TikTok.
   * Tabelas + CSS inline para funcionar no Gmail/Outlook; o logo vem do site.
   * `secoes` são `<tr>`s prontos que entram entre o cabeçalho e o rodapé.
   */
  private layoutEscuro(opts: {
    titulo: string;
    preheader: string;
    secoes: string;
    rodape: string;
  }): string {
    const appUrl = this.appUrl();
    return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="color-scheme" content="dark">
  <meta name="supported-color-schemes" content="dark">
  <title>${opts.titulo}</title>
</head>
<body style="margin:0;padding:0;background:#010101;-webkit-font-smoothing:antialiased">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0">${opts.preheader}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#010101">
    <tr><td align="center" style="padding:32px 16px">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:520px;background:#0d0d10;border-radius:20px;overflow:hidden;font-family:Inter,'Segoe UI',Helvetica,Arial,sans-serif;color:#f1f1f2">

        <!-- faixa ciano/rosa -->
        <tr><td style="height:6px;line-height:6px;font-size:0;background:linear-gradient(90deg,#25f4ee 0%,#25f4ee 50%,#fe2c55 50%,#fe2c55 100%)">&nbsp;</td></tr>

        <!-- logo -->
        <tr><td align="center" style="padding:36px 32px 8px">
          <img src="${appUrl}/logo-transparent.png" width="96" height="96" alt="PikPok" style="display:block;border-radius:24px;border:0">
        </td></tr>
        <tr><td align="center" style="padding:0 32px 28px">
          <div style="font-size:30px;font-weight:800;letter-spacing:-0.5px;line-height:1.1">
            <span style="color:#25f4ee">Pik</span><span style="color:#fe2c55">Pok</span>
          </div>
          <div style="margin-top:6px;font-size:13px;color:#8a8b91">Inteligência de produtos para o TikTok Shop</div>
        </td></tr>

        ${opts.secoes}

        <!-- rodapé -->
        <tr><td style="height:1px;line-height:1px;font-size:0;background:#1e1e24">&nbsp;</td></tr>
        <tr><td align="center" style="padding:24px 32px 32px;font-size:12px;line-height:1.6;color:#6f7076">
          ${opts.rodape}<br>
          Dúvidas? Responda este e-mail ou acesse <a href="${appUrl}" style="color:#25f4ee;text-decoration:none">${appUrl.replace(/^https?:\/\//, '')}</a>
          <div style="margin-top:14px;font-weight:700"><span style="color:#25f4ee">Pik</span><span style="color:#fe2c55">Pok</span></div>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
  }

  /**
   * Confirmação de cadastro. Só tem uma ação, então o botão é o centro do
   * e-mail; o link cru vai embaixo para quem o cliente de e-mail bloqueia.
   */
  async sendConfirmationEmail(to: string, link: string): Promise<SentMail> {
    const html = this.layoutEscuro({
      titulo: 'Confirme seu e-mail — PikPok',
      preheader: 'Falta um clique para ativar sua conta no PikPok.',
      secoes: `
        <tr><td style="padding:0 32px">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#25f4ee;margin-bottom:10px">Último passo</div>
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff">Confirme seu e-mail ✉️</h1>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#c9c9ce">Sua conta no PikPok está quase pronta. Clique no botão abaixo para confirmar que este e-mail é seu e liberar o acesso.</p>
        </td></tr>

        <tr><td align="center" style="padding:0 32px 28px">${this.botao(link, 'Confirmar e-mail')}</td></tr>

        <tr><td style="padding:0 32px 12px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#16161b;border-radius:14px;border-left:3px solid #25f4ee">
            <tr><td style="padding:14px 16px;font-size:13px;line-height:1.55;color:#9a9ba1">
              Se o botão não funcionar, copie e cole este link no navegador:<br>
              <a href="${link}" style="color:#fe2c55;text-decoration:none;word-break:break-all">${link}</a>
            </td></tr>
          </table>
        </td></tr>

        <tr><td style="padding:12px 32px 36px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b1f1f;border-radius:14px;border:1px solid #1b3d3c">
            <tr><td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#c9c9ce">
              🔥 <strong style="color:#25f4ee">Do outro lado do clique:</strong> os produtos que mais vendem no TikTok Shop, os vídeos que convertem e o Estúdio pra criar os seus.
            </td></tr>
          </table>
        </td></tr>`,
      rodape: 'Se você não criou esta conta, ignore esta mensagem — nada será ativado.',
    });

    return this.send({
      to,
      subject: 'Confirme seu e-mail — PikPok',
      text: `Bem-vindo ao PikPok!\n\nConfirme seu e-mail abrindo o link:\n${link}\n\nSe você não criou esta conta, ignore esta mensagem.`,
      body: '',
      html,
    });
  }

  /** Boas-vindas para quem acabou de ativar a conta. */
  async sendWelcomeEmail(to: string, displayName?: string): Promise<SentMail> {
    const appUrl = this.appUrl();
    const primeiroNome = (displayName ?? '').trim().split(/\s+/)[0];
    const saudacao = primeiroNome ? `Olá, ${escapeHtml(primeiroNome)}!` : 'Olá!';

    const passos: Array<[emoji: string, titulo: string, texto: string, path: string]> = [
      ['🔥', 'Descubra o que está vendendo', 'Produtos em alta no TikTok Shop, com vendas, comissão e tendência.', '/produtos'],
      ['🎬', 'Veja os vídeos que convertem', 'Criadores e vídeos que realmente geram vendas — aprenda com quem já vende.', '/criadores'],
      ['⚡', 'Crie seus vídeos no Estúdio', 'Roteiro, narração e variações prontas para postar em minutos.', '/estudio'],
    ];

    const html = this.layoutEscuro({
      titulo: 'Bem-vindo ao PikPok',
      preheader: 'Sua conta está ativa. Veja por onde começar no PikPok.',
      secoes: `
        <tr><td style="padding:0 32px">
          <h1 style="margin:0 0 12px;font-size:24px;line-height:1.25;font-weight:800;color:#ffffff">${saudacao}<br>Bem-vindo ao PikPok 🎉</h1>
          <p style="margin:0 0 28px;font-size:16px;line-height:1.6;color:#c9c9ce">Sua conta está ativa. A partir de agora você vê o que está vendendo no TikTok Shop antes de todo mundo — e já cria seus vídeos a partir disso.</p>
        </td></tr>

        <tr><td align="center" style="padding:0 32px 32px">${this.botao(`${appUrl}/dashboard`, 'Começar agora')}</td></tr>

        <tr><td style="padding:0 32px">
          <div style="font-size:12px;font-weight:700;letter-spacing:1.5px;text-transform:uppercase;color:#25f4ee;margin-bottom:12px">Por onde começar</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0">
            ${passos
              .map(
                ([emoji, titulo, texto, path]) => `
            <tr><td style="padding:0 0 12px">
              <a href="${appUrl}${path}" style="text-decoration:none;color:inherit">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#16161b;border-radius:14px;border-left:3px solid #fe2c55">
                <tr>
                  <td width="48" valign="top" style="padding:16px 0 16px 16px;font-size:24px;line-height:1">${emoji}</td>
                  <td valign="top" style="padding:16px 16px 16px 8px">
                    <div style="font-size:15px;font-weight:700;color:#ffffff;margin-bottom:4px">${titulo}</div>
                    <div style="font-size:14px;line-height:1.5;color:#9a9ba1">${texto}</div>
                  </td>
                </tr>
              </table>
              </a>
            </td></tr>`,
              )
              .join('')}
          </table>
        </td></tr>

        <tr><td style="padding:16px 32px 36px">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#0b1f1f;border-radius:14px;border:1px solid #1b3d3c">
            <tr><td style="padding:16px 18px;font-size:14px;line-height:1.55;color:#c9c9ce">
              💡 <strong style="color:#25f4ee">Dica:</strong> salve os produtos que chamarem sua atenção em <a href="${appUrl}/favoritos" style="color:#fe2c55;text-decoration:none;font-weight:600">Favoritos</a> para acompanhar a evolução deles.
            </td></tr>
          </table>
        </td></tr>`,
      rodape: 'Você recebeu este e-mail porque criou uma conta no PikPok.',
    });

    return this.send({
      to,
      subject: `${primeiroNome ? `${primeiroNome}, sua` : 'Sua'} conta no PikPok está ativa 🎉`,
      text: [
        `${saudacao}`,
        '',
        'Bem-vindo ao PikPok! Sua conta está ativa.',
        '',
        'Por onde começar:',
        ...passos.map(([, titulo, texto, path]) => `- ${titulo}: ${texto} ${appUrl}${path}`),
        '',
        `Começar agora: ${appUrl}/dashboard`,
        '',
        'Você recebeu este e-mail porque criou uma conta no PikPok.',
      ].join('\n'),
      body: '',
      html,
    });
  }

  async sendPasswordResetEmail(to: string, link: string): Promise<SentMail> {
    return this.send({
      to,
      subject: 'Redefinir sua senha — PikPok',
      text: `Recebemos um pedido para redefinir a senha da sua conta PikPok.\n\nAbra o link abaixo para escolher uma nova senha (vale por 1 hora):\n${link}\n\nSe não foi você, ignore esta mensagem — sua senha continua a mesma.`,
      body: `
        <h2 style="font-size:18px;margin:0 0 8px">Redefinir sua senha</h2>
        <p style="margin:0 0 24px">Recebemos um pedido para redefinir a senha da sua conta. Clique no botão abaixo para escolher uma nova — o link vale por <strong>1 hora</strong>.</p>
        <a href="${link}" style="display:inline-block;background:#fe2c55;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">Criar nova senha</a>
        <p style="color:#73747b;font-size:13px;margin:24px 0 0">Se o botão não funcionar, copie e cole este link no navegador:<br><a href="${link}" style="color:#fe2c55">${link}</a></p>`,
      footer:
        'Se não foi você que pediu, ignore esta mensagem — sua senha continua a mesma.',
    });
  }
}
