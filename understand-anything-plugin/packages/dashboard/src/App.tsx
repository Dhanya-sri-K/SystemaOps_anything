import { useEffect, useState, useMemo, useCallback, lazy, Suspense } from "react";
import { validateGraph } from "@understand-anything/core/schema";
import type { GraphIssue } from "@understand-anything/core/schema";
import { useDashboardStore } from "./store";
import GraphView from "./components/GraphView";
import DomainGraphView from "./components/DomainGraphView";
import KnowledgeGraphView from "./components/KnowledgeGraphView";
import SearchBar from "./components/SearchBar";
import NodeInfo from "./components/NodeInfo";
import LayerLegend from "./components/LayerLegend";
import DiffToggle from "./components/DiffToggle";
import FilterPanel from "./components/FilterPanel";
import ExportMenu from "./components/ExportMenu";
import PersonaSelector from "./components/PersonaSelector";
import ProjectOverview from "./components/ProjectOverview";
import FileExplorer from "./components/FileExplorer";
import WarningBanner from "./components/WarningBanner";
import UploadScreen from "./components/UploadScreen";
import MobileLayout from "./components/MobileLayout";
import { useIsMobile } from "./hooks/useIsMobile";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import type { KeyboardShortcut } from "./hooks/useKeyboardShortcuts";
import { ThemeProvider } from "./themes/index.ts";
import { ThemePicker } from "./components/ThemePicker.tsx";
import type { ThemeConfig } from "./themes/index.ts";
import { I18nProvider, useI18n } from "./contexts/I18nContext.tsx";
import ProjectChatbot from "./components/ProjectChatbot";
import TourPopup from "./components/TourPopup";


// Lazy-load heavy / optional components so they ship in separate chunks.
const CodeViewer = lazy(() => import("./components/CodeViewer"));
const LearnPanel = lazy(() => import("./components/LearnPanel"));
const PathFinderModal = lazy(() => import("./components/PathFinderModal"));
const KeyboardShortcutsHelp = lazy(
  () => import("./components/KeyboardShortcutsHelp"),
);
const OnboardingOverlay = lazy(() => import("./components/OnboardingOverlay"));

const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === "true";
const SESSION_TOKEN_KEY = "systemaops-token";
const ONBOARDING_DISMISSED_KEY = "so-onboarding-dismissed-v1";
type SidebarTab = "files" | "chat" | "filters";

function shouldShowOnboarding(): boolean {
  if (typeof window === "undefined") return false;
  const params = new URLSearchParams(window.location.search);
  if (params.get("onboard") === "force") return true;
  return window.localStorage.getItem(ONBOARDING_DISMISSED_KEY) !== "1";
}

/** Resolve data file URL — in demo mode, use env var URLs; otherwise use local paths with token. */
function dataUrl(fileName: string, token: string | null): string {
  if (DEMO_MODE) {
    const envMap: Record<string, string | undefined> = {
      "knowledge-graph.json": import.meta.env.VITE_GRAPH_URL,
      "domain-graph.json": import.meta.env.VITE_DOMAIN_GRAPH_URL,
      "meta.json": import.meta.env.VITE_META_URL,
      "diff-overlay.json": import.meta.env.VITE_DIFF_OVERLAY_URL,
      "config.json": import.meta.env.VITE_CONFIG_URL,
    };
    const url = envMap[fileName];
    if (url) return url;
    const base = import.meta.env.BASE_URL || "/";
    return `${base.endsWith("/") ? base : `${base}/`}${fileName}`;
  }
  const path = `/${fileName}`;
  return token ? `${path}?token=${encodeURIComponent(token)}` : path;
}

/**
 * Resolve the access token from the URL query string or sessionStorage.
 * If found in the URL, persist to sessionStorage and strip the param from the address bar.
 */
function resolveInitialToken(): string | null {
  if (DEMO_MODE) return "__demo__";
  const params = new URLSearchParams(window.location.search);
  const urlToken = params.get("token");
  if (urlToken) {
    sessionStorage.setItem(SESSION_TOKEN_KEY, urlToken);
    // Clean the URL
    params.delete("token");
    const cleanSearch = params.toString();
    const newUrl =
      window.location.pathname + (cleanSearch ? `?${cleanSearch}` : "") + window.location.hash;
    window.history.replaceState(null, "", newUrl);
    return urlToken;
  }
  return sessionStorage.getItem(SESSION_TOKEN_KEY);
}

function App() {
  const [accessToken, setAccessToken] = useState<string | null>(resolveInitialToken);
  const graph = useDashboardStore((s) => s.graph);

  const handleTokenValid = useCallback((token: string) => {
    sessionStorage.setItem(SESSION_TOKEN_KEY, token);
    setAccessToken(token);
  }, []);

  const handleResetProject = useCallback(() => {
    sessionStorage.removeItem(SESSION_TOKEN_KEY);
    useDashboardStore.setState({
      graph: null,
      domainGraph: null,
      uploadedFiles: null
    });
    setAccessToken(null);
  }, []);

  // In demo mode, skip token gate entirely
  if (DEMO_MODE) {
    return <Dashboard accessToken="__demo__" onResetProject={handleResetProject} />;
  }

  // Show the upload screen when no token and no local graph is available
  if (accessToken === null && graph === null) {
    return <UploadScreen onTokenValid={handleTokenValid} />;
  }

  return <Dashboard accessToken={accessToken ?? "__local__"} onResetProject={handleResetProject} />;
}

function Dashboard({
  accessToken,
  onResetProject,
}: {
  accessToken: string;
  onResetProject: () => void;
}) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setDiffOverlay = useDashboardStore((s) => s.setDiffOverlay);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [graphIssues, setGraphIssues] = useState<GraphIssue[]>([]);
  const [metaTheme, setMetaTheme] = useState<ThemeConfig | null>(null);
  const [outputLanguage, setOutputLanguage] = useState<string | undefined>();
  const graph = useDashboardStore((s) => s.graph);

  useEffect(() => {
    if (accessToken === "__local__") return;
    fetch(dataUrl("meta.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((meta) => {
        if (meta?.theme) setMetaTheme(meta.theme);
      })
      .catch(() => {});
    fetch(dataUrl("config.json", accessToken))
      .then((r) => (r.ok ? r.json() : null))
      .then((config) => {
        if (config?.outputLanguage) setOutputLanguage(config.outputLanguage);
      })
      .catch(() => {});
  }, [accessToken]);

  useEffect(() => {
    if (accessToken === "__local__") return;
    fetch(dataUrl("knowledge-graph.json", accessToken))
      .then((res) => res.json())
      .then((data: unknown) => {
        const result = validateGraph(data);
        if (result.success && result.data) {
          setGraph(result.data);
          setGraphIssues(result.issues);
          if ((data as Record<string, unknown>).kind === "knowledge") {
            useDashboardStore.getState().setViewMode("knowledge");
            useDashboardStore.getState().setIsKnowledgeGraph(true);
          }
          for (const issue of result.issues) {
            if (issue.level === "auto-corrected") {
              console.warn(`[graph] auto-corrected: ${issue.message}`);
            } else if (issue.level === "dropped") {
              console.error(`[graph] dropped: ${issue.message}`);
            }
          }
        } else if (result.fatal) {
          console.error("Knowledge graph validation failed:", result.fatal);
          setLoadError(`Invalid knowledge graph: ${result.fatal}`);
        } else {
          console.error("Knowledge graph validation failed: unknown error");
          setLoadError("Invalid knowledge graph: unknown validation error");
        }
      })
      .catch((err) => {
        console.error("Failed to load knowledge graph:", err);
        setLoadError(`Failed to load knowledge graph: ${err instanceof Error ? err.message : String(err)}`);
      });
  }, [setGraph, accessToken]);

  useEffect(() => {
    if (accessToken === "__local__") return;
    fetch(dataUrl("diff-overlay.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (
          data &&
          typeof data === "object" &&
          "changedNodeIds" in data &&
          "affectedNodeIds" in data &&
          Array.isArray((data as Record<string, unknown>).changedNodeIds) &&
          Array.isArray((data as Record<string, unknown>).affectedNodeIds)
        ) {
          const d = data as { changedNodeIds: string[]; affectedNodeIds: string[] };
          if (d.changedNodeIds.length > 0) {
            setDiffOverlay(d.changedNodeIds, d.affectedNodeIds);
          }
        }
      })
      .catch(() => {});
  }, [setDiffOverlay, accessToken]);

  useEffect(() => {
    if (accessToken === "__local__") return;
    fetch(dataUrl("domain-graph.json", accessToken))
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data: unknown) => {
        if (!data) return;
        const result = validateGraph(data);
        if (result.success && result.data) {
          setDomainGraph(result.data);
        } else if (result.fatal) {
          console.warn(`[domain-graph] validation failed: ${result.fatal}`);
        }
      })
      .catch(() => {});
  }, [setDomainGraph, accessToken]);

  if (graph === null) {
    if (loadError) {
      return <UploadScreen onTokenValid={onResetProject} initialError={loadError} />;
    }
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-root noise-overlay">
        <div className="w-12 h-12 rounded-full border-4 border-accent/10 border-t-accent animate-spin mb-4" />
        <p className="text-text-muted text-sm font-mono">Loading project graph...</p>
      </div>
    );
  }

  return (
    <I18nProvider language={outputLanguage ?? "en"}>
      <ThemeProvider metaTheme={metaTheme}>
        <DashboardContent
          accessToken={accessToken}
          loadError={loadError}
          graphIssues={graphIssues}
          onResetProject={onResetProject}
        />
      </ThemeProvider>
    </I18nProvider>
  );
}

function DashboardContent({
  accessToken,
  loadError,
  graphIssues,
  onResetProject,
}: {
  accessToken: string;
  loadError: string | null;
  graphIssues: GraphIssue[];
  onResetProject: () => void;
}) {
  const graph = useDashboardStore((s) => s.graph);
  const selectedNodeId = useDashboardStore((s) => s.selectedNodeId);
  const selectNode = useDashboardStore((s) => s.selectNode);
  const tourActive = useDashboardStore((s) => s.tourActive);
  const persona = useDashboardStore((s) => s.persona);
  const codeViewerOpen = useDashboardStore((s) => s.codeViewerOpen);
  const codeViewerExpanded = useDashboardStore((s) => s.codeViewerExpanded);
  const expandCodeViewer = useDashboardStore((s) => s.expandCodeViewer);
  const collapseCodeViewer = useDashboardStore((s) => s.collapseCodeViewer);
  const pathFinderOpen = useDashboardStore((s) => s.pathFinderOpen);
  const togglePathFinder = useDashboardStore((s) => s.togglePathFinder);
  const nodeTypeFilters = useDashboardStore((s) => s.nodeTypeFilters);
  const toggleNodeTypeFilter = useDashboardStore((s) => s.toggleNodeTypeFilter);
  const detailLevel = useDashboardStore((s) => s.detailLevel);
  const setDetailLevel = useDashboardStore((s) => s.setDetailLevel);
  const showFunctionsInClassView = useDashboardStore((s) => s.showFunctionsInClassView);
  const toggleShowFunctionsInClassView = useDashboardStore((s) => s.toggleShowFunctionsInClassView);
  
  const [showKeyboardHelp, setShowKeyboardHelp] = useState(false);
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>("files");
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(false);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(false);

  const [showOnboarding, setShowOnboarding] = useState(shouldShowOnboarding);
  const dismissOnboarding = useCallback((remember: boolean) => {
    if (remember && typeof window !== "undefined") {
      window.localStorage.setItem(ONBOARDING_DISMISSED_KEY, "1");
    }
    setShowOnboarding(false);
  }, []);
  
  const viewMode = useDashboardStore((s) => s.viewMode);
  const setViewMode = useDashboardStore((s) => s.setViewMode);
  const isKnowledgeGraph = useDashboardStore((s) => s.isKnowledgeGraph);
  const domainGraph = useDashboardStore((s) => s.domainGraph);
  const layoutIssues = useDashboardStore((s) => s.layoutIssues);
  const isMobile = useIsMobile();
  const { t } = useI18n();
  const allIssues = useMemo(
    () => [...graphIssues, ...layoutIssues],
    [graphIssues, layoutIssues],
  );

  // Auto-expand Right Details Sidebar when a node is selected
  useEffect(() => {
    if (selectedNodeId) {
      setRightSidebarCollapsed(false);
    }
  }, [selectedNodeId]);

  // Define keyboard shortcuts
  const shortcuts = useMemo<KeyboardShortcut[]>(
    () => [
      // Help
      {
        key: "?",
        shiftKey: true,
        description: t.keyboardShortcuts.showHelp,
        action: () => setShowKeyboardHelp((prev) => !prev),
        category: "General",
      },
      // Navigation
      {
        key: "Escape",
        description: t.keyboardShortcuts.escapeDesc,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.pathFinderOpen) {
            state.togglePathFinder();
          } else if (state.filterPanelOpen) {
            state.toggleFilterPanel();
          } else if (state.exportMenuOpen) {
            state.toggleExportMenu();
          } else if (state.codeViewerExpanded) {
            state.collapseCodeViewer();
          } else if (state.codeViewerOpen) {
            state.closeCodeViewer();
          } else if (state.selectedNodeId) {
            state.selectNode(null);
          } else if (state.navigationLevel === "layer-detail") {
            state.navigateToOverview();
          } else if (state.tourActive) {
            state.stopTour();
          } else {
            setShowKeyboardHelp(false);
          }
        },
        category: "Navigation",
      },
      {
        key: "/",
        description: t.keyboardShortcuts.focusSearch,
        action: () => {
          const searchInput = document.querySelector<HTMLInputElement>(
            '[data-testid="search-input"]'
          );
          searchInput?.focus();
        },
        category: "Navigation",
      },
      // Tour controls
      {
        key: "ArrowRight",
        description: t.keyboardShortcuts.nextStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.nextTourStep();
          }
        },
        category: "Tour",
      },
      {
        key: "ArrowLeft",
        description: t.keyboardShortcuts.prevStep,
        action: () => {
          const state = useDashboardStore.getState();
          if (state.tourActive) {
            state.prevTourStep();
          }
        },
        category: "Tour",
      },
      // View toggles
      {
        key: "d",
        description: t.keyboardShortcuts.toggleDiff,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleDiffMode();
        },
        category: "View",
      },
      {
        key: "f",
        description: t.keyboardShortcuts.toggleFilter,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleFilterPanel();
        },
        category: "View",
      },
      {
        key: "e",
        description: t.keyboardShortcuts.toggleExport,
        action: () => {
          const state = useDashboardStore.getState();
          state.toggleExportMenu();
        },
        category: "View",
      },
      {
        key: "p",
        description: t.keyboardShortcuts.openPathFinder,
        action: () => {
          const state = useDashboardStore.getState();
          state.togglePathFinder();
        },
        category: "View",
      },
    ],
    [t]
  );

  // Register keyboard shortcuts
  useKeyboardShortcuts(shortcuts);

  const handleTabToggle = (tab: SidebarTab) => {
    if (sidebarTab === tab) {
      setLeftSidebarCollapsed((prev) => !prev);
    } else {
      setSidebarTab(tab);
      setLeftSidebarCollapsed(false);
    }
  };

  const isLearnMode = tourActive || persona === "junior";
  const rightSidebarContent = (
    <div className="h-full flex flex-col min-h-0 bg-surface">
      <div className="flex items-center justify-between p-4 border-b border-border-subtle bg-surface/80 shrink-0">
        <h3 className="font-heading text-sm text-text-primary tracking-wider uppercase flex items-center gap-2">
          {selectedNodeId ? (
            <>
              <span className="neon-dot-purple shrink-0" />
              <span>{t.sidebar.info}</span>
            </>
          ) : tourActive ? (
            <>
              <span className="neon-dot-purple shrink-0 animate-pulse" />
              <span>Interactive Tour</span>
            </>
          ) : (
            <>
              <span className="neon-dot shrink-0" />
              <span>Project Overview</span>
            </>
          )}
        </h3>
        <button
          onClick={() => {
            if (tourActive) {
              useDashboardStore.getState().stopTour();
            } else if (selectedNodeId) {
              selectNode(null);
            } else {
              setRightSidebarCollapsed(true);
            }
          }}
          className="text-text-muted hover:text-accent p-1 rounded hover:bg-elevated/40 transition-colors"
          title="Close / Stop Tour"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div className="flex-1 overflow-auto min-h-0">
        {selectedNodeId && <NodeInfo />}
        {isLearnMode && !tourActive && (
          <Suspense fallback={null}>
            <div className={selectedNodeId ? "border-t border-border-subtle/30 mt-4 pt-4" : "h-full"}>
              <LearnPanel />
            </div>
          </Suspense>
        )}
        {!selectedNodeId && (!isLearnMode || tourActive) && <ProjectOverview />}
      </div>
    </div>
  );

  const leftSidebarContent = (
    <div className="h-full flex flex-col min-h-0 bg-surface">
      {/* Tab panel header title */}
      <div className="px-4 py-3 border-b border-border-subtle bg-surface/80 shrink-0 flex items-center justify-between">
        <h3 className="font-heading text-xs text-text-primary tracking-widest uppercase font-bold">
          {sidebarTab === "files" ? t.sidebar.files : sidebarTab === "chat" ? "AI Companion" : "System Settings"}
        </h3>
        <button
          onClick={() => setLeftSidebarCollapsed(true)}
          className="text-text-muted hover:text-accent p-1 rounded hover:bg-elevated/40 transition-colors md:hidden"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
      </div>

      <div className="flex-1 min-h-0 overflow-hidden">
        {sidebarTab === "files" ? (
          <div className="h-full overflow-auto p-2"><FileExplorer /></div>
        ) : sidebarTab === "chat" ? (
          <ProjectChatbot embedded={true} />
        ) : (
          /* Settings / Filters tab panel contents (Relocated options) */
          <div className="h-full overflow-auto p-4 space-y-6">
            
            {/* View Mode Selector - Segmented Sliding Control */}
            {graph && !isKnowledgeGraph && domainGraph && (
              <div>
                <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 font-mono">
                  Visualization Mode
                </h4>
                <div className="cyber-segmented-control relative flex bg-elevated/40 border border-border-subtle/50 rounded-lg p-0.5 w-full">
                  <button
                    type="button"
                    onClick={() => setViewMode("domain")}
                    title={t.drawer.domain}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all relative z-10 ${
                      viewMode === "domain"
                        ? "text-accent font-bold"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {viewMode === "domain" && (
                      <span className="absolute inset-0 bg-accent/15 border border-accent/20 rounded-md z-[-1]" />
                    )}
                    {t.drawer.domain}
                  </button>
                  <button
                    type="button"
                    onClick={() => setViewMode("structural")}
                    title={t.drawer.structural}
                    className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all relative z-10 ${
                      viewMode === "structural"
                        ? "text-accent font-bold"
                        : "text-text-muted hover:text-text-secondary"
                    }`}
                  >
                    {viewMode === "structural" && (
                      <span className="absolute inset-0 bg-accent/15 border border-accent/20 rounded-md z-[-1]" />
                    )}
                    {t.drawer.structural}
                  </button>
                </div>
              </div>
            )}

            {/* Detail Level Selector - Segmented Sliding Control */}
            {!isKnowledgeGraph && viewMode !== "domain" && (
              <div className="space-y-3">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 font-mono">
                    Detail Level
                  </h4>
                  <div className="cyber-segmented-control relative flex bg-elevated/40 border border-border-subtle/50 rounded-lg p-0.5 w-full">
                    <button
                      type="button"
                      onClick={() => setDetailLevel("file")}
                      title={t.detailLevel.filesTitle}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all relative z-10 ${
                        detailLevel === "file"
                          ? "text-accent font-bold"
                          : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {detailLevel === "file" && (
                        <span className="absolute inset-0 bg-accent/15 border border-accent/20 rounded-md z-[-1]" />
                      )}
                      {t.detailLevel.files}
                    </button>
                    <button
                      type="button"
                      onClick={() => setDetailLevel("class")}
                      title={t.detailLevel.classesTitle}
                      className={`flex-1 py-1.5 text-xs font-semibold rounded-md transition-all relative z-10 ${
                        detailLevel === "class"
                          ? "text-accent font-bold"
                          : "text-text-muted hover:text-text-secondary"
                      }`}
                    >
                      {detailLevel === "class" && (
                        <span className="absolute inset-0 bg-accent/15 border border-accent/20 rounded-md z-[-1]" />
                      )}
                      {t.detailLevel.classes}
                    </button>
                  </div>
                </div>

                {detailLevel === "class" && (
                  <div className="flex items-center justify-between p-2.5 rounded-lg bg-elevated/25 border border-border-subtle/30">
                    <span className="text-xs text-text-secondary font-medium">Show Functions</span>
                    <label className="cyber-switch shrink-0">
                      <input
                        type="checkbox"
                        checked={showFunctionsInClassView}
                        onChange={toggleShowFunctionsInClassView}
                      />
                      <span className="cyber-switch-slider"></span>
                    </label>
                  </div>
                )}
              </div>
            )}

            {/* Diff Analysis Mode switch toggle */}
            <div className="p-3 rounded-lg bg-elevated/15 border border-border-subtle/40">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-[10px] font-bold uppercase tracking-widest text-text-muted font-mono">
                  Diff Analysis
                </span>
                <label className="cyber-switch shrink-0">
                  <input
                    type="checkbox"
                    checked={useDashboardStore((s) => s.diffMode)}
                    onChange={() => useDashboardStore.getState().toggleDiffMode()}
                    disabled={useDashboardStore((s) => s.changedNodeIds).size === 0}
                  />
                  <span className="cyber-switch-slider"></span>
                </label>
              </div>
              <p className="text-[10px] text-text-muted leading-normal mb-2.5">
                Highlight file commits & downstream impacts.
              </p>
              <div className="border-t border-border-subtle/20 pt-2">
                <DiffToggle />
              </div>
            </div>

            {/* Category Filter panel grid */}
            <div>
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2.5 font-mono">
                System Component filters
              </h4>
              <div className="grid grid-cols-2 gap-2">
                {(isKnowledgeGraph ? [
                  { key: "knowledge" as const, label: t.nodeTypeLabels.all, color: "var(--color-node-article)" },
                ] : [
                  { key: "code" as const, label: t.nodeTypeLabels.code, color: "var(--color-node-file)" },
                  { key: "config" as const, label: t.nodeTypeLabels.config, color: "var(--color-node-config)" },
                  { key: "docs" as const, label: t.nodeTypeLabels.docs, color: "var(--color-node-document)" },
                  { key: "infra" as const, label: t.nodeTypeLabels.infra, color: "var(--color-node-service)" },
                  { key: "data" as const, label: t.nodeTypeLabels.data, color: "var(--color-node-table)" },
                  { key: "domain" as const, label: t.nodeTypeLabels.domain, color: "var(--color-node-concept)" },
                  { key: "knowledge" as const, label: t.nodeTypeLabels.knowledge, color: "var(--color-node-article)" },
                ]).map((cat) => {
                  const isActive = nodeTypeFilters[cat.key] !== false;
                  return (
                    <button
                      key={cat.key}
                      type="button"
                      onClick={() => toggleNodeTypeFilter(cat.key)}
                      className={`flex items-center gap-1.5 p-2 rounded-lg border text-left text-[11px] transition-all truncate ${
                        isActive
                          ? "border-accent/40 bg-accent/5 text-text-primary shadow-sm hover:border-accent"
                          : "border-transparent bg-transparent text-text-muted/40 line-through hover:text-text-muted"
                      }`}
                      title={`${isActive ? "Hide" : "Show"} ${cat.label} nodes`}
                    >
                      <span
                        className="w-2 h-2 rounded-full shrink-0"
                        style={{
                          backgroundColor: cat.color,
                          boxShadow: isActive ? `0 0 8px ${cat.color}` : 'none',
                          opacity: isActive ? 1 : 0.3,
                        }}
                      />
                      <span className="truncate flex-1">{cat.label}</span>
                      {isActive && <span className="neon-dot shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Layer Depth Legend block */}
            <div className="border-t border-border-subtle/30 pt-4">
              <h4 className="text-[10px] font-bold uppercase tracking-widest text-text-muted mb-2 font-mono">
                Layer Hierarchy
              </h4>
              <div className="overflow-x-auto scrollbar-hide py-1">
                <LayerLegend />
              </div>
            </div>

          </div>
        )}
      </div>
    </div>
  );

  if (isMobile) {
    return (
      <MobileLayout
        accessToken={accessToken}
        showKeyboardHelp={showKeyboardHelp}
        setShowKeyboardHelp={setShowKeyboardHelp}
        loadError={loadError}
        allIssues={allIssues}
        shortcuts={shortcuts}
      />
    );
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-root text-text-primary noise-overlay cyber-grid overflow-hidden">
      
      {/* Sleek Minimalist Top Header */}
      <header className="h-14 bg-surface border-b border-border-subtle shrink-0 flex items-center px-4 justify-between gap-4 z-40">
        
        {/* Left branding */}
        <div className="flex items-center gap-3 shrink-0 min-w-0">
          <div className="flex items-center gap-2">
            <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse shrink-0" />
            <h1 className="font-heading text-sm font-bold text-text-primary tracking-widest uppercase font-mono truncate max-w-[120px] sm:max-w-none">
              SYSTEMAOPS
            </h1>
          </div>
          <div className="w-px h-4 bg-border-subtle" />
          <PersonaSelector />
        </div>

        {/* Center centered search bar */}
        <div className="flex-1 max-w-xl">
          <SearchBar />
        </div>

        {/* Right action control stack */}
        <div className="flex items-center gap-3 shrink-0">
          
          <button
            onClick={onResetProject}
            className="btn-cyber px-3 py-1.5 text-xs text-accent gap-1.5 flex items-center cursor-pointer"
            title="Upload another folder or GitHub repository"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
            </svg>
            <span className="hidden sm:inline">Upload New</span>
          </button>

          <button
            onClick={togglePathFinder}
            className={`btn-cyber px-3 py-1.5 text-xs text-text-secondary gap-1.5 flex items-center ${
              pathFinderOpen ? "btn-cyber-active" : ""
            }`}
            title={t.pathFinder.title}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
            <span className="hidden sm:inline">{t.common.path}</span>
          </button>

          <FilterPanel />
          <ExportMenu />
          <ThemePicker />

          <button
            onClick={() => setShowKeyboardHelp(true)}
            className="text-text-muted hover:text-accent p-1.5 rounded hover:bg-elevated/40 transition-colors"
            title={t.keyboardShortcuts.showHelp}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
          </button>

          {/* Right sidebar expand/collapse toggle when no node selected */}
          {!selectedNodeId && (
            <button
              onClick={() => setRightSidebarCollapsed((prev) => !prev)}
              className={`p-1.5 rounded hover:bg-elevated/40 transition-colors ${
                !rightSidebarCollapsed ? "text-accent" : "text-text-muted"
              }`}
              title="Toggle Project Overview panel"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h7" />
              </svg>
            </button>
          )}

        </div>
      </header>

      {/* Validation warning banner */}
      {allIssues.length > 0 && !loadError && (
        <WarningBanner issues={allIssues} />
      )}

      {/* Error banner */}
      {loadError && (
        <div className="px-5 py-3 bg-red-900/30 border-b border-red-700 text-red-200 text-sm">
          {loadError}
        </div>
      )}

      {/* Main Workspace Frame */}
      <div className="flex-1 flex min-h-0 relative">
        
        {/* Vertical Left Activity Bar */}
        <aside className="w-14 bg-surface/90 border-r border-border-subtle flex flex-col justify-between py-4 items-center shrink-0 z-30">
          
          {/* Top activity icons */}
          <div className="flex flex-col items-center gap-3 w-full">
            {/* Logo Emblem */}
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-accent to-accent-secondary flex items-center justify-center font-heading text-base font-black text-root shadow-[0_0_12px_rgba(0,245,255,0.4)] mb-4 select-none">
              S
            </div>

            {/* Tab buttons */}
            {(["files", "chat", "filters"] as const).map((tab) => {
              const isActive = sidebarTab === tab && !leftSidebarCollapsed;
              let title = "File Explorer";
              let icon = (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              );

              if (tab === "chat") {
                title = "AI Companion";
                icon = (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                  </svg>
                );
              } else if (tab === "filters") {
                title = "Filters & Legend";
                icon = (
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4" />
                  </svg>
                );
              }

              return (
                <button
                  key={tab}
                  type="button"
                  onClick={() => handleTabToggle(tab)}
                  className={`w-10 h-10 rounded-lg flex items-center justify-center transition-all relative group ${
                    isActive
                      ? "bg-accent/15 text-accent shadow-sm border border-accent/25"
                      : "text-text-muted hover:text-text-primary hover:bg-elevated/40"
                  }`}
                  title={title}
                >
                  {icon}
                  
                  {/* Left indicator line */}
                  {isActive && (
                    <span className="absolute left-0 top-2 bottom-2 w-0.5 bg-accent rounded-r-md" />
                  )}
                  
                  {/* Tooltip */}
                  <span className="absolute left-full ml-2 px-2 py-1 bg-surface border border-border-subtle rounded text-[10px] uppercase font-bold tracking-widest text-text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                    {title}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Bottom activity icons */}
          <div className="flex flex-col items-center gap-3 w-full">
            
            {/* Keyboard Help Quick Launch */}
            <button
              onClick={() => setShowKeyboardHelp(true)}
              className="w-10 h-10 rounded-lg flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-elevated/40 transition-colors group relative"
              title="Keyboard Shortcuts"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M18 8A6 6 0 006 8c0 7-3 9-3 9h18s-3-2-3-9M13.73 21a2 2 0 01-3.46 0" />
              </svg>
              <span className="absolute left-full ml-2 px-2 py-1 bg-surface border border-border-subtle rounded text-[10px] uppercase font-bold tracking-widest text-text-primary opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none z-50">
                Shortcuts Help
              </span>
            </button>

          </div>
        </aside>

        {/* Primary Collapsible Left Sidebar */}
        <aside
          className={`bg-surface border-r border-border-subtle overflow-hidden transition-all duration-300 z-20 shrink-0 flex flex-col ${
            leftSidebarCollapsed ? "w-0 border-r-0" : "w-[300px] md:w-[340px]"
          }`}
        >
          {!leftSidebarCollapsed && (
            <div className="h-full flex flex-col min-h-0 animate-slide-left">
              {leftSidebarContent}
            </div>
          )}
        </aside>

        {/* Graph Workspace Canvas */}
        <div className="flex-1 min-w-0 min-h-0 relative z-10">
          {viewMode === "knowledge" ? (
            <KnowledgeGraphView />
          ) : viewMode === "domain" && domainGraph ? (
            <DomainGraphView />
          ) : (
            <GraphView />
          )}

          {/* Overlay hints */}
          <div className="absolute top-3 right-3 text-[10px] font-mono text-text-muted/65 pointer-events-none select-none bg-root/40 border border-border-subtle/25 px-2 py-1 rounded backdrop-blur-sm">
            {t.common.pressKeyboard}
          </div>
          
          {/* Bottom Code Viewer Slide-up overlay */}
          {codeViewerOpen && !codeViewerExpanded && (
            <div className="absolute bottom-0 left-0 right-0 h-[40vh] bg-surface border-t border-border-subtle animate-slide-up z-20 overflow-hidden">
              <Suspense fallback={null}>
                <CodeViewer accessToken={accessToken} onExpand={expandCodeViewer} />
              </Suspense>
            </div>
          )}
        </div>

        {/* Dedicated Collapsible Right Sidebar */}
        <aside
          className={`bg-surface border-l border-border-subtle overflow-hidden transition-all duration-300 z-20 shrink-0 flex flex-col ${
            rightSidebarCollapsed ? "w-0 border-l-0" : "w-[360px] md:w-[400px] lg:w-[440px]"
          }`}
        >
          {!rightSidebarCollapsed && (
            <div className="h-full flex flex-col min-h-0 animate-slide-right">
              {rightSidebarContent}
            </div>
          )}
        </aside>

      </div>

      {/* Full Expanded code viewer modal */}
      {codeViewerOpen && codeViewerExpanded && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-sm p-4"
          onMouseDown={collapseCodeViewer}
        >
          <div
            className="w-[calc(100vw-32px)] max-w-[1120px] h-[calc(100vh-32px)] sm:h-[calc(100vh-48px)] max-h-[820px] rounded-lg border border-border-medium bg-surface shadow-2xl overflow-hidden"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <Suspense fallback={null}>
              <CodeViewer
                accessToken={accessToken}
                presentation="modal"
                onClose={collapseCodeViewer}
              />
            </Suspense>
          </div>
        </div>
      )}

      {/* Keyboard shortcuts help modal */}
      {showKeyboardHelp && (
        <Suspense fallback={null}>
          <KeyboardShortcutsHelp
            shortcuts={shortcuts}
            onClose={() => setShowKeyboardHelp(false)}
          />
        </Suspense>
      )}

      {/* Path Finder Modal */}
      {pathFinderOpen && (
        <Suspense fallback={null}>
          <PathFinderModal isOpen={pathFinderOpen} onClose={togglePathFinder} />
        </Suspense>
      )}

      {/* Onboarding Overlay */}
      {showOnboarding && (
        <Suspense fallback={null}>
          <OnboardingOverlay onDismiss={dismissOnboarding} />
        </Suspense>
      )}

      {/* Floating chatbot (fallback if sidebar chatbot is closed or collapsed) */}
      {(sidebarTab !== "chat" || leftSidebarCollapsed) && <ProjectChatbot />}

      {/* Floating Interactive Tour Popup */}
      {tourActive && <TourPopup />}
    </div>
  );
}

export default App;

