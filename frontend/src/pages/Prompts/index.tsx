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
import { PromptTemplate, studioService } from '@/services/studio.service';
import { videogenService } from '@/services/videogen.service';

function PromptCard({ prompt }: { prompt: PromptTemplate }) {
  const navigate = useNavigate();
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [genError, setGenError] = useState<string | null>(null);

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
          disabled={generating}
          sx={{ mt: 1 }}
        >
          {generating
            ? 'Enviando...'
            : prompt.mediaType === 'video'
              ? 'Gerar vídeo com IA'
              : 'Gerar imagem com IA'}
        </Button>
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

      <Grid container spacing={2}>
        {prompts.map((p) => (
          <Grid item xs={12} sm={6} md={4} key={p.id}>
            <PromptCard prompt={p} />
          </Grid>
        ))}
      </Grid>
    </>
  );
}
