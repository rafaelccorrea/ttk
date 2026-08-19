import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import HeadsetMicRoundedIcon from '@mui/icons-material/HeadsetMicRounded';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Grid,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BrandLoader } from '@/components/ui/BrandLoader';
import { useConfirmacao } from '@/components/ui/ConfirmDialog';
import { CREDITS_CHANGED_EVENT } from '@/services/api';
import { LiveSession, liveService } from '@/services/live.service';
import { STATUS_UI, StatusChip, estaProcessando, mensagemDeErro } from './status';
import { CardDoApp } from './CardDoApp';
import { EnvioDialog, duracaoLegivel } from './EnvioDialog';
import { HistoricoDeLives } from './HistoricoDeLives';

/** De quanto em quanto tempo reconsultamos enquanto há live processando. */
const POLL_MS = 8000;


export function LivePage() {
  const navigate = useNavigate();
  const [sessoes, setSessoes] = useState<LiveSession[] | null>(null);
  const { confirmar, dialogoDeConfirmacao } = useConfirmacao();
  const [erro, setErro] = useState<string | null>(null);
  const [dialogo, setDialogo] = useState(false);
  const processandoAntes = useRef(false);

  const carregar = useCallback(async () => {
    try {
      const lista = await liveService.listSessions();
      setSessoes(lista);
      setErro(null);
      return lista;
    } catch (error) {
      setErro(mensagemDeErro(error));
      return null;
    }
  }, []);

  useEffect(() => {
    void carregar();
  }, [carregar]);

  /*
   * Polling com prazo de validade.
   *
   * O efeito depende da própria lista, então ele se re-arma a cada resposta e
   * simplesmente NÃO agenda o próximo ciclo quando nenhuma live está mais
   * processando — em vez de deixar um `setInterval` batendo na API para sempre
   * numa aba esquecida aberta. `setTimeout` e não `setInterval` de propósito:
   * o relógio só recomeça depois que a resposta chegou, então uma consulta
   * lenta nunca empilha a próxima em cima dela.
   */
  useEffect(() => {
    if (!sessoes) return;
    const trabalhando = sessoes.some((s) => estaProcessando(s.status));

    // O débito acontece em background, no fim do pipeline. Quando a última
    // live sai do processamento, o saldo no cabeçalho está velho.
    if (processandoAntes.current && !trabalhando) {
      window.dispatchEvent(new Event(CREDITS_CHANGED_EVENT));
    }
    processandoAntes.current = trabalhando;

    if (!trabalhando) return;
    const timer = window.setTimeout(() => void carregar(), POLL_MS);
    return () => window.clearTimeout(timer);
  }, [sessoes, carregar]);

  async function apagar(sessao: LiveSession) {
    const ok = await confirmar({
      titulo: `Apagar "${sessao.title}"?`,
      mensagem:
        'A base de conhecimento desta live vai junto — produtos, apelidos e respostas. Não dá para desfazer, e reconstruí-la exige enviar a gravação de novo.',
      textoConfirmar: 'Apagar live',
    });
    if (!ok) return;
    try {
      await liveService.deleteSession(sessao.id);
      await carregar();
    } catch (error) {
      setErro(mensagemDeErro(error));
    }
  }

  if (!sessoes) return <BrandLoader label="Carregando suas lives..." />;

  return (
    <>
      {/*
       * O cabeçalho carrega o logo e o gradiente da marca porque esta é a porta
       * de um produto que continua FORA do navegador: daqui a pessoa vai baixar
       * um aplicativo e abri-lo no meio de uma transmissão. Quando ela vir a
       * janela do app, tem que reconhecer que é a mesma coisa que viu aqui.
       */}
      <Box
        sx={{
          position: 'relative',
          overflow: 'hidden',
          borderRadius: 4,
          p: { xs: 2.5, md: 3 },
          mb: 3,
          border: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.paper',
          backgroundImage:
            'radial-gradient(70% 130% at 100% 0%, rgba(254,44,85,0.10) 0%, transparent 60%),' +
            'radial-gradient(50% 100% at 0% 100%, rgba(0,194,187,0.07) 0%, transparent 60%)',
        }}
      >
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ sm: 'center' }}
          justifyContent="space-between"
          spacing={2}
        >
          <Stack direction="row" spacing={1.75} alignItems="center" sx={{ minWidth: 0 }}>
            <Box
              component="img"
              src="/icon-192.png"
              alt=""
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2.5,
                flexShrink: 0,
                boxShadow: '0 6px 22px rgba(254,44,85,0.22)',
              }}
            />
            <Box sx={{ minWidth: 0 }}>
              <Typography
                variant="h5"
                sx={{
                  lineHeight: 1.2,
                  fontWeight: 800,
                  // O gradiente da marca no título, não num enfeite ao lado:
                  // é o mesmo par de cores do app desktop e do ícone.
                  background: 'linear-gradient(90deg, #fe2c55 0%, #00c2bb 100%)',
                  backgroundClip: 'text',
                  WebkitBackgroundClip: 'text',
                  WebkitTextFillColor: 'transparent',
                  width: 'fit-content',
                }}
              >
                Copiloto de Live
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                Suba uma live que você já fez e transforme o que você falou ao
                vivo numa base de conhecimento dos seus produtos.
              </Typography>
              {/* O produto em três passos, para quem chega sem contexto: a
                  jornada atravessa web e desktop e nada mais na tela conta
                  essa ordem. */}
              <Stack
                direction="row"
                spacing={1}
                sx={{ mt: 1.25, flexWrap: 'wrap', rowGap: 0.75 }}
              >
                {['1 · Monte a base', '2 · Instale o app', '3 · Entre ao vivo'].map(
                  (passo) => (
                    <Chip
                      key={passo}
                      size="small"
                      variant="outlined"
                      label={passo}
                      sx={{ fontWeight: 700 }}
                    />
                  ),
                )}
              </Stack>
            </Box>
          </Stack>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            onClick={() => setDialogo(true)}
            sx={{ flexShrink: 0, alignSelf: { xs: 'flex-start', sm: 'center' } }}
          >
            Nova base
          </Button>
        </Stack>
      </Box>

      {erro && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {erro}
        </Alert>
      )}

      {/*
       * O app vem ANTES da lista, e não no fim da página, porque sem ele metade
       * do produto não existe: a base montada aqui só vira resposta no chat
       * quando o aplicativo está rodando na live. Quem chega nesta tela precisa
       * descobrir isso agora, não depois de procurar.
       */}
      <CardDoApp paraQuem="lista" />

      {/*
       * Some sozinho para quem nunca transmitiu — ver `HistoricoDeLives`. Fica
       * acima das bases porque, para quem já usa o produto, "como foi a última
       * live" é a pergunta que traz a pessoa a esta tela.
       */}
      <HistoricoDeLives />

      {sessoes.length === 0 ? (
        <Card
          sx={{
            textAlign: 'center',
            py: { xs: 5, md: 8 },
            px: 3,
            borderStyle: 'dashed',
            // Vazio não é erro: a moldura tracejada diz "aqui vai entrar
            // alguma coisa" em vez de parecer um card que falhou ao carregar.
            bgcolor: 'transparent',
            '&:hover': { bgcolor: 'transparent' },
          }}
        >
          <Box
            sx={{
              width: 72,
              height: 72,
              mx: 'auto',
              mb: 2,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'rgba(254,44,85,0.08)',
            }}
          >
            <HeadsetMicRoundedIcon sx={{ fontSize: 34, color: '#fe2c55' }} />
          </Box>
          <Typography variant="h6" fontWeight={800} mb={1}>
            Sua live sabe tudo sobre seus produtos. Falta só anotar.
          </Typography>
          <Typography color="text.secondary" sx={{ maxWidth: 560, mx: 'auto', mb: 3 }}>
            Você já respondeu mil vezes preço, tamanho, cor, frete e "chega
            quando?" ao vivo. Suba a gravação de uma live e a gente ouve tudo,
            separa cada produto com preço, variações, frete e promoção, e junta as
            perguntas e objeções que o chat mais repete. Depois você revisa e
            corrige o que quiser — a base fica sua.
          </Typography>
          <Button
            variant="contained"
            size="large"
            startIcon={<UploadFileRoundedIcon />}
            onClick={() => setDialogo(true)}
          >
            Enviar minha primeira live
          </Button>
        </Card>
      ) : (
        <Grid container spacing={2}>
          {sessoes.map((sessao) => {
            const ui = STATUS_UI[sessao.status];
            return (
              <Grid item xs={12} md={6} key={sessao.id}>
                <Card
                  sx={{
                    height: '100%',
                    display: 'flex',
                    flexDirection: 'column',
                    position: 'relative',
                    overflow: 'hidden',
                    // Uma base pronta é a que o vendedor veio buscar — ela se
                    // distingue por um fio verde na borda de cima, legível de
                    // relance numa grade de oito cards. As em processamento
                    // ficam neutras: não há nada a fazer com elas ainda.
                    '&::before':
                      sessao.status === 'pronta'
                        ? {
                            content: '""',
                            position: 'absolute',
                            top: 0,
                            left: 0,
                            right: 0,
                            height: 2,
                            bgcolor: 'success.main',
                          }
                        : undefined,
                  }}
                >
                  <CardActionArea
                    onClick={() => navigate(`/copiloto/${sessao.id}`)}
                    sx={{ flex: 1, alignItems: 'flex-start' }}
                  >
                    <CardContent>
                      <Stack
                        direction="row"
                        alignItems="flex-start"
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Typography fontWeight={800} sx={{ flexGrow: 1, lineHeight: 1.35 }}>
                          {sessao.title}
                        </Typography>
                        <StatusChip status={sessao.status} />
                      </Stack>

                      <Typography
                        variant="body2"
                        color="text.secondary"
                        mt={1}
                        sx={{ lineHeight: 1.55 }}
                      >
                        {sessao.status === 'erro'
                          ? (sessao.errorMessage ?? ui.dica)
                          : ui.dica}
                      </Typography>

                      <Stack direction="row" spacing={1} mt={1.5} flexWrap="wrap" useFlexGap>
                        {duracaoLegivel(sessao.durationSeconds) && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`Live de ${duracaoLegivel(sessao.durationSeconds)}`}
                          />
                        )}
                        {sessao.creditsSpent > 0 && (
                          <Chip
                            size="small"
                            variant="outlined"
                            label={`${sessao.creditsSpent} créditos usados`}
                          />
                        )}
                        <Chip
                          size="small"
                          variant="outlined"
                          label={new Date(sessao.createdAt).toLocaleDateString('pt-BR')}
                        />
                      </Stack>
                    </CardContent>
                  </CardActionArea>
                  <Box display="flex" justifyContent="flex-end" px={1.5} pb={1}>
                    <Tooltip title="Apagar esta live">
                      <span>
                        <IconButton
                          size="small"
                          aria-label={`Apagar ${sessao.title}`}
                          onClick={() => void apagar(sessao)}
                          disabled={estaProcessando(sessao.status)}
                        >
                          <DeleteOutlineRoundedIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Card>
              </Grid>
            );
          })}
        </Grid>
      )}

      <EnvioDialog
        aberto={dialogo}
        onFechar={() => setDialogo(false)}
        onPronta={(id) => {
          setDialogo(false);
          navigate(`/copiloto/${id}`);
        }}
      />
      {dialogoDeConfirmacao}
    </>
  );
}
