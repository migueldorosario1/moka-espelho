import { TopNav } from "@/components/TopNav";
import Link from "next/link";
import { CafezinhoLogo } from "@/components/CafezinhoLogo";
import { LlmPriceRanking } from "@/components/LlmPriceRanking";
import { CostCalculator } from "@/components/CostCalculator";
import { SiteFooter } from "@/components/SiteFooter";

/**
 * 🏆 Mural das IAs — página PRÓPRIA (pedido do Miguel, 24/08: "bota o mural
 * das IAs numa página separada... não vamos misturar a página de telemetria
 * com mural das IAs").
 *
 * Separação de conceitos: /telemetria ("Suas IAs") é o SEU bolso (gastos,
 * tokens, gráficos); o Mural é pra ESCOLHER IA (ranking de preço/qualidade
 * + 🧮 calculadora — que migrou pra cá em 25/08: "gostei da ideia, mas
 * bota em outro lugar"). Acessos: ícone 🏆 na primeira página, hub 📊 no
 * leitor, botão nas Suas IAs e nas configurações.
 */
export default function MuralDasIasPage() {
  return (
    <main className="estante-page">
      <TopNav right={<>
<Link href="/" className="brand" title="Moka — Ir para página central">
            <CafezinhoLogo size={26} opacity={0.85} /> <span>Moka</span>
          </Link>
          <span className="cfg-topbar-label">🏆 Mural das IAs</span>
      </>} />
      <div className="cfg-container" style={{ maxWidth: 860 }}>
        <LlmPriceRanking />
        <div style={{ marginTop: 18 }}>
          <CostCalculator />
        </div>
      </div>
      <SiteFooter />
    </main>
  );
}
