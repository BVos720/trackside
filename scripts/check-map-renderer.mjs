// Validate the actual JavaScript shipped inside the native WebView, not just TSX.
// Metro cannot syntax-check code hidden inside a template literal.
import fs from 'node:fs';
import vm from 'node:vm';
import ts from 'typescript';
import assert from 'node:assert/strict';

function loadPlainTs(file) {
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const exports = {};
  new Function('exports', compiled)(exports);
  return exports;
}
const source = fs.readFileSync('src/ui/screens/TerrainSpike.tsx', 'utf8');
const ast = ts.createSourceFile('TerrainSpike.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const htmlFunction = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'buildHtml');
assert.ok(htmlFunction, 'Native HTML builder must exist');
const compiled = ts.transpileModule(htmlFunction.getText(ast), { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
const shaders = loadPlainTs('src/ui/map/atmosphereShaders.ts');
const { TERRAIN_SHADOW_FUNCTION } = loadPlainTs('src/core/logic/terrainShadow.ts');
const { SCENE_LIGHTING_SOURCE } = loadPlainTs('src/ui/map/sceneLightingSource.ts');
const dependencies = { ...shaders, TERRAIN_SHADOW_FUNCTION, SCENE_LIGHTING_SOURCE, SCENERY_DATA_URIS: {}, CALLOUT_W: 124, TERRAIN_SOURCE: 'terrain', VENUE_VIEW: {
  test: { centre: [6.94, 50.34], bounds: [[6.8, 50.2], [7.1, 50.5]], minZoom: 10, maxZoom: 19 },
} };
const html = new Function(...Object.keys(dependencies), compiled + '\nreturn buildHtml("test", "file:///test.pmtiles");')(...Object.values(dependencies));
const script = html.match(/<script>([\s\S]*?)<\/script>/)?.[1];
assert.ok(script, 'Native page must contain its renderer');
new vm.Script(script, { filename: 'trackside-terrain-embedded.js' });
assert.ok(script.includes(JSON.stringify(shaders.rainVertexShader)), 'Native renderer must embed shared rain shader verbatim');
assert.ok(script.includes(JSON.stringify(shaders.cloudFragmentShader)), 'Native renderer must embed shared cloud shader verbatim');
assert.ok(script.includes(SCENE_LIGHTING_SOURCE), 'Native renderer must embed the shared scenery/cloud-shadow implementation');
await import('./build-scene-lighting.mjs?check');
const serializedShadow = new Function(`return (${TERRAIN_SHADOW_FUNCTION});`)();
assert.deepEqual(serializedShadow(new Float32Array(25), 5, 400, 400, 90, 20), new Uint8ClampedArray(25));
console.log('Native WebView JavaScript parses; shared shader embedding and standalone shadow serialization pass.');
