import 'dotenv/config';
import { DataSource } from 'typeorm';
import { Creator } from '../../modules/creators/entities/creator.entity';

// Seed determinístico: mesmo resultado em qualquer máquina (LCG simples).
let seedState = 77;
function rand(): number {
  seedState = (seedState * 1664525 + 1013904223) % 4294967296;
  return seedState / 4294967296;
}
function randInt(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min;
}

// ~40 criadores brasileiros fictícios, porém realistas.
// [handle, nome, categoria]
const CREATORS: Array<[string, string, string]> = [
  ['garciaindica', 'Garcia Indica', 'beleza'],
  ['achadinhosdalari', 'Achadinhos da Lari', 'moda-feminina'],
  ['casalfurtado', 'Casal Furtado', 'casa-cozinha'],
  ['belezacomduda', 'Beleza com Duda', 'beleza'],
  ['skincaredajuh', 'Skincare da Juh', 'beleza'],
  ['makedanay', 'Make da Nay', 'beleza'],
  ['lookdapati', 'Look da Pati', 'moda-feminina'],
  ['modinhadabela', 'Modinha da Bela', 'moda-feminina'],
  ['closetdamari', 'Closet da Mari', 'moda-feminina'],
  ['estilosarah', 'Estilo Sarah', 'moda-feminina'],
  ['brunodolook', 'Bruno do Look', 'moda-masculina'],
  ['modabrasileiro', 'Moda do Brasileiro', 'moda-masculina'],
  ['estilodovini', 'Estilo do Vini', 'moda-masculina'],
  ['drippdotheo', 'Dripp do Theo', 'moda-masculina'],
  ['cozinhadaneide', 'Cozinha da Neide', 'casa-cozinha'],
  ['lardocelarpaula', 'Lar Doce Lar da Paula', 'casa-cozinha'],
  ['organizacomtata', 'Organiza com Tata', 'casa-cozinha'],
  ['achadosdecasa', 'Achados de Casa', 'casa-cozinha'],
  ['quartodossonhosbr', 'Quarto dos Sonhos BR', 'cama-mesa'],
  ['enxovaldacintia', 'Enxoval da Cíntia', 'cama-mesa'],
  ['camaequilibrada', 'Cama Equilibrada', 'cama-mesa'],
  ['technandinho', 'Tech Nandinho', 'eletronicos'],
  ['gadgetsdopedro', 'Gadgets do Pedro', 'eletronicos'],
  ['eletronicosdakau', 'Eletrônicos da Kau', 'eletronicos'],
  ['setupdomatheus', 'Setup do Matheus', 'eletronicos'],
  ['fitcomcamila', 'Fit com Camila', 'fitness'],
  ['treinodojorge', 'Treino do Jorge', 'fitness'],
  ['marombadodudu', 'Maromba do Dudu', 'fitness'],
  ['vidafitdalu', 'Vida Fit da Lu', 'fitness'],
  ['ferramentasdotiao', 'Ferramentas do Tião', 'ferramentas'],
  ['oficinadocarlao', 'Oficina do Carlão', 'ferramentas'],
  ['maridodealuguelze', 'Marido de Aluguel Zé', 'ferramentas'],
  ['mundodaisa', 'Mundo da Isa', 'infantil'],
  ['brinquedosdotom', 'Brinquedos do Tom', 'infantil'],
  ['maternidadereal_bia', 'Maternidade Real da Bia', 'infantil'],
  ['saudecomdrarenata', 'Saúde com Dra. Renata', 'saude'],
  ['bemestarleandro', 'Bem-Estar Leandro', 'saude'],
  ['vidasaudaveljo', 'Vida Saudável da Jô', 'saude'],
  ['promodachris', 'Promo da Chris', 'beleza'],
  ['achadinhosdoraf', 'Achadinhos do Raf', 'eletronicos'],
  ['tendenciadamanu', 'Tendência da Manu', 'moda-feminina'],
  ['casadovaldir', 'Casa do Valdir', 'casa-cozinha'],
];

async function run() {
  const url = process.env.DATABASE_URL;
  const dataSource = new DataSource(
    url
      ? {
          type: 'postgres',
          url,
          ssl: { rejectUnauthorized: false },
          entities: [Creator],
          synchronize: true,
        }
      : {
          type: 'postgres',
          host: process.env.DB_HOST ?? 'localhost',
          port: Number(process.env.DB_PORT ?? 5432),
          username: process.env.DB_USERNAME ?? 'postgres',
          password: process.env.DB_PASSWORD ?? 'postgres',
          database: process.env.DB_DATABASE ?? 'pikpok',
          entities: [Creator],
          synchronize: true,
        },
  );
  await dataSource.initialize();

  const creators = dataSource.getRepository(Creator);

  if ((await creators.count()) > 0) {
    console.log('Criadores já populados — nada a fazer. (Apague a tabela para re-seedar.)');
    await dataSource.destroy();
    return;
  }

  console.log('Populando criadores...');
  const rows: Partial<Creator>[] = [];
  CREATORS.forEach(([handle, name, category], index) => {
    // Seguidores: 30K a 7M, com cauda longa (poucos muito grandes).
    const followers = Math.round(30_000 + Math.pow(rand(), 2.2) * 6_970_000);

    // GMV 30 dias: 50K a 3M, distribuição decrescente pelo rank de inserção.
    const decay = Math.pow(0.92, index); // decresce a cada criador
    const gmv = Math.max(
      50_000,
      Math.round((3_000_000 * decay + randInt(-40_000, 40_000)) * 100) / 100,
    );

    // Vendas coerentes com o GMV (ticket médio entre R$ 35 e R$ 120).
    const avgTicket = 35 + rand() * 85;
    const salesPeriod = Math.max(100, Math.round(gmv / avgTicket));

    rows.push({
      handle,
      name,
      category,
      followers,
      gmvPeriod: gmv.toFixed(2),
      salesPeriod,
      avatarUrl: null as unknown as string,
    });
  });

  await creators.save(creators.create(rows));
  console.log(`Criadores: ${rows.length} inseridos.`);

  await dataSource.destroy();
  console.log('Seed de criadores concluído.');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
