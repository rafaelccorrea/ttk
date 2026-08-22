import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import MovieFilterRoundedIcon from '@mui/icons-material/MovieFilterRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import RocketLaunchRoundedIcon from '@mui/icons-material/RocketLaunchRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  Grid,
  IconButton,
  InputAdornment,
  MenuItem,
  Pagination,
  Skeleton,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  Switch,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useSaldo } from '@/hooks/useSaldo';
import { useConfirmacao } from '@/components/ui/ConfirmDialog';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { SmartImage } from '@/components/ui/SmartImage';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { MeusProdutos } from '@/components/produtos/MeusProdutos';
import {
  useConfirmarGasto,
  type PedidoDeGasto,
} from '@/hooks/useConfirmarGasto';
import { resolveApiUrl } from '@/services/api';
import { formatMoney } from '@/utils/format';
import {
  LIMITES,
  avisoFalaNoLimite,
  indicadorDeFala,
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
  CampaignStyle,
  CampaignList,
  CampaignPricing,
  CampaignScene,
  Persona,
  SEM_NARRACAO,
  SceneAudioMode,
  SceneKind,
  UserProduct,
  campaignsService,
  cenaSemPessoa,
} from '@/services/campaigns.service';

/**
 * Cena que compõe a foto REAL do produto no frame — demonstração ou
 * apresentador com o produto na mão. A flag vem do roteiro; a regex é só o
 * fallback para cenas gravadas antes dela existir (o mesmo teste do backend).
 */
function cenaUsaProduto(cena: CampaignScene): boolean {
  return (
    cenaSemPessoa(cena.tipo) ||
    cena.tipo === 'apresentador_produto' ||
    cena.seguraProduto ||
    /segur|na m[ãa]o|em m[ãa]os|mostra o produto/i.test(cena.acaoVisual ?? '')
  );
}

/**
 * Troca a foto de onde a cena de produto parte.
 *
 * O vendedor sobe até cinco ângulos e o roteiro escolhe um por cena; quando a
 * escolha não é a que ele queria, o único caminho era gerar o roteiro de novo
 * — e isso é crédito gasto para mudar uma imagem. Aqui a troca é de graça.
 */
function TrocarFotoDialog({
  aberto,
  fotos,
  atual,
  onClose,
  onEscolher,
}: {
  aberto: boolean;
  fotos: string[];
  atual: string | null;
  onClose: () => void;
  onEscolher: (url: string) => void;
}) {
  return (
    <Dialog open={aberto} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontWeight: 800 }}>
        De qual foto esta cena parte?
        <Typography variant="caption" color="text.secondary" display="block">
          É literalmente o primeiro frame do vídeo da cena.
        </Typography>
      </DialogTitle>
      <DialogContent>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          {fotos.map((foto) => {
            const escolhida = foto === atual;
            return (
              <Box
                key={foto}
                component="button"
                type="button"
                onClick={() => onEscolher(foto)}
                aria-label="Usar esta foto na cena"
                sx={{
                  all: 'unset',
                  // `position` depois do `all: unset`, que zera tudo: o
                  // SmartImage é `absolute; inset: 0` e precisa desta âncora.
                  position: 'relative',
                  cursor: 'pointer',
                  width: 104,
                  aspectRatio: '9 / 16',
                  borderRadius: 2,
                  overflow: 'hidden',
                  bgcolor: '#fff',
                  border: '2px solid',
                  borderColor: escolhida ? 'primary.main' : 'divider',
                  boxShadow: (t) =>
                    escolhida ? `0 0 0 4px ${alpha(t.palette.primary.main, 0.16)}` : 'none',
                  transition: 'border-color .15s ease, box-shadow .2s ease',
                }}
              >
                <SmartImage src={foto} alt="Foto do produto" objectFit="contain" />
                {escolhida && (
                  <Chip
                    size="small"
                    label="em uso"
                    sx={{
                      position: 'absolute',
                      bottom: 4,
                      left: 4,
                      height: 18,
                      fontSize: 10,
                      fontWeight: 800,
                      color: '#fff',
                      bgcolor: 'primary.main',
                    }}
                  />
                )}
              </Box>
            );
          })}
        </Stack>
        {!fotos.length && (
          <Alert severity="warning">
            Este produto não tem fotos cadastradas. Envie fotos na aba Produtos.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Fechar</Button>
      </DialogActions>
    </Dialog>
  );
}

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
  // Edição inline de persona existente — nome e voz não mexem no retrato.
  const [editandoNome, setEditandoNome] = useState<string | null>(null);
  const [nomeRascunho, setNomeRascunho] = useState('');
  const grupoVoz = grupos.find((g) => g.key === 'voz');

  async function salvarPersona(id: string, patch: { label?: string; voz?: string }) {
    try {
      await campaignsService.updatePersona(id, patch);
      onChange();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }
  const { confirmar, dialogo } = useConfirmarGasto();
  const saldoImagem = useSaldo('image');

  // Pré-seleciona a primeira opção de cada grupo: campo vazio é erro garantido.
  useEffect(() => {
    if (!grupos.length || Object.keys(attrs).length) return;
    const inicial: Record<string, string> = {};
    for (const grupo of grupos) inicial[grupo.key] = grupo.options[0].id;
    setAttrs(inicial);
  }, [grupos, attrs]);

  // A voz acompanha o gênero: o default é a primeira opção do catálogo
  // (feminina), e persona "Homem" com voz feminina esquecida reproduziria o
  // defeito que este seletor veio corrigir. Trocar o gênero realinha a voz;
  // depois disso o vendedor ainda pode escolher qualquer uma.
  useEffect(() => {
    const genero = attrs.genero;
    const voz = attrs.voz;
    if (!genero || !voz) return;
    const femininas = ['feminina-jovem', 'feminina-madura'];
    const masculinas = ['masculina-jovem', 'masculina-grave'];
    const corrigida =
      genero === 'homem' && femininas.includes(voz)
        ? 'masculina-jovem'
        : genero === 'mulher' && masculinas.includes(voz)
          ? 'feminina-jovem'
          : genero === 'androgino' && voz !== 'androgina'
            ? 'androgina'
            : null;
    if (corrigida) setAttrs((atual) => ({ ...atual, voz: corrigida }));
    // Só quando o GÊNERO muda — reagir a attrs.voz desfaria a escolha manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attrs.genero]);

  const completo = grupos.length > 0 && grupos.every((g) => attrs[g.key]);

  // Foto de referência: vira o retrato direto, sem gerar imagem nem cobrar.
  const [foto, setFoto] = useState<File | null>(null);
  const [fotoPreview, setFotoPreview] = useState<string | null>(null);
  const inputFoto = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!foto) {
      setFotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(foto);
    setFotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [foto]);

  async function criarComFoto() {
    if (!foto) return;
    setGerando(true);
    setErro(null);
    try {
      await campaignsService.createPersonaFromPhoto(foto, {
        label: label.trim() || undefined,
        attrs,
      });
      setLabel('');
      setFoto(null);
      onChange();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setGerando(false);
    }
  }

  async function criar() {
    const autorizado = await confirmar({
      acao: 'image',
      titulo: 'Gerar retrato do apresentador',
      detalhe: 'O retrato é gerado uma vez e reusado em todas as cenas.',
    });
    if (!autorizado) return;
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

              {/* Foto de referência: o rosto vem da foto, os atributos acima
                  só descrevem voz/energia/cenário para o roteiro. Grátis. */}
              <input
                ref={inputFoto}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                hidden
                onChange={(e) => setFoto(e.target.files?.[0] ?? null)}
              />
              {fotoPreview && (
                <Stack direction="row" spacing={1.5} alignItems="center">
                  <Box
                    component="img"
                    src={fotoPreview}
                    alt="Foto de referência"
                    sx={{
                      width: 56,
                      height: 56,
                      borderRadius: 2,
                      objectFit: 'cover',
                      border: '1px solid',
                      borderColor: 'divider',
                    }}
                  />
                  <Typography variant="body2" sx={{ flex: 1 }} noWrap>
                    {foto?.name}
                  </Typography>
                  <IconButton size="small" onClick={() => setFoto(null)} aria-label="Remover foto">
                    <CloseRoundedIcon fontSize="small" />
                  </IconButton>
                </Stack>
              )}
              {foto ? (
                <Button
                  variant="contained"
                  fullWidth
                  startIcon={<AddPhotoAlternateRoundedIcon />}
                  onClick={criarComFoto}
                  disabled={!completo || gerando || Boolean(validarRotuloPersona(label))}
                >
                  {gerando ? 'Salvando apresentador...' : 'Usar esta foto como retrato · grátis'}
                </Button>
              ) : (
                <Button
                  variant="outlined"
                  fullWidth
                  startIcon={<AddPhotoAlternateRoundedIcon />}
                  onClick={() => inputFoto.current?.click()}
                  disabled={gerando}
                >
                  Usar minha foto de referência
                </Button>
              )}
              <Divider>
                <Typography variant="caption" color="text.secondary">
                  ou
                </Typography>
              </Divider>

              {/* Sem saldo o botão trava aqui, e não no 402 depois de a pessoa
                  ter montado a persona inteira escolhendo oito atributos. */}
              <Tooltip title={saldoImagem.motivo}>
                <span>
                  <Button
                    variant={foto ? 'outlined' : 'contained'}
                    fullWidth
                    startIcon={<AutoAwesomeRoundedIcon />}
                    onClick={criar}
                    disabled={
                      !completo ||
                      gerando ||
                      saldoImagem.insuficiente ||
                      Boolean(validarRotuloPersona(label))
                    }
                  >
                    {gerando
                      ? 'Gerando retrato...'
                      : saldoImagem.insuficiente
                        ? 'Créditos insuficientes'
                        : `Gerar retrato com IA${precos ? ` · ${precos.persona} créditos` : ''}`}
                  </Button>
                </span>
              </Tooltip>
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
                  {/* Nome editável no clique: título da persona é como ela
                      aparece nas campanhas, e antes só dava para acertar na
                      criação. Salvar vazio volta ao nome pelos atributos. */}
                  {editandoNome === persona.id ? (
                    <TextField
                      size="small"
                      autoFocus
                      fullWidth
                      value={nomeRascunho}
                      onChange={(e) => setNomeRascunho(e.target.value)}
                      onBlur={() => {
                        void salvarPersona(persona.id, { label: nomeRascunho.trim() });
                        setEditandoNome(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          void salvarPersona(persona.id, { label: nomeRascunho.trim() });
                          setEditandoNome(null);
                        }
                        if (e.key === 'Escape') setEditandoNome(null);
                      }}
                      inputProps={{
                        maxLength: LIMITES.rotuloPersona,
                        style: { fontSize: 14, fontWeight: 700 },
                        'aria-label': 'Nome do apresentador',
                      }}
                    />
                  ) : (
                    <Tooltip title="Clique para renomear">
                      <Typography
                        fontWeight={700}
                        fontSize={14}
                        noWrap
                        sx={{ cursor: 'pointer' }}
                        onClick={() => {
                          setNomeRascunho(persona.label);
                          setEditandoNome(persona.id);
                        }}
                      >
                        {persona.label}
                      </Typography>
                    </Tooltip>
                  )}
                  {/* Voz editável a qualquer momento: ela não entra no prompt
                      do retrato, então trocar é grátis e vale já para a
                      próxima renderização e dublagem. */}
                  {grupoVoz && (
                    <TextField
                      select
                      size="small"
                      fullWidth
                      label={grupoVoz.label}
                      sx={{ mt: 1 }}
                      value={persona.attrs?.voz ?? ''}
                      onChange={(e) =>
                        void salvarPersona(persona.id, { voz: e.target.value })
                      }
                      SelectProps={{ displayEmpty: true }}
                      InputLabelProps={{ shrink: true }}
                    >
                      {!persona.attrs?.voz && (
                        <MenuItem value="" disabled>
                          Padrão do gênero
                        </MenuItem>
                      )}
                      {grupoVoz.options.map((opcao) => (
                        <MenuItem key={opcao.id} value={opcao.id}>
                          {opcao.label}
                        </MenuItem>
                      ))}
                    </TextField>
                  )}
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
      {dialogo}
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
  /** Texto fixo ou calculado a partir do valor digitado (ex.: duração). */
  ajuda?: string | ((valor: string) => string);
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
        erro ??
        alerta ??
        `${ajuda ? `${typeof ajuda === 'function' ? ajuda(valor) : ajuda} ` : ''}${contador(valor, limite)}`
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
  // Cena cuja foto está sendo trocada (null = diálogo fechado).
  const [trocandoFoto, setTrocandoFoto] = useState<string | null>(null);
  // QUAL cena está redublando. O `ocupado` global trava tudo (certo — é uma
  // operação por vez), mas o spinner tem que aparecer só no botão clicado:
  // três botões girando juntos liam como "redublou as três".
  const [redublando, setRedublando] = useState<string | null>(null);
  /**
   * Status da redublagem, preso à CENA e com desfecho.
   *
   * O aviso no topo da página falava de "cena 1" longe da cena 1 — e sumia
   * sem dizer se deu certo. Aqui a mensagem nasce embaixo da cena clicada e
   * termina em sucesso ("voz regravada") ou no motivo da falha.
   */
  const [redubStatus, setRedubStatus] = useState<{
    id: string;
    msg: string;
    tipo: 'info' | 'success' | 'error';
  } | null>(null);

  const verificarRedub = useCallback(
    async (cenaId: string, tentativa = 0) => {
      const d = await campaignsService.detail(detalhe.id).catch(() => null);
      const c = d?.cenas.find((x) => x.id === cenaId);
      if (c?.error?.startsWith('Redublagem')) {
        setRedubStatus({ id: cenaId, msg: c.error, tipo: 'error' });
      } else if (c?.outputUrl?.includes('-ptbr')) {
        setRedubStatus({
          id: cenaId,
          msg: 'Voz regravada em português. ✓',
          tipo: 'success',
        });
      } else if (tentativa < 2) {
        // Ainda processando: reconsulta em vez de declarar um desfecho falso.
        setTimeout(() => void verificarRedub(cenaId, tentativa + 1), 10000);
        return;
      } else {
        setRedubStatus({
          id: cenaId,
          msg: 'A regravação está demorando — recarregue em instantes para conferir.',
          tipo: 'info',
        });
      }
      onChange();
    },
    [detalhe.id, onChange],
  );
  const [confirmarTudo, setConfirmarTudo] = useState(false);
  const { saldo, ilimitado } = useSaldo('video');
  const { confirmar, dialogo } = useConfirmarGasto();
  // Refazer cena: reabrir é grátis, mas invalida o vídeo final e o render
  // novo cobra — merece uma confirmação própria, sem ser a de gasto.
  const { confirmar: confirmarRefazer, dialogoDeConfirmacao: dialogoRefazer } =
    useConfirmacao();

  const personaPronta = detalhe.persona?.status === 'pronta';
  const todasProntas =
    detalhe.cenas.length > 0 && detalhe.cenas.every((c) => c.status === 'pronta');

  const fotosDoProduto = detalhe.produto?.images ?? [];
  const cenaEmTroca = detalhe.cenas.find((c) => c.id === trocandoFoto) ?? null;

  /**
   * Espelha a escolha do backend na renderização: a foto marcada na cena se
   * ainda existir no produto, senão a capa. É o que faz o cartão mostrar a
   * MESMA foto que vai entrar na mão do apresentador — antes a composição era
   * anunciada no selo mas nenhuma foto aparecia, e o vendedor não sabia qual
   * produto ia aparecer.
   */
  const fotoCompostaDa = (cena: CampaignScene): string | null =>
    cena.baseImageUrl && fotosDoProduto.includes(cena.baseImageUrl)
      ? cena.baseImageUrl
      : (fotosDoProduto[0] ?? null);

  // O que ainda falta pagar: cena pendente ou que falhou. Renderizando já foi
  // cobrada, e pronta idem — somá-las inflaria o total do diálogo.
  const faltaRenderizar = detalhe.cenas.filter(
    (c) => c.status === 'pendente' || c.status === 'falhou',
  );
  const custoTotal = precos ? faltaRenderizar.length * precos.cena : null;
  const semSaldo =
    !ilimitado && saldo !== null && custoTotal !== null && saldo < custoTotal;
  // A fila (`renderQueue`) conta como "renderizando": o servidor gera as
  // cenas uma por vez, e entre um disparo e outro pode não haver nenhuma cena
  // com status `renderizando` — mas a campanha continua trabalhando.
  const renderizando =
    detalhe.renderQueue || detalhe.cenas.some((c) => c.status === 'renderizando');
  // O backend bloqueia regerar depois da primeira cena pronta (seria jogar o
  // crédito dela fora) — o botão segue a mesma regra para nem oferecer o erro.
  const algumaPronta = detalhe.cenas.some((c) => c.status === 'pronta');

  /**
   * @param gasto quando informado, pede confirmação antes de executar.
   *
   * A confirmação entra AQUI, e não em cada botão, porque as três ações pagas
   * desta tela já passavam por este mesmo caminho. Espalhar o diálogo pelos
   * `onClick` deixaria a próxima ação paga nascer sem ele — que é exatamente
   * como o Multiplicador ficou sem aviso nenhum.
   */
  async function acao(fn: () => Promise<unknown>, gasto?: PedidoDeGasto) {
    // Guarda de reentrância. `disabled={ocupado}` só passa a valer depois do
    // repinte do React, e dois cliques rápidos cabem nessa janela — em
    // "Gerar roteiro" e "Renderizar cena" isso é crédito cobrado duas vezes.
    if (ocupado) return;
    // Antes da trava: cancelar no diálogo não pode deixar a tela ocupada.
    if (gasto && !(await confirmar(gasto))) return;
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

      {/* Legenda é escolha: quem usa a legenda automática do TikTok acabava
          com duas sobrepostas. Mudar com o final pronto descarta o arquivo e a
          montagem automática refaz com a escolha nova. Campanha muda não tem
          fala nenhuma — não há o que legendar. */}
      {detalhe.vozNarrador !== SEM_NARRACAO && (
      <FormControlLabel
        sx={{ alignSelf: 'flex-start', ml: 0 }}
        control={
          <Switch
            checked={detalhe.subtitles ?? true}
            disabled={ocupado}
            onChange={(e) =>
              void acao(() =>
                campaignsService.update(detalhe.id, { subtitles: e.target.checked }),
              )
            }
          />
        }
        label={
          <Typography variant="body2" color="text.secondary">
            Legendas no vídeo final (as falas queimadas na tela)
          </Typography>
        }
      />
      )}

      {/* A fala não entra no prompt do vídeo (só a ação visual entra), então o
          clipe sai sem narração automática. Prometer implicitamente o
          contrário — deixando o vendedor revisar cada fala com cuidado — e
          entregar um vídeo mudo é a pior surpresa possível depois do gasto. */}
      {detalhe.cenas.length > 0 && !detalhe.finalVideoUrl && (
        <Alert severity="info" variant="outlined">
          A <strong>fala</strong> de cada cena é dita pelo apresentador em
          português e vira legenda no vídeo final — revise o texto antes de
          renderizar, porque é exatamente isso que sai no áudio.
        </Alert>
      )}

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
                onClick={() =>
                  acao(() => campaignsService.assemble(detalhe.id))
                }
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
                onClick={() => acao(() => campaignsService.generateScript(detalhe.id), {
                    acao: 'script',
                    titulo: 'Gerar roteiro e storyboard',
                  })}
              >
                {ocupado
                  ? 'Escrevendo...'
                  : `Gerar roteiro${precos ? ` · ${precos.roteiro} créditos` : ''}`}
              </Button>
            </Stack>
          </CardContent>
        </Card>
      )}

      {/* O roteiro não precisa ser aceito de primeira: outra versão custa o
          mesmo que a primeira e sai em segundos. Escondê-lo atrás de "apague a
          campanha e crie outra" fazia o vendedor conviver com um roteiro que
          ele não gostou. */}
      {detalhe.cenas.length > 0 && !algumaPronta && !renderizando && (
        <Button
          variant="text"
          size="small"
          sx={{ alignSelf: 'flex-start' }}
          startIcon={<AutoAwesomeRoundedIcon />}
          disabled={ocupado}
          onClick={() => acao(() => campaignsService.generateScript(detalhe.id), {
                    acao: 'script',
                    titulo: 'Gerar roteiro e storyboard',
                  })}
        >
          Não gostou? Escrever outra versão
          {precos ? ` · ${precos.roteiro} créditos` : ''}
        </Button>
      )}

      {/* A ação que o vendedor quer é UMA: sair daqui com o vídeo. Renderizar
          cena por cena e depois montar à mão era ele executando o pipeline no
          lugar do produto. */}
      {faltaRenderizar.length > 0 && (
        <Card
          sx={{
            borderColor: 'primary.main',
            background: (t) => alpha(t.palette.primary.main, 0.04),
          }}
        >
          <CardContent>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={2}
              alignItems={{ sm: 'center' }}
            >
              <Box flexGrow={1}>
                <Typography fontWeight={800}>Gerar o vídeo completo</Typography>
                <Typography variant="body2" color="text.secondary">
                  Renderiza as {faltaRenderizar.length} cena(s) que faltam e junta
                  tudo num vídeo 9:16 sozinho, quando a última ficar pronta.
                </Typography>
              </Box>
              <Button
                variant="contained"
                size="large"
                startIcon={
                  ocupado || renderizando ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <RocketLaunchRoundedIcon />
                  )
                }
                disabled={ocupado || renderizando}
                onClick={() => setConfirmarTudo(true)}
                sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
              >
                {renderizando
                  ? 'Gerando...'
                  : `Gerar vídeo completo${custoTotal !== null ? ` · ${custoTotal} créditos` : ''}`}
              </Button>
            </Stack>
            {/* Cancelar só desliga o que AINDA NÃO disparou — e isso é grátis.
                A cena em voo termina, porque o crédito dela já foi debitado. */}
            {detalhe.renderQueue && (
              <Button
                size="small"
                color="inherit"
                sx={{ mt: 1, color: 'text.secondary' }}
                disabled={ocupado}
                onClick={() => acao(() => campaignsService.cancelQueue(detalhe.id))}
              >
                Cancelar as cenas na fila (não cobra nada)
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {/* Confirmação do total: é o maior gasto da tela, e um clique sem aviso
          num botão desse tamanho é crédito queimado sem volta. */}
      <Dialog
        open={confirmarTudo}
        onClose={() => setConfirmarTudo(false)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle sx={{ fontWeight: 800 }}>Gerar o vídeo completo?</DialogTitle>
        <DialogContent>
          <Stack spacing={1}>
            <Typography variant="body2">
              {faltaRenderizar.length} cena(s) serão renderizadas
              {precos ? ` a ${precos.cena} créditos cada` : ''}.
            </Typography>
            {custoTotal !== null && (
              <Typography variant="h6" fontWeight={800} color="primary.main">
                Total: {custoTotal} créditos
              </Typography>
            )}
            {!ilimitado && saldo !== null && (
              <Typography variant="caption" color={semSaldo ? 'error.main' : 'text.secondary'}>
                Seu saldo: {saldo} créditos
                {semSaldo ? ' — não dá para gerar todas agora.' : ''}
              </Typography>
            )}
            <Typography variant="caption" color="text.secondary">
              A montagem final não custa créditos. Cena que falhar é estornada.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmarTudo(false)}>Cancelar</Button>
          <Button
            variant="contained"
            disabled={ocupado || semSaldo}
            startIcon={<RocketLaunchRoundedIcon />}
            /*
             * SEM `gasto` aqui: este botão já está DENTRO da confirmação.
             *
             * O diálogo acima é feito sob medida para este gasto — diz quantas
             * cenas faltam, o preço de cada uma, o total, o saldo, que a
             * montagem final é de graça e que cena falhada é estornada. A
             * confirmação genérica não sabe nada disso, e encadeá-la aqui só
             * produzia duas telas seguidas perguntando a mesma coisa, sendo a
             * segunda pior que a primeira.
             */
            onClick={() => {
              setConfirmarTudo(false);
              void acao(() => campaignsService.renderAll(detalhe.id));
            }}
          >
            Gerar agora
          </Button>
        </DialogActions>
      </Dialog>

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
                    // `relative` é obrigatório: o SmartImage se posiciona com
                    // `absolute; inset: 0`. Sem âncora aqui ele subia até o
                    // primeiro ancestral posicionado e o frame da cena cobria
                    // a página inteira — a tela do storyboard virava uma foto
                    // gigante por cima de tudo.
                    position: 'relative',
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
                    <Stack alignItems="center" spacing={1} px={2}>
                      <BrandLoader minHeight={120} />
                      {/* Por que NÃO tem cancelar aqui: o crédito desta cena
                          foi debitado na submissão à fornecedora e abortar lá
                          não estorna — cancelar agora só jogaria o crédito
                          fora. Se a geração falhar, o estorno é automático. */}
                      <Typography variant="caption" color="text.secondary" textAlign="center">
                        Gerando — esta cena já foi cobrada e não dá mais para
                        cancelar. Se falhar, o crédito volta sozinho.
                      </Typography>
                    </Stack>
                  ) : cena.status === 'pendente' && detalhe.renderQueue ? (
                    // Na fila: o servidor vai disparar esta cena sozinho
                    // quando a anterior terminar. O cancelar fica AQUI, no
                    // cartão da cena — o botão global embaixo do "Gerar vídeo
                    // completo" existia, mas quem quer parar olha para a cena.
                    <Stack alignItems="center" spacing={1} px={2}>
                      <CircularProgress size={20} color="inherit" />
                      <Typography variant="caption" color="text.secondary" textAlign="center">
                        Na fila — gera sozinha quando a cena anterior terminar.
                      </Typography>
                      <Tooltip title="Desliga a fila inteira: nenhuma cena que ainda não começou será gerada nem cobrada. A cena que já está gerando termina normalmente.">
                        <Button
                          size="small"
                          color="inherit"
                          sx={{ color: 'text.secondary' }}
                          disabled={ocupado}
                          onClick={() =>
                            acao(() => campaignsService.cancelQueue(detalhe.id))
                          }
                        >
                          Cancelar (não cobra nada)
                        </Button>
                      </Tooltip>
                    </Stack>
                  ) : cena.status === 'falhou' ? (
                    <Typography variant="body2" color="text.secondary" px={2} textAlign="center">
                      {cena.error ?? 'A cena falhou.'} Os créditos foram estornados.
                    </Typography>
                  ) : cenaSemPessoa(cena.tipo) && cena.baseImageUrl ? (
                    // Pré-visualização honesta: é literalmente o frame de onde
                    // a cena vai partir. SÓ na demonstração — na cena de
                    // apresentador o frame parte do retrato e a foto escolhida
                    // entra apenas como referência da composição; usar a foto
                    // como preview aqui fazia a troca parecer que substituía a
                    // cena inteira, apresentador incluído.
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

                  {/* Qual foto do produto entra na mão do apresentador. O selo
                      dizia "com o SEU produto" mas nenhuma foto aparecia — e
                      sem escolha o servidor usa a capa em silêncio. A
                      miniatura mostra a MESMA foto que a renderização vai
                      compor; "Trocar foto" muda as duas. */}
                  {!cenaSemPessoa(cena.tipo) &&
                    cenaUsaProduto(cena) &&
                    !(cena.status === 'pronta' && cena.outputUrl) &&
                    fotoCompostaDa(cena) && (
                      <Tooltip
                        title={
                          fotosDoProduto.length > 1
                            ? `É esta foto do produto que entra na mão do apresentador. Clique para escolher entre as ${fotosDoProduto.length} fotos.`
                            : 'É esta foto do produto que entra na mão do apresentador.'
                        }
                      >
                        <Box
                          component="button"
                          type="button"
                          aria-label="Escolher qual foto do produto entra nesta cena"
                          onClick={() => setTrocandoFoto(cena.id)}
                          disabled={
                            ocupado ||
                            cena.status === 'renderizando' ||
                            fotosDoProduto.length < 2
                          }
                          sx={{
                            all: 'unset',
                            // `position` depois do `all: unset`, que zera
                            // tudo: o SmartImage é `absolute; inset: 0` e
                            // precisa desta âncora.
                            position: 'absolute',
                            right: 8,
                            bottom: 8,
                            width: 64,
                            aspectRatio: '3 / 4',
                            borderRadius: 1.5,
                            overflow: 'hidden',
                            border: '2px solid',
                            borderColor: 'background.paper',
                            boxShadow: 3,
                            bgcolor: 'background.paper',
                            cursor:
                              fotosDoProduto.length > 1 ? 'pointer' : 'default',
                          }}
                        >
                          <SmartImage
                            src={fotoCompostaDa(cena)!}
                            alt="Foto do produto que entra nesta cena"
                          />
                        </Box>
                      </Tooltip>
                    )}
                </Box>

                {/* Status da redublagem DESTA cena: progresso, sucesso ou o
                    motivo da falha — no lugar onde o clique aconteceu. */}
                {redubStatus?.id === cena.id && (
                  <Alert
                    severity={redubStatus.tipo}
                    variant="outlined"
                    sx={{ mt: 1 }}
                    onClose={() => setRedubStatus(null)}
                  >
                    {redubStatus.msg}
                  </Alert>
                )}
                {/* Falha registrada no servidor (ex.: de uma tentativa
                    anterior) — visível mesmo sem clique nesta sessão. */}
                {cena.status === 'pronta' &&
                  cena.error &&
                  redubStatus?.id !== cena.id && (
                    <Alert severity="warning" sx={{ mt: 1 }} variant="outlined">
                      {cena.error}
                    </Alert>
                  )}

                {/* As ações da cena numa fileira discreta sob o vídeo — os
                    botões empilhados em largura total disputavam atenção com o
                    conteúdo e alongavam o card. */}
                <Stack direction="row" spacing={1} mt={1} flexWrap="wrap" useFlexGap>
                  {cena.status === 'pronta' && cena.outputUrl && (
                    <>
                      {/* Refazer só ESTA cena: reabre para edição e o render
                          novo substitui o vídeo atual. As outras cenas ficam
                          como estão — não é preciso regenerar a campanha. */}
                      <Tooltip title="Reabre a cena para editar fala, ação ou foto e renderizar de novo. Só a nova renderização cobra créditos; as outras cenas não mudam.">
                        <span>
                          <Button
                            size="small"
                            variant="outlined"
                            color="inherit"
                            startIcon={<PlayArrowRoundedIcon />}
                            disabled={ocupado || detalhe.renderQueue}
                            onClick={async () => {
                              const ok = await confirmarRefazer({
                                titulo: `Refazer a cena ${cena.ordem}?`,
                                mensagem: `A cena volta para edição e o vídeo atual dela é substituído quando você renderizar de novo${
                                  precos ? ` (${precos.cena} créditos)` : ''
                                }. O vídeo final será remontado com a cena nova.`,
                                textoConfirmar: 'Refazer cena',
                                destrutivo: false,
                              });
                              if (!ok) return;
                              await acao(() => campaignsService.reopenScene(cena.id));
                            }}
                          >
                            Refazer cena
                          </Button>
                        </span>
                      </Tooltip>
                      <Tooltip title="Baixar o MP4 desta cena">
                        <Button
                          size="small"
                          variant="outlined"
                          color="inherit"
                          startIcon={<DownloadRoundedIcon />}
                          component="a"
                          href={resolveApiUrl(cena.outputUrl)}
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Baixar
                        </Button>
                      </Tooltip>
                      {/* Redublar só FUNCIONA em cena de produto (no
                          apresentador a voz nasce sincronizada com os lábios;
                          TTS dessincronizaria a boca). Antes o botão sumia
                          nas demais e parecia bug — agora aparece sempre,
                          desabilitado com o motivo no tooltip. */}
                      {(() => {
                        const motivo =
                          !cenaSemPessoa(cena.tipo)
                            ? 'Indisponível em cena de apresentador: a voz nasce sincronizada com os lábios no próprio vídeo — regravar por cima dessincronizaria a boca.'
                            : cena.modoAudio === 'sem_fala'
                              ? 'Esta cena foi gerada sem fala — só o som ambiente.'
                              : !cena.fala?.trim()
                                ? 'Esta cena não tem fala para regravar.'
                                : null;
                        return (
                          <Tooltip
                            title={
                              motivo ??
                              'Regrava só a voz em português. Não consome créditos — o vídeo final é remontado com o novo áudio.'
                            }
                          >
                            {/* span: Tooltip não dispara em botão desabilitado. */}
                            <span>
                              <Button
                                size="small"
                                variant="outlined"
                                color="inherit"
                                startIcon={
                                  redublando === cena.id ? (
                                    <CircularProgress size={14} color="inherit" />
                                  ) : (
                                    <AutoAwesomeRoundedIcon />
                                  )
                                }
                                disabled={ocupado || Boolean(motivo)}
                                onClick={async () => {
                                  setRedublando(cena.id);
                                  try {
                                    await acao(() => campaignsService.redubScene(cena.id));
                                    // O servidor regrava em background; a
                                    // verificação agendada fecha o ciclo com
                                    // sucesso ou com o motivo da falha.
                                    setRedubStatus({
                                      id: cena.id,
                                      msg: 'Regravando a voz em português — o vídeo atualiza sozinho em instantes.',
                                      tipo: 'info',
                                    });
                                    setTimeout(() => void verificarRedub(cena.id), 15000);
                                  } finally {
                                    setRedublando(null);
                                  }
                                }}
                              >
                                {redublando === cena.id
                                  ? 'Redublando...'
                                  : 'Redublar · grátis'}
                              </Button>
                            </span>
                          </Tooltip>
                        );
                      })()}
                    </>
                  )}
                  {/* Trocar a foto é grátis e só faz sentido antes de
                      renderizar — depois de pronta, o vídeo já existe. Vale
                      para a demonstração E para a cena com o produto na mão
                      (a foto escolhida é a que entra na composição). */}
                  {cenaUsaProduto(cena) && cena.status !== 'pronta' && (
                    <Tooltip title="Escolher qual foto do produto aparece nesta cena (grátis)">
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        startIcon={<PhotoLibraryRoundedIcon />}
                        onClick={() => setTrocandoFoto(cena.id)}
                        disabled={ocupado || cena.status === 'renderizando'}
                      >
                        Trocar foto
                      </Button>
                    </Tooltip>
                  )}
                </Stack>
              </Grid>

              <Grid item xs={12} sm={7}>
                <Stack spacing={1.5}>
                  <Chip
                    size="small"
                    label={
                      cena.tipo === 'mao_produto'
                        ? 'Só as mãos · parte da sua foto'
                        : cena.tipo === 'unboxing'
                          ? 'Unboxing · parte da sua foto'
                          : cenaSemPessoa(cena.tipo)
                            ? 'Demonstração · parte da sua foto'
                            : // Quando a cena compõe o produto no frame, o selo
                              // precisa dizer isso — senão a cena mais cara do
                              // roteiro passa por uma cena comum.
                              cenaUsaProduto(cena)
                              ? 'Apresentador · com o SEU produto na mão'
                              : 'Apresentador · parte do retrato'
                    }
                    color={cenaUsaProduto(cena) ? 'primary' : 'default'}
                    sx={{ alignSelf: 'flex-start', fontWeight: 700 }}
                  />
                  {/* O formato e o áudio são escolha do vendedor, não só da
                      IA. Cena pronta não muda mais: trocar o formato invalida
                      o render, e o vídeo já foi pago. */}
                  {cena.status !== 'pronta' && (
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <TextField
                        select
                        size="small"
                        label="Tipo de cena"
                        value={cena.tipo}
                        disabled={cena.status === 'renderizando'}
                        sx={{ minWidth: 230 }}
                        onChange={(e) =>
                          acao(() =>
                            campaignsService.updateScene(cena.id, {
                              tipoCena: e.target.value as SceneKind,
                            }),
                          )
                        }
                      >
                        {/* Campanha sem apresentador não tem retrato: as duas
                            opções com pessoa ficam fora da lista. */}
                        {detalhe.estilo !== 'sem_apresentador' && [
                          <MenuItem key="apresentador" value="apresentador">
                            Apresentador falando
                          </MenuItem>,
                          <MenuItem
                            key="apresentador_produto"
                            value="apresentador_produto"
                          >
                            Apresentador com o produto na mão
                          </MenuItem>,
                        ]}
                        <MenuItem value="mao_produto">
                          Só as mãos usando o produto
                        </MenuItem>
                        <MenuItem value="unboxing">Unboxing da embalagem</MenuItem>
                        <MenuItem value="produto_close">Produto em close</MenuItem>
                      </TextField>
                      {/* Campanha muda: toda cena é "sem fala" por definição —
                          um select de opção única só levantaria dúvida. */}
                      {detalhe.vozNarrador !== SEM_NARRACAO && (
                      <TextField
                        select
                        size="small"
                        label="Áudio"
                        value={
                          cena.modoAudio ??
                          (cenaSemPessoa(cena.tipo) ? 'narracao' : 'fala')
                        }
                        disabled={cena.status === 'renderizando'}
                        sx={{ minWidth: 170 }}
                        onChange={(e) =>
                          acao(() =>
                            campaignsService.updateScene(cena.id, {
                              modoAudio: e.target.value as SceneAudioMode,
                            }),
                          )
                        }
                      >
                        {/* Fala é lip-sync: só existe com apresentador. E o
                            apresentador não aceita narração por cima — a boca
                            dessincronizaria. Campanha criada sem narração não
                            tem voz nenhuma: sobra só o "sem fala". */}
                        {detalhe.vozNarrador !== SEM_NARRACAO &&
                          (cenaSemPessoa(cena.tipo) ? (
                            <MenuItem value="narracao">Narração em off</MenuItem>
                          ) : (
                            <MenuItem value="fala">Fala (lábios sincronizados)</MenuItem>
                          ))}
                        <MenuItem value="sem_fala">Sem fala · só a cena</MenuItem>
                      </TextField>
                      )}
                    </Stack>
                  )}
                  {/* Campanha muda não tem fala em cena nenhuma — o campo só
                      confundiria ("fala de quê, se não tem voz?"). */}
                  {detalhe.vozNarrador !== SEM_NARRACAO && (
                    <CampoDeCena
                      rotulo={`Cena ${cena.ordem} — fala`}
                      valorSalvo={cena.fala}
                      bloqueado={cena.status === 'pronta'}
                      validar={validarFala}
                      aviso={avisoFalaNoLimite}
                      ajuda={indicadorDeFala}
                      limite={LIMITES.fala}
                      salvar={(valor) =>
                        acao(() => campaignsService.updateScene(cena.id, { fala: valor }))
                      }
                    />
                  )}
                  <CampoDeCena
                    rotulo="O que aparece na tela"
                    valorSalvo={cena.acaoVisual}
                    bloqueado={cena.status === 'pronta'}
                    validar={validarAcaoVisual}
                    limite={LIMITES.acaoVisual}
                    ajuda={
                      cenaSemPessoa(cena.tipo)
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
                        // Com a fila ligada é o servidor quem dispara: o
                        // clique aqui duplicaria o pedido da mesma cena.
                        detalhe.renderQueue ||
                        (!cenaSemPessoa(cena.tipo) && !personaPronta)
                      }
                      onClick={() =>
                        acao(() => campaignsService.renderScene(cena.id), {
                          acao: 'video',
                          titulo: 'Renderizar cena',
                        })
                      }
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

      <TrocarFotoDialog
        aberto={Boolean(cenaEmTroca)}
        fotos={fotosDoProduto}
        // `fotoCompostaDa`, e não o campo cru: cena sem escolha explícita usa
        // a capa na renderização, e o diálogo precisa destacar essa realidade
        // em vez de abrir sem nenhuma foto marcada.
        atual={cenaEmTroca ? fotoCompostaDa(cenaEmTroca) : null}
        onClose={() => setTrocandoFoto(null)}
        onEscolher={(url) => {
          const id = cenaEmTroca?.id;
          setTrocandoFoto(null);
          if (id) void acao(() => campaignsService.updateScene(id, { baseImageUrl: url }));
        }}
      />
      {dialogo}
      {dialogoRefazer}
    </Stack>
  );
}

// --------------------------------------------------------------- campanhas
function CampanhasTab({
  etapa,
  onEtapa,
  produtos,
  personas,
  grupos,
  campanhas,
  pagina,
  paginas,
  onPagina,
  busca,
  onBusca,
  precos,
  onChange,
}: {
  /** Passo escolhido lá em cima — voltar para "Roteiro" fecha a campanha. */
  etapa: number;
  /** Avisa a página se estamos montando o roteiro (2) ou vendo o vídeo (3). */
  onEtapa: (etapa: number) => void;
  produtos: UserProduct[];
  personas: Persona[];
  /** Catálogo de atributos — daqui sai a lista de vozes do narrador. */
  grupos: AttributeGroup[];
  /** Só a página atual — quem pagina é o servidor. */
  campanhas: Campaign[];
  pagina: number;
  paginas: number;
  onPagina: (pagina: number) => void;
  /** O termo digitado; quem busca é a API, atravessando todas as páginas. */
  busca: string;
  onBusca: (termo: string) => void;
  precos: CampaignPricing | null;
  onChange: () => void;
}) {
  const [userProductId, setUserProductId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [durationSeconds, setDuration] = useState(15);
  const [estilo, setEstilo] = useState<CampaignStyle>('misto');
  const [vozNarrador, setVozNarrador] = useState('');
  // Sem apresentador a voz é obrigatória na API; sem um default o botão de
  // criar ficava travado sem explicar. A primeira voz do catálogo já vem
  // selecionada — dá para trocar, mas nunca ficar sem.
  const vozesDoCatalogo = grupos.find((g) => g.key === 'voz')?.options ?? [];
  const primeiraVoz = vozesDoCatalogo[0]?.id ?? '';
  useEffect(() => {
    if (estilo === 'sem_apresentador' && !vozNarrador && primeiraVoz) {
      setVozNarrador(primeiraVoz);
    }
  }, [estilo, vozNarrador, primeiraVoz]);
  // Excluir campanha descarta roteiro e cenas já PAGAS — clique acidental na
  // lixeira da lista não pode custar créditos.
  const { confirmar, dialogoDeConfirmacao } = useConfirmacao();
  // Trava de clique repetido. Sem ela, cada clique durante a espera da rede
  // criava uma campanha — e cada campanha é um roteiro a caminho, ou seja,
  // crédito queimado por impaciência. O estado sobe ANTES do await.
  const [criando, setCriando] = useState(false);
  // A campanha aberta mora na URL (/campanhas/:id), não em estado local:
  // assim dá para recarregar, voltar com o botão do navegador e compartilhar
  // o link de uma campanha específica.
  const { id: aberta = null } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const setAberta = useCallback(
    (id: string | null) => navigate(id ? `/campanhas/${id}` : '/campanhas'),
    [navigate],
  );
  const [detalhe, setDetalhe] = useState<CampaignDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  // Batida do polling. O efeito abaixo dependia só de `detalhe`: quando um
  // refresh falhava (500, rede), o estado não mudava, o efeito não rodava de
  // novo e o polling MORRIA — a cena ficava "renderizando" para sempre na
  // tela mesmo com a geração concluída no servidor. O contador re-arma o
  // timer aconteça o que acontecer com a consulta.
  const [batidaDePolling, setBatidaDePolling] = useState(0);

  // O passo do topo acompanha o que está na tela: lista/criação é "Roteiro",
  // campanha aberta é "Vídeo". Sem isto o cabeçalho mente sobre onde a pessoa
  // está.
  useEffect(() => {
    onEtapa(aberta ? 3 : 2);
  }, [aberta, onEtapa]);

  // Clicar em "Roteiro" no topo com uma campanha aberta volta para a lista.
  //
  // Mas SÓ quando a etapa MUDOU para 2 — comparar apenas o valor fechava a
  // campanha no instante de abrir: os dois efeitos rodam no mesmo commit, e
  // este aqui ainda enxergava a etapa antiga (2) com `aberta` recém-setada,
  // desfazendo o clique em "Abrir" antes de a tela aparecer.
  const etapaAnterior = useRef(etapa);
  useEffect(() => {
    const mudouParaRoteiro = etapa === 2 && etapaAnterior.current === 3;
    etapaAnterior.current = etapa;
    if (mudouParaRoteiro && aberta) setAberta(null);
  }, [etapa, aberta, setAberta]);

  const carregarDetalhe = useCallback(async (id: string) => {
    /*
     * Duas fases, de propósito. O `refresh` consulta a fornecedora e pode
     * rodar dublagem e montagem — segundos de ffmpeg dentro do request. Com
     * ele na frente, clicar em "Abrir" deixava a tela em branco até o
     * servidor terminar de trabalhar. O detalhe puro chega em milissegundos e
     * pinta a tela; o refresh atualiza por cima quando terminar.
     */
    const rapido = await campaignsService.detail(id).catch(() => null);
    if (rapido) setDetalhe(rapido);
    const dados = await campaignsService.refresh(id);
    setDetalhe(dados);
  }, []);

  useEffect(() => {
    if (!aberta) {
      setDetalhe(null);
      return;
    }
    // Id inválido na URL (campanha excluída, link errado): volta para a lista
    // em vez de deixar a tela da lista com uma URL que promete outra coisa.
    void carregarDetalhe(aberta).catch((error) => {
      console.error(error);
      setErro(mensagemDeErro(error));
      setAberta(null);
    });
  }, [aberta, carregarDetalhe, setAberta]);

  // Só consulta enquanto existe algo em andamento — parado, não gera tráfego.
  useEffect(() => {
    if (!aberta || !detalhe) return;
    const cenasProntas =
      detalhe.cenas.length > 0 && detalhe.cenas.every((c) => c.status === 'pronta');
    const emAndamento =
      detalhe.persona?.status === 'gerando' ||
      // Fila ligada: é o refresh que dispara a próxima cena — parar de
      // consultar aqui congelaria a fila no meio.
      detalhe.renderQueue ||
      detalhe.cenas.some((c) => c.status === 'renderizando') ||
      // Cenas prontas SEM vídeo final: é o refresh que monta — parar aqui
      // era o que obrigava o usuário a dar F5 para ver o vídeo aparecer.
      (cenasProntas && !detalhe.finalVideoUrl);
    if (!emAndamento) return;
    const timer = setTimeout(async () => {
      try {
        await carregarDetalhe(aberta);
      } catch (error) {
        console.error(error);
      } finally {
        // Mesmo em falha o próximo tique é agendado — ver `batidaDePolling`.
        setBatidaDePolling((b) => b + 1);
      }
    }, POLL_MS);
    return () => clearTimeout(timer);
  }, [aberta, detalhe, batidaDePolling, carregarDetalhe]);

  async function criar() {
    // Guarda de reentrância: o `disabled` do botão depende do React ter
    // repintado, e dois cliques rápidos cabem antes disso.
    if (criando) return;
    setCriando(true);
    setErro(null);
    try {
      const nova = await campaignsService.create({
        userProductId,
        durationSeconds,
        estilo,
        // Sem apresentador a voz é a única fonte de áudio; nos demais estilos
        // a voz vem da persona e o campo nem é enviado.
        ...(estilo === 'sem_apresentador'
          ? { vozNarrador }
          : { personaId }),
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
  const podeCriar =
    Boolean(
      userProductId &&
        (estilo === 'sem_apresentador' ? vozNarrador : personaId),
    ) &&
    !fotosFaltando &&
    !criando;
  const vozes = vozesDoCatalogo;

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
              <TextField
                select
                label="Estilo do criativo"
                value={estilo}
                onChange={(e) => setEstilo(e.target.value as CampaignStyle)}
                fullWidth
                helperText={
                  estilo === 'sem_apresentador'
                    ? 'Só o produto em quadro: mãos usando, unboxing e closes, com narração em off.'
                    : estilo === 'ugc'
                      ? 'Todas as cenas com a pessoa em quadro, estilo UGC.'
                      : 'A IA mistura apresentador e demonstrações do produto.'
                }
              >
                <MenuItem value="misto">Misto · a IA decide cena a cena</MenuItem>
                <MenuItem value="ugc">Com apresentador (UGC)</MenuItem>
                <MenuItem value="sem_apresentador">
                  Sem apresentador · só produto
                </MenuItem>
              </TextField>
              {estilo === 'sem_apresentador' ? (
                <TextField
                  select
                  label="Voz do narrador"
                  value={vozNarrador}
                  onChange={(e) => setVozNarrador(e.target.value)}
                  fullWidth
                  helperText={
                    vozNarrador === SEM_NARRACAO
                      ? 'O vídeo sai mudo: só o som ambiente das cenas, sem voz.'
                      : 'É a voz que narra as cenas em off.'
                  }
                >
                  {vozes.map((v) => (
                    <MenuItem key={v.id} value={v.id}>
                      {v.label}
                    </MenuItem>
                  ))}
                  <MenuItem value={SEM_NARRACAO}>
                    Sem narração · vídeo sem voz
                  </MenuItem>
                </TextField>
              ) : (
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
              )}
              <TextField
                select
                label="Duração"
                value={durationSeconds}
                onChange={(e) => setDuration(Number(e.target.value))}
                fullWidth
              >
                <MenuItem value={15}>15 segundos · 3 cenas</MenuItem>
                <MenuItem value={30}>30 segundos · 6 cenas</MenuItem>
                <MenuItem value={45}>45 segundos · 9 cenas</MenuItem>
                <MenuItem value={60}>60 segundos · 12 cenas</MenuItem>
              </TextField>
              {precos && (
                <Alert severity="info">
                  Roteiro {precos.roteiro} + {Math.round(durationSeconds / 5)} cenas ×{' '}
                  {precos.cena} ={' '}
                  <strong>
                    {precos.roteiro + precos.cena * Math.round(durationSeconds / 5)} créditos
                  </strong>
                  . Você só paga cada cena ao renderizá-la — dá para parar no meio.
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
          {/* A busca é do servidor e atravessa TODAS as páginas — nome da
              campanha, produto ou preço. Um filtro local só acharia o que por
              acaso está na página aberta. */}
          {(campanhas.length > 0 || busca) && (
            <TextField
              size="small"
              fullWidth
              placeholder="Buscar por nome, produto ou valor…"
              value={busca}
              onChange={(e) => onBusca(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon fontSize="small" />
                  </InputAdornment>
                ),
              }}
            />
          )}
          {!campanhas.length && (
            <Alert severity="info">
              {busca
                ? `Nenhuma campanha encontrada para "${busca}".`
                : 'Nenhuma campanha ainda.'}
            </Alert>
          )}
          {dialogoDeConfirmacao}
          {campanhas.map((campanha) => (
            <Card key={campanha.id}>
              <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                {/* A capa do produto identifica a campanha de relance — com
                    várias campanhas do mesmo vendedor, o título sozinho não
                    distingue nada. */}
                <Box
                  sx={{
                    position: 'relative',
                    width: 56,
                    height: 56,
                    borderRadius: 1.5,
                    overflow: 'hidden',
                    flexShrink: 0,
                    bgcolor: 'rgba(22,24,35,0.06)',
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  {campanha.productImage ? (
                    <SmartImage src={campanha.productImage} alt={campanha.title} />
                  ) : (
                    <MovieFilterRoundedIcon color="disabled" fontSize="small" />
                  )}
                </Box>
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
                    const ok = await confirmar({
                      titulo: `Excluir "${campanha.title}"?`,
                      mensagem: campanha.creditsSpent
                        ? `Esta campanha já consumiu ${campanha.creditsSpent} créditos — o roteiro e as cenas vão junto e não há estorno.`
                        : 'O roteiro e as cenas vão junto. Não dá para desfazer.',
                      textoConfirmar: 'Excluir',
                      destrutivo: true,
                    });
                    if (!ok) return;
                    await campaignsService.delete(campanha.id);
                    onChange();
                  }}
                >
                  <DeleteOutlineRoundedIcon />
                </IconButton>
              </CardContent>
            </Card>
          ))}
          {paginas > 1 && (
            <Pagination
              count={paginas}
              page={pagina}
              onChange={(_e, nova) => onPagina(nova)}
              sx={{ alignSelf: 'center', pt: 1 }}
            />
          )}
        </Stack>
      </Grid>
    </Grid>
  );
}

// -------------------------------------------------------------------- página
/**
 * Os quatro passos da fábrica.
 *
 * A frase do topo já prometia um caminho ("cadastre o produto, escolha quem
 * apresenta, aprove o roteiro e receba o vídeo"), mas a tela entregava três
 * abas soltas e cabia à pessoa descobrir a ordem — e descobrir tarde, quando o
 * botão travava sem dizer o que faltava. Aqui a ordem é a própria interface.
 *
 * Os passos continuam clicáveis fora de ordem: quem já tem produto e
 * apresentador cadastrados não deve ser obrigado a passear por eles.
 */
const PASSOS = [
  { titulo: 'Produto', ajuda: 'O que você vende, com fotos reais.' },
  { titulo: 'Apresentador', ajuda: 'Quem aparece no vídeo.' },
  { titulo: 'Roteiro', ajuda: 'A fala e as cenas, revisadas por você.' },
  { titulo: 'Vídeo', ajuda: 'Renderiza e monta o arquivo final.' },
];

export function CampaignsPage() {
  // Chegou por /campanhas/:id (link direto, F5, voltar do navegador): abre
  // direto no passo da campanha em vez de começar em "Produtos".
  const { id: campanhaNaUrl } = useParams<{ id: string }>();
  const [passo, setPasso] = useState(campanhaNaUrl ? 3 : 0);
  useEffect(() => {
    if (campanhaNaUrl) setPasso(3);
  }, [campanhaNaUrl]);
  const [grupos, setGrupos] = useState<AttributeGroup[]>([]);
  const [produtos, setProdutos] = useState<UserProduct[]>([]);
  const [personas, setPersonas] = useState<Persona[]>([]);
  const [campanhas, setCampanhas] = useState<CampaignList>({
    items: [],
    total: 0,
    page: 1,
    pageCount: 1,
    comVideo: 0,
  });
  const [paginaCampanhas, setPaginaCampanhas] = useState(1);
  /** O que está no campo (`busca`) e o que já foi à API (`buscaAplicada`) —
   *  separados pelo debounce, para não disparar uma request por tecla. */
  const [buscaCampanhas, setBuscaCampanhas] = useState('');
  const [buscaAplicada, setBuscaAplicada] = useState('');
  const [precos, setPrecos] = useState<CampaignPricing | null>(null);
  const [carregando, setCarregando] = useState(true);
  const montado = useRef(true);

  const recarregar = useCallback(async () => {
    const [p, pe, c] = await Promise.all([
      campaignsService.listProducts(),
      campaignsService.listPersonas(),
      campaignsService.list(paginaCampanhas, buscaAplicada),
    ]);
    if (!montado.current) return;
    setProdutos(p);
    setPersonas(pe);
    setCampanhas(c);
    // Excluir a última campanha da última página deixaria a tela numa página
    // que não existe mais — volta para a última que existe.
    if (paginaCampanhas > c.pageCount) setPaginaCampanhas(c.pageCount);
  }, [paginaCampanhas, buscaAplicada]);

  // O debounce da busca: 400ms depois da última tecla o termo vai à API, e a
  // paginação volta ao começo — a página 3 de uma busca antiga não existe na
  // lista filtrada.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      setBuscaAplicada(buscaCampanhas);
      setPaginaCampanhas(1);
    }, 400);
    return () => window.clearTimeout(timer);
  }, [buscaCampanhas]);

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

  // Cada passo é "cumprido" pelo que existe de verdade na conta, não por ter
  // sido visitado: visitar não produz nada.
  // Totais da conta inteira, não da página atual: a lista é paginada e a
  // campanha com vídeo pode estar em qualquer página.
  const cumprido = [
    produtos.some((p) => p.images.length >= LIMITES.fotosMinimasPorProduto),
    personas.some((p) => p.status === 'pronta'),
    campanhas.total > 0,
    campanhas.comVideo > 0,
  ];

  // O que impede o avanço, em uma frase. É a informação que antes só aparecia
  // como um botão cinza sem explicação.
  const bloqueio = [
    produtos.length
      ? `Envie ao menos ${LIMITES.fotosMinimasPorProduto} fotos de um produto.`
      : 'Cadastre o produto que você vende.',
    personas.length
      ? 'Aguarde o retrato do apresentador ficar pronto.'
      : 'Monte quem apresenta — ou continue para criar um vídeo sem apresentador.',
    null,
    null,
  ][passo];

  return (
    <Box>
      <Typography variant="h4" fontWeight={900} gutterBottom>
        Fábrica de criativos
      </Typography>
      <Typography variant="body1" color="text.secondary" mb={3}>
        Cadastre o seu produto, escolha quem apresenta, aprove o roteiro e receba
        o vídeo pronto para publicar.
      </Typography>

      <Stepper
        nonLinear
        activeStep={passo}
        alternativeLabel
        sx={{
          mb: 3,
          '& .MuiStepConnector-line': { borderColor: 'divider' },
        }}
      >
        {PASSOS.map((p, i) => (
          <Step key={p.titulo} completed={cumprido[i]}>
            <StepButton onClick={() => setPasso(i)}>
              <StepLabel
                optional={
                  <Typography variant="caption" color="text.secondary">
                    {p.ajuda}
                  </Typography>
                }
              >
                <Typography component="span" fontWeight={passo === i ? 800 : 600}>
                  {p.titulo}
                </Typography>
              </StepLabel>
            </StepButton>
          </Step>
        ))}
      </Stepper>
      <Divider sx={{ mb: 3 }} />

      {passo === 0 && <MeusProdutos produtos={produtos} onChange={recarregar} />}
      {passo === 1 && (
        <PersonasTab
          grupos={grupos}
          personas={personas}
          precos={precos}
          onChange={recarregar}
        />
      )}
      {passo >= 2 && (
        <CampanhasTab
          etapa={passo}
          onEtapa={setPasso}
          produtos={produtos}
          personas={personas}
          grupos={grupos}
          campanhas={campanhas.items}
          pagina={campanhas.page}
          paginas={campanhas.pageCount}
          onPagina={setPaginaCampanhas}
          busca={buscaCampanhas}
          onBusca={setBuscaCampanhas}
          precos={precos}
          onChange={recarregar}
        />
      )}

      {/* Navegação só nos dois primeiros passos: do roteiro em diante quem
          manda no fluxo é a própria campanha (criar, gerar, renderizar). */}
      {passo <= 1 && (
        <Stack direction="row" spacing={1.5} alignItems="center" mt={3}>
          <Button
            startIcon={<ArrowBackRoundedIcon />}
            disabled={passo === 0}
            onClick={() => setPasso((p) => p - 1)}
          >
            Voltar
          </Button>
          <Box flexGrow={1} />
          {bloqueio && !cumprido[passo] && (
            <Typography variant="caption" color="text.secondary">
              {bloqueio}
            </Typography>
          )}
          <Button
            variant="contained"
            endIcon={<ArrowForwardRoundedIcon />}
            // Trava com a razão à mostra ao lado — botão cinza mudo é o que
            // fazia a tela parecer quebrada. O passo do apresentador não
            // trava: o estilo "sem apresentador" dispensa persona.
            disabled={!cumprido[passo] && passo !== 1}
            onClick={() => setPasso((p) => p + 1)}
          >
            Continuar
          </Button>
        </Stack>
      )}
    </Box>
  );
}
