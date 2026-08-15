import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BillingService } from '../billing/billing.service';
import { GenerateMediaDto } from './dto/generate-media.dto';
import { GeneratedMedia } from './entities/generated-media.entity';
import { HiggsfieldService } from './higgsfield.service';

const TERMINAL = ['completed', 'failed', 'nsfw', 'canceled'];

@Injectable()
export class VideogenService {
  constructor(
    @InjectRepository(GeneratedMedia)
    private readonly media: Repository<GeneratedMedia>,
    private readonly higgsfield: HiggsfieldService,
    private readonly billing: BillingService,
  ) {}

  /**
   * Inicia uma geração. Imagem: Soul direto. Vídeo: fase 1 (Soul cria o
   * frame base); a fase 2 (DoP anima) é disparada no refresh quando a
   * imagem fica pronta.
   */
  async generate(userId: string, dto: GenerateMediaDto): Promise<GeneratedMedia> {
    // Cobra antes de submeter; se a Higgsfield recusar, o estorno é automático.
    const submitted = await this.billing.withCharge(userId, dto.kind, () =>
      this.higgsfield.submitImage(dto.prompt, dto.aspectRatio ?? '9:16'),
    );
    return this.media.save(
      this.media.create({
        userId,
        kind: dto.kind,
        prompt: dto.prompt,
        aspectRatio: dto.aspectRatio ?? '9:16',
        status: (submitted.status as GeneratedMedia['status']) ?? 'queued',
        phase: 'image',
        requestId: submitted.requestId,
      }),
    );
  }

  list(userId: string): Promise<GeneratedMedia[]> {
    return this.media.find({
      where: { userId },
      order: { createdAt: 'DESC' },
      take: 50,
    });
  }

  /** Busca o item e, se ainda estiver em andamento, atualiza pelo status da API. */
  async refresh(userId: string, id: string): Promise<GeneratedMedia> {
    const item = await this.media.findOneBy({ id, userId });
    if (!item) {
      throw new NotFoundException(`Geração ${id} não encontrada`);
    }
    if (TERMINAL.includes(item.status) || !item.requestId) {
      return item;
    }

    const status = await this.higgsfield.getStatus(item.requestId);

    if (status.status === 'completed') {
      if (item.phase === 'image') {
        item.imageUrl = status.imageUrl ?? item.imageUrl;
        if (item.kind === 'image') {
          item.status = 'completed';
          item.outputUrl = status.imageUrl ?? null as unknown as string;
        } else if (item.imageUrl) {
          // Vídeo: frame pronto → dispara a animação (fase 2).
          const video = await this.higgsfield.submitVideo(
            item.imageUrl,
            item.prompt,
          );
          item.phase = 'video';
          item.requestId = video.requestId;
          item.status = (video.status as GeneratedMedia['status']) ?? 'queued';
        } else {
          item.status = 'failed';
          item.error = 'Imagem base não retornou URL.';
        }
      } else {
        item.status = 'completed';
        item.outputUrl = status.videoUrl ?? null as unknown as string;
      }
    } else if (TERMINAL.includes(status.status)) {
      item.status = status.status as GeneratedMedia['status'];
      item.error = status.error ?? item.error;
    } else {
      item.status = status.status as GeneratedMedia['status'];
    }

    // Falhou depois de cobrado → devolve os créditos (uma única vez).
    if (
      ['failed', 'nsfw', 'canceled'].includes(item.status) &&
      !item.refunded
    ) {
      await this.billing.refund(
        userId,
        item.kind,
        `Estorno: geração de ${item.kind === 'video' ? 'vídeo' : 'imagem'} falhou`,
      );
      item.refunded = true;
    }

    return this.media.save(item);
  }

  async delete(userId: string, id: string): Promise<void> {
    const result = await this.media.delete({ id, userId });
    if (!result.affected) {
      throw new NotFoundException(`Geração ${id} não encontrada`);
    }
  }
}
