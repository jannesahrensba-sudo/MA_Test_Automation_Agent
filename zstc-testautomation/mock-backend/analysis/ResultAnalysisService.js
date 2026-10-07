'use strict';
/**
 * ResultAnalysisService — deterministic analysis of a finished run ("why did it fail, who should look at it, what to
 * do"). It only uses the evidence of the run (steps, assertions, documents, technical log), the test data, the mock price
 * list and the previous run of the same test case; it never guesses beyond that evidence. Every finding names its
 * evidence and a confidence:
 *   HIGH    the evidence proves the cause (e.g. the deviation equals exactly one hour of the service product)
 *   MEDIUM  the evidence fits a known cause, other causes are possible
 *   LOW     only a hint (e.g. something changed since the last passed run)
 * The service assistant discusses these findings ("validated"): a language model explains them, it does not invent
 * other causes. In the real system the same rules run on the real documents and logs (⚠ data access to be clarified).
 *
 * Finding codes (FindingCode, parameters as JSON for the agent):
 *   ALL_PASSED · NET_VALUE_DEVIATION · NET_VALUE_IN_TOLERANCE · STATUS_MISMATCH · FIELD_MISMATCH · FLOW_INCOMPLETE ·
 *   MATERIAL_BLOCKED · POSTING_MISSING · STEP_ERROR · CONTRACT_INVALID · CANCELLED · HANDOVER · REGRESSION · FIXED ·
 *   SAME_AS_BEFORE
 */
const pricing = require('../common/pricing');
const { RESULT, ASSERTION, STEP_STATUS, BO_LABEL, criticalityOf } = require('../common/codes');

const CATEGORY = Object.freeze({
    RESULT: 'RESULT',
    DEVIATION: 'DEVIATION',
    TECHNICAL: 'TECHNICAL',
    PRECONDITION: 'PRECONDITION',
    HANDOVER: 'HANDOVER',
    REGRESSION: 'REGRESSION'
});
const SEVERITY = Object.freeze({ ERROR: 'ERROR', WARNING: 'WARNING', INFO: 'INFO', SUCCESS: 'SUCCESS' });
const CONFIDENCE = Object.freeze({ HIGH: 'HIGH', MEDIUM: 'MEDIUM', LOW: 'LOW' });
const PASSED = new Set([RESULT.PASSED, RESULT.PASSED_WITH_WARNING]);

const label = (code) => BO_LABEL[code] || code || '';
const amount = (text) => {
    const match = String(text || '').replace(/,/g, '').match(/-?\d+(\.\d+)?/);
    return match ? Number(match[0]) : NaN;
};
const money = (value, currency = 'EUR') => `${Number(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;

/**
 * Explains a net value deviation with the mock price list: which quantity of which item makes up the difference.
 *
 * @param {number} delta actual − expected
 * @param {object} data test data
 * @returns {{text: string, exact: boolean, product: string, quantity: number, unit: string, price: number}|undefined} explanation
 */
function explainDelta(delta, data) {
    const candidates = [
        [data.ServiceProduct, 'HR', ['hour', 'hours']],
        [data.ServicePart, 'PC', ['piece', 'pieces']]
    ];
    for (const [product, unit, words] of candidates) {
        const entry = product && pricing.unitPrice(product);
        if (!entry || !entry.price) {
            continue;
        }
        const quantity = delta / entry.price;
        // whole pieces, quarter hours
        const step = unit === 'HR' ? 0.25 : 1;
        if (Math.abs(quantity) >= step && Math.abs(quantity / step - Math.round(quantity / step)) < 1e-6) {
            return {
                text: `${Math.abs(quantity)} ${Math.abs(quantity) === 1 ? words[0] : words[1]} of ${product} (${money(entry.price, entry.currency)} per ${words[0]})`,
                exact: true,
                product,
                quantity,
                unit,
                price: entry.price
            };
        }
    }
    return undefined;
}

/**
 * @param {object} input input
 * @param {object} input.testCase TestCase (active)
 * @param {object} input.data TestCaseData
 * @param {object} input.execution Execution row (finished)
 * @param {object[]} input.steps ExecutionStep rows {Sequence, BusinessObjectType, ExecutionStatus, ExpectedStatus, ActualStatus, Message, ProcessStepID, StepName, ResponsibleTeam}
 * @param {object[]} input.assertions TestAssertion rows
 * @param {object[]} input.documents DocumentReference rows
 * @param {object} [input.previous] previous finished run of the same test case {execution, changes: string[], lastPassed?, changesSincePassed?}
 * @param {Function} [input.teamOf] processStepID → responsible team
 * @returns {{headline: string, findings: object[]}} analysis
 */
function analyzeRun({ testCase, data, execution, steps, assertions, documents, previous, teamOf = () => '' }) {
    const findings = [];
    const add = (finding) =>
        findings.push({
            Category: finding.category,
            Severity: finding.severity,
            Criticality: criticalityOf(finding.severity),
            FindingCode: finding.code,
            ProcessStepID: finding.step?.ProcessStepID || finding.step?.processStepID || '',
            StepName: finding.step?.StepName || finding.step?.stepName || '',
            ResponsibleTeam: finding.team ?? (finding.step ? finding.step.ResponsibleTeam || teamOf(finding.step.ProcessStepID) || '' : ''),
            Finding: finding.finding.slice(0, 255),
            ProbableCause: (finding.cause || '').slice(0, 255),
            Recommendation: (finding.recommendation || '').slice(0, 255),
            Evidence: (finding.evidence || '').slice(0, 255),
            Confidence: finding.confidence || CONFIDENCE.MEDIUM,
            Parameters: JSON.stringify(finding.params || {})
        });
    const result = execution.FunctionalResult;
    const stepOf = (processStepID) => steps.find((s) => s.ProcessStepID === processStepID) || { ProcessStepID: processStepID, StepName: '' };
    const created = documents.filter((d) => d.DocumentOrigin !== 'TAKEN_OVER');
    const takenOver = documents.filter((d) => d.DocumentOrigin === 'TAKEN_OVER');

    // handover from a predecessor test case
    if (execution.PredecessorExecution) {
        add({
            category: CATEGORY.HANDOVER,
            severity: SEVERITY.INFO,
            code: 'HANDOVER',
            team: '',
            finding: `The run continued with ${takenOver.map((d) => `${label(d.BusinessObjectType)} ${d.DocumentID}`).join(', ') || 'the documents'} of ${execution.PredecessorExecution}.`,
            cause: '',
            recommendation: 'If the first own step fails, check the handed-over document in the run of the predecessor test case first.',
            evidence: `Taken over: ${takenOver.map((d) => d.DocumentID).join(', ')}`,
            confidence: CONFIDENCE.HIGH,
            params: { from: execution.PredecessorExecution, documents: takenOver.map((d) => ({ type: d.BusinessObjectType, id: d.DocumentID })) }
        });
    }

    if (result === RESULT.PASSED) {
        add({
            category: CATEGORY.RESULT,
            severity: SEVERITY.SUCCESS,
            code: 'ALL_PASSED',
            team: '',
            finding: `All ${assertions.length} assertions passed; ${created.length} documents created: ${created.map((d) => d.DocumentID).join(' → ')}.`,
            cause: '',
            recommendation: 'No action needed.',
            evidence: `Final result PASSED, run ${execution.ExternalExecutionID}`,
            confidence: CONFIDENCE.HIGH,
            params: { assertions: assertions.length, documents: created.map((d) => d.DocumentID) }
        });
    }

    // functional deviations: one finding per failed (or warned) assertion; after a technical error or a missing
    // precondition the failed assertions are consequences of that step and are not reported separately
    const functional = result === RESULT.FAILED_FUNCTIONAL || result === RESULT.PASSED_WITH_WARNING;
    for (const assertion of assertions.filter((a) => functional && (a.Result === ASSERTION.FAILED || a.Result === ASSERTION.WARNING))) {
        const step = stepOf(assertion.ProcessStepID);
        const severity = assertion.Result === ASSERTION.FAILED ? SEVERITY.ERROR : SEVERITY.WARNING;
        if (assertion.Field === 'NetValue') {
            const expected = amount(assertion.ExpectedValue);
            const actual = amount(assertion.ActualValue);
            const delta = pricing.round2(actual - expected);
            const priceList = pricing.expectedNetAmount(data);
            const explained = explainDelta(delta, data);
            const consistent = priceList !== undefined && Math.abs(priceList - actual) < 0.005;
            let cause;
            let confidence = CONFIDENCE.MEDIUM;
            if (consistent && explained) {
                cause = `The documents are priced exactly as the test data says (${money(priceList)}); the maintained expectation differs by ${explained.text}.`;
                confidence = CONFIDENCE.HIGH;
            } else if (consistent) {
                cause = `The documents are priced as the test data says (${money(priceList)}); the maintained expectation is not up to date.`;
                confidence = CONFIDENCE.HIGH;
            } else if (explained) {
                cause = `The difference equals ${explained.text}: a quantity or duration differs between test data and documents, or the price changed.`;
            } else {
                cause = 'Pricing in the system differs from the expectation (conditions, price list or discount changed).';
                confidence = CONFIDENCE.LOW;
            }
            add({
                category: CATEGORY.DEVIATION,
                severity,
                code: severity === SEVERITY.ERROR ? 'NET_VALUE_DEVIATION' : 'NET_VALUE_IN_TOLERANCE',
                step,
                // test data and expectation do not match: the team of the test case maintains both; otherwise pricing
                team: consistent ? testCase.ProcessTeam || '' : undefined,
                finding: `Net value ${assertion.ActualValue} instead of ${assertion.ExpectedValue} (difference ${money(delta)}${assertion.Tolerance ? `, tolerance ${assertion.Tolerance}` : ''}).`,
                cause,
                recommendation: consistent
                    ? `If the test data are right, set the expected net value to ${money(actual)}; otherwise correct duration or quantity in the test data.`
                    : 'Compare the pricing of the document with the price conditions of this release; involve the team responsible for pricing.',
                evidence: `Assertion NetValue of ${label(assertion.BusinessObjectType)}: ${assertion.Message}`,
                confidence,
                params: { expected, actual, delta, tolerance: assertion.Tolerance ? amount(assertion.Tolerance) : null, object: assertion.BusinessObjectType, priceList: priceList ?? null, explained: explained ? { product: explained.product, quantity: explained.quantity, unit: explained.unit, price: explained.price } : null }
            });
        } else if (assertion.Field === 'Status') {
            add({
                category: CATEGORY.DEVIATION,
                severity,
                code: 'STATUS_MISMATCH',
                step,
                finding: `${label(assertion.BusinessObjectType)} has status ${assertion.ActualValue || '–'} instead of ${assertion.ExpectedValue}.`,
                cause: 'The document was not processed to the expected status (missing follow-up step, status profile or a blocking error).',
                recommendation: 'Check the step log and the status of the document in the system; compare with the expected status of the process step.',
                evidence: `Assertion Status: ${assertion.Message}`,
                confidence: CONFIDENCE.MEDIUM,
                params: { expected: assertion.ExpectedValue, actual: assertion.ActualValue, object: assertion.BusinessObjectType }
            });
        } else if (assertion.Field === 'DocumentFlow') {
            add({
                category: CATEGORY.DEVIATION,
                severity,
                code: 'FLOW_INCOMPLETE',
                step,
                finding: `Document flow ${assertion.ActualValue || '–'} instead of ${assertion.ExpectedValue}.`,
                cause: 'A document is missing or not linked to its predecessor (copy control or reference fields).',
                recommendation: 'Open the SAP objects of the run and check the predecessor references of the documents.',
                evidence: assertion.Message,
                confidence: CONFIDENCE.MEDIUM,
                params: { expected: assertion.ExpectedValue, actual: assertion.ActualValue, object: assertion.BusinessObjectType }
            });
        } else {
            add({
                category: CATEGORY.DEVIATION,
                severity,
                code: 'FIELD_MISMATCH',
                step,
                finding: `${assertion.Field} of the ${label(assertion.BusinessObjectType)} is ${assertion.ActualValue || '–'} instead of ${assertion.ExpectedValue || '–'}.`,
                cause: 'The document was created with other values than the approved test data (determination in the system or a changed test case).',
                recommendation: 'Compare the test data with the document; if the system determination is intended, adapt the test data.',
                evidence: assertion.Message,
                confidence: CONFIDENCE.MEDIUM,
                params: { field: assertion.Field, expected: assertion.ExpectedValue, actual: assertion.ActualValue, object: assertion.BusinessObjectType }
            });
        }
    }

    // technical failure or missing precondition: the failed step and its message
    const failedStep = steps.find((s) => s.ExecutionStatus === STEP_STATUS.FAILED);
    if (failedStep && result !== RESULT.FAILED_FUNCTIONAL) {
        const message = failedStep.Message || '';
        let finding;
        if (/blocked in plant|material is blocked/i.test(message)) {
            const part = (message.match(/spare part (\S+)/) || [])[1] || data.ServicePart;
            finding = {
                category: CATEGORY.TECHNICAL,
                severity: SEVERITY.ERROR,
                code: 'MATERIAL_BLOCKED',
                cause: `Goods issue for spare part ${part} failed: the material is blocked in the plant (material status).`,
                recommendation: `Unblock ${part} in the plant or choose another spare part in the test data; then run again.`,
                confidence: CONFIDENCE.HIGH,
                params: { part }
            };
        } else if (/Contract determination/i.test(message)) {
            const reason = /expired|not valid on/i.test(message) ? 'expired or not yet valid' : /not released/i.test(message) ? 'not released' : /does not cover/i.test(message) ? 'not covering the reference object' : 'not found';
            finding = {
                category: CATEGORY.PRECONDITION,
                severity: SEVERITY.ERROR,
                code: 'CONTRACT_INVALID',
                cause: `No valid service contract: the contract is ${reason}.`,
                recommendation: 'Extend or release the contract, add the object to its object list, or test this case with a way without contract.',
                confidence: CONFIDENCE.HIGH,
                params: { reason, contract: data.ServiceContract || '' }
            };
        } else if (/not transferred to accounting/i.test(message)) {
            finding = {
                category: CATEGORY.TECHNICAL,
                severity: SEVERITY.ERROR,
                code: 'POSTING_MISSING',
                cause: 'The billing document was not posted to accounting (posting block or account determination).',
                recommendation: 'Check the accounting status of the billing document and the account determination; involve the team responsible for billing and FI.',
                confidence: CONFIDENCE.MEDIUM,
                params: {}
            };
        } else {
            finding = {
                category: CATEGORY.TECHNICAL,
                severity: SEVERITY.ERROR,
                code: 'STEP_ERROR',
                cause: message || 'The step reported an error without details.',
                recommendation: 'Check the technical log of the run and the application log of the document in the system.',
                confidence: CONFIDENCE.LOW,
                params: {}
            };
        }
        add({
            ...finding,
            step: failedStep,
            finding: `Step ${failedStep.Sequence} (${label(failedStep.BusinessObjectType)}) failed: ${message}`,
            evidence: `Step log: ${message}`,
            params: { ...finding.params, sequence: failedStep.Sequence, object: failedStep.BusinessObjectType, message }
        });
    }
    if (execution.Status === 'CANCELLED') {
        add({
            category: CATEGORY.RESULT,
            severity: SEVERITY.WARNING,
            code: 'CANCELLED',
            team: '',
            finding: 'The run was cancelled before it finished.',
            cause: 'Cancelled by a user.',
            recommendation: 'Start the execution again when the cancellation was not intended.',
            evidence: `Run ${execution.ExternalExecutionID}: status CANCELLED`,
            confidence: CONFIDENCE.HIGH,
            params: {}
        });
    }

    // comparison with the previous run of the same test case
    if (previous && previous.execution) {
        const before = previous.execution;
        const now = PASSED.has(result);
        const then = PASSED.has(before.FunctionalResult);
        const where = `${before.ExternalExecutionID}${before.ReleaseID ? ` (release ${before.ReleaseID})` : ''}`;
        if (then && !now) {
            const changes = previous.changes || [];
            add({
                category: CATEGORY.REGRESSION,
                severity: SEVERITY.WARNING,
                code: 'REGRESSION',
                team: '',
                finding: `Regression: the previous run ${where} passed with version ${before.TestCaseVersion}; this run fails with version ${execution.TestCaseVersion}.`,
                cause: changes.length
                    ? `Changed since the passed run: ${changes.join('; ')}.`
                    : `The test case is unchanged${before.ReleaseID !== execution.ReleaseID ? `; the release changed from ${before.ReleaseID || '–'} to ${execution.ReleaseID || '–'}` : ''}: look for changes in the system (customizing, transport, upgrade).`,
                recommendation: changes.length ? 'Check whether the change of the test case is intended; otherwise revert it.' : 'Compare the configuration of the releases; report the deviation to the team of the failing step.',
                evidence: `Previous run ${before.ExternalExecutionID}: ${before.FunctionalResult}`,
                confidence: changes.length ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
                params: { previous: before.ExternalExecutionID, previousRelease: before.ReleaseID || '', previousVersion: before.TestCaseVersion, changes }
            });
        } else if (!then && now) {
            add({
                category: CATEGORY.REGRESSION,
                severity: SEVERITY.SUCCESS,
                code: 'FIXED',
                team: '',
                finding: `Fixed: the previous run ${where} ended with ${before.FunctionalResult}; this run passes.`,
                cause: '',
                recommendation: 'No action needed.',
                evidence: `Previous run ${before.ExternalExecutionID}: ${before.FunctionalResult}`,
                confidence: CONFIDENCE.HIGH,
                params: { previous: before.ExternalExecutionID, previousResult: before.FunctionalResult }
            });
        } else {
            add({
                category: CATEGORY.REGRESSION,
                severity: SEVERITY.INFO,
                code: 'SAME_AS_BEFORE',
                team: '',
                finding: `Same result as the previous run ${where}: ${before.FunctionalResult}.`,
                cause: '',
                recommendation: now ? 'No action needed.' : 'The deviation persists: work on the findings above.',
                evidence: `Previous run ${before.ExternalExecutionID}: ${before.FunctionalResult}`,
                confidence: CONFIDENCE.HIGH,
                params: { previous: before.ExternalExecutionID, previousResult: before.FunctionalResult }
            });
            // the deviation persists over several runs: what changed since the last passed run is still the best hint
            const passed = previous.lastPassed;
            if (!now && passed) {
                const changes = previous.changesSincePassed || [];
                const since = `${passed.ExternalExecutionID}${passed.ReleaseID ? ` (release ${passed.ReleaseID})` : ''}`;
                add({
                    category: CATEGORY.REGRESSION,
                    severity: SEVERITY.WARNING,
                    code: 'REGRESSION',
                    team: '',
                    finding: `Regression: the last passed run ${since} used version ${passed.TestCaseVersion}; this run fails with version ${execution.TestCaseVersion}.`,
                    cause: changes.length
                        ? `Changed since the passed run: ${changes.join('; ')}.`
                        : `The test case is unchanged${passed.ReleaseID !== execution.ReleaseID ? `; the release changed from ${passed.ReleaseID || '–'} to ${execution.ReleaseID || '–'}` : ''}: look for changes in the system (customizing, transport, upgrade).`,
                    recommendation: changes.length ? 'Check whether the change of the test case is intended; otherwise revert it.' : 'Compare the configuration of the releases; report the deviation to the team of the failing step.',
                    evidence: `Last passed run ${passed.ExternalExecutionID}: ${passed.FunctionalResult}`,
                    confidence: changes.length ? CONFIDENCE.MEDIUM : CONFIDENCE.LOW,
                    params: { previous: passed.ExternalExecutionID, previousRelease: passed.ReleaseID || '', previousVersion: passed.TestCaseVersion, changes, lastPassed: true }
                });
            }
        }
    }

    const rank = { ERROR: 0, WARNING: 1, INFO: 2, SUCCESS: 3 };
    const order = { DEVIATION: 0, TECHNICAL: 0, PRECONDITION: 0, RESULT: 1, REGRESSION: 2, HANDOVER: 3 };
    findings.sort((a, b) => rank[a.Severity] - rank[b.Severity] || order[a.Category] - order[b.Category]);
    findings.forEach((f, i) => {
        f.Sequence = i + 1;
    });
    const main = findings.find((f) => f.Severity === SEVERITY.ERROR) || findings.find((f) => f.Severity === SEVERITY.WARNING) || findings[0];
    const headline = main
        ? `${result || execution.Status}: ${main.ProbableCause && main.Severity !== SEVERITY.SUCCESS ? main.ProbableCause : main.Finding}`.slice(0, 255)
        : `${result || execution.Status}`;
    return { headline, findings };
}

module.exports = { analyzeRun, explainDelta, CATEGORY, SEVERITY, CONFIDENCE };
