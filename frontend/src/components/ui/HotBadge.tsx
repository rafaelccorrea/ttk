import LocalFireDepartmentRoundedIcon from '@mui/icons-material/LocalFireDepartmentRounded';
import { Chip, Tooltip } from '@mui/material';

/**
 * Selo de "está pegando fogo" — usado nos cards de produto e de vídeo para
 * destacar, dentro da lista, o que está bombando de verdade.
 */
export function HotBadge({ title = 'Em alta' }: { title?: string }) {
  return (
    <Tooltip title={title}>
      <Chip
        size="small"
        icon={
          <LocalFireDepartmentRoundedIcon
            sx={{ fontSize: 15, color: '#fff !important' }}
          />
        }
        label="Em alta"
        sx={{
          height: 22,
          fontSize: 11,
          fontWeight: 800,
          color: '#fff',
          background: 'linear-gradient(135deg, #f59e0b 0%, #ef4444 100%)',
          boxShadow: '0 0 10px rgba(239,68,68,0.55)',
          '& .MuiChip-label': { pl: 0.5, pr: 0.9 },
          '& .MuiChip-icon': { ml: 0.7, mr: 0 },
        }}
      />
    </Tooltip>
  );
}
