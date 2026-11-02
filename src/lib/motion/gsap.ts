"use client";

import gsap from "gsap";
import { useGSAP } from "@gsap/react";
import { CustomEase } from "gsap/CustomEase";
import { DrawSVGPlugin } from "gsap/DrawSVGPlugin";
import { MorphSVGPlugin } from "gsap/MorphSVGPlugin";
import { ScrambleTextPlugin } from "gsap/ScrambleTextPlugin";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import { SplitText } from "gsap/SplitText";

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, ScrollTrigger, SplitText, MorphSVGPlugin, DrawSVGPlugin, ScrambleTextPlugin, CustomEase);
  CustomEase.create("hold", "0.16, 1, 0.3, 1");
}

export const REDUCED = "(prefers-reduced-motion: reduce)";
export const MOTION = "(prefers-reduced-motion: no-preference)";
export const DESKTOP = "(min-width: 1024px)";

export { gsap, useGSAP, ScrollTrigger, SplitText };
