'use strict';
/**
 * Generates webapp/localService/mainService/metadata.xml from contract.js.
 *
 * Usage: node tools/metadata/generate.js
 *
 * The generated file is committed; it is the OData V4 mock contract of ZUI_STC_TEST_CASE_O4 that the
 * FE mock server serves locally and that the real RAP service has to provide later (see docs/mock-to-real-mapping.md).
 */
const fs = require('fs');
const path = require('path');
const { V, esc, pad, annotationXml, propertyXml, navigationPropertyXml } = require('./edmx');
const contract = require('./contract');

const { NS, T } = contract;
const OUTPUT = path.join(__dirname, '..', '..', 'webapp', 'localService', 'mainService', 'metadata.xml');

/* Vocabulary references in the form a RAP service on SAP Gateway delivers them */
const VOCABULARIES = [
    ['/IWBEP/VOC_COMMON', 'com.sap.vocabularies.Common.v1', 'SAP__common'],
    ['/IWBEP/VOC_CORE', 'Org.OData.Core.V1', 'SAP__core'],
    ['/IWBEP/VOC_CAPABILITIES', 'Org.OData.Capabilities.V1', 'SAP__capabilities'],
    ['/IWBEP/VOC_MEASURES', 'Org.OData.Measures.V1', 'SAP__measures'],
    ['/IWBEP/VOC_UI', 'com.sap.vocabularies.UI.v1', 'SAP__UI']
];

const DRAFT_ACTIONS = ['Activate', 'Edit', 'Prepare', 'Discard'];

/* ------------------------------------------------------------------------------------------------ */
/* Model preparation                                                                                 */
/* ------------------------------------------------------------------------------------------------ */
function prepareEntities() {
    const all = [];
    for (const entity of contract.entities) {
        const props = [...entity.props];
        const navs = [...(entity.navs || [])];
        const keys = [...entity.keys];
        if (entity.draft) {
            keys.push('IsActiveEntity');
            props.push(
                { name: 'IsActiveEntity', type: 'Edm.Boolean', nullable: false, label: 'Is Active', technical: true },
                { name: 'HasActiveEntity', type: 'Edm.Boolean', nullable: false, label: 'Has Active', technical: true },
                { name: 'HasDraftEntity', type: 'Edm.Boolean', nullable: false, label: 'Has Draft', technical: true }
            );
            navs.push({ name: 'DraftAdministrativeData', targetType: T('I_DraftAdministrativeData'), targetSet: 'I_DraftAdministrativeData' });
            navs.push({ name: 'SiblingEntity', target: entity.name });
        }
        if (entity.entityControl) {
            props.push({ name: '__EntityControl', type: `${NS}.EntityControl`, technical: true });
        }
        if (entity.operationControl) {
            props.push({ name: '__OperationControl', type: `${NS}.${entity.name}OperationControl`, technical: true });
        }
        if (entity.fieldControl) {
            props.push({ name: '__FieldControl', type: `${NS}.${entity.name}FieldControl`, technical: true });
        }
        if (entity.messages) {
            props.push({ name: 'SAP__Messages', type: `Collection(${NS}.SAP__Message)`, nullable: false, technical: true });
        }
        all.push({ ...entity, props, navs, keys, kind: 'bo' });
    }
    for (const vh of [...contract.valueHelps, ...contract.codeLists]) {
        all.push({ ...vh, navs: vh.navs || [], kind: vh.codeList ? 'codeList' : 'valueHelp' });
    }
    all.push({
        name: 'I_DraftAdministrativeData',
        kind: 'draftAdmin',
        keys: ['DraftUUID'],
        navs: [],
        props: [
            { name: 'DraftUUID', type: 'Edm.Guid', nullable: false, label: 'Draft (Technical ID)' },
            { name: 'DraftEntityType', type: 'Edm.String', maxLength: 30, nullable: false, label: 'Draft Entity ID' },
            { name: 'CreationDateTime', type: 'Edm.DateTimeOffset', precision: 7, label: 'Draft Created On' },
            { name: 'CreatedByUser', type: 'Edm.String', maxLength: 12, nullable: false, label: 'Draft Created By' },
            { name: 'LastChangeDateTime', type: 'Edm.DateTimeOffset', precision: 7, label: 'Draft Last Changed On' },
            { name: 'LastChangedByUser', type: 'Edm.String', maxLength: 12, nullable: false, label: 'Draft Last Changed By' },
            { name: 'DraftAccessType', type: 'Edm.String', maxLength: 1, nullable: false, label: 'Draft Access Type' },
            { name: 'ProcessingStartDateTime', type: 'Edm.DateTimeOffset', precision: 7, label: 'Draft In Process Since' },
            { name: 'InProcessByUser', type: 'Edm.String', maxLength: 12, nullable: false, label: 'Draft In Process By' },
            { name: 'DraftIsKeptByUser', type: 'Edm.Boolean', nullable: false, label: 'Draft Is Kept By User' },
            { name: 'EnqueueStartDateTime', type: 'Edm.DateTimeOffset', precision: 7, label: 'Draft Locked Since' },
            { name: 'DraftIsCreatedByMe', type: 'Edm.Boolean', nullable: false, label: 'Draft Created By Me' },
            { name: 'DraftIsLastChangedByMe', type: 'Edm.Boolean', nullable: false, label: 'Draft Last Changed By Me' },
            { name: 'DraftIsProcessedByMe', type: 'Edm.Boolean', nullable: false, label: 'Draft In Process By Me' },
            { name: 'CreatedByUserDescription', type: 'Edm.String', maxLength: 80, nullable: false, label: 'Draft Created By (Description)' },
            { name: 'LastChangedByUserDescription', type: 'Edm.String', maxLength: 80, nullable: false, label: 'Draft Last Changed By (Description)' },
            { name: 'InProcessByUserDescription', type: 'Edm.String', maxLength: 80, nullable: false, label: 'Draft In Process By (Description)' }
        ]
    });
    const byName = new Map(all.map((e) => [e.name, e]));
    for (const entity of all) {
        for (const nav of entity.navs) {
            if (!nav.targetType) {
                if (!byName.has(nav.target)) {
                    throw new Error(`Unknown navigation target ${nav.target} in ${entity.name}.${nav.name}`);
                }
                nav.targetType = T(nav.target);
                nav.targetSet = nav.target;
            }
            for (const [source] of nav.constraints || []) {
                if (!entity.props.some((p) => p.name === source)) {
                    throw new Error(`Referential constraint source ${source} missing in ${entity.name}.${nav.name}`);
                }
            }
            for (const [, target] of nav.constraints || []) {
                if (!byName.get(nav.targetSet).props.some((p) => p.name === target)) {
                    throw new Error(`Referential constraint target ${target} missing in ${nav.targetSet} (${entity.name}.${nav.name})`);
                }
            }
        }
    }
    return { all, byName };
}

/* ------------------------------------------------------------------------------------------------ */
/* Annotations derived from properties and entity sets                                               */
/* ------------------------------------------------------------------------------------------------ */
function valueListAnnotations(prop, vl) {
    const params = [
        V.rec('SAP__common.ValueListParameterInOut', { LocalDataProperty: V.propPath(prop.name), ValueListProperty: V.str(vl.key) })
    ];
    for (const [local, remote] of vl.in || []) {
        params.push(V.rec('SAP__common.ValueListParameterIn', { LocalDataProperty: V.propPath(local), ValueListProperty: V.str(remote) }));
    }
    for (const [local, remote] of vl.out || []) {
        params.push(V.rec('SAP__common.ValueListParameterOut', { LocalDataProperty: V.propPath(local), ValueListProperty: V.str(remote) }));
    }
    for (const [remote, constant] of vl.constants || []) {
        params.push(V.rec('SAP__common.ValueListParameterConstant', { ValueListProperty: V.str(remote), Constant: V.str(constant) }));
    }
    for (const display of vl.display || []) {
        params.push(V.rec('SAP__common.ValueListParameterDisplayOnly', { ValueListProperty: V.str(display) }));
    }
    const result = [
        [
            'SAP__common.ValueList',
            V.rec('SAP__common.ValueListType', {
                Label: V.str(prop.label),
                CollectionPath: V.str(vl.collection),
                SearchSupported: V.bool(!vl.fixed),
                Parameters: V.coll(params)
            })
        ]
    ];
    if (vl.fixed) {
        result.push(['SAP__common.ValueListWithFixedValues', V.bool(true)]);
    }
    return result;
}

function propertyAnnotations(entity, prop) {
    const annos = [];
    if (prop.label) {
        annos.push(['SAP__common.Label', V.str(prop.label)]);
    }
    if (prop.text) {
        annos.push(['SAP__common.Text', V.path(prop.text), undefined, [['SAP__UI.TextArrangement', V.enum(`SAP__UI.TextArrangementType/${prop.textArrangement || 'TextFirst'}`)]]]);
    }
    if (prop.computed) {
        annos.push(['SAP__core.Computed', V.bool(true)]);
    }
    if (prop.immutable) {
        annos.push(['SAP__core.Immutable', V.bool(true)]);
    }
    if (prop.hidden || prop.technical) {
        annos.push(['SAP__UI.Hidden', V.bool(true)]);
    }
    if (prop.multiLine) {
        annos.push(['SAP__UI.MultiLineText', V.bool(true)]);
    }
    if (prop.unit) {
        annos.push(['SAP__measures.Unit', V.path(prop.unit)]);
    }
    if (prop.unitText) {
        // constant unit, e.g. % of a KPI (shown as "83 %" by progress indicators)
        annos.push(['SAP__measures.Unit', V.str(prop.unitText)]);
    }
    if (prop.currency) {
        annos.push(['SAP__measures.ISOCurrency', V.path(prop.currency)]);
    }
    if (entity.fieldControl && entity.fieldControl.includes(prop.name)) {
        annos.push(['SAP__common.FieldControl', V.path(`__FieldControl/${prop.name}`)]);
    }
    if (prop.valueList) {
        annos.push(...valueListAnnotations(prop, prop.valueList));
    }
    return annos;
}

function restrictions({ insertable, updatable, deletable }) {
    const annos = [];
    annos.push([
        'SAP__capabilities.InsertRestrictions',
        V.rec('SAP__capabilities.InsertRestrictionsType', { Insertable: typeof insertable === 'string' ? V.path(insertable) : V.bool(insertable) })
    ]);
    annos.push([
        'SAP__capabilities.UpdateRestrictions',
        V.rec('SAP__capabilities.UpdateRestrictionsType', { Updatable: typeof updatable === 'string' ? V.path(updatable) : V.bool(updatable) })
    ]);
    annos.push([
        'SAP__capabilities.DeleteRestrictions',
        V.rec('SAP__capabilities.DeleteRestrictionsType', { Deletable: typeof deletable === 'string' ? V.path(deletable) : V.bool(deletable) })
    ]);
    return annos;
}

const SET_CAPABILITIES = {
    TestCase: { insertable: true, updatable: '__EntityControl/Updatable', deletable: '__EntityControl/Deletable', searchable: true },
    TestCaseData: { insertable: false, updatable: true, deletable: false },
    ValidationResult: { insertable: false, updatable: false, deletable: false },
    Execution: { insertable: false, updatable: false, deletable: false },
    ExecutionStep: { insertable: false, updatable: false, deletable: false },
    DocumentReference: { insertable: false, updatable: false, deletable: false },
    TestAssertion: { insertable: false, updatable: false, deletable: false },
    ResultFinding: { insertable: false, updatable: false, deletable: false },
    ProcessProfile: { insertable: false, updatable: '__EntityControl/Updatable', deletable: false, searchable: true },
    FieldRequirement: { insertable: true, updatable: true, deletable: true },
    TestCaseStep: { insertable: true, updatable: true, deletable: true },
    TestCaseVersion: { insertable: false, updatable: false, deletable: false },
    ProcessTeam: { insertable: true, updatable: '__EntityControl/Updatable', deletable: false, searchable: true },
    TeamMember: { insertable: true, updatable: true, deletable: true },
    BusinessProcess: { insertable: true, updatable: '__EntityControl/Updatable', deletable: false, searchable: true },
    ProcessStep: { insertable: true, updatable: true, deletable: true },
    ProcessVariant: { insertable: true, updatable: true, deletable: true },
    ProcessVersion: { insertable: false, updatable: false, deletable: false },
    Release: { insertable: true, updatable: '__EntityControl/Updatable', deletable: false, searchable: true },
    ReleaseScope: { insertable: true, updatable: true, deletable: true },
    ReleaseTestCase: { insertable: false, updatable: false, deletable: false },
    ReleaseStepCoverage: { insertable: false, updatable: false, deletable: false },
    RegressionRun: { insertable: false, updatable: false, deletable: false },
    RegressionRunItem: { insertable: false, updatable: false, deletable: false }
};

function entitySetAnnotations(entity, byName) {
    const annos = [];
    if (entity.draft === 'root') {
        annos.push([
            'SAP__common.DraftRoot',
            V.rec('SAP__common.DraftRootType', {
                ActivationAction: V.str(`${NS}.Activate`),
                EditAction: V.str(`${NS}.Edit`),
                PreparationAction: V.str(`${NS}.Prepare`),
                DiscardAction: V.str(`${NS}.Discard`)
            })
        ]);
    } else if (entity.draft === 'node') {
        annos.push(['SAP__common.DraftNode', V.rec('SAP__common.DraftNodeType', { PreparationAction: V.str(`${NS}.Prepare`) })]);
    }
    if (entity.kind === 'bo') {
        const caps = SET_CAPABILITIES[entity.name];
        annos.push(['SAP__capabilities.SearchRestrictions', V.rec('SAP__capabilities.SearchRestrictionsType', { Searchable: V.bool(!!caps.searchable) })]);
        annos.push(...restrictions(caps));
        // Navigation restrictions: compositions/associations whose targets must not be created/changed from the UI
        const restricted = entity.navs
            .filter((nav) => nav.collection && SET_CAPABILITIES[nav.targetSet])
            .map((nav) => {
                const target = SET_CAPABILITIES[nav.targetSet];
                return V.rec('SAP__capabilities.NavigationPropertyRestriction', {
                    NavigationProperty: V.navPath(nav.name),
                    InsertRestrictions: V.rec('SAP__capabilities.InsertRestrictionsType', { Insertable: V.bool(target.insertable === true) }),
                    DeleteRestrictions: V.rec('SAP__capabilities.DeleteRestrictionsType', { Deletable: V.bool(target.deletable === true) }),
                    UpdateRestrictions: V.rec('SAP__capabilities.UpdateRestrictionsType', { Updatable: V.bool(target.updatable === true) })
                });
            });
        if (restricted.length) {
            annos.push(['SAP__capabilities.NavigationRestrictions', V.rec('SAP__capabilities.NavigationRestrictionsType', { RestrictedProperties: V.coll(restricted) })]);
        }
    } else {
        annos.push(['SAP__capabilities.SearchRestrictions', V.rec('SAP__capabilities.SearchRestrictionsType', { Searchable: V.bool(entity.kind === 'valueHelp') })]);
        annos.push(...restrictions({ insertable: false, updatable: false, deletable: false }));
    }
    void byName;
    return annos;
}

/* ------------------------------------------------------------------------------------------------ */
/* XML emission                                                                                      */
/* ------------------------------------------------------------------------------------------------ */
function entityTypeXml(entity, level) {
    const lines = [`${pad(level)}<EntityType Name="${entity.name}Type">`, `${pad(level + 1)}<Key>`];
    for (const key of entity.keys) {
        lines.push(`${pad(level + 2)}<PropertyRef Name="${key}"/>`);
    }
    lines.push(`${pad(level + 1)}</Key>`);
    for (const prop of entity.props) {
        const p = { ...prop };
        if (entity.keys.includes(p.name)) {
            p.nullable = false;
        }
        lines.push(propertyXml(p, level + 1));
    }
    for (const nav of entity.navs) {
        lines.push(navigationPropertyXml({ ...nav, cascade: undefined, onDeleteCascade: nav.cascade }, level + 1));
    }
    lines.push(`${pad(level)}</EntityType>`);
    return lines.join('\n');
}

function complexTypesXml(all, level) {
    const lines = [];
    lines.push(`${pad(level)}<ComplexType Name="SAP__Message">`);
    lines.push(`${pad(level + 1)}<Property Name="code" Type="Edm.String" Nullable="false"/>`);
    lines.push(`${pad(level + 1)}<Property Name="message" Type="Edm.String" Nullable="false"/>`);
    lines.push(`${pad(level + 1)}<Property Name="target" Type="Edm.String"/>`);
    lines.push(`${pad(level + 1)}<Property Name="additionalTargets" Type="Collection(Edm.String)" Nullable="false"/>`);
    lines.push(`${pad(level + 1)}<Property Name="transition" Type="Edm.Boolean" Nullable="false"/>`);
    lines.push(`${pad(level + 1)}<Property Name="numericSeverity" Type="Edm.Byte" Nullable="false"/>`);
    lines.push(`${pad(level + 1)}<Property Name="longtextUrl" Type="Edm.String"/>`);
    lines.push(`${pad(level)}</ComplexType>`);
    lines.push(`${pad(level)}<ComplexType Name="EntityControl">`);
    lines.push(`${pad(level + 1)}<Property Name="Deletable" Type="Edm.Boolean" Nullable="false"/>`);
    lines.push(`${pad(level + 1)}<Property Name="Updatable" Type="Edm.Boolean" Nullable="false"/>`);
    lines.push(`${pad(level)}</ComplexType>`);
    for (const entity of all) {
        if (entity.operationControl) {
            lines.push(`${pad(level)}<ComplexType Name="${entity.name}OperationControl">`);
            for (const action of entity.operationControl) {
                lines.push(`${pad(level + 1)}<Property Name="${action}" Type="Edm.Boolean" Nullable="false"/>`);
            }
            lines.push(`${pad(level)}</ComplexType>`);
        }
        if (entity.fieldControl) {
            lines.push(`${pad(level)}<ComplexType Name="${entity.name}FieldControl">`);
            for (const field of entity.fieldControl) {
                lines.push(`${pad(level + 1)}<Property Name="${field}" Type="Edm.Byte" Nullable="false"/>`);
            }
            lines.push(`${pad(level)}</ComplexType>`);
        }
    }
    return lines.join('\n');
}

function actionsXml(all, level) {
    const lines = [];
    const draftRoots = all.filter((e) => e.draft === 'root');
    for (const root of draftRoots) {
        for (const action of DRAFT_ACTIONS) {
            const entitySetPath = action === 'Activate' || action === 'Edit' ? ' EntitySetPath="_it"' : '';
            lines.push(`${pad(level)}<Action Name="${action}"${entitySetPath} IsBound="true">`);
            lines.push(`${pad(level + 1)}<Parameter Name="_it" Type="${T(root.name)}" Nullable="false"/>`);
            if (action === 'Edit') {
                lines.push(`${pad(level + 1)}<Parameter Name="PreserveChanges" Type="Edm.Boolean"/>`);
            }
            if (action !== 'Discard') {
                lines.push(`${pad(level + 1)}<ReturnType Type="${T(root.name)}" Nullable="false"/>`);
            }
            lines.push(`${pad(level)}</Action>`);
        }
    }
    for (const action of contract.actions) {
        lines.push(`${pad(level)}<Action Name="${action.name}" EntitySetPath="_it" IsBound="true">`);
        lines.push(`${pad(level + 1)}<Parameter Name="_it" Type="${T(action.boundTo)}" Nullable="false"/>`);
        for (const param of action.params || []) {
            const maxLength = param.maxLength ? ` MaxLength="${param.maxLength}"` : '';
            lines.push(`${pad(level + 1)}<Parameter Name="${param.name}" Type="${param.type}"${maxLength}/>`);
        }
        lines.push(`${pad(level + 1)}<ReturnType Type="${T(action.returns)}" Nullable="false"/>`);
        lines.push(`${pad(level)}</Action>`);
    }
    return lines.join('\n');
}

function entityContainerXml(all, level) {
    const lines = [`${pad(level)}<EntityContainer Name="Container">`];
    for (const entity of all) {
        const bindings = entity.navs.map((nav) => `${pad(level + 2)}<NavigationPropertyBinding Path="${nav.name}" Target="${nav.targetSet}"/>`);
        if (bindings.length === 0) {
            lines.push(`${pad(level + 1)}<EntitySet Name="${entity.name}" EntityType="${T(entity.name)}"/>`);
        } else {
            lines.push(`${pad(level + 1)}<EntitySet Name="${entity.name}" EntityType="${T(entity.name)}">`);
            lines.push(...bindings);
            lines.push(`${pad(level + 1)}</EntitySet>`);
        }
    }
    lines.push(`${pad(level)}</EntityContainer>`);
    return lines.join('\n');
}

function annotationsBlock(target, annos, level) {
    if (!annos.length) {
        return '';
    }
    const lines = [`${pad(level)}<Annotations Target="${esc(target)}">`];
    for (const [term, value, qualifier, nested] of annos) {
        lines.push(annotationXml(term, value, qualifier, level + 1, nested));
    }
    lines.push(`${pad(level)}</Annotations>`);
    return lines.join('\n');
}

function generate() {
    const { all, byName } = prepareEntities();
    const out = [];
    out.push('<?xml version="1.0" encoding="utf-8"?>');
    out.push('<!--');
    out.push('    OData V4 mock contract of ZUI_STC_TEST_CASE_O4 (project proposal, NOT an SAP standard service).');
    out.push('    GENERATED by tools/metadata/generate.js from tools/metadata/contract.js - do not edit manually.');
    out.push('    Structure follows RAP-generated V4 metadata; business field names follow released S/4HANA APIs.');
    out.push('-->');
    out.push('<edmx:Edmx xmlns:edmx="http://docs.oasis-open.org/odata/ns/edmx" xmlns="http://docs.oasis-open.org/odata/ns/edm" Version="4.0">');
    for (const [technicalName, namespace, alias] of VOCABULARIES) {
        const uri = `/sap/opu/odata/IWFND/CATALOGSERVICE;v=2/Vocabularies(TechnicalName='${encodeURIComponent(technicalName)}',Version='0001',SAP__Origin='LOCAL')/$value`;
        out.push(`    <edmx:Reference Uri="${esc(uri)}">`);
        out.push(`        <edmx:Include Namespace="${namespace}" Alias="${alias}"/>`);
        out.push('    </edmx:Reference>');
    }
    out.push('    <edmx:DataServices>');
    out.push(`        <Schema Namespace="${NS}" Alias="SAP__self">`);
    out.push('            <Annotation Term="SAP__core.SchemaVersion" String="1.0.0"/>');
    for (const entity of all) {
        out.push(entityTypeXml(entity, 3));
    }
    out.push(complexTypesXml(all, 3));
    out.push(actionsXml(all, 3));
    out.push(entityContainerXml(all, 3));

    // Annotations: properties
    for (const entity of all) {
        for (const prop of entity.props) {
            const block = annotationsBlock(`${NS}.${entity.name}Type/${prop.name}`, propertyAnnotations(entity, prop), 3);
            if (block) {
                out.push(block);
            }
        }
    }
    // Annotations: entity sets
    for (const entity of all) {
        const block = annotationsBlock(`${NS}.Container/${entity.name}`, entitySetAnnotations(entity, byName), 3);
        if (block) {
            out.push(block);
        }
    }
    // Annotations: action parameters (labels)
    for (const action of contract.actions) {
        for (const param of action.params || []) {
            const target = `${NS}.${action.name}(${T(action.boundTo)})/${param.name}`;
            if (!contract.annotations[target]) {
                out.push(annotationsBlock(target, [['SAP__common.Label', V.str(param.label)]], 3));
            }
        }
    }
    // Annotations: UI, side effects, actions (contract.js)
    for (const [target, annos] of Object.entries(contract.annotations)) {
        out.push(annotationsBlock(target, annos, 3));
    }
    out.push('        </Schema>');
    out.push('    </edmx:DataServices>');
    out.push('</edmx:Edmx>');
    out.push('');
    return out.join('\n');
}

if (require.main === module) {
    const xml = generate();
    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    fs.writeFileSync(OUTPUT, xml, 'utf-8');
    console.log(`Generated ${path.relative(process.cwd(), OUTPUT)} (${xml.split('\n').length} lines)`);
}

module.exports = { generate };
