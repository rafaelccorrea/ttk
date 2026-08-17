import AddRoundedIcon from '@mui/icons-material/AddRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  Card,
  CircularProgress,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { CurrencyField } from '@/components/ui/CurrencyField';
import { ScrollX } from '@/components/ui/ScrollX';
import { CREDITS_CHANGED_EVENT } from '@/services/api';
import { formatMoney } from '@/utils/format';
import {
  FaqInput,
  LiveFaq,
  LiveFaqKind,
  LiveProduct,
  LiveSessionDetail,
  ProdutoInput,
  ResultadoDaImportacao,
  liveService,
} from '@/services/live.service';
import { STATUS_UI, StatusChip, OrigemChip, estaProcessando, mensagemDeErro } from './status';
import { CardDoApp } from './CardDoApp';

const POLL_MS = 8000;

const ROTULO_TIPO: Record<LiveFaqKind, string> = {
  faq: 'Pergunta do chat',
  objecao: 'Objeção',
  politica: 'Política da loja',
};

/**
 * Listas que o vendedor digita separadas por vírgula.
 *
 * Variações e apelidos são arrays no backend, mas pedir um campo por item numa
 * tabela de 30 produtos é tortura. A vírgula é o separador que quem vende já
 * usa ao falar ("P, M e G"), e o `filter` cuida da vírgula sobrando no fim.
 */
function paraLista(texto: string): string[] {
  return texto
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function deLista(itens: unknown[] | undefined): string {
  return (itens ?? []).map((item) => String(item)).join(', ');
}

// ---------------------------------------------------------------- produtos
function ProdutoDialog({
  aberto,
  produto,
  onFechar,
  onSalvar,
}: {
  aberto: boolean;
  /** `null` = cadastro novo, à mão. */
  produto: LiveProduct | null;
  onFechar: () => void;
  onSalvar: (dto: ProdutoInput & { name: string }) => Promise<void>;
}) {
  const [nome, setNome] = useState('');
  const [preco, setPreco] = useState<number | null>(null);
  const [variacoes, setVariacoes] = useState('');
  const [frete, setFrete] = useState('');
  const [promo, setPromo] = useState('');
  const [apelidos, setApelidos] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setNome(produto?.name ?? '');
    setPreco(produto?.priceBrl != null ? Number(produto.priceBrl) : null);
    setVariacoes(deLista(produto?.variants));
    setFrete(produto?.shippingInfo ?? '');
    setPromo(produto?.promo ?? '');
    setApelidos(deLista(produto?.aliases));
    setErro(null);
  }, [aberto, produto]);

  async function salvar() {
    if (!nome.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar({
        name: nome.trim(),
        priceBrl: preco,
        variants: paraLista(variacoes),
        shippingInfo: frete.trim(),
        promo: promo.trim(),
        aliases: paraLista(apelidos),
      });
      onFechar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={salvando ? undefined : onFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>
        {produto ? 'Corrigir produto' : 'Novo produto'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} mt={0.5}>
          <TextField
            label="Nome do produto"
            value={nome}
            onChange={(e) => setNome(e.target.value.slice(0, 200))}
            fullWidth
            autoFocus
          />
          <CurrencyField label="Preço" value={preco} onChange={setPreco} fullWidth />
          <TextField
            label="Variações"
            placeholder="P, M, G"
            helperText="Tamanhos, cores ou kits, separados por vírgula."
            value={variacoes}
            onChange={(e) => setVariacoes(e.target.value)}
            fullWidth
          />
          <TextField
            label="Frete"
            placeholder="Frete grátis acima de R$ 199"
            value={frete}
            onChange={(e) => setFrete(e.target.value.slice(0, 500))}
            fullWidth
          />
          <TextField
            label="Promoção"
            placeholder="Leve 2 pague 1 só hoje"
            value={promo}
            onChange={(e) => setPromo(e.target.value.slice(0, 500))}
            fullWidth
          />
          <TextField
            label="Como o chat chama este produto"
            placeholder="o kit rosa, aquele de 129"
            helperText="Os apelidos que aparecem nas perguntas. Ninguém digita o nome do catálogo — quanto mais apelidos, mais fácil achar o produto certo."
            value={apelidos}
            onChange={(e) => setApelidos(e.target.value)}
            fullWidth
          />
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button variant="contained" onClick={salvar} disabled={!nome.trim() || salvando}>
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// -------------------------------------------------------------------- FAQ
function FaqDialog({
  aberto,
  faq,
  produtos,
  onFechar,
  onSalvar,
}: {
  aberto: boolean;
  faq: LiveFaq | null;
  produtos: LiveProduct[];
  onFechar: () => void;
  onSalvar: (dto: FaqInput & { question: string; answer: string }) => Promise<void>;
}) {
  const [pergunta, setPergunta] = useState('');
  const [resposta, setResposta] = useState('');
  const [tipo, setTipo] = useState<LiveFaqKind>('faq');
  const [produtoId, setProdutoId] = useState('');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    if (!aberto) return;
    setPergunta(faq?.question ?? '');
    setResposta(faq?.answer ?? '');
    setTipo(faq?.kind ?? 'faq');
    setProdutoId(faq?.liveProductId ?? '');
    setErro(null);
  }, [aberto, faq]);

  async function salvar() {
    if (!pergunta.trim() || !resposta.trim()) return;
    setSalvando(true);
    setErro(null);
    try {
      await onSalvar({
        question: pergunta.trim(),
        answer: resposta.trim(),
        kind: tipo,
        // String vazia não é UUID: o backend recusaria. `null` é o jeito certo
        // de dizer "esta resposta vale para a live inteira".
        liveProductId: produtoId || null,
      });
      onFechar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Dialog open={aberto} onClose={salvando ? undefined : onFechar} fullWidth maxWidth="sm">
      <DialogTitle sx={{ fontWeight: 800 }}>
        {faq ? 'Corrigir resposta' : 'Nova resposta'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2.5} mt={0.5}>
          <TextField
            label="O que perguntam"
            placeholder="Chega em quantos dias?"
            value={pergunta}
            onChange={(e) => setPergunta(e.target.value.slice(0, 500))}
            fullWidth
            autoFocus
          />
          <TextField
            label="Como você responde"
            placeholder="De 5 a 9 dias úteis para todo o Brasil."
            value={resposta}
            onChange={(e) => setResposta(e.target.value.slice(0, 2000))}
            fullWidth
            multiline
            minRows={3}
          />
          <TextField
            select
            label="Tipo"
            value={tipo}
            onChange={(e) => setTipo(e.target.value as LiveFaqKind)}
            fullWidth
          >
            {(Object.keys(ROTULO_TIPO) as LiveFaqKind[]).map((k) => (
              <MenuItem key={k} value={k}>
                {ROTULO_TIPO[k]}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            label="Produto"
            helperText="Prazo de entrega e troca valem para a live toda — deixe em 'Vale para a live inteira'."
            value={produtoId}
            onChange={(e) => setProdutoId(e.target.value)}
            fullWidth
          >
            <MenuItem value="">Vale para a live inteira</MenuItem>
            {produtos.map((p) => (
              <MenuItem key={p.id} value={p.id}>
                {p.name}
              </MenuItem>
            ))}
          </TextField>
          {erro && <Alert severity="error">{erro}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onFechar} disabled={salvando}>
          Cancelar
        </Button>
        <Button
          variant="contained"
          onClick={salvar}
          disabled={!pergunta.trim() || !resposta.trim() || salvando}
        >
          Salvar
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ------------------------------------------------------------------ página
export function LiveDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const [sessao, setSessao] = useState<LiveSessionDetail | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [naoEncontrada, setNaoEncontrada] = useState(false);
  const [produtoEditando, setProdutoEditando] = useState<LiveProduct | null>(null);
  const [produtoDialogo, setProdutoDialogo] = useState(false);
  const [faqEditando, setFaqEditando] = useState<LiveFaq | null>(null);
  const [faqDialogo, setFaqDialogo] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] =
    useState<ResultadoDaImportacao | null>(null);
  const processandoAntes = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const detalhe = await liveService.getSession(id);
      setSessao(detalhe);
      setErro(null);
    } catch (error) {
      const status = (error as { response?: { status?: number } })?.response?.status;
      if (status === 404) setNaoEncontrada(true);
      else setErro(mensagemDeErro(error));
    }
  }, [id]);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /**
   * Importa a planilha e recarrega a base.
   *
   * O resultado fica na tela até o vendedor fechar — não some sozinho. Ele
   * precisa ler quantas linhas ficaram de fora, e um aviso que desaparece em
   * três segundos é o mesmo que não avisar.
   */
  const importarCsv = useCallback(
    async (arquivo: File) => {
      setImportando(true);
      setErro(null);
      setResultadoImport(null);
      try {
        const resultado = await liveService.importarCatalogo(id, arquivo);
        setResultadoImport(resultado);
        await carregar();
      } catch (error) {
        setErro(mensagemDeErro(error));
      } finally {
        setImportando(false);
      }
    },
    [id, carregar],
  );

  // Mesmo polling da listagem: reagenda enquanto a live trabalha e para sozinho
  // quando ela chega em `pronta` ou `erro`.
  useEffect(() => {
    if (!sessao) return;
    const trabalhando = estaProcessando(sessao.status);
    if (processandoAntes.current && !trabalhando) {
      window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
    }
    processandoAntes.current = trabalhando;
    if (!trabalhando) return;
    const timer = window.setTimeout(() => void carregar(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [sessao, carregar]);

  if (naoEncontrada) {
    return (
      <Alert severity="warning">
        Não achamos esta live. Ela pode ter sido apagada.{' '}
        <Link to="/copiloto">Voltar para minhas lives</Link>
      </Alert>
    );
  }

  if (!sessao) {
    return erro ? (
      <Alert severity="error">{erro}</Alert>
    ) : (
      <BrandLoader label="Abrindo sua base..." />
    );
  }

  const ui = STATUS_UI[sessao.status];
  const daIa = sessao.produtos.filter((p) => p.origin === 'ia').length;
  const revisar = sessao.produtos.filter(
    (p) => p.origin === 'ia' && p.confidence != null && Number(p.confidence) < 0.6,
  ).length;

  async function salvarProduto(dto: ProdutoInput & { name: string }) {
    if (produtoEditando) await liveService.updateProduct(produtoEditando.id, dto);
    else await liveService.createProduct(id, dto);
    await carregar();
  }

  async function salvarFaq(dto: FaqInput & { question: string; answer: string }) {
    if (faqEditando) await liveService.updateFaq(faqEditando.id, dto);
    else await liveService.createFaq(id, dto);
    await carregar();
  }

  async function alternarAtivo(produto: LiveProduct) {
    try {
      await liveService.updateProduct(produto.id, { active: !produto.active });
      await carregar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  async function apagarProduto(produto: LiveProduct) {
    if (!window.confirm(`Tirar "${produto.name}" da base?`)) return;
    try {
      await liveService.deleteProduct(produto.id);
      await carregar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  async function apagarFaq(faq: LiveFaq) {
    if (!window.confirm('Tirar esta resposta da base?')) return;
    try {
      await liveService.deleteFaq(faq.id);
      await carregar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  return (
    <>
      <Button
        startIcon={<ArrowBackRoundedIcon />}
        onClick={() => navigate('/copiloto')}
        sx={{ mb: 1 }}
      >
        Minhas lives
      </Button>

      <Stack direction="row" alignItems="center" spacing={1.5} flexWrap="wrap" useFlexGap>
        <Typography variant="h5">{sessao.title}</Typography>
        <StatusChip status={sessao.status} />
      </Stack>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5, mb: 2.5 }}>
        {sessao.creditsSpent > 0
          ? `${ui.dica} · ${sessao.creditsSpent} créditos usados nesta live.`
          : ui.dica}
      </Typography>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {estaProcessando(sessao.status) && (
        <Card sx={{ mb: 2.5 }}>
          <LinearProgress />
          <CardContent>
            <Typography fontWeight={800} mb={0.5}>
              {ui.label}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {ui.dica} Esta tela se atualiza sozinha — não precisa recarregar nem
              enviar a gravação de novo.
            </Typography>
          </CardContent>
        </Card>
      )}

      {sessao.status === 'erro' && (
        <Alert severity="error" sx={{ mb: 2.5 }}>
          <AlertTitle>Não deu para terminar esta live</AlertTitle>
          {sessao.errorMessage ??
            'O processamento falhou e não recebemos o motivo. Tente enviar a gravação de novo.'}
        </Alert>
      )}

      {sessao.status === 'pronta' && revisar > 0 && (
        <Alert severity="warning" sx={{ mb: 2.5 }}>
          {revisar === 1
            ? 'Tem 1 produto que a IA não entendeu direito. Ele está no topo da lista — confira o preço antes de usar.'
            : `Tem ${revisar} produtos que a IA não entendeu direito. Eles estão no topo da lista — confira os preços antes de usar.`}
        </Alert>
      )}

      {/*
       * O passo que faltava no fluxo.
       *
       * Base pronta é meio produto: ela não responde ninguém sozinha. Quem lê o
       * chat e escreve durante a transmissão é o aplicativo de computador, e
       * este é o único momento em que o vendedor está olhando para a base dele
       * pronta — exatamente quando a próxima ação faz sentido. Deixar o convite
       * só na lista, lá atrás, era pedir que ele descobrisse por conta própria
       * que existe uma segunda metade.
       */}
      {sessao.status === 'pronta' && <CardDoApp paraQuem="detalhe" />}

      {/* ------------------------------------------------------- produtos */}
      <Card sx={{ mb: 3 }}>
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
            spacing={1}
            mb={1.5}
          >
            <Box>
              <Typography fontWeight={800}>Produtos desta live</Typography>
              <Typography variant="body2" color="text.secondary">
                {sessao.produtos.length === 0
                  ? 'Nenhum produto na base ainda.'
                  : `${sessao.produtos.length} no total · ${daIa} vieram da sua live`}
              </Typography>
            </Box>
            <Stack direction="row" spacing={1}>
              {/*
               * A extração só conhece o que foi FALADO na live — e o vendedor
               * mostra vinte itens numa transmissão enquanto tem duzentos na
               * loja. O chat pergunta pelos duzentos, e ninguém cadastra
               * duzentos à mão.
               */}
              <Button
                component="label"
                variant="outlined"
                color="inherit"
                startIcon={
                  importando ? (
                    <CircularProgress size={16} />
                  ) : (
                    <UploadFileRoundedIcon />
                  )
                }
                disabled={importando}
              >
                {importando ? 'Importando...' : 'Importar CSV'}
                <input
                  hidden
                  type="file"
                  accept=".csv,text/csv"
                  onChange={(e) => {
                    const arquivo = e.target.files?.[0];
                    // Zera o input: sem isto, escolher o MESMO arquivo de novo
                    // (o caso normal depois de corrigir a planilha) não dispara
                    // evento nenhum e a tela parece travada.
                    e.target.value = '';
                    if (arquivo) void importarCsv(arquivo);
                  }}
                />
              </Button>
              <Button
                variant="outlined"
                startIcon={<AddRoundedIcon />}
                onClick={() => {
                  setProdutoEditando(null);
                  setProdutoDialogo(true);
                }}
              >
                Adicionar produto
              </Button>
            </Stack>
          </Stack>

          {resultadoImport && (
            <Alert
              severity={resultadoImport.ignoradas.length ? 'warning' : 'success'}
              onClose={() => setResultadoImport(null)}
              sx={{ mb: 2 }}
            >
              <AlertTitle>
                {resultadoImport.criados} novos ·{' '}
                {resultadoImport.atualizados} atualizados
              </AlertTitle>
              {resultadoImport.ignoradas.length > 0 && (
                <>
                  {resultadoImport.ignoradas.length}{' '}
                  {resultadoImport.ignoradas.length === 1
                    ? 'linha ficou de fora'
                    : 'linhas ficaram de fora'}
                  :{' '}
                  {resultadoImport.ignoradas
                    .slice(0, 3)
                    .map((i: { linha: number; motivo: string }) => `linha ${i.linha} (${i.motivo})`)
                    .join('; ')}
                  {resultadoImport.ignoradas.length > 3 && ' ...'}
                </>
              )}
            </Alert>
          )}

          {sessao.produtos.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Quando o processamento terminar, os produtos que você citou na live
              aparecem aqui. Você também pode cadastrar um à mão a qualquer hora.
            </Typography>
          ) : (
            <ScrollX>
              <Table size="small" sx={{ minWidth: 860 }}>
                <TableHead>
                  <TableRow>
                    <TableCell>Produto</TableCell>
                    <TableCell>Preço</TableCell>
                    <TableCell>Variações</TableCell>
                    <TableCell>Frete</TableCell>
                    <TableCell>Apelidos no chat</TableCell>
                    <TableCell align="center">Usar</TableCell>
                    <TableCell align="right">Ações</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {sessao.produtos.map((produto) => (
                    <TableRow key={produto.id} sx={{ opacity: produto.active ? 1 : 0.55 }}>
                      <TableCell>
                        <Typography fontWeight={700}>{produto.name}</Typography>
                        <Box mt={0.5}>
                          <OrigemChip origin={produto.origin} confidence={produto.confidence} />
                        </Box>
                        {produto.promo && (
                          <Typography variant="caption" color="text.secondary" display="block">
                            {produto.promo}
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>
                        {produto.priceBrl != null ? (
                          formatMoney(Number(produto.priceBrl))
                        ) : (
                          <Typography variant="body2" color="warning.main">
                            sem preço
                          </Typography>
                        )}
                      </TableCell>
                      <TableCell>{deLista(produto.variants) || '—'}</TableCell>
                      <TableCell sx={{ maxWidth: 200 }}>
                        {produto.shippingInfo || '—'}
                      </TableCell>
                      <TableCell sx={{ maxWidth: 220 }}>
                        {produto.aliases.length ? (
                          <Stack direction="row" spacing={0.5} flexWrap="wrap" useFlexGap>
                            {produto.aliases.map((apelido) => (
                              <Chip key={apelido} size="small" label={apelido} />
                            ))}
                          </Stack>
                        ) : (
                          '—'
                        )}
                      </TableCell>
                      <TableCell align="center">
                        {/* Desligar esconde o produto sem apagar o histórico —
                            serve para o que saiu de estoque no meio da live. */}
                        <Tooltip
                          title={
                            produto.active
                              ? 'Este produto está valendo'
                              : 'Guardado: não vai ser usado nas respostas'
                          }
                        >
                          <Switch
                            size="small"
                            checked={produto.active}
                            onChange={() => void alternarAtivo(produto)}
                          />
                        </Tooltip>
                      </TableCell>
                      <TableCell align="right">
                        {/* O rótulo carrega o nome do produto: numa tabela de 30
                            linhas, "editar" sozinho não diz editar o quê. */}
                        <IconButton
                          size="small"
                          aria-label={`Corrigir ${produto.name}`}
                          onClick={() => {
                            setProdutoEditando(produto);
                            setProdutoDialogo(true);
                          }}
                        >
                          <EditRoundedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`Tirar ${produto.name} da base`}
                          onClick={() => void apagarProduto(produto)}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </ScrollX>
          )}
        </CardContent>
      </Card>

      {/* ------------------------------------------------------------ FAQ */}
      <Card>
        <CardContent>
          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            alignItems={{ sm: 'center' }}
            justifyContent="space-between"
            spacing={1}
            mb={1.5}
          >
            <Box>
              <Typography fontWeight={800}>Perguntas, objeções e políticas</Typography>
              <Typography variant="body2" color="text.secondary">
                O que o chat mais pergunta e o que trava a compra.
              </Typography>
            </Box>
            <Button
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={() => {
                setFaqEditando(null);
                setFaqDialogo(true);
              }}
            >
              Adicionar resposta
            </Button>
          </Stack>

          {sessao.faq.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Nada aqui ainda. Prazo de entrega, troca, formas de pagamento e o
              famoso "tá caro" são bons primeiros cadastros.
            </Typography>
          ) : (
            <Stack divider={<Divider flexItem />} spacing={0}>
              {sessao.faq.map((item) => {
                const produto = sessao.produtos.find((p) => p.id === item.liveProductId);
                return (
                  <Box key={item.id} py={1.5}>
                    <Stack
                      direction="row"
                      alignItems="flex-start"
                      justifyContent="space-between"
                      spacing={1}
                    >
                      <Box flexGrow={1}>
                        <Typography fontWeight={700}>{item.question}</Typography>
                        <Typography variant="body2" color="text.secondary" mt={0.5}>
                          {item.answer}
                        </Typography>
                        <Stack
                          direction="row"
                          spacing={0.75}
                          mt={1}
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Chip size="small" variant="outlined" label={ROTULO_TIPO[item.kind]} />
                          <OrigemChip origin={item.origin} />
                          <Chip
                            size="small"
                            variant="outlined"
                            label={produto ? produto.name : 'Vale para a live inteira'}
                          />
                        </Stack>
                      </Box>
                      <Box whiteSpace="nowrap">
                        <IconButton
                          size="small"
                          aria-label={`Corrigir resposta: ${item.question}`}
                          onClick={() => {
                            setFaqEditando(item);
                            setFaqDialogo(true);
                          }}
                        >
                          <EditRoundedIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`Tirar resposta: ${item.question}`}
                          onClick={() => void apagarFaq(item)}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </Box>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          )}
        </CardContent>
      </Card>

      <ProdutoDialog
        aberto={produtoDialogo}
        produto={produtoEditando}
        onFechar={() => setProdutoDialogo(false)}
        onSalvar={salvarProduto}
      />
      <FaqDialog
        aberto={faqDialogo}
        faq={faqEditando}
        produtos={sessao.produtos}
        onFechar={() => setFaqDialogo(false)}
        onSalvar={salvarFaq}
      />
    </>
  );
}
