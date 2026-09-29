'use strict';
/**
 * Minimal EDMX (OData V4 CSDL XML) writer used to generate the mock contract of ZUI_STC_TEST_CASE_O4.
 *
 * Annotation values are described with the small builder API `V` below and serialized to CSDL XML.
 * The output mirrors the structure of RAP-generated service metadata (vocabulary references with
 * SAP__* aliases, SAP__self schema alias, draft actions, SAP__Messages, __OperationControl, ...).
 */

/** Escapes a string for use inside an XML attribute or text node. */
function esc(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

const INLINE_KINDS = new Set([
    'String',
    'Path',
    'Bool',
    'EnumMember',
    'Int',
    'Decimal',
    'AnnotationPath',
    'PropertyPath',
    'NavigationPropertyPath'
]);

/** Builders for annotation values. */
const V = {
    str: (v) => ({ kind: 'String', v }),
    path: (v) => ({ kind: 'Path', v }),
    bool: (v) => ({ kind: 'Bool', v: String(v) }),
    enum: (v) => ({ kind: 'EnumMember', v }),
    int: (v) => ({ kind: 'Int', v: String(v) }),
    annoPath: (v) => ({ kind: 'AnnotationPath', v }),
    propPath: (v) => ({ kind: 'PropertyPath', v }),
    navPath: (v) => ({ kind: 'NavigationPropertyPath', v }),
    /** Record with optional type, property values and nested annotations ([term, value, qualifier]). */
    rec: (type, props = {}, annotations = []) => ({ kind: 'Record', type, props, annotations }),
    coll: (items) => ({ kind: 'Collection', items }),
    /** Dynamic expression $Not(path) */
    not: (pathValue) => ({ kind: 'Not', inner: pathValue })
};

function pad(level) {
    return '    '.repeat(level);
}

function valueToChildXml(value, level) {
    switch (value.kind) {
        case 'Record': {
            const typeAttr = value.type ? ` Type="${esc(value.type)}"` : '';
            const lines = [`${pad(level)}<Record${typeAttr}>`];
            for (const [prop, propValue] of Object.entries(value.props)) {
                if (propValue === undefined) {
                    continue;
                }
                lines.push(propertyValueXml(prop, propValue, level + 1));
            }
            for (const [term, annoValue, qualifier] of value.annotations) {
                lines.push(annotationXml(term, annoValue, qualifier, level + 1));
            }
            lines.push(`${pad(level)}</Record>`);
            return lines.join('\n');
        }
        case 'Collection': {
            if (value.items.length === 0) {
                return `${pad(level)}<Collection/>`;
            }
            const lines = [`${pad(level)}<Collection>`];
            for (const item of value.items) {
                if (INLINE_KINDS.has(item.kind)) {
                    lines.push(`${pad(level + 1)}<${item.kind}>${esc(item.v)}</${item.kind}>`);
                } else {
                    lines.push(valueToChildXml(item, level + 1));
                }
            }
            lines.push(`${pad(level)}</Collection>`);
            return lines.join('\n');
        }
        case 'Not':
            return `${pad(level)}<Not>\n${pad(level + 1)}<${value.inner.kind}>${esc(value.inner.v)}</${value.inner.kind}>\n${pad(level)}</Not>`;
        default:
            throw new Error(`Unsupported child value kind ${value.kind}`);
    }
}

function propertyValueXml(prop, value, level) {
    if (INLINE_KINDS.has(value.kind)) {
        return `${pad(level)}<PropertyValue Property="${esc(prop)}" ${value.kind}="${esc(value.v)}"/>`;
    }
    return `${pad(level)}<PropertyValue Property="${esc(prop)}">\n${valueToChildXml(value, level + 1)}\n${pad(level)}</PropertyValue>`;
}

/**
 * Serializes one annotation.
 *
 * @param {string} term the (aliased) term, e.g. SAP__UI.LineItem
 * @param {object|undefined} value the value built with V; undefined means a tagging annotation without value
 * @param {string|undefined} qualifier optional qualifier
 * @param {number} level indentation level
 * @returns {string} XML
 */
function annotationXml(term, value, qualifier, level, nested = []) {
    const q = qualifier ? ` Qualifier="${esc(qualifier)}"` : '';
    const nestedXml = nested.map(([nTerm, nValue, nQualifier]) => annotationXml(nTerm, nValue, nQualifier, level + 1));
    if (value === undefined) {
        return nestedXml.length
            ? `${pad(level)}<Annotation Term="${esc(term)}"${q}>\n${nestedXml.join('\n')}\n${pad(level)}</Annotation>`
            : `${pad(level)}<Annotation Term="${esc(term)}"${q}/>`;
    }
    if (INLINE_KINDS.has(value.kind)) {
        return nestedXml.length
            ? `${pad(level)}<Annotation Term="${esc(term)}"${q} ${value.kind}="${esc(value.v)}">\n${nestedXml.join('\n')}\n${pad(level)}</Annotation>`
            : `${pad(level)}<Annotation Term="${esc(term)}"${q} ${value.kind}="${esc(value.v)}"/>`;
    }
    const inner = [valueToChildXml(value, level + 1), ...nestedXml].join('\n');
    return `${pad(level)}<Annotation Term="${esc(term)}"${q}>\n${inner}\n${pad(level)}</Annotation>`;
}

function propertyXml(p, level) {
    const attrs = [`Name="${esc(p.name)}"`, `Type="${esc(p.type)}"`];
    if (p.nullable === false) {
        attrs.push('Nullable="false"');
    }
    if (p.maxLength !== undefined) {
        attrs.push(`MaxLength="${p.maxLength}"`);
    }
    if (p.precision !== undefined) {
        attrs.push(`Precision="${p.precision}"`);
    }
    if (p.scale !== undefined) {
        attrs.push(`Scale="${p.scale}"`);
    }
    return `${pad(level)}<Property ${attrs.join(' ')}/>`;
}

function navigationPropertyXml(n, level) {
    const type = n.collection ? `Collection(${n.targetType})` : n.targetType;
    const attrs = [`Name="${esc(n.name)}"`, `Type="${esc(type)}"`];
    if (n.partner) {
        attrs.push(`Partner="${esc(n.partner)}"`);
    }
    if (n.nullable === false && !n.collection) {
        attrs.push('Nullable="false"');
    }
    const children = [];
    for (const [source, target] of n.constraints || []) {
        children.push(`${pad(level + 1)}<ReferentialConstraint Property="${esc(source)}" ReferencedProperty="${esc(target)}"/>`);
    }
    if (n.onDeleteCascade) {
        children.push(`${pad(level + 1)}<OnDelete Action="Cascade"/>`);
    }
    if (children.length === 0) {
        return `${pad(level)}<NavigationProperty ${attrs.join(' ')}/>`;
    }
    return `${pad(level)}<NavigationProperty ${attrs.join(' ')}>\n${children.join('\n')}\n${pad(level)}</NavigationProperty>`;
}

module.exports = { V, esc, pad, annotationXml, propertyXml, navigationPropertyXml };
