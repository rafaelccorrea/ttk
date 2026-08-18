import { Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { AppLayout } from '@/components/layout/AppLayout';
import { FreeSampleGate } from '@/components/ui/FreeSampleGate';
import { PlanGate } from '@/components/ui/PlanGate';
import { RequireSubscription } from '@/components/ui/RequireSubscription';
import { AcademyPage } from '@/pages/Academy';
import { AdminPage } from '@/pages/Admin';
import { AnalyzePage } from '@/pages/Analyze';
import { AtivarDispositivoPage } from '@/pages/AtivarDispositivo';
import { useAuth } from '@/contexts/AuthContext';
import { CampaignsPage } from '@/pages/Campaigns';
import { ConfirmEmailPage } from '@/pages/ConfirmEmail';
import { CreatorsPage } from '@/pages/Creators';
import { DashboardPage } from '@/pages/Dashboard';
import { FavoritesPage } from '@/pages/Favorites';
import { FreeCriadoresPage } from '@/pages/Free/Criadores';
import { FreeFavoritosPage } from '@/pages/Free/Favoritos';
import { FreeProdutoDetalhePage } from '@/pages/Free/ProdutoDetalhe';
import { FreeProdutosPage } from '@/pages/Free/Produtos';
import { FreeVideosPage } from '@/pages/Free/Videos';
import { ForgotPasswordPage } from '@/pages/ForgotPassword';
import { ResetPasswordPage } from '@/pages/ResetPassword';
import { GenerationsPage } from '@/pages/Generations';
import { IngestionPage } from '@/pages/Ingestion';
import { LandingPage } from '@/pages/Landing';
import { LivePage } from '@/pages/Live';
import { LiveDetailPage } from '@/pages/Live/Detail';
import { LoginPage } from '@/pages/Login';
import { MultiplierPage } from '@/pages/Multiplier';
import { PlansPage } from '@/pages/Plans';
import { ProfilePage } from '@/pages/Profile';
import { ReferralPage } from '@/pages/Referral';
import { ProductDetailPage } from '@/pages/ProductDetail';
import { ProductsPage } from '@/pages/Products';
import { PromptsPage } from '@/pages/Prompts';
import { StudioPage } from '@/pages/Studio';
import { SubscribePage } from '@/pages/Subscribe';
import { TrendsPage } from '@/pages/Trends';
import { VideosPage } from '@/pages/Videos';

function ProtectedRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Routes>
      <Route path="/" element={<LandingPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/confirmar-email" element={<ConfirmEmailPage />} />
      <Route path="/esqueci-a-senha" element={<ForgotPasswordPage />} />
      <Route path="/redefinir-senha" element={<ResetPasswordPage />} />
      <Route element={<ProtectedRoutes />}>
        {/* Fora do AppLayout de propósito: quem não tem assinatura não vê o
            app por trás, só a tela de pagamento. */}
        <Route path="/assinatura" element={<SubscribePage />} />
        {/* Aprovação do app desktop. Exige login (é a sessão da web que diz de
            quem é a conta), mas não passa pelo RequireSubscription: a tela é
            uma decisão de segurança e tem que abrir mesmo com a assinatura
            vencida — inclusive para recusar um pedido que não foi seu. */}
        <Route path="/ativar" element={<AtivarDispositivoPage />} />
        <Route element={<AppLayout />}>
          {/* As três telas de descoberta ficam FORA do RequireSubscription:
              são as únicas que a conta gratuita abre, em modo amostra (ver
              docs/CONTA-FREE.md). O FreeSampleGate escolhe qual versão
              renderizar e manda para /assinatura quem não se encaixa em
              nenhuma das duas. Todo o resto do app continua com o paywall na
              entrada, logo abaixo. */}
          <Route
            path="/produtos"
            element={
              <FreeSampleGate
                pago={<ProductsPage />}
                amostra={<FreeProdutosPage />}
              />
            }
          />
          <Route
            path="/produtos/:id"
            element={
              <FreeSampleGate
                pago={<ProductDetailPage />}
                amostra={<FreeProdutoDetalhePage />}
              />
            }
          />
          <Route
            path="/videos"
            element={
              <FreeSampleGate pago={<VideosPage />} amostra={<FreeVideosPage />} />
            }
          />
          {/* Planos e Perfil também ficam fora do paywall, e por motivos
              diferentes. Planos é a TELA DE COMPRA: com ela bloqueada, todo CTA
              da amostra levava à tela de bloqueio — que por sua vez oferece
              "Ver planos". O caminho de conversão inteiro se fechava num
              círculo. Perfil é a própria conta (nome, e-mail, senha), não é
              dado de mercado: trancar alguém fora dos próprios dados por não
              ter assinatura não protege nada. */}
          <Route path="/planos" element={<PlansPage />} />
          <Route path="/perfil" element={<ProfilePage />} />
          {/* As ferramentas de IA do Essencial também abrem no gratuito, e o
              teto delas não é o plano — é o SALDO. Quem não assina começa com a
              cortesia de cadastro (SIGNUP_BONUS_CREDITS) e gasta até acabar; o
              backend cobra crédito a cada chamada e responde 402 quando não há
              saldo, que é uma resposta muito melhor do que "faça upgrade" para
              quem só quer experimentar. Ver FEATURE_MIN_PLAN e
              docs/CONTA-FREE.md. */}
          <Route path="/estudio" element={<StudioPage />} />
          <Route path="/analisar" element={<AnalyzePage />} />
          <Route path="/geracoes" element={<GenerationsPage />} />
          <Route path="/prompts" element={<PromptsPage />} />
          {/* Estar logado não basta: conta sem assinatura não entra no resto. */}
          <Route element={<RequireSubscription />}>
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/tendencias" element={<TrendsPage />} />
            {/* Campanhas e Multiplicador são Pro no backend; sem o gate aqui,
                quem assina o Essencial abria a tela e só descobria no 403. */}
            <Route
              path="/campanhas"
              element={
                <PlanGate feature="campaigns">
                  <CampaignsPage />
                </PlanGate>
              }
            />
            <Route
              path="/multiplicador"
              element={
                <PlanGate feature="multiplier">
                  <MultiplierPage />
                </PlanGate>
              }
            />
            {/* Live Copilot é gate de plano no backend (`live_copilot`); sem o
                PlanGate aqui a tela abriria e só o 403 explicaria o porquê. */}
            <Route
              path="/copiloto"
              element={
                <PlanGate feature="live_copilot">
                  <LivePage />
                </PlanGate>
              }
            />
            <Route
              path="/copiloto/:id"
              element={
                <PlanGate feature="live_copilot">
                  <LiveDetailPage />
                </PlanGate>
              }
            />
            <Route path="/academy" element={<AcademyPage />} />
            <Route path="/indique" element={<ReferralPage />} />
            <Route
              path="/coleta"
              element={
                <PlanGate feature="ingestion">
                  <IngestionPage />
                </PlanGate>
              }
            />
            {/* A rota existe para qualquer logado; quem barra é o AdminGuard
                do backend, que responde 403 em todas as chamadas /admin. */}
            <Route path="/admin" element={<AdminPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
