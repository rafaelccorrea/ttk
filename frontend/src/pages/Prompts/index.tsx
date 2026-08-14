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
import { useEffect, useState } from 'react';
import { PromptTemplate, studioService } from '@/services/studio.service';

function PromptCard({ prompt }: { prompt: PromptTemplate }) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [copied, setCopied] = useState(false);

  const filled = prompt.fields.reduce(
    (text, field) => text.replaceAll(`{{${field}}}`, values[field] || `{{${field}}}`),
    prompt.template,
  );

  async function copy() {
    await navigator.clipboard.writeText(filled);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
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

      <Box display="flex" gap={2} my={2} flexWrap="wrap">
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
        <TextField
          size="small"
          label="Buscar"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </Box>

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
