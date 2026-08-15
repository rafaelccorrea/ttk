import { api } from './api';

export interface IngestionRun {
  id: string;
  trigger: 'cron' | 'manual';
  status: 'running' | 'success' | 'error';
  startedAt: string;
  finishedAt: string | null;
  hashtagsFetched: number;
  creatorsFetched: number;
  videosUpserted: number;
  error: string | null;
}

export interface IngestionStatus {
  cronExpr: string;
  enabled: boolean;
  nextRunAt: string | null;
  isRunning: boolean;
  lastRun: IngestionRun | null;
}

export const ingestionService = {
  async status(): Promise<IngestionStatus> {
    const { data } = await api.get<IngestionStatus>('/ingestion/status');
    return data;
  },
  async runs(limit = 20): Promise<IngestionRun[]> {
    const { data } = await api.get<IngestionRun[]>('/ingestion/runs', { params: { limit } });
    return data;
  },
  async run(): Promise<IngestionRun> {
    const { data } = await api.post<IngestionRun>('/ingestion/run');
    return data;
  },
  async updateSchedule(input: { cronExpr?: string; enabled?: boolean }): Promise<IngestionStatus> {
    const { data } = await api.patch<IngestionStatus>('/ingestion/schedule', input);
    return data;
  },
};
