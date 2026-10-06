'use strict';
/**
 * assignment — process assignment of a test case (process team → business process → process variant → section of the
 * path from the start object to the end object).
 *
 *   ASSIGNED  team, process and pilot variant are set and consistent
 *   ASSUMED   consistent, but the team is responsible for none of the steps of the path (to be confirmed)
 *   OPEN      something is missing or not part of the pilot — the test case cannot be approved or executed
 * Open or assumed team assignments of single process steps are listed in the note; they do not block the test case.
 *
 * Pure function: no repository access (the caller passes the active process model).
 */
const catalog = require('./processCatalog');
const { ASSIGNMENT } = require('../common/codes');

/**
 * @param {object} tc TestCase entry
 * @param {object} model active process model {process, steps, variants}
 * @param {Set<string>} teams known process teams
 * @returns {{status: string, note: string, variant?: object, path: object[]}} assignment
 */
function assignmentOf(tc, model, teams) {
    const missing = [];
    if (!tc.ProcessTeam) {
        missing.push('process team');
    }
    if (!tc.BusinessProcess) {
        missing.push('business process');
    }
    if (!tc.ProcessVariant) {
        missing.push('process variant');
    }
    if (missing.length) {
        return { status: ASSIGNMENT.OPEN, note: `Process assignment open: ${missing.join(', ')} missing.`, path: [] };
    }
    if (!teams.has(tc.ProcessTeam)) {
        return { status: ASSIGNMENT.OPEN, note: `Process team ${tc.ProcessTeam} does not exist.`, path: [] };
    }
    if (!model.process) {
        return { status: ASSIGNMENT.OPEN, note: `Business process ${tc.BusinessProcess} does not exist.`, path: [] };
    }
    if (model.process.PilotScope !== catalog.PILOT) {
        return { status: ASSIGNMENT.OPEN, note: `Business process ${tc.BusinessProcess} is not part of the pilot (later extension).`, path: [] };
    }
    const variant = model.variants.find((v) => v.Variant === tc.ProcessVariant);
    if (!variant) {
        return { status: ASSIGNMENT.OPEN, note: `Process variant ${tc.ProcessVariant} does not exist in ${tc.BusinessProcess}.`, path: [] };
    }
    if (variant.PilotScope !== catalog.PILOT) {
        return { status: ASSIGNMENT.OPEN, note: `Process variant ${tc.ProcessVariant} (${variant.VariantName}) is a later API extension, not part of the pilot.`, variant, path: [] };
    }
    const { path, endObjectInPath, startObjectInPath } = catalog.section(catalog.variantPath(model.steps, variant.Variant), tc.StartObject, tc.EndObject);
    if (!endObjectInPath) {
        return { status: ASSIGNMENT.OPEN, note: `End object ${tc.EndObject} is not part of variant ${variant.Variant}.`, variant, path };
    }
    if (!startObjectInPath) {
        return { status: ASSIGNMENT.OPEN, note: `Start object ${tc.StartObject} is not part of variant ${variant.Variant} up to ${tc.EndObject}.`, variant, path };
    }
    const notes = [];
    const openSteps = path.filter((step) => step.TeamAssignment === ASSIGNMENT.OPEN).map((step) => step.StepID);
    const assumedSteps = path.filter((step) => step.TeamAssignment === ASSIGNMENT.ASSUMED).map((step) => step.StepID);
    if (openSteps.length) {
        notes.push(`team open for ${openSteps.join(', ')}`);
    }
    if (assumedSteps.length) {
        notes.push(`team assumed for ${assumedSteps.join(', ')}`);
    }
    const involved = model.process.OwnerTeam === tc.ProcessTeam || path.some((step) => step.ResponsibleTeam === tc.ProcessTeam);
    if (!involved) {
        return {
            status: ASSIGNMENT.ASSUMED,
            note: [`${tc.ProcessTeam} is responsible for none of the steps of this path – confirm the assignment`, ...notes].join('; ') + '.',
            variant,
            path
        };
    }
    return { status: ASSIGNMENT.ASSIGNED, note: notes.length ? `Assigned; ${notes.join('; ')}.` : 'Assigned.', variant, path };
}

module.exports = { assignmentOf };
