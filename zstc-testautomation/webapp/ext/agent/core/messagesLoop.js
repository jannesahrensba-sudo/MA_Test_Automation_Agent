sap.ui.define([], function () {
    "use strict";

    /**
     * Manual tool-use loop of the Claude Messages API, run in the page: the local proxy /agent-api/messages performs one
     * API request per round (the API key stays on the server), the tools run here against the OData service.
     *
     * The history is append-only (assistant content blocks, including thinking blocks, are passed back unchanged).
     * If a turn fails or is refused, the history is cut back to the state before the turn — earlier turns stay untouched.
     */

    const MAX_ROUNDS = 8;

    function textOf(content) {
        return (content || [])
            .filter(function (block) {
                return block.type === "text";
            })
            .map(function (block) {
                return block.text;
            })
            .join("\n")
            .trim();
    }

    /** tool definition for the Messages API (name, description, input_schema) */
    function apiTool(tool) {
        return { name: tool.name, description: tool.description, input_schema: tool.inputSchema };
    }

    /**
     * @param {object} options options
     * @param {Function} options.send (request, signal) → Messages API response {content, stop_reason, stop_details?}
     * @param {string} options.system system prompt
     * @param {object[]} options.history Messages API history (mutated: this turn is appended)
     * @param {string} options.userContent new user message
     * @param {object[]} options.tools tools {name, description, inputSchema, execute}
     * @param {AbortSignal} [options.signal] stop signal
     * @param {Function} [options.onStep] step callback
     * @returns {Promise<{text: string, stopReason: string, rounds: number}>} final answer
     */
    async function run(options) {
        const history = options.history;
        const start = history.length;
        const byName = new Map(
            options.tools.map(function (tool) {
                return [tool.name, tool];
            })
        );
        const request = { system: options.system, tools: options.tools.map(apiTool) };
        const onStep = options.onStep || function () {};
        history.push({ role: "user", content: options.userContent });
        try {
            for (let round = 1; round <= MAX_ROUNDS; round++) {
                const response = await options.send(Object.assign({ messages: history }, request), options.signal);
                if (response.stop_reason === "refusal") {
                    history.splice(start);
                    return {
                        text: "Diese Anfrage kann ich so nicht bearbeiten. Bitte formulieren Sie die Störungsmeldung sachlich neu.",
                        stopReason: "refusal",
                        rounds: round
                    };
                }
                history.push({ role: "assistant", content: response.content });
                if (response.stop_reason === "pause_turn") {
                    continue;
                }
                const toolUses = (response.content || []).filter(function (block) {
                    return block.type === "tool_use";
                });
                if (response.stop_reason !== "tool_use" || toolUses.length === 0) {
                    return { text: textOf(response.content) || "(keine Antwort)", stopReason: response.stop_reason, rounds: round };
                }
                const narration = textOf(response.content);
                if (narration) {
                    onStep({ icon: "sap-icon://discussion", text: narration });
                }
                // all results of one round in one user message; the tools are serialized (one draft)
                const results = [];
                for (const block of toolUses) {
                    const tool = byName.get(block.name);
                    try {
                        if (!tool) {
                            throw new Error("Unbekanntes Tool " + block.name);
                        }
                        const output = await tool.execute(block.input || {}, { signal: options.signal });
                        results.push({ type: "tool_result", tool_use_id: block.id, content: JSON.stringify(output) });
                    } catch (error) {
                        onStep({ icon: "sap-icon://error", text: block.name + ": " + (error.message || error), state: "Error" });
                        results.push({ type: "tool_result", tool_use_id: block.id, content: "Error: " + (error.message || error), is_error: true });
                    }
                }
                history.push({ role: "user", content: results });
            }
            history.push({ role: "user", content: "Bitte fasse den aktuellen Stand kurz zusammen, ohne weitere Tools aufzurufen." });
            const last = await options.send(Object.assign({ messages: history, tool_choice: { type: "none" } }, request), options.signal);
            history.push({ role: "assistant", content: last.content });
            return { text: textOf(last.content), stopReason: "max_rounds", rounds: MAX_ROUNDS + 1 };
        } catch (error) {
            history.splice(start);
            throw error;
        }
    }

    return { run: run, textOf: textOf, MAX_ROUNDS: MAX_ROUNDS };
});
