sap.ui.define([], function () {
    "use strict";

    /**
     * Text matching for the master data search of the agent tools and for the answers of the rule-based agent.
     * Pure functions (no UI5 dependencies): normalization, tokens without German filler words, token score.
     */

    const STOPWORDS = new Set(
        (
            "der die das den dem des ein eine einen einem einer eines im in am an auf aus bei beim von vom zu zum zur und oder " +
            "mit fuer ist sind war nicht kein keine es sich dass da hier bitte frau herr familie wohnung haus seit noch mehr " +
            "nichts ganz schon wie was wer wo welche welcher welches the of at on for"
        ).split(" ")
    );

    /** lower case, umlauts and ß transliterated, "str." expanded, punctuation removed */
    function normalize(text) {
        return String(text === undefined || text === null ? "" : text)
            .toLowerCase()
            .replace(/ä/g, "ae")
            .replace(/ö/g, "oe")
            .replace(/ü/g, "ue")
            .replace(/ß/g, "ss")
            .replace(/str\.\s*/g, "strasse ")
            .replace(/[^a-z0-9]+/g, " ")
            .trim();
    }

    /** significant tokens of a text (no filler words, no single characters) */
    function tokens(text) {
        return normalize(text)
            .split(" ")
            .filter(function (t) {
                return t.length > 1 && !STOPWORDS.has(t);
            });
    }

    /**
     * Score of a haystack for query tokens: 2 per token found as a word, 1 per token found as part of a word (≥ 3 characters).
     *
     * @param {string[]} queryTokens tokens of the query
     * @param {string} haystack text to search in
     * @returns {{score: number, matched: number}} score and number of matched tokens
     */
    function score(queryTokens, haystack) {
        const words = new Set(normalize(haystack).split(" "));
        const text = " " + Array.from(words).join(" ") + " ";
        let total = 0;
        let matched = 0;
        for (const token of queryTokens) {
            if (words.has(token)) {
                total += 2;
                matched++;
            } else if (token.length >= 3 && text.indexOf(token) > -1) {
                total += 1;
                matched++;
            }
        }
        return { score: total, matched: matched };
    }

    /**
     * Ranks entries by a query: best first, only entries with at least one matched token.
     *
     * @param {object[]} entries entries
     * @param {string} query query text
     * @param {Function} textOf entry → searchable text
     * @param {number} [limit] maximum number of results
     * @returns {Array<{entry: object, score: number, matched: number}>} ranked entries
     */
    function rank(entries, query, textOf, limit) {
        const queryTokens = tokens(query);
        if (queryTokens.length === 0) {
            return entries.slice(0, limit || entries.length).map(function (entry) {
                return { entry: entry, score: 0, matched: 0 };
            });
        }
        return entries
            .map(function (entry) {
                return Object.assign({ entry: entry }, score(queryTokens, textOf(entry)));
            })
            .filter(function (r) {
                return r.matched > 0;
            })
            .sort(function (a, b) {
                return b.score - a.score || b.matched - a.matched;
            })
            .slice(0, limit || entries.length);
    }

    return { normalize: normalize, tokens: tokens, score: score, rank: rank };
});
