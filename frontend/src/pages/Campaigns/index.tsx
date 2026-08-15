import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Grid,
  IconButton,
  MenuItem,
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
import { resolveApiUrl } from '@/services/api';
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
} from './validacao';
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

// ---------------------------------------------------------------- produtos
/**
 * Card do produto com a galeria.
 *
 * A foto não é enfeite de cadastro: as cenas de demonstração são animadas a
 * partir dela. Sem foto, a IA inventa um objeto parecido e o anúncio mostra um
 * produto que não é o que o vendedor vende — por isso o aviso fica no card, e
 * não escondido numa ajuda.
 */
function ProdutoCard({
  produto,
  onChange,
}: {
  produto: UserProduct;
  onChange: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  async function enviar(arquivos: FileList | null) {
    if (!arquivos?.length) return;
    const lista = Array.from(arquivos);
    setErro(null);

    // Valida ANTES de subir: 30MB gastos para receber um 413, ou um PDF
    // renomeado para .jpg recusado só depois de atravessar a rede, é tempo do
    // usuário jogado fora.
    const invalida = lista.map(validarFoto).find(Boolean);
    if (invalida) {
      setErro(invalida);
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    const cabem = LIMITES.fotosPorProduto - produto.images.length;
    if (lista.length > cabem) {
      setErro(
        `Cabem mais ${cabem} foto(s) neste produto (limite de ${LIMITES.fotosPorProduto}).`,
      );
      if (inputRef.current) inputRef.current.value = '';
      return;
    }

    setEnviando(true);
    try {
      for (const arquivo of lista) {
        await campaignsService.addPhoto(produto.id, arquivo);
      }
      onChange();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Card>
      <CardContent>
        <Box display="flex" alignItems="center" gap={2}>
          <Box flexGrow={1}>
            <Typography fontWeight={700}>{produto.name}</Typography>
            <Typography variant="body2" color="text.secondary">
              {produto.priceBrl ? `R$ ${Number(produto.priceBrl).toFixed(2)}` : 'sem preço'}
              {produto.benefit ? ` · ${produto.benefit}` : ''}
            </Typography>
          </Box>
          <IconButton
            onClick={async () => {
              await campaignsService.deleteProduct(produto.id);
              onChange();
            }}
          >
            <DeleteOutlineRoundedIcon />
          </IconButton>
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {produto.images.map((foto) => (
            <Box
              key={foto}
              sx={{
                position: 'relative',
                width: 72,
                height: 72,
                borderRadius: 1.5,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
              }}
            >
              <SmartImage src={foto} alt={produto.name} />
              <IconButton
                size="small"
                onClick={async () => {
                  await campaignsService.removePhoto(produto.id, foto);
                  onChange();
                }}
                sx={{
                  position: 'absolute',
                  top: 2,
                  right: 2,
                  bgcolor: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
                }}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}

          {produto.images.length < LIMITES.fotosPorProduto && (
            <Button
              component="label"
              variant="outlined"
              startIcon={enviando ? <CircularProgress size={16} /> : <AddPhotoAlternateRoundedIcon />}
              disabled={enviando}
              sx={{ height: 72, borderStyle: 'dashed' }}
            >
              {enviando ? 'Enviando...' : 'Adicionar foto'}
              <input
                ref={inputRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => void enviar(e.target.files)}
              />
            </Button>
          )}
        </Stack>

        {erro && (
          <Alert severity="error" sx={{ mt: 1.5 }}>
            {erro}
          </Alert>
        )}
        {!produto.images.length && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            Sem foto, o vídeo não mostra o seu produto — a IA desenha um objeto
            parecido. Envie ao menos uma foto para ter cenas de demonstração reais.
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}

function ProdutosTab({
  produtos,
  onChange,
}: {
  produtos: UserProduct[];
  onChange: () => void;
}) {
  const [name, setName] = useState('');
  const [priceBrl, setPriceBrl] = useState<number | null>(null);
  const [benefit, setBenefit] = useState('');
  const [problemSolved, setProblemSolved] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  // Erro só aparece depois que o campo perdeu o foco: acusar "obrigatório" na
  // primeira letra digitada é ruído, não ajuda.
  const [tocado, setTocado] = useState<Record<string, boolean>>({});

  const erros = {
    name: validarNomeProduto(name),
    priceBrl: validarPreco(priceBrl),
    benefit: validarTextoLongo(benefit, LIMITES.beneficio, 'Benefício'),
    problemSolved: validarTextoLongo(problemSolved, LIMITES.problema, 'Problema'),
  };
  const invalido = Object.values(erros).some(Boolean);

  function mostrar(campo: keyof typeof erros): string | undefined {
    return tocado[campo] ? (erros[campo] ?? undefined) : undefined;
  }

  async function salvar() {
    // Ao enviar, tudo passa a ser "tocado": senão o botão fica desabilitado
    // sem o usuário saber qual campo está errado.
    setTocado({ name: true, priceBrl: true, benefit: true, problemSolved: true });
    if (invalido) return;

    setSalvando(true);
    setErro(null);
    try {
      await campaignsService.createProduct({
        name: name.trim(),
        priceBrl: priceBrl ?? undefined,
        benefit: benefit.trim() || undefined,
        problemSolved: problemSolved.trim() || undefined,
      });
      setName('');
      setPriceBrl(null);
      setBenefit('');
      setProblemSolved('');
      setTocado({});
      onChange();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Grid container spacing={3}>
      <Grid item xs={12} md={5}>
        <Card>
          <CardContent>
            <Stack spacing={2}>
              <Typography variant="h6" fontWeight={800}>
                Novo produto
              </Typography>
              <TextField
                required
                label="Nome do produto"
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTocado((t) => ({ ...t, name: true }))}
                error={Boolean(mostrar('name'))}
                helperText={mostrar('name') ?? contador(name, LIMITES.nomeProduto)}
                inputProps={{ maxLength: LIMITES.nomeProduto }}
                fullWidth
              />
              <CurrencyField
                label="Preço"
                value={priceBrl}
                onChange={setPriceBrl}
                onBlur={() => setTocado((t) => ({ ...t, priceBrl: true }))}
                error={Boolean(mostrar('priceBrl'))}
                helperText={mostrar('priceBrl') ?? 'Opcional — entra no CTA do roteiro.'}
                fullWidth
              />
              <TextField
                label="Principal benefício"
                placeholder="Corta tudo em segundos, sem sujeira."
                value={benefit}
                onChange={(e) => setBenefit(e.target.value)}
                onBlur={() => setTocado((t) => ({ ...t, benefit: true }))}
                error={Boolean(mostrar('benefit'))}
                multiline
                minRows={2}
                fullWidth
                inputProps={{ maxLength: LIMITES.beneficio }}
                FormHelperTextProps={{
                  sx: perigoNoContador(benefit, LIMITES.beneficio)
                    ? { color: 'warning.main' }
                    : undefined,
                }}
                helperText={
                  mostrar('benefit') ??
                  `Vira a promessa do gancho. ${contador(benefit, LIMITES.beneficio)}`
                }
              />
              <TextField
                label="Problema que resolve"
                placeholder="Perder 20 minutos picando cebola."
                value={problemSolved}
                onChange={(e) => setProblemSolved(e.target.value)}
                onBlur={() => setTocado((t) => ({ ...t, problemSolved: true }))}
                error={Boolean(mostrar('problemSolved'))}
                multiline
                minRows={2}
                fullWidth
                inputProps={{ maxLength: LIMITES.problema }}
                FormHelperTextProps={{
                  sx: perigoNoContador(problemSolved, LIMITES.problema)
                    ? { color: 'warning.main' }
                    : undefined,
                }}
                helperText={
                  mostrar('problemSolved') ??
                  `Vira a primeira frase do vídeo. ${contador(problemSolved, LIMITES.problema)}`
                }
              />
              {erro && <Alert severity="error">{erro}</Alert>}
              <Button
                variant="contained"
                onClick={salvar}
                // Não desabilita por campo inválido: botão morto sem explicação
                // é o pior dos dois mundos. Clicar revela o que falta.
                disabled={salvando}
              >
                {salvando ? 'Salvando...' : 'Salvar produto'}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Grid>

      <Grid item xs={12} md={7}>
        <Stack spacing={1.5}>
          {!produtos.length && (
            <Alert severity="info">
              Cadastre o produto que você vende para começar uma campanha.
            </Alert>
          )}
          {produtos.map((produto) => (
            <ProdutoCard key={produto.id} produto={produto} onChange={onChange} />
          ))}
        </Stack>
      </Grid>
    </Grid>
  );
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

  const podeCriar = Boolean(userProductId && personaId);

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
                  caption: p.benefit ?? undefined,
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
              {erro && <Alert severity="error">{erro}</Alert>}
              <Button variant="contained" onClick={criar} disabled={!podeCriar}>
                Criar campanha
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

      {aba === 0 && <ProdutosTab produtos={produtos} onChange={recarregar} />}
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
