import { Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import { Trend, trendsService } from '@/services/trends.service';

export function TrendsPage() {
  const [trends, setTrends] = useState<Trend[]>([]);

  useEffect(() => {
    trendsService.list().then(setTrends).catch(console.error);
  }, []);

  return (
    <>
      <Typography variant="h5" gutterBottom>
        Tendências
      </Typography>
      {trends.length === 0 && (
        <Typography color="text.secondary">
          Nenhuma tendência cadastrada ainda.
        </Typography>
      )}
      {trends.map((trend) => (
        <Typography key={trend.id}>{trend.title}</Typography>
      ))}
    </>
  );
}
