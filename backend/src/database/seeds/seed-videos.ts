import 'dotenv/config';
import { DataSource } from 'typeorm';
import { ProductMetricDaily } from '../../modules/products/entities/product-metric-daily.entity';
import { Product } from '../../modules/products/entities/product.entity';
import { SavedVideo } from '../../modules/videos/entities/saved-video.entity';
import { Video } from '../../modules/videos/entities/video.entity';

// Seed determinístico: mesmo resultado em qualquer máquina (LCG simples).
let seedState = 42;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}
function pick<T>(arr: T[]): T {
  return arr[randInt(0, arr.length - 1)];
}

const CREATORS = [
  '@achadinhosdaju',
  '@eusoubarone',
  '@dicasdatata',
  '@compreicomprova',
  '@achadosdomarcos',
  '@viraliza.shop',
  '@lojinhadabia',
  '@testei.pravoce',
  '@promodakemi',
  '@garimpodalari',
  '@ofertasdodudu',
  '@casadamile',
];

// Caption por categoria: [texto base, categoria]
const CAPTIONS: Array<[string, string]> = [
  ['Gente, esse sérum mudou minha pele em 2 semanas 😱 #skincare #achadinhos #tiktokshop', 'beleza'],
  ['O protetor solar que não deixa a pele oleosa EXISTE ✨ #beleza #achadinhostiktok #tiktokshop', 'beleza'],
  ['Testei a progressiva orgânica mais viral do TikTok 💇‍♀️ #cabelo #achadinhos #tiktokmefezcomprar', 'beleza'],
  ['Cílios de banda invisível: aplicação em 2 minutos, olha o resultado 👀 #makeup #achadinhos #tiktokshop', 'beleza'],
  ['Essa cinta modeladora é melhor que a importada e custa 3x menos 🔥 #modafeminina #achadinhos #tiktokshop', 'moda-feminina'],
  ['A calça wide leg que todo mundo pergunta onde comprei 🛍️ #lookdodia #achadinhostiktok #tiktokshop', 'moda-feminina'],
  ['Legging flare flanelada pro inverno: conforto nível MÁXIMO ❄️ #moda #achadinhos #tiktokmefezcomprar', 'moda-feminina'],
  ['Bolsa de couro PU que parece de boutique cara 😍 #bolsas #achadinhos #tiktokshop', 'moda-feminina'],
  ['Kit 4 camisetas premium por esse preço? Corre antes que acabe 🏃 #modamasculina #achadinhos #tiktokshop', 'moda-masculina'],
  ['A jaqueta de sarja mais pedida do momento, prova real no corpo 🧥 #streetwear #achadinhostiktok #tiktokshop', 'moda-masculina'],
  ['Oversized estonada que não desbota na lavagem, testei por 30 dias 🧪 #modamasculina #achadinhos #tiktokshop', 'moda-masculina'],
  ['Essa air fryer de 5,5L virou minha melhor amiga na cozinha 🍟 #casacozinha #achadinhos #tiktokshop', 'casa-cozinha'],
  ['Fatiador de legumes que corta couve em 10 segundos ⏱️ #cozinha #achadinhostiktok #tiktokmefezcomprar', 'casa-cozinha'],
  ['O jogo de panela cerâmica mais lindo que já vi, nada gruda 🍳 #casa #achadinhos #tiktokshop', 'casa-cozinha'],
  ['Lustre nórdico 3 em 1: minha sala parece outra casa ✨ #decoracao #achadinhos #tiktokshop', 'casa-cozinha'],
  ['Coberdrom sherpa 2,40m: parece abraço de urso 🧸 #camamesa #achadinhos #tiktokshop', 'cama-mesa'],
  ['Cortina blackout que deixa o quarto ESCURO de verdade 🌑 #quarto #achadinhostiktok #tiktokshop', 'cama-mesa'],
  ['Lençol 400 fios por menos de 20 reais? Sim, e é bom 😴 #enxoval #achadinhos #tiktokmefezcomprar', 'cama-mesa'],
  ['Smartwatch com GPS e chamada bluetooth por preço de fone 🤯 #tech #achadinhos #tiktokshop', 'eletronicos'],
  ['Projetor astronauta: meu quarto virou uma galáxia 🌌 #quartogamer #achadinhostiktok #tiktokshop', 'eletronicos'],
  ['Fone TWS esportivo que não cai nem no treino pesado 🎧 #eletronicos #achadinhos #tiktokshop', 'eletronicos'],
  ['Fita neon LED: setup gamer completo gastando pouco 🎮 #setupgamer #achadinhos #tiktokmefezcomprar', 'eletronicos'],
  ['Conjunto fitness que não fica transparente no agachamento 🍑 #fitness #achadinhos #tiktokshop', 'fitness'],
  ['Halteres ajustáveis 6 em 1: academia em casa resolvida 💪 #treinoemcasa #achadinhostiktok #tiktokshop', 'fitness'],
  ['Garrafa térmica com canudo que mantém gelado por 24h 🧊 #fitness #achadinhos #tiktokshop', 'fitness'],
  ['Parafusadeira 48V com 2 baterias: montei a casa inteira 🔧 #ferramentas #achadinhos #tiktokshop', 'ferramentas'],
  ['Kit amortecedor de porta: nunca mais bati a porta do carro 🚗 #automotivo #achadinhostiktok #tiktokshop', 'ferramentas'],
  ['48 carrinhos com pista: meu filho sumiu por 3 horas 😂 #infantil #achadinhos #tiktokmefezcomprar', 'infantil'],
  ['Polvo dançante que hipnotiza qualquer bebê 🐙 #maternidade #achadinhos #tiktokshop', 'infantil'],
  ['Massageador de pescoço que acaba com a tensão do home office 💆 #saude #achadinhos #tiktokshop', 'saude'],
  ['Escova de limpeza elétrica 9 em 1: faxina em metade do tempo 🧽 #limpeza #achadinhostiktok #tiktokshop', 'saude'],
  ['Mix de castanhas 1kg direto da fábrica, qualidade absurda 🥜 #saudavel #achadinhos #tiktokshop', 'saude'],
];

const TRANSCRIPTS = [
  'Oi gente! Chegou o achadinho que vocês pediram. Olha só a qualidade disso aqui, e o preço tá surreal. Link na vitrine!',
  'Eu não acreditei quando abri a caixa. Testei na hora e já quero comprar mais dois. Corre lá na vitrinha antes que esgote.',
  'Presta atenção nesse detalhe. É por isso que esse produto tá viralizando. Custa uma fração do importado e entrega o mesmo resultado.',
  'Comprei sem expectativa nenhuma e me surpreendi demais. Vou mostrar o antes e depois pra vocês verem que não é papo.',
  'Terceira vez que compro desse fornecedor. Chega rápido, bem embalado e o cupom da live ainda tá valendo. Aproveita!',
  'Se você tava esperando um sinal pra comprar, é esse vídeo. Olha o teste que eu fiz aqui, funcionou perfeitamente.',
];

async function run() {
  const url = process.env.DATABASE_URL;
  const entities = [Video, SavedVideo, Product, ProductMetricDaily];
  const dataSource = new DataSource(
    url
      ? {
          type: 'postgres',
          url,
          ssl: { rejectUnauthorized: false },
          entities,
          synchronize: true,
        }
      : {
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'pikpok',
          entities,
          synchronize: true,
        },
  );
  await dataSource.initialize();

  const videos = dataSource.getRepository(Video);
  const products = dataSource.getRepository(Product);

  if ((await videos.count()) > 0) {
    console.log('Vídeos já populados — nada a fazer. (Apague a tabela para re-seedar.)');
    await dataSource.destroy();
    return;
  }

  // Busca produtos existentes para vincular ~60% dos vídeos.
  const allProducts = await products.find();
  const byCategory = new Map<string, Product[]>();
  for (const p of allProducts) {
    const list = byCategory.get(p.category) ?? [];
    list.push(p);
    byCategory.set(p.category, list);
  }

  console.log('Populando vídeos virais...');
  const TOTAL = 48;
  for (let i = 0; i < TOTAL; i++) {
    const [caption, category] = CAPTIONS[i % CAPTIONS.length];
    // Views entre 50K e 20M com distribuição enviesada (poucos virais gigantes).
    const views = Math.round(50_000 + Math.pow(rand(), 2.2) * 19_950_000);
    const likes = Math.round(views * 0.04 * (0.8 + rand() * 0.4));
    const revenueEstimate = views * 0.036 * (0.8 + rand() * 0.4);
    const daysAgo = randInt(1, 60);
    const postedAt = new Date();
    postedAt.setUTCDate(postedAt.getUTCDate() - daysAgo);

    // ~60% dos vídeos vinculados a um produto (preferindo a mesma categoria).
    let productId: string | null = null;
    if (rand() < 0.6 && allProducts.length > 0) {
      const pool = byCategory.get(category) ?? allProducts;
      productId = pick(pool).id;
    }

    await videos.save(
      videos.create({
        externalId: `seed-video-${i + 1}`,
        caption,
        creatorHandle: CREATORS[i % CREATORS.length],
        views,
        likes,
        revenueEstimate: revenueEstimate.toFixed(2),
        postedAt: postedAt.toISOString().slice(0, 10),
        transcript: rand() < 0.5 ? pick(TRANSCRIPTS) : null,
        productId,
        category,
      }),
    );
  }

  console.log(`Vídeos: ${TOTAL} vídeos virais populados.`);
  await dataSource.destroy();
  console.log('Seed de vídeos concluído.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
