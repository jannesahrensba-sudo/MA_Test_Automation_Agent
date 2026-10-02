'use strict';
/**
 * authorization — process team roles of the mockup (server-side checks before approval and execution).
 *
 * Business responsibility and execution authorization are assigned separately per process team (TeamMember):
 *   PROCESS_OWNER  business responsibility: approves the test cases of the team
 *   TEST_EXECUTOR  may run the test cases of the team (single runs and release regression runs)
 * Only active rows count (a team in edit mode keeps its saved roles until it is saved again).
 *
 * Real system (⚠ NOCH ZU VERIFIZIEREN): the check of the RAP facade combines the business role / authorization object of
 * the app with the team function of the user — target: process teams as teams of Responsibility Management.
 */
const { TEAM_ROLE } = require('../common/codes');
const { CATEGORY, MockServiceError } = require('../common/messages');

const ROLE_TEXT = {
    [TEAM_ROLE.PROCESS_OWNER]: 'process owner (business responsibility)',
    [TEAM_ROLE.TEST_EXECUTOR]: 'test executor (execution authorization)'
};

/**
 * @param {object} repo repository
 * @param {string} user user ID
 * @param {string} team process team
 * @returns {Promise<string[]>} roles of the user in the team
 */
async function rolesOf(repo, user, team) {
    if (!team) {
        return [];
    }
    const rows = await repo.find('TeamMember', { ProcessTeam: team, UserID: user, IsActiveEntity: true });
    return [...new Set(rows.map((row) => row.TeamRole))];
}

async function hasRole(repo, user, team, role) {
    return (await rolesOf(repo, user, team)).includes(role);
}

/**
 * Throws an AUTHORIZATION_ERROR when the user lacks the role in the team.
 *
 * @param {object} repo repository
 * @param {object} options options
 * @param {string} options.user user ID
 * @param {string} options.team process team
 * @param {string} options.role required role
 * @param {string} options.action action text for the message
 * @param {number} options.number message number
 */
async function requireRole(repo, { user, team, role, action, number }) {
    if (!(await hasRole(repo, user, team, role))) {
        throw new MockServiceError(
            CATEGORY.AUTHORIZATION_ERROR,
            number,
            `${user} may not ${action}: the role ${ROLE_TEXT[role] || role} in process team ${team || '(none)'} is missing. Roles are maintained in the process team.`
        );
    }
}

module.exports = { ROLE_TEXT, rolesOf, hasRole, requireRole };
