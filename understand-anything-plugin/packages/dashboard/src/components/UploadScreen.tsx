import { useState, useCallback, useRef, useEffect } from "react";
import { parseFiles } from "../utils/browserScanner";
import { fetchGithubRepo, GithubProgress } from "../utils/githubFetcher";
import { useDashboardStore } from "../store";

interface FileSystemEntry {
  name: string;
  isFile: boolean;
  isDirectory: boolean;
  file?: (successCallback: (file: File) => void) => void;
  createReader?: () => {
    readEntries: (successCallback: (entries: FileSystemEntry[]) => void) => void;
  };
}

interface UploadScreenProps {
  onTokenValid: (token: string) => void;
  initialError?: string | null;
}

export default function UploadScreen({ onTokenValid, initialError }: UploadScreenProps) {
  const setGraph = useDashboardStore((s) => s.setGraph);
  const setDomainGraph = useDashboardStore((s) => s.setDomainGraph);
  const setUploadedFiles = useDashboardStore((s) => s.setUploadedFiles);
  const clearChatHistory = useDashboardStore((s) => s.clearChatHistory);

  const [activeTab, setActiveTab] = useState<"upload" | "github" | "server">("upload");
  const [tokenInput, setTokenInput] = useState("");
  const [githubUrl, setGithubUrl] = useState("");
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(initialError || null);

  useEffect(() => {
    if (initialError) setError(initialError);
  }, [initialError]);
  
  // Progress states
  const [status, setStatus] = useState<GithubProgress["status"]>("idle");
  const [progressMsg, setProgressMsg] = useState("");
  const [currentFileIndex, setCurrentFileIndex] = useState(0);
  const [totalFiles, setTotalFiles] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 1. Process files from local folder upload
  const handleFiles = useCallback(async (filesList: FileList | File[]) => {
    if (!filesList || filesList.length === 0) return;

    setStatus("analyzing");
    setProgressMsg("Scanning uploaded directory...");
    setError(null);

    try {
      const scannedFiles: { name: string; path: string; content: string; sizeBytes: number }[] = [];
      const totalToRead = Array.from(filesList).length;
      let readCount = 0;

      setTotalFiles(totalToRead);
      setCurrentFileIndex(0);

      // Read all file contents
      for (const file of Array.from(filesList)) {
        // webkitRelativePath contains the full relative path from folder root
        const relativePath = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
        
        try {
          const content = await file.text();
          scannedFiles.push({
            name: file.name,
            path: relativePath,
            content: content,
            sizeBytes: file.size,
          });
        } catch (e) {
          console.warn(`Could not read file ${relativePath}:`, e);
        }

        readCount++;
        setCurrentFileIndex(readCount);
        setProgressMsg(`Reading: ${relativePath}`);
      }

      setProgressMsg("Analyzing codebase structure & dependencies...");
      // Parse scanned files using our browser scanner
      const projectName = filesList[0] ? ((filesList[0] as File & { webkitRelativePath?: string }).webkitRelativePath?.split("/")[0] || "Local Codebase") : "Local Codebase";
      const { graph, domainGraph, uploadedFiles } = await parseFiles(scannedFiles, projectName);

      // Save to store
      setUploadedFiles(uploadedFiles);
      setDomainGraph(domainGraph);
      clearChatHistory();
      setGraph(graph);
      onTokenValid("__local__");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to analyze the directory. Make sure it contains valid files.");
      setStatus("idle");
    }
  }, [setGraph, setDomainGraph, setUploadedFiles, clearChatHistory, onTokenValid]);

  // Handle HTML5 File Input Change
  const handleFolderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      handleFiles(e.target.files);
    }
  };

  // Drag and drop events
  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    
    // Check if directory upload is supported in drop items
    if (e.dataTransfer.items) {
      const entries: FileSystemEntry[] = [];
      
      for (let i = 0; i < e.dataTransfer.items.length; i++) {
        const item = e.dataTransfer.items[i];
        if (item.kind === "file") {
          const entry = (item as unknown as { webkitGetAsEntry: () => FileSystemEntry | null }).webkitGetAsEntry();
          if (entry) entries.push(entry);
        }
      }

      if (entries.length > 0) {
        // Helper to traverse dropped folder items recursively
        const traverseDirectory = async (entry: FileSystemEntry, path = ""): Promise<File[]> => {
          return new Promise((resolve) => {
            if (entry.isFile && entry.file) {
              entry.file((file: File) => {
                // Attach custom relative path property
                Object.defineProperty(file, "webkitRelativePath", {
                  value: path ? `${path}/${entry.name}` : entry.name,
                  writable: true
                });
                resolve([file]);
              });
            } else if (entry.isDirectory && entry.createReader) {
              const dirReader = entry.createReader();
              dirReader.readEntries(async (subEntries: FileSystemEntry[]) => {
                const results = await Promise.all(
                  subEntries.map((subEntry) => traverseDirectory(subEntry, path ? `${path}/${entry.name}` : entry.name))
                );
                resolve(results.flat());
              });
            } else {
              resolve([]);
            }
          });
        };

        setProgressMsg("Reading files...");
        setStatus("analyzing");

        Promise.all(entries.map((entry) => traverseDirectory(entry)))
          .then((results) => {
            const allFiles = results.flat();
            handleFiles(allFiles);
          })
          .catch((err) => {
            console.error("Error traversing dropped directory:", err);
            setError("Error processing dropped folder.");
            setStatus("idle");
          });
      }
    } else if (e.dataTransfer.files) {
      handleFiles(e.dataTransfer.files);
    }
  };

  // 2. Fetch and process Github Repo
  const handleGithubSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const url = githubUrl.trim();
    if (!url) return;

    setError(null);
    setStatus("fetching-tree");

    try {
      const { files, repoName } = await fetchGithubRepo(url, (progress) => {
        setStatus(progress.status);
        if (progress.currentFileName) setProgressMsg(progress.currentFileName);
        if (progress.currentFileIndex !== undefined) setCurrentFileIndex(progress.currentFileIndex);
        if (progress.totalFiles !== undefined) setTotalFiles(progress.totalFiles);
      });

      setStatus("analyzing");
      setProgressMsg("Generating graphs and project tours...");

      const { graph, domainGraph, uploadedFiles } = await parseFiles(files, repoName);
      
      setUploadedFiles(uploadedFiles);
      setDomainGraph(domainGraph);
      clearChatHistory();
      setGraph(graph);
      onTokenValid("__local__");
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : "Failed to import GitHub repository.");
      setStatus("idle");
    }
  };

  // 3. Connect to local Dev Server via token
  const handleTokenSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const token = tokenInput.trim();
    if (!token) return;

    setStatus("analyzing");
    setProgressMsg("Connecting to developer server...");
    setError(null);

    try {
      const res = await fetch(`/knowledge-graph.json?token=${encodeURIComponent(token)}`);
      if (res.ok) {
        onTokenValid(token);
      } else if (res.status === 403) {
        setError("Invalid token. Please check the token printed in your terminal.");
        setStatus("idle");
      } else {
        setError(`Connection failed (Status: ${res.status}). Ensure the dev server is running.`);
        setStatus("idle");
      }
    } catch (err) {
      setError(`Server unreachable: ${err instanceof Error ? err.message : String(err)}`);
      setStatus("idle");
    }
  };

  const isScanning = status !== "idle" && status !== "completed" && status !== "error";

  if (isScanning) {
    const percent = totalFiles > 0 ? Math.round((currentFileIndex / totalFiles) * 100) : 0;
    return (
      <div className="h-screen w-screen flex flex-col items-center justify-center bg-root text-text-primary noise-overlay cyber-grid p-6">
        <div className="w-full max-w-xl p-8 bg-surface/90 backdrop-blur-md border border-border-medium rounded-xl shadow-[0_0_30px_rgba(0,245,255,0.25)] flex flex-col items-center">
          
          {/* Animated Spinner & Progress */}
          <div className="relative w-24 h-24 mb-8 flex items-center justify-center">
            {/* Outer spinning ring */}
            <div className="absolute inset-0 rounded-full border-4 border-border-subtle border-t-accent animate-spin shadow-[0_0_12px_rgba(0,242,254,0.2)]" />
            {/* Inner pulsing glow */}
            <div className="w-16 h-16 rounded-full bg-accent/10 border border-accent/20 animate-pulse flex items-center justify-center shadow-[0_0_15px_rgba(0,242,254,0.15)]">
              <span className="text-xs font-mono font-bold text-accent">
                {status === "downloading-files" ? `${percent}%` : "SO"}
              </span>
            </div>
          </div>

          <h2 className="text-xl font-heading text-text-primary mb-2 text-center tracking-wider uppercase font-bold">
            {status === "fetching-tree" && "Connecting to GitHub..."}
            {status === "downloading-files" && "Downloading Repository Files"}
            {status === "analyzing" && "Analyzing Codebase Structure"}
          </h2>
          
          <p className="text-sm text-text-muted text-center max-w-md mb-8 truncate w-full px-4 font-mono">
            {progressMsg}
          </p>

          {/* Progress bar */}
          {(status === "downloading-files" || status === "analyzing") && totalFiles > 0 && (
            <div className="w-full bg-elevated h-2.5 rounded-full overflow-hidden border border-border-subtle mb-3">
              <div
                className="h-full bg-gradient-to-r from-accent/70 to-accent rounded-full transition-all duration-300"
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          
          {totalFiles > 0 && (
            <div className="text-xs text-text-muted font-mono">
              Processed {currentFileIndex} of {totalFiles} items
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-root noise-overlay cyber-grid p-6 overflow-auto">
      <div className="w-full max-w-3xl flex flex-col md:flex-row bg-surface/95 backdrop-blur-md border border-border-medium rounded-xl shadow-[0_0_30px_rgba(0,245,255,0.25)] overflow-hidden min-h-[500px]">
        
        {/* Left pane: Branding & Instructions */}
        <div className="md:w-5/12 bg-elevated/40 p-8 flex flex-col justify-between border-b md:border-b-0 md:border-r border-border-subtle">
          <div>
            <div className="w-12 h-12 rounded-lg bg-accent/10 border border-accent/40 flex items-center justify-center mb-6 shadow-[0_0_15px_rgba(0,242,254,0.2)] animate-pulse">
              <span className="font-heading text-xl text-accent font-bold tracking-wider">SO</span>
            </div>
            <h1 className="font-heading text-3xl text-text-primary tracking-wider mb-3 leading-tight font-bold uppercase">
              SystemaOps
            </h1>
            <p className="text-text-secondary text-sm leading-relaxed mb-6 font-sans">
              Developer Operations Control Center. Upload a local folder or connect a GitHub repository to construct architectural maps, trace dependencies, and analyze system operations in real time.
            </p>
          </div>
          
          {/* Tech badge icons */}
          <div className="flex gap-2.5 flex-wrap">
            {["React Flow", "Zustand", "Tailwind 4", "Client-Side"].map((tech) => (
              <span key={tech} className="text-[10px] uppercase font-mono tracking-wider text-accent border border-accent/30 bg-accent/10 px-2.5 py-1 rounded-md shadow-[0_0_8px_rgba(0,242,254,0.1)]">
                {tech}
              </span>
            ))}
          </div>
        </div>

        {/* Right pane: Selection and forms */}
        <div className="md:w-7/12 p-8 flex flex-col">
          {/* Tab selector */}
          <div className="flex bg-elevated rounded-lg p-1 mb-8 shrink-0">
            <button
              onClick={() => { setActiveTab("upload"); setError(null); }}
              className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                activeTab === "upload"
                  ? "bg-accent/15 text-accent shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              Upload Folder
            </button>
            <button
              onClick={() => { setActiveTab("github"); setError(null); }}
              className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                activeTab === "github"
                  ? "bg-accent/15 text-accent shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              GitHub Link
            </button>
            <button
              onClick={() => { setActiveTab("server"); setError(null); }}
              className={`flex-1 py-2 text-xs font-semibold uppercase tracking-wider rounded-md transition-all ${
                activeTab === "server"
                  ? "bg-accent/15 text-accent shadow-sm"
                  : "text-text-muted hover:text-text-primary"
              }`}
            >
              CLI Server
            </button>
          </div>

          <div className="flex-1 flex flex-col justify-center min-h-[220px]">
            {/* TAB 1: Upload Folder */}
            {activeTab === "upload" && (
              <div
                onDragEnter={handleDrag}
                onDragOver={handleDrag}
                onDragLeave={handleDrag}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`flex-1 flex flex-col items-center justify-center border-2 border-dashed rounded-xl cursor-pointer p-6 transition-all duration-300 ${
                  isDragActive
                    ? "border-accent bg-accent/5 shadow-[0_0_15px_rgba(0,245,255,0.15)] scale-[0.99]"
                    : "border-border-medium hover:border-accent/50 hover:bg-elevated/20"
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFolderChange}
                  className="hidden"
                  {...({
                    webkitdirectory: "",
                    directory: "",
                    multiple: true,
                  } as Record<string, unknown>)}
                />
                
                {/* Folder Upload Icon */}
                <svg className={`w-12 h-12 mb-4 transition-transform duration-300 ${isDragActive ? "scale-110 text-accent" : "text-text-muted"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 19a2 2 0 01-2-2V7a2 2 0 012-2h4l2 2h4a2 2 0 012 2v1M5 19h14a2 2 0 002-2v-5M5 19v-2m14 2v-2M9 11h.01M12 11h.01M15 11h.01" />
                </svg>

                <p className="text-sm text-text-primary font-medium text-center mb-1">
                  Drag and drop your project folder here
                </p>
                <p className="text-xs text-text-muted text-center">
                  or click to browse your computer
                </p>
              </div>
            )}

            {/* TAB 2: GitHub URL */}
            {activeTab === "github" && (
              <form onSubmit={handleGithubSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                    Public GitHub Repository URL
                  </label>
                  <input
                    type="url"
                    value={githubUrl}
                    onChange={(e) => setGithubUrl(e.target.value)}
                    placeholder="https://github.com/owner/repository"
                    required
                    className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted/40 font-mono text-sm focus:outline-none focus:border-accent transition-colors"
                  />
                </div>
                <button
                  type="submit"
                  disabled={!githubUrl.trim()}
                  className="w-full py-3 bg-accent text-root font-semibold rounded-lg transition-all hover:brightness-110 hover:shadow-[0_0_15px_rgba(0,245,255,0.35)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Fetch and Analyze
                </button>
              </form>
            )}

            {/* TAB 3: Local Dev Server Token */}
            {activeTab === "server" && (
              <form onSubmit={handleTokenSubmit} className="space-y-4">
                <div>
                  <label className="block text-[11px] font-semibold text-text-muted uppercase tracking-wider mb-2">
                    CLI Access Token
                  </label>
                  <input
                    type="text"
                    value={tokenInput}
                    onChange={(e) => setTokenInput(e.target.value)}
                    placeholder="Paste the token printed in terminal..."
                    required
                    className="w-full px-4 py-3 bg-elevated border border-border-subtle rounded-lg text-text-primary placeholder:text-text-muted/40 font-mono text-sm focus:outline-none focus:border-accent transition-colors"
                  />
                  <p className="text-[10px] text-text-muted mt-2">
                    Requires running `pnpm dev:dashboard` or `/understand` local server.
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={!tokenInput.trim()}
                  className="w-full py-3 bg-accent text-root font-semibold rounded-lg transition-all hover:brightness-110 hover:shadow-[0_0_15px_rgba(0,245,255,0.35)] disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  Connect Server
                </button>
              </form>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="mt-6 p-4 bg-red-900/15 border border-red-700/30 rounded-lg text-red-400 text-xs leading-relaxed shrink-0">
              <span className="font-semibold block mb-0.5">Error:</span>
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
