/**
 * Vocabulário fechado da persona — quem aparece no vídeo.
 *
 * Duas razões para NÃO ser um campo de texto livre:
 *
 *  1. Consistência. O mesmo prompt escrito à mão gera pessoas *parecidas*, não
 *     a mesma pessoa. Aqui cada atributo tem um fragmento fixo, e o prompt de
 *     todas as cenas nasce da mesma string, palavra por palavra — só a ação
 *     muda. Sem isso, a apresentadora troca de rosto no meio do anúncio.
 *
 *  2. Contenção. Não existe onde digitar "com o rosto de [pessoa real]".
 *     É a defesa mais barata contra uso indevido de imagem, e ela é
 *     estrutural: não é um filtro que alguém contorna reescrevendo a frase.
 *
 * O fragmento é montado no servidor a partir dos ids escolhidos. O cliente
 * nunca envia texto de descrição de pessoa — só ids desta tabela.
 */

export interface AttributeOption {
  id: string;
  /** Como aparece na tela para o vendedor. */
  label: string;
  /** O que entra no prompt (inglês: os modelos respondem melhor). */
  fragment: string;
}

export interface AttributeGroup {
  key: PersonaAttributeKey;
  label: string;
  options: AttributeOption[];
}

export type PersonaAttributeKey =
  | 'genero'
  | 'idade'
  | 'tomDePele'
  | 'cabelo'
  | 'corpo'
  | 'figurino'
  | 'cenario'
  | 'energia';

export const PERSONA_GROUPS: AttributeGroup[] = [
  {
    key: 'genero',
    label: 'Gênero',
    options: [
      { id: 'mulher', label: 'Mulher', fragment: 'a woman' },
      { id: 'homem', label: 'Homem', fragment: 'a man' },
      { id: 'androgino', label: 'Andrógino', fragment: 'an androgynous person' },
    ],
  },
  {
    key: 'idade',
    label: 'Faixa etária',
    options: [
      { id: '18-24', label: '18 a 24 anos', fragment: 'in their early twenties' },
      { id: '25-34', label: '25 a 34 anos', fragment: 'in their late twenties' },
      { id: '35-49', label: '35 a 49 anos', fragment: 'in their forties' },
      { id: '50+', label: '50 anos ou mais', fragment: 'in their fifties' },
    ],
  },
  {
    key: 'tomDePele',
    label: 'Tom de pele',
    options: [
      { id: 'clara', label: 'Clara', fragment: 'light skin' },
      { id: 'morena-clara', label: 'Morena clara', fragment: 'light brown skin' },
      { id: 'morena', label: 'Morena', fragment: 'brown skin' },
      { id: 'negra', label: 'Negra', fragment: 'dark brown skin' },
    ],
  },
  {
    key: 'cabelo',
    label: 'Cabelo',
    options: [
      { id: 'loiro-longo', label: 'Loiro longo', fragment: 'long blonde hair' },
      { id: 'loiro-curto', label: 'Loiro curto', fragment: 'short blonde hair' },
      { id: 'castanho-longo', label: 'Castanho longo', fragment: 'long brown hair' },
      { id: 'castanho-curto', label: 'Castanho curto', fragment: 'short brown hair' },
      { id: 'preto-liso', label: 'Preto liso', fragment: 'straight black hair' },
      { id: 'cacheado', label: 'Cacheado', fragment: 'curly hair' },
      { id: 'crespo', label: 'Crespo', fragment: 'natural afro hair' },
      { id: 'ruivo', label: 'Ruivo', fragment: 'red hair' },
      { id: 'raspado', label: 'Raspado', fragment: 'buzz cut' },
    ],
  },
  {
    key: 'corpo',
    label: 'Corpo',
    options: [
      { id: 'magro', label: 'Magro', fragment: 'slim build' },
      { id: 'medio', label: 'Médio', fragment: 'average build' },
      { id: 'atletico', label: 'Atlético', fragment: 'athletic build' },
      { id: 'plus', label: 'Plus size', fragment: 'plus size build' },
    ],
  },
  {
    key: 'figurino',
    label: 'Figurino',
    options: [
      { id: 'casual', label: 'Casual do dia a dia', fragment: 'wearing a casual t-shirt and jeans' },
      { id: 'vestido-vermelho', label: 'Vestido vermelho', fragment: 'wearing an elegant red dress' },
      { id: 'social', label: 'Social / escritório', fragment: 'wearing a smart blazer' },
      { id: 'fitness', label: 'Fitness', fragment: 'wearing athletic workout clothes' },
      { id: 'praia', label: 'Praia / verão', fragment: 'wearing light summer beachwear' },
      { id: 'jaleco', label: 'Jaleco / profissional da saúde', fragment: 'wearing a white lab coat' },
      { id: 'chef', label: 'Avental de cozinha', fragment: 'wearing a kitchen apron' },
    ],
  },
  {
    key: 'cenario',
    label: 'Cenário',
    options: [
      { id: 'sala', label: 'Sala de casa', fragment: 'in a cozy living room' },
      { id: 'cozinha', label: 'Cozinha', fragment: 'in a bright modern kitchen' },
      { id: 'quarto', label: 'Quarto', fragment: 'in a tidy bedroom' },
      { id: 'banheiro', label: 'Banheiro / penteadeira', fragment: 'at a bathroom vanity' },
      { id: 'academia', label: 'Academia', fragment: 'in a gym' },
      { id: 'loja', label: 'Loja / comércio', fragment: 'in a small retail store' },
      { id: 'rua', label: 'Rua', fragment: 'on a city street' },
      { id: 'estudio', label: 'Fundo neutro de estúdio', fragment: 'against a clean neutral studio backdrop' },
    ],
  },
  {
    key: 'energia',
    label: 'Energia da apresentação',
    options: [
      { id: 'animada', label: 'Animada e acelerada', fragment: 'energetic and enthusiastic expression' },
      { id: 'amiga', label: 'Conversa de amiga', fragment: 'warm friendly expression' },
      { id: 'seria', label: 'Séria e técnica', fragment: 'confident serious expression' },
      { id: 'surpresa', label: 'Surpresa / reação', fragment: 'surprised delighted expression' },
    ],
  },
];

export type PersonaAttributes = Record<PersonaAttributeKey, string>;

/** Traço fixo que vale para toda persona, em qualquer cena. */
const BASE_STYLE =
  'photorealistic vertical UGC smartphone video still, natural lighting, ' +
  'shot on iPhone, amateur authentic look, Brazilian';

/**
 * Valida os ids escolhidos e devolve os atributos limpos.
 * Erra alto: id fora do catálogo é tentativa de injetar descrição livre.
 */
export function validarAtributos(entrada: Partial<PersonaAttributes>): PersonaAttributes {
  const saida = {} as PersonaAttributes;
  for (const grupo of PERSONA_GROUPS) {
    const escolhido = entrada[grupo.key];
    if (!escolhido) {
      throw new Error(`Escolha uma opção para "${grupo.label}".`);
    }
    if (!grupo.options.some((o) => o.id === escolhido)) {
      throw new Error(`Opção inválida em "${grupo.label}".`);
    }
    saida[grupo.key] = escolhido;
  }
  return saida;
}

/**
 * Monta o texto que descreve a pessoa. É a ÚNICA fonte de descrição física —
 * o roteiro e as cenas só acrescentam ação, nunca aparência.
 */
export function montarFragmento(attrs: PersonaAttributes): string {
  const pedaco = (key: PersonaAttributeKey): string => {
    const grupo = PERSONA_GROUPS.find((g) => g.key === key)!;
    return grupo.options.find((o) => o.id === attrs[key])!.fragment;
  };

  return [
    pedaco('genero'),
    pedaco('idade'),
    `with ${pedaco('cabelo')}`,
    pedaco('tomDePele'),
    pedaco('corpo'),
    pedaco('figurino'),
    pedaco('cenario'),
    pedaco('energia'),
    BASE_STYLE,
  ].join(', ');
}

/** Rótulo legível para a lista de personas ("Mulher, 25 a 34, loiro longo"). */
export function rotularPersona(attrs: PersonaAttributes): string {
  const rotulo = (key: PersonaAttributeKey): string => {
    const grupo = PERSONA_GROUPS.find((g) => g.key === key)!;
    return grupo.options.find((o) => o.id === attrs[key])!.label;
  };
  return [rotulo('genero'), rotulo('idade'), rotulo('cabelo'), rotulo('figurino')].join(' · ');
}
