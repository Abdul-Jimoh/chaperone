import { Audience } from "@/components/site/Audience";
import { Developers } from "@/components/site/Developers";
import { FlowSection } from "@/components/site/FlowSection";
import { Footer } from "@/components/site/Footer";
import { Hero } from "@/components/site/Hero";
import { InjectionSection } from "@/components/site/InjectionSection";
import { MandateSection } from "@/components/site/MandateSection";
import { ProblemSection } from "@/components/site/ProblemSection";
import { Nav } from "@/components/site/Nav";
import { SmoothScroll } from "@/components/site/SmoothScroll";
import { Stats } from "@/components/site/Stats";

export default function Home() {
  return (
    <SmoothScroll>
      <Nav />
      <main>
        <Hero />
        <ProblemSection />
        <MandateSection />
        <FlowSection />
        <InjectionSection />
        <Stats />
        <Developers />
        <Audience />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
