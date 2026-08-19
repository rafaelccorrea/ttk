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

export interface CampaignScene {
  id: string;
  ordem: number;
  /** `produto` anima a foto real; `apresentador` anima o retrato da persona. */
  tipo: 'apresentador' | 'produto';
  baseImageUrl: string | null;
  fala: string;
  acaoVisual: string;
  status: 'pendente' | 'renderizando' | 'pronta' | 'falhou';
  outputUrl: string | null;
  error: string | null;
}

export interface Campaign {
  id: string;
  title: string;
  durationSeconds: number;
  status: 'rascunho' | 'roteiro' | 'storyboard' | 'renderizando' | 'pronta';
  script: string | null;
  /** Vídeo montado a partir das cenas — é o entregável da campanha. */
  finalVideoUrl: string | null;
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

  async create(input: {
    userProductId: string;
    personaId: string;
    durationSeconds?: number;
  }): Promise<Campaign> {
    const { data } = await api.post<Campaign>('/campaigns', input);
    return data;
  },

  async list(page = 1): Promise<CampaignList> {
    const { data } = await api.get<CampaignList | Campaign[]>('/campaigns', {
      params: { page },
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

  async refresh(id: string): Promise<CampaignDetail> {
    const { data } = await api.get<CampaignDetail>(`/campaigns/${id}/refresh`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/campaigns/${id}`);
  },

  async updateScene(
    sceneId: string,
    // `baseImageUrl` só vale para cena de produto, e o servidor confere que a
    // URL é uma das fotos cadastradas — aqui é só o transporte.
    input: { fala?: string; acaoVisual?: string; baseImageUrl?: string },
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

  async renderScene(sceneId: string): Promise<CampaignScene> {
    const { data } = await api.post<CampaignScene>(
      `/campaigns/scenes/${sceneId}/render`,
    );
    return data;
  },
};
