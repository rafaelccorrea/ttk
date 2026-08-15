import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SupportMessage } from './entities/support-message.entity';

@Injectable()
export class SupportService {
  constructor(
    @InjectRepository(SupportMessage)
    private readonly repository: Repository<SupportMessage>,
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
      }),
    );

    return [userMessage, ack];
  }
}
