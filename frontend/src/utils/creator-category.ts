/**
 * Tradução das categorias de criador.
 *
 * A categoria vem crua da API do TikTok, em inglês ("Other", "Shopping &
 * Retail", "Public Figure"), e era exibida assim numa plataforma inteiramente
 * em português — inclusive no filtro, onde o usuário precisava adivinhar o
 * termo em inglês para achar o nicho dele.
 *
 * A tradução acontece só na EXIBIÇÃO: o valor mandado para a API continua
 * sendo o original, senão o filtro para de bater com o que está no banco.
 *
 * Categoria desconhecida cai no próprio texto, sem quebrar — o TikTok
 * acrescenta rótulos novos sem avisar, e mostrar o nome em inglês é melhor
 * que mostrar vazio.
 */
const TRADUCAO: Record<string, string> = {
  'Art & Crafts': 'Arte e Artesanato',
  Beauty: 'Beleza',
  'Media & Entertainment': 'Mídia e Entretenimento',
  Other: 'Outros',
  'Personal Blog': 'Blog Pessoal',
  Pets: 'Pets',
  'Public Figure': 'Figura Pública',
  'Shopping & Retail': 'Compras e Varejo',
  geral: 'Geral',
};

export function traduzirCategoria(original: string | null | undefined): string {
  if (!original) return 'Sem categoria';
  return TRADUCAO[original] ?? original;
}
