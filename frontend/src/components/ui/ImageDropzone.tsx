import { Box, IconButton, Typography } from '@mui/material';
import AddPhotoAlternateRoundedIcon from '@mui/icons-material/AddPhotoAlternateRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { ChangeEvent, DragEvent, useRef, useState } from 'react';

interface ImageDropzoneProps {
  /** URL já enviada, ou `null` quando ainda não há foto. */
  value: string | null;
  /** Recebe o arquivo escolhido; quem chama faz o upload. */
  onFile: (file: File) => void;
  onClear: () => void;
  uploading?: boolean;
  label?: string;
  hint?: string;
  error?: string | null;
}

/**
 * Área de arrastar-e-soltar para UMA imagem.
 *
 * O `<input type="file">` cru resolve o clique mas não o arrasto, que é como
 * a pessoa já traz a foto do produto da pasta de downloads. A miniatura fica
 * dentro da própria área: sem ela não dá para saber se subiu a foto certa.
 */
export function ImageDropzone({
  value,
  onFile,
  onClear,
  uploading,
  label = 'Arraste a imagem aqui ou clique para enviar',
  hint = 'PNG/JPG — ajuda a IA a entender o produto',
  error,
}: ImageDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [sobre, setSobre] = useState(false);

  function escolher(file?: File | null) {
    if (!file) return;
    // Filtro no cliente é conveniência: quem valida de verdade é o servidor,
    // decodificando a imagem.
    if (!file.type.startsWith('image/')) return;
    onFile(file);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setSobre(false);
    escolher(event.dataTransfer.files?.[0]);
  }

  function handleInput(event: ChangeEvent<HTMLInputElement>) {
    escolher(event.target.files?.[0]);
    // Permite reenviar o mesmo arquivo depois de remover.
    event.target.value = '';
  }

  return (
    <Box>
      <Box
        onClick={() => !uploading && inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setSobre(true);
        }}
        onDragLeave={() => setSobre(false)}
        onDrop={handleDrop}
        sx={{
          position: 'relative',
          border: '1.5px dashed',
          borderColor: error ? 'error.main' : sobre ? 'primary.main' : 'divider',
          bgcolor: sobre ? 'action.hover' : 'action.selected',
          borderRadius: 2.5,
          minHeight: 132,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 0.5,
          p: 2,
          cursor: uploading ? 'wait' : 'pointer',
          transition: 'border-color .15s, background-color .15s',
        }}
      >
        {value ? (
          <>
            <Box
              component="img"
              src={value}
              alt="Foto do produto"
              sx={{
                maxHeight: 160,
                maxWidth: '100%',
                borderRadius: 2,
                objectFit: 'contain',
              }}
            />
            <IconButton
              size="small"
              aria-label="Remover imagem"
              onClick={(e) => {
                e.stopPropagation();
                onClear();
              }}
              sx={{
                position: 'absolute',
                top: 6,
                right: 6,
                bgcolor: 'background.paper',
                '&:hover': { bgcolor: 'background.paper' },
              }}
            >
              <CloseRoundedIcon fontSize="small" />
            </IconButton>
          </>
        ) : (
          <>
            <AddPhotoAlternateRoundedIcon color="disabled" />
            <Typography variant="body2" color="text.secondary" align="center">
              {uploading ? 'Enviando imagem…' : label}
            </Typography>
            <Typography variant="caption" color="text.disabled" align="center">
              {hint}
            </Typography>
          </>
        )}
        <input
          ref={inputRef}
          hidden
          type="file"
          accept="image/*"
          onChange={handleInput}
        />
      </Box>
      {error && (
        <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
          {error}
        </Typography>
      )}
    </Box>
  );
}
