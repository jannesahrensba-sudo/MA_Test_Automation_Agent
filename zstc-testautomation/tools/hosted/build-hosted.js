'use strict';
/**
 * Assembles the hosted mockup (static files, no server) into dist-hosted/site:
 *
 *   index.html, boot.js, launcher/     hosted page (slim shell instead of the SAP Fiori launchpad sandbox)
 *   mockserver.js                      in-browser OData V4 mock service (tools/hosted/build-mockserver.js)
 *   app/                               the unchanged app (Component-preload.js, manifest.json)
 *   resources/                         SAPUI5 1.136 runtime: sap-ui-core.js, library preloads, themes
 *
 * Fonts are embedded as data: URIs because the hosting page only allows fonts from data: URIs.
 *
 * Prerequisite: ui5 build --config ui5-hosted.yaml --dest dist-hosted/build --include-dependency <libraries>
 * (npm run build:hosted runs both steps).
 */
const fs = require('fs');
const path = require('path');
const { build: buildMockserver } = require('./build-mockserver');

const ROOT = path.join(__dirname, '../..');
const BUILD = path.join(ROOT, 'dist-hosted/build');
const SITE = path.join(ROOT, 'dist-hosted/site');
const PAGE = path.join(__dirname, 'page');

const LIBRARIES = [
    'sap.ui.core',
    'sap.m',
    'sap.f',
    'sap.fe.base',
    'sap.fe.controls',
    'sap.fe.core',
    'sap.fe.macros',
    'sap.fe.navigation',
    'sap.fe.placeholder',
    'sap.fe.templates',
    'sap.suite.ui.commons',
    'sap.suite.ui.microchart',
    'sap.ui.fl',
    'sap.ui.layout',
    'sap.ui.mdc',
    'sap.ui.table',
    'sap.ui.unified',
    'sap.uxap',
    'sap.ui.export'
];
const THEMES = ['sap_horizon', 'sap_horizon_dark'];
module.exports = { LIBRARIES };

/** additional single resources that are requested outside of the library preloads (determined by tracing) */
const EXTRA_RESOURCES = [
    'sap-ui-core.js',
    'sap/ui/core/themes/base/fonts/SAP-icons.json',
    'sap/ui/core/cldr/en.json'
];

const copied = [];
function copy(relativeSource, relativeTarget = relativeSource, from = BUILD) {
    const source = path.join(from, relativeSource);
    if (!fs.existsSync(source)) {
        return false;
    }
    const target = path.join(SITE, relativeTarget);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
    copied.push(relativeTarget);
    return true;
}

const FONT_MIME = { '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf' };

/**
 * Inlines url(...woff2) references of a CSS file as data: URIs and drops the other font formats from src lists.
 *
 * @param {string} css CSS text
 * @param {string} cssFile absolute path of the CSS file (to resolve relative URLs)
 * @returns {{css: string, fonts: number}} CSS with embedded fonts
 */
function inlineFonts(css, cssFile) {
    let fonts = 0;
    const result = css.replace(/@font-face\s*{[^}]*}/g, (block) => {
        const sources = [...block.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)\s*(format\(\s*['"]?([^'")]+)['"]?\s*\))?/g)];
        // best available format: woff2, then woff, then ttf (eot and svg fonts are not used by current browsers)
        const best = ['woff2', 'woff', 'ttf'].map((ext) => sources.find((m) => new RegExp(`\\.${ext}(\\?|#|$)`).test(m[2]))).find(Boolean);
        if (!best) {
            return block;
        }
        const fontFile = path.resolve(path.dirname(cssFile), best[2].replace(/[?#].*$/, ''));
        if (!fs.existsSync(fontFile)) {
            console.warn(`  font not found: ${path.relative(BUILD, fontFile)}`);
            return block;
        }
        fonts++;
        const ext = path.extname(fontFile);
        const format = { '.woff2': 'woff2', '.woff': 'woff', '.ttf': 'truetype' }[ext];
        const dataUri = `data:${FONT_MIME[ext]};base64,${fs.readFileSync(fontFile).toString('base64')}`;
        // replace every src declaration (some blocks declare src twice, e.g. for the IE eot fallback)
        return block.replace(/src\s*:[^;}]*;?/g, '').replace(/}\s*$/, `;src:url(${dataUri}) format("${format}")}`);
    });
    return { css: result, fonts };
}

async function main() {
    if (!fs.existsSync(path.join(BUILD, 'resources/sap-ui-core.js'))) {
        throw new Error('Run the UI5 build first (npm run build:hosted).');
    }
    fs.rmSync(SITE, { recursive: true, force: true });
    fs.mkdirSync(SITE, { recursive: true });

    // hosted page + in-browser mock service
    for (const file of ['index.html', 'boot.js', 'launcher/Launcher.js']) {
        copy(file, file, PAGE);
    }
    await buildMockserver(SITE);
    copied.push('mockserver.js');

    // app (unchanged): component preload and descriptor
    copy('Component-preload.js', 'app/Component-preload.js');
    copy('manifest.json', 'app/manifest.json');

    // SAPUI5 runtime
    for (const resource of EXTRA_RESOURCES) {
        copy(`resources/${resource}`);
    }
    let fontCount = 0;
    const i18nResources = {};
    for (const library of LIBRARIES) {
        const libPath = library.replace(/\./g, '/');
        // library-preload.js plus partial bundles (e.g. sap.ui.fl library-preload-apply.js / -write.js)
        const bundles = fs
            .readdirSync(path.join(BUILD, 'resources', libPath))
            .filter((f) => /^library-preload.*\.js$/.test(f) && !f.includes('.support.'));
        if (!bundles.length) {
            console.warn(`  no library-preload.js for ${library}`);
        }
        bundles.forEach((bundle) => copy(`resources/${libPath}/${bundle}`));
        copy(`resources/${libPath}/manifest.json`);
        // manifests of components inside the library (e.g. sap.fe.core.fpm) are loaded separately
        const walk = (dir) =>
            fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    return /^(test|designtime|themes|thirdparty|messagebundle)/.test(entry.name) ? [] : walk(full);
                }
                return entry.name === 'manifest.json' && dir !== path.join(BUILD, 'resources', libPath) ? [full] : [];
            });
        walk(path.join(BUILD, 'resources', libPath)).forEach((file) => copy(path.relative(BUILD, file)));
        // message bundles are not part of the library preloads: collected into one extra preload bundle (English UI)
        // and also published as files, because some resource bundles are requested directly
        for (const bundle of ['messagebundle_en.properties', 'messagebundle.properties']) {
            const file = path.join(BUILD, 'resources', libPath, bundle);
            if (fs.existsSync(file)) {
                i18nResources[`${libPath}/${bundle}`] = fs.readFileSync(file, 'utf8');
                copy(`resources/${libPath}/${bundle}`);
            }
        }
        for (const theme of THEMES) {
            const themeDir = `resources/${libPath}/themes/${theme}`;
            const cssFile = path.join(BUILD, themeDir, 'library.css');
            if (fs.existsSync(cssFile)) {
                const { css, fonts } = inlineFonts(fs.readFileSync(cssFile, 'utf8'), cssFile);
                fontCount += fonts;
                fs.mkdirSync(path.join(SITE, themeDir), { recursive: true });
                fs.writeFileSync(path.join(SITE, themeDir, 'library.css'), css);
                copied.push(`${themeDir}/library.css`);
            }
            copy(`${themeDir}/library-parameters.json`);
        }
    }

    // illustrations of empty tables and error states (sap.m.IllustratedMessage)
    const illustrations = 'resources/sap/m/themes/base/illustrations';
    copy(`${illustrations}/metadata.json`);
    copy(`${illustrations}/sapIllus-Patterns.svg`);
    for (const type of ['BeforeSearch', 'NoData', 'NoEntries', 'NoSearchResults', 'NoFilterResults', 'NoColumnsSet', 'UnableToLoad']) {
        for (const size of ['Dot', 'Spot', 'Dialog', 'Scene']) {
            copy(`${illustrations}/sapIllus-${size}-${type}.svg`);
        }
    }

    // sap-ui-version.json (read by SAP Fiori elements at start): versions and dependency hints of the libraries
    const versionInfo = {
        name: 'zstc.testautomation',
        version: '0.1.0',
        buildTimestamp: new Date().toISOString().replace(/[-:T]/g, '').slice(0, 12),
        scmRevision: '',
        libraries: LIBRARIES.map((library) => {
            const manifestFile = path.join(BUILD, 'resources', library.replace(/\./g, '/'), 'manifest.json');
            const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : {};
            const libs = manifest['sap.ui5']?.dependencies?.libs || {};
            return {
                name: library,
                version: manifest['sap.app']?.applicationVersion?.version || '1.136.0',
                buildTimestamp: '',
                scmRevision: '',
                manifestHints: { dependencies: { libs } }
            };
        })
    };
    fs.writeFileSync(path.join(SITE, 'resources/sap-ui-version.json'), JSON.stringify(versionInfo, null, 1));
    copied.push('resources/sap-ui-version.json');

    // extra preload bundle with the message bundles of all libraries (no single .properties requests)
    const i18nBundle = `//@ui5-bundle zstc-i18n-preload.js\nsap.ui.require.preload(${JSON.stringify(i18nResources)}, "zstc-i18n-preload");\n`;
    fs.writeFileSync(path.join(SITE, 'resources/zstc-i18n-preload.js'), i18nBundle);
    copied.push('resources/zstc-i18n-preload.js');

    // the hosting rejects files with a literal U+FFFD (replacement character): minified code keeps it in string
    // literals (e.g. jQuery's CSS escape in sap-ui-core.js) — the \\uFFFD escape sequence is equivalent there
    for (const file of copied.filter((f) => /\.(js|json)$/.test(f))) {
        const target = path.join(SITE, file);
        const text = fs.readFileSync(target, 'utf8');
        if (text.includes('\uFFFD')) {
            if (/\\\uFFFD/.test(text)) {
                throw new Error(`${file}: escaped U+FFFD found, check manually`);
            }
            fs.writeFileSync(target, text.replace(/\uFFFD/g, '\\uFFFD'));
            console.log(`  ${file}: U+FFFD written as escape sequence`);
        }
    }

    // report
    let bytes = 0;
    for (const file of copied) {
        bytes += fs.statSync(path.join(SITE, file)).size;
    }
    const largest = copied
        .map((file) => [file, fs.statSync(path.join(SITE, file)).size])
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([file, size]) => `${file} ${(size / 1024 / 1024).toFixed(1)} MB`);
    console.log(`site: ${copied.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB, ${fontCount} fonts embedded`);
    console.log(`largest: ${largest.join(' · ')}`);
    fs.writeFileSync(path.join(ROOT, 'dist-hosted/files.json'), JSON.stringify(copied.sort(), null, 1));
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
