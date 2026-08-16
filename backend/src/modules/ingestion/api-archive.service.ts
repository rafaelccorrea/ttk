import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThan, Repository } from 'typeorm';
import { ApiRawResponse } from './entities/api-raw-response.entity';

/** Por quantos dias o bruto fica guardado antes de ser podado. */
const RETENCAO_DIAS = 90;

/** Teto por registro. Resposta gigante vira só o cabeçalho, sem o corpo. */
const MAX_BYTES = 512 * 1024;

/**
 * Arquivo das respostas cruas do fornecedor.
 *
 * A gravação é DESACOPLADA da chamada: quem faz a requisição não espera o
 * banco. Se o arquivo falhar, a ingestão continua — perder o registro é ruim,
 * perder a coleta que já foi paga é pior.
 */
@Injectable()
export class ApiArchiveService {
  private readonly logger = new Logger(ApiArchiveService.name);
  private ultimaPoda = 0;

  constructor(
    @InjectRepository(ApiRawResponse)
    private readonly raw: Repository<ApiRawResponse>,
  ) {}

  /**
   * Guarda uma resposta. Nunca lança: é observabilidade, não caminho crítico.
   *
   * `subject` é o que torna o arquivo pesquisável — o id do produto, do vídeo
   * ou da loja a que a resposta se refere.
   */
  registrar(entrada: {
    endpoint: string;
    params: Record<string, unknown>;
    httpStatus: number;
    code: number;
    message?: string | null;
    payload: unknown;
    purpose: string;
  }): void {
    void this.gravar(entrada).catch((erro) =>
      this.logger.warn(`Não consegui arquivar ${entrada.endpoint}: ${erro}`),
    );
  }

  private async gravar(entrada: {
    endpoint: string;
    params: Record<string, unknown>;
    httpStatus: number;
    code: number;
    message?: string | null;
    payload: unknown;
    purpose: string;
  }): Promise<void> {
    const dados = (entrada.payload as { data?: unknown } | null)?.data;
    const itemCount = Array.isArray(dados) ? dados.length : dados ? 1 : 0;

    // Resposta absurdamente grande: guarda o cabeçalho e descarta o corpo, em
    // vez de inchar o banco por um caso extremo.
    let payload: unknown = entrada.payload;
    try {
      if (JSON.stringify(payload ?? null).length > MAX_BYTES) {
        payload = { truncado: true, motivo: `acima de ${MAX_BYTES} bytes` };
      }
    } catch {
      payload = { truncado: true, motivo: 'payload não serializável' };
    }

    await this.raw.save(
      this.raw.create({
        endpoint: entrada.endpoint,
        params: entrada.params,
        subject: this.assunto(entrada.params),
        httpStatus: entrada.httpStatus,
        code: entrada.code,
        message: entrada.message ?? null,
        itemCount,
        payload,
        purpose: entrada.purpose,
      }),
    );

    await this.podarDeVezEmQuando();
  }

  /** O id que identifica o assunto da chamada, entre os parâmetros. */
  private assunto(params: Record<string, unknown>): string | null {
    for (const chave of [
      'product_id',
      'product_ids',
      'video_id',
      'video_ids',
      'user_ids',
      'user_id',
      'seller_id',
      'category_id',
    ]) {
      const valor = params[chave];
      if (valor !== undefined && valor !== null && `${valor}`.length) {
        return `${valor}`.slice(0, 255);
      }
    }
    return null;
  }

  /** Poda no máximo uma vez por hora, para não pesar em toda gravação. */
  private async podarDeVezEmQuando(): Promise<void> {
    const agora = Date.now();
    if (agora - this.ultimaPoda < 60 * 60 * 1000) return;
    this.ultimaPoda = agora;
    const limite = new Date(agora - RETENCAO_DIAS * 24 * 60 * 60 * 1000);
    const { affected } = await this.raw.delete({ createdAt: LessThan(limite) });
    if (affected) {
      this.logger.log(`Arquivo podado: ${affected} respostas com mais de ${RETENCAO_DIAS} dias.`);
    }
  }

  /** Respostas guardadas sobre um assunto, da mais nova para a mais velha. */
  buscarPorAssunto(subject: string, limite = 20): Promise<ApiRawResponse[]> {
    return this.raw.find({
      where: { subject },
      order: { createdAt: 'DESC' },
      take: limite,
    });
  }
}
