import { exec } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
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
import { promptTemFala } from './gerador-de-midia';
import type { OpcoesDeVideo } from './gerador-de-midia';
import { modeloDeVideo } from './modelos-de-video';

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
  private readonly modeloVideoComFala: string;
  /** undefined = ainda não perguntei; null = perguntei e não há. */
  private workspace: string | null | undefined;

  constructor(private readonly config: ConfigService) {
    this.binario =
      this.config.get<string>('HIGGSFIELD_CLI_BIN') ?? HiggsfieldCliService.acharBinario();
    this.credenciais =
      this.config.get<string>('HIGGSFIELD_CREDENTIALS_PATH') ??
      (this.config.get<string>('HIGGSFIELD_CREDENTIALS_JSON')
        ? join(tmpdir(), 'pikpok-higgsfield', 'credentials.json')
        : null);
    this.semear();
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
    /*
     * Cena com alguém FALANDO em quadro vai para outro modelo. O Kling 3.0 só
     * fala inglês, chinês, japonês, coreano e espanhol: a ordem "pt-BR" no
     * prompt era ignorada e a apresentadora saía falando INGLÊS (produção,
     * 2026-08-22). O Seedance 2.0 tem áudio nativo com lip-sync em português.
     * Cena muda (close de produto, mãos) continua no modelo barato/rápido.
     */
    this.modeloVideoComFala =
      this.config.get<string>('HIGGSFIELD_CLI_SPEECH_VIDEO_MODEL') ?? 'seedance_2_0';
  }

  /**
   * Argumentos do job de vídeo, escolhendo o modelo pela presença de fala no
   * prompt. O Seedance precisa dos parâmetros explícitos: sem `--generate_audio`
   * não há voz, e sem `--aspect_ratio` o default é 16:9 — o frame 9:16 viraria
   * barra preta dos dois lados.
   */
  private argsDeVideo(prompt: string, startImage: string, opcoes?: OpcoesDeVideo): string[] {
    const comFala = opcoes?.comFala ?? promptTemFala(prompt);
    const modelo = this.resolverModeloDeVideo(prompt, opcoes);
    const args = [
      'generate',
      'create',
      modelo,
      '--prompt',
      HiggsfieldCliService.citar(prompt),
      '--start-image',
      startImage,
    ];
    // Parâmetros por modelo vêm do catálogo; modelo fora dele (env apontando
    // para algo novo da CLI) vai sem extras, como sempre foi.
    args.push(...(modeloDeVideo(modelo)?.args(comFala) ?? []));
    return args;
  }

  /** Quem pediu escolhe; sem pedido, o padrão por haver fala ou não. */
  resolverModeloDeVideo(prompt: string, opcoes?: OpcoesDeVideo): string {
    if (opcoes?.modelo) return opcoes.modelo;
    const comFala = opcoes?.comFala ?? promptTemFala(prompt);
    return comFala ? this.modeloVideoComFala : this.modeloVideo;
  }

  /**
   * Escreve a credencial no disco a partir da variável de ambiente, se faltar.
   *
   * Hospedagem que recria o container a cada deploy leva junto qualquer arquivo
   * solto — e a credencial some sem aviso, no meio de um deploy comum, deixando
   * a geração desligada por um motivo que ninguém liga ao que acabou de ser
   * publicado. Guardar o conteúdo numa variável e reescrever o arquivo no boot é
   * o que faz a credencial sobreviver ao ciclo de vida da máquina.
   *
   * A escrita é condicional, e a condição é o ponto: só semeia quando o arquivo
   * NÃO existe. A CLI reescreve esse arquivo a cada renovação, e se o refresh
   * token rotacionar — o que é prática comum em OAuth —, sobrescrever a cada
   * boot restauraria um token velho por cima do válido e quebraria a
   * autenticação justamente em quem reinicia com frequência. Semear é para
   * máquina nova; máquina que já tem credencial fica com a dela.
   *
   * Preferir um caminho PERSISTENTE em `HIGGSFIELD_CREDENTIALS_PATH` continua
   * sendo melhor que semear, e por essa mesma razão: sem reescrita, não há
   * conflito possível com a rotação.
   */
  /**
   * Recupera o JSON da credencial de como o painel o entregou.
   *
   * O valor colado no painel da hospedagem não volta como foi escrito: veio
   * `\{   "auth_version": ...`, com barra invertida antes das chaves e espaços
   * no lugar das quebras de linha. `JSON.parse` recusa, o arquivo é gravado
   * corrompido, e — o que custou horas para enxergar — a CLI também não
   * consegue ler o token ali dentro. Ela então faz a requisição sem
   * autenticação válida e reporta "request failed (no response received)", que
   * parece problema de REDE e não é.
   *
   * Por isso a normalização tenta três formas, da mais provável para a mais
   * defensiva, e valida cada uma com um `parse` de verdade em vez de confiar na
   * aparência do texto:
   *   1. já é JSON válido — o caso de quem monta o arquivo à mão;
   *   2. está em base64 — a forma recomendada justamente por atravessar
   *      qualquer painel sem ser reescrita;
   *   3. veio escapado — desfaz as barras invertidas.
   *
   * Devolve null quando nenhuma serve, para o chamador gravar nada em vez de
   * gravar lixo: arquivo ausente produz uma falha honesta ("sem credencial"),
   * arquivo corrompido produz uma mentira.
   */
  private static normalizarCredencial(bruto: string): string | null {
    const tentativas = [
      bruto,
      (() => {
        try {
          return Buffer.from(bruto.trim(), 'base64').toString('utf8');
        } catch {
          return '';
        }
      })(),
      bruto.replace(/\\(.)/g, '$1'),
    ];
    for (const tentativa of tentativas) {
      try {
        const objeto = JSON.parse(tentativa) as { access_token?: string };
        // O parse sozinho não basta: base64 de lixo às vezes vira um número
        // válido. O que importa é ter o campo que a CLI vai usar.
        if (objeto?.access_token) return JSON.stringify(objeto);
      } catch {
        // Próxima forma.
      }
    }
    return null;
  }

  /** O arquivo existe E dá para ler o token dele? */
  private static credencialUtilizavel(caminho: string): boolean {
    try {
      const { access_token: token } = JSON.parse(readFileSync(caminho, 'utf8')) as {
        access_token?: string;
      };
      return Boolean(token);
    } catch {
      return false;
    }
  }

  private semear(): void {
    const bruto = this.config.get<string>('HIGGSFIELD_CREDENTIALS_JSON');
    if (!bruto || !this.credenciais) return;
    /*
     * "Não sobrescrever o que já existe" vira "não sobrescrever o que já
     * existe E PRESTA".
     *
     * A regra original protegia a rotação do token: a CLI reescreve o arquivo a
     * cada renovação, e restaurar a versão do ambiente por cima apagaria o
     * token novo. Só que ela também protegia um arquivo CORROMPIDO — foi
     * exatamente o que aconteceu quando o painel devolveu o JSON escapado: o
     * arquivo ruim foi gravado uma vez e nenhum boot seguinte o consertava,
     * porque ele "existia".
     */
    if (existsSync(this.credenciais)) {
      if (HiggsfieldCliService.credencialUtilizavel(this.credenciais)) return;
      this.logger.warn(
        'Credencial da Higgsfield no disco está ilegível; regravando a partir do ambiente.',
      );
    }
    const conteudo = HiggsfieldCliService.normalizarCredencial(bruto);
    if (!conteudo) {
      this.logger.error(
        'HIGGSFIELD_CREDENTIALS_JSON não contém um credentials.json legível ' +
          '(nem puro, nem base64, nem escapado). A geração fica desligada — ' +
          'gere o valor com: base64 -w0 ~/.config/higgsfield/credentials.json',
      );
      return;
    }
    try {
      mkdirSync(dirname(this.credenciais), { recursive: true });
      // 0600: o arquivo carrega um refresh token, e num servidor compartilhado
      // a permissão padrão o deixaria legível para qualquer processo.
      writeFileSync(this.credenciais, conteudo, { mode: 0o600 });
      this.logger.log(
        `Credencial da Higgsfield semeada em ${this.credenciais} a partir do ambiente.`,
      );
    } catch (erro) {
      this.logger.error(
        `Não foi possível semear a credencial da Higgsfield: ${
          erro instanceof Error ? erro.message : erro
        }`,
      );
    }
  }

  /**
   * Como invocar a CLI: o Node em execução rodando o JS de entrada.
   *
   * O atalho parece o caminho óbvio e não funciona em produção. A Hostinger
   * publica os arquivos sem o bit de execução, então `.bin/higgsfield` responde
   * `Permission denied` — o processo nem começa. Chamar o JS de entrada pelo
   * interpretador contorna isso inteiro: quem precisa ser executável passa a
   * ser o Node, que obviamente é.
   *
   * E o interpretador é `process.execPath`, não a palavra `node`. O shell que o
   * `exec` abre não herda o PATH que a hospedagem monta para a aplicação, e o
   * erro seguinte foi `/bin/sh: node: command not found` — com o processo Node
   * rodando, tentando chamar a si mesmo. O caminho absoluto de quem já está em
   * execução é a única referência que não depende de ambiente.
   *
   * `require.resolve` em vez de montar o caminho na mão porque o pacote pode
   * estar içado para um `node_modules` acima (workspaces) ou aninhado; quem
   * sabe onde ele foi parar é o resolvedor do próprio Node.
   *
   * O `higgsfield` solto no PATH continua como reserva: é o que existe na
   * máquina de quem roda o `seed:personas` no próprio computador.
   */
  private static acharBinario(): string {
    try {
      const pacote = require.resolve('@higgsfield/cli/package.json');
      const raiz = dirname(pacote);

      /*
       * O binário NATIVO primeiro, não o `bin/higgsfield.js`.
       *
       * Aquele arquivo não faz o trabalho: ele repassa os argumentos para
       * `vendor/hf` com `stdio: 'inherit'`, que manda a saída direto para a
       * saída do processo pai em vez de devolvê-la pelo cano que o `exec`
       * escuta. Neste servidor essa indireção engole tudo — a CLI terminava com
       * código ZERO, stdout vazio e stderr vazio, o que é o pior tipo de falha:
       * a que não deixa rastro. Chamando o executável direto, a saída volta
       * pelo caminho normal.
       *
       * O `liberarVendor` continua sendo o que torna isso possível, já que o
       * arquivo chega do deploy sem permissão de execução.
       */
      const nativo = join(raiz, 'vendor', process.platform === 'win32' ? 'hf.exe' : 'hf');
      if (existsSync(nativo)) {
        HiggsfieldCliService.liberarVendor(raiz);
        return HiggsfieldCliService.citar(nativo);
      }

      // Sem o nativo, o embrulho ainda é melhor que nada.
      const entrada = join(raiz, 'bin', 'higgsfield.js');
      if (existsSync(entrada)) {
        return [
          HiggsfieldCliService.citar(process.execPath),
          HiggsfieldCliService.citar(entrada),
        ].join(' ');
      }
    } catch {
      // Pacote ausente: cai no PATH, que é o caso da máquina de desenvolvimento.
    }
    return 'higgsfield';
  }

  /**
   * Devolve o bit de execução ao binário nativo que a CLI dispara.
   *
   * Rodar a entrada com `node` resolve o atalho, mas não o passo seguinte: o
   * `bin/higgsfield.js` só repassa os argumentos para `vendor/hf`, um
   * executável de verdade — que chega do deploy sem permissão pelo mesmo
   * motivo e falharia com o mesmo `Permission denied`, agora um nível mais
   * fundo e mais difícil de ler.
   *
   * Corrigir no boot em vez de exigir um `chmod` manual é o que mantém a
   * máquina reconstruível sem ninguém lembrar de um passo. Falhar aqui não é
   * fatal: registra e segue, porque no Windows a operação é inócua e num
   * sistema onde já esteja correta não há o que fazer.
   */
  private static liberarVendor(raizDoPacote: string): void {
    const hf = join(
      raizDoPacote,
      'vendor',
      process.platform === 'win32' ? 'hf.exe' : 'hf',
    );
    if (!existsSync(hf)) return;
    try {
      chmodSync(hf, 0o755);
    } catch {
      // Sem permissão para corrigir a permissão: a chamada vai falhar adiante
      // com uma mensagem clara, e não há o que fazer de melhor aqui.
    }
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
    return this.executar(args, await this.resolverWorkspace());
  }

  /**
   * Descobre em qual workspace cobrar, e guarda a resposta.
   *
   * A conta pode ter mais de um workspace e a CLI recusa qualquer comando sem
   * um escolhido — `No workspace selected`. Localmente isso se resolve uma vez
   * com `workspace set`, que grava num arquivo de configuração; no servidor,
   * esse arquivo não existe e a geração morria aí, depois de já ter passado
   * pela permissão e pelo interpretador.
   *
   * Descobrir sozinho em vez de exigir `HIGGSFIELD_WORKSPACE_ID` no painel é
   * deliberado: cada variável a mais é um passo que alguém esquece ao recriar o
   * ambiente, e a falha volta como "indisponível" sem explicar por quê. A
   * variável continua valendo para quem tem vários workspaces e precisa
   * escolher — mas quem tem um só não precisa saber que isso existe.
   *
   * O valor fica em memória porque não muda durante a vida do processo, e uma
   * consulta por geração seria uma chamada de rede a mais no caminho de quem
   * está esperando.
   */
  private async resolverWorkspace(): Promise<string | null> {
    const configurado = this.config.get<string>('HIGGSFIELD_WORKSPACE_ID');
    if (configurado) return configurado;
    // Só o SUCESSO entra em cache. Guardar o fracasso foi um erro que se pagou
    // caro: uma falha momentânea na primeira tentativa condenava o processo
    // inteiro a nunca mais ter workspace, e todas as gerações seguintes
    // morriam em "No workspace selected" sem sequer tentar de novo.
    if (this.workspace) return this.workspace;

    /*
     * A lista vem por HTTP, não pela CLI.
     *
     * A sonda provou que o servidor alcança `fnf-api-gw` e recebe 200 — é o
     * caminho que sabidamente funciona daqui. Perguntar pela CLI acrescentaria
     * a única peça que ainda não é confiável neste ambiente, e para uma
     * pergunta que o `fetch` responde melhor.
     */
    const porHttp = await this.workspacesPorHttp();
    if (porHttp) {
      this.workspace = porHttp;
      this.logger.log(`Workspace da Higgsfield resolvido por HTTP: ${porHttp}`);
      return porHttp;
    }

    try {
      const stdout = await this.executar(['workspace', 'list', '--json'], null);
      const lista = JSON.parse(stdout) as Array<{ id?: string; is_selected?: boolean }>;
      // O já selecionado ganha do primeiro: se alguém escolheu, a escolha vale.
      const escolhido = lista?.find((w) => w.is_selected) ?? lista?.[0];
      if (escolhido?.id) {
        this.workspace = escolhido.id;
        this.logger.log(`Workspace da Higgsfield resolvido pela CLI: ${this.workspace}`);
        return this.workspace;
      }
    } catch {
      // Sem lista, segue sem workspace: o comando seguinte falha com a
      // mensagem da própria CLI, que é mais informativa do que qualquer
      // suposição feita aqui.
    }
    return null;
  }

  /** A lista de workspaces pelo `fetch` do Node. Ver `verificarRede`. */
  private async workspacesPorHttp(): Promise<string | null> {
    const token = this.lerToken();
    if (!token) return null;
    try {
      const resposta = await fetch('https://fnf-api-gw.higgsfield.ai/fnf/workspaces', {
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'PikPok/1.0 (+https://pikpokviral.com.br)',
        },
      });
      if (!resposta.ok) return null;
      const lista = (await resposta.json()) as Array<{ id?: string }>;
      return lista?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }

  /** O access token do arquivo de credencial, ou null se não der para ler. */
  private lerToken(): string | null {
    if (!this.credenciais || !existsSync(this.credenciais)) return null;
    try {
      const { access_token: token } = JSON.parse(
        readFileSync(this.credenciais, 'utf8'),
      ) as { access_token?: string };
      return token ?? null;
    } catch {
      return null;
    }
  }

  /** A execução crua. Separada de `cli` para o resolvedor não chamar a si mesmo. */
  private async executar(args: string[], workspace: string | null): Promise<string> {
    if (!this.isConfigured) {
      throw new ServiceUnavailableException(
        'Geração de mídia indisponível: credencial da Higgsfield ausente.',
      );
    }
    // O caminho do binário também é citado: em servidor Windows ele mora sob
    // "Program Files", e um espaço não citado transformaria o executável em dois
    // argumentos.
    /*
     * A saída vai para ARQUIVO, não para o cano do `exec`.
     *
     * Este binário não entrega nada quando o destino do stdout é um pipe: sai
     * com código zero, stdout vazio, stderr vazio. Redirecionado para um
     * arquivo, o mesmo comando escreve normalmente — provado com `version`, que
     * devolveu string vazia pelo cano e 88 caracteres pelo arquivo, na mesma
     * máquina e no mesmo instante.
     *
     * Foi o sintoma mais caro desta integração justamente por não deixar
     * rastro: um processo que termina bem e não fala parece sucesso para
     * qualquer tratamento de erro.
     *
     * `stderr` vai para um arquivo SEPARADO de propósito: juntar os dois
     * contaminaria o JSON com qualquer aviso que a ferramenta resolvesse
     * imprimir, e o parse quebraria por um motivo que nada tem a ver com a
     * resposta.
     */
    const base = join(tmpdir(), `hf-${randomUUID()}`);
    const arquivoSaida = `${base}.out`;
    const arquivoErro = `${base}.err`;
    const comando =
      [this.binario, ...args].join(' ') +
      ` > ${HiggsfieldCliService.citar(arquivoSaida)}` +
      ` 2> ${HiggsfieldCliService.citar(arquivoErro)}`;

    const lerEApagar = (caminho: string): string => {
      try {
        if (!existsSync(caminho)) return '';
        const texto = readFileSync(caminho, 'utf8');
        unlinkSync(caminho);
        return texto;
      } catch {
        return '';
      }
    };

    try {
      await execAsync(comando, {
        maxBuffer: 16 * 1024 * 1024,
        env: {
          ...process.env,
          // É o que faz a CLI ler a credencial do servidor em vez do HOME do
          // usuário que por acaso está executando o processo do Node.
          ...(this.credenciais ? { HIGGSFIELD_CREDENTIALS_PATH: this.credenciais } : {}),
          // Substitui o arquivo de configuração que o servidor não tem.
          ...(workspace ? { HIGGSFIELD_WORKSPACE_ID: workspace } : {}),
        },
      });
      const saida = lerEApagar(arquivoSaida);
      const erroDaCli = lerEApagar(arquivoErro);
      /*
       * Saída vazia com código de saída ZERO continua sendo caso de log.
       *
       * Não deveria mais acontecer agora que a escrita é em arquivo, mas um
       * processo que termina bem e não fala é justamente o que não cai em
       * nenhum tratamento — e foi o que custou mais tempo aqui. A linha fica
       * como rede de segurança, não como expectativa.
       */
      if (!saida.trim()) {
        this.logger.error(
          `CLI terminou sem saída. stderr: ${(erroDaCli || '(vazio)').slice(0, 500)}`,
        );
      }
      return saida;
    } catch (erro) {
      const erroDaCli = lerEApagar(arquivoErro);
      lerEApagar(arquivoSaida);
      if (erroDaCli.trim()) {
        this.logger.error(`CLI reclamou: ${erroDaCli.slice(0, 500)}`);
      }
      /*
       * Traduzir a falha do processo é o que separa um 500 de um 503.
       *
       * Sem isto, o erro do `exec` sobe cru: o Nest o trata como erro interno,
       * o cliente vê "Internal server error" e o texto do comando inteiro —
       * caminhos do servidor inclusive — vai parar no log de exceção como se
       * fosse um bug nosso. Aconteceu de verdade, com o binário sem permissão
       * de execução.
       *
       * O que é verdade para quem pediu a geração é sempre a mesma coisa: o
       * fornecedor não atendeu, e ninguém foi cobrado — `withCharge` estorna
       * quando esta exceção sobe. O detalhe técnico fica no log, que é de quem
       * conserta.
       */
      const detalhe = erro instanceof Error ? erro.message : String(erro);
      this.logger.error(`Falha ao executar a CLI da Higgsfield: ${detalhe}`);
      throw new ServiceUnavailableException(
        'A geração de mídia está temporariamente indisponível. Seus créditos ' +
          'não foram cobrados — tente de novo em alguns minutos.',
      );
    }
  }

  /** Envolve um valor para o shell da plataforma. Ver o comentário de `cli`. */
  private static citar(valor: string): string {
    // Windows: o `hf.exe` é Go e parseia a linha de comando à moda do
    // CommandLineToArgv — aspa interna é `\"`, NÃO `""` (o dobrar do cmd).
    // Com `""` um prompt contendo "PikPok Sistema" virava vários argumentos
    // posicionais ("Too many positional args") e nada gerava no Windows.
    return process.platform === 'win32'
      ? `"${valor.replace(/(\\*)"/g, '$1$1\\"')}"`
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
    /*
     * `?? ''` porque a saída pode vir vazia, e não deveria explodir aqui.
     *
     * Vinha `undefined`, e o `.slice` do relato de erro estourava com
     * "Cannot read properties of undefined" — um TypeError, que o Nest traduz
     * para 500. Ou seja: o tratamento de erro virou a causa de um erro pior que
     * o original, e escondeu o de verdade. Quem falha aqui é a Higgsfield, e
     * isso é 503; TypeError nosso no meio do caminho só atrapalha quem lê o log.
     */
    const saida = (await this.cli([...args, '--json'])) ?? '';
    let dados: unknown;
    try {
      dados = JSON.parse(saida);
    } catch {
      // O texto cru vai para o log, não para o cliente: se a CLI imprimiu algo
      // inesperado, é isso que diz o que houve — e adivinhar já custou caro.
      this.logger.error(
        `Saída não-JSON da CLI (${saida.length} chars): ${saida.slice(0, 500) || '(vazia)'}`,
      );
      throw new ServiceUnavailableException(
        'A geração de mídia está temporariamente indisponível. Seus créditos ' +
          'não foram cobrados — tente de novo em alguns minutos.',
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

  async submitImage(
    prompt: string,
    aspectRatio: string,
    referencias?: Buffer[],
  ): Promise<SubmitResult> {
    const args = [
      'generate',
      'create',
      this.modeloImagem,
      '--prompt',
      HiggsfieldCliService.citar(prompt),
      '--aspect_ratio',
      HiggsfieldCliService.citar(aspectRatio),
    ];
    if (!referencias?.length) return this.submeter(args);

    // Cada referência vira um arquivo tmp e um --image-references; a CLI
    // sobe sozinha. O nano banana aceita até 14 — aqui vão 2 ou 3.
    const pasta = await mkdtemp(join(tmpdir(), 'pikpok-hf-ref-'));
    try {
      for (const ref of referencias) {
        const arquivo = join(pasta, `${randomUUID()}.png`);
        await writeFile(arquivo, ref);
        args.push('--image-references', HiggsfieldCliService.citar(arquivo));
      }
      return await this.submeter(args);
    } finally {
      await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
    }
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
  async submitVideo(
    imageUrl: string,
    prompt: string,
    imagem?: Buffer,
    opcoes?: OpcoesDeVideo,
  ): Promise<SubmitResult> {
    const ehIdDeJob = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

    // Frame já em mãos: grava no tmp e entrega o caminho — sem rede no meio.
    if (imagem?.length) {
      const pasta = await mkdtemp(join(tmpdir(), 'pikpok-hf-'));
      try {
        const arquivo = join(pasta, `${randomUUID()}.png`);
        await writeFile(arquivo, imagem);
        return await this.submeter(this.argsDeVideo(prompt, HiggsfieldCliService.citar(arquivo), opcoes));
      } finally {
        await rm(pasta, { recursive: true, force: true }).catch(() => undefined);
      }
    }

    if (ehIdDeJob.test(imageUrl)) {
      return this.submeter(this.argsDeVideo(prompt, imageUrl, opcoes));
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
      return await this.submeter(this.argsDeVideo(prompt, HiggsfieldCliService.citar(arquivo), opcoes));
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
   * A mesma consulta da CLI, feita pelo `fetch` do Node.
   *
   * Existe para separar duas causas que produzem a MESMA tela para o cliente e
   * exigem correções opostas. Quando a CLI falha com "request failed (no
   * response received)", isso pode ser a rede do servidor não alcançar a
   * Higgsfield — e aí não há o que fazer no código — ou pode ser só o binário
   * Go não encontrar os certificados raiz do sistema, coisa que o Node não
   * sofre porque carrega os dele embutidos.
   *
   * Se esta sonda responder e a CLI não, a rede está boa e o problema é do
   * binário. Se as duas falharem, o servidor realmente não fala com eles. Um
   * teste que distingue as duas coisas vale mais que qualquer suposição — e a
   * suposição custou caro aqui.
   */
  async verificarRede(): Promise<{ ok: boolean; status?: number; detalhe?: string }> {
    const token = this.lerToken();
    if (!token) return { ok: false, detalhe: 'sem credencial legível' };
    try {
      const resposta = await fetch('https://fnf-api-gw.higgsfield.ai/fnf/workspaces', {
        headers: {
          Authorization: `Bearer ${token}`,
          // Identificação honesta: é o PikPok chamando, e a API responde a
          // clientes identificados. Requisição sem agente nenhum é tratada
          // como tráfego anônimo e recusada.
          'User-Agent': 'PikPok/1.0 (+https://pikpokviral.com.br)',
        },
      });
      return { ok: resposta.ok, status: resposta.status };
    } catch (erro) {
      return { ok: false, detalhe: erro instanceof Error ? erro.message : String(erro) };
    }
  }

  /**
   * Fotografa o estado da instalação da CLI, de uma vez só.
   *
   * Cada hipótese testada com um deploy separado custou minutos e ainda assim
   * respondeu uma pergunta por vez — enquanto o sintoma ("saída vazia, código
   * zero") admite várias causas ao mesmo tempo: binário ausente, arquitetura
   * errada, permissão, ou um executável que simplesmente não fala. Este método
   * derruba todas as perguntas juntas, e o que ele imprime é o que decide o
   * próximo passo sem mais adivinhação.
   */
  async diagnosticar(): Promise<void> {
    const linhas: string[] = [`binário em uso: ${this.binario}`];
    try {
      const raiz = dirname(require.resolve('@higgsfield/cli/package.json'));
      linhas.push(`pacote: ${raiz}`);
      for (const rel of ['vendor/hf', 'vendor/hf.exe', 'vendor/install.json', 'bin/higgsfield.js']) {
        const caminho = join(raiz, rel);
        if (!existsSync(caminho)) {
          linhas.push(`  ${rel}: AUSENTE`);
          continue;
        }
        const s = statSync(caminho);
        linhas.push(`  ${rel}: ${s.size} bytes, modo ${(s.mode & 0o777).toString(8)}`);
      }
      const meta = join(raiz, 'vendor', 'install.json');
      if (existsSync(meta)) {
        linhas.push(`  install.json: ${readFileSync(meta, 'utf8').slice(0, 200)}`);
      }
    } catch (erro) {
      linhas.push(`  não foi possível inspecionar o pacote: ${String(erro)}`);
    }

    // `version` é a pergunta mais barata que existe: não usa rede, não usa
    // credencial e não gasta crédito. Se nem ela responde, o problema é o
    // executável, e não nada do que vem depois dele.
    try {
      const { stdout, stderr } = await execAsync(`${this.binario} version`, {
        maxBuffer: 1024 * 1024,
      });
      linhas.push(`  version -> stdout: ${JSON.stringify((stdout ?? '').slice(0, 200))}`);
      linhas.push(`  version -> stderr: ${JSON.stringify((stderr ?? '').slice(0, 200))}`);
    } catch (erro) {
      const e = erro as { message?: string; code?: number; stdout?: string; stderr?: string };
      linhas.push(
        `  version -> FALHOU code=${e?.code} msg=${e?.message?.slice(0, 200)} ` +
          `stderr=${JSON.stringify((e?.stderr ?? '').slice(0, 200))}`,
      );
    }

    /*
     * O mesmo comando, agora escrevendo num ARQUIVO em vez do cano do `exec`.
     *
     * Separa as duas explicações que sobraram para "saída vazia com código
     * zero", e elas pedem decisões opostas: se o arquivo tiver conteúdo, o
     * binário fala e quem perde a saída é o encanamento entre os processos —
     * conserto nosso. Se o arquivo vier vazio também, o executável realmente
     * não produz nada nesta máquina, e aí nenhuma mudança de código resolve.
     *
     * O `echo` do código de saída vai junto porque um processo morto por limite
     * do servidor e um processo que terminou bem em silêncio se parecem iguais
     * daqui — e não são a mesma conversa.
     */
    const saidaEmArquivo = join(tmpdir(), `hf-diag-${randomUUID()}.txt`);
    try {
      const { stdout } = await execAsync(
        `${this.binario} version > ${saidaEmArquivo} 2>&1; echo "codigo=$?"`,
        { maxBuffer: 1024 * 1024 },
      );
      const conteudo = existsSync(saidaEmArquivo)
        ? readFileSync(saidaEmArquivo, 'utf8')
        : '(arquivo não criado)';
      linhas.push(`  version em arquivo -> ${(stdout ?? '').trim()}`);
      linhas.push(
        `  version em arquivo -> conteúdo (${conteudo.length} chars): ` +
          `${JSON.stringify(conteudo.slice(0, 300))}`,
      );
    } catch (erro) {
      linhas.push(`  version em arquivo -> FALHOU: ${String(erro).slice(0, 200)}`);
    } finally {
      try {
        if (existsSync(saidaEmArquivo)) unlinkSync(saidaEmArquivo);
      } catch {
        // Arquivo de diagnóstico órfão em /tmp não justifica derrubar nada.
      }
    }

    this.logger.error(`DIAGNÓSTICO DA CLI:\n${linhas.join('\n')}`);
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
