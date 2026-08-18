import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Collapse,
  Divider,
  Grid,
  IconButton,
  Stack,
  Tab,
  Tabs,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from '@mui/material';
import DeleteIcon from '@mui/icons-material/Delete';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EditNoteRoundedIcon from '@mui/icons-material/EditNoteRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import ImageNotSupportedRoundedIcon from '@mui/icons-material/ImageNotSupportedRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { SmartImage } from '@/components/ui/SmartImage';
import { Link, useSearchParams } from 'react-router-dom';
import { SearchableSelect } from '@/components/ui/SearchableSelect';
import { ImageDropzone } from '@/components/ui/ImageDropzone';
import { formatCurrency, formatNumber } from '@/utils/format';
import { proxyImage } from '@/utils/tiktok';
import { useSaldo } from '@/hooks/useSaldo';
import { apiErrorMessage } from '@/contexts/AuthContext';
import { billingService } from '@/services/billing.service';
import { freeService } from '@/services/free.service';
import { productsService, RankedProduct } from '@/services/products.service';
import {
  PECAS_MAX,
  PECAS_PADRAO,
  Script,
  studioService,
} from '@/services/studio.service';
import { campaignsService, UserProduct } from '@/services/campaigns.service';

/**
 * Tons sugeridos para o roteiro.
 *
 * O campo continua aceitando texto livre (`allowCustom`): a lista é atalho
 * para os tons que mais funcionam no TikTok Shop, não uma restrição.
 */
const TONES = [
  'Divertido e urgente',
  'Direto ao ponto',
  'Empolgado e enérgico',
  'Amigável e próximo',
  'Autoridade e especialista',
  'Emocional e pessoal',
  'Bem-humorado',
  'Educativo e didático',
  'Depoimento honesto',
  'Urgência e escassez',
  'Sofisticado e premium',
];

/**
 * Ficha do produto montada com o que já temos em mãos.
 *
 * São os mesmos dados que alimentam o catálogo — nada de chamada extra nem
 * de token gasto. Serve de ponto de partida para o usuário editar antes de
 * gerar o roteiro, em vez de começar de um campo vazio.
 */
function detalhesDoProduto(p: RankedProduct): string {
  const linhas = [
    `Produto: ${p.title}`,
    `Preço: ${formatCurrency(p.price)}`,
    p.storeName ? `Loja: ${p.storeName}` : null,
    `Categoria: ${p.category}`,
    p.rating ? `Avaliação: ${p.rating} de 5` : null,
    /*
     * Condicional porque o produto pode vir da AMOSTRA gratuita, que não traz
     * vendas — e a linha incondicional mandava "Vendas nos últimos 30 dias: —"
     * dentro do prompt. Não é só feio na ficha: é ruído escrito no pedido que
     * vai para o modelo, sobre o dado mais importante do produto.
     */
    p.salesPeriod
      ? `Vendas nos últimos 30 dias: ${formatNumber(p.salesPeriod)}`
      : null,
    /*
     * `!= null` (e não `!== null`): produto vindo da amostra gratuita pode não
     * trazer o campo, e `undefined !== null` é verdadeiro — a ficha saía com
     * "Crescimento no período: undefined%" e isso ia para dentro do prompt.
     */
    p.growthPct != null
      ? `Crescimento no período: ${p.growthPct >= 0 ? '+' : ''}${p.growthPct}%`
      : null,
  ];
  return linhas.filter(Boolean).join('\n');
}

/** Mesma ficha, para o produto que o próprio vendedor cadastrou. */
function detalhesDoMeuProduto(p: UserProduct): string {
  return [
    `Produto: ${p.name}`,
    p.priceBrl !== null ? `Preço: ${formatCurrency(p.priceBrl)}` : null,
    p.benefit ? `Benefício principal: ${p.benefit}` : null,
    p.problemSolved ? `Problema que resolve: ${p.problemSolved}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * Rótulo em caixa alta acima de cada campo.
 *
 * Substitui o `label` flutuante do MUI: com formulário longo, o rótulo dentro
 * da borda some quando o campo está preenchido e a tela vira uma pilha de
 * caixas sem nome.
 */
function Rotulo({ children }: { children: ReactNode }) {
  return (
    <Typography
      variant="caption"
      color="text.secondary"
      sx={{
        display: 'block',
        mb: 0.75,
        fontWeight: 700,
        letterSpacing: 0.8,
        textTransform: 'uppercase',
      }}
    >
      {children}
    </Typography>
  );
}

/**
 * Linha da lista de produtos: miniatura, título e a legenda de cada origem.
 *
 * Fica FORA da página de propósito: declarada dentro dela, a função seria
 * outra a cada render, e o React remontaria todas as linhas a cada tecla
 * digitada na busca — as fotos recomeçavam o carregamento e piscavam.
 */
function ItemProduto({
  titulo,
  legenda,
  foto,
  ativo,
  onSelect,
}: {
  titulo: string;
  legenda: string;
  foto?: string | null;
  ativo: boolean;
  onSelect: () => void;
}) {
  return (
    <Box
      onClick={onSelect}
      sx={{
        display: 'flex',
        gap: 1.25,
        alignItems: 'center',
        p: 1,
        borderRadius: 2,
        cursor: 'pointer',
        border: '1px solid',
        borderColor: ativo ? 'primary.main' : 'transparent',
        bgcolor: ativo ? 'action.selected' : 'transparent',
        '&:hover': { bgcolor: 'action.hover' },
      }}
    >
      <Box
        sx={{
          // `SmartImage` se posiciona em `absolute; inset: 0` — sem este
          // `relative` ela ancora no primeiro pai posicionado (a página) e a
          // foto vaza por cima de todo o layout.
          position: 'relative',
          width: 44,
          height: 44,
          flexShrink: 0,
          borderRadius: 1.5,
          overflow: 'hidden',
          bgcolor: 'action.hover',
        }}
      >
        <SmartImage
          src={foto ?? null}
          alt={titulo}
          fallback={
            <ImageNotSupportedRoundedIcon sx={{ fontSize: 16, opacity: 0.35 }} />
          }
        />
      </Box>
      <Box minWidth={0}>
        <Typography noWrap fontSize={14} fontWeight={600}>
          {titulo}
        </Typography>
        <Typography noWrap fontSize={12.5} color="text.secondary">
          {legenda}
        </Typography>
      </Box>
    </Box>
  );
}

export function StudioPage() {
  const [searchParams] = useSearchParams();
  const [type, setType] = useState<'live' | 'video'>(
    searchParams.get('type') === 'video' ? 'video' : 'live',
  );
  // Valor do campo com prefixo de origem: `cat:` catálogo da plataforma,
  // `meu:` produto cadastrado pelo próprio vendedor. Sem o prefixo os dois
  // ids se confundiriam num único uuid.
  const [selecao, setSelecao] = useState(() => {
    const id = searchParams.get('productId');
    return id ? `cat:${id}` : '';
  });
  const productId = selecao.startsWith('cat:') ? selecao.slice(4) : '';
  const userProductId = selecao.startsWith('meu:') ? selecao.slice(4) : '';
  const [meusProdutos, setMeusProdutos] = useState<UserProduct[]>([]);
  // Aba da lista da esquerda: catálogo da plataforma × produtos do vendedor.
  const [aba, setAba] = useState<'top' | 'meus'>('top');
  const [mostrarSalvos, setMostrarSalvos] = useState(false);
  // `pecas` só faz sentido no vídeo: a live é um ciclo contínuo, não peças
  // avulsas para embaralhar.
  const [formato, setFormato] = useState<'completo' | 'pecas'>('completo');
  // Quantas peças de cada bloco. O padrão (5/2/2) já dá 20 combinações no
  // Multiplicador — bastante para um teste A/B sem virar uma tarde de gravação.
  const [pecas, setPecas] = useState({ ...PECAS_PADRAO });
  const [imagemUrl, setImagemUrl] = useState<string | null>(null);
  const [enviandoImagem, setEnviandoImagem] = useState(false);
  const [erroImagem, setErroImagem] = useState<string | null>(null);
  const [productName, setProductName] = useState('');
  const [productDescription, setProductDescription] = useState('');
  const [tone, setTone] = useState('');
  const [topProducts, setTopProducts] = useState<RankedProduct[]>([]);
  const [busca, setBusca] = useState('');
  const [buscando, setBuscando] = useState(false);
  // O produto escolhido pode sair da lista na busca seguinte; guardá-lo à
  // parte mantém foto, título e a ficha de detalhes.
  const [escolhido, setEscolhido] = useState<RankedProduct | null>(null);
  const [scripts, setScripts] = useState<Script[]>([]);
  const [result, setResult] = useState<Script | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /*
   * Conta gratuita: tem as ferramentas de IA, não tem o catálogo. `null`
   * enquanto a carteira não chega — a lista só carrega depois, para não
   * disparar a chamada errada e ter de refazê-la.
   */
  const [semDescoberta, setSemDescoberta] = useState<boolean | null>(null);
  /*
   * "Dá para gerar?" respondido antes do clique. O roteiro é cobrado como
   * `script` na tabela do backend — a mesma chave que o 402 usaria.
   */
  const saldo = useSaldo('script');

  useEffect(() => {
    studioService.listScripts().then(setScripts).catch(console.error);
    campaignsService.listProducts().then(setMeusProdutos).catch(console.error);
    billingService
      .wallet()
      .then((w) => setSemDescoberta(w.features?.discovery === false))
      .catch(() => setSemDescoberta(false));
  }, []);

  // A lista carregada é só o topo do catálogo. Sem busca no servidor, um
  // produto fora dos 50 mais vendidos não aparecia por mais que se digitasse.
  useEffect(() => {
    if (semDescoberta === null) return; // ainda não sabemos qual fonte usar
    let cancelado = false;
    setBuscando(true);
    const timer = setTimeout(() => {
      /*
       * Conta gratuita não tem `discovery`: o ranking responde 403 e a lista
       * ficava vazia, com um "nenhum produto encontrado" que culpava a busca
       * por uma trava de plano. Aqui ela recebe os produtos da amostra — os
       * mesmos 20 da tela de Produtos —, que é o que ela tem e é suficiente
       * para gerar um roteiro de verdade. A busca não filtra a amostra porque
       * a amostra não é buscável (ver docs/CONTA-FREE.md).
       */
      const fonte = semDescoberta
        ? freeService.sample().then((s) => ({
            items: s.products.map(
              (p) =>
                ({
                  id: p.id,
                  title: p.title,
                  category: p.category,
                  imageUrl: p.imageUrl,
                  price: p.price,
                  // A amostra tem crescimento; vendas exatas, não. O que existe
                  // vai junto: é contexto real para o roteiro.
                  growthPct: p.growthPct,
                }) as RankedProduct,
            ),
          }))
        : productsService.rank({
            period: 30,
            limit: 50,
            search: busca.trim() || undefined,
          });
      fonte
        .then((data) => {
          if (!cancelado) setTopProducts(data.items);
        })
        .catch(console.error)
        .finally(() => {
          if (!cancelado) setBuscando(false);
        });
    }, 350);
    return () => {
      cancelado = true;
      clearTimeout(timer);
    };
  }, [busca, semDescoberta]);

  // Último texto que este efeito escreveu. Só sobrescrevemos o que foi
  // preenchido automaticamente — o que o usuário digitou fica intocado.
  const autoDescricaoRef = useRef('');

  useEffect(() => {
    const doCatalogo =
      escolhido?.id === productId
        ? escolhido
        : topProducts.find((p) => p.id === productId);
    const meu = meusProdutos.find((p) => p.id === userProductId);
    const texto = doCatalogo
      ? detalhesDoProduto(doCatalogo)
      : meu
        ? detalhesDoMeuProduto(meu)
        : '';
    setProductDescription((atual) => {
      const foiAutomatico = atual === autoDescricaoRef.current;
      if (!foiAutomatico && atual.trim() !== '') return atual;
      autoDescricaoRef.current = texto;
      return texto;
    });
  }, [productId, userProductId, topProducts, escolhido, meusProdutos]);

  // Trava síncrona: `busy` só desabilita o botão no próximo render. Num
  // formulário isso é ainda mais fácil de disparar duas vezes (clique + Enter),
  // e cada envio extra é um roteiro cobrado de novo do usuário.
  const busyRef = useRef(false);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (busyRef.current) return;
    busyRef.current = true;
    setError(null);
    setBusy(true);
    try {
      const script = await studioService.generate({
        type,
        productId: productId || undefined,
        userProductId: userProductId || undefined,
        productName: selecao ? undefined : productName,
        productDescription: productDescription || undefined,
        productImageUrl: imagemUrl ?? undefined,
        formato,
        ...(type === 'video' && formato === 'pecas'
          ? {
              hooksCount: pecas.hooks,
              bodiesCount: pecas.bodies,
              ctasCount: pecas.ctas,
            }
          : {}),
        tone: tone || undefined,
      });
      setResult(script);
      setScripts((prev) => [script, ...prev]);
      // O saldo acabou de mudar: sem recarregar, o botão continuaria liberado
      // até um F5 — e a trava só serve se souber do gasto que ela mesma causou.
      saldo.recarregar();
    } catch (err) {
      /*
       * `err.message` do axios é "Request failed with status code 402" — e era
       * isso que aparecia na tela quando o saldo acabava, que é justamente o
       * momento em que a conta gratuita decide se assina. `apiErrorMessage`
       * pega a mensagem que o backend escreveu ("Créditos insuficientes: este
       * envio custa 8 e você tem 2…"), que é a única que serve para alguém.
       */
      setError(apiErrorMessage(err));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  async function handleImagem(file: File) {
    setErroImagem(null);
    setEnviandoImagem(true);
    try {
      setImagemUrl(await studioService.uploadProductImage(file));
    } catch (err) {
      setErroImagem(
        err instanceof Error ? err.message : 'Falha ao enviar a imagem',
      );
    } finally {
      setEnviandoImagem(false);
    }
  }

  async function handleDelete(id: string) {
    await studioService.deleteScript(id);
    setScripts((prev) => prev.filter((s) => s.id !== id));
    if (result?.id === id) setResult(null);
  }

  /** Escolhe o produto e já traz a foto dele para o campo de imagem. */
  function selecionar(valor: string) {
    setSelecao(valor);
    const doCatalogo = topProducts.find((p) => `cat:${p.id}` === valor);
    setEscolhido(doCatalogo ?? null);
    // Já temos a foto do produto escolhido: usá-la poupa o upload e é a mesma
    // imagem que a IA precisa ver.
    const meu = meusProdutos.find((p) => `meu:${p.id}` === valor);
    const foto = doCatalogo?.imageUrl
      ? proxyImage(doCatalogo.imageUrl)
      : (meu?.images[0] ?? null);
    setImagemUrl(foto ?? null);
    setErroImagem(null);
  }


  const listaMeus = meusProdutos.filter((p) =>
    p.name.toLowerCase().includes(busca.trim().toLowerCase()),
  );
  const listaTop =
    escolhido && !topProducts.some((p) => p.id === escolhido.id)
      ? [escolhido, ...topProducts]
      : topProducts;

  return (
    <>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        spacing={1.5}
        sx={{ mb: 3 }}
      >
        <Box>
          <Typography variant="overline" color="text.secondary" letterSpacing={1.2}>
            Estúdio · IA
          </Typography>
          <Typography variant="h4" fontWeight={800} lineHeight={1.15}>
            Roteirizar{' '}
            <Box component="span" color="primary.main">
              {type === 'live' ? 'Live' : 'Vídeos'}
            </Box>
          </Typography>
          <Typography color="text.secondary" sx={{ mt: 0.75, maxWidth: 640 }}>
            {type === 'live'
              ? 'Escolha um produto do catálogo (ou descreva o seu e suba uma imagem). A IA monta um roteiro em CICLOS: Apresentação → Oferta → Garantia → CTA, repetido em loop.'
              : 'Escolha um produto do catálogo (ou descreva o seu e suba uma imagem). A IA monta um roteiro de vídeo curto no modelo Gancho → Corpo → CTA, pronto pra gravar.'}
          </Typography>
        </Box>
        <Button
          variant="outlined"
          startIcon={<FolderOpenRoundedIcon />}
          onClick={() => setMostrarSalvos((v) => !v)}
          sx={{ flexShrink: 0, borderRadius: 2 }}
        >
          Roteiros salvos {scripts.length ? `(${scripts.length})` : ''}
        </Button>
      </Stack>

      <Grid container spacing={3} alignItems="flex-start">
        {/* Coluna da esquerda: escolher o produto. */}
        <Grid item xs={12} md={5}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <Tabs
                value={aba}
                onChange={(_e, v) => setAba(v)}
                variant="fullWidth"
                sx={{ minHeight: 38, mb: 1.5 }}
              >
                <Tab
                  value="top"
                  label="Top produtos"
                  sx={{ minHeight: 38, textTransform: 'none', fontWeight: 700 }}
                />
                <Tab
                  value="meus"
                  label="Meus produtos"
                  sx={{ minHeight: 38, textTransform: 'none', fontWeight: 700 }}
                />
              </Tabs>

              <TextField
                fullWidth
                size="small"
                placeholder="Buscar produto…"
                value={busca}
                onChange={(e) => setBusca(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <SearchRoundedIcon
                      fontSize="small"
                      sx={{ mr: 1, color: 'text.disabled' }}
                    />
                  ),
                }}
                sx={{ mb: 1.5, '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
              />

              {/* Sempre no topo: o produto que não está no catálogo é o caso
                  mais comum de quem está começando. */}
              <Box
                onClick={() => selecionar('')}
                sx={{
                  display: 'flex',
                  gap: 1.25,
                  alignItems: 'center',
                  p: 1.25,
                  mb: 1,
                  borderRadius: 2,
                  cursor: 'pointer',
                  border: '1px solid',
                  borderColor: selecao ? 'divider' : 'primary.main',
                  bgcolor: selecao ? 'transparent' : 'action.selected',
                }}
              >
                <EditNoteRoundedIcon color={selecao ? 'disabled' : 'primary'} />
                <Box minWidth={0}>
                  <Typography fontSize={14} fontWeight={700}>
                    Descrever meu produto
                  </Typography>
                  <Typography fontSize={12.5} color="text.secondary">
                    Não está na lista? Descreve ele e sobe a imagem.
                  </Typography>
                </Box>
                {!selecao && (
                  <CheckCircleRoundedIcon
                    color="primary"
                    fontSize="small"
                    sx={{ ml: 'auto' }}
                  />
                )}
              </Box>

              <Divider sx={{ mb: 1 }} />

              <Box sx={{ maxHeight: 420, overflowY: 'auto', pr: 0.5 }}>
                {aba === 'top' ? (
                  buscando && !listaTop.length ? (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                      Buscando…
                    </Typography>
                  ) : listaTop.length ? (
                    listaTop.map((p) => (
                      <ItemProduto
                        key={p.id}
                        titulo={p.title}
                        legenda={
                          /*
                           * A amostra gratuita não traz o número de vendas (é
                           * dado do plano pago), e `formatNumber(undefined)`
                           * escrevia "— vendas" em toda linha. Sem o número, a
                           * categoria é a informação útil que sobra.
                           */
                          semDescoberta
                            ? `${formatCurrency(p.price)} · ${p.category}`
                            : `${formatCurrency(p.price)} · ${formatNumber(p.salesPeriod)} vendas`
                        }
                        foto={p.imageUrl ? proxyImage(p.imageUrl) : null}
                        ativo={selecao === `cat:${p.id}`}
                        onSelect={() => selecionar(`cat:${p.id}`)}
                      />
                    ))
                  ) : (
                    <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                      Nenhum produto encontrado para essa busca.
                    </Typography>
                  )
                ) : listaMeus.length ? (
                  listaMeus.map((p) => (
                    <ItemProduto
                      key={p.id}
                      titulo={p.name}
                      legenda={
                        p.benefit ??
                        (p.priceBrl !== null
                          ? formatCurrency(p.priceBrl)
                          : 'Produto seu')
                      }
                      foto={p.images[0] ?? null}
                      ativo={selecao === `meu:${p.id}`}
                      onSelect={() => selecionar(`meu:${p.id}`)}
                    />
                  ))
                ) : (
                  <Typography variant="body2" color="text.secondary" sx={{ p: 1 }}>
                    Você ainda não cadastrou produtos. Cadastre em Campanhas, ou
                    use “Descrever meu produto” aqui em cima.
                  </Typography>
                )}
              </Box>
            </CardContent>
          </Card>
        </Grid>

        {/* Coluna da direita: o formulário do roteiro. */}
        <Grid item xs={12} md={7}>
          <Card sx={{ borderRadius: 3 }}>
            <CardContent>
              <form onSubmit={handleSubmit}>
                <ToggleButtonGroup
                  exclusive
                  size="small"
                  value={type}
                  onChange={(_e, value) => value && setType(value)}
                  sx={{
                    mb: 2.5,
                    '& .MuiToggleButton-root': {
                      textTransform: 'none',
                      fontWeight: 700,
                      borderRadius: 2,
                      px: 2,
                    },
                  }}
                >
                  <ToggleButton value="live">Roteiro de Live</ToggleButton>
                  <ToggleButton value="video">Roteiro de Vídeo</ToggleButton>
                </ToggleButtonGroup>

                {type === 'video' && (
                  <ToggleButtonGroup
                    exclusive
                    size="small"
                    value={formato}
                    onChange={(_e, v) => v && setFormato(v)}
                    sx={{
                      mb: 2.5,
                      ml: { sm: 1 },
                      '& .MuiToggleButton-root': {
                        textTransform: 'none',
                        fontWeight: 700,
                        borderRadius: 2,
                        px: 2,
                      },
                    }}
                  >
                    <ToggleButton value="completo">Roteiro completo</ToggleButton>
                    <ToggleButton value="pecas">
                      Peças pro Multiplicador
                    </ToggleButton>
                  </ToggleButtonGroup>
                )}

                <Rotulo>Descreva o produto</Rotulo>
                <TextField
                  fullWidth
                  required={!selecao}
                  disabled={Boolean(selecao)}
                  placeholder="Nome do produto (ex.: Chapinha Profissional Bivolt)"
                  value={
                    selecao
                      ? (escolhido?.title ??
                        meusProdutos.find((p) => p.id === userProductId)?.name ??
                        '')
                      : productName
                  }
                  onChange={(e) => setProductName(e.target.value)}
                  sx={{ mb: 2.5, '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
                />

                <Rotulo>Descrição / detalhes</Rotulo>
                <TextField
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder="O que é, pra quem serve, preço, diferenciais, garantia, brinde… quanto mais detalhe, melhor o roteiro."
                  value={productDescription}
                  onChange={(e) => setProductDescription(e.target.value)}
                  sx={{ mb: 2.5, '& .MuiOutlinedInput-root': { borderRadius: 2.5 } }}
                />

                <Rotulo>Imagem do produto (opcional)</Rotulo>
                <ImageDropzone
                  value={imagemUrl}
                  uploading={enviandoImagem}
                  error={erroImagem}
                  onFile={handleImagem}
                  onClear={() => {
                    setImagemUrl(null);
                    setErroImagem(null);
                  }}
                />

                <Box sx={{ mt: 2.5 }}>
                  <Rotulo>Tom (opcional)</Rotulo>
                </Box>
                <SearchableSelect
                  fullWidth
                  allowCustom
                  placeholder="Escolha ou escreva o seu"
                  value={tone}
                  onChange={setTone}
                  options={TONES.map((t) => ({ value: t, label: t }))}
                />

                {type === 'video' && formato === 'pecas' && (
                  <Box sx={{ mt: 2.5 }}>
                    <Rotulo>Quantas peças de cada?</Rotulo>
                    <Stack direction="row" spacing={1.5} sx={{ mt: 1 }}>
                      {(
                        [
                          ['hooks', 'Ganchos'],
                          ['bodies', 'Corpos'],
                          ['ctas', 'CTAs'],
                        ] as const
                      ).map(([campo, rotulo]) => (
                        <TextField
                          key={campo}
                          type="number"
                          label={rotulo}
                          value={pecas[campo]}
                          // Os tetos são os do Multiplicador: pedir mais peças do
                          // que a tela de upload aceita só geraria texto perdido.
                          inputProps={{ min: 1, max: PECAS_MAX[campo] }}
                          helperText={`até ${PECAS_MAX[campo]}`}
                          onChange={(e) => {
                            const n = Number(e.target.value);
                            if (!Number.isFinite(n)) return;
                            setPecas((prev) => ({
                              ...prev,
                              [campo]: Math.min(
                                Math.max(Math.trunc(n), 1),
                                PECAS_MAX[campo],
                              ),
                            }));
                          }}
                          sx={{
                            width: 110,
                            '& .MuiOutlinedInput-root': { borderRadius: 2.5 },
                          }}
                        />
                      ))}
                    </Stack>
                  </Box>
                )}

                {error && (
                  <Alert severity="error" sx={{ mt: 2 }}>
                    {error}
                  </Alert>
                )}

                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1.5}
                  sx={{ mt: 3, flexWrap: 'wrap', gap: 1 }}
                >
                  {/* Saldo insuficiente é sabido ANTES do clique: travar aqui
                      evita o formulário inteiro terminar num 402. O <span> é
                      necessário porque botão desabilitado não dispara os
                      eventos que o Tooltip escuta. */}
                  <Tooltip title={saldo.motivo}>
                    <span>
                      <Button
                        type="submit"
                        variant="contained"
                        size="large"
                        disabled={busy || enviandoImagem || saldo.insuficiente}
                        startIcon={<AutoAwesomeRoundedIcon />}
                        sx={{ borderRadius: 2.5, px: 3, fontWeight: 700 }}
                      >
                        {busy
                          ? 'Gerando…'
                          : type === 'video' && formato === 'pecas'
                            ? 'Gerar peças'
                            : `Gerar roteiro ${type === 'live' ? 'de live' : 'do vídeo'}`}
                      </Button>
                    </span>
                  </Tooltip>
                  {saldo.insuficiente && (
                    <Button
                      component={Link}
                      to="/planos"
                      variant="outlined"
                      size="large"
                      sx={{ borderRadius: 2.5, fontWeight: 700 }}
                    >
                      {saldo.semPlano ? 'Assinar um plano' : 'Comprar créditos'}
                    </Button>
                  )}
                  <Typography variant="body2" color="text.secondary">
                    {type === 'video' && formato === 'pecas' ? (
                      <>
                        Saída:{' '}
                        <Box component="span" color="primary.main" fontWeight={700}>
                          {pecas.hooks} ganchos · {pecas.bodies} corpos ·{' '}
                          {pecas.ctas} CTAs
                        </Box>{' '}
                        — grave as {pecas.hooks + pecas.bodies + pecas.ctas} peças
                        e suba no Multiplicador para virar{' '}
                        <Box component="span" color="primary.main" fontWeight={700}>
                          {pecas.hooks * pecas.bodies * pecas.ctas} vídeos
                        </Box>
                      </>
                    ) : (
                      <>
                        Estrutura:{' '}
                        <Box component="span" color="primary.main" fontWeight={700}>
                          {type === 'live'
                            ? 'Apresentação · Oferta · Garantia · CTA'
                            : 'Gancho · Corpo · CTA'}
                        </Box>
                      </>
                    )}
                  </Typography>
                </Stack>
              </form>
            </CardContent>
          </Card>

          {result && (
            <Card sx={{ mt: 3, borderRadius: 3 }}>
              <CardContent>
                <Stack
                  direction="row"
                  justifyContent="space-between"
                  alignItems="center"
                  sx={{ mb: 1 }}
                >
                  <Typography variant="h6" fontWeight={800}>
                    {result.productName}
                  </Typography>
                  <IconButton
                    size="small"
                    onClick={() => navigator.clipboard.writeText(result.content)}
                    aria-label="copiar"
                  >
                    <ContentCopyIcon fontSize="small" />
                  </IconButton>
                </Stack>
                <Typography
                  component="pre"
                  variant="body2"
                  sx={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit' }}
                >
                  {result.content}
                </Typography>
              </CardContent>
            </Card>
          )}
        </Grid>
      </Grid>

      {/* Os roteiros salvos só ocupam a tela quando pedidos. */}
      <Collapse in={mostrarSalvos} unmountOnExit>
        <Card sx={{ mt: 3, borderRadius: 3 }}>
          <CardContent>
            <Typography variant="h6" fontWeight={800} gutterBottom>
              Roteiros salvos
            </Typography>
            {scripts.length === 0 ? (
              <Typography color="text.secondary">
                Nenhum roteiro ainda — gere o primeiro aí em cima.
              </Typography>
            ) : (
              <Stack divider={<Divider />}>
                {scripts.map((s) => (
                  <Stack
                    key={s.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ py: 1.25 }}
                  >
                    <Box
                      sx={{ cursor: 'pointer', flexGrow: 1, minWidth: 0 }}
                      onClick={() => {
                        setResult(s);
                        setMostrarSalvos(false);
                      }}
                    >
                      <Typography noWrap fontWeight={600}>
                        {s.productName}
                      </Typography>
                      <Typography variant="body2" color="text.secondary">
                        {s.type === 'live' ? 'Live' : 'Vídeo'} ·{' '}
                        {new Date(s.createdAt).toLocaleString('pt-BR')}
                      </Typography>
                    </Box>
                    <IconButton
                      size="small"
                      onClick={() => handleDelete(s.id)}
                      aria-label="excluir"
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>
      </Collapse>
    </>
  );
}
