import { useLayoutEffect, useRef, type ReactNode } from 'react';

/** AW23: egysoros felirat: soha nem törik; ha nem fér ki, a betű arányosan kisebb (legfeljebb `minScale`-ig, mint az iOS `minimumScaleFactor`). */
export function FitText({ className, minScale = 0.6, children }: { className?: string; minScale?: number; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      const base = parseFloat(getComputedStyle(el).fontSize);
      const k = el.clientWidth > 0 && el.scrollWidth > el.clientWidth ? Math.max(minScale, el.clientWidth / el.scrollWidth) : 1;
      if (k < 1) el.style.fontSize = `${base * k}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, [children, minScale]);
  return (
    <div ref={ref} className={`fit-text ${className ?? ''}`}>
      {children}
    </div>
  );
}
