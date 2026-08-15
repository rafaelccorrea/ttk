/**
 * Categorias de primeiro nível da TikTok Shop (endpoint `/echotik/category/l1`).
 *
 * O EchoTik devolve o nome só em en-US, id-ID, th-TH, zh-CN, ms-MY e vi-VN —
 * não há pt-BR. Como a lista é pequena e praticamente estática, fica fixa aqui
 * já traduzida, em vez de gastar 1 request por execução para receber inglês.
 *
 * Os ids vieram da resposta real da API (31 categorias, agosto/2026).
 */
export const PRODUCT_CATEGORIES: Record<string, string> = {
  '0': 'Outros',
  '2344592': 'Reservas e Vouchers',
  '600001': 'Casa e Utilidades',
  '600024': 'Cozinha',
  '600154': 'Cama, Mesa e Banho',
  '600942': 'Eletrodomésticos',
  '601152': 'Moda Feminina e Lingerie',
  '601303': 'Moda Muçulmana',
  '601352': 'Calçados',
  '601450': 'Beleza e Cuidados Pessoais',
  '601739': 'Celulares e Eletrônicos',
  '601755': 'Informática e Escritório',
  '602118': 'Pet Shop',
  '602284': 'Bebês e Maternidade',
  '603014': 'Esporte e Ar Livre',
  '604206': 'Brinquedos e Hobbies',
  '604453': 'Móveis',
  '604579': 'Ferramentas',
  '604968': 'Casa e Construção',
  '605196': 'Automotivo e Motos',
  '605248': 'Acessórios de Moda',
  '700437': 'Alimentos e Bebidas',
  '700645': 'Saúde',
  '801928': 'Livros e Revistas',
  '802184': 'Moda Infantil',
  '824328': 'Moda Masculina',
  '824584': 'Malas e Bolsas',
  '834312': 'Produtos Virtuais',
  '856720': 'Seminovos',
  '951432': 'Colecionáveis',
  '953224': 'Joias e Acessórios',
};

/** Nome em português da categoria, ou 'Outros' se o id for desconhecido. */
export function categoryName(categoryId: string | null | undefined): string {
  if (!categoryId) return 'Outros';
  return PRODUCT_CATEGORIES[String(categoryId)] ?? 'Outros';
}

/** Lista para popular o filtro na interface, em ordem alfabética. */
export function categoryOptions(): Array<{ id: string; name: string }> {
  return Object.entries(PRODUCT_CATEGORIES)
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}
