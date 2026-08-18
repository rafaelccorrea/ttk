import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogContent,
  Divider,
  Grid,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  Tab,
  Tabs,
  TextField,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { SmartImage } from '@/components/ui/SmartImage';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { MeusProdutos } from '@/components/produtos/MeusProdutos';
import { resolveApiUrl } from '@/services/api';
import { formatMoney } from '@/utils/format';
import {
  LIMITES,
  avisoFalaLonga,
  contador,
  perigoNoContador,
  validarAcaoVisual,
  validarFala,
  validarFoto,
  validarNomeProduto,
  validarPreco,
  validarRotuloPersona,
  validarTextoLongo,
} from '@/utils/validacao-criativos';
import {
  AttributeGroup,
  Campaign,
  CampaignDetail,
  CampaignPricing,
  Persona,
  UserProduct,
  campaignsService,
} from '@/services/campaigns.service';

/** Enquanto houver retrato ou cena em andamento, reconsulta neste intervalo. */
const POLL_MS = 6000;

function mensagemDeErro(error: unknown): string {
  const resposta = (error as { response?: { data?: { message?: string } } })?.response;
  return resposta?.data?.message ?? 'Não foi possível concluir. Tente de novo.';
}


// ---------------------------------------------------------------- personas
function PersonasTab({
  grupos,
  personas,
  precos,
  onChange,
}: {
  grupos: AttributeGroup[];
  personas: Persona[];
  precos: CampaignPricing | null;
  onChange: () => void;
}) {
  const [attrs, setAttrs] = useState<Record<string, string>>({});
  const [label, setLabel] = useState('');
  const [gerando, setGerando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Pré-seleciona a primeira opção de cada grupo: campo vazio é erro garantido.
  useEffect(() => {
    if (!grupos.length || Object.keys(attrs).length) return;
    const inicial: Record<string, string> = {};
    for (const grupo of grupos) inicial[grupo.key] = grupo.options[0].id;
    setAttrs(inicial);
  }, [grupos, attrs]);

  const completo = grupos.length > 0 && grupos.every((g) => attrs[g.key]);

  async function criar() {
    setGerando(true);
    setErro(null);
    try {
      await campaignsService.createPersona({ label: label.trim() || undefined, attrs });
      setLabel('');
      onChange();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setGerando(false);
    }
  }

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={800}>
                Novo apresentador
              </Typography>
              <Typography variant="body2" color="text.secondary">
                O retrato é gerado uma vez e reusado em todas as cenas — é o que
                mantém o mesmo rosto do começo ao fim do vídeo.
              </Typography>
              <TextField
                label="Apelido (opcional)"
                placeholder="Ju da cozinha"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                error={Boolean(validarRotuloPersona(label))}
                inputProps={{ maxLength: LIMITES.rotuloPersona }}
                helperText={
                  validarRotuloPersona(label) ??
                  'Sem apelido, a persona recebe um nome pelos atributos escolhidos.'
                }
                fullWidth
              />
              {grupos.map((grupo) => (
                <TextField
                  key={grupo.key}
                  select
                  label={grupo.label}
                  value={attrs[grupo.key] ?? ''}
                  onChange={(e) => setAttrs({ ...attrs, [grupo.key]: e.target.value })}
                  fullWidth
                >
                  {grupo.options.map((opcao) => (
                    <MenuItem key={opcao.id} value={opcao.id}>
                      {opcao.label}
                    </MenuItem>
                  ))}
                </TextField>
              ))}
              {erro && <Alert severity="error">{erro}</Alert>}
              <Button
                variant="contained"
                startIcon={<AutoAwesomeRoundedIcon />}
                onClick={criar}
                disabled={!completo || gerando || Boolean(validarRotuloPersona(label))}
              >
                {gerando
                  ? 'Gerando retrato...'
                  : `Gerar retrato${precos ? ` · ${precos.persona} créditos` : ''}`}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={7}>
        <Grid container spacing={2}>
          {!personas.length && (
            <Grid item xs={12}>
              <Alert severity="info">
                Nenhum apresentador ainda. Monte o primeiro ao lado.
              </Alert>
            </Grid>
          )}
          {personas.map((persona) => (
            <Grid item xs={6} sm={4} key={persona.id}>
              <Card sx={{ height: '100%' }}>
                <Box sx={{ aspectRatio: '9 / 14', position: 'relative' }}>
                  {persona.status === 'gerando' ? (
                    <BrandLoader minHeight={180} />
                  ) : persona.status === 'falhou' ? (
                    <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', px: 2 }}>
                      <Typography variant="body2" color="text.secondary" textAlign="center">
                        O retrato não ficou pronto. Os créditos foram estornados.
                      </Typography>
                    </Box>
                  ) : (
                    <SmartImage src={persona.seedImageUrl} alt={persona.label} />
                  )}
                </Box>
                <CardContent sx={{ py: 1.5 }}>
                  <Typography fontWeight={700} fontSize={14} noWrap>
                    {persona.label}
                  </Typography>
                  <Box display="flex" alignItems="center" gap={1} mt={0.5}>
                    <Chip
                      size="small"
                      label={
                        persona.status === 'pronta'
                          ? 'Pronto'
                          : persona.status === 'gerando'
                            ? 'Gerando'
                            : 'Falhou'
                      }
                      color={persona.status === 'pronta' ? 'success' : 'default'}
                    />
                    <IconButton
                      size="small"
                      sx={{ ml: 'auto' }}
                      onClick={async () => {
                        await campaignsService.deletePersona(persona.id);
                        onChange();
                      }}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Grid>
    </Grid>
  );
}

// --------------------------------------------------------------- storyboard
/**
 * Campo de texto de uma cena.
 *
 * Controlado, e não `defaultValue` com `onBlur`: sem estado local não há
 * contador nem validação enquanto se digita, e o usuário só descobriria que
 * passou do limite ao receber um 400 — com o texto já perdido.
 *
 * Grava ao sair do campo, mas só se mudou e só se for válido. Texto inválido
 * fica na tela para ser corrigido, em vez de ser silenciosamente descartado.
 */
function CampoDeCena({
  rotulo,
  valorSalvo,
  bloqueado,
  limite,
  ajuda,
  validar,
  aviso,
  salvar,
}: {
  rotulo: string;
  valorSalvo: string;
  bloqueado: boolean;
  limite: number;
  ajuda?: string;
  validar: (valor: string) => string | null;
  aviso?: (valor: string) => string | null;
  salvar: (valor: string) => void;
}) {
  const [valor, setValor] = useState(valorSalvo);

  // Regeração do roteiro troca o texto por fora; o campo tem que acompanhar.
  useEffect(() => setValor(valorSalvo), [valorSalvo]);

  const erro = validar(valor);
  const alerta = !erro && aviso ? aviso(valor) : null;

  return (
    <TextField
      label={rotulo}
      value={valor}
      onChange={(e) => setValor(e.target.value)}
      onBlur={() => {
        if (erro || valor === valorSalvo) return;
        salvar(valor);
      }}
      multiline
      minRows={2}
      fullWidth
      disabled={bloqueado}
      error={Boolean(erro)}
      inputProps={{ maxLength: limite }}
      FormHelperTextProps={{
        sx: alerta
          ? { color: 'warning.main' }
          : perigoNoContador(valor, limite)
            ? { color: 'warning.main' }
            : undefined,
      }}
      helperText={
        erro ?? alerta ?? `${ajuda ? `${ajuda} ` : ''}${contador(valor, limite)}`
      }
    />
  );
}

function Storyboard({
  detalhe,
  precos,
  onChange,
}: {
  detalhe: CampaignDetail;
  precos: CampaignPricing | null;
  onChange: () => void;
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const personaPronta = detalhe.persona?.status === 'pronta';
  const todasProntas =
    detalhe.cenas.length > 0 && detalhe.cenas.every((c) => c.status === 'pronta');

  async function acao(fn: () => Promise<unknown>) {
    setOcupado(true);
    setErro(null);
    try {
      await fn();
      onChange();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setOcupado(false);
    }
  }

  return (
    <Stack spacing={2}>
      <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
        <Typography variant="h6" fontWeight={800} flexGrow={1}>
          {detalhe.title}
        </Typography>
        <Chip label={`${detalhe.durationSeconds}s`} size="small" />
        <Chip label={`${detalhe.creditsSpent} créditos usados`} size="small" />
      </Box>

      {erro && <Alert severity="error">{erro}</Alert>}

      {/* O entregável fica no topo: quem abre uma campanha pronta veio buscar
          o vídeo, não revisar as cenas. */}
      {detalhe.finalVideoUrl && (
        <Card>
          <CardContent>
            <Stack spacing={1.5} alignItems="center">
              <Typography fontWeight={800} alignSelf="flex-start">
                Vídeo pronto para publicar
              </Typography>
              <Box
                component="video"
                src={resolveApiUrl(detalhe.finalVideoUrl)}
                controls
                playsInline
                sx={{
                  width: '100%',
                  maxWidth: 320,
                  aspectRatio: '9 / 16',
                  borderRadius: 2,
                  bgcolor: '#000',
                }}
              />
              <Button
                variant="contained"
                startIcon={<DownloadRoundedIcon />}
                component="a"
                href={resolveApiUrl(detalhe.finalVideoUrl)}
                target="_blank"
                rel="noopener noreferrer"
              >
                Baixar vídeo
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {todasProntas && !detalhe.finalVideoUrl && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary">
                Todas as cenas estão prontas. A montagem junta tudo num único
                vídeo 9:16 — não consome créditos.
              </Typography>
              <Button
                variant="contained"
                startIcon={<MovieFilterRoundedIcon />}
                disabled={ocupado}
                onClick={() => acao(() => campaignsService.assemble(detalhe.id))}
              >
                {ocupado ? 'Montando...' : 'Montar vídeo final'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {!detalhe.cenas.length && (
        <Card variant="outlined">
          <CardContent>
            <Stack spacing={1.5} alignItems="flex-start">
              <Typography variant="body2" color="text.secondary">
                O roteiro é escrito com o seu produto, quem apresenta e os ganchos
                que estão vendendo na categoria. Você edita cada fala antes de
                gastar crédito de vídeo.
              </Typography>
              <Button
                variant="contained"
                startIcon={<AutoAwesomeRoundedIcon />}
                disabled={ocupado}
                onClick={() => acao(() => campaignsService.generateScript(detalhe.id))}
              >
                {ocupado
                  ? 'Escrevendo...'
                  : `Gerar roteiro${precos ? ` · ${precos.roteiro} créditos` : ''}`}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {!personaPronta && detalhe.cenas.length > 0 && (
        <Alert severity="info">
          O retrato do apresentador ainda está sendo gerado. Assim que ficar
          pronto, você pode renderizar as cenas.
        </Alert>
      )}

      {detalhe.cenas.map((cena) => (
        <Card key={cena.id} variant="outlined">
          <CardContent>
            <Grid container spacing={2}>
              <Grid item xs={12} sm={5}>
                <Box
                  sx={{
                    aspectRatio: '9 / 14',
                    maxHeight: 300,
                    borderRadius: 2,
                    overflow: 'hidden',
                    bgcolor: 'rgba(22,24,35,0.04)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {cena.status === 'pronta' && cena.outputUrl ? (
                    <Box
                      component="video"
                      src={resolveApiUrl(cena.outputUrl)}
                      controls
                      loop
                      playsInline
                      sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : cena.status === 'renderizando' ? (
                    <BrandLoader minHeight={160} />
                  ) : cena.status === 'falhou' ? (
                    <Typography variant="body2" color="text.secondary" px={2} textAlign="center">
                      {cena.error ?? 'A cena falhou.'} Os créditos foram estornados.
                    </Typography>
                  ) : cena.baseImageUrl ? (
                    // Pré-visualização honesta: é literalmente o frame de onde
                    // a cena vai partir.
                    <SmartImage src={cena.baseImageUrl} alt={`Cena ${cena.ordem}`} />
                  ) : detalhe.persona?.seedImageUrl ? (
                    <SmartImage
                      src={detalhe.persona.seedImageUrl}
                      alt={`Cena ${cena.ordem}`}
                    />
                  ) : (
                    <Stack alignItems="center" spacing={1}>
                      <MovieFilterRoundedIcon color="disabled" />
                      <Typography variant="caption" color="text.secondary">
                        Cena {cena.ordem}
                      </Typography>
                    </Stack>
                  )}
                </Box>
              </Grid>

              <Grid item xs={12} sm={7}>
                <Stack spacing={1.5}>
                  <Chip
                    size="small"
                    label={
                      cena.tipo === 'produto'
                        ? 'Demonstração · parte da sua foto'
                        : 'Apresentador · parte do retrato'
                    }
                    color={cena.tipo === 'produto' ? 'primary' : 'default'}
                    sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
                  />
                  <CampoDeCena
                    rotulo={`Cena ${cena.ordem} — fala`}
                    valorSalvo={cena.fala}
                    bloqueado={cena.status === 'pronta'}
                    validar={validarFala}
                    aviso={avisoFalaLonga}
                    limite={LIMITES.fala}
                    salvar={(valor) =>
                      acao(() => campaignsService.updateScene(cena.id, { fala: valor }))
                    }
                  />
                  <CampoDeCena
                    rotulo="O que aparece na tela"
                    valorSalvo={cena.acaoVisual}
                    bloqueado={cena.status === 'pronta'}
                    validar={validarAcaoVisual}
                    limite={LIMITES.acaoVisual}
                    ajuda={
                      cena.tipo === 'produto'
                        ? 'Só o movimento de câmera e do objeto — nesta cena a pessoa não entra em quadro.'
                        : 'Descreva a ação. A aparência do apresentador já está definida.'
                    }
                    salvar={(valor) =>
                      acao(() =>
                        campaignsService.updateScene(cena.id, { acaoVisual: valor }),
                      )
                    }
                  />
                  {cena.status !== 'pronta' && (
                    <Button
                      variant="outlined"
                      startIcon={<PlayArrowRoundedIcon />}
                      // Cena de produto não depende do retrato: ela parte da
                      // foto e pode ser renderizada antes dele ficar pronto.
                      disabled={
                        ocupado ||
                        cena.status === 'renderizando' ||
                        (cena.tipo === 'apresentador' && !personaPronta)
                      }
                      onClick={() => acao(() => campaignsService.renderScene(cena.id))}
                    >
                      {cena.status === 'renderizando'
                        ? 'Renderizando...'
                        : `Renderizar cena${precos ? ` · ${precos.cena} créditos` : ''}`}
                    </Button>
                  )}
                </Stack>
              </Grid>
            </Grid>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

// --------------------------------------------------------------- campanhas
function CampanhasTab({
  produtos,
  personas,
  campanhas,
  precos,
  onChange,
}: {
  produtos: UserProduct[];
  personas: Persona[];
  campanhas: Campaign[];
  precos: CampaignPricing | null;
  onChange: () => void;
}) {
  const [userProductId, setUserProductId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [durationSeconds, setDuration] = useState(15);
  // Trava de clique repetido. Sem ela, cada clique durante a espera da rede
  // criava uma campanha — e cada campanha é um roteiro a caminho, ou seja,
  // crédito queimado por impaciência. O estado sobe ANTES do await.
  const [criando, setCriando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<CampaignDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const carregarDetalhe = useCallback(async (id: string) => {
    // `refresh` consulta as gerações em andamento e devolve a campanha inteira.
    const dados = await campaignsService.refresh(id);
    setDetalhe(dados);
  }, []);

  useEffect(() => {
    if (!aberta) {
      setDetalhe(null);
      return;
    }
    void carregarDetalhe(aberta).catch(console.error);
  }, [aberta, carregarDetalhe]);

  // Só consulta enquanto existe algo em andamento — parado, não gera tráfego.
  useEffect(() => {
    if (!aberta || !detalhe) return;
    const emAndamento =
      detalhe.persona?.status === 'gerando' ||
      detalhe.cenas.some((c) => c.status === 'renderizando');
    if (!emAndamento) return;
    const timer = setTimeout(() => void carregarDetalhe(aberta).catch(console.error), POLL_MS);
    return () => clearTimeout(timer);
  }, [aberta, detalhe, carregarDetalhe]);

  async function criar() {
    // Guarda de reentrância: o `disabled` do botão depende do React ter
    // repintado, e dois cliques rápidos cabem antes disso.
    if (criando) return;
    setCriando(true);
    setErro(null);
    try {
      const nova = await campaignsService.create({
        userProductId,
        personaId,
        durationSeconds,
      });
      onChange();
      setAberta(nova.id);
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setCriando(false);
    }
  }

  if (aberta && detalhe) {
    return (
      <Stack spacing={2}>
        <Button sx={{ alignSelf: 'flex-start' }} onClick={() => setAberta(null)}>
          ← Voltar para as campanhas
        </Button>
        <Storyboard
          detalhe={detalhe}
          precos={precos}
          onChange={() => void carregarDetalhe(detalhe.id).then(onChange)}
        />
      </Stack>
    );
  }

  const produtoEscolhido = produtos.find((p) => p.id === userProductId) ?? null;
  // O mesmo piso do backend: sem `fotosMinimasPorProduto` fotos, a campanha é
  // recusada na API. Barrar aqui poupa a ida e o 400.
  const fotosFaltando = produtoEscolhido
    ? Math.max(0, LIMITES.fotosMinimasPorProduto - produtoEscolhido.images.length)
    : 0;
  const podeCriar = Boolean(userProductId && personaId) && !fotosFaltando && !criando;

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={800}>
                Nova campanha
              </Typography>
              <SearchableSelect
                label="Produto"
                placeholder="Buscar produto…"
                value={userProductId}
                onChange={setUserProductId}
                fullWidth
                helperText={!produtos.length ? 'Cadastre um produto primeiro.' : ' '}
                options={produtos.map((p) => ({
                  value: p.id,
                  label: p.name,
                  imageUrl: p.images[0] ?? null,
                  // A contagem de fotos entra na legenda da lista: é o que
                  // decide se o produto pode virar campanha, então precisa
                  // aparecer ANTES da escolha, não depois do botão travado.
                  caption:
                    p.images.length < LIMITES.fotosMinimasPorProduto
                      ? `${p.images.length}/${LIMITES.fotosMinimasPorProduto} fotos — faltam fotos`
                      : (p.benefit ?? undefined),
                }))}
              />
              <SearchableSelect
                label="Quem apresenta"
                placeholder="Buscar apresentador…"
                value={personaId}
                onChange={setPersonaId}
                fullWidth
                helperText={!personas.length ? 'Monte um apresentador primeiro.' : ' '}
                options={personas.map((p) => ({
                  value: p.id,
                  label: p.label,
                  imageUrl: p.seedImageUrl,
                  caption: p.status !== 'pronta' ? 'retrato em preparo' : undefined,
                }))}
              />
              <TextField
                select
                label="Duração"
                value={durationSeconds}
                onChange={(e) => setDuration(Number(e.target.value))}
                fullWidth
              >
                <MenuItem value={15}>15 segundos · 3 cenas</MenuItem>
                <MenuItem value={30}>30 segundos · 6 cenas</MenuItem>
              </TextField>
              {precos && (
                <Alert severity="info">
                  Roteiro {precos.roteiro} + {Math.round(durationSeconds / 5)} cenas ×{' '}
                  {precos.cena} ={' '}
                  <strong>
                    {precos.roteiro + precos.cena * Math.round(durationSeconds / 5)} créditos
                  </strong>
                  . Você só paga cada cena ao renderizá-la.
                </Alert>
              )}
              {Boolean(fotosFaltando) && (
                <Alert severity="warning">
                  <strong>{produtoEscolhido?.name}</strong> tem{' '}
                  {produtoEscolhido?.images.length} de {LIMITES.fotosMinimasPorProduto}{' '}
                  fotos. Cada cena de demonstração parte de uma foto diferente — envie
                  mais {fotosFaltando} na aba <strong>Produtos</strong> para criar a
                  campanha.
                </Alert>
              )}
              {erro && <Alert severity="error">{erro}</Alert>}
              <Button
                variant="contained"
                size="large"
                onClick={criar}
                disabled={!podeCriar}
                // O ícone troca pelo spinner no mesmo lugar: o botão não muda
                // de largura no meio do clique, e a espera fica evidente sem
                // precisar ler o texto.
                startIcon={
                  criando ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <RocketLaunchRoundedIcon />
                  )
                }
              >
                {criando ? 'Criando campanha...' : 'Criar campanha'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={7}>
        <Stack spacing={1.5}>
          {!campanhas.length && (
            <Alert severity="info">Nenhuma campanha ainda.</Alert>
          )}
          {campanhas.map((campanha) => (
            <Card key={campanha.id}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                <Box flexGrow={1}>
                  <Typography fontWeight={700}>{campanha.title}</Typography>
                  <Typography variant="body2" color="text.secondary">
                    {campanha.durationSeconds}s · {campanha.status} ·{' '}
                    {campanha.creditsSpent} créditos
                  </Typography>
                </Box>
                <Button size="small" onClick={() => setAberta(campanha.id)}>
                  Abrir
                </Button>
                <IconButton
                  onClick={async () => {
                    await campaignsService.delete(campanha.id);
                    onChange();
                  }}
                >
                  <DeleteOutlineRoundedIcon />
                </IconButton>
              </CardContent>
            </Card>
          ))}
        </Stack>
      </Grid>
    </Grid>
  );
}

// -------------------------------------------------------------------- página
export function CampaignsPage() {
  const [aba, setAba] = useState(0);
  const [grupos, setGrupos] = useState<AttributeGroup[]>([]);
  const [produtos, setProdutos] = useState<UserProduct[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [campanhas, setCampanhas] = useState<Campaign[]>([]);
  const [precos, setPrecos] = useState<CampaignPricing | null>(null);
  const [carregando, setCarregando] = useState(true);
  const montado = useRef(true);

  const recarregar = useCallback(async () => {
    const [p, pe, c] = await Promise.all([
      campaignsService.listProducts(),
      campaignsService.listPersonas(),
      campaignsService.list(),
    ]);
    if (!montado.current) return;
    setProdutos(p);
    setPersonas(pe);
    setCampanhas(c);
  }, []);

  useEffect(() => {
    montado.current = true;
    Promise.all([
      campaignsService.personaOptions().then(setGrupos),
      campaignsService.pricing().then(setPrecos),
      recarregar(),
    ])
      .catch(console.error)
      .finally(() => montado.current && setCarregando(false));
    return () => {
      montado.current = false;
    };
  }, [recarregar]);

  // Retrato em preparo: reconsulta até concluir, senão o card fica girando à toa.
  useEffect(() => {
    const gerando = personas.filter((p) => p.status === 'gerando');
    if (!gerando.length) return;
    const timer = setTimeout(async () => {
      await Promise.all(
        gerando.map((p) => campaignsService.refreshPersona(p.id).catch(() => null)),
      );
      await recarregar().catch(console.error);
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [personas, recarregar]);

  if (carregando) return <BrandLoader minHeight={320} />;

  return (
    <Box>
      <Typography variant="h4" fontWeight={900} gutterBottom>
        Fábrica de criativos
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>
        Cadastre o seu produto, escolha quem apresenta, aprove o roteiro e receba
        o vídeo pronto para publicar.
      </Typography>

      <Tabs value={aba} onChange={(_, v) => setAba(v)} sx={{ mb: 3 }}>
        <Tab label={`Produtos (${produtos.length})`} />
        <Tab label={`Apresentadores (${personas.length})`} />
        <Tab label={`Campanhas (${campanhas.length})`} />
      </Tabs>
      <Divider sx={{ mb: 3 }} />

      {aba === 0 && <MeusProdutos produtos={produtos} onChange={recarregar} />}
      {aba === 1 && (
        <PersonasTab
          grupos={grupos}
          personas={personas}
          precos={precos}
          onChange={recarregar}
        />
      )}
      {aba === 2 && (
        <CampanhasTab
          produtos={produtos}
          personas={personas}
          campanhas={campanhas}
          precos={precos}
          onChange={recarregar}
        />
      )}
    </Box>
  );
}
