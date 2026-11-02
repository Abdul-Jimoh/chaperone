import { Audience } from "@/components/site/Audience";
import { Cursor } from "@/components/site/Cursor";
import { Developers } from "@/components/site/Developers";
import { FlowSection } from "@/components/site/FlowSection";
import { Footer } from "@/components/site/Footer";
import { Hero } from "@/components/site/Hero";
import { InjectionSection } from "@/components/site/InjectionSection";
import { MandateSection } from "@/components/site/MandateSection";
import { Marquee } from "@/components/site/Marquee";
import { Nav } from "@/components/site/Nav";
import { SmoothScroll } from "@/components/site/SmoothScroll";
import { Stats } from "@/components/site/Stats";

export default function Home() {
  return (
    <SmoothScroll>
      <Nav />
      <main>
        <Hero />
        <Marquee
          items={["Your rules", "PayPal holds", "Code decides", "You approve", "Revoke anytime"]}
          className="border-y border-line-strong bg-ink py-5 text-[clamp(2.2rem,5.5vw,5rem)] font-medium leading-none tracking-[-0.045em] text-paper"
        />
        <MandateSection />
        <FlowSection />
        <InjectionSection />
        <Stats />
        <Developers />
        <Audience />
      </main>
      <Footer />
      <Cursor />
    </SmoothScroll>
  );
}
