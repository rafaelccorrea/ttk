import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { adminEmails } from '../admin/admin.access';
import { MailService } from '../auth/mail.service';
import { AppUser } from '../users/entities/app-user.entity';
import { SupportMessage } from './entities/support-message.entity';

export interface SupportConversation {
  userId: string;
  email: string | null;
  displayName: string | null;
  plan: string | null;
  ultimaMensagem: string;
  ultimaEm: Date;
  naoLidas: number;
  total: number;
}

/**
 * Chat de suporte: uma conversa por usuário.
 *
 * Toda mensagem cai SOMENTE nas mãos de quem é admin (`ADMIN_EMAILS`): a
 * lista/resposta fica atrás do AdminGuard e o aviso por e-mail vai só para
 * esses endereços. O usuário enxerga apenas a própria conversa.
 */
@Injectable()
export class SupportService {
  private readonly logger = new Logger(SupportService.name);

  constructor(
    @InjectRepository(SupportMessage)
    private readonly repository: Repository<SupportMessage>,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
    private readonly mail: MailService,
  ) {}

  list(userId: string): Promise<SupportMessage[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'ASC' },
      take: 200,
    });
  }

  async send(userId: string, text: string, userEmail?: string) {
    const userMessage = await this.repository.save(
      this.repository.create({ userId, sender: 'user', text }),
    );

    // Confirmação automática persistida; some quando um atendente responder de verdade.
    const isFirstContact =
      (await this.repository.count({ where: { userId, sender: 'agent' } })) === 0;
    const ack = await this.repository.save(
      this.repository.create({
        userId,
        sender: 'agent',
        text: isFirstContact
          ? `Recebemos sua mensagem! 🙌 Nossa equipe responde por aqui${userEmail ? ` e avisa em ${userEmail}` : ''} em até 1 dia útil.`
          : 'Mensagem registrada — seguimos com o atendimento por aqui. ✅',
        readByAgent: true,
      }),
    );

    void this.avisarAdmins(userId, userEmail, text);
    return [userMessage, ack];
  }

  // ---------- lado do administrador ----------

  /** Conversas com a última mensagem e quantas do usuário ainda não foram lidas. */
  async listConversations(): Promise<SupportConversation[]> {
    const rows: Array<{
      userId: string;
      ultimaEm: Date;
      naoLidas: string;
      total: string;
    }> = await this.repository
      .createQueryBuilder('m')
      .select('m.userId', 'userId')
      .addSelect('MAX(m.createdAt)', 'ultimaEm')
      .addSelect(
        `SUM(CASE WHEN m.sender = 'user' AND m.readByAgent = false THEN 1 ELSE 0 END)`,
        'naoLidas',
      )
      .addSelect('COUNT(*)', 'total')
      .groupBy('m.userId')
      .orderBy('"ultimaEm"', 'DESC')
      .limit(200)
      .getRawMany();

    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.userId);
    const [users, ultimas] = await Promise.all([
      this.users.find({ where: { id: In(ids) } }),
      this.repository
        .createQueryBuilder('m')
        .distinctOn(['m.userId'])
        .where('m.userId IN (:...ids)', { ids })
        .orderBy('m.userId')
        .addOrderBy('m.createdAt', 'DESC')
        .getMany(),
    ]);
    const porUsuario = new Map(users.map((u) => [u.id, u]));
    const ultimaPor = new Map(ultimas.map((m) => [m.userId, m]));

    return rows.map((r) => {
      const u = porUsuario.get(r.userId);
      return {
        userId: r.userId,
        email: u?.email ?? null,
        displayName: u?.displayName ?? null,
        plan: u?.plan ?? null,
        ultimaMensagem: ultimaPor.get(r.userId)?.text ?? '',
        ultimaEm: new Date(r.ultimaEm),
        naoLidas: Number(r.naoLidas),
        total: Number(r.total),
      };
    });
  }

  /** Total de mensagens de usuários ainda não lidas — badge do painel. */
  unreadCount(): Promise<number> {
    return this.repository.count({ where: { sender: 'user', readByAgent: false } });
  }

  /** Abre a conversa e marca as mensagens do usuário como lidas. */
  async conversation(userId: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Conta não encontrada');
    await this.repository.update(
      { userId, sender: 'user', readByAgent: false },
      { readByAgent: true },
    );
    const mensagens = await this.list(userId);
    return {
      user: {
        id: user.id,
        email: user.email,
        displayName: user.displayName,
        plan: user.plan,
      },
      mensagens,
    };
  }

  async reply(userId: string, text: string, adminEmail: string) {
    const user = await this.users.findOne({ where: { id: userId } });
    if (!user) throw new NotFoundException('Conta não encontrada');
    const saved = await this.repository.save(
      this.repository.create({ userId, sender: 'agent', text, readByAgent: true }),
    );
    this.logger.log(`Suporte: ${adminEmail} respondeu ${user.email}`);
    if (user.email) {
      void this.mail
        .send({
          to: user.email,
          subject: 'O suporte PikPok respondeu você',
          text: `Resposta do suporte:\n\n${text}\n\nContinue a conversa pelo chat dentro do app.`,
          body: `<p>O suporte respondeu no seu chat:</p>${citacao(text)}<p>Continue a conversa pelo chat dentro do app.</p>`,
        })
        .catch((e) => this.logger.warn(`E-mail de resposta falhou: ${e?.message ?? e}`));
    }
    return saved;
  }

  /** Aviso por e-mail só para os endereços de ADMIN_EMAILS. */
  private async avisarAdmins(userId: string, userEmail: string | undefined, text: string) {
    const destinos = adminEmails();
    if (destinos.length === 0) {
      this.logger.warn('ADMIN_EMAILS vazio — mensagem de suporte sem aviso por e-mail');
      return;
    }
    const quem = userEmail ?? userId;
    await Promise.all(
      destinos.map((to) =>
        this.mail
          .send({
            to,
            subject: `[Suporte] Nova mensagem de ${quem}`,
            text: `${quem} escreveu no chat de suporte:\n\n${text}\n\nResponda pelo painel admin.`,
            body: `<p><strong>${escapeHtml(quem)}</strong> escreveu no chat de suporte:</p>${citacao(text)}<p>Responda pelo painel admin → Suporte.</p>`,
          })
          .catch((e) =>
            this.logger.warn(`Aviso de suporte para ${to} falhou: ${e?.message ?? e}`),
          ),
      ),
    );
  }
}

function citacao(text: string): string {
  return `<blockquote style="border-left:3px solid #fe2c55;margin:16px 0;padding:8px 16px;color:#161823;white-space:pre-wrap">${escapeHtml(text)}</blockquote>`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
