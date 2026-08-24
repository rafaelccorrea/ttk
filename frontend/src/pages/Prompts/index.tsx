import AutoAwesomeRoundedIcon from '@mui/icons-material/AutoAwesomeRounded';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Grid,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { FilterBar, SearchField } from '@/components/ui/Filters';
import { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiErrorMessage } from '@/contexts/AuthContext';
import { billingService, Wallet } from '@/services/billing.service';
import {
  PromptsRefreshStatus,
  PromptTemplate,
  studioService,
} from '@/services/studio.service';
import { videogenService } from '@/services/videogen.service';

function PromptCard({ prompt, wallet }: { prompt: PromptTemplate; wallet: Wallet | null }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

  /**
   * O custo tem que aparecer ANTES do clique.
   * Gerar vídeo é a ação mais cara do produto (60 créditos) e disparava com um
   * clique único, sem preço à vista e sem confirmação — o usuário só descobria
   * o tamanho da conta olhando o saldo depois. Créditos gastos não voltam
   * (o estorno só cobre falha da geração), então o preço é informação de
   * decisão, não detalhe.
   */
  const preco = wallet?.prices?.[prompt.mediaType]?.credits ?? null;
  // O vídeo de cortesia: este vídeo sai sem debitar, então nem o preço nem a
  // trava de saldo valem — o que a tela diz é que ele é por nossa conta.
  const cortesia = prompt.mediaType === 'video' && wallet?.sampleVideo?.available === true;
  const semSaldo = !cortesia && wallet !== null && preco !== null && wallet.credits < preco;

  const filled = prompt.fields.reduce(
    (text, field) => text.replaceAll(`{{${field}}}`, values[field] || `{{${field}}}`),
    prompt.template,
  );

  async function copy() {
    await navigator.clipboard.writeText(filled);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  // Trava síncrona: o estado `generating` só desabilita o botão no próximo
  // render, e um duplo-clique cabe nessa janela — cada disparo extra é
  // crédito do usuário queimado numa geração idêntica.
  const generatingRef = useRef(false);

  // Gera a mídia com IA (Higgsfield) e leva o usuário para a galeria.
  async function generate() {
    if (generatingRef.current) return;
    generatingRef.current = true;
    setGenError(null);
    setGenerating(true);
    try {
      await videogenService.generate({
        kind: prompt.mediaType,
        prompt: filled,
        aspectRatio: '9:16',
      });
      navigate('/geracoes');
    } catch (err) {
      setGenError(apiErrorMessage(err));
    } finally {
      generatingRef.current = false;
      setGenerating(false);
    }
  }

  return (
    <Card sx={{ height: '100%' }}>
      <CardContent>
        <Box display="flex" gap={1} mb={1} flexWrap="wrap">
          <Chip
            size="small"
            color="secondary"
            label={prompt.mediaType === 'video' ? 'Vídeo' : 'Imagem'}
          />
          {prompt.durationSec && (
            <Chip size="small" label={`${prompt.durationSec}s`} />
          )}
          {prompt.tags.map((t) => (
            <Chip key={t} size="small" variant="outlined" label={t} />
          ))}
          {/* Procedência à vista: "em alta" é um formato que a plataforma
              acabou de extrair dos anúncios que estão vendendo, não do acervo
              fixo. É a diferença entre um cofre vivo e uma lista velha. */}
          {prompt.source === 'auto' && (
            <Chip size="small" color="warning" label="em alta" sx={{ fontWeight: 700 }} />
          )}
        </Box>
        <Typography fontWeight={600} gutterBottom>
          {prompt.title}
        </Typography>
        <Typography variant="body2" color="text.secondary" gutterBottom>
          {filled}
        </Typography>
        {prompt.fields.map((field) => (
          <TextField
            key={field}
            size="small"
            fullWidth
            label={field}
            margin="dense"
            value={values[field] ?? ''}
            onChange={(e) =>
              setValues((prev) => ({ ...prev, [field]: e.target.value }))
            }
          />
        ))}
        <Button
          fullWidth
          variant="contained"
          size="small"
          startIcon={<ContentCopyIcon />}
          onClick={copy}
          sx={{ mt: 1 }}
        >
          {copied ? 'Copiado!' : 'Copiar prompt'}
        </Button>
        <Button
          fullWidth
          variant="outlined"
          size="small"
          startIcon={<AutoAwesomeRoundedIcon />}
          onClick={generate}
          disabled={generating || semSaldo}
          sx={{ mt: 1 }}
        >
          {generating
            ? 'Enviando...'
            : `${prompt.mediaType === 'video' ? 'Gerar vídeo com IA' : 'Gerar imagem com IA'}${
                cortesia ? ' · por nossa conta' : preco !== null ? ` · ${preco} cr` : ''
              }`}
        </Button>
        {cortesia && (
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            Seu primeiro vídeo com IA é cortesia — não gasta seus créditos.
          </Typography>
        )}
        {semSaldo && (
          <Typography variant="caption" color="text.secondary" display="block" mt={0.5}>
            Saldo insuficiente ({wallet?.credits} cr). Recarregue em Planos &
            Créditos.
          </Typography>
        )}
        {genError && (
          <Typography variant="caption" color="error" display="block" mt={0.5}>
            {genError}
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}

export function PromptsPage() {
  const [prompts, setPrompts] = useState<PromptTemplate[]>([]);
  const [mediaType, setMediaType] = useState<'video' | 'image' | ''>('');
  const [search, setSearch] = useState('');
  const [wallet, setWallet] = useState<Wallet | null>(null);
  const [refresh, setRefresh] = useState<PromptsRefreshStatus | null>(null);

  // Uma leitura só para a página inteira: o preço é o mesmo em todos os cards.
  useEffect(() => {
    billingService.wallet().then(setWallet).catch(console.error);
    studioService.promptsRefreshStatus().then(setRefresh).catch(console.error);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      studioService
        .listPrompts({
          mediaType: mediaType || undefined,
          search: search || undefined,
        })
        .then(setPrompts)
        .catch(console.error);
    }, 300);
    return () => clearTimeout(timer);
  }, [mediaType, search]);

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Cofre de Prompts
      </Typography>
      <Typography color="text.secondary" gutterBottom>
        Prompts prontos de vídeo e imagem IA — preencha os campos e copie.
      </Typography>

      {/* O Cofre se atualiza sozinho toda semana a partir dos anúncios que
          estão vendendo. Dizer isso é metade do valor: sem a data, o usuário
          não tem como saber se está olhando um formato atual ou de um ano
          atrás — e é exatamente essa dúvida que faz ele parar de voltar aqui. */}
      {refresh?.nextRunAt && (
        <Typography variant="caption" color="text.secondary" display="block">
          {refresh.isRunning
            ? 'Destilando novos formatos agora...'
            : // Sem ponto final no fim: em pt-BR o mês abreviado já sai com um
              // ("17 de ago."), e somar o meu produzia "ago..".
              `Atualizado a partir dos anúncios que mais venderam nos últimos 30 dias. Próxima leva em ${new Date(
                refresh.nextRunAt,
              ).toLocaleDateString('pt-BR', {
                weekday: 'long',
                day: '2-digit',
                month: 'short',
              })}`}
        </Typography>
      )}

      <FilterBar sx={{ my: 2 }}>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={mediaType}
          onChange={(_e, value) => setMediaType(value ?? '')}
        >
          <ToggleButton value="">Todos</ToggleButton>
          <ToggleButton value="video">Vídeo</ToggleButton>
          <ToggleButton value="image">Imagem</ToggleButton>
        </ToggleButtonGroup>
        <SearchField
          value={search}
          onChange={setSearch}
          placeholder="Buscar prompt"
        />
      </FilterBar>

      {/* Sem isto a busca sem resultado deixava a tela em branco, o que se
          confunde com erro de carregamento. */}
      {prompts.length === 0 && (search || mediaType) && (
        <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
          Nenhum prompt encontrado para esse filtro.
        </Typography>
      )}

      <Grid container spacing={2}>
        {prompts.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <PromptCard prompt={p} wallet={wallet} />
          </Grid>
        ))}
      </Grid>
    </>
  );
}
