sap.ui.define([], function () {
    "use strict";

    /**
     * Minimal Markdown for the chat bubbles (sap.m.FormattedText): paragraphs, "- " lists and **bold**.
     * Everything else is escaped; FormattedText sanitizes the result once more.
     */

    function escape(text) {
        return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
    }

    function inline(text) {
        return escape(text).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
    }

    /**
     * @param {string} text answer of the agent
     * @returns {string} HTML for sap.m.FormattedText
     */
    function toHtml(text) {
        const html = [];
        let list = [];
        let paragraph = [];
        const flushList = function () {
            if (list.length) {
                html.push("<ul>" + list.map((item) => "<li>" + inline(item) + "</li>").join("") + "</ul>");
                list = [];
            }
        };
        const flushParagraph = function () {
            if (paragraph.length) {
                html.push("<p>" + paragraph.map(inline).join("<br>") + "</p>");
                paragraph = [];
            }
        };
        String(text || "")
            .replace(/\r/g, "")
            .split("\n")
            .forEach(function (line) {
                const item = line.match(/^\s*[-*•]\s+(.*)$/);
                if (item) {
                    flushParagraph();
                    list.push(item[1]);
                } else if (line.trim() === "") {
                    flushList();
                    flushParagraph();
                } else {
                    flushList();
                    paragraph.push(line.replace(/^#+\s*/, ""));
                }
            });
        flushList();
        flushParagraph();
        return html.join("");
    }

    return { toHtml: toHtml, escape: escape };
});
