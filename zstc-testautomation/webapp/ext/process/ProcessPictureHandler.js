sap.ui.define(["sap/m/Popover", "sap/m/VBox", "sap/m/ObjectStatus", "sap/m/Text"], function (Popover, VBox, ObjectStatus, Text) {
    "use strict";

    const PICTURE = "zstc.testautomation.ext.process.ProcessPicture";
    const STATE_TEXT = { run: "inRun", taken: "legendTaken", before: "notInRun", after: "notInRun", off: "notInRun", covered: "covered", gap: "notCovered", way: "legendWay" };

    /** the process picture next to a control of the toolbar (same VBox) */
    function pictureNear(control) {
        let box = control;
        while (box && !(box.isA && box.isA("sap.m.VBox"))) {
            box = box.getParent();
        }
        return box
            ? box.getItems().find(function (item) {
                  return item.isA(PICTURE);
              })
            : undefined;
    }

    function bundleOf(control) {
        const model = control.getModel("i18n");
        return model && model.getResourceBundle();
    }

    /**
     * Event handlers of the process picture sections (test case: way of the test case; business process: all ways).
     * The step details come from the process model; the state in the test case from the layout of the picture.
     */
    return {
        onModeChange: function (event) {
            const picture = pictureNear(event.getSource());
            if (picture) {
                picture.setMode(event.getParameter("item").getKey());
            }
        },

        onVariantChange: function (event) {
            const picture = pictureNear(event.getSource());
            const item = event.getParameter("selectedItem");
            if (picture) {
                picture.setVariant(item ? item.getKey() : "");
            }
        },

        onLaterChange: function (event) {
            const picture = pictureNear(event.getSource());
            if (picture) {
                picture.setShowLater(event.getParameter("selected"));
            }
        },

        /** details of a step in a popover next to the step */
        onStepPress: function (event) {
            const picture = event.getSource();
            const node = event.getParameter("node");
            const domRef = event.getParameter("domRef");
            const bundle = bundleOf(picture);
            if (!node || !domRef || !bundle) {
                return;
            }
            const text = function (key, args) {
                return bundle.getText(key, args);
            };
            const step = node.step;
            const texts = picture.getLayout().texts;
            const automation = { automated: text("ppAutomated"), decision: texts.decision, manual: texts.manual, later: texts.later }[node.kind];
            const rows = [
                [text("ppDetailTeam"), (step.TeamName || step.ResponsibleTeam || texts.teamOpen) + (step.TeamAssignment === "ASSUMED" ? " (" + texts.assumed + ")" : "")],
                [text("ppDetailAutomation"), automation],
                [text("ppDetailObject"), step.BusinessObjectType ? text("bo" + step.BusinessObjectType) : "–"],
                [text("ppDetailWays"), String(step.Variants || "").split(",").join(", ")]
            ];
            if (STATE_TEXT[node.state]) {
                rows.push([text("ppDetailState"), texts[STATE_TEXT[node.state]]]);
            }
            if (node.result) {
                rows.push([text("ppDetailResult"), texts["legend" + node.result.charAt(0).toUpperCase() + node.result.slice(1)]]);
            }
            const popover = new Popover({
                title: step.StepID + " " + step.StepName,
                placement: "Auto",
                contentWidth: "22rem",
                content: [
                    new VBox({
                        items: rows.map(function (row) {
                            return new ObjectStatus({ title: row[0], text: row[1] });
                        }).concat(node.flag ? [new Text({ text: node.flag })] : [])
                    }).addStyleClass("sapUiSmallMargin")
                ],
                afterClose: function () {
                    popover.destroy();
                }
            });
            picture.addDependent(popover);
            popover.openBy(domRef);
        }
    };
});
