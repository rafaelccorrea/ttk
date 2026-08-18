import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import ImageNotSupportedRoundedIcon from '@mui/icons-material/ImageNotSupportedRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import SaveRoundedIcon from '@mui/icons-material/SaveRounded';
import ZoomInRoundedIcon from '@mui/icons-material/ZoomInRounded';
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
  DialogTitle,
  Fade,
  Grid,
  IconButton,
  LinearProgress,
  Skeleton,
  Stack,
  TextField,
  Tooltip,
  Typography,
  alpha,
} from '@mui/material';
import { useRef, useState } from 'react';
import { useConfirmacao } from '@/components/ui/ConfirmDialog';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { SmartImage } from '@/components/ui/SmartImage';
import { resolveApiUrl } from '@/services/api';
import { UserProduct, campaignsService } from '@/services/campaigns.service';
import {
  LIMITES,
  contador,
  perigoNoContador,
  validarFoto,
  validarNomeProduto,
  validarPreco,
  validarTextoLongo,
} from '@/utils/validacao-criativos';
import { formatMoney } from '@/utils/format';
import { mensagemDeErro } from '@/services/erros';

/**
 * O catálogo do próprio vendedor — o que ELE vende, não o que a ingestão coleta.
 *
 * Vive fora das páginas porque aparece em duas: na Fábrica de Criativos, onde é
 * o primeiro passo para montar uma campanha, e em Produtos, onde é o lugar que
 * o vendedor procura quando quer ver o que cadastrou. Duplicar a tela em dois
 * arquivos faria as duas divergirem no primeiro ajuste de validação.
 */
/**
 * Galeria de fotos do produto, em modal.
 *
 * Fica fora do card de propósito: a fileira de miniaturas com upload e lixeiras
 * dentro de cada card transformava a lista de produtos numa parede de imagens,
 * e a lista existe para o vendedor ACHAR o produto, não para editar fotos. O
 * modal é o lugar onde se mexe nas fotos; o card só informa quantas há.
 */
function GaleriaDialog({
  produto,
  aberto,
  onClose,
  onChange,
}: {
  produto: UserProduct;
  aberto: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ampliada, setAmpliada] = useState<string | null>(null);
  // Arrastar o arquivo para dentro do modal é o primeiro gesto que todo mundo
  // tenta; sem realce visual não dá para saber se a área aceita a solta.
  const [arrastando, setArrastando] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const total = produto.images.length;
  const lotado = total >= LIMITES.fotosPorProduto;
  const faltam = Math.max(0, LIMITES.fotosMinimasPorProduto - total);

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

    const cabem = LIMITES.fotosPorProduto - total;
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
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      // Recarrega SEMPRE, inclusive no erro: num lote de três, a terceira pode
      // falhar depois das duas primeiras já terem subido — sem isto a galeria
      // ficava mostrando um estado velho que já não é o do servidor.
      onChange();
      setEnviando(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  return (
    <Dialog open={aberto} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ pb: 1 }}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Box flexGrow={1} minWidth={0}>
            <Typography variant="h6" fontWeight={800} noWrap>
              Fotos de {produto.name}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Mínimo de {LIMITES.fotosMinimasPorProduto}, máximo de{' '}
              {LIMITES.fotosPorProduto} · JPG, PNG ou WebP até{' '}
              {LIMITES.fotoBytes / 1024 / 1024}MB cada
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </DialogTitle>

      <DialogContent
        // Aceita a solta no corpo inteiro do modal: mirar o botão tracejado de
        // 96px com o mouse carregado é uma precisão que não se deve exigir.
        onDragOver={(e) => {
          if (lotado || enviando) return;
          e.preventDefault();
          setArrastando(true);
        }}
        onDragLeave={() => setArrastando(false)}
        onDrop={(e) => {
          e.preventDefault();
          setArrastando(false);
          if (lotado || enviando) return;
          void enviar(e.dataTransfer.files);
        }}
        sx={{
          pb: 2,
          outline: (t) =>
            arrastando ? `2px dashed ${t.palette.primary.main}` : '2px dashed transparent',
          outlineOffset: -8,
          borderRadius: 2,
          transition: 'outline-color .15s ease',
        }}
      >
        {/* A barra mede o piso, não o teto: o que importa é quanto falta para
            poder criar a campanha, e o traço marca esse ponto. */}
        <Box mb={2}>
          <Box display="flex" alignItems="baseline" gap={1}>
            <Typography
              variant="caption"
              fontWeight={800}
              color={faltam ? 'warning.main' : 'success.main'}
            >
              {total}/{LIMITES.fotosPorProduto} fotos
            </Typography>
            <Typography variant="caption" color="text.secondary" ml="auto">
              {faltam
                ? `faltam ${faltam} para liberar a campanha`
                : 'pronto para campanha'}
            </Typography>
          </Box>
          <Box sx={{ position: 'relative', mt: 0.75 }}>
            <LinearProgress
              variant="determinate"
              value={Math.min(100, (total / LIMITES.fotosPorProduto) * 100)}
              sx={{
                height: 5,
                borderRadius: 999,
                bgcolor: 'rgba(22,24,35,0.06)',
                '& .MuiLinearProgress-bar': {
                  borderRadius: 999,
                  background: faltam
                    ? 'linear-gradient(90deg, #f59e0b 0%, #fe2c55 100%)'
                    : 'linear-gradient(90deg, #fe2c55 0%, #00c2bb 100%)',
                },
              }}
            />
            <Box
              sx={{
                position: 'absolute',
                top: -2,
                bottom: -2,
                left: `${(LIMITES.fotosMinimasPorProduto / LIMITES.fotosPorProduto) * 100}%`,
                width: 2,
                borderRadius: 1,
                bgcolor: faltam ? 'warning.main' : 'transparent',
              }}
            />
          </Box>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap" useFlexGap>
          {produto.images.map((foto, indice) => (
            <Box
              key={foto}
              sx={{
                position: 'relative',
                // Miniatura no MESMO formato do arquivo (9:16). Num quadrado,
                // a foto vertical aparecia como uma fatia central e não dava
                // para reconhecer o produto.
                width: 96,
                aspectRatio: '9 / 16',
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                bgcolor: '#fff',
                transition: 'transform .15s ease, box-shadow .2s ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  boxShadow: '0 8px 22px rgba(22,24,35,0.14)',
                },
                // Os controles só aparecem na foto sob o cursor: cinco
                // miniaturas com lixeira fixa viravam uma parede de ícones.
                '& .acoes': { opacity: 0, transition: 'opacity .15s ease' },
                '&:hover .acoes, &:focus-within .acoes': { opacity: 1 },
              }}
            >
              {/* A miniatura é pequena demais para conferir enquadramento, e é
                  dela que sai o frame da cena — vale poder ver de perto. */}
              <Box
                component="button"
                type="button"
                onClick={() => setAmpliada(foto)}
                aria-label={`Ver ${produto.name} em tamanho maior`}
                sx={{
                  // `position` DEPOIS do `all: 'unset'`, que zera tudo — sem
                  // isto o SmartImage se ancora no avô em vez do botão, e as
                  // duas caixas só coincidem por acidente de geometria.
                  all: 'unset',
                  position: 'relative',
                  cursor: 'zoom-in',
                  display: 'block',
                  width: '100%',
                  height: '100%',
                }}
              >
                {/* `contain`: o arquivo já vem em 9:16 com o produto inteiro —
                    recortar de novo aqui desfaria o trabalho. */}
                <SmartImage src={foto} alt={produto.name} objectFit="contain" />
              </Box>

              {/* Véu só no hover, e sem capturar o clique — quem clica quer
                  ampliar a foto que está embaixo, não acertar o véu. */}
              <Box
                className="acoes"
                sx={{
                  position: 'absolute',
                  inset: 0,
                  pointerEvents: 'none',
                  background:
                    'linear-gradient(180deg, rgba(0,0,0,0.40) 0%, rgba(0,0,0,0) 45%, rgba(0,0,0,0.35) 100%)',
                }}
              >
                <ZoomInRoundedIcon
                  sx={{
                    position: 'absolute',
                    bottom: 4,
                    left: 6,
                    fontSize: 16,
                    color: '#fff',
                    filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))',
                  }}
                />
              </Box>

              {/* A primeira foto é a que o card mostra e a referência principal
                  das cenas — vale dizer qual é, senão a ordem parece aleatória. */}
              {indice === 0 && (
                <Chip
                  size="small"
                  label="capa"
                  sx={{
                    position: 'absolute',
                    bottom: 4,
                    right: 4,
                    height: 18,
                    fontSize: 10,
                    fontWeight: 800,
                    color: '#fff',
                    bgcolor: 'rgba(0,0,0,0.55)',
                  }}
                />
              )}

              <IconButton
                className="acoes"
                size="small"
                aria-label={`Remover uma foto de ${produto.name}`}
                onClick={async () => {
                  await campaignsService.removePhoto(produto.id, foto);
                  onChange();
                }}
                sx={{
                  position: 'absolute',
                  top: 3,
                  right: 3,
                  bgcolor: 'rgba(0,0,0,0.55)',
                  color: '#fff',
                  '&:hover': { bgcolor: 'error.main' },
                }}
              >
                <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
              </IconButton>
            </Box>
          ))}

          {/* Vaga fantasma durante o upload. O `addPhoto` faz normalização no
              sharp e envio ao S3 — segundos em que a fileira ficava parada e
              parecia que o clique não pegou. */}
          {enviando && (
            <Box
              sx={{
                width: 96,
                aspectRatio: '9 / 16',
                borderRadius: 2,
                overflow: 'hidden',
                border: '1px solid',
                borderColor: 'divider',
                position: 'relative',
              }}
            >
              <Skeleton variant="rectangular" width="100%" height="100%" />
              <Box sx={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>
                <CircularProgress size={20} />
              </Box>
            </Box>
          )}

          {!lotado && (
            <Button
              component="label"
              variant="outlined"
              color={arrastando ? 'primary' : 'inherit'}
              disabled={enviando}
              // Mesmo formato das miniaturas, para a fileira não ficar torta.
              // O ícone vira filho: com `startIcon` a margem lateral do MUI
              // desalinha tudo quando o botão é uma coluna.
              sx={{
                width: 96,
                aspectRatio: '9 / 16',
                borderStyle: 'dashed',
                borderWidth: 1.5,
                borderRadius: 2,
                flexDirection: 'column',
                gap: 0.5,
                fontSize: 12,
                lineHeight: 1.2,
                px: 1,
                color: arrastando ? 'primary.main' : 'text.secondary',
                bgcolor: (t) => (arrastando ? alpha(t.palette.primary.main, 0.06) : 'transparent'),
                '&:hover': {
                  borderStyle: 'dashed',
                  color: 'primary.main',
                  borderColor: 'primary.main',
                  bgcolor: (t) => alpha(t.palette.primary.main, 0.05),
                },
              }}
            >
              {enviando ? <CircularProgress size={18} /> : <AddPhotoAlternateRoundedIcon />}
              {enviando ? 'Enviando...' : arrastando ? 'Solte aqui' : 'Adicionar foto'}
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
          <Fade in>
            <Alert severity="error" variant="outlined" sx={{ mt: 2, borderRadius: 2 }}>
              {erro}
            </Alert>
          </Fade>
        )}

        {Boolean(faltam) && (
          // Tom baixo, não um Alert cheio: é a orientação permanente de uma
          // galeria incompleta, e não um erro que acabou de acontecer.
          <Box
            sx={{
              mt: 2,
              px: 1.5,
              py: 1.25,
              borderRadius: 2,
              display: 'flex',
              gap: 1.25,
              alignItems: 'flex-start',
              bgcolor: (t) => alpha(t.palette.warning.main, 0.08),
              border: (t) => `1px solid ${alpha(t.palette.warning.main, 0.22)}`,
            }}
          >
            <ImageNotSupportedRoundedIcon sx={{ fontSize: 18, color: 'warning.main', mt: '1px' }} />
            <Typography variant="caption" color="text.secondary" lineHeight={1.5}>
              {total
                ? `Faltam ${faltam} foto(s) para criar campanha com este produto.`
                : 'Sem foto, o vídeo não mostra o seu produto — a IA desenha um objeto parecido.'}{' '}
              Cada cena de demonstração parte de uma foto diferente, por isso o mínimo
              é {LIMITES.fotosMinimasPorProduto}.
            </Typography>
          </Box>
        )}

        {/* Zoom sobre o modal: a miniatura de 96px não serve para conferir
            enquadramento, e é o enquadramento que vira o frame da cena. */}
        <Dialog
          open={Boolean(ampliada)}
          onClose={() => setAmpliada(null)}
          maxWidth="sm"
          fullWidth
        >
          <DialogContent sx={{ p: 0, bgcolor: '#000', position: 'relative' }}>
            {ampliada && (
              <Box
                component="img"
                src={resolveApiUrl(ampliada)}
                alt={produto.name}
                sx={{
                  display: 'block',
                  width: '100%',
                  // `contain`: aqui a foto é conferida, então não pode cortar —
                  // é justamente o corte que se quer avaliar.
                  maxHeight: '80vh',
                  objectFit: 'contain',
                }}
              />
            )}
            <IconButton
              onClick={() => setAmpliada(null)}
              sx={{
                position: 'absolute',
                top: 8,
                right: 8,
                bgcolor: 'rgba(0,0,0,0.55)',
                color: '#fff',
                '&:hover': { bgcolor: 'rgba(0,0,0,0.75)' },
              }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </DialogContent>
        </Dialog>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Linha do produto na lista.
 *
 * Enxuta de propósito: nome, preço, benefício e QUANTAS fotos existem. Mexer
 * nas fotos é tarefa ocasional e acontece no modal — a lista precisa caber na
 * tela quando o vendedor tem dez produtos cadastrados.
 *
 * A contagem não é enfeite: as cenas de demonstração são animadas a partir das
 * fotos, e sem o mínimo a campanha nem abre. Por isso o estado aparece no card,
 * e não escondido dentro do modal.
 */
function ProdutoCard({
  produto,
  onChange,
}: {
  produto: UserProduct;
  onChange: () => void;
}) {
  const [galeria, setGaleria] = useState(false);
  // Excluir leva junto fotos e o vínculo com campanhas — não pode ser um
  // clique acidental na lixeira.
  const { confirmar, dialogoDeConfirmacao } = useConfirmacao();

  const capa = produto.images[0];
  const total = produto.images.length;
  const faltam = Math.max(0, LIMITES.fotosMinimasPorProduto - total);

  return (
    <Card sx={{ position: 'relative', overflow: 'hidden' }}>
      {/* Fio da marca no topo, aceso só quando o produto já pode virar
          campanha: separa um card do outro e serve de semáforo de relance. */}
      <Box
        sx={{
          height: 3,
          background: faltam
            ? 'rgba(22,24,35,0.08)'
            : 'linear-gradient(90deg, #fe2c55 0%, #00c2bb 100%)',
        }}
      />
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1.75 }}>
        {/* Capa: a primeira foto é a referência principal das cenas, então é
            ela que representa o produto na lista. */}
        <Box
          sx={{
            // `relative` é obrigatório: o SmartImage se posiciona com
            // `absolute; inset: 0`, então sem âncora aqui ele se prende ao
            // Card e a foto sai flutuando por cima do nome e do benefício.
            position: 'relative',
            width: 52,
            aspectRatio: '9 / 16',
            flexShrink: 0,
            borderRadius: 2,
            overflow: 'hidden',
            border: '1px solid',
            borderColor: 'divider',
            bgcolor: capa ? '#fff' : 'rgba(22,24,35,0.03)',
            display: 'grid',
            placeItems: 'center',
          }}
        >
          {capa ? (
            <SmartImage src={capa} alt={produto.name} objectFit="contain" />
          ) : (
            <ImageNotSupportedRoundedIcon sx={{ fontSize: 18, color: 'text.disabled' }} />
          )}
        </Box>

        <Box flexGrow={1} minWidth={0}>
          <Stack direction="row" alignItems="center" gap={1} flexWrap="wrap">
            <Typography variant="subtitle1" fontWeight={800} letterSpacing="-0.01em">
              {produto.name}
            </Typography>
            {/* `toFixed` devolvia "R$ 99.00", com ponto — errado em pt-BR. */}
            <Chip
              size="small"
              label={produto.priceBrl ? formatMoney(Number(produto.priceBrl)) : 'sem preço'}
              sx={{
                height: 22,
                fontWeight: 800,
                fontSize: 12,
                color: produto.priceBrl ? 'primary.main' : 'text.secondary',
                bgcolor: (t) =>
                  produto.priceBrl ? alpha(t.palette.primary.main, 0.1) : 'rgba(22,24,35,0.05)',
              }}
            />
            {/* Um chip só resume o estado das fotos: quantas há e se libera a
                campanha. É o que a fileira de miniaturas dizia ocupando meia
                tela. */}
            <Chip
              size="small"
              icon={
                faltam ? (
                  <PhotoLibraryRoundedIcon sx={{ fontSize: 14 }} />
                ) : (
                  <CheckCircleRoundedIcon sx={{ fontSize: 14 }} />
                )
              }
              label={
                faltam
                  ? `${total}/${LIMITES.fotosMinimasPorProduto} fotos`
                  : `${total} fotos · pronto`
              }
              sx={{
                height: 22,
                fontWeight: 700,
                fontSize: 11,
                color: faltam ? 'warning.main' : 'success.main',
                bgcolor: (t) =>
                  alpha(faltam ? t.palette.warning.main : t.palette.success.main, 0.1),
                '& .MuiChip-icon': {
                  color: faltam ? 'warning.main' : 'success.main',
                  ml: 0.75,
                },
              }}
            />
          </Stack>
          {produto.benefit && (
            <Typography variant="body2" color="text.secondary" mt={0.25} noWrap>
              {produto.benefit}
            </Typography>
          )}
        </Box>

        <Button
          variant={faltam ? 'contained' : 'outlined'}
          size="small"
          color={faltam ? 'primary' : 'inherit'}
          startIcon={<PhotoLibraryRoundedIcon />}
          onClick={() => setGaleria(true)}
          sx={{ flexShrink: 0, whiteSpace: 'nowrap' }}
        >
          {faltam ? 'Enviar fotos' : 'Fotos'}
        </Button>

        <Tooltip title="Excluir produto">
          <IconButton
            size="small"
            onClick={async () => {
              const ok = await confirmar({
                titulo: `Excluir "${produto.name}"?`,
                mensagem:
                  'As fotos vão junto e as campanhas dele param de funcionar. Não dá para desfazer.',
                textoConfirmar: 'Excluir',
                destrutivo: true,
              });
              if (!ok) return;
              await campaignsService.deleteProduct(produto.id);
              onChange();
            }}
            // Cinza em repouso, vermelho ao mirar: excluir não pode disputar
            // atenção com a ação principal, mas tem que avisar que é destrutivo.
            sx={{
              flexShrink: 0,
              color: 'text.disabled',
              '&:hover': {
                color: 'error.main',
                bgcolor: (t) => alpha(t.palette.error.main, 0.08),
              },
            }}
          >
            <DeleteOutlineRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </CardContent>

      <GaleriaDialog
        produto={produto}
        aberto={galeria}
        onClose={() => setGaleria(false)}
        onChange={onChange}
      />
      {dialogoDeConfirmacao}
    </Card>
  );
}

export function MeusProdutos({
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
    // Guarda de reentrância: o `disabled` só vale depois do repinte, e dois
    // cliques rápidos cabem antes disso — cadastravam o produto duas vezes.
    if (salvando) return;
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
                placeholder="Ex.: Batom matte longa duração"
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
                placeholder="Ex.: Fixa o dia inteiro sem retocar. (é a promessa do seu gancho)"
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
                  `Seja específico: número, tempo ou situação real vendem mais que adjetivo. ${contador(benefit, LIMITES.beneficio)}`
                }
              />
              <TextField
                label="Problema que resolve"
                placeholder="Ex.: Batom que sai no primeiro café. (o vídeo abre encenando isso)"
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
                  `Descreva com as palavras de quem sofre o problema — vira a primeira frase do vídeo. ${contador(problemSolved, LIMITES.problema)}`
                }
              />
              {erro && <Alert severity="error">{erro}</Alert>}
              <Button
                variant="contained"
                size="large"
                onClick={salvar}
                // Não desabilita por campo inválido: botão morto sem explicação
                // é o pior dos dois mundos. Clicar revela o que falta.
                disabled={salvando}
                // Spinner no lugar do ícone: a largura do botão não muda no
                // meio do clique e a espera fica visível sem ler o texto.
                startIcon={
                  salvando ? (
                    <CircularProgress size={18} color="inherit" />
                  ) : (
                    <SaveRoundedIcon />
                  )
                }
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
