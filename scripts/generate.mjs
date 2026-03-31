import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, "..");

const OUTPUTS = {
  zedTheme: path.join(ROOT, "themes", "vscode-2026-port-theme.json"),
  resolvedDark: path.join(ROOT, "generated", "vscode", "2026-dark.resolved.json"),
  resolvedLight: path.join(ROOT, "generated", "vscode", "2026-light.resolved.json"),
  sourceMeta: path.join(ROOT, "metadata", "upstream-sources.json")
};

const UPSTREAM_BASE =
  "https://raw.githubusercontent.com/microsoft/vscode/main/extensions/theme-defaults/themes";

const ENTRIES = [
  {
    id: "2026-dark",
    includePath: "2026-dark.json",
    themeName: "VS Code 2026 Dark",
    appearance: "dark"
  },
  {
    id: "2026-light",
    includePath: "2026-light.json",
    themeName: "VS Code 2026 Light",
    appearance: "light"
  }
];

const SCOPE_TO_SYNTAX = [
  { needles: ["comment"], key: "comment" },
  { needles: ["string.regexp", "source.regexp"], key: "string.regex" },
  { needles: ["string.escape", "constant.character.escape"], key: "string.escape" },
  { needles: ["string"], key: "string" },
  { needles: ["constant.numeric", "number"], key: "number" },
  { needles: ["constant.language", "boolean"], key: "boolean" },
  { needles: ["constant", "entity.name.constant", "variable.other.constant"], key: "constant" },
  { needles: ["entity.name.function", "support.function"], key: "function" },
  { needles: ["keyword.operator"], key: "operator" },
  { needles: ["keyword", "storage"], key: "keyword" },
  { needles: ["entity.name.tag"], key: "tag" },
  {
    needles: [
      "support.type.property-name.json",
      "support.type.property-name",
      "meta.property-name",
      "entity.other.attribute-name"
    ],
    key: "attribute"
  },
  { needles: ["support.type", "entity.name.type", "storage.type"], key: "type" },
  {
    needles: [
      "support.variable",
      "meta.module-reference",
      "variable.other.readwrite",
      "variable.other",
      "variable.parameter",
      "variable"
    ],
    key: "variable"
  },
  { needles: ["variable.language", "variable.other.constant"], key: "variable.special" },
  { needles: ["punctuation.definition.list"], key: "punctuation.list_marker" },
  { needles: ["punctuation.definition.tag", "punctuation.section"], key: "punctuation.delimiter" },
  { needles: ["punctuation"], key: "punctuation" },
  { needles: ["markup.heading", "header"], key: "title" },
  { needles: ["markup.inline.raw", "text.literal"], key: "text.literal" },
  { needles: ["markup.italic", "emphasis"], key: "emphasis" },
  { needles: ["markup.bold", "strong"], key: "emphasis.strong" },
  { needles: ["meta.preprocessor", "preproc"], key: "preproc" },
  { needles: ["support.class", "entity.name.namespace"], key: "namespace" },
  { needles: ["entity.name.label"], key: "label" }
];

const SEMANTIC_TO_SYNTAX = {
  newOperator: "operator",
  stringLiteral: "string",
  customLiteral: "constant",
  numberLiteral: "number"
};

const fetchCache = new Map();

async function main() {
  await ensureOutputDirs();

  const resolved = [];
  for (const entry of ENTRIES) {
    const theme = await resolveTheme(entry.includePath);
    resolved.push({ entry, theme });
  }

  await writeResolvedOutputs(resolved);
  await writeZedTheme(resolved);
  await writeSourceMetadata();
}

async function ensureOutputDirs() {
  await mkdir(path.dirname(OUTPUTS.zedTheme), { recursive: true });
  await mkdir(path.dirname(OUTPUTS.resolvedDark), { recursive: true });
  await mkdir(path.dirname(OUTPUTS.sourceMeta), { recursive: true });
}

async function resolveTheme(themePath, stack = []) {
  const normalizedPath = normalizeThemePath(themePath);

  if (stack.includes(normalizedPath)) {
    throw new Error(`Circular include detected: ${[...stack, normalizedPath].join(" -> ")}`);
  }

  const { json, sourceUrl } = await fetchThemeJson(normalizedPath);

  let merged = emptyTheme();

  if (typeof json.include === "string" && json.include.trim() !== "") {
    const parentPath = normalizeThemePath(path.posix.join(path.posix.dirname(normalizedPath), json.include));
    const parent = await resolveTheme(parentPath, [...stack, normalizedPath]);
    merged = mergeThemes(merged, parent);
  }

  const current = normalizeThemeJson(json, normalizedPath, sourceUrl);
  return mergeThemes(merged, current);
}

function normalizeThemeJson(json, themePath, sourceUrl) {
  const tokenColors = normalizeTokenColors(json.tokenColors);
  const semanticTokenColors =
    json.semanticTokenColors && typeof json.semanticTokenColors === "object"
      ? json.semanticTokenColors
      : {};

  return {
    name: typeof json.name === "string" ? json.name : path.posix.basename(themePath),
    type: typeof json.type === "string" ? json.type : undefined,
    sourcePath: themePath,
    sourceUrl,
    colors: json.colors && typeof json.colors === "object" ? json.colors : {},
    tokenColors,
    semanticTokenColors,
    semanticHighlighting:
      typeof json.semanticHighlighting === "boolean" ? json.semanticHighlighting : undefined
  };
}

function normalizeTokenColors(tokenColors) {
  if (!tokenColors) {
    return [];
  }

  if (Array.isArray(tokenColors)) {
    return tokenColors;
  }

  return [];
}

function mergeThemes(baseTheme, overrideTheme) {
  return {
    ...baseTheme,
    ...overrideTheme,
    colors: {
      ...(baseTheme.colors || {}),
      ...(overrideTheme.colors || {})
    },
    tokenColors: [...(baseTheme.tokenColors || []), ...(overrideTheme.tokenColors || [])],
    semanticTokenColors: {
      ...(baseTheme.semanticTokenColors || {}),
      ...(overrideTheme.semanticTokenColors || {})
    },
    semanticHighlighting:
      overrideTheme.semanticHighlighting ?? baseTheme.semanticHighlighting ?? undefined
  };
}

function emptyTheme() {
  return {
    colors: {},
    tokenColors: [],
    semanticTokenColors: {}
  };
}

async function fetchThemeJson(themePath) {
  if (fetchCache.has(themePath)) {
    return fetchCache.get(themePath);
  }

  const sourceUrl = `${UPSTREAM_BASE}/${themePath}`;
  const response = await fetch(sourceUrl, { headers: { "Cache-Control": "no-cache" } });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceUrl} (${response.status})`);
  }

  const raw = await response.text();
  const parsed = parseJsonc(raw);
  const sha256 = createHash("sha256").update(raw).digest("hex");

  const value = {
    json: parsed,
    raw,
    sourceUrl,
    themePath,
    sha256
  };

  fetchCache.set(themePath, value);
  return value;
}

async function writeResolvedOutputs(resolved) {
  for (const { entry, theme } of resolved) {
    const outputPath = entry.id === "2026-dark" ? OUTPUTS.resolvedDark : OUTPUTS.resolvedLight;
    await writeStableJson(outputPath, {
      entry: entry.id,
      includePath: entry.includePath,
      appearance: entry.appearance,
      source: theme.sourceUrl,
      resolved: {
        name: theme.name,
        type: theme.type,
        colors: theme.colors,
        tokenColors: theme.tokenColors,
        semanticTokenColors: theme.semanticTokenColors,
        semanticHighlighting: theme.semanticHighlighting
      }
    });
  }
}

async function writeZedTheme(resolved) {
  const zedThemes = resolved.map(({ entry, theme }) => {
    const style = buildZedStyle(theme);

    return {
      name: entry.themeName,
      appearance: entry.appearance,
      style
    };
  });

  const family = {
    $schema: "https://zed.dev/schema/themes/v0.2.0.json",
    name: "VS Code 2026 Port",
    author: "Ported from Microsoft VS Code defaults",
    themes: zedThemes
  };

  await writeStableJson(OUTPUTS.zedTheme, family);
}

function buildZedStyle(theme) {
  const colors = theme.colors || {};
  const style = {};

  const pick = (...keys) => {
    for (const key of keys) {
      const value = normalizeColor(colors[key]);
      if (value) {
        return value;
      }
    }

    return null;
  };

  const set = (key, value) => {
    if (value) {
      style[key] = value;
    }
  };

  set("background", pick("sideBar.background", "panel.background", "editor.background"));
  set("surface.background", pick("panel.background", "editorGroupHeader.tabsBackground", "sideBar.background"));
  set("elevated_surface.background", pick("editorWidget.background", "quickInput.background", "menu.background"));
  set("panel.background", pick("panel.background", "sideBar.background"));
  set("status_bar.background", pick("statusBar.background"));
  set("title_bar.background", pick("titleBar.activeBackground"));
  set("title_bar.inactive_background", pick("titleBar.inactiveBackground"));
  set("toolbar.background", pick("activityBar.background", "sideBar.background"));
  set("tab_bar.background", pick("editorGroupHeader.tabsBackground", "sideBar.background"));
  set("tab.active_background", pick("tab.activeBackground", "editor.background"));
  set("tab.inactive_background", pick("tab.inactiveBackground", "editorGroupHeader.tabsBackground"));

  set("border", pick("panel.border", "tab.border", "sideBar.border"));
  set("border.variant", pick("menu.border", "pickerGroup.border", "tab.lastPinnedBorder"));
  set("border.focused", pick("focusBorder", "statusBar.focusBorder"));
  set("border.selected", pick("inputOption.activeBorder", "tab.activeBorderTop", "activityBar.activeFocusBorder"));
  set("border.transparent", "#00000000");
  set("border.disabled", pick("disabledForeground", "tab.unfocusedInactiveForeground"));

  set("element.background", pick("button.background", "input.background", "dropdown.background", "checkbox.background"));
  set("element.hover", pick("button.hoverBackground", "list.hoverBackground", "toolbar.hoverBackground"));
  set("element.active", pick("statusBarItem.activeBackground", "actionBar.toggledBackground", "tab.selectedBackground"));
  set("element.selected", pick("list.activeSelectionBackground", "quickInputList.focusBackground", "menu.selectionBackground"));
  set("element.disabled", pick("disabledForeground", "button.secondaryBackground", "input.background"));

  set("ghost_element.background", "#00000000");
  set("ghost_element.hover", pick("list.hoverBackground", "toolbar.hoverBackground"));
  set("ghost_element.active", pick("statusBarItem.activeBackground", "list.inactiveSelectionBackground"));
  set("ghost_element.selected", pick("list.focusBackground", "list.activeSelectionBackground"));
  set("ghost_element.disabled", pick("disabledForeground", "tab.unfocusedInactiveForeground"));

  set("drop_target.background", pick("list.dropBackground"));

  set("text", pick("foreground", "editor.foreground"));
  set("text.muted", pick("descriptionForeground", "statusBar.foreground", "breadcrumb.foreground"));
  set("text.placeholder", pick("input.placeholderForeground", "disabledForeground"));
  set("text.disabled", pick("disabledForeground"));
  set("text.accent", pick("textLink.foreground", "editorLink.activeForeground", "list.highlightForeground"));

  set("icon", pick("icon.foreground", "foreground"));
  set("icon.muted", pick("descriptionForeground", "activityBar.inactiveForeground"));
  set("icon.disabled", pick("disabledForeground"));
  set("icon.placeholder", pick("input.placeholderForeground", "descriptionForeground"));
  set("icon.accent", pick("activityBarBadge.background", "focusBorder"));

  set("link_text.hover", pick("textLink.activeForeground", "notificationLink.foreground"));
  set("search.match_background", pick("editor.findMatchBackground"));
  set("search.active_match_background", pick("editor.findMatchHighlightBackground", "editor.wordHighlightStrongBackground"));

  set("scrollbar.thumb.background", pick("scrollbarSlider.background", "minimapSlider.background"));
  set("scrollbar.thumb.hover_background", pick("scrollbarSlider.hoverBackground", "minimapSlider.hoverBackground"));
  set("scrollbar.thumb.border", pick("scrollbarSlider.activeBackground", "minimapSlider.activeBackground"));
  set("scrollbar.track.background", pick("scrollbar.shadow"));
  set("scrollbar.track.border", pick("panel.border", "sideBar.border"));

  set("editor.background", pick("editor.background"));
  set("editor.foreground", pick("editor.foreground", "foreground"));
  set("editor.gutter.background", pick("editorGutter.background", "editor.background"));
  set("editor.subheader.background", pick("editorStickyScroll.background", "editorGroupHeader.tabsBackground"));
  set("editor.active_line.background", pick("editor.lineHighlightBackground", "editorStickyScrollHover.background"));
  set("editor.highlighted_line.background", pick("editor.rangeHighlightBackground", "editor.lineHighlightBackground"));
  set("editor.line_number", pick("editorLineNumber.foreground"));
  set("editor.active_line_number", pick("editorLineNumber.activeForeground"));
  set("editor.hover_line_number", pick("editorLineNumber.activeForeground", "editorLineNumber.foreground"));
  set("editor.invisible", pick("editorWhitespace.foreground"));
  set("editor.wrap_guide", pick("editorIndentGuide.background", "editorIndentGuide.background1"));
  set("editor.active_wrap_guide", pick("editorIndentGuide.activeBackground", "editorIndentGuide.activeBackground1"));
  set("editor.document_highlight.read_background", pick("editor.wordHighlightBackground", "editor.selectionHighlightBackground"));
  set("editor.document_highlight.write_background", pick("editor.wordHighlightStrongBackground", "editor.selectionBackground"));

  set("terminal.background", pick("terminal.background", "panel.background"));
  set("terminal.foreground", pick("terminal.foreground", "foreground"));
  set("terminal.bright_foreground", pick("terminalCursor.foreground", "button.foreground", "foreground"));
  set("terminal.dim_foreground", pick("descriptionForeground", "disabledForeground"));

  set("terminal.ansi.black", pick("terminal.ansiBlack", "editor.background"));
  set("terminal.ansi.red", pick("terminal.ansiRed", "charts.red", "errorForeground"));
  set("terminal.ansi.green", pick("terminal.ansiGreen", "charts.green", "gitDecoration.addedResourceForeground"));
  set("terminal.ansi.yellow", pick("terminal.ansiYellow", "charts.yellow", "list.warningForeground"));
  set("terminal.ansi.blue", pick("terminal.ansiBlue", "charts.blue", "focusBorder"));
  set("terminal.ansi.magenta", pick("terminal.ansiMagenta", "charts.purple"));
  set("terminal.ansi.cyan", pick("terminal.ansiCyan", "gauge.foreground", "charts.blue"));
  set("terminal.ansi.white", pick("terminal.ansiWhite", "terminal.foreground", "foreground"));

  set("terminal.ansi.bright_black", pick("terminal.ansiBrightBlack", "disabledForeground"));
  set("terminal.ansi.bright_red", pick("terminal.ansiBrightRed", "notificationsErrorIcon.foreground", "errorForeground"));
  set("terminal.ansi.bright_green", pick("terminal.ansiBrightGreen", "gitDecoration.untrackedResourceForeground", "gitDecoration.addedResourceForeground"));
  set("terminal.ansi.bright_yellow", pick("terminal.ansiBrightYellow", "gauge.warningForeground", "list.warningForeground"));
  set("terminal.ansi.bright_blue", pick("terminal.ansiBrightBlue", "chat.slashCommandForeground", "charts.blue"));
  set("terminal.ansi.bright_magenta", pick("terminal.ansiBrightMagenta", "token.debug-token", "charts.purple"));
  set("terminal.ansi.bright_cyan", pick("terminal.ansiBrightCyan", "charts.blue", "gauge.foreground"));
  set("terminal.ansi.bright_white", pick("terminal.ansiBrightWhite", "button.foreground", "foreground"));

  set("version_control.added", pick("gitDecoration.addedResourceForeground", "editorOverviewRuler.addedForeground"));
  set("version_control.modified", pick("gitDecoration.modifiedResourceForeground", "editorOverviewRuler.modifiedForeground"));
  set("version_control.deleted", pick("gitDecoration.deletedResourceForeground", "editorOverviewRuler.deletedForeground"));
  set("version_control.word_added", pick("diffEditor.insertedTextBackground"));
  set("version_control.word_deleted", pick("diffEditor.removedTextBackground"));
  set("version_control.conflict_marker.ours", pick("diffEditor.insertedLineBackground"));
  set("version_control.conflict_marker.theirs", pick("diffEditor.removedLineBackground"));

  set("conflict", pick("gitDecoration.conflictingResourceForeground", "activityErrorBadge.background"));
  set("conflict.background", pick("inputValidation.errorBackground", "diffEditor.removedLineBackground"));
  set("conflict.border", pick("inputValidation.errorBorder", "panel.border"));

  set("created", pick("gitDecoration.addedResourceForeground", "editorGutter.addedBackground"));
  set("created.background", pick("diffEditor.insertedLineBackground"));
  set("created.border", pick("diffEditor.insertedTextBackground"));

  set("deleted", pick("gitDecoration.deletedResourceForeground", "editorGutter.deletedBackground"));
  set("deleted.background", pick("diffEditor.removedLineBackground"));
  set("deleted.border", pick("diffEditor.removedTextBackground"));

  set("error", pick("errorForeground", "notificationsErrorIcon.foreground", "list.errorForeground"));
  set("error.background", pick("inputValidation.errorBackground", "gauge.errorBackground"));
  set("error.border", pick("inputValidation.errorBorder", "panel.border"));

  set("hidden", pick("disabledForeground", "tab.unfocusedInactiveForeground"));
  set("hidden.background", pick("tab.unfocusedInactiveBackground", "panel.background"));
  set("hidden.border", pick("tab.border", "panel.border"));

  set("hint", pick("notificationsInfoIcon.foreground", "editorLink.activeForeground"));
  set("hint.background", pick("inputValidation.infoBackground", "chat.slashCommandBackground"));
  set("hint.border", pick("inputValidation.infoBorder", "focusBorder"));

  set("ignored", pick("gitDecoration.ignoredResourceForeground", "disabledForeground"));
  set("ignored.background", pick("tab.unfocusedInactiveBackground", "panel.background"));
  set("ignored.border", pick("panel.border", "tab.border"));

  set("info", pick("notificationsInfoIcon.foreground", "editorLink.activeForeground"));
  set("info.background", pick("inputValidation.infoBackground", "chat.requestBubbleBackground"));
  set("info.border", pick("inputValidation.infoBorder", "focusBorder"));

  set("modified", pick("gitDecoration.modifiedResourceForeground", "list.warningForeground"));
  set("modified.background", pick("inputValidation.warningBackground", "gauge.warningBackground"));
  set("modified.border", pick("inputValidation.warningBorder", "panel.border"));

  set("predictive", pick("chat.slashCommandForeground", "gauge.foreground"));
  set("predictive.background", pick("chat.slashCommandBackground", "chat.requestBubbleBackground"));
  set("predictive.border", pick("focusBorder", "panel.border"));

  set("renamed", pick("textLink.foreground", "list.highlightForeground"));
  set("renamed.background", pick("list.dropBackground", "quickInputList.focusBackground"));
  set("renamed.border", pick("focusBorder", "panel.border"));

  set("success", pick("gitDecoration.addedResourceForeground", "editorGutter.addedBackground"));
  set("success.background", pick("diffEditor.insertedLineBackground", "inputValidation.infoBackground"));
  set("success.border", pick("diffEditor.insertedTextBackground", "panel.border"));

  set("unreachable", pick("disabledForeground", "descriptionForeground"));
  set("unreachable.background", pick("tab.unfocusedInactiveBackground", "editor.inactiveSelectionBackground"));
  set("unreachable.border", pick("panel.border", "tab.border"));

  set("warning", pick("list.warningForeground", "notificationsWarningIcon.foreground"));
  set("warning.background", pick("inputValidation.warningBackground", "gauge.warningBackground"));
  set("warning.border", pick("inputValidation.warningBorder", "panel.border"));

  const players = buildPlayers(colors);
  if (players.length > 0) {
    style.players = players;
  }

  const syntax = buildSyntax(theme);
  if (Object.keys(syntax).length > 0) {
    style.syntax = syntax;
  }

  return sortObjectDeep(style);
}

function buildPlayers(colors) {
  const candidates = [
    colors["focusBorder"],
    colors["textLink.foreground"],
    colors["activityBarBadge.background"],
    colors["editorCursor.foreground"],
    colors["charts.blue"],
    colors["charts.green"],
    colors["charts.yellow"],
    colors["charts.purple"],
    colors["errorForeground"]
  ]
    .map(normalizeColor)
    .filter(Boolean);

  const unique = [];
  for (const color of candidates) {
    if (!unique.includes(color)) {
      unique.push(color);
    }
  }

  return unique.slice(0, 8).map((color) => ({
    cursor: color,
    background: color,
    selection: withAlpha(color, "3d")
  }));
}

function buildSyntax(theme) {
  const syntax = {};
  const bestByKey = new Map();

  for (const [ruleIndex, tokenRule] of (theme.tokenColors || []).entries()) {
    if (!tokenRule || typeof tokenRule !== "object") {
      continue;
    }

    const settings = tokenRule.settings && typeof tokenRule.settings === "object" ? tokenRule.settings : {};
    const scopes = normalizeScopes(tokenRule.scope);

    for (const mapping of SCOPE_TO_SYNTAX) {
      const score = bestScopeScore(scopes, mapping.needles);
      if (score < 0) {
        continue;
      }

      const style = toHighlightStyle(settings);
      if (Object.keys(style).length === 0) {
        continue;
      }

      const existing = bestByKey.get(mapping.key);
      if (
        !existing ||
        score > existing.score ||
        (score === existing.score && ruleIndex > existing.ruleIndex)
      ) {
        bestByKey.set(mapping.key, {
          style,
          score,
          ruleIndex
        });
      }
    }
  }

  for (const [syntaxKey, entry] of bestByKey.entries()) {
    syntax[syntaxKey] = { ...entry.style };
  }

  for (const [semanticKey, syntaxKey] of Object.entries(SEMANTIC_TO_SYNTAX)) {
    const semanticValue = theme.semanticTokenColors?.[semanticKey];
    const style = toSemanticHighlightStyle(semanticValue);
    if (Object.keys(style).length === 0) {
      continue;
    }

    if (syntax[syntaxKey]) {
      continue;
    }

    syntax[syntaxKey] = style;
  }

  if (!syntax.primary) {
    const fallback = normalizeColor(theme.colors?.["editor.foreground"] || theme.colors?.foreground);
    if (fallback) {
      syntax.primary = { color: fallback };
    }
  }

  return sortObjectDeep(syntax);
}

function toSemanticHighlightStyle(value) {
  if (typeof value === "string") {
    const color = normalizeColor(value);
    return color ? { color } : {};
  }

  if (!value || typeof value !== "object") {
    return {};
  }

  return toHighlightStyle(value);
}

function toHighlightStyle(settings) {
  const style = {};
  const color = normalizeColor(settings.foreground ?? settings.color ?? null);
  if (color) {
    style.color = color;
  }

  const fontStyle = typeof settings.fontStyle === "string" ? settings.fontStyle.toLowerCase() : "";
  if (fontStyle.includes("italic")) {
    style.font_style = "italic";
  }

  if (fontStyle.includes("bold")) {
    style.font_weight = 700;
  }

  if (typeof settings.font_style === "string") {
    style.font_style = settings.font_style;
  }

  if (typeof settings.font_weight === "number") {
    style.font_weight = settings.font_weight;
  }

  return style;
}

function normalizeScopes(scope) {
  if (Array.isArray(scope)) {
    return scope.map((entry) => String(entry).toLowerCase());
  }

  if (typeof scope === "string") {
    return scope
      .split(",")
      .map((entry) => entry.trim().toLowerCase())
      .filter(Boolean);
  }

  return [];
}

function bestScopeScore(scopes, needles) {
  let best = -1;

  for (const scope of scopes) {
    const scopeSegments = scope.split(/\s+/).filter(Boolean);

    for (const [needleIndex, needle] of needles.entries()) {
      const needlePriority = (needles.length - needleIndex) * 10;
      const needleSegments = needle.split(/\s+/).filter(Boolean);

      if (scope === needle) {
        best = Math.max(best, 1000 + needlePriority + needle.length);
        continue;
      }

      if (scope.startsWith(`${needle}.`)) {
        best = Math.max(best, 900 + needlePriority + needle.length);
        continue;
      }

      const hasExactSegment = scopeSegments.some((segment) => segment === needle);
      if (hasExactSegment) {
        best = Math.max(best, 850 + needlePriority + needle.length);
        continue;
      }

      const hasPrefixedSegment = scopeSegments.some((segment) => segment.startsWith(`${needle}.`));
      if (hasPrefixedSegment) {
        best = Math.max(best, 800 + needlePriority + needle.length);
        continue;
      }

      const hasNeedleSequence = needleSegments.every((part) => scope.includes(part));
      if (hasNeedleSequence) {
        best = Math.max(best, 200 + needlePriority + needle.length);
      }
    }
  }

  return best;
}

async function writeSourceMetadata() {
  const sources = [];
  for (const [themePath, record] of [...fetchCache.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    sources.push({
      path: themePath,
      url: record.sourceUrl,
      sha256: record.sha256
    });
  }

  await writeStableJson(OUTPUTS.sourceMeta, {
    sourceBase: UPSTREAM_BASE,
    sources
  });
}

function normalizeThemePath(themePath) {
  const normalized = path.posix.normalize(themePath.replace(/\\/g, "/")).replace(/^\/+/, "");

  const anchoredPrefix = "theme-defaults/themes/";
  const anchoredIndex = normalized.indexOf(anchoredPrefix);
  if (anchoredIndex >= 0) {
    return normalized.slice(anchoredIndex + anchoredPrefix.length);
  }

  return normalized.replace(/^\.\//, "");
}

function normalizeColor(color) {
  if (typeof color !== "string") {
    return null;
  }

  const value = color.trim();
  if (!value.startsWith("#")) {
    return null;
  }

  const hex = value.slice(1);

  if (!/^[0-9a-fA-F]+$/.test(hex)) {
    return null;
  }

  if (hex.length === 3) {
    return `#${hex
      .split("")
      .map((digit) => `${digit}${digit}`)
      .join("")}`.toLowerCase();
  }

  if (hex.length === 4) {
    const [r, g, b, a] = hex.split("");
    return `#${r}${r}${g}${g}${b}${b}${a}${a}`.toLowerCase();
  }

  if (hex.length === 6 || hex.length === 8) {
    return `#${hex.toLowerCase()}`;
  }

  return null;
}

function withAlpha(color, alphaHex) {
  const normalized = normalizeColor(color);
  if (!normalized) {
    return null;
  }

  if (normalized.length === 9) {
    return `${normalized.slice(0, 7)}${alphaHex}`;
  }

  return `${normalized}${alphaHex}`;
}

async function writeStableJson(filePath, value) {
  const sorted = sortObjectDeep(value);
  const content = `${JSON.stringify(sorted, null, 2)}\n`;
  await writeFile(filePath, content, "utf8");
}

function sortObjectDeep(value) {
  if (Array.isArray(value)) {
    return value.map((item) => sortObjectDeep(item));
  }

  if (!value || typeof value !== "object") {
    return value;
  }

  const sorted = {};
  for (const key of Object.keys(value).sort((a, b) => a.localeCompare(b))) {
    sorted[key] = sortObjectDeep(value[key]);
  }

  return sorted;
}

function parseJsonc(input) {
  const withoutComments = stripComments(input);
  const withoutTrailingCommas = removeTrailingCommas(withoutComments);
  return JSON.parse(withoutTrailingCommas);
}

function stripComments(input) {
  let output = "";
  let inString = false;
  let quoteChar = "";
  let inSingleLineComment = false;
  let inMultiLineComment = false;
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    const next = input[i + 1];

    if (inSingleLineComment) {
      if (char === "\n") {
        inSingleLineComment = false;
        output += char;
      }
      continue;
    }

    if (inMultiLineComment) {
      if (char === "*" && next === "/") {
        inMultiLineComment = false;
        i += 1;
      }
      continue;
    }

    if (inString) {
      output += char;
      if (!escaped && char === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      output += char;
      escaped = false;
      continue;
    }

    if (char === "/" && next === "/") {
      inSingleLineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inMultiLineComment = true;
      i += 1;
      continue;
    }

    output += char;
  }

  return output;
}

function removeTrailingCommas(input) {
  let output = "";
  let inString = false;
  let quoteChar = "";
  let escaped = false;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];

    if (inString) {
      output += char;
      if (!escaped && char === quoteChar) {
        inString = false;
        quoteChar = "";
      }
      escaped = !escaped && char === "\\";
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      quoteChar = char;
      output += char;
      escaped = false;
      continue;
    }

    if (char === ",") {
      let j = i + 1;
      while (j < input.length && /\s/.test(input[j])) {
        j += 1;
      }

      if (input[j] === "}" || input[j] === "]") {
        continue;
      }
    }

    output += char;
  }

  return output;
}

await main();
