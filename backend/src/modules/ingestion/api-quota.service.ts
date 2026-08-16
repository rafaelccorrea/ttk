import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { IngestionSetting } from './entities/ingestion-setting.entity';

/**
 * Para que serve a requisição.
 *
 * A separação não é estatística: é o que impede uma finalidade de matar a
 * outra. Sem ela, uma varredura de catálogo consome a cota inteira e o play
 * do usuário para de funcionar até o mês virar — ou o contrário, os plays
 * drenam tudo e a coleta nunca acontece.
 */
export type FinalidadeDaChamada = 'coleta' | 'player';

/** Fatia do teto mensal reservada ao player. O resto é da coleta. */
const FATIA_PLAYER_PADRAO = 0.3;

/**
 * Livro-caixa das chamadas ao fornecedor.
 *
 * A cota do EchoTik é mensal, por REQUISIÇÃO, e não recupera. Antes disto, só
 * a ingestão contava o que gastava: as chamadas do player (resolver o MP4 na
 * hora de tocar) não entravam em conta nenhuma e não tinham teto. O medidor
 * mostrava zero enquanto a cota real drenava — foi assim que as chaves
 * anteriores acabaram sem ninguém ver.
 *
 * Agora TODA chamada cobrada passa por aqui, e o corte é rígido.
 *
 * O contador vive em memória e é descarregado no banco de forma agrupada: uma
 * escrita por requisição transformaria cada play em duas idas ao banco, e o
 * número exato não vale esse preço. Em queda do processo perde-se, no pior
 * caso, os últimos segundos de contagem.
 */
@Injectable()
export class ApiQuotaService {
  private readonly logger = new Logger(ApiQuotaService.name);

  private carregado = false;
  private mesCorrente = '';
  private tetoMensal = 0;
  private usadoColeta = 0;
  private usadoPlayer = 0;
  private fatiaPlayer = FATIA_PLAYER_PADRAO;
  /** Quanto ainda não foi para o banco. */
  private pendenteColeta = 0;
  private pendentePlayer = 0;
  private descarregando: Promise<void> | null = null;

  constructor(
    @InjectRepository(IngestionSetting)
    private readonly settings: Repository<IngestionSetting>,
  ) {}

  private mesDeHoje(): string {
    return new Date().toISOString().slice(0, 7);
  }

  /** Lê o estado do banco na primeira chamada (e quando o mês vira). */
  private async carregar(): Promise<void> {
    const mes = this.mesDeHoje();
    if (this.carregado && this.mesCorrente === mes) return;

    const setting = await this.settings.findOneBy({ id: 1 });
    this.tetoMensal = setting?.apiMonthlyBudget ?? 0;
    this.fatiaPlayer = (setting?.apiPlaybackSharePct ?? 30) / 100;

    if (setting && setting.apiMonthKey === mes) {
      this.usadoColeta = setting.apiRequestsUsed ?? 0;
      this.usadoPlayer = setting.apiPlaybackUsed ?? 0;
    } else {
      // Mês novo: o contador zera junto com a cota do fornecedor.
      this.usadoColeta = 0;
      this.usadoPlayer = 0;
      if (setting) {
        setting.apiMonthKey = mes;
        setting.apiRequestsUsed = 0;
        setting.apiPlaybackUsed = 0;
        await this.settings.save(setting);
      }
    }
    this.mesCorrente = mes;
    this.carregado = true;
  }

  /** Teto de cada finalidade. Sem teto mensal configurado, é ilimitado. */
  private tetoDe(finalidade: FinalidadeDaChamada): number {
    if (this.tetoMensal <= 0) return Number.POSITIVE_INFINITY;
    return finalidade === 'player'
      ? Math.floor(this.tetoMensal * this.fatiaPlayer)
      : this.tetoMensal - Math.floor(this.tetoMensal * this.fatiaPlayer);
  }

  private usadoDe(finalidade: FinalidadeDaChamada): number {
    return finalidade === 'player' ? this.usadoPlayer : this.usadoColeta;
  }

  /**
   * Registra uma requisição, se ela couber na cota da finalidade.
   *
   * Devolve `false` quando o teto já foi atingido — e nesse caso a chamada ao
   * fornecedor NÃO deve acontecer. É o corte rígido.
   */
  async registrar(finalidade: FinalidadeDaChamada): Promise<boolean> {
    await this.carregar();
    if (this.usadoDe(finalidade) >= this.tetoDe(finalidade)) {
      this.logger.warn(
        `Cota de ${finalidade} esgotada no mês (${this.usadoDe(finalidade)}/${this.tetoDe(finalidade)}).`,
      );
      return false;
    }
    if (finalidade === 'player') {
      this.usadoPlayer += 1;
      this.pendentePlayer += 1;
    } else {
      this.usadoColeta += 1;
      this.pendenteColeta += 1;
    }
    // Agrupa as escritas: a cada 10 requisições o banco é atualizado.
    if (this.pendenteColeta + this.pendentePlayer >= 10) void this.descarregar();
    return true;
  }

  /** Grava no banco o que ainda estava só em memória. */
  async descarregar(): Promise<void> {
    if (this.descarregando) return this.descarregando;
    const coleta = this.pendenteColeta;
    const player = this.pendentePlayer;
    if (!coleta && !player) return;
    this.pendenteColeta = 0;
    this.pendentePlayer = 0;

    this.descarregando = (async () => {
      try {
        await this.settings.increment({ id: 1 }, 'apiRequestsUsed', coleta);
        await this.settings.increment({ id: 1 }, 'apiPlaybackUsed', player);
      } catch (erro) {
        // Devolve para a próxima tentativa: contador que some vira cota
        // gasta sem registro, que é o problema que este serviço existe para
        // resolver.
        this.pendenteColeta += coleta;
        this.pendentePlayer += player;
        this.logger.warn(`Não consegui gravar o consumo de cota: ${erro}`);
      } finally {
        this.descarregando = null;
      }
    })();
    return this.descarregando;
  }

  /** Fotografia para a tela de ingestão. */
  async situacao(): Promise<{
    mes: string;
    tetoMensal: number;
    coleta: { usado: number; teto: number; restante: number };
    player: { usado: number; teto: number; restante: number };
  }> {
    await this.carregar();
    const monta = (f: FinalidadeDaChamada) => {
      const teto = this.tetoDe(f);
      const usado = this.usadoDe(f);
      return {
        usado,
        teto: Number.isFinite(teto) ? teto : 0,
        restante: Number.isFinite(teto) ? Math.max(0, teto - usado) : -1,
      };
    };
    return {
      mes: this.mesCorrente,
      tetoMensal: this.tetoMensal,
      coleta: monta('coleta'),
      player: monta('player'),
    };
  }

  /** Quanto a coleta ainda pode gastar neste mês. */
  async restanteDeColeta(): Promise<number> {
    await this.carregar();
    const teto = this.tetoDe('coleta');
    if (!Number.isFinite(teto)) return Number.MAX_SAFE_INTEGER;
    return Math.max(0, teto - this.usadoColeta);
  }
}
