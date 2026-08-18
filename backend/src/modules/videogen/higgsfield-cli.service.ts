import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type {
  GeradorDeMidia,
  StatusResult,
  SubmitResult,
} from './gerador-de-midia';

const execAsync = promisify(exec);

/**
 * Gera mídia pela CLI da Higgsfield, gastando os créditos do PLANO.
 *
 * A alternativa a este arquivo é o `higgsfield.service.ts`, que fala com a API
 * de `platform.higgsfield.ai`. Os dois geram a mesma imagem pelos mesmos
 * modelos; o que muda é de qual bolso sai. A API tem carteira própria e, quando
 * ela zera, responde `not_enough_credits` mesmo com o plano pago e cheio — foi
 * exatamente o que aconteceu e o que deixou a Fábrica de Criativos parada.
 *
 * O preço de usar o plano é a autenticação: a CLI usa OAuth de USUÁRIO, com um
 * access token de 24h renovado por um refresh token. Não é credencial de
 * serviço e pode cair — por revogação, troca de senha ou expiração do refresh.
 * A resposta a isso não é fingir que não acontece; é `verificarAutenticacao()`,
 * que a sentinela chama de fora para avisar ANTES do cliente descobrir.
 */
@Injectable()
export class HiggsfieldCliService implements GeradorDeMidia {
  private readonly logger = new Logger(HiggsfieldCliService.name);
  private readonly binario: string;
  private readonly credenciais: string | null;
  private readonly modeloImagem: string;
  private readonly modeloVideo: string;

  constructor(private readonly config: ConfigService) {
    this.binario = this.config.get<string>('HIGGSFIELD_CLI_BIN') ?? 'higgsfield';
    this.credenciais = this.config.get<string>('HIGGSFIELD_CREDENTIALS_PATH') ?? null;
    /*
     * Modelos por ambiente, com padrão conservador.
     *
     * `kling3_0_turbo` custa 7,5 créditos do plano contra 22,5 do Seedance 2.0,
     * e é a variante rápida — o que importa quando há um vendedor olhando a
     * tela esperando. O catálogo da CLI muda sozinho (`higgsfield model list`),
     * então nome cravado em código vira "Unknown model" meses depois.
     */
    this.modeloImagem =
      this.config.get<string>('HIGGSFIELD_CLI_IMAGE_MODEL') ?? 'nano_banana_2';
    this.modeloVideo =
      this.config.get<string>('HIGGSFIELD_CLI_VIDEO_MODEL') ?? 'kling3_0_turbo';
  }

  /**
   * Sem arquivo de credencial não há o que tentar.
   *
   * A checagem é pela EXISTÊNCIA do arquivo, não pela validade do token: o
   * token vence a cada 24h por natureza e a própria CLI o renova. Recusar aqui
   * por token vencido desligaria a feature em toda madrugada, sozinha.
   */
  get isConfigured(): boolean {
    return Boolean(this.credenciais && existsSync(this.credenciais));
  }

  /**
   * Executa a CLI e devolve o stdout.
   *
   * O shell é requisito, não escolha: no Windows o executável é um `.cmd`, que
   * o Node se recusa a lançar sem shell desde a correção de injeção de
   * argumento. E como o shell concatena os argumentos sem citar nada, citar
   * aqui é o que impede um prompt — que é uma frase com vírgulas e espaços — de
   * chegar do outro lado como dezenas de argumentos posicionais.
   */
  private async cli(args: string[]): Promise<string> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Geração de mídia indisponível: credencial da Higgsfield ausente.',
      );
    }
    const comando = [this.binario, ...args].join(' ');
    const { stdout } = await execAsync(comando, {
      maxBuffer: 16 * 1024 * 1024,
      env: {
        ...process.env,
        // É o que faz a CLI ler a credencial do servidor em vez do HOME do
        // usuário que por acaso está executando o processo do Node.
        ...(this.credenciais ? { HIGGSFIELD_CREDENTIALS_PATH: this.credenciais } : {}),
      },
    });
    return stdout;
  }

  /** Envolve um valor para o shell da plataforma. Ver o comentário de `cli`. */
  private citar(valor: string): string {
    return process.platform === 'win32'
      ? `"${valor.replace(/"/g, '""')}"`
      : `'${valor.replace(/'/g, `'\\''`)}'`;
  }

  /**
   * Submete um job e devolve o id.
   *
   * `generate create` sem `--wait` responde um ARRAY de ids e volta na hora. É
   * de propósito: com `--wait` a CLI bloquearia por 30 a 60 segundos, e a
   * requisição HTTP do vendedor ficaria pendurada esperando. O produto já tem
   * polling (`videogen.refresh`) — usar o modo assíncrono é o que mantém a
   * arquitetura que já existe em vez de furá-la.
   */
  private async submeter(args: string[]): Promise<SubmitResult> {
    const stdout = await this.cli([...args, '--json']);
    let dados: unknown;
    try {
      dados = JSON.parse(stdout);
    } catch {
      throw new ServiceUnavailableException(
        `Resposta ilegível da Higgsfield: ${stdout.slice(0, 200)}`,
      );
    }
    const id = Array.isArray(dados)
      ? dados.find((v): v is string => typeof v === 'string')
      : (dados as { id?: string })?.id;
    if (!id) {
      throw new ServiceUnavailableException('A Higgsfield não devolveu id de job.');
    }
    // 'queued' e não o status real porque a submissão não traz status nenhum;
    // o primeiro `getStatus` corrige. O vocabulário é o mesmo do `MediaStatus`.
    return { requestId: id, status: 'queued' };
  }

  async submitImage(prompt: string, aspectRatio: string): Promise<SubmitResult> {
    return this.submeter([
      'generate',
      'create',
      this.modeloImagem,
      '--prompt',
      this.citar(prompt),
      '--aspect_ratio',
      this.citar(aspectRatio),
    ]);
  }

  /**
   * Anima uma imagem pronta.
   *
   * `--start-image` aceita id de job ou caminho de arquivo local, e NÃO aceita
   * URL. Quando o frame veio da própria CLI, o id do job da imagem serve
   * direto e nada trafega. Quando veio de outro lugar — o espelho no S3, uma
   * foto do vendedor —, o jeito é baixar para um arquivo temporário e deixar a
   * CLI subir. O `finally` apaga: são arquivos de megabytes num diretório que
   * ninguém varre, e vazar isso enche o disco do servidor em semanas.
   */
  async submitVideo(imageUrl: string, prompt: string): Promise<SubmitResult> {
    const ehIdDeJob = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (ehIdDeJob.test(imageUrl)) {
      return this.submeter([
        'generate',
        'create',
        this.modeloVideo,
        '--prompt',
        this.citar(prompt),
        '--start-image',
        imageUrl,
      ]);
    }

    const pasta = await mkdtemp(join(tmpdir(), 'pikpok-hf-'));
    try {
      const resposta = await fetch(imageUrl);
      if (!resposta.ok) {
        throw new ServiceUnavailableException(
          `Não foi possível ler o frame base (${resposta.status}).`,
        );
      }
      const arquivo = join(pasta, `${randomUUID()}.png`);
      await writeFile(arquivo, Buffer.from(await resposta.arrayBuffer()));
      return await this.submeter([
        'generate',
        'create',
        this.modeloVideo,
        '--prompt',
        this.citar(prompt),
        '--start-image',
        this.citar(arquivo),
      ]);
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  async getStatus(requestId: string): Promise<StatusResult> {
    const stdout = await this.cli(['generate', 'get', requestId, '--json']);
    const job = JSON.parse(stdout) as {
      status?: string;
      result_url?: string | null;
      error?: unknown;
    };
    const url = job?.result_url ?? undefined;
    return {
      status: job?.status ?? 'in_progress',
      /*
       * A mesma URL nos dois campos, e isso não é desleixo.
       *
       * A CLI devolve um `result_url` só, sem dizer se aquilo é imagem ou
       * vídeo — e o `job_type` que ela reporta nem é a string que enviamos
       * (pedimos `nano_banana_2` e volta `nano_banana_pro`), então classificar
       * por ele seria adivinhar. Quem sabe o que pediu é o chamador: ele
       * guarda a fase no banco e lê `imageUrl` na fase 'image' e `videoUrl` na
       * fase 'video'. Preencher os dois deixa a decisão com quem tem a
       * informação.
       */
      imageUrl: url,
      videoUrl: url,
      error: job?.error ? String(job.error) : undefined,
    };
  }

  /**
   * Diz se a credencial ainda vale, sem gerar nada e sem gastar crédito.
   *
   * `account status` só lê saldo, e é justamente por isso que serve de sonda: a
   * pergunta que interessa não é "consigo gerar?" (que custaria créditos para
   * responder) e sim "a autenticação está de pé e sobrou saldo?".
   *
   * Devolver o saldo junto é o que permite alertar por DOIS motivos diferentes
   * com uma chamada só. Os dois derrubam a feature, e quem é avisado a tempo
   * resolve os dois antes do cliente esbarrar neles.
   */
  async verificarAutenticacao(): Promise<{ ok: boolean; creditos?: number; erro?: string }> {
    try {
      const stdout = await this.cli(['account', 'status', '--json']);
      const dados = JSON.parse(stdout) as { credits?: number };
      return { ok: true, creditos: dados?.credits };
    } catch (erro) {
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Autenticação da Higgsfield falhou: ${detalhe}`);
      return { ok: false, erro: detalhe };
    }
  }
}
