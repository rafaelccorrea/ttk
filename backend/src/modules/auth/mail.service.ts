import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';

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
      html: `
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

  async sendConfirmationEmail(to: string, link: string): Promise<SentMail> {
    return this.send({
      to,
      subject: 'Confirme seu e-mail — PikPok',
      text: `Bem-vindo ao PikPok!\n\nConfirme seu e-mail abrindo o link:\n${link}\n\nSe você não criou esta conta, ignore esta mensagem.`,
      body: `
        <h2 style="font-size:18px;margin:0 0 8px">Confirme seu e-mail</h2>
        <p style="margin:0 0 24px">Falta um passo para ativar sua conta. Clique no botão abaixo:</p>
        <a href="${link}" style="display:inline-block;background:#fe2c55;color:#fff;text-decoration:none;font-weight:700;padding:12px 28px;border-radius:10px">Confirmar e-mail</a>
        <p style="color:#73747b;font-size:13px;margin:24px 0 0">Se o botão não funcionar, copie e cole este link no navegador:<br><a href="${link}" style="color:#fe2c55">${link}</a></p>`,
      footer: 'Se você não criou esta conta, ignore esta mensagem.',
    });
  }
}
