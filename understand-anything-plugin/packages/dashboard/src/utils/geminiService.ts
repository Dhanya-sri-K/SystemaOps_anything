import { useDashboardStore } from "../store";
import { TourStep } from "@understand-anything/core/types";

export interface ChatMessage {
  role: "user" | "model";
  parts: string;
}

// Statically collect all source files of the dashboard plugin on build
const localFilesRaw = import.meta.glob<string>(
  [
    "../**/*.{ts,tsx,css}",
    "../../package.json",
    "../../vite.config.ts",
    "../../../../../README.md"
  ],
  {
    query: "?raw",
    import: "default",
    eager: true
  }
) as Record<string, string>;

/**
 * Collects and maps local codebase files into an array of { path, content } objects.
 */
export function getLocalCodebaseFiles(): { path: string; content: string }[] {
  const files: { path: string; content: string }[] = [];
  for (const [key, content] of Object.entries(localFilesRaw)) {
    // Clean up path names for presentation to the LLM
    const cleanPath = key
      .replace(/^\.\.\/\.\.\/\.\.\/\.\.\/\.\.\//, "") // monorepo root
      .replace(/^\.\.\/\.\.\/\.\.\/\.\.\//, "")
      .replace(/^\.\.\/\.\.\//, "")
      .replace(/^\.\.\//, "src/");
    
    // Ignore build output, dependencies, or map files
    if (
      cleanPath.includes("node_modules/") ||
      cleanPath.includes("dist/") ||
      cleanPath.includes(".git/") ||
      cleanPath.endsWith(".map")
    ) {
      continue;
    }
    
    files.push({
      path: cleanPath,
      content: content as string
    });
  }
  return files;
}

/**
 * Gets the active codebase files.
 * If the user has uploaded/analyzed a project (local folder or GitHub repo), use that.
 * Otherwise, fall back to the statically-collected dashboard source files.
 */
export function getActiveCodebaseFiles(): { path: string; content: string }[] {
  const state = useDashboardStore.getState();
  if (state.uploadedFiles && state.uploadedFiles.size > 0) {
    return Array.from(state.uploadedFiles.entries()).map(([path, data]) => ({
      path,
      content: data.content
    }));
  }
  return getLocalCodebaseFiles();
}

/**
 * Prioritizes and trims the codebase files to stay well within token limits (under 30,000 tokens).
 */
export function optimizeCodebaseContext(
  files: { path: string; content: string }[],
  maxCharacters = 120000
): { path: string; content: string }[] {
  const scoredFiles = files.map(file => {
    const pathLower = file.path.toLowerCase();
    let priority = 3; // default

    if (
      pathLower.endsWith("package.json") ||
      pathLower.endsWith("requirements.txt") ||
      pathLower.includes("readme")
    ) {
      priority = 1; // Highest importance
    } else if (
      pathLower.includes("vite.config") ||
      pathLower.includes("tsconfig") ||
      pathLower.includes("app.tsx") ||
      pathLower.includes("store.ts") ||
      pathLower.includes("geminiservice")
    ) {
      priority = 2; // Core configuration/routing/state
    } else if (
      pathLower.endsWith(".css") ||
      pathLower.endsWith(".svg") ||
      pathLower.includes("theme") ||
      pathLower.includes("legend") ||
      pathLower.includes("styles")
    ) {
      priority = 4; // Lowest importance (styling)
    }

    return { file, priority };
  });

  // Sort by priority (1 is highest) and then by content size (smaller first, to fit more configs)
  scoredFiles.sort((a, b) => {
    if (a.priority !== b.priority) return a.priority - b.priority;
    return a.file.content.length - b.file.content.length;
  });

  const optimized: { path: string; content: string }[] = [];
  let totalLength = 0;

  for (const item of scoredFiles) {
    if (totalLength + item.file.content.length > maxCharacters) {
      const remainingSpace = maxCharacters - totalLength;
      if (remainingSpace > 1000 && item.priority <= 2) {
        optimized.push({
          path: item.file.path,
          content: item.file.content.slice(0, remainingSpace) + "\n\n[Content truncated due to size limits...]"
        });
      }
      break;
    }
    optimized.push(item.file);
    totalLength += item.file.content.length;
  }

  return optimized;
}

/**
 * Calls OpenRouter API to analyze the active codebase and generate 10 detailed tour steps.
 */
export async function generateProjectTour(
  codebaseFiles: { path: string; content: string }[]
): Promise<TourStep[]> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is not configured. Please define VITE_OPENROUTER_API_KEY in your .env file."
    );
  }

  // Optimize files to avoid token limits
  const optimizedFiles = optimizeCodebaseContext(codebaseFiles, 80000);

  const prompt = `
You are a senior software architect. Analyze the following codebase files and generate a detailed 10-step guided tour of this project.

Each of the 10 steps must be highly detailed. Each step MUST contain a "description" field with a minimum of 4-5 sentences (a full, rich paragraph in Markdown). Avoid one-liners or generic summaries. Refer to actual file paths, components, functions, or patterns found in the codebase.

The 10 steps you must generate are:
1. "Introduction" - Project name, what it actually does, clear summary.
2. "What is this project for?" - Real use case, who uses it, what problem it solves.
3. "Why is this project useful?" - Specific benefits from actual features in the code.
4. "Problem Statement" - The exact pain point this project addresses.
5. "Methodology & Execution Flow" - Real step-by-step flow of how the app works based on actual code logic.
6. "Technology Stack" - Every library, framework, tool from package.json and actual imports.
7. "System Architecture" - How folders, modules, layers are actually structured.
8. "Dependency Mapping" - Which modules/components depend on which, from actual imports.
9. "Key Features" - Every major feature found in the code with full explanation.
10. "API & Data Flow" - How data moves through the system based on actual API calls and state management.

Return your response as a JSON array of objects. Do not wrap in markdown backticks. The array must contain exactly 10 objects. Each object must have these exact properties:
{
  "order": number (0 to 9),
  "title": string (the exact step name from the list above),
  "description": string (the detailed 4-5 sentence Markdown explanation),
  "nodeIds": string[] (array of relative file paths from the codebase that are highly relevant to this step, e.g. ["packages/dashboard/src/App.tsx", "packages/dashboard/src/store.ts"]),
  "languageLesson": string (optional, an educational note about code patterns or language features used in this codebase)
}

Here are the codebase files:
${optimizedFiles.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n")}
`;

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "Understand Anything"
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: [
        { role: "user", content: prompt }
      ],
      max_tokens: 2000,
      response_format: { type: "json_object" }
    })
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || "Failed to generate project tour from OpenRouter.");
  }

  const responseText = data.choices?.[0]?.message?.content;
  if (!responseText) {
    throw new Error("Empty response from OpenRouter.");
  }

  try {
    const parsed = JSON.parse(responseText);
    if (Array.isArray(parsed)) {
      return parsed;
    }
    if (parsed.steps && Array.isArray(parsed.steps)) {
      return parsed.steps;
    }
    if (parsed.tour && Array.isArray(parsed.tour)) {
      return parsed.tour;
    }
    throw new Error("OpenRouter JSON response does not contain a valid tour steps array.");
  } catch (err) {
    console.error("Failed to parse OpenRouter response:", responseText, err);
    throw new Error("Failed to generate project tour from OpenRouter API.");
  }
}

/**
 * Queries the OpenRouter chatbot using the active codebase context and message history.
 */
export async function queryChatbot(
  codebaseFiles: { path: string; content: string }[],
  history: ChatMessage[],
  question: string
): Promise<string> {
  const apiKey = import.meta.env.VITE_OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OpenRouter API key is not configured. Please define VITE_OPENROUTER_API_KEY in your .env file."
    );
  }

  // Optimize files to avoid token limits (keep under free account limit)
  const optimizedFiles = optimizeCodebaseContext(codebaseFiles, 70000);

  const codebaseContext = `
You are an expert software developer and architect who has read the entire codebase for this project.
Your task is to answer the user's questions about the codebase accurately, using code snippets and references to files where appropriate.
Be friendly, professional, and clear.

Here is the codebase files context:
${optimizedFiles.map(f => `--- FILE: ${f.path} ---\n${f.content}`).join("\n\n")}
`;

  const formattedHistory = [
    {
      role: "system",
      content: codebaseContext
    },
    {
      role: "user",
      content: "First, acknowledge that you have read the codebase and are ready to help."
    },
    {
      role: "assistant",
      content: "Hello! I have read the entire codebase and am ready to answer any questions you have about its architecture, components, features, or data flow. Ask me anything!"
    },
    ...history.map(msg => ({
      role: msg.role === "model" ? "assistant" : "user",
      content: msg.parts
    }))
  ];

  formattedHistory.push({
    role: "user",
    content: question
  });

  const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "HTTP-Referer": "http://localhost:5173",
      "X-Title": "Understand Anything"
    },
    body: JSON.stringify({
      model: "google/gemini-2.5-flash",
      messages: formattedHistory,
      max_tokens: 2000
    })
  });

  const data = await res.json();
  if (data.error) {
    throw new Error(data.error.message || "Failed to query OpenRouter chatbot.");
  }

  const responseText = data.choices?.[0]?.message?.content;
  if (!responseText) {
    throw new Error("Empty response from OpenRouter chatbot.");
  }

  return responseText;
}
