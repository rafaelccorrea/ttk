import { api } from './api';

export interface AttributeOption {
  id: string;
  label: string;
}

export interface AttributeGroup {
  key: string;
  label: string;
  options: AttributeOption[];
}

export interface UserProduct {
  id: string;
  name: string;
  priceBrl: number | null;
  benefit: string | null;
  problemSolved: string | null;
  images: string[];
  sourceProductId: string | null;
  createdAt: string;
}

export interface Persona {
  id: string;
  label: string;
  attrs: Record<string, string>;
  status: 'gerando' | 'pronta' | 'falhou';
  seedImageUrl: string | null;
  createdAt: string;
}

/**
 * Formato da cena — o mesmo enum do backend. As três últimas animam a foto
 * real do produto (sem pessoa em quadro); as duas primeiras partem do retrato
 * da persona.
 */
export type SceneKind =
  | 'apresentador'
  | 'apresentador_produto'
  | 'mao_produto'
  | 'unboxing'
  | 'produto_close';

/** Cenas em que ninguém aparece em quadro — partem da foto do produto. */
export function cenaSemPessoa(tipo: SceneKind): boolean {
  return tipo === 'mao_produto' || tipo === 'unboxing' || tipo === 'produto_close';
}

/** Como a fala vira áudio: lip-sync do modelo, TTS em off, ou nada. */
export type SceneAudioMode = 'fala' | 'narracao' | 'sem_fala';

export interface CampaignScene {
  id: string;
  ordem: number;
  tipo: SceneKind;
  modoAudio: SceneAudioMode;
  /**
   * LEGADO: substituído por `tipo = 'apresentador_produto'`; ainda vem `true`
   * em cenas antigas (a tela cai numa regex de fallback para elas).
   */
  seguraProduto: boolean;
  baseImageUrl: string | null;
  fala: string;
  acaoVisual: string;
  status: 'pendente' | 'renderizando' | 'pronta' | 'falhou';
  outputUrl: string | null;
  error: string | null;
  /** Modelo de vídeo FORÇADO nesta cena (experimento); null = padrão do perfil. */
  modelo: string | null;
  /** Modelo que de fato gerou o clipe atual (null até existir render). */
  modeloUsado: string | null;
}

export interface VideoModelOption {
  id: string;
  label: string;
  falaPtBr: boolean;
  custoPlano: number;
}

export type PerfilDeCena = 'apresentador_fala' | 'apresentador_mudo' | 'tela' | 'produto';

export interface VideoModelsCatalog {
  modelos: VideoModelOption[];
  padrao: Record<PerfilDeCena, string>;
}

/** Estilo do criativo: com apresentador, só produto, ou a IA decide. */
export type CampaignStyle = 'ugc' | 'sem_apresentador' | 'misto';

/**
 * Sentinela em `vozNarrador` (o mesmo valor do backend): campanha sem
 * narração nenhuma — toda cena nasce `sem_fala`, só com o som ambiente.
 */
export const SEM_NARRACAO = 'sem_narracao';

export interface Campaign {
  id: string;
  title: string;
  durationSeconds: number;
  estilo: CampaignStyle;
  /** Voz do narrador (id do catálogo) — só no estilo sem apresentador. */
  vozNarrador: string | null;
  status: 'rascunho' | 'roteiro' | 'storyboard' | 'renderizando' | 'pronta';
  script: string | null;
  /** Vídeo montado a partir das cenas — é o entregável da campanha. */
  finalVideoUrl: string | null;
  /** Legendas queimadas no vídeo final. */
  subtitles: boolean;
  /**
   * Fila ligada: o servidor está gerando as cenas UMA POR VEZ, avançando a
   * cada refresh. Enquanto true, a campanha está trabalhando mesmo que
   * nenhuma cena esteja `renderizando` neste exato instante.
   */
  renderQueue: boolean;
  creditsSpent: number;
  /** Foto de capa do produto da campanha — a miniatura do card da lista. */
  productImage?: string | null;
  createdAt: string;
}

export interface CampaignList {
  items: Campaign[];
  total: number;
  page: number;
  pageCount: number;
  /** Quantas campanhas da conta INTEIRA já têm vídeo final — o stepper marca
   *  o passo "Vídeo" com isso, e a página atual não sabe responder sozinha. */
  comVideo: number;
}

export interface CampaignDetail extends Campaign {
  produto: UserProduct | null;
  persona: Persona | null;
  cenas: CampaignScene[];
}

export interface CampaignPricing {
  persona: number;
  roteiro: number;
  cena: number;
  cenas: number;
  totalCampanha: number;
}

export const campaignsService = {
  async personaOptions(): Promise<AttributeGroup[]> {
    const { data } = await api.get<AttributeGroup[]>('/campaigns/persona-options');
    return data;
  },

  async pricing(durationSeconds = 15): Promise<CampaignPricing> {
    const { data } = await api.get<CampaignPricing>('/campaigns/pricing', {
      params: { durationSeconds },
    });
    return data;
  },

  async createProduct(input: {
    name: string;
    priceBrl?: number;
    benefit?: string;
    problemSolved?: string;
    images?: string[];
    sourceProductId?: string;
  }): Promise<UserProduct> {
    const { data } = await api.post<UserProduct>('/campaigns/products', input);
    return data;
  },

  async listProducts(): Promise<UserProduct[]> {
    const { data } = await api.get<UserProduct[]>('/campaigns/products');
    return data;
  },

  async deleteProduct(id: string): Promise<void> {
    await api.delete(`/campaigns/products/${id}`);
  },

  async addPhoto(productId: string, file: File): Promise<UserProduct> {
    const form = new FormData();
    form.append('file', file);
    const { data } = await api.post<UserProduct>(
      `/campaigns/products/${productId}/photos`,
      form,
    );
    return data;
  },

  async removePhoto(productId: string, url: string): Promise<UserProduct> {
    const { data } = await api.delete<UserProduct>(
      `/campaigns/products/${productId}/photos`,
      { params: { url } },
    );
    return data;
  },

  async createPersona(input: {
    label?: string;
    attrs: Record<string, string>;
  }): Promise<Persona> {
    const { data } = await api.post<Persona>('/campaigns/personas', input);
    return data;
  },

  /**
   * Apresentador a partir de uma foto de referência — a foto vira o retrato
   * direto, sem gerar imagem e sem cobrar créditos.
   */
  async createPersonaFromPhoto(
    file: File,
    input: { label?: string; attrs: Record<string, string> },
  ): Promise<Persona> {
    const form = new FormData();
    form.append('file', file);
    if (input.label) form.append('label', input.label);
    form.append('attrs', JSON.stringify(input.attrs));
    const { data } = await api.post<Persona>('/campaigns/personas/from-photo', form);
    return data;
  },

  async listPersonas(): Promise<Persona[]> {
    const { data } = await api.get<Persona[]>('/campaigns/personas');
    return data;
  },

  async refreshPersona(id: string): Promise<Persona> {
    const { data } = await api.get<Persona>(`/campaigns/personas/${id}`);
    return data;
  },

  async deletePersona(id: string): Promise<void> {
    await api.delete(`/campaigns/personas/${id}`);
  },

  /** Apelido e voz — grátis, não mexe no retrato. */
  async updatePersona(
    id: string,
    patch: { label?: string; voz?: string },
  ): Promise<Persona> {
    const { data } = await api.patch<Persona>(`/campaigns/personas/${id}`, patch);
    return data;
  },

  async create(input: {
    userProductId: string;
    /** Obrigatória, exceto no estilo `sem_apresentador`. */
    personaId?: string;
    durationSeconds?: number;
    estilo?: CampaignStyle;
    /** Voz do narrador — obrigatória quando `estilo = 'sem_apresentador'`. */
    vozNarrador?: string;
  }): Promise<Campaign> {
    const { data } = await api.post<Campaign>('/campaigns', input);
    return data;
  },

  /** `q` busca no servidor — título, nome do produto ou preço — atravessando
   *  todas as páginas, não só a aberta. */
  async list(page = 1, q?: string): Promise<CampaignList> {
    const { data } = await api.get<CampaignList | Campaign[]>('/campaigns', {
      params: { page, ...(q?.trim() ? { q: q.trim() } : {}) },
    });
    // Backend antigo (ou ainda não reiniciado) devolve o array puro. O front
    // e o back não deployam juntos — o front é subido à mão — então essa
    // janela existe de verdade; normalizar aqui evita a tela em branco.
    if (Array.isArray(data)) {
      return {
        items: data,
        total: data.length,
        page: 1,
        pageCount: 1,
        comVideo: data.filter((c) => c.finalVideoUrl).length,
      };
    }
    return data;
  },

  async detail(id: string): Promise<CampaignDetail> {
    const { data } = await api.get<CampaignDetail>(`/campaigns/${id}`);
    return data;
  },

  async generateScript(id: string): Promise<CampaignDetail> {
    const { data } = await api.post<CampaignDetail>(`/campaigns/${id}/script`);
    return data;
  },

  async assemble(id: string): Promise<CampaignDetail> {
    const { data } = await api.post<CampaignDetail>(`/campaigns/${id}/assemble`);
    return data;
  },

  /**
   * Dispara de uma vez todas as cenas que faltam. A cobrança continua por
   * cena, no servidor; o que muda é o número de cliques. A montagem final
   * acontece sozinha quando a última cena fica pronta.
   */
  async renderAll(id: string): Promise<CampaignDetail> {
    const { data } = await api.post<CampaignDetail>(`/campaigns/${id}/render-all`);
    return data;
  },

  /** Desliga a fila: o que não disparou não cobra; a cena em voo termina. */
  async cancelQueue(id: string): Promise<CampaignDetail> {
    const { data } = await api.post<CampaignDetail>(`/campaigns/${id}/queue/cancel`);
    return data;
  },

  async refresh(id: string): Promise<CampaignDetail> {
    const { data } = await api.get<CampaignDetail>(`/campaigns/${id}/refresh`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/campaigns/${id}`);
  },

  /** Preferências (ex.: legendas). Mudar com o final pronto o remonta. */
  async update(
    id: string,
    input: { subtitles?: boolean },
  ): Promise<Campaign> {
    const { data } = await api.patch<Campaign>(`/campaigns/${id}`, input);
    return data;
  },

  async updateScene(
    sceneId: string,
    // `baseImageUrl` só vale para cena de produto, e o servidor confere que a
    // URL é uma das fotos cadastradas — aqui é só o transporte. Trocar
    // `tipoCena` invalida o render pendente e refaz o prompt no servidor.
    input: {
      fala?: string;
      acaoVisual?: string;
      baseImageUrl?: string;
      /** Id do catálogo (`getVideoModels`); null volta ao padrão do perfil. */
      modelo?: string | null;
      tipoCena?: SceneKind;
      modoAudio?: SceneAudioMode;
    },
  ): Promise<CampaignScene> {
    const { data } = await api.patch<CampaignScene>(
      `/campaigns/scenes/${sceneId}`,
      input,
    );
    return data;
  },

  /** Refaz só a NARRAÇÃO da cena (TTS pt-BR + remux). Não custa créditos. */
  async redubScene(sceneId: string): Promise<CampaignScene> {
    const { data } = await api.post<CampaignScene>(
      `/campaigns/scenes/${sceneId}/redub`,
    );
    return data;
  },

  /** Modelos de vídeo disponíveis e o padrão por perfil de cena. */
  async getVideoModels(): Promise<VideoModelsCatalog> {
    const { data } = await api.get<VideoModelsCatalog>('/campaigns/video-models');
    return data;
  },

  /** Reabre uma cena pronta para refazer — grátis; o render novo é que cobra. */
  async reopenScene(sceneId: string): Promise<CampaignScene> {
    const { data } = await api.post<CampaignScene>(
      `/campaigns/scenes/${sceneId}/reopen`,
    );
    return data;
  },

  async renderScene(sceneId: string): Promise<CampaignScene> {
    const { data } = await api.post<CampaignScene>(
      `/campaigns/scenes/${sceneId}/render`,
    );
    return data;
  },
};
