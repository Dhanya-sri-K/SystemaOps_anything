import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import { useDashboardStore } from "../store";

export default function TourPopup() {
  const graph = useDashboardStore((s) => s.graph);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const currentTourStep = useDashboardStore((s) => s.currentTourStep);
  const stopTour = useDashboardStore((s) => s.stopTour);
  const nextTourStep = useDashboardStore((s) => s.nextTourStep);
  const prevTourStep = useDashboardStore((s) => s.prevTourStep);
  const selectNode = useDashboardStore((s) => s.selectNode);

  const tourSteps = useMemo(
    () => (graph?.tour ? [...graph.tour].sort((a, b) => a.order - b.order) : []),
    [graph?.tour]
  );

  const totalSteps = tourSteps.length;
  const hasTour = totalSteps > 0;

  // Track step with state to run fade/slide transition animations
  const [activeStep, setActiveStep] = useState(currentTourStep);
  const [animating, setAnimating] = useState(false);

  useEffect(() => {
    if (currentTourStep !== activeStep) {
      setAnimating(true);
      const timer = setTimeout(() => {
        setActiveStep(currentTourStep);
        setAnimating(false);
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [currentTourStep, activeStep]);

  if (!tourActive || !hasTour) return null;

  const step = tourSteps[activeStep];
  if (!step) return null;

  const progressPct = ((activeStep + 1) / totalSteps) * 100;
  const isFirst = activeStep === 0;
  const isLast = activeStep === totalSteps - 1;

  return (
    <div className="fixed inset-0 bg-root/60 backdrop-blur-sm z-50 flex items-center justify-center p-4 sm:p-6 animate-fade-slide-in">
      <div className="w-full max-w-2xl bg-surface border border-border-medium rounded-2xl shadow-[0_0_40px_rgba(0,245,255,0.2)] overflow-hidden flex flex-col transition-all duration-300">
        {/* Sleek Progress Indicator Bar */}
        <div className="h-1.5 w-full bg-elevated shrink-0 relative">
          <div
            className="h-full bg-gradient-to-r from-accent to-accent-secondary transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Popup Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border-subtle bg-surface/40 shrink-0">
          <div className="flex items-center gap-2.5">
            <span className="relative flex h-2.5 w-2.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-accent opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-accent"></span>
            </span>
            <h3 className="font-heading text-xs font-bold text-accent uppercase tracking-widest font-mono">
              Interactive System Tour
            </h3>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-xs font-mono font-bold text-text-muted bg-elevated px-2.5 py-1 rounded border border-border-subtle/30">
              Step {activeStep + 1} / {totalSteps}
            </span>
            <button
              onClick={stopTour}
              className="text-text-muted hover:text-accent p-1 rounded hover:bg-elevated/45 transition-colors"
              title="Exit Tour"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Main Tour Step Explanation Card Body */}
        <div className={`p-6 sm:p-8 overflow-y-auto max-h-[50vh] sm:max-h-[420px] transition-all duration-150 ${animating ? "opacity-0 translate-y-1" : "opacity-100 translate-y-0"}`}>
          <h2 className="text-base sm:text-lg font-heading font-extrabold text-text-primary mb-3.5 font-mono flex items-center gap-2">
            <span className="text-accent font-bold font-mono">#</span>
            {step.title}
          </h2>

          <div className="text-xs sm:text-sm text-text-secondary leading-relaxed sm:leading-loose space-y-3 select-text">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-3 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-bold text-text-primary">{children}</strong>,
                code: ({ className, children }) => {
                  const isBlock = className?.includes("language-");
                  return isBlock ? (
                    <code className="block bg-elevated/80 rounded-xl px-4 py-3 mb-3 overflow-x-auto text-[11px] font-mono leading-relaxed border border-border-subtle/50">
                      {children}
                    </code>
                  ) : (
                    <code className="bg-elevated border border-border-subtle/50 rounded-md px-2 py-0.5 text-[11px] font-mono text-accent">
                      {children}
                    </code>
                  );
                },
                ul: ({ children }) => <ul className="list-disc list-inside mb-3 pl-3 space-y-1.5">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-3 pl-3 space-y-1.5">{children}</ol>,
                a: ({ href, children }) => {
                  if (
                    href &&
                    (href.startsWith("file:") ||
                      href.startsWith("class:") ||
                      href.startsWith("function:") ||
                      href.startsWith("config:") ||
                      href.startsWith("document:"))
                  ) {
                    return (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          selectNode(href);
                        }}
                        className="text-accent hover:underline font-bold inline-block text-left bg-transparent border-none p-0 cursor-pointer"
                      >
                        {children}
                      </button>
                    );
                  }
                  return (
                    <a
                      href={href}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-accent hover:underline font-bold"
                    >
                      {children}
                    </a>
                  );
                }
              }}
            >
              {step.description}
            </ReactMarkdown>
          </div>

          {step.languageLesson && (
            <div className="bg-accent/5 border border-accent/20 rounded-xl p-4 mt-5 relative overflow-hidden">
              <div className="absolute right-3 top-3 text-[10px] font-mono text-accent/40 font-bold uppercase select-none">
                Lesson
              </div>
              <h4 className="text-xs font-bold text-accent uppercase tracking-wider mb-1.5 font-mono">
                Language Tip
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                {step.languageLesson}
              </p>
            </div>
          )}
        </div>

        {/* Footer Navigation Buttons */}
        <div className="flex items-center justify-between px-6 py-4 bg-surface/30 border-t border-border-subtle shrink-0">
          <button
            onClick={prevTourStep}
            disabled={isFirst}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-xs font-bold font-mono border transition-all ${
              isFirst
                ? "border-transparent bg-transparent text-text-muted/20 cursor-not-allowed"
                : "border-border-subtle bg-elevated/40 text-text-secondary hover:border-accent hover:text-accent hover:bg-elevated"
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            <span>Prev</span>
          </button>

          <span className="text-[10px] font-mono text-text-muted hidden sm:inline">
            Use Arrow Keys ← / → to navigate
          </span>

          {isLast ? (
            <button
              onClick={stopTour}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-extrabold font-mono bg-gradient-to-r from-accent to-accent-secondary text-root hover:shadow-[0_0_15px_rgba(168,85,247,0.5)] transition-all cursor-pointer"
            >
              <span>Finish Tour</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          ) : (
            <button
              onClick={nextTourStep}
              className="flex items-center gap-2 px-5 py-2 rounded-lg text-xs font-extrabold font-mono bg-accent/15 border border-accent/30 text-accent hover:bg-accent/25 hover:border-accent transition-all cursor-pointer"
            >
              <span>Next</span>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
