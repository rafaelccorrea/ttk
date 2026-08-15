import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import { Button, CircularProgress, Snackbar } from '@mui/material';
import { useState } from 'react';

interface ExportButtonProps {
  label?: string;
  onExport: () => Promise<void>;
}

/** Botão de baixar relatório: segura o clique enquanto o arquivo é gerado. */
export function ExportButton({
  label = 'Exportar CSV',
  onExport,
}: ExportButtonProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleClick() {
    setBusy(true);
    try {
      await onExport();
    } catch {
      setError('Não foi possível gerar o arquivo. Tente novamente.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Button
        size="small"
        variant="outlined"
        disabled={busy}
        onClick={handleClick}
        startIcon={
          busy ? (
            <CircularProgress size={14} color="inherit" />
          ) : (
            <DownloadRoundedIcon />
          )
        }
      >
        {busy ? 'Gerando...' : label}
      </Button>
      <Snackbar
        open={error !== null}
        autoHideDuration={5000}
        onClose={() => setError(null)}
        message={error ?? ''}
      />
    </>
  );
}
