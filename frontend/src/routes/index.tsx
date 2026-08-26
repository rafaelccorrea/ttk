import { lazy, Suspense } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router-dom";
import { GlobalLoader } from "@/components/ui/GlobalLoader";
import { AppLayout } from "@/components/layout/AppLayout";
import { FreeSampleGate } from "@/components/ui/FreeSampleGate";
import { PlanGate } from "@/components/ui/PlanGate";
import { RequireSubscription } from "@/components/ui/RequireSubscription";
import { AtivarDispositivoPage } from "@/pages/AtivarDispositivo";
import { useAuth } from "@/contexts/AuthContext";
import { ConfirmEmailPage } from "@/pages/ConfirmEmail";
import { ForgotPasswordPage } from "@/pages/ForgotPassword";
import { ResetPasswordPage } from "@/pages/ResetPassword";
import { LandingPage } from "@/pages/Landing";
import { LoginPage } from "@/pages/Login";

/*
 * Páginas pesadas entram por `lazy`: cada rota baixa só o seu chunk, e o
 * bundle inicial deixa de carregar as 30 telas para pintar uma.
 */
const AdminPage = lazy(() =>
  import("@/pages/Admin").then((m) => ({ default: m.AdminPage })),
);
const AnalyzePage = lazy(() =>
  import("@/pages/Analyze").then((m) => ({ default: m.AnalyzePage })),
);
const CampaignsPage = lazy(() =>
  import("@/pages/Campaigns").then((m) => ({ default: m.CampaignsPage })),
);
const CreatorsPage = lazy(() =>
  import("@/pages/Creators").then((m) => ({ default: m.CreatorsPage })),
);
const DashboardPage = lazy(() =>
  import("@/pages/Dashboard").then((m) => ({ default: m.DashboardPage })),
);
const FavoritesPage = lazy(() =>
  import("@/pages/Favorites").then((m) => ({ default: m.FavoritesPage })),
);
const GenerationsPage = lazy(() =>
  import("@/pages/Generations").then((m) => ({ default: m.GenerationsPage })),
);
const IngestionPage = lazy(() =>
  import("@/pages/Ingestion").then((m) => ({ default: m.IngestionPage })),
);
const LivePage = lazy(() =>
  import("@/pages/Live").then((m) => ({ default: m.LivePage })),
);
const LiveDetailPage = lazy(() =>
  import("@/pages/Live/Detail").then((m) => ({ default: m.LiveDetailPage })),
);
const LiveRunPage = lazy(() =>
  import("@/pages/Live/RunDetail").then((m) => ({ default: m.LiveRunPage })),
);
const MultiplierPage = lazy(() =>
  import("@/pages/Multiplier").then((m) => ({ default: m.MultiplierPage })),
);
const CutsPage = lazy(() =>
  import("@/pages/Cuts").then((m) => ({ default: m.CutsPage })),
);
const PlansPage = lazy(() =>
  import("@/pages/Plans").then((m) => ({ default: m.PlansPage })),
);
const ProfilePage = lazy(() =>
  import("@/pages/Profile").then((m) => ({ default: m.ProfilePage })),
);
const ReferralPage = lazy(() =>
  import("@/pages/Referral").then((m) => ({ default: m.ReferralPage })),
);
const ProductDetailPage = lazy(() =>
  import("@/pages/ProductDetail").then((m) => ({
    default: m.ProductDetailPage,
  })),
);
const ProductsPage = lazy(() =>
  import("@/pages/Products").then((m) => ({ default: m.ProductsPage })),
);
const PromptsPage = lazy(() =>
  import("@/pages/Prompts").then((m) => ({ default: m.PromptsPage })),
);
const StudioPage = lazy(() =>
  import("@/pages/Studio").then((m) => ({ default: m.StudioPage })),
);
const SubscribePage = lazy(() =>
  import("@/pages/Subscribe").then((m) => ({ default: m.SubscribePage })),
);
const TrendsPage = lazy(() =>
  import("@/pages/Trends").then((m) => ({ default: m.TrendsPage })),
);
const VideosPage = lazy(() =>
  import("@/pages/Videos").then((m) => ({ default: m.VideosPage })),
);
const AcademyPage = lazy(() =>
  import("@/pages/Academy").then((m) => ({ default: m.AcademyPage })),
);
const FreeCriadoresPage = lazy(() =>
  import("@/pages/Free/Criadores").then((m) => ({
    default: m.FreeCriadoresPage,
  })),
);
const FreeFavoritosPage = lazy(() =>
  import("@/pages/Free/Favoritos").then((m) => ({
    default: m.FreeFavoritosPage,
  })),
);
const FreeProdutoDetalhePage = lazy(() =>
  import("@/pages/Free/ProdutoDetalhe").then((m) => ({
    default: m.FreeProdutoDetalhePage,
  })),
);
const FreeProdutosPage = lazy(() =>
  import("@/pages/Free/Produtos").then((m) => ({
    default: m.FreeProdutosPage,
  })),
);
const FreeVideosPage = lazy(() =>
  import("@/pages/Free/Videos").then((m) => ({ default: m.FreeVideosPage })),
);

function ProtectedRoutes() {
  const { isAuthenticated, isLoading } = useAuth();
  if (isLoading) return null;
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return <Outlet />;
}

export function AppRoutes() {
  return (
    <Suspense fallback={<GlobalLoader variante="leve" />}>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/login" element={<LoginPage />} />
        {import.meta.env.DEV && (
          <Route path="/dev/multiplicador" element={<MultiplierPage />} />
        )}
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
                <FreeSampleGate
                  pago={<VideosPage />}
                  amostra={<FreeVideosPage />}
                />
              }
            />
            {/* Favoritos e Criadores também têm modo amostra: favoritar é barato e
              cria hábito, e a amostra de criadores é a CAUDA do ranking (ver
              docs/CONTA-FREE.md) — prova que a base existe sem entregar quem
              fatura mais, que é o que a tela paga vende. */}
            <Route
              path="/favoritos"
              element={
                <FreeSampleGate
                  pago={<FavoritesPage />}
                  amostra={<FreeFavoritosPage />}
                />
              }
            />
            <Route
              path="/criadores"
              element={
                <FreeSampleGate
                  pago={<CreatorsPage />}
                  amostra={<FreeCriadoresPage />}
                />
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
            {/* A Fábrica abre no gratuito em MODO AMOSTRA (campaigns_sample):
              produto + roteiro + uma cena de produto pelo vídeo de cortesia.
              O que produz a campanha inteira é decidido dentro da tela, cena a
              cena, pelo `amostra` do detalhe — e o backend é a autoridade. */}
            <Route
              path="/campanhas/:id?"
              element={
                <PlanGate feature="campaigns_sample">
                  <CampaignsPage />
                </PlanGate>
              }
            />
            {/* Estar logado não basta: conta sem assinatura não entra no resto. */}
            <Route element={<RequireSubscription />}>
              <Route path="/dashboard" element={<DashboardPage />} />
              <Route path="/tendencias" element={<TrendsPage />} />
              {/* Multiplicador é Pro no backend; sem o gate aqui, quem assina o
                Essencial abria a tela e só descobria no 403. */}
              <Route
                path="/multiplicador"
                element={
                  <PlanGate feature="multiplier">
                    <MultiplierPage />
                  </PlanGate>
                }
              />
              {/* Cortes é Pro no backend (`cuts`), mesma régua do Multiplicador. */}
              <Route
                path="/cortes"
                element={
                  <PlanGate feature="cuts">
                    <CutsPage />
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
              {/* Vem antes de `/copiloto/:id` só por leitura — o roteador ranqueia
                o segmento estático `lives` acima do dinâmico de qualquer forma. */}
              <Route
                path="/copiloto/lives/:id"
                element={
                  <PlanGate feature="live_copilot">
                    <LiveRunPage />
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
    </Suspense>
  );
}
