#!/usr/bin/env -S deno run --no-lock --node-modules-dir=none --allow-read --allow-write

type Format = "svg" | "ascii";
type ColorMode = "none" | "auto" | "ansi16" | "ansi256" | "truecolor" | "html";

type BeautifulMermaidModule = {
  renderMermaidASCII(this: void, text: string, options?: Record<string, unknown>): string;
  renderMermaidSVG(this: void, text: string, options?: Record<string, unknown>): string;
  THEMES: Record<string, Record<string, string>>;
};

type RenderArgs = {
  format: Format;
  input?: string;
  output?: string;
  listThemes: boolean;
  theme?: string;
  colors: Record<string, string>;
  font?: string;
  transparent?: boolean;
  interactive?: boolean;
  padding?: number;
  nodeSpacing?: number;
  layerSpacing?: number;
  componentSpacing?: number;
  useAscii?: boolean;
  colorMode?: ColorMode;
  paddingX?: number;
  paddingY?: number;
  boxBorderPadding?: number;
};

const USAGE = `Render Mermaid diagrams with beautiful-mermaid.

Usage:
  scripts/render.ts [OPTIONS] [INPUT]
  scripts/render.ts --list-themes

INPUT may be a Mermaid file path or '-' for stdin. If INPUT is omitted, stdin is
read. Output is written to stdout unless --output is provided.

Options:
  -h, --help                     Show this help.
      --list-themes              List built-in beautiful-mermaid theme names.
  -f, --format svg|ascii         Output format (default: svg).
  -o, --output FILE              Write output to FILE instead of stdout.
      --theme NAME               Built-in theme from THEMES (mainly for SVG).
      --bg COLOR                 Background color or CSS variable.
      --fg COLOR                 Foreground color or CSS variable.
      --line COLOR               Edge/connector color.
      --accent COLOR             Arrow/highlight color.
      --muted COLOR              Secondary text/label color.
      --surface COLOR            Node fill tint.
      --border COLOR             Node/group stroke color.
      --font FAMILY              SVG font family (default: Inter).
      --transparent              SVG: omit background fill.
      --interactive              SVG: enable XY chart hover tooltips.
      --padding PX               SVG canvas padding.
      --node-spacing PX          SVG horizontal node spacing.
      --layer-spacing PX         SVG vertical layer spacing.
      --component-spacing PX     SVG disconnected-component spacing.
      --use-ascii                ASCII: use 7-bit +-| characters instead of Unicode.
      --color-mode MODE          ASCII color mode: none, auto, ansi16, ansi256,
                                 truecolor, or html.
      --padding-x N              ASCII horizontal spacing between nodes.
      --padding-y N              ASCII vertical spacing between nodes.
      --box-border-padding N     ASCII padding inside node boxes.

Examples:
  scripts/render.ts --format svg --theme tokyo-night input.mmd -o diagram.svg
  scripts/render.ts --format ascii --color-mode none input.mmd
  printf 'graph LR\\n  A --> B\\n' | scripts/render.ts --format ascii
`;

class UsageError extends Error {}

function readValue(argv: string[], index: number, flag: string): [string, number] {
  const next = argv[index + 1];
  if (next === undefined) {
    throw new UsageError(`${flag} requires a value`);
  }
  return [next, index + 1];
}

function parseNumber(value: string, flag: string): number {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new UsageError(`${flag} requires a numeric value; received ${JSON.stringify(value)}`);
  }
  return n;
}

function parseFormat(value: string): Format {
  if (value === "svg" || value === "ascii") return value;
  throw new UsageError(`--format must be "svg" or "ascii"; received ${JSON.stringify(value)}`);
}

function parseColorMode(value: string): ColorMode {
  if (["none", "auto", "ansi16", "ansi256", "truecolor", "html"].includes(value)) {
    return value as ColorMode;
  }
  throw new UsageError(
    `--color-mode must be one of none, auto, ansi16, ansi256, truecolor, html; received ${JSON.stringify(
      value,
    )}`,
  );
}

function parseArgs(argv: string[]): RenderArgs | "help" {
  const args: RenderArgs = {
    format: "svg",
    listThemes: false,
    colors: {},
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    switch (arg) {
      case "-h":
      case "--help":
        return "help";
      case "--list-themes":
        args.listThemes = true;
        break;
      case "-f":
      case "--format": {
        const [value, nextIndex] = readValue(argv, i, arg);
        args.format = parseFormat(value);
        i = nextIndex;
        break;
      }
      case "-o":
      case "--output": {
        const [value, nextIndex] = readValue(argv, i, arg);
        args.output = value;
        i = nextIndex;
        break;
      }
      case "--theme": {
        const [value, nextIndex] = readValue(argv, i, arg);
        args.theme = value;
        i = nextIndex;
        break;
      }
      case "--bg":
      case "--fg":
      case "--line":
      case "--accent":
      case "--muted":
      case "--surface":
      case "--border": {
        const [value, nextIndex] = readValue(argv, i, arg);
        args.colors[arg.slice(2)] = value;
        i = nextIndex;
        break;
      }
      case "--font": {
        const [value, nextIndex] = readValue(argv, i, arg);
        args.font = value;
        i = nextIndex;
        break;
      }
      case "--transparent":
        args.transparent = true;
        break;
      case "--interactive":
        args.interactive = true;
        break;
      case "--padding":
      case "--node-spacing":
      case "--layer-spacing":
      case "--component-spacing":
      case "--padding-x":
      case "--padding-y":
      case "--box-border-padding": {
        const [value, nextIndex] = readValue(argv, i, arg);
        const n = parseNumber(value, arg);
        if (arg === "--padding") args.padding = n;
        else if (arg === "--node-spacing") args.nodeSpacing = n;
        else if (arg === "--layer-spacing") args.layerSpacing = n;
        else if (arg === "--component-spacing") args.componentSpacing = n;
        else if (arg === "--padding-x") args.paddingX = n;
        else if (arg === "--padding-y") args.paddingY = n;
        else args.boxBorderPadding = n;
        i = nextIndex;
        break;
      }
      case "--use-ascii":
        args.useAscii = true;
        break;
      case "--color-mode": {
        const [value, nextIndex] = readValue(argv, i, arg);
        args.colorMode = parseColorMode(value);
        i = nextIndex;
        break;
      }
      default:
        if (arg !== "-" && arg.startsWith("-")) {
          throw new UsageError(`Unknown option: ${arg}`);
        }
        if (args.input !== undefined) {
          throw new UsageError(
            `Only one input path is supported; received both ${JSON.stringify(
              args.input,
            )} and ${JSON.stringify(arg)}`,
          );
        }
        args.input = arg;
    }
  }

  return args;
}

async function readStdin(): Promise<string> {
  const chunks: Uint8Array[] = [];
  for await (const chunk of Deno.stdin.readable) chunks.push(chunk);
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder().decode(merged);
}

async function readInput(path?: string): Promise<string> {
  if (path === undefined || path === "-") return await readStdin();
  return await Deno.readTextFile(path);
}

async function writeOutput(path: string | undefined, text: string): Promise<void> {
  if (!path || path === "-") {
    await Deno.stdout.write(new TextEncoder().encode(text));
    if (!text.endsWith("\n")) {
      await Deno.stdout.write(new TextEncoder().encode("\n"));
    }
    return;
  }

  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  if (slash > 0) await Deno.mkdir(path.slice(0, slash), { recursive: true });
  await Deno.writeTextFile(path, text);
}

function withDefined<T extends Record<string, unknown>>(obj: T): T {
  for (const key of Object.keys(obj)) {
    if (obj[key] === undefined) delete obj[key];
  }
  return obj;
}

function semicolonHint(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes("Invalid mermaid header") && message.includes(";")) {
    return "\nHint: beautiful-mermaid is more reliable with a standalone header line. Try changing `graph LR; A --> B` to `graph LR\\n  A --> B`.";
  }
  return "";
}

async function main(): Promise<void> {
  let parsed: RenderArgs | "help";
  try {
    parsed = parseArgs(Deno.args);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`Error: ${error.message}\n\n${USAGE}`);
      Deno.exit(2);
    }
    throw error;
  }

  if (parsed === "help") {
    console.log(USAGE);
    return;
  }

  const beautifulMermaidSpecifier = "npm:beautiful-mermaid@1.1.3";
  const mermaid = (await import(beautifulMermaidSpecifier)) as BeautifulMermaidModule;
  const { renderMermaidASCII, renderMermaidSVG, THEMES } = mermaid;

  if (parsed.listThemes) {
    console.log(Object.keys(THEMES).sort().join("\n"));
    return;
  }

  let theme: Record<string, string> = {};
  if (parsed.theme) {
    const selected = THEMES[parsed.theme];
    if (!selected) {
      console.error(`Unknown theme: ${parsed.theme}`);
      console.error(`Available themes:\n${Object.keys(THEMES).sort().join("\n")}`);
      Deno.exit(2);
    }
    theme = selected;
  }

  const source = (await readInput(parsed.input)).trim();
  if (!source) {
    console.error("No Mermaid source provided. Pass an input file or pipe source on stdin.");
    Deno.exit(2);
  }

  try {
    const colorOptions = { ...theme, ...parsed.colors };
    let rendered: string;

    if (parsed.format === "svg") {
      const options = withDefined({
        ...colorOptions,
        font: parsed.font,
        transparent: parsed.transparent,
        interactive: parsed.interactive,
        padding: parsed.padding,
        nodeSpacing: parsed.nodeSpacing,
        layerSpacing: parsed.layerSpacing,
        componentSpacing: parsed.componentSpacing,
      });
      rendered = renderMermaidSVG(source, options);
    } else {
      const fg = colorOptions["fg"] ?? "#27272A";
      const line = colorOptions["line"] ?? fg;
      const border = colorOptions["border"] ?? line;
      const accent = colorOptions["accent"] ?? line;
      const asciiTheme =
        Object.keys(colorOptions).length === 0
          ? undefined
          : withDefined({
              fg,
              border,
              line,
              arrow: accent,
              accent: colorOptions["accent"],
              bg: colorOptions["bg"],
              corner: colorOptions["line"],
              junction: colorOptions["border"],
            });
      const options = withDefined({
        useAscii: parsed.useAscii,
        colorMode: parsed.colorMode,
        paddingX: parsed.paddingX,
        paddingY: parsed.paddingY,
        boxBorderPadding: parsed.boxBorderPadding,
        theme: asciiTheme,
      });
      rendered = renderMermaidASCII(source, options);
    }

    await writeOutput(parsed.output, rendered);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`beautiful-mermaid render failed: ${message}${semicolonHint(error)}`);
    Deno.exit(1);
  }
}

await main();
