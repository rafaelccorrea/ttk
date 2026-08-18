import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { HiggsfieldCliService } from './higgsfield-cli.service';

/**
 * Piso de créditos do plano abaixo do qual já vale avisar.
 *
 * 200 créditos são ~100 retratos ou ~26 vídeos: pouco para o mês, e muito para
 * o tempo que se leva para recarregar. O alerta precisa chegar enquanto ainda
 * dá para agir sem pressa — um aviso disparado no zero não é aviso, é aviso de
 * incêndio.
 */
const PISO_DE_CREDITOS = 200;

/**
 * Vigia a credencial da CLI e o saldo do plano, para nada parar de surpresa.
 *
 * Este arquivo existe por causa de uma limitação que não dá para consertar: a
 * CLI autentica com OAuth de USUÁRIO, e um token de usuário pode cair — por
 * revogação, troca de senha ou expiração do refresh. Não existe promessa de
 * disponibilidade que se possa fazer sobre isso, e prometer seria mentira.
 *
 * O que dá para garantir é a ORDEM em que as pessoas descobrem. Sem sentinela,
 * quem descobre primeiro é o vendedor, no meio de uma campanha, e o segundo é o
 * suporte. Com ela, quem descobre primeiro é quem tem o navegador para rodar
 * `higgsfield auth login` — e o vendedor talvez nem chegue a perceber.
 *
 * A sonda é `account status`: só lê saldo, não gera nada e não gasta crédito.
 * Perguntar "consigo gerar?" custaria uma geração por checagem, o que tornaria
 * a própria vigilância uma despesa.
 */
@Injectable()
export class HiggsfieldSentinelaService {
  private readonly logger = new Logger(HiggsfieldSentinelaService.name);

  /**
   * O último estado conhecido, para o log falar de MUDANÇA e não de estado.
   *
   * Sem isso, uma autenticação caída viraria uma linha de erro a cada dez
   * minutos — 144 por dia, idênticas. Log que se repete assim é log que se
   * aprende a ignorar, e o dia em que ele importar vai passar batido junto com
   * os outros. Só a transição é notícia.
   */
  private ultimoOk: boolean | null = null;
  private ultimoAvisoDeSaldo = false;

  constructor(
    private readonly cli: HiggsfieldCliService,
    private readonly config: ConfigService,
  ) {}

  /**
   * A cada minuto, e configurável por ambiente.
   *
   * O access token vale 24h, então o intervalo não é sobre pegar a expiração em
   * cima da hora — é sobre o tempo entre a queda e você saber dela. Começou em
   * dez minutos por economia, e dez minutos são uma eternidade quando se está
   * caçando um problema: cada hipótese esperava o próximo tique para responder.
   *
   * Um minuto pesa quase nada porque a sonda é `account status`, que só lê
   * saldo: sem geração, sem crédito. E o log continua enxuto porque só a
   * MUDANÇA de estado vira linha — cem tiques seguidos com tudo bem não
   * imprimem nada.
   *
   * `HIGGSFIELD_SENTINELA_CRON` permite afrouxar depois que a poeira baixar,
   * sem passar por um deploy para mexer num número.
   */
  @Cron(process.env.HIGGSFIELD_SENTINELA_CRON ?? '*/1 * * * *')
  async vigiar(): Promise<void> {
    // Sem CLI ativa não há o que vigiar: com HIGGSFIELD_DRIVER=api quem gera é
    // a chave de servidor, que não expira e não tem sessão para cair.
    const driver = (this.config.get<string>('HIGGSFIELD_DRIVER') ?? 'cli').toLowerCase();
    if (driver === 'api' || !this.cli.isConfigured) return;

    const resultado = await this.cli.verificarAutenticacao();

    if (resultado.ok !== this.ultimoOk) {
      if (resultado.ok) {
        this.logger.log(
          `Higgsfield OK — ${resultado.creditos ?? '?'} créditos no plano.` +
            (this.ultimoOk === false ? ' Autenticação restabelecida.' : ''),
        );
      } else {
        /*
         * Nível de erro e instrução no texto: quem lê esta linha às 3h da manhã
         * precisa saber o que fazer sem abrir o código. É a única falha do
         * sistema cuja correção é um comando manual num navegador.
         */
        /*
         * Antes de culpar a autenticação, separa as duas causas possíveis.
         *
         * "A CLI falhou" não diz se o servidor não alcança a Higgsfield ou se
         * é o binário que não consegue falar. As correções são opostas — uma é
         * trocar de hospedagem, a outra é ajustar o processo —, e sem esta
         * linha o log manda rodar `auth login`, que não conserta nem uma nem
         * outra. Errar esse diagnóstico já custou caro aqui.
         */
        await this.cli.diagnosticar();
        const rede = await this.cli.verificarRede();
        this.logger.error(
          rede.ok
            ? `DIAGNÓSTICO: o servidor ALCANÇA a Higgsfield por HTTP (${rede.status}). ` +
              'A rede está boa — a falha é do binário da CLI.'
            : `DIAGNÓSTICO: o servidor NÃO alcança a Higgsfield por HTTP ` +
              `(${rede.status ?? rede.detalhe}). A barreira é de rede.`,
        );
        this.logger.error(
          'ALERTA: a autenticação da Higgsfield caiu — a geração de mídia está ' +
            'fora do ar. Rode `higgsfield auth login` e reponha o arquivo em ' +
            `HIGGSFIELD_CREDENTIALS_PATH. Detalhe: ${resultado.erro ?? 'sem detalhe'}`,
        );
      }
      this.ultimoOk = resultado.ok;
    }

    if (!resultado.ok) return;

    /*
     * O saldo tem histerese de propósito.
     *
     * Um alerta que dispara toda vez que o saldo está abaixo do piso repetiria
     * o aviso a cada dez minutos até a recarga. Avisar na DESCIDA e rearmar só
     * quando o saldo volta com folga (10% acima) é o que faz o aviso ser lido.
     */
    const creditos = resultado.creditos ?? Infinity;
    if (creditos < PISO_DE_CREDITOS && !this.ultimoAvisoDeSaldo) {
      this.logger.warn(
        `ALERTA: restam ${creditos} créditos no plano da Higgsfield (piso: ` +
          `${PISO_DE_CREDITOS}). Renove ou aumente o plano antes que a geração pare.`,
      );
      this.ultimoAvisoDeSaldo = true;
    } else if (creditos > PISO_DE_CREDITOS * 1.1) {
      this.ultimoAvisoDeSaldo = false;
    }
  }
}
