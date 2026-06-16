interface GithubRepoInfo {
  owner: string;
  repo: string;
  branch: string;
}

export function parseGithubUrl(urlStr: string): GithubRepoInfo | null {
  try {
    const cleanUrl = urlStr.trim().replace(/\.git$/, "");
    const url = new URL(cleanUrl);
    if (url.hostname !== "github.com") return null;

    const segments = url.pathname.split("/").filter((s) => s !== "");
    if (segments.length < 2) return null;

    const owner = segments[0];
    const repo = segments[1];
    let branch = "main"; // default fallback

    // check if branch is specified in URL (e.g., /tree/branchName)
    if (segments[2] === "tree" && segments[3]) {
      branch = segments.slice(3).join("/");
    }

    return { owner, repo, branch };
  } catch (_e) {
    return null;
  }
}

export interface GithubProgress {
  status: "idle" | "fetching-tree" | "downloading-files" | "analyzing" | "completed" | "error";
  currentFileIndex?: number;
  totalFiles?: number;
  currentFileName?: string;
  error?: string;
}

interface GithubTreeItem {
  path: string;
  mode: string;
  type: "blob" | "tree";
  sha: string;
  size?: number;
  url: string;
}

const EXTENSION_CAPS = new Set([
  "js", "jsx", "ts", "tsx", "py", "go", "java", "rs", "rb", "sh", "css", "html", "json", "yaml", "yml", "toml", "md"
]);

const IGNORED_PATHS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".understand-anything/",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "venv/",
  ".venv/"
];

// Maximum code files to download in browser to prevent memory/rate-limit locks
const MAX_DOWNLOAD_FILES = 150;
const CONCURRENT_DOWNLOADS = 8;

interface JSDelivrFile {
  name: string;
  type: "file" | "directory";
  size?: number;
  files?: JSDelivrFile[];
}

function flattenJSDelivrTree(
  files: JSDelivrFile[],
  currentPath = ""
): { path: string; type: "blob" | "tree"; size?: number }[] {
  let result: { path: string; type: "blob" | "tree"; size?: number }[] = [];
  for (const item of files) {
    const itemPath = currentPath ? `${currentPath}/${item.name}` : item.name;
    if (item.type === "file") {
      result.push({
        path: itemPath,
        type: "blob",
        size: item.size,
      });
    } else if (item.type === "directory" && item.files) {
      result = result.concat(flattenJSDelivrTree(item.files, itemPath));
    }
  }
  return result;
}

export async function fetchGithubRepo(
  url: string,
  onProgress: (progress: GithubProgress) => void,
  token?: string
): Promise<{
  files: { name: string; path: string; content: string; sizeBytes: number }[];
  repoName: string;
}> {
  const repoInfo = parseGithubUrl(url);
  if (!repoInfo) {
    throw new Error("Invalid GitHub repository URL. Use format: https://github.com/owner/repo");
  }

  const { owner, repo, branch } = repoInfo;
  
  onProgress({ status: "fetching-tree", currentFileName: "Connecting to GitHub API..." });

  const headers: HeadersInit = {};
  if (token) {
    headers["Authorization"] = `token ${token}`;
  }

  let resolvedBranch = branch;
  let repoName = repo;

  // 1. Fetch default branch and metadata
  try {
    const metaRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers });
    if (!metaRes.ok) {
      if (metaRes.status === 404) {
        throw new Error("Repository not found. Make sure it is a public repository.");
      }
      throw new Error(`GitHub API returned status ${metaRes.status}`);
    }
    const metaData = await metaRes.json();
    repoName = metaData.name || repo;
    // If user didn't specify branch in URL, use the repo's default branch
    if (branch === "main" && metaData.default_branch) {
      resolvedBranch = metaData.default_branch;
    }
  } catch (err) {
    console.error("Failed to fetch repository metadata", err);
    if (err instanceof Error && err.message.includes("Repository not found")) {
      throw err;
    }
    // Continue with the default branch main if metadata API fails (e.g. rate limit)
  }

  // 2. Fetch the file tree
  let treeItems: GithubTreeItem[] = [];
  let fetchedViaJSDelivr = false;

  try {
    onProgress({ status: "fetching-tree", currentFileName: `Connecting to jsDelivr CDN (${resolvedBranch})...` });
    let jsdelivrRes = await fetch(
      `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@${resolvedBranch}`
    );
    
    // If resolved branch is "main" and it failed with 404, let's try "master"
    if (!jsdelivrRes.ok && jsdelivrRes.status === 404 && resolvedBranch === "main") {
      onProgress({ status: "fetching-tree", currentFileName: "Trying fallback branch (master)..." });
      jsdelivrRes = await fetch(
        `https://data.jsdelivr.com/v1/packages/gh/${owner}/${repo}@master`
      );
      if (jsdelivrRes.ok) {
        resolvedBranch = "master";
      }
    }

    if (jsdelivrRes.ok) {
      const jsdelivrData = await jsdelivrRes.json();
      if (jsdelivrData && Array.isArray(jsdelivrData.files)) {
        const flattened = flattenJSDelivrTree(jsdelivrData.files);
        treeItems = flattened.map(item => ({
          path: item.path,
          type: item.type,
          mode: "",
          sha: "", // not needed for raw downloads
          size: item.size,
          url: ""
        }));
        fetchedViaJSDelivr = true;
      }
    }
  } catch (err) {
    console.warn("jsDelivr fetch failed, falling back to GitHub API", err);
  }

  if (!fetchedViaJSDelivr) {
    try {
      onProgress({ status: "fetching-tree", currentFileName: "Connecting to GitHub API..." });
      const treeRes = await fetch(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${resolvedBranch}?recursive=1`,
        { headers }
      );
      if (!treeRes.ok) {
        if (treeRes.status === 403) {
          throw new Error("Failed to load file tree from GitHub (Status: 403). The GitHub API rate limit has been exceeded. Please provide a GitHub Personal Access Token below to bypass rate limits.");
        }
        throw new Error(`Failed to load file tree from GitHub (Status: ${treeRes.status}).`);
      }
      const treeData = await treeRes.json();
      if (treeData.truncated) {
        console.warn("GitHub tree is truncated; some files may be missing.");
      }
      treeItems = treeData.tree || [];
    } catch (err) {
      throw new Error(err instanceof Error ? err.message : "Failed to retrieve directory structure.");
    }
  }

  // 3. Filter files
  const codeFiles = treeItems.filter((item) => {
    if (item.type !== "blob") return false;
    const ext = item.path.split(".").pop()?.toLowerCase() ?? "";
    const isIgnored = IGNORED_PATHS.some((ignored) => item.path.includes(ignored) || item.path.startsWith(ignored));
    return EXTENSION_CAPS.has(ext) && !isIgnored;
  });

  // Sort files by size so we prioritize smaller config/code files over massive data/log files
  codeFiles.sort((a, b) => (a.size ?? 0) - (b.size ?? 0));

  // Cap download count
  const filesToDownload = codeFiles.slice(0, MAX_DOWNLOAD_FILES);

  if (filesToDownload.length === 0) {
    throw new Error("No supported code or text files found in the repository.");
  }

  // 4. Download file contents in concurrent batches
  const downloadedFiles: { name: string; path: string; content: string; sizeBytes: number }[] = [];
  let downloadedCount = 0;

  onProgress({
    status: "downloading-files",
    currentFileIndex: 0,
    totalFiles: filesToDownload.length,
    currentFileName: "Preparing downloads...",
  });

  // Helper to fetch file content
  const downloadFile = async (item: GithubTreeItem) => {
    const fileName = item.path.split("/").pop() ?? item.path;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${resolvedBranch}/${item.path}`;

    try {
      const res = await fetch(rawUrl);
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const text = await res.text();
      downloadedFiles.push({
        name: fileName,
        path: item.path,
        content: text,
        sizeBytes: item.size ?? text.length,
      });
    } catch (err) {
      console.error(`Failed to download ${item.path}:`, err);
      // Create empty/error node rather than blocking the whole download
      downloadedFiles.push({
        name: fileName,
        path: item.path,
        content: `// Error loading file from GitHub: ${err instanceof Error ? err.message : String(err)}`,
        sizeBytes: 0,
      });
    } finally {
      downloadedCount++;
      onProgress({
        status: "downloading-files",
        currentFileIndex: downloadedCount,
        totalFiles: filesToDownload.length,
        currentFileName: item.path,
      });
    }
  };

  // Run downloads in chunks
  for (let i = 0; i < filesToDownload.length; i += CONCURRENT_DOWNLOADS) {
    const batch = filesToDownload.slice(i, i + CONCURRENT_DOWNLOADS);
    await Promise.all(batch.map((item) => downloadFile(item)));
  }

  onProgress({
    status: "analyzing",
    currentFileIndex: downloadedCount,
    totalFiles: filesToDownload.length,
    currentFileName: "Parsing code structures...",
  });

  return {
    files: downloadedFiles,
    repoName,
  };
}
