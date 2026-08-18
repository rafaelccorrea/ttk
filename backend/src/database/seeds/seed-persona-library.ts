import 'dotenv/config';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
import { DataSource } from 'typeorm';
import { Persona } from '../../modules/campaigns/entities/persona.entity';
import { MediaMirrorService } from '../../modules/media/media-mirror.service';
import {
  montarFragmento,
  rotularPersona,
  validarAtributos,
  type PersonaAttributes,
} from '../../modules/campaigns/persona-catalog';

/**
 * Constrói a BIBLIOTECA de retratos-semente, em lote, pela CLI da Higgsfield.
 *
 * Por que pela CLI e não pela API que o `higgsfield.service.ts` usa: são duas
 * carteiras diferentes. A API de `platform.higgsfield.ai` cobra de um saldo
 * próprio, hoje zerado, e a CLI cobra dos créditos do PLANO — os que a conta já
 * tem. Enquanto não houver saldo de API, este é o único caminho que gera imagem
 * de verdade, e ele existe porque o retrato-semente é a única peça do produto
 * que se gera UMA vez e se reusa para sempre (ver `persona.entity.ts`).
 *
 * O que este script NÃO é: caminho de produção. A CLI autentica com OAuth de
 * usuário e guarda um token que expira; quem renova é o refresh token no
 * `credentials.json`, e se ele cair só um humano com navegador destrava. Isso é
 * aceitável numa ferramenta que você roda na sua máquina e olha o resultado —
 * seria inaceitável no caminho de um cliente esperando o vídeo dele.
 *
 * Uso:
 *   npm run seed:personas -- --dry     lista o que geraria, sem gastar crédito
 *   npm run seed:personas              gera de verdade
 *   npm run seed:personas -- --limite 5   gera só as 5 primeiras que faltam
 *
 * Antes da primeira execução: `higgsfield auth login` (abre o navegador).
 */

const execAsync = promisify(exec);

/**
 * Dono das personas da biblioteca.
 *
 * UUID fixo e sem usuário correspondente: a tabela `personas` não tem chave
 * estrangeira para `users` (ver a migração AddCampaigns), então o sentinela não
 * precisa existir em lugar nenhum — ele serve só para separar, numa consulta, o
 * que é acervo nosso do que é persona criada por um vendedor. Se algum dia a FK
 * entrar, este id vira uma linha de verdade em `users` e nada mais muda.
 */
export const PERSONA_LIBRARY_USER_ID = '00000000-0000-0000-0000-000000000001';

/**
 * O modelo de imagem, sobrescrevível por ambiente.
 *
 * O catálogo da CLI muda sozinho — modelo some, modelo novo entra — e um nome
 * cravado aqui vira erro "Unknown model" meses depois. `higgsfield model list`
 * mostra o catálogo do dia.
 */
const MODELO = process.env.HIGGSFIELD_CLI_MODEL ?? 'nano_banana_2';

/**
 * Os arquétipos do acervo.
 *
 * Não é amostragem do catálogo: 3 gêneros × 4 idades × 4 tons × 9 cabelos × 4
 * corpos × 7 figurinos × 8 cenários × 4 energias dão 387.072 combinações, e
 * gerar "algumas" ao acaso produziria um acervo com buracos onde há demanda e
 * sobra onde não há. A lista abaixo é o contrário: parte dos nichos que vendem
 * no TikTok Shop Brasil — os mesmos de `seed-creators.ts` — e escolhe, para
 * cada um, a apresentadora que aquele nicho de fato usa. Cozinha tem avental,
 * fitness tem academia, saúde tem jaleco.
 *
 * `nicho` não entra no prompt: serve para a galeria saber o que sugerir a quem
 * vende air fryer, e para esta lista ser lida como cobertura de mercado em vez
 * de lista de atributos.
 */
const CURADORIA: Array<{ nicho: string; attrs: PersonaAttributes }> = [
  // Beleza — o nicho de maior volume, por isso quatro variações de tom e idade.
  { nicho: 'beleza', attrs: a('mulher', '25-34', 'morena-clara', 'castanho-longo', 'medio', 'casual', 'banheiro', 'amiga') },
  { nicho: 'beleza', attrs: a('mulher', '18-24', 'negra', 'crespo', 'magro', 'casual', 'banheiro', 'animada') },
  { nicho: 'beleza', attrs: a('mulher', '35-49', 'clara', 'loiro-longo', 'medio', 'casual', 'banheiro', 'amiga') },
  { nicho: 'beleza', attrs: a('mulher', '25-34', 'morena', 'cacheado', 'plus', 'casual', 'quarto', 'animada') },

  // Moda feminina — o figurino é o produto, então varia mais que o cenário.
  { nicho: 'moda-feminina', attrs: a('mulher', '18-24', 'morena-clara', 'castanho-longo', 'magro', 'vestido-vermelho', 'quarto', 'animada') },
  { nicho: 'moda-feminina', attrs: a('mulher', '25-34', 'clara', 'loiro-curto', 'medio', 'casual', 'loja', 'amiga') },
  { nicho: 'moda-feminina', attrs: a('mulher', '25-34', 'negra', 'cacheado', 'plus', 'vestido-vermelho', 'estudio', 'animada') },
  { nicho: 'moda-feminina', attrs: a('mulher', '18-24', 'morena', 'preto-liso', 'magro', 'praia', 'rua', 'animada') },

  // Moda masculina.
  { nicho: 'moda-masculina', attrs: a('homem', '25-34', 'morena-clara', 'castanho-curto', 'atletico', 'casual', 'rua', 'animada') },
  { nicho: 'moda-masculina', attrs: a('homem', '18-24', 'negra', 'raspado', 'atletico', 'casual', 'loja', 'animada') },

  // Casa e cozinha — avental e cozinha, que é o par que o espectador espera.
  { nicho: 'casa-cozinha', attrs: a('mulher', '35-49', 'morena', 'castanho-curto', 'medio', 'chef', 'cozinha', 'amiga') },
  { nicho: 'casa-cozinha', attrs: a('mulher', '50+', 'clara', 'loiro-curto', 'medio', 'chef', 'cozinha', 'amiga') },
  { nicho: 'casa-cozinha', attrs: a('homem', '35-49', 'morena-clara', 'castanho-curto', 'medio', 'chef', 'cozinha', 'surpresa') },

  // Cama, mesa e banho.
  { nicho: 'cama-mesa', attrs: a('mulher', '25-34', 'clara', 'castanho-longo', 'medio', 'casual', 'quarto', 'amiga') },

  // Eletrônicos — energia técnica, fundo neutro: o produto é o assunto.
  { nicho: 'eletronicos', attrs: a('homem', '25-34', 'morena-clara', 'castanho-curto', 'medio', 'casual', 'estudio', 'seria') },
  { nicho: 'eletronicos', attrs: a('homem', '18-24', 'morena', 'preto-liso', 'magro', 'casual', 'sala', 'surpresa') },
  { nicho: 'eletronicos', attrs: a('mulher', '25-34', 'morena-clara', 'castanho-curto', 'magro', 'casual', 'estudio', 'seria') },

  // Fitness.
  { nicho: 'fitness', attrs: a('mulher', '25-34', 'morena', 'preto-liso', 'atletico', 'fitness', 'academia', 'animada') },
  { nicho: 'fitness', attrs: a('homem', '25-34', 'negra', 'raspado', 'atletico', 'fitness', 'academia', 'animada') },
  { nicho: 'fitness', attrs: a('mulher', '35-49', 'clara', 'loiro-longo', 'medio', 'fitness', 'academia', 'amiga') },

  // Ferramentas — público mais velho, tom técnico.
  { nicho: 'ferramentas', attrs: a('homem', '35-49', 'morena', 'castanho-curto', 'medio', 'casual', 'sala', 'seria') },
  { nicho: 'ferramentas', attrs: a('homem', '50+', 'clara', 'castanho-curto', 'medio', 'casual', 'loja', 'seria') },

  // Infantil — quem compra é mãe/pai, não a criança; a persona é o adulto.
  { nicho: 'infantil', attrs: a('mulher', '25-34', 'morena-clara', 'castanho-longo', 'medio', 'casual', 'sala', 'amiga') },

  // Saúde — jaleco, porque é o que dá autoridade percebida na vertical.
  { nicho: 'saude', attrs: a('mulher', '35-49', 'clara', 'castanho-curto', 'medio', 'jaleco', 'estudio', 'seria') },
  { nicho: 'saude', attrs: a('homem', '35-49', 'morena-clara', 'castanho-curto', 'medio', 'jaleco', 'estudio', 'seria') },
];

/** Encurtador posicional: a lista acima só é legível se couber numa linha. */
function a(
  genero: string,
  idade: string,
  tomDePele: string,
  cabelo: string,
  corpo: string,
  figurino: string,
  cenario: string,
  energia: string,
): PersonaAttributes {
  // Passa pelo validador do catálogo de propósito: um id trocado numa linha
  // dessas seria descoberto só depois de gastar o crédito da geração.
  return validarAtributos({
    genero,
    idade,
    tomDePele,
    cabelo,
    corpo,
    figurino,
    cenario,
    energia,
  } as Partial<PersonaAttributes>);
}

/**
 * Pede um retrato à CLI e devolve a URL do resultado.
 *
 * `--wait` faz a própria CLI bloquear até o job terminar, o que dispensa
 * reimplementar aqui o polling que o `higgsfield.service.ts` faz — e dispensa
 * junto o bug de rota de status que aquele arquivo pode ter.
 *
 * A extração da URL varre o JSON em vez de ler um campo fixo: o formato de
 * saída da CLI não é contrato estável, e um acervo que falha inteiro porque
 * `result_url` virou `resultUrl` numa atualização não vale o campo cravado.
 */
async function gerarRetrato(prompt: string): Promise<string | null> {
  /*
   * A chamada passa pelo shell e por isso o prompt PRECISA vir citado.
   *
   * No Windows o executável é um `.cmd`, e o Node se recusa a lançar `.cmd`
   * sem shell desde a correção de injeção de argumento — então shell não é
   * escolha, é requisito. Só que com shell os argumentos são concatenados sem
   * citação nenhuma: o fragmento da persona é uma frase com vírgulas e espaços,
   * e chegava do outro lado como dezenas de argumentos posicionais
   * ("Too many positional args"). Citar aqui é o que mantém a frase inteira.
   */
  const citar = (valor: string): string =>
    process.platform === 'win32'
      ? `"${valor.replace(/"/g, '""')}"`
      : `'${valor.replace(/'/g, `'\\''`)}'`;

  const comando = [
    'higgsfield',
    'generate',
    'create',
    MODELO,
    '--prompt',
    citar(prompt),
    // 9:16 porque todo o produto é vídeo vertical de TikTok; um retrato
    // quadrado entraria cortado como frame base.
    '--aspect_ratio',
    '9:16',
    '--wait',
    '--json',
  ].join(' ');

  const { stdout } = await execAsync(comando, { maxBuffer: 16 * 1024 * 1024 });

  let dados: unknown;
  try {
    dados = JSON.parse(stdout);
  } catch {
    // Sem JSON válido, a última URL impressa ainda serve.
    const solta = stdout.match(/https?:\/\/\S+\.(?:png|jpe?g|webp)/gi);
    return solta?.[solta.length - 1] ?? null;
  }

  const urls: string[] = [];
  const varrer = (no: unknown): void => {
    if (typeof no === 'string') {
      if (/^https?:\/\//.test(no) && /\.(png|jpe?g|webp)(\?|$)/i.test(no)) urls.push(no);
      return;
    }
    if (Array.isArray(no)) return no.forEach(varrer);
    if (no && typeof no === 'object') Object.values(no).forEach(varrer);
  };
  varrer(dados);
  return urls[0] ?? null;
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  const ensaio = args.includes('--dry');
  const posLimite = args.indexOf('--limite');
  const limite = posLimite >= 0 ? Number(args[posLimite + 1]) : Infinity;

  const url = process.env.DATABASE_URL;
  const dataSource = new DataSource(
    url
      ? {
          type: 'postgres',
          url,
          ssl: { rejectUnauthorized: false },
          entities: [Persona],
          synchronize: false,
        }
      : {
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'pikpok',
          entities: [Persona],
          synchronize: false,
        },
  );
  await dataSource.initialize();
  const personas = dataSource.getRepository(Persona);

  const espelho = new MediaMirrorService({
    get: (chave: string) => process.env[chave],
  } as never);

  /*
   * O que JÁ existe define o que falta, e a chave é o fragmento de prompt, não
   * o rótulo: o rótulo só usa quatro dos oito atributos (ver `rotularPersona`),
   * então duas personas diferentes podem se chamar igual. O fragmento é a
   * descrição completa e é o que de fato gera a imagem.
   *
   * Isso é o que torna o script reexecutável: interromper no meio, corrigir uma
   * linha da curadoria e rodar de novo só gasta crédito com o que falta.
   */
  const existentes = await personas.find({
    where: { userId: PERSONA_LIBRARY_USER_ID },
    select: ['promptFragment'],
  });
  const jaTem = new Set(existentes.map((p) => p.promptFragment));

  const pendentes = CURADORIA.filter((item) => !jaTem.has(montarFragmento(item.attrs)));
  console.log(
    `Acervo: ${CURADORIA.length} arquétipos, ${jaTem.size} prontos, ${pendentes.length} a gerar.`,
  );

  const alvo = pendentes.slice(0, limite);
  if (ensaio) {
    console.log('\n--dry: nada será gerado e nenhum crédito será gasto.\n');
    alvo.forEach((item, i) => {
      console.log(`${String(i + 1).padStart(2)}. [${item.nicho}] ${rotularPersona(item.attrs)}`);
      console.log(`    ${montarFragmento(item.attrs)}\n`);
    });
    await dataSource.destroy();
    return;
  }

  let ok = 0;
  for (const [i, item] of alvo.entries()) {
    const fragmento = montarFragmento(item.attrs);
    const rotulo = rotularPersona(item.attrs);
    console.log(`\n[${i + 1}/${alvo.length}] ${item.nicho} — ${rotulo}`);

    try {
      const origem = await gerarRetrato(fragmento);
      if (!origem) {
        console.warn('  sem URL na resposta da CLI; pulando.');
        continue;
      }

      /*
       * O espelhamento não é otimização: a URL que a fornecedora devolve
       * EXPIRA, e uma persona que perde o retrato perde a consistência de
       * rosto de todas as campanhas futuras (é o que o comentário da entidade
       * chama de perder a consistência). Gravar a URL de origem no banco seria
       * gravar uma bomba-relógio.
       */
      const resposta = await fetch(origem);
      if (!resposta.ok) {
        console.warn(`  download falhou (${resposta.status}); pulando.`);
        continue;
      }
      const bytes = Buffer.from(await resposta.arrayBuffer());

      const persona = await personas.save(
        personas.create({
          userId: PERSONA_LIBRARY_USER_ID,
          label: rotulo,
          attrs: item.attrs,
          promptFragment: fragmento,
          status: 'gerando',
        }),
      );

      // 'contain' e não 'cover': recortar retrato corta cabeça e queixo, que é
      // exatamente o que o frame base não pode perder.
      const definitiva = await espelho.putImage(bytes, 'personas', persona.id, 'contain');
      if (!definitiva) {
        console.warn('  espelhamento no S3 falhou; persona fica como "falhou".');
        await personas.update(persona.id, { status: 'falhou' });
        continue;
      }

      await personas.update(persona.id, { seedImageUrl: definitiva, status: 'pronta' });
      console.log(`  pronta: ${definitiva}`);
      ok += 1;
    } catch (erro) {
      // Uma falha não derruba o lote: o crédito das anteriores já foi gasto e
      // perder o acervo inteiro por causa da última linha seria o pior desfecho.
      console.error(`  falhou: ${erro instanceof Error ? erro.message : erro}`);
    }
  }

  console.log(`\n${ok} de ${alvo.length} retratos gerados.`);
  await dataSource.destroy();
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
