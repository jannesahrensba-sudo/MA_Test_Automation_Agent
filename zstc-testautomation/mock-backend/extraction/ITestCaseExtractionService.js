'use strict';
/**
 * ITestCaseExtractionService — contract of the (optional) free-text extraction.
 *
 * The structured, table-driven capture is the primary way to enter a test case. The free text
 * "Describe Test Scenario" + action "analyze" is a convenience that pre-fills fields.
 *
 * Implementations:
 *   - MockTestCaseExtractionService (this project): deterministic keyword/token matching against the
 *     master data pools. NO language model.
 *   - real implementation: open (project decision, not an SAP standard component).
 */
class ITestCaseExtractionService {
    /**
     * Extracts field proposals from a free-text scenario description.
     *
     * @param {string} text free text
     * @param {object} pools value help pools
     * @returns {{proposals: Array<{field:string, value:any, candidates:string[], status:'SUCCESS'|'WARNING', source:string, matchedText:string}>}}
     *          proposals per field; status WARNING = several plausible candidates
     */
    // eslint-disable-next-line no-unused-vars
    extract(text, pools) {
        throw new Error('ITestCaseExtractionService.extract must be implemented');
    }
}

module.exports = { ITestCaseExtractionService };
