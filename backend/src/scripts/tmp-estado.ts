import AppDataSource from '../database/data-source';
AppDataSource.initialize().then(async (ds) => {
  const rows = await ds.query(`
    SELECT c.id, c.status, c."renderQueue", s.ordem, s.status AS cena, g.status AS media, g.error
    FROM campaigns c LEFT JOIN campaign_scenes s ON s."campaignId"=c.id
    LEFT JOIN generated_media g ON g.id = s."generatedMediaId"
    WHERE c."updatedAt" > now() - interval '1 day' ORDER BY c."updatedAt" DESC, s.ordem LIMIT 12`);
  console.log(rows.map((r: any) => `${r.id.slice(0,8)} ${r.status} fila:${r.renderQueue} | cena ${r.ordem}: ${r.cena} (media: ${r.media ?? '-'}${r.error ? ' ERR: ' + r.error : ''})`).join('\n'));
  await ds.destroy();
});
