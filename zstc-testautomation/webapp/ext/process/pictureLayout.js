sap.ui.define([], function () {
    "use strict";

    /**
     * Process picture ("Prozessbild"): layout and SVG of a process with one swim lane per process team and the process
     * steps in process order (sequence). Pure module without UI5 APIs (unit-testable in Node); the control
     * zstc.testautomation.ext.process.ProcessPicture renders the result (file name differs from the control on purpose:
     * case-insensitive file systems).
     *
     * Modes:
     *   - WAY: the steps of one way (process variant); the section of a test case (start object up to end object, contract
     *     determination before the start included — the same rule as the backend) is highlighted, steps before the start
     *     are taken over from a predecessor test case when the start needs one, results of a run can be shown per step;
     *   - PROCESS: all pilot steps (optionally the later ones) with the connections of all ways; a way can be highlighted,
     *     or the coverage of a test package (steps covered / not covered).
     *
     * The picture shows only what the process model contains: no step, branch condition or team is added.
     */

    const NODE_W = 112;
    const NODE_H = 66;
    /** horizontal: lanes are rows, the steps run from left to right */
    const GAP_X = 30;
    const LANE_H = 104;
    const LANE_LABEL_W = 136;
    /** vertical (narrow containers): lanes are columns, the steps run from top to bottom */
    const GAP_Y = 30;
    const LANE_W = 136;
    const LANE_LABEL_H = 64;
    const TOP = 8;
    const LEGEND_ROW = 22;
    const NAME_CHARS = 18;

    const DOCUMENT_ORDER = ["SERVICE_CONTRACT", "SERVICE_REQUEST", "SERVICE_QUOTATION", "SERVICE_ORDER", "SERVICE_CONFIRMATION", "BILLING_DOC_REQUEST", "BILLING_DOCUMENT", "ACCOUNTING_DOCUMENT"];
    const ABBREVIATION = {
        SERVICE_CONTRACT: "CT",
        SERVICE_REQUEST: "SR",
        SERVICE_QUOTATION: "QT",
        SERVICE_ORDER: "SO",
        SERVICE_CONFIRMATION: "SC",
        BILLING_DOC_REQUEST: "BDR",
        BILLING_DOCUMENT: "BD",
        ACCOUNTING_DOCUMENT: "FI"
    };

    /** German default texts; the control passes the texts of the app's i18n model */
    const TEXTS = {
        decision: "Entscheidung",
        manual: "manuell",
        later: "später",
        start: "Start",
        end: "Ende",
        takenOver: "vom Vorgänger",
        teamOpen: "Team offen",
        assumed: "Zuordnung angenommen",
        legendRun: "im Lauf",
        legendOutside: "nicht im Lauf",
        legendTaken: "vom Vorgänger übernommen",
        legendHandover: "Übergabe zwischen Teams",
        legendPassed: "bestanden",
        legendFailed: "fehlgeschlagen",
        legendNotReached: "nicht erreicht",
        legendWay: "Weg",
        legendCovered: "abgedeckt",
        legendGap: "nicht abgedeckt",
        legendManual: "manuell / Entscheidung",
        legendLater: "später (nicht im Pilot)",
        picture: "Prozessbild",
        stepsInRun: "{0} von {1} Schritten im Lauf",
        stepsCovered: "{0} von {1} automatisierten Schritten abgedeckt",
        inRun: "im Lauf",
        notInRun: "nicht im Lauf",
        covered: "abgedeckt",
        notCovered: "nicht abgedeckt",
        handoverOne: "1 Übergabe",
        handoverMany: "{0} Übergaben",
        empty: "Kein Weg gewählt: Weg und Prozessteam bestimmen die Schritte."
    };

    function format(text, args) {
        return String(text).replace(/\{(\d+)\}/g, function (match, index) {
            return args[Number(index)] === undefined ? match : String(args[Number(index)]);
        });
    }

    function escape(value) {
        return String(value === null || value === undefined ? "" : value)
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function variantsOf(step) {
        return String(step.Variants || "")
            .split(",")
            .map(function (v) {
                return v.trim();
            })
            .filter(Boolean);
    }

    function bySequence(a, b) {
        return (Number(a.Sequence) || 0) - (Number(b.Sequence) || 0) || String(a.StepID).localeCompare(String(b.StepID));
    }

    function wayPath(steps, variant) {
        return steps
            .filter(function (step) {
                return variantsOf(step).indexOf(variant) > -1;
            })
            .sort(bySequence);
    }

    /**
     * Section of a path between start object and end object — the same rule as the backend (processCatalog.section):
     * the path ends with the last step of the end object, starts with the first step of the start object, and contract
     * determination steps before the start stay in the section (precondition, contract reference).
     *
     * @param {object[]} path steps of the way
     * @param {string} [startObject] start object
     * @param {string} [endObject] end object
     * @returns {object[]} steps of the section
     */
    function sectionOf(path, startObject, endObject) {
        let upToEnd = path;
        if (endObject) {
            let last = -1;
            path.forEach(function (step, index) {
                if (step.BusinessObjectType === endObject) {
                    last = index;
                }
            });
            if (last > -1) {
                upToEnd = path.slice(0, last + 1);
            }
        }
        if (!startObject) {
            return upToEnd;
        }
        const first = upToEnd.findIndex(function (step) {
            return step.BusinessObjectType === startObject;
        });
        if (first === -1) {
            return upToEnd;
        }
        return upToEnd
            .slice(0, first)
            .filter(function (step) {
                return step.BusinessObjectType === "SERVICE_CONTRACT";
            })
            .concat(upToEnd.slice(first));
    }

    /** words of a text in at most n lines of max characters (last line shortened with …) */
    function wrap(text, max, lines) {
        const words = String(text || "").split(/\s+/).filter(Boolean);
        const result = [];
        let current = "";
        let index = 0;
        while (index < words.length && result.length < lines) {
            const word = words[index];
            const candidate = current ? current + " " + word : word;
            if (candidate.length <= max) {
                current = candidate;
                index++;
            } else if (!current) {
                current = word.slice(0, max - 1) + "…";
                index++;
            } else {
                result.push(current);
                current = "";
            }
        }
        if (current && result.length < lines) {
            result.push(current);
        }
        if (index < words.length && result.length) {
            const last = result[result.length - 1];
            result[result.length - 1] = (last.length >= max ? last.slice(0, max - 1) : last) + "…";
        }
        return result;
    }

    function kindOf(step) {
        if (step.PilotScope && step.PilotScope !== "PILOT") {
            return "later";
        }
        if (step.Automation === "DECISION") {
            return "decision";
        }
        if (step.Automation === "MANUAL") {
            return "manual";
        }
        if (step.Automation === "PLANNED") {
            return "later";
        }
        return "automated";
    }

    /**
     * Layout of the picture.
     *
     * @param {object} input input
     * @param {object[]} input.steps process steps (StepID, StepName, Sequence, BusinessObjectType, ResponsibleTeam, TeamName, TeamAssignment, Variants, PilotScope, Automation)
     * @param {string} [input.mode] WAY (default with a variant) | PROCESS
     * @param {string} [input.variant] way (WAY: the steps shown; PROCESS: highlighted way)
     * @param {string} [input.startObject] start object of the test case
     * @param {string} [input.endObject] end object of the test case
     * @param {string} [input.predecessorObject] document taken over from the predecessor test case
     * @param {boolean} [input.section] highlight the section (default true with a variant)
     * @param {boolean} [input.showLater] PROCESS: show the steps outside the pilot
     * @param {object} [input.results] StepID → status of a run (DONE, FAILED, SKIPPED, RUNNING, PLANNED)
     * @param {object} [input.checks] StepID → worst result of the test assertions of the step (FAILED, WARNING, PASSED)
     * @param {object} [input.coverage] StepID → number of test cases (PROCESS: coverage of a test package)
     * @param {object} [input.texts] texts
     * @param {string} [input.orientation] horizontal (default) | vertical (narrow containers)
     * @returns {object} layout {width, height, lanes, nodes, edges, legend, summary, empty}
     */
    function layout(input) {
        const texts = Object.assign({}, TEXTS, input.texts || {});
        const all = (input.steps || []).slice().sort(bySequence);
        const mode = input.mode === "PROCESS" || !input.variant ? "PROCESS" : "WAY";
        const way = input.variant ? wayPath(all, input.variant) : [];
        const showSection = input.section !== false && !!input.variant;
        const section = showSection ? sectionOf(way, input.startObject, input.endObject) : [];
        const inSection = new Set(
            section.map(function (s) {
                return s.StepID;
            })
        );
        const onWay = new Set(
            way.map(function (s) {
                return s.StepID;
            })
        );
        const coverage = input.coverage || null;
        const results = input.results || null;

        const shown =
            mode === "WAY"
                ? way
                : all.filter(function (s) {
                      return input.showLater || s.PilotScope === "PILOT" || onWay.has(s.StepID);
                  });
        if (!shown.length) {
            return { width: 640, height: 60, lanes: [], nodes: [], edges: [], legend: [], summary: { total: 0, inRun: 0, teams: [] }, empty: texts.empty, texts: texts };
        }
        const shownIds = new Set(
            shown.map(function (s) {
                return s.StepID;
            })
        );

        // connections: consecutive steps of the way (WAY) or of every way shown (PROCESS); the sequence orders every way
        const pairs = [];
        const seen = new Set();
        const addPath = function (path, variant) {
            for (let i = 1; i < path.length; i++) {
                const key = path[i - 1].StepID + ">" + path[i].StepID;
                if (shownIds.has(path[i - 1].StepID) && shownIds.has(path[i].StepID) && !seen.has(key)) {
                    seen.add(key);
                    pairs.push({ from: path[i - 1].StepID, to: path[i].StepID, variant: variant });
                }
            }
        };
        if (mode === "WAY") {
            addPath(way, input.variant);
        } else {
            const variants = [];
            shown.forEach(function (step) {
                variantsOf(step).forEach(function (v) {
                    if (variants.indexOf(v) === -1) {
                        variants.push(v);
                    }
                });
            });
            variants.forEach(function (variant) {
                const path = wayPath(shown, variant);
                const pilot = path.every(function (s) {
                    return s.PilotScope === "PILOT";
                });
                if (pilot || input.showLater || variant === input.variant) {
                    addPath(path, variant);
                }
            });
        }

        // columns: WAY = position on the way; PROCESS = layers of the connections (longest path, long edges shortened)
        const column = new Map();
        if (mode === "WAY") {
            shown.forEach(function (step, index) {
                column.set(step.StepID, index);
            });
        } else {
            const parents = new Map();
            const children = new Map();
            shown.forEach(function (step) {
                parents.set(step.StepID, []);
                children.set(step.StepID, []);
            });
            pairs.forEach(function (pair) {
                parents.get(pair.to).push(pair.from);
                children.get(pair.from).push(pair.to);
            });
            shown.forEach(function (step) {
                const before = parents.get(step.StepID).map(function (id) {
                    return column.get(id);
                });
                column.set(step.StepID, before.length ? Math.max.apply(null, before) + 1 : 0);
            });
            shown
                .slice()
                .reverse()
                .forEach(function (step) {
                    const after = children.get(step.StepID).map(function (id) {
                        return column.get(id);
                    });
                    if (after.length) {
                        const latest = Math.min.apply(null, after) - 1;
                        if (latest > column.get(step.StepID)) {
                            column.set(step.StepID, latest);
                        }
                    }
                });
        }

        // lanes: teams in order of their first step (an open assignment is its own lane); alternatives in the same lane and
        // column get their own row
        const laneKeys = [];
        const laneInfo = {};
        const laneKey = function (step) {
            return step.TeamAssignment === "OPEN" || !step.ResponsibleTeam ? "" : step.ResponsibleTeam;
        };
        shown.forEach(function (step) {
            const key = laneKey(step);
            if (laneKeys.indexOf(key) === -1) {
                laneKeys.push(key);
                laneInfo[key] = { key: key, name: key ? step.TeamName || key : texts.teamOpen, assumed: false, rows: 1 };
            }
            if (step.TeamAssignment === "ASSUMED") {
                laneInfo[key].assumed = true;
            }
        });
        const row = new Map();
        const occupied = new Set();
        shown.forEach(function (step) {
            const key = laneKey(step);
            let r = 0;
            while (occupied.has(key + "|" + column.get(step.StepID) + "|" + r)) {
                r++;
            }
            occupied.add(key + "|" + column.get(step.StepID) + "|" + r);
            row.set(step.StepID, r);
            laneInfo[key].rows = Math.max(laneInfo[key].rows, r + 1);
        });
        const vertical = input.orientation === "vertical";
        const laneSize = vertical ? LANE_W : LANE_H;
        let laneStart = vertical ? 4 : TOP;
        const lanes = laneKeys.map(function (key, index) {
            const lane = Object.assign({}, laneInfo[key], { start: laneStart, size: laneInfo[key].rows * laneSize, index: index });
            laneStart += lane.size;
            return lane;
        });
        const lanesExtent = laneStart - (vertical ? 4 : TOP);
        const columns =
            Math.max.apply(
                null,
                shown.map(function (s) {
                    return column.get(s.StepID);
                })
            ) + 1;
        const pitch = vertical ? NODE_H + GAP_Y : NODE_W + GAP_X;
        const gap = vertical ? GAP_Y : GAP_X;
        const width = vertical ? laneStart + 4 : LANE_LABEL_W + columns * pitch + 12;
        const flowEnd = vertical ? LANE_LABEL_H + columns * pitch : TOP + lanesExtent;
        /** position of a step: main axis = process order, cross axis = lane and row */
        const place = function (step, lane) {
            const main = column.get(step.StepID) * pitch + gap / 2;
            const cross = lanes[lane].start + row.get(step.StepID) * laneSize + (laneSize - (vertical ? NODE_W : NODE_H)) / 2;
            return vertical ? { x: cross, y: LANE_LABEL_H + main } : { x: LANE_LABEL_W + main, y: cross };
        };

        // predecessor: documents before the start come from the predecessor test case (handover)
        const takenOverTypes = input.predecessorObject ? DOCUMENT_ORDER.slice(0, DOCUMENT_ORDER.indexOf(input.predecessorObject) + 1) : [];
        const firstInSection = section.length ? section[0].StepID : "";
        const lastInSection = section.length ? section[section.length - 1].StepID : "";
        const startStep =
            section.find(function (s) {
                return s.BusinessObjectType === input.startObject;
            }) || section[0];
        const startIndex = startStep ? way.indexOf(startStep) : -1;
        let takenFlag = false;

        const nodes = shown.map(function (step) {
            const lane = laneKeys.indexOf(laneKey(step));
            const kind = kindOf(step);
            let state;
            if (coverage) {
                if (kind === "automated") {
                    state = coverage[step.StepID] ? "covered" : "gap";
                } else if (kind === "later") {
                    state = "off";
                } else {
                    state = coverage[step.StepID] ? "covered" : "neutral";
                }
            } else if (showSection) {
                if (inSection.has(step.StepID)) {
                    state = "run";
                } else if (onWay.has(step.StepID)) {
                    const index = way.indexOf(step);
                    if (index < startIndex && input.predecessorObject && (takenOverTypes.indexOf(step.BusinessObjectType) > -1 || !step.BusinessObjectType)) {
                        state = "taken";
                    } else {
                        state = index < startIndex ? "before" : "after";
                    }
                } else {
                    state = "off";
                }
            } else if (input.variant) {
                state = onWay.has(step.StepID) ? "way" : "off";
            } else {
                state = "neutral";
            }
            const result = results && inSection.has(step.StepID) ? resultOf(step, kind, results, section, input.checks || {}) : "";
            const flag = step.StepID === firstInSection ? texts.start : step.StepID === lastInSection ? texts.end : state === "taken" && !takenFlag ? texts.takenOver : "";
            if (state === "taken") {
                takenFlag = true;
            }
            return {
                id: step.StepID,
                step: step,
                kind: kind,
                state: state,
                result: result,
                x: place(step, lane).x,
                y: place(step, lane).y,
                w: NODE_W,
                h: NODE_H,
                column: column.get(step.StepID),
                lane: lane,
                row: row.get(step.StepID),
                lines: wrap(step.StepName, NAME_CHARS, 2),
                meta:
                    kind === "decision"
                        ? texts.decision
                        : kind === "manual"
                        ? texts.manual
                        : kind === "later"
                        ? texts.later
                        : ABBREVIATION[step.BusinessObjectType] || step.BusinessObjectType || "",
                flag: flag,
                flagClass: step.StepID === lastInSection && step.StepID !== firstInSection ? "end" : flag === texts.takenOver ? "taken" : ""
            };
        });
        const byId = new Map(
            nodes.map(function (n) {
                return [n.id, n];
            })
        );

        let channelUse = 0;
        const edges = pairs.map(function (pair) {
            const a = byId.get(pair.from);
            const b = byId.get(pair.to);
            // exit at the end of the source, entry at the start of the target (along the process order)
            const p1 = vertical ? [a.x + NODE_W / 2, a.y + NODE_H] : [a.x + NODE_W, a.y + NODE_H / 2];
            const p2 = vertical ? [b.x + NODE_W / 2, b.y] : [b.x, b.y + NODE_H / 2];
            const point = function (main, cross) {
                return vertical ? [cross, main] : [main, cross];
            };
            const m1 = vertical ? p1[1] : p1[0];
            const m2 = vertical ? p2[1] : p2[0];
            const c1 = vertical ? p1[0] : p1[1];
            const c2 = vertical ? p2[0] : p2[1];
            let points;
            if (b.column === a.column + 1) {
                const mid = m1 + gap / 2;
                points = c1 === c2 ? [p1, p2] : [p1, point(mid, c1), point(mid, c2), p2];
            } else {
                // longer connection: through the free channel at the lane border; the turns lie next to the nodes, the
                // elbows of neighbouring steps use the middle of the gap
                const offset = (channelUse++ % 3) * 4;
                const laneA = lanes[a.lane];
                const channel = b.lane > a.lane ? laneA.start + laneA.size - 4 - offset : laneA.start + 4 + offset;
                const ma = m1 + gap / 2 - 7;
                const mb = m2 - gap / 2 + 7;
                points = [p1, point(ma, c1), point(ma, channel), point(mb, channel), point(mb, c2), p2];
            }
            let state;
            if (coverage) {
                state = "neutral";
            } else if (showSection && inSection.has(a.id) && inSection.has(b.id)) {
                state = "run";
            } else if (input.variant && onWay.has(a.id) && onWay.has(b.id) && wayContains(way, a.id, b.id)) {
                state = showSection ? "muted" : "way";
            } else {
                // nothing highlighted: plain connections
                state = input.variant ? "muted" : "neutral";
            }
            return {
                from: a.id,
                to: b.id,
                points: points,
                state: state,
                handover: a.lane !== b.lane && (state === "run" || state === "way"),
                toTeam: b.step.TeamName || b.step.ResponsibleTeam || texts.teamOpen
            };
        });

        const automatedShown = nodes.filter(function (n) {
            return n.kind === "automated";
        });
        const summary = {
            total: nodes.length,
            inRun: nodes.filter(function (n) {
                return n.state === "run";
            }).length,
            covered: automatedShown.filter(function (n) {
                return n.state === "covered";
            }).length,
            automated: automatedShown.length,
            handovers: edges.filter(function (e) {
                return e.handover && e.state === "run";
            }).length,
            teams: lanes.map(function (lane) {
                return lane.name;
            }),
            first: firstInSection,
            last: lastInSection
        };

        const legend = [];
        if (coverage) {
            legend.push({ cls: "covered", text: texts.legendCovered }, { cls: "gap", text: texts.legendGap });
        } else if (showSection) {
            legend.push({ cls: "run", text: texts.legendRun }, { cls: "before", text: texts.legendOutside });
            if (
                nodes.some(function (n) {
                    return n.state === "taken";
                })
            ) {
                legend.push({ cls: "taken", text: texts.legendTaken });
            }
            if (
                nodes.some(function (n) {
                    return n.result;
                })
            ) {
                legend.push({ cls: "passed", text: texts.legendPassed }, { cls: "failed", text: texts.legendFailed }, { cls: "notReached", text: texts.legendNotReached });
            }
        } else if (input.variant) {
            legend.push({ cls: "way", text: texts.legendWay });
        }
        if (
            edges.some(function (e) {
                return e.handover;
            })
        ) {
            legend.push({ cls: "handover", text: texts.legendHandover });
        }
        if (
            nodes.some(function (n) {
                return n.kind === "manual" || n.kind === "decision";
            })
        ) {
            legend.push({ cls: "manual", text: texts.legendManual });
        }
        if (
            nodes.some(function (n) {
                return n.kind === "later";
            })
        ) {
            legend.push({ cls: "later", text: texts.legendLater });
        }

        // legend below the lanes, wrapped to the width of the picture
        let lx = 10;
        let ly = flowEnd + 10;
        const legendItems = legend.map(function (entry) {
            const entryWidth = 40 + entry.text.length * 6.2;
            if (lx > 10 && lx + entryWidth > width) {
                lx = 10;
                ly += LEGEND_ROW;
            }
            const item = Object.assign({ x: lx, y: ly }, entry);
            lx += entryWidth;
            return item;
        });

        return {
            mode: mode,
            orientation: vertical ? "vertical" : "horizontal",
            width: width,
            height: (legendItems.length ? ly + LEGEND_ROW : flowEnd) + 6,
            flowEnd: flowEnd,
            lanes: lanes,
            nodes: nodes,
            edges: edges,
            legend: legendItems,
            summary: summary,
            texts: texts
        };
    }

    function wayContains(way, a, b) {
        for (let i = 1; i < way.length; i++) {
            if (way[i - 1].StepID === a && way[i].StepID === b) {
                return true;
            }
        }
        return false;
    }

    /**
     * result of a step in a run: automated steps by their execution status and the test assertions of the step (a document
     * created with a wrong value fails the step); decisions and manual steps are passed when a later step was reached
     */
    function resultOf(step, kind, results, section, checks) {
        const status = results[step.StepID];
        if (kind === "automated") {
            if (status === "DONE") {
                return checks[step.StepID] === "FAILED" ? "failed" : "passed";
            }
            return status === "FAILED" ? "failed" : status === "RUNNING" ? "" : "notReached";
        }
        const index = section.indexOf(step);
        const reachedLater = section.slice(index + 1).some(function (s) {
            return results[s.StepID] === "DONE" || results[s.StepID] === "FAILED";
        });
        return reachedLater ? "passed" : "";
    }

    const STYLE =
        ".zstcPp{display:block}" +
        ".zstcPp text{font-family:var(--sapFontFamily,'72',Arial,sans-serif);fill:var(--sapTextColor,#131e29)}" +
        ".zstcPp .lane{fill:var(--sapList_Background,#fff)}.zstcPp .lane.alt{fill:var(--sapList_AlternatingBackground,#f5f6f7)}" +
        ".zstcPp .laneLine{stroke:var(--sapList_BorderColor,#e5e5e5)}" +
        ".zstcPp .laneName{font-size:12px;font-weight:bold}.zstcPp .laneSub{font-size:10px;fill:var(--sapContent_LabelColor,#556b82)}" +
        ".zstcPp .box{fill:var(--sapTile_Background,#fff);stroke:var(--sapList_BorderColor,#c4c9cf);stroke-width:1}" +
        ".zstcPp .sid{font-size:10.5px;font-weight:bold;fill:var(--sapContent_LabelColor,#556b82)}" +
        ".zstcPp .name{font-size:11px}.zstcPp .meta{font-size:10px;fill:var(--sapContent_LabelColor,#556b82)}" +
        ".zstcPp .n-run .box,.zstcPp .n-way .box,.zstcPp .n-covered .box{stroke:var(--sapBrandColor,#0070f2);stroke-width:2}" +
        ".zstcPp .n-way .box{stroke-width:1.5}" +
        ".zstcPp .n-before .box,.zstcPp .n-after .box{fill:var(--sapNeutralBackgroundColor,#eff1f2);stroke-dasharray:4 3}" +
        ".zstcPp .n-before text,.zstcPp .n-after text,.zstcPp .n-off text{fill:var(--sapContent_LabelColor,#556b82)}" +
        ".zstcPp .n-taken .box{fill:var(--sapInformationBackgroundColor,#e1f4ff);stroke:var(--sapInformativeElementColor,#0070f2);stroke-dasharray:4 3}" +
        ".zstcPp .n-off{opacity:.45}" +
        ".zstcPp .n-gap .box{stroke:var(--sapCriticalElementColor,#e76500);stroke-width:2;stroke-dasharray:5 3}" +
        ".zstcPp .k-manual .box{stroke-dasharray:6 3}.zstcPp .k-later .box{stroke-dasharray:2 3}.zstcPp .k-later text{fill:var(--sapContent_LabelColor,#556b82)}" +
        ".zstcPp .r-passed .box{stroke:var(--sapPositiveElementColor,#30914c)}.zstcPp .r-failed .box{stroke:var(--sapNegativeElementColor,#d20a0a)}" +
        ".zstcPp .badge{fill:var(--sapContent_LabelColor,#556b82)}.zstcPp .badge.passed{fill:var(--sapPositiveElementColor,#30914c)}" +
        ".zstcPp .badge.failed{fill:var(--sapNegativeElementColor,#d20a0a)}.zstcPp .badge.notReached{fill:var(--sapNeutralElementColor,#788fa6)}" +
        ".zstcPp .badgeMark{stroke:#fff;stroke-width:1.6;fill:none;stroke-linecap:round}" +
        ".zstcPp .diamond{fill:var(--sapCriticalElementColor,#e76500)}" +
        ".zstcPp .edge{fill:none;stroke:var(--sapContent_ForegroundBorderColor,#758ca4);stroke-width:1.5}" +
        ".zstcPp .e-muted{stroke-dasharray:4 3;opacity:.7}.zstcPp .e-run,.zstcPp .e-way{stroke:var(--sapBrandColor,#0070f2);stroke-width:2}" +
        ".zstcPp .handover{fill:var(--sapCriticalElementColor,#e76500);stroke:var(--sapTile_Background,#fff);stroke-width:1.5}" +
        ".zstcPp .flag rect{fill:var(--sapBrandColor,#0070f2)}.zstcPp .flag.end rect{fill:var(--sapTextColor,#131e29)}.zstcPp .flag.taken rect{fill:var(--sapInformativeElementColor,#0070f2)}" +
        ".zstcPp .flag text{fill:#fff;font-size:9.5px;font-weight:bold}" +
        ".zstcPp .node{cursor:pointer;outline:none}.zstcPp .focus{fill:none;stroke:none}" +
        ".zstcPp .node:focus .focus,.zstcPp .node:hover .focus{stroke:var(--sapContent_FocusColor,#0032a5);stroke-width:2;stroke-dasharray:3 2}" +
        ".zstcPp .legend text{font-size:11px;fill:var(--sapContent_LabelColor,#556b82)}" +
        ".zstcPp .sw{fill:var(--sapTile_Background,#fff);stroke:var(--sapList_BorderColor,#c4c9cf)}" +
        ".zstcPp .sw.run,.zstcPp .sw.way,.zstcPp .sw.covered{stroke:var(--sapBrandColor,#0070f2);stroke-width:2}" +
        ".zstcPp .sw.before{fill:var(--sapNeutralBackgroundColor,#eff1f2);stroke-dasharray:3 2}" +
        ".zstcPp .sw.taken{fill:var(--sapInformationBackgroundColor,#e1f4ff);stroke:var(--sapInformativeElementColor,#0070f2);stroke-dasharray:3 2}" +
        ".zstcPp .sw.gap{stroke:var(--sapCriticalElementColor,#e76500);stroke-width:2;stroke-dasharray:3 2}" +
        ".zstcPp .sw.manual{stroke-dasharray:4 2}.zstcPp .sw.later{stroke-dasharray:1 2}" +
        ".zstcPp .sw.passed{stroke:var(--sapPositiveElementColor,#30914c);stroke-width:2}.zstcPp .sw.failed{stroke:var(--sapNegativeElementColor,#d20a0a);stroke-width:2}" +
        ".zstcPp .sw.notReached{stroke:var(--sapNeutralElementColor,#788fa6);stroke-width:2}" +
        ".zstcPp .sw.handover{fill:var(--sapCriticalElementColor,#e76500);stroke:none}" +
        ".zstcPp .empty{font-size:12px;fill:var(--sapContent_LabelColor,#556b82)}";

    function ariaOfNode(node, texts) {
        const step = node.step;
        const state = node.state === "run" ? texts.inRun : node.state === "covered" ? texts.covered : node.state === "gap" ? texts.notCovered : node.state === "taken" ? texts.legendTaken : node.state === "neutral" || node.state === "way" ? "" : texts.notInRun;
        return [step.StepID, step.StepName, step.TeamName || step.ResponsibleTeam || texts.teamOpen, node.meta, state, node.result ? texts["legend" + node.result.charAt(0).toUpperCase() + node.result.slice(1)] : ""]
            .filter(Boolean)
            .join(", ");
    }

    /**
     * SVG of a layout (string; every text escaped).
     *
     * @param {object} model result of layout()
     * @param {object} [options] options
     * @param {string} [options.id] unique ID of the picture (marker IDs)
     * @param {string} [options.title] accessible name of the picture
     * @returns {string} SVG markup
     */
    function svg(model, options) {
        const id = (options && options.id) || "zstcPp";
        const texts = model.texts || TEXTS;
        const title = (options && options.title) || texts.picture;
        if (model.empty) {
            return (
                '<svg class="zstcPp" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="' +
                escape(title + ": " + model.empty) +
                '" viewBox="0 0 ' +
                model.width +
                " " +
                model.height +
                '" width="100%" preserveAspectRatio="xMinYMin meet"><style>' +
                STYLE +
                '</style><text class="empty" x="8" y="34">' +
                escape(model.empty) +
                "</text></svg>"
            );
        }
        const out = [];
        const summary = model.summary;
        const caption =
            title +
            ": " +
            (summary.automated && model.nodes.some(function (n) { return n.state === "covered" || n.state === "gap"; })
                ? format(texts.stepsCovered, [summary.covered, summary.automated])
                : summary.inRun
                ? format(texts.stepsInRun, [summary.inRun, summary.total])
                : summary.total + " Schritte") +
            ". " +
            summary.teams.join(", ");
        out.push(
            '<svg class="zstcPp" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="' +
                escape(caption) +
                '" viewBox="0 0 ' +
                model.width +
                " " +
                model.height +
                '" width="100%" preserveAspectRatio="xMinYMin meet">'
        );
        out.push("<style>" + STYLE + "</style>");
        // arrow heads: marker content does not inherit from the connection, so one marker per colour
        const marker = function (name, color) {
            return (
                '<marker id="' + escape(id) + "-" + name + '" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" style="fill:' + color + '"/></marker>'
            );
        };
        out.push("<defs>" + marker("arrow", "var(--sapContent_ForegroundBorderColor,#758ca4)") + marker("arrowRun", "var(--sapBrandColor,#0070f2)") + "</defs>");
        // lanes: rows (horizontal) or columns (vertical) with the name of the process team
        const vertical = model.orientation === "vertical";
        model.lanes.forEach(function (lane) {
            const nameLines = wrap(lane.name, vertical ? 20 : 18, 2);
            const sub = [lane.key, lane.assumed ? texts.assumed : ""].filter(Boolean);
            if (vertical) {
                out.push('<rect class="lane' + (lane.index % 2 ? " alt" : "") + '" x="' + lane.start + '" y="0" width="' + lane.size + '" height="' + model.flowEnd + '"/>');
                out.push('<line class="laneLine" x1="' + (lane.start + lane.size) + '" x2="' + (lane.start + lane.size) + '" y1="0" y2="' + model.flowEnd + '"/>');
                const center = lane.start + lane.size / 2;
                nameLines.forEach(function (line, index) {
                    out.push('<text class="laneName" text-anchor="middle" x="' + center + '" y="' + (14 + index * 13) + '">' + escape(line) + "</text>");
                });
                sub.forEach(function (line, index) {
                    out.push(
                        '<text class="laneSub" text-anchor="middle" x="' + center + '" y="' + (15 + nameLines.length * 13 + index * 11) + '"' + (line === texts.assumed ? ' font-style="italic"' : "") + ">" + escape(line) + "</text>"
                    );
                });
                return;
            }
            out.push('<rect class="lane' + (lane.index % 2 ? " alt" : "") + '" x="0" y="' + lane.start + '" width="' + model.width + '" height="' + lane.size + '"/>');
            out.push('<line class="laneLine" x1="0" x2="' + model.width + '" y1="' + (lane.start + lane.size) + '" y2="' + (lane.start + lane.size) + '"/>');
            const baseY = lane.start + lane.size / 2 - (nameLines.length - 1) * 7 - (sub.length ? 6 * sub.length : 0);
            nameLines.forEach(function (line, index) {
                out.push('<text class="laneName" x="10" y="' + (baseY + index * 14) + '">' + escape(line) + "</text>");
            });
            sub.forEach(function (line, index) {
                out.push('<text class="laneSub" x="10" y="' + (baseY + nameLines.length * 14 + index * 12) + '"' + (line === texts.assumed ? ' font-style="italic"' : "") + ">" + escape(line) + "</text>");
            });
        });
        if (vertical) {
            out.push('<line class="laneLine" x1="0" x2="' + model.width + '" y1="' + (LANE_LABEL_H - 8) + '" y2="' + (LANE_LABEL_H - 8) + '"/>');
        } else {
            out.push('<line class="laneLine" x1="' + (LANE_LABEL_W - 6) + '" x2="' + (LANE_LABEL_W - 6) + '" y1="' + TOP + '" y2="' + model.flowEnd + '"/>');
        }
        // connections
        model.edges.forEach(function (edge) {
            const d = edge.points
                .map(function (p, index) {
                    return (index ? "L" : "M") + p[0] + " " + p[1];
                })
                .join("");
            const arrow = edge.state === "run" || edge.state === "way" ? "-arrowRun" : "-arrow";
            out.push('<path class="edge e-' + edge.state + '" d="' + d + '" marker-end="url(#' + escape(id) + arrow + ')"/>');
        });
        model.edges.forEach(function (edge) {
            if (edge.handover) {
                const p = edge.points.length > 2 ? edge.points[Math.floor(edge.points.length / 2) - 1] : edge.points[0];
                const q = edge.points.length > 2 ? edge.points[Math.floor(edge.points.length / 2)] : edge.points[1];
                out.push('<circle class="handover" cx="' + (p[0] + q[0]) / 2 + '" cy="' + (p[1] + q[1]) / 2 + '" r="6"><title>' + escape(texts.legendHandover + ": " + edge.toTeam) + "</title></circle>");
            }
        });
        // steps
        model.nodes.forEach(function (node) {
            const cls = "node n-" + node.state + " k-" + node.kind + (node.result ? " r-" + node.result : "");
            out.push(
                '<g class="' + cls + '" data-step="' + escape(node.id) + '" tabindex="0" role="button" aria-label="' + escape(ariaOfNode(node, texts)) + '" transform="translate(' + node.x + " " + node.y + ')">'
            );
            out.push("<title>" + escape(node.step.StepID + " " + node.step.StepName) + "</title>");
            out.push('<rect class="focus" x="-4" y="-4" width="' + (node.w + 8) + '" height="' + (node.h + 8) + '" rx="10"/>');
            out.push('<rect class="box" width="' + node.w + '" height="' + node.h + '" rx="8"/>');
            out.push('<text class="sid" x="8" y="15">' + escape(node.id) + "</text>");
            node.lines.forEach(function (line, index) {
                out.push('<text class="name" x="8" y="' + (30 + index * 13) + '">' + escape(line) + "</text>");
            });
            out.push('<text class="meta" x="8" y="' + (node.h - 7) + '">' + escape(node.meta) + "</text>");
            if (node.kind === "decision") {
                out.push('<rect class="diamond" x="' + (node.w - 16) + '" y="6" width="9" height="9" transform="rotate(45 ' + (node.w - 11.5) + ' 10.5)"/>');
            }
            if (node.result) {
                const cx = node.w - 12;
                const cy = node.h - 12;
                out.push('<circle class="badge ' + node.result + '" cx="' + cx + '" cy="' + cy + '" r="7"/>');
                if (node.result === "passed") {
                    out.push('<path class="badgeMark" d="M' + (cx - 3.5) + " " + cy + "L" + (cx - 1) + " " + (cy + 2.5) + "L" + (cx + 3.5) + " " + (cy - 2.5) + '"/>');
                } else if (node.result === "failed") {
                    out.push('<path class="badgeMark" d="M' + (cx - 3) + " " + (cy - 3) + "L" + (cx + 3) + " " + (cy + 3) + "M" + (cx + 3) + " " + (cy - 3) + "L" + (cx - 3) + " " + (cy + 3) + '"/>');
                } else {
                    out.push('<path class="badgeMark" d="M' + (cx - 3.5) + " " + cy + "L" + (cx + 3.5) + " " + cy + '"/>');
                }
            }
            out.push("</g>");
            if (node.flag) {
                const flagWidth = 10 + node.flag.length * 5.6;
                out.push(
                    '<g class="flag' +
                        (node.flagClass ? " " + node.flagClass : "") +
                        '" transform="translate(' +
                        (node.flagClass === "taken" ? node.x + 6 : node.x + node.w - flagWidth - 6) +
                        " " +
                        (node.y - 9) +
                        ')"><rect width="' +
                        flagWidth +
                        '" height="15" rx="7"/><text x="' +
                        flagWidth / 2 +
                        '" y="11" text-anchor="middle">' +
                        escape(node.flag) +
                        "</text></g>"
                );
            }
        });
        // legend
        out.push('<g class="legend">');
        model.legend.forEach(function (entry) {
            if (entry.cls === "handover") {
                out.push('<circle class="sw handover" cx="' + (entry.x + 7) + '" cy="' + (entry.y + 7) + '" r="6"/>');
            } else if (["passed", "failed", "notReached"].indexOf(entry.cls) > -1) {
                out.push('<circle class="badge ' + entry.cls + '" cx="' + (entry.x + 7) + '" cy="' + (entry.y + 7) + '" r="6"/>');
            } else {
                out.push('<rect class="sw ' + entry.cls + '" x="' + entry.x + '" y="' + entry.y + '" width="22" height="14" rx="3"/>');
            }
            out.push('<text x="' + (entry.x + 28) + '" y="' + (entry.y + 11) + '">' + escape(entry.text) + "</text>");
        });
        out.push("</g>");
        out.push("</svg>");
        return out.join("");
    }

    return {
        TEXTS: TEXTS,
        DOCUMENT_ORDER: DOCUMENT_ORDER,
        format: format,
        sectionOf: sectionOf,
        wayPath: wayPath,
        wrap: wrap,
        escape: escape,
        layout: layout,
        svg: svg,
        NODE_W: NODE_W,
        LANE_H: LANE_H
    };
});
