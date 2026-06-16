import { useMemo, useState, useEffect } from "react";
import ReactMarkdown from "react-markdown";
import { useDashboardStore } from "../store";
import { useI18n } from "../contexts/I18nContext";
import { fetchGithubRepo } from "../utils/githubFetcher";
import { parseFiles } from "../utils/browserScanner";
import {
  generateProjectTour,
  getActiveCodebaseFiles
} from "../utils/geminiService";

export default function LearnPanel() {
  const graph = useDashboardStore((s) => s.graph);
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setUploadedFiles = useDashboardStore((s) => s.setUploadedFiles);
  const clearChatHistory = useDashboardStore((s) => s.clearChatHistory);
  
  const tourActive = useDashboardStore((s) => s.tourActive);
  const currentTourStep = useDashboardStore((s) => s.currentTourStep);
  const startTour = useDashboardStore((s) => s.startTour);
  const stopTour = useDashboardStore((s) => s.stopTour);
  const setTourStep = useDashboardStore((s) => s.setTourStep);
  const nextTourStep = useDashboardStore((s) => s.nextTourStep);
  const prevTourStep = useDashboardStore((s) => s.prevTourStep);
  const selectNode = useDashboardStore((s) => s.selectNode);
  
  // Gemini store states
  const isTourLoading = useDashboardStore((s) => s.isTourLoading);
  const setTourLoading = useDashboardStore((s) => s.setTourLoading);
  const tourError = useDashboardStore((s) => s.tourError);
  const setTourError = useDashboardStore((s) => s.setTourError);
  const analyzingRepoLabel = useDashboardStore((s) => s.analyzingRepoLabel);
  const setAnalyzingRepoLabel = useDashboardStore((s) => s.setAnalyzingRepoLabel);
  const resetToLocalCodebase = useDashboardStore((s) => s.resetToLocalCodebase);

  const { t } = useI18n();

  // Local component states
  const [githubUrl, setGithubUrl] = useState("");
  const [tourLoadingMessage, setTourLoadingMessage] = useState("");
  const [lastAnalyzedProject, setLastAnalyzedProject] = useState<string | null>(null);

  const tourSteps = useMemo(
    () => graph?.tour ? [...graph.tour].sort((a, b) => a.order - b.order) : [],
    [graph?.tour]
  );
  const hasTour = tourSteps.length > 0;

  // Auto-generate project tour on load or name change
  useEffect(() => {
    if (graph && graph.project.name !== lastAnalyzedProject && !isTourLoading) {
      setLastAnalyzedProject(graph.project.name);
      handleGenerateTour();
    }
  }, [graph?.project.name, lastAnalyzedProject]);

  const handleGenerateTour = async () => {
    if (!graph) return;
    setTourError(null);

    // Check localStorage cache first to avoid rate-limiting/quota exhaustion
    const cacheKey = `gemini-tour-cache-${graph.project.name}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setGraph({
            ...graph,
            tour: parsed
          });
          return;
        }
      }
    } catch (e) {
      console.warn("Failed to read tour from cache:", e);
    }

    setTourLoading(true);
    setTourLoadingMessage("Collecting codebase files for context...");
    
    try {
      const files = getActiveCodebaseFiles();
      if (files.length === 0) {
        throw new Error("No source files found in the active project to analyze.");
      }
      
      setTourLoadingMessage("Analyzing codebase with Google Gemini...");
      const geminiTourSteps = await generateProjectTour(files);
      
      // Save tour to cache
      try {
        localStorage.setItem(cacheKey, JSON.stringify(geminiTourSteps));
      } catch (e) {
        console.warn("Failed to save tour to cache:", e);
      }

      setGraph({
        ...graph,
        tour: geminiTourSteps
      });
    } catch (err) {
      console.error("Gemini Tour Error:", err);
      setTourError(err instanceof Error ? err.message : "Failed to analyze codebase.");
    } finally {
      setTourLoading(false);
    }
  };

  const handleGithubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = githubUrl.trim();
    if (!url) return;

    setTourError(null);
    setTourLoading(true);
    setTourLoadingMessage("Connecting to GitHub...");

    try {
      const { files, repoName } = await fetchGithubRepo(url, (progress) => {
        if (progress.status === "fetching-tree") {
          setTourLoadingMessage("Fetching repository file list...");
        } else if (progress.status === "downloading-files") {
          setTourLoadingMessage(`Downloading: ${progress.currentFileName || ""}`);
        } else if (progress.status === "analyzing") {
          setTourLoadingMessage("Parsing codebase dependency graph...");
        }
      });

      setTourLoadingMessage("Building interactive graphs...");
      const { graph: newGraph, domainGraph: newDomainGraph, uploadedFiles: newUploadedFiles } = await parseFiles(files, repoName);

      setUploadedFiles(newUploadedFiles);
      setDomainGraph(newDomainGraph);
      setAnalyzingRepoLabel(repoName);
      setLastAnalyzedProject(repoName);

      // Check cache for this GitHub repo
      const cacheKey = `gemini-tour-cache-${repoName}`;
      let geminiTourSteps;
      try {
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          geminiTourSteps = JSON.parse(cached);
        }
      } catch (e) {
        console.warn("Failed to read cached GitHub tour:", e);
      }

      // Generate if not cached
      if (!geminiTourSteps) {
        setTourLoadingMessage("Analyzing codebase structures via Gemini API...");
        geminiTourSteps = await generateProjectTour(files);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(geminiTourSteps));
        } catch (e) {
          console.warn("Failed to cache GitHub tour:", e);
        }
      }

      newGraph.tour = geminiTourSteps;
      
      clearChatHistory();
      setGraph(newGraph);
      setGithubUrl("");
    } catch (err) {
      console.error("GitHub Analyzer Error:", err);
      setTourError(err instanceof Error ? err.message : "Failed to import GitHub repository.");
    } finally {
      setTourLoading(false);
    }
  };

  // State: Loading spinner
  const renderLoading = () => (
    <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
      <div className="w-8 h-8 rounded-full border-2 border-accent/10 border-t-accent animate-spin mb-4" />
      <p className="text-xs text-text-muted font-mono animate-pulse max-w-[200px] break-words">
        {tourLoadingMessage || "Gemini is analyzing..."}
      </p>
    </div>
  );

  // State: Error view
  const renderError = () => (
    <div className="p-4 flex-1 overflow-auto">
      <div className="p-4 bg-red-950/20 border border-red-900/30 rounded-xl text-red-400 text-xs leading-relaxed mb-4">
        <span className="font-semibold block text-red-300 mb-1">Analysis Error</span>
        <p className="mb-3">{tourError}</p>
        <button
          onClick={handleGenerateTour}
          className="px-3 py-1.5 bg-red-900/20 hover:bg-red-900/30 border border-red-800/40 text-red-300 rounded-md transition-colors font-semibold cursor-pointer"
        >
          Retry Gemini Analysis
        </button>
      </div>
    </div>
  );

  // State: Content when not loading and no error
  const renderContent = () => {
    if (!hasTour) {
      return (
        <div className="flex-1 flex items-center justify-center p-5">
          <div className="text-center px-4">
            <div className="text-2xl mb-2 text-text-muted">🧭</div>
            <p className="text-text-muted text-sm">{t.learnPanel.noTour}</p>
            <p className="text-text-muted text-xs mt-1">
              {t.learnPanel.noTourHint}
            </p>
          </div>
        </div>
      );
    }

    if (!tourActive) {
      return (
        <div className="p-5 flex-1 overflow-y-auto">
          <div className="mb-4">
            <h2 className="text-base font-heading text-text-primary mb-1">Project Tour</h2>
            <p className="text-[11px] text-text-muted">
              {tourSteps.length} Steps &middot; AI-Generated Walkthrough
            </p>
          </div>

          <button
            onClick={startTour}
            className="w-full mb-5 bg-accent/10 border border-accent/30 text-accent text-xs font-semibold py-2 px-4 rounded-lg hover:bg-accent/20 transition-colors cursor-pointer"
          >
            Start Tour
          </button>

          <div className="space-y-2">
            <h3 className="text-[10px] font-bold text-accent uppercase tracking-wider mb-2">
              Tour Stops
            </h3>
            {tourSteps.map((step, i) => (
              <div
                key={step.order}
                onClick={() => setTourStep(i)}
                className="flex items-start gap-2 text-xs bg-elevated rounded-lg px-3 py-2.5 border border-border-subtle hover:border-accent/30 transition-all cursor-pointer"
              >
                <span className="text-accent font-mono shrink-0 mt-0.5">
                  {i + 1}.
                </span>
                <span className="text-text-secondary hover:text-text-primary font-medium transition-colors font-semibold">
                  {step.title}
                </span>
              </div>
            ))}
          </div>
        </div>
      );
    }

    const step = tourSteps[currentTourStep];
    if (!step) return null;

    const totalSteps = tourSteps.length;
    const progressPct = ((currentTourStep + 1) / totalSteps) * 100;
    const isFirst = currentTourStep === 0;
    const isLast = currentTourStep === totalSteps - 1;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header with progress counter and exit */}
        <div className="flex items-center justify-between px-4 py-2 border-b border-border-subtle bg-surface shrink-0">
          <div className="flex items-center gap-2">
            <h3 className="text-[10px] font-bold text-accent uppercase tracking-wider">
              Tour Step
            </h3>
            <span className="text-xs text-text-muted">
              {currentTourStep + 1} / {totalSteps}
            </span>
          </div>
          <button
            onClick={stopTour}
            className="text-[10px] text-text-muted hover:text-text-secondary transition-colors cursor-pointer"
          >
            Exit Tour
          </button>
        </div>

        {/* Progress bar */}
        <div className="h-1 bg-elevated shrink-0">
          <div
            className="h-full bg-accent transition-all duration-300"
            style={{ width: `${progressPct}%` }}
          />
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4 min-h-0">
          <h2 className="text-base font-heading text-text-primary mb-3">{step.title}</h2>

          <div className="text-xs text-text-secondary leading-relaxed mb-4 tour-markdown space-y-2">
            <ReactMarkdown
              components={{
                p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                strong: ({ children }) => <strong className="font-semibold text-text-primary">{children}</strong>,
                code: ({ className, children }) => {
                  const isBlock = className?.includes("language-");
                  return isBlock ? (
                    <code className="block bg-elevated rounded px-2.5 py-2 mb-2 overflow-x-auto text-[10px] font-mono leading-relaxed border border-border-subtle">
                      {children}
                    </code>
                  ) : (
                    <code className="bg-elevated border border-border-subtle rounded px-1.5 py-0.5 text-[10px] font-mono">
                      {children}
                    </code>
                  );
                },
                ul: ({ children }) => <ul className="list-disc list-inside mb-2 pl-2 space-y-1">{children}</ul>,
                ol: ({ children }) => <ol className="list-decimal list-inside mb-2 pl-2 space-y-1">{children}</ol>,
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
                        className="text-accent hover:underline font-semibold inline-block text-left bg-transparent border-none p-0 cursor-pointer"
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
                      className="text-accent hover:underline font-semibold"
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
            <div className="bg-accent/5 border border-accent/20 rounded-lg p-3 mb-4">
              <h4 className="text-[10px] font-bold text-accent uppercase tracking-wider mb-1">
                Language Lesson
              </h4>
              <p className="text-xs text-text-secondary leading-relaxed">
                {step.languageLesson}
              </p>
            </div>
          )}

          {step.nodeIds && step.nodeIds.length > 0 && (
            <div className="mb-4">
              <h4 className="text-[10px] font-bold text-accent uppercase tracking-wider mb-2">
                Referenced Components
              </h4>
              <div className="flex flex-wrap gap-1.5">
                {step.nodeIds.map((nodeId) => {
                  const node = graph?.nodes.find((n) => n.id === nodeId);
                  return (
                    <button
                      key={nodeId}
                      onClick={() => selectNode(nodeId)}
                      className="text-[10px] bg-elevated border border-border-subtle hover:border-accent/40 text-text-secondary px-2.5 py-1 rounded-full hover:text-text-primary transition-all cursor-pointer"
                    >
                      {node?.name ?? nodeId.split("/").pop() ?? nodeId}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Navigation: dots + prev/next */}
        <div className="px-4 py-3 border-t border-border-subtle bg-surface shrink-0">
          <div className="flex justify-center gap-1.5 mb-3">
            {tourSteps.map((_, i) => (
              <button
                key={i}
                onClick={() => setTourStep(i)}
                className={`w-1.5 h-1.5 rounded-full transition-colors cursor-pointer ${
                  i === currentTourStep
                    ? "bg-accent"
                    : "bg-border-medium hover:bg-text-muted"
                }`}
                aria-label={`Go to step ${i + 1}`}
              />
            ))}
          </div>

          <div className="flex gap-2">
            <button
              onClick={prevTourStep}
              disabled={isFirst}
              className="flex-1 text-xs bg-elevated border border-border-subtle text-text-secondary py-1.5 rounded-lg hover:bg-surface disabled:opacity-40 disabled:cursor-not-allowed transition-colors cursor-pointer"
            >
              Back
            </button>
            <button
              onClick={isLast ? stopTour : nextTourStep}
              className="flex-1 text-xs bg-accent/10 border border-accent/30 text-accent py-1.5 rounded-lg hover:bg-accent/20 transition-colors cursor-pointer"
            >
              {isLast ? "Finish" : "Next"}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="h-full w-full flex flex-col overflow-hidden bg-surface">
      {/* Top panel: GitHub Analyzer Input */}
      <div className="p-4 border-b border-border-subtle bg-surface shrink-0">
        <form onSubmit={handleGithubSubmit} className="space-y-2 mb-3">
          <div className="relative">
            <input
              type="url"
              value={githubUrl}
              onChange={(e) => setGithubUrl(e.target.value)}
              placeholder="Paste a GitHub repo URL to analyze any project..."
              className="w-full px-3 py-2 bg-elevated border border-border-subtle rounded-lg text-xs text-text-primary placeholder:text-text-muted/40 focus:outline-none focus:border-accent transition-colors"
            />
            {githubUrl && (
              <button
                type="button"
                onClick={() => setGithubUrl("")}
                className="absolute right-2.5 top-2 text-text-muted hover:text-text-primary text-xs"
              >
                ✕
              </button>
            )}
          </div>
          <button
            type="submit"
            disabled={!githubUrl.trim() || isTourLoading}
            className="w-full bg-accent/15 border border-accent/30 text-accent text-xs font-semibold py-1.5 rounded-lg hover:bg-accent/25 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {isTourLoading && githubUrl ? "Analyzing..." : "Analyze GitHub Project"}
          </button>
        </form>

        {/* Status label */}
        <div className="flex items-center justify-between bg-elevated border border-border-subtle rounded-lg p-2">
          <div className="flex flex-col min-w-0">
            <span className="text-[9px] text-text-muted uppercase tracking-wider font-mono">Status</span>
            <span className="text-xs text-accent font-semibold truncate max-w-[130px] sm:max-w-[160px] md:max-w-[180px]">
              Currently analyzing: {analyzingRepoLabel}
            </span>
          </div>
          {analyzingRepoLabel !== "Local Project" && (
            <button
              onClick={resetToLocalCodebase}
              className="text-[9px] bg-accent/10 border border-accent/30 text-accent font-bold px-2 py-1 rounded transition-colors hover:bg-accent/25 cursor-pointer shrink-0"
            >
              Switch Back
            </button>
          )}
        </div>
      </div>

      {/* Main interactive area */}
      {isTourLoading ? renderLoading() : tourError ? renderError() : renderContent()}
    </div>
  );
}

