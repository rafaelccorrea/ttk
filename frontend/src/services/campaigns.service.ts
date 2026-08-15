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
  creditsSpent: number;
  createdAt: string;
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

  async list(): Promise<Campaign[]> {
    const { data } = await api.get<Campaign[]>('/campaigns');
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

  async refresh(id: string): Promise<CampaignDetail> {
    const { data } = await api.get<CampaignDetail>(`/campaigns/${id}/refresh`);
    return data;
  },

  async delete(id: string): Promise<void> {
    await api.delete(`/campaigns/${id}`);
  },

  async updateScene(
    sceneId: string,
    input: { fala?: string; acaoVisual?: string },
  ): Promise<CampaignScene> {
    const { data } = await api.patch<CampaignScene>(
      `/campaigns/scenes/${sceneId}`,
      input,
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
