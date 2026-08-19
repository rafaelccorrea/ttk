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
  Grid,
  IconButton,
  MenuItem,
  Skeleton,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
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
  const { confirmar, dialogo } = useConfirmarGasto();
  const saldoImagem = useSaldo('image');

  // Pré-seleciona a primeira opção de cada grupo: campo vazio é erro garantido.
  useEffect(() => {
    if (!grupos.length || Object.keys(attrs).length) return;
    const inicial: Record<string, string> = {};
    for (const grupo of grupos) inicial[grupo.key] = grupo.options[0].id;
    setAttrs(inicial);
  }, [grupos, attrs]);

  const completo = grupos.length > 0 && grupos.every((g) => attrs[g.key]);

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
              {/* Sem saldo o botão trava aqui, e não no 402 depois de a pessoa
                  ter montado a persona inteira escolhendo oito atributos. */}
              <Tooltip title={saldoImagem.motivo}>
                <span>
                  <Button
                    variant="contained"
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
                        : `Gerar retrato${precos ? ` · ${precos.persona} créditos` : ''}`}
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
  // Cena cuja foto está sendo trocada (null = diálogo fechado).
  const [trocandoFoto, setTrocandoFoto] = useState<string | null>(null);
  // QUAL cena está redublando. O `ocupado` global trava tudo (certo — é uma
  // operação por vez), mas o spinner tem que aparecer só no botão clicado:
  // três botões girando juntos liam como "redublou as três".
  const [redublando, setRedublando] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [confirmarTudo, setConfirmarTudo] = useState(false);
  const { saldo, ilimitado } = useSaldo('video');
  const { confirmar, dialogo } = useConfirmarGasto();

  const personaPronta = detalhe.persona?.status === 'pronta';
  const todasProntas =
    detalhe.cenas.length > 0 && detalhe.cenas.every((c) => c.status === 'pronta');

  const fotosDoProduto = detalhe.produto?.images ?? [];
  const cenaEmTroca = detalhe.cenas.find((c) => c.id === trocandoFoto) ?? null;

  // O que ainda falta pagar: cena pendente ou que falhou. Renderizando já foi
  // cobrada, e pronta idem — somá-las inflaria o total do diálogo.
  const faltaRenderizar = detalhe.cenas.filter(
    (c) => c.status === 'pendente' || c.status === 'falhou',
  );
  const custoTotal = precos ? faltaRenderizar.length * precos.cena : null;
  const semSaldo =
    !ilimitado && saldo !== null && custoTotal !== null && saldo < custoTotal;
  const renderizando = detalhe.cenas.some((c) => c.status === 'renderizando');
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
      {aviso && (
        <Alert severity="info" onClose={() => setAviso(null)}>
          {aviso}
        </Alert>
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

                {/* A redublagem roda em background: se falhou, o motivo
                    gravado na cena é a única forma de o usuário saber. */}
                {cena.status === 'pronta' && cena.error && (
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
                      {Boolean(cena.fala?.trim()) && (
                        <Tooltip title="Regrava só a voz em português. Não consome créditos — o vídeo final é remontado com o novo áudio.">
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
                            disabled={ocupado}
                            onClick={async () => {
                              setRedublando(cena.id);
                              try {
                                await acao(() => campaignsService.redubScene(cena.id));
                                // O servidor regrava em background (o proxy da
                                // hospedagem não sobrevive à espera). A recarga
                                // programada busca o resultado sem o usuário
                                // precisar adivinhar quando ficou pronto.
                                setAviso(
                                  `Regravando a voz da cena ${cena.ordem} em português — o vídeo atualiza sozinho em instantes.`,
                                );
                                setTimeout(() => {
                                  setAviso(null);
                                  onChange();
                                }, 15000);
                              } finally {
                                setRedublando(null);
                              }
                            }}
                          >
                            {redublando === cena.id ? 'Redublando...' : 'Redublar · grátis'}
                          </Button>
                        </Tooltip>
                      )}
                    </>
                  )}
                  {/* Trocar a foto é grátis e só faz sentido antes de
                      renderizar — depois de pronta, o vídeo já existe. */}
                  {cena.tipo === 'produto' && cena.status !== 'pronta' && (
                    <Tooltip title="Escolher de qual foto esta cena parte (grátis)">
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
        atual={cenaEmTroca?.baseImageUrl ?? null}
        onClose={() => setTrocandoFoto(null)}
        onEscolher={(url) => {
          const id = cenaEmTroca?.id;
          setTrocandoFoto(null);
          if (id) void acao(() => campaignsService.updateScene(id, { baseImageUrl: url }));
        }}
      />
      {dialogo}
    </Stack>
  );
}

// --------------------------------------------------------------- campanhas
function CampanhasTab({
  etapa,
  onEtapa,
  produtos,
  personas,
  campanhas,
  precos,
  onChange,
}: {
  /** Passo escolhido lá em cima — voltar para "Roteiro" fecha a campanha. */
  etapa: number;
  /** Avisa a página se estamos montando o roteiro (2) ou vendo o vídeo (3). */
  onEtapa: (etapa: number) => void;
  produtos: UserProduct[];
  personas: Persona[];
  campanhas: Campaign[];
  precos: CampaignPricing | null;
  onChange: () => void;
}) {
  const [userProductId, setUserProductId] = useState('');
  const [personaId, setPersonaId] = useState('');
  const [durationSeconds, setDuration] = useState(15);
  // Excluir campanha descarta roteiro e cenas já PAGAS — clique acidental na
  // lixeira da lista não pode custar créditos.
  const { confirmar, dialogoDeConfirmacao } = useConfirmacao();
  // Trava de clique repetido. Sem ela, cada clique durante a espera da rede
  // criava uma campanha — e cada campanha é um roteiro a caminho, ou seja,
  // crédito queimado por impaciência. O estado sobe ANTES do await.
  const [criando, setCriando] = useState(false);
  const [aberta, setAberta] = useState<string | null>(null);
  const [detalhe, setDetalhe] = useState<CampaignDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);

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
  }, [etapa, aberta]);

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
          {!campanhas.length && (
            <Alert severity="info">Nenhuma campanha ainda.</Alert>
          )}
          {dialogoDeConfirmacao}
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
  const [passo, setPasso] = useState(0);
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

  // Cada passo é "cumprido" pelo que existe de verdade na conta, não por ter
  // sido visitado: visitar não produz nada.
  const cumprido = [
    produtos.some((p) => p.images.length >= LIMITES.fotosMinimasPorProduto),
    personas.some((p) => p.status === 'pronta'),
    campanhas.length > 0,
    campanhas.some((c) => c.finalVideoUrl),
  ];

  // O que impede o avanço, em uma frase. É a informação que antes só aparecia
  // como um botão cinza sem explicação.
  const bloqueio = [
    produtos.length
      ? `Envie ao menos ${LIMITES.fotosMinimasPorProduto} fotos de um produto.`
      : 'Cadastre o produto que você vende.',
    personas.length
      ? 'Aguarde o retrato do apresentador ficar pronto.'
      : 'Monte quem vai apresentar o vídeo.',
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
          campanhas={campanhas}
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
            // fazia a tela parecer quebrada.
            disabled={!cumprido[passo]}
            onClick={() => setPasso((p) => p + 1)}
          >
            Continuar
          </Button>
        </Stack>
      )}
    </Box>
  );
}
