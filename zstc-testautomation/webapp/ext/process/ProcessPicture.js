sap.ui.define(["sap/ui/core/Control", "./pictureLayout", "./ProcessPictureStep", "./ProcessPictureResult"], function (Control, pictureLayout) {
    "use strict";

    /** i18n keys of the texts of the picture: pp + key with a capital letter (e.g. ppLegendRun) */
    function textsOf(control) {
        const model = control.getModel("i18n");
        const bundle = model && model.getResourceBundle && model.getResourceBundle();
        const texts = {};
        if (bundle && typeof bundle.getText === "function") {
            Object.keys(pictureLayout.TEXTS).forEach(function (key) {
                const i18nKey = "pp" + key.charAt(0).toUpperCase() + key.slice(1);
                const text = bundle.getText(i18nKey, undefined, true);
                if (text) {
                    texts[key] = text;
                }
            });
        }
        return texts;
    }

    /**
     * Process picture (app control, not an SAP standard control): one swim lane per process team, the process steps in
     * process order, the section of a test case highlighted (start, end, handovers, documents taken over from a
     * predecessor) and — after a run — the result per step. Rendered as SVG by ./pictureLayout (pure layout module).
     * Steps and results are aggregations, so they bind to OData (ProcessStepVH / ProcessStep, ExecutionStep) or JSON.
     * Pressing a step (mouse, Enter, Space) fires stepPress.
     */
    const ProcessPicture = Control.extend("zstc.testautomation.ext.process.ProcessPicture", {
        metadata: {
            properties: {
                /** WAY: the steps of the way; PROCESS: all pilot steps with the connections of all ways */
                mode: { type: "string", defaultValue: "WAY" },
                /** horizontal: lanes as rows (wide pages); vertical: lanes as columns (narrow panels) */
                orientation: { type: "string", defaultValue: "horizontal" },
                variant: { type: "string", defaultValue: "" },
                startObject: { type: "string", defaultValue: "" },
                endObject: { type: "string", defaultValue: "" },
                predecessorObject: { type: "string", defaultValue: "" },
                /** highlight the section start..end of a test case (false: highlight the way only) */
                showSection: { type: "boolean", defaultValue: true },
                showLater: { type: "boolean", defaultValue: false },
                showResults: { type: "boolean", defaultValue: true },
                showCaption: { type: "boolean", defaultValue: true },
                /** StepID → number of test cases (coverage of a test package, PROCESS mode) */
                coverage: { type: "object", defaultValue: null },
                /** smallest scale before the picture scrolls horizontally */
                minScale: { type: "float", defaultValue: 0.8 },
                title: { type: "string", defaultValue: "" }
            },
            aggregations: {
                steps: { type: "zstc.testautomation.ext.process.ProcessPictureStep", multiple: true, singularName: "step" },
                results: { type: "zstc.testautomation.ext.process.ProcessPictureResult", multiple: true, singularName: "result" },
                /** test assertions of the run (status = assertion result): a failed check fails its step */
                checks: { type: "zstc.testautomation.ext.process.ProcessPictureResult", multiple: true, singularName: "check" }
            },
            events: {
                stepPress: {
                    parameters: {
                        stepId: { type: "string" },
                        node: { type: "object" },
                        domRef: { type: "object" }
                    }
                }
            }
        },

        renderer: {
            apiVersion: 2,
            render: function (rm, control) {
                const model = control.getLayout();
                const texts = model.texts;
                rm.openStart("div", control);
                rm.class("zstcProcessPicture");
                rm.style("width", "100%");
                rm.openEnd();
                const caption = control.getShowCaption() ? control.getCaption() : "";
                if (caption) {
                    rm.openStart("div");
                    rm.class("sapUiTinyMarginBottom");
                    rm.class("sapMText");
                    rm.openEnd();
                    rm.text(caption);
                    rm.close("div");
                }
                rm.openStart("div");
                rm.style("overflow-x", "auto");
                rm.style("width", "100%");
                rm.openEnd();
                rm.openStart("div");
                rm.style("min-width", Math.round(model.width * control.getMinScale()) + "px");
                rm.style("max-width", model.width + "px");
                rm.openEnd();
                rm.unsafeHtml(pictureLayout.svg(model, { id: control.getId() + "-svg", title: control.getTitle() || texts.picture }));
                rm.close("div");
                rm.close("div");
                rm.close("div");
            }
        },

        /** steps of the aggregation in the input format of the layout */
        _stepRows: function () {
            return this.getSteps().map(function (step) {
                return {
                    StepID: step.getStepId(),
                    StepName: step.getName(),
                    Sequence: step.getSequence(),
                    BusinessObjectType: step.getBusinessObject(),
                    ResponsibleTeam: step.getTeam(),
                    TeamName: step.getTeamName(),
                    TeamAssignment: step.getAssignment(),
                    Variants: step.getVariants(),
                    PilotScope: step.getPilot(),
                    Automation: step.getAutomation()
                };
            });
        },

        /** @returns {object} layout of the current state (see pictureLayout.layout) */
        getLayout: function () {
            let results = null;
            const checks = {};
            if (this.getShowResults() && this.getResults().length) {
                results = {};
                this.getResults().forEach(function (result) {
                    results[result.getStepId()] = result.getStatus();
                });
                const rank = { FAILED: 3, WARNING: 2, PASSED: 1 };
                this.getChecks().forEach(function (check) {
                    const id = check.getStepId();
                    if ((rank[check.getStatus()] || 0) > (rank[checks[id]] || 0)) {
                        checks[id] = check.getStatus();
                    }
                });
            }
            this._layout = pictureLayout.layout({
                steps: this._stepRows(),
                mode: this.getMode(),
                variant: this.getVariant(),
                startObject: this.getStartObject(),
                endObject: this.getEndObject(),
                predecessorObject: this.getPredecessorObject(),
                section: this.getShowSection(),
                showLater: this.getShowLater(),
                results: results,
                checks: checks,
                coverage: this.getCoverage(),
                orientation: this.getOrientation(),
                texts: textsOf(this)
            });
            return this._layout;
        },

        /** short text above the picture: steps in the run, start and end, handovers */
        getCaption: function () {
            const model = this._layout || this.getLayout();
            const summary = model.summary;
            const texts = model.texts;
            if (model.empty || !summary.total) {
                return "";
            }
            if (this.getCoverage()) {
                return pictureLayout.format(texts.stepsCovered, [summary.covered, summary.automated]);
            }
            if (!summary.inRun) {
                return "";
            }
            const parts = [pictureLayout.format(texts.stepsInRun, [summary.inRun, summary.total])];
            if (summary.first) {
                parts.push(texts.start + ": " + summary.first + (summary.last && summary.last !== summary.first ? " · " + texts.end + ": " + summary.last : ""));
            }
            if (summary.handovers) {
                parts.push(pictureLayout.format(summary.handovers === 1 ? texts.handoverOne : texts.handoverMany, [summary.handovers]));
            }
            return parts.join(" · ");
        },

        /** node of a step in the current layout (state, result, team) */
        getNode: function (stepId) {
            const model = this._layout || this.getLayout();
            return model.nodes.find(function (node) {
                return node.id === stepId;
            });
        },

        _fire: function (event) {
            const target = event.target && event.target.closest ? event.target.closest("[data-step]") : null;
            if (!target) {
                return false;
            }
            const stepId = target.getAttribute("data-step");
            this.fireStepPress({ stepId: stepId, node: this.getNode(stepId), domRef: target });
            return true;
        },

        onclick: function (event) {
            this._fire(event);
        },

        onkeydown: function (event) {
            if ((event.key === "Enter" || event.key === " ") && this._fire(event)) {
                event.preventDefault();
            }
        }
    });

    return ProcessPicture;
});
