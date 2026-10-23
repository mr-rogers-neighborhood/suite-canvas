import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * `@suite/graph` is the pure core. It may not import React, a rich-text or
 * canvas library, or a Loro editor adaptor, and it may not touch a browser
 * global. That is what keeps its whole suite a two-second node run and lets
 * mutation testing explore it without a DOM.
 *
 * These guards read the sources instead of executing them: an import is a fact
 * about a file, while a DOM reference would only fail later, in whichever test
 * happens to run without a DOM.
 */
const WHY =
  "packages/graph is the pure, DOM-free core: that is why its suite runs in a couple of seconds " +
  "and can be mutation-tested. Move React, editor or browser code into apps/canvas and pass " +
  "plain data into the graph.";

/**
 * TypeScript's own file-system API keeps this guard type-checkable without a
 * Node type dependency in the core package; it reads the same files from disk.
 */
const ROOT = ts.sys.getCurrentDirectory();
const SRC =
  ["packages/graph/src", "src"]
    .map((candidate) => `${ROOT}/${candidate}`)
    .find((candidate) => ts.sys.fileExists(`${candidate}/index.ts`)) ?? `${ROOT}/src`;

/** Packages the core may not depend on, matched together with their sub-paths. */
const FORBIDDEN_MODULES = ["react", "react-dom", "@xyflow", "@tiptap", "loro-adaptors"] as const;

const DOM_GLOBALS = new Set(["document", "window", "localStorage", "navigator"]);

function sourceFiles(directory: string): string[] {
  return ts.sys
    .readDirectory(directory, [".ts"])
    .filter((file) => !file.endsWith(".test.ts"))
    .sort();
}

function readFile(file: string): string {
  const source = ts.sys.readFile(file);
  if (source === undefined) throw new Error(`could not read ${file}`);
  return source;
}

function parse(source: string, file: string): ts.SourceFile {
  return ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true);
}

/** Every static import, re-export and dynamic import in one file. */
function importsOf(file: ts.SourceFile): string[] {
  const specifiers: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isImportDeclaration(node) && ts.isStringLiteral(node.moduleSpecifier)) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (
      ts.isExportDeclaration(node) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifiers.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      const [argument] = node.arguments;
      if (argument && ts.isStringLiteral(argument)) specifiers.push(argument.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return specifiers;
}

function isForbidden(specifier: string): boolean {
  return FORBIDDEN_MODULES.some(
    (prefix) => specifier === prefix || specifier.startsWith(`${prefix}/`),
  );
}

/**
 * Names the file declares itself. A local may share a DOM name — `search.ts`
 * binds `window` for a slice of body text — and then its uses are not globals.
 */
function boundNames(file: ts.SourceFile): Set<string> {
  const names = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (ts.isVariableDeclaration(node) || ts.isParameter(node) || ts.isBindingElement(node)) {
      if (ts.isIdentifier(node.name)) names.add(node.name.text);
    } else if (
      ts.isImportClause(node) ||
      ts.isFunctionDeclaration(node) ||
      ts.isClassDeclaration(node)
    ) {
      if (node.name) names.add(node.name.text);
    } else if (ts.isNamespaceImport(node) || ts.isImportSpecifier(node)) {
      names.add(node.name.text);
    } else if (
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEnumDeclaration(node) ||
      ts.isFunctionExpression(node)
    ) {
      if (node.name) names.add(node.name.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return names;
}

/** A property key (`{ document: … }`) or member name (`parsed.document`) is not a global. */
function isMemberName(node: ts.Identifier): boolean {
  const { parent } = node;
  return (
    (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
    (ts.isPropertyAssignment(parent) && parent.name === node) ||
    (ts.isPropertyDeclaration(parent) && parent.name === node) ||
    (ts.isPropertySignature(parent) && parent.name === node) ||
    (ts.isMethodDeclaration(parent) && parent.name === node) ||
    (ts.isMethodSignature(parent) && parent.name === node) ||
    (ts.isEnumMember(parent) && parent.name === node) ||
    (ts.isQualifiedName(parent) && parent.right === node)
  );
}

/** DOM globals this file references without declaring a local of the same name. */
function globalReferences(file: ts.SourceFile): string[] {
  const bound = boundNames(file);
  const found = new Set<string>();
  const visit = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      DOM_GLOBALS.has(node.text) &&
      !bound.has(node.text) &&
      !isMemberName(node)
    ) {
      found.add(node.text);
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return [...found];
}

describe("core purity", () => {
  const SOURCES = sourceFiles(SRC).map((file) => ({
    name: file.slice(SRC.length + 1).replaceAll("\\", "/"),
    file,
    source: readFile(file),
  }));

  it("scans every non-test source file under src", () => {
    const names = SOURCES.map(({ name }) => name);
    expect(names).toEqual(
      expect.arrayContaining(["index.ts", "schema.ts", "loro/WorkspaceDocument.ts"]),
    );
    expect(SOURCES.length).toBeGreaterThan(10);
  });

  it("imports nothing that needs React, an editor or a canvas", () => {
    const offenders = SOURCES.flatMap(({ name, file, source }) =>
      importsOf(parse(source, file))
        .filter(isForbidden)
        .map((specifier) => `${name} imports ${specifier}`),
    );
    expect(offenders, WHY).toEqual([]);
  });

  it("touches no browser global", () => {
    const offenders = SOURCES.flatMap(({ name, file, source }) =>
      globalReferences(parse(source, file)).map((identifier) => `${name} uses ${identifier}`),
    );
    expect(offenders, WHY).toEqual([]);
  });
});
