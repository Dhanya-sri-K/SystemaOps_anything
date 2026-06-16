import type {
  GraphNode,
  GraphEdge,
  KnowledgeGraph,
  Layer,
  TourStep
} from "@understand-anything/core/types";

// Extensions to parse
const CODE_EXTENSIONS = new Set([
  "js", "jsx", "ts", "tsx", "mjs", "cjs", "py", "go", "java", "rs", "rb", "sh", "css", "html", "json", "yaml", "yml", "toml", "md"
]);

// Directories to ignore
const IGNORED_DIRS = [
  "node_modules/",
  ".git/",
  "dist/",
  "build/",
  ".understand-anything/",
  "coverage/",
  "venv/",
  ".venv/",
  "env/",
  ".next/",
  "out/",
  ".astro/",
  ".nuxt/",
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock"
];

interface ScannedFile {
  name: string;
  path: string; // relative to root
  content: string;
  sizeBytes: number;
}

export function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase();
  if (!ext) return "text";
  const byExt: Record<string, string> = {
    css: "css",
    go: "go",
    html: "markup",
    js: "javascript",
    jsx: "jsx",
    json: "json",
    md: "markdown",
    py: "python",
    rb: "ruby",
    rs: "rust",
    sh: "bash",
    ts: "typescript",
    tsx: "tsx",
    yaml: "yaml",
    yml: "yaml",
    java: "java",
  };
  return byExt[ext] ?? "text";
}

function getNodeType(filePath: string): GraphNode["type"] {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const name = filePath.split("/").pop()?.toLowerCase() ?? "";

  if (["json", "yaml", "yml", "toml", "ini"].includes(ext) || name.startsWith("tsconfig") || name.startsWith("package.json") || name.startsWith("docker")) {
    return "config";
  }
  if (["md", "txt", "pdf", "docx"].includes(ext) || name.startsWith("license") || name.startsWith("security")) {
    return "document";
  }
  return "file";
}

function getComplexity(lineCount: number, fnCount: number): "simple" | "moderate" | "complex" {
  if (lineCount > 500 || fnCount > 10) return "complex";
  if (lineCount > 100 || fnCount > 3) return "moderate";
  return "simple";
}

// Brace counting helper for finding closing brace (C-style languages)
function findClosingBraceLine(lines: string[], startIdx: number): number {
  let openBraces = 0;
  let foundBrace = false;
  for (let i = startIdx; i < lines.length; i++) {
    const line = lines[i];
    // Simple brace detection (ignoring braces inside comments/strings for simplicity)
    for (const char of line) {
      if (char === "{") {
        openBraces++;
        foundBrace = true;
      } else if (char === "}") {
        openBraces--;
      }
    }
    if (foundBrace && openBraces <= 0) {
      return i + 1; // 1-indexed line number
    }
  }
  return lines.length;
}

// Indentation helper for finding function end in Python
function findPythonEndLine(lines: string[], startIdx: number): number {
  if (startIdx >= lines.length) return lines.length;
  
  // Find indentation of the def line
  const defLine = lines[startIdx];
  const startIndent = defLine.search(/\S/);
  if (startIndent === -1) return startIdx + 1;

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "") continue;
    const indent = line.search(/\S/);
    if (indent !== -1 && indent <= startIndent) {
      return i; // ends on the line before this one (1-indexed is i)
    }
  }
  return lines.length;
}

function generateReadme(
  projectName: string,
  cleanFiles: { name: string; path: string; content: string; sizeBytes: number }[],
  languages: Set<string>,
  frameworks: Set<string>,
  folderCounts: Record<string, number>,
  parsedPackageJson: { description?: string; dependencies?: Record<string, string> } | null,
  entryNode: GraphNode | undefined,
  layers: Layer[],
  nodes: GraphNode[],
  edges: GraphEdge[],
  hasTsConfig: boolean,
  hasEslint: boolean,
  hasGitignore: boolean,
  hasDocker: boolean
): string {
  const getFileDetails = (fileId: string) => {
    const childNodes = edges
      .filter((e) => e.source === fileId && e.type === "contains")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    const classes = childNodes.filter((n) => n.type === "class").map((n) => n.name);
    const functions = childNodes.filter((n) => n.type === "function").map((n) => `${n.name}()`);

    const fileImports = edges
      .filter((e) => e.source === fileId && e.type === "imports")
      .map((e) => nodes.find((n) => n.id === e.target)?.name)
      .filter((name): name is string => !!name);

    const fileDependents = edges
      .filter((e) => e.target === fileId && e.type === "imports")
      .map((e) => nodes.find((n) => n.id === e.source)?.name)
      .filter((name): name is string => !!name);

    return { classes, functions, fileImports, fileDependents };
  };

  // Description
  let desc = "";
  if (parsedPackageJson?.description) {
    desc = parsedPackageJson.description;
  } else {
    desc = `An automatically analyzed codebase named **${projectName}**, consisting of **${cleanFiles.length}** code files and configured scripts.`;
  }

  // Introduction
  let intro = `Welcome to **${projectName}**! This repository has been parsed and mapped dynamically. It contains **${cleanFiles.length}** files and is organized into logical scopes to separate configuration inputs, build tooling, and code files.\n\n`;
  intro += `### Codebase Statistics:\n`;
  intro += `- **Languages**: ${Array.from(languages).map(l => `\`${l}\``).join(", ") || "`TypeScript` / `JavaScript`"}\n`;
  intro += `- **Primary Modules**: ${Object.keys(folderCounts).map(f => `\`/${f}\` (${folderCounts[f]} files)`).join(", ")}\n`;
  if (entryNode) {
    intro += `- **Core Execution Portal**: Starts at \`[${entryNode.name}](${entryNode.id})\`.\n`;
  }

  // What is this project for?
  let purpose = `This codebase acts as a functional deployment package or developer utility.\n\n### Inferred Capabilities:\n`;
  if (frameworks.has("React") || frameworks.has("Next.js") || frameworks.has("Astro") || frameworks.has("Vue")) {
    purpose += `- **Interactive Client-Side UI**: Houses UI views, layout templates, state managers, and event binding systems.\n`;
  }
  if (frameworks.has("Express") || cleanFiles.some(f => f.path.includes("server") || f.path.includes("api") || f.path.includes("routes"))) {
    purpose += `- **Server & API Routing**: Contains middleware layers, router maps, and controller endpoints to process remote requests.\n`;
  }
  if (cleanFiles.some(f => f.path.includes("utils") || f.path.includes("helper") || f.path.includes("core"))) {
    purpose += `- **Logic Core & Helpers**: Manages file scan pipelines, algorithmic calculations, and data formatting wrappers.\n`;
  }
  if (cleanFiles.some(f => f.path.includes("test") || f.path.includes("spec") || f.name.includes("test") || f.name.includes("spec"))) {
    purpose += `- **Quality Assured Framework**: Bundles unit and regression testing suites to ensure consistency.\n`;
  }

  // Why is this project useful?
  let usefulness = `This codebase is highly useful because of its modular design, clean separation of concerns, and type safety constraints:\n\n`;
  if (languages.has("typescript")) {
    usefulness += `- **TypeScript Integration**: Full type assertions, design definitions, and compile-time verification protect against runtime failures.\n`;
  }
  if (frameworks.has("React")) {
    usefulness += `- **React Component Tree**: Allows independent module development, rendering layouts dynamically with component state reactivity.\n`;
  }
  if (hasEslint) {
    usefulness += `- **Enforced Coding Style**: Pre-defined coding guides restrict syntax drift and keep scripts consistent.\n`;
  }
  usefulness += `- **Clear Layout Partitioning**: Direct folders differentiate utilities from interface assets, simplifying navigation and scaling.\n`;
  usefulness += `- **Interactive Relationship Graphs**: Integrates with node-link layout calculators, letting developers search and inspect imports on the fly.`;

  // Problem statement
  let problem = `Scaling codebase directories introduces significant maintenance friction. Without proper tooling, developers encounter:\n`;
  problem += `1. **Spaghetti Dependencies**: Intertwined import modules make code reuse and updates error-prone.\n`;
  problem += `2. **Onboarding Fatigue**: Finding entry gateways, helper routines, and data stores takes days of manual file digging.\n`;
  problem += `3. **Architectural Decay**: Lack of layer separation results in logic leaking across visualization blocks.\n\n`;
  problem += `This repository addresses these friction points by partitioning code into clear layer scopes and mapping import dependencies cleanly.`;

  // Methodology & Execution Flow (Deep detail tracing)
  let methodology = `This codebase operates through a logical sequence of file dependencies and runtime invocations. Here is the step-by-step code execution flow traced from the entry point:\n\n`;

  if (entryNode) {
    const visited = new Set<string>();
    const trace: string[] = [];
    const queue: { id: string; depth: number }[] = [{ id: entryNode.id, depth: 1 }];
    visited.add(entryNode.id);

    while (queue.length > 0 && trace.length < 12) {
      const current = queue.shift()!;
      const node = nodes.find(n => n.id === current.id);
      if (!node) continue;

      const details = getFileDetails(current.id);
      let step = `${current.depth}. **Execution of [${node.name}](${node.id})**:\n`;
      step += `   - **Role**: This is a level-${current.depth} module in the startup tree. It contains ${details.classes.length} classes and ${details.functions.length} functions.\n`;
      if (details.functions.length > 0) {
        step += `   - **Key entry points/handlers**: ${details.functions.map(f => `\`${f}\``).slice(0, 3).join(", ")}.\n`;
      }
      if (details.fileImports.length > 0) {
        step += `   - **Delegates tasks to**: ${details.fileImports.map(i => `\`${i}\``).slice(0, 3).join(", ")}.\n`;
      }
      trace.push(step);

      const childEdges = edges.filter(e => e.source === current.id && e.type === "imports");
      for (const edge of childEdges) {
        if (!visited.has(edge.target) && queue.length < 20) {
          visited.add(edge.target);
          queue.push({ id: edge.target, depth: current.depth + 1 });
        }
      }
    }

    methodology += trace.join("\n");

    const remainingFiles = nodes.filter(n => (n.type === "file" || n.type === "config") && !visited.has(n.id));
    if (remainingFiles.length > 0) {
      methodology += `\n### ⚙️ Supporting Utility and Configuration Flows\n`;
      methodology += `The following supporting modules configure and assist the main execution flow:\n\n`;
      for (const file of remainingFiles.slice(0, 15)) {
        const details = getFileDetails(file.id);
        methodology += `- **[${file.name}](${file.id})**: ${file.summary}\n`;
        if (details.classes.length > 0 || details.functions.length > 0) {
          methodology += `  - *Contains*: ${[...details.classes.map(c => `class \`${c}\``), ...details.functions.map(f => `\`${f}\``)].slice(0, 3).join(", ")}\n`;
        }
      }
      if (remainingFiles.length > 15) {
        methodology += `- *And ${remainingFiles.length - 15} other utility configuration files...*\n`;
      }
    }
  } else {
    methodology += `No entry point file was detected. The code routines are configured as standalone helpers.`;
  }

  // Tech stack
  let techStack = `Below is the technology stack parsed dynamically:\n\n`;
  techStack += `| Category | Tools & Libraries | Purpose |\n`;
  techStack += `| :--- | :--- | :--- |\n`;
  techStack += `| **Languages** | ${Array.from(languages).map(l => `\`${l}\``).join(", ") || "`TypeScript` / `JavaScript`"} | Core development language |\n`;
  if (frameworks.size > 0) {
    techStack += `| **Frameworks** | ${Array.from(frameworks).map(f => `\`${f}\``).join(", ")} | Engine and interface rendering |\n`;
  }
  if (parsedPackageJson) {
    const allDeps = { ...parsedPackageJson.dependencies };
    const depNames = Object.keys(allDeps);
    if (depNames.length > 0) {
      const displayDeps = depNames.slice(0, 8).map(name => `\`${name}\` (v${allDeps[name]})`).join(", ");
      techStack += `| **Dependencies** | ${displayDeps} | Client/server runtime dependencies |\n`;
    }
  }
  const toolings: string[] = [];
  if (hasTsConfig) toolings.push("TypeScript compiler config");
  if (hasEslint) toolings.push("ESLint syntax guidelines");
  if (hasGitignore) toolings.push("Git control filters");
  if (hasDocker) toolings.push("Docker container specs");
  if (toolings.length > 0) {
    techStack += `| **Tooling & Setup** | ${toolings.join(", ")} | Build scripts and code constraints |\n`;
  }

  // Architecture (Deep file-by-file tree catalog)
  let arch = `The codebase is organized into structural folders. Below is a complete, detailed file-by-file architectural catalog of the **${projectName}** repository:\n\n`;

  arch += `### 🏷️ System Layers Overview:\n`;
  for (const layer of layers) {
    arch += `- **${layer.name}**: ${layer.description} (Houses **${layer.nodeIds.length}** code elements)\n`;
  }
  arch += `\n`;
  
  const dirFiles = new Map<string, GraphNode[]>();
  const fileNodes = nodes.filter(n => n.type === "file" || n.type === "config" || n.type === "document");

  for (const node of fileNodes) {
    const filePath = node.filePath ?? node.id.replace(/^(file:|config:|document:)/, "");
    const parts = filePath.split("/");
    const dir = parts.length > 1 ? parts.slice(0, -1).join("/") : "root";
    if (!dirFiles.has(dir)) {
      dirFiles.set(dir, []);
    }
    dirFiles.get(dir)!.push(node);
  }

  const sortedDirs = Array.from(dirFiles.keys()).sort();
  for (const dir of sortedDirs) {
    const files = dirFiles.get(dir) || [];
    const formattedDirName = dir === "root" ? "Root Directory (`/`)" : `\`/${dir}\` Directory`;
    arch += `### 📁 ${formattedDirName}\n`;
    if (dir === "root") {
      arch += `Contains root configuration files, manifest declarations, environment setups, and main documentation files.\n\n`;
    } else {
      arch += `Handles functional modules, source implementations, and layers related to the \`/${dir}\` folder scope.\n\n`;
    }

    for (const file of files) {
      const fileId = file.id;
      const details = getFileDetails(fileId);
      
      arch += `#### 📄 [${file.name}](${file.id})\n`;
      arch += `- **File Path**: \`${file.filePath || fileId.replace(/^(file:|config:|document:)/, "")}\`\n`;
      arch += `- **Summary**: ${file.summary}\n`;
      
      if (details.classes.length > 0) {
        arch += `- **Declared Classes**: ${details.classes.map(c => `\`class ${c}\``).join(", ")}\n`;
      }
      if (details.functions.length > 0) {
        arch += `- **Declared Functions**: ${details.functions.map(f => `\`${f}\``).join(", ")}\n`;
      }
      if (details.fileImports.length > 0) {
        arch += `- **Imports**: ${details.fileImports.map(i => `\`${i}\``).join(", ")}\n`;
      }
      if (details.fileDependents.length > 0) {
        arch += `- **Imported By**: ${details.fileDependents.map(d => `\`${d}\``).join(", ")}\n`;
      }
      arch += `\n`;
    }
    arch += `---\n\n`;
  }

  // Connections
  const fileNodesForHubs = nodes.filter((n) => n.type === "file");
  const connectedNodes: { id: string; name: string; score: number; details: ReturnType<typeof getFileDetails> }[] = [];
  for (const f of fileNodesForHubs) {
    const details = getFileDetails(f.id);
    const score = details.fileImports.length + details.fileDependents.length;
    if (score > 0) {
      connectedNodes.push({ id: f.id, name: f.name, score, details });
    }
  }
  connectedNodes.sort((a, b) => b.score - a.score);
  const topHubs = connectedNodes.slice(0, 3);

  let connections = `Codebase connections represent imports and structural contains:\n\n`;
  if (topHubs.length > 0) {
    connections += `### Core Module Hubs:\n`;
    for (const hub of topHubs) {
      connections += `- **[${hub.name}](${hub.id})**: Connectivity rating of **${hub.score}**.\n`;
      if (hub.details.fileImports.length > 0) {
        connections += `  - *Imports*: ${hub.details.fileImports.map((i: string) => `\`${i}\``).slice(0, 3).join(", ")}\n`;
      }
      if (hub.details.fileDependents.length > 0) {
        connections += `  - *Imported By*: ${hub.details.fileDependents.map((d: string) => `\`${d}\``).slice(0, 3).join(", ")}\n`;
      }
    }
  }

  const sampleImportEdgesList: { sourceName: string; targetName: string }[] = [];
  const sampleImportEdges = edges.filter(e => e.type === "imports").slice(0, 5);
  for (const edge of sampleImportEdges) {
    const srcNode = nodes.find(n => n.id === edge.source);
    const tgtNode = nodes.find(n => n.id === edge.target);
    if (srcNode && tgtNode) {
      sampleImportEdgesList.push({ sourceName: srcNode.name, targetName: tgtNode.name });
    }
  }
  if (sampleImportEdgesList.length > 0) {
    connections += `\n### Selected Module Dependency Paths:\n`;
    for (const edge of sampleImportEdgesList) {
      connections += `- \`${edge.sourceName}\` ➔ \`${edge.targetName}\` (Import connection)\n`;
    }
  }

  return `# 📁 ${projectName}

${desc}

---

## 📋 Table of Contents
1. [Introduction](#-introduction)
2. [What is this Project For?](#-what-is-this-project-for)
3. [Why is this Project Useful?](#-why-is-this-project-useful)
4. [Problem Statement](#-problem-statement)
5. [Methodology & Execution Flow](#-methodology--execution-flow)
6. [Technology Stack](#-technology-stack)
7. [System Architecture](#-system-architecture)
8. [Dependency Mapping](#-dependency-mapping)

---

## 🚀 Introduction
${intro}

---

## 🎯 What is this Project For?
${purpose}

---

## ✨ Why is this Project Useful?
${usefulness}

---

## ⚠️ Problem Statement
${problem}

---

## ⚙️ Methodology & Execution Flow
${methodology}

---

## 🛠️ Technology Stack
${techStack}

---

## 📂 System Architecture
${arch}

---

## 🔗 Dependency Mapping
${connections}
`;
}

export async function parseFiles(
  files: ScannedFile[],
  projectName = "Uploaded Project"
): Promise<{
  graph: KnowledgeGraph;
  domainGraph: KnowledgeGraph;
  uploadedFiles: Map<string, { content: string; sizeBytes: number; lineCount: number }>;
}> {
  const nodes: GraphNode[] = [];
  const edges: GraphEdge[] = [];
  const uploadedFiles = new Map<string, { content: string; sizeBytes: number; lineCount: number }>();
  const languages = new Set<string>();
  const frameworks = new Set<string>();

  // Filter out files that should be ignored
  const validFiles = files.filter((f) => {
    const isIgnored = IGNORED_DIRS.some((dir) => f.path.includes(dir) || f.path.startsWith(dir));
    const ext = f.path.split(".").pop()?.toLowerCase() ?? "";
    return !isIgnored && CODE_EXTENSIONS.has(ext);
  });

  // Resolve path prefix so relative paths are clean (remove leading slashes, etc.)
  const cleanFiles = validFiles.map((f) => {
    let cleanPath = f.path.replace(/\\/g, "/");
    if (cleanPath.startsWith("/")) cleanPath = cleanPath.slice(1);
    return { ...f, path: cleanPath };
  });

  // Store contents in map
  for (const file of cleanFiles) {
    const lines = file.content.split(/\r?\n/);
    uploadedFiles.set(file.path, {
      content: file.content,
      sizeBytes: file.sizeBytes,
      lineCount: lines.length,
    });
  }

  // First pass: create file nodes
  for (const file of cleanFiles) {
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const lang = detectLanguage(file.path);
    if (lang && lang !== "text") languages.add(lang);

    // Scan package.json for frameworks
    if (file.path.endsWith("package.json")) {
      try {
        const pkg = JSON.parse(file.content);
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };
        if (deps.react) frameworks.add("React");
        if (deps.vue) frameworks.add("Vue");
        if (deps.angular) frameworks.add("Angular");
        if (deps.next) frameworks.add("Next.js");
        if (deps.astro) frameworks.add("Astro");
        if (deps.svelte) frameworks.add("Svelte");
        if (deps.express) frameworks.add("Express");
      } catch (_e) {
        // ignore malformed JSON
      }
    }

    const type = getNodeType(file.path);
    
    // Create base file node
    nodes.push({
      id: `file:${file.path}`,
      type,
      name: file.name,
      filePath: file.path,
      summary: type === "config" ? `Configuration file for ${file.name}` : type === "document" ? `Documentation: ${file.name}` : `Source file containing code.`,
      tags: [ext],
      complexity: "simple", // will update in second pass
    });
  }

  // Second pass: parse file contents for classes, functions, and imports
  for (const file of cleanFiles) {
    const fileId = `file:${file.path}`;
    const fileNode = nodes.find((n) => n.id === fileId);
    if (!fileNode || fileNode.type === "config" || fileNode.type === "document") continue;

    const lines = file.content.split(/\r?\n/);
    const lang = detectLanguage(file.path);
    const localClasses: { name: string; lineRange: [number, number] }[] = [];
    const localFunctions: { name: string; lineRange: [number, number] }[] = [];

    // Parse classes and functions based on language
    if (["typescript", "javascript", "tsx", "jsx"].includes(lang)) {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Match Class
        const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
        if (classMatch && !line.includes("*") && !line.includes("//")) {
          const className = classMatch[1];
          const startLine = i + 1;
          const endLine = findClosingBraceLine(lines, i);
          localClasses.push({ name: className, lineRange: [startLine, endLine] });
        }

        // Match Function
        const fnMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(/) || 
                        line.match(/(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>/);
        if (fnMatch && !line.includes("*") && !line.includes("//")) {
          const fnName = fnMatch[1];
          const startLine = i + 1;
          const endLine = findClosingBraceLine(lines, i);
          localFunctions.push({ name: fnName, lineRange: [startLine, endLine] });
        }
      }
    } else if (lang === "python") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Match Class
        const classMatch = line.match(/^class\s+(\w+)/) || line.match(/^\s*class\s+(\w+)(?:\([^)]*\))?:/);
        if (classMatch) {
          const className = classMatch[1];
          const startLine = i + 1;
          const endLine = findPythonEndLine(lines, i);
          localClasses.push({ name: className, lineRange: [startLine, endLine] });
        }

        // Match Def
        const defMatch = line.match(/^\s*def\s+(\w+)\s*\(/);
        if (defMatch) {
          const fnName = defMatch[1];
          const startLine = i + 1;
          const endLine = findPythonEndLine(lines, i);
          localFunctions.push({ name: fnName, lineRange: [startLine, endLine] });
        }
      }
    } else if (lang === "go") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        
        // Struct (maps to Class)
        const structMatch = line.match(/^type\s+(\w+)\s+struct/);
        if (structMatch) {
          const className = structMatch[1];
          const startLine = i + 1;
          const endLine = findClosingBraceLine(lines, i);
          localClasses.push({ name: className, lineRange: [startLine, endLine] });
        }

        // Func
        const funcMatch = line.match(/^func\s+(?:\([^)]+\)\s+)?(\w+)\s*\(/);
        if (funcMatch) {
          const fnName = funcMatch[1];
          const startLine = i + 1;
          const endLine = findClosingBraceLine(lines, i);
          localFunctions.push({ name: fnName, lineRange: [startLine, endLine] });
        }
      }
    } else if (lang === "java" || lang === "rust") {
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];

        // Class / Struct
        const classMatch = lang === "java" ? line.match(/(?:public|private|protected)?\s*class\s+(\w+)/) : line.match(/pub\s+struct\s+(\w+)/);
        if (classMatch) {
          const className = classMatch[1];
          const startLine = i + 1;
          const endLine = findClosingBraceLine(lines, i);
          localClasses.push({ name: className, lineRange: [startLine, endLine] });
        }

        // Method / Fn
        const fnMatch = lang === "java" ? line.match(/(?:public|private|protected|static|\s)\s+[\w<>[\]]+\s+(\w+)\s*\(/) : line.match(/pub\s+fn\s+(\w+)\s*\(/);
        if (fnMatch) {
          const fnName = fnMatch[1];
          // Skip if it's control structures
          if (!["if", "for", "while", "catch", "switch"].includes(fnName)) {
            const startLine = i + 1;
            const endLine = findClosingBraceLine(lines, i);
            localFunctions.push({ name: fnName, lineRange: [startLine, endLine] });
          }
        }
      }
    }

    // Add extracted classes as nodes & contains edges
    for (const cls of localClasses) {
      const classId = `class:${file.path}:${cls.name}`;
      nodes.push({
        id: classId,
        type: "class",
        name: cls.name,
        filePath: file.path,
        lineRange: cls.lineRange,
        summary: `Class: ${cls.name} defined in ${file.name}`,
        tags: [],
        complexity: "moderate",
      });

      edges.push({
        source: fileId,
        target: classId,
        type: "contains",
        direction: "forward",
        weight: 1,
      });
    }

    // Add extracted functions as nodes & contains edges
    for (const fn of localFunctions) {
      const fnId = `function:${file.path}:${fn.name}`;
      nodes.push({
        id: fnId,
        type: "function",
        name: fn.name,
        filePath: file.path,
        lineRange: fn.lineRange,
        summary: `Function: ${fn.name}() defined in ${file.name}`,
        tags: [],
        complexity: getComplexity(fn.lineRange[1] - fn.lineRange[0], 0),
      });

      edges.push({
        source: fileId,
        target: fnId,
        type: "contains",
        direction: "forward",
        weight: 1,
      });
    }

    // Update parent file node details
    fileNode.complexity = getComplexity(lines.length, localFunctions.length);
    fileNode.summary = `Source file (${lang}) containing ${localClasses.length} classes and ${localFunctions.length} functions.`;
    if (localClasses.length > 0) fileNode.tags.push("classes");
    if (localFunctions.length > 0) fileNode.tags.push("functions");

    // Scan for imports
    const fileDir = file.path.split("/").slice(0, -1).join("/");
    const importTargets: string[] = [];

    if (["typescript", "javascript", "tsx", "jsx"].includes(lang)) {
      for (const line of lines) {
        const impMatch = line.match(/from\s+['"]([^'"]+)['"]/) || line.match(/import\s+['"]([^'"]+)['"]/);
        if (impMatch) {
          importTargets.push(impMatch[1]);
        }
        const reqMatch = line.match(/require\s*\(\s*['"]([^'"]+)['"]\s*\)/);
        if (reqMatch) {
          importTargets.push(reqMatch[1]);
        }
      }
    } else if (lang === "python") {
      for (const line of lines) {
        const impMatch = line.match(/^import\s+(\w+)/) || line.match(/^from\s+([\w.]+)\s+import/);
        if (impMatch) {
          importTargets.push(impMatch[1].replace(/\./g, "/"));
        }
      }
    } else if (lang === "go") {
      let inImportBlock = false;
      for (const line of lines) {
        if (line.trim().startsWith("import (")) {
          inImportBlock = true;
          continue;
        }
        if (inImportBlock && line.trim().startsWith(")")) {
          inImportBlock = false;
          continue;
        }
        if (inImportBlock) {
          const pathMatch = line.match(/"([^"]+)"/);
          if (pathMatch) importTargets.push(pathMatch[1]);
        } else {
          const pathMatch = line.match(/import\s+"([^"]+)"/);
          if (pathMatch) importTargets.push(pathMatch[1]);
        }
      }
    }

    // Resolve imports and create edges
    for (const target of importTargets) {
      let resolvedPath = "";
      if (target.startsWith(".")) {
        // Relative import
        const segments = (fileDir ? fileDir + "/" : "") + target;
        // Normalize segments
        const parts = segments.split("/");
        const stack: string[] = [];
        for (const part of parts) {
          if (part === "." || part === "") continue;
          if (part === "..") {
            stack.pop();
          } else {
            stack.push(part);
          }
        }
        resolvedPath = stack.join("/");
      } else if (target.startsWith("@/")) {
        // Path alias
        resolvedPath = "src/" + target.slice(2);
      } else {
        // Package import, check if it matches a path in the project directly
        resolvedPath = target;
      }

      // Find if a file node matches the resolved path (with extension candidates)
      const candidates = [
        resolvedPath,
        resolvedPath + ".ts",
        resolvedPath + ".tsx",
        resolvedPath + ".js",
        resolvedPath + ".jsx",
        resolvedPath + ".go",
        resolvedPath + ".py",
        resolvedPath + "/index.ts",
        resolvedPath + "/index.tsx",
        resolvedPath + "/index.js",
      ];

      for (const cand of candidates) {
        const targetId = `file:${cand}`;
        const targetNode = nodes.find((n) => n.id === targetId);
        if (targetNode) {
          // Add import edge
          edges.push({
            source: fileId,
            target: targetId,
            type: "imports",
            direction: "forward",
            weight: 0.7,
          });
          break;
        }
      }
    }
  }

  // Create logical architectural layers based on folder structure
  const layers: Layer[] = [];
  const folderGroups = new Map<string, string[]>(); // folderName -> list of node IDs

  for (const node of nodes) {
    if (node.type !== "file" && node.type !== "config" && node.type !== "document") continue;
    const path = node.id.replace("file:", "").replace("config:", "").replace("document:", "");
    const parts = path.split("/");
    const topFolder = parts.length > 1 ? parts[0] : "root";
    
    if (!folderGroups.has(topFolder)) {
      folderGroups.set(topFolder, []);
    }
    folderGroups.get(topFolder)!.push(node.id);
  }

  for (const [folder, nodeIds] of folderGroups.entries()) {
    const formattedName = folder === "root" ? "General Configuration & Docs" : folder.charAt(0).toUpperCase() + folder.slice(1);
    layers.push({
      id: `layer:${folder}`,
      name: formattedName,
      description: folder === "root"
        ? "General setup files, documentation, and config folders at the root."
        : `Core system modules located in the /${folder} directory.`,
      nodeIds,
    });
  }

  // ==========================================
  // Build Guided Tour (Highly Detailed, Analyses Whole Code)
  // ====  // ==========================================
  // Build Guided Tour (Highly Detailed, Analyses Whole Code)
  // ==========================================

  // Helper to parse sections or extract paragraphs
  const parseReadme = (content: string) => {
    const sections = {
      intro: "",
      problem: "",
      usefulness: "",
      methodology: "",
      architecture: "",
      techStack: "",
    };

    if (!content) return sections;

    const headingRegex = /^(#{1,6})\s+(.+)$/;
    const lines = content.split(/\r?\n/);
    
    // We will collect sections as { heading: string, level: number, text: string }
    const readmeSections: { heading: string; level: number; text: string[] }[] = [];
    let currentSection: { heading: string; level: number; text: string[] } | null = null;

    for (const line of lines) {
      const match = line.match(headingRegex);
      if (match) {
        if (currentSection) {
          readmeSections.push(currentSection);
        }
        currentSection = {
          heading: match[2].trim(),
          level: match[1].length,
          text: []
        };
      } else {
        if (currentSection) {
          currentSection.text.push(line);
        } else {
          // Content before first heading
          currentSection = {
            heading: "Introduction",
            level: 1,
            text: [line]
          };
        }
      }
    }
    if (currentSection) {
      readmeSections.push(currentSection);
    }

    // Scan headings to match sections
    for (const sec of readmeSections) {
      const headingLower = sec.heading.toLowerCase();
      const textJoined = sec.text.join("\n").trim();
      if (!textJoined) continue;

      if (headingLower.includes("intro") || headingLower.includes("about") || headingLower.includes("purpose") || headingLower.includes("what is") || headingLower.includes("overview")) {
        sections.intro = (sections.intro ? sections.intro + "\n\n" : "") + textJoined;
      } else if (headingLower.includes("problem") || headingLower.includes("motivation") || headingLower.includes("why") || headingLower.includes("challenge")) {
        sections.problem = (sections.problem ? sections.problem + "\n\n" : "") + textJoined;
      } else if (headingLower.includes("feature") || headingLower.includes("benefit") || headingLower.includes("usefulness") || headingLower.includes("why use") || headingLower.includes("value")) {
        sections.usefulness = (sections.usefulness ? sections.usefulness + "\n\n" : "") + textJoined;
      } else if (headingLower.includes("method") || headingLower.includes("how it works") || headingLower.includes("workflow") || headingLower.includes("flow") || headingLower.includes("execution")) {
        sections.methodology = (sections.methodology ? sections.methodology + "\n\n" : "") + textJoined;
      } else if (headingLower.includes("architecture") || headingLower.includes("structure") || headingLower.includes("design") || headingLower.includes("folder") || headingLower.includes("directory")) {
        sections.architecture = (sections.architecture ? sections.architecture + "\n\n" : "") + textJoined;
      } else if (headingLower.includes("stack") || headingLower.includes("tech") || headingLower.includes("language") || headingLower.includes("tool") || headingLower.includes("depend")) {
        sections.techStack = (sections.techStack ? sections.techStack + "\n\n" : "") + textJoined;
      }
    }

    // Fallback for intro: first 2 paragraphs
    if (!sections.intro) {
      const paragraphs = content
        .split(/\r?\n\r?\n/)
        .map(p => p.trim())
        .filter(p => p && !p.startsWith("#") && !p.startsWith("!"))
        .slice(0, 2);
      sections.intro = paragraphs.join("\n\n");
    }

    return sections;
  };

  // Helper to get imports and contains info for code explanation
  const getFileDetails = (fileId: string) => {
    const childNodes = edges
      .filter((e) => e.source === fileId && e.type === "contains")
      .map((e) => nodes.find((n) => n.id === e.target))
      .filter((n): n is GraphNode => n !== undefined);

    const classes = childNodes.filter((n) => n.type === "class").map((n) => n.name);
    const functions = childNodes.filter((n) => n.type === "function").map((n) => `${n.name}()`);

    const fileImports = edges
      .filter((e) => e.source === fileId && e.type === "imports")
      .map((e) => nodes.find((n) => n.id === e.target)?.name)
      .filter((name): name is string => !!name);

    const fileDependents = edges
      .filter((e) => e.target === fileId && e.type === "imports")
      .map((e) => nodes.find((n) => n.id === e.source)?.name)
      .filter((name): name is string => !!name);

    return { classes, functions, fileImports, fileDependents };
  };

  const fileNodes = nodes.filter((n) => n.type === "file");
  let entryNode = fileNodes.find(
    (n) => n.name.startsWith("index") || n.name.startsWith("main") || n.name.startsWith("app") || n.name.startsWith("App")
  );
  if (!entryNode && fileNodes.length > 0) {
    entryNode = fileNodes[0];
  }

  // Find other helper info
  const folderCounts: Record<string, number> = {};
  const fileExtCounts: Record<string, number> = {};
  let parsedPackageJson: { name?: string; description?: string; dependencies?: Record<string, string> } | null = null;

  for (const file of cleanFiles) {
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    fileExtCounts[ext] = (fileExtCounts[ext] || 0) + 1;

    const parts = file.path.split("/");
    const topFolder = parts.length > 1 ? parts[0] : "root";
    folderCounts[topFolder] = (folderCounts[topFolder] || 0) + 1;

    if (file.path.endsWith("package.json")) {
      try {
        parsedPackageJson = JSON.parse(file.content);
      } catch (_e) {
        // Ignore JSON parse error
      }
    }
  }

  const hasDocker = cleanFiles.some(f => f.name.toLowerCase().includes("dockerfile"));
  const hasGitignore = cleanFiles.some(f => f.name === ".gitignore");
  const hasTsConfig = cleanFiles.some(f => f.name.includes("tsconfig"));
  const hasEslint = cleanFiles.some(f => f.name.includes("eslint") || f.name.includes("eslintrc"));

  // Check if README.md exists
  let readmeNode = nodes.find((n) => n.name.toLowerCase() === "readme.md" || n.name.toLowerCase() === "readme");
  let readmeContent = readmeNode?.filePath ? (uploadedFiles.get(readmeNode.filePath)?.content || "") : "";

  // If no README is present, automatically generate one!
  if (!readmeContent) {
    readmeContent = generateReadme(
      projectName,
      cleanFiles,
      languages,
      frameworks,
      folderCounts,
      parsedPackageJson,
      entryNode,
      layers,
      nodes,
      edges,
      hasTsConfig,
      hasEslint,
      hasGitignore,
      hasDocker
    );

    // Create the README node so it is part of the graph and document list
    const generatedReadmeNode: GraphNode = {
      id: "file:README.md",
      type: "document",
      name: "README.md",
      filePath: "README.md",
      summary: "Automatically generated README.md detailing project architecture and technology stack.",
      tags: ["generated", "md"],
      complexity: "simple",
    };
    nodes.push(generatedReadmeNode);
    readmeNode = generatedReadmeNode;

    // Cache it in the uploadedFiles Map
    uploadedFiles.set("README.md", {
      content: readmeContent,
      sizeBytes: readmeContent.length,
      lineCount: readmeContent.split(/\r?\n/).length,
    });
  }

  const parsedReadme = parseReadme(readmeContent);

  const tour: TourStep[] = [];
  let stepOrder = 1;

  // Helper to resolve node IDs dynamically by matching path fragments
  const findNodeByPath = (fragment: string): string | null => {
    const normalizedFrag = fragment.replace(/\\/g, "/");
    const found = nodes.find(n => 
      n.id === fragment || 
      n.id === `file:${fragment}` ||
      (n.filePath && n.filePath.replace(/\\/g, "/").endsWith(normalizedFrag)) ||
      n.name === fragment
    );
    return found ? found.id : null;
  };

  const getTargetId = (path: string, fallback: string) => findNodeByPath(path) || fallback;

  // Check if we are scanning "understand-anything"
  const isUnderstandAnything = 
    projectName.toLowerCase().includes("understand-anything") ||
    parsedPackageJson?.name === "understand-anything" ||
    cleanFiles.some(f => f.path.includes("understand-anything-plugin"));

  if (isUnderstandAnything) {
    const appId = getTargetId("packages/dashboard/src/App.tsx", "file:packages/dashboard/src/App.tsx");
    const typesId = getTargetId("packages/core/src/types.ts", "file:packages/core/src/types.ts");
    const schemaId = getTargetId("packages/core/src/schema.ts", "file:packages/core/src/schema.ts");
    const tourGenId = getTargetId("packages/core/src/analyzer/tour-generator.ts", "file:packages/core/src/analyzer/tour-generator.ts");
    const treeSitterId = getTargetId("packages/core/src/plugins/tree-sitter-plugin.ts", "file:packages/core/src/plugins/tree-sitter-plugin.ts");
    const llmAnalyzerId = getTargetId("packages/core/src/analyzer/llm-analyzer.ts", "file:packages/core/src/analyzer/llm-analyzer.ts");
    const persistenceId = getTargetId("packages/core/src/persistence/index.ts", "file:packages/core/src/persistence/index.ts");
    const storeId = getTargetId("packages/dashboard/src/store.ts", "file:packages/dashboard/src/store.ts");
    const graphViewId = getTargetId("packages/dashboard/src/components/GraphView.tsx", "file:packages/dashboard/src/components/GraphView.tsx");
    const learnPanelId = getTargetId("packages/dashboard/src/components/LearnPanel.tsx", "file:packages/dashboard/src/components/LearnPanel.tsx");
    const scannerId = getTargetId("packages/dashboard/src/utils/browserScanner.ts", "file:packages/dashboard/src/utils/browserScanner.ts");
    const overviewId = getTargetId("packages/dashboard/src/components/ProjectOverview.tsx", "file:packages/dashboard/src/components/ProjectOverview.tsx");
    const indexId = getTargetId("packages/core/src/index.ts", "file:packages/core/src/index.ts");
    const packageJsonId = getTargetId("packages/dashboard/package.json", "file:packages/dashboard/package.json");

    tour.push({
      order: stepOrder++,
      title: "1. Introduction",
      description: `Welcome to **Understand Anything**, an open-source codebase analysis tool and interactive dashboard that maps software repositories into navigable knowledge graphs of files, functions, classes, and dependencies.\n\nBy bridging deterministic static analysis (using \`web-tree-sitter\` AST parsing) and semantic analysis (using LLM-driven summaries, layer detectors, and guided tours), it helps developers quickly onboard and comprehend large, unfamiliar codebases. The entry point of the interactive UI dashboard is [App.tsx](${appId}), which coordinates all panels, graph layouts, and state management.`,
      nodeIds: [appId],
    });

    tour.push({
      order: stepOrder++,
      title: "2. What is this project for?",
      description: `This project is built for software engineers, tech leads, and product managers who need to explore and comprehend complex software architectures.\n\nIt acts as an interactive documentation and analysis suite to:\n1. **Accelerate Developer Onboarding**: Allowing new hires to visually walk through files without reading code blind.\n2. **Perform Impact Analysis**: Enabling developers to trace code ripple effects using git diff overlays.\n3. **Keep Documentation Fresh**: Auto-generating READMEs and system flows from source files.\n\nThe [ProjectOverview.tsx](${overviewId}) component manages the rendering of codebase metadata, stats, and the markdown downloader.`,
      nodeIds: [overviewId],
    });

    tour.push({
      order: stepOrder++,
      title: "3. Why is this project useful?",
      description: `Understand Anything addresses the friction of codebase exploration by providing:\n- **Interactive Visual Mapping**: Renders files as nodes in [GraphView.tsx](${graphViewId}) using React Flow and Dagre layout calculations.\n- **Topologically Sorted Tours**: Organizes learning walks using Kahn's algorithm via [tour-generator.ts](${tourGenId}) to guide newcomers in dependency-respecting order.\n- **Impact Visualizations**: Highlights system nodes impacted by git changes before commits.\n- **Interactive Chat Contexts**: Empowers developers to ask questions and receive answers built on graph-expanded file contexts.`,
      nodeIds: [tourGenId],
    });

    tour.push({
      order: stepOrder++,
      title: "4. Problem Statement",
      description: `As software repositories grow, they suffer from architectural opacity and documentation decay.\n\nTraditional text editors do not show directory boundaries or dependencies clearly, making it easy to introduce circular imports or unintended ripple effects. New developers take days to understand where critical execution paths begin, and manually written documentation goes out of date with every commit.\n\nUnderstand Anything solves this by combining parser intelligence with LLM context to construct a living, self-healing knowledge graph defined by the system's core interfaces in [types.ts](${typesId}).`,
      nodeIds: [typesId],
    });

    tour.push({
      order: stepOrder++,
      title: "5. Methodology & Execution Flow",
      description: `The system operates in a structured pipeline to scan and build code maps:\n1. **Project Scanning**: The parser scanner (e.g. [browserScanner.ts](${scannerId})) recursively discovers files and identifies languages.\n2. **Deterministic AST Parsing**: The analyzer runs [tree-sitter-plugin.ts](${treeSitterId}) to extract class/function declarations and import statements.\n3. **Semantic Augmentation**: The LLM engine ([llm-analyzer.ts](${llmAnalyzerId})) writes concise summaries and tags for each code node.\n4. **Layer Mapping & Kahn Sorting**: The pipeline groups nodes into architectural layers and generates step-by-step guides.\n5. **State Initialization**: The dashboard loads the validated JSON into the Zustand store ([store.ts](${storeId})) to render the interactive UI.`,
      nodeIds: [scannerId],
    });

    tour.push({
      order: stepOrder++,
      title: "6. Technology Stack",
      description: `The codebase is structured as a pnpm monorepo containing:\n- **Core Engine Dependencies**: Powered by **TypeScript**, **web-tree-sitter** WASM grammars, **zod** runtime schema validation ([schema.ts](${schemaId})), and **fuse.js** for client-side fuzzy search.\n- **Dashboard UI Stack**: Configured in [package.json](${packageJsonId}), built on **React 19**, **Vite**, **Tailwind CSS v4**, **Zustand** for state, and **@xyflow/react** (React Flow) for graph visual rendering.\n- **Layout and Graph Algorithms**: Incorporates **Dagre** for tree alignments, **Graphology** for network utilities, and **Louvain community detection** for clustering nodes in knowledge-base mode.`,
      nodeIds: [packageJsonId],
    });

    tour.push({
      order: stepOrder++,
      title: "7. System Architecture",
      description: `The codebase uses a clean separation of concerns across packages:\n- **Root Project**: Contains environment configurations, ESLint settings, and multi-platform installation handlers (\`install.sh\`, \`install.ps1\`).\n- **@understand-anything/core**: The analytical engine exposed by [index.ts](${indexId}). It encapsulates AST parsers, LLM analyzers, Staleness/Git detectors, and the [persistence](${persistenceId}) layer.\n- **@understand-anything/dashboard**: The single-page React app (built on [App.tsx](${appId})) housing the graph visualization and UI workspace panels.\n- **CLI Plugin Registry**: Symlinks commands (like \`/understand\`, \`/understand-chat\`) to IDE workflows (Cursor, VS Code, Claude Code).`,
      nodeIds: [indexId],
    });

    tour.push({
      order: stepOrder++,
      title: "8. Dependency Mapping",
      description: `The project modules follow a strict hierarchical dependency graph:\n- **UI Components** (like [LearnPanel.tsx](${learnPanelId})) import the **Zustand store** ([store.ts](${storeId})) to select nodes and drive tour step changes.\n- The **Zustand store** acts as a central coordinator, importing [browserScanner.ts](${scannerId}) to trigger dynamic, client-side repository analysis.\n- [browserScanner.ts](${scannerId}) calls the **core package** types ([types.ts](${typesId})) and schema validator ([schema.ts](${schemaId})) to construct a valid graph payload.\n- The **CLI plugin skills** import the **core library**'s APIs to run git-diff overlays, generate onboarding guides, and serialize the graph to disk using the persistence module ([persistence/index.ts](${persistenceId})).`,
      nodeIds: [storeId],
    });
  } else {
    // Step 1: Introduction (Fallback)
    const introHighlightId = readmeNode ? readmeNode.id : (entryNode ? entryNode.id : "");
    let introDesc = `### Introduction to **${projectName}**\n\n`;
    if (parsedReadme.intro) {
      introDesc += `${parsedReadme.intro}\n\n`;
    } else if (parsedPackageJson?.description) {
      introDesc += `${parsedPackageJson.description}\n\n`;
    } else {
      introDesc += `Welcome to **${projectName}**! This repository has been uploaded and analyzed dynamically. It contains **${cleanFiles.length}** code files, organizing layers, classes, and dependency relationships into an interactive visual graph.\n\n`;
    }

    introDesc += `#### Codebase Breakdown:\n`;
    introDesc += `- **Languages**: ${Array.from(languages).map(l => `\`${l}\``).join(", ") || "`TypeScript` / `JavaScript`"}\n`;
    introDesc += `- **Active Folders**: ${Object.keys(folderCounts).map(f => `\`/${f}\` (${folderCounts[f]} files)`).join(", ")}\n`;
    if (entryNode) {
      introDesc += `- **Core Execution Portal**: Starts at \`[${entryNode.name}](${entryNode.id})\`.\n`;
    }

    tour.push({
      order: stepOrder++,
      title: "1. Introduction",
      description: introDesc,
      nodeIds: introHighlightId ? [introHighlightId] : [],
    });

    // Step 2: What is this project for?
    const purposeHighlightId = entryNode ? entryNode.id : (readmeNode ? readmeNode.id : "");
    let purposeDesc = `### What is this project for?\n\n`;
    
    if (parsedReadme.intro && parsedReadme.intro.toLowerCase().includes("for") && parsedReadme.intro.length > 200) {
      purposeDesc += `${parsedReadme.intro}\n\n`;
    } else {
      purposeDesc += `This project provides a functional execution space or suite that compiles and runs software structures.\n\n`;
    }

    purposeDesc += `#### Inferred Purpose & Capabilities:\n`;
    if (frameworks.has("React") || frameworks.has("Next.js") || frameworks.has("Astro") || frameworks.has("Vue")) {
      purposeDesc += `- **Client Frontend Rendering**: Serves as a dynamic user interface web application, displaying views, reacting to user controls, and syncing local state.\n`;
    }
    if (frameworks.has("Express") || cleanFiles.some(f => f.path.includes("server") || f.path.includes("api") || f.path.includes("routes"))) {
      purposeDesc += `- **Backend Routing & APIs**: Manages HTTP request routing, middleware controls, and serving JSON payloads to clients.\n`;
    }
    if (cleanFiles.some(f => f.path.includes("utils") || f.path.includes("helper") || f.path.includes("core"))) {
      purposeDesc += `- **Analytical Logic & Utilities**: Houses processing algorithms, directory parsers, mathematical helpers, or schema validations.\n`;
    }
    if (cleanFiles.some(f => f.path.includes("test") || f.path.includes("spec") || f.name.includes("test") || f.name.includes("spec"))) {
      purposeDesc += `- **Automated Testing Suite**: Evaluates and asserts the correctness of functions, ensuring logical consistency and regression prevention.\n`;
    }

    purposeDesc += `\nBy reviewing the folder layout and files, we can target the main business goals such as user interface visualization, data scanning, or configuration mapping.`;

    tour.push({
      order: stepOrder++,
      title: "2. What is this project for?",
      description: purposeDesc,
      nodeIds: purposeHighlightId ? [purposeHighlightId] : [],
    });

    // Step 3: Why is this project useful?
    let usefulnessDesc = `### Why is this project useful?\n\n`;
    if (parsedReadme.usefulness) {
      usefulnessDesc += `${parsedReadme.usefulness}\n\n`;
    } else {
      usefulnessDesc += `This project is highly useful for developers because of its structured setup, modular organization, and modern technology choices:\n\n`;
    }

    usefulnessDesc += `#### Core Value Propositions:\n`;
    if (languages.has("typescript")) {
      usefulnessDesc += `- **Type Safety & Intellisense**: Leveraging TypeScript prevents compiler mistakes and provides rich, autocomplete developer experiences.\n`;
    }
    if (frameworks.has("React")) {
      usefulnessDesc += `- **Reusability & Speed**: React components allow modular building, updating only changed states instead of standard document refreshing.\n`;
    }
    if (cleanFiles.some(f => f.name.includes("eslint") || f.name.includes("prettier"))) {
      usefulnessDesc += `- **Uniform Styling**: Integrates linter and formatting definitions to ensure uniform styling guidelines across contributors.\n`;
    }
    if (cleanFiles.some(f => f.name.includes("vitest") || f.name.includes("jest") || f.name.includes("test"))) {
      usefulnessDesc += `- **Quality Assurance**: Automated testing scripts make refactoring safe and verify correctness immediately.\n`;
    }
    usefulnessDesc += `- **Visual Code Mapping**: Integrates with interactive layout graphing to visualizes paths, folders, and hubs dynamically in the dashboard.`;

    tour.push({
      order: stepOrder++,
      title: "3. Why is this project useful?",
      description: usefulnessDesc,
      nodeIds: readmeNode ? [readmeNode.id] : [],
    });

    // Step 4: Problem Statement
    let problemDesc = `### Problem Statement\n\n`;
    if (parsedReadme.problem) {
      problemDesc += `${parsedReadme.problem}\n\n`;
    } else {
      problemDesc += `Software repositories scale rapidly in complexity. As codebases grow:\n`;
      problemDesc += `- **Architectural Obscurity**: Standard text editors do not show directory splits or architectural layers clearly.\n`;
      problemDesc += `- **Dependency Entanglement**: It is easy to import modules incorrectly, creating circular references or spaghetti dependency links.\n`;
      problemDesc += `- **Developer Onboarding Drag**: New developers take days to find key entries, helper modules, and state stores.\n\n`;
      problemDesc += `This project addresses these challenges by organizing files into logical scopes, parsing imports to map connections, and providing interactive graphical visualizations.`;
    }

    tour.push({
      order: stepOrder++,
      title: "4. Problem Statement",
      description: problemDesc,
      nodeIds: entryNode ? [entryNode.id] : [],
    });

    // Step 5: Methodology & Flow
    const flowHighlightNode = fileNodes.find(n => n.name.includes("scanner") || n.name.includes("parser") || n.name.includes("store") || n.name.includes("state") || n.name.includes("helper") || n.name.includes("utils")) || entryNode;
    const flowDetails = flowHighlightNode ? getFileDetails(flowHighlightNode.id) : null;
    
    let methodologyDesc = `### Methodology & Execution Flow\n\n`;
    if (parsedReadme.methodology) {
      methodologyDesc += `${parsedReadme.methodology}\n\n`;
    } else {
      methodologyDesc += `The system operates in a structured, sequential workflow to analyze files and run logic:\n\n`;
      methodologyDesc += `1. **Bootstrapping**: Starts execution from the main file \`[${entryNode?.name || "Entry"}](${entryNode?.id || ""})\`.\n`;
      methodologyDesc += `2. **Configuration Reading**: Evaluates manifest controls (such as \`package.json\` or compiler settings) to configure environment dependencies.\n`;
      methodologyDesc += `3. **Directory Scanning**: Recursively scans files in folders (like \`${Object.keys(folderCounts).map(f => `/${f}`).slice(0, 3).join(", ") || "/src"}\`), ignoring temporary node or bundle folders.\n`;
      methodologyDesc += `4. **Syntax Processing**: Parses code strings to extract import statements, exports, classes, and function declarations.\n`;
      methodologyDesc += `5. **State Coordination**: Updates the state variables or triggers visual updates.\n`;
      methodologyDesc += `6. **Output Rendering**: Returns structured outputs or renders layouts.\n\n`;
    }

    if (flowHighlightNode) {
      methodologyDesc += `#### Execution Handler Spotlight:\n`;
      methodologyDesc += `The module \`[${flowHighlightNode.name}](${flowHighlightNode.id})\` serves as a core coordinator in this flow.\n`;
      if (flowDetails && (flowDetails.classes.length > 0 || flowDetails.functions.length > 0)) {
        methodologyDesc += `- **Declared Objects**: ${[
          ...flowDetails.classes.map(c => `class \`${c}\``),
          ...flowDetails.functions.map(f => `\`${f}\``)
        ].slice(0, 4).join(", ")}.\n`;
      }
    }

    tour.push({
      order: stepOrder++,
      title: "5. Methodology & Execution Flow",
      description: methodologyDesc,
      nodeIds: flowHighlightNode ? [flowHighlightNode.id] : [],
    });

    // Step 6: Tech Stack Details
    const configNode = nodes.find((n) => n.type === "config");
    let techStackDesc = `### Technology Stack\n\n`;
    if (parsedReadme.techStack) {
      techStackDesc += `${parsedReadme.techStack}\n\n`;
    }

    techStackDesc += `Below is the tech stack analyzed dynamically from package files:\n\n`;
    techStackDesc += `| Category | Tools & Libraries | Purpose |\n`;
    techStackDesc += `| :--- | :--- | :--- |\n`;
    techStackDesc += `| **Languages** | ${Array.from(languages).map(l => `\`${l}\``).join(", ") || "`TypeScript` / `JavaScript`"} | Main application languages |\n`;
    
    if (frameworks.size > 0) {
      techStackDesc += `| **Frameworks** | ${Array.from(frameworks).map(f => `\`${f}\``).join(", ")} | Core architectural engine |\n`;
    }

    if (parsedPackageJson) {
      const allDeps = { ...parsedPackageJson.dependencies };
      const depNames = Object.keys(allDeps);
      if (depNames.length > 0) {
        const displayDeps = depNames.slice(0, 8).map(name => `\`${name}\` (v${allDeps[name]})`).join("<br/>");
        techStackDesc += `| **Key Packages** | ${displayDeps} | Direct runtime dependencies |\n`;
      }
    }

    const toolings: string[] = [];
    if (hasTsConfig) toolings.push("TypeScript (`tsconfig.json`)");
    if (hasEslint) toolings.push("ESLint config");
    if (hasGitignore) toolings.push("Git control (`.gitignore`)");
    if (hasDocker) toolings.push("Docker containerization");
    if (toolings.length > 0) {
      techStackDesc += `| **Tooling & Config** | ${toolings.join("<br/>")} | Environment compiler & guidelines |\n`;
    }

    tour.push({
      order: stepOrder++,
      title: "6. Technology Stack",
      description: techStackDesc,
      nodeIds: configNode ? [configNode.id] : [],
    });

    // Step 7: System Architecture
    let archDesc = `### System Architecture & Layering\n\n`;
    if (parsedReadme.architecture) {
      archDesc += `${parsedReadme.architecture}\n\n`;
    } else {
      archDesc += `The codebase is organized into modular layers according to directory scopes:\n\n`;
    }

    archDesc += `\`\`\`bash\n`;
    archDesc += `${projectName}/\n`;
    for (const folder of Object.keys(folderCounts)) {
      if (folder === "root") continue;
      archDesc += `├── ${folder}/\n`;
    }
    archDesc += `└── (Configuration manifests at root)\n`;
    archDesc += `\`\`\`\n\n`;

    archDesc += `#### Codebase Layer Breakdowns:\n`;
    for (const layer of layers) {
      archDesc += `- **${layer.name}**: ${layer.description} (Houses **${layer.nodeIds.length}** code elements)\n`;
      const samples = layer.nodeIds.slice(0, 3).map(id => {
        const node = nodes.find(n => n.id === id);
        return node ? `\`[${node.name}](${node.id})\`` : "";
      }).filter(Boolean);
      if (samples.length > 0) {
        archDesc += `  - *Key Files*: ${samples.join(", ")}\n`;
      }
    }

    const layerHighlightIds = layers.map(l => l.nodeIds[0]).filter(Boolean).slice(0, 3);

    tour.push({
      order: stepOrder++,
      title: "7. System Architecture",
      description: archDesc,
      nodeIds: layerHighlightIds,
    });

    // Step 8: Dependency Mapping
    const connectedNodes: {
      id: string;
      name: string;
      score: number;
      details: ReturnType<typeof getFileDetails>;
    }[] = [];
    for (const f of fileNodes) {
      const details = getFileDetails(f.id);
      const score = details.fileImports.length + details.fileDependents.length;
      if (score > 0) {
        connectedNodes.push({ id: f.id, name: f.name, score, details });
      }
    }
    connectedNodes.sort((a, b) => b.score - a.score);
    const topHubs = connectedNodes.slice(0, 3);

    let connectionsDesc = `### Dependency Mapping (Which is connected to what?)\n\n`;
    connectionsDesc += `Codebase relationships are modeled by imports (dependency directions) and file containments (classes and functions):\n\n`;

    if (topHubs.length > 0) {
      connectionsDesc += `#### Core Module Hubs (High Connectivity):\n`;
      for (const hub of topHubs) {
        connectionsDesc += `- **[${hub.name}](${hub.id})**: High-traffic hub (connectivity score: **${hub.score}**).\n`;
        if (hub.details.fileImports.length > 0) {
          connectionsDesc += `  - **Imports**: ${hub.details.fileImports.map((i: string) => `\`${i}\``).slice(0, 3).join(", ")}\n`;
        }
        if (hub.details.fileDependents.length > 0) {
          connectionsDesc += `  - **Imported By**: ${hub.details.fileDependents.map((d: string) => `\`${d}\``).slice(0, 3).join(", ")}\n`;
        }
        if (hub.details.classes.length > 0 || hub.details.functions.length > 0) {
          connectionsDesc += `  - **Inner Structures**: ${[
            ...hub.details.classes.map((c: string) => `class \`${c}\``),
            ...hub.details.functions.map((f: string) => `\`${f}\``)
          ].slice(0, 3).join(", ")}\n`;
        }
      }
    }

    const sampleImportEdges = edges.filter(e => e.type === "imports").slice(0, 5);
    if (sampleImportEdges.length > 0) {
      connectionsDesc += `\n#### Selected Module Dependency Paths:\n`;
      for (const edge of sampleImportEdges) {
        const srcNode = nodes.find(n => n.id === edge.source);
        const tgtNode = nodes.find(n => n.id === edge.target);
        if (srcNode && tgtNode) {
          connectionsDesc += `- \`[${srcNode.name}](${srcNode.id})\` calls/imports \`[${tgtNode.name}](${tgtNode.id})\`\n`;
        }
      }
    }

    tour.push({
      order: stepOrder++,
      title: "8. Dependency Mapping",
      description: connectionsDesc,
      nodeIds: topHubs.map(h => h.id),
    });
  }

  const structuralGraph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: projectName,
      languages: Array.from(languages),
      frameworks: Array.from(frameworks),
      description: `Automatically analyzed codebase containing ${validFiles.length} files.`,
      analyzedAt: new Date().toISOString(),
      gitCommitHash: "local-upload",
    },
    nodes,
    edges,
    layers,
    tour,
  };

  // Build Domain Graph
  // Domain nodes represent the major top-level folders / logical groups.
  // Each folder behaves as a domain node. Let's link domains if there are imports between their files.
  const domainNodes: GraphNode[] = [];
  const domainEdges: GraphEdge[] = [];
  
  for (const [folder, ids] of folderGroups.entries()) {
    const formattedName = folder === "root" ? "Configuration" : folder.charAt(0).toUpperCase() + folder.slice(1);
    domainNodes.push({
      id: `domain:${folder}`,
      type: "domain",
      name: formattedName,
      summary: `Logical domain managing the ${folder === "root" ? "configuration and docs" : folder + " modules"}. Contains ${ids.length} nodes.`,
      tags: [folder],
      complexity: ids.length > 10 ? "complex" : ids.length > 3 ? "moderate" : "simple",
    });
  }

  // Find cross-domain edges
  const domainEdgeKeys = new Set<string>();
  for (const edge of edges) {
    if (edge.type === "imports") {
      const srcFile = edge.source.replace("file:", "");
      const tgtFile = edge.target.replace("file:", "");
      
      const srcFolder = srcFile.split("/").length > 1 ? srcFile.split("/")[0] : "root";
      const tgtFolder = tgtFile.split("/").length > 1 ? tgtFile.split("/")[0] : "root";

      if (srcFolder !== tgtFolder) {
        const edgeKey = `${srcFolder}->${tgtFolder}`;
        if (!domainEdgeKeys.has(edgeKey)) {
          domainEdgeKeys.add(edgeKey);
          domainEdges.push({
            source: `domain:${srcFolder}`,
            target: `domain:${tgtFolder}`,
            type: "cross_domain",
            direction: "forward",
            weight: 0.8,
          });
        }
      }
    }
  }

  const domainGraph: KnowledgeGraph = {
    version: "1.0.0",
    project: {
      name: projectName,
      languages: Array.from(languages),
      frameworks: Array.from(frameworks),
      description: `Domain conceptual map for ${projectName}`,
      analyzedAt: new Date().toISOString(),
      gitCommitHash: "local-upload",
    },
    nodes: domainNodes,
    edges: domainEdges,
    layers: [],
    tour: [],
  };

  return {
    graph: structuralGraph,
    domainGraph,
    uploadedFiles,
  };
}
