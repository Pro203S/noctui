import { COMPONENT_NAME as TEXT_COMPONENT_NAME } from "../../components/Text.js";
import { COMPONENT_NAME as VIEW_COMPONENT_NAME } from "../../components/View.js";
import type { NoctUIChild } from "../reconciler/index.js";
import { serializeGrid } from "./color.js";
import { createGrid, gridToPlainText, resizeGrid } from "./grid.js";
import { normalizeCellCount, ZERO_EDGES } from "./style.js";
import { textToGrid } from "./text.js";
import type {
    CellGrid,
    LayoutChild,
    LayoutConstraints,
    LayoutResult,
} from "./types.js";
import { layoutView } from "./view.js";

function emptyResult(): LayoutResult {
    return {
        grid: createGrid(0, 0),
        margin: { ...ZERO_EDGES },
        position: { mode: "static", zIndex: 0 },
        autoWidth: true,
        autoHeight: true,
    };
}

function constrainTextGrid(
    text: string,
    constraints: LayoutConstraints,
): CellGrid {
    const stretchWidth = normalizeCellCount(constraints.stretchWidth);
    const maximumWidth = normalizeCellCount(constraints.maxWidth);
    const width = stretchWidth ?? maximumWidth;
    let grid = textToGrid(text, width);
    const stretchHeight = normalizeCellCount(constraints.stretchHeight);
    const maximumHeight = normalizeCellCount(constraints.maxHeight);

    if (stretchHeight !== undefined) {
        grid = resizeGrid(grid, grid.width, stretchHeight);
    } else if (maximumHeight !== undefined && grid.height > maximumHeight) {
        grid = resizeGrid(grid, grid.width, maximumHeight);
    }

    return grid;
}

function textResult(
    text: string,
    constraints: LayoutConstraints = {},
): LayoutResult {
    return {
        grid: constrainTextGrid(text, constraints),
        margin: { ...ZERO_EDGES },
        position: { mode: "static", zIndex: 0 },
        autoWidth: constraints.stretchWidth === undefined,
        autoHeight: constraints.stretchHeight === undefined,
    };
}

function renderTextChild(child: NoctUIChild): string {
    if (child.hidden) {
        return "";
    }

    if (child.kind === "text") {
        return child.text;
    }

    if (child.type === TEXT_COMPONENT_NAME) {
        const children = child.children.map(renderTextChild).join("");
        return child.component.render(child.props, children);
    }

    return gridToPlainText(layoutNode(child).grid);
}

function resolveAbsoluteLayout(
    child: NoctUIChild,
    parentX = 0,
    parentY = 0,
): void {
    if (
        child.kind !== "component" ||
        child.type !== VIEW_COMPONENT_NAME
    ) {
        return;
    }

    const x = parentX + child.layout.x;
    const y = parentY + child.layout.y;

    child.layout = {
        ...child.layout,
        x,
        y,
    };

    for (const nestedChild of child.children) {
        resolveAbsoluteLayout(
            nestedChild,
            x,
            y,
        );
    }
}

function layoutNode(
    child: NoctUIChild,
    constraints: LayoutConstraints = {},
): LayoutResult {
    if (child.hidden) {
        return emptyResult();
    }

    if (child.kind === "text") {
        return textResult(child.text, constraints);
    }

    switch (child.type) {
        case TEXT_COMPONENT_NAME: {
            const children = child.children.map(renderTextChild).join("");

            return textResult(
                child.component.render(child.props, children),
                constraints,
            );
        }

        case VIEW_COMPONENT_NAME: {
            const children = child.children.map(createLayoutChild);

            return child.component.render(
                child.props,
                children,
                constraints,
            );
        }
    }
}

function createLayoutChild(
    child: NoctUIChild,
    sourceIndex: number,
): LayoutChild {
    return {
        sourceIndex,

        layout(constraints) {
            return layoutNode(child, constraints);
        },

        setLayout(layout) {
            if (
                child.kind === "component" &&
                child.type === VIEW_COMPONENT_NAME
            ) {
                child.layout = layout;
            }
        },
    };
}

export function renderLayoutChildren(
    children: readonly NoctUIChild[],
): string {
    const root = layoutView({
        style: {},
        children: children.map(createLayoutChild),
    });

    for (const child of children) {
        resolveAbsoluteLayout(child);
    }

    return serializeGrid(root.grid);
}
