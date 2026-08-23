import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { adminEmails } from '../admin/admin.access';
import { MailService } from '../auth/mail.service';

/** Por onde a conta entrou — vai no assunto do e-mail e no toast. */
export type OrigemDaConta = 'senha' | 'google' | 'supabase';

export interface ContaNova {
  id: string;
  email: string;
  displayName?: string | null;
  origem: OrigemDaConta;
  /** Entrou na lista de espera (soft launch) em vez de ativar na hora. */
  naFila?: boolean;
  /** E-mail de quem indicou, quando veio por link de indicação. */
  indicadoPor?: string | null;
}

const ORIGEM_LABEL: Record<OrigemDaConta, string> = {
  senha: 'e-mail e senha',
  google: 'Google',
  supabase: 'login externo (Supabase)',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Avisa a equipe que uma conta acabou de ser criada.
 *
 * Um único ponto chamado pelos três lugares onde uma linha de `app_users`
 * nasce (cadastro por senha, primeiro login com Google, `ensure` do guard).
 * Best-effort e fora do caminho crítico: o cadastro do cliente NUNCA falha
 * porque o e-mail para nós não saiu — a falha vai para o log, e o painel
 * (`/admin/novas-contas`) continua sendo a fonte que não depende de SMTP.
 */
@Injectable()
export class NovaContaService {
  private readonly logger = new Logger(NovaContaService.name);

  constructor(
    private readonly mail: MailService,
    private readonly config: ConfigService,
  ) {}

  avisar(conta: ContaNova): void {
    const destinatarios = adminEmails();
    if (!destinatarios.length) {
      this.logger.log(`Nova conta ${conta.email} (${conta.origem}) — ADMIN_EMAILS vazio, sem aviso.`);
      return;
    }
    void this.enviar(conta, destinatarios).catch((err: Error) =>
      this.logger.error(`Aviso de nova conta (${conta.email}) não saiu: ${err.message}`),
    );
  }

  private async enviar(conta: ContaNova, destinatarios: string[]): Promise<void> {
    const appUrl = this.config.get<string>('APP_URL', 'http://localhost:5173').replace(/\/$/, '');
    const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
    const origem = ORIGEM_LABEL[conta.origem];
    const nome = conta.displayName?.trim() || null;
    const linhas: Array<[string, string]> = [
      ['E-mail', conta.email],
      ...(nome ? ([['Nome', nome]] as Array<[string, string]>) : []),
      ['Entrou por', origem],
      ['Quando', quando],
      ...(conta.naFila ? ([['Situação', 'na lista de espera']] as Array<[string, string]>) : []),
      ...(conta.indicadoPor
        ? ([['Indicado por', conta.indicadoPor]] as Array<[string, string]>)
        : []),
    ];

    const subject = `Nova conta: ${conta.email}${conta.naFila ? ' (na fila)' : ''} · ${origem}`;
    const text =
      `Uma conta nova foi criada no PikPok.\n\n` +
      linhas.map(([k, v]) => `${k}: ${v}`).join('\n') +
      `\n\nAbrir no painel: ${appUrl}/admin`;
    const body = `
      <h2 style="font-size:18px;margin:0 0 12px">Nova conta criada</h2>
      <table style="border-collapse:collapse;font-size:14px">
        ${linhas
          .map(
            ([k, v]) =>
              `<tr><td style="padding:4px 12px 4px 0;color:#73747b">${escapeHtml(k)}</td><td style="padding:4px 0;font-weight:600">${escapeHtml(v)}</td></tr>`,
          )
          .join('')}
      </table>
      <p style="margin:20px 0 0"><a href="${appUrl}/admin" style="background:#fe2c55;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Abrir no painel</a></p>`;

    // Um envio por destinatário: se um endereço estiver errado, os outros
    // ainda recebem.
    await Promise.all(
      destinatarios.map((to) =>
        this.mail.send({
          to,
          subject,
          text,
          body,
          footer: 'Você recebe este aviso porque está em ADMIN_EMAILS.',
        }),
      ),
    );
    this.logger.log(`Aviso de nova conta enviado: ${conta.email} → ${destinatarios.join(', ')}`);
  }
}
