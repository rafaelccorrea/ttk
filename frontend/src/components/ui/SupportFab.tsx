import WhatsAppIcon from '@mui/icons-material/WhatsApp';
import { Fab, Tooltip, useMediaQuery, useTheme } from '@mui/material';

const WHATSAPP_URL =
  'https://wa.me/5511999999999?text=Preciso%20de%20ajuda%20no%20PikPok';

export function SupportFab() {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  function open() {
    window.open(WHATSAPP_URL, '_blank', 'noopener,noreferrer');
  }

  return (
    <Tooltip title="Falar com o suporte no WhatsApp">
      <Fab
        color="primary"
        variant={isMobile ? 'circular' : 'extended'}
        onClick={open}
        aria-label="Suporte"
        sx={{ position: 'fixed', bottom: 24, right: 24, zIndex: (t) => t.zIndex.tooltip + 1 }}
      >
        <WhatsAppIcon sx={{ mr: isMobile ? 0 : 1 }} />
        {!isMobile && 'Suporte'}
      </Fab>
    </Tooltip>
  );
}
