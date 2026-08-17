import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes, randomInt } from 'crypto';
import { In, LessThan, Repository } from 'typeorm';
import { AppUser } from '../users/entities/app-user.entity';
import { AuthService } from './auth.service';
import { DeviceAuthorization } from './entities/device-authorization.entity';

/**
 * Janela de aprovação. Curta porque durante ela existe um código de 4
 * caracteres capaz de virar sessão: o custo de errar aqui é alguém aprovar por
 * engano um pareamento que não é seu. Dez minutos dão tempo de abrir o
 * navegador e conferir, e não mais que isso.
 */
const TTL_AUTORIZACAO_SEGUNDOS = 600;

/** 30 dias — o app de live fica pareado por temporada, não por sessão. */
const TTL_TOKEN_SEGUNDOS = 30 * 24 * 60 * 60;

/**
 * Alfabeto sem ambiguidade visual para o código curto. Fora: O e 0, I e 1, L
 * (vira 1), S (vira 5), U (vira V em algumas fontes). Quem lê o código está
 * copiando de uma tela para outra, e um caractere confundido não produz erro
 * de digitação — produz "código inválido" numa tela de segurança.
 */
const ALFABETO_SEM_AMBIGUIDADE = 'ABCDEFGHJKMNPQRTVWXYZ23456789';

@Injectable()
export class DeviceFlowService {
  private readonly logger = new Logger(DeviceFlowService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly authService: AuthService,
    @InjectRepository(DeviceAuthorization)
    private readonly autorizacoes: Repository<DeviceAuthorization>,
    @InjectRepository(AppUser)
    private readonly users: Repository<AppUser>,
  ) {}

  private gerarUserCode(): string {
    // `randomInt` e não Math.random: este código autoriza acesso a uma conta,
    // e o gerador do V8 é previsível para quem observa saídas suficientes.
    let sufixo = '';
    for (let i = 0; i < 4; i += 1) {
      sufixo += ALFABETO_SEM_AMBIGUIDADE[
        randomInt(ALFABETO_SEM_AMBIGUIDADE.length)
      ];
    }
    return `PIKPOK-${sufixo}`;
  }

  private get verificationUrl(): string {
    const appUrl = this.config
      .get('APP_URL', 'http://localhost:5173')
      .replace(/\/$/, '');
    /*
     * O padrão de `localhost` é conveniência de quem desenvolve, e em produção
     * ele é uma armadilha silenciosa: o app instalado abriria o navegador do
     * cliente em `http://localhost:5173/ativar`, que na máquina dele não existe.
     * O pareamento morre ali, sem erro em lugar nenhum — o backend respondeu
     * 200, o app fez o que mandaram, e a página simplesmente não carrega.
     *
     * Então em produção a ausência de APP_URL é falha de configuração, e falha
     * de configuração se anuncia na primeira chamada, não no primeiro cliente.
     */
    if (
      process.env.NODE_ENV === 'production' &&
      /^https?:\/\/(localhost|127\.0\.0\.1)/i.test(appUrl)
    ) {
      throw new Error(
        'APP_URL não está configurada: o app desktop receberia um endereço de pareamento que só existe na máquina do servidor.',
      );
    }
    return `${appUrl}/ativar`;
  }

  /**
   * Passo 1, chamado pelo app desktop antes de existir qualquer sessão.
   *
   * O `userCode` tem só 4 caracteres num alfabeto de 29, então colisões entre
   * autorizações vivas são plausíveis — e a coluna é UNIQUE. Em vez de confiar
   * na sorte, tenta de novo algumas vezes; o UNIQUE é a garantia final de que
   * dois dispositivos nunca compartilham o mesmo código.
   */
  async iniciar(deviceName?: string) {
    const expiresAt = new Date(Date.now() + TTL_AUTORIZACAO_SEGUNDOS * 1000);

    for (let tentativa = 0; tentativa < 8; tentativa += 1) {
      const registro = this.autorizacoes.create({
        // 32 bytes: este é o segredo de verdade do fluxo, o único que precisa
        // resistir a adivinhação por força bruta.
        deviceCode: randomBytes(32).toString('hex'),
        userCode: this.gerarUserCode(),
        status: 'pendente',
        expiresAt,
        deviceName: deviceName?.trim().slice(0, 120) || null,
      });
      try {
        const salvo = await this.autorizacoes.save(registro);
        return {
          deviceCode: salvo.deviceCode,
          userCode: salvo.userCode,
          verificationUrl: `${this.verificationUrl}?code=${salvo.userCode}`,
          expiresIn: TTL_AUTORIZACAO_SEGUNDOS,
        };
      } catch (err) {
        // 23505 = unique_violation: o código curto colidiu com um vivo.
        if ((err as { code?: string }).code !== '23505') throw err;
      }
    }
    throw new BadRequestException(
      'Não foi possível gerar um código agora. Tente novamente.',
    );
  }

  /**
   * Passo 2, chamado pela WEB com o usuário já autenticado. É esta chamada —
   * e só ela — que decide de quem é a conta que o dispositivo vai acessar: o
   * `userId` vem da sessão do navegador, nunca do corpo da requisição.
   */
  async aprovar(userId: string, userCode: string) {
    const registro = await this.buscarPorUserCode(userCode);
    if (registro.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException(
        'Este código expirou. Gere um novo no aplicativo.',
      );
    }
    if (registro.status !== 'pendente') {
      throw new BadRequestException(
        registro.status === 'aprovado'
          ? 'Este código já foi aprovado.'
          : 'Este código não está mais válido. Gere um novo no aplicativo.',
      );
    }

    registro.status = 'aprovado';
    registro.userId = userId;
    registro.approvedAt = new Date();
    await this.autorizacoes.save(registro);
    return { status: 'aprovado' as const, deviceName: registro.deviceName };
  }

  /** Recusa explícita: a pessoa não reconheceu o código que apareceu. */
  async negar(userId: string, userCode: string) {
    const registro = await this.buscarPorUserCode(userCode);
    if (registro.status !== 'pendente') {
      throw new BadRequestException('Este código não está mais pendente.');
    }
    registro.status = 'negado';
    registro.userId = userId;
    await this.autorizacoes.save(registro);
    return { status: 'negado' as const };
  }

  /** Dados que a tela de aprovação mostra antes de a pessoa decidir. */
  async consultarPorUserCode(userCode: string) {
    const registro = await this.buscarPorUserCode(userCode);
    return {
      userCode: registro.userCode,
      deviceName: registro.deviceName,
      status: registro.expiresAt.getTime() < Date.now() ? 'expirado' : registro.status,
      expiresAt: registro.expiresAt,
    };
  }

  private async buscarPorUserCode(userCode: string) {
    const normalizado = userCode?.trim().toUpperCase();
    const registro = normalizado
      ? await this.autorizacoes.findOneBy({ userCode: normalizado })
      : null;
    if (!registro) {
      throw new NotFoundException('Código não encontrado.');
    }
    return registro;
  }

  /**
   * Passo 3, chamado em laço pelo app desktop. Autentica-se pelo próprio
   * `deviceCode` — é o único endpoint do fluxo em que o segredo do dispositivo
   * trafega.
   */
  async trocarPorToken(deviceCode: string) {
    const registro = deviceCode
      ? await this.autorizacoes.findOneBy({ deviceCode })
      : null;
    // Mesma resposta para código inexistente e para código errado: nada aqui
    // deve ajudar quem está varrendo o espaço de `deviceCode`.
    if (!registro) {
      throw new UnauthorizedException('Autorização inválida.');
    }

    const expirado =
      registro.status === 'expirado' ||
      (registro.status === 'pendente' &&
        registro.expiresAt.getTime() < Date.now());
    if (expirado) {
      throw new BadRequestException(
        'O código expirou antes da aprovação. Gere um novo no aplicativo.',
      );
    }
    if (registro.status === 'negado') {
      throw new BadRequestException('Esta autorização foi recusada.');
    }
    if (registro.status === 'pendente') {
      return { status: 'pendente' as const };
    }

    /*
     * A emissão é a parte perigosa: quem interceptar o `deviceCode` — log de
     * proxy, histórico de terminal, print de tela — poderia trocá-lo por um
     * token novo de 30 dias quantas vezes quisesse, indefinidamente.
     *
     * O UPDATE condicional abaixo é o que fecha isso, e precisa ser UPDATE e
     * não "ler, checar, salvar": entre a leitura e o save cabem duas
     * requisições simultâneas, as duas vendo `tokenIssuedAt` nulo, as duas
     * emitindo. Aqui o próprio Postgres arbitra — o `WHERE tokenIssuedAt IS
     * NULL` faz exatamente uma das concorrentes afetar uma linha, e a outra
     * afeta zero e sai sem token.
     */
    const resultado = await this.autorizacoes
      .createQueryBuilder()
      .update(DeviceAuthorization)
      .set({ tokenIssuedAt: () => 'now()' })
      .where('id = :id', { id: registro.id })
      .andWhere('status = :status', { status: 'aprovado' })
      .andWhere('"tokenIssuedAt" IS NULL')
      .execute();

    if (!resultado.affected) {
      throw new BadRequestException(
        'Esta autorização já foi utilizada. Gere um novo código no aplicativo.',
      );
    }

    const user = await this.users.findOneBy({ id: registro.userId as string });
    if (!user) {
      throw new UnauthorizedException('Conta não encontrada.');
    }

    return {
      status: 'aprovado' as const,
      accessToken: this.authService.issueDeviceToken(user, TTL_TOKEN_SEGUNDOS),
      expiresIn: TTL_TOKEN_SEGUNDOS,
      user: { id: user.id, email: user.email },
    };
  }

  /**
   * Encerra o que ninguém aprovou. O `trocarPorToken` já trata o vencimento em
   * tempo real, então isto não é a barreira de segurança — é higiene: sem ele
   * a tabela acumula pendências eternas e a tela de aprovação continuaria
   * mostrando como "aguardando" um código que morreu há dias.
   */
  @Cron('*/5 * * * *')
  async expirarPendentes(): Promise<number> {
    const resultado = await this.autorizacoes
      .createQueryBuilder()
      .update(DeviceAuthorization)
      .set({ status: 'expirado' })
      .where({ status: In(['pendente']), expiresAt: LessThan(new Date()) })
      .execute();
    const total = resultado.affected ?? 0;
    if (total) {
      this.logger.log(`${total} autorização(ões) de dispositivo expirada(s).`);
    }
    return total;
  }
}
