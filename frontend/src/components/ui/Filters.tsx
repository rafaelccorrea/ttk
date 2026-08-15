import { Box, InputAdornment, IconButton, MenuItem, TextField } from '@mui/material';
import type { BoxProps, TextFieldProps } from '@mui/material';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import type { ReactNode } from 'react';

/**
 * Campos de filtro do sistema — visual "pill/soft":
 * cantos totalmente arredondados, fundo levemente contrastante,
 * borda sutil e anel de foco na cor da marca.
 */

const pillSx = {
  '& .MuiOutlinedInput-root': {
    borderRadius: 999,
    fontSize: 14,
    fontWeight: 500,
    paddingLeft: 0.5,
  },
} as const;

// ---------------------------------------------------------------- FilterBar

export function FilterBar({ children, sx, ...rest }: BoxProps) {
  return (
    <Box
      display="flex"
      alignItems="center"
      gap={1.25}
      flexWrap="wrap"
      sx={{ mb: 3, ...sx }}
      {...rest}
    >
      {children}
    </Box>
  );
}

// -------------------------------------------------------------- SearchField

type SearchFieldProps = Omit<TextFieldProps, 'onChange' | 'value' | 'select'> & {
  value: string;
  onChange: (value: string) => void;
};

export function SearchField({
  value,
  onChange,
  placeholder = 'Buscar…',
  sx,
  ...rest
}: SearchFieldProps) {
  return (
    <TextField
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      sx={{ minWidth: 240, ...pillSx, ...sx }}
      InputProps={{
        startAdornment: (
          <InputAdornment position="start" sx={{ ml: 0.75, mr: -0.25 }}>
            <SearchRoundedIcon sx={{ fontSize: 19, color: 'text.secondary' }} />
          </InputAdornment>
        ),
        endAdornment: value ? (
          <InputAdornment position="end">
            <IconButton
              size="small"
              aria-label="Limpar busca"
              onClick={() => onChange('')}
              sx={{ mr: 0.25 }}
            >
              <CloseRoundedIcon sx={{ fontSize: 16 }} />
            </IconButton>
          </InputAdornment>
        ) : undefined,
      }}
      {...rest}
    />
  );
}

// -------------------------------------------------------------- SelectField

export type SelectOption = { value: string | number; label: ReactNode };

type SelectFieldProps = Omit<TextFieldProps, 'onChange' | 'value' | 'select'> & {
  value: string | number;
  onChange: (value: string) => void;
  options: SelectOption[];
  startIcon?: ReactNode;
};

export function SelectField({
  value,
  onChange,
  options,
  startIcon,
  sx,
  ...rest
}: SelectFieldProps) {
  return (
    <TextField
      select
      size="small"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      sx={{ minWidth: 190, ...pillSx, ...sx }}
      InputProps={
        startIcon
          ? {
              startAdornment: (
                <InputAdornment position="start" sx={{ ml: 0.75, mr: -0.25 }}>
                  {startIcon}
                </InputAdornment>
              ),
            }
          : undefined
      }
      {...rest}
    >
      {options.map((opt) => (
        <MenuItem key={String(opt.value)} value={opt.value}>
          {opt.label}
        </MenuItem>
      ))}
    </TextField>
  );
}

// ---------------------------------------------------------------- FormField

/** Campo de formulário (não filtro): mesmo visual soft, cantos médios. */
export function FormField({ sx, ...rest }: TextFieldProps) {
  return (
    <TextField
      fullWidth
      size="small"
      sx={{ '& .MuiOutlinedInput-root': { borderRadius: 2.5, fontSize: 14.5 }, ...sx }}
      {...rest}
    />
  );
}
